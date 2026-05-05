const OPEN_RENTAL_STATUSES = new Set(['active', 'confirmed', 'return_planned']);
const OPEN_SERVICE_STATUSES = new Set(['new', 'open', 'assigned', 'in_progress', 'waiting_parts', 'needs_revision', 'ready']);

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeStatus(value) {
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

function addDaysKey(todayKey, days) {
  const date = new Date(todayKey);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function overdueDays(row, todayKey) {
  const outstanding = safeNumber(row?.outstanding);
  if (outstanding <= 0) return 0;
  const dueKey = dateKey(row?.expectedPaymentDate || row?.endDate);
  if (!dueKey || dueKey >= todayKey) return 0;
  return Math.max(0, Math.floor((new Date(todayKey).getTime() - new Date(dueKey).getTime()) / 86400000));
}

function uniqueKey(...parts) {
  return parts.map(part => normalizeText(part).toLowerCase()).find(Boolean) || 'unknown';
}

function isOpenRental(rental) {
  return OPEN_RENTAL_STATUSES.has(normalizeStatus(rental?.status));
}

function isOpenServiceTicket(ticket) {
  const status = normalizeStatus(ticket?.status);
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

function isUnsignedDocument(doc) {
  return (doc?.type === 'contract' || doc?.type === 'act') && doc?.status !== 'signed';
}

function buildHighRiskClients(clientDebtAgingRows) {
  const grouped = new Map();
  for (const row of clientDebtAgingRows || []) {
    const key = uniqueKey(row?.clientId, row?.client);
    const item = grouped.get(key) ?? {
      clientId: row?.clientId,
      client: normalizeText(row?.client) || 'Клиент не привязан',
      manager: normalizeText(row?.manager) || 'Не назначен',
      debt: 0,
      rentals: 0,
      overdueRentals: 0,
      maxOverdueDays: 0,
      hasActiveRental: false,
      has60PlusDebt: false,
    };
    item.debt += safeNumber(row?.debt);
    item.rentals += safeNumber(row?.rentals);
    item.overdueRentals += safeNumber(row?.overdueRentals);
    item.maxOverdueDays = Math.max(item.maxOverdueDays, safeNumber(row?.maxOverdueDays));
    item.hasActiveRental = item.hasActiveRental || Boolean(row?.hasActiveRental);
    item.has60PlusDebt = item.has60PlusDebt || row?.ageBucket === '60_plus' || safeNumber(row?.maxOverdueDays) > 60;
    grouped.set(key, item);
  }

  return Array.from(grouped.values())
    .filter(item => item.has60PlusDebt || (item.hasActiveRental && item.overdueRentals > 0))
    .sort((a, b) => b.debt - a.debt || b.maxOverdueDays - a.maxOverdueDays || a.client.localeCompare(b.client, 'ru'));
}

export function buildDashboardAttentionSummary(input = {}) {
  const todayKey = dateKey(input.today) || new Date().toISOString().slice(0, 10);
  const tomorrowKey = addDaysKey(todayKey, 1);
  const rentalDebtRows = Array.isArray(input.rentalDebtRows) ? input.rentalDebtRows : [];
  const rentals = Array.isArray(input.rentals) ? input.rentals : [];
  const documents = Array.isArray(input.documents) ? input.documents : [];
  const tickets = Array.isArray(input.tickets) ? input.tickets : [];
  const equipment = Array.isArray(input.equipment) ? input.equipment : [];
  const clientDebtAgingRows = Array.isArray(input.clientDebtAgingRows) ? input.clientDebtAgingRows : [];

  const overdueRows = rentalDebtRows
    .map(row => ({ ...row, overdueDays: overdueDays(row, todayKey), outstanding: safeNumber(row?.outstanding) }))
    .filter(row => row.outstanding > 0 && row.overdueDays > 0);
  const debt60PlusRows = overdueRows.filter(row => row.overdueDays > 60);
  const overdueClientKeys = new Set(overdueRows.map(row => uniqueKey(row.clientId, row.client)));

  const returnsToday = rentals.filter(rental => isOpenRental(rental) && dateKey(rental?.endDate || rental?.plannedReturnDate) === todayKey);
  const returnsTomorrow = rentals.filter(rental => isOpenRental(rental) && dateKey(rental?.endDate || rental?.plannedReturnDate) === tomorrowKey);
  const upcomingReturns = rentals
    .filter(rental => isOpenRental(rental))
    .map(rental => ({
      id: normalizeText(rental?.id),
      client: normalizeText(rental?.client) || 'Клиент не указан',
      equipment: normalizeText(rental?.equipmentInv) || normalizeText(Array.isArray(rental?.equipment) ? rental.equipment.join(', ') : rental?.equipment) || 'Техника не указана',
      date: dateKey(rental?.endDate || rental?.plannedReturnDate),
      manager: normalizeText(rental?.manager) || 'Не назначен',
    }))
    .filter(row => row.date && row.date >= todayKey)
    .sort((a, b) => a.date.localeCompare(b.date) || a.client.localeCompare(b.client, 'ru'))
    .slice(0, 5);

  const unsignedDocuments = documents
    .filter(isUnsignedDocument)
    .map(doc => ({
      id: normalizeText(doc?.id),
      type: documentTypeLabel(doc?.type),
      client: normalizeText(doc?.client) || 'Клиент не указан',
      rental: normalizeText(doc?.rentalId || doc?.rental) || 'Аренда не указана',
      status: documentStatusLabel(doc?.status),
      manager: normalizeText(doc?.manager) || 'Не назначен',
      date: dateKey(doc?.date),
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.client.localeCompare(b.client, 'ru'));

  const openTickets = tickets.filter(isOpenServiceTicket);
  const unassignedTickets = openTickets.filter(ticket =>
    !normalizeText(ticket?.assignedMechanicId)
    && !normalizeText(ticket?.assignedMechanicName)
    && !normalizeText(ticket?.assignedTo)
  );
  const waitingPartsTickets = openTickets.filter(ticket => normalizeStatus(ticket?.status) === 'waiting_parts');
  const urgentTickets = openTickets.filter(ticket => ['critical', 'high'].includes(normalizeStatus(ticket?.priority)));
  const equipmentInService = equipment.filter(item => item?.status === 'in_service');
  const availableEquipment = equipment.filter(item => item?.status === 'available');
  const highRiskClients = buildHighRiskClients(clientDebtAgingRows);

  return {
    receivables: {
      overdueDebt: overdueRows.reduce((sum, row) => sum + row.outstanding, 0),
      overdueClients: overdueClientKeys.size,
      overdueRentals: overdueRows.length,
      debt60Plus: debt60PlusRows.reduce((sum, row) => sum + row.outstanding, 0),
      rentals60Plus: debt60PlusRows.length,
    },
    returns: {
      today: returnsToday.length,
      tomorrow: returnsTomorrow.length,
      upcoming: upcomingReturns,
    },
    documents: {
      unsigned: unsignedDocuments.length,
      items: unsignedDocuments.slice(0, 5),
    },
    service: {
      unassigned: unassignedTickets.length,
      waitingParts: waitingPartsTickets.length,
      urgent: urgentTickets.length,
      equipmentInService: equipmentInService.length,
    },
    idleEquipment: {
      available: availableEquipment.length,
      idleDaysAvailable: false,
    },
    highRiskClients: {
      count: highRiskClients.length,
      sixtyPlus: highRiskClients.filter(item => item.has60PlusDebt).length,
      activeWithOverdue: highRiskClients.filter(item => item.hasActiveRental && item.overdueRentals > 0).length,
      top: highRiskClients.slice(0, 5),
    },
  };
}
