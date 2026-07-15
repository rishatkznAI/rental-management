import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  AGING_CALCULATION_VERSION,
  buildCanonicalAging,
  civilDateInTimezone,
  classifyReceivable,
  overdueDays,
  resolveAsOfDate,
} = require('../server/lib/canonical-receivables-aging.js');

function view(id, overrides = {}) {
  return {
    id,
    companyId: 'company-a',
    branchId: 'branch-a1',
    sourceSystem: 'test',
    sourceDocumentType: 'invoice',
    sourceDocumentId: `invoice-${id}`,
    normalizedSourceLineId: 'line-1',
    status: 'posted',
    outstandingBalanceMinor: 100,
    confirmedWriteOffMinor: 0,
    contractualDueDate: '2026-07-15',
    dueDateProvenance: 'invoice_due_date',
    companyTimezone: 'Europe/Moscow',
    ...overrides,
  };
}

function aging(rows, overrides = {}, options) {
  return buildCanonicalAging(rows, {
    asOfDate: '2026-07-15',
    timezone: 'Europe/Moscow',
    currency: 'RUB',
    companyId: 'company-a',
    branchScope: 'all_authorized',
    ...overrides,
  }, options);
}

test('aging uses exact civil-day boundaries for today, future, and 1/30/31/60/61/90/91 days', () => {
  const rows = [
    view('today', { contractualDueDate: '2026-07-15' }),
    view('future', { contractualDueDate: '2026-07-16' }),
    view('d1', { contractualDueDate: '2026-07-14' }),
    view('d30', { contractualDueDate: '2026-06-15' }),
    view('d31', { contractualDueDate: '2026-06-14' }),
    view('d60', { contractualDueDate: '2026-05-16' }),
    view('d61', { contractualDueDate: '2026-05-15' }),
    view('d90', { contractualDueDate: '2026-04-16' }),
    view('d91', { contractualDueDate: '2026-04-15' }),
  ];
  assert.deepEqual(rows.map(row => classifyReceivable(row, '2026-07-15').classification), [
    'current', 'current', 'days1to30', 'days1to30', 'days31to60',
    'days31to60', 'days61to90', 'days61to90', 'over90',
  ]);
  assert.deepEqual(rows.map(row => overdueDays('2026-07-15', row.contractualDueDate)), [
    0, -1, 1, 30, 31, 60, 61, 90, 91,
  ]);
  const result = aging(rows);
  assert.equal(result.calculationVersion, AGING_CALCULATION_VERSION);
  assert.equal(result.currentMinor, 200);
  assert.deepEqual(result.buckets, {
    days1to30Minor: 200,
    days31to60Minor: 200,
    days61to90Minor: 200,
    over90Minor: 100,
  });
  assert.equal(result.overdueMinor, 700);
  assert.equal(result.totalOutstandingMinor, 900);
  assert.equal(result.reconciled, true);
});

test('aging classification honors accepted provenance, ambiguity, dispute, draft, and integrity precedence', () => {
  const provenances = [
    'invoice_due_date',
    'contractual_payment_due_date',
    'installment_due_date',
    'migrated_verified',
  ];
  const rows = provenances.map((provenance, index) => view(`accepted-${index}`, {
    dueDateProvenance: provenance,
  }));
  rows.push(
    view('missing-date', { contractualDueDate: null }),
    view('unknown-date', { dueDateProvenance: 'unknown' }),
    view('invalid-timezone', { companyTimezone: 'Not/AZone' }),
    view('disputed', { status: 'disputed', contractualDueDate: null, companyTimezone: '' }),
    view('draft', { status: 'draft' }),
    view('cancelled-positive', { status: 'cancelled' }),
    view('written-off-positive', { status: 'written_off', confirmedWriteOffMinor: 50 }),
    view('paid', { outstandingBalanceMinor: 0 }),
  );
  const result = aging(rows);
  assert.equal(result.currentMinor, 400);
  assert.equal(result.ambiguousAmountMinor, 300);
  assert.equal(result.counts.ambiguous, 3);
  assert.equal(result.disputedAmountMinor, 100);
  assert.equal(result.counts.disputed, 1);
  assert.equal(result.otherExcludedAmountMinor, 300);
  assert.equal(result.counts.otherExcluded, 3);
  assert.equal(result.integrityErrorCount, 2);
  assert.equal(result.writtenOffAmountMinor, 50);
  assert.deepEqual(result.excludedReasons.map(item => item.reason), [
    'draft',
    'missing_or_invalid_due_date',
    'missing_or_invalid_timezone',
    'positive_cancelled_balance',
    'positive_written_off_balance',
    'unapproved_due_date_provenance',
  ]);
});

