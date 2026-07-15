const AGING_CALCULATION_VERSION = 'receivables-aging-v1';

const ACCEPTED_DUE_DATE_PROVENANCES = new Set([
  'invoice_due_date',
  'contractual_payment_due_date',
  'installment_due_date',
  'migrated_verified',
]);

class CanonicalReceivablesAgingError extends Error {
  constructor(code, message, field) {
    super(message);
    this.name = 'CanonicalReceivablesAgingError';
    this.code = code;
    this.field = field;
  }
}

function fail(code, message, field) {
  throw new CanonicalReceivablesAgingError(code, message, field);
}

function isDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const monthLengths = [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthLengths[month - 1];
}

function validateDateOnly(value, field = 'asOfDate') {
  if (!isDateOnly(value)) {
    fail('INVALID_DATE', `${field} must be a valid YYYY-MM-DD civil date.`, field);
  }
  return value;
}

function isValidIanaTimezone(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function validateTimezone(value) {
  if (!isValidIanaTimezone(value)) {
    fail('INVALID_COMPANY_TIMEZONE', 'The trusted company timezone is missing or invalid.', 'timezone');
  }
  return value;
}

// Proleptic Gregorian civil-day index. Aging never subtracts UTC timestamps.
function civilDayNumber(value) {
  validateDateOnly(value);
  let [year, month, day] = value.split('-').map(Number);
  year -= month <= 2 ? 1 : 0;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const shiftedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4)
    - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra;
}

function civilDateInTimezone(instant, timezone) {
  validateTimezone(timezone);
  const parsed = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(parsed.getTime())) {
    fail('INVALID_TIMESTAMP', 'A canonical effective timestamp is invalid.');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function resolveAsOfDate({ asOfDate, timezone, now = new Date() } = {}) {
  validateTimezone(timezone);
  if (asOfDate !== undefined && asOfDate !== null && asOfDate !== '') {
    return validateDateOnly(asOfDate, 'asOfDate');
  }
  return civilDateInTimezone(now, timezone);
}

function isEffectiveByAsOf(instant, timezone, asOfDate) {
  if (!instant) return false;
  return civilDayNumber(civilDateInTimezone(instant, timezone)) <= civilDayNumber(asOfDate);
}

function overdueDays(asOfDate, contractualDueDate) {
  return civilDayNumber(asOfDate) - civilDayNumber(contractualDueDate);
}

function bucketForOverdueDays(days) {
  if (!Number.isSafeInteger(days)) fail('INVALID_OVERDUE_DAYS', 'overdueDays must be a safe integer.');
  if (days <= 0) return 'current';
  if (days <= 30) return 'days1to30';
  if (days <= 60) return 'days31to60';
  if (days <= 90) return 'days61to90';
  return 'over90';
}

function classifyReceivable(view, asOfDate) {
  const amount = view?.outstandingBalanceMinor;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    fail('MINOR_UNIT_OVERFLOW', 'Receivable outstanding is not a non-negative safe integer.');
  }
  if (amount === 0) return { classification: 'settled', overdueDays: null };

  if (view.status === 'disputed') return { classification: 'disputed', overdueDays: null };
  if (view.status === 'draft') {
    return { classification: 'otherExcluded', overdueDays: null, reason: 'draft' };
  }
  if (view.status === 'cancelled' || view.status === 'written_off') {
    return {
      classification: 'otherExcluded',
      overdueDays: null,
      reason: `positive_${view.status}_balance`,
      integrityError: true,
    };
  }
  if (view.status !== 'posted') {
    return {
      classification: 'otherExcluded',
      overdueDays: null,
      reason: 'invalid_workflow_status',
      integrityError: true,
    };
  }
  if (!isDateOnly(view.contractualDueDate)) {
    return { classification: 'ambiguous', overdueDays: null, reason: 'missing_or_invalid_due_date' };
  }
  if (!ACCEPTED_DUE_DATE_PROVENANCES.has(view.dueDateProvenance)) {
    return { classification: 'ambiguous', overdueDays: null, reason: 'unapproved_due_date_provenance' };
  }
  if (!isValidIanaTimezone(view.companyTimezone)) {
    return { classification: 'ambiguous', overdueDays: null, reason: 'missing_or_invalid_timezone' };
  }
  const days = overdueDays(asOfDate, view.contractualDueDate);
  return { classification: bucketForOverdueDays(days), overdueDays: days };
}

function safeAdd(left, right, field) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    fail('MINOR_UNIT_OVERFLOW', `${field} exceeds the safe integer range.`, field);
  }
  return result;
}

