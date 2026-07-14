const {
  CANONICAL_RECEIVABLES_TABLE,
  FINANCIAL_AUDIT_EVENTS_TABLE,
} = require('./canonical-receivables-schema');
const {
  CANONICAL_APPROVAL_REQUESTS_TABLE,
  CANONICAL_PAYMENT_ALLOCATIONS_TABLE,
  CANONICAL_PAYMENTS_TABLE,
  CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE,
} = require('./canonical-receivables-settlement-schema');
const {
  adjustmentBalanceEffect,
  calculatePaymentUnapplied: calculatePaymentUnappliedDomain,
  calculateReceivableOutstanding: calculateReceivableOutstandingDomain,
  requiresAdjustmentApproval,
  requiresAllocationApproval,
  validateAdjustmentRecord,
  validateAllocationRecord,
  validateCancellationOperation,
  validateCanonicalPayment,
  validateDueDateChangeOperation,
  validateSeparationOfDuties,
} = require('./canonical-receivables-settlement-domain');

const SENSITIVE_AUDIT_KEY_PATTERN = /(password|passhash|token|secret|credential|api[_-]?key|authorization|cookie|session|webhook)/i;

class CanonicalSettlementRepositoryError extends Error {
  constructor(code, message, field) {
    super(message);
    this.name = 'CanonicalSettlementRepositoryError';
    this.code = code;
    this.field = field;
  }
}

function fail(code, message, field) {
  throw new CanonicalSettlementRepositoryError(code, message, field);
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('REPOSITORY_FIELD_REQUIRED', `${field} is required.`, field);
  }
  return value.trim();
}

function optionalText(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) {
    fail('INVALID_REPOSITORY_FIELD', `${field} must be non-empty text when supplied.`, field);
  }
  return value.trim();
}

function requiredPositiveMinor(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail('INVALID_MINOR_UNIT_AMOUNT', `${field} must be a positive safe integer.`, field);
  }
  return value;
}

function timestamp(value, field) {
  const result = requiredText(value, field);
  if (Number.isNaN(Date.parse(result))) {
    fail('INVALID_TIMESTAMP', `${field} must be a valid timestamp.`, field);
  }
  return result;
}

function safeInteger(value, field) {
  if (!Number.isSafeInteger(value)) {
    fail('MINOR_UNIT_OVERFLOW', `${field} is outside safe integer range.`, field);
  }
  return value;
}

function parsePayload(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    fail('INVALID_APPROVAL_PAYLOAD', 'Approval request payload is invalid JSON.');
  }
}

function hasSensitiveKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasSensitiveKey);
  return Object.entries(value).some(([key, nested]) => (
    SENSITIVE_AUDIT_KEY_PATTERN.test(key) || hasSensitiveKey(nested)
  ));
}

function auditJson(value, field) {
  if (value === undefined || value === null) return null;
  if (hasSensitiveKey(value)) {
    fail('AUDIT_SECRET_REJECTED', `${field} contains a secret-bearing field.`, field);
  }
  try {
    return JSON.stringify(value);
  } catch {
    fail('INVALID_AUDIT_JSON', `${field} must be JSON serializable.`, field);
  }
}

function translateSqliteError(error) {
  const message = String(error?.message || error);
  if (/payment balance insufficient/i.test(message)) {
    fail('PAYMENT_BALANCE_INSUFFICIENT', 'Payment unapplied balance is insufficient.');
  }
  if (/receivable already settled|adjustment exceeds receivable outstanding/i.test(message)) {
    fail('RECEIVABLE_ALREADY_SETTLED', 'Operation exceeds receivable outstanding balance.');
  }
  if (/allocation payment\/receivable contract invalid/i.test(message)) {
    fail('ALLOCATION_CONTRACT_INVALID', 'Payment and receivable scope, status, or currency is invalid.');
  }
  if (/refund exceeds available refundable amount/i.test(message)) {
    fail('REFUND_AMOUNT_EXCEEDS_AVAILABLE', 'Refund exceeds available refundable amount.');
  }
  if (/database is locked|database is busy/i.test(message)) {
    fail('CONCURRENT_WRITE_CONFLICT', 'Settlement write could not acquire the SQLite write lock.');
  }
  throw error;
}

