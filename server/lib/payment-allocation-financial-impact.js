const {
  AR_DEBTOR_IDENTITY_STATUSES,
  resolveArDebtorIdentity,
} = require('./ar-debtor-identity');
const {
  resolvePaymentCounterpartyRelation,
} = require('./payment-counterparty-relations');
const {
  resolveRentalCounterpartyRelation,
} = require('./rental-counterparty-relations');
const { COUNTERPARTY_RELATION_CODES } = require('./counterparty-relations');

const RELATION_SOURCES = Object.freeze({
  EXPLICIT_ALLOCATION: 'explicit_allocation',
  DIRECT_PAYMENT_RENTAL: 'direct_payment_rental',
});

const SEVERITIES = Object.freeze({
  BLOCKING: 'Blocking',
  WARNING: 'Warning',
  INFORMATIONAL: 'Informational',
});

const ISSUE_CLASSES = Object.freeze({
  SAFE: 'safe',
  LEGACY_RESOLVED: 'legacy_resolved',
  CROSS_COUNTERPARTY: 'cross_counterparty',
  PAYMENT_IDENTITY_CONFLICT: 'payment_identity_conflict',
  RENTAL_IDENTITY_CONFLICT: 'rental_identity_conflict',
  UNRESOLVED_PAYMENT: 'unresolved_payment',
  UNRESOLVED_RENTAL: 'unresolved_rental',
  ORPHAN_PAYMENT: 'orphan_payment',
  ORPHAN_RENTAL: 'orphan_rental',
  ORPHAN_COUNTERPARTY: 'orphan_counterparty',
  AMBIGUOUS_COUNTERPARTY: 'ambiguous_counterparty',
  DUPLICATE_PAYMENT_ID: 'duplicate_payment_id',
  DUPLICATE_RENTAL_ID: 'duplicate_rental_id',
  DUPLICATE_ALLOCATION_ID: 'duplicate_allocation_id',
  INVALID_AMOUNT: 'invalid_amount',
  NEGATIVE_AMOUNT: 'negative_amount',
  OVER_CAP: 'over_cap',
  ORDERING_EFFECT: 'ordering_effect',
  CANCELLED: 'cancelled',
  READER_DIFFERENCE: 'reader_difference',
});

const REQUIRED_COLLECTIONS = Object.freeze([
  'payments',
  'payment_allocations',
  'rentals',
  'gantt_rentals',
  'clients',
  'counterparties',
  'counterparty_role_assignments',
  'documents',
]);

const IGNORED_PAYMENT_STATUSES = new Set([
  'cancelled',
  'canceled',
  'void',
  'error',
  'failed',
  'closed',
  'deleted',
  'reversed',
]);

const IGNORED_RENTAL_STATUSES = new Set([
  'cancelled',
  'canceled',
  'void',
  'error',
  'failed',
  'deleted',
  'archived',
]);

const SEVERITY_ORDER = Object.freeze({
  [SEVERITIES.BLOCKING]: 0,
  [SEVERITIES.WARNING]: 1,
  [SEVERITIES.INFORMATIONAL]: 2,
});

const ISSUE_PRIORITY = Object.freeze([
  ISSUE_CLASSES.DUPLICATE_PAYMENT_ID,
  ISSUE_CLASSES.DUPLICATE_RENTAL_ID,
  ISSUE_CLASSES.DUPLICATE_ALLOCATION_ID,
  ISSUE_CLASSES.ORPHAN_PAYMENT,
  ISSUE_CLASSES.ORPHAN_RENTAL,
  ISSUE_CLASSES.ORPHAN_COUNTERPARTY,
  ISSUE_CLASSES.AMBIGUOUS_COUNTERPARTY,
  ISSUE_CLASSES.PAYMENT_IDENTITY_CONFLICT,
  ISSUE_CLASSES.RENTAL_IDENTITY_CONFLICT,
  ISSUE_CLASSES.UNRESOLVED_PAYMENT,
  ISSUE_CLASSES.UNRESOLVED_RENTAL,
  ISSUE_CLASSES.CROSS_COUNTERPARTY,
  ISSUE_CLASSES.INVALID_AMOUNT,
  ISSUE_CLASSES.NEGATIVE_AMOUNT,
  ISSUE_CLASSES.OVER_CAP,
  ISSUE_CLASSES.ORDERING_EFFECT,
  ISSUE_CLASSES.READER_DIFFERENCE,
  ISSUE_CLASSES.LEGACY_RESOLVED,
  ISSUE_CLASSES.CANCELLED,
  ISSUE_CLASSES.SAFE,
]);

const BLOCKING_ISSUE_CLASSES = new Set([
  ISSUE_CLASSES.CROSS_COUNTERPARTY,
  ISSUE_CLASSES.PAYMENT_IDENTITY_CONFLICT,
  ISSUE_CLASSES.RENTAL_IDENTITY_CONFLICT,
  ISSUE_CLASSES.UNRESOLVED_PAYMENT,
  ISSUE_CLASSES.UNRESOLVED_RENTAL,
  ISSUE_CLASSES.ORPHAN_PAYMENT,
  ISSUE_CLASSES.ORPHAN_RENTAL,
  ISSUE_CLASSES.ORPHAN_COUNTERPARTY,
  ISSUE_CLASSES.AMBIGUOUS_COUNTERPARTY,
  ISSUE_CLASSES.DUPLICATE_PAYMENT_ID,
  ISSUE_CLASSES.DUPLICATE_RENTAL_ID,
  ISSUE_CLASSES.DUPLICATE_ALLOCATION_ID,
  ISSUE_CLASSES.INVALID_AMOUNT,
  ISSUE_CLASSES.NEGATIVE_AMOUNT,
  ISSUE_CLASSES.OVER_CAP,
  ISSUE_CLASSES.ORDERING_EFFECT,
]);

