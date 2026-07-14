const PAYMENT_KINDS = Object.freeze(['receipt', 'refund', 'reversal']);
const PAYMENT_WORKFLOW_STATUSES = Object.freeze(['pending', 'confirmed', 'failed', 'cancelled']);
const ALLOCATION_KINDS = Object.freeze(['allocation', 'reversal']);
const ALLOCATION_STATUSES = Object.freeze(['pending', 'confirmed', 'rejected', 'cancelled']);
const APPROVAL_STATUSES = Object.freeze(['not_required', 'pending', 'approved', 'rejected']);
const ADJUSTMENT_TYPES = Object.freeze([
  'credit',
  'debit',
  'discount',
  'penalty',
  'correction',
  'write_off',
  'refund_effect',
  'reversal',
]);
const BALANCE_EFFECTS = Object.freeze(['increase', 'decrease', 'none']);
const TRUSTED_ALLOCATION_EVIDENCE_TYPES = Object.freeze([
  'exact_document_reference',
  'explicit_client_instruction',
]);
const ALLOCATION_EVIDENCE_TYPES = Object.freeze([
  ...TRUSTED_ALLOCATION_EVIDENCE_TYPES,
  'manual_ambiguous',
]);
const SENSITIVE_OPERATION_TYPES = Object.freeze([
  'refund',
  'adjustment',
  'reversal',
  'write_off',
  'due_date_change_after_allocation',
  'posted_receivable_cancellation',
]);

class CanonicalSettlementDomainError extends Error {
  constructor(code, message, field) {
    super(message);
    this.name = 'CanonicalSettlementDomainError';
    this.code = code;
    this.field = field;
  }
}

function fail(code, message, field) {
  throw new CanonicalSettlementDomainError(code, message, field);
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('REQUIRED_FIELD', `${field} is required.`, field);
  }
  return value.trim();
}

function optionalText(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) {
    fail('INVALID_TEXT', `${field} must be non-empty text when supplied.`, field);
  }
  return value.trim();
}

function validateInstant(value, field) {
  const timestamp = requiredText(value, field);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(timestamp)
    || Number.isNaN(Date.parse(timestamp))
  ) {
    fail('INVALID_TIMESTAMP', `${field} must be an RFC 3339 UTC timestamp.`, field);
  }
  return timestamp;
}

function isDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function validateDueDateContract(input = {}) {
  const provenances = [
    'invoice_due_date',
    'contractual_payment_due_date',
    'installment_due_date',
    'migrated_verified',
    'unknown',
  ];
  if (!provenances.includes(input.dueDateProvenance)) {
    fail('INVALID_DUE_DATE_PROVENANCE', 'dueDateProvenance is not approved.', 'dueDateProvenance');
  }
  if (input.dueDateProvenance !== 'unknown' && !input.contractualDueDate) {
    fail(
      'CONTRACTUAL_DUE_DATE_REQUIRED',
      'Accepted due-date provenance requires a contractual date.',
      'contractualDueDate',
    );
  }
  if (input.contractualDueDate !== null && input.contractualDueDate !== undefined) {
    if (!isDateOnly(input.contractualDueDate)) {
      fail('INVALID_DATE', 'contractualDueDate must be a valid YYYY-MM-DD date.', 'contractualDueDate');
    }
  }
  return true;
}

function positiveMinor(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail('INVALID_MINOR_UNIT_AMOUNT', `${field} must be a positive safe integer.`, field);
  }
  return value;
}

function nonNegativeMinor(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('INVALID_MINOR_UNIT_AMOUNT', `${field} must be a non-negative safe integer.`, field);
  }
  return value;
}

function safeAdd(left, right, field = 'amountMinor') {
  const value = left + right;
  if (!Number.isSafeInteger(value)) {
    fail('MINOR_UNIT_OVERFLOW', `${field} exceeds safe integer range.`, field);
  }
  return value;
}

function normalizeCapabilities(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value.map(item => String(item || '').trim()).filter(Boolean));
  return new Set();
}

function validateSeparationOfDuties(input = {}) {
  const initiatedBy = requiredText(input.initiatedBy, 'initiatedBy');
  const approvedBy = requiredText(input.approvedBy, 'approvedBy');
  if (initiatedBy === approvedBy) {
    fail('SELF_APPROVAL_FORBIDDEN', 'Initiator and approver must be different users.', 'approvedBy');
  }
  const initiatorActorType = input.initiatorActorType || 'user';
  const approverActorType = input.approverActorType || 'user';
  if (!['user', 'system', 'integration'].includes(initiatorActorType)) {
    fail('INVALID_ACTOR_TYPE', 'initiatorActorType is not approved.', 'initiatorActorType');
  }
  if (approverActorType !== 'user') {
    fail(
      'APPROVER_MUST_BE_USER',
      'System and integration actors cannot approve sensitive operations.',
      'approverActorType',
    );
  }
  return true;
}

