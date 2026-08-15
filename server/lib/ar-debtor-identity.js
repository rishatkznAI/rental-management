const AR_DEBTOR_IDENTITY_STATUSES = Object.freeze({
  CANONICAL: 'canonical',
  LEGACY_RESOLVED: 'legacy_resolved',
  COUNTERPARTY_ONLY: 'counterparty_only',
  MATCHING_DUAL_ID: 'matching_dual_id',
  UNRESOLVED: 'unresolved',
  MISMATCH: 'mismatch',
  AMBIGUOUS: 'ambiguous',
  ORPHAN_CLIENT: 'orphan_client',
  ORPHAN_COUNTERPARTY: 'orphan_counterparty',
});

const AR_DEBTOR_AUDIT_COLLECTIONS = Object.freeze([
  'rentals',
  'gantt_rentals',
  'payments',
  'payment_allocations',
  'debt_collection_plans',
  'debt_collection_actions',
  'receivable_payment_plans',
]);

const RESOLVED_STATUSES = new Set([
  AR_DEBTOR_IDENTITY_STATUSES.CANONICAL,
  AR_DEBTOR_IDENTITY_STATUSES.LEGACY_RESOLVED,
  AR_DEBTOR_IDENTITY_STATUSES.COUNTERPARTY_ONLY,
  AR_DEBTOR_IDENTITY_STATUSES.MATCHING_DUAL_ID,
]);

const BLOCKING_STATUSES = new Set([
  AR_DEBTOR_IDENTITY_STATUSES.UNRESOLVED,
  AR_DEBTOR_IDENTITY_STATUSES.MISMATCH,
  AR_DEBTOR_IDENTITY_STATUSES.AMBIGUOUS,
  AR_DEBTOR_IDENTITY_STATUSES.ORPHAN_CLIENT,
  AR_DEBTOR_IDENTITY_STATUSES.ORPHAN_COUNTERPARTY,
]);

const DISPLAY_SNAPSHOT_FIELDS = Object.freeze([
  'client',
  'clientName',
  'company',
  'companyName',
  'counterparty',
  'counterpartyName',
  'email',
  'inn',
  'name',
  'phone',
]);

