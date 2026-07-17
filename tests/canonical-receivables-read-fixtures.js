import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const { ensureCanonicalReceivablesSchema } = require('../server/lib/canonical-receivables-schema.js');
const {
  ensureCanonicalReceivablesSettlementSchema,
} = require('../server/lib/canonical-receivables-settlement-schema.js');

export function createCanonicalReadContext({ seedScopes = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-read-pr3-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  ensureCanonicalReceivablesSchema(db);
  ensureCanonicalReceivablesSettlementSchema(db);
  if (seedScopes) {
    for (const [companyId, timezone] of [['company-a', 'Europe/Moscow'], ['company-b', 'America/New_York']]) {
      db.prepare(`
        INSERT INTO canonical_companies (id, receivablesTimezone, createdAt)
        VALUES (?, ?, '2026-01-01T00:00:00.000Z')
      `).run(companyId, timezone);
    }
    for (const [companyId, branchId, isHeadOffice] of [
      ['company-a', 'branch-a1', 1],
      ['company-a', 'branch-a2', 0],
      ['company-b', 'branch-b1', 1],
    ]) {
      db.prepare(`
        INSERT INTO canonical_branches (companyId, id, isHeadOffice, createdAt)
        VALUES (?, ?, ?, '2026-01-01T00:00:00.000Z')
      `).run(companyId, branchId, isHeadOffice);
    }
  }
  return {
    db,
    dbPath,
    dir,
    close() {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function insertReceivable(db, overrides = {}) {
  const id = overrides.id || `rec-${Math.random().toString(36).slice(2)}`;
  const companyId = overrides.companyId || 'company-a';
  const branchId = overrides.branchId || (companyId === 'company-b' ? 'branch-b1' : 'branch-a1');
  const workflowStatus = overrides.workflowStatus || 'posted';
  const createdAt = overrides.createdAt || '2026-06-01T09:00:00.000Z';
  const row = {
    id,
    companyId,
    branchId,
    clientId: overrides.clientId || `${companyId}-client-1`,
    contractId: overrides.contractId ?? `${companyId}-contract-1`,
    rentalId: overrides.rentalId ?? `${companyId}-rental-1`,
    sourceDocumentType: overrides.sourceDocumentType || 'invoice',
    sourceDocumentId: overrides.sourceDocumentId || `invoice-${id}`,
    sourceLineId: overrides.sourceLineId ?? 'line-1',
    sourceSystem: overrides.sourceSystem || 'test-canonical',
    externalId: overrides.externalId ?? null,
    idempotencyKey: overrides.idempotencyKey || `idem-${id}`,
    currency: overrides.currency || 'RUB',
    originalAmountMinor: overrides.originalAmountMinor ?? 10000,
    issuedAt: overrides.issuedAt ?? createdAt,
    postedAt: overrides.postedAt === undefined
      ? (['posted', 'disputed', 'written_off'].includes(workflowStatus) ? createdAt : null)
      : overrides.postedAt,
    contractualDueDate: overrides.contractualDueDate === undefined ? '2026-07-01' : overrides.contractualDueDate,
    dueDateProvenance: overrides.dueDateProvenance || 'invoice_due_date',
    companyTimezone: overrides.companyTimezone || (companyId === 'company-b' ? 'America/New_York' : 'Europe/Moscow'),
    workflowStatus,
    cancellationReason: overrides.cancellationReason ?? (workflowStatus === 'cancelled' ? 'voided fixture' : null),
    description: overrides.description ?? `Receivable ${id}`,
    createdAt,
    updatedAt: overrides.updatedAt || createdAt,
    cancelledAt: overrides.cancelledAt ?? (workflowStatus === 'cancelled' ? createdAt : null),
    closedAt: overrides.closedAt ?? null,
    writtenOffAt: overrides.writtenOffAt ?? (workflowStatus === 'written_off' ? createdAt : null),
    version: overrides.version || 1,
  };
  db.prepare(`
    INSERT INTO canonical_receivables (
      id, companyId, branchId, clientId, contractId, rentalId,
      sourceDocumentType, sourceDocumentId, sourceLineId, sourceSystem,
      externalId, idempotencyKey, currency, originalAmountMinor, issuedAt,
      postedAt, contractualDueDate, dueDateProvenance, companyTimezone,
      workflowStatus, cancellationReason, description, createdAt, updatedAt,
      cancelledAt, closedAt, writtenOffAt, version
    ) VALUES (
      @id, @companyId, @branchId, @clientId, @contractId, @rentalId,
      @sourceDocumentType, @sourceDocumentId, @sourceLineId, @sourceSystem,
      @externalId, @idempotencyKey, @currency, @originalAmountMinor, @issuedAt,
      @postedAt, @contractualDueDate, @dueDateProvenance, @companyTimezone,
      @workflowStatus, @cancellationReason, @description, @createdAt, @updatedAt,
      @cancelledAt, @closedAt, @writtenOffAt, @version
    )
  `).run(row);
  return db.prepare('SELECT * FROM canonical_receivables WHERE id = ?').get(id);
}

export function insertApproval(db, overrides = {}) {
  const id = overrides.id || `approval-${Math.random().toString(36).slice(2)}`;
  const status = overrides.status || 'approved';
  const row = {
    id,
    companyId: overrides.companyId || 'company-a',
    operationType: overrides.operationType || 'adjustment',
    aggregateType: overrides.aggregateType || 'receivable_adjustment',
    aggregateId: overrides.aggregateId || `aggregate-${id}`,
    initiatedBy: overrides.initiatedBy || 'user-initiator',
    initiatorActorType: 'user',
    requestedAt: overrides.requestedAt || '2026-06-01T10:00:00.000Z',
    approvedBy: status === 'approved' ? (overrides.approvedBy || 'user-approver') : null,
    approverActorType: status === 'approved' ? 'user' : null,
    approvedAt: status === 'approved' ? (overrides.approvedAt || '2026-06-01T11:00:00.000Z') : null,
    rejectedBy: status === 'rejected' ? (overrides.rejectedBy || 'user-rejector') : null,
    rejectedAt: status === 'rejected' ? (overrides.rejectedAt || '2026-06-01T11:00:00.000Z') : null,
    status,
    reason: overrides.reason || 'fixture approval',
    rejectionReason: status === 'rejected' ? (overrides.rejectionReason || 'fixture rejected') : null,
    correlationId: overrides.correlationId || `correlation-${id}`,
    operationPayloadJson: overrides.operationPayloadJson || '{}',
    createdAt: overrides.createdAt || '2026-06-01T10:00:00.000Z',
    version: 1,
  };
  db.prepare(`
    INSERT INTO canonical_approval_requests (
      id, companyId, operationType, aggregateType, aggregateId,
      initiatedBy, initiatorActorType, requestedAt, approvedBy,
      approverActorType, approvedAt, rejectedBy, rejectedAt, status,
      reason, rejectionReason, correlationId, operationPayloadJson,
      createdAt, version
    ) VALUES (
      @id, @companyId, @operationType, @aggregateType, @aggregateId,
      @initiatedBy, @initiatorActorType, @requestedAt, @approvedBy,
      @approverActorType, @approvedAt, @rejectedBy, @rejectedAt, @status,
      @reason, @rejectionReason, @correlationId, @operationPayloadJson,
      @createdAt, @version
    )
  `).run(row);
  return row;
}

export function insertPayment(db, overrides = {}) {
  const id = overrides.id || `payment-${Math.random().toString(36).slice(2)}`;
  const companyId = overrides.companyId || 'company-a';
  const paymentKind = overrides.paymentKind || 'receipt';
  const branchId = overrides.branchId || (companyId === 'company-b' ? 'branch-b1' : 'branch-a1');
  const correlationId = overrides.correlationId || `correlation-${id}`;
  const amount = overrides.receivedAmountMinor ?? 10000;
  const refundAmountMinor = overrides.refundAmountMinor ?? (paymentKind === 'receipt' ? 0 : amount);
  const reason = overrides.reason ?? (paymentKind === 'receipt' ? null : 'fixture compensation');
  let approvalRequestId = overrides.approvalRequestId ?? null;
  if (paymentKind !== 'receipt' && !approvalRequestId) {
    approvalRequestId = `approval-${id}`;
    insertApproval(db, {
      id: approvalRequestId,
      companyId,
      operationType: paymentKind === 'refund' ? 'refund' : 'refund_reversal',
      aggregateType: 'payment',
      aggregateId: id,
      correlationId,
      operationPayloadJson: JSON.stringify({
        paymentKind,
        reversalOfPaymentId: overrides.reversalOfPaymentId ?? null,
        refundAmountMinor,
        currency: overrides.currency || 'RUB',
        branchId,
        reason,
        correlationId,
      }),
    });
  }
  const row = {
    id,
    companyId,
    branchId,
    clientId: overrides.clientId || `${companyId}-client-1`,
    externalId: overrides.externalId ?? null,
    idempotencyKey: overrides.idempotencyKey || `idem-${id}`,
    currency: overrides.currency || 'RUB',
    paymentKind,
    receivedAmountMinor: amount,
    refundAmountMinor,
    receivedAt: overrides.receivedAt || '2026-06-10T09:00:00.000Z',
    workflowStatus: overrides.workflowStatus || 'confirmed',
    sourceSystem: overrides.sourceSystem || 'test-canonical',
    sourceDocumentType: overrides.sourceDocumentType ?? null,
    sourceDocumentId: overrides.sourceDocumentId ?? null,
    internalTransfer: overrides.internalTransfer ? 1 : 0,
    reversalOfPaymentId: overrides.reversalOfPaymentId ?? null,
    approvalRequestId,
    reason,
    correlationId,
    createdAt: overrides.createdAt || '2026-06-10T09:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-06-10T09:00:00.000Z',
    version: 1,
  };
  db.prepare(`
    INSERT INTO canonical_payments (
      id, companyId, branchId, clientId, externalId, idempotencyKey,
      currency, paymentKind, receivedAmountMinor, refundAmountMinor,
      receivedAt, workflowStatus, sourceSystem, sourceDocumentType,
      sourceDocumentId, internalTransfer, reversalOfPaymentId,
      approvalRequestId, reason, correlationId, createdAt, updatedAt, version
    ) VALUES (
      @id, @companyId, @branchId, @clientId, @externalId, @idempotencyKey,
      @currency, @paymentKind, @receivedAmountMinor, @refundAmountMinor,
      @receivedAt, @workflowStatus, @sourceSystem, @sourceDocumentType,
      @sourceDocumentId, @internalTransfer, @reversalOfPaymentId,
      @approvalRequestId, @reason, @correlationId, @createdAt, @updatedAt, @version
    )
  `).run(row);
  return row;
}

export function insertAllocation(db, overrides = {}) {
  const id = overrides.id || `allocation-${Math.random().toString(36).slice(2)}`;
  const companyId = overrides.companyId || 'company-a';
  const allocationKind = overrides.allocationKind || 'allocation';
  const allocationStatus = overrides.allocationStatus || 'confirmed';
  const paymentBranchId = overrides.paymentBranchId || 'branch-a1';
  const receivableBranchId = overrides.receivableBranchId || 'branch-a1';
  const allocatedAmountMinor = overrides.allocatedAmountMinor ?? 1000;
  const allocationReason = overrides.allocationReason || 'fixture allocation';
  const matchingEvidenceType = overrides.matchingEvidenceType || 'exact_document_reference';
  const matchingEvidenceReference = overrides.matchingEvidenceReference || 'fixture-reference';
  const correlationId = overrides.correlationId || `correlation-${id}`;
  const reversalAllocationId = overrides.reversalAllocationId ?? null;
  const needsApproval = allocationKind === 'reversal' || overrides.approvalStatus === 'approved';
  let approvalRequestId = overrides.approvalRequestId ?? null;
  if (needsApproval && !approvalRequestId) {
    approvalRequestId = `approval-${id}`;
    insertApproval(db, {
      id: approvalRequestId,
      companyId,
      operationType: allocationKind === 'reversal' ? 'allocation_reversal' : 'allocation',
      aggregateType: 'payment_allocation',
      aggregateId: id,
      correlationId,
      operationPayloadJson: JSON.stringify({
        paymentId: overrides.paymentId,
        receivableId: overrides.receivableId,
        allocatedAmountMinor,
        reversalAllocationId,
        currency: 'RUB',
        paymentBranchId,
        receivableBranchId,
        matchingEvidenceType,
        matchingEvidenceReference,
        allocationReason,
        correlationId,
      }),
    });
  }
  const approvalStatus = overrides.approvalStatus || (needsApproval ? 'approved' : 'not_required');
  const approved = approvalStatus === 'approved';
  const row = {
    id,
    companyId,
    paymentId: overrides.paymentId,
    receivableId: overrides.receivableId,
    paymentBranchId,
    receivableBranchId,
    allocatedAmountMinor,
    allocationKind,
    allocationStatus,
    allocationReason,
    matchingEvidenceType,
    matchingEvidenceReference,
    initiatedBy: 'user-initiator',
    initiatedAt: overrides.initiatedAt || '2026-06-10T10:00:00.000Z',
    approvedBy: approved ? 'user-approver' : null,
    approvedAt: approved ? (overrides.approvedAt || '2026-06-10T11:00:00.000Z') : null,
    approvalStatus,
    approvalRequestId,
    reversedAt: allocationKind === 'reversal'
      ? (overrides.reversedAt || '2026-06-10T11:00:00.000Z')
      : null,
    reversalAllocationId,
    idempotencyKey: overrides.idempotencyKey || `idem-${id}`,
    correlationId,
    createdAt: overrides.createdAt || '2026-06-10T10:00:00.000Z',
    version: 1,
  };
  db.prepare(`
    INSERT INTO canonical_payment_allocations (
      id, companyId, paymentId, receivableId, paymentBranchId,
      receivableBranchId, allocatedAmountMinor, allocationKind,
      allocationStatus, allocationReason, matchingEvidenceType,
      matchingEvidenceReference, initiatedBy, initiatedAt, approvedBy,
      approvedAt, approvalStatus, approvalRequestId, reversedAt,
      reversalAllocationId, idempotencyKey, correlationId, createdAt, version
    ) VALUES (
      @id, @companyId, @paymentId, @receivableId, @paymentBranchId,
      @receivableBranchId, @allocatedAmountMinor, @allocationKind,
      @allocationStatus, @allocationReason, @matchingEvidenceType,
      @matchingEvidenceReference, @initiatedBy, @initiatedAt, @approvedBy,
      @approvedAt, @approvalStatus, @approvalRequestId, @reversedAt,
      @reversalAllocationId, @idempotencyKey, @correlationId, @createdAt, @version
    )
  `).run(row);
  return row;
}

export function insertAdjustment(db, overrides = {}) {
  const id = overrides.id || `adjustment-${Math.random().toString(36).slice(2)}`;
  const companyId = overrides.companyId || 'company-a';
  const workflowStatus = overrides.workflowStatus || 'confirmed';
  const approvalStatus = overrides.approvalStatus || (workflowStatus === 'confirmed' ? 'approved' : 'pending');
  const branchId = overrides.branchId || 'branch-a1';
  const adjustmentType = overrides.adjustmentType || 'credit';
  const balanceEffect = overrides.balanceEffect || 'decrease';
  const amountMinor = overrides.amountMinor ?? 1000;
  const reason = overrides.reason || 'fixture adjustment';
  const supportingDocumentReference = overrides.supportingDocumentReference
    ?? (adjustmentType === 'write_off' ? 'writeoff-document' : null);
  const sourceDocumentType = overrides.sourceDocumentType ?? null;
  const sourceDocumentId = overrides.sourceDocumentId ?? null;
  const reversesAdjustmentId = overrides.reversesAdjustmentId ?? null;
  const correlationId = overrides.correlationId || `correlation-${id}`;
  let approvalRequestId = overrides.approvalRequestId || `approval-${id}`;
  insertApproval(db, {
    id: approvalRequestId,
    companyId,
    operationType: adjustmentType === 'write_off'
      ? 'write_off'
      : adjustmentType === 'reversal' ? 'adjustment_reversal' : 'adjustment',
    aggregateType: 'receivable_adjustment',
    aggregateId: id,
    status: approvalStatus === 'approved' ? 'approved' : 'pending',
    correlationId,
    operationPayloadJson: JSON.stringify({
      receivableId: overrides.receivableId,
      adjustmentType,
      balanceEffect,
      amountMinor,
      reversesAdjustmentId,
      branchId,
      currency: 'RUB',
      reason,
      supportingDocumentReference,
      sourceDocumentType,
      sourceDocumentId,
      correlationId,
    }),
  });
  const row = {
    id,
    companyId,
    branchId,
    receivableId: overrides.receivableId,
    adjustmentType,
    balanceEffect,
    amountMinor,
    workflowStatus,
    reason,
    supportingDocumentReference,
    sourceDocumentType,
    sourceDocumentId,
    reversesAdjustmentId,
    initiatedBy: 'user-initiator',
    initiatedAt: overrides.initiatedAt || '2026-06-15T10:00:00.000Z',
    approvedBy: approvalStatus === 'approved' ? 'user-approver' : null,
    approvedAt: approvalStatus === 'approved' ? (overrides.approvedAt || '2026-06-15T11:00:00.000Z') : null,
    approvalStatus,
    approvalRequestId,
    idempotencyKey: overrides.idempotencyKey || `idem-${id}`,
    correlationId,
    effectiveAt: overrides.effectiveAt || '2026-06-15T11:00:00.000Z',
    createdAt: overrides.createdAt || '2026-06-15T10:00:00.000Z',
    version: 1,
  };
  db.prepare(`
    INSERT INTO canonical_receivable_adjustments (
      id, companyId, branchId, receivableId, adjustmentType, balanceEffect,
      amountMinor, workflowStatus, reason, supportingDocumentReference,
      sourceDocumentType, sourceDocumentId, reversesAdjustmentId, initiatedBy,
      initiatedAt, approvedBy, approvedAt, approvalStatus, approvalRequestId,
      idempotencyKey, correlationId, effectiveAt, createdAt, version
    ) VALUES (
      @id, @companyId, @branchId, @receivableId, @adjustmentType, @balanceEffect,
      @amountMinor, @workflowStatus, @reason, @supportingDocumentReference,
      @sourceDocumentType, @sourceDocumentId, @reversesAdjustmentId, @initiatedBy,
      @initiatedAt, @approvedBy, @approvedAt, @approvalStatus, @approvalRequestId,
      @idempotencyKey, @correlationId, @effectiveAt, @createdAt, @version
    )
  `).run(row);
  return row;
}

export function insertDueDateAudit(db, overrides = {}) {
  const id = overrides.id || `audit-${Math.random().toString(36).slice(2)}`;
  const row = {
    id,
    companyId: overrides.companyId || 'company-a',
    branchId: overrides.branchId || 'branch-a1',
    aggregateType: 'receivable',
    aggregateId: overrides.receivableId,
    eventType: 'due_date_change_approved',
    actorId: 'user-approver',
    actorType: 'user',
    occurredAt: overrides.occurredAt || '2026-07-15T10:00:00.000Z',
    reason: 'fixture correction',
    previousValueJson: overrides.previousValueJson ?? JSON.stringify({
      contractualDueDate: overrides.previousDueDate || '2026-07-01',
      dueDateProvenance: overrides.previousProvenance || 'invoice_due_date',
    }),
    newValueJson: overrides.newValueJson ?? JSON.stringify({
      contractualDueDate: overrides.newDueDate || '2026-08-01',
      dueDateProvenance: overrides.newProvenance || 'contractual_payment_due_date',
    }),
    correlationId: overrides.correlationId || `correlation-${id}`,
    sourceSystem: 'test-canonical',
    createdAt: overrides.occurredAt || '2026-07-15T10:00:00.000Z',
  };
  db.prepare(`
    INSERT INTO financial_audit_events (
      id, companyId, branchId, aggregateType, aggregateId, eventType,
      actorId, actorType, occurredAt, reason, previousValueJson,
      newValueJson, correlationId, sourceSystem, createdAt
    ) VALUES (
      @id, @companyId, @branchId, @aggregateType, @aggregateId, @eventType,
      @actorId, @actorType, @occurredAt, @reason, @previousValueJson,
      @newValueJson, @correlationId, @sourceSystem, @createdAt
    )
  `).run(row);
  return row;
}

export function trustedScope(overrides = {}) {
  const companyId = overrides.companyId || 'company-a';
  const defaultBranches = companyId === 'company-b'
    ? ['branch-b1']
    : companyId === 'company-a'
      ? ['branch-a1', 'branch-a2']
      : ['unmapped-test-branch'];
  const allowedBranchIds = overrides.allowedBranchIds ?? defaultBranches;
  return {
    authenticated: true,
    principalId: overrides.principalId || 'user-finance',
    companyId,
    capabilities: overrides.capabilities || ['receivables.read'],
    companyWideBranchAccess: overrides.companyWideBranchAccess ?? true,
    allowedBranchIds,
    branchIds: allowedBranchIds,
    receivablesTimezone: overrides.receivablesTimezone,
  };
}

export async function withServer(app, fn) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
