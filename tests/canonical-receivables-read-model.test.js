import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  createCanonicalReadContext,
  insertAdjustment,
  insertAllocation,
  insertDueDateAudit,
  insertPayment,
  insertReceivable,
  trustedScope,
} from './canonical-receivables-read-fixtures.js';

const require = createRequire(import.meta.url);
const {
  createCanonicalReceivablesReadRepository,
} = require('../server/lib/canonical-receivables-read-repository.js');
const {
  createCanonicalReceivablesReadService,
} = require('../server/lib/canonical-receivables-read-service.js');

function service(db) {
  return createCanonicalReceivablesReadService({
    repository: createCanonicalReceivablesReadRepository(db),
    cursorSecret: 'test-canonical-cursor-secret',
    now: () => new Date('2026-07-15T12:00:00.000Z'),
  });
}

test('read model projects partial and multiple payments without floating point or negative debt', () => {
  const context = createCanonicalReadContext();
  try {
    insertReceivable(context.db, { id: 'rec-one', originalAmountMinor: 10000 });
    insertPayment(context.db, { id: 'pay-one', receivedAmountMinor: 3000 });
    insertPayment(context.db, { id: 'pay-two', receivedAmountMinor: 2000 });
    insertPayment(context.db, { id: 'pay-over', receivedAmountMinor: 9000 });
    insertAllocation(context.db, {
      id: 'alloc-one', paymentId: 'pay-one', receivableId: 'rec-one', allocatedAmountMinor: 3000,
    });
    insertAllocation(context.db, {
      id: 'alloc-two', paymentId: 'pay-two', receivableId: 'rec-one', allocatedAmountMinor: 2000,
    });

    const read = service(context.db);
    const detail = read.detail('rec-one', { asOfDate: '2026-07-15' }, trustedScope());
    assert.equal(detail.confirmedAllocatedMinor, 5000);
    assert.equal(detail.outstandingBalanceMinor, 5000);
    assert.equal(detail.balanceStatus, 'partially_paid');
    assert.deepEqual(detail.canonicalLinks.paymentAllocationIds, ['alloc-one', 'alloc-two']);

    const summary = read.summary({ asOfDate: '2026-07-15' }, trustedScope());
    assert.equal(summary.confirmedAllocatedMinor, 5000);
    assert.equal(summary.totalOutstandingMinor, 5000);
    assert.equal(summary.unappliedPaymentMinor, 9000);
    assert.equal(summary.reconciled, true);
  } finally {
    context.close();
  }
});

test('one payment can settle several receivables and allocation reversal restores only its target', () => {
  const context = createCanonicalReadContext();
  try {
    insertReceivable(context.db, { id: 'rec-a', originalAmountMinor: 8000 });
    insertReceivable(context.db, { id: 'rec-b', originalAmountMinor: 7000 });
    insertPayment(context.db, { id: 'pay-shared', receivedAmountMinor: 10000 });
    insertAllocation(context.db, {
      id: 'alloc-a', paymentId: 'pay-shared', receivableId: 'rec-a', allocatedAmountMinor: 6000,
    });
    insertAllocation(context.db, {
      id: 'alloc-b', paymentId: 'pay-shared', receivableId: 'rec-b', allocatedAmountMinor: 4000,
    });
    insertAllocation(context.db, {
      id: 'reverse-a', paymentId: 'pay-shared', receivableId: 'rec-a', allocatedAmountMinor: 6000,
      allocationKind: 'reversal', reversalAllocationId: 'alloc-a',
    });
    const read = service(context.db);
    assert.equal(read.detail('rec-a', {}, trustedScope()).outstandingBalanceMinor, 8000);
    assert.equal(read.detail('rec-b', {}, trustedScope()).outstandingBalanceMinor, 3000);
    assert.equal(read.summary({}, trustedScope()).unappliedPaymentMinor, 6000);
  } finally {
    context.close();
  }
});

