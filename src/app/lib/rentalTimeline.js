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

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function daysBetween(start, end) {
  return Math.floor((start.getTime() - end.getTime()) / DAY_MS);
}

function clampDate(date, min, max) {
  if (date < min) return min;
  if (date > max) return max;
  return date;
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

function readFirstDate(...values) {
  for (const value of values) {
    const date = parseDateOnly(value);
    if (date) return date;
  }
  return null;
}

function readAmount(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.max(0, numeric);
  }
  return 0;
}

function resolvePaidThroughDate(rental, debtRow, start, end, amount, paidAmount, outstanding, status) {
  const explicit = readFirstDate(rental?.paidThroughDate, rental?.paidUntil, rental?.paidToDate);
  if (explicit) return dateKey(clampDate(explicit, start, end));

  if (
    status === 'paid'
    || (amount > 0 && paidAmount >= amount)
    || (Boolean(debtRow) && outstanding <= 0 && (amount > 0 || paidAmount > 0))
  ) {
    return dateKey(end);
  }

  const totalDays = Math.max(1, daysBetween(end, start) + 1);
  if (paidAmount <= 0 || amount <= 0) return null;

  const dailyRate = amount / totalDays;
  if (!Number.isFinite(dailyRate) || dailyRate <= 0) return null;

  const paidDays = Math.floor(paidAmount / dailyRate);
  if (paidDays <= 0) return null;

  return dateKey(clampDate(addDays(start, paidDays - 1), start, end));
}

function hasOutstandingDebt(rental, debtRow, amount, paidAmount, outstanding, status) {
  if (outstanding > 0) return true;
  if (status === 'overdue') return true;
  if ((status === 'unpaid' || status === 'partial') && amount > 0) return paidAmount < amount;
  if (Boolean(debtRow) && amount > 0) return paidAmount < amount;
  return false;
}

function resolveOverdueSinceDate(rental, debtRow, start, end, paidThroughDate, todayKey, amount, paidAmount, outstanding, status) {
  if (!hasOutstandingDebt(rental, debtRow, amount, paidAmount, outstanding, status)) return null;

  const explicit = readFirstDate(rental?.overdueSince, rental?.debtSince, rental?.paymentOverdueSince, debtRow?.overdueSince, debtRow?.debtSince);
  if (explicit) return dateKey(clampDate(explicit, start, end));

  const due = readFirstDate(
    debtRow?.expectedPaymentDate,
    debtRow?.dueDate,
    rental?.expectedPaymentDate,
    rental?.dueDate,
    rental?.paymentDueDate,
  );
  if (due && dateKey(due) < todayKey) {
    return dateKey(clampDate(addDays(due, 1), start, end));
  }

  const paidThrough = parseDateOnly(paidThroughDate);
  const today = parseDateOnly(todayKey);
  if (paidThrough && today && today > paidThrough && today >= start) {
    return dateKey(clampDate(addDays(paidThrough, 1), start, end));
  }

  return null;
}

function pushSegment(segments, tone, start, end, rentalStart, totalDays) {
  if (!start || !end || start > end) return;
  const offsetStart = daysBetween(start, rentalStart);
  const offsetEndExclusive = daysBetween(addDays(end, 1), rentalStart);
  segments.push({
    tone,
    startDate: dateKey(start),
    endDate: dateKey(end),
    startPercent: Math.max(0, Math.min(100, (offsetStart / totalDays) * 100)),
    widthPercent: Math.max(0, Math.min(100, ((offsetEndExclusive - offsetStart) / totalDays) * 100)),
  });
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

export function buildRentalPaymentBar(rental, debtRow, todayKey = dateKey(new Date())) {
  const start = parseDateOnly(rental?.startDate);
  const end = parseDateOnly(rental?.endDate);
  if (!start || !end || start > end) {
    return {
      tone: 'unknown',
      paymentStatus: 'unknown',
      amount: 0,
      paidAmount: 0,
      outstanding: 0,
      paidThroughDate: null,
      overdueSince: null,
      paidThroughPercent: null,
      overdueSincePercent: null,
      segments: [{ tone: 'unknown', startDate: '', endDate: '', startPercent: 0, widthPercent: 100 }],
    };
  }

  const status = normalizeStatus(debtRow?.paymentStatus || rental?.paymentStatus);
  const amount = readAmount(debtRow?.amount, rental?.totalAmount, rental?.amount);
  const paidAmount = readAmount(debtRow?.paidAmount, rental?.paidAmount, rental?.paid);
  const explicitOutstanding = readAmount(debtRow?.outstanding, debtRow?.debt, rental?.outstanding, rental?.debt);
  const outstanding = status === 'paid'
    ? 0
    : (explicitOutstanding || (amount > 0 ? Math.max(0, amount - paidAmount) : 0));
  const totalDays = Math.max(1, daysBetween(end, start) + 1);
  const paidThroughDate = resolvePaidThroughDate(rental, debtRow, start, end, amount, paidAmount, outstanding, status);
  const overdueSince = resolveOverdueSinceDate(rental, debtRow, start, end, paidThroughDate, todayKey, amount, paidAmount, outstanding, status);
  const tone = classifyRentalPaymentTone(rental, debtRow, todayKey);
  const segments = [];

  const paidThrough = parseDateOnly(paidThroughDate);
  const overdueStart = parseDateOnly(overdueSince);
  let cursor = new Date(start);

  if (paidThrough) {
    pushSegment(segments, 'paid', cursor, paidThrough, start, totalDays);
    cursor = addDays(paidThrough, 1);
  }

  if (overdueStart) {
    pushSegment(segments, 'unpaid', cursor, addDays(overdueStart, -1), start, totalDays);
    pushSegment(segments, 'overdue', overdueStart, end, start, totalDays);
  } else if (cursor <= end) {
    pushSegment(segments, tone === 'unknown' ? 'unknown' : 'unpaid', cursor, end, start, totalDays);
  }

  if (segments.length === 0) {
    pushSegment(segments, tone === 'unknown' ? 'unknown' : tone, start, end, start, totalDays);
  }

  const paidThroughPercent = paidThrough
    ? Math.max(0, Math.min(100, (daysBetween(addDays(paidThrough, 1), start) / totalDays) * 100))
    : null;
  const overdueSincePercent = overdueStart
    ? Math.max(0, Math.min(100, (daysBetween(overdueStart, start) / totalDays) * 100))
    : null;

  return {
    tone,
    paymentStatus: status || 'unknown',
    amount,
    paidAmount,
    outstanding,
    paidThroughDate,
    overdueSince,
    paidThroughPercent,
    overdueSincePercent,
    segments,
  };
}