test('company-local date normalization is deterministic around UTC boundaries and DST', () => {
  assert.equal(civilDateInTimezone('2026-07-14T21:30:00.000Z', 'Europe/Moscow'), '2026-07-15');
  assert.equal(civilDateInTimezone('2026-07-15T01:00:00.000Z', 'America/New_York'), '2026-07-14');
  assert.equal(civilDateInTimezone('2026-03-08T04:30:00.000Z', 'America/New_York'), '2026-03-07');
  assert.equal(civilDateInTimezone('2026-03-08T07:30:00.000Z', 'America/New_York'), '2026-03-08');
  assert.equal(resolveAsOfDate({
    timezone: 'Europe/Moscow',
    now: new Date('2026-07-14T21:30:00.000Z'),
  }), '2026-07-15');
  assert.equal(overdueDays('2026-03-09', '2026-03-08'), 1);
});

test('aging detects duplicate identity, invalid timezone/date, safe-integer overflow, and reconciliation failure', () => {
  assert.throws(() => aging([
    view('one'),
    view('two', { sourceDocumentId: 'invoice-one' }),
  ]), error => error.code === 'CANONICAL_IDENTITY_INTEGRITY_ERROR');
  assert.throws(() => aging([view('overflow-a', { outstandingBalanceMinor: Number.MAX_SAFE_INTEGER }), view('overflow-b')]),
    error => error.code === 'MINOR_UNIT_OVERFLOW');
  assert.throws(() => aging([view('forced')], {}, { forceReconciliationFailure: true }),
    error => error.code === 'RECEIVABLES_RECONCILIATION_FAILED');
  assert.throws(() => aging([], { timezone: 'Invalid/Timezone' }),
    error => error.code === 'INVALID_COMPANY_TIMEZONE');
  assert.throws(() => aging([], { asOfDate: '2026-02-30' }),
    error => error.code === 'INVALID_DATE');
});

test('empty ledger and positive mixed ledger satisfy all three exact reconciliation equations', () => {
  const empty = aging([]);
  assert.equal(empty.totalOutstandingMinor, 0);
  assert.equal(empty.eligibleOutstandingMinor, 0);
  assert.equal(empty.overdueMinor, 0);
  assert.equal(empty.reconciled, true);

  const mixed = aging([
    view('current', { outstandingBalanceMinor: 101 }),
    view('overdue', { outstandingBalanceMinor: 202, contractualDueDate: '2026-07-01' }),
    view('ambiguous', { outstandingBalanceMinor: 303, dueDateProvenance: 'unknown' }),
    view('disputed', { outstandingBalanceMinor: 404, status: 'disputed' }),
    view('excluded', { outstandingBalanceMinor: 505, status: 'draft' }),
  ]);
  assert.equal(mixed.totalOutstandingMinor,
    mixed.currentMinor + mixed.overdueMinor + mixed.ambiguousAmountMinor
      + mixed.disputedAmountMinor + mixed.otherExcludedAmountMinor);
  assert.equal(mixed.eligibleOutstandingMinor, mixed.currentMinor + mixed.overdueMinor);
  assert.equal(mixed.overdueMinor,
    mixed.buckets.days1to30Minor + mixed.buckets.days31to60Minor
      + mixed.buckets.days61to90Minor + mixed.buckets.over90Minor);
});
