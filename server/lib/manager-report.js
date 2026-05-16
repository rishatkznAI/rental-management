const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const EQ_TYPE_LABELS = {
  scissor: 'Ножничный',
  articulated: 'Коленчатый',
  telescopic: 'Телескопический',
};

const RENTAL_STATUS_LABELS = {
  created: 'Бронь',
  active: 'Активна',
  returned: 'Возвращена',
  closed: 'Закрыта',
};

const PAYMENT_STATUS_LABELS = {
  paid: 'Оплачено',
  partial: 'Частично',
  unpaid: 'Не оплачено',
};

const IGNORED_PAYMENT_STATUSES = new Set(['cancelled', 'canceled', 'void', 'error', 'failed', 'closed', 'deleted', 'reversed']);
const IGNORED_RENTAL_STATUSES = new Set(['cancelled', 'canceled', 'void', 'error', 'failed', 'deleted', 'archived']);
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeStatus(value) {
  return String(value ?? '').trim().toLowerCase();
}

function shouldCountManagerReportPayment(payment) {
  return !IGNORED_PAYMENT_STATUSES.has(normalizeStatus(payment?.status));
}

function shouldCountManagerReportRental(rental) {
  return !IGNORED_RENTAL_STATUSES.has(normalizeStatus(rental?.status));
}

function toMoney(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function text(value) {
  return String(value ?? '').trim();
}

function parseMoneyValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, value) : null;
  const normalized = String(value).replace(/\s+/g, '').replace(',', '.').replace(/[^\d.]/g, '');
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
}

