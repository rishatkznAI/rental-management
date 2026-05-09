const DAY_MS = 86400000;

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

function parseDateOnly(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const [year, month, day] = text.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) {
    const fallback = new Date(text);
    return Number.isNaN(fallback.getTime()) ? null : new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  }
  return new Date(year, month - 1, day);
}

function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function overdueDays(row, todayKey) {
  const outstanding = safeNumber(row?.outstanding);
  if (outstanding <= 0) return 0;
  const dueKey = normalizeText(row?.expectedPaymentDate || row?.endDate);
  if (!dueKey || dueKey >= todayKey) return 0;
  const today = parseDateOnly(todayKey);
  const due = parseDateOnly(dueKey);
  if (!today || !due) return 0;
  return Math.max(0, Math.floor((today.getTime() - due.getTime()) / DAY_MS));
}

export function classifyRentalPaymentTone(rental, debtRow, todayKey = dateKey(new Date())) {
  const status = normalizeStatus(debtRow?.paymentStatus || rental?.paymentStatus);
  const amount = safeNumber(debtRow?.amount ?? rental?.amount);
  const paidAmount = safeNumber(debtRow?.paidAmount);
  const outstanding = safeNumber(debtRow?.outstanding);
  const hasDebtFacts = Boolean(debtRow);

  if (hasDebtFacts) {
    if (outstanding <= 0 && (amount > 0 || paidAmount > 0 || status === 'paid')) return 'paid';
    if (overdueDays(debtRow, todayKey) > 0) return 'overdue';
    if (paidAmount > 0 && outstanding > 0) return 'partial';
    if (outstanding > 0) return 'unpaid';
  }

  if (status === 'paid') return 'paid';
  if (status === 'partial') return 'partial';
  if (status === 'unpaid') {
    const fallbackDebtRow = {
      expectedPaymentDate: rental?.expectedPaymentDate,
      endDate: rental?.endDate,
      outstanding: amount > 0 ? amount : 1,
    };
    return overdueDays(fallbackDebtRow, todayKey) > 0 ? 'overdue' : 'unpaid';
  }

  return 'unknown';
}

export function buildRentalDayTiles(rental, viewStartValue, totalDays) {
  const start = parseDateOnly(rental?.startDate);
  const end = parseDateOnly(rental?.endDate);
  const viewStart = parseDateOnly(viewStartValue);
  if (!start || !end || !viewStart || totalDays <= 0) return [];

  const viewEndExclusive = new Date(viewStart);
  viewEndExclusive.setDate(viewEndExclusive.getDate() + totalDays);
  const endExclusive = new Date(end);
  endExclusive.setDate(endExclusive.getDate() + 1);

  const clampedStart = start > viewStart ? start : viewStart;
  const clampedEnd = endExclusive < viewEndExclusive ? endExclusive : viewEndExclusive;
  if (clampedStart >= clampedEnd) return [];

  const tiles = [];
  for (let day = new Date(clampedStart); day < clampedEnd; day.setDate(day.getDate() + 1)) {
    tiles.push({
      date: dateKey(day),
      index: Math.floor((day.getTime() - viewStart.getTime()) / DAY_MS),
    });
  }
  return tiles;
}
