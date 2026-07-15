const {
  calculatePaymentUnapplied,
  calculateReceivableOutstanding,
} = require('./canonical-receivables-settlement-domain');
const {
  ACCEPTED_DUE_DATE_PROVENANCES: AGING_ACCEPTED_DUE_DATE_PROVENANCES,
  classifyReceivable,
  civilDateInTimezone,
  isDateOnly,
  isEffectiveByAsOf,
} = require('./canonical-receivables-aging');

const ACCEPTED_DUE_DATE_PROVENANCES = new Set(AGING_ACCEPTED_DUE_DATE_PROVENANCES);
const DUE_DATE_PROVENANCES = new Set([...ACCEPTED_DUE_DATE_PROVENANCES, 'unknown']);
const WORKFLOW_STATUSES = new Set(['draft', 'posted', 'disputed', 'cancelled', 'written_off']);
const COMPLETED_WORKFLOW_EVENT_TYPES = new Set([
  'cancellation_approved',
  'dispute_opened',
  'dispute_resolved',
  'receivable_posted',
  'workflow_status_changed',
  'write_off_approved',
  'write_off_reversed',
]);

class CanonicalReceivablesReadModelError extends Error {
  constructor(code, message, field) {
    super(message);
    this.name = 'CanonicalReceivablesReadModelError';
    this.code = code;
    this.field = field;
  }
}

function fail(code, message, field) {
  throw new CanonicalReceivablesReadModelError(code, message, field);
}

function safeInteger(value, field) {
  if (!Number.isSafeInteger(value)) {
    fail('MINOR_UNIT_OVERFLOW', `${field} is outside the safe integer range.`, field);
  }
  return value;
}

function safeAdd(left, right, field) {
  return safeInteger(left + right, field);
}

function parseAuditJson(value, field, { required = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) {
      fail('CANONICAL_AUDIT_INTEGRITY_ERROR', `${field} is missing from canonical audit evidence.`, field);
    }
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    if (required) {
      fail('CANONICAL_AUDIT_INTEGRITY_ERROR', `${field} must contain a canonical audit object.`, field);
    }
    return null;
  } catch {
    fail('CANONICAL_AUDIT_INTEGRITY_ERROR', `${field} contains invalid canonical audit JSON.`, field);
  }
}

function auditIntegrity(message, field) {
  fail('CANONICAL_AUDIT_INTEGRITY_ERROR', message, field);
}

function compareAuditEvents(left, right) {
  const byTime = String(left.occurredAt || '').localeCompare(String(right.occurredAt || ''));
  return byTime || String(left.id || '').localeCompare(String(right.id || ''));
}

function validateAuditEventIdentity(event, seenCorrelations) {
  if (
    typeof event.id !== 'string'
    || !event.id
    || typeof event.correlationId !== 'string'
    || !event.correlationId
    || typeof event.occurredAt !== 'string'
    || Number.isNaN(Date.parse(event.occurredAt))
  ) {
    auditIntegrity('Canonical audit evidence has an invalid identity or effective timestamp.');
  }
  if (seenCorrelations.has(event.correlationId)) {
    auditIntegrity('Duplicate canonical audit evidence was detected.', 'correlationId');
  }
  seenCorrelations.add(event.correlationId);
}

function dueDateState(value, field) {
  const parsed = parseAuditJson(value, field, { required: true });
  if (
    !Object.prototype.hasOwnProperty.call(parsed, 'contractualDueDate')
    || !Object.prototype.hasOwnProperty.call(parsed, 'dueDateProvenance')
  ) {
    auditIntegrity(`${field} is missing contractual due-date evidence.`, field);
  }
  const contractualDueDate = parsed.contractualDueDate ?? null;
  const dueDateProvenance = parsed.dueDateProvenance;
  if (
    !DUE_DATE_PROVENANCES.has(dueDateProvenance)
    || (contractualDueDate !== null && !isDateOnly(contractualDueDate))
    || (ACCEPTED_DUE_DATE_PROVENANCES.has(dueDateProvenance) && contractualDueDate === null)
  ) {
    auditIntegrity(`${field} contains invalid contractual due-date evidence.`, field);
  }
  return { contractualDueDate, dueDateProvenance };
}

