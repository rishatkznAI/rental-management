const ACCEPTED_DUE_DATE_PROVENANCES = Object.freeze([
  'invoice_due_date',
  'contractual_payment_due_date',
  'installment_due_date',
  'migrated_verified',
]);

const DUE_DATE_PROVENANCES = Object.freeze([
  ...ACCEPTED_DUE_DATE_PROVENANCES,
  'unknown',
]);

const WORKFLOW_STATUSES = Object.freeze([
  'draft',
  'posted',
  'disputed',
  'cancelled',
  'written_off',
]);

const CREATION_WORKFLOW_STATUSES = new Set(['draft', 'posted']);
const BALANCE_BEARING_WORKFLOW_STATUSES = new Set(['posted', 'disputed']);
const NON_CANONICAL_DUE_DATE_FIELDS = Object.freeze([
  'expectedPaymentDate',
  'endDate',
  'rentalEndDate',
  'managerForecastDate',
]);
const DOCUMENT_TOTAL_SOURCE_LINE_ID = '__document_total__';

class ReceivableDomainError extends Error {
  constructor(code, message, field) {
    super(message);
    this.name = 'ReceivableDomainError';
    this.code = code;
    this.field = field;
  }
}

function fail(code, message, field) {
  throw new ReceivableDomainError(code, message, field);
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
    fail('INVALID_TEXT', `${field} must be a non-empty string when supplied.`, field);
  }
  return value.trim();
}

function isDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function validateDateOnly(value, field) {
  if (!isDateOnly(value)) {
    fail('INVALID_DATE', `${field} must be a valid YYYY-MM-DD civil date.`, field);
  }
  return true;
}

function validateInstant(value, field) {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
    || Number.isNaN(Date.parse(value))
  ) {
    fail('INVALID_TIMESTAMP', `${field} must be a valid RFC 3339 UTC timestamp.`, field);
  }
  return true;
}

