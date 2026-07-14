import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  ensureCanonicalReceivablesSchema,
} = require('../server/lib/canonical-receivables-schema.js');
const {
  ensureCanonicalReceivablesSettlementSchema,
} = require('../server/lib/canonical-receivables-settlement-schema.js');
const settlementRepositoryModule = require('../server/lib/canonical-receivables-settlement-repository.js');
const {
  CanonicalSettlementRepositoryError,
  createCanonicalSettlementRepository,
} = settlementRepositoryModule;

const T0 = '2026-07-14T09:00:00.000Z';
const T1 = '2026-07-14T10:00:00.000Z';
const T2 = '2026-07-14T11:00:00.000Z';
const T3 = '2026-07-14T12:00:00.000Z';
const T4 = '2026-07-14T13:00:00.000Z';
const serverPackagePath = fileURLToPath(new URL('../server/package.json', import.meta.url));
const settlementRepositoryPath = fileURLToPath(
  new URL('../server/lib/canonical-receivables-settlement-repository.js', import.meta.url),
);

async function runConcurrentRepositoryCalls(dbPath, calls) {
  const source = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { createRequire } = require('node:module');
    const serverRequire = createRequire(workerData.serverPackagePath);
    const Database = serverRequire('better-sqlite3');
    const { createCanonicalSettlementRepository } = require(workerData.repositoryPath);
    parentPort.postMessage({ ready: true });
    parentPort.once('message', ({ method, input }) => {
      const db = new Database(workerData.dbPath);
      db.pragma('foreign_keys = ON');
      db.pragma('busy_timeout = 1000');
      try {
        const repository = createCanonicalSettlementRepository(db);
        const value = repository[method](input);
        parentPort.postMessage({ status: 'success', id: value?.id || null });
      } catch (error) {
        parentPort.postMessage({
          status: 'error',
          code: error?.code || null,
          message: String(error?.message || error),
        });
      } finally {
        db.close();
      }
    });
  `;
  const workers = calls.map(() => new Worker(source, {
    eval: true,
    workerData: { dbPath, serverPackagePath, repositoryPath: settlementRepositoryPath },
  }));
  try {
    await Promise.all(workers.map(worker => once(worker, 'message')));
    const results = workers.map((worker, index) => {
      const result = once(worker, 'message').then(([message]) => message);
      worker.postMessage(calls[index]);
      return result;
    });
    return await Promise.all(results);
  } finally {
    await Promise.all(workers.map(worker => worker.terminate()));
  }
}

function assertOneConcurrentWinner(results, allowedLoserCodes) {
  assert.equal(results.filter(result => result.status === 'success').length, 1, JSON.stringify(results));
  const loser = results.find(result => result.status === 'error');
  assert.ok(loser, JSON.stringify(results));
  assert.ok(
    allowedLoserCodes.includes(loser.code) || allowedLoserCodes.some(code => loser.message.includes(code)),
    JSON.stringify(results),
  );
}

function makeContext() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-receivables-pr2-repository-'));
  const dbPath = path.join(dir, 'app.sqlite');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 25');
  ensureCanonicalReceivablesSchema(db);
  ensureCanonicalReceivablesSettlementSchema(db);
  db.exec(`
    INSERT INTO canonical_companies (id, receivablesTimezone) VALUES
      ('company-1', 'Europe/Moscow'),
      ('company-2', 'Europe/Moscow');
    INSERT INTO canonical_branches (companyId, id, isHeadOffice) VALUES
      ('company-1', 'branch-1', 1),
      ('company-1', 'branch-1b', 0),
      ('company-2', 'branch-2', 1);
  `);
  return { db, dbPath, dir, repository: createCanonicalSettlementRepository(db) };
}

function closeContext(context) {
  context.db.close();
  fs.rmSync(context.dir, { recursive: true, force: true });
}

function insertReceivable(db, overrides = {}) {
  const row = {
    id: 'receivable-1',
    companyId: 'company-1',
    branchId: 'branch-1',
    clientId: 'client-1',
    sourceDocumentType: 'invoice',
    sourceDocumentId: 'invoice-1',
    sourceSystem: 'test',
    idempotencyKey: 'receivable-key-1',
    currency: 'RUB',
    originalAmountMinor: 10000,
    postedAt: T0,
    contractualDueDate: '2026-07-31',
    dueDateProvenance: 'invoice_due_date',
    companyTimezone: 'Europe/Moscow',
    workflowStatus: 'posted',
    createdAt: T0,
    updatedAt: T0,
    version: 1,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_receivables (
      id, companyId, branchId, clientId, sourceDocumentType, sourceDocumentId,
      sourceSystem, idempotencyKey, currency, originalAmountMinor, postedAt,
      contractualDueDate, dueDateProvenance, companyTimezone, workflowStatus,
      createdAt, updatedAt, version
    ) VALUES (
      @id, @companyId, @branchId, @clientId, @sourceDocumentType, @sourceDocumentId,
      @sourceSystem, @idempotencyKey, @currency, @originalAmountMinor, @postedAt,
      @contractualDueDate, @dueDateProvenance, @companyTimezone, @workflowStatus,
      @createdAt, @updatedAt, @version
    )
  `).run(row);
  return row;
}

function paymentInput(overrides = {}) {
  return {
    id: 'payment-1',
    companyId: 'company-1',
    branchId: 'branch-1',
    clientId: 'client-1',
    externalId: null,
    idempotencyKey: 'payment-key-1',
    currency: 'RUB',
    paymentKind: 'receipt',
    receivedAmountMinor: 10000,
    receivedAt: T1,
    workflowStatus: 'confirmed',
    sourceSystem: 'test',
    sourceDocumentType: 'bank_statement',
    sourceDocumentId: 'bank-line-1',
    internalTransfer: false,
    correlationId: 'payment-correlation-1',
    createdAt: T1,
    updatedAt: T1,
    version: 1,
    ...overrides,
  };
}

function allocationInput(overrides = {}) {
  return {
    id: 'allocation-1',
    companyId: 'company-1',
    paymentId: 'payment-1',
    receivableId: 'receivable-1',
    allocatedAmountMinor: 1000,
    allocationReason: 'exact invoice match',
    matchingEvidenceType: 'exact_document_reference',
    matchingEvidenceReference: 'invoice-1',
    initiatedBy: 'user-1',
    initiatedAt: T2,
    idempotencyKey: 'allocation-key-1',
    correlationId: 'allocation-correlation-1',
    createdAt: T2,
    expectedPaymentVersion: 1,
    expectedReceivableVersion: 1,
    policyContext: {
      verifyMatchingEvidence: evidence => (
        ['exact_document_reference', 'explicit_client_instruction'].includes(evidence.evidenceType)
        && Boolean(evidence.reference)
      ),
    },
    ...overrides,
  };
}

function approvalInput(overrides = {}) {
  return {
    approvedBy: 'user-2',
    approverActorType: 'user',
    approvedAt: T3,
    ...overrides,
  };
}

function adjustmentInput(overrides = {}) {
  return {
    id: 'adjustment-1',
    companyId: 'company-1',
    receivableId: 'receivable-1',
    adjustmentType: 'credit',
    balanceEffect: 'decrease',
    amountMinor: 1000,
    reason: 'approved credit note',
    supportingDocumentReference: null,
    sourceDocumentType: 'credit_note',
    sourceDocumentId: 'credit-note-1',
    initiatedBy: 'user-1',
    initiatedAt: T2,
    approvalRequestId: 'approval-adjustment-1',
    idempotencyKey: 'adjustment-key-1',
    correlationId: 'adjustment-correlation-1',
    effectiveAt: T3,
    createdAt: T2,
    sourceSystem: 'test',
    ...overrides,
  };
}

function auditTypes(db) {
  return db.prepare('SELECT eventType FROM financial_audit_events ORDER BY eventType').all().map(row => row.eventType);
}

