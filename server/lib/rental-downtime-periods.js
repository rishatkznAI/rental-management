const CLOSED_RENTAL_STATUSES = new Set(['closed', 'returned', 'completed', 'cancelled', 'canceled']);
const DOWNTIME_STATUSES = new Set(['active', 'closed', 'cancelled']);

function text(value) {
  return String(value ?? '').trim();
}

function dateKey(value) {
  const raw = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function parseDateOnly(value) {
  return new Date(`${value}T00:00:00`);
}

function inclusiveDays(startDate, endDate) {
  const start = dateKey(startDate);
  const end = dateKey(endDate);
  if (!start || !end || end < start) return 0;
  return Math.floor((parseDateOnly(end).getTime() - parseDateOnly(start).getTime()) / 86400000) + 1;
}

function rangesOverlapInclusive(startA, endA, startB, endB) {
  const normalizedStartA = dateKey(startA);
  const normalizedEndA = dateKey(endA);
  const normalizedStartB = dateKey(startB);
  const normalizedEndB = dateKey(endB);
  if (!normalizedStartA || !normalizedEndA || !normalizedStartB || !normalizedEndB) return false;
  return normalizedStartA <= normalizedEndB && normalizedStartB <= normalizedEndA;
}

function rentalStartDate(rental) {
  return dateKey(rental?.startDate);
}

function rentalEndDate(rental) {
  return dateKey(rental?.plannedReturnDate || rental?.endDate || rental?.actualReturnDate || rental?.returnDate);
}

function rentalEquipmentId(rental, input = {}) {
  return text(input.equipmentId)
    || text(rental?.equipmentId)
    || text(rental?.equipmentIds?.[0])
    || '';
}

function rentalEquipmentInv(rental, input = {}) {
  return text(input.equipmentInv || input.inventoryNumber)
    || text(rental?.equipmentInv || rental?.inventoryNumber)
    || (Array.isArray(rental?.equipment) ? text(rental.equipment[0]) : '')
    || '';
}

function rentalSerialNumber(rental, input = {}) {
  return text(input.serialNumber) || text(rental?.serialNumber) || '';
}

function normalizeStatus(value) {
  const status = text(value).toLowerCase();
  return DOWNTIME_STATUSES.has(status) ? status : 'active';
}

function legacyDowntimePeriod(rental) {
  if (!rental || rental.downtimeStatus === 'cancelled') return null;
  const startDate = dateKey(rental.downtimeStartDate);
  const endDate = dateKey(rental.downtimeEndDate || rental.downtimeStartDate);
  const days = Math.max(0, Number(rental.downtimeDays) || 0);
  if (!startDate || (!days && !text(rental.downtimeReason))) return null;
  return {
    id: `legacy-downtime:${text(rental.id) || text(rental.rentalId) || startDate}`,
    rentalId: text(rental.id || rental.rentalId || rental.sourceRentalId || rental.originalRentalId),
    ganttRentalId: text(rental.ganttRentalId || rental.linkedGanttRentalId),
    equipmentId: rentalEquipmentId(rental),
    equipmentInv: rentalEquipmentInv(rental),
    serialNumber: rentalSerialNumber(rental),
    clientId: text(rental.clientId),
    startDate,
    endDate,
    reason: text(rental.downtimeReason) || 'Простой аренды',
    comment: text(rental.downtimeComment),
    affectsBilling: Boolean(rental.downtimeAffectsBilling),
    status: normalizeStatus(rental.downtimeStatus),
    createdAt: text(rental.updatedAt || rental.createdAt),
    updatedAt: text(rental.updatedAt || rental.createdAt),
  };
}

function normalizeRentalDowntimePeriod(period, rental = {}) {
  if (!period || typeof period !== 'object') return null;
  const startDate = dateKey(period.startDate || period.downtimeStartDate);
  const endDate = dateKey(period.endDate || period.downtimeEndDate || period.startDate || period.downtimeStartDate);
  if (!startDate || !endDate) return null;
  return {
    id: text(period.id),
    rentalId: text(period.rentalId) || text(rental.id || rental.rentalId || rental.sourceRentalId || rental.originalRentalId),
    ganttRentalId: text(period.ganttRentalId || period.linkedGanttRentalId),
    equipmentId: rentalEquipmentId(rental, period),
    equipmentInv: rentalEquipmentInv(rental, period),
    serialNumber: rentalSerialNumber(rental, period),
    clientId: text(period.clientId) || text(rental.clientId),
    startDate,
    endDate,
    reason: text(period.reason || period.downtimeReason) || 'Простой аренды',
    comment: text(period.comment || period.downtimeComment),
    affectsBilling: period.affectsBilling === true,
    status: normalizeStatus(period.status || period.downtimeStatus),
    createdBy: text(period.createdBy),
    createdAt: text(period.createdAt),
    updatedAt: text(period.updatedAt),
  };
}

function normalizeRentalDowntimePeriods(rental) {
  const periods = Array.isArray(rental?.downtimePeriods)
    ? rental.downtimePeriods
      .map(period => normalizeRentalDowntimePeriod(period, rental))
      .filter(Boolean)
      .filter(period => period.id)
    : [];
  const list = periods.length ? periods : [legacyDowntimePeriod(rental)].filter(Boolean);
  return list.sort((left, right) =>
    left.startDate.localeCompare(right.startDate) || left.endDate.localeCompare(right.endDate) || left.id.localeCompare(right.id)
  );
}

function activeDowntimePeriods(periods) {
  return (periods || []).filter(period => normalizeStatus(period.status) !== 'cancelled');
}

function validateRentalDowntimePeriod(input, options = {}) {
  const rental = options.rental || {};
  const startDate = dateKey(input?.startDate);
  const endDate = dateKey(input?.endDate);
  const reason = text(input?.reason);
  if (!rental?.id) return { ok: false, status: 404, error: 'Аренда для простоя не найдена.' };
  if (CLOSED_RENTAL_STATUSES.has(text(rental.status).toLowerCase()) || rental.actualReturnDate) {
    return { ok: false, status: 409, error: 'Аренда уже закрыта. Новый простой можно добавить только до закрытия аренды.' };
  }
  if (!rentalEquipmentId(rental, input) && !rentalEquipmentInv(rental, input) && !rentalSerialNumber(rental, input)) {
    return { ok: false, status: 400, error: 'Нельзя создать простой без техники.' };
  }
  if (!startDate) return { ok: false, status: 400, error: 'Укажите дату начала простоя.' };
  if (!endDate) return { ok: false, status: 400, error: 'Укажите дату окончания простоя.' };
  if (endDate < startDate) return { ok: false, status: 400, error: 'Дата окончания простоя не может быть раньше даты начала.' };
  if (!reason) return { ok: false, status: 400, error: 'Укажите причину простоя.' };

  const rentalStart = rentalStartDate(rental);
  const rentalEnd = rentalEndDate(rental);
  if (rentalStart && startDate < rentalStart) {
    return { ok: false, status: 409, error: 'Простой не может начинаться раньше начала аренды.' };
  }
  if (rentalEnd && endDate > rentalEnd) {
    return { ok: false, status: 409, error: 'Простой выходит за период аренды. Скорректируйте даты простоя или срок аренды.' };
  }

  const excludeId = text(options.excludeId);
  const existing = activeDowntimePeriods(options.existingPeriods || [])
    .filter(period => !excludeId || text(period.id) !== excludeId);
  const overlapping = existing.find(period => rangesOverlapInclusive(startDate, endDate, period.startDate, period.endDate));
  if (overlapping) {
    return { ok: false, status: 409, error: 'Этот период пересекается с уже зафиксированным простоем по этой аренде.' };
  }

  return { ok: true };
}

function buildDowntimePeriod(input, rental, options = {}) {
  const now = options.now || new Date().toISOString();
  const author = text(options.author) || 'Система';
  const previous = options.previous || {};
  return normalizeRentalDowntimePeriod({
    ...previous,
    ...input,
    id: text(previous.id) || text(options.id),
    rentalId: text(rental?.id || rental?.rentalId || rental?.sourceRentalId || rental?.originalRentalId),
    ganttRentalId: text(input?.ganttRentalId || previous.ganttRentalId),
    equipmentId: rentalEquipmentId(rental, input),
    equipmentInv: rentalEquipmentInv(rental, input),
    serialNumber: rentalSerialNumber(rental, input),
    clientId: text(input?.clientId) || text(rental?.clientId),
    affectsBilling: input?.affectsBilling === true,
    status: normalizeStatus(input?.status || previous.status),
    createdBy: text(previous.createdBy) || author,
    createdAt: text(previous.createdAt) || now,
    updatedAt: now,
  }, rental);
}

function summarizeRentalDowntimes(rental) {
  const periods = normalizeRentalDowntimePeriods(rental);
  const activePeriods = activeDowntimePeriods(periods);
  const downtimeDays = activePeriods.reduce((sum, period) => sum + inclusiveDays(period.startDate, period.endDate), 0);
  const billableDowntimeDays = activePeriods
    .filter(period => period.affectsBilling)
    .reduce((sum, period) => sum + inclusiveDays(period.startDate, period.endDate), 0);
  const totalCalendarDays = inclusiveDays(rentalStartDate(rental), rentalEndDate(rental));
  const billableDays = totalCalendarDays ? Math.max(0, totalCalendarDays - billableDowntimeDays) : 0;
  const activeRentalDays = totalCalendarDays ? Math.max(0, totalCalendarDays - downtimeDays) : 0;
  const latest = activePeriods[activePeriods.length - 1] || null;
  return {
    periods,
    totalCalendarDays,
    downtimeDays,
    billableDowntimeDays,
    billableDays,
    activeRentalDays,
    latest,
  };
}

function syncRentalDowntimeSummaryFields(rental) {
  const summary = summarizeRentalDowntimes(rental);
  const latest = summary.latest;
  return {
    ...rental,
    downtimePeriods: summary.periods,
    downtimeDays: summary.downtimeDays,
    downtimeBillableDays: summary.billableDowntimeDays,
    billableDays: summary.billableDays || undefined,
    activeRentalDays: summary.activeRentalDays || undefined,
    downtimeReason: latest ? latest.reason : '',
    downtimeStartDate: latest ? latest.startDate : '',
    downtimeEndDate: latest ? latest.endDate : '',
    downtimeComment: latest ? latest.comment : '',
    downtimeStatus: latest ? latest.status : '',
    downtimeAffectsBilling: latest ? latest.affectsBilling : false,
  };
}

function createRentalDowntime(rental, input, options = {}) {
  const existingPeriods = normalizeRentalDowntimePeriods(rental);
  const validation = validateRentalDowntimePeriod(input, { ...options, rental, existingPeriods });
  if (!validation.ok) return validation;
  const downtime = buildDowntimePeriod(input, rental, options);
  const nextRental = syncRentalDowntimeSummaryFields({
    ...rental,
    downtimePeriods: [...existingPeriods, downtime],
  });
  return { ok: true, downtime, rental: nextRental };
}

function updateRentalDowntime(rental, downtimeId, input, options = {}) {
  const existingPeriods = normalizeRentalDowntimePeriods(rental);
  const targetId = text(downtimeId);
  const previous = existingPeriods.find(period => text(period.id) === targetId);
  if (!previous) return { ok: false, status: 404, error: 'Простой аренды не найден.' };
  const candidate = { ...previous, ...input, id: previous.id };
  const validation = validateRentalDowntimePeriod(candidate, {
    ...options,
    rental,
    existingPeriods,
    excludeId: previous.id,
  });
  if (!validation.ok) return validation;
  const downtime = buildDowntimePeriod(candidate, rental, { ...options, previous, id: previous.id });
  const nextRental = syncRentalDowntimeSummaryFields({
    ...rental,
    downtimePeriods: existingPeriods.map(period => period.id === previous.id ? downtime : period),
  });
  return { ok: true, downtime, rental: nextRental };
}

function cancelRentalDowntime(rental, downtimeId, options = {}) {
  const existingPeriods = normalizeRentalDowntimePeriods(rental);
  const targetId = text(downtimeId);
  const previous = existingPeriods.find(period => text(period.id) === targetId);
  if (!previous) return { ok: false, status: 404, error: 'Простой аренды не найден.' };
  const downtime = buildDowntimePeriod(
    { ...previous, status: 'cancelled' },
    rental,
    { ...options, previous, id: previous.id },
  );
  const nextRental = syncRentalDowntimeSummaryFields({
    ...rental,
    downtimePeriods: existingPeriods.map(period => period.id === previous.id ? downtime : period),
  });
  return { ok: true, downtime, rental: nextRental };
}

module.exports = {
  activeDowntimePeriods,
  cancelRentalDowntime,
  createRentalDowntime,
  dateKey,
  inclusiveDays,
  normalizeRentalDowntimePeriod,
  normalizeRentalDowntimePeriods,
  summarizeRentalDowntimes,
  syncRentalDowntimeSummaryFields,
  updateRentalDowntime,
  validateRentalDowntimePeriod,
};