const CONSUMER_MATRIX = Object.freeze([
  Object.freeze({
    consumer: 'finance_core_ar',
    usesExplicitAllocations: true,
    usesDirectPaymentRentalId: 'fallback_only',
    capsAndOrders: 'payment amount cap; persisted allocation order; allocation dedupe',
    canonicalCounterpartyValidation: false,
    changesOutstanding: true,
    notes: 'Backend finance-core formula used by receivables balances, reports, cash-flow receivables, and frontend mirrors.',
  }),
  Object.freeze({
    consumer: 'finance_routes_linked_ar',
    usesExplicitAllocations: true,
    usesDirectPaymentRentalId: 'fallback_only',
    capsAndOrders: 'finance-core cap/order/dedupe after filtering Gantt rows to linked Classic Rentals',
    canonicalCounterpartyValidation: false,
    changesOutstanding: true,
    notes: 'Finance API collection boundary excludes Gantt rows without a stable Classic Rental link.',
  }),
  Object.freeze({
    consumer: 'frontend_finance_mirror',
    usesExplicitAllocations: true,
    usesDirectPaymentRentalId: 'fallback_only',
    capsAndOrders: 'payment amount cap; persisted order; frontend no-id allocation dedupe key',
    canonicalCounterpartyValidation: false,
    changesOutstanding: true,
    notes: 'Differs from backend for no-id allocations and allocatedAmount-only legacy rows.',
  }),
  Object.freeze({
    consumer: 'manager_report_backend',
    usesExplicitAllocations: true,
    usesDirectPaymentRentalId: 'fallback_only',
    capsAndOrders: 'payment amount cap; persisted order; no allocation status filter or dedupe',
    canonicalCounterpartyValidation: false,
    changesOutstanding: true,
    notes: 'Can count cancelled/error/duplicate allocation rows that finance-core ignores.',
  }),
  Object.freeze({
    consumer: 'manager_report_frontend',
    usesExplicitAllocations: true,
    usesDirectPaymentRentalId: 'fallback_only',
    capsAndOrders: 'payment amount cap; persisted order; status filter; no allocation dedupe',
    canonicalCounterpartyValidation: false,
    changesOutstanding: true,
    notes: 'Mirrors finance filtering but does not mirror allocation dedupe.',
  }),
  Object.freeze({
    consumer: 'finance_core_without_allocations',
    usesExplicitAllocations: false,
    usesDirectPaymentRentalId: true,
    capsAndOrders: 'payment amount cap; duplicate direct Payment IDs deduped',
    canonicalCounterpartyValidation: false,
    changesOutstanding: true,
    notes: 'Current Tasks Center and several frontend debt call sites omit payment_allocations.',
  }),
  Object.freeze({
    consumer: 'rental_detail',
    usesExplicitAllocations: true,
    usesDirectPaymentRentalId: 'fallback_only',
    capsAndOrders: 'raw positive allocation sum; no Payment cap; cancelled-only filter',
    canonicalCounterpartyValidation: false,
    changesOutstanding: false,
    notes: 'Classic Rental payment display and paidAmount presentation.',
  }),
  Object.freeze({
    consumer: 'receivables_payment_detail',
    usesExplicitAllocations: false,
    usesDirectPaymentRentalId: true,
    capsAndOrders: 'raw direct association; effective Payment amount; no cap or dedupe',
    canonicalCounterpartyValidation: false,
    changesOutstanding: false,
    notes: 'Payment list attached to an otherwise finance-core receivable row.',
  }),
  Object.freeze({
    consumer: 'payment_status_sync',
    usesExplicitAllocations: true,
    usesDirectPaymentRentalId: 'fallback_only',
    capsAndOrders: 'effective paid cap only; persisted order; cancelled-only filter; no dedupe',
    canonicalCounterpartyValidation: false,
    changesOutstanding: false,
    notes: 'Changes Gantt paymentStatus and matches Classic/Gantt rental aliases.',
  }),
  Object.freeze({
    consumer: 'rental_workspace_payment_status',
    usesExplicitAllocations: false,
    usesDirectPaymentRentalId: true,
    capsAndOrders: 'effective direct Payment amount; alias matching; no cap or dedupe',
    canonicalCounterpartyValidation: false,
    changesOutstanding: false,
    notes: 'Frontend Rentals workspace recalculation after adding a Payment.',
  }),
  Object.freeze({
    consumer: 'raw_direct_debt_helpers',
    usesExplicitAllocations: false,
    usesDirectPaymentRentalId: true,
    capsAndOrders: 'effective Payment amount; no Payment cap, allocation precedence, or dedupe',
    canonicalCounterpartyValidation: false,
    changesOutstanding: true,
    notes: 'Rental change-request debt calculation and other legacy direct helpers.',
  }),
  Object.freeze({
    consumer: 'rental_extension_financials',
    usesExplicitAllocations: false,
    usesDirectPaymentRentalId: true,
    capsAndOrders: 'numeric paidAmount, otherwise paid Payment amount; alias matching; no cap or dedupe',
    canonicalCounterpartyValidation: false,
    changesOutstanding: true,
    notes: 'Rental extension preview paidAmount/outstanding calculation.',
  }),
  Object.freeze({
    consumer: 'equipment_detail_ar',
    usesExplicitAllocations: false,
    usesDirectPaymentRentalId: true,
    capsAndOrders: 'effective Payment amount; no Payment cap, allocation precedence, or dedupe',
    canonicalCounterpartyValidation: false,
    changesOutstanding: true,
    notes: 'Equipment detail paid revenue and equipment debt.',
  }),
  Object.freeze({
    consumer: 'equipment_360_payment_outstanding',
    usesExplicitAllocations: false,
    usesDirectPaymentRentalId: true,
    capsAndOrders: 'Payment face amount minus effective paid amount; no allocation precedence',
    canonicalCounterpartyValidation: false,
    changesOutstanding: false,
    notes: 'Equipment 360 invoice-outstanding presentation; metric differs from AR paid contribution.',
  }),
  Object.freeze({
    consumer: 'manager_plan_debt_snapshot',
    usesExplicitAllocations: false,
    usesDirectPaymentRentalId: true,
    capsAndOrders: 'stored debt/outstanding/balance snapshot; last row per client/rental key wins',
    canonicalCounterpartyValidation: false,
    changesOutstanding: false,
    notes: 'Manager My Plan debtor attribution; it does not recalculate Payment allocations.',
  }),
  Object.freeze({
    consumer: 'bot_manager_financial_view',
    usesExplicitAllocations: false,
    usesDirectPaymentRentalId: true,
    capsAndOrders: 'raw paidAmount, otherwise raw amount; no status filter, cap, or dedupe',
    canonicalCounterpartyValidation: false,
    changesOutstanding: true,
    notes: 'MAX manager current-debt view.',
  }),
  Object.freeze({
    consumer: 'equipment_economics',
    usesExplicitAllocations: false,
    usesDirectPaymentRentalId: true,
    capsAndOrders: 'last Payment per Rental wins; raw paidAmount/amount',
    canonicalCounterpartyValidation: false,
    changesOutstanding: false,
    notes: 'Paid-revenue equipment view; included as a related financial presentation.',
  }),
]);

function text(value) {
  return String(value ?? '').trim();
}

function normalizeStatus(value) {
  return text(value).toLowerCase();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readCollection(data, name) {
  if (typeof data === 'function') return asArray(data(name));
  if (data && typeof data.readData === 'function') return asArray(data.readData(name));
  return asArray(data?.[name]);
}

function compareText(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''), 'en');
}

function shouldCountPayment(record) {
  return !IGNORED_PAYMENT_STATUSES.has(normalizeStatus(record?.status));
}

function shouldCountRental(record) {
  return !IGNORED_RENTAL_STATUSES.has(normalizeStatus(record?.status));
}

function positiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function effectivePaidAmount(payment) {
  if (!shouldCountPayment(payment)) return 0;
  if (typeof payment?.paidAmount === 'number') {
    return Number.isFinite(payment.paidAmount) ? Math.max(0, payment.paidAmount) : 0;
  }
  return payment?.status === 'paid' ? positiveNumber(payment?.amount) : 0;
}

function paymentCap(payment, capToPaymentAmount = true) {
  const paid = effectivePaidAmount(payment);
  if (!capToPaymentAmount) return paid;
  const amount = Number(payment?.amount);
  return Number.isFinite(amount) && amount > 0 ? Math.min(paid, amount) : paid;
}

function allocationAmount(allocation) {
  return positiveNumber(allocation?.amount ?? allocation?.allocatedAmount);
}

function countIds(records) {
  const result = new Map();
  for (const record of records) {
    const id = text(record?.id);
    if (id) result.set(id, (result.get(id) || 0) + 1);
  }
  return result;
}