function isValidIanaTimezone(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function isAcceptedDueDateProvenance(value) {
  return ACCEPTED_DUE_DATE_PROVENANCES.includes(value);
}

function validateDueDateContract(input = {}) {
  const provenance = input.dueDateProvenance;
  if (!DUE_DATE_PROVENANCES.includes(provenance)) {
    fail('INVALID_DUE_DATE_PROVENANCE', 'dueDateProvenance is not approved.', 'dueDateProvenance');
  }

  const dueDate = input.contractualDueDate;
  if (isAcceptedDueDateProvenance(provenance) && !dueDate) {
    fail(
      'CONTRACTUAL_DUE_DATE_REQUIRED',
      'Accepted due-date provenance requires contractualDueDate.',
      'contractualDueDate',
    );
  }
  if (dueDate !== undefined && dueDate !== null && dueDate !== '') {
    validateDateOnly(dueDate, 'contractualDueDate');
  }
  return true;
}

function validateMoneyContract(input = {}) {
  const amount = input.originalAmountMinor;
  if (!Number.isSafeInteger(amount)) {
    fail(
      'INVALID_MINOR_UNIT_AMOUNT',
      'originalAmountMinor must be a safe integer in minor units.',
      'originalAmountMinor',
    );
  }
  if (amount < 0) {
    fail('NEGATIVE_AMOUNT', 'originalAmountMinor cannot be negative.', 'originalAmountMinor');
  }
  if (input.currency !== 'RUB') {
    fail('UNSUPPORTED_CURRENCY', 'The initial canonical release supports RUB only.', 'currency');
  }
  if (['posted', 'disputed', 'written_off'].includes(input.workflowStatus) && amount <= 0) {
    fail('POSTED_AMOUNT_REQUIRED', 'A posted receivable must have a positive amount.', 'originalAmountMinor');
  }
  return true;
}

function validateWorkflowStatus(value) {
  if (!WORKFLOW_STATUSES.includes(value)) {
    fail('INVALID_WORKFLOW_STATUS', 'workflowStatus is not an approved stored state.', 'workflowStatus');
  }
  return true;
}

function isWorkflowTransitionAllowed(fromStatus, toStatus, context = {}) {
  if (!WORKFLOW_STATUSES.includes(fromStatus) || !WORKFLOW_STATUSES.includes(toStatus)) return false;
  if (fromStatus === 'draft' && ['posted', 'cancelled'].includes(toStatus)) return true;
  if (fromStatus === 'posted' && toStatus === 'disputed') return true;
  if (fromStatus === 'disputed' && toStatus === 'posted') {
    return context.disputeResolutionApproved === true;
  }
  if (['posted', 'disputed'].includes(fromStatus) && toStatus === 'cancelled') {
    return context.cancellationWorkflowApproved === true;
  }

  // PR1 intentionally exposes no write-off or compensating-event authorization.
  return false;
}

function validateWorkflowTransition(fromStatus, toStatus, context = {}) {
  validateWorkflowStatus(fromStatus);
  validateWorkflowStatus(toStatus);
  if (!isWorkflowTransitionAllowed(fromStatus, toStatus, context)) {
    fail(
      'WORKFLOW_TRANSITION_NOT_ALLOWED',
      `Transition ${fromStatus} -> ${toStatus} is not enabled by the PR1 state contract.`,
      'workflowStatus',
    );
  }
  return true;
}

function normalizeSourceLineId(value) {
  if (value === undefined || value === null) return DOCUMENT_TOTAL_SOURCE_LINE_ID;
  if (typeof value !== 'string') {
    fail('INVALID_SOURCE_LINE_ID', 'sourceLineId must be text when supplied.', 'sourceLineId');
  }
  return value.trim() || DOCUMENT_TOTAL_SOURCE_LINE_ID;
}

function createSourceIdentity(input = {}) {
  const identity = [
    requiredText(input.companyId, 'companyId'),
    requiredText(input.sourceSystem, 'sourceSystem'),
    requiredText(input.sourceDocumentType, 'sourceDocumentType'),
    requiredText(input.sourceDocumentId, 'sourceDocumentId'),
    normalizeSourceLineId(input.sourceLineId),
  ];
  return JSON.stringify(identity);
}

function createIdempotencyIdentity(input = {}) {
  return JSON.stringify([
    requiredText(input.companyId, 'companyId'),
    requiredText(input.idempotencyKey, 'idempotencyKey'),
  ]);
}

function validateIdempotencyIdentity(input = {}) {
  createIdempotencyIdentity(input);
  return true;
}

function assertApprovedSourceDocumentPolicy(input, sourceDocumentPolicy) {
  if (!sourceDocumentPolicy || typeof sourceDocumentPolicy.isApprovedSourceDocument !== 'function') {
    fail(
      'SOURCE_DOCUMENT_POLICY_REQUIRED',
      'Posting requires an injected approved source-document policy.',
      'sourceDocumentType',
    );
  }
  if (sourceDocumentPolicy.isApprovedSourceDocument({
    companyId: input.companyId,
    sourceSystem: input.sourceSystem,
    sourceDocumentType: input.sourceDocumentType,
    sourceDocumentId: input.sourceDocumentId,
    sourceLineId: input.sourceLineId ?? null,
  }) !== true) {
    fail(
      'SOURCE_DOCUMENT_NOT_APPROVED',
      'The supplied source document is not approved for receivable posting.',
      'sourceDocumentType',
    );
  }
  return true;
}

function validateReceivableRecord(input = {}) {
  requiredText(input.id, 'id');
  requiredText(input.companyId, 'companyId');
  requiredText(input.branchId, 'branchId');
  requiredText(input.clientId, 'clientId');
  requiredText(input.sourceSystem, 'sourceSystem');
  requiredText(input.sourceDocumentType, 'sourceDocumentType');
  requiredText(input.sourceDocumentId, 'sourceDocumentId');
  normalizeSourceLineId(input.sourceLineId);
  requiredText(input.idempotencyKey, 'idempotencyKey');
  requiredText(input.companyTimezone, 'companyTimezone');
  if (!isValidIanaTimezone(input.companyTimezone)) {
    fail('INVALID_COMPANY_TIMEZONE', 'companyTimezone must be a valid IANA timezone.', 'companyTimezone');
  }

  validateWorkflowStatus(input.workflowStatus);
  validateMoneyContract(input);
  validateDueDateContract(input);
  validateIdempotencyIdentity(input);
  createSourceIdentity(input);

  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    fail('INVALID_VERSION', 'version must be a positive safe integer.', 'version');
  }
  validateInstant(input.createdAt, 'createdAt');
  validateInstant(input.updatedAt, 'updatedAt');
  if (input.issuedAt !== undefined && input.issuedAt !== null) validateInstant(input.issuedAt, 'issuedAt');
  if (input.postedAt !== undefined && input.postedAt !== null) validateInstant(input.postedAt, 'postedAt');

  if (['posted', 'disputed', 'written_off'].includes(input.workflowStatus) && !input.postedAt) {
    fail('POSTED_AT_REQUIRED', 'postedAt is required for an activated receivable.', 'postedAt');
  }
  if (input.workflowStatus === 'cancelled') {
    requiredText(input.cancellationReason, 'cancellationReason');
    validateInstant(input.cancelledAt, 'cancelledAt');
  }
  if (input.workflowStatus === 'written_off') validateInstant(input.writtenOffAt, 'writtenOffAt');
  optionalText(input.contractId, 'contractId');
  optionalText(input.rentalId, 'rentalId');
  optionalText(input.externalId, 'externalId');
  optionalText(input.description, 'description');
  return true;
}

