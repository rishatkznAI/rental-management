const {
  activeDowntimePeriods,
  dateKey,
  inclusiveDays,
  normalizeRentalDowntimePeriods,
} = require('./rental-downtime-periods');

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

function rentalStartDate(rental) {
  return dateKey(rental?.startDate);
}

function rentalEndDate(rental) {
  return dateKey(rental?.plannedReturnDate || rental?.endDate || rental?.actualReturnDate || rental?.returnDate);
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
  if (rateValue !== null) {
    return /мес|month/.test(rateText) ? roundMoney(rateValue / 30) : rateValue;
  }
  return 0;
}

function normalizeBillingOptions(options = {}) {
  return {
    periodStart: dateKey(options.periodStart || options.dateFrom),
    periodEnd: dateKey(options.periodEnd || options.dateTo),
  };
}

function calculateRentalBilling(rental, options = {}) {
  const fullStart = rentalStartDate(rental);
  const fullEnd = rentalEndDate(rental) || fullStart;
  const fullCalendarDays = inclusiveDays(fullStart, fullEnd);
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
      periods: activeDowntimePeriods(normalizeRentalDowntimePeriods(rental)),
      scopedPeriods: [],
    };
  }

  const { periodStart, periodEnd } = normalizeBillingOptions(options);
  const allocationStart = maxDate(fullStart, periodStart);
  const allocationEnd = minDate(fullEnd, periodEnd);
  const totalCalendarDays = inclusiveDays(allocationStart, allocationEnd);

  const periods = activeDowntimePeriods(normalizeRentalDowntimePeriods(rental));
  const scopedPeriods = periods
    .map(period => {
      const startDate = maxDate(period.startDate, allocationStart);
      const endDate = minDate(period.endDate, allocationEnd);
      const days = inclusiveDays(startDate, endDate);
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
  const coversFullRental = totalCalendarDays > 0
    && allocationStart === fullStart
    && allocationEnd === fullEnd;
  const grossRentalAmount = coversFullRental
    ? grossFullAmount
    : roundMoney(dailyRate * totalCalendarDays);
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

function getRentalBillingAmount(rental, options = {}) {
  return calculateRentalBilling(rental, options).finalRentalAmount;
}

module.exports = {
  calculateRentalBilling,
  getRentalBillingAmount,
};