function rentalReferenceIds(rental) {
  return [rental?.id, rental?.rentalId, rental?.sourceRentalId, rental?.originalRentalId]
    .map(text)
    .filter(Boolean);
}

function buildRelations(collections) {
  const explicit = collections.payment_allocations.map((record, sourceIndex) => ({
    _key: `explicit_allocation:${sourceIndex}`,
    relationSource: RELATION_SOURCES.EXPLICIT_ALLOCATION,
    sourceIndex,
    allocationId: text(record?.id) || null,
    paymentId: text(record?.paymentId) || null,
    rentalId: text(record?.rentalId) || null,
    documentId: text(record?.documentId) || null,
    provenanceSource: text(record?.source) || null,
    record,
  }));
  const direct = collections.payments
    .map((record, sourceIndex) => ({ record, sourceIndex }))
    .filter(({ record }) => text(record?.rentalId))
    .map(({ record, sourceIndex }) => ({
      _key: `direct_payment_rental:${sourceIndex}`,
      relationSource: RELATION_SOURCES.DIRECT_PAYMENT_RENTAL,
      sourceIndex,
      allocationId: null,
      paymentId: text(record?.id) || null,
      rentalId: text(record?.rentalId) || null,
      documentId: text(record?.documentId || record?.document) || null,
      provenanceSource: 'payment_rental',
      record,
    }));
  return { explicit, direct, all: [...explicit, ...direct] };
}

function emptyEffect(reader) {
  return {
    reader,
    counted: false,
    effectiveAmount: 0,
    targetRentalId: null,
    affectedRentalIds: [],
    targetRentalMatches: 0,
    affectsBalance: false,
    appliedAmountAcrossRows: 0,
    whyCounted: null,
    statusExcluded: false,
    duplicateExcluded: false,
    suppressedByExplicitAllocation: false,
    truncatedByCap: false,
    orderingSelected: false,
    priorEffectiveAmount: 0,
    precedenceImpactAmount: 0,
    precedenceAffectedRentalId: null,
  };
}

function makeEffectMap(relations, reader) {
  return new Map(relations.all.map(relation => [relation._key, emptyEffect(reader)]));
}

function allocationDedupeKey(allocation) {
  const id = text(allocation?.id);
  if (id) return id;
  return JSON.stringify([
    text(allocation?.paymentId),
    text(allocation?.rentalId),
    text(allocation?.documentId),
    text(allocation?.objectId),
    text(allocation?.contractId),
    allocationAmount(allocation),
  ]);
}

function frontendAllocationDedupeKey(allocation) {
  const id = text(allocation?.id);
  if (id) return id;
  return JSON.stringify([
    text(allocation?.paymentId),
    text(allocation?.rentalId),
    text(allocation?.documentId),
    allocation?.amount || 0,
  ]);
}

function frontendAllocationAmount(allocation) {
  return positiveNumber(allocation?.amount);
}

function allocationIncluded(allocation, mode) {
  if (mode === 'none') return false;
  if (mode === 'all') return true;
  if (mode === 'cancel_only') return normalizeStatus(allocation?.status) !== 'cancelled';
  return shouldCountPayment(allocation);
}

function matchingRentals(collections, rawRentalId, targetMode) {
  const id = text(rawRentalId);
  if (!id) return [];
  if (targetMode === 'classic_exact') {
    return collections.rentals.filter(rental => text(rental?.id) === id);
  }
  if (targetMode === 'gantt_alias') {
    return collections.gantt_rentals.filter(rental => rentalReferenceIds(rental).includes(id));
  }
  if (targetMode === 'all_alias') {
    return [...collections.rentals, ...collections.gantt_rentals]
      .filter(rental => rentalReferenceIds(rental).includes(id));
  }
  if (targetMode === 'gantt_linked_exact') {
    const classicRentalIds = new Set(collections.rentals.map(rental => text(rental?.id)).filter(Boolean));
    return collections.gantt_rentals.filter(rental => (
      text(rental?.id) === id
      && [rental?.rentalId, rental?.sourceRentalId, rental?.originalRentalId]
        .map(text)
        .filter(Boolean)
        .some(linkedId => classicRentalIds.has(linkedId))
    ));
  }
  return collections.gantt_rentals.filter(rental => text(rental?.id) === id);
}

function attachRentalImpact(effect, collections, targetMode = 'gantt_exact', changesOutstanding = true) {
  if (effect.effectiveAmount === 0 || !effect.targetRentalId) return effect;
  const matches = matchingRentals(collections, effect.targetRentalId, targetMode)
    .filter(shouldCountRental);
  effect.affectedRentalIds = matches.map(item => text(item?.id)).filter(Boolean);
  effect.targetRentalMatches = matches.length;
  effect.affectsBalance = Boolean(changesOutstanding && matches.length > 0);
  effect.appliedAmountAcrossRows = effect.effectiveAmount * matches.length;
  return effect;
}

function evaluateAllocationReader(collections, relations, {
  reader,
  allocationMode = 'finance',
  dedupeAllocations = true,
  capToPaymentAmount = true,
  dedupeDirectPayments = true,
  targetMode = 'gantt_exact',
  changesOutstanding = true,
  allocationAmountForReader = allocationAmount,
  allocationDedupeKeyForReader = allocationDedupeKey,
} = {}) {
  const effects = makeEffectMap(relations, reader);
  const groups = new Map();
  const seenAllocations = new Set();

  for (const relation of relations.explicit) {
    const effect = effects.get(relation._key);
    if (!allocationIncluded(relation.record, allocationMode)) {
      effect.statusExcluded = true;
      continue;
    }
    const paymentId = text(relation.record?.paymentId);
    if (!paymentId) continue;
    if (dedupeAllocations) {
      const key = allocationDedupeKeyForReader(relation.record);
      if (seenAllocations.has(key)) {
        effect.duplicateExcluded = true;
        continue;
      }
      seenAllocations.add(key);
    }
    if (!groups.has(paymentId)) groups.set(paymentId, []);
    groups.get(paymentId).push(relation);
  }

  const paymentById = new Map();
  for (const payment of collections.payments) {
    const id = text(payment?.id);
    if (id) paymentById.set(id, payment);
  }

  for (const [paymentId, group] of groups) {
    const payment = paymentById.get(paymentId);
    if (!payment || !shouldCountPayment(payment)) {
      if (payment) {
        for (const relation of group) effects.get(relation._key).statusExcluded = true;
      }
      continue;
    }
    let remaining = paymentCap(payment, capToPaymentAmount);
    let consumed = 0;
    for (const relation of group) {
      const effect = effects.get(relation._key);
      const rentalId = text(relation.record?.rentalId);
      const requested = allocationAmountForReader(relation.record);
      if (!rentalId || requested <= 0 || remaining <= 0) {
        if (requested > 0 && remaining <= 0) {
          effect.truncatedByCap = true;
          effect.orderingSelected = consumed > 0;
          effect.priorEffectiveAmount = consumed;
        }
        continue;
      }
      const amount = Math.min(requested, remaining);
      effect.counted = amount > 0;
      effect.effectiveAmount = amount;
      effect.targetRentalId = rentalId;
      effect.truncatedByCap = amount < requested;
      effect.orderingSelected = effect.truncatedByCap && consumed > 0;
      effect.priorEffectiveAmount = consumed;
      effect.whyCounted = effect.truncatedByCap
        ? (consumed > 0 ? 'ordering-selected capped contribution' : 'capped contribution')
        : 'explicit effective allocation';
      remaining -= amount;
      consumed += amount;
      attachRentalImpact(effect, collections, targetMode, changesOutstanding);
    }
  }

  const seenDirectPaymentIds = new Set();
  for (const relation of relations.direct) {
    const payment = relation.record;
    const effect = effects.get(relation._key);
    const paymentId = text(payment?.id);
    if (!shouldCountPayment(payment)) {
      effect.statusExcluded = true;
      continue;
    }
    if (paymentId && groups.has(paymentId)) {
      effect.suppressedByExplicitAllocation = true;
      continue;
    }
    if (dedupeDirectPayments && paymentId) {
      if (seenDirectPaymentIds.has(paymentId)) {
        effect.duplicateExcluded = true;
        continue;
      }
      seenDirectPaymentIds.add(paymentId);
    }
    const amount = paymentCap(payment, capToPaymentAmount);
    const rentalId = text(payment?.rentalId);
    if (!rentalId || amount <= 0) continue;
    effect.counted = true;
    effect.effectiveAmount = amount;
    effect.targetRentalId = rentalId;
    effect.truncatedByCap = effectivePaidAmount(payment) > amount;
    effect.whyCounted = effect.truncatedByCap
      ? 'direct fallback capped contribution'
      : 'direct fallback relation';
    attachRentalImpact(effect, collections, targetMode, changesOutstanding);
  }

  return { effects, groups };
}