function createCanonicalAgingAccumulator(metadata = {}, options = {}) {
  const asOfDate = validateDateOnly(metadata.asOfDate, 'asOfDate');
  const timezone = validateTimezone(metadata.timezone);
  if (metadata.currency !== 'RUB') {
    fail('UNSUPPORTED_CURRENCY', 'The canonical receivables read API supports RUB only.', 'currency');
  }
  const result = {
    asOfDate,
    timezone,
    currency: 'RUB',
    companyId: metadata.companyId,
    branchScope: metadata.branchScope,
    calculationVersion: AGING_CALCULATION_VERSION,
    totalOutstandingMinor: 0,
    eligibleOutstandingMinor: 0,
    currentMinor: 0,
    overdueMinor: 0,
    buckets: {
      days1to30Minor: 0,
      days31to60Minor: 0,
      days61to90Minor: 0,
      over90Minor: 0,
    },
    ambiguousAmountMinor: 0,
    disputedAmountMinor: 0,
    otherExcludedAmountMinor: 0,
    writtenOffAmountMinor: 0,
    counts: {
      current: 0,
      days1to30: 0,
      days31to60: 0,
      days61to90: 0,
      over90: 0,
      ambiguous: 0,
      disputed: 0,
      otherExcluded: 0,
    },
    excludedReasons: [],
    integrityErrorCount: 0,
    reconciled: false,
  };
  const reasons = new Map();
  const seenIds = new Set();
  const seenSources = new Set();
  let finished = false;

  function add(view) {
    if (finished) fail('AGING_ACCUMULATOR_FINISHED', 'Canonical aging accumulation is already complete.');
    const sourceIdentity = JSON.stringify([
      view.companyId,
      view.sourceSystem,
      view.sourceDocumentType,
      view.sourceDocumentId,
      view.normalizedSourceLineId || view.sourceLineId || '__document_total__',
    ]);
    if (seenIds.has(view.id) || seenSources.has(sourceIdentity)) {
      fail('CANONICAL_IDENTITY_INTEGRITY_ERROR', 'Duplicate canonical receivable identity detected.');
    }
    seenIds.add(view.id);
    seenSources.add(sourceIdentity);

    result.writtenOffAmountMinor = safeAdd(
      result.writtenOffAmountMinor,
      view.confirmedWriteOffMinor || 0,
      'writtenOffAmountMinor',
    );
    const classification = classifyReceivable(view, asOfDate);
    if (classification.classification === 'settled') return;

    const amount = view.outstandingBalanceMinor;
    result.totalOutstandingMinor = safeAdd(result.totalOutstandingMinor, amount, 'totalOutstandingMinor');
    if (classification.classification === 'current') {
      result.currentMinor = safeAdd(result.currentMinor, amount, 'currentMinor');
      result.counts.current += 1;
    } else if (['days1to30', 'days31to60', 'days61to90', 'over90'].includes(classification.classification)) {
      const field = `${classification.classification}Minor`;
      result.buckets[field] = safeAdd(result.buckets[field], amount, field);
      result.counts[classification.classification] += 1;
    } else if (classification.classification === 'ambiguous') {
      result.ambiguousAmountMinor = safeAdd(result.ambiguousAmountMinor, amount, 'ambiguousAmountMinor');
      result.counts.ambiguous += 1;
    } else if (classification.classification === 'disputed') {
      result.disputedAmountMinor = safeAdd(result.disputedAmountMinor, amount, 'disputedAmountMinor');
      result.counts.disputed += 1;
    } else {
      result.otherExcludedAmountMinor = safeAdd(result.otherExcludedAmountMinor, amount, 'otherExcludedAmountMinor');
      result.counts.otherExcluded += 1;
    }
    if (classification.reason) {
      const previous = reasons.get(classification.reason) || { reason: classification.reason, amountMinor: 0, count: 0 };
      previous.amountMinor = safeAdd(previous.amountMinor, amount, 'excludedReasonAmountMinor');
      previous.count += 1;
      reasons.set(classification.reason, previous);
    }
    if (classification.integrityError) result.integrityErrorCount += 1;
  }

  function addMany(views = []) {
    for (const view of views) add(view);
  }

  function finish() {
    if (finished) fail('AGING_ACCUMULATOR_FINISHED', 'Canonical aging accumulation is already complete.');
    finished = true;
    result.overdueMinor = safeAdd(
      safeAdd(result.buckets.days1to30Minor, result.buckets.days31to60Minor, 'overdueMinor'),
      safeAdd(result.buckets.days61to90Minor, result.buckets.over90Minor, 'overdueMinor'),
      'overdueMinor',
    );
    result.eligibleOutstandingMinor = safeAdd(result.currentMinor, result.overdueMinor, 'eligibleOutstandingMinor');
    result.excludedReasons = [...reasons.values()].sort((left, right) => left.reason.localeCompare(right.reason));

    const reconciledOutstanding = safeAdd(
      safeAdd(result.currentMinor, result.overdueMinor, 'reconciliation'),
      safeAdd(
        safeAdd(result.ambiguousAmountMinor, result.disputedAmountMinor, 'reconciliation'),
        result.otherExcludedAmountMinor,
        'reconciliation',
      ),
      'reconciliation',
    );
    const reconciled = !options.forceReconciliationFailure
      && result.totalOutstandingMinor === reconciledOutstanding
      && result.eligibleOutstandingMinor === result.currentMinor + result.overdueMinor
      && result.overdueMinor === Object.values(result.buckets).reduce(
        (sum, amount) => safeAdd(sum, amount, 'overdueReconciliation'),
        0,
      );
    if (!reconciled) {
      fail('RECEIVABLES_RECONCILIATION_FAILED', 'Canonical receivables aging did not reconcile exactly.');
    }
    result.reconciled = true;
    return result;
  }

  return Object.freeze({ add, addMany, finish });
}

function buildCanonicalAging(views, metadata = {}, options = {}) {
  const accumulator = createCanonicalAgingAccumulator(metadata, options);
  accumulator.addMany(views);
  return accumulator.finish();
}

module.exports = {
  ACCEPTED_DUE_DATE_PROVENANCES,
  AGING_CALCULATION_VERSION,
  CanonicalReceivablesAgingError,
  bucketForOverdueDays,
  buildCanonicalAging,
  civilDateInTimezone,
  civilDayNumber,
  classifyReceivable,
  createCanonicalAgingAccumulator,
  isDateOnly,
  isEffectiveByAsOf,
  isValidIanaTimezone,
  overdueDays,
  resolveAsOfDate,
  validateDateOnly,
  validateTimezone,
};