function canApproveOperation(input = {}, policy = {}) {
  try {
    validateSeparationOfDuties(input);
  } catch (error) {
    if (error instanceof CanonicalSettlementDomainError) return false;
    throw error;
  }
  const capabilities = normalizeCapabilities(input.capabilities);
  const requiredCapabilities = Array.isArray(policy.requiredCapabilities)
    ? policy.requiredCapabilities
    : [];
  return requiredCapabilities.every(capability => capabilities.has(capability));
}

function requiresAllocationApproval(input = {}, policy = {}) {
  const paymentCompanyId = requiredText(input.paymentCompanyId, 'paymentCompanyId');
  const receivableCompanyId = requiredText(input.receivableCompanyId, 'receivableCompanyId');
  if (paymentCompanyId !== receivableCompanyId) {
    fail('COMPANY_MISMATCH', 'Cross-company allocation is forbidden.', 'companyId');
  }
  if (input.paymentCurrency !== input.receivableCurrency) {
    fail('CURRENCY_MISMATCH', 'Payment and receivable currencies must match.', 'currency');
  }
  positiveMinor(input.allocatedAmountMinor, 'allocatedAmountMinor');
  const evidenceType = requiredText(input.matchingEvidenceType, 'matchingEvidenceType');
  if (!ALLOCATION_EVIDENCE_TYPES.includes(evidenceType)) {
    fail('INVALID_MATCHING_EVIDENCE', 'matchingEvidenceType is not approved.', 'matchingEvidenceType');
  }
  const reference = optionalText(input.matchingEvidenceReference, 'matchingEvidenceReference');
  const evidenceIsStructurallyTrusted = TRUSTED_ALLOCATION_EVIDENCE_TYPES.includes(evidenceType)
    && Boolean(reference);
  const verifyMatchingEvidence = policy.verifyMatchingEvidence;
  const trustedEvidence = evidenceIsStructurallyTrusted
    && typeof verifyMatchingEvidence === 'function'
    && verifyMatchingEvidence(Object.freeze({
      evidenceType,
      reference,
      paymentCompanyId,
      receivableCompanyId,
      paymentBranchId: input.paymentBranchId,
      receivableBranchId: input.receivableBranchId,
      paymentCurrency: input.paymentCurrency,
      receivableCurrency: input.receivableCurrency,
      allocatedAmountMinor: input.allocatedAmountMinor,
    })) === true;
  const sameBranch = requiredText(input.paymentBranchId, 'paymentBranchId')
    === requiredText(input.receivableBranchId, 'receivableBranchId');
  if (policy.forceApproval === true) return true;
  return !(sameBranch && trustedEvidence);
}

function requiresAdjustmentApproval(input = {}, _policy = {}) {
  const type = requiredText(input.adjustmentType, 'adjustmentType');
  if (!ADJUSTMENT_TYPES.includes(type)) {
    fail('INVALID_ADJUSTMENT_TYPE', 'adjustmentType is not approved.', 'adjustmentType');
  }
  return true;
}

function requiresSensitiveOperationApproval(operationType, context = {}, policy = {}) {
  const type = requiredText(operationType, 'operationType');
  if (type === 'allocation') return requiresAllocationApproval(context, policy);
  if (!SENSITIVE_OPERATION_TYPES.includes(type)) {
    fail('INVALID_OPERATION_TYPE', 'operationType is not approved.', 'operationType');
  }
  return true;
}

function adjustmentBalanceEffect(adjustmentType, context = {}) {
  const type = requiredText(adjustmentType, 'adjustmentType');
  if (!ADJUSTMENT_TYPES.includes(type)) {
    fail('INVALID_ADJUSTMENT_TYPE', 'adjustmentType is not approved.', 'adjustmentType');
  }
  if (['debit', 'penalty'].includes(type)) return 'increase';
  if (['credit', 'discount', 'write_off'].includes(type)) return 'decrease';
  if (type === 'refund_effect') return 'none';
  if (type === 'correction') {
    if (!['increase', 'decrease'].includes(context.balanceEffect)) {
      fail(
        'CORRECTION_EFFECT_REQUIRED',
        'A correction requires an explicit increase or decrease balanceEffect.',
        'balanceEffect',
      );
    }
    return context.balanceEffect;
  }
  if (!['increase', 'decrease', 'none'].includes(context.originalBalanceEffect)) {
    fail(
      'REVERSAL_EFFECT_REQUIRED',
      'A reversal requires the referenced adjustment balance effect.',
      'originalBalanceEffect',
    );
  }
  if (context.originalBalanceEffect === 'increase') return 'decrease';
  if (context.originalBalanceEffect === 'decrease') return 'increase';
  return 'none';
}