function evaluatePaymentStatusSync(collections, relations) {
  const reader = 'payment_status_sync';
  const effects = makeEffectMap(relations, reader);
  const groups = new Map();
  for (const relation of relations.explicit) {
    const effect = effects.get(relation._key);
    if (!allocationIncluded(relation.record, 'cancel_only')) {
      effect.statusExcluded = true;
      continue;
    }
    const paymentId = text(relation.record?.paymentId);
    if (!paymentId) continue;
    if (!groups.has(paymentId)) groups.set(paymentId, []);
    groups.get(paymentId).push(relation);
  }

  const directByPaymentIndex = new Map(relations.direct.map(relation => [relation.sourceIndex, relation]));
  for (let paymentIndex = 0; paymentIndex < collections.payments.length; paymentIndex += 1) {
    const payment = collections.payments[paymentIndex];
    const directRelation = directByPaymentIndex.get(paymentIndex) || null;
    const directEffect = directRelation ? effects.get(directRelation._key) : null;
    if (!shouldCountPayment(payment)) {
      if (directEffect) directEffect.statusExcluded = true;
      continue;
    }
    const paymentId = text(payment?.id);
    const allocations = paymentId ? groups.get(paymentId) : null;
    if (!allocations) {
      const amount = effectivePaidAmount(payment);
      if (!directEffect || amount <= 0) continue;
      directEffect.counted = true;
      directEffect.effectiveAmount += amount;
      directEffect.targetRentalId = text(payment?.rentalId) || null;
      directEffect.whyCounted = 'direct relation used for Gantt paymentStatus';
      attachRentalImpact(directEffect, collections, 'gantt_alias', false);
      continue;
    }
    if (directEffect) directEffect.suppressedByExplicitAllocation = true;
    let remaining = effectivePaidAmount(payment);
    let consumed = 0;
    for (const allocationRelation of allocations) {
      const effect = effects.get(allocationRelation._key);
      const requested = allocationAmount(allocationRelation.record);
      if (requested <= 0 || remaining <= 0) continue;
      const amount = Math.min(requested, remaining);
      effect.counted = true;
      effect.effectiveAmount += amount;
      effect.targetRentalId = text(allocationRelation.record?.rentalId) || null;
      effect.truncatedByCap = amount < requested;
      effect.orderingSelected = effect.truncatedByCap && consumed > 0;
      effect.priorEffectiveAmount = consumed;
      effect.whyCounted = effect.truncatedByCap
        ? 'paymentStatus ordering-selected contribution'
        : 'explicit contribution to Gantt paymentStatus';
      remaining -= amount;
      consumed += amount;
    }
  }
  for (const effect of effects.values()) attachRentalImpact(effect, collections, 'gantt_alias', false);
  return effects;
}

function rentalDetailPaymentAmount(payment) {
  const status = text(payment?.status);
  if (status === 'cancelled' || status === 'refunded') return 0;
  if (typeof payment?.paidAmount === 'number') {
    return Number.isFinite(payment.paidAmount) ? Math.max(0, payment.paidAmount) : 0;
  }
  return payment?.status === 'paid' ? positiveNumber(payment?.amount) : 0;
}

function evaluateRentalDetail(collections, relations) {
  const reader = 'rental_detail';
  const effects = makeEffectMap(relations, reader);
  const activeAllocationPaymentIds = new Set();
  for (const relation of relations.explicit) {
    const effect = effects.get(relation._key);
    if (String(relation.record?.status || '') === 'cancelled') {
      effect.statusExcluded = true;
      continue;
    }
    const paymentId = text(relation.record?.paymentId);
    if (paymentId) activeAllocationPaymentIds.add(paymentId);
    const amount = allocationAmount(relation.record);
    const rentalId = text(relation.record?.rentalId);
    if (!rentalId || amount <= 0) continue;
    effect.counted = true;
    effect.effectiveAmount = amount;
    effect.targetRentalId = rentalId;
    effect.whyCounted = 'raw active allocation displayed on Rental Detail';
    attachRentalImpact(effect, collections, 'classic_exact', false);
  }
  for (const relation of relations.direct) {
    const effect = effects.get(relation._key);
    const paymentId = text(relation.record?.id);
    if (paymentId && activeAllocationPaymentIds.has(paymentId)) {
      effect.suppressedByExplicitAllocation = true;
      continue;
    }
    const amount = rentalDetailPaymentAmount(relation.record);
    if (amount <= 0) continue;
    effect.counted = true;
    effect.effectiveAmount = amount;
    effect.targetRentalId = text(relation.record?.rentalId) || null;
    effect.whyCounted = 'direct Payment displayed on Rental Detail';
    attachRentalImpact(effect, collections, 'classic_exact', false);
  }
  return effects;
}

function evaluateRawDirectReader(collections, relations, {
  reader,
  amountForPayment,
  targetMode,
  changesOutstanding,
  lastPerRental = false,
  allowNegative = false,
  metric = 'paid_contribution',
} = {}) {
  const effects = makeEffectMap(relations, reader);
  const selected = new Set();
  if (lastPerRental) {
    const last = new Map();
    for (const relation of relations.direct) last.set(text(relation.record?.rentalId), relation._key);
    for (const key of last.values()) selected.add(key);
  }
  for (const relation of relations.direct) {
    const effect = effects.get(relation._key);
    if (lastPerRental && !selected.has(relation._key)) {
      effect.duplicateExcluded = true;
      continue;
    }
    const numeric = Number(amountForPayment(relation.record));
    const amount = Number.isFinite(numeric) ? (allowNegative ? numeric : Math.max(0, numeric)) : 0;
    if (amount === 0) continue;
    effect.counted = true;
    effect.metric = metric;
    effect.effectiveAmount = amount;
    effect.targetRentalId = text(relation.record?.rentalId) || null;
    effect.whyCounted = lastPerRental ? 'last raw direct Payment wins' : 'raw direct Payment relation';
    attachRentalImpact(effect, collections, targetMode, changesOutstanding);
  }
  return effects;
}

