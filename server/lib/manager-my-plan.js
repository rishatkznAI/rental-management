const { normalizeRole } = require('./role-groups');

const ACTIVE_RENTAL_STATUSES = new Set(['active', 'confirmed', 'return_planned', 'delivery']);
const CLOSED_RENTAL_STATUSES = new Set(['closed', 'returned', 'cancelled', 'completed', 'done']);
const INACTIVE_EQUIPMENT_STATUSES = new Set(['inactive', 'sold', 'written_off', 'written-off', 'archived', 'decommissioned', 'disposed', 'scrapped']);
const RENTAL_MANAGER_ROLE = 'Менеджер по аренде';
const PLAN_ROLES = new Set(['Администратор', RENTAL_MANAGER_ROLE, 'Офис-менеджер', 'Руководитель']);
const SECRET_KEY_PATTERN = /(password|token|cookie|secret|private[_-]?key|authorization|auth[_-]?header|db[_-]?url|hash)/i;
const ACTIVITY_TYPES = new Set(['call', 'site_visit', 'note']);
const ACTIVITY_RESULTS = new Set(['completed', 'no_answer', 'scheduled', 'info', 'other']);

function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKey(value) {
  const raw = text(value);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function isoOrNow(value, fallback) {
  const raw = text(value);
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback;
}

function addDays(todayKey, days) {
  const parsed = new Date(`${todayKey}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function weekRange(todayKey) {
  const parsed = new Date(`${todayKey}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return { start: todayKey, end: todayKey };
  const day = parsed.getUTCDay() || 7;
  const start = new Date(parsed);
  start.setUTCDate(parsed.getUTCDate() - day + 1);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function isActiveRental(rental) {
  const status = lower(rental?.status || 'active');
  if (CLOSED_RENTAL_STATUSES.has(status)) return false;
  return ACTIVE_RENTAL_STATUSES.has(status) || !status;
}

function hasManagerLink(record, manager) {
  if (!manager.id && !manager.name) return true;
  const ids = [record?.managerId, record?.responsibleManagerId, record?.createdByUserId].map(text);
  if (manager.id && ids.includes(manager.id)) return true;
  const names = [record?.manager, record?.managerName, record?.responsibleManagerName, record?.createdByName].map(lower);
  return Boolean(manager.name && names.includes(lower(manager.name)));
}

function hasActivityManagerLink(record, manager) {
  if (!manager.id && !manager.name) return true;
  const ids = [record?.managerId, record?.userId, record?.createdBy].map(text);
  if (manager.id && ids.includes(manager.id)) return true;
  const names = [record?.managerName, record?.createdByName].map(lower);
  return Boolean(manager.name && names.includes(lower(manager.name)));
}

function clientName(record, clientsById) {
  const clientId = text(record?.clientId);
  return text(clientsById.get(clientId)?.company || clientsById.get(clientId)?.name || record?.clientName || record?.client) || 'Клиент не указан';
}

function rentalLabel(rental, clientsById) {
  const label = text(rental?.number || rental?.rentalNumber || rental?.id);
  return label ? `Аренда ${label}` : clientName(rental, clientsById);
}

function equipmentLabel(equipment) {
  return text([
    equipment?.inventoryNumber ? `№${equipment.inventoryNumber}` : '',
    equipment?.manufacturer,
    equipment?.model,
  ].filter(Boolean).join(' ')) || text(equipment?.name) || 'Техника';
}

function safeRental(rental, clientsById, equipmentById) {
  const equipmentId = text(rental?.equipmentId || rental?.equipment?.[0]);
  const equipment = equipmentById.get(equipmentId);
  return {
    id: text(rental?.id),
    label: rentalLabel(rental, clientsById),
    clientId: text(rental?.clientId),
    clientName: clientName(rental, clientsById),
    equipmentId,
    equipmentLabel: equipment ? equipmentLabel(equipment) : text(rental?.equipmentName || rental?.equipmentLabel || rental?.equipment?.join(', ')) || 'Техника не указана',
    startDate: dateKey(rental?.startDate),
    endDate: dateKey(rental?.endDate || rental?.plannedReturnDate),
    status: text(rental?.status || 'active'),
  };
}

function safeClient(client) {
  return {
    id: text(client?.id),
    label: text(client?.company || client?.name) || 'Клиент',
    lastActivityDate: dateKey(client?.lastActivityDate || client?.lastRentalDate || client?.updatedAt || client?.createdAt),
    managerName: text(client?.manager || client?.managerName),
  };
}

function safeActivity(activity, clientsById = new Map(), rentalsById = new Map(), equipmentById = new Map()) {
  const relatedClientId = text(activity?.relatedClientId);
  const relatedRentalId = text(activity?.relatedRentalId);
  const relatedEquipmentId = text(activity?.relatedEquipmentId);
  const rental = rentalsById.get(relatedRentalId);
  const equipment = equipmentById.get(relatedEquipmentId);
  const client = clientsById.get(relatedClientId || text(rental?.clientId));
  return {
    id: text(activity?.id),
    createdAt: isoOrNow(activity?.createdAt, ''),
    createdBy: text(activity?.createdBy || activity?.userId),
    userId: text(activity?.userId || activity?.createdBy),
    managerId: text(activity?.managerId || activity?.userId || activity?.createdBy),
    managerName: text(activity?.managerName || activity?.createdByName),
    activityType: ACTIVITY_TYPES.has(activity?.activityType) ? activity.activityType : 'note',
    relatedClientId,
    relatedRentalId,
    relatedEquipmentId,
    relatedLabel: text(client?.company || client?.name || rental?.clientName || rental?.client || equipment?.name || equipment?.inventoryNumber),
    resultStatus: ACTIVITY_RESULTS.has(activity?.resultStatus) ? activity.resultStatus : 'other',
    comment: text(activity?.comment).slice(0, 1000),
    activityDate: dateKey(activity?.activityDate || activity?.effectiveAt || activity?.createdAt),
    effectiveAt: isoOrNow(activity?.effectiveAt || activity?.activityDate || activity?.createdAt, ''),
  };
}

function safeDebt(record, clientsById) {
  return {
    id: text(record?.id || record?.clientId),
    clientId: text(record?.clientId),
    clientName: clientName(record, clientsById),
    rentalId: text(record?.rentalId || record?.id),
    amount: Math.max(0, number(record?.debt ?? record?.debtAmount ?? record?.outstanding ?? record?.balance)),
  };
}

function safeDocument(doc, clientsById) {
  return {
    id: text(doc?.id),
    label: text(doc?.number || doc?.documentNumber || doc?.title || doc?.id) || 'Документ',
    type: text(doc?.type || doc?.documentType || 'other'),
    status: text(doc?.status || 'draft'),
    clientId: text(doc?.clientId),
    clientName: clientName(doc, clientsById),
    rentalId: text(doc?.rentalId || doc?.sourceRentalId),
  };
}

function canRead(access, collection) {
  return access.readableCollections.includes(collection);
}

function buildAccess(userRole, getRoleAccessSummary) {
  if (typeof getRoleAccessSummary === 'function') {
    const summary = getRoleAccessSummary(userRole) || {};
    return {
      normalizedRole: normalizeRole(summary.normalizedRole || userRole),
      readableCollections: Array.isArray(summary.readableCollections) ? summary.readableCollections : [],
    };
  }
  return { normalizedRole: normalizeRole(userRole), readableCollections: [] };
}

function chooseManagerScope(req, users, access) {
  const role = access.normalizedRole;
  const own = {
    id: text(req.user?.userId),
    name: text(req.user?.userName),
  };
  if (role === RENTAL_MANAGER_ROLE) return own;

  const requestedId = text(req.query?.managerId);
  if (!requestedId) return { id: '', name: text(req.user?.userName) || 'Все менеджеры' };
  const manager = users.find(user => text(user?.id) === requestedId && normalizeRole(user?.role) === RENTAL_MANAGER_ROLE);
  return manager ? { id: text(manager.id), name: text(manager.name) } : { id: '', name: text(req.user?.userName) || 'Все менеджеры' };
}

function isPlanRoleAllowed(access) {
  return PLAN_ROLES.has(access.normalizedRole) && canRead(access, 'rentals');
}

function activeFleetEquipment(equipment) {
  return equipment.filter(item => {
    if (item?.archived || item?.deleted || item?.isForSale || item?.forSale || item?.saleMode) return false;
    const category = lower(item?.category || 'own');
    if (category === 'sold' || category === 'client') return false;
    if (item?.activeInFleet === false) return false;
    const status = lower(item?.status);
    return !INACTIVE_EQUIPMENT_STATUSES.has(status);
  });
}

function rentalIdentityKeys(rental) {
  return [
    rental?.id,
    rental?.rentalId,
    rental?.sourceRentalId,
    rental?.linkedRentalId,
  ].map(text).filter(Boolean);
}

function dedupeRentals(rentals) {
  const byKey = new Map();
  const result = [];
  for (const rental of rentals) {
    const keys = rentalIdentityKeys(rental);
    const existingIndex = keys.map(key => byKey.get(key)).find(index => index !== undefined);
    if (existingIndex === undefined) {
      const index = result.length;
      result.push(rental);
      keys.forEach(key => byKey.set(key, index));
      continue;
    }
    result[existingIndex] = { ...result[existingIndex], ...rental };
    rentalIdentityKeys(result[existingIndex]).forEach(key => byKey.set(key, existingIndex));
  }
  return result;
}

function rentalEquipmentId(rental) {
  return text(rental?.equipmentId || rental?.equipment?.[0] || rental?.equipmentIds?.[0]);
}

function calculateUtilization(equipment, activeRentals) {
  const fleet = activeFleetEquipment(equipment);
  if (fleet.length === 0) {
    return { percent: 0, known: false, reason: 'Нет данных об активной технике в парке.' };
  }
  const fleetIds = new Set(fleet.map(item => text(item.id)).filter(Boolean));
  const occupied = new Set();
  activeRentals.forEach(rental => {
    const equipmentId = rentalEquipmentId(rental);
    if (equipmentId && fleetIds.has(equipmentId)) occupied.add(equipmentId);
  });
  return {
    percent: Math.round((occupied.size / fleet.length) * 100),
    known: true,
    reason: '',
  };
}

function link(label, type, id) {
  return { label: text(label) || 'Открыть', type, id: text(id) };
}

function task(level, type, title, description, action, taskLink) {
  return {
    level,
    type,
    title,
    description,
    action,
    link: taskLink,
  };
}

function documentType(doc) {
  return lower(doc?.type || doc?.documentType);
}

function documentLinkedToRental(doc, rental) {
  const rentalIds = [rental?.id, rental?.rentalId, rental?.sourceRentalId].map(text).filter(Boolean);
  const docRentalIds = [doc?.rentalId, doc?.sourceRentalId, doc?.linkedRentalId].map(text).filter(Boolean);
  if (docRentalIds.some(id => rentalIds.includes(id))) return true;
  const docIds = Array.isArray(rental?.documents) ? rental.documents.map(text) : [];
  return docIds.includes(text(doc?.id));
}

function hasContract(doc) {
  const type = documentType(doc);
  return type === 'contract' || type === 'rental_contract';
}

function hasUpd(doc) {
  const type = documentType(doc);
  return type === 'upd' || type === 'act' || type === 'transfer_act_to_client' || type === 'return_act_from_client';
}

function assertNoSecretKeys(value, path = '$') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new Error(`Unsafe manager plan key ${path}.${key}`);
    }
    assertNoSecretKeys(child, `${path}.${key}`);
  }
}