function sameDueDateState(left, right) {
  return left.contractualDueDate === right.contractualDueDate
    && left.dueDateProvenance === right.dueDateProvenance;
}

function groupBy(rows, key) {
  const grouped = new Map();
  for (const row of rows) {
    const value = row[key];
    const list = grouped.get(value) || [];
    list.push(row);
    grouped.set(value, list);
  }
  return grouped;
}

function dueDateAtAsOf(receivable, events, { asOfDate, timezone }) {
  const approved = events
    .filter(event => event.eventType === 'due_date_change_approved')
    .map(event => ({
      ...event,
      previousValue: dueDateState(event.previousValueJson, 'previousValueJson'),
      newValue: dueDateState(event.newValueJson, 'newValueJson'),
    }))
    .sort(compareAuditEvents);
  const seenCorrelations = new Set();
  for (let index = 0; index < approved.length; index += 1) {
    const event = approved[index];
    validateAuditEventIdentity(event, seenCorrelations);
    if (index > 0) {
      const previous = approved[index - 1];
      if (event.occurredAt === previous.occurredAt) {
        auditIntegrity('Multiple due-date approvals share an ambiguous effective timestamp.', 'occurredAt');
      }
      if (!sameDueDateState(event.previousValue, previous.newValue)) {
        auditIntegrity('Canonical due-date audit evidence is conflicting or incomplete.');
      }
    }
  }
  if (approved.length > 0) {
    const current = {
      contractualDueDate: receivable.contractualDueDate ?? null,
      dueDateProvenance: receivable.dueDateProvenance,
    };
    if (!sameDueDateState(approved[approved.length - 1].newValue, current)) {
      auditIntegrity('Canonical due-date audit evidence does not reconcile to the stored receivable.');
    }
  }
  const effective = approved.filter(event => isEffectiveByAsOf(event.occurredAt, timezone, asOfDate));
  if (effective.length > 0) {
    const latest = effective[effective.length - 1];
    return latest.newValue;
  }
  if (approved.length > 0) {
    return approved[0].previousValue;
  }
  return {
    contractualDueDate: receivable.contractualDueDate,
    dueDateProvenance: receivable.dueDateProvenance,
  };
}

function workflowState(value, field) {
  const parsed = parseAuditJson(value, field, { required: true });
  if (!WORKFLOW_STATUSES.has(parsed.workflowStatus)) {
    auditIntegrity(`${field} is missing an approved workflow status.`, field);
  }
  return parsed.workflowStatus;
}

function workflowStatusAtAsOf(receivable, events, { asOfDate, timezone }) {
  if (receivable.postedAt && !isEffectiveByAsOf(receivable.postedAt, timezone, asOfDate)) return 'draft';
  const approvedTransitions = events
    .filter(event => COMPLETED_WORKFLOW_EVENT_TYPES.has(event.eventType))
    .map(event => ({
      ...event,
      previousStatus: workflowState(event.previousValueJson, 'previousValueJson'),
      newStatus: workflowState(event.newValueJson, 'newValueJson'),
    }))
    .sort(compareAuditEvents);
  const seenCorrelations = new Set();
  for (let index = 0; index < approvedTransitions.length; index += 1) {
    const event = approvedTransitions[index];
    validateAuditEventIdentity(event, seenCorrelations);
    if (index > 0) {
      const previous = approvedTransitions[index - 1];
      if (event.occurredAt === previous.occurredAt || event.previousStatus !== previous.newStatus) {
        auditIntegrity('Canonical workflow audit evidence is conflicting or incomplete.');
      }
    }
  }
  if (approvedTransitions.length > 0) {
    const latest = approvedTransitions[approvedTransitions.length - 1];
    if (latest.newStatus !== receivable.workflowStatus) {
      auditIntegrity('Canonical workflow audit evidence does not reconcile to the stored receivable.');
    }
    let status = approvedTransitions[0].previousStatus;
    for (const event of approvedTransitions) {
      if (!isEffectiveByAsOf(event.occurredAt, timezone, asOfDate)) break;
      status = event.newStatus;
    }
    return status;
  }
  if (
    ['cancelled', 'written_off'].includes(receivable.workflowStatus)
    && !isEffectiveByAsOf(
      receivable.workflowStatus === 'cancelled' ? receivable.cancelledAt : receivable.writtenOffAt,
      timezone,
      asOfDate,
    )
  ) {
    auditIntegrity('Historical workflow status cannot be reconstructed without completed audit evidence.');
  }
  if (
    receivable.workflowStatus === 'disputed'
    && !isEffectiveByAsOf(receivable.updatedAt, timezone, asOfDate)
  ) {
    auditIntegrity('Historical dispute status cannot be reconstructed without completed audit evidence.');
  }
  return receivable.workflowStatus;
}