function validateReceivableCreationInput(input = {}, options = {}) {
  for (const field of NON_CANONICAL_DUE_DATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field) && input[field] !== undefined && input[field] !== null) {
      fail(
        'NON_CANONICAL_DUE_DATE_FIELD',
        `${field} cannot be supplied as canonical due-date evidence.`,
        field,
      );
    }
  }

  validateReceivableRecord(input);
  if (!CREATION_WORKFLOW_STATUSES.has(input.workflowStatus)) {
    fail(
      'INVALID_CREATION_WORKFLOW_STATUS',
      'A receivable can only be created as draft or posted.',
      'workflowStatus',
    );
  }
  if (input.workflowStatus === 'posted') {
    assertApprovedSourceDocumentPolicy(input, options.sourceDocumentPolicy);
  }
  return true;
}

function postedFieldValue(field, record) {
  if (field === 'originalAmountMinor') return record?.originalAmountMinor;
  return record?.[field] === undefined || record?.[field] === null
    ? null
    : record[field];
}

function validatePostedFieldImmutability(previous = {}, next = {}) {
  validateWorkflowStatus(previous.workflowStatus);
  if (previous.workflowStatus === 'draft') return true;

  const immutableFields = [
    'companyId',
    'branchId',
    'clientId',
    'sourceSystem',
    'sourceDocumentType',
    'sourceDocumentId',
    'sourceLineId',
    'currency',
    'companyTimezone',
    'originalAmountMinor',
  ];
  for (const field of immutableFields) {
    if (!Object.is(postedFieldValue(field, previous), postedFieldValue(field, next))) {
      fail('POSTED_FIELD_IMMUTABLE', `${field} cannot change after posting.`, field);
    }
  }
  return true;
}

function calculateOutstandingBalanceMinor(receivable = {}) {
  validateWorkflowStatus(receivable.workflowStatus);
  validateMoneyContract(receivable);
  if (!BALANCE_BEARING_WORKFLOW_STATUSES.has(receivable.workflowStatus)) return 0;

  // PR1 has no allocations or adjustments. PR2 must replace this limited input
  // equation with the approved append-only settlement effects.
  return receivable.originalAmountMinor;
}