function relationId(value) {
  return String(value ?? '').trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readCollection(data, name) {
  if (typeof data === 'function') return asArray(data(name));
  if (data && typeof data.readData === 'function') return asArray(data.readData(name));
  return asArray(data?.[name]);
}

function buildIdIndex(list) {
  const index = new Map();
  for (const item of asArray(list)) {
    const id = relationId(item?.id);
    if (!id) continue;
    const matches = index.get(id) || [];
    matches.push(item);
    index.set(id, matches);
  }
  return index;
}

function buildResolverContext(data) {
  const collections = {
    counterparties: readCollection(data, 'counterparties'),
    clients: readCollection(data, 'clients'),
    rentals: readCollection(data, 'rentals'),
    gantt_rentals: readCollection(data, 'gantt_rentals'),
    payments: readCollection(data, 'payments'),
    documents: readCollection(data, 'documents'),
    client_contracts: readCollection(data, 'client_contracts'),
    client_objects: readCollection(data, 'client_objects'),
    counterparty_role_assignments: readCollection(data, 'counterparty_role_assignments'),
  };
  return {
    collections,
    indexes: Object.fromEntries(Object.entries(collections)
      .map(([name, list]) => [name, buildIdIndex(list)])),
  };
}

function compareText(left, right) {
  const leftText = String(left ?? '');
  const rightText = String(right ?? '');
  if (leftText < rightText) return -1;
  if (leftText > rightText) return 1;
  return 0;
}

function sortSourceRelations(relations) {
  return [...relations].sort((left, right) => (
    compareText(left.path, right.path)
    || compareText(left.stableId, right.stableId)
    || compareText(left.counterpartyId, right.counterpartyId)
    || compareText(left.outcome, right.outcome)
  ));
}

function sortIssues(issues) {
  return [...issues].sort((left, right) => (
    compareText(left.code, right.code)
    || compareText(left.relation, right.relation)
    || compareText(left.stableId, right.stableId)
    || compareText(left.counterpartyId, right.counterpartyId)
    || compareText(left.message, right.message)
  ));
}

function uniqueSorted(values) {
  return [...new Set(values.map(relationId).filter(Boolean))].sort(compareText);
}

function displaySnapshots(record) {
  return DISPLAY_SNAPSHOT_FIELDS
    .map(field => ({ field, value: relationId(record?.[field]) }))
    .filter(item => item.value);
}

function isActiveAssignment(assignment) {
  return relationId(assignment?.status).toLowerCase() === 'active'
    && !relationId(assignment?.validTo);
}

function lifecycleAndRoleMetadata(counterparty, counterpartyId, context) {
  if (!counterparty) {
    return {
      counterpartyLifecycleStatus: null,
      counterpartyArchived: null,
      activeCustomerRole: null,
      customerRoleSource: null,
      customerProfiles: [],
    };
  }
  const assignments = context.collections.counterparty_role_assignments
    .filter(item => relationId(item?.counterpartyId) === counterpartyId);
  const activeCustomerRole = assignments.length > 0
    ? assignments.some(item => relationId(item?.roleCode) === 'customer' && isActiveAssignment(item))
    : asArray(counterparty?.roles).map(relationId).includes('customer');
  const customerProfiles = context.collections.clients
    .filter(item => relationId(item?.counterpartyId) === counterpartyId)
    .map(item => ({
      clientId: relationId(item?.id) || null,
      status: relationId(item?.customerRoleStatus || item?.status) || 'active',
      archived: Boolean(item?.archivedAt || relationId(item?.status).toLowerCase() === 'archived'),
      displayName: relationId(item?.company || item?.name) || null,
    }))
    .sort((left, right) => compareText(left.clientId, right.clientId));
  return {
    counterpartyLifecycleStatus: relationId(counterparty?.status) || 'active',
    counterpartyArchived: Boolean(
      counterparty?.archivedAt || relationId(counterparty?.status).toLowerCase() === 'archived'
    ),
    activeCustomerRole,
    customerRoleSource: assignments.length > 0 ? 'role_assignment' : 'counterparty_projection',
    customerProfiles,
  };
}

function resolveArDebtorIdentity(record, data = {}, options = {}) {
  const context = options.context || buildResolverContext(data);
  const sourceRelations = [];
  const candidateCounterpartyIds = [];
  const legacyClientIds = [];
  const issues = [];
  const issueKeys = new Set();

  function addIssue(issue) {
    const normalized = {
      blocking: issue.blocking !== false,
      code: issue.code,
      relation: issue.relation || null,
      stableId: relationId(issue.stableId) || null,
      counterpartyId: relationId(issue.counterpartyId) || null,
      message: issue.message,
    };
    const key = JSON.stringify(normalized);
    if (issueKeys.has(key)) return;
    issueKeys.add(key);
    issues.push(normalized);
  }

  function addSource({
    path,
    stableId,
    counterpartyId = null,
    authority,
    outcome,
  }) {
    sourceRelations.push({
      path,
      stableId: relationId(stableId) || null,
      counterpartyId: relationId(counterpartyId) || null,
      authority,
      outcome,
    });
  }

  function addCandidate({ path, stableId, counterpartyId, authority }) {
    const id = relationId(counterpartyId);
    if (!id) return;
    candidateCounterpartyIds.push(id);
    addSource({ path, stableId, counterpartyId: id, authority, outcome: 'candidate' });
  }

  function findUnique(collectionNames, stableId, relation) {
    const id = relationId(stableId);
    if (!id) return { status: 'absent', id, item: null, collection: null, matches: 0 };
    const matches = [];
    for (const collection of collectionNames) {
      for (const item of context.indexes[collection]?.get(id) || []) {
        matches.push({ collection, item });
      }
    }
    if (matches.length === 0) return { status: 'missing', id, item: null, collection: null, matches: 0 };
    if (matches.length > 1) {
      addSource({
        path: relation,
        stableId: id,
        authority: 'stable_id',
        outcome: 'ambiguous',
      });
      addIssue({
        code: 'AR_DEBTOR_RELATION_AMBIGUOUS',
        relation,
        stableId: id,
        message: `Stable relation ${relation} is ambiguous (${matches.length} matches).`,
      });
      return { status: 'ambiguous', id, item: null, collection: null, matches: matches.length };
    }
    return {
      status: 'found',
      id,
      item: matches[0].item,
      collection: matches[0].collection,
      matches: 1,
    };
  }

  function collectClient(clientId, path) {
    const id = relationId(clientId);
    if (!id) return;
    legacyClientIds.push(id);
    const match = findUnique(['clients'], id, path);
    if (match.status === 'ambiguous') return;
    if (match.status === 'missing') {
      addSource({ path, stableId: id, authority: 'compatibility', outcome: 'orphan_client' });
      addIssue({
        code: 'AR_DEBTOR_ORPHAN_CLIENT',
        relation: path,
        stableId: id,
        message: `Client ${id} referenced by ${path} does not exist.`,
      });
      return;
    }
    const counterpartyId = relationId(match.item?.counterpartyId);
    if (!counterpartyId) {
      addSource({ path, stableId: id, authority: 'compatibility', outcome: 'missing_counterparty_link' });
      addIssue({
        code: 'AR_DEBTOR_CLIENT_COUNTERPARTY_MISSING',
        relation: path,
        stableId: id,
        message: `Client ${id} does not contain a stable counterpartyId.`,
      });
      return;
    }
    addCandidate({ path, stableId: id, counterpartyId, authority: 'compatibility' });
    const clientStatus = relationId(match.item?.customerRoleStatus || match.item?.status).toLowerCase();
    if (match.item?.archivedAt || ['archived', 'inactive'].includes(clientStatus)) {
      addIssue({
        blocking: false,
        code: 'AR_DEBTOR_CUSTOMER_PROFILE_INACTIVE',
        relation: path,
        stableId: id,
        counterpartyId,
        message: `Client ${id} is inactive; its stable Counterparty relation remains diagnostic identity authority.`,
      });
    }
  }

  function collectRental(rentalId, path) {
    const id = relationId(rentalId);
    if (!id) return;
    const match = findUnique(['rentals', 'gantt_rentals'], id, path);
    if (match.status === 'ambiguous') return;
    if (match.status === 'missing') {
      addSource({ path, stableId: id, authority: 'stable_id', outcome: 'missing' });
      addIssue({
        code: 'AR_DEBTOR_RELATION_TARGET_MISSING',
        relation: path,
        stableId: id,
        message: `Rental ${id} referenced by ${path} does not exist.`,
      });
      return;
    }
    const rentalPath = `${path} -> ${match.collection === 'rentals' ? 'Rental' : 'GanttRental'}`;
    const counterpartyId = relationId(match.item?.counterpartyId);
    const clientId = relationId(match.item?.clientId);
    if (counterpartyId) {
      addCandidate({
        path: `${rentalPath}.counterpartyId`,
        stableId: id,
        counterpartyId,
        authority: 'canonical',
      });
    }
    if (clientId) collectClient(clientId, `${rentalPath}.clientId -> Client.counterpartyId`);
    if (!counterpartyId && !clientId) {
      addSource({ path: rentalPath, stableId: id, authority: 'stable_id', outcome: 'missing_identity' });
      addIssue({
        code: 'AR_DEBTOR_STABLE_ID_MISSING',
        relation: rentalPath,
        stableId: id,
        message: `Rental ${id} has no stable counterpartyId or legacy clientId relation.`,
      });
    }
  }

  function collectPayment(paymentId, path) {
    const id = relationId(paymentId);
    if (!id) return;
    const match = findUnique(['payments'], id, path);
    if (match.status === 'ambiguous') return;
    if (match.status === 'missing') {
      addSource({ path, stableId: id, authority: 'stable_id', outcome: 'missing' });
      addIssue({
        code: 'AR_DEBTOR_RELATION_TARGET_MISSING',
        relation: path,
        stableId: id,
        message: `Payment ${id} referenced by ${path} does not exist.`,
      });
      return;
    }
    const counterpartyId = relationId(match.item?.counterpartyId);
    const clientId = relationId(match.item?.clientId);
    const rentalId = relationId(
      match.item?.rentalId || match.item?.ganttRentalId || match.item?.classicRentalId
    );
    if (counterpartyId) {
      addCandidate({
        path: `${path} -> Payment.counterpartyId`,
        stableId: id,
        counterpartyId,
        authority: 'canonical',
      });
    }
    if (clientId) collectClient(clientId, `${path} -> Payment.clientId -> Client.counterpartyId`);
    if (rentalId) collectRental(rentalId, `${path} -> Payment.rentalId`);
    if (!counterpartyId && !clientId && !rentalId) {
      addSource({ path, stableId: id, authority: 'stable_id', outcome: 'missing_identity' });
      addIssue({
        code: 'AR_DEBTOR_STABLE_ID_MISSING',
        relation: path,
        stableId: id,
        message: `Payment ${id} has no permitted stable Counterparty compatibility relation.`,
      });
    }
  }

  function collectDirectTarget({ field, collection, entity }) {
    const id = relationId(record?.[field]);
    if (!id) return;
    const path = `record.${field} -> ${entity}.counterpartyId`;
    const match = findUnique([collection], id, `record.${field}`);
    if (match.status === 'ambiguous') return;
    if (match.status === 'missing') {
      addSource({ path, stableId: id, authority: 'stable_id', outcome: 'missing' });
      addIssue({
        code: 'AR_DEBTOR_RELATION_TARGET_MISSING',
        relation: `record.${field}`,
        stableId: id,
        message: `${entity} ${id} referenced by record.${field} does not exist.`,
      });
      return;
    }
    const counterpartyId = relationId(match.item?.counterpartyId);
    if (!counterpartyId) {
      addSource({ path, stableId: id, authority: 'canonical', outcome: 'missing_identity' });
      addIssue({
        code: 'AR_DEBTOR_STABLE_ID_MISSING',
        relation: path,
        stableId: id,
        message: `${entity} ${id} does not contain a stable counterpartyId.`,
      });
      return;
    }
    addCandidate({ path, stableId: id, counterpartyId, authority: 'canonical' });
  }

  if (Number(options.rootRecordMatches) > 1) {
    addIssue({
      code: 'AR_DEBTOR_RECORD_ID_AMBIGUOUS',
      relation: options.domain || 'record',
      stableId: options.recordId,
      message: `Record stable ID ${relationId(options.recordId)} is duplicated (${options.rootRecordMatches} matches).`,
    });
  }

  const explicitCounterpartyId = relationId(record?.counterpartyId);
  if (explicitCounterpartyId) {
    addCandidate({
      path: 'record.counterpartyId',
      stableId: explicitCounterpartyId,
      counterpartyId: explicitCounterpartyId,
      authority: 'canonical',
    });
  }
  if (relationId(record?.clientId)) {
    collectClient(record.clientId, 'record.clientId -> Client.counterpartyId');
  }
  if (relationId(record?.rentalId)) collectRental(record.rentalId, 'record.rentalId');
  if (relationId(record?.paymentId)) collectPayment(record.paymentId, 'record.paymentId');
  collectDirectTarget({ field: 'documentId', collection: 'documents', entity: 'Document' });
  collectDirectTarget({ field: 'contractId', collection: 'client_contracts', entity: 'ClientContract' });
  collectDirectTarget({ field: 'objectId', collection: 'client_objects', entity: 'ClientObject' });

  const candidates = uniqueSorted(candidateCounterpartyIds);
  for (const counterpartyId of candidates) {
    const match = findUnique(['counterparties'], counterpartyId, 'Counterparty.id');
    if (match.status === 'ambiguous') continue;
    if (match.status === 'missing') {
      addIssue({
        code: 'AR_DEBTOR_ORPHAN_COUNTERPARTY',
        relation: 'Counterparty.id',
        stableId: counterpartyId,
        counterpartyId,
        message: `Stable relation points to missing Counterparty ${counterpartyId}.`,
      });
    }
  }

  if (candidates.length > 1) {
    addIssue({
      code: 'AR_DEBTOR_IDENTITY_MISMATCH',
      relation: 'stable_candidates',
      message: `Stable relation chains disagree: ${candidates.join(', ')}.`,
    });
  }
  if (candidates.length === 0 && !issues.some(issue => issue.blocking)) {
    addIssue({
      code: 'AR_DEBTOR_IDENTITY_UNRESOLVED',
      relation: 'record',
      message: 'No permitted stable Counterparty relation was found.',
    });
  }

  const blockingIssues = issues.filter(issue => issue.blocking);
  let status;
  if (blockingIssues.some(issue => [
    'AR_DEBTOR_RELATION_AMBIGUOUS',
    'AR_DEBTOR_RECORD_ID_AMBIGUOUS',
  ].includes(issue.code))) {
    status = AR_DEBTOR_IDENTITY_STATUSES.AMBIGUOUS;
  } else if (candidates.length > 1) {
    status = AR_DEBTOR_IDENTITY_STATUSES.MISMATCH;
  } else if (blockingIssues.some(issue => issue.code === 'AR_DEBTOR_ORPHAN_CLIENT')) {
    status = AR_DEBTOR_IDENTITY_STATUSES.ORPHAN_CLIENT;
  } else if (blockingIssues.some(issue => issue.code === 'AR_DEBTOR_ORPHAN_COUNTERPARTY')) {
    status = AR_DEBTOR_IDENTITY_STATUSES.ORPHAN_COUNTERPARTY;
  } else if (blockingIssues.length > 0 || candidates.length === 0) {
    status = AR_DEBTOR_IDENTITY_STATUSES.UNRESOLVED;
  } else {
    const canonicalSources = sourceRelations.filter(item => (
      item.outcome === 'candidate' && item.authority === 'canonical'
    ));
    const compatibilitySources = sourceRelations.filter(item => (
      item.outcome === 'candidate' && item.authority === 'compatibility'
    ));
    if (canonicalSources.length > 0 && compatibilitySources.length > 0) {
      status = AR_DEBTOR_IDENTITY_STATUSES.MATCHING_DUAL_ID;
    } else if (compatibilitySources.length > 0) {
      status = AR_DEBTOR_IDENTITY_STATUSES.LEGACY_RESOLVED;
    } else if (
      canonicalSources.length === 1
      && canonicalSources[0].path === 'record.counterpartyId'
    ) {
      status = AR_DEBTOR_IDENTITY_STATUSES.COUNTERPARTY_ONLY;
    } else {
      status = AR_DEBTOR_IDENTITY_STATUSES.CANONICAL;
    }
  }

  const counterpartyId = RESOLVED_STATUSES.has(status) ? candidates[0] : null;
  const counterparty = counterpartyId
    ? (context.indexes.counterparties.get(counterpartyId) || [])[0] || null
    : null;
  const metadata = {
    ...lifecycleAndRoleMetadata(counterparty, counterpartyId, context),
    displaySnapshots: displaySnapshots(record),
  };
  if (counterparty && metadata.counterpartyArchived) {
    addIssue({
      blocking: false,
      code: 'AR_DEBTOR_COUNTERPARTY_ARCHIVED',
      relation: 'Counterparty.id',
      stableId: counterpartyId,
      counterpartyId,
      message: `Counterparty ${counterpartyId} is archived; historic stable debtor identity is retained.`,
    });
  }
  if (counterparty && metadata.activeCustomerRole === false) {
    addIssue({
      blocking: false,
      code: 'AR_DEBTOR_CUSTOMER_ROLE_INACTIVE',
      relation: 'Counterparty.id',
      stableId: counterpartyId,
      counterpartyId,
      message: `Counterparty ${counterpartyId} has no active customer role; identity is not rebound.`,
    });
  }

  return {
    status,
    counterpartyId,
    candidateCounterpartyIds: candidates,
    sourceRelations: sortSourceRelations(sourceRelations),
    legacyClientIds: uniqueSorted(legacyClientIds),
    issues: sortIssues(issues),
    metadata,
  };
}

function statusCounts() {
  return Object.values(AR_DEBTOR_IDENTITY_STATUSES)
    .reduce((counts, status) => ({ ...counts, [status]: 0 }), {});
}

function stableRecordKey(record) {
  const keys = Object.keys(record || {}).sort(compareText);
  return JSON.stringify(keys.reduce((result, key) => {
    result[key] = record[key];
    return result;
  }, {}));
}

function auditArDebtorIdentities(data = {}, options = {}) {
  const collections = Array.isArray(options.collections) && options.collections.length > 0
    ? uniqueSorted(options.collections)
    : [...AR_DEBTOR_AUDIT_COLLECTIONS];
  const context = buildResolverContext(data);
  const entries = [];
  const scannedCollections = {};

  for (const domain of collections) {
    const records = readCollection(data, domain);
    scannedCollections[domain] = records.length;
    const idCounts = new Map();
    for (const record of records) {
      const id = relationId(record?.id);
      if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1);
    }
    const sortedRecords = records
      .map((record, sourceIndex) => ({ record, sourceIndex, key: stableRecordKey(record) }))
      .sort((left, right) => (
        compareText(relationId(left.record?.id), relationId(right.record?.id))
        || compareText(left.key, right.key)
        || left.sourceIndex - right.sourceIndex
      ));
    for (const { record } of sortedRecords) {
      const recordId = relationId(record?.id) || null;
      const result = resolveArDebtorIdentity(record, data, {
        context,
        domain,
        recordId,
        rootRecordMatches: recordId ? idCounts.get(recordId) : 0,
      });
      entries.push({ domain, recordId, ...result });
    }
  }

  entries.sort((left, right) => (
    compareText(left.domain, right.domain)
    || compareText(left.recordId, right.recordId)
    || compareText(left.status, right.status)
    || compareText(JSON.stringify(left.sourceRelations), JSON.stringify(right.sourceRelations))
  ));

  const counts = statusCounts();
  for (const entry of entries) counts[entry.status] += 1;
  const issues = entries.flatMap(entry => entry.issues.map(issue => ({
    domain: entry.domain,
    recordId: entry.recordId,
    status: entry.status,
    counterpartyId: entry.counterpartyId,
    ...issue,
  }))).sort((left, right) => (
    compareText(left.domain, right.domain)
    || compareText(left.recordId, right.recordId)
    || compareText(left.code, right.code)
    || compareText(left.relation, right.relation)
    || compareText(left.stableId, right.stableId)
  ));
  const blockingIssues = issues.filter(issue => issue.blocking);
  const resolved = entries.filter(entry => RESOLVED_STATUSES.has(entry.status)).length;

  return {
    summary: {
      inspected: entries.length,
      resolved,
      ...counts,
      orphan: counts.orphan_client + counts.orphan_counterparty,
      blockingIssueCount: blockingIssues.length,
      collections: Object.fromEntries(Object.entries(scannedCollections).sort(([left], [right]) => compareText(left, right))),
    },
    entries,
    issues,
    blockingIssues,
  };
}

function isBlockingArDebtorIdentityStatus(status) {
  return BLOCKING_STATUSES.has(status);
}

module.exports = {
  AR_DEBTOR_AUDIT_COLLECTIONS,
  AR_DEBTOR_IDENTITY_STATUSES,
  auditArDebtorIdentities,
  isBlockingArDebtorIdentityStatus,
  resolveArDebtorIdentity,
};
