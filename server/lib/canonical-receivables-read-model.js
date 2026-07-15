const {
  calculatePaymentUnapplied,
  calculateReceivableOutstanding,
} = require('./canonical-receivables-settlement-domain');
const {
  classifyReceivable,
  civilDateInTimezone,
  isEffectiveByAsOf,
} = require('./canonical-receivables-aging');

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

function parseAuditJson(value, field) {
  if (value === null || value === undefined || value === '') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    fail('CANONICAL_AUDIT_INTEGRITY_ERROR', `${field} contains invalid canonical audit JSON.`, field);
  }
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
      previousValue: parseAuditJson(event.previousValueJson, 'previousValueJson'),
      newValue: parseAuditJson(event.newValueJson, 'newValueJson'),
    }));
  const effective = approved.filter(event => isEffectiveByAsOf(event.occurredAt, timezone, asOfDate));
  if (effective.length > 0) {
    const latest = effective[effective.length - 1];
    return {
      contractualDueDate: latest.newValue?.contractualDueDate ?? null,
      dueDateProvenance: latest.newValue?.dueDateProvenance || 'unknown',
    };
  }
  if (approved.length > 0) {
    const earliestFuture = approved[0];
    return {
      contractualDueDate: earliestFuture.previousValue?.contractualDueDate ?? null,
      dueDateProvenance: earliestFuture.previousValue?.dueDateProvenance || 'unknown',
    };
  }
  return {
    contractualDueDate: receivable.contractualDueDate,
    dueDateProvenance: receivable.dueDateProvenance,
  };
}

function workflowStatusAtAsOf(receivable, events, { asOfDate, timezone }) {
  if (receivable.postedAt && !isEffectiveByAsOf(receivable.postedAt, timezone, asOfDate)) return 'draft';
  const approvedTransitions = events
    .filter(event => isEffectiveByAsOf(event.occurredAt, timezone, asOfDate))
    .map(event => ({
      ...event,
      previousValue: parseAuditJson(event.previousValueJson, 'previousValueJson'),
      newValue: parseAuditJson(event.newValueJson, 'newValueJson'),
    }))
    .filter(event => typeof event.newValue?.workflowStatus === 'string');
  if (approvedTransitions.length > 0) {
    return approvedTransitions[approvedTransitions.length - 1].newValue.workflowStatus;
  }
  if (
    receivable.workflowStatus === 'cancelled'
    && receivable.cancelledAt
    && !isEffectiveByAsOf(receivable.cancelledAt, timezone, asOfDate)
  ) {
    const event = events.find(item => item.eventType === 'cancellation_approved');
    const previousValue = parseAuditJson(event?.previousValueJson, 'previousValueJson');
    return previousValue?.workflowStatus || 'posted';
  }
  if (
    receivable.workflowStatus === 'written_off'
    && receivable.writtenOffAt
    && !isEffectiveByAsOf(receivable.writtenOffAt, timezone, asOfDate)
  ) return 'posted';
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
  // PR2 owns the approved arithmetic. Passing the raw balance-bearing state lets
  // the read side detect positive draft/cancelled/written-off integrity defects
  // instead of hiding them behind workflow zeroing.
  const outstandingBalanceMinor = calculateReceivableOutstanding({
    workflowStatus: 'posted',
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

function calculateScopedUnappliedPayments(snapshot, { asOfDate, timezone, clientId, currency = 'RUB' } = {}) {
  const allocationsByPayment = groupBy(snapshot.paymentAllocations || [], 'paymentId');
  const payments = (snapshot.payments || []).filter(payment => (
    payment.currency === currency
    && (!clientId || payment.clientId === clientId)
    && isEffectiveByAsOf(payment.receivedAt, timezone, asOfDate)
  ));
  const byId = new Map(payments.map(payment => [payment.id, payment]));
  let total = 0;
  for (const payment of payments) {
    if (payment.paymentKind !== 'receipt') continue;
    let confirmedActiveAllocationsMinor = 0;
    for (const allocation of allocationsByPayment.get(payment.id) || []) {
      if (
        allocation.allocationStatus !== 'confirmed'
        || !isEffectiveByAsOf(allocationEffectiveAt(allocation), timezone, asOfDate)
      ) continue;
      confirmedActiveAllocationsMinor = safeAdd(
        confirmedActiveAllocationsMinor,
        (allocation.allocationKind === 'reversal' ? -1 : 1) * allocation.allocatedAmountMinor,
        'confirmedActiveAllocationsMinor',
      );
    }
    let confirmedRefundsMinor = 0;
    for (const compensation of payments) {
      if (compensation.workflowStatus !== 'confirmed') continue;
      if (compensation.reversalOfPaymentId === payment.id) {
        confirmedRefundsMinor = safeAdd(
          confirmedRefundsMinor,
          compensation.refundAmountMinor,
          'confirmedRefundsMinor',
        );
        continue;
      }
      if (compensation.paymentKind !== 'reversal') continue;
      const original = byId.get(compensation.reversalOfPaymentId);
      if (original?.paymentKind === 'refund' && original.reversalOfPaymentId === payment.id) {
        confirmedRefundsMinor = safeAdd(
          confirmedRefundsMinor,
          -compensation.refundAmountMinor,
          'confirmedRefundsMinor',
        );
      }
    }
    const unapplied = calculatePaymentUnapplied({
      ...payment,
      internalTransfer: payment.internalTransfer === 1,
      confirmedActiveAllocationsMinor,
      confirmedRefundsMinor,
    });
    total = safeAdd(total, unapplied, 'unappliedPaymentMinor');
  }
  return total;
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
  dueDateAtAsOf,
  matchesReceivableFilters,
  projectReceivable,
  projectScopedReceivables,
  workflowStatusAtAsOf,
};