function isAgingEligible(receivable = {}, outstandingBalanceMinor = calculateOutstandingBalanceMinor(receivable)) {
  if (!Number.isSafeInteger(outstandingBalanceMinor) || outstandingBalanceMinor <= 0) return false;
  if (receivable.workflowStatus !== 'posted') return false;
  if (!isAcceptedDueDateProvenance(receivable.dueDateProvenance)) return false;
  if (!isDateOnly(receivable.contractualDueDate)) return false;
  return isValidIanaTimezone(receivable.companyTimezone);
}

function deriveSettlementState(receivable = {}, options = {}) {
  const outstandingBalanceMinor = options.outstandingBalanceMinor
    ?? calculateOutstandingBalanceMinor(receivable);
  const confirmedAllocatedMinor = options.confirmedAllocatedMinor ?? 0;
  if (!Number.isSafeInteger(outstandingBalanceMinor) || outstandingBalanceMinor < 0) {
    fail('INVALID_OUTSTANDING_BALANCE', 'outstandingBalanceMinor must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(confirmedAllocatedMinor) || confirmedAllocatedMinor < 0) {
    fail('INVALID_ALLOCATION_TOTAL', 'confirmedAllocatedMinor must be a non-negative safe integer.');
  }
  if (!BALANCE_BEARING_WORKFLOW_STATUSES.has(receivable.workflowStatus)) return 'not_applicable';
  if (outstandingBalanceMinor === 0) return 'paid';
  if (confirmedAllocatedMinor > 0) return 'partially_paid';
  return 'open';
}

function civilDayNumber(value) {
  validateDateOnly(value, 'asOfDate');
  const [year, month, day] = value.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function deriveOverdueState(receivable = {}, options = {}) {
  const outstandingBalanceMinor = options.outstandingBalanceMinor
    ?? calculateOutstandingBalanceMinor(receivable);
  if (!Number.isSafeInteger(outstandingBalanceMinor) || outstandingBalanceMinor < 0) {
    fail('INVALID_OUTSTANDING_BALANCE', 'outstandingBalanceMinor must be a non-negative safe integer.');
  }
  if (outstandingBalanceMinor === 0) return { agingStatus: 'settled', overdueDays: null };
  if (receivable.workflowStatus === 'disputed') return { agingStatus: 'disputed', overdueDays: null };
  if (['draft', 'cancelled', 'written_off'].includes(receivable.workflowStatus)) {
    return { agingStatus: 'excluded', overdueDays: null };
  }
  if (!isAgingEligible(receivable, outstandingBalanceMinor)) {
    return { agingStatus: 'ambiguous', overdueDays: null };
  }

  // The caller must supply the server-derived company civil date. This helper
  // deliberately never consults browser or host-local time.
  const overdueDays = civilDayNumber(options.asOfDate) - civilDayNumber(receivable.contractualDueDate);
  return {
    agingStatus: overdueDays > 0 ? 'overdue' : 'current',
    overdueDays,
  };
}

module.exports = {
  ACCEPTED_DUE_DATE_PROVENANCES,
  DOCUMENT_TOTAL_SOURCE_LINE_ID,
  DUE_DATE_PROVENANCES,
  ReceivableDomainError,
  WORKFLOW_STATUSES,
  assertApprovedSourceDocumentPolicy,
  calculateOutstandingBalanceMinor,
  createIdempotencyIdentity,
  createSourceIdentity,
  deriveOverdueState,
  deriveSettlementState,
  isAcceptedDueDateProvenance,
  isAgingEligible,
  isWorkflowTransitionAllowed,
  normalizeSourceLineId,
  validateDueDateContract,
  validateIdempotencyIdentity,
  validateMoneyContract,
  validatePostedFieldImmutability,
  validateReceivableCreationInput,
  validateReceivableRecord,
  validateWorkflowTransition,
};