function validateCanonicalPayment(input = {}) {
  for (const field of ['id', 'companyId', 'branchId', 'clientId', 'idempotencyKey', 'currency', 'sourceSystem']) {
    requiredText(input[field], field);
  }
  const paymentKind = requiredText(input.paymentKind, 'paymentKind');
  const workflowStatus = requiredText(input.workflowStatus, 'workflowStatus');
  if (!PAYMENT_KINDS.includes(paymentKind)) {
    fail('INVALID_PAYMENT_KIND', 'paymentKind is not approved.', 'paymentKind');
  }
  if (!PAYMENT_WORKFLOW_STATUSES.includes(workflowStatus)) {
    fail('INVALID_PAYMENT_STATUS', 'workflowStatus is not approved.', 'workflowStatus');
  }
  if (input.currency !== 'RUB') {
    fail('UNSUPPORTED_CURRENCY', 'The initial settlement release supports RUB only.', 'currency');
  }
  positiveMinor(input.receivedAmountMinor, 'receivedAmountMinor');
  nonNegativeMinor(input.refundAmountMinor, 'refundAmountMinor');
  if (paymentKind === 'receipt') {
    positiveMinor(input.receivedAmountMinor, 'receivedAmountMinor');
    if (input.refundAmountMinor !== 0 || input.reversalOfPaymentId) {
      fail('INVALID_RECEIPT_SHAPE', 'A receipt cannot carry refund or reversal fields.', 'paymentKind');
    }
  } else {
    positiveMinor(input.refundAmountMinor, 'refundAmountMinor');
    if (input.receivedAmountMinor !== input.refundAmountMinor) {
      fail(
        'INVALID_REFUND_SHAPE',
        'Refund and reversal rows must carry the same positive magnitude in receivedAmountMinor and refundAmountMinor.',
        'receivedAmountMinor',
      );
    }
    requiredText(input.reversalOfPaymentId, 'reversalOfPaymentId');
    requiredText(input.reason, 'reason');
  }
  if (![true, false, 0, 1].includes(input.internalTransfer)) {
    fail('INVALID_INTERNAL_TRANSFER', 'internalTransfer must be boolean.', 'internalTransfer');
  }
  validateInstant(input.receivedAt, 'receivedAt');
  validateInstant(input.createdAt, 'createdAt');
  validateInstant(input.updatedAt, 'updatedAt');
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    fail('INVALID_VERSION', 'version must be a positive safe integer.', 'version');
  }
  const sourceDocumentType = optionalText(input.sourceDocumentType, 'sourceDocumentType');
  const sourceDocumentId = optionalText(input.sourceDocumentId, 'sourceDocumentId');
  if (Boolean(sourceDocumentType) !== Boolean(sourceDocumentId)) {
    fail(
      'INCOMPLETE_SOURCE_DOCUMENT',
      'sourceDocumentType and sourceDocumentId must be supplied together.',
      sourceDocumentId ? 'sourceDocumentType' : 'sourceDocumentId',
    );
  }
  return true;
}

