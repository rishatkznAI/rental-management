const OPEN_RENTAL_STATUSES = new Set(['active', 'created', 'confirmed', 'return_planned']);
const CLOSED_RENTAL_STATUSES = new Set(['returned', 'closed', 'cancelled']);
const OPEN_SERVICE_STATUSES = new Set(['new', 'open', 'assigned', 'in_progress', 'waiting_parts', 'needs_revision', 'ready']);
const IGNORED_PAYMENT_STATUSES = new Set(['cancelled', 'canceled', 'void', 'error', 'failed', 'closed', 'deleted', 'reversed']);
const IGNORED_FINANCE_RENTAL_STATUSES = new Set(['created', 'cancelled', 'canceled', 'deleted', 'archived']);

function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function dateKey(value) {
  const raw = text(value);
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  const startKey = dateKey(start);
  const endKey = dateKey(end);
  if (!startKey || !endKey) return 0;
  return Math.max(0, Math.ceil((new Date(endKey).getTime() - new Date(startKey).getTime()) / 86400000));
}

function matchesEquipmentBySafeKey(record, equipment, inventoryIsUnique) {
  if (!record || !equipment) return false;
  if (record.equipmentId && equipment.id && String(record.equipmentId) === String(equipment.id)) return true;
  if (inventoryIsUnique && record.equipmentInv && equipment.inventoryNumber && text(record.equipmentInv) === text(equipment.inventoryNumber)) return true;
  if (inventoryIsUnique && record.inventoryNumber && equipment.inventoryNumber && text(record.inventoryNumber) === text(equipment.inventoryNumber)) return true;
  if (record.serialNumber && equipment.serialNumber && text(record.serialNumber) === text(equipment.serialNumber)) return true;
  return false;
}

function isOpenRental(rental) {
  return OPEN_RENTAL_STATUSES.has(lower(rental?.status));
}

function isClosedRental(rental) {
  return CLOSED_RENTAL_STATUSES.has(lower(rental?.status));
}

function isOpenService(ticket) {
  const status = lower(ticket?.status);
  return !status || OPEN_SERVICE_STATUSES.has(status);
}

function sortByDateDesc(left, right, field) {
  return dateKey(right?.[field]).localeCompare(dateKey(left?.[field]));
}

function rentalStatusLabel(status) {
  const value = lower(status);
  if (value === 'active') return 'Активна';
  if (value === 'created' || value === 'confirmed') return 'Бронь';
  if (value === 'returned') return 'Возвращена';
  if (value === 'closed') return 'Закрыта';
  if (value === 'cancelled') return 'Отменена';
  return text(status) || 'Без статуса';
}

function serviceStatusLabel(status) {
  const value = lower(status);
  if (value === 'new') return 'Новая';
  if (value === 'assigned') return 'Назначена';
  if (value === 'in_progress') return 'В работе';
  if (value === 'waiting_parts') return 'Ожидание запчастей';
  if (value === 'needs_revision') return 'На доработке';
  if (value === 'ready') return 'Готово';
  if (value === 'closed') return 'Закрыта';
  return text(status) || 'Без статуса';
}

function documentTypeLabel(type) {
  const value = lower(type);
  if (value === 'contract') return 'Договор';
  if (value === 'act') return 'Акт';
  if (value === 'invoice') return 'Счёт';
  if (value === 'work_order') return 'Наряд';
  return text(type) || 'Документ';
}

function documentStatusLabel(status) {
  const value = lower(status);
  if (value === 'draft') return 'Черновик';
  if (value === 'sent') return 'Отправлен';
  if (value === 'signed') return 'Подписан';
  return text(status) || 'Без статуса';
}

function documentMatchesEquipment(doc, equipment, inventoryIsUnique) {
  if (matchesEquipmentBySafeKey(doc, equipment, inventoryIsUnique)) return true;
  if (doc?.equipmentInv && inventoryIsUnique && text(doc.equipmentInv) === text(equipment?.inventoryNumber)) return true;
  return false;
}

function clientDebtForRental(rental, clients) {
  const clientId = text(rental?.clientId);
  const clientName = lower(rental?.client);
  const client = (Array.isArray(clients) ? clients : []).find(item =>
    (clientId && text(item?.id) === clientId)
    || (!clientId && clientName && lower(item?.company) === clientName)
  );
  return number(client?.debt);
}

function paymentOutstanding(payment) {
  return Math.max(0, number(payment?.amount) - getEffectivePaidAmount(payment));
}

function shouldCountPayment(payment) {
  return !IGNORED_PAYMENT_STATUSES.has(lower(payment?.status));
}

function getEffectivePaidAmount(payment) {
  if (!shouldCountPayment(payment)) return 0;
  if (typeof payment?.paidAmount === 'number') return number(payment.paidAmount);
  if (lower(payment?.status) === 'paid') return number(payment?.amount);
  return 0;
}