test('repository surface is company-scoped and canonical receipt creation is idempotent', () => {
  const context = makeContext();
  try {
    const { repository } = context;
    assert.deepEqual(Object.keys(settlementRepositoryModule).sort(), [
      'CanonicalSettlementRepositoryError',
      'createCanonicalSettlementRepository',
    ]);
    assert.deepEqual(Object.keys(repository).sort(), [
      'approveAdjustment',
      'approveAllocation',
      'approveCancellation',
      'approveDueDateChange',
      'approveRefund',
      'approveWriteOff',
      'calculatePaymentUnapplied',
      'calculateReceivableOutstanding',
      'createCanonicalPayment',
      'getAdjustment',
      'getAllocation',
      'getApprovalRequest',
      'getPayment',
      'rejectAdjustment',
      'rejectAllocation',
      'requestAdjustment',
      'requestAllocation',
      'requestCancellation',
      'requestDueDateChange',
      'requestRefund',
      'requestWriteOff',
      'reverseAdjustment',
      'reverseAllocation',
      'reverseRefund',
    ]);
    assert.throws(() => repository.getPayment({ id: 'payment-1' }), /companyId is required/);
    const created = repository.createCanonicalPayment(paymentInput());
    assert.equal(created.receivedAmountMinor, 10000);
    assert.equal(repository.createCanonicalPayment(paymentInput()).id, created.id);
    assert.throws(
      () => repository.createCanonicalPayment(paymentInput({ id: 'payment-other' })),
      error => error instanceof CanonicalSettlementRepositoryError && error.code === 'DUPLICATE_IDEMPOTENCY_KEY',
    );
    assert.throws(
      () => repository.createCanonicalPayment(paymentInput({ clientId: 'client-other' })),
      error => error.code === 'DUPLICATE_IDEMPOTENCY_KEY',
    );
    repository.createCanonicalPayment(paymentInput({
      id: 'company-2-payment',
      companyId: 'company-2',
      branchId: 'branch-2',
      clientId: 'client-2',
      sourceDocumentId: 'company-2-bank-line',
      correlationId: 'company-2-correlation',
    }));
    assert.equal(repository.getPayment({ companyId: 'company-2', id: 'payment-1' }), null);
    assert.ok(auditTypes(context.db).includes('payment_recorded'));
  } finally {
    closeContext(context);
  }
});

test('partial, many-to-one, and one-to-many ordinary allocations update exact derived balances', () => {
  const context = makeContext();
  try {
    const { db, repository } = context;
    insertReceivable(db, { id: 'receivable-1', originalAmountMinor: 6000 });
    insertReceivable(db, {
      id: 'receivable-2', sourceDocumentId: 'invoice-2', idempotencyKey: 'receivable-key-2', originalAmountMinor: 4000,
    });
    repository.createCanonicalPayment(paymentInput({ receivedAmountMinor: 10000 }));
    const first = repository.requestAllocation(allocationInput({ allocatedAmountMinor: 3000 }));
    assert.equal(first.approvalStatus, 'not_required');
    assert.equal(repository.calculatePaymentUnapplied({ companyId: 'company-1', paymentId: 'payment-1' }), 7000);
    assert.equal(repository.calculateReceivableOutstanding({ companyId: 'company-1', receivableId: 'receivable-1' }), 3000);
    const second = repository.requestAllocation(allocationInput({
      id: 'allocation-2',
      receivableId: 'receivable-2',
      allocatedAmountMinor: 4000,
      matchingEvidenceReference: 'invoice-2',
      idempotencyKey: 'allocation-key-2',
      correlationId: 'allocation-correlation-2',
      expectedPaymentVersion: 2,
      expectedReceivableVersion: 1,
    }));
    assert.equal(second.allocationStatus, 'confirmed');
    repository.createCanonicalPayment(paymentInput({
      id: 'payment-2',
      idempotencyKey: 'payment-key-2',
      externalId: 'payment-external-2',
      sourceDocumentId: 'bank-line-2',
      receivedAmountMinor: 3000,
      correlationId: 'payment-correlation-2',
    }));
    repository.requestAllocation(allocationInput({
      id: 'allocation-3',
      paymentId: 'payment-2',
      allocatedAmountMinor: 3000,
      idempotencyKey: 'allocation-key-3',
      correlationId: 'allocation-correlation-3',
      expectedPaymentVersion: 1,
      expectedReceivableVersion: 2,
    }));
    assert.equal(repository.calculateReceivableOutstanding({ companyId: 'company-1', receivableId: 'receivable-1' }), 0);
    assert.equal(repository.calculatePaymentUnapplied({ companyId: 'company-1', paymentId: 'payment-1' }), 3000);
    assert.equal(repository.calculatePaymentUnapplied({ companyId: 'company-1', paymentId: 'payment-2' }), 0);
    assert.equal(repository.requestAllocation(allocationInput({ allocatedAmountMinor: 3000 })).id, first.id);
    assert.throws(() => repository.requestAllocation(allocationInput({
      allocatedAmountMinor: 3000,
      allocationReason: 'conflicting retry payload',
    })), error => error.code === 'DUPLICATE_IDEMPOTENCY_KEY');
    assert.throws(() => repository.requestAllocation(allocationInput({
      id: 'allocation-over',
      receivableId: 'receivable-2',
      allocatedAmountMinor: 1,
      matchingEvidenceReference: 'invoice-2',
      idempotencyKey: 'allocation-over',
      correlationId: 'allocation-over',
      expectedPaymentVersion: 3,
      expectedReceivableVersion: 2,
    })), error => error.code === 'RECEIVABLE_ALREADY_SETTLED');
  } finally {
    closeContext(context);
  }
});

test('ambiguous and cross-branch allocations remain pending until a distinct user approves; rejection has no balance effect', () => {
  const context = makeContext();
  try {
    const { db, repository } = context;
    insertReceivable(db, { branchId: 'branch-1b' });
    repository.createCanonicalPayment(paymentInput());
    const pending = repository.requestAllocation(allocationInput({
      allocatedAmountMinor: 3000,
      approvalRequestId: 'approval-allocation-1',
    }));
    assert.equal(pending.allocationStatus, 'pending');
    assert.equal(pending.approvalStatus, 'pending');
    assert.equal(repository.calculatePaymentUnapplied({ companyId: 'company-1', paymentId: 'payment-1' }), 10000);
    assert.throws(() => repository.approveAllocation({
      companyId: 'company-1',
      allocationId: pending.id,
      ...approvalInput({ approvedBy: 'user-1' }),
      expectedPaymentVersion: 1,
      expectedReceivableVersion: 1,
    }), error => error.code === 'SELF_APPROVAL_FORBIDDEN');
    const approved = repository.approveAllocation({
      companyId: 'company-1',
      allocationId: pending.id,
      ...approvalInput(),
      expectedPaymentVersion: 1,
      expectedReceivableVersion: 1,
    });
    assert.equal(approved.allocationStatus, 'confirmed');
    assert.equal(approved.approvedBy, 'user-2');
    assert.equal(repository.calculateReceivableOutstanding({ companyId: 'company-1', receivableId: 'receivable-1' }), 7000);

    insertReceivable(db, {
      id: 'receivable-2',
      branchId: 'branch-1',
      sourceDocumentId: 'invoice-2',
      idempotencyKey: 'receivable-key-2',
    });
    const ambiguous = repository.requestAllocation(allocationInput({
      id: 'allocation-2',
      receivableId: 'receivable-2',
      allocatedAmountMinor: 1000,
      allocationReason: 'manual matching needs confirmation',
      matchingEvidenceType: 'manual_ambiguous',
      matchingEvidenceReference: null,
      approvalRequestId: 'approval-allocation-2',
      idempotencyKey: 'allocation-key-2',
      correlationId: 'allocation-correlation-2',
      expectedPaymentVersion: 2,
      expectedReceivableVersion: 1,
    }));
    assert.equal(ambiguous.approvalStatus, 'pending');
    const rejectionInput = {
      companyId: 'company-1',
      allocationId: ambiguous.id,
      rejectedBy: 'user-2',
      rejectedAt: T4,
      rejectionReason: 'matching evidence is insufficient',
    };
    const rejected = repository.rejectAllocation(rejectionInput);
    assert.equal(rejected.allocationStatus, 'rejected');
    assert.equal(repository.rejectAllocation(rejectionInput).id, rejected.id);
    assert.throws(() => repository.rejectAllocation({
      ...rejectionInput,
      rejectedBy: 'user-3',
    }), error => error.code === 'APPROVAL_ALREADY_FINAL');
    assert.equal(auditTypes(db).filter(type => type === 'allocation_rejected').length, 1);
    assert.equal(repository.calculateReceivableOutstanding({ companyId: 'company-1', receivableId: 'receivable-2' }), 10000);
    assert.ok(auditTypes(db).includes('allocation_rejected'));
  } finally {
    closeContext(context);
  }
});