function validateAllocationRecord(input = {}) {
  for (const field of [
    'id',
    'companyId',
    'paymentId',
    'receivableId',
    'paymentBranchId',
    'receivableBranchId',
    'allocationReason',
    'matchingEvidenceType',
    'initiatedBy',
    'initiatedAt',
    'approvalStatus',
    'idempotencyKey',
    'correlationId',
    'createdAt',
  ]) requiredText(input[field], field);
  positiveMinor(input.allocatedAmountMinor, 'allocatedAmountMinor');
  if (!ALLOCATION_KINDS.includes(input.allocationKind)) {
    fail('INVALID_ALLOCATION_KIND', 'allocationKind is not approved.', 'allocationKind');
  }
  if (!ALLOCATION_STATUSES.includes(input.allocationStatus)) {
    fail('INVALID_ALLOCATION_STATUS', 'allocationStatus is not approved.', 'allocationStatus');
  }
  if (!APPROVAL_STATUSES.includes(input.approvalStatus)) {
    fail('INVALID_APPROVAL_STATUS', 'approvalStatus is not approved.', 'approvalStatus');
  }
  if (!ALLOCATION_EVIDENCE_TYPES.includes(input.matchingEvidenceType)) {
    fail('INVALID_MATCHING_EVIDENCE', 'matchingEvidenceType is not approved.', 'matchingEvidenceType');
  }
  if (TRUSTED_ALLOCATION_EVIDENCE_TYPES.includes(input.matchingEvidenceType)) {
    requiredText(input.matchingEvidenceReference, 'matchingEvidenceReference');
  }
  if (input.allocationKind === 'reversal') {
    requiredText(input.reversalAllocationId, 'reversalAllocationId');
  } else if (input.reversalAllocationId) {
    fail('INVALID_REVERSAL_REFERENCE', 'Only reversal rows reference another allocation.', 'reversalAllocationId');
  }
  if (input.approvalStatus === 'approved') {
    validateSeparationOfDuties(input);
    validateInstant(input.approvedAt, 'approvedAt');
  }
  if (input.allocationStatus === 'confirmed' && !['not_required', 'approved'].includes(input.approvalStatus)) {
    fail('APPROVAL_MISSING', 'A confirmed allocation requires approved or not-required approval state.', 'approvalStatus');
  }
  if (
    input.allocationStatus === 'confirmed'
    && (
      input.paymentBranchId !== input.receivableBranchId
      || input.matchingEvidenceType === 'manual_ambiguous'
      || input.allocationKind === 'reversal'
    )
    && input.approvalStatus !== 'approved'
  ) {
    fail(
      'APPROVAL_MISSING',
      'A confirmed allocation requires approved status for cross-branch, ambiguous, or reversal operations.',
      'approvalStatus',
    );
  }
  validateInstant(input.initiatedAt, 'initiatedAt');
  validateInstant(input.createdAt, 'createdAt');
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    fail('INVALID_VERSION', 'version must be a positive safe integer.', 'version');
  }
  return true;
}

function validateAdjustmentRecord(input = {}, context = {}) {
  for (const field of [
    'id',
    'companyId',
    'branchId',
    'receivableId',
    'adjustmentType',
    'workflowStatus',
    'reason',
    'initiatedBy',
    'initiatedAt',
    'approvalStatus',
    'idempotencyKey',
    'correlationId',
    'effectiveAt',
    'createdAt',
  ]) requiredText(input[field], field);
  positiveMinor(input.amountMinor, 'amountMinor');
  if (!ADJUSTMENT_TYPES.includes(input.adjustmentType)) {
    fail('INVALID_ADJUSTMENT_TYPE', 'adjustmentType is not approved.', 'adjustmentType');
  }
  if (!ALLOCATION_STATUSES.includes(input.workflowStatus)) {
    fail('INVALID_ADJUSTMENT_STATUS', 'workflowStatus is not approved.', 'workflowStatus');
  }
  if (!APPROVAL_STATUSES.includes(input.approvalStatus)) {
    fail('INVALID_APPROVAL_STATUS', 'approvalStatus is not approved.', 'approvalStatus');
  }
  const effect = adjustmentBalanceEffect(input.adjustmentType, {
    balanceEffect: input.balanceEffect,
    originalBalanceEffect: context.originalBalanceEffect,
  });
  if (effect !== input.balanceEffect) {
    fail('INVALID_BALANCE_EFFECT', 'balanceEffect does not match adjustmentType.', 'balanceEffect');
  }
  if (input.adjustmentType === 'reversal') {
    requiredText(input.reversesAdjustmentId, 'reversesAdjustmentId');
  } else if (input.reversesAdjustmentId) {
    fail('INVALID_REVERSAL_REFERENCE', 'Only reversal adjustments reference another adjustment.', 'reversesAdjustmentId');
  }
  if (input.adjustmentType === 'write_off') {
    requiredText(input.supportingDocumentReference, 'supportingDocumentReference');
  }
  if (input.approvalStatus === 'approved') {
    validateSeparationOfDuties(input);
    validateInstant(input.approvedAt, 'approvedAt');
  }
  if (input.workflowStatus === 'confirmed' && input.approvalStatus !== 'approved') {
    fail('APPROVAL_MISSING', 'A confirmed adjustment requires dual approval.', 'approvalStatus');
  }
  validateInstant(input.initiatedAt, 'initiatedAt');
  validateInstant(input.effectiveAt, 'effectiveAt');
  validateInstant(input.createdAt, 'createdAt');
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    fail('INVALID_VERSION', 'version must be a positive safe integer.', 'version');
  }
  return true;
}