export function buildEquipment360Summary(input = {}) {
  const equipment = input.equipment;
  const todayKey = dateKey(input.today) || new Date().toISOString().slice(0, 10);
  const inventoryIsUnique = input.inventoryIsUnique === true;

  if (!equipment) {
    return {
      occupancy: { state: 'unknown', label: 'Нет данных', currentRental: null, nextRental: null, overdueReturn: null },
      rentals: { latest: [], history: [], count: 0, averageDurationDays: 0 },
      service: { open: [], latest: [], waitingParts: 0, highPriorityOpen: [] },
      downtime: { label: 'Нет данных', days: null, reason: 'unknown' },
      documents: { latest: [], count: 0, unsigned: 0 },
      finance: { revenue: 0, outstanding: 0, rentalCount: 0, averageDurationDays: 0, utilizationPercent: null },
      flags: [],
    };
  }

  const rentals = (Array.isArray(input.rentals) ? input.rentals : [])
    .filter(item => matchesEquipmentBySafeKey(item, equipment, inventoryIsUnique))
    .sort((a, b) => sortByDateDesc(a, b, 'startDate'));
  const activeRentals = rentals.filter(isOpenRental);
  const currentRental = activeRentals
    .filter(item => dateKey(item?.startDate) <= todayKey && (!dateKey(item?.endDate) || dateKey(item?.endDate) >= todayKey))
    .sort((a, b) => dateKey(a?.endDate).localeCompare(dateKey(b?.endDate)))[0]
    || activeRentals.find(item => lower(item?.status) === 'active')
    || null;
  const futureRental = rentals
    .filter(item => isOpenRental(item) && dateKey(item?.startDate) > todayKey)
    .sort((a, b) => dateKey(a?.startDate).localeCompare(dateKey(b?.startDate)))[0]
    || null;
  const overdueReturn = activeRentals
    .filter(item => dateKey(item?.endDate) && dateKey(item?.endDate) < todayKey)
    .sort((a, b) => dateKey(a?.endDate).localeCompare(dateKey(b?.endDate)))[0]
    || null;

  const serviceTickets = (Array.isArray(input.serviceTickets) ? input.serviceTickets : [])
    .filter(item => matchesEquipmentBySafeKey(item, equipment, inventoryIsUnique))
    .sort((a, b) => sortByDateDesc(a, b, 'createdAt'));
  const openService = serviceTickets.filter(isOpenService);
  const highPriorityOpen = openService.filter(item => ['high', 'critical'].includes(lower(item?.priority)));
  const waitingParts = openService.filter(item => lower(item?.status) === 'waiting_parts').length;

  const documents = (Array.isArray(input.documents) ? input.documents : [])
    .filter(item => documentMatchesEquipment(item, equipment, inventoryIsUnique))
    .map(item => ({
      id: text(item?.id),
      type: documentTypeLabel(item?.type),
      status: documentStatusLabel(item?.status),
      rawStatus: lower(item?.status),
      date: dateKey(item?.date),
      rentalId: text(item?.rentalId || item?.rental),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const rentalIds = new Set(rentals.map(item => text(item?.id)).filter(Boolean));
  const payments = (Array.isArray(input.payments) ? input.payments : [])
    .filter(item => item?.rentalId && rentalIds.has(text(item.rentalId)) && shouldCountPayment(item));
  const financeRentals = rentals.filter(item => !IGNORED_FINANCE_RENTAL_STATUSES.has(lower(item?.status)));
  const revenue = financeRentals.reduce((sum, item) => sum + number(item?.amount ?? item?.price), 0);
  const outstanding = payments.reduce((sum, item) => sum + paymentOutstanding(item), 0);
  const durations = financeRentals.map(item => daysBetween(item?.startDate, item?.endDate)).filter(Boolean);
  const averageDurationDays = durations.length
    ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
    : 0;

  const closedRentals = rentals.filter(isClosedRental);
  const lastClosedRental = closedRentals
    .slice()
    .sort((a, b) => dateKey(b?.endDate).localeCompare(dateKey(a?.endDate)))[0]
    || null;
  let downtime = { label: 'Свободна сейчас', days: null, reason: 'available' };
  if (lower(equipment.status) === 'in_service' || openService.length > 0) {
    const since = openService.map(item => dateKey(item?.createdAt)).filter(Boolean).sort()[0];
    downtime = since
      ? { label: `Простой из-за сервиса: ${daysBetween(since, todayKey)} дн.`, days: daysBetween(since, todayKey), reason: 'service' }
      : { label: 'Простой из-за сервиса', days: null, reason: 'service' };
  } else if (currentRental) {
    downtime = { label: 'Сейчас в аренде', days: 0, reason: 'rented' };
  } else if (lastClosedRental?.endDate) {
    const idleDays = daysBetween(lastClosedRental.endDate, todayKey);
    downtime = { label: `Свободна ${idleDays} дн.`, days: idleDays, reason: 'available' };
  }

  const repeatedReasons = new Map();
  serviceTickets.forEach(ticket => {
    const reason = lower(ticket?.reason);
    if (!reason) return;
    repeatedReasons.set(reason, (repeatedReasons.get(reason) || 0) + 1);
  });

  const flags = [];
  if (lower(equipment.status) === 'in_service' || openService.length > 0) flags.push({ id: 'in-service', label: 'Техника в сервисе', severity: 'high' });
  if (highPriorityOpen.length > 0) flags.push({ id: 'high-service', label: 'Срочная сервисная заявка', severity: 'high' });
  if (overdueReturn) flags.push({ id: 'overdue-return', label: 'Просроченный возврат', severity: 'high' });
  if (currentRental && clientDebtForRental(currentRental, input.clients) > 0) flags.push({ id: 'active-client-debt', label: 'Активная аренда при долге клиента', severity: 'medium' });
  if (documents.length === 0) flags.push({ id: 'no-documents', label: 'Нет связанных документов', severity: 'medium' });
  if (dateKey(equipment.nextMaintenance) && dateKey(equipment.nextMaintenance) < todayKey) flags.push({ id: 'maintenance-overdue', label: 'Просрочено ТО', severity: 'high' });
  if (dateKey(equipment.maintenanceCHTO) && dateKey(equipment.maintenanceCHTO) < todayKey) flags.push({ id: 'chto-overdue', label: 'Просрочено ЧТО', severity: 'medium' });
  if (dateKey(equipment.maintenancePTO) && dateKey(equipment.maintenancePTO) < todayKey) flags.push({ id: 'pto-overdue', label: 'Просрочено ПТО', severity: 'medium' });
  if ([...repeatedReasons.values()].some(count => count >= 3)) flags.push({ id: 'repeat-service', label: 'Повторные сервисные обращения', severity: 'medium' });

  const occupancyState = lower(equipment.status);
  const occupancyLabel = currentRental
    ? 'В аренде'
    : openService.length > 0 || occupancyState === 'in_service'
      ? 'В сервисе'
      : futureRental
        ? 'Свободна, есть будущая бронь'
        : occupancyState === 'inactive'
          ? 'Списана'
          : occupancyState === 'reserved'
            ? 'Забронирована'
            : 'Свободна';

  return {
    occupancy: {
      state: occupancyState || 'unknown',
      label: occupancyLabel,
      currentRental: currentRental ? normalizeRental(currentRental) : null,
      nextRental: futureRental ? normalizeRental(futureRental) : null,
      overdueReturn: overdueReturn ? normalizeRental(overdueReturn) : null,
    },
    rentals: {
      latest: rentals.slice(0, 10).map(normalizeRental),
      history: rentals.map(normalizeRental),
      count: rentals.length,
      averageDurationDays,
    },
    service: {
      open: openService.slice(0, 10).map(normalizeServiceTicket),
      latest: serviceTickets.slice(0, 10).map(normalizeServiceTicket),
      waitingParts,
      highPriorityOpen: highPriorityOpen.map(normalizeServiceTicket),
    },
    downtime,
    documents: {
      latest: documents.slice(0, 10),
      count: documents.length,
      unsigned: documents.filter(item => item.rawStatus !== 'signed').length,
    },
    finance: {
      revenue,
      outstanding,
      rentalCount: financeRentals.length,
      averageDurationDays,
      utilizationPercent: input.utilizationPercent ?? null,
    },
    flags,
  };
}

function normalizeRental(rental) {
  return {
    id: text(rental?.id),
    clientId: text(rental?.clientId),
    client: text(rental?.client) || 'Клиент не указан',
    startDate: dateKey(rental?.startDate),
    endDate: dateKey(rental?.endDate),
    status: lower(rental?.status) || 'unknown',
    statusLabel: rentalStatusLabel(rental?.status),
    manager: text(rental?.manager || rental?.managerInitials) || 'Не назначен',
    amount: number(rental?.amount ?? rental?.price),
  };
}

function normalizeServiceTicket(ticket) {
  return {
    id: text(ticket?.id),
    status: lower(ticket?.status) || 'unknown',
    statusLabel: serviceStatusLabel(ticket?.status),
    priority: lower(ticket?.priority) || 'medium',
    mechanic: text(ticket?.assignedMechanicName || ticket?.assignedTo) || 'Не назначен',
    reason: text(ticket?.reason || ticket?.description) || 'Причина не указана',
    createdAt: dateKey(ticket?.createdAt || ticket?.plannedDate || ticket?.closedAt),
    waitingParts: lower(ticket?.status) === 'waiting_parts',
  };
}

export const __equipment360TestUtils = {
  dateKey,
  daysBetween,
  matchesEquipmentBySafeKey,
};
