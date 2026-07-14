import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  calculateOutstandingBalanceMinor,
  createIdempotencyIdentity,
  createSourceIdentity,
  deriveOverdueState,
  deriveSettlementState,
  isAcceptedDueDateProvenance,
  isAgingEligible,
  validateDueDateContract,
  validateMoneyContract,
  validatePostedFieldImmutability,
  validateReceivableCreationInput,
  validateWorkflowTransition,
} = require('../server/lib/canonical-receivable-domain.js');

function draftReceivable(overrides = {}) {
  return {
    id: 'receivable-1',
    companyId: 'company-1',
    branchId: 'branch-1',
    clientId: 'client-1',
    contractId: null,
    rentalId: null,
    sourceSystem: 'test_source',
    sourceDocumentType: 'externally_configured_type',
    sourceDocumentId: 'source-1',
    sourceLineId: null,
    externalId: null,
    idempotencyKey: 'idempotency-1',
    currency: 'RUB',
    originalAmountMinor: 12500,
    issuedAt: null,
    postedAt: null,
    contractualDueDate: null,
    dueDateProvenance: 'unknown',
    companyTimezone: 'Europe/Moscow',
    workflowStatus: 'draft',
    description: null,
    createdAt: '2026-07-13T09:00:00.000Z',
    updatedAt: '2026-07-13T09:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

function postedReceivable(overrides = {}) {
  return draftReceivable({
    workflowStatus: 'posted',
    postedAt: '2026-07-13T09:05:00.000Z',
    contractualDueDate: '2026-07-20',
    dueDateProvenance: 'invoice_due_date',
    ...overrides,
  });
}

const approvingSourcePolicy = {
  isApprovedSourceDocument(source) {
    return source.sourceDocumentType === 'externally_configured_type';
  },
};

test('valid draft and posted receivables pass while posted creation requires an injected source policy', () => {
  assert.equal(validateReceivableCreationInput(draftReceivable()), true);
  assert.throws(
    () => validateReceivableCreationInput(postedReceivable()),
    error => error.code === 'SOURCE_DOCUMENT_POLICY_REQUIRED',
  );
  assert.equal(validateReceivableCreationInput(postedReceivable(), {
    sourceDocumentPolicy: approvingSourcePolicy,
  }), true);
  assert.throws(
    () => validateReceivableCreationInput(postedReceivable(), {
      sourceDocumentPolicy: { isApprovedSourceDocument: () => false },
    }),
    error => error.code === 'SOURCE_DOCUMENT_NOT_APPROVED',
  );
});

test('minor-unit money rejects floats, negatives, unsafe integers, unsupported currencies, and zero posted amounts', () => {
  assert.equal(validateMoneyContract(draftReceivable()), true);
  assert.throws(
    () => validateMoneyContract(draftReceivable({ originalAmountMinor: 12.5 })),
    error => error.code === 'INVALID_MINOR_UNIT_AMOUNT',
  );
  assert.throws(
    () => validateMoneyContract(draftReceivable({ originalAmountMinor: -1 })),
    error => error.code === 'NEGATIVE_AMOUNT',
  );
  assert.throws(
    () => validateMoneyContract(draftReceivable({ originalAmountMinor: Number.MAX_SAFE_INTEGER + 1 })),
    error => error.code === 'INVALID_MINOR_UNIT_AMOUNT',
  );
  assert.throws(
    () => validateMoneyContract(draftReceivable({ currency: 'USD' })),
    error => error.code === 'UNSUPPORTED_CURRENCY',
  );
  assert.throws(
    () => validateMoneyContract(postedReceivable({ originalAmountMinor: 0 })),
    error => error.code === 'POSTED_AMOUNT_REQUIRED',
  );
});

test('due-date provenance accepts only the approved contract and accepted provenance requires a date', () => {
  for (const provenance of [
    'invoice_due_date',
    'contractual_payment_due_date',
    'installment_due_date',
    'migrated_verified',
  ]) {
    assert.equal(isAcceptedDueDateProvenance(provenance), true);
    assert.equal(validateDueDateContract({
      contractualDueDate: '2026-07-20',
      dueDateProvenance: provenance,
    }), true);
  }
  assert.equal(isAcceptedDueDateProvenance('unknown'), false);
  assert.equal(validateDueDateContract({
    contractualDueDate: null,
    dueDateProvenance: 'unknown',
  }), true);
  assert.throws(
    () => validateDueDateContract({
      contractualDueDate: null,
      dueDateProvenance: 'invoice_due_date',
    }),
    error => error.code === 'CONTRACTUAL_DUE_DATE_REQUIRED',
  );
  for (const provenance of ['expected_payment_date', 'rental_end_date', 'manager_forecast']) {
    assert.throws(
      () => validateDueDateContract({
        contractualDueDate: '2026-07-20',
        dueDateProvenance: provenance,
      }),
      error => error.code === 'INVALID_DUE_DATE_PROVENANCE',
    );
  }
});

test('creation input rejects expected payment and rental end dates as canonical fields', () => {
  assert.throws(
    () => validateReceivableCreationInput(draftReceivable({ expectedPaymentDate: '2026-07-20' })),
    error => error.code === 'NON_CANONICAL_DUE_DATE_FIELD' && error.field === 'expectedPaymentDate',
  );
  assert.throws(
    () => validateReceivableCreationInput(draftReceivable({ endDate: '2026-07-20' })),
    error => error.code === 'NON_CANONICAL_DUE_DATE_FIELD' && error.field === 'endDate',
  );
});

test('posted amount, company, client, branch, source identity, and currency cannot silently change', () => {
  const previous = postedReceivable();
  assert.equal(validatePostedFieldImmutability(previous, { ...previous, description: 'updated display text' }), true);
  for (const [field, value] of [
    ['originalAmountMinor', 13000],
    ['companyId', 'company-2'],
    ['branchId', 'branch-2'],
    ['clientId', 'client-2'],
    ['sourceSystem', 'other_source'],
    ['sourceDocumentType', 'other_type'],
    ['sourceDocumentId', 'source-2'],
    ['sourceLineId', ''],
    ['sourceLineId', '   '],
    ['sourceLineId', 'line-2'],
    ['currency', 'USD'],
    ['companyTimezone', 'Asia/Yekaterinburg'],
  ]) {
    assert.throws(
      () => validatePostedFieldImmutability(previous, { ...previous, [field]: value }),
      error => error.code === 'POSTED_FIELD_IMMUTABLE' && error.field === field,
    );
  }
  const draft = draftReceivable();
  assert.equal(validatePostedFieldImmutability(draft, { ...draft, originalAmountMinor: 13000 }), true);
});

test('PR1 workflow contract allows only approved transitions and keeps cancellation/write-off behind explicit hooks', () => {
  assert.equal(validateWorkflowTransition('draft', 'posted'), true);
  assert.equal(validateWorkflowTransition('draft', 'cancelled'), true);
  assert.equal(validateWorkflowTransition('posted', 'disputed'), true);
  assert.throws(
    () => validateWorkflowTransition('disputed', 'posted'),
    error => error.code === 'WORKFLOW_TRANSITION_NOT_ALLOWED',
  );
  assert.equal(validateWorkflowTransition('disputed', 'posted', {
    disputeResolutionApproved: true,
  }), true);
  assert.throws(
    () => validateWorkflowTransition('posted', 'cancelled'),
    error => error.code === 'WORKFLOW_TRANSITION_NOT_ALLOWED',
  );
  assert.equal(validateWorkflowTransition('posted', 'cancelled', {
    cancellationWorkflowApproved: true,
  }), true);
  assert.throws(
    () => validateWorkflowTransition('posted', 'written_off', {
      writeOffWorkflowApproved: true,
    }),
    error => error.code === 'WORKFLOW_TRANSITION_NOT_ALLOWED',
  );
  assert.throws(
    () => validateWorkflowTransition('cancelled', 'posted'),
    error => error.code === 'WORKFLOW_TRANSITION_NOT_ALLOWED',
  );
});

test('PR1 outstanding and settlement helpers are deterministic and explicitly limited to original amount', () => {
  assert.equal(calculateOutstandingBalanceMinor(postedReceivable()), 12500);
  assert.equal(calculateOutstandingBalanceMinor(postedReceivable({ workflowStatus: 'disputed' })), 12500);
  assert.equal(calculateOutstandingBalanceMinor(draftReceivable()), 0);
  assert.equal(calculateOutstandingBalanceMinor(draftReceivable({
    workflowStatus: 'cancelled',
    cancellationReason: 'Draft cancelled',
    cancelledAt: '2026-07-13T10:00:00.000Z',
  })), 0);
  assert.equal(deriveSettlementState(postedReceivable()), 'open');
  assert.equal(deriveSettlementState(postedReceivable(), {
    outstandingBalanceMinor: 5000,
    confirmedAllocatedMinor: 7500,
  }), 'partially_paid');
  assert.equal(deriveSettlementState(postedReceivable(), {
    outstandingBalanceMinor: 0,
    confirmedAllocatedMinor: 12500,
  }), 'paid');
});

test('aging eligibility requires positive balance, posted state, accepted provenance, a date, and valid timezone', () => {
  const posted = postedReceivable();
  assert.equal(isAgingEligible(posted), true);
  assert.equal(isAgingEligible(posted, 0), false);
  assert.equal(isAgingEligible(postedReceivable({ dueDateProvenance: 'unknown' })), false);
  assert.equal(isAgingEligible(postedReceivable({ contractualDueDate: null })), false);
  assert.equal(isAgingEligible(postedReceivable({ companyTimezone: 'not/a-timezone' })), false);
  assert.equal(isAgingEligible(postedReceivable({ workflowStatus: 'disputed' })), false);
  assert.equal(isAgingEligible(draftReceivable({
    workflowStatus: 'cancelled',
    cancellationReason: 'Cancelled',
    cancelledAt: '2026-07-13T10:00:00.000Z',
  })), false);
  assert.equal(isAgingEligible(postedReceivable({
    workflowStatus: 'written_off',
    writtenOffAt: '2026-07-13T10:00:00.000Z',
  })), false);
});

test('overdue derivation keeps disputed and ambiguous balances outside ordinary overdue', () => {
  assert.deepEqual(deriveOverdueState(postedReceivable(), { asOfDate: '2026-07-20' }), {
    agingStatus: 'current',
    overdueDays: 0,
  });
  assert.deepEqual(deriveOverdueState(postedReceivable(), { asOfDate: '2026-07-21' }), {
    agingStatus: 'overdue',
    overdueDays: 1,
  });
  assert.deepEqual(deriveOverdueState(postedReceivable({ workflowStatus: 'disputed' }), {
    asOfDate: '2026-07-21',
  }), {
    agingStatus: 'disputed',
    overdueDays: null,
  });
  assert.deepEqual(deriveOverdueState(postedReceivable({
    contractualDueDate: null,
    dueDateProvenance: 'unknown',
  }), { asOfDate: '2026-07-21' }), {
    agingStatus: 'ambiguous',
    overdueDays: null,
  });
});

test('source and idempotency identities are deterministic and company scoped', () => {
  const firstSource = createSourceIdentity(draftReceivable());
  const repeatedSource = createSourceIdentity(draftReceivable({ sourceLineId: '  ' }));
  assert.equal(firstSource, repeatedSource);
  assert.notEqual(firstSource, createSourceIdentity(draftReceivable({ companyId: 'company-2' })));
  assert.notEqual(firstSource, createSourceIdentity(draftReceivable({ sourceLineId: 'line-1' })));

  const firstIdempotency = createIdempotencyIdentity(draftReceivable());
  assert.equal(firstIdempotency, createIdempotencyIdentity(draftReceivable()));
  assert.notEqual(firstIdempotency, createIdempotencyIdentity(draftReceivable({ companyId: 'company-2' })));
  assert.notEqual(firstIdempotency, createIdempotencyIdentity(draftReceivable({ idempotencyKey: 'other-key' })));
});
