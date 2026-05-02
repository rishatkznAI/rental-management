const OPEN_RENTAL_STATUSES = new Set(['active', 'created', 'confirmed', 'return_planned']);
const CLOSED_RENTAL_STATUSES = new Set(['returned', 'closed', 'cancelled']);
const OPEN_SERVICE_STATUSES = new Set(['new', 'open', 'assigned', 'in_progress', 'waiting_parts', 'ready']);

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function safeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function dateKey(value) {
  const text = normalizeText(value);
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function getOverdueDays(dueDate, todayKey) {
  const dueKey = dateKey(dueDate);
  if (!dueKey || dueKey >= todayKey) return 0;
  return Math.max(0, Math.floor((new Date(todayKey).getTime() - new Date(dueKey).getTime()) / 86400000));
}

function sameClient(record, client) {
  if (!record || !client) return false;
  if (record.clientId && client.id && String(record.clientId) === String(client.id)) return true;
  if (!record.clientId && client.company && normalizeKey(record.client) === normalizeKey(client.company)) return true;
  return false;
}

function isOpenRental(rental) {
  return OPEN_RENTAL_STATUSES.has(normalizeKey(rental?.status));
}

function isClosedRental(rental) {
  return CLOSED_RENTAL_STATUSES.has(normalizeKey(rental?.status));
}

function isUnsignedDocument(doc) {
  return (doc?.type === 'contract' || doc?.type === 'act') && doc?.status !== 'signed';
}

function isOpenServiceTicket(ticket) {
  const status = normalizeKey(ticket?.status);
  return !status || OPEN_SERVICE_STATUSES.has(status) || status !== 'closed';
}

function documentTypeLabel(type) {
  if (type === 'contract') return 'Договор';
  if (type === 'act') return 'Акт';
  if (type === 'invoice') return 'Счёт';
  if (type === 'work_order') return 'Наряд';
  return 'Документ';
}

function documentStatusLabel(status) {
  if (status === 'draft') return 'Черновик';
  if (status === 'sent') return 'Отправлен';
  if (status === 'signed') return 'Подписан';
  return normalizeText(status) || 'Без статуса';
}

function paymentStatusLabel(status) {
  if (status === 'paid') return 'Оплачен';
  if (status === 'partial') return 'Частично';
  if (status === 'overdue') return 'Просрочен';
  if (status === 'pending') return 'Ожидает';
  return normalizeText(status) || 'Без статуса';
}

function riskLevelLabel(level) {
  if (level === 'high') return 'Высокий';
  if (level === 'medium') return 'Средний';
  return 'Низкий';
}

function sortByDateDesc(left, right, leftField, rightField = leftField) {
  return dateKey(right?.[rightField]).localeCompare(dateKey(left?.[leftField]));
}

export function buildClient360Summary(input = {}) {
  const client = input.client;
  const todayKey = dateKey(input.today) || new Date().toISOString().slice(0, 10);
  if (!client) {
    return {
      rentals: { active: [], completed: [], overdueReturns: [], latest: [], nextReturn: null },
      debt: { total: 0, overdue: 0, maxAgeDays: 0, hasActiveRental: false, riskLevel: 'low', riskLabel: 'Низкий' },
      documents: { total: 0, unsigned: 0, latest: [] },
      payments: { total: 0, latest: [] },
      service: { total: 0, open: 0, latest: [] },
      flags: [],
    };
  }

  const rentals = (Array.isArray(input.rentals) ? input.rentals : [])
    .filter(item => sameClient(item, client));
  const activeRentals = rentals.filter(isOpenRental);
  const completedRentals = rentals.filter(isClosedRental);
  const overdueReturns = activeRentals.filter(item => {
    const returnKey = dateKey(item?.endDate || item?.plannedReturnDate);
    return returnKey && returnKey < todayKey;
  });
  const nextReturn = activeRentals
    .map(item => ({ ...item, __returnKey: dateKey(item?.endDate || item?.plannedReturnDate) }))
    .filter(item => item.__returnKey && item.__returnKey >= todayKey)
    .sort((a, b) => a.__returnKey.localeCompare(b.__returnKey))[0] || null;
  const latestRentals = rentals
    .slice()
    .sort((a, b) => sortByDateDesc(a, b, 'startDate'))
    .slice(0, 10)
    .map(item => ({
      id: normalizeText(item?.id),
      equipment: normalizeText(item?.equipmentInv) || normalizeText(Array.isArray(item?.equipment) ? item.equipment.join(', ') : item?.equipment) || 'Техника не указана',
      startDate: dateKey(item?.startDate),
      endDate: dateKey(item?.endDate || item?.plannedReturnDate),
      status: normalizeText(item?.status) || 'unknown',
      manager: normalizeText(item?.manager) || 'Не назначен',
      amount: safeNumber(item?.amount ?? item?.price),
    }));

  const rentalIds = new Set(rentals.map(item => normalizeText(item?.id)).filter(Boolean));
  const equipmentKeys = new Set(rentals.flatMap(item => [
    normalizeText(item?.equipmentId),
    normalizeText(item?.equipmentInv),
    ...(Array.isArray(item?.equipment) ? item.equipment.map(normalizeText) : []),
  ]).filter(Boolean));

  const rentalDebtRows = (Array.isArray(input.rentalDebtRows) ? input.rentalDebtRows : [])
    .filter(item => sameClient(item, client) || rentalIds.has(normalizeText(item?.rentalId)));
  const overdueDebtRows = rentalDebtRows
    .map(item => ({ ...item, overdueDays: getOverdueDays(item?.expectedPaymentDate || item?.endDate, todayKey), outstanding: safeNumber(item?.outstanding) }))
    .filter(item => item.outstanding > 0 && item.overdueDays > 0);
  const totalDebt = rentalDebtRows.reduce((sum, item) => sum + safeNumber(item?.outstanding), safeNumber(client.debt));
  const overdueDebt = overdueDebtRows.reduce((sum, item) => sum + item.outstanding, 0);
  const maxAgeDays = overdueDebtRows.reduce((max, item) => Math.max(max, item.overdueDays), 0);
  const hasActiveRental = activeRentals.length > 0;
  const riskLevel = maxAgeDays > 60 || (hasActiveRental && overdueDebt > 0) || overdueReturns.length > 0
    ? 'high'
    : totalDebt > 0 || maxAgeDays > 0
      ? 'medium'
      : 'low';

  const documents = (Array.isArray(input.documents) ? input.documents : [])
    .filter(item => sameClient(item, client) || rentalIds.has(normalizeText(item?.rentalId || item?.rental)))
    .map(item => ({
      id: normalizeText(item?.id),
      type: documentTypeLabel(item?.type),
      status: documentStatusLabel(item?.status),
      rawStatus: normalizeText(item?.status),
      date: dateKey(item?.date),
      rental: normalizeText(item?.rentalId || item?.rental) || 'Аренда не указана',
      unsigned: isUnsignedDocument(item),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const payments = (Array.isArray(input.payments) ? input.payments : [])
    .filter(item => sameClient(item, client) || rentalIds.has(normalizeText(item?.rentalId)))
    .map(item => ({
      id: normalizeText(item?.id),
      invoiceNumber: normalizeText(item?.invoiceNumber) || normalizeText(item?.id),
      date: dateKey(item?.paidDate || item?.dueDate),
      amount: safeNumber(item?.paidAmount ?? item?.amount),
      status: paymentStatusLabel(item?.status),
      rentalId: normalizeText(item?.rentalId) || 'Аренда не указана',
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const serviceTickets = (Array.isArray(input.serviceTickets) ? input.serviceTickets : [])
    .filter(item =>
      (item?.clientId && client.id && String(item.clientId) === String(client.id))
      || rentalIds.has(normalizeText(item?.rentalId))
      || equipmentKeys.has(normalizeText(item?.equipmentId))
      || equipmentKeys.has(normalizeText(item?.inventoryNumber))
    )
    .map(item => ({
      id: normalizeText(item?.id),
      status: normalizeText(item?.status) || 'Без статуса',
      equipment: normalizeText(item?.equipment) || normalizeText(item?.inventoryNumber) || 'Техника не указана',
      date: dateKey(item?.createdAt || item?.plannedDate || item?.closedAt),
      priority: normalizeText(item?.priority) || 'medium',
      open: isOpenServiceTicket(item),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const unsignedDocuments = documents.filter(item => item.unsigned).length;
  const openServiceTickets = serviceTickets.filter(item => item.open).length;
  const flags = [];
  if (maxAgeDays > 60) flags.push({ id: 'debt-60', label: 'Долг 60+ дней', severity: 'high' });
  if (hasActiveRental && overdueDebt > 0) flags.push({ id: 'active-overdue', label: 'Активная аренда при просрочке', severity: 'high' });
  if (unsignedDocuments > 0) flags.push({ id: 'unsigned-docs', label: 'Есть документы без подписи', severity: 'medium' });
  if (overdueReturns.length > 0) flags.push({ id: 'overdue-returns', label: 'Есть просроченный возврат', severity: 'high' });
  if (openServiceTickets > 0) flags.push({ id: 'open-service', label: 'Открытые сервисные заявки по технике клиента', severity: 'medium' });

  return {
    rentals: {
      active: activeRentals,
      completed: completedRentals,
      overdueReturns,
      latest: latestRentals,
      nextReturn: nextReturn ? {
        id: normalizeText(nextReturn.id),
        date: nextReturn.__returnKey,
        equipment: normalizeText(nextReturn.equipmentInv) || 'Техника не указана',
      } : null,
    },
    debt: {
      total: totalDebt,
      overdue: overdueDebt,
      maxAgeDays,
      hasActiveRental,
      riskLevel,
      riskLabel: riskLevelLabel(riskLevel),
    },
    documents: {
      total: documents.length,
      unsigned: unsignedDocuments,
      latest: documents.slice(0, 5),
    },
    payments: {
      total: payments.length,
      latest: payments.slice(0, 5),
    },
    service: {
      total: serviceTickets.length,
      open: openServiceTickets,
      latest: serviceTickets.slice(0, 5),
    },
    flags,
  };
}