function directRawAmountInfo(payment) {
  const hasPaidAmount = Object.prototype.hasOwnProperty.call(payment || {}, 'paidAmount');
  const rawValue = hasPaidAmount ? payment?.paidAmount : (payment?.status === 'paid' ? payment?.amount : 0);
  const numeric = Number(rawValue);
  const paidAmountInvalid = hasPaidAmount
    && typeof payment?.paidAmount !== 'number'
    && payment?.paidAmount !== null
    && payment?.paidAmount !== undefined
    && payment?.paidAmount !== '';
  const amountNumeric = Number(payment?.amount);
  const amountInvalid = payment?.amount !== null
    && payment?.amount !== undefined
    && payment?.amount !== ''
    && !Number.isFinite(amountNumeric);
  return {
    rawAmount: Number.isFinite(numeric) ? numeric : null,
    invalid: paidAmountInvalid || amountInvalid || !Number.isFinite(numeric),
    negative: Number.isFinite(numeric) && numeric < 0,
  };
}

function allocationRawAmountInfo(allocation) {
  const rawValue = allocation?.amount ?? allocation?.allocatedAmount;
  const numeric = Number(rawValue);
  return {
    rawAmount: Number.isFinite(numeric) ? numeric : null,
    invalid: rawValue === null || rawValue === undefined || rawValue === '' || !Number.isFinite(numeric),
    negative: Number.isFinite(numeric) && numeric < 0,
  };
}

function identityView(record) {
  return {
    ...(text(record?.counterpartyId) ? { counterpartyId: text(record.counterpartyId) } : {}),
    ...(text(record?.clientId) ? { clientId: text(record.clientId) } : {}),
  };
}

function jh1Identity(record, collections, rootRecordMatches) {
  return resolveArDebtorIdentity(identityView(record), collections, { rootRecordMatches });
}

function resolveRentalEndpoint(collections, rentalId) {
  const id = text(rentalId);
  if (!id) return { status: 'unresolved', record: null, domain: null, matches: 0, matchKind: null };
  const domains = [
    ['rentals', collections.rentals],
    ['gantt_rentals', collections.gantt_rentals],
  ];
  const exact = domains.flatMap(([domain, list]) => list
    .filter(rental => text(rental?.id) === id)
    .map(record => ({ domain, record })));
  if (exact.length > 1) return { status: 'duplicate', record: null, domain: null, matches: exact.length, matchKind: 'exact' };
  if (exact.length === 1) return { status: 'resolved', ...exact[0], matches: 1, matchKind: 'exact' };
  const aliases = domains.flatMap(([domain, list]) => list
    .filter(rental => rentalReferenceIds(rental).includes(id))
    .map(record => ({ domain, record })));
  if (aliases.length > 1) return { status: 'duplicate', record: null, domain: null, matches: aliases.length, matchKind: 'alias' };
  if (aliases.length === 1) return { status: 'resolved', ...aliases[0], matches: 1, matchKind: 'alias' };
  return { status: 'orphan', record: null, domain: null, matches: 0, matchKind: null };
}

function identityErrorClass(side, error) {
  if (error?.code === COUNTERPARTY_RELATION_CODES.MISMATCH) {
    return side === 'payment'
      ? ISSUE_CLASSES.PAYMENT_IDENTITY_CONFLICT
      : ISSUE_CLASSES.RENTAL_IDENTITY_CONFLICT;
  }
  if (error?.code === COUNTERPARTY_RELATION_CODES.COUNTERPARTY_NOT_FOUND) {
    return ISSUE_CLASSES.ORPHAN_COUNTERPARTY;
  }
  if (error?.code === COUNTERPARTY_RELATION_CODES.AMBIGUOUS) {
    return ISSUE_CLASSES.AMBIGUOUS_COUNTERPARTY;
  }
  return side === 'payment' ? ISSUE_CLASSES.UNRESOLVED_PAYMENT : ISSUE_CLASSES.UNRESOLVED_RENTAL;
}

function resolvedIdentityPayload(result, jh1) {
  return {
    valid: Boolean(result),
    counterpartyId: result?.counterpartyId || null,
    clientId: result?.clientId || null,
    source: result?.source || (result ? 'rental_identity' : null),
    jh1Status: jh1?.status || null,
    jh1CounterpartyId: jh1?.counterpartyId || null,
    errorCode: null,
    error: null,
  };
}

function failedIdentityPayload(error, jh1) {
  return {
    valid: false,
    counterpartyId: null,
    clientId: null,
    source: null,
    jh1Status: jh1?.status || null,
    jh1CounterpartyId: jh1?.counterpartyId || null,
    errorCode: error?.code || null,
    error: error?.message || String(error),
  };
}