test('immutable approval and operation snapshots reject changed evidence, amounts, types, and write-off support', () => {
  const context = makeContext();
  try {
    const { db, repository } = context;
    insertReceivable(db, { branchId: 'branch-1b' });
    repository.createCanonicalPayment(paymentInput());
    const allocation = repository.requestAllocation(allocationInput({
      allocatedAmountMinor: 3000,
      approvalRequestId: 'approval-binding-allocation',
      correlationId: 'binding-allocation',
      idempotencyKey: 'binding-allocation',
    }));
    assert.throws(() => db.prepare(`
      UPDATE canonical_approval_requests
      SET operationPayloadJson = '{}'
      WHERE companyId = 'company-1' AND id = 'approval-binding-allocation'
    `).run(), /identity and payload are immutable/);
    assert.throws(() => db.prepare(`
      UPDATE canonical_payment_allocations
      SET approvalStatus = 'not_required', approvalRequestId = NULL
      WHERE companyId = 'company-1' AND id = ?
    `).run(allocation.id), /required allocation approval cannot be removed|identity and financial payload are immutable/);
    assert.throws(() => db.prepare(`
      UPDATE canonical_payment_allocations
      SET allocatedAmountMinor = 2500,
          matchingEvidenceType = 'explicit_client_instruction',
          matchingEvidenceReference = 'changed-after-request'
      WHERE companyId = 'company-1' AND id = ?
    `).run(allocation.id), /identity and financial payload are immutable/);
    assert.equal(repository.getApprovalRequest({
      companyId: 'company-1', id: 'approval-binding-allocation',
    }).status, 'pending');
    assert.equal(repository.getAllocation({ companyId: 'company-1', id: allocation.id }).allocationStatus, 'pending');

    const adjustment = repository.requestAdjustment(adjustmentInput({
      approvalRequestId: 'approval-binding-adjustment',
      idempotencyKey: 'binding-adjustment',
      correlationId: 'binding-adjustment',
    }));
    assert.throws(() => db.prepare(`
      UPDATE canonical_receivable_adjustments
      SET adjustmentType = 'discount'
      WHERE companyId = 'company-1' AND id = ?
    `).run(adjustment.id), /identity and financial payload are immutable/);
    assert.equal(repository.getApprovalRequest({
      companyId: 'company-1', id: 'approval-binding-adjustment',
    }).status, 'pending');

    const writeOff = repository.requestWriteOff(adjustmentInput({
      id: 'write-off-binding', adjustmentType: 'write_off', amountMinor: 500,
      reason: 'documented write-off', supportingDocumentReference: 'write-off-document',
      sourceDocumentType: null, sourceDocumentId: null,
      approvalRequestId: 'approval-binding-write-off',
      idempotencyKey: 'binding-write-off', correlationId: 'binding-write-off',
    }));
    assert.throws(() => db.prepare(`
      UPDATE canonical_receivable_adjustments
      SET supportingDocumentReference = NULL
      WHERE companyId = 'company-1' AND id = ?
    `).run(writeOff.id), /identity and financial payload are immutable|CHECK constraint failed/);
  } finally {
    closeContext(context);
  }
});

test('credit, debit, discount, penalty, write-off, pending/rejected adjustment, and reversal effects are exact', () => {
  const context = makeContext();
  try {
    const { db, repository } = context;
    insertReceivable(db);
    let expectedVersion = 1;
    const approve = (request, approvedAt = T3) => {
      const pending = repository.requestAdjustment(request);
      assert.equal(pending.workflowStatus, 'pending');
      const confirmed = repository.approveAdjustment({
        companyId: 'company-1',
        adjustmentId: pending.id,
        ...approvalInput({ approvedAt }),
        expectedReceivableVersion: expectedVersion,
      });
      expectedVersion += 1;
      return confirmed;
    };
    const credit = approve(adjustmentInput());
    assert.equal(repository.requestAdjustment(adjustmentInput()).id, credit.id);
    assert.equal(repository.approveAdjustment({
      companyId: 'company-1', adjustmentId: credit.id,
      ...approvalInput(), expectedReceivableVersion: 1,
    }).id, credit.id);
    assert.throws(() => repository.approveAdjustment({
      companyId: 'company-1', adjustmentId: credit.id,
      ...approvalInput({ approvedBy: 'user-3' }), expectedReceivableVersion: 1,
    }), error => error.code === 'APPROVAL_ALREADY_FINAL');
    approve(adjustmentInput({
      id: 'adjustment-debit', adjustmentType: 'debit', balanceEffect: 'increase', amountMinor: 500,
      sourceDocumentType: 'debit_note', sourceDocumentId: 'debit-note-1',
      approvalRequestId: 'approval-adjustment-debit', idempotencyKey: 'adjustment-key-debit',
      correlationId: 'adjustment-correlation-debit',
    }));
    approve(adjustmentInput({
      id: 'adjustment-discount', adjustmentType: 'discount', amountMinor: 200,
      sourceDocumentType: null, sourceDocumentId: null,
      approvalRequestId: 'approval-adjustment-discount', idempotencyKey: 'adjustment-key-discount',
      correlationId: 'adjustment-correlation-discount',
    }));
    approve(adjustmentInput({
      id: 'adjustment-penalty', adjustmentType: 'penalty', balanceEffect: 'increase', amountMinor: 100,
      sourceDocumentType: null, sourceDocumentId: null,
      approvalRequestId: 'approval-adjustment-penalty', idempotencyKey: 'adjustment-key-penalty',
      correlationId: 'adjustment-correlation-penalty',
    }));
    const writeOffInput = adjustmentInput({
      id: 'adjustment-write-off',
      amountMinor: 1000,
      reason: 'approved irrecoverable balance',
      supportingDocumentReference: 'write-off-act-1',
      sourceDocumentType: null,
      sourceDocumentId: null,
      approvalRequestId: 'approval-adjustment-write-off',
      idempotencyKey: 'adjustment-key-write-off',
      correlationId: 'adjustment-correlation-write-off',
    });
    const writeOff = repository.requestWriteOff(writeOffInput);
    assert.equal(repository.requestWriteOff(writeOffInput).id, writeOff.id);
    assert.equal(writeOff.workflowStatus, 'pending');
    assert.throws(() => repository.approveWriteOff({
      companyId: 'company-1', adjustmentId: writeOff.id,
      ...approvalInput({ approvedBy: 'user-1' }), expectedReceivableVersion: expectedVersion,
    }), error => error.code === 'SELF_APPROVAL_FORBIDDEN');
    repository.approveWriteOff({
      companyId: 'company-1', adjustmentId: writeOff.id,
      ...approvalInput(), expectedReceivableVersion: expectedVersion,
    });
    expectedVersion += 1;
    assert.equal(repository.calculateReceivableOutstanding({ companyId: 'company-1', receivableId: 'receivable-1' }), 8400);

    const rejectedPending = repository.requestAdjustment(adjustmentInput({
      id: 'adjustment-rejected', amountMinor: 500,
      approvalRequestId: 'approval-adjustment-rejected', idempotencyKey: 'adjustment-key-rejected',
      correlationId: 'adjustment-correlation-rejected', sourceDocumentId: 'credit-note-rejected',
    }));
    assert.equal(repository.calculateReceivableOutstanding({ companyId: 'company-1', receivableId: 'receivable-1' }), 8400);
    const rejectionInput = {
      companyId: 'company-1', adjustmentId: rejectedPending.id,
      rejectedBy: 'user-2', rejectedAt: T4, rejectionReason: 'document rejected', sourceSystem: 'test',
    };
    repository.rejectAdjustment(rejectionInput);
    assert.equal(repository.rejectAdjustment(rejectionInput).id, rejectedPending.id);
    assert.throws(() => repository.rejectAdjustment({
      ...rejectionInput,
      rejectionReason: 'different final reason',
    }), error => error.code === 'APPROVAL_ALREADY_FINAL');
    assert.equal(auditTypes(db).filter(type => type === 'adjustment_rejected').length, 1);
    assert.equal(repository.calculateReceivableOutstanding({ companyId: 'company-1', receivableId: 'receivable-1' }), 8400);

    const reversal = repository.reverseAdjustment(adjustmentInput({
      id: 'adjustment-credit-reversal',
      originalAdjustmentId: credit.id,
      reason: 'reverse credit note',
      sourceDocumentType: null,
      sourceDocumentId: null,
      approvalRequestId: 'approval-adjustment-credit-reversal',
      idempotencyKey: 'adjustment-key-credit-reversal',
      correlationId: 'adjustment-correlation-credit-reversal',
    }));
    assert.equal(reversal.workflowStatus, 'pending');
    repository.approveAdjustment({
      companyId: 'company-1', adjustmentId: reversal.id,
      ...approvalInput(), expectedReceivableVersion: expectedVersion,
    });
    assert.equal(repository.calculateReceivableOutstanding({ companyId: 'company-1', receivableId: 'receivable-1' }), 9400);
    assert.throws(() => repository.reverseAdjustment({
      companyId: 'company-1', originalAdjustmentId: reversal.id,
    }), error => error.code === 'ADJUSTMENT_NOT_REVERSIBLE');
    assert.throws(() => db.prepare(`
      INSERT INTO canonical_receivable_adjustments (
        id, companyId, branchId, receivableId, adjustmentType, balanceEffect,
        amountMinor, workflowStatus, reason, reversesAdjustmentId, initiatedBy,
        initiatedAt, approvalStatus, approvalRequestId, idempotencyKey,
        correlationId, effectiveAt, createdAt, version
      ) VALUES (
        'adjustment-reversal-chain', 'company-1', 'branch-1', 'receivable-1',
        'reversal', 'decrease', 1000, 'pending', 'invalid reversal chain', ?,
        'user-1', ?, 'pending', 'missing-approval', 'adjustment-reversal-chain',
        'adjustment-reversal-chain', ?, ?, 1
      )
    `).run(reversal.id, T4, T4, T4), /eligible confirmed original/);
    assert.equal(repository.reverseAdjustment(adjustmentInput({
      id: 'adjustment-credit-reversal',
      originalAdjustmentId: credit.id,
      reason: 'reverse credit note',
      sourceDocumentType: null,
      sourceDocumentId: null,
      approvalRequestId: 'approval-adjustment-credit-reversal',
      idempotencyKey: 'adjustment-key-credit-reversal',
      correlationId: 'adjustment-correlation-credit-reversal',
    })).id, reversal.id);
    assert.ok(auditTypes(db).includes('write_off_approved'));
    assert.ok(auditTypes(db).includes('adjustment_reversed'));
  } finally {
    closeContext(context);
  }
});