function calculateReceivableOutstanding(input = {}) {
  const workflowStatus = input.workflowStatus || 'posted';
  if (['draft', 'cancelled'].includes(workflowStatus)) return 0;
  let total = nonNegativeMinor(input.originalAmountMinor, 'originalAmountMinor');
  for (const [field, direction] of [
    ['confirmedDebitAdjustmentsMinor', 1],
    ['confirmedPenaltyAdjustmentsMinor', 1],
    ['confirmedIncreasingCorrectionsMinor', 1],
    ['confirmedCreditAdjustmentsMinor', -1],
    ['confirmedDiscountAdjustmentsMinor', -1],
    ['confirmedDecreasingCorrectionsMinor', -1],
    ['confirmedWriteOffMinor', -1],
    ['confirmedActivePaymentAllocationsMinor', -1],
  ]) {
    const value = nonNegativeMinor(input[field] ?? 0, field);
    total = safeAdd(total, direction * value, field);
  }
  if (total < 0) {
    fail(
      'RECEIVABLE_OVER_SETTLED',
      'Confirmed effects exceed receivable outstanding; the operation must be rejected.',
      'originalAmountMinor',
    );
  }
  return total;
}

function calculatePaymentUnapplied(input = {}) {
  if (
    input.workflowStatus !== 'confirmed'
    || input.paymentKind !== 'receipt'
    || input.internalTransfer === true
    || input.internalTransfer === 1
  ) return 0;
  let total = nonNegativeMinor(input.receivedAmountMinor, 'receivedAmountMinor');
  total = safeAdd(
    total,
    -nonNegativeMinor(input.confirmedActiveAllocationsMinor ?? 0, 'confirmedActiveAllocationsMinor'),
    'confirmedActiveAllocationsMinor',
  );
  total = safeAdd(
    total,
    -nonNegativeMinor(input.confirmedRefundsMinor ?? 0, 'confirmedRefundsMinor'),
    'confirmedRefundsMinor',
  );
  if (total < 0) {
    fail(
      'PAYMENT_OVER_APPLIED',
      'Confirmed allocations and refunds exceed the received amount.',
      'receivedAmountMinor',
    );
  }
  return total;
}

function validateDueDateChangeOperation(input = {}) {
  requiredText(input.receivableId, 'receivableId');
  requiredText(input.reason, 'reason');
  requiredText(input.initiatedBy, 'initiatedBy');
  requiredText(input.correlationId, 'correlationId');
  validateInstant(input.effectiveAt, 'effectiveAt');
  validateDueDateContract({
    contractualDueDate: input.requestedDueDate,
    dueDateProvenance: input.provenance,
  });
  if (input.priorDueDate !== null && input.priorDueDate !== undefined) {
    validateDueDateContract({
      contractualDueDate: input.priorDueDate,
      dueDateProvenance: input.priorProvenance,
    });
  }
  const approvalRequired = input.hasAllocationHistory === true;
  if (approvalRequired && input.approvedBy) validateSeparationOfDuties(input);
  return Object.freeze({ approvalRequired });
}

function validateCancellationOperation(input = {}) {
  requiredText(input.receivableId, 'receivableId');
  requiredText(input.reason, 'reason');
  requiredText(input.initiatedBy, 'initiatedBy');
  const hasActiveAllocation = input.hasActiveAllocation ?? input.hasAllocationHistory ?? false;
  const hasActiveAdjustment = input.hasActiveAdjustment ?? input.hasAdjustmentHistory ?? false;
  if (hasActiveAllocation || hasActiveAdjustment) {
    fail(
      'COMPENSATING_OPERATIONS_REQUIRED',
      'A receivable with allocation or adjustment history requires compensating operations.',
      'receivableId',
    );
  }
  const approvalRequired = input.workflowStatus !== 'draft';
  if (approvalRequired && input.approvedBy) validateSeparationOfDuties(input);
  return Object.freeze({ approvalRequired });
}

module.exports = {
  ADJUSTMENT_TYPES,
  ALLOCATION_EVIDENCE_TYPES,
  ALLOCATION_KINDS,
  ALLOCATION_STATUSES,
  APPROVAL_STATUSES,
  BALANCE_EFFECTS,
  CanonicalSettlementDomainError,
  PAYMENT_KINDS,
  PAYMENT_WORKFLOW_STATUSES,
  SENSITIVE_OPERATION_TYPES,
  TRUSTED_ALLOCATION_EVIDENCE_TYPES,
  adjustmentBalanceEffect,
  calculatePaymentUnapplied,
  calculateReceivableOutstanding,
  canApproveOperation,
  requiresAdjustmentApproval,
  requiresAllocationApproval,
  requiresSensitiveOperationApproval,
  validateAdjustmentRecord,
  validateAllocationRecord,
  validateCancellationOperation,
  validateCanonicalPayment,
  validateDueDateChangeOperation,
  validateSeparationOfDuties,
};