function evaluateIdentity(relation, collections, idCounts) {
  const issueClasses = new Set();
  const paymentId = text(relation.paymentId);
  const paymentMatches = paymentId
    ? collections.payments.filter(payment => text(payment?.id) === paymentId)
    : [];
  let paymentRecord = relation.relationSource === RELATION_SOURCES.DIRECT_PAYMENT_RENTAL
    ? relation.record
    : paymentMatches[0] || null;
  if (!paymentId && relation.relationSource === RELATION_SOURCES.EXPLICIT_ALLOCATION) {
    issueClasses.add(ISSUE_CLASSES.UNRESOLVED_PAYMENT);
    paymentRecord = null;
  } else if (paymentMatches.length === 0) {
    issueClasses.add(ISSUE_CLASSES.ORPHAN_PAYMENT);
    paymentRecord = null;
  } else if (paymentMatches.length > 1) {
    issueClasses.add(ISSUE_CLASSES.DUPLICATE_PAYMENT_ID);
  }

  const rentalEndpoint = resolveRentalEndpoint(collections, relation.rentalId);
  if (rentalEndpoint.status === 'unresolved') issueClasses.add(ISSUE_CLASSES.UNRESOLVED_RENTAL);
  else if (rentalEndpoint.status === 'orphan') issueClasses.add(ISSUE_CLASSES.ORPHAN_RENTAL);
  else if (rentalEndpoint.status === 'duplicate') issueClasses.add(ISSUE_CLASSES.DUPLICATE_RENTAL_ID);

  let paymentIdentity = {
    valid: false,
    counterpartyId: null,
    clientId: null,
    source: null,
    jh1Status: null,
    jh1CounterpartyId: null,
    errorCode: null,
    error: paymentRecord ? null : 'Payment endpoint is not uniquely resolvable.',
  };
  if (paymentRecord) {
    const directRentalAuthorityFallback = relation.relationSource === RELATION_SOURCES.DIRECT_PAYMENT_RENTAL
      && !text(paymentRecord?.counterpartyId)
      && !text(paymentRecord?.clientId);
    const jh1 = directRentalAuthorityFallback
      ? resolveArDebtorIdentity(paymentRecord, collections, {
        rootRecordMatches: paymentId ? idCounts.payments.get(paymentId) || 0 : 0,
      })
      : jh1Identity(paymentRecord, collections, paymentId ? idCounts.payments.get(paymentId) || 0 : 0);
    try {
      const result = resolvePaymentCounterpartyRelation(paymentRecord, collections, {
        allowArchived: true,
        useRentalAuthority: directRentalAuthorityFallback,
      });
      paymentIdentity = resolvedIdentityPayload(result, jh1);
      if (result.source === 'client'
        || result.source === 'rental'
        || jh1.status === AR_DEBTOR_IDENTITY_STATUSES.LEGACY_RESOLVED) {
        issueClasses.add(ISSUE_CLASSES.LEGACY_RESOLVED);
      }
    } catch (error) {
      paymentIdentity = failedIdentityPayload(error, jh1);
      issueClasses.add(identityErrorClass('payment', error));
    }
  }

  let rentalIdentity = {
    valid: false,
    counterpartyId: null,
    clientId: null,
    source: null,
    jh1Status: null,
    jh1CounterpartyId: null,
    errorCode: null,
    error: rentalEndpoint.record ? null : 'Rental endpoint is not uniquely resolvable.',
  };
  if (rentalEndpoint.record) {
    const rentalRecordId = text(rentalEndpoint.record?.id);
    const rootMatches = rentalRecordId
      ? (rentalEndpoint.domain === 'rentals'
        ? idCounts.rentals.get(rentalRecordId) || 0
        : idCounts.gantt_rentals.get(rentalRecordId) || 0)
      : 0;
    const jh1 = jh1Identity(rentalEndpoint.record, collections, rootMatches);
    try {
      const result = resolveRentalCounterpartyRelation(rentalEndpoint.record, collections, {
        allowArchived: true,
      });
      rentalIdentity = resolvedIdentityPayload(result, jh1);
      if (!text(rentalEndpoint.record?.counterpartyId)
        && (result.clientId || jh1.status === AR_DEBTOR_IDENTITY_STATUSES.LEGACY_RESOLVED)) {
        issueClasses.add(ISSUE_CLASSES.LEGACY_RESOLVED);
      }
    } catch (error) {
      rentalIdentity = failedIdentityPayload(error, jh1);
      issueClasses.add(identityErrorClass('rental', error));
    }
  }

  if (paymentIdentity.valid && rentalIdentity.valid
    && paymentIdentity.counterpartyId !== rentalIdentity.counterpartyId) {
    issueClasses.add(ISSUE_CLASSES.CROSS_COUNTERPARTY);
  }

  const valid = paymentIdentity.valid
    && rentalIdentity.valid
    && paymentIdentity.counterpartyId === rentalIdentity.counterpartyId
    && !issueClasses.has(ISSUE_CLASSES.DUPLICATE_PAYMENT_ID)
    && !issueClasses.has(ISSUE_CLASSES.DUPLICATE_RENTAL_ID);
  return {
    issueClasses,
    paymentCounterpartyId: paymentIdentity.counterpartyId,
    rentalCounterpartyId: rentalIdentity.counterpartyId,
    canonicalValidity: {
      valid,
      sameCounterparty: paymentIdentity.valid && rentalIdentity.valid
        ? paymentIdentity.counterpartyId === rentalIdentity.counterpartyId
        : null,
      payment: paymentIdentity,
      rental: {
        ...rentalIdentity,
        endpointDomain: rentalEndpoint.domain,
        endpointRecordId: text(rentalEndpoint.record?.id) || null,
        endpointMatchKind: rentalEndpoint.matchKind,
        endpointMatches: rentalEndpoint.matches,
      },
    },
  };
}

function stableIssueClasses(classes) {
  const unique = new Set(classes);
  if (unique.size === 0) unique.add(ISSUE_CLASSES.SAFE);
  const priority = new Map(ISSUE_PRIORITY.map((value, index) => [value, index]));
  return [...unique].sort((left, right) => (
    (priority.get(left) ?? ISSUE_PRIORITY.length) - (priority.get(right) ?? ISSUE_PRIORITY.length)
    || compareText(left, right)
  ));
}

function effectComparable(effect, compareBalance = false) {
  return JSON.stringify({
    metric: effect?.metric || 'paid_contribution',
    effectiveAmount: effect?.effectiveAmount || 0,
    targetRentalId: effect?.targetRentalId || null,
    suppressedByExplicitAllocation: Boolean(effect?.suppressedByExplicitAllocation),
    ...(compareBalance ? { affectsBalance: Boolean(effect?.affectsBalance) } : {}),
  });
}

function effectForOutput(effect) {
  return {
    metric: effect?.metric || 'paid_contribution',
    counted: Boolean(effect?.counted),
    effectiveAmount: effect?.effectiveAmount || 0,
    targetRentalId: effect?.targetRentalId || null,
    affectedRentalIds: effect?.affectedRentalIds || [],
    targetRentalMatches: effect?.targetRentalMatches || 0,
    affectsBalance: Boolean(effect?.affectsBalance),
    appliedAmountAcrossRows: effect?.appliedAmountAcrossRows || 0,
    whyCounted: effect?.whyCounted || null,
    statusExcluded: Boolean(effect?.statusExcluded),
    duplicateExcluded: Boolean(effect?.duplicateExcluded),
    suppressedByExplicitAllocation: Boolean(effect?.suppressedByExplicitAllocation),
    truncatedByCap: Boolean(effect?.truncatedByCap),
    orderingSelected: Boolean(effect?.orderingSelected),
    priorEffectiveAmount: effect?.priorEffectiveAmount || 0,
    precedenceImpactAmount: effect?.precedenceImpactAmount || 0,
    precedenceAffectedRentalId: effect?.precedenceAffectedRentalId || null,
  };
}

function choosePrimaryIssue(issueClasses) {
  return stableIssueClasses(issueClasses)[0];
}

function severityFor(issueClasses, { monetaryPotential, statusExcluded }) {
  const hasBlockingClass = issueClasses.some(issue => BLOCKING_ISSUE_CLASSES.has(issue));
  if (hasBlockingClass && monetaryPotential && !statusExcluded) return SEVERITIES.BLOCKING;
  if (hasBlockingClass || issueClasses.some(issue => issue !== ISSUE_CLASSES.SAFE)) return SEVERITIES.WARNING;
  return SEVERITIES.INFORMATIONAL;
}

function relationSort(left, right) {
  return (SEVERITY_ORDER[left.severity] ?? 9) - (SEVERITY_ORDER[right.severity] ?? 9)
    || compareText(left.issueClass, right.issueClass)
    || compareText(left.paymentId, right.paymentId)
    || compareText(left.rentalId, right.rentalId)
    || compareText(left.allocationId, right.allocationId)
    || compareText(left.relationSource, right.relationSource)
    || left.sourceIndex - right.sourceIndex;
}

function findAffectedCounterpartyId(relation, identity, central, collections) {
  if (central.affectsBalance && identity.rentalCounterpartyId) return identity.rentalCounterpartyId;
  if (!central.precedenceAffectedRentalId) return null;
  const endpoint = resolveRentalEndpoint(collections, central.precedenceAffectedRentalId);
  if (!endpoint.record) return null;
  try {
    return resolveRentalCounterpartyRelation(endpoint.record, collections, { allowArchived: true }).counterpartyId;
  } catch {
    return null;
  }
}