function allocationEffectiveAt(row) {
  return row.approvedAt || row.reversedAt || row.initiatedAt || row.createdAt;
}

function projectReceivable(receivable, context = {}) {
  const { asOfDate, timezone } = context;
  const allocations = (context.allocations || []).filter(row => (
    row.allocationStatus === 'confirmed'
    && isEffectiveByAsOf(allocationEffectiveAt(row), timezone, asOfDate)
  ));
  const adjustments = (context.adjustments || []).filter(row => (
    row.workflowStatus === 'confirmed'
    && isEffectiveByAsOf(row.effectiveAt, timezone, asOfDate)
  ));
  const auditEvents = context.auditEvents || [];

  let confirmedAllocatedMinor = 0;
  for (const allocation of allocations) {
    const direction = allocation.allocationKind === 'reversal' ? -1 : 1;
    confirmedAllocatedMinor = safeAdd(
      confirmedAllocatedMinor,
      direction * safeInteger(allocation.allocatedAmountMinor, 'allocatedAmountMinor'),
      'confirmedAllocatedMinor',
    );
  }
  if (confirmedAllocatedMinor < 0) {
    fail('CANONICAL_ALLOCATION_INTEGRITY_ERROR', 'Confirmed allocation reversals exceed allocations.');
  }

  let confirmedDebitAdjustmentsMinor = 0;
  let confirmedCreditAdjustmentsMinor = 0;
  let confirmedWriteOffMinor = 0;
  for (const adjustment of adjustments) {
    const amount = safeInteger(adjustment.amountMinor, 'amountMinor');
    if (adjustment.adjustmentType === 'write_off' && adjustment.balanceEffect === 'decrease') {
      confirmedWriteOffMinor = safeAdd(confirmedWriteOffMinor, amount, 'confirmedWriteOffMinor');
    } else if (adjustment.balanceEffect === 'increase') {
      confirmedDebitAdjustmentsMinor = safeAdd(
        confirmedDebitAdjustmentsMinor,
        amount,
        'confirmedDebitAdjustmentsMinor',
      );
    } else if (adjustment.balanceEffect === 'decrease') {
      confirmedCreditAdjustmentsMinor = safeAdd(
        confirmedCreditAdjustmentsMinor,
        amount,
        'confirmedCreditAdjustmentsMinor',
      );
    }
  }

  const status = workflowStatusAtAsOf(receivable, auditEvents, { asOfDate, timezone });
  const dueDate = dueDateAtAsOf(receivable, auditEvents, { asOfDate, timezone });
  // PR2 owns the approved arithmetic, including zero balance for draft and
  // cancelled workflow states. The aging layer still rejects any positive
  // cancelled/written-off view supplied by a future or corrupted projection.
  const outstandingBalanceMinor = calculateReceivableOutstanding({
    workflowStatus: status,
    originalAmountMinor: safeInteger(receivable.originalAmountMinor, 'originalAmountMinor'),
    confirmedDebitAdjustmentsMinor,
    confirmedCreditAdjustmentsMinor,
    confirmedWriteOffMinor,
    confirmedActivePaymentAllocationsMinor: confirmedAllocatedMinor,
  });
  const balanceStatus = outstandingBalanceMinor === 0
    ? 'paid'
    : confirmedAllocatedMinor > 0 ? 'partially_paid' : 'open';
  const baseView = {
    id: receivable.id,
    companyId: receivable.companyId,
    branchId: receivable.branchId,
    clientId: receivable.clientId,
    contractId: receivable.contractId,
    rentalId: receivable.rentalId,
    sourceDocumentType: receivable.sourceDocumentType,
    sourceDocumentId: receivable.sourceDocumentId,
    sourceLineId: receivable.sourceLineId,
    normalizedSourceLineId: receivable.normalizedSourceLineId,
    sourceSystem: receivable.sourceSystem,
    externalId: receivable.externalId,
    currency: receivable.currency,
    originalAmountMinor: receivable.originalAmountMinor,
    confirmedDebitAdjustmentsMinor,
    confirmedCreditAdjustmentsMinor,
    confirmedAllocatedMinor,
    confirmedWriteOffMinor,
    outstandingBalanceMinor,
    unallocatedAgainstReceivableMinor: 0,
    issuedAt: receivable.issuedAt,
    postedAt: receivable.postedAt,
    contractualDueDate: dueDate.contractualDueDate,
    dueDateProvenance: dueDate.dueDateProvenance,
    companyTimezone: receivable.companyTimezone,
    status,
    balanceStatus: ['posted', 'disputed'].includes(status) ? balanceStatus : 'not_applicable',
    description: receivable.description,
    createdAt: receivable.createdAt,
    updatedAt: receivable.updatedAt,
    cancelledAt: receivable.cancelledAt,
    closedAt: receivable.closedAt,
    writtenOffAt: receivable.writtenOffAt,
    version: receivable.version,
  };
  const aging = classifyReceivable(baseView, asOfDate);
  return {
    ...baseView,
    agingStatus: aging.classification === 'settled'
      ? 'settled'
      : ['current', 'days1to30', 'days31to60', 'days61to90', 'over90'].includes(aging.classification)
        ? (aging.classification === 'current' ? 'current' : 'overdue')
        : aging.classification,
    agingBucket: ['current', 'days1to30', 'days31to60', 'days61to90', 'over90'].includes(aging.classification)
      ? aging.classification
      : null,
    overdueDays: aging.overdueDays,
  };
}

