const CLOSED_RENTAL_STATUSES = new Set(['closed', 'returned', 'completed', 'cancelled', 'canceled']);
const RENTAL_FLOW_STATUS_PRIORITY = {
  active: 5,
  confirmed: 4,
  delivery: 3,
  created: 2,
};

function text(value) {
  return String(value ?? '').trim();
}

function isSafeEquipmentInventoryRef(value) {
  const normalized = text(value);
  return Boolean(normalized && normalized !== '0' && normalized !== '-' && normalized !== '—');
}

function dateKey(value) {
  const raw = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function parseDateOnly(value) {
  return new Date(`${value}T00:00:00`);
}

function toMoney(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function parseMoneyValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, value) : null;
  const normalized = String(value)
    .replace(/\s+/g, '')
    .replace(',', '.')
    .replace(/[^\d.]/g, '');
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
}

function roundMoney(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function maxDate(left, right) {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function minDate(left, right) {
  if (!left) return right;
  if (!right) return left;
  return left < right ? left : right;
}

export function getDowntimeRentalDays(startDate, endDate) {
  const start = dateKey(startDate);
  const end = dateKey(endDate) || start;
  if (!start || !end || end < start) return 0;
  const diffMs = parseDateOnly(end).getTime() - parseDateOnly(start).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

export function dateRangesOverlapInclusive(startA, endA, startB, endB) {
  const normalizedStartA = dateKey(startA);
  const normalizedStartB = dateKey(startB);
  const normalizedEndA = dateKey(endA) || normalizedStartA;
  const normalizedEndB = dateKey(endB) || normalizedStartB;
  if (!normalizedStartA || !normalizedStartB || !normalizedEndA || !normalizedEndB) return false;
  return normalizedStartA <= normalizedEndB && normalizedStartB <= normalizedEndA;
}

export function isOpenRentalForDowntime(rental) {
  const status = text(rental?.status).toLowerCase();
  return !CLOSED_RENTAL_STATUSES.has(status) && !rental?.actualReturnDate;
}

export function rentalMatchesDowntimeEquipment(rental, downtime) {
  const downtimeEquipmentId = text(downtime?.equipmentId);
  const rentalEquipmentId = text(rental?.equipmentId);
  if (downtimeEquipmentId && rentalEquipmentId) return downtimeEquipmentId === rentalEquipmentId;

  const downtimeSerialNumber = text(downtime?.serialNumber);
  const rentalSerialNumber = text(rental?.serialNumber);
  if (downtimeSerialNumber && rentalSerialNumber) return downtimeSerialNumber === rentalSerialNumber;

  const downtimeEquipmentInv = text(downtime?.equipmentInv || downtime?.inventoryNumber);
  const rentalEquipmentInv = text(rental?.equipmentInv || rental?.inventoryNumber);
  if (!isSafeEquipmentInventoryRef(downtimeEquipmentInv)) return false;
  if (rentalEquipmentInv && !isSafeEquipmentInventoryRef(rentalEquipmentInv)) return false;
  if (downtimeEquipmentInv && rentalEquipmentInv && downtimeEquipmentInv === rentalEquipmentInv) return true;
  if (downtimeEquipmentInv && Array.isArray(rental?.equipment)) {
    return rental.equipment.map(text).includes(downtimeEquipmentInv);
  }
  return false;
}

export function canonicalDowntimeRentalId(rental) {
  return text(rental?.rentalId)
    || text(rental?.sourceRentalId)
    || text(rental?.originalRentalId)
    || text(rental?.id);
}

function rentalFlowStatusPriority(rental) {
  const status = text(rental?.status).toLowerCase();
  return RENTAL_FLOW_STATUS_PRIORITY[status] || 1;
}

export function chooseBestDowntimeRentalMatch(matches) {
  return [...(Array.isArray(matches) ? matches : [])].sort((left, right) =>
    rentalFlowStatusPriority(right) - rentalFlowStatusPriority(left),
  )[0] || null;
}

function groupMatchesByCanonicalRental(matches) {
  const groups = new Map();
  for (const rental of matches) {
    const key = canonicalDowntimeRentalId(rental);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(rental);
    groups.set(key, group);
  }
  return groups;
}

export function findDowntimeRentalFlowTarget({ downtime, rentals }) {
  const matches = (Array.isArray(rentals) ? rentals : [])
    .filter(rental => isOpenRentalForDowntime(rental))
    .filter(rental => rentalMatchesDowntimeEquipment(rental, downtime))
    .filter(rental => dateRangesOverlapInclusive(
      downtime?.startDate,
      downtime?.endDate || downtime?.startDate,
      rental?.startDate,
      rental?.endDate || rental?.plannedReturnDate,
    ));

  if (matches.length === 1) {
    return { flow: 'rental', rental: matches[0], matches };
  }

  const matchGroups = groupMatchesByCanonicalRental(matches);

  if (matchGroups.size === 1) {
    const groupedMatches = [...matchGroups.values()][0];
    return {
      flow: 'rental',
      rental: chooseBestDowntimeRentalMatch(groupedMatches),
      matches,
    };
  }
  if (matches.length > 1) {
    return {
      flow: 'conflict',
      matches,
      message: 'Найдено несколько разных аренд в выбранном периоде. Откройте нужную аренду и скорректируйте простой там.',
    };
  }
  return { flow: 'standalone', rental: null, matches: [] };
}

export function formatDowntimePeriod(startDate, endDate) {
  const start = dateKey(startDate);
  const end = dateKey(endDate) || start;
  if (!start) return '';
  return end && end !== start ? `${start} → ${end}` : start;
}

export function normalizeRentalDowntimePeriod(period, rental = {}) {
  const startDate = dateKey(period?.startDate || period?.downtimeStartDate);
  const endDate = dateKey(period?.endDate || period?.downtimeEndDate || period?.startDate || period?.downtimeStartDate);
  if (!startDate || !endDate) return null;
  return {
    id: text(period?.id),
    rentalId: text(period?.rentalId) || canonicalDowntimeRentalId(rental),
    ganttRentalId: text(period?.ganttRentalId || period?.linkedGanttRentalId) || text(rental?.id),
    clientId: text(period?.clientId) || text(rental?.clientId),
    equipmentId: text(period?.equipmentId) || text(rental?.equipmentId),
    equipmentInv: text(period?.equipmentInv || period?.inventoryNumber) || text(rental?.equipmentInv || rental?.inventoryNumber),
    serialNumber: text(period?.serialNumber) || text(rental?.serialNumber),
    startDate,
    endDate,
    reason: text(period?.reason || period?.downtimeReason) || 'Простой аренды',
    comment: text(period?.comment || period?.downtimeComment),
    affectsBilling: period?.affectsBilling === true,
    status: text(period?.status || period?.downtimeStatus) || 'active',
    createdBy: text(period?.createdBy),
    createdAt: text(period?.createdAt),
    updatedAt: text(period?.updatedAt),
  };
}

export function normalizeRentalDowntimePeriods(rental) {
  const periods = Array.isArray(rental?.downtimePeriods)
    ? rental.downtimePeriods.map(period => normalizeRentalDowntimePeriod(period, rental)).filter(Boolean).filter(period => period.id)
    : [];
  if (periods.length > 0) {
    return periods
      .filter(period => period.status !== 'cancelled')
      .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.endDate.localeCompare(right.endDate));
  }
  const legacy = buildLegacyRentalDowntimePeriod(rental);
  return legacy ? [legacy] : [];
}

export function buildLegacyRentalDowntimePeriod(rental) {
  if (!rental || rental.downtimeStatus === 'cancelled') return null;
  const periodFromReason = String(rental.downtimeReason || '').match(/период\s+(\d{4}-\d{2}-\d{2})(?:\s*(?:→|->|-)\s*(\d{4}-\d{2}-\d{2}))?/i);
  const startDate = dateKey(rental.downtimeStartDate || periodFromReason?.[1]);
  const endDate = dateKey(rental.downtimeEndDate || rental.downtimeStartDate || periodFromReason?.[2] || periodFromReason?.[1]);
  const days = Math.max(0, Number(rental.downtimeDays) || 0);
  if (!startDate || (!days && !rental.downtimeReason)) return null;
  return normalizeRentalDowntimePeriod({
    id: `rental-downtime:${text(rental.id)}`,
    rentalId: canonicalDowntimeRentalId(rental),
    ganttRentalId: text(rental.id),
    equipmentId: rental.equipmentId,
    equipmentInv: rental.equipmentInv,
    serialNumber: rental.serialNumber,
    startDate,
    endDate,
    reason: rental.downtimeReason || 'Простой аренды',
    comment: rental.downtimeComment || '',
    affectsBilling: rental.downtimeAffectsBilling === true,
    status: rental.downtimeStatus || 'active',
  }, rental);
}

export function calculateRentalDowntimeSummary(rental) {
  const periods = normalizeRentalDowntimePeriods(rental);
  const totalCalendarDays = getDowntimeRentalDays(rental?.startDate, rental?.plannedReturnDate || rental?.endDate);
  const downtimeDays = periods.reduce((sum, period) => sum + getDowntimeRentalDays(period.startDate, period.endDate), 0);
  const billableDowntimeDays = periods
    .filter(period => period.affectsBilling)
    .reduce((sum, period) => sum + getDowntimeRentalDays(period.startDate, period.endDate), 0);
  return {
    periods,
    totalCalendarDays,
    downtimeDays,
    billableDowntimeDays,
    billableDays: totalCalendarDays ? Math.max(0, totalCalendarDays - billableDowntimeDays) : 0,
    activeRentalDays: totalCalendarDays ? Math.max(0, totalCalendarDays - downtimeDays) : 0,
  };
}

function inferGrossAmount(rental) {
  return toMoney(rental?.amount ?? rental?.price ?? rental?.totalAmount ?? rental?.rentalAmount);
}

function inferDailyRate(rental, fullCalendarDays, grossAmount) {
  if (grossAmount > 0 && fullCalendarDays > 0) return roundMoney(grossAmount / fullCalendarDays);
  const explicitDaily = parseMoneyValue(rental?.dailyRate ?? rental?.pricePerDay);
  if (explicitDaily !== null) return explicitDaily;
  const monthlyRate = parseMoneyValue(rental?.monthlyRate);
  if (monthlyRate !== null) return roundMoney(monthlyRate / 30);
  const rateText = String(rental?.rate || '').toLowerCase();
  const rateValue = parseMoneyValue(rateText);
  if (rateValue !== null) return /мес|month/.test(rateText) ? roundMoney(rateValue / 30) : rateValue;
  return 0;
}

export function calculateRentalBilling(rental, options = {}) {
  const fullStart = dateKey(rental?.startDate);
  const fullEnd = dateKey(rental?.plannedReturnDate || rental?.endDate || rental?.actualReturnDate || rental?.returnDate) || fullStart;
  const fullCalendarDays = getDowntimeRentalDays(fullStart, fullEnd);
  const grossFullAmount = inferGrossAmount(rental);
  const dailyRate = inferDailyRate(rental, fullCalendarDays, grossFullAmount);
  if (fullCalendarDays <= 0) {
    return {
      totalCalendarDays: 0,
      downtimeDays: 0,
      billingDowntimeDays: 0,
      nonBillingDowntimeDays: 0,
      billableDays: 0,
      activeRentalDays: 0,
      dailyRate,
      grossRentalAmount: grossFullAmount,
      downtimeAdjustmentAmount: 0,
      finalRentalAmount: grossFullAmount,
      periods: normalizeRentalDowntimePeriods(rental),
      scopedPeriods: [],
    };
  }
  const periodStart = dateKey(options.periodStart || options.dateFrom);
  const periodEnd = dateKey(options.periodEnd || options.dateTo);
  const allocationStart = maxDate(fullStart, periodStart);
  const allocationEnd = minDate(fullEnd, periodEnd);
  const totalCalendarDays = getDowntimeRentalDays(allocationStart, allocationEnd);
  const periods = normalizeRentalDowntimePeriods(rental);
  const scopedPeriods = periods
    .filter(period => period.status !== 'cancelled')
    .map(period => {
      const startDate = maxDate(period.startDate, allocationStart);
      const endDate = minDate(period.endDate, allocationEnd);
      const days = getDowntimeRentalDays(startDate, endDate);
      if (days <= 0) return null;
      return { ...period, startDate, endDate, days };
    })
    .filter(Boolean);
  const downtimeDays = scopedPeriods.reduce((sum, period) => sum + period.days, 0);
  const billingDowntimeDays = scopedPeriods
    .filter(period => period.affectsBilling)
    .reduce((sum, period) => sum + period.days, 0);
  const nonBillingDowntimeDays = Math.max(0, downtimeDays - billingDowntimeDays);
  const billableDays = totalCalendarDays ? Math.max(0, totalCalendarDays - billingDowntimeDays) : 0;
  const activeRentalDays = totalCalendarDays ? Math.max(0, totalCalendarDays - downtimeDays) : 0;
  const coversFullRental = totalCalendarDays > 0 && allocationStart === fullStart && allocationEnd === fullEnd;
  const grossRentalAmount = coversFullRental ? grossFullAmount : roundMoney(dailyRate * totalCalendarDays);
  const downtimeAdjustmentAmount = roundMoney(dailyRate * billingDowntimeDays);
  const finalRentalAmount = roundMoney(Math.max(0, grossRentalAmount - downtimeAdjustmentAmount));
  return {
    totalCalendarDays,
    downtimeDays,
    billingDowntimeDays,
    nonBillingDowntimeDays,
    billableDays,
    activeRentalDays,
    dailyRate,
    grossRentalAmount,
    downtimeAdjustmentAmount,
    finalRentalAmount,
    periods,
    scopedPeriods,
  };
}

export function getRentalBillingAmount(rental, options = {}) {
  return calculateRentalBilling(rental, options).finalRentalAmount;
}

export function buildRentalDowntimePatch(downtime) {
  const reason = text(downtime?.reason) || 'Простой техники';
  const comment = text(downtime?.comment);
  const period = formatDowntimePeriod(downtime?.startDate, downtime?.endDate);
  const status = text(downtime?.status) || 'active';
  const details = [
    period ? `период ${period}` : '',
    comment,
  ].filter(Boolean).join('; ');
  return {
    downtimeDays: status === 'cancelled' ? 0 : getDowntimeRentalDays(downtime?.startDate, downtime?.endDate),
    downtimeReason: details ? `${reason} (${details})` : reason,
    downtimeStartDate: dateKey(downtime?.startDate),
    downtimeEndDate: dateKey(downtime?.endDate) || dateKey(downtime?.startDate),
    downtimeComment: comment,
    downtimeStatus: status,
  };
}

export function buildRentalDowntimeChangeReason(downtime, rental) {
  const equipment = text(downtime?.serialNumber || rental?.serialNumber || downtime?.equipmentInv || rental?.equipmentInv || rental?.equipment?.[0]);
  const period = formatDowntimePeriod(downtime?.startDate, downtime?.endDate);
  const reason = text(downtime?.reason) || 'причина не указана';
  const comment = text(downtime?.comment);
  return [
    `Простой техники${equipment ? ` ${equipment}` : ''}${period ? `: ${period}` : ''}`,
    reason,
    comment,
  ].filter(Boolean).join('. ');
}

export function downtimeSaveErrorMessage(error) {
  const message = text(error?.message);
  if (!message || /^HTTP\s+\d+$/i.test(message) || /validation failed/i.test(message)) {
    return 'Не удалось сохранить простой. Проверьте технику, даты и пересечения с арендой.';
  }
  return message;
}