function activityMatchesPeriod(activity, fromKey, toKey) {
  const key = dateKey(activity?.activityDate || activity?.effectiveAt || activity?.createdAt);
  if (!key) return false;
  if (fromKey && key < fromKey) return false;
  if (toKey && key > toKey) return false;
  return true;
}

function buildActivityAggregates({
  activityRows = [],
  manager,
  todayKey,
  dailyCallsTarget = 0,
  weeklySiteVisitsTarget = 0,
  required = false,
  clientsById = new Map(),
  rentalsById = new Map(),
  equipmentById = new Map(),
}) {
  const week = weekRange(todayKey);
  const scoped = activityRows
    .filter(item => hasActivityManagerLink(item, manager))
    .map(item => safeActivity(item, clientsById, rentalsById, equipmentById))
    .filter(item => item.id);
  const todayCallsDone = scoped.filter(item => item.activityType === 'call' && item.activityDate === todayKey).length;
  const weekSiteVisitsDone = scoped.filter(item => (
    item.activityType === 'site_visit'
    && item.activityDate >= week.start
    && item.activityDate <= week.end
  )).length;
  const completionBase = dailyCallsTarget + weeklySiteVisitsTarget;
  const completionDone = Math.min(todayCallsDone, dailyCallsTarget) + Math.min(weekSiteVisitsDone, weeklySiteVisitsTarget);
  const completionPercent = completionBase > 0 ? Math.round((completionDone / completionBase) * 100) : 100;
  const activityProgressStatus = !required
    ? 'optional'
    : completionPercent >= 100
      ? 'complete'
      : completionPercent > 0
        ? 'in_progress'
        : 'not_started';
  const nextRecommendedAction = !required
    ? 'Фокус дня — удержание, продления, возвраты, долги и документы.'
    : todayCallsDone < dailyCallsTarget
      ? 'Нужен звонок клиенту.'
      : weekSiteVisitsDone < weeklySiteVisitsTarget
        ? 'Нужен выезд на объект.'
        : 'План активности выполнен, проверьте задачи с рисками.';
  return {
    todayCallsDone,
    todayCallsTarget: dailyCallsTarget,
    weekSiteVisitsDone,
    weekSiteVisitsTarget: weeklySiteVisitsTarget,
    activityProgressStatus,
    nextRecommendedAction,
    completionPercent,
    recentActivity: scoped
      .sort((a, b) => text(b.effectiveAt || b.createdAt).localeCompare(text(a.effectiveAt || a.createdAt)))
      .slice(0, 8),
  };
}

