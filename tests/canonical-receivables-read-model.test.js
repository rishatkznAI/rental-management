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
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  createCanonicalReceivablesReadRepository,
} = require('../server/lib/canonical-receivables-read-repository.js');
const {
  createCanonicalReceivablesReadService,
} = require('../server/lib/canonical-receivables-read-service.js');
const {
  createCanonicalSettlementRepository,
} = require('../server/lib/canonical-receivables-settlement-repository.js');

function service(db) {
  return createCanonicalReceivablesReadService({
    repository: createCanonicalReceivablesReadRepository(db),
    cursorSecret: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
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

test('summary streams refund and refund-reversal effects without double reducing unapplied cash', () => {
  const context = createCanonicalReadContext();
  try {
    insertPayment(context.db, { id: 'receipt-refund-chain', receivedAmountMinor: 10000 });
    insertPayment(context.db, {
      id: 'refund-chain',
      paymentKind: 'refund',
      receivedAmountMinor: 3000,
      refundAmountMinor: 3000,
      reversalOfPaymentId: 'receipt-refund-chain',
    });
    const read = service(context.db);
    assert.equal(read.summary({}, trustedScope()).unappliedPaymentMinor, 7000);

    insertPayment(context.db, {
      id: 'refund-chain-reversal',
      paymentKind: 'reversal',
      receivedAmountMinor: 3000,
      refundAmountMinor: 3000,
      reversalOfPaymentId: 'refund-chain',
    });
    assert.equal(read.summary({}, trustedScope()).unappliedPaymentMinor, 10000);
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

test('historical status excludes pre-posting debt and ignores pending cancellation requests', () => {
  const context = createCanonicalReadContext();
  try {
    insertReceivable(context.db, {
      id: 'rec-future-posting',
      createdAt: '2026-07-01T09:00:00.000Z',
      postedAt: '2026-07-20T09:00:00.000Z',
      updatedAt: '2026-07-20T09:00:00.000Z',
      originalAmountMinor: 10000,
    });
    insertReceivable(context.db, { id: 'rec-pending-cancellation', originalAmountMinor: 7000 });
    const settlement = createCanonicalSettlementRepository(context.db);
    settlement.requestCancellation({
      companyId: 'company-a',
      receivableId: 'rec-pending-cancellation',
      reason: 'awaiting a second approver',
      initiatedBy: 'user-requester',
      cancelledAt: '2026-07-10T09:00:00.000Z',
      correlationId: 'pending-cancellation-history',
      sourceSystem: 'test',
      approvalRequestId: 'approval-pending-cancellation-history',
    });

    const read = service(context.db);
    const beforePosting = read.detail(
      'rec-future-posting',
      { asOfDate: '2026-07-10' },
      trustedScope(),
    );
    assert.equal(beforePosting.status, 'draft');
    assert.equal(beforePosting.outstandingBalanceMinor, 0);
    assert.equal(beforePosting.agingStatus, 'settled');

    const pendingCancellation = read.detail(
      'rec-pending-cancellation',
      { asOfDate: '2026-07-11' },
      trustedScope(),
    );
    assert.equal(pendingCancellation.status, 'posted');
    assert.equal(pendingCancellation.outstandingBalanceMinor, 7000);

    settlement.approveCancellation({
      companyId: 'company-a',
      receivableId: 'rec-pending-cancellation',
      approvalRequestId: 'approval-pending-cancellation-history',
      approvedBy: 'user-approver',
      approverActorType: 'user',
      approvedAt: '2026-07-20T09:00:00.000Z',
      expectedReceivableVersion: 1,
      sourceSystem: 'test',
    });
    const beforeApproval = read.detail(
      'rec-pending-cancellation',
      { asOfDate: '2026-07-11' },
      trustedScope(),
    );
    assert.equal(beforeApproval.status, 'posted');
    assert.equal(beforeApproval.outstandingBalanceMinor, 7000);
    const afterApproval = read.detail(
      'rec-pending-cancellation',
      { asOfDate: '2026-07-21' },
      trustedScope(),
    );
    assert.equal(afterApproval.status, 'cancelled');
    assert.equal(afterApproval.outstandingBalanceMinor, 0);
    assert.equal(afterApproval.agingStatus, 'settled');
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

test('multiple due-date corrections form one deterministic historical chain', () => {
  const context = createCanonicalReadContext();
  try {
    insertReceivable(context.db, {
      id: 'rec-multi-history',
      contractualDueDate: '2026-09-01',
      dueDateProvenance: 'installment_due_date',
      updatedAt: '2026-07-20T10:00:00.000Z',
    });
    insertDueDateAudit(context.db, {
      id: 'audit-multi-1', receivableId: 'rec-multi-history',
      previousDueDate: '2026-07-01', previousProvenance: 'invoice_due_date',
      newDueDate: '2026-08-01', newProvenance: 'contractual_payment_due_date',
      occurredAt: '2026-07-10T10:00:00.000Z',
    });
    insertDueDateAudit(context.db, {
      id: 'audit-multi-2', receivableId: 'rec-multi-history',
      previousDueDate: '2026-08-01', previousProvenance: 'contractual_payment_due_date',
      newDueDate: '2026-09-01', newProvenance: 'installment_due_date',
      occurredAt: '2026-07-20T10:00:00.000Z',
    });
    const read = service(context.db);
    assert.equal(read.detail('rec-multi-history', { asOfDate: '2026-07-05' }, trustedScope()).contractualDueDate,
      '2026-07-01');
    assert.equal(read.detail('rec-multi-history', { asOfDate: '2026-07-15' }, trustedScope()).contractualDueDate,
      '2026-08-01');
    assert.equal(read.detail('rec-multi-history', { asOfDate: '2026-07-25' }, trustedScope()).contractualDueDate,
      '2026-09-01');
  } finally {
    context.close();
  }
});

test('malformed, duplicate, or conflicting due-date audit evidence fails without a financial response', () => {
  const context = createCanonicalReadContext();
  try {
    insertReceivable(context.db, {
      id: 'rec-malformed-audit', contractualDueDate: '2026-08-01',
    });
    insertDueDateAudit(context.db, {
      id: 'audit-malformed', receivableId: 'rec-malformed-audit',
      previousValueJson: '{}', newValueJson: '{}',
    });

    insertReceivable(context.db, {
      id: 'rec-conflicting-audit', contractualDueDate: '2026-09-01',
      dueDateProvenance: 'installment_due_date',
    });
    insertDueDateAudit(context.db, {
      id: 'audit-conflict-1', receivableId: 'rec-conflicting-audit',
      previousDueDate: '2026-07-01', newDueDate: '2026-08-01',
      occurredAt: '2026-07-10T10:00:00.000Z',
    });
    insertDueDateAudit(context.db, {
      id: 'audit-conflict-2', receivableId: 'rec-conflicting-audit',
      previousDueDate: '2026-07-15', newDueDate: '2026-09-01',
      newProvenance: 'installment_due_date', occurredAt: '2026-07-20T10:00:00.000Z',
    });

    insertReceivable(context.db, {
      id: 'rec-duplicate-audit', contractualDueDate: '2026-09-01',
      dueDateProvenance: 'installment_due_date',
    });
    insertDueDateAudit(context.db, {
      id: 'audit-duplicate-1', receivableId: 'rec-duplicate-audit',
      previousDueDate: '2026-07-01', newDueDate: '2026-08-01',
      occurredAt: '2026-07-10T10:00:00.000Z', correlationId: 'duplicate-correlation',
    });
    insertDueDateAudit(context.db, {
      id: 'audit-duplicate-2', receivableId: 'rec-duplicate-audit',
      previousDueDate: '2026-08-01', newDueDate: '2026-09-01',
      previousProvenance: 'contractual_payment_due_date', newProvenance: 'installment_due_date',
      occurredAt: '2026-07-20T10:00:00.000Z', correlationId: 'duplicate-correlation',
    });

    const read = service(context.db);
    for (const id of ['rec-malformed-audit', 'rec-conflicting-audit', 'rec-duplicate-audit']) {
      assert.throws(
        () => read.detail(id, { asOfDate: '2026-07-25' }, trustedScope()),
        error => error.code === 'CANONICAL_AUDIT_INTEGRITY_ERROR',
      );
    }
  } finally {
    context.close();
  }
});

test('summary and aging stream receivables and payments through bounded snapshot batches', () => {
  const context = createCanonicalReadContext();
  try {
    for (let index = 0; index < 205; index += 1) {
      const suffix = String(index).padStart(3, '0');
      insertReceivable(context.db, {
        id: `rec-aggregate-${suffix}`,
        originalAmountMinor: 100,
      });
      insertPayment(context.db, {
        id: `payment-aggregate-${suffix}`,
        receivedAmountMinor: 100,
      });
    }
    const base = createCanonicalReceivablesReadRepository(context.db);
    const calls = {
      receivables: 0,
      payments: 0,
      paymentAllocations: 0,
      paymentCompensations: 0,
    };
    const repository = {
      readSnapshot(callback) {
        return base.readSnapshot(reader => callback({
          ...reader,
          listReceivables(scope, options) {
            assert.ok(options.limit <= 200);
            calls.receivables += 1;
            return reader.listReceivables(scope, options);
          },
          listPayments(scope, options) {
            assert.ok(options.limit <= 200);
            calls.payments += 1;
            return reader.listPayments(scope, options);
          },
          listPaymentAllocations(scope, options) {
            assert.ok(options.limit <= 200);
            calls.paymentAllocations += 1;
            return reader.listPaymentAllocations(scope, options);
          },
          listPaymentCompensations(scope, options) {
            assert.ok(options.limit <= 200);
            calls.paymentCompensations += 1;
            return reader.listPaymentCompensations(scope, options);
          },
        }));
      },
    };
    const read = createCanonicalReceivablesReadService({
      repository,
      cursorSecret: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      now: () => new Date('2026-07-15T12:00:00.000Z'),
    });
    const summary = read.summary({}, trustedScope());
    const aging = read.aging({}, trustedScope());
    assert.equal(summary.receivableCount, 205);
    assert.equal(summary.totalOutstandingMinor, 20500);
    assert.equal(summary.unappliedPaymentMinor, 20500);
    assert.equal(aging.totalOutstandingMinor, 20500);
    assert.ok(calls.receivables >= 4);
    assert.ok(calls.payments >= 2);
    assert.ok(calls.paymentAllocations >= 1);
    assert.ok(calls.paymentCompensations >= 1);
  } finally {
    context.close();
  }
});

test('read repository keeps later queries on the same SQLite snapshot during a concurrent WAL write', () => {
  const context = createCanonicalReadContext();
  let writer;
  try {
    context.db.pragma('journal_mode = WAL');
    insertReceivable(context.db, { id: 'rec-snapshot', originalAmountMinor: 10000 });
    writer = new Database(context.dbPath);
    writer.pragma('foreign_keys = ON');
    const repository = createCanonicalReceivablesReadRepository(context.db);
    let allocationCountInsideSnapshot;
    repository.readSnapshot(reader => {
      assert.equal(reader.listReceivables(trustedScope()).length, 1);
      insertPayment(writer, { id: 'payment-concurrent', receivedAmountMinor: 1000 });
      insertAllocation(writer, {
        id: 'allocation-concurrent',
        paymentId: 'payment-concurrent',
        receivableId: 'rec-snapshot',
        allocatedAmountMinor: 1000,
      });
      allocationCountInsideSnapshot = reader.listAllocations(trustedScope()).length;
    });
    assert.equal(allocationCountInsideSnapshot, 0);
    const allocationCountAfterSnapshot = repository.readSnapshot(
      reader => reader.listAllocations(trustedScope()).length,
    );
    assert.equal(allocationCountAfterSnapshot, 1);
  } finally {
    writer?.close();
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