function applyPrecedenceImpacts(collections, relations, centralResult) {
  for (const [paymentId, allocations] of centralResult.groups) {
    const totalApplied = allocations.reduce((sum, relation) => (
      sum + (centralResult.effects.get(relation._key)?.appliedAmountAcrossRows || 0)
    ), 0);
    if (totalApplied > 0) continue;
    const directRelations = relations.direct.filter(relation => text(relation.paymentId) === paymentId);
    const direct = directRelations.find(relation => {
      const amount = paymentCap(relation.record, true);
      return shouldCountPayment(relation.record)
        && amount > 0
        && matchingRentals(collections, relation.rentalId, 'gantt_exact').some(shouldCountRental);
    });
    if (!direct || allocations.length === 0) continue;
    const effect = centralResult.effects.get(allocations[0]._key);
    effect.precedenceImpactAmount = paymentCap(direct.record, true);
    effect.precedenceAffectedRentalId = text(direct.rentalId) || null;
    if (!effect.whyCounted) effect.whyCounted = 'explicit allocation precedence suppresses direct fallback';
  }
}

function buildReaderEffects(collections, relations) {
  const central = evaluateAllocationReader(collections, relations, {
    reader: 'finance_core_ar',
  });
  applyPrecedenceImpacts(collections, relations, central);
  const financeRoutesLinked = evaluateAllocationReader(collections, relations, {
    reader: 'finance_routes_linked_ar',
    targetMode: 'gantt_linked_exact',
  }).effects;
  const frontendFinance = evaluateAllocationReader(collections, relations, {
    reader: 'frontend_finance_mirror',
    allocationAmountForReader: frontendAllocationAmount,
    allocationDedupeKeyForReader: frontendAllocationDedupeKey,
  }).effects;
  const managerBackend = evaluateAllocationReader(collections, relations, {
    reader: 'manager_report_backend',
    allocationMode: 'all',
    dedupeAllocations: false,
    dedupeDirectPayments: false,
  }).effects;
  const managerFrontend = evaluateAllocationReader(collections, relations, {
    reader: 'manager_report_frontend',
    allocationMode: 'finance',
    dedupeAllocations: false,
    dedupeDirectPayments: true,
  }).effects;
  const withoutAllocations = evaluateAllocationReader(collections, relations, {
    reader: 'finance_core_without_allocations',
    allocationMode: 'none',
  }).effects;
  const paymentStatusSync = evaluatePaymentStatusSync(collections, relations);
  const rentalDetail = evaluateRentalDetail(collections, relations);
  const receivablesDetail = evaluateRawDirectReader(collections, relations, {
    reader: 'receivables_payment_detail',
    amountForPayment: effectivePaidAmount,
    targetMode: 'gantt_exact',
    changesOutstanding: false,
  });
  const rawDirectDebt = evaluateRawDirectReader(collections, relations, {
    reader: 'raw_direct_debt_helpers',
    amountForPayment: effectivePaidAmount,
    targetMode: 'classic_exact',
    changesOutstanding: true,
  });
  const rentalExtension = evaluateRawDirectReader(collections, relations, {
    reader: 'rental_extension_financials',
    amountForPayment: payment => {
      if (!shouldCountPayment(payment)) return 0;
      const paid = Number(payment?.paidAmount);
      if (Number.isFinite(paid)) return Math.max(0, paid);
      return payment?.status === 'paid' ? Math.max(0, Number(payment?.amount) || 0) : 0;
    },
    targetMode: 'all_alias',
    changesOutstanding: true,
  });
  const equipmentDetail = evaluateRawDirectReader(collections, relations, {
    reader: 'equipment_detail_ar',
    amountForPayment: effectivePaidAmount,
    targetMode: 'gantt_exact',
    changesOutstanding: true,
  });
  const equipment360 = evaluateRawDirectReader(collections, relations, {
    reader: 'equipment_360_payment_outstanding',
    amountForPayment: payment => Math.max(0, positiveNumber(payment?.amount) - effectivePaidAmount(payment)),
    targetMode: 'gantt_exact',
    changesOutstanding: false,
    metric: 'payment_outstanding',
  });
  const rentalWorkspacePaymentStatus = evaluateRawDirectReader(collections, relations, {
    reader: 'rental_workspace_payment_status',
    amountForPayment: effectivePaidAmount,
    targetMode: 'gantt_alias',
    changesOutstanding: false,
  });
  const managerPlanDebtSnapshot = evaluateRawDirectReader(collections, relations, {
    reader: 'manager_plan_debt_snapshot',
    amountForPayment: payment => positiveNumber(
      payment?.debt ?? payment?.debtAmount ?? payment?.outstanding ?? payment?.balance,
    ),
    targetMode: 'all_alias',
    changesOutstanding: false,
    metric: 'debt_snapshot',
  });
  const botManager = evaluateRawDirectReader(collections, relations, {
    reader: 'bot_manager_financial_view',
    amountForPayment: payment => (typeof payment?.paidAmount === 'number'
      ? payment.paidAmount
      : payment?.amount),
    targetMode: 'gantt_exact',
    changesOutstanding: true,
  });
  const equipmentEconomics = evaluateRawDirectReader(collections, relations, {
    reader: 'equipment_economics',
    amountForPayment: payment => Number(payment?.paidAmount ?? payment?.amount) || 0,
    targetMode: 'gantt_exact',
    changesOutstanding: false,
    lastPerRental: true,
    allowNegative: true,
  });

  return {
    finance_core_ar: central.effects,
    finance_routes_linked_ar: financeRoutesLinked,
    frontend_finance_mirror: frontendFinance,
    manager_report_backend: managerBackend,
    manager_report_frontend: managerFrontend,
    finance_core_without_allocations: withoutAllocations,
    rental_detail: rentalDetail,
    receivables_payment_detail: receivablesDetail,
    payment_status_sync: paymentStatusSync,
    raw_direct_debt_helpers: rawDirectDebt,
    rental_extension_financials: rentalExtension,
    equipment_detail_ar: equipmentDetail,
    equipment_360_payment_outstanding: equipment360,
    rental_workspace_payment_status: rentalWorkspacePaymentStatus,
    manager_plan_debt_snapshot: managerPlanDebtSnapshot,
    bot_manager_financial_view: botManager,
    equipment_economics: equipmentEconomics,
  };
}