function roundMoney(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function parseDateKey(value) {
  const text = String(value || '').slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date) {
  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function inclusiveDays(start, end) {
  if (!start || !end || end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

function getRentalDays(startDate, endDate) {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate) || start;
  return inclusiveDays(start, end);
}

function clampDate(date, min, max) {
  if (min && date < min) return min;
  if (max && date > max) return max;
  return date;
}

function splitRentalPeriodByMonth(rental, period = {}) {
  let start = parseDateKey(rental?.startDate);
  let end = parseDateKey(rental?.endDate || rental?.plannedReturnDate);
  if (!start) return [];
  if (!end) end = start;
  if (end < start) end = start;
  const periodStart = parseDateKey(period.dateFrom);
  const periodEnd = parseDateKey(period.dateTo);
  const clippedStart = clampDate(start, periodStart, periodEnd);
  const clippedEnd = clampDate(end, periodStart, periodEnd);
  if (clippedEnd < clippedStart || clippedEnd < start || clippedStart > end) return [];
  const parts = [];
  let cursor = startOfMonth(clippedStart);
  while (cursor <= clippedEnd) {
    const allocationStart = clampDate(clampDate(start, cursor, endOfMonth(cursor)), periodStart, periodEnd);
    const allocationEnd = clampDate(clampDate(end, cursor, endOfMonth(cursor)), periodStart, periodEnd);
    const days = inclusiveDays(allocationStart, allocationEnd);
    if (days > 0) {
      parts.push({ monthKey: monthKey(cursor), monthLabel: monthLabel(cursor), allocationStartDate: dateKey(allocationStart), allocationEndDate: dateKey(allocationEnd), days });
    }
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return parts;
}

function canonicalRentalId(rental) {
  return text(rental?.rentalId) || text(rental?.sourceRentalId) || text(rental?.originalRentalId) || text(rental?.id);
}

function normalizeDowntimePeriod(period, rental = {}) {
  const startDate = String(period?.startDate || period?.downtimeStartDate || '').slice(0, 10);
  const endDate = String(period?.endDate || period?.downtimeEndDate || startDate).slice(0, 10);
  if (!parseDateKey(startDate) || !parseDateKey(endDate)) return null;
  return {
    id: text(period?.id),
    rentalId: text(period?.rentalId) || canonicalRentalId(rental),
    startDate,
    endDate,
    affectsBilling: period?.affectsBilling === true,
    status: text(period?.status || period?.downtimeStatus) || 'active',
  };
}

function legacyDowntimePeriod(rental) {
  if (!rental || rental.downtimeStatus === 'cancelled') return null;
  const periodFromReason = String(rental.downtimeReason || '').match(/период\s+(\d{4}-\d{2}-\d{2})(?:\s*(?:→|->|-)\s*(\d{4}-\d{2}-\d{2}))?/i);
  const startDate = String(rental.downtimeStartDate || periodFromReason?.[1] || '').slice(0, 10);
  const endDate = String(rental.downtimeEndDate || rental.downtimeStartDate || periodFromReason?.[2] || periodFromReason?.[1] || '').slice(0, 10);
  const days = Math.max(0, Number(rental.downtimeDays) || 0);
  if (!startDate || (!days && !rental.downtimeReason)) return null;
  return normalizeDowntimePeriod({
    id: `rental-downtime:${text(rental.id)}`,
    rentalId: canonicalRentalId(rental),
    startDate,
    endDate,
    affectsBilling: rental.downtimeAffectsBilling === true,
    status: rental.downtimeStatus || 'active',
  }, rental);
}

function normalizeDowntimePeriods(rental) {
  const periods = Array.isArray(rental?.downtimePeriods)
    ? rental.downtimePeriods.map(period => normalizeDowntimePeriod(period, rental)).filter(Boolean).filter(period => period.id)
    : [];
  if (periods.length > 0) return periods.filter(period => period.status !== 'cancelled').sort((left, right) => left.startDate.localeCompare(right.startDate) || left.endDate.localeCompare(right.endDate));
  const legacy = legacyDowntimePeriod(rental);
  return legacy ? [legacy] : [];
}

function minDate(left, right) {
  if (!left) return right;
  if (!right) return left;
  return left < right ? left : right;
}

function maxDate(left, right) {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
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

function calculateRentalBilling(rental, options = {}) {
  const fullStart = String(rental?.startDate || '').slice(0, 10);
  const fullEnd = String(rental?.plannedReturnDate || rental?.endDate || rental?.actualReturnDate || rental?.returnDate || fullStart).slice(0, 10);
  const fullCalendarDays = getRentalDays(fullStart, fullEnd);
  const grossFullAmount = inferGrossAmount(rental);
  const dailyRate = inferDailyRate(rental, fullCalendarDays, grossFullAmount);
  if (fullCalendarDays <= 0) return { finalRentalAmount: grossFullAmount };
  const periodStart = String(options.periodStart || options.dateFrom || '').slice(0, 10);
  const periodEnd = String(options.periodEnd || options.dateTo || '').slice(0, 10);
  const allocationStart = maxDate(fullStart, periodStart);
  const allocationEnd = minDate(fullEnd, periodEnd);
  const totalCalendarDays = getRentalDays(allocationStart, allocationEnd);
  const scopedPeriods = normalizeDowntimePeriods(rental)
    .map(period => {
      const startDate = maxDate(period.startDate, allocationStart);
      const endDate = minDate(period.endDate, allocationEnd);
      const days = getRentalDays(startDate, endDate);
      return days <= 0 ? null : { ...period, startDate, endDate, days };
    })
    .filter(Boolean);
  const billingDowntimeDays = scopedPeriods.filter(period => period.affectsBilling).reduce((sum, period) => sum + period.days, 0);
  const coversFullRental = totalCalendarDays > 0 && allocationStart === fullStart && allocationEnd === fullEnd;
  const grossRentalAmount = coversFullRental ? grossFullAmount : roundMoney(dailyRate * totalCalendarDays);
  return { finalRentalAmount: roundMoney(Math.max(0, grossRentalAmount - roundMoney(dailyRate * billingDowntimeDays))) };
}

function rentalAmountForPart(rental, part) {
  return calculateRentalBilling(rental, {
    periodStart: part.allocationStartDate,
    periodEnd: part.allocationEndDate,
  }).finalRentalAmount;
}

function getManagerReportPaidAmount(payment) {
  if (!shouldCountManagerReportPayment(payment)) return 0;
  if (typeof payment?.paidAmount === 'number') return toMoney(payment.paidAmount);
  if (payment?.status === 'paid') return toMoney(payment.amount);
  return 0;
}

function buildPaidByRental(payments, paymentAllocations = []) {
  const allocationsByPaymentId = new Map();
  for (const allocation of paymentAllocations || []) {
    const paymentId = String(allocation?.paymentId || '').trim();
    if (!paymentId) continue;
    const list = allocationsByPaymentId.get(paymentId) ?? [];
    list.push(allocation);
    allocationsByPaymentId.set(paymentId, list);
  }
  const paymentsById = new Map((payments || []).filter(payment => payment?.id).map(payment => [String(payment.id), payment]));
  const paidByRental = new Map();
  const paidDatesByRental = new Map();
  for (const [paymentId, allocations] of allocationsByPaymentId) {
    const payment = paymentsById.get(paymentId);
    if (!payment || !shouldCountManagerReportPayment(payment)) continue;
    let remaining = Math.min(getManagerReportPaidAmount(payment), toMoney(payment.amount) || getManagerReportPaidAmount(payment));
    for (const allocation of allocations) {
      const rentalId = String(allocation?.rentalId || '').trim();
      const requested = toMoney(allocation?.amount ?? allocation?.allocatedAmount);
      if (!rentalId || requested <= 0 || remaining <= 0) continue;
      const amount = Math.min(requested, remaining);
      paidByRental.set(rentalId, (paidByRental.get(rentalId) ?? 0) + amount);
      const date = payment.paidDate || allocation.paidDate || '';
      if (date && date > (paidDatesByRental.get(rentalId) || '')) paidDatesByRental.set(rentalId, date);
      remaining -= amount;
    }
  }
  for (const payment of payments || []) {
    const id = String(payment?.id || '').trim();
    if (!payment?.rentalId || !shouldCountManagerReportPayment(payment) || (id && allocationsByPaymentId.has(id))) continue;
    const amount = Math.min(getManagerReportPaidAmount(payment), toMoney(payment.amount) || getManagerReportPaidAmount(payment));
    if (amount <= 0) continue;
    paidByRental.set(payment.rentalId, (paidByRental.get(payment.rentalId) ?? 0) + amount);
    if (payment.paidDate && payment.paidDate > (paidDatesByRental.get(payment.rentalId) || '')) paidDatesByRental.set(payment.rentalId, payment.paidDate);
  }
  return { paidByRental, paidDatesByRental };
}

function splitMoneyByWeights(total, weights, totalWeight) {
  const safeTotal = toMoney(total);
  const sumWeight = weights.reduce((sum, value) => sum + Math.max(0, value || 0), 0);
  const safeTotalWeight = Math.max(0, totalWeight || 0);
  if (safeTotal <= 0 || sumWeight <= 0 || safeTotalWeight <= 0) return weights.map(() => 0);
  let used = 0;
  const coversWholeAmount = Math.abs(sumWeight - safeTotalWeight) < 0.000001;
  return weights.map((weight, index) => {
    if (coversWholeAmount && index === weights.length - 1) return roundMoney(safeTotal - used);
    const part = roundMoney(safeTotal * Math.max(0, weight || 0) / safeTotalWeight);
    used += part;
    return part;
  });
}

function buildManagerReportRows(rentals, equipmentList, payments, period = {}, paymentAllocations = []) {
  const eqById = new Map();
  const eqByUniqueInv = new Map();
  const inventoryCounts = new Map();
  for (const eq of equipmentList || []) {
    eqById.set(eq.id, eq);
    inventoryCounts.set(eq.inventoryNumber, (inventoryCounts.get(eq.inventoryNumber) ?? 0) + 1);
  }
  for (const eq of equipmentList || []) {
    if ((inventoryCounts.get(eq.inventoryNumber) ?? 0) === 1) eqByUniqueInv.set(eq.inventoryNumber, eq);
  }
  const { paidByRental, paidDatesByRental } = buildPaidByRental(payments, paymentAllocations);
  const rows = [];
  for (const rental of (rentals || []).filter(shouldCountManagerReportRental)) {
    const eq = (rental.equipmentId ? eqById.get(rental.equipmentId) : undefined) ?? eqByUniqueInv.get(rental.equipmentInv);
    const parts = splitRentalPeriodByMonth(rental, period);
    if (parts.length === 0) continue;
    const amountParts = parts.map(part => rentalAmountForPart(rental, part));
    const paidParts = splitMoneyByWeights(paidByRental.get(rental.id) ?? 0, amountParts, calculateRentalBilling(rental).finalRentalAmount);
    parts.forEach((part, index) => {
      const amount = amountParts[index] || 0;
      const paidAmount = paidParts[index] || 0;
      const debt = roundMoney(Math.max(0, amount - paidAmount));
      const paymentStatus = paidAmount + 0.005 >= amount ? 'paid' : (paidAmount > 0 ? 'partial' : 'unpaid');
      rows.push({
        rowId: `${rental.id}:${part.monthKey}:${part.allocationStartDate}:${part.allocationEndDate}`,
        rentalId: rental.id,
        equipmentId: eq?.id || rental.equipmentId || '',
        equipmentFilterKey: eq?.id || rental.equipmentId || `inv:${rental.equipmentInv || '—'}`,
        monthLabel: part.monthLabel,
        monthKey: part.monthKey,
        allocationStartDate: part.allocationStartDate,
        allocationEndDate: part.allocationEndDate,
        allocationDays: part.days,
        manager: rental.manager || '—',
        client: rental.client || '—',
        equipmentInv: rental.equipmentInv || '—',
        equipmentType: eq?.type ?? '',
        equipmentLabel: eq ? (EQ_TYPE_LABELS[eq.type] ?? eq.type) : '—',
        equipmentName: eq ? `${eq.manufacturer || ''} ${eq.model || ''}`.trim() : (rental.equipmentInv || '—'),
        startDate: rental.startDate,
        endDate: rental.endDate || rental.plannedReturnDate || '',
        amount,
        paymentStatus,
        paymentLabel: PAYMENT_STATUS_LABELS[paymentStatus] ?? paymentStatus,
        paidAmount,
        debt,
        paidDate: paidDatesByRental.get(rental.id) || '',
        updSigned: Boolean(rental.updSigned),
        updDate: rental.updDate ?? '',
        rentalStatus: rental.status,
        rentalStatusLabel: RENTAL_STATUS_LABELS[rental.status] ?? rental.status,
      });
    });
  }
  return rows;
}

function filterManagerReportRows(rows, filters = {}) {
  return (rows || []).filter(row => {
    if (filters.manager && filters.manager !== 'all' && row.manager !== filters.manager) return false;
    if (filters.client && filters.client !== 'all' && row.client !== filters.client) return false;
    if (filters.equipmentType && filters.equipmentType !== 'all' && row.equipmentType !== filters.equipmentType) return false;
    if (filters.equipmentInv && filters.equipmentInv !== 'all' && row.equipmentFilterKey !== filters.equipmentInv) return false;
    if (filters.paymentStatus && filters.paymentStatus !== 'all' && row.paymentStatus !== filters.paymentStatus) return false;
    if (filters.updStatus === 'signed' && !row.updSigned) return false;
    if (filters.updStatus === 'unsigned' && row.updSigned) return false;
    if (filters.rentalStatus && filters.rentalStatus !== 'all' && row.rentalStatus !== filters.rentalStatus) return false;
    return true;
  });
}

function buildManagerReportSummary(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (!map.has(row.manager)) {
      map.set(row.manager, { manager: row.manager, rentals: new Set(), clients: new Set(), totalAmount: 0, paidAmount: 0, debt: 0, updSignedCount: 0, updNotSignedCount: 0, activeRentals: new Set(), closedRentals: new Set(), overdueRentals: new Set() });
    }
    const item = map.get(row.manager);
    item.rentals.add(row.rentalId);
    item.clients.add(row.client);
    item.totalAmount = roundMoney(item.totalAmount + row.amount);
    item.paidAmount = roundMoney(item.paidAmount + row.paidAmount);
    item.debt = roundMoney(item.debt + row.debt);
    if (row.updSigned) item.updSignedCount += 1;
    else item.updNotSignedCount += 1;
    if (row.rentalStatus === 'active') item.activeRentals.add(row.rentalId);
    if (['returned', 'closed'].includes(row.rentalStatus)) item.closedRentals.add(row.rentalId);
    if (row.debt > 0 && row.allocationEndDate < new Date().toISOString().slice(0, 10)) item.overdueRentals.add(row.rentalId);
  }
  return [...map.values()].map(item => ({
    manager: item.manager,
    rentalsCount: item.rentals.size,
    clientsCount: item.clients.size,
    totalAmount: item.totalAmount,
    paidAmount: item.paidAmount,
    debt: item.debt,
    updSignedCount: item.updSignedCount,
    updNotSignedCount: item.updNotSignedCount,
    activeRentals: item.activeRentals.size,
    closedRentals: item.closedRentals.size,
    overdueRentals: item.overdueRentals.size,
  })).sort((a, b) => b.totalAmount - a.totalAmount);
}

module.exports = {
  buildManagerReportRows,
  buildManagerReportSummary,
  filterManagerReportRows,
};