function projectScopedReceivables(snapshot, { asOfDate, timezone }) {
  const allocationsByReceivable = groupBy(snapshot.allocations || [], 'receivableId');
  const adjustmentsByReceivable = groupBy(snapshot.adjustments || [], 'receivableId');
  const auditsByReceivable = groupBy(snapshot.auditEvents || [], 'aggregateId');
  return (snapshot.receivables || [])
    .filter(receivable => isEffectiveByAsOf(receivable.createdAt, timezone, asOfDate))
    .map(receivable => projectReceivable(receivable, {
      asOfDate,
      timezone,
      allocations: allocationsByReceivable.get(receivable.id) || [],
      adjustments: adjustmentsByReceivable.get(receivable.id) || [],
      auditEvents: auditsByReceivable.get(receivable.id) || [],
    }));
}

function createScopedUnappliedPaymentsAccumulator({
  asOfDate,
  timezone,
  clientId,
  currency = 'RUB',
} = {}) {
  const paymentsById = new Map();
  const receiptStates = new Map();

  function addPayments(rows = []) {
    for (const payment of rows) {
      if (
        payment.currency !== currency
        || (clientId && payment.clientId !== clientId)
        || !isEffectiveByAsOf(payment.receivedAt, timezone, asOfDate)
      ) continue;
      paymentsById.set(payment.id, payment);
      if (payment.paymentKind === 'receipt') {
        receiptStates.set(payment.id, {
          payment,
          confirmedActiveAllocationsMinor: 0,
          confirmedRefundsMinor: 0,
        });
      }
    }
  }

  function addAllocations(rows = []) {
    for (const allocation of rows) {
      if (
        allocation.allocationStatus !== 'confirmed'
        || !isEffectiveByAsOf(allocationEffectiveAt(allocation), timezone, asOfDate)
      ) continue;
      const state = receiptStates.get(allocation.paymentId);
      if (!state) continue;
      const amount = safeInteger(allocation.allocatedAmountMinor, 'allocatedAmountMinor');
      state.confirmedActiveAllocationsMinor = safeAdd(
        state.confirmedActiveAllocationsMinor,
        (allocation.allocationKind === 'reversal' ? -1 : 1) * amount,
        'confirmedActiveAllocationsMinor',
      );
    }
  }

  function addPaymentEffects(rows = []) {
    for (const effect of rows) {
      if (
        effect.workflowStatus !== 'confirmed'
        || !isEffectiveByAsOf(effect.receivedAt, timezone, asOfDate)
      ) continue;
      const state = receiptStates.get(effect.receiptId);
      if (!state) continue;
      state.confirmedRefundsMinor = safeAdd(
        state.confirmedRefundsMinor,
        safeInteger(effect.refundDeltaMinor, 'refundDeltaMinor'),
        'confirmedRefundsMinor',
      );
    }
  }

  function finish() {
    for (const payment of paymentsById.values()) {
      if (payment.workflowStatus !== 'confirmed' || !payment.reversalOfPaymentId) continue;
      const directReceipt = receiptStates.get(payment.reversalOfPaymentId);
      const amount = safeInteger(payment.refundAmountMinor, 'refundAmountMinor');
      if (directReceipt) {
        directReceipt.confirmedRefundsMinor = safeAdd(
          directReceipt.confirmedRefundsMinor,
          amount,
          'confirmedRefundsMinor',
        );
        continue;
      }
      if (payment.paymentKind !== 'reversal') continue;
      const original = paymentsById.get(payment.reversalOfPaymentId);
      const receipt = original?.paymentKind === 'refund'
        ? receiptStates.get(original.reversalOfPaymentId)
        : null;
      if (receipt) {
        receipt.confirmedRefundsMinor = safeAdd(
          receipt.confirmedRefundsMinor,
          -amount,
          'confirmedRefundsMinor',
        );
      }
    }
    let total = 0;
    for (const state of receiptStates.values()) {
      total = safeAdd(total, calculatePaymentUnapplied({
        ...state.payment,
        internalTransfer: state.payment.internalTransfer === 1,
        confirmedActiveAllocationsMinor: state.confirmedActiveAllocationsMinor,
        confirmedRefundsMinor: state.confirmedRefundsMinor,
      }), 'unappliedPaymentMinor');
    }
    return total;
  }

  return Object.freeze({ addAllocations, addPaymentEffects, addPayments, finish });
}