test('allocation reversal is append-only, approval-gated, idempotent, and restores both balances', () => {
  const context = makeContext();
  try {
    const { db, repository } = context;
    insertReceivable(db, { originalAmountMinor: 5000 });
    repository.createCanonicalPayment(paymentInput({ receivedAmountMinor: 5000 }));
    const original = repository.requestAllocation(allocationInput({ allocatedAmountMinor: 4000 }));
    const reversal = repository.reverseAllocation(allocationInput({
      id: 'allocation-reversal-1',
      originalAllocationId: original.id,
      allocationReason: 'approved correction',
      approvalRequestId: 'approval-allocation-reversal-1',
      idempotencyKey: 'allocation-reversal-key-1',
      correlationId: 'allocation-reversal-correlation-1',
      expectedPaymentVersion: 2,
      expectedReceivableVersion: 2,
    }));
    assert.equal(reversal.allocationStatus, 'pending');
    assert.equal(repository.calculatePaymentUnapplied({ companyId: 'company-1', paymentId: 'payment-1' }), 1000);
    assert.throws(() => db.prepare(`
      INSERT INTO canonical_payment_allocations (
        id, companyId, paymentId, receivableId, paymentBranchId, receivableBranchId,
        allocatedAmountMinor, allocationKind, allocationStatus, allocationReason,
        matchingEvidenceType, initiatedBy, initiatedAt, approvalStatus,
        approvalRequestId, reversalAllocationId, idempotencyKey, correlationId,
        createdAt, version
      ) VALUES (
        'allocation-reversal-chain', 'company-1', 'payment-1', 'receivable-1',
        'branch-1', 'branch-1', 4000, 'reversal', 'pending', 'invalid reversal chain',
        'manual_ambiguous', 'user-1', ?, 'pending', 'missing-approval', ?,
        'allocation-reversal-chain', 'allocation-reversal-chain', ?, 1
      )
    `).run(T3, reversal.id, T3), /eligible confirmed original/);
    repository.approveAllocation({
      companyId: 'company-1', allocationId: reversal.id,
      ...approvalInput(), expectedPaymentVersion: 2, expectedReceivableVersion: 2,
    });
    assert.equal(repository.calculatePaymentUnapplied({ companyId: 'company-1', paymentId: 'payment-1' }), 5000);
    assert.equal(repository.calculateReceivableOutstanding({ companyId: 'company-1', receivableId: 'receivable-1' }), 5000);
    assert.equal(repository.getAllocation({ companyId: 'company-1', id: original.id }).allocationStatus, 'confirmed');
    assert.throws(() => repository.reverseAllocation({
      companyId: 'company-1', originalAllocationId: reversal.id,
    }), error => error.code === 'ALLOCATION_NOT_REVERSIBLE');
    assert.equal(repository.reverseAllocation(allocationInput({
      id: 'allocation-reversal-1',
      originalAllocationId: original.id,
      allocationReason: 'approved correction',
      approvalRequestId: 'approval-allocation-reversal-1',
      idempotencyKey: 'allocation-reversal-key-1',
      correlationId: 'allocation-reversal-correlation-1',
    })).id, reversal.id);
    assert.throws(() => repository.reverseAllocation(allocationInput({
      id: 'allocation-reversal-2',
      originalAllocationId: original.id,
      allocationReason: 'duplicate reversal',
      approvalRequestId: 'approval-allocation-reversal-2',
      idempotencyKey: 'allocation-reversal-key-2',
      correlationId: 'allocation-reversal-correlation-2',
    })), error => error.code === 'ALLOCATION_ALREADY_REVERSED');
    assert.ok(auditTypes(db).includes('allocation_reversed'));
  } finally {
    closeContext(context);
  }
});

