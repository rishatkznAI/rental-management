import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCanonicalDebtAging,
  calendarOverdueDays,
  debtAgingBucketForDays,
  mapRentalDebtRowsForCompanyHealth,
} from '../src/app/lib/companyHealthDebtAging.js';

const AS_OF_DATE = '2026-07-13';
const OPTIONS = {
  sourceAvailable: true,
  asOfDate: AS_OF_DATE,
  companyTimeZone: 'Europe/Moscow',
};

function dateDaysBefore(days) {
  const date = new Date(`${AS_OF_DATE}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function receivable(id, overdueDays, overrides = {}) {
  return {
    receivableId: id,
    clientId: `client-${id}`,
    canonicalReceivableAmount: 100,
    confirmedAllocatedPayments: 0,
    confirmedCredits: 0,
    confirmedReversals: 0,
    effectiveDueDate: dateDaysBefore(overdueDays),
    dueDateSource: 'invoice_due_date',
    status: 'open',
    statusSemantics: 'receivable_lifecycle',
    ...overrides,
  };
}

test('canonical aging assigns every boundary to exactly one non-overlapping bucket', () => {
  const boundaries = [
    [0, 'current'],
    [1, 'bucket1to30'],
    [30, 'bucket1to30'],
    [31, 'bucket31to60'],
    [60, 'bucket31to60'],
    [61, 'bucket61to90'],
    [90, 'bucket61to90'],
    [91, 'bucketOver90'],
  ];
  const result = buildCanonicalDebtAging(
    boundaries.map(([days], index) => receivable(`R-${index}`, days)),
    OPTIONS,
  );

  assert.equal(result.eligibleReceivableCount, boundaries.length);
  assert.equal(new Set(result.eligibleReceivables.map(row => row.receivableId)).size, boundaries.length);
  for (const [days, bucket] of boundaries) {
    assert.equal(debtAgingBucketForDays(days)?.key, bucket);
    assert.equal(result.eligibleReceivables.find(row => row.overdueDays === days)?.bucket, bucket);
  }
  const assignedIds = result.buckets.flatMap(bucket => bucket.receivableIds);
  assert.equal(assignedIds.length, new Set(assignedIds).size);
  assert.equal(result.currentCount, 1);
  assert.equal(result.bucket1to30Count, 2);
  assert.equal(result.bucket31to60Count, 2);
  assert.equal(result.bucket61to90Count, 2);
  assert.equal(result.bucketOver90Count, 1);
});

test('canonical aging reconciles eligible totals and excludes current debt from overdue', () => {
  const result = buildCanonicalDebtAging([
    receivable('current', 0, { canonicalReceivableAmount: 10 }),
    receivable('1-30', 12, { canonicalReceivableAmount: 20 }),
    receivable('31-60', 45, { canonicalReceivableAmount: 30 }),
    receivable('61-90', 75, { canonicalReceivableAmount: 40 }),
    receivable('over90', 120, { canonicalReceivableAmount: 50 }),
  ], OPTIONS);

  assert.equal(result.totalOutstandingAmount, 150);
  assert.equal(result.overdueOutstandingAmount, 140);
  assert.equal(
    result.currentAmount
      + result.bucket1to30Amount
      + result.bucket31to60Amount
      + result.bucket61to90Amount
      + result.bucketOver90Amount,
    result.totalOutstandingAmount,
  );
  assert.equal(
    result.bucket1to30Amount
      + result.bucket31to60Amount
      + result.bucket61to90Amount
      + result.bucketOver90Amount,
    result.overdueOutstandingAmount,
  );
});

test('paid, zero, negative, and overpaid receivables do not enter aging', () => {
  const result = buildCanonicalDebtAging([
    receivable('paid', 10, { canonicalReceivableAmount: 100, confirmedAllocatedPayments: 100 }),
    receivable('zero', 10, { canonicalReceivableAmount: 0 }),
    receivable('negative', 10, { canonicalReceivableAmount: -100 }),
    receivable('overpaid', 10, { canonicalReceivableAmount: 100, confirmedAllocatedPayments: 140 }),
  ], OPTIONS);

  assert.equal(result.eligibleReceivableCount, 0);
  assert.equal(result.totalOutstandingAmount, 0);
  assert.equal(result.overdueOutstandingAmount, 0);
});

test('proven terminal receivable statuses are excluded while rental closed status is not invented as settlement', () => {
  const result = buildCanonicalDebtAging([
    receivable('cancelled', 10, { status: 'cancelled' }),
    receivable('deleted', 10, { status: 'deleted' }),
    receivable('closed-receivable', 10, { status: 'closed' }),
    receivable('closed-rental', 10, { status: 'closed', statusSemantics: 'rental_lifecycle' }),
  ], OPTIONS);

  assert.equal(result.excludedStatusCount, 3);
  assert.equal(result.excludedStatusAmount, 300);
  assert.equal(result.eligibleReceivableCount, 1);
  assert.equal(result.overdueOutstandingAmount, 100);
});

test('partial confirmed payment reduces only the remaining balance and pending payment does not', () => {
  const result = buildCanonicalDebtAging([
    receivable('partial', 10, {
      canonicalReceivableAmount: 100,
      confirmedAllocatedPayments: 40,
      pendingPayments: 60,
    }),
  ], OPTIONS);

  assert.equal(result.totalOutstandingAmount, 60);
  assert.equal(result.overdueOutstandingAmount, 60);
  assert.equal(result.eligibleReceivables[0].outstandingBalance, 60);
});

test('credits and reversals follow the documented outstanding-balance formula', () => {
  const result = buildCanonicalDebtAging([
    receivable('formula', 10, {
      canonicalReceivableAmount: 100,
      confirmedAllocatedPayments: 30,
      confirmedCredits: 20,
      confirmedReversals: 5,
    }),
  ], OPTIONS);

  assert.equal(result.totalOutstandingAmount, 55);
});

test('ambiguous due dates and rental end dates are excluded from numeric aging', () => {
  const mapped = mapRentalDebtRowsForCompanyHealth([
    {
      rentalId: 'GR-1',
      clientId: 'C-1',
      amount: 100,
      paidAmount: 0,
      expectedPaymentDate: dateDaysBefore(10),
      endDate: dateDaysBefore(30),
      rentalStatus: 'active',
    },
  ]);
  const result = buildCanonicalDebtAging(mapped, OPTIONS);

  assert.equal(result.eligibleReceivableCount, 0);
  assert.equal(result.excludedAmbiguousCount, 1);
  assert.equal(result.excludedAmbiguousAmount, 100);
  assert.equal(result.ambiguousReceivables[0].agingEligible, false);
  assert.equal(result.ambiguousReceivables[0].reason, 'Не подтверждена договорная дата платежа');
  assert.equal(result.debtAgingReliable, false);
});

test('company-timezone normalization handles a midnight boundary as calendar days', () => {
  const result = buildCanonicalDebtAging([
    {
      ...receivable('timezone', 0),
      effectiveDueDate: '2026-07-12',
    },
  ], {
    sourceAvailable: true,
    asOfInstant: '2026-07-12T21:30:00.000Z',
    companyTimeZone: 'Europe/Moscow',
  });

  assert.equal(result.asOfDate, '2026-07-13');
  assert.equal(calendarOverdueDays('2026-07-12', result.asOfDate), 1);
  assert.equal(result.bucket1to30Count, 1);
});

test('missing company timezone makes otherwise dated debt ambiguous', () => {
  const result = buildCanonicalDebtAging([receivable('timezone-missing', 10)], {
    sourceAvailable: true,
    asOfDate: AS_OF_DATE,
  });

  assert.equal(result.debtAgingReliable, false);
  assert.equal(result.excludedAmbiguousCount, 1);
  assert.match(result.ambiguousReceivables[0].reason, /часовой пояс/);
});

test('the same receivable id is never counted twice and conflicting duplicates are excluded', () => {
  const identical = receivable('duplicate', 61, { canonicalReceivableAmount: 125 });
  const deduplicated = buildCanonicalDebtAging([identical, { ...identical }], OPTIONS);
  const conflicting = buildCanonicalDebtAging([
    identical,
    { ...identical, canonicalReceivableAmount: 150 },
  ], OPTIONS);

  assert.equal(deduplicated.totalOutstandingAmount, 125);
  assert.equal(deduplicated.bucket61to90Count, 1);
  assert.equal(deduplicated.duplicateReceivableCount, 1);
  assert.equal(conflicting.totalOutstandingAmount, 0);
  assert.equal(conflicting.conflictingDuplicateCount, 1);
  assert.equal(conflicting.excludedAmbiguousAmount, 150);
});

test('60+ debt is not repeated and over-90 is a genuine 91+ bucket', () => {
  const result = buildCanonicalDebtAging([
    receivable('day-60', 60),
    receivable('day-61', 61),
    receivable('day-90', 90),
    receivable('day-91', 91),
  ], OPTIONS);

  assert.equal(result.bucket31to60Amount, 100);
  assert.equal(result.bucket61to90Amount, 200);
  assert.equal(result.bucketOver90Amount, 100);
  assert.equal(result.overdueOutstandingAmount, 400);
});

test('currency-safe cent rounding keeps bucket and total reconciliation stable', () => {
  const result = buildCanonicalDebtAging([
    receivable('round-a', 1, { canonicalReceivableAmount: 10.005, confirmedAllocatedPayments: 0.004 }),
    receivable('round-b', 31, { canonicalReceivableAmount: 20.335, confirmedAllocatedPayments: 0.005 }),
  ], OPTIONS);

  assert.equal(result.bucket1to30Amount, 10.01);
  assert.equal(result.bucket31to60Amount, 20.33);
  assert.equal(result.totalOutstandingAmount, 30.34);
  assert.equal(result.overdueOutstandingAmount, 30.34);
});
