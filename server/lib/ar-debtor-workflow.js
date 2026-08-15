const {
  AR_DEBTOR_IDENTITY_STATUSES,
  arDebtorIdentityReadFields,
  assertCanonicalArDebtorIdentity,
  isResolvedArDebtorIdentityStatus,
  resolveArDebtorIdentity,
} = require('./ar-debtor-identity');

const AR_WORKFLOW_COLLECTIONS = new Set([
  'debt_collection_plans',
  'debt_collection_actions',
  'receivable_payment_plans',
]);

function text(value) {
  return String(value ?? '').trim();
}

function collectionList(data, name) {
  if (typeof data === 'function') return data(name) || [];
  if (data && typeof data.readData === 'function') return data.readData(name) || [];
  return data?.[name] || [];
}

function planReferenceId(record) {
  return text(record?.debtCollectionPlanId || record?.collectionPlanId || record?.planId);
}

function parentPlanResolution(record, data) {
  const planId = planReferenceId(record);
  if (!planId) return { planId: '', plan: null, identity: null, issue: null };
  const matches = collectionList(data, 'debt_collection_plans')
    .filter(item => text(item?.id) === planId);
  if (matches.length !== 1) {
    return {
      planId,
      plan: null,
      identity: null,
      issue: {
        blocking: true,
        code: matches.length > 1 ? 'AR_DEBTOR_PLAN_AMBIGUOUS' : 'AR_DEBTOR_PLAN_NOT_FOUND',
        relation: 'record.debtCollectionPlanId',
        stableId: planId,
        counterpartyId: null,
        message: matches.length > 1
          ? `Debt collection plan ${planId} is ambiguous.`
          : `Debt collection plan ${planId} was not found.`,
      },
    };
  }
  const plan = matches[0];
  const identity = resolveArDebtorIdentity(plan, data, {
    domain: 'debt_collection_plans',
    recordId: planId,
  });
  if (!identity.counterpartyId || !isResolvedArDebtorIdentityStatus(identity.status)) {
    return {
      planId,
      plan,
      identity,
      issue: {
        blocking: true,
        code: 'AR_DEBTOR_PLAN_IDENTITY_UNRESOLVED',
        relation: 'record.debtCollectionPlanId',
        stableId: planId,
        counterpartyId: null,
        message: `Debt collection plan ${planId} has no proven canonical debtor identity.`,
      },
    };
  }
  return { planId, plan, identity, issue: null };
}

function unresolvedParentResult(parent) {
  const status = parent?.issue?.code === 'AR_DEBTOR_PLAN_AMBIGUOUS'
    ? AR_DEBTOR_IDENTITY_STATUSES.AMBIGUOUS
    : AR_DEBTOR_IDENTITY_STATUSES.UNRESOLVED;
  return {
    status,
    counterpartyId: null,
    candidateCounterpartyIds: [],
    sourceRelations: [],
    legacyClientIds: [],
    issues: [parent.issue],
    metadata: {
      counterpartyLifecycleStatus: null,
      counterpartyArchived: null,
      activeCustomerRole: null,
      customerRoleSource: null,
      customerProfiles: [],
      displaySnapshots: [],
    },
  };
}

function mismatchWithParentResult(identity, parent) {
  const issue = {
    blocking: true,
    code: 'AR_DEBTOR_PLAN_IDENTITY_MISMATCH',
    relation: 'record.debtCollectionPlanId',
    stableId: parent.planId,
    counterpartyId: parent.identity.counterpartyId,
    message: `Workflow debtor ${identity.counterpartyId} differs from plan debtor ${parent.identity.counterpartyId}.`,
  };
  return {
    ...identity,
    status: AR_DEBTOR_IDENTITY_STATUSES.MISMATCH,
    counterpartyId: null,
    candidateCounterpartyIds: [...new Set([
      ...(identity.candidateCounterpartyIds || []),
      parent.identity.counterpartyId,
    ])].sort(),
    issues: [...(identity.issues || []), issue],
  };
}

function resolveArWorkflowIdentity(collection, record, data = {}, options = {}) {
  if (!AR_WORKFLOW_COLLECTIONS.has(collection)) {
    return resolveArDebtorIdentity(record, data, options);
  }
  const parent = collection === 'debt_collection_plans'
    ? { planId: '', plan: null, identity: null, issue: null }
    : parentPlanResolution(record, data);
  if (parent.issue) return unresolvedParentResult(parent);
  const candidate = parent.identity
    ? {
        ...record,
        counterpartyId: text(record?.counterpartyId) || parent.identity.counterpartyId,
        clientId: text(record?.clientId) || text(parent.plan?.clientId) || undefined,
      }
    : record;
  const identity = resolveArDebtorIdentity(candidate, data, options);
  if (
    parent.identity?.counterpartyId
    && identity.counterpartyId
    && identity.counterpartyId !== parent.identity.counterpartyId
  ) {
    return mismatchWithParentResult(identity, parent);
  }
  return identity;
}

function hasWorkflowSource(record) {
  return Boolean([
    planReferenceId(record),
    text(record?.clientId),
    text(record?.rentalId),
    text(record?.paymentId),
    text(record?.documentId),
  ].some(Boolean));
}

function assertCanonicalArWorkflowWrite(collection, record, data = {}, options = {}) {
  if (!AR_WORKFLOW_COLLECTIONS.has(collection)) return record;
  if (collection !== 'debt_collection_plans' && !hasWorkflowSource(record)) {
    const error = new Error('Collection workflow write requires a stable debtor source relation.');
    error.status = 400;
    error.code = 'AR_DEBTOR_SOURCE_REQUIRED';
    error.details = { domain: collection };
    throw error;
  }
  const parent = collection === 'debt_collection_plans'
    ? null
    : parentPlanResolution(record, data);
  if (parent?.issue) {
    const error = new Error(parent.issue.message);
    error.status = parent.issue.code === 'AR_DEBTOR_PLAN_AMBIGUOUS' ? 409 : 400;
    error.code = parent.issue.code;
    error.details = { domain: collection, planId: parent.planId };
    throw error;
  }
  const candidate = parent?.identity
    ? {
        ...record,
        counterpartyId: text(record?.counterpartyId) || parent.identity.counterpartyId,
        clientId: text(record?.clientId) || text(parent.plan?.clientId) || undefined,
        debtCollectionPlanId: parent.planId,
      }
    : record;
  const identity = assertCanonicalArDebtorIdentity(candidate, data, {
    ...options,
    domain: collection,
    recordId: options.recordId || text(record?.id) || null,
  });
  if (parent?.identity?.counterpartyId && identity.counterpartyId !== parent.identity.counterpartyId) {
    const error = new Error('Collection workflow debtor differs from the authoritative plan debtor.');
    error.status = 409;
    error.code = 'AR_DEBTOR_PLAN_IDENTITY_MISMATCH';
    error.details = {
      domain: collection,
      planId: parent.planId,
      expectedCounterpartyId: parent.identity.counterpartyId,
      actualCounterpartyId: identity.counterpartyId,
    };
    throw error;
  }
  return {
    ...candidate,
    counterpartyId: identity.counterpartyId,
  };
}

function decorateArWorkflowRecord(collection, record, data = {}, options = {}) {
  const identity = resolveArWorkflowIdentity(collection, record, data, options);
  return {
    ...record,
    ...arDebtorIdentityReadFields(identity),
  };
}

module.exports = {
  AR_WORKFLOW_COLLECTIONS,
  assertCanonicalArWorkflowWrite,
  decorateArWorkflowRecord,
  resolveArWorkflowIdentity,
};