test('refunds require approval, cannot consume allocated cash, and explicit refund reversal restores capacity', () => {
  const context = makeContext();
  try {
    const { db, repository } = context;
    insertReceivable(db);
    repository.createCanonicalPayment(paymentInput());
    repository.requestAllocation(allocationInput({ allocatedAmountMinor: 4000 }));
    assert.throws(() => repository.requestRefund({
      id: 'refund-over', companyId: 'company-1', reversalOfPaymentId: 'payment-1', refundAmountMinor: 7000,
      reason: 'too large', initiatedBy: 'user-1', initiatedAt: T2,
      approvalRequestId: 'approval-refund-over', idempotencyKey: 'refund-over', correlationId: 'refund-over',
      receivedAt: T2, sourceSystem: 'test', createdAt: T2,
    }), error => error.code === 'REFUND_AMOUNT_EXCEEDS_AVAILABLE');
    const refundInput = {
      id: 'refund-1', companyId: 'company-1', reversalOfPaymentId: 'payment-1', refundAmountMinor: 2000,
      reason: 'client refund', initiatedBy: 'user-1', initiatedAt: T2,
      approvalRequestId: 'approval-refund-1', idempotencyKey: 'refund-key-1', correlationId: 'refund-correlation-1',
      receivedAt: T2, sourceSystem: 'test', createdAt: T2,
    };
    const refund = repository.requestRefund(refundInput);
    assert.equal(repository.requestRefund(refundInput).id, refund.id);
    assert.equal(refund.workflowStatus, 'pending');
    assert.equal(refund.receivedAmountMinor, 2000);
    assert.equal(refund.refundAmountMinor, 2000);
    assert.throws(() => db.prepare(`
      UPDATE canonical_payments
      SET refundAmountMinor = 1000, receivedAmountMinor = 1000
      WHERE companyId = 'company-1' AND id = ?
    `).run(refund.id), /identity and financial payload are immutable/);
    assert.throws(() => repository.requestRefund({
      id: 'refund-1', companyId: 'company-1', reversalOfPaymentId: 'payment-1', refundAmountMinor: 2000,
      reason: 'conflicting refund retry', initiatedBy: 'user-1', initiatedAt: T2,
      approvalRequestId: 'approval-refund-1', idempotencyKey: 'refund-key-1',
      correlationId: 'refund-correlation-1', receivedAt: T2, sourceSystem: 'test', createdAt: T2,
    }), error => error.code === 'DUPLICATE_IDEMPOTENCY_KEY');
    assert.equal(repository.calculatePaymentUnapplied({ companyId: 'company-1', paymentId: 'payment-1' }), 6000);
    assert.throws(() => repository.approveRefund({
      companyId: 'company-1', refundPaymentId: refund.id,
      ...approvalInput({ approvedBy: 'user-1' }), expectedPaymentVersion: 2,
    }), error => error.code === 'SELF_APPROVAL_FORBIDDEN');
    const refundApprovalInput = {
      companyId: 'company-1', refundPaymentId: refund.id,
      ...approvalInput(), expectedPaymentVersion: 2,
    };
    repository.approveRefund(refundApprovalInput);
    assert.equal(repository.approveRefund(refundApprovalInput).id, refund.id);
    assert.throws(() => repository.approveRefund({
      ...refundApprovalInput,
      approvedBy: 'user-3',
    }), error => error.code === 'APPROVAL_ALREADY_FINAL');
    assert.equal(repository.calculatePaymentUnapplied({ companyId: 'company-1', paymentId: 'payment-1' }), 4000);
    const refundReversalInput = {
      id: 'refund-reversal-1', companyId: 'company-1', refundPaymentId: refund.id,
      reason: 'refund was rejected by bank', initiatedBy: 'user-1', initiatedAt: T3,
      approvalRequestId: 'approval-refund-reversal-1', idempotencyKey: 'refund-reversal-key-1',
      correlationId: 'refund-reversal-correlation-1', receivedAt: T3, sourceSystem: 'test', createdAt: T3,
    };
    const refundReversal = repository.reverseRefund(refundReversalInput);
    assert.equal(repository.reverseRefund(refundReversalInput).id, refundReversal.id);
    repository.approveRefund({
      companyId: 'company-1', refundPaymentId: refundReversal.id,
      ...approvalInput({ approvedAt: T4 }), expectedPaymentVersion: 3,
    });
    assert.equal(repository.calculatePaymentUnapplied({ companyId: 'company-1', paymentId: 'payment-1' }), 6000);
    assert.throws(() => db.prepare(`
      INSERT INTO canonical_payments (
        id, companyId, branchId, clientId, idempotencyKey, currency, paymentKind,
        receivedAmountMinor, refundAmountMinor, receivedAt, workflowStatus,
        sourceSystem, internalTransfer, reversalOfPaymentId, approvalRequestId,
        reason, correlationId, createdAt, updatedAt, version
      ) VALUES (
        'payment-reversal-chain', 'company-1', 'branch-1', 'client-1',
        'payment-reversal-chain', 'RUB', 'reversal', 2000, 2000, ?, 'pending',
        'test', 0, ?, 'missing-approval', 'invalid reversal chain',
        'payment-reversal-chain', ?, ?, 1
      )
    `).run(T4, refundReversal.id, T4, T4), /eligible confirmed original/);
    assert.throws(() => repository.reverseRefund({
      companyId: 'company-1', refundPaymentId: refundReversal.id,
    }), error => error.code === 'REFUND_NOT_REVERSIBLE');
    const secondRefund = repository.requestRefund({
      id: 'refund-2', companyId: 'company-1', reversalOfPaymentId: 'payment-1', refundAmountMinor: 6000,
      reason: 'replacement refund after explicit reversal', initiatedBy: 'user-1', initiatedAt: T4,
      approvalRequestId: 'approval-refund-2', idempotencyKey: 'refund-key-2', correlationId: 'refund-correlation-2',
      receivedAt: T4, sourceSystem: 'test', createdAt: T4,
    });
    repository.approveRefund({
      companyId: 'company-1', refundPaymentId: secondRefund.id,
      ...approvalInput({ approvedAt: '2026-07-14T14:00:00.000Z' }), expectedPaymentVersion: 4,
    });
    assert.equal(repository.calculatePaymentUnapplied({ companyId: 'company-1', paymentId: 'payment-1' }), 0);
    assert.equal(repository.getPayment({ companyId: 'company-1', id: 'payment-1' }).receivedAmountMinor, 10000);
    assert.ok(auditTypes(db).includes('refund_requested'));
    assert.ok(auditTypes(db).includes('refund_approved'));
    assert.ok(auditTypes(db).includes('refund_reversed'));
  } finally {
    closeContext(context);
  }
});