test('confirmed debit, credit, adjustment reversal, and partial/full write-off use PR2 balance semantics', () => {
  const context = createCanonicalReadContext();
  try {
    insertReceivable(context.db, { id: 'rec-adjust', originalAmountMinor: 10000 });
    insertAdjustment(context.db, {
      id: 'debit', receivableId: 'rec-adjust', adjustmentType: 'debit', balanceEffect: 'increase', amountMinor: 2000,
    });
    insertAdjustment(context.db, {
      id: 'credit', receivableId: 'rec-adjust', adjustmentType: 'credit', balanceEffect: 'decrease', amountMinor: 1000,
    });
    insertAdjustment(context.db, {
      id: 'credit-reversal', receivableId: 'rec-adjust', adjustmentType: 'reversal',
      balanceEffect: 'increase', amountMinor: 1000, reversesAdjustmentId: 'credit',
    });
    insertAdjustment(context.db, {
      id: 'partial-writeoff', receivableId: 'rec-adjust', adjustmentType: 'write_off',
      balanceEffect: 'decrease', amountMinor: 3000,
    });
    const detail = service(context.db).detail('rec-adjust', {}, trustedScope());
    assert.equal(detail.confirmedDebitAdjustmentsMinor, 3000);
    assert.equal(detail.confirmedCreditAdjustmentsMinor, 1000);
    assert.equal(detail.confirmedWriteOffMinor, 3000);
    assert.equal(detail.outstandingBalanceMinor, 9000);

    insertAdjustment(context.db, {
      id: 'full-writeoff', receivableId: 'rec-adjust', adjustmentType: 'write_off',
      balanceEffect: 'decrease', amountMinor: 9000,
    });
    const settled = service(context.db).detail('rec-adjust', {}, trustedScope());
    assert.equal(settled.outstandingBalanceMinor, 0);
    assert.equal(settled.balanceStatus, 'paid');
    assert.equal(settled.agingStatus, 'settled');
  } finally {
    context.close();
  }
});

test('pending and rejected settlement events have no financial effect', () => {
  const context = createCanonicalReadContext();
  try {
    insertReceivable(context.db, { id: 'rec-pending', originalAmountMinor: 10000 });
    insertPayment(context.db, { id: 'pay-pending', receivedAmountMinor: 10000 });
    insertAllocation(context.db, {
      id: 'alloc-pending', paymentId: 'pay-pending', receivableId: 'rec-pending',
      allocatedAmountMinor: 5000, allocationStatus: 'pending',
    });
    insertAdjustment(context.db, {
      id: 'adjust-pending', receivableId: 'rec-pending', adjustmentType: 'credit',
      balanceEffect: 'decrease', amountMinor: 2000, workflowStatus: 'pending', approvalStatus: 'pending',
    });
    insertAdjustment(context.db, {
      id: 'adjust-rejected', receivableId: 'rec-pending', adjustmentType: 'debit',
      balanceEffect: 'increase', amountMinor: 3000, workflowStatus: 'rejected', approvalStatus: 'rejected',
    });
    const detail = service(context.db).detail('rec-pending', {}, trustedScope());
    assert.equal(detail.confirmedAllocatedMinor, 0);
    assert.equal(detail.confirmedDebitAdjustmentsMinor, 0);
    assert.equal(detail.confirmedCreditAdjustmentsMinor, 0);
    assert.equal(detail.outstandingBalanceMinor, 10000);
  } finally {
    context.close();
  }
});

test('historical as-of uses the due date valid before and after append-only correction evidence', () => {
  const context = createCanonicalReadContext();
  try {
    insertReceivable(context.db, {
      id: 'rec-history', contractualDueDate: '2026-08-01',
      dueDateProvenance: 'contractual_payment_due_date', updatedAt: '2026-07-15T10:00:00.000Z',
    });
    insertDueDateAudit(context.db, {
      receivableId: 'rec-history', previousDueDate: '2026-07-01', newDueDate: '2026-08-01',
      occurredAt: '2026-07-15T10:00:00.000Z',
    });
    const read = service(context.db);
    const before = read.detail('rec-history', { asOfDate: '2026-07-10' }, trustedScope());
    assert.equal(before.contractualDueDate, '2026-07-01');
    assert.equal(before.dueDateProvenance, 'invoice_due_date');
    assert.equal(before.overdueDays, 9);
    assert.equal(before.agingStatus, 'overdue');

    const after = read.detail('rec-history', { asOfDate: '2026-07-20' }, trustedScope());
    assert.equal(after.contractualDueDate, '2026-08-01');
    assert.equal(after.dueDateProvenance, 'contractual_payment_due_date');
    assert.equal(after.overdueDays, -12);
    assert.equal(after.agingStatus, 'current');
  } finally {
    context.close();
  }
});

test('projection fails on unsafe integer overflow instead of returning partial financial data', () => {
  const context = createCanonicalReadContext();
  try {
    insertReceivable(context.db, { id: 'rec-overflow', originalAmountMinor: Number.MAX_SAFE_INTEGER });
    insertAdjustment(context.db, {
      id: 'overflow-debit', receivableId: 'rec-overflow', adjustmentType: 'debit',
      balanceEffect: 'increase', amountMinor: 1,
    });
    assert.throws(() => service(context.db).summary({}, trustedScope()),
      error => error.code === 'MINOR_UNIT_OVERFLOW');
  } finally {
    context.close();
  }
});
