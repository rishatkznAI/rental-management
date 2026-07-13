const DAY_MS = 86_400_000;

const EXCLUDED_RECORD_STATUSES = new Set([
  'cancelled',
  'canceled',
  'void',
  'error',
  'failed',
  'deleted',
  'archived',
]);

const CLOSED_RECEIVABLE_STATUSES = new Set(['closed', 'paid', 'settled', 'written_off']);

export const CANONICAL_DUE_DATE_SOURCES = Object.freeze([
  'invoice_due_date',
  'contractual_payment_due_date',
]);

export const DEBT_AGING_BUCKETS = Object.freeze([
  { key: 'current', label: 'Не наступил срок', minDays: Number.NEGATIVE_INFINITY, maxDays: 0 },
  { key: 'bucket1to30', label: '1–30 дней', minDays: 1, maxDays: 30 },
  { key: 'bucket31to60', label: '31–60 дней', minDays: 31, maxDays: 60 },
  { key: 'bucket61to90', label: '61–90 дней', minDays: 61, maxDays: 90 },
  { key: 'bucketOver90', label: 'Более 90 дней', minDays: 91, maxDays: Number.POSITIVE_INFINITY },
]);

const AMBIGUOUS_DUE_DATE_REASON = 'Не подтверждена договорная дата платежа';
const AMBIGUOUS_TIMEZONE_REASON = 'Не подтверждён часовой пояс компании';

function text(value) {
  return String(value ?? '').trim();
}

function normalizeStatus(value) {
  return text(value).toLowerCase();
}

function toCents(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round((numeric + Number.EPSILON) * 100));
}

function fromCents(value) {
  return Number((value / 100).toFixed(2));
}

function validDateKey(value) {
  const key = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  const [year, month, day] = key.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    ? key
    : '';
}

function dateKeyInTimeZone(value, timeZone) {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime()) || !timeZone) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const byType = new Map(parts.map(part => [part.type, part.value]));
    return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
  } catch {
    return '';
  }
}

function civilDayNumber(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return Math.trunc(Date.UTC(year, month - 1, day) / DAY_MS);
}

export function calendarOverdueDays(dueDate, asOfDate) {
  const dueKey = validDateKey(dueDate);
  const asOfKey = validDateKey(asOfDate);
  if (!dueKey || !asOfKey) return null;
  return civilDayNumber(asOfKey) - civilDayNumber(dueKey);
}

export function debtAgingBucketForDays(overdueDays) {
  if (!Number.isFinite(Number(overdueDays))) return null;
  const days = Number(overdueDays);
  return DEBT_AGING_BUCKETS.find(bucket => days >= bucket.minDays && days <= bucket.maxDays) ?? null;
}

function outstandingCents(row) {
  const amount = toCents(row?.canonicalReceivableAmount);
  const allocated = toCents(row?.confirmedAllocatedPayments);
  const credits = toCents(row?.confirmedCredits);
  const reversals = toCents(row?.confirmedReversals);
  return Math.max(0, amount - allocated - credits + reversals);
}

function receivableId(row, index) {
  return text(row?.receivableId || row?.id || row?.rentalId) || `missing:${index}`;
}

function dueDateFor(row) {
  const source = text(row?.dueDateSource);
  if (!CANONICAL_DUE_DATE_SOURCES.includes(source)) return '';
  return validDateKey(row?.effectiveDueDate || row?.dueDate);
}

function duplicateFingerprint(row) {
  return JSON.stringify({
    amount: toCents(row?.canonicalReceivableAmount),
    allocated: toCents(row?.confirmedAllocatedPayments),
    credits: toCents(row?.confirmedCredits),
    reversals: toCents(row?.confirmedReversals),
    dueDate: dueDateFor(row),
    dueDateSource: text(row?.dueDateSource),
    clientId: text(row?.clientId),
    status: normalizeStatus(row?.status),
  });
}

function addExcludedReason(map, code, label, amountCents = 0, count = 1) {
  const current = map.get(code) ?? { code, label, count: 0, amountCents: 0 };
  current.count += count;
  current.amountCents += amountCents;
  map.set(code, current);
}

function emptyBucket(bucket) {
  return { key: bucket.key, label: bucket.label, count: 0, amountCents: 0, receivableIds: [] };
}