test('due-date changes preserve previous value and posted cancellation stays approval/compensation gated', () => {
  const context = makeContext();
  try {
    const { db, repository } = context;
    insertReceivable(db, { id: 'receivable-no-history' });
    assert.throws(() => db.prepare(`
      UPDATE canonical_receivables
      SET contractualDueDate = '2026-08-01', dueDateProvenance = 'contractual_payment_due_date'
      WHERE companyId = 'company-1' AND id = 'receivable-no-history'
    `).run(), /immutable audited operation/);
    const direct = repository.requestDueDateChange({
      companyId: 'company-1', receivableId: 'receivable-no-history', requestedDueDate: '2026-08-15',
      provenance: 'contractual_payment_due_date', reason: 'signed amendment', initiatedBy: 'user-1',
      effectiveAt: T2, correlationId: 'due-date-direct', sourceSystem: 'test', expectedReceivableVersion: 1,
    });
    assert.equal(direct.approvalRequired, false);
    assert.equal(direct.receivable.contractualDueDate, '2026-08-15');

    insertReceivable(db, {
      id: 'receivable-with-history', sourceDocumentId: 'invoice-history', idempotencyKey: 'receivable-history',
    });
    repository.createCanonicalPayment(paymentInput());
    repository.requestAllocation(allocationInput({
      receivableId: 'receivable-with-history', allocatedAmountMinor: 1000,
      matchingEvidenceReference: 'invoice-history',
    }));
    const pending = repository.requestDueDateChange({
      companyId: 'company-1', receivableId: 'receivable-with-history', requestedDueDate: '2026-08-20',
      provenance: 'contractual_payment_due_date', reason: 'post-allocation amendment', initiatedBy: 'user-1',
      effectiveAt: T3, correlationId: 'due-date-pending', sourceSystem: 'test',
      approvalRequestId: 'approval-due-date-1',
    });
    assert.equal(pending.approvalRequired, true);
    assert.equal(pending.receivable.contractualDueDate, '2026-07-31');
    const approved = repository.approveDueDateChange({
      companyId: 'company-1', receivableId: 'receivable-with-history', approvalRequestId: 'approval-due-date-1',
      ...approvalInput({ approvedAt: T4 }), expectedReceivableVersion: 2, sourceSystem: 'test',
    });
    assert.equal(approved.contractualDueDate, '2026-08-20');
    assert.equal(repository.approveDueDateChange({
      companyId: 'company-1', receivableId: 'receivable-with-history', approvalRequestId: 'approval-due-date-1',
      ...approvalInput({ approvedAt: T4 }), expectedReceivableVersion: 2, sourceSystem: 'test',
    }).contractualDueDate, '2026-08-20');
    assert.throws(() => repository.approveDueDateChange({
      companyId: 'company-1', receivableId: 'receivable-with-history', approvalRequestId: 'approval-due-date-1',
      ...approvalInput({ approvedBy: 'user-3', approvedAt: T4 }), expectedReceivableVersion: 2,
    }), error => error.code === 'APPROVAL_ALREADY_FINAL');
    assert.throws(() => repository.requestCancellation({
      companyId: 'company-1', receivableId: 'receivable-with-history', reason: 'cannot cancel directly',
      initiatedBy: 'user-1', cancelledAt: T4, correlationId: 'cancel-with-history', sourceSystem: 'test',
      approvalRequestId: 'approval-cancel-history',
    }), error => error.code === 'COMPENSATING_OPERATIONS_REQUIRED');
    const compensatedAllocation = repository.reverseAllocation({
      id: 'allocation-history-reversal', companyId: 'company-1', originalAllocationId: 'allocation-1',
      allocationReason: 'compensate before cancellation', initiatedBy: 'user-1', initiatedAt: T4,
      approvalRequestId: 'approval-allocation-history-reversal',
      idempotencyKey: 'allocation-history-reversal', correlationId: 'allocation-history-reversal',
      createdAt: T4,
    });
    repository.approveAllocation({
      companyId: 'company-1', allocationId: compensatedAllocation.id,
      ...approvalInput({ approvedAt: '2026-07-14T13:15:00.000Z' }),
      expectedPaymentVersion: 2, expectedReceivableVersion: 3,
    });
    const compensatedCancellation = repository.requestCancellation({
      companyId: 'company-1', receivableId: 'receivable-with-history',
      reason: 'source obligation voided after compensation', initiatedBy: 'user-1',
      cancelledAt: '2026-07-14T13:20:00.000Z', correlationId: 'cancel-after-compensation',
      sourceSystem: 'test', approvalRequestId: 'approval-cancel-after-compensation',
    });
    assert.equal(compensatedCancellation.approvalRequired, true);
    assert.equal(repository.approveCancellation({
      companyId: 'company-1', receivableId: 'receivable-with-history',
      approvalRequestId: 'approval-cancel-after-compensation',
      ...approvalInput({ approvedAt: '2026-07-14T13:30:00.000Z' }),
      expectedReceivableVersion: 4, sourceSystem: 'test',
    }).workflowStatus, 'cancelled');

    insertReceivable(db, {
      id: 'receivable-cancellable', sourceDocumentId: 'invoice-cancellable', idempotencyKey: 'receivable-cancellable',
    });
    assert.throws(() => db.prepare(`
      UPDATE canonical_receivables
      SET workflowStatus = 'cancelled', cancellationReason = 'direct bypass', cancelledAt = '${T3}'
      WHERE companyId = 'company-1' AND id = 'receivable-cancellable'
    `).run(), /immutable approved audited operation/);
    const cancellation = repository.requestCancellation({
      companyId: 'company-1', receivableId: 'receivable-cancellable', reason: 'source obligation voided',
      initiatedBy: 'user-1', cancelledAt: T3, correlationId: 'cancel-pending', sourceSystem: 'test',
      approvalRequestId: 'approval-cancel-1',
    });
    assert.equal(cancellation.approvalRequired, true);
    assert.equal(cancellation.receivable.workflowStatus, 'posted');
    const cancelled = repository.approveCancellation({
      companyId: 'company-1', receivableId: 'receivable-cancellable', approvalRequestId: 'approval-cancel-1',
      ...approvalInput({ approvedAt: T4 }), expectedReceivableVersion: 1, sourceSystem: 'test',
    });
    assert.equal(cancelled.workflowStatus, 'cancelled');
    assert.equal(repository.approveCancellation({
      companyId: 'company-1', receivableId: 'receivable-cancellable', approvalRequestId: 'approval-cancel-1',
      ...approvalInput({ approvedAt: T4 }), expectedReceivableVersion: 1, sourceSystem: 'test',
    }).workflowStatus, 'cancelled');
    assert.throws(() => repository.approveCancellation({
      companyId: 'company-1', receivableId: 'receivable-cancellable', approvalRequestId: 'approval-cancel-1',
      ...approvalInput({ approvedBy: 'user-3', approvedAt: T4 }), expectedReceivableVersion: 1,
    }), error => error.code === 'APPROVAL_ALREADY_FINAL');

    insertReceivable(db, {
      id: 'receivable-cancellation-race',
      sourceDocumentId: 'invoice-cancellation-race',
      idempotencyKey: 'receivable-cancellation-race',
    });
    repository.requestCancellation({
      companyId: 'company-1', receivableId: 'receivable-cancellation-race',
      reason: 'source obligation expected to be voided', initiatedBy: 'user-1', cancelledAt: T3,
      correlationId: 'cancel-race', sourceSystem: 'test', approvalRequestId: 'approval-cancel-race',
    });
    repository.requestAllocation(allocationInput({
      id: 'allocation-cancellation-race', receivableId: 'receivable-cancellation-race',
      allocatedAmountMinor: 1000, matchingEvidenceReference: 'invoice-cancellation-race',
      idempotencyKey: 'allocation-cancellation-race', correlationId: 'allocation-cancellation-race',
      expectedPaymentVersion: 3, expectedReceivableVersion: 1,
    }));
    assert.throws(() => repository.approveCancellation({
      companyId: 'company-1', receivableId: 'receivable-cancellation-race',
      approvalRequestId: 'approval-cancel-race', ...approvalInput({ approvedAt: T4 }),
      expectedReceivableVersion: 2, sourceSystem: 'test',
    }), error => error.code === 'COMPENSATING_OPERATIONS_REQUIRED');
    assert.equal(repository.getApprovalRequest({
      companyId: 'company-1', id: 'approval-cancel-race',
    }).status, 'pending');
    const events = db.prepare(`
      SELECT eventType, previousValueJson, newValueJson, correlationId
      FROM financial_audit_events
      WHERE aggregateId IN ('receivable-with-history', 'receivable-cancellable')
      ORDER BY eventType
    `).all();
    assert.ok(events.some(event => event.eventType === 'due_date_change_requested'
      && JSON.parse(event.previousValueJson).contractualDueDate === '2026-07-31'
      && JSON.parse(event.newValueJson).approvalRequestId === 'approval-due-date-1'));
    assert.ok(events.some(event => event.eventType === 'due_date_change_approved'
      && JSON.parse(event.newValueJson).approvalRequestId === 'approval-due-date-1'));
    assert.ok(events.some(event => event.eventType === 'cancellation_requested'
      && JSON.parse(event.newValueJson).approvalRequestId === 'approval-cancel-1'));
    assert.ok(events.some(event => event.eventType === 'cancellation_approved'));
  } finally {
    closeContext(context);
  }
});

