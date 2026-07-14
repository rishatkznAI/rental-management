import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  CanonicalSettlementDomainError,
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
} = require('../server/lib/canonical-receivables-settlement-domain.js');

function allocationPolicy(overrides = {}) {
  return {
    paymentCompanyId: 'company-1',
    receivableCompanyId: 'company-1',
    paymentCurrency: 'RUB',
    receivableCurrency: 'RUB',
    paymentBranchId: 'branch-1',
    receivableBranchId: 'branch-1',
    allocatedAmountMinor: 1000,
    matchingEvidenceType: 'exact_document_reference',
    matchingEvidenceReference: 'invoice-1',
    ...overrides,
  };
}

const verifiedEvidencePolicy = Object.freeze({
  verifyMatchingEvidence: evidence => (
    ['exact_document_reference', 'explicit_client_instruction'].includes(evidence.evidenceType)
    && Boolean(evidence.reference)
  ),
});

function payment(overrides = {}) {
  return {
    id: 'payment-1',
    companyId: 'company-1',
    branchId: 'branch-1',
    clientId: 'client-1',
    idempotencyKey: 'payment-key-1',
    currency: 'RUB',
    paymentKind: 'receipt',
    receivedAmountMinor: 10000,
    refundAmountMinor: 0,
    receivedAt: '2026-07-14T10:00:00.000Z',
    workflowStatus: 'confirmed',
    sourceSystem: 'test',
    sourceDocumentType: null,
    sourceDocumentId: null,
    internalTransfer: false,
    reversalOfPaymentId: null,
    reason: null,
    createdAt: '2026-07-14T10:00:00.000Z',
    updatedAt: '2026-07-14T10:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

function allocation(overrides = {}) {
  return {
    id: 'allocation-1',
    companyId: 'company-1',
    paymentId: 'payment-1',
    receivableId: 'receivable-1',
    paymentBranchId: 'branch-1',
    receivableBranchId: 'branch-1',
    allocatedAmountMinor: 1000,
    allocationKind: 'allocation',
    allocationStatus: 'confirmed',
    allocationReason: 'exact match',
    matchingEvidenceType: 'exact_document_reference',
    matchingEvidenceReference: 'invoice-1',
    initiatedBy: 'user-1',
    initiatedAt: '2026-07-14T11:00:00.000Z',
    approvedBy: null,
    approvedAt: null,
    approvalStatus: 'not_required',
    reversedAt: null,
    reversalAllocationId: null,
    idempotencyKey: 'allocation-key-1',
    correlationId: 'allocation-correlation-1',
    createdAt: '2026-07-14T11:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

function adjustment(overrides = {}) {
  return {
    id: 'adjustment-1',
    companyId: 'company-1',
    branchId: 'branch-1',
    receivableId: 'receivable-1',
    adjustmentType: 'credit',
    balanceEffect: 'decrease',
    amountMinor: 1000,
    workflowStatus: 'confirmed',
    reason: 'approved credit',
    supportingDocumentReference: null,
    sourceDocumentType: null,
    sourceDocumentId: null,
    reversesAdjustmentId: null,
    initiatedBy: 'user-1',
    initiatedAt: '2026-07-14T11:00:00.000Z',
    approvedBy: 'user-2',
    approvedAt: '2026-07-14T12:00:00.000Z',
    approvalStatus: 'approved',
    idempotencyKey: 'adjustment-key-1',
    correlationId: 'adjustment-correlation-1',
    effectiveAt: '2026-07-14T12:00:00.000Z',
    createdAt: '2026-07-14T11:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

test('ordinary exact-reference and client-instruction allocations are exempt only within one branch', () => {
  assert.equal(requiresAllocationApproval(allocationPolicy()), true);
  assert.equal(requiresAllocationApproval(allocationPolicy(), verifiedEvidencePolicy), false);
  assert.equal(requiresAllocationApproval(allocationPolicy({
    matchingEvidenceType: 'explicit_client_instruction',
    matchingEvidenceReference: 'instruction-1',
  }), verifiedEvidencePolicy), false);
  assert.equal(requiresAllocationApproval(allocationPolicy({
    matchingEvidenceType: 'manual_ambiguous',
    matchingEvidenceReference: null,
  }), verifiedEvidencePolicy), true);
  assert.equal(requiresAllocationApproval(
    allocationPolicy({ receivableBranchId: 'branch-2' }), verifiedEvidencePolicy,
  ), true);
  assert.equal(requiresAllocationApproval(
    allocationPolicy({ matchingEvidenceReference: null }), verifiedEvidencePolicy,
  ), true);
  assert.equal(requiresAllocationApproval(allocationPolicy(), {
    verifyMatchingEvidence: () => false,
  }), true);
});

test('allocation policy rejects cross-company and currency mismatch instead of silently requiring approval', () => {
  assert.throws(
    () => requiresAllocationApproval(allocationPolicy({ receivableCompanyId: 'company-2' })),
    error => error instanceof CanonicalSettlementDomainError && error.code === 'COMPANY_MISMATCH',
  );
  assert.throws(
    () => requiresAllocationApproval(allocationPolicy({ receivableCurrency: 'USD' })),
    error => error.code === 'CURRENCY_MISMATCH',
  );
});

test('separation of duties and injected capability context fail closed', () => {
  assert.equal(validateSeparationOfDuties({ initiatedBy: 'user-1', approvedBy: 'user-2' }), true);
  assert.throws(
    () => validateSeparationOfDuties({ initiatedBy: 'user-1', approvedBy: 'user-1' }),
    error => error.code === 'SELF_APPROVAL_FORBIDDEN',
  );
  assert.throws(
    () => validateSeparationOfDuties({
      initiatedBy: 'integration-1',
      approvedBy: 'integration-2',
      initiatorActorType: 'integration',
      approverActorType: 'integration',
    }),
    error => error.code === 'APPROVER_MUST_BE_USER',
  );
  assert.equal(canApproveOperation({
    initiatedBy: 'user-1', approvedBy: 'user-2', capabilities: ['adjustments.approve'],
  }, { requiredCapabilities: ['adjustments.approve'] }), true);
  assert.equal(canApproveOperation({
    initiatedBy: 'user-1', approvedBy: 'user-2', capabilities: [],
  }, { requiredCapabilities: ['adjustments.approve'] }), false);
});

test('temporary D-25 makes every adjustment and listed sensitive operation approval-required', () => {
  for (const adjustmentType of [
    'credit', 'debit', 'discount', 'penalty', 'correction', 'write_off', 'refund_effect', 'reversal',
  ]) {
    assert.equal(requiresAdjustmentApproval({ adjustmentType }), true, adjustmentType);
  }
  assert.equal(requiresAdjustmentApproval(
    { adjustmentType: 'credit' },
    { approvalExemptAdjustmentTypes: ['credit'] },
  ), true, 'policy context cannot weaken mandatory D-25 adjustment approval');
  for (const operationType of [
    'refund', 'adjustment', 'reversal', 'write_off',
    'due_date_change_after_allocation', 'posted_receivable_cancellation',
  ]) {
    assert.equal(requiresSensitiveOperationApproval(operationType), true, operationType);
  }
});

test('payment contract uses RUB integer magnitudes and never treats pending receipts as balance capacity', () => {
  assert.equal(validateCanonicalPayment(payment()), true);
  assert.equal(validateCanonicalPayment(payment({
    paymentKind: 'refund',
    receivedAmountMinor: 2500,
    refundAmountMinor: 2500,
    reversalOfPaymentId: 'payment-original',
    reason: 'approved partial refund',
  })), true);
  assert.throws(() => validateCanonicalPayment(payment({
    paymentKind: 'refund',
    receivedAmountMinor: 0,
    refundAmountMinor: 2500,
    reversalOfPaymentId: 'payment-original',
    reason: 'invalid zero received magnitude',
  })), /positive safe integer/);
  assert.throws(() => validateCanonicalPayment(payment({
    paymentKind: 'refund',
    receivedAmountMinor: 2000,
    refundAmountMinor: 2500,
    reversalOfPaymentId: 'payment-original',
    reason: 'mismatched magnitudes',
  })), /same positive magnitude/);
  assert.throws(() => validateCanonicalPayment(payment({ receivedAmountMinor: 1.5 })), /safe integer/);
  assert.throws(() => validateCanonicalPayment(payment({ currency: 'USD' })), /RUB only/);
  assert.throws(() => validateCanonicalPayment(payment({ workflowStatus: 'scheduled' })), /not approved/);
  assert.equal(calculatePaymentUnapplied({
    ...payment(),
    confirmedActiveAllocationsMinor: 2500,
    confirmedRefundsMinor: 1000,
  }), 6500);
  assert.equal(calculatePaymentUnapplied({
    ...payment({ workflowStatus: 'pending' }),
    confirmedActiveAllocationsMinor: 0,
    confirmedRefundsMinor: 0,
  }), 0);
  assert.throws(() => calculatePaymentUnapplied({
    ...payment(),
    confirmedActiveAllocationsMinor: 10001,
    confirmedRefundsMinor: 0,
  }), error => error.code === 'PAYMENT_OVER_APPLIED');
});

test('receivable balance equation handles partial/multiple effects, disputes, reversals, and no float drift', () => {
  assert.equal(calculateReceivableOutstanding({
    originalAmountMinor: 10000,
    workflowStatus: 'posted',
    confirmedDebitAdjustmentsMinor: 1000,
    confirmedPenaltyAdjustmentsMinor: 250,
    confirmedCreditAdjustmentsMinor: 500,
    confirmedDiscountAdjustmentsMinor: 250,
    confirmedWriteOffMinor: 1000,
    confirmedActivePaymentAllocationsMinor: 4000,
  }), 5500);
  assert.equal(calculateReceivableOutstanding({
    originalAmountMinor: 10000,
    workflowStatus: 'disputed',
    confirmedActivePaymentAllocationsMinor: 4000,
  }), 6000);
  assert.equal(calculateReceivableOutstanding({
    originalAmountMinor: 10000,
    workflowStatus: 'cancelled',
  }), 0);
  assert.throws(() => calculateReceivableOutstanding({
    originalAmountMinor: 100,
    workflowStatus: 'posted',
    confirmedCreditAdjustmentsMinor: 101,
  }), error => error.code === 'RECEIVABLE_OVER_SETTLED');
  assert.throws(() => calculateReceivableOutstanding({
    originalAmountMinor: 10.5,
    workflowStatus: 'posted',
  }), /non-negative safe integer/);
  const large = Number.MAX_SAFE_INTEGER - 10;
  assert.throws(() => calculateReceivableOutstanding({
    originalAmountMinor: large,
    workflowStatus: 'posted',
    confirmedDebitAdjustmentsMinor: 20,
  }), error => error.code === 'MINOR_UNIT_OVERFLOW');
});

test('adjustment types define explicit effects and reversal derives the exact opposite', () => {
  assert.equal(adjustmentBalanceEffect('debit'), 'increase');
  assert.equal(adjustmentBalanceEffect('penalty'), 'increase');
  assert.equal(adjustmentBalanceEffect('credit'), 'decrease');
  assert.equal(adjustmentBalanceEffect('discount'), 'decrease');
  assert.equal(adjustmentBalanceEffect('write_off'), 'decrease');
  assert.equal(adjustmentBalanceEffect('refund_effect'), 'none');
  assert.equal(adjustmentBalanceEffect('correction', { balanceEffect: 'increase' }), 'increase');
  assert.equal(adjustmentBalanceEffect('reversal', { originalBalanceEffect: 'decrease' }), 'increase');
  assert.throws(() => adjustmentBalanceEffect('correction'), /explicit/);
  assert.throws(() => adjustmentBalanceEffect('reversal'), /referenced/);
});

test('allocation and adjustment record guards enforce approval, evidence, write-off documents, and reversal links', () => {
  assert.equal(validateAllocationRecord(allocation()), true);
  assert.throws(() => validateAllocationRecord(allocation({
    matchingEvidenceType: 'manual_ambiguous',
  })), /confirmed allocation requires/);
  assert.throws(() => validateAllocationRecord(allocation({
    allocationKind: 'reversal',
    reversalAllocationId: null,
    approvalStatus: 'pending',
    allocationStatus: 'pending',
  })), /reversalAllocationId/);
  assert.equal(validateAdjustmentRecord(adjustment()), true);
  assert.throws(() => validateAdjustmentRecord(adjustment({
    approvedBy: 'user-1',
  })), /different users/);
  assert.throws(() => validateAdjustmentRecord(adjustment({
    adjustmentType: 'write_off',
    supportingDocumentReference: null,
  })), /supportingDocumentReference/);
});

test('due-date and cancellation foundations preserve D-25 approval and compensation gates', () => {
  const dueDate = {
    receivableId: 'receivable-1',
    requestedDueDate: '2026-08-01',
    provenance: 'contractual_payment_due_date',
    priorDueDate: '2026-07-31',
    priorProvenance: 'invoice_due_date',
    reason: 'signed contract amendment',
    initiatedBy: 'user-1',
    effectiveAt: '2026-07-14T12:00:00.000Z',
    correlationId: 'due-date-correlation',
  };
  assert.deepEqual(validateDueDateChangeOperation({ ...dueDate, hasAllocationHistory: false }), {
    approvalRequired: false,
  });
  assert.deepEqual(validateDueDateChangeOperation({ ...dueDate, hasAllocationHistory: true }), {
    approvalRequired: true,
  });
  assert.throws(() => validateDueDateChangeOperation({ ...dueDate, reason: '' }), /reason is required/);
  assert.deepEqual(validateCancellationOperation({
    receivableId: 'receivable-1', workflowStatus: 'draft', reason: 'draft error', initiatedBy: 'user-1',
  }), { approvalRequired: false });
  assert.deepEqual(validateCancellationOperation({
    receivableId: 'receivable-1', workflowStatus: 'posted', reason: 'approved cancellation', initiatedBy: 'user-1',
  }), { approvalRequired: true });
  assert.throws(() => validateCancellationOperation({
    receivableId: 'receivable-1', workflowStatus: 'posted', reason: 'cancel', initiatedBy: 'user-1',
    hasAllocationHistory: true,
  }), error => error.code === 'COMPENSATING_OPERATIONS_REQUIRED');
});