function calculateScopedUnappliedPayments(snapshot, options = {}) {
  const accumulator = createScopedUnappliedPaymentsAccumulator(options);
  accumulator.addPayments(snapshot.payments || []);
  accumulator.addAllocations(snapshot.paymentAllocations || []);
  return accumulator.finish();
}

function matchesReceivableFilters(view, filters = {}, timezone) {
  const equalFilters = {
    clientId: 'clientId',
    contractId: 'contractId',
    rentalId: 'rentalId',
    sourceSystem: 'sourceSystem',
    sourceDocumentType: 'sourceDocumentType',
    sourceDocumentId: 'sourceDocumentId',
    sourceLineId: 'sourceLineId',
    status: 'status',
    balanceStatus: 'balanceStatus',
    agingStatus: 'agingStatus',
    currency: 'currency',
  };
  for (const [filter, field] of Object.entries(equalFilters)) {
    if (filters[filter] !== undefined && filters[filter] !== null && filters[filter] !== '') {
      if (String(view[field] ?? '') !== String(filters[filter])) return false;
    }
  }
  if (filters.dueDateFrom && (!view.contractualDueDate || view.contractualDueDate < filters.dueDateFrom)) return false;
  if (filters.dueDateTo && (!view.contractualDueDate || view.contractualDueDate > filters.dueDateTo)) return false;
  const issuedDate = view.issuedAt ? civilDateInTimezone(view.issuedAt, timezone) : null;
  if (filters.issuedFrom && (!issuedDate || issuedDate < filters.issuedFrom)) return false;
  if (filters.issuedTo && (!issuedDate || issuedDate > filters.issuedTo)) return false;
  return true;
}

module.exports = {
  CanonicalReceivablesReadModelError,
  calculateScopedUnappliedPayments,
  createScopedUnappliedPaymentsAccumulator,
  dueDateAtAsOf,
  matchesReceivableFilters,
  projectReceivable,
  projectScopedReceivables,
  workflowStatusAtAsOf,
};