function buildManagerMyPlan(input) {
  const {
    req,
    readData,
    getRoleAccessSummary,
    todayKey = dateKey(new Date().toISOString()),
  } = input;
  const access = buildAccess(req.user?.userRole, getRoleAccessSummary);
  if (!isPlanRoleAllowed(access)) {
    return { status: 403, body: { ok: false, error: 'Forbidden' } };
  }

  const users = readData('users') || [];
  const manager = chooseManagerScope(req, users, access);
  const canScopeByManager = Boolean(manager.id || manager.name);
  const read = collection => (canRead(access, collection) ? (readData(collection) || []) : []);
  const equipment = read('equipment');
  const rentalsRaw = dedupeRentals([...read('rentals'), ...read('gantt_rentals')]);
  const clients = read('clients');
  const payments = read('payments');
  const documentsRaw = read('documents');
  const service = read('service');
  const activityRows = readData('manager_activity') || [];

  const clientsById = new Map(clients.map(item => [text(item.id), item]));
  const equipmentById = new Map(equipment.map(item => [text(item.id), item]));
  const rentals = canScopeByManager
    ? rentalsRaw.filter(item => hasManagerLink(item, manager))
    : rentalsRaw;
  const activeRentals = rentals.filter(isActiveRental);
  const rentalsById = new Map(rentals.map(item => [text(item.id), item]));
  const utilization = canRead(access, 'equipment')
    ? calculateUtilization(equipment, activeRentals)
    : { percent: 0, known: false, reason: 'Нет доступа к данным техники для расчета загрузки парка.' };

  const tomorrowKey = addDays(todayKey, 1);
  const soonLimitKey = addDays(todayKey, 7);
  const endingToday = activeRentals.filter(item => dateKey(item.endDate || item.plannedReturnDate) === todayKey);
  const endingTomorrow = activeRentals.filter(item => dateKey(item.endDate || item.plannedReturnDate) === tomorrowKey);
  const overdue = activeRentals.filter(item => {
    const end = dateKey(item.endDate || item.plannedReturnDate);
    return end && end < todayKey;
  });
  const endingSoon = activeRentals.filter(item => {
    const end = dateKey(item.endDate || item.plannedReturnDate);
    return end && end >= todayKey && end <= soonLimitKey;
  });

  const rentalDocuments = documentsRaw.filter(doc => rentals.some(rental => documentLinkedToRental(doc, rental)));
  const missingContractRentals = canRead(access, 'documents')
    ? activeRentals.filter(rental => !rentalDocuments.some(doc => documentLinkedToRental(doc, rental) && hasContract(doc)))
    : [];
  const missingUpdRentals = canRead(access, 'documents')
    ? activeRentals.filter(rental => !rentalDocuments.some(doc => documentLinkedToRental(doc, rental) && hasUpd(doc)))
    : [];
  const unsignedDocuments = rentalDocuments.filter(doc => lower(doc.status) !== 'signed' && lower(doc.status) !== 'cancelled');

  const debtByClientRental = new Map();
  rentals.forEach(rental => {
    const amount = number(rental.debt ?? rental.debtAmount ?? rental.outstanding);
    if (amount <= 0) return;
    const key = `${text(rental.clientId)}:${text(rental.id)}`;
    debtByClientRental.set(key, safeDebt({ ...rental, amount, debt: amount }, clientsById));
  });
  payments.forEach(payment => {
    const amount = number(payment.debt ?? payment.debtAmount ?? payment.outstanding ?? payment.balance);
    if (amount <= 0) return;
    const linkedRental = rentals.find(rental => text(rental.id) === text(payment.rentalId));
    if (!linkedRental && canScopeByManager) return;
    const key = `${text(payment.clientId || linkedRental?.clientId)}:${text(payment.rentalId)}`;
    debtByClientRental.set(key, safeDebt({ ...payment, clientId: payment.clientId || linkedRental?.clientId }, clientsById));
  });
  const debtors = Array.from(debtByClientRental.values()).sort((a, b) => b.amount - a.amount);
  const totalDebt = debtors.reduce((sum, item) => sum + item.amount, 0);

  const recentLimitKey = addDays(todayKey, -30);
  const rentalClientIds = new Set(activeRentals.map(item => text(item.clientId)).filter(Boolean));
  const scopedClients = canScopeByManager ? clients.filter(item => hasManagerLink(item, manager)) : clients;
  const clientsWithoutRecentActivity = scopedClients.filter(client => {
    const last = dateKey(client.lastActivityDate || client.lastRentalDate || client.updatedAt || client.createdAt);
    return !rentalClientIds.has(text(client.id)) && (!last || last < recentLimitKey);
  }).map(safeClient).slice(0, 20);

  const tasks = [];
  overdue.slice(0, 8).forEach(rental => tasks.push(task(
    'risk',
    'return',
    'Есть риск: просроченный возврат',
    `${rentalLabel(rental, clientsById)} должна была вернуться ${dateKey(rental.endDate || rental.plannedReturnDate) || 'по плану'}.`,
    'Связаться с клиентом и согласовать возврат или продление.',
    link(rentalLabel(rental, clientsById), 'rental', rental.id),
  )));
  [...endingToday, ...endingTomorrow].slice(0, 8).forEach(rental => tasks.push(task(
    'warning',
    'return',
    dateKey(rental.endDate || rental.plannedReturnDate) === todayKey ? 'Нужно действие: возврат сегодня' : 'Нужно действие: возврат завтра',
    `${clientName(rental, clientsById)}: проверьте готовность к возврату.`,
    'Подтвердить дату, доставку и состояние техники.',
    link(rentalLabel(rental, clientsById), 'rental', rental.id),
  )));
  endingSoon.slice(0, 8).forEach(rental => tasks.push(task(
    'info',
    'rental_extension',
    'Аренда скоро заканчивается',
    `${clientName(rental, clientsById)}: окончание ${dateKey(rental.endDate || rental.plannedReturnDate)}.`,
    'Предложить продление до освобождения техники.',
    link(rentalLabel(rental, clientsById), 'rental', rental.id),
  )));
  debtors.slice(0, 8).forEach(row => tasks.push(task(
    'risk',
    'debt',
    'Есть риск: клиент с долгом',
    `${row.clientName}: долг ${Math.round(row.amount).toLocaleString('ru-RU')} ₽.`,
    'Проверить оплату и согласовать следующий шаг.',
    link(row.clientName, row.rentalId ? 'rental' : 'client', row.rentalId || row.clientId),
  )));
  missingUpdRentals.slice(0, 6).forEach(rental => tasks.push(task(
    'warning',
    'document',
    'Аренда без УПД',
    `${clientName(rental, clientsById)}: не найден УПД или акт.`,
    'Проверить комплект закрывающих документов.',
    link(rentalLabel(rental, clientsById), 'rental', rental.id),
  )));
  missingContractRentals.slice(0, 6).forEach(rental => tasks.push(task(
    'warning',
    'document',
    'Аренда без договора',
    `${clientName(rental, clientsById)}: не найден договор аренды.`,
    'Запросить или оформить договор до следующего действия.',
    link(rentalLabel(rental, clientsById), 'rental', rental.id),
  )));
  unsignedDocuments.slice(0, 6).forEach(doc => tasks.push(task(
    'warning',
    'document',
    'Документ не подписан',
    `${safeDocument(doc, clientsById).label}: статус ${text(doc.status) || 'не указан'}.`,
    'Проверить подпись и отправку клиенту.',
    link(safeDocument(doc, clientsById).label, 'document', doc.id),
  )));
  clientsWithoutRecentActivity.slice(0, 8).forEach(client => tasks.push(task(
    'info',
    'client_activity',
    'Клиент без активности',
    `${client.label}: давно не было активных аренд.`,
    'Запланировать касание и уточнить потребность в технике.',
    link(client.label, 'client', client.id),
  )));

  const occupiedEquipmentIds = new Set(activeRentals.map(rentalEquipmentId).filter(Boolean));
  activeFleetEquipment(equipment)
    .filter(item => !occupiedEquipmentIds.has(text(item.id)) && lower(item.status) === 'available')
    .slice(0, 6)
    .forEach(item => tasks.push(task(
      'info',
      'idle_equipment',
      'Техника свободна для аренды',
      `${equipmentLabel(item)} сейчас не занята активной арендой.`,
      'Проверить подходящих клиентов и предложить технику.',
      link(equipmentLabel(item), 'equipment', item.id),
    )));
  service
    .filter(item => ['ready', 'closed'].includes(lower(item.status)) && text(item.equipmentId))
    .slice(0, 4)
    .forEach(item => {
      const eq = equipmentById.get(text(item.equipmentId));
      tasks.push(task(
        'info',
        'idle_equipment',
        'Техника после ремонта доступна',
        `${eq ? equipmentLabel(eq) : 'Техника'} готова к следующей аренде.`,
        'Проверить готовность к выдаче и предложить клиентам.',
        link(eq ? equipmentLabel(eq) : 'Техника', 'equipment', item.equipmentId),
      ));
    });

  const planStatus = utilization.known
    ? (utilization.percent >= 80 ? 'done' : 'needs_activity')
    : 'unknown';
  const activityRequired = planStatus === 'needs_activity';
  const activityMessage = planStatus === 'done'
    ? 'Парк загружен, фокус — продления, возвраты, долги и документы.'
    : planStatus === 'needs_activity'
      ? 'Загрузка ниже 80%, нужен активный поиск аренды.'
      : `Загрузку нельзя посчитать: ${utilization.reason}`;
  const activityAggregates = buildActivityAggregates({
    activityRows,
    manager,
    todayKey,
    dailyCallsTarget: activityRequired ? 40 : 0,
    weeklySiteVisitsTarget: activityRequired ? 2 : 0,
    required: activityRequired,
    clientsById,
    rentalsById,
    equipmentById,
  });

  const body = {
    summary: {
      managerName: manager.name || 'Все менеджеры',
      fleetUtilizationPercent: utilization.known ? utilization.percent : 0,
      planStatus,
      activeRentals: activeRentals.length,
      rentalsEndingSoon: endingSoon.length,
      overdueReturns: overdue.length,
      debtAmount: totalDebt,
      documentsMissing: missingContractRentals.length + missingUpdRentals.length + unsignedDocuments.length,
      clientsWithoutActivity: clientsWithoutRecentActivity.length,
      todayCallsDone: activityAggregates.todayCallsDone,
      todayCallsTarget: activityAggregates.todayCallsTarget,
      weekSiteVisitsDone: activityAggregates.weekSiteVisitsDone,
      weekSiteVisitsTarget: activityAggregates.weekSiteVisitsTarget,
      activityProgressStatus: activityAggregates.activityProgressStatus,
      nextRecommendedAction: activityAggregates.nextRecommendedAction,
      completionPercent: activityAggregates.completionPercent,
    },
    activityTarget: {
      required: activityRequired,
      reason: utilization.known ? (activityRequired ? 'Загрузка парка ниже 80%.' : 'Загрузка парка 80% или выше.') : utilization.reason,
      dailyCallsTarget: activityRequired ? 40 : 0,
      weeklySiteVisitsTarget: activityRequired ? 2 : 0,
      message: activityMessage,
      todayCallsDone: activityAggregates.todayCallsDone,
      todayCallsTarget: activityAggregates.todayCallsTarget,
      weekSiteVisitsDone: activityAggregates.weekSiteVisitsDone,
      weekSiteVisitsTarget: activityAggregates.weekSiteVisitsTarget,
      activityProgressStatus: activityAggregates.activityProgressStatus,
      nextRecommendedAction: activityAggregates.nextRecommendedAction,
      completionPercent: activityAggregates.completionPercent,
    },
    recentActivity: activityAggregates.recentActivity,
    tasks: tasks.slice(0, 40),
    rentals: {
      endingToday: endingToday.map(item => safeRental(item, clientsById, equipmentById)),
      endingTomorrow: endingTomorrow.map(item => safeRental(item, clientsById, equipmentById)),
      overdue: overdue.map(item => safeRental(item, clientsById, equipmentById)),
      active: activeRentals.slice(0, 50).map(item => safeRental(item, clientsById, equipmentById)),
    },
    money: {
      debtors,
      totalDebt,
    },
    documents: {
      missingContract: missingContractRentals.map(item => safeRental(item, clientsById, equipmentById)),
      missingUpd: missingUpdRentals.map(item => safeRental(item, clientsById, equipmentById)),
      unsigned: unsignedDocuments.map(item => safeDocument(item, clientsById)),
    },
    clients: {
      withoutRecentActivity: clientsWithoutRecentActivity,
    },
  };

  assertNoSecretKeys(body);
  return { status: 200, body };
}

module.exports = {
  buildManagerMyPlan,
  buildActivityAggregates,
  safeActivity,
  activityMatchesPeriod,
  chooseManagerScope,
  buildAccess,
  text,
  dateKey,
  isPlanRoleAllowed,
};