function createCanonicalSettlementRepository(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    fail('DATABASE_REQUIRED', 'A better-sqlite3 database is required.');
  }

  function runImmediate(transaction, input) {
    try {
      return transaction.immediate(input);
    } catch (error) {
      if (error instanceof CanonicalSettlementRepositoryError) throw error;
      translateSqliteError(error);
    }
  }

  function getPayment(query = {}) {
    const companyId = requiredText(query.companyId, 'companyId');
    const id = requiredText(query.id, 'id');
    return db.prepare(`
      SELECT * FROM ${CANONICAL_PAYMENTS_TABLE}
      WHERE companyId = ? AND id = ?
    `).get(companyId, id) || null;
  }

  function getAllocation(query = {}) {
    const companyId = requiredText(query.companyId, 'companyId');
    const id = requiredText(query.id, 'id');
    return db.prepare(`
      SELECT * FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}
      WHERE companyId = ? AND id = ?
    `).get(companyId, id) || null;
  }

  function getAdjustment(query = {}) {
    const companyId = requiredText(query.companyId, 'companyId');
    const id = requiredText(query.id, 'id');
    return db.prepare(`
      SELECT * FROM ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE}
      WHERE companyId = ? AND id = ?
    `).get(companyId, id) || null;
  }

  function getApprovalRequest(query = {}) {
    const companyId = requiredText(query.companyId, 'companyId');
    const id = requiredText(query.id, 'id');
    return db.prepare(`
      SELECT * FROM ${CANONICAL_APPROVAL_REQUESTS_TABLE}
      WHERE companyId = ? AND id = ?
    `).get(companyId, id) || null;
  }

  function paymentOrFail(companyId, id) {
    const payment = getPayment({ companyId, id });
    if (!payment) fail('PAYMENT_NOT_FOUND', 'Canonical payment was not found.', 'paymentId');
    return payment;
  }

  function receivableOrFail(companyId, id) {
    const receivable = db.prepare(`
      SELECT * FROM ${CANONICAL_RECEIVABLES_TABLE}
      WHERE companyId = ? AND id = ?
    `).get(companyId, id);
    if (!receivable) fail('RECEIVABLE_NOT_FOUND', 'Canonical receivable was not found.', 'receivableId');
    return receivable;
  }

  function allocationOrFail(companyId, id) {
    const allocation = getAllocation({ companyId, id });
    if (!allocation) fail('ALLOCATION_NOT_FOUND', 'Canonical allocation was not found.', 'allocationId');
    return allocation;
  }

  function adjustmentOrFail(companyId, id) {
    const adjustment = getAdjustment({ companyId, id });
    if (!adjustment) fail('ADJUSTMENT_NOT_FOUND', 'Canonical adjustment was not found.', 'adjustmentId');
    return adjustment;
  }

  function approvalOrFail(companyId, id, operationType, aggregateId) {
    const approval = getApprovalRequest({ companyId, id });
    if (
      !approval
      || approval.operationType !== operationType
      || approval.aggregateId !== aggregateId
    ) {
      fail('APPROVAL_REQUEST_NOT_FOUND', 'Matching approval request was not found.', 'approvalRequestId');
    }
    return approval;
  }

  function netAllocationMinor({ companyId, paymentId, receivableId }) {
    const where = ['companyId = @companyId', "allocationStatus = 'confirmed'"];
    const params = { companyId };
    if (paymentId) {
      where.push('paymentId = @paymentId');
      params.paymentId = paymentId;
    }
    if (receivableId) {
      where.push('receivableId = @receivableId');
      params.receivableId = receivableId;
    }
    const value = db.prepare(`
      SELECT COALESCE(SUM(
        CASE allocationKind WHEN 'allocation' THEN allocatedAmountMinor ELSE -allocatedAmountMinor END
      ), 0) AS amount
      FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}
      WHERE ${where.join(' AND ')}
    `).get(params).amount;
    return safeInteger(value, 'confirmedActiveAllocationsMinor');
  }

  function netPaymentCompensationMinor(companyId, receiptId) {
    const rows = db.prepare(`
      SELECT id, paymentKind, refundAmountMinor, reversalOfPaymentId
      FROM ${CANONICAL_PAYMENTS_TABLE}
      WHERE companyId = ?
        AND workflowStatus = 'confirmed'
        AND paymentKind IN ('refund', 'reversal')
    `).all(companyId);
    const byId = new Map(rows.map(row => [row.id, row]));
    let amount = 0;
    for (const row of rows) {
      if (row.reversalOfPaymentId === receiptId) {
        amount = safeInteger(amount + row.refundAmountMinor, 'confirmedRefundsMinor');
        continue;
      }
      if (row.paymentKind !== 'reversal') continue;
      const original = byId.get(row.reversalOfPaymentId);
      if (original?.paymentKind === 'refund' && original.reversalOfPaymentId === receiptId) {
        amount = safeInteger(amount - row.refundAmountMinor, 'confirmedRefundsMinor');
      }
    }
    if (amount < 0) fail('PAYMENT_INTEGRITY_ERROR', 'Payment compensation chain is negative.');
    return amount;
  }

  function hasUncompensatedAllocation(companyId, receivableId) {
    return db.prepare(`
      SELECT EXISTS(
        SELECT 1
        FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} original
        WHERE original.companyId = ?
          AND original.receivableId = ?
          AND (
            original.allocationStatus = 'pending'
            OR (
              original.allocationKind = 'allocation'
              AND original.allocationStatus = 'confirmed'
              AND NOT EXISTS (
                SELECT 1 FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} reversal
                WHERE reversal.companyId = original.companyId
                  AND reversal.reversalAllocationId = original.id
                  AND reversal.allocationKind = 'reversal'
                  AND reversal.allocationStatus = 'confirmed'
              )
            )
          )
      ) AS value
    `).get(companyId, receivableId).value === 1;
  }

  function hasUncompensatedAdjustment(companyId, receivableId) {
    return db.prepare(`
      SELECT EXISTS(
        SELECT 1
        FROM ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE} original
        WHERE original.companyId = ?
          AND original.receivableId = ?
          AND (
            original.workflowStatus = 'pending'
            OR (
              original.adjustmentType != 'reversal'
              AND original.workflowStatus = 'confirmed'
              AND NOT EXISTS (
                SELECT 1 FROM ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE} reversal
                WHERE reversal.companyId = original.companyId
                  AND reversal.reversesAdjustmentId = original.id
                  AND reversal.adjustmentType = 'reversal'
                  AND reversal.workflowStatus = 'confirmed'
              )
            )
          )
      ) AS value
    `).get(companyId, receivableId).value === 1;
  }

  function calculatePaymentUnapplied(query = {}) {
    const companyId = requiredText(query.companyId, 'companyId');
    const payment = paymentOrFail(companyId, requiredText(query.paymentId, 'paymentId'));
    return calculatePaymentUnappliedDomain({
      ...payment,
      internalTransfer: payment.internalTransfer === 1,
      confirmedActiveAllocationsMinor: netAllocationMinor({ companyId, paymentId: payment.id }),
      confirmedRefundsMinor: netPaymentCompensationMinor(companyId, payment.id),
    });
  }

  function calculateReceivableOutstanding(query = {}) {
    const companyId = requiredText(query.companyId, 'companyId');
    const receivable = receivableOrFail(companyId, requiredText(query.receivableId, 'receivableId'));
    const adjustmentTotals = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN balanceEffect = 'increase' THEN amountMinor ELSE 0 END), 0) AS increases,
        COALESCE(SUM(CASE WHEN balanceEffect = 'decrease' THEN amountMinor ELSE 0 END), 0) AS decreases
      FROM ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE}
      WHERE companyId = ? AND receivableId = ? AND workflowStatus = 'confirmed'
    `).get(companyId, receivable.id);
    return calculateReceivableOutstandingDomain({
      workflowStatus: receivable.workflowStatus,
      originalAmountMinor: receivable.originalAmountMinor,
      confirmedDebitAdjustmentsMinor: safeInteger(adjustmentTotals.increases, 'adjustmentIncreases'),
      confirmedCreditAdjustmentsMinor: safeInteger(adjustmentTotals.decreases, 'adjustmentDecreases'),
      confirmedActivePaymentAllocationsMinor: netAllocationMinor({ companyId, receivableId: receivable.id }),
    });
  }

  function assertAggregateVersion(row, expectedVersion, field) {
    const expected = expectedVersion ?? row.version;
    if (!Number.isSafeInteger(expected) || expected < 1 || row.version !== expected) {
      fail('STALE_VERSION', `${field} version is stale.`, field);
    }
    return expected;
  }

  function bumpPaymentVersion(payment, expectedVersion, updatedAt) {
    const result = db.prepare(`
      UPDATE ${CANONICAL_PAYMENTS_TABLE}
      SET version = version + 1, updatedAt = ?
      WHERE companyId = ? AND id = ? AND version = ?
    `).run(updatedAt, payment.companyId, payment.id, expectedVersion);
    if (result.changes !== 1) fail('STALE_VERSION', 'payment version is stale.', 'expectedPaymentVersion');
  }

  function bumpReceivableVersion(receivable, expectedVersion, updatedAt) {
    const result = db.prepare(`
      UPDATE ${CANONICAL_RECEIVABLES_TABLE}
      SET version = version + 1, updatedAt = ?
      WHERE companyId = ? AND id = ? AND version = ?
    `).run(updatedAt, receivable.companyId, receivable.id, expectedVersion);
    if (result.changes !== 1) fail('STALE_VERSION', 'receivable version is stale.', 'expectedReceivableVersion');
  }

  function appendAudit(input) {
    const event = {
      id: `settlement:${input.eventType}:${input.aggregateId}:${input.correlationId}`,
      companyId: input.companyId,
      branchId: input.branchId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      actorId: input.actorId || null,
      actorType: input.actorType || 'user',
      occurredAt: input.occurredAt,
      reason: input.reason || null,
      previousValueJson: auditJson(input.previousValue, 'previousValueJson'),
      newValueJson: auditJson(input.newValue, 'newValueJson'),
      correlationId: input.correlationId,
      sourceSystem: input.sourceSystem,
      createdAt: input.occurredAt,
    };
    if (event.actorType === 'user' && !event.actorId) {
      fail('AUDIT_ACTOR_REQUIRED', 'actorId is required for user audit events.', 'actorId');
    }
    db.prepare(`
      INSERT INTO ${FINANCIAL_AUDIT_EVENTS_TABLE} (
        id, companyId, branchId, aggregateType, aggregateId, eventType,
        actorId, actorType, occurredAt, reason, previousValueJson,
        newValueJson, correlationId, sourceSystem, createdAt
      ) VALUES (
        @id, @companyId, @branchId, @aggregateType, @aggregateId, @eventType,
        @actorId, @actorType, @occurredAt, @reason, @previousValueJson,
        @newValueJson, @correlationId, @sourceSystem, @createdAt
      )
    `).run(event);
    return event;
  }

  function idempotentRow(table, companyId, idempotencyKey, expectedId, fields = {}) {
    const existing = db.prepare(`
      SELECT * FROM ${table}
      WHERE companyId = ? AND idempotencyKey = ?
    `).get(companyId, idempotencyKey);
    if (!existing) return null;
    const same = existing.id === expectedId
      && Object.entries(fields).every(([field, value]) => Object.is(existing[field], value));
    if (!same) {
      fail(
        'DUPLICATE_IDEMPOTENCY_KEY',
        'The company-scoped idempotency key is already used by a different operation.',
        'idempotencyKey',
      );
    }
    return existing;
  }

  function insertApprovalRequest(input) {
    const row = {
      id: requiredText(input.id, 'approvalRequestId'),
      companyId: requiredText(input.companyId, 'companyId'),
      operationType: requiredText(input.operationType, 'operationType'),
      aggregateType: requiredText(input.aggregateType, 'aggregateType'),
      aggregateId: requiredText(input.aggregateId, 'aggregateId'),
      initiatedBy: requiredText(input.initiatedBy, 'initiatedBy'),
      initiatorActorType: input.initiatorActorType || 'user',
      requestedAt: timestamp(input.requestedAt, 'requestedAt'),
      status: 'pending',
      reason: requiredText(input.reason, 'reason'),
      correlationId: requiredText(input.correlationId, 'correlationId'),
      operationPayloadJson: JSON.stringify(input.operationPayload || {}),
      createdAt: timestamp(input.createdAt, 'createdAt'),
      version: 1,
    };
    db.prepare(`
      INSERT INTO ${CANONICAL_APPROVAL_REQUESTS_TABLE} (
        id, companyId, operationType, aggregateType, aggregateId,
        initiatedBy, initiatorActorType, requestedAt, status, reason,
        correlationId, operationPayloadJson, createdAt, version
      ) VALUES (
        @id, @companyId, @operationType, @aggregateType, @aggregateId,
        @initiatedBy, @initiatorActorType, @requestedAt, @status, @reason,
        @correlationId, @operationPayloadJson, @createdAt, @version
      )
    `).run(row);
    return getApprovalRequest({ companyId: row.companyId, id: row.id });
  }

  function approveRequest(approval, input) {
    if (approval.status === 'approved') {
      if (approval.approvedBy === input.approvedBy) return approval;
      fail('APPROVAL_ALREADY_FINAL', 'Approval request already has a final decision.');
    }
    if (approval.status !== 'pending') fail('APPROVAL_ALREADY_FINAL', 'Approval request is already rejected.');
    validateSeparationOfDuties({
      initiatedBy: approval.initiatedBy,
      approvedBy: input.approvedBy,
      initiatorActorType: approval.initiatorActorType,
      approverActorType: input.approverActorType || 'user',
    });
    const result = db.prepare(`
      UPDATE ${CANONICAL_APPROVAL_REQUESTS_TABLE}
      SET status = 'approved',
          approvedBy = @approvedBy,
          approverActorType = @approverActorType,
          approvedAt = @approvedAt,
          version = version + 1
      WHERE companyId = @companyId AND id = @id AND status = 'pending' AND version = @version
    `).run({
      companyId: approval.companyId,
      id: approval.id,
      approvedBy: requiredText(input.approvedBy, 'approvedBy'),
      approverActorType: input.approverActorType || 'user',
      approvedAt: timestamp(input.approvedAt, 'approvedAt'),
      version: approval.version,
    });
    if (result.changes !== 1) fail('STALE_VERSION', 'Approval request changed concurrently.');
    return getApprovalRequest({ companyId: approval.companyId, id: approval.id });
  }

  function rejectRequest(approval, input) {
    const rejectedBy = requiredText(input.rejectedBy, 'rejectedBy');
    const rejectionReason = requiredText(input.rejectionReason, 'rejectionReason');
    if (approval.status === 'rejected') {
      if (approval.rejectedBy === rejectedBy && approval.rejectionReason === rejectionReason) return approval;
      fail('APPROVAL_ALREADY_FINAL', 'Approval request already has a different final decision.');
    }
    if (approval.status !== 'pending') fail('APPROVAL_ALREADY_FINAL', 'Approval request already has a final decision.');
    if (rejectedBy === approval.initiatedBy) {
      fail('SELF_APPROVAL_FORBIDDEN', 'Initiator cannot make the final rejection decision.', 'rejectedBy');
    }
    const result = db.prepare(`
      UPDATE ${CANONICAL_APPROVAL_REQUESTS_TABLE}
      SET status = 'rejected',
          rejectedBy = @rejectedBy,
          rejectedAt = @rejectedAt,
          rejectionReason = @rejectionReason,
          version = version + 1
      WHERE companyId = @companyId AND id = @id AND status = 'pending' AND version = @version
    `).run({
      companyId: approval.companyId,
      id: approval.id,
      rejectedBy,
      rejectedAt: timestamp(input.rejectedAt, 'rejectedAt'),
      rejectionReason,
      version: approval.version,
    });
    if (result.changes !== 1) fail('STALE_VERSION', 'Approval request changed concurrently.');
    return getApprovalRequest({ companyId: approval.companyId, id: approval.id });
  }

  const createCanonicalPaymentTransaction = db.transaction((input = {}) => {
    const companyId = requiredText(input.companyId, 'companyId');
    const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey');
    const id = requiredText(input.id, 'id');
    const existing = idempotentRow(CANONICAL_PAYMENTS_TABLE, companyId, idempotencyKey, id, {
      paymentKind: input.paymentKind,
      receivedAmountMinor: input.receivedAmountMinor,
      branchId: input.branchId,
      clientId: input.clientId,
      externalId: input.externalId ?? null,
      currency: input.currency,
      receivedAt: input.receivedAt,
      workflowStatus: input.workflowStatus,
      sourceSystem: input.sourceSystem,
      sourceDocumentType: input.sourceDocumentType ?? null,
      sourceDocumentId: input.sourceDocumentId ?? null,
      internalTransfer: input.internalTransfer === true || input.internalTransfer === 1
        ? 1
        : input.internalTransfer === false || input.internalTransfer === 0 ? 0 : input.internalTransfer,
      correlationId: input.correlationId,
    });
    if (existing) return existing;
    if (input.paymentKind !== 'receipt') {
      fail('APPROVAL_WORKFLOW_REQUIRED', 'Refunds and reversals must use their approval workflow.', 'paymentKind');
    }
    const row = {
      id,
      companyId,
      branchId: requiredText(input.branchId, 'branchId'),
      clientId: requiredText(input.clientId, 'clientId'),
      externalId: optionalText(input.externalId, 'externalId'),
      idempotencyKey,
      currency: input.currency,
      paymentKind: 'receipt',
      receivedAmountMinor: input.receivedAmountMinor,
      refundAmountMinor: 0,
      receivedAt: timestamp(input.receivedAt, 'receivedAt'),
      workflowStatus: input.workflowStatus,
      sourceSystem: requiredText(input.sourceSystem, 'sourceSystem'),
      sourceDocumentType: optionalText(input.sourceDocumentType, 'sourceDocumentType'),
      sourceDocumentId: optionalText(input.sourceDocumentId, 'sourceDocumentId'),
      internalTransfer: input.internalTransfer ? 1 : 0,
      reversalOfPaymentId: null,
      approvalRequestId: null,
      reason: optionalText(input.reason, 'reason'),
      correlationId: requiredText(input.correlationId, 'correlationId'),
      createdAt: timestamp(input.createdAt, 'createdAt'),
      updatedAt: timestamp(input.updatedAt, 'updatedAt'),
      version: input.version ?? 1,
    };
    validateCanonicalPayment({ ...row, internalTransfer: Boolean(row.internalTransfer) });
    db.prepare(`
      INSERT INTO ${CANONICAL_PAYMENTS_TABLE} (
        id, companyId, branchId, clientId, externalId, idempotencyKey, currency,
        paymentKind, receivedAmountMinor, refundAmountMinor, receivedAt, workflowStatus,
        sourceSystem, sourceDocumentType, sourceDocumentId, internalTransfer,
        reversalOfPaymentId, approvalRequestId, reason, correlationId, createdAt, updatedAt, version
      ) VALUES (
        @id, @companyId, @branchId, @clientId, @externalId, @idempotencyKey, @currency,
        @paymentKind, @receivedAmountMinor, @refundAmountMinor, @receivedAt, @workflowStatus,
        @sourceSystem, @sourceDocumentType, @sourceDocumentId, @internalTransfer,
        @reversalOfPaymentId, @approvalRequestId, @reason, @correlationId, @createdAt, @updatedAt, @version
      )
    `).run(row);
    appendAudit({
      eventType: 'payment_recorded',
      aggregateType: 'payment',
      aggregateId: row.id,
      companyId: row.companyId,
      branchId: row.branchId,
      actorId: input.actorId || null,
      actorType: input.actorType || 'integration',
      occurredAt: row.createdAt,
      reason: row.reason,
      previousValue: null,
      newValue: {
        paymentKind: row.paymentKind,
        receivedAmountMinor: row.receivedAmountMinor,
        currency: row.currency,
        workflowStatus: row.workflowStatus,
      },
      correlationId: row.correlationId,
      sourceSystem: row.sourceSystem,
    });
    return getPayment({ companyId: row.companyId, id: row.id });
  });

  function createCanonicalPayment(input) {
    return runImmediate(createCanonicalPaymentTransaction, input);
  }

  function assertAllocationContract(payment, receivable, input) {
    if (payment.companyId !== receivable.companyId) fail('COMPANY_MISMATCH', 'Cross-company allocation is forbidden.');
    if (payment.clientId !== receivable.clientId) fail('CLIENT_MISMATCH', 'Payment and receivable clients must match.');
    if (payment.currency !== receivable.currency) fail('CURRENCY_MISMATCH', 'Payment and receivable currencies must match.');
    if (payment.workflowStatus !== 'confirmed' || payment.paymentKind !== 'receipt' || payment.internalTransfer === 1) {
      fail('PAYMENT_NOT_ALLOCATABLE', 'Only a confirmed non-transfer receipt can fund allocations.');
    }
    if (!['posted', 'disputed'].includes(receivable.workflowStatus)) {
      fail('RECEIVABLE_NOT_SETTLEABLE', 'Receivable is not in a settleable workflow state.');
    }
    if (input.allocatedAmountMinor > calculatePaymentUnapplied({ companyId: payment.companyId, paymentId: payment.id })) {
      fail('PAYMENT_BALANCE_INSUFFICIENT', 'Payment unapplied balance is insufficient.');
    }
    if (input.allocatedAmountMinor > calculateReceivableOutstanding({ companyId: receivable.companyId, receivableId: receivable.id })) {
      fail('RECEIVABLE_ALREADY_SETTLED', 'Allocation exceeds receivable outstanding balance.');
    }
  }

  const requestAllocationTransaction = db.transaction((input = {}) => {
    const companyId = requiredText(input.companyId, 'companyId');
    const id = requiredText(input.id, 'id');
    const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey');
    const existing = idempotentRow(CANONICAL_PAYMENT_ALLOCATIONS_TABLE, companyId, idempotencyKey, id, {
      paymentId: input.paymentId,
      receivableId: input.receivableId,
      allocatedAmountMinor: input.allocatedAmountMinor,
      allocationKind: input.allocationKind || 'allocation',
      allocationReason: input.allocationReason,
      matchingEvidenceType: input.matchingEvidenceType,
      matchingEvidenceReference: input.matchingEvidenceReference ?? null,
      initiatedBy: input.initiatedBy,
      reversalAllocationId: input.reversalAllocationId ?? null,
      approvalRequestId: input.approvalRequestId ?? null,
      correlationId: input.correlationId,
    });
    if (existing) return existing;
    const payment = paymentOrFail(companyId, requiredText(input.paymentId, 'paymentId'));
    const receivable = receivableOrFail(companyId, requiredText(input.receivableId, 'receivableId'));
    requiredPositiveMinor(input.allocatedAmountMinor, 'allocatedAmountMinor');
    const allocationKind = input.allocationKind || 'allocation';
    if (allocationKind === 'allocation') {
      assertAllocationContract(payment, receivable, input);
    } else {
      const original = allocationOrFail(
        companyId,
        requiredText(input.reversalAllocationId, 'reversalAllocationId'),
      );
      if (
        original.allocationKind !== 'allocation'
        || original.allocationStatus !== 'confirmed'
        || original.paymentId !== payment.id
        || original.receivableId !== receivable.id
        || original.allocatedAmountMinor !== input.allocatedAmountMinor
      ) {
        fail(
          'ALLOCATION_NOT_REVERSIBLE',
          'Allocation reversal must exactly reference a confirmed original allocation.',
          'reversalAllocationId',
        );
      }
      const existingReversal = db.prepare(`
        SELECT * FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}
        WHERE companyId = ? AND reversalAllocationId = ?
          AND allocationStatus IN ('pending', 'confirmed')
      `).get(companyId, original.id);
      if (existingReversal) {
        fail('ALLOCATION_ALREADY_REVERSED', 'The allocation already has a reversal event.');
      }
    }
    const approvalRequired = allocationKind === 'reversal' || requiresAllocationApproval({
      paymentCompanyId: payment.companyId,
      receivableCompanyId: receivable.companyId,
      paymentCurrency: payment.currency,
      receivableCurrency: receivable.currency,
      paymentBranchId: payment.branchId,
      receivableBranchId: receivable.branchId,
      allocatedAmountMinor: input.allocatedAmountMinor,
      matchingEvidenceType: input.matchingEvidenceType,
      matchingEvidenceReference: input.matchingEvidenceReference,
    }, input.policyContext);
    let approvalRequestId = null;
    if (approvalRequired) {
      approvalRequestId = requiredText(input.approvalRequestId, 'approvalRequestId');
      insertApprovalRequest({
        id: approvalRequestId,
        companyId,
        operationType: allocationKind === 'reversal' ? 'allocation_reversal' : 'allocation',
        aggregateType: 'payment_allocation',
        aggregateId: id,
        initiatedBy: input.initiatedBy,
        initiatorActorType: input.initiatorActorType,
        requestedAt: input.initiatedAt,
        reason: input.allocationReason,
        correlationId: input.correlationId,
        operationPayload: {
          paymentId: payment.id,
          receivableId: receivable.id,
          allocatedAmountMinor: input.allocatedAmountMinor,
          reversalAllocationId: input.reversalAllocationId || null,
          currency: payment.currency,
          paymentBranchId: payment.branchId,
          receivableBranchId: receivable.branchId,
          matchingEvidenceType: input.matchingEvidenceType,
          matchingEvidenceReference: input.matchingEvidenceReference || null,
          allocationReason: input.allocationReason,
          correlationId: input.correlationId,
        },
        createdAt: input.createdAt,
      });
    }
    const row = {
      id,
      companyId,
      paymentId: payment.id,
      receivableId: receivable.id,
      paymentBranchId: payment.branchId,
      receivableBranchId: receivable.branchId,
      allocatedAmountMinor: input.allocatedAmountMinor,
      allocationKind,
      allocationStatus: approvalRequired ? 'pending' : 'confirmed',
      allocationReason: requiredText(input.allocationReason, 'allocationReason'),
      matchingEvidenceType: requiredText(input.matchingEvidenceType, 'matchingEvidenceType'),
      matchingEvidenceReference: optionalText(input.matchingEvidenceReference, 'matchingEvidenceReference'),
      initiatedBy: requiredText(input.initiatedBy, 'initiatedBy'),
      initiatedAt: timestamp(input.initiatedAt, 'initiatedAt'),
      approvedBy: null,
      approvedAt: null,
      approvalStatus: approvalRequired ? 'pending' : 'not_required',
      approvalRequestId,
      reversedAt: null,
      reversalAllocationId: optionalText(input.reversalAllocationId, 'reversalAllocationId'),
      idempotencyKey,
      correlationId: requiredText(input.correlationId, 'correlationId'),
      createdAt: timestamp(input.createdAt, 'createdAt'),
      version: 1,
    };
    validateAllocationRecord(row);
    if (!approvalRequired) {
      const paymentVersion = assertAggregateVersion(payment, input.expectedPaymentVersion, 'expectedPaymentVersion');
      const receivableVersion = assertAggregateVersion(receivable, input.expectedReceivableVersion, 'expectedReceivableVersion');
      db.prepare(`
        INSERT INTO ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} (
          id, companyId, paymentId, receivableId, paymentBranchId, receivableBranchId,
          allocatedAmountMinor, allocationKind, allocationStatus, allocationReason,
          matchingEvidenceType, matchingEvidenceReference, initiatedBy, initiatedAt,
          approvedBy, approvedAt, approvalStatus, approvalRequestId, reversedAt,
          reversalAllocationId, idempotencyKey, correlationId, createdAt, version
        ) VALUES (
          @id, @companyId, @paymentId, @receivableId, @paymentBranchId, @receivableBranchId,
          @allocatedAmountMinor, @allocationKind, @allocationStatus, @allocationReason,
          @matchingEvidenceType, @matchingEvidenceReference, @initiatedBy, @initiatedAt,
          @approvedBy, @approvedAt, @approvalStatus, @approvalRequestId, @reversedAt,
          @reversalAllocationId, @idempotencyKey, @correlationId, @createdAt, @version
        )
      `).run(row);
      bumpPaymentVersion(payment, paymentVersion, row.createdAt);
      bumpReceivableVersion(receivable, receivableVersion, row.createdAt);
    } else {
      db.prepare(`
        INSERT INTO ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} (
          id, companyId, paymentId, receivableId, paymentBranchId, receivableBranchId,
          allocatedAmountMinor, allocationKind, allocationStatus, allocationReason,
          matchingEvidenceType, matchingEvidenceReference, initiatedBy, initiatedAt,
          approvedBy, approvedAt, approvalStatus, approvalRequestId, reversedAt,
          reversalAllocationId, idempotencyKey, correlationId, createdAt, version
        ) VALUES (
          @id, @companyId, @paymentId, @receivableId, @paymentBranchId, @receivableBranchId,
          @allocatedAmountMinor, @allocationKind, @allocationStatus, @allocationReason,
          @matchingEvidenceType, @matchingEvidenceReference, @initiatedBy, @initiatedAt,
          @approvedBy, @approvedAt, @approvalStatus, @approvalRequestId, @reversedAt,
          @reversalAllocationId, @idempotencyKey, @correlationId, @createdAt, @version
        )
      `).run(row);
    }
    appendAudit({
      eventType: 'allocation_requested',
      aggregateType: 'payment_allocation',
      aggregateId: row.id,
      companyId,
      branchId: row.receivableBranchId,
      actorId: row.initiatedBy,
      actorType: input.initiatorActorType || 'user',
      occurredAt: row.initiatedAt,
      reason: row.allocationReason,
      previousValue: null,
      newValue: {
        paymentId: row.paymentId,
        receivableId: row.receivableId,
        allocatedAmountMinor: row.allocatedAmountMinor,
        approvalRequired,
        approvalRequestId,
      },
      correlationId: row.correlationId,
      sourceSystem: payment.sourceSystem,
    });
    if (!approvalRequired) {
      appendAudit({
        eventType: 'allocation_approved',
        aggregateType: 'payment_allocation',
        aggregateId: row.id,
        companyId,
        branchId: row.receivableBranchId,
        actorId: row.initiatedBy,
        actorType: input.initiatorActorType || 'user',
        occurredAt: row.createdAt,
        reason: 'D-25 ordinary allocation approval exemption',
        previousValue: { allocationStatus: 'pending' },
        newValue: { allocationStatus: 'confirmed', approvalStatus: 'not_required' },
        correlationId: row.correlationId,
        sourceSystem: payment.sourceSystem,
      });
    }
    return getAllocation({ companyId, id });
  });

  function requestAllocation(input) {
    return runImmediate(requestAllocationTransaction, input);
  }

  const approveAllocationTransaction = db.transaction((input = {}) => {
    const companyId = requiredText(input.companyId, 'companyId');
    const allocation = allocationOrFail(companyId, requiredText(input.allocationId, 'allocationId'));
    if (allocation.allocationStatus === 'confirmed') {
      const approval = allocation.approvalRequestId
        ? getApprovalRequest({ companyId, id: allocation.approvalRequestId })
        : null;
      if (approval?.status === 'approved' && approval.approvedBy === input.approvedBy) return allocation;
      fail('APPROVAL_ALREADY_FINAL', 'Allocation approval already has a different final decision.');
    }
    if (allocation.allocationStatus !== 'pending' || allocation.approvalStatus !== 'pending') {
      fail('ALLOCATION_NOT_PENDING', 'Allocation is not awaiting approval.');
    }
    const operationType = allocation.allocationKind === 'reversal' ? 'allocation_reversal' : 'allocation';
    const approval = approvalOrFail(companyId, allocation.approvalRequestId, operationType, allocation.id);
    const payment = paymentOrFail(companyId, allocation.paymentId);
    const receivable = receivableOrFail(companyId, allocation.receivableId);
    if (allocation.allocationKind === 'allocation') assertAllocationContract(payment, receivable, allocation);
    const paymentVersion = assertAggregateVersion(payment, input.expectedPaymentVersion, 'expectedPaymentVersion');
    const receivableVersion = assertAggregateVersion(receivable, input.expectedReceivableVersion, 'expectedReceivableVersion');
    const approvedAt = timestamp(input.approvedAt, 'approvedAt');
    approveRequest(approval, input);
    const result = db.prepare(`
      UPDATE ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}
      SET allocationStatus = 'confirmed',
          approvalStatus = 'approved',
          approvedBy = @approvedBy,
          approvedAt = @approvedAt,
          reversedAt = CASE WHEN allocationKind = 'reversal' THEN @approvedAt ELSE reversedAt END,
          version = version + 1
      WHERE companyId = @companyId AND id = @id
        AND allocationStatus = 'pending' AND approvalStatus = 'pending' AND version = @version
    `).run({
      companyId,
      id: allocation.id,
      approvedBy: requiredText(input.approvedBy, 'approvedBy'),
      approvedAt,
      version: allocation.version,
    });
    if (result.changes !== 1) fail('STALE_VERSION', 'Allocation changed concurrently.');
    bumpPaymentVersion(payment, paymentVersion, approvedAt);
    bumpReceivableVersion(receivable, receivableVersion, approvedAt);
    const eventType = allocation.allocationKind === 'reversal' ? 'allocation_reversed' : 'allocation_approved';
    appendAudit({
      eventType,
      aggregateType: 'payment_allocation',
      aggregateId: allocation.id,
      companyId,
      branchId: allocation.receivableBranchId,
      actorId: input.approvedBy,
      actorType: input.approverActorType || 'user',
      occurredAt: approvedAt,
      reason: approval.reason,
      previousValue: { allocationStatus: allocation.allocationStatus, approvalStatus: allocation.approvalStatus },
      newValue: {
        allocationStatus: 'confirmed',
        approvalStatus: 'approved',
        approvalRequestId: approval.id,
        reversalAllocationId: allocation.reversalAllocationId,
      },
      correlationId: allocation.correlationId,
      sourceSystem: payment.sourceSystem,
    });
    return getAllocation({ companyId, id: allocation.id });
  });

  function approveAllocation(input) {
    return runImmediate(approveAllocationTransaction, input);
  }

  const rejectAllocationTransaction = db.transaction((input = {}) => {
    const companyId = requiredText(input.companyId, 'companyId');
    const allocation = allocationOrFail(companyId, requiredText(input.allocationId, 'allocationId'));
    const operationType = allocation.allocationKind === 'reversal' ? 'allocation_reversal' : 'allocation';
    const approval = approvalOrFail(companyId, allocation.approvalRequestId, operationType, allocation.id);
    if (allocation.allocationStatus === 'rejected') {
      rejectRequest(approval, input);
      return allocation;
    }
    if (allocation.allocationStatus !== 'pending') fail('ALLOCATION_NOT_PENDING', 'Allocation is not pending.');
    const rejectedAt = timestamp(input.rejectedAt, 'rejectedAt');
    rejectRequest(approval, input);
    const result = db.prepare(`
      UPDATE ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}
      SET allocationStatus = 'rejected', approvalStatus = 'rejected', version = version + 1
      WHERE companyId = ? AND id = ? AND allocationStatus = 'pending' AND version = ?
    `).run(companyId, allocation.id, allocation.version);
    if (result.changes !== 1) fail('STALE_VERSION', 'Allocation changed concurrently.');
    const payment = paymentOrFail(companyId, allocation.paymentId);
    appendAudit({
      eventType: 'allocation_rejected',
      aggregateType: 'payment_allocation',
      aggregateId: allocation.id,
      companyId,
      branchId: allocation.receivableBranchId,
      actorId: input.rejectedBy,
      actorType: 'user',
      occurredAt: rejectedAt,
      reason: input.rejectionReason,
      previousValue: { allocationStatus: 'pending', approvalStatus: 'pending' },
      newValue: { allocationStatus: 'rejected', approvalStatus: 'rejected', approvalRequestId: approval.id },
      correlationId: allocation.correlationId,
      sourceSystem: payment.sourceSystem,
    });
    return getAllocation({ companyId, id: allocation.id });
  });

  function rejectAllocation(input) {
    return runImmediate(rejectAllocationTransaction, input);
  }

  function reverseAllocation(input = {}) {
    const companyId = requiredText(input.companyId, 'companyId');
    const original = allocationOrFail(companyId, requiredText(input.originalAllocationId, 'originalAllocationId'));
    if (original.allocationKind !== 'allocation' || original.allocationStatus !== 'confirmed') {
      fail('ALLOCATION_NOT_REVERSIBLE', 'Only a confirmed original allocation can be reversed.');
    }
    return requestAllocation({
      ...input,
      companyId,
      paymentId: original.paymentId,
      receivableId: original.receivableId,
      allocatedAmountMinor: original.allocatedAmountMinor,
      allocationKind: 'reversal',
      matchingEvidenceType: 'manual_ambiguous',
      matchingEvidenceReference: null,
      reversalAllocationId: original.id,
    });
  }

  const requestAdjustmentTransaction = db.transaction((input = {}) => {
    const companyId = requiredText(input.companyId, 'companyId');
    const id = requiredText(input.id, 'id');
    const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey');
    const existing = idempotentRow(CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE, companyId, idempotencyKey, id, {
      receivableId: input.receivableId,
      adjustmentType: input.adjustmentType,
      amountMinor: input.amountMinor,
      reason: input.reason,
      supportingDocumentReference: input.supportingDocumentReference ?? null,
      sourceDocumentType: input.sourceDocumentType ?? null,
      sourceDocumentId: input.sourceDocumentId ?? null,
      reversesAdjustmentId: input.reversesAdjustmentId ?? null,
      initiatedBy: input.initiatedBy,
      approvalRequestId: input.approvalRequestId,
      correlationId: input.correlationId,
      effectiveAt: input.effectiveAt,
    });
    if (existing) return existing;
    const receivable = receivableOrFail(companyId, requiredText(input.receivableId, 'receivableId'));
    requiredPositiveMinor(input.amountMinor, 'amountMinor');
    requiresAdjustmentApproval(input, input.policyContext);
    let original = null;
    if (input.adjustmentType === 'reversal') {
      original = adjustmentOrFail(companyId, requiredText(input.reversesAdjustmentId, 'reversesAdjustmentId'));
      if (
        original.workflowStatus !== 'confirmed'
        || original.receivableId !== receivable.id
        || original.adjustmentType === 'reversal'
      ) {
        fail('ADJUSTMENT_NOT_REVERSIBLE', 'Referenced adjustment is not a confirmed adjustment for this receivable.');
      }
      if (input.amountMinor !== original.amountMinor) {
        fail('REVERSAL_AMOUNT_MISMATCH', 'Adjustment reversal must exactly compensate the original amount.');
      }
      const existingReversal = db.prepare(`
        SELECT * FROM ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE}
        WHERE companyId = ? AND reversesAdjustmentId = ?
          AND workflowStatus IN ('pending', 'confirmed')
      `).get(companyId, original.id);
      if (existingReversal) {
        fail('ADJUSTMENT_ALREADY_REVERSED', 'The adjustment already has a reversal event.');
      }
    }
    const balanceEffect = adjustmentBalanceEffect(input.adjustmentType, {
      balanceEffect: input.balanceEffect,
      originalBalanceEffect: original?.balanceEffect,
    });
    const approvalRequestId = requiredText(input.approvalRequestId, 'approvalRequestId');
    const operationType = input.adjustmentType === 'write_off'
      ? 'write_off'
      : input.adjustmentType === 'reversal' ? 'adjustment_reversal' : 'adjustment';
    insertApprovalRequest({
      id: approvalRequestId,
      companyId,
      operationType,
      aggregateType: 'receivable_adjustment',
      aggregateId: id,
      initiatedBy: input.initiatedBy,
      initiatorActorType: input.initiatorActorType,
      requestedAt: input.initiatedAt,
      reason: input.reason,
      correlationId: input.correlationId,
      operationPayload: {
        receivableId: receivable.id,
        adjustmentType: input.adjustmentType,
        balanceEffect,
        amountMinor: input.amountMinor,
        reversesAdjustmentId: input.reversesAdjustmentId || null,
        branchId: receivable.branchId,
        currency: receivable.currency,
        reason: input.reason,
        supportingDocumentReference: input.supportingDocumentReference || null,
        sourceDocumentType: input.sourceDocumentType || null,
        sourceDocumentId: input.sourceDocumentId || null,
        correlationId: input.correlationId,
      },
      createdAt: input.createdAt,
    });
    const row = {
      id,
      companyId,
      branchId: receivable.branchId,
      receivableId: receivable.id,
      adjustmentType: input.adjustmentType,
      balanceEffect,
      amountMinor: input.amountMinor,
      workflowStatus: 'pending',
      reason: requiredText(input.reason, 'reason'),
      supportingDocumentReference: optionalText(input.supportingDocumentReference, 'supportingDocumentReference'),
      sourceDocumentType: optionalText(input.sourceDocumentType, 'sourceDocumentType'),
      sourceDocumentId: optionalText(input.sourceDocumentId, 'sourceDocumentId'),
      reversesAdjustmentId: optionalText(input.reversesAdjustmentId, 'reversesAdjustmentId'),
      initiatedBy: requiredText(input.initiatedBy, 'initiatedBy'),
      initiatedAt: timestamp(input.initiatedAt, 'initiatedAt'),
      approvedBy: null,
      approvedAt: null,
      approvalStatus: 'pending',
      approvalRequestId,
      idempotencyKey,
      correlationId: requiredText(input.correlationId, 'correlationId'),
      effectiveAt: timestamp(input.effectiveAt, 'effectiveAt'),
      createdAt: timestamp(input.createdAt, 'createdAt'),
      version: 1,
    };
    validateAdjustmentRecord(row, { originalBalanceEffect: original?.balanceEffect });
    db.prepare(`
      INSERT INTO ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE} (
        id, companyId, branchId, receivableId, adjustmentType, balanceEffect,
        amountMinor, workflowStatus, reason, supportingDocumentReference,
        sourceDocumentType, sourceDocumentId, reversesAdjustmentId,
        initiatedBy, initiatedAt, approvedBy, approvedAt, approvalStatus,
        approvalRequestId, idempotencyKey, correlationId, effectiveAt, createdAt, version
      ) VALUES (
        @id, @companyId, @branchId, @receivableId, @adjustmentType, @balanceEffect,
        @amountMinor, @workflowStatus, @reason, @supportingDocumentReference,
        @sourceDocumentType, @sourceDocumentId, @reversesAdjustmentId,
        @initiatedBy, @initiatedAt, @approvedBy, @approvedAt, @approvalStatus,
        @approvalRequestId, @idempotencyKey, @correlationId, @effectiveAt, @createdAt, @version
      )
    `).run(row);
    appendAudit({
      eventType: input.adjustmentType === 'write_off' ? 'write_off_requested' : 'adjustment_requested',
      aggregateType: 'receivable_adjustment',
      aggregateId: row.id,
      companyId,
      branchId: row.branchId,
      actorId: row.initiatedBy,
      actorType: input.initiatorActorType || 'user',
      occurredAt: row.initiatedAt,
      reason: row.reason,
      previousValue: null,
      newValue: {
        receivableId: row.receivableId,
        adjustmentType: row.adjustmentType,
        balanceEffect: row.balanceEffect,
        amountMinor: row.amountMinor,
        approvalRequestId,
      },
      correlationId: row.correlationId,
      sourceSystem: input.sourceSystem || 'canonical_settlement',
    });
    return getAdjustment({ companyId, id });
  });

  function requestAdjustment(input) {
    return runImmediate(requestAdjustmentTransaction, input);
  }

  const approveAdjustmentTransaction = db.transaction((input = {}) => {
    const companyId = requiredText(input.companyId, 'companyId');
    const adjustment = adjustmentOrFail(companyId, requiredText(input.adjustmentId, 'adjustmentId'));
    if (adjustment.workflowStatus === 'confirmed') {
      const approval = adjustment.approvalRequestId
        ? getApprovalRequest({ companyId, id: adjustment.approvalRequestId })
        : null;
      if (approval?.status === 'approved' && approval.approvedBy === input.approvedBy) return adjustment;
      fail('APPROVAL_ALREADY_FINAL', 'Adjustment approval already has a different final decision.');
    }
    if (adjustment.workflowStatus !== 'pending') fail('ADJUSTMENT_NOT_PENDING', 'Adjustment is not pending.');
    const operationType = adjustment.adjustmentType === 'write_off'
      ? 'write_off'
      : adjustment.adjustmentType === 'reversal' ? 'adjustment_reversal' : 'adjustment';
    const approval = approvalOrFail(companyId, adjustment.approvalRequestId, operationType, adjustment.id);
    const receivable = receivableOrFail(companyId, adjustment.receivableId);
    const receivableVersion = assertAggregateVersion(receivable, input.expectedReceivableVersion, 'expectedReceivableVersion');
    if (
      adjustment.balanceEffect === 'decrease'
      && adjustment.amountMinor > calculateReceivableOutstanding({ companyId, receivableId: receivable.id })
    ) {
      fail('RECEIVABLE_ALREADY_SETTLED', 'Adjustment exceeds receivable outstanding balance.');
    }
    const approvedAt = timestamp(input.approvedAt, 'approvedAt');
    approveRequest(approval, input);
    const result = db.prepare(`
      UPDATE ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE}
      SET workflowStatus = 'confirmed', approvalStatus = 'approved',
          approvedBy = @approvedBy, approvedAt = @approvedAt, version = version + 1
      WHERE companyId = @companyId AND id = @id
        AND workflowStatus = 'pending' AND approvalStatus = 'pending' AND version = @version
    `).run({
      companyId,
      id: adjustment.id,
      approvedBy: requiredText(input.approvedBy, 'approvedBy'),
      approvedAt,
      version: adjustment.version,
    });
    if (result.changes !== 1) fail('STALE_VERSION', 'Adjustment changed concurrently.');
    bumpReceivableVersion(receivable, receivableVersion, approvedAt);
    const eventType = adjustment.adjustmentType === 'write_off'
      ? 'write_off_approved'
      : adjustment.adjustmentType === 'reversal' ? 'adjustment_reversed' : 'adjustment_approved';
    appendAudit({
      eventType,
      aggregateType: 'receivable_adjustment',
      aggregateId: adjustment.id,
      companyId,
      branchId: adjustment.branchId,
      actorId: input.approvedBy,
      actorType: input.approverActorType || 'user',
      occurredAt: approvedAt,
      reason: adjustment.reason,
      previousValue: { workflowStatus: 'pending', approvalStatus: 'pending' },
      newValue: {
        workflowStatus: 'confirmed',
        approvalStatus: 'approved',
        approvalRequestId: approval.id,
        reversesAdjustmentId: adjustment.reversesAdjustmentId,
      },
      correlationId: adjustment.correlationId,
      sourceSystem: input.sourceSystem || 'canonical_settlement',
    });
    return getAdjustment({ companyId, id: adjustment.id });
  });

  function approveAdjustment(input) {
    return runImmediate(approveAdjustmentTransaction, input);
  }

  const rejectAdjustmentTransaction = db.transaction((input = {}) => {
    const companyId = requiredText(input.companyId, 'companyId');
    const adjustment = adjustmentOrFail(companyId, requiredText(input.adjustmentId, 'adjustmentId'));
    const operationType = adjustment.adjustmentType === 'write_off'
      ? 'write_off'
      : adjustment.adjustmentType === 'reversal' ? 'adjustment_reversal' : 'adjustment';
    const approval = approvalOrFail(companyId, adjustment.approvalRequestId, operationType, adjustment.id);
    if (adjustment.workflowStatus === 'rejected') {
      rejectRequest(approval, input);
      return adjustment;
    }
    if (adjustment.workflowStatus !== 'pending') fail('ADJUSTMENT_NOT_PENDING', 'Adjustment is not pending.');
    const rejectedAt = timestamp(input.rejectedAt, 'rejectedAt');
    rejectRequest(approval, input);
    const result = db.prepare(`
      UPDATE ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE}
      SET workflowStatus = 'rejected', approvalStatus = 'rejected', version = version + 1
      WHERE companyId = ? AND id = ? AND workflowStatus = 'pending' AND version = ?
    `).run(companyId, adjustment.id, adjustment.version);
    if (result.changes !== 1) fail('STALE_VERSION', 'Adjustment changed concurrently.');
    appendAudit({
      eventType: 'adjustment_rejected',
      aggregateType: 'receivable_adjustment',
      aggregateId: adjustment.id,
      companyId,
      branchId: adjustment.branchId,
      actorId: input.rejectedBy,
      actorType: 'user',
      occurredAt: rejectedAt,
      reason: input.rejectionReason,
      previousValue: { workflowStatus: 'pending', approvalStatus: 'pending' },
      newValue: { workflowStatus: 'rejected', approvalStatus: 'rejected', approvalRequestId: approval.id },
      correlationId: adjustment.correlationId,
      sourceSystem: input.sourceSystem || 'canonical_settlement',
    });
    return getAdjustment({ companyId, id: adjustment.id });
  });

  function rejectAdjustment(input) {
    return runImmediate(rejectAdjustmentTransaction, input);
  }

  function reverseAdjustment(input = {}) {
    const companyId = requiredText(input.companyId, 'companyId');
    const original = adjustmentOrFail(companyId, requiredText(input.originalAdjustmentId, 'originalAdjustmentId'));
    if (original.workflowStatus !== 'confirmed' || original.adjustmentType === 'reversal') {
      fail('ADJUSTMENT_NOT_REVERSIBLE', 'Only a confirmed adjustment can be reversed.');
    }
    return requestAdjustment({
      ...input,
      companyId,
      receivableId: original.receivableId,
      adjustmentType: 'reversal',
      amountMinor: original.amountMinor,
      reversesAdjustmentId: original.id,
      balanceEffect: adjustmentBalanceEffect('reversal', { originalBalanceEffect: original.balanceEffect }),
    });
  }

  function requestWriteOff(input = {}) {
    return requestAdjustment({ ...input, adjustmentType: 'write_off', balanceEffect: 'decrease' });
  }

  function approveWriteOff(input = {}) {
    return approveAdjustment(input);
  }

  const requestRefundTransaction = db.transaction((input = {}) => {
    const companyId = requiredText(input.companyId, 'companyId');
    const id = requiredText(input.id, 'id');
    const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey');
    const existing = idempotentRow(CANONICAL_PAYMENTS_TABLE, companyId, idempotencyKey, id, {
      paymentKind: input.paymentKind || 'refund',
      receivedAmountMinor: input.refundAmountMinor,
      refundAmountMinor: input.refundAmountMinor,
      reversalOfPaymentId: input.reversalOfPaymentId,
      externalId: input.externalId ?? null,
      receivedAt: input.receivedAt,
      sourceSystem: input.sourceSystem,
      sourceDocumentType: input.sourceDocumentType ?? null,
      sourceDocumentId: input.sourceDocumentId ?? null,
      approvalRequestId: input.approvalRequestId,
      reason: input.reason,
      correlationId: input.correlationId,
    });
    if (existing) return existing;
    const paymentKind = input.paymentKind || 'refund';
    if (!['refund', 'reversal'].includes(paymentKind)) {
      fail('INVALID_PAYMENT_KIND', 'Refund workflow accepts refund or reversal only.', 'paymentKind');
    }
    const referenced = paymentOrFail(companyId, requiredText(input.reversalOfPaymentId, 'reversalOfPaymentId'));
    requiredPositiveMinor(input.refundAmountMinor, 'refundAmountMinor');
    let receipt = referenced;
    if (paymentKind === 'refund') {
      if (referenced.paymentKind !== 'receipt' || referenced.workflowStatus !== 'confirmed') {
        fail('REFUND_SOURCE_INVALID', 'Refund must reference a confirmed receipt.');
      }
      if (input.refundAmountMinor > calculatePaymentUnapplied({ companyId, paymentId: referenced.id })) {
        fail('REFUND_AMOUNT_EXCEEDS_AVAILABLE', 'Refund exceeds available unapplied amount.');
      }
    } else {
      if (!['receipt', 'refund'].includes(referenced.paymentKind) || referenced.workflowStatus !== 'confirmed') {
        fail('REFUND_REVERSAL_SOURCE_INVALID', 'Reversal must reference a confirmed receipt or refund.');
      }
      const existingReversal = db.prepare(`
        SELECT * FROM ${CANONICAL_PAYMENTS_TABLE}
        WHERE companyId = ? AND paymentKind = 'reversal' AND reversalOfPaymentId = ?
      `).get(companyId, referenced.id);
      if (existingReversal) {
        fail('PAYMENT_EVENT_ALREADY_REVERSED', 'The referenced payment event already has a reversal.');
      }
      if (referenced.paymentKind === 'refund') {
        receipt = paymentOrFail(companyId, referenced.reversalOfPaymentId);
        if (input.refundAmountMinor !== referenced.refundAmountMinor) {
          fail('REVERSAL_AMOUNT_MISMATCH', 'Refund reversal must exactly compensate the refund.');
        }
      } else if (input.refundAmountMinor !== referenced.receivedAmountMinor) {
        fail('REVERSAL_AMOUNT_MISMATCH', 'Payment reversal must exactly compensate the receipt.');
      }
    }
    const approvalRequestId = requiredText(input.approvalRequestId, 'approvalRequestId');
    insertApprovalRequest({
      id: approvalRequestId,
      companyId,
      operationType: paymentKind === 'reversal' && referenced.paymentKind === 'refund'
        ? 'refund_reversal'
        : 'refund',
      aggregateType: 'payment',
      aggregateId: id,
      initiatedBy: input.initiatedBy,
      initiatorActorType: input.initiatorActorType,
      requestedAt: input.initiatedAt,
      reason: input.reason,
      correlationId: input.correlationId,
      operationPayload: {
        paymentKind,
        reversalOfPaymentId: referenced.id,
        receiptId: receipt.id,
        refundAmountMinor: input.refundAmountMinor,
        currency: receipt.currency,
        branchId: receipt.branchId,
        reason: input.reason,
        correlationId: input.correlationId,
      },
      createdAt: input.createdAt,
    });
    const row = {
      id,
      companyId,
      branchId: receipt.branchId,
      clientId: receipt.clientId,
      externalId: optionalText(input.externalId, 'externalId'),
      idempotencyKey,
      currency: receipt.currency,
      paymentKind,
      receivedAmountMinor: input.refundAmountMinor,
      refundAmountMinor: input.refundAmountMinor,
      receivedAt: timestamp(input.receivedAt, 'receivedAt'),
      workflowStatus: 'pending',
      sourceSystem: requiredText(input.sourceSystem, 'sourceSystem'),
      sourceDocumentType: optionalText(input.sourceDocumentType, 'sourceDocumentType'),
      sourceDocumentId: optionalText(input.sourceDocumentId, 'sourceDocumentId'),
      internalTransfer: 0,
      reversalOfPaymentId: referenced.id,
      approvalRequestId,
      reason: requiredText(input.reason, 'reason'),
      correlationId: requiredText(input.correlationId, 'correlationId'),
      createdAt: timestamp(input.createdAt, 'createdAt'),
      updatedAt: timestamp(input.updatedAt || input.createdAt, 'updatedAt'),
      version: 1,
    };
    validateCanonicalPayment({ ...row, internalTransfer: false });
    db.prepare(`
      INSERT INTO ${CANONICAL_PAYMENTS_TABLE} (
        id, companyId, branchId, clientId, externalId, idempotencyKey, currency,
        paymentKind, receivedAmountMinor, refundAmountMinor, receivedAt, workflowStatus,
        sourceSystem, sourceDocumentType, sourceDocumentId, internalTransfer,
        reversalOfPaymentId, approvalRequestId, reason, correlationId, createdAt, updatedAt, version
      ) VALUES (
        @id, @companyId, @branchId, @clientId, @externalId, @idempotencyKey, @currency,
        @paymentKind, @receivedAmountMinor, @refundAmountMinor, @receivedAt, @workflowStatus,
        @sourceSystem, @sourceDocumentType, @sourceDocumentId, @internalTransfer,
        @reversalOfPaymentId, @approvalRequestId, @reason, @correlationId, @createdAt, @updatedAt, @version
      )
    `).run(row);
    appendAudit({
      eventType: 'refund_requested',
      aggregateType: 'payment',
      aggregateId: row.id,
      companyId,
      branchId: row.branchId,
      actorId: input.initiatedBy,
      actorType: input.initiatorActorType || 'user',
      occurredAt: input.initiatedAt,
      reason: row.reason,
      previousValue: null,
      newValue: {
        paymentKind: row.paymentKind,
        reversalOfPaymentId: row.reversalOfPaymentId,
        refundAmountMinor: row.refundAmountMinor,
        approvalRequestId,
      },
      correlationId: row.correlationId,
      sourceSystem: row.sourceSystem,
    });
    return getPayment({ companyId, id });
  });

  function requestRefund(input) {
    return runImmediate(requestRefundTransaction, input);
  }

  function reverseRefund(input = {}) {
    const companyId = requiredText(input.companyId, 'companyId');
    const refund = paymentOrFail(companyId, requiredText(input.refundPaymentId, 'refundPaymentId'));
    if (refund.paymentKind !== 'refund' || refund.workflowStatus !== 'confirmed') {
      fail('REFUND_NOT_REVERSIBLE', 'Only a confirmed refund can be reversed.');
    }
    return requestRefund({
      ...input,
      companyId,
      paymentKind: 'reversal',
      reversalOfPaymentId: refund.id,
      refundAmountMinor: refund.refundAmountMinor,
    });
  }

  const approveRefundTransaction = db.transaction((input = {}) => {
    const companyId = requiredText(input.companyId, 'companyId');
    const refund = paymentOrFail(companyId, requiredText(input.refundPaymentId, 'refundPaymentId'));
    if (refund.workflowStatus === 'confirmed') {
      const approval = refund.approvalRequestId
        ? getApprovalRequest({ companyId, id: refund.approvalRequestId })
        : null;
      if (approval?.status === 'approved' && approval.approvedBy === input.approvedBy) return refund;
      fail('APPROVAL_ALREADY_FINAL', 'Refund approval already has a different final decision.');
    }
    if (refund.workflowStatus !== 'pending' || !['refund', 'reversal'].includes(refund.paymentKind)) {
      fail('REFUND_NOT_PENDING', 'Refund or reversal is not pending.');
    }
    const referenced = paymentOrFail(companyId, refund.reversalOfPaymentId);
    const receipt = referenced.paymentKind === 'refund'
      ? paymentOrFail(companyId, referenced.reversalOfPaymentId)
      : referenced;
    const operationType = refund.paymentKind === 'reversal' && referenced.paymentKind === 'refund'
      ? 'refund_reversal'
      : 'refund';
    const approval = approvalOrFail(companyId, refund.approvalRequestId, operationType, refund.id);
    const receiptVersion = assertAggregateVersion(receipt, input.expectedPaymentVersion, 'expectedPaymentVersion');
    if (refund.paymentKind === 'refund') {
      if (refund.refundAmountMinor > calculatePaymentUnapplied({ companyId, paymentId: receipt.id })) {
        fail('REFUND_AMOUNT_EXCEEDS_AVAILABLE', 'Refund exceeds available unapplied amount.');
      }
    } else if (referenced.paymentKind === 'receipt') {
      if (netAllocationMinor({ companyId, paymentId: receipt.id }) !== 0) {
        fail('ALLOCATION_REVERSAL_REQUIRED', 'All allocations must be reversed before payment reversal.');
      }
      if (refund.refundAmountMinor > calculatePaymentUnapplied({ companyId, paymentId: receipt.id })) {
        fail('REFUND_AMOUNT_EXCEEDS_AVAILABLE', 'Payment reversal exceeds available amount.');
      }
    }
    const approvedAt = timestamp(input.approvedAt, 'approvedAt');
    approveRequest(approval, input);
    const result = db.prepare(`
      UPDATE ${CANONICAL_PAYMENTS_TABLE}
      SET workflowStatus = 'confirmed', updatedAt = @approvedAt, version = version + 1
      WHERE companyId = @companyId AND id = @id
        AND workflowStatus = 'pending' AND version = @version
    `).run({ companyId, id: refund.id, approvedAt, version: refund.version });
    if (result.changes !== 1) fail('STALE_VERSION', 'Refund changed concurrently.');
    bumpPaymentVersion(receipt, receiptVersion, approvedAt);
    appendAudit({
      eventType: operationType === 'refund_reversal' ? 'refund_reversed' : 'refund_approved',
      aggregateType: 'payment',
      aggregateId: refund.id,
      companyId,
      branchId: refund.branchId,
      actorId: input.approvedBy,
      actorType: input.approverActorType || 'user',
      occurredAt: approvedAt,
      reason: refund.reason,
      previousValue: { workflowStatus: 'pending' },
      newValue: {
        workflowStatus: 'confirmed',
        approvalRequestId: approval.id,
        reversalOfPaymentId: refund.reversalOfPaymentId,
      },
      correlationId: refund.correlationId,
      sourceSystem: refund.sourceSystem,
    });
    return getPayment({ companyId, id: refund.id });
  });

  function approveRefund(input) {
    return runImmediate(approveRefundTransaction, input);
  }

  const requestDueDateChangeTransaction = db.transaction((input = {}) => {
    const companyId = requiredText(input.companyId, 'companyId');
    const receivable = receivableOrFail(companyId, requiredText(input.receivableId, 'receivableId'));
    const hasAllocationHistory = db.prepare(`
      SELECT EXISTS(
        SELECT 1 FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}
        WHERE companyId = ? AND receivableId = ?
      ) AS value
    `).get(companyId, receivable.id).value === 1;
    const operation = validateDueDateChangeOperation({
      ...input,
      priorDueDate: receivable.contractualDueDate,
      priorProvenance: receivable.dueDateProvenance,
      hasAllocationHistory,
    });
    const approvalRequestId = operation.approvalRequired
      ? requiredText(input.approvalRequestId, 'approvalRequestId')
      : null;
    const payload = {
      requestedDueDate: input.requestedDueDate ?? null,
      priorDueDate: receivable.contractualDueDate,
      provenance: input.provenance,
      priorProvenance: receivable.dueDateProvenance,
      effectiveAt: input.effectiveAt,
      branchId: receivable.branchId,
      currency: receivable.currency,
      correlationId: input.correlationId,
      approvalRequired: operation.approvalRequired,
      approvalRequestId,
    };
    appendAudit({
      eventType: 'due_date_change_requested',
      aggregateType: 'receivable',
      aggregateId: receivable.id,
      companyId,
      branchId: receivable.branchId,
      actorId: input.initiatedBy,
      actorType: input.initiatorActorType || 'user',
      occurredAt: input.effectiveAt,
      reason: input.reason,
      previousValue: { contractualDueDate: receivable.contractualDueDate, dueDateProvenance: receivable.dueDateProvenance },
      newValue: payload,
      correlationId: input.correlationId,
      sourceSystem: input.sourceSystem || 'canonical_settlement',
    });
    if (operation.approvalRequired) {
      insertApprovalRequest({
        id: approvalRequestId,
        companyId,
        operationType: 'due_date_change',
        aggregateType: 'receivable',
        aggregateId: receivable.id,
        initiatedBy: input.initiatedBy,
        initiatorActorType: input.initiatorActorType,
        requestedAt: input.effectiveAt,
        reason: input.reason,
        correlationId: input.correlationId,
        operationPayload: payload,
        createdAt: input.effectiveAt,
      });
      return { approvalRequired: true, receivable, approvalRequestId };
    }
    const receivableVersion = assertAggregateVersion(receivable, input.expectedReceivableVersion, 'expectedReceivableVersion');
    const result = db.prepare(`
      UPDATE ${CANONICAL_RECEIVABLES_TABLE}
      SET contractualDueDate = @requestedDueDate,
          dueDateProvenance = @provenance,
          updatedAt = @effectiveAt,
          version = version + 1
      WHERE companyId = @companyId AND id = @id AND version = @version
    `).run({
      companyId,
      id: receivable.id,
      requestedDueDate: payload.requestedDueDate,
      provenance: payload.provenance,
      effectiveAt: payload.effectiveAt,
      version: receivableVersion,
    });
    if (result.changes !== 1) fail('STALE_VERSION', 'Receivable version is stale.');
    appendAudit({
      eventType: 'due_date_change_approved',
      aggregateType: 'receivable',
      aggregateId: receivable.id,
      companyId,
      branchId: receivable.branchId,
      actorId: input.initiatedBy,
      actorType: input.initiatorActorType || 'user',
      occurredAt: input.effectiveAt,
      reason: input.reason,
      previousValue: { contractualDueDate: receivable.contractualDueDate, dueDateProvenance: receivable.dueDateProvenance },
      newValue: { contractualDueDate: payload.requestedDueDate, dueDateProvenance: payload.provenance, approvalRequired: false },
      correlationId: input.correlationId,
      sourceSystem: input.sourceSystem || 'canonical_settlement',
    });
    return {
      approvalRequired: false,
      receivable: receivableOrFail(companyId, receivable.id),
      approvalRequestId: null,
    };
  });

  function requestDueDateChange(input) {
    return runImmediate(requestDueDateChangeTransaction, input);
  }

  const approveDueDateChangeTransaction = db.transaction((input = {}) => {
    const companyId = requiredText(input.companyId, 'companyId');
    const approval = approvalOrFail(
      companyId,
      requiredText(input.approvalRequestId, 'approvalRequestId'),
      'due_date_change',
      requiredText(input.receivableId, 'receivableId'),
    );
    const receivable = receivableOrFail(companyId, approval.aggregateId);
    if (approval.status === 'approved') {
      if (approval.approvedBy === input.approvedBy) return receivable;
      fail('APPROVAL_ALREADY_FINAL', 'Due-date approval already has a different final decision.');
    }
    const payload = parsePayload(approval.operationPayloadJson);
    const receivableVersion = assertAggregateVersion(receivable, input.expectedReceivableVersion, 'expectedReceivableVersion');
    approveRequest(approval, input);
    const result = db.prepare(`
      UPDATE ${CANONICAL_RECEIVABLES_TABLE}
      SET contractualDueDate = @requestedDueDate,
          dueDateProvenance = @provenance,
          updatedAt = @approvedAt,
          version = version + 1
      WHERE companyId = @companyId AND id = @id AND version = @version
    `).run({
      companyId,
      id: receivable.id,
      requestedDueDate: payload.requestedDueDate,
      provenance: payload.provenance,
      approvedAt: timestamp(input.approvedAt, 'approvedAt'),
      version: receivableVersion,
    });
    if (result.changes !== 1) fail('STALE_VERSION', 'Receivable version is stale.');
    appendAudit({
      eventType: 'due_date_change_approved',
      aggregateType: 'receivable',
      aggregateId: receivable.id,
      companyId,
      branchId: receivable.branchId,
      actorId: input.approvedBy,
      actorType: input.approverActorType || 'user',
      occurredAt: input.approvedAt,
      reason: approval.reason,
      previousValue: { contractualDueDate: payload.priorDueDate, dueDateProvenance: payload.priorProvenance },
      newValue: {
        contractualDueDate: payload.requestedDueDate,
        dueDateProvenance: payload.provenance,
        approvalRequestId: approval.id,
      },
      correlationId: approval.correlationId,
      sourceSystem: input.sourceSystem || 'canonical_settlement',
    });
    return receivableOrFail(companyId, receivable.id);
  });

  function approveDueDateChange(input) {
    return runImmediate(approveDueDateChangeTransaction, input);
  }

  const requestCancellationTransaction = db.transaction((input = {}) => {
    const companyId = requiredText(input.companyId, 'companyId');
    const receivable = receivableOrFail(companyId, requiredText(input.receivableId, 'receivableId'));
    const hasActiveAllocation = hasUncompensatedAllocation(companyId, receivable.id);
    const hasActiveAdjustment = hasUncompensatedAdjustment(companyId, receivable.id);
    const operation = validateCancellationOperation({
      ...input,
      workflowStatus: receivable.workflowStatus,
      hasActiveAllocation,
      hasActiveAdjustment,
    });
    const approvalRequestId = operation.approvalRequired
      ? requiredText(input.approvalRequestId, 'approvalRequestId')
      : null;
    const cancelledAt = timestamp(input.cancelledAt, 'cancelledAt');
    appendAudit({
      eventType: 'cancellation_requested',
      aggregateType: 'receivable',
      aggregateId: receivable.id,
      companyId,
      branchId: receivable.branchId,
      actorId: input.initiatedBy,
      actorType: input.initiatorActorType || 'user',
      occurredAt: cancelledAt,
      reason: input.reason,
      previousValue: { workflowStatus: receivable.workflowStatus },
      newValue: {
        workflowStatus: 'cancelled',
        approvalRequired: operation.approvalRequired,
        approvalRequestId,
      },
      correlationId: input.correlationId,
      sourceSystem: input.sourceSystem || 'canonical_settlement',
    });
    if (operation.approvalRequired) {
      insertApprovalRequest({
        id: approvalRequestId,
        companyId,
        operationType: 'posted_receivable_cancellation',
        aggregateType: 'receivable',
        aggregateId: receivable.id,
        initiatedBy: input.initiatedBy,
        initiatorActorType: input.initiatorActorType,
        requestedAt: cancelledAt,
        reason: input.reason,
        correlationId: input.correlationId,
        operationPayload: {
          cancelledAt,
          priorWorkflowStatus: receivable.workflowStatus,
          branchId: receivable.branchId,
          currency: receivable.currency,
          correlationId: input.correlationId,
        },
        createdAt: cancelledAt,
      });
      return { approvalRequired: true, receivable, approvalRequestId };
    }
    const version = assertAggregateVersion(receivable, input.expectedReceivableVersion, 'expectedReceivableVersion');
    const result = db.prepare(`
      UPDATE ${CANONICAL_RECEIVABLES_TABLE}
      SET workflowStatus = 'cancelled', cancellationReason = @reason,
          cancelledAt = @cancelledAt, updatedAt = @cancelledAt, version = version + 1
      WHERE companyId = @companyId AND id = @id AND version = @version
    `).run({ companyId, id: receivable.id, reason: input.reason, cancelledAt, version });
    if (result.changes !== 1) fail('STALE_VERSION', 'Receivable version is stale.');
    appendAudit({
      eventType: 'cancellation_approved',
      aggregateType: 'receivable',
      aggregateId: receivable.id,
      companyId,
      branchId: receivable.branchId,
      actorId: input.initiatedBy,
      actorType: input.initiatorActorType || 'user',
      occurredAt: cancelledAt,
      reason: input.reason,
      previousValue: { workflowStatus: receivable.workflowStatus },
      newValue: { workflowStatus: 'cancelled', approvalRequired: false },
      correlationId: input.correlationId,
      sourceSystem: input.sourceSystem || 'canonical_settlement',
    });
    return { approvalRequired: false, receivable: receivableOrFail(companyId, receivable.id), approvalRequestId: null };
  });

  function requestCancellation(input) {
    return runImmediate(requestCancellationTransaction, input);
  }

  const approveCancellationTransaction = db.transaction((input = {}) => {
    const companyId = requiredText(input.companyId, 'companyId');
    const approval = approvalOrFail(
      companyId,
      requiredText(input.approvalRequestId, 'approvalRequestId'),
      'posted_receivable_cancellation',
      requiredText(input.receivableId, 'receivableId'),
    );
    const receivable = receivableOrFail(companyId, approval.aggregateId);
    if (approval.status === 'approved') {
      if (approval.approvedBy === input.approvedBy) return receivable;
      fail('APPROVAL_ALREADY_FINAL', 'Cancellation approval already has a different final decision.');
    }
    const hasActiveAllocation = hasUncompensatedAllocation(companyId, receivable.id);
    const hasActiveAdjustment = hasUncompensatedAdjustment(companyId, receivable.id);
    validateCancellationOperation({
      receivableId: receivable.id,
      reason: approval.reason,
      initiatedBy: approval.initiatedBy,
      workflowStatus: receivable.workflowStatus,
      hasActiveAllocation,
      hasActiveAdjustment,
    });
    const version = assertAggregateVersion(receivable, input.expectedReceivableVersion, 'expectedReceivableVersion');
    const approvedAt = timestamp(input.approvedAt, 'approvedAt');
    approveRequest(approval, input);
    const result = db.prepare(`
      UPDATE ${CANONICAL_RECEIVABLES_TABLE}
      SET workflowStatus = 'cancelled', cancellationReason = @reason,
          cancelledAt = @approvedAt, updatedAt = @approvedAt, version = version + 1
      WHERE companyId = @companyId AND id = @id AND version = @version
    `).run({ companyId, id: receivable.id, reason: approval.reason, approvedAt, version });
    if (result.changes !== 1) fail('STALE_VERSION', 'Receivable version is stale.');
    appendAudit({
      eventType: 'cancellation_approved',
      aggregateType: 'receivable',
      aggregateId: receivable.id,
      companyId,
      branchId: receivable.branchId,
      actorId: input.approvedBy,
      actorType: input.approverActorType || 'user',
      occurredAt: approvedAt,
      reason: approval.reason,
      previousValue: { workflowStatus: receivable.workflowStatus },
      newValue: { workflowStatus: 'cancelled', approvalRequestId: approval.id },
      correlationId: approval.correlationId,
      sourceSystem: input.sourceSystem || 'canonical_settlement',
    });
    return receivableOrFail(companyId, receivable.id);
  });

  function approveCancellation(input) {
    return runImmediate(approveCancellationTransaction, input);
  }

  return Object.freeze({
    approveAllocation,
    approveCancellation,
    approveDueDateChange,
    approveAdjustment,
    approveRefund,
    approveWriteOff,
    calculatePaymentUnapplied,
    calculateReceivableOutstanding,
    createCanonicalPayment,
    getAdjustment,
    getAllocation,
    getApprovalRequest,
    getPayment,
    rejectAdjustment,
    rejectAllocation,
    requestAdjustment,
    requestAllocation,
    requestCancellation,
    requestDueDateChange,
    requestRefund,
    requestWriteOff,
    reverseAdjustment,
    reverseAllocation,
    reverseRefund,
  });
}

module.exports = {
  CanonicalSettlementRepositoryError,
  createCanonicalSettlementRepository,
};