test('audit insertion failure rolls back approval, financial state, and aggregate versions atomically', () => {
  const context = makeContext();
  try {
    const { db, repository } = context;
    insertReceivable(db);
    repository.createCanonicalPayment(paymentInput());
    const pending = repository.requestAllocation(allocationInput({
      matchingEvidenceType: 'manual_ambiguous',
      matchingEvidenceReference: null,
      allocationReason: 'manual match awaiting approval',
      approvalRequestId: 'approval-audit-rollback',
      idempotencyKey: 'allocation-audit-rollback',
      correlationId: 'allocation-audit-rollback',
    }));
    db.exec(`
      CREATE TRIGGER fail_allocation_approved_audit
      BEFORE INSERT ON financial_audit_events
      FOR EACH ROW WHEN NEW.eventType = 'allocation_approved'
      BEGIN
        SELECT RAISE(ABORT, 'forced audit failure');
      END;
    `);
    assert.throws(() => repository.approveAllocation({
      companyId: 'company-1', allocationId: pending.id, ...approvalInput(),
      expectedPaymentVersion: 1, expectedReceivableVersion: 1,
    }), /forced audit failure/);
    assert.equal(repository.getAllocation({ companyId: 'company-1', id: pending.id }).allocationStatus, 'pending');
    assert.equal(repository.getApprovalRequest({
      companyId: 'company-1', id: 'approval-audit-rollback',
    }).status, 'pending');
    assert.equal(repository.getPayment({ companyId: 'company-1', id: 'payment-1' }).version, 1);
    assert.equal(db.prepare(`
      SELECT version FROM canonical_receivables
      WHERE companyId = 'company-1' AND id = 'receivable-1'
    `).get().version, 1);
    assert.deepEqual(db.prepare(`
      SELECT eventType FROM financial_audit_events
      WHERE aggregateId = ? ORDER BY eventType
    `).all(pending.id), [{ eventType: 'allocation_requested' }]);
  } finally {
    closeContext(context);
  }
});

test('separate SQLite connections serialize competing financial confirmations and reversals', async t => {
  await t.test('two allocations competing for one payment have one winner', async () => {
    const context = makeContext();
    try {
      const { db, dbPath, repository } = context;
      insertReceivable(db);
      insertReceivable(db, {
        id: 'receivable-2', sourceDocumentId: 'invoice-2', idempotencyKey: 'receivable-key-2',
      });
      repository.createCanonicalPayment(paymentInput());
      for (const [suffix, receivableId] of [['1', 'receivable-1'], ['2', 'receivable-2']]) {
        repository.requestAllocation(allocationInput({
          id: `payment-race-allocation-${suffix}`, receivableId, allocatedAmountMinor: 7000,
          matchingEvidenceType: 'manual_ambiguous', matchingEvidenceReference: null,
          allocationReason: 'payment race', approvalRequestId: `payment-race-approval-${suffix}`,
          idempotencyKey: `payment-race-allocation-${suffix}`,
          correlationId: `payment-race-allocation-${suffix}`,
        }));
      }
      const results = await runConcurrentRepositoryCalls(dbPath, ['1', '2'].map(suffix => ({
        method: 'approveAllocation',
        input: {
          companyId: 'company-1', allocationId: `payment-race-allocation-${suffix}`,
          approvedBy: `approver-${suffix}`, approverActorType: 'user', approvedAt: T3,
          expectedPaymentVersion: 1, expectedReceivableVersion: 1,
        },
      })));
      assertOneConcurrentWinner(results, [
        'PAYMENT_BALANCE_INSUFFICIENT', 'STALE_VERSION', 'CONCURRENT_WRITE_CONFLICT',
      ]);
      assert.equal(repository.calculatePaymentUnapplied({
        companyId: 'company-1', paymentId: 'payment-1',
      }), 3000);
    } finally {
      closeContext(context);
    }
  });

  await t.test('two allocations competing for one receivable have one winner', async () => {
    const context = makeContext();
    try {
      const { db, dbPath, repository } = context;
      insertReceivable(db);
      repository.createCanonicalPayment(paymentInput({ receivedAmountMinor: 7000 }));
      repository.createCanonicalPayment(paymentInput({
        id: 'payment-2', idempotencyKey: 'payment-key-2', externalId: 'payment-external-2',
        sourceDocumentId: 'bank-line-2', receivedAmountMinor: 7000, correlationId: 'payment-2',
      }));
      for (const [suffix, paymentId] of [['1', 'payment-1'], ['2', 'payment-2']]) {
        repository.requestAllocation(allocationInput({
          id: `receivable-race-allocation-${suffix}`, paymentId, allocatedAmountMinor: 7000,
          matchingEvidenceType: 'manual_ambiguous', matchingEvidenceReference: null,
          allocationReason: 'receivable race', approvalRequestId: `receivable-race-approval-${suffix}`,
          idempotencyKey: `receivable-race-allocation-${suffix}`,
          correlationId: `receivable-race-allocation-${suffix}`,
        }));
      }
      const results = await runConcurrentRepositoryCalls(dbPath, ['1', '2'].map(suffix => ({
        method: 'approveAllocation',
        input: {
          companyId: 'company-1', allocationId: `receivable-race-allocation-${suffix}`,
          approvedBy: `approver-${suffix}`, approverActorType: 'user', approvedAt: T3,
          expectedPaymentVersion: 1, expectedReceivableVersion: 1,
        },
      })));
      assertOneConcurrentWinner(results, [
        'RECEIVABLE_ALREADY_SETTLED', 'STALE_VERSION', 'CONCURRENT_WRITE_CONFLICT',
      ]);
      assert.equal(repository.calculateReceivableOutstanding({
        companyId: 'company-1', receivableId: 'receivable-1',
      }), 3000);
    } finally {
      closeContext(context);
    }
  });

  await t.test('allocation and refund competing for payment capacity have one winner', async () => {
    const context = makeContext();
    try {
      const { db, dbPath, repository } = context;
      insertReceivable(db);
      repository.createCanonicalPayment(paymentInput());
      repository.requestAllocation(allocationInput({
        id: 'allocation-refund-race', allocatedAmountMinor: 7000,
        matchingEvidenceType: 'manual_ambiguous', matchingEvidenceReference: null,
        allocationReason: 'allocation refund race', approvalRequestId: 'approval-allocation-refund-race',
        idempotencyKey: 'allocation-refund-race', correlationId: 'allocation-refund-race',
      }));
      repository.requestRefund({
        id: 'refund-race', companyId: 'company-1', reversalOfPaymentId: 'payment-1',
        refundAmountMinor: 7000, reason: 'refund race', initiatedBy: 'user-1', initiatedAt: T2,
        approvalRequestId: 'approval-refund-race', idempotencyKey: 'refund-race',
        correlationId: 'refund-race', receivedAt: T2, sourceSystem: 'test', createdAt: T2,
      });
      const results = await runConcurrentRepositoryCalls(dbPath, [
        {
          method: 'approveAllocation',
          input: {
            companyId: 'company-1', allocationId: 'allocation-refund-race',
            approvedBy: 'approver-allocation', approverActorType: 'user', approvedAt: T3,
            expectedPaymentVersion: 1, expectedReceivableVersion: 1,
          },
        },
        {
          method: 'approveRefund',
          input: {
            companyId: 'company-1', refundPaymentId: 'refund-race',
            approvedBy: 'approver-refund', approverActorType: 'user', approvedAt: T3,
            expectedPaymentVersion: 1,
          },
        },
      ]);
      assertOneConcurrentWinner(results, [
        'PAYMENT_BALANCE_INSUFFICIENT', 'REFUND_AMOUNT_EXCEEDS_AVAILABLE',
        'STALE_VERSION', 'CONCURRENT_WRITE_CONFLICT',
      ]);
      assert.equal(repository.calculatePaymentUnapplied({
        companyId: 'company-1', paymentId: 'payment-1',
      }), 3000);
    } finally {
      closeContext(context);
    }
  });

  await t.test('allocation and write-off competing for receivable capacity have one winner', async () => {
    const context = makeContext();
    try {
      const { db, dbPath, repository } = context;
      insertReceivable(db);
      repository.createCanonicalPayment(paymentInput({ receivedAmountMinor: 7000 }));
      repository.requestAllocation(allocationInput({
        id: 'allocation-write-off-race', allocatedAmountMinor: 7000,
        matchingEvidenceType: 'manual_ambiguous', matchingEvidenceReference: null,
        allocationReason: 'allocation write-off race', approvalRequestId: 'approval-allocation-write-off-race',
        idempotencyKey: 'allocation-write-off-race', correlationId: 'allocation-write-off-race',
      }));
      repository.requestWriteOff(adjustmentInput({
        id: 'write-off-race', adjustmentType: 'write_off', amountMinor: 7000,
        reason: 'write-off race', supportingDocumentReference: 'write-off-race-document',
        sourceDocumentType: null, sourceDocumentId: null,
        approvalRequestId: 'approval-write-off-race', idempotencyKey: 'write-off-race',
        correlationId: 'write-off-race',
      }));
      const results = await runConcurrentRepositoryCalls(dbPath, [
        {
          method: 'approveAllocation',
          input: {
            companyId: 'company-1', allocationId: 'allocation-write-off-race',
            approvedBy: 'approver-allocation', approverActorType: 'user', approvedAt: T3,
            expectedPaymentVersion: 1, expectedReceivableVersion: 1,
          },
        },
        {
          method: 'approveWriteOff',
          input: {
            companyId: 'company-1', adjustmentId: 'write-off-race',
            approvedBy: 'approver-write-off', approverActorType: 'user', approvedAt: T3,
            expectedReceivableVersion: 1,
          },
        },
      ]);
      assertOneConcurrentWinner(results, [
        'RECEIVABLE_ALREADY_SETTLED', 'STALE_VERSION', 'CONCURRENT_WRITE_CONFLICT',
      ]);
      assert.equal(repository.calculateReceivableOutstanding({
        companyId: 'company-1', receivableId: 'receivable-1',
      }), 3000);
    } finally {
      closeContext(context);
    }
  });

  await t.test('conflicting approvers cannot both finalize one request', async () => {
    const context = makeContext();
    try {
      const { db, dbPath, repository } = context;
      insertReceivable(db);
      repository.createCanonicalPayment(paymentInput());
      repository.requestAllocation(allocationInput({
        matchingEvidenceType: 'manual_ambiguous', matchingEvidenceReference: null,
        approvalRequestId: 'approval-double-race', idempotencyKey: 'approval-double-race',
        correlationId: 'approval-double-race',
      }));
      const results = await runConcurrentRepositoryCalls(dbPath, ['2', '3'].map(suffix => ({
        method: 'approveAllocation',
        input: {
          companyId: 'company-1', allocationId: 'allocation-1',
          approvedBy: `user-${suffix}`, approverActorType: 'user', approvedAt: T3,
          expectedPaymentVersion: 1, expectedReceivableVersion: 1,
        },
      })));
      assertOneConcurrentWinner(results, ['APPROVAL_ALREADY_FINAL', 'CONCURRENT_WRITE_CONFLICT']);
      const finalApproval = repository.getApprovalRequest({ companyId: 'company-1', id: 'approval-double-race' });
      assert.equal(repository.approveAllocation({
        companyId: 'company-1', allocationId: 'allocation-1',
        approvedBy: finalApproval.approvedBy, approverActorType: 'user', approvedAt: T3,
        expectedPaymentVersion: 1, expectedReceivableVersion: 1,
      }).allocationStatus, 'confirmed');
      assert.equal(db.prepare(`
        SELECT COUNT(*) AS count FROM financial_audit_events
        WHERE aggregateId = 'allocation-1' AND eventType = 'allocation_approved'
      `).get().count, 1);
    } finally {
      closeContext(context);
    }
  });

  await t.test('two reversal requests for one allocation create only one active reversal', async () => {
    const context = makeContext();
    try {
      const { db, dbPath, repository } = context;
      insertReceivable(db);
      repository.createCanonicalPayment(paymentInput());
      repository.requestAllocation(allocationInput({ allocatedAmountMinor: 1000 }));
      const calls = ['1', '2'].map(suffix => ({
        method: 'reverseAllocation',
        input: {
          id: `reversal-race-${suffix}`, companyId: 'company-1', originalAllocationId: 'allocation-1',
          allocationReason: 'reversal race', initiatedBy: 'user-1', initiatedAt: T3,
          approvalRequestId: `approval-reversal-race-${suffix}`,
          idempotencyKey: `reversal-race-${suffix}`, correlationId: `reversal-race-${suffix}`,
          createdAt: T3,
        },
      }));
      const results = await runConcurrentRepositoryCalls(dbPath, calls);
      assertOneConcurrentWinner(results, ['ALLOCATION_ALREADY_REVERSED', 'CONCURRENT_WRITE_CONFLICT']);
      assert.equal(db.prepare(`
        SELECT COUNT(*) AS count FROM canonical_payment_allocations
        WHERE companyId = 'company-1' AND reversalAllocationId = 'allocation-1'
          AND allocationStatus IN ('pending', 'confirmed')
      `).get().count, 1);
    } finally {
      closeContext(context);
    }
  });
});