export function buildCanonicalDebtAging(receivables = [], options = {}) {
  const rows = Array.isArray(receivables) ? receivables : [];
  const sourceAvailable = options.sourceAvailable === true;
  const companyTimeZone = text(options.companyTimeZone);
  const explicitAsOfDate = validDateKey(options.asOfDate);
  const asOfDate = explicitAsOfDate || dateKeyInTimeZone(options.asOfInstant ?? new Date(), companyTimeZone);
  const hasCompanyCalendar = Boolean(companyTimeZone && asOfDate);
  const groups = new Map();

  rows.forEach((row, index) => {
    const id = receivableId(row, index);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  });

  const buckets = new Map(DEBT_AGING_BUCKETS.map(bucket => [bucket.key, emptyBucket(bucket)]));
  const excludedReasons = new Map();
  const eligibleReceivables = [];
  const ambiguousReceivables = [];
  const overdueByClient = new Map();
  let excludedAmbiguousCents = 0;
  let excludedAmbiguousCount = 0;
  let excludedStatusCents = 0;
  let excludedStatusCount = 0;
  let duplicateReceivableCount = 0;
  let conflictingDuplicateCount = 0;

  for (const [id, candidates] of groups.entries()) {
    const uniqueFingerprints = new Set(candidates.map(duplicateFingerprint));
    if (candidates.length > 1) duplicateReceivableCount += candidates.length - 1;
    if (uniqueFingerprints.size > 1) {
      const amountCents = Math.max(...candidates.map(outstandingCents));
      conflictingDuplicateCount += 1;
      excludedAmbiguousCount += 1;
      excludedAmbiguousCents += amountCents;
      ambiguousReceivables.push({ receivableId: id, outstandingBalance: fromCents(amountCents), reason: 'Конфликтующие дубли одной дебиторки' });
      addExcludedReason(excludedReasons, 'conflicting_duplicate', 'Конфликтующие дубли одной дебиторки', amountCents);
      continue;
    }

    const row = candidates[0];
    const balanceCents = outstandingCents(row);
    if (balanceCents <= 0) continue;

    const status = normalizeStatus(row?.status);
    const statusSemantics = text(row?.statusSemantics);
    const excludedByStatus = EXCLUDED_RECORD_STATUSES.has(status)
      || (statusSemantics === 'receivable_lifecycle' && CLOSED_RECEIVABLE_STATUSES.has(status));
    if (excludedByStatus) {
      excludedStatusCount += 1;
      excludedStatusCents += balanceCents;
      addExcludedReason(excludedReasons, 'terminal_status', 'Исключено по терминальному статусу', balanceCents);
      continue;
    }

    const effectiveDueDate = dueDateFor(row);
    let ambiguityReason = '';
    if (!effectiveDueDate) ambiguityReason = AMBIGUOUS_DUE_DATE_REASON;
    else if (!hasCompanyCalendar) ambiguityReason = AMBIGUOUS_TIMEZONE_REASON;

    if (ambiguityReason) {
      excludedAmbiguousCount += 1;
      excludedAmbiguousCents += balanceCents;
      ambiguousReceivables.push({
        receivableId: id,
        outstandingBalance: fromCents(balanceCents),
        sourceStatus: 'ambiguous',
        agingEligible: false,
        reason: ambiguityReason,
        ambiguousDate: validDateKey(row?.expectedPaymentDate || row?.endDate),
      });
      addExcludedReason(
        excludedReasons,
        effectiveDueDate ? 'company_timezone_unconfirmed' : 'contractual_due_date_unconfirmed',
        ambiguityReason,
        balanceCents,
      );
      continue;
    }

    const overdueDays = calendarOverdueDays(effectiveDueDate, asOfDate);
    const bucket = debtAgingBucketForDays(overdueDays);
    if (!bucket) {
      excludedAmbiguousCount += 1;
      excludedAmbiguousCents += balanceCents;
      addExcludedReason(excludedReasons, 'invalid_due_date', AMBIGUOUS_DUE_DATE_REASON, balanceCents);
      continue;
    }

    const bucketState = buckets.get(bucket.key);
    bucketState.count += 1;
    bucketState.amountCents += balanceCents;
    bucketState.receivableIds.push(id);
    const item = {
      receivableId: id,
      clientId: text(row?.clientId) || undefined,
      outstandingBalance: fromCents(balanceCents),
      effectiveDueDate,
      dueDateSource: text(row?.dueDateSource),
      overdueDays,
      bucket: bucket.key,
      sourceStatus: 'real',
      agingEligible: true,
    };
    eligibleReceivables.push(item);
    if (overdueDays > 0 && item.clientId) {
      overdueByClient.set(item.clientId, (overdueByClient.get(item.clientId) ?? 0) + balanceCents);
    }
  }

  const current = buckets.get('current');
  const bucket1to30 = buckets.get('bucket1to30');
  const bucket31to60 = buckets.get('bucket31to60');
  const bucket61to90 = buckets.get('bucket61to90');
  const bucketOver90 = buckets.get('bucketOver90');
  const totalOutstandingCents = [...buckets.values()].reduce((sum, bucket) => sum + bucket.amountCents, 0);
  const overdueOutstandingCents = totalOutstandingCents - current.amountCents;
  const largestClientOverdueCents = Math.max(0, ...overdueByClient.values());
  const overdueRowsWithoutClientId = eligibleReceivables.filter(row => row.overdueDays > 0 && !row.clientId).length;
  const debtAgingReliable = sourceAvailable
    && excludedAmbiguousCount === 0
    && conflictingDuplicateCount === 0
    && (eligibleReceivables.length === 0 || hasCompanyCalendar);
  const sourceConfidence = !sourceAvailable || excludedAmbiguousCount > 0
    ? 'low'
    : duplicateReceivableCount > 0 || overdueRowsWithoutClientId > 0
      ? 'medium'
      : 'high';

  const exposeBucket = bucket => ({
    key: bucket.key,
    label: bucket.label,
    amount: fromCents(bucket.amountCents),
    count: bucket.count,
    receivableIds: bucket.receivableIds,
  });

  return {
    asOfDate: asOfDate || null,
    companyTimeZone: companyTimeZone || null,
    timezoneStatus: hasCompanyCalendar ? 'confirmed' : 'ambiguous',
    sourceStatus: debtAgingReliable ? 'derived' : sourceAvailable ? 'ambiguous' : 'missing',
    sourceConfidence,
    debtAgingReliable,
    overdueReceivablesAvailable: debtAgingReliable,
    totalOutstandingAmount: fromCents(totalOutstandingCents),
    overdueOutstandingAmount: fromCents(overdueOutstandingCents),
    currentAmount: fromCents(current.amountCents),
    bucket1to30Amount: fromCents(bucket1to30.amountCents),
    bucket31to60Amount: fromCents(bucket31to60.amountCents),
    bucket61to90Amount: fromCents(bucket61to90.amountCents),
    bucketOver90Amount: fromCents(bucketOver90.amountCents),
    currentCount: current.count,
    bucket1to30Count: bucket1to30.count,
    bucket31to60Count: bucket31to60.count,
    bucket61to90Count: bucket61to90.count,
    bucketOver90Count: bucketOver90.count,
    eligibleReceivableCount: eligibleReceivables.length,
    overdueReceivableCount: eligibleReceivables.filter(row => row.overdueDays > 0).length,
    excludedAmbiguousAmount: fromCents(excludedAmbiguousCents),
    excludedAmbiguousCount,
    excludedStatusAmount: fromCents(excludedStatusCents),
    excludedStatusCount,
    duplicateReceivableCount,
    conflictingDuplicateCount,
    largestClientOverdueAmount: fromCents(largestClientOverdueCents),
    largestClientConcentrationAvailable: overdueOutstandingCents === 0 || overdueRowsWithoutClientId === 0,
    buckets: [...buckets.values()].map(exposeBucket),
    eligibleReceivables,
    ambiguousReceivables,
    excludedReasons: [...excludedReasons.values()].map(reason => ({
      code: reason.code,
      label: reason.label,
      count: reason.count,
      amount: fromCents(reason.amountCents),
    })),
  };
}

export function mapRentalDebtRowsForCompanyHealth(rentalDebtRows = []) {
  return (Array.isArray(rentalDebtRows) ? rentalDebtRows : []).map(row => ({
    receivableId: row?.rentalId,
    clientId: row?.clientId,
    canonicalReceivableAmount: row?.amount,
    confirmedAllocatedPayments: row?.paidAmount,
    confirmedCredits: 0,
    confirmedReversals: 0,
    expectedPaymentDate: row?.expectedPaymentDate,
    endDate: row?.endDate,
    status: row?.rentalStatus,
    statusSemantics: 'rental_lifecycle',
    // Neither rental.expectedPaymentDate nor rental.endDate is proven contractual.
    // Therefore no effectiveDueDate/dueDateSource is supplied to canonical aging.
  }));
}
