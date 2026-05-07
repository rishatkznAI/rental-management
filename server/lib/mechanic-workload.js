const PAY_TYPES = new Set(['hourly_norm', 'fixed', 'no_pay']);
const TERMINAL_UNPAID_STATUSES = new Set(['cancelled', 'rejected']);
const CLOSED_TICKET_STATUSES = new Set(['closed']);

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function safeNonNegative(value, fallback = 0) {
  const numeric = toNumber(value, fallback);
  return numeric >= 0 ? numeric : fallback;
}

function safePositive(value, fallback = 1) {
  const numeric = toNumber(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function roundMoney(value) {
  return Math.round((safeNonNegative(value, 0) + Number.EPSILON) * 100) / 100;
}

function normalizePayType(value) {
  const raw = String(value || '').trim();
  return PAY_TYPES.has(raw) ? raw : 'hourly_norm';
}

function normalizeDate(value) {
  if (!value) return '';
  const raw = String(value);
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

function isInsidePeriod(date, dateFrom, dateTo) {
  if (!date) return true;
  if (dateFrom && date < dateFrom) return false;
  if (dateTo && date > dateTo) return false;
  return true;
}

function inclusiveDays(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return 1;
  const start = Date.parse(`${dateFrom}T00:00:00Z`);
  const end = Date.parse(`${dateTo}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.max(1, Math.floor((end - start) / 86400000) + 1);
}

function calculateWorkAmount({ payType, normHours, rate, fixedAmount, quantity }) {
  const normalizedPayType = normalizePayType(payType);
  const safeQuantity = safePositive(quantity, 1);
  if (normalizedPayType === 'no_pay') return 0;
  if (normalizedPayType === 'fixed') {
    return roundMoney(safeNonNegative(fixedAmount, rate) * safeQuantity);
  }
  return roundMoney(safeNonNegative(normHours, 0) * safeNonNegative(rate, 0) * safeQuantity);
}

function pushWarning(warnings, type, message, work, extra = {}) {
  warnings.push({
    type,
    message,
    workId: work?.id || '',
    serviceTicketId: work?.serviceTicketId || work?.repairId || extra.serviceTicketId || '',
    mechanicId: work?.mechanicId || extra.mechanicId || '',
    severity: extra.severity || 'warning',
  });
}

function buildMechanicWorkloadReport(input = {}, options = {}) {
  const tickets = Array.isArray(input.tickets) ? input.tickets : [];
  const workItems = Array.isArray(input.workItems) ? input.workItems : [];
  const mechanics = Array.isArray(input.mechanics) ? input.mechanics : [];
  const equipment = Array.isArray(input.equipment) ? input.equipment : [];
  const serviceWorks = Array.isArray(input.serviceWorks) ? input.serviceWorks : [];
  const dateFrom = normalizeDate(options.dateFrom);
  const dateTo = normalizeDate(options.dateTo);
  const includeStatuses = Array.isArray(options.includeStatuses) && options.includeStatuses.length > 0
    ? new Set(options.includeStatuses)
    : new Set(['completed']);

  const ticketById = new Map(tickets.map(ticket => [ticket.id, ticket]));
  const mechanicById = new Map(mechanics.map(mechanic => [mechanic.id, mechanic]));
  const equipmentById = new Map(equipment.map(item => [item.id, item]));
  const catalogById = new Map(serviceWorks.map(item => [item.id, item]));
  const warnings = [];
  const byMechanic = new Map();
  const details = [];
  const periodDays = inclusiveDays(dateFrom, dateTo);

  const getBucket = (mechanicId, mechanicName) => {
    const key = mechanicId || mechanicName || 'unassigned';
    if (!byMechanic.has(key)) {
      byMechanic.set(key, {
        mechanicId: mechanicId || '',
        mechanicName: mechanicName || 'Не назначен',
        completedWorksCount: 0,
        ticketIds: new Set(),
        totalNormHours: 0,
        totalAmount: 0,
        worksByCategory: {},
        worksByEquipmentType: {},
        tickets: [],
        warnings: [],
      });
    }
    return byMechanic.get(key);
  };

  for (const item of workItems) {
    const serviceTicketId = item.serviceTicketId || item.repairId || item.serviceId || '';
    const ticket = serviceTicketId ? ticketById.get(serviceTicketId) : null;
    const workCatalogId = item.workCatalogId || item.workId || item.catalogId || '';
    const catalog = workCatalogId ? catalogById.get(workCatalogId) : null;
    const status = String(item.status || 'completed').trim() || 'completed';
    const quantity = safePositive(item.quantity, 1);
    const payType = normalizePayType(item.payType || catalog?.payType);
    const normHours = safeNonNegative(
      item.normHours ?? item.normHoursSnapshot ?? item.defaultNormHours ?? catalog?.defaultNormHours ?? catalog?.normHours,
      0,
    );
    const rate = safeNonNegative(
      item.rate ?? item.ratePerHourSnapshot ?? item.defaultMechanicRate ?? catalog?.defaultMechanicRate ?? catalog?.ratePerHour,
      0,
    );
    const fixedAmount = safeNonNegative(
      item.fixedAmount ?? item.fixedAmountSnapshot ?? catalog?.fixedAmount ?? catalog?.defaultMechanicRate ?? catalog?.ratePerHour,
      rate,
    );
    const calculatedAmount = calculateWorkAmount({ payType, normHours, rate, fixedAmount, quantity });
    const amount = item.amount == null ? calculatedAmount : roundMoney(item.amount);
    const mechanicId = item.mechanicId || ticket?.assignedMechanicId || '';
    const mechanic = mechanicId ? mechanicById.get(mechanicId) : null;
    const mechanicName = item.mechanicNameSnapshot || item.mechanicName || mechanic?.name || ticket?.assignedMechanicName || ticket?.assignedTo || 'Не назначен';
    const equipmentId = item.equipmentId || ticket?.equipmentId || '';
    const eq = equipmentId ? equipmentById.get(equipmentId) : null;
    const equipmentType = item.equipmentType || item.equipmentTypeSnapshot || ticket?.equipmentType || eq?.type || '';
    const workDate = normalizeDate(item.completedAt || item.performedAt || item.createdAt || ticket?.closedAt || ticket?.createdAt);
    const category = item.categorySnapshot || catalog?.category || 'Без категории';
    const normalized = {
      id: item.id || '',
      serviceTicketId,
      repairId: serviceTicketId,
      workCatalogId,
      workId: workCatalogId,
      workNameSnapshot: item.workNameSnapshot || item.nameSnapshot || catalog?.name || item.name || 'Работа',
      mechanicId,
      mechanicName,
      equipmentId,
      equipmentLabel: item.equipmentSnapshot || ticket?.equipment || [eq?.manufacturer, eq?.model].filter(Boolean).join(' ') || '—',
      equipmentInv: item.equipmentInv || item.inventoryNumber || ticket?.inventoryNumber || eq?.inventoryNumber || '',
      serialNumber: item.serialNumber || ticket?.serialNumber || eq?.serialNumber || '',
      modelSnapshot: item.modelSnapshot || item.equipmentModel || eq?.model || '',
      equipmentType,
      category,
      completedAt: normalizeDate(item.completedAt || item.performedAt || item.createdAt),
      performedAt: normalizeDate(item.performedAt || item.completedAt || item.createdAt),
      date: workDate,
      quantity,
      normHours,
      rate,
      fixedAmount,
      amount,
      payType,
      status,
      source: item.source || (workCatalogId ? 'manual' : 'legacy'),
      comment: item.comment || item.description || '',
      repairStatus: ticket?.status || '',
    };

    if (!serviceTicketId || !ticket) pushWarning(warnings, 'missing_ticket', 'Работа без привязки к сервисной заявке', normalized);
    if (!mechanicId) pushWarning(warnings, 'missing_mechanic', 'Работа без механика', normalized);
    if (!equipmentId) pushWarning(warnings, 'missing_equipment', 'Работа без привязки к технике', normalized);
    if (normHours <= 0 && payType === 'hourly_norm') pushWarning(warnings, 'missing_norm_hours', 'Работа без нормо-часов', normalized);
    if (rate <= 0 && payType === 'hourly_norm') pushWarning(warnings, 'missing_rate', 'Работа без ставки', normalized);
    if (amount <= 0 && payType !== 'no_pay') pushWarning(warnings, 'zero_amount', 'Работа с нулевым начислением', normalized);
    if (workDate && !isInsidePeriod(workDate, dateFrom, dateTo)) {
      pushWarning(warnings, 'outside_period', 'Работа выполнена вне выбранного периода', normalized, { severity: 'info' });
    }

    if (!includeStatuses.has(status) || TERMINAL_UNPAID_STATUSES.has(status) || !isInsidePeriod(workDate, dateFrom, dateTo)) {
      details.push(normalized);
      continue;
    }

    const bucket = getBucket(mechanicId, mechanicName);
    bucket.completedWorksCount += 1;
    if (serviceTicketId) bucket.ticketIds.add(serviceTicketId);
    bucket.totalNormHours += normHours * quantity;
    bucket.totalAmount += amount;
    bucket.worksByCategory[category] = (bucket.worksByCategory[category] || 0) + 1;
    const equipmentTypeKey = equipmentType || 'Не указан';
    bucket.worksByEquipmentType[equipmentTypeKey] = (bucket.worksByEquipmentType[equipmentTypeKey] || 0) + 1;
    bucket.tickets.push({
      serviceTicketId,
      status: ticket?.status || '',
      workId: normalized.id,
      workName: normalized.workNameSnapshot,
      date: workDate,
      normHours: normalized.normHours,
      amount: normalized.amount,
    });
    details.push(normalized);
  }

  const incompleteStatuses = new Set(['planned', 'in_progress']);
  const worksByTicket = new Map();
  for (const item of workItems) {
    const serviceTicketId = item.serviceTicketId || item.repairId || item.serviceId || '';
    if (!serviceTicketId) continue;
    const group = worksByTicket.get(serviceTicketId) || [];
    group.push(item);
    worksByTicket.set(serviceTicketId, group);
  }
  for (const ticket of tickets) {
    if (!CLOSED_TICKET_STATUSES.has(String(ticket.status || ''))) continue;
    const unfinished = (worksByTicket.get(ticket.id) || []).filter(item => incompleteStatuses.has(String(item.status || 'completed')));
    if (unfinished.length === 0) continue;
    const warning = {
      type: 'closed_ticket_unfinished_work',
      message: 'Заявка закрыта, но есть незавершённые работы',
      workId: unfinished[0]?.id || '',
      serviceTicketId: ticket.id,
      mechanicId: unfinished[0]?.mechanicId || ticket.assignedMechanicId || '',
      severity: 'warning',
    };
    warnings.push(warning);
  }

  for (const warning of warnings) {
    const mechanicId = warning.mechanicId || '';
    const detail = mechanicId
      ? details.find(item => item.mechanicId === mechanicId && (!warning.workId || item.id === warning.workId))
      : null;
    const bucket = getBucket(mechanicId, detail?.mechanicName || '');
    bucket.warnings.push(warning);
  }

  const mechanicsSummary = [...byMechanic.values()]
    .map(item => ({
      mechanicId: item.mechanicId,
      mechanicName: item.mechanicName,
      completedWorksCount: item.completedWorksCount,
      completedTicketsCount: item.ticketIds.size,
      totalNormHours: Number(item.totalNormHours.toFixed(2)),
      totalAmount: roundMoney(item.totalAmount),
      averageNormHoursPerDay: Number((item.totalNormHours / periodDays).toFixed(2)),
      worksByCategory: item.worksByCategory,
      worksByEquipmentType: item.worksByEquipmentType,
      tickets: item.tickets,
      warnings: item.warnings,
    }))
    .sort((a, b) => b.totalNormHours - a.totalNormHours || b.totalAmount - a.totalAmount);

  const completedDetails = details.filter(item =>
    includeStatuses.has(item.status)
    && !TERMINAL_UNPAID_STATUSES.has(item.status)
    && isInsidePeriod(item.date, dateFrom, dateTo),
  );
  const kpi = {
    completedWorks: completedDetails.length,
    totalNormHours: Number(mechanicsSummary.reduce((sum, item) => sum + item.totalNormHours, 0).toFixed(2)),
    totalAmount: roundMoney(mechanicsSummary.reduce((sum, item) => sum + item.totalAmount, 0)),
    averagePerMechanic: mechanicsSummary.length === 0
      ? 0
      : Number((mechanicsSummary.reduce((sum, item) => sum + item.totalNormHours, 0) / mechanicsSummary.length).toFixed(2)),
    missingNormHours: warnings.filter(item => item.type === 'missing_norm_hours').length,
    missingMechanic: warnings.filter(item => item.type === 'missing_mechanic').length,
    closedTicketsWithUnfinishedWorks: warnings.filter(item => item.type === 'closed_ticket_unfinished_work').length,
  };

  return {
    period: { dateFrom, dateTo },
    kpi,
    mechanics: mechanicsSummary,
    details,
    warnings,
  };
}

module.exports = {
  calculateWorkAmount,
  buildMechanicWorkloadReport,
  normalizePayType,
};