function diagnosePaymentAllocationFinancialImpact(data = {}) {
  const collections = Object.fromEntries(REQUIRED_COLLECTIONS.map(name => [name, readCollection(data, name)]));
  const relations = buildRelations(collections);
  const readerEffects = buildReaderEffects(collections, relations);
  const idCounts = {
    payments: countIds(collections.payments),
    payment_allocations: countIds(collections.payment_allocations),
    rentals: countIds(collections.rentals),
    gantt_rentals: countIds(collections.gantt_rentals),
  };
  const documentCounts = countIds(collections.documents);
  const entries = [];
  const balanceReaders = new Set(CONSUMER_MATRIX
    .filter(consumer => consumer.changesOutstanding)
    .map(consumer => consumer.consumer));

  for (const relation of relations.all) {
    const identity = evaluateIdentity(relation, collections, idCounts);
    const issueClasses = new Set(identity.issueClasses);
    const amountInfo = relation.relationSource === RELATION_SOURCES.EXPLICIT_ALLOCATION
      ? allocationRawAmountInfo(relation.record)
      : directRawAmountInfo(relation.record);
    if (amountInfo.invalid) issueClasses.add(ISSUE_CLASSES.INVALID_AMOUNT);
    if (amountInfo.negative) issueClasses.add(ISSUE_CLASSES.NEGATIVE_AMOUNT);
    if (relation.allocationId && (idCounts.payment_allocations.get(relation.allocationId) || 0) > 1) {
      issueClasses.add(ISSUE_CLASSES.DUPLICATE_ALLOCATION_ID);
    }

    const central = readerEffects.finance_core_ar.get(relation._key);
    if (central.truncatedByCap) issueClasses.add(ISSUE_CLASSES.OVER_CAP);
    if (central.orderingSelected) issueClasses.add(ISSUE_CLASSES.ORDERING_EFFECT);
    const statusExcluded = central.statusExcluded
      || (central.effectiveAmount > 0 && central.targetRentalMatches === 0
        && matchingRentals(collections, central.targetRentalId, 'gantt_exact').length > 0);
    if (statusExcluded) issueClasses.add(ISSUE_CLASSES.CANCELLED);

    const differences = [];
    for (const [reader, effects] of Object.entries(readerEffects)) {
      if (reader === 'finance_core_ar') continue;
      const effect = effects.get(relation._key);
      const compareBalance = balanceReaders.has(reader);
      if (effectComparable(effect, compareBalance) === effectComparable(central, compareBalance)) continue;
      differences.push({
        reader,
        baselineMetric: central.metric || 'paid_contribution',
        readerMetric: effect.metric || 'paid_contribution',
        baselineEffectiveAmount: central.effectiveAmount || 0,
        readerEffectiveAmount: effect.effectiveAmount || 0,
        baselineTargetRentalId: central.targetRentalId || null,
        readerTargetRentalId: effect.targetRentalId || null,
        baselineSuppressed: Boolean(central.suppressedByExplicitAllocation),
        readerSuppressed: Boolean(effect.suppressedByExplicitAllocation),
      });
    }
    differences.sort((left, right) => compareText(left.reader, right.reader));
    if (differences.length > 0) issueClasses.add(ISSUE_CLASSES.READER_DIFFERENCE);

    if (issueClasses.size === 0) issueClasses.add(ISSUE_CLASSES.SAFE);
    const sortedIssues = stableIssueClasses(issueClasses);
    if (sortedIssues.length > 1) {
      const safeIndex = sortedIssues.indexOf(ISSUE_CLASSES.SAFE);
      if (safeIndex >= 0) sortedIssues.splice(safeIndex, 1);
    }
    const monetaryPotential = (amountInfo.rawAmount !== null && amountInfo.rawAmount > 0)
      || amountInfo.invalid
      || central.precedenceImpactAmount > 0;
    const severity = severityFor(sortedIssues, { monetaryPotential, statusExcluded });
    const canonicalIssues = stableIssueClasses(identity.issueClasses);
    const affectsCurrentAr = Boolean(central.affectsBalance || central.precedenceImpactAmount > 0);
    const affectedRentalId = central.affectsBalance
      ? central.targetRentalId
      : central.precedenceAffectedRentalId;
    const currentReaderEffect = effectForOutput(central);
    const outputReaderEffects = Object.fromEntries(Object.entries(readerEffects)
      .map(([reader, effects]) => [reader, effectForOutput(effects.get(relation._key))]));

    entries.push({
      relationSource: relation.relationSource,
      sourceIndex: relation.sourceIndex,
      allocationId: relation.allocationId,
      paymentId: relation.paymentId,
      rentalId: relation.rentalId,
      paymentCounterpartyId: identity.paymentCounterpartyId || null,
      rentalCounterpartyId: identity.rentalCounterpartyId || null,
      issueClass: choosePrimaryIssue(sortedIssues),
      issueClasses: sortedIssues,
      canonicalIssueClass: choosePrimaryIssue(canonicalIssues),
      severity,
      rawAmount: amountInfo.rawAmount,
      effectiveAmount: central.effectiveAmount || 0,
      affectsCurrentAr,
      affectedRentalId: affectedRentalId || null,
      affectedCounterpartyId: findAffectedCounterpartyId(relation, identity, central, collections),
      whyCounted: affectsCurrentAr ? currentReaderEffect.whyCounted : null,
      currentReaderEffect,
      canonicalValidity: identity.canonicalValidity,
      readerEffects: outputReaderEffects,
      readerDifferences: differences,
      provenance: {
        source: relation.provenanceSource,
        documentId: relation.documentId,
        documentMatches: relation.documentId ? documentCounts.get(relation.documentId) || 0 : 0,
        affectsMonetaryInterpretation: false,
      },
    });
  }

  entries.sort(relationSort);
  const blocking = entries.filter(entry => entry.severity === SEVERITIES.BLOCKING);
  const warnings = entries.filter(entry => entry.severity === SEVERITIES.WARNING);
  const arImpactBlockers = blocking.filter(entry => entry.affectsCurrentAr);
  const identityOnlyBlockers = blocking.filter(entry => !entry.affectsCurrentAr);
  const financialImpactAmount = entry => Math.max(
    entry.effectiveAmount || 0,
    entry.currentReaderEffect?.precedenceImpactAmount || 0,
  );
  const summary = {
    recordsInspected: REQUIRED_COLLECTIONS.reduce((sum, name) => sum + collections[name].length, 0),
    relationRecordsInspected: entries.length,
    effectiveExplicitAllocations: entries.filter(entry => (
      entry.relationSource === RELATION_SOURCES.EXPLICIT_ALLOCATION
      && entry.currentReaderEffect.counted
      && entry.currentReaderEffect.targetRentalMatches > 0
    )).length,
    effectiveDirectRelations: entries.filter(entry => (
      entry.relationSource === RELATION_SOURCES.DIRECT_PAYMENT_RENTAL
      && entry.currentReaderEffect.counted
      && entry.currentReaderEffect.targetRentalMatches > 0
    )).length,
    blockingIssues: blocking.length,
    warningIssues: warnings.length,
    informationalRelations: entries.length - blocking.length - warnings.length,
    totalEffectiveAmountAffected: arImpactBlockers.reduce((sum, entry) => sum + financialImpactAmount(entry), 0),
    arImpactBlockers: arImpactBlockers.length,
    identityOnlyBlockers: identityOnlyBlockers.length,
    readerDifferences: entries.filter(entry => entry.issueClasses.includes(ISSUE_CLASSES.READER_DIFFERENCE)).length,
    collections: Object.fromEntries(REQUIRED_COLLECTIONS.map(name => [name, collections[name].length])),
  };

  return {
    mode: 'read-only',
    modelVersion: 'J-H1.3',
    summary,
    consumerMatrix: CONSUMER_MATRIX,
    taxonomy: {
      issueClasses: Object.values(ISSUE_CLASSES),
      severities: Object.values(SEVERITIES),
    },
    relations: entries,
    arImpactBlockers,
    identityOnlyBlockers,
    readerDifferences: entries.filter(entry => entry.readerDifferences.length > 0),
  };
}

module.exports = {
  CONSUMER_MATRIX,
  ISSUE_CLASSES,
  RELATION_SOURCES,
  REQUIRED_COLLECTIONS,
  SEVERITIES,
  diagnosePaymentAllocationFinancialImpact,
};