test('SQLite immediate transactions serialize writers; stale versions and capacity checks prevent double settlement', () => {
  const context = makeContext();
  let secondDb;
  try {
    const { db, dbPath, repository } = context;
    insertReceivable(db);
    insertReceivable(db, {
      id: 'receivable-2', sourceDocumentId: 'invoice-2', idempotencyKey: 'receivable-key-2',
    });
    repository.createCanonicalPayment(paymentInput());
    secondDb = new Database(dbPath);
    secondDb.pragma('foreign_keys = ON');
    secondDb.pragma('busy_timeout = 1');
    const secondRepository = createCanonicalSettlementRepository(secondDb);
    db.exec('BEGIN IMMEDIATE');
    assert.throws(() => secondRepository.requestAllocation(allocationInput()), error => (
      error instanceof CanonicalSettlementRepositoryError && error.code === 'CONCURRENT_WRITE_CONFLICT'
    ));
    db.exec('ROLLBACK');

    repository.requestAllocation(allocationInput({ allocatedAmountMinor: 6000 }));
    assert.throws(() => repository.requestAllocation(allocationInput({
      id: 'allocation-stale', receivableId: 'receivable-2', allocatedAmountMinor: 4000,
      matchingEvidenceReference: 'invoice-2', idempotencyKey: 'allocation-stale',
      correlationId: 'allocation-stale', expectedPaymentVersion: 1, expectedReceivableVersion: 1,
    })), error => error.code === 'STALE_VERSION');
    repository.requestAllocation(allocationInput({
      id: 'allocation-second', receivableId: 'receivable-2', allocatedAmountMinor: 4000,
      matchingEvidenceReference: 'invoice-2', idempotencyKey: 'allocation-second',
      correlationId: 'allocation-second', expectedPaymentVersion: 2, expectedReceivableVersion: 1,
    }));
    assert.throws(() => repository.requestAllocation(allocationInput({
      id: 'allocation-over-capacity', receivableId: 'receivable-2', allocatedAmountMinor: 1,
      matchingEvidenceReference: 'invoice-2', idempotencyKey: 'allocation-over-capacity',
      correlationId: 'allocation-over-capacity', expectedPaymentVersion: 3, expectedReceivableVersion: 2,
    })), error => ['PAYMENT_BALANCE_INSUFFICIENT', 'RECEIVABLE_ALREADY_SETTLED'].includes(error.code));
    assert.equal(repository.calculatePaymentUnapplied({ companyId: 'company-1', paymentId: 'payment-1' }), 0);
    assert.equal(repository.calculateReceivableOutstanding({ companyId: 'company-1', receivableId: 'receivable-1' }), 4000);
    assert.equal(repository.calculateReceivableOutstanding({ companyId: 'company-1', receivableId: 'receivable-2' }), 6000);
  } finally {
    secondDb?.close();
    closeContext(context);
  }
});
