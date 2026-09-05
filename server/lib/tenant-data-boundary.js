const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const {
  prepareSqliteReadonlyStatement,
} = require('./sqlite-readonly-statement');
const {
  ActorScopeError,
  assertCompleteActorScope,
  assignTrustedScope,
  filterRecordsByActorScope,
} = require('./trusted-actor-scope');
const { COMPANY_MEMBERSHIPS_TABLE } = require('./platform-identity-schema');
const {
  ALL_APP_DATA_COLLECTIONS,
  COLLECTION_SCOPE_CATEGORY,
  COLLECTION_SHAPE,
  PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS,
  collectionsForCategory,
  getCollectionScopePolicy,
} = require('./app-data-scope-registry');
const {
  archiveTenantCatalogRecord: archivePhysicalTenantCatalogRecord,
  assertValidCatalogFamilyState,
  assertValidCatalogState,
  CATALOG_ORIGIN_KINDS,
  createTenantCatalogEntry: createPhysicalTenantCatalogEntry,
  deleteEffectiveTenantCatalogRecord: deleteLogicalTenantCatalogRecord,
  isPlatformDefaultTenantOverlayCollection,
  readEffectiveCatalog,
  readEffectiveCatalogRecord,
  readTenantPhysicalCatalogRecord,
  replacePlatformCatalogDefaults,
  replaceTenantCatalogPartition,
  revertTenantCatalogOverride: revertPhysicalTenantCatalogOverride,
  TRUSTED_PLATFORM_CATALOG_AUTHORITY,
  updateEffectiveTenantCatalogRecord: updateLogicalTenantCatalogRecord,
  PlatformDefaultTenantOverlayError,
} = require('./platform-default-tenant-overlay');

const TENANT_OWNED_ARRAY_COLLECTIONS = Object.freeze([
  ...collectionsForCategory(COLLECTION_SCOPE_CATEGORY.TENANT),
  ...collectionsForCategory(COLLECTION_SCOPE_CATEGORY.TENANT_TECHNICAL),
  ...collectionsForCategory(COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE),
  ...collectionsForCategory(COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY),
].filter(name => getCollectionScopePolicy(name)?.shape === COLLECTION_SHAPE.ARRAY));
const TENANT_OWNED_MAP_COLLECTIONS = Object.freeze([
  ...collectionsForCategory(COLLECTION_SCOPE_CATEGORY.TENANT_TECHNICAL),
].filter(name => getCollectionScopePolicy(name)?.shape === COLLECTION_SHAPE.MAP));
const TENANT_OWNED_SINGLETON_COLLECTIONS = Object.freeze([
  ...collectionsForCategory(COLLECTION_SCOPE_CATEGORY.TENANT),
  ...collectionsForCategory(COLLECTION_SCOPE_CATEGORY.TENANT_TECHNICAL),
].filter(name => getCollectionScopePolicy(name)?.shape === COLLECTION_SHAPE.SINGLETON));
const GLOBAL_REFERENCE_COLLECTIONS = Object.freeze([
  ...collectionsForCategory(COLLECTION_SCOPE_CATEGORY.GLOBAL_REFERENCE),
]);
const SYSTEM_GLOBAL_COLLECTIONS = Object.freeze([
  ...collectionsForCategory(COLLECTION_SCOPE_CATEGORY.SYSTEM),
]);
const LEGACY_HISTORY_COLLECTIONS = Object.freeze([
  ...collectionsForCategory(COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY),
]);
const DERIVED_SCOPE_COLLECTIONS = Object.freeze([
  ...collectionsForCategory(COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE),
]);
const TENANT_SINGLETON_ENVELOPE = '__tenantScopedValues';
const tenantContext = new AsyncLocalStorage();

class TenantDataBoundaryError extends Error {
  constructor(code, message, status = 403, details = undefined) {
    super(message);
    this.name = 'TenantDataBoundaryError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function text(value) {
  return String(value ?? '').trim();
}

function collectionPolicy(name) {
  const collection = text(name);
  const policy = getCollectionScopePolicy(collection);
  if (!policy) {
    throw new TenantDataBoundaryError(
      'TENANT_COLLECTION_UNCLASSIFIED',
      'The requested data collection has no security classification.',
      403,
      { collection },
    );
  }
  return policy;
}

function isTenantOwnedCollection(name) {
  const category = getCollectionScopePolicy(text(name))?.category;
  return category === COLLECTION_SCOPE_CATEGORY.TENANT
    || category === COLLECTION_SCOPE_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY
    || category === COLLECTION_SCOPE_CATEGORY.TENANT_TECHNICAL
    || category === COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE
    || category === COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY;
}

function isGlobalReferenceCollection(name) {
  return getCollectionScopePolicy(text(name))?.category === COLLECTION_SCOPE_CATEGORY.GLOBAL_REFERENCE;
}

function isLegacyIdempotencyCollection(name) {
  return getCollectionScopePolicy(text(name))?.writeAuthority === 'PLATFORM_REMEDIATION_ONLY';
}

function createContext(kind, values = {}) {
  return Object.freeze({ kind, readFingerprints: new Map(), ...values });
}

function runWithTenantActorScope(scope, operation) {
  const actorScope = assertCompleteActorScope(scope);
  if (typeof operation !== 'function') throw new TypeError('Tenant data access requires an operation.');
  const parentContext = activeTenantContext();
  if (parentContext) {
    if (
      parentContext.kind !== 'tenant_actor'
      || parentContext.actorScope.companyId !== actorScope.companyId
      || parentContext.actorScope.tenantId !== actorScope.tenantId
    ) {
      throw new TenantDataBoundaryError(
        'TENANT_SCOPE_ELEVATION_DENIED',
        'An active data-access context cannot be replaced by another tenant scope.',
        403,
      );
    }
    // Same-tenant re-entry keeps the original authoritative principal,
    // capabilities, and optimistic-read snapshot. It must not manufacture a
    // fresh context from caller-supplied identity fields.
    return operation();
  }
  return tenantContext.run(createContext('tenant_actor', {
    actorScope,
    allowedHistoryWrites: new Set(),
    repositoryReason: null,
  }), operation);
}

function runWithTenantHistoryRepositoryScope({ scope, reason, writableCollections = [] } = {}, operation) {
  const requestedActorScope = assertCompleteActorScope(scope);
  const parentContext = activeTenantContext();
  if (parentContext && parentContext.kind !== 'tenant_actor') {
    throw new TenantDataBoundaryError(
      'HISTORY_SCOPE_ELEVATION_DENIED',
      'A denied or platform data-access context cannot be replaced by tenant history scope.',
      403,
    );
  }
  if (
    parentContext?.kind === 'tenant_actor'
    && (
      parentContext.actorScope.companyId !== requestedActorScope.companyId
      || parentContext.actorScope.tenantId !== requestedActorScope.tenantId
    )
  ) {
    throw new TenantDataBoundaryError(
      'CROSS_TENANT_HISTORY_SCOPE_DENIED',
      'A tenant operation cannot switch scope through the history repository.',
      403,
    );
  }
  const repositoryReason = text(reason);
  if (!repositoryReason) {
    throw new TenantDataBoundaryError(
      'HISTORY_REPOSITORY_REASON_REQUIRED',
      'A repository reason is required for tenant history persistence.',
      403,
    );
  }
  if (typeof operation !== 'function') throw new TypeError('Tenant history repository access requires an operation.');
  const allowedHistoryWrites = new Set((writableCollections || []).map(name => {
    const policy = collectionPolicy(name);
    if (policy.category !== COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY) {
      throw new TenantDataBoundaryError(
        'HISTORY_REPOSITORY_COLLECTION_INVALID',
        'Only explicitly classified history collections may use the history repository.',
        403,
        { collection: policy.name },
      );
    }
    return policy.name;
  }));
  if (
    parentContext?.repositoryReason
    && [...allowedHistoryWrites].some(name => !parentContext.allowedHistoryWrites?.has(name))
  ) {
    throw new TenantDataBoundaryError(
      'HISTORY_SCOPE_CAPABILITY_EXCEEDED',
      'A nested history repository cannot widen its collection capability.',
      403,
    );
  }
  if (parentContext?.repositoryReason) return operation();
  const actorScope = parentContext?.kind === 'tenant_actor'
    ? parentContext.actorScope
    : requestedActorScope;
  return tenantContext.run(createContext('tenant_actor', {
    actorScope,
    allowedHistoryWrites,
    repositoryReason,
    // A semantic-history repository call may wrap an already-scoped business
    // mutation. Reuse the snapshot map so the mixed atomic batch retains the
    // optimistic-concurrency guarantees established by the preceding reads.
    ...(parentContext?.kind === 'tenant_actor'
      ? { readFingerprints: parentContext.readFingerprints }
      : {}),
  }), operation);
}

function runWithDeniedTenantScope(operation) {
  return tenantContext.run(createContext('tenant_denied'), operation);
}

function platformCollectionSet(collections, label) {
  return new Set((collections || []).map(name => {
    try {
      return collectionPolicy(name).name;
    } catch (error) {
      if (error?.code === 'TENANT_COLLECTION_UNCLASSIFIED') {
        throw new TenantDataBoundaryError(
          'PLATFORM_SCOPE_COLLECTION_INVALID',
          `${label} contains an unclassified collection.`,
          403,
        );
      }
      throw error;
    }
  }));
}

function enterPlatformSystemScope({
  reason,
  allowedWrites,
  allowedReads = null,
  allowedParentKinds = new Set(),
}, operation) {
  const parentContext = activeTenantContext();
  if (parentContext && !allowedParentKinds.has(parentContext.kind)) {
    throw new TenantDataBoundaryError(
      'PLATFORM_SCOPE_ELEVATION_DENIED',
      'An active data-access context cannot be replaced by platform scope.',
      403,
    );
  }
  return tenantContext.run(createContext('platform_system', {
    reason,
    allowedWrites,
    allowedReads,
  }), operation);
}

function runWithPlatformSystemScope({ reason, writableCollections = [] } = {}, operation) {
  const purpose = text(reason);
  if (!purpose) {
    throw new TenantDataBoundaryError(
      'PLATFORM_DATA_ACCESS_REASON_REQUIRED',
      'Explicit platform data access requires a reason.',
      403,
    );
  }
  if (typeof operation !== 'function') throw new TypeError('Platform data access requires an operation.');
  const allowedWrites = platformCollectionSet(writableCollections, 'Platform write allow-list');
  return enterPlatformSystemScope({
    reason: purpose,
    allowedWrites,
  }, operation);
}

function createBoundPlatformSystemScopeRunner({
  reasonPrefix,
  readableCollections = [],
  writableCollections = [],
  allowedParentKinds = [],
} = {}) {
  if (activeTenantContext()) {
    throw new TenantDataBoundaryError(
      'PLATFORM_SCOPE_CAPABILITY_CREATION_DENIED',
      'A bound platform capability cannot be created inside an active data-access context.',
      403,
    );
  }
  const prefix = text(reasonPrefix);
  if (!prefix) {
    throw new TenantDataBoundaryError(
      'PLATFORM_DATA_ACCESS_REASON_REQUIRED',
      'A bound platform capability requires an exact reason prefix.',
      403,
    );
  }
  const fixedWrites = platformCollectionSet(writableCollections, 'Bound platform write allow-list');
  const fixedReads = platformCollectionSet(
    [...readableCollections, ...fixedWrites],
    'Bound platform read allow-list',
  );
  const parentKinds = new Set(allowedParentKinds);
  if ([...parentKinds].some(kind => !['tenant_actor', 'tenant_denied', 'platform_system'].includes(kind))) {
    throw new TenantDataBoundaryError(
      'PLATFORM_SCOPE_PARENT_INVALID',
      'A bound platform capability contains an unsupported parent context.',
      403,
    );
  }
  return Object.freeze(function runWithBoundPlatformSystemScope(
    { reason, writableCollections: requestedWrites = [] } = {},
    operation,
  ) {
    const purpose = text(reason);
    if (!purpose || !purpose.startsWith(prefix)) {
      throw new TenantDataBoundaryError(
        'PLATFORM_DATA_ACCESS_REASON_INVALID',
        'The platform data-access reason is outside the bound capability.',
        403,
      );
    }
    if (typeof operation !== 'function') throw new TypeError('Platform data access requires an operation.');
    const allowedWrites = platformCollectionSet(requestedWrites, 'Requested platform write allow-list');
    if ([...allowedWrites].some(name => !fixedWrites.has(name))) {
      throw new TenantDataBoundaryError(
        'PLATFORM_SCOPE_CAPABILITY_EXCEEDED',
        'The requested platform write is outside the bound capability.',
        403,
      );
    }
    return enterPlatformSystemScope({
      reason: purpose,
      allowedWrites,
      allowedReads: fixedReads,
      allowedParentKinds: parentKinds,
    }, operation);
  });
}

function activeTenantContext() {
  return tenantContext.getStore() || null;
}

// Callers sometimes need to capture enough context to resume an audited unit
// of work. Never expose the live ALS object: Set/Map contents remain mutable
// even when their containing object is frozen and could otherwise widen a
// bound capability or replace the concurrency snapshot.
function currentTenantContext() {
  const context = activeTenantContext();
  if (!context) return null;
  return Object.freeze({
    kind: context.kind,
    ...(context.actorScope ? {
      actorScope: Object.freeze({ ...context.actorScope }),
    } : {}),
    ...(context.reason ? { reason: context.reason } : {}),
    ...(context.repositoryReason ? { repositoryReason: context.repositoryReason } : {}),
    ...(context.allowedWrites instanceof Set ? {
      allowedWrites: new Set(context.allowedWrites),
    } : {}),
    ...(context.allowedReads instanceof Set ? {
      allowedReads: new Set(context.allowedReads),
    } : {}),
    ...(context.allowedHistoryWrites instanceof Set ? {
      allowedHistoryWrites: new Set(context.allowedHistoryWrites),
    } : {}),
  });
}

function scopeMatches(record, scope) {
  return text(record?.companyId) === scope.companyId
    && text(record?.tenantId) === scope.tenantId;
}

function isUnscopedRecord(record) {
  return !text(record?.companyId) && !text(record?.tenantId);
}

function assertIncomingScope(record, scope, collection) {
  for (const field of ['companyId', 'tenantId']) {
    if (!Object.prototype.hasOwnProperty.call(record || {}, field)) continue;
    const supplied = text(record?.[field]);
    if (supplied && supplied !== scope[field]) {
      throw new TenantDataBoundaryError(
        'TENANT_SCOPE_SPOOFING_DENIED',
        'Record ownership does not match trusted actor scope.',
        403,
        { collection, field },
      );
    }
  }
}

function stableRecordId(record) {
  return text(record?.id || record?._id);
}

function rawFingerprint(value) {
  return JSON.stringify(value ?? null);
}

function rememberRead(context, name, raw) {
  if (!context?.readFingerprints?.has(name)) {
    context?.readFingerprints?.set(name, rawFingerprint(raw));
  }
}

function rememberPersisted(context, name, value) {
  context?.readFingerprints?.set(name, rawFingerprint(value));
}

function assertReadSnapshotCurrent(context, collection, raw) {
  if (!context?.readFingerprints?.has(collection)) return;
  if (context.readFingerprints.get(collection) === rawFingerprint(raw)) return;
  throw new TenantDataBoundaryError(
    'TENANT_COLLECTION_CONCURRENT_MODIFICATION',
    'The collection changed after it was read; retry the operation.',
    409,
    { collection },
  );
}

function mergeTenantArray(
  collection,
  rawValue,
  nextValue,
  scope,
  ownsStoredRecord = record => scopeMatches(record, scope),
) {
  if (!Array.isArray(nextValue)) {
    throw new TenantDataBoundaryError(
      'TENANT_COLLECTION_SHAPE_INVALID',
      `Tenant-scoped collection ${collection} must be an array.`,
      409,
    );
  }
  const raw = Array.isArray(rawValue) ? rawValue : [];
  const policy = collectionPolicy(collection);
  let appendOnlyPrefixLength = null;
  if (policy.mutationPolicy === 'APPEND_ONLY') {
    const currentScoped = raw.filter(ownsStoredRecord);
    const preservesHistory = nextValue.length >= currentScoped.length
      && currentScoped.every((record, index) => rawFingerprint(record) === rawFingerprint(nextValue[index]));
    if (!preservesHistory) {
      throw new TenantDataBoundaryError(
        'TENANT_APPEND_ONLY_COLLECTION_MUTATION',
        `Tenant-scoped collection ${collection} is append-only.`,
        409,
        { collection },
      );
    }
    appendOnlyPrefixLength = currentScoped.length;
  }
  const outsideScope = raw.filter(record => !ownsStoredRecord(record));
  const outsideIds = new Set(outsideScope.map(stableRecordId).filter(Boolean));
  const incomingIds = new Set();
  const scoped = nextValue.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TenantDataBoundaryError(
        'TENANT_RECORD_SHAPE_INVALID',
        `Tenant-scoped collection ${collection} contains an invalid record.`,
        409,
      );
    }
    assertIncomingScope(record, scope, collection);
    const id = stableRecordId(record);
    if (id && (outsideIds.has(id) || incomingIds.has(id))) {
      throw new TenantDataBoundaryError(
        'TENANT_RECORD_ID_COLLISION',
        'Record identifier is unavailable.',
        409,
        { collection },
      );
    }
    if (id) incomingIds.add(id);
    return assignTrustedScope(record, scope);
  });
  if (appendOnlyPrefixLength !== null) {
    return [...raw, ...scoped.slice(appendOnlyPrefixLength)];
  }
  return [...outsideScope, ...scoped];
}

function filterTenantMap(rawValue, scope) {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return {};
  return Object.fromEntries(Object.entries(rawValue).filter(([, value]) => scopeMatches(value, scope)));
}

function mergeTenantMap(collection, rawValue, nextValue, scope) {
  if (!nextValue || typeof nextValue !== 'object' || Array.isArray(nextValue)) {
    throw new TenantDataBoundaryError(
      'TENANT_COLLECTION_SHAPE_INVALID',
      `Tenant-scoped collection ${collection} must be an object map.`,
      409,
    );
  }
  const raw = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue) ? rawValue : {};
  const outside = Object.fromEntries(Object.entries(raw).filter(([, value]) => !scopeMatches(value, scope)));
  const scoped = {};
  for (const [key, value] of Object.entries(nextValue)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TenantDataBoundaryError(
        'TENANT_RECORD_SHAPE_INVALID',
        `Tenant-scoped map ${collection} contains an invalid record.`,
        409,
      );
    }
    if (Object.prototype.hasOwnProperty.call(outside, key)) {
      throw new TenantDataBoundaryError(
        'TENANT_RECORD_ID_COLLISION',
        'Record identifier is unavailable.',
        409,
        { collection },
      );
    }
    assertIncomingScope(value, scope, collection);
    scoped[key] = assignTrustedScope(value, scope);
  }
  return { ...outside, ...scoped };
}

function readTenantSingleton(rawValue, scope) {
  const envelope = rawValue?.[TENANT_SINGLETON_ENVELOPE];
  const entry = envelope && typeof envelope === 'object' && !Array.isArray(envelope)
    ? envelope[scope.companyId]
    : null;
  return scopeMatches(entry, scope) ? entry.value : null;
}

function mergeTenantSingleton(collection, rawValue, nextValue, scope) {
  if (!nextValue || typeof nextValue !== 'object' || Array.isArray(nextValue)) {
    throw new TenantDataBoundaryError(
      'TENANT_COLLECTION_SHAPE_INVALID',
      `Tenant-scoped singleton ${collection} must be an object.`,
      409,
    );
  }
  const existingEnvelope = rawValue?.[TENANT_SINGLETON_ENVELOPE];
  const envelope = existingEnvelope && typeof existingEnvelope === 'object' && !Array.isArray(existingEnvelope)
    ? existingEnvelope
    : {};
  return {
    ...(rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue) ? rawValue : {}),
    [TENANT_SINGLETON_ENVELOPE]: {
      ...envelope,
      [scope.companyId]: {
        companyId: scope.companyId,
        tenantId: scope.tenantId,
        value: nextValue,
      },
    },
  };
}

function emptyValueForPolicy(policy) {
  if (policy.shape === COLLECTION_SHAPE.MAP) return {};
  if (policy.shape === COLLECTION_SHAPE.SINGLETON) return null;
  return [];
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertStoredSingletonEnvelope(policy, value) {
  if (!Object.prototype.hasOwnProperty.call(value, TENANT_SINGLETON_ENVELOPE)) return;
  const envelope = value[TENANT_SINGLETON_ENVELOPE];
  const validEnvelope = isPlainRecord(envelope) && Object.entries(envelope).every(([key, entry]) => {
    if (!text(key) || !isPlainRecord(entry) || !isPlainRecord(entry.value)) return false;
    const companyId = text(entry.companyId);
    const tenantId = text(entry.tenantId);
    return companyId === text(key) && tenantId === companyId;
  });
  if (validEnvelope) return;
  throw new TenantDataBoundaryError(
    'COLLECTION_STORED_SHAPE_INVALID',
    'Stored tenant-singleton envelope is invalid; access is blocked to prevent data loss.',
    409,
    {
      collection: policy.name,
      expectedShape: policy.shape,
      component: TENANT_SINGLETON_ENVELOPE,
    },
  );
}

function assertStoredCollectionShape(policy, value) {
  if (value === null || value === undefined) return;
  const valid = policy.shape === COLLECTION_SHAPE.ARRAY
    ? Array.isArray(value)
    : policy.shape === COLLECTION_SHAPE.MAP
      ? Boolean(value && typeof value === 'object' && !Array.isArray(value))
      : Boolean(value && typeof value === 'object' && !Array.isArray(value));
  if (valid) {
    if (policy.shape === COLLECTION_SHAPE.SINGLETON) assertStoredSingletonEnvelope(policy, value);
    return;
  }
  throw new TenantDataBoundaryError(
    'COLLECTION_STORED_SHAPE_INVALID',
    'Stored collection shape is invalid; access is blocked to prevent data loss.',
    409,
    { collection: policy.name, expectedShape: policy.shape },
  );
}

function assertNextCollectionShape(policy, value) {
  const valid = policy.shape === COLLECTION_SHAPE.ARRAY
    ? Array.isArray(value)
    : Boolean(value && typeof value === 'object' && !Array.isArray(value));
  if (valid) return;
  throw new TenantDataBoundaryError(
    'COLLECTION_WRITE_SHAPE_INVALID',
    'Collection write shape does not match its registry policy.',
    409,
    { collection: policy.name, expectedShape: policy.shape },
  );
}

function createTenantDataBoundary({
  db,
  readRawData,
  writeRawData,
  writeRawDataBatch,
  assertRelationships = () => {},
  generateCatalogRecordId,
  generateMutationAuditId = () => `AUD-MUT-${randomUUID()}`,
  nowIso = () => new Date().toISOString(),
} = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('Tenant data boundary requires SQLite.');
  if (
    typeof readRawData !== 'function'
    || typeof writeRawData !== 'function'
    || typeof writeRawDataBatch !== 'function'
  ) {
    throw new TypeError('Tenant data boundary requires raw storage and an atomic batch writer.');
  }
  if (generateCatalogRecordId !== undefined && typeof generateCatalogRecordId !== 'function') {
    throw new TypeError('Tenant data boundary catalog ID generator must be a function.');
  }

  const activeMembershipsForCompany = prepareSqliteReadonlyStatement(db, `
    SELECT principalId
    FROM ${COMPANY_MEMBERSHIPS_TABLE}
    WHERE companyId = ? AND status = 'active'
      AND principalId IN (
        SELECT principalId
        FROM ${COMPANY_MEMBERSHIPS_TABLE}
        WHERE status = 'active'
        GROUP BY principalId
        HAVING COUNT(*) = 1
      )
    ORDER BY principalId
  `);
  const activeMembershipScopesForPrincipal = prepareSqliteReadonlyStatement(db, `
    SELECT companyId
    FROM ${COMPANY_MEMBERSHIPS_TABLE}
    WHERE principalId = ? AND status = 'active'
    ORDER BY companyId
  `);

  function companyPrincipalIds(scope) {
    return new Set(activeMembershipsForCompany.all(scope.companyId).map(row => text(row.principalId)).filter(Boolean));
  }

  function readUsers(scope, rawValue) {
    const allowed = companyPrincipalIds(scope);
    const raw = Array.isArray(rawValue) ? rawValue : [];
    const visible = raw.filter(user => allowed.has(text(user?.id)));
    const visibleIds = visible.map(user => text(user?.id));
    if (new Set(visibleIds).size !== visibleIds.length) {
      throw new TenantDataBoundaryError(
        'USER_DIRECTORY_IDENTITY_AMBIGUOUS',
        'The user directory contains more than one record for an active principal.',
        409,
      );
    }
    for (const user of visible) assertReadableUserTenantProfile(user, scope);
    return visible;
  }

  function readData(collection) {
    const name = text(collection);
    const policy = collectionPolicy(name);
    const context = activeTenantContext();
    if (!context) {
      throw new TenantDataBoundaryError(
        'DATA_ACCESS_CONTEXT_REQUIRED',
        'Explicit tenant or platform data access context is required.',
        403,
        { collection: name },
      );
    }
    if (context.kind === 'tenant_denied') return emptyValueForPolicy(policy);
    const raw = readRawData(name);
    assertStoredCollectionShape(policy, raw);
    if (isPlatformDefaultTenantOverlayCollection(name)) {
      assertValidCatalogState({ collection: name, records: Array.isArray(raw) ? raw : [] });
    }
    rememberRead(context, name, raw);
    if (context.kind === 'platform_system') {
      if (context.allowedReads instanceof Set && !context.allowedReads.has(name)) {
        throw new TenantDataBoundaryError(
          'PLATFORM_COLLECTION_READ_NOT_ALLOWLISTED',
          'This bound platform operation is not authorized to read the collection.',
          403,
          { collection: name, reason: context.reason },
        );
      }
      return raw;
    }
    if (context.kind === 'tenant_public_read') {
      if (!context.allowedReads?.has(name)) {
        throw new TenantDataBoundaryError(
          'PUBLIC_TENANT_COLLECTION_READ_NOT_ALLOWLISTED',
          'The public tenant reader is not authorized for this collection.',
          403,
          { collection: name },
        );
      }
      if (
        !isTenantOwnedCollection(name)
        || policy.shape !== COLLECTION_SHAPE.SINGLETON
      ) {
        throw new TenantDataBoundaryError(
          'PUBLIC_TENANT_SINGLETON_POLICY_REQUIRED',
          'Only an explicitly classified tenant singleton may use public projection access.',
          403,
          { collection: name },
        );
      }
      return readTenantSingleton(raw, context.tenantScope);
    }
    const scope = context.actorScope;
    if (name === 'users') return readUsers(scope, raw);
    if (policy.category === COLLECTION_SCOPE_CATEGORY.SYSTEM) {
      throw new TenantDataBoundaryError(
        'SYSTEM_COLLECTION_POLICY_REQUIRED',
        'System data is not available through a tenant collection reader.',
        403,
        { collection: name },
      );
    }
    if (policy.category === COLLECTION_SCOPE_CATEGORY.GLOBAL_REFERENCE) {
      return (Array.isArray(raw) ? raw : []).filter(isUnscopedRecord);
    }
    if (policy.category === COLLECTION_SCOPE_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY) {
      return readEffectiveCatalog({
        collection: name,
        records: Array.isArray(raw) ? raw : [],
        scope,
      });
    }
    if (isLegacyIdempotencyCollection(name)) return [];
    if (policy.category === COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE) {
      const memo = new Map();
      return filterRecordsByActorScope(raw, scope).filter(record => (
        tenantDerivedResolution(name, record, scope, readRawData, memo).ok
      ));
    }
    if (policy.shape === COLLECTION_SHAPE.MAP) return filterTenantMap(raw, scope);
    if (policy.shape === COLLECTION_SHAPE.SINGLETON) return readTenantSingleton(raw, scope);
    return filterRecordsByActorScope(raw, scope);
  }

  function readTenantPhysicalData(collection, physicalId) {
    const name = text(collection);
    const policy = collectionPolicy(name);
    const context = activeTenantContext();
    if (!context || context.kind !== 'tenant_actor') {
      throw new ActorScopeError(
        'ACTOR_SCOPE_INCOMPLETE',
        'Trusted company/tenant scope is required for physical tenant data access.',
        403,
      );
    }
    if (policy.category !== COLLECTION_SCOPE_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY) {
      throw new TenantDataBoundaryError(
        'TENANT_PHYSICAL_COLLECTION_UNSUPPORTED',
        'Direct physical access is only available for tenant catalogue rows.',
        403,
        { collection: name },
      );
    }
    const raw = readRawData(name);
    assertStoredCollectionShape(policy, raw);
    assertValidCatalogState({ collection: name, records: Array.isArray(raw) ? raw : [] });
    rememberRead(context, name, raw);
    return readTenantPhysicalCatalogRecord({
      collection: name,
      records: Array.isArray(raw) ? raw : [],
      scope: context.actorScope,
      physicalId: text(physicalId),
    });
  }

  function mergeUsers(rawValue, nextValue, scope) {
    if (!Array.isArray(nextValue)) {
      throw new TenantDataBoundaryError('USER_DIRECTORY_SHAPE_INVALID', 'User directory must be an array.', 409);
    }
    const raw = Array.isArray(rawValue) ? rawValue : [];
    const allowed = companyPrincipalIds(scope);
    const currentVisibleIds = raw.map(user => text(user?.id)).filter(id => allowed.has(id));
    if (new Set(currentVisibleIds).size !== currentVisibleIds.length) {
      throw new TenantDataBoundaryError(
        'USER_DIRECTORY_IDENTITY_AMBIGUOUS',
        'The user directory contains more than one record for an active principal.',
        409,
      );
    }
    const currentIds = new Set(raw.map(user => text(user?.id)).filter(id => allowed.has(id)));
    const nextIds = new Set();
    for (const user of nextValue) {
      const id = text(user?.id);
      if (!id || !allowed.has(id) || nextIds.has(id)) {
        throw new TenantDataBoundaryError(
          'USER_MEMBERSHIP_WORKFLOW_REQUIRED',
          'User creation, deletion, or cross-company mutation requires the Membership lifecycle.',
          409,
        );
      }
      nextIds.add(id);
    }
    if (currentIds.size !== nextIds.size || [...currentIds].some(id => !nextIds.has(id))) {
      throw new TenantDataBoundaryError(
        'USER_MEMBERSHIP_WORKFLOW_REQUIRED',
        'User creation, deletion, or cross-company mutation requires the Membership lifecycle.',
        409,
      );
    }
    const nextById = new Map(nextValue.map(user => [text(user?.id), user]));
    return raw.map(user => nextById.get(text(user?.id)) || user);
  }

  function buildStagedReader(entries) {
    const staged = new Map((entries || []).map(entry => [entry.name, entry.value]));
    return name => staged.has(name) ? staged.get(name) : readRawData(name);
  }

  function referenceIds(record, rule) {
    const values = [];
    for (const field of rule.fields || []) {
      const value = record?.[field];
      if (Array.isArray(value)) {
        for (const item of value) {
          const id = text(typeof item === 'object' ? item?.id : item);
          if (id) values.push({ field, id });
        }
      } else {
        const id = text(typeof value === 'object' ? value?.id : value);
        if (id) values.push({ field, id });
      }
    }
    return values;
  }

  function resolveDerivedRecord({
    collection,
    policy,
    record,
    scope,
    read,
    userBelongsToScope,
    memo = new Map(),
  }) {
    const memoKey = `${collection}\u0000${stableRecordId(record)}\u0000${rawFingerprint(record)}`;
    if (memo.has(memoKey)) return memo.get(memoKey);
    let suppliedReferences = 0;
    for (const rule of policy.parentResolver || []) {
      for (const { field, id } of referenceIds(record, rule)) {
        suppliedReferences += 1;
        if (rule.collections.includes('users')) {
          const users = Array.isArray(read('users')) ? read('users') : [];
          const matches = users.filter(user => text(user?.id) === id);
          if (matches.length !== 1 || !userBelongsToScope(id, scope)) {
            const result = { ok: false, code: 'DERIVED_SCOPE_PARENT_UNAVAILABLE', field };
            memo.set(memoKey, result);
            return result;
          }
          continue;
        }

        const matches = [];
        for (const parentCollection of rule.collections || []) {
          const parents = read(parentCollection);
          if (parents !== null && parents !== undefined && !Array.isArray(parents)) {
            const result = { ok: false, code: 'DERIVED_SCOPE_PARENT_UNAVAILABLE', field };
            memo.set(memoKey, result);
            return result;
          }
          const collectionMatches = (Array.isArray(parents) ? parents : [])
            .filter(parent => stableRecordId(parent) === id);
          if (collectionMatches.length > 1) {
            const result = { ok: false, code: 'DERIVED_SCOPE_PARENT_AMBIGUOUS', field };
            memo.set(memoKey, result);
            return result;
          }
          for (const parent of collectionMatches) {
            matches.push({ collection: parentCollection, record: parent });
          }
        }
        if (matches.length === 0) {
          const result = { ok: false, code: 'DERIVED_SCOPE_PARENT_UNAVAILABLE', field };
          memo.set(memoKey, result);
          return result;
        }
        const distinctScopes = new Set(matches.map(({ record: parent }) => (
          `${text(parent?.companyId)}\u0000${text(parent?.tenantId)}`
        )));
        if (distinctScopes.size !== 1) {
          const result = { ok: false, code: 'DERIVED_SCOPE_PARENT_AMBIGUOUS', field };
          memo.set(memoKey, result);
          return result;
        }
        if (matches.some(({ record: parent }) => !scopeMatches(parent, scope))) {
          const result = { ok: false, code: 'DERIVED_SCOPE_PARENT_UNAVAILABLE', field };
          memo.set(memoKey, result);
          return result;
        }
        for (const { collection: parentCollection, record: parent } of matches) {
          const parentPolicy = collectionPolicy(parentCollection);
          if (parentPolicy.category !== COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE) continue;
          const parentResult = resolveDerivedRecord({
            collection: parentCollection,
            policy: parentPolicy,
            record: parent,
            scope,
            read,
            userBelongsToScope,
            memo,
          });
          if (!parentResult.ok) {
            const result = { ok: false, code: 'DERIVED_SCOPE_PARENT_UNAVAILABLE', field };
            memo.set(memoKey, result);
            return result;
          }
        }
      }
    }
    const result = suppliedReferences > 0
      ? { ok: true }
      : { ok: false, code: 'DERIVED_SCOPE_PARENT_REQUIRED', field: null };
    memo.set(memoKey, result);
    return result;
  }

  function throwDerivedResolution(result, collection) {
    if (result.ok) return;
    const messages = {
      DERIVED_SCOPE_PARENT_REQUIRED: 'A stable authoritative parent is required.',
      DERIVED_SCOPE_PARENT_AMBIGUOUS: 'The authoritative parent is ambiguous.',
      DERIVED_SCOPE_PARENT_UNAVAILABLE: 'The authoritative parent is unavailable.',
    };
    throw new TenantDataBoundaryError(
      result.code,
      messages[result.code] || 'The authoritative parent is unavailable.',
      409,
      { collection, ...(result.field ? { field: result.field } : {}) },
    );
  }

  function tenantDerivedResolution(collection, record, scope, read = readRawData, memo = new Map()) {
    const policy = collectionPolicy(collection);
    const allowedUsers = companyPrincipalIds(scope);
    return resolveDerivedRecord({
      collection,
      policy,
      record,
      scope,
      read,
      userBelongsToScope: id => allowedUsers.has(id),
      memo,
    });
  }

  function buildIntegrityState(prepared, originalValues = new Map()) {
    const staged = new Map((prepared || []).map(entry => [entry.name, entry.value]));
    const before = new Map(originalValues);
    const entries = [];
    for (const name of ALL_APP_DATA_COLLECTIONS) {
      const policy = collectionPolicy(name);
      if (
        (
          policy.shape !== COLLECTION_SHAPE.ARRAY
          && !(
            policy.shape === COLLECTION_SHAPE.MAP
            && policy.category === COLLECTION_SCOPE_CATEGORY.TENANT_TECHNICAL
          )
        )
        || policy.category === COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY
      ) continue;
      const raw = before.has(name) ? before.get(name) : readRawData(name);
      before.set(name, raw);
      assertStoredCollectionShape(policy, raw);
      entries.push({
        name,
        value: staged.has(name)
          ? staged.get(name)
          : (policy.shape === COLLECTION_SHAPE.MAP
            ? (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {})
            : (Array.isArray(raw) ? raw : [])),
      });
    }
    return { entries, originalValues: before };
  }

  function integrityScopes(entries, explicitScopes = []) {
    const scopes = new Map();
    for (const scope of explicitScopes || []) {
      const trusted = assertCompleteActorScope(scope);
      scopes.set(trusted.companyId, trusted);
    }
    if (scopes.size > 0) return [...scopes.values()];
    for (const entry of entries || []) {
      const policy = collectionPolicy(entry.name);
      if (
        policy.category === COLLECTION_SCOPE_CATEGORY.SYSTEM
        || policy.category === COLLECTION_SCOPE_CATEGORY.GLOBAL_REFERENCE
        || policy.category === COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY
      ) continue;
      const records = policy.shape === COLLECTION_SHAPE.MAP
        ? Object.values(entry.value || {})
        : (entry.value || []);
      for (const record of records) {
        const companyId = text(record?.companyId);
        const tenantId = text(record?.tenantId);
        if (companyId && companyId === tenantId) scopes.set(companyId, { companyId, tenantId });
      }
    }
    return [...scopes.values()];
  }

  function assertDerivedIntegrity(entries, originalValues, scopes) {
    const read = buildStagedReader(entries);
    const beforeRead = name => originalValues.get(name);
    for (const scope of scopes) {
      for (const entry of entries || []) {
        const policy = getCollectionScopePolicy(entry.name);
        if (policy?.category !== COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE) continue;
        const previousRows = Array.isArray(originalValues.get(entry.name))
          ? originalValues.get(entry.name)
          : [];
        for (const record of (entry.value || []).filter(item => scopeMatches(item, scope))) {
          const currentResolution = tenantDerivedResolution(entry.name, record, scope, read);
          if (currentResolution.ok) continue;
          const id = stableRecordId(record);
          const previous = id
            ? previousRows.find(candidate => stableRecordId(candidate) === id && scopeMatches(candidate, scope))
            : previousRows.find(candidate => rawFingerprint(candidate) === rawFingerprint(record));
          if (previous) {
            const previousResolution = tenantDerivedResolution(entry.name, previous, scope, beforeRead);
            if (!previousResolution.ok && rawFingerprint(previous) === rawFingerprint(record)) continue;
            if (previousResolution.ok) {
              throw new TenantDataBoundaryError(
                'TENANT_PARENT_MUTATION_ORPHANS_CHILD',
                'The mutation would make a previously valid derived record unresolved.',
                409,
                { collection: entry.name },
              );
            }
          }
          throwDerivedResolution(currentResolution, entry.name);
        }
      }
    }
  }

  function platformRecords(policy, value) {
    if (policy.shape === COLLECTION_SHAPE.ARRAY) return value;
    if (policy.shape === COLLECTION_SHAPE.MAP) return Object.values(value);
    const envelope = value?.[TENANT_SINGLETON_ENVELOPE];
    if (!isPlainRecord(envelope)) {
      throw new TenantDataBoundaryError(
        'PLATFORM_TENANT_SCOPE_INVALID',
        'Platform maintenance must preserve the scoped singleton envelope.',
        409,
        { collection: policy.name },
      );
    }
    return Object.values(envelope);
  }

  function exactStoredTenantScope(record) {
    const companyId = text(record?.companyId);
    const tenantId = text(record?.tenantId);
    return Boolean(companyId) && companyId === tenantId;
  }

  function assertPlatformScopedRecords(policy, value) {
    if (policy.shape === COLLECTION_SHAPE.SINGLETON) {
      try {
        assertStoredSingletonEnvelope(policy, value);
      } catch (error) {
        if (error?.code !== 'COLLECTION_STORED_SHAPE_INVALID') throw error;
        throw new TenantDataBoundaryError(
          'PLATFORM_TENANT_SCOPE_INVALID',
          'Platform maintenance cannot persist an invalid tenant-singleton envelope.',
          409,
          { collection: policy.name },
        );
      }
    }
    const records = platformRecords(policy, value);
    if (records.some(record => !isPlainRecord(record) || !exactStoredTenantScope(record))) {
      throw new TenantDataBoundaryError(
        'PLATFORM_TENANT_SCOPE_INVALID',
        'Platform maintenance cannot persist unscoped or partially scoped tenant rows.',
        409,
        { collection: policy.name },
      );
    }
    if (policy.shape === COLLECTION_SHAPE.ARRAY) {
      const ids = records.map(stableRecordId).filter(Boolean);
      if (new Set(ids).size !== ids.length) {
        throw new TenantDataBoundaryError(
          'PLATFORM_RECORD_ID_DUPLICATE',
          'Platform maintenance cannot persist duplicate stable record identifiers.',
          409,
          { collection: policy.name },
        );
      }
    }
  }

  function assertPlatformUserDirectory(value) {
    const ids = [];
    for (const user of value) {
      const id = isPlainRecord(user) ? text(user.id) : '';
      if (!id) {
        throw new TenantDataBoundaryError(
          'PLATFORM_USER_ID_REQUIRED',
          'Platform maintenance cannot persist a user without a stable identifier.',
          409,
          { collection: 'users' },
        );
      }
      ids.push(id);
    }
    if (new Set(ids).size !== ids.length) {
      throw new TenantDataBoundaryError(
        'PLATFORM_RECORD_ID_DUPLICATE',
        'Platform maintenance cannot persist duplicate stable record identifiers.',
        409,
        { collection: 'users' },
      );
    }
  }

  function assertPlatformHistoryRecords(policy, raw, value) {
    const current = Array.isArray(raw) ? raw : [];
    const preservesHistory = value.length >= current.length
      && current.every((record, index) => rawFingerprint(record) === rawFingerprint(value[index]));
    if (!preservesHistory) {
      throw new TenantDataBoundaryError(
        'PLATFORM_HISTORY_IMMUTABLE',
        'Platform maintenance cannot modify, reorder, or delete persisted history.',
        409,
        { collection: policy.name },
      );
    }
    for (const record of value.slice(current.length)) {
      if (exactStoredTenantScope(record)) continue;
      if (record?.auditKind === 'GLOBAL_SYSTEM' && isUnscopedRecord(record)) continue;
      throw new TenantDataBoundaryError(
        'PLATFORM_HISTORY_SCOPE_INVALID',
        'Platform maintenance cannot create unscoped tenant history.',
        409,
        { collection: policy.name },
      );
    }
  }

  function isAuthoritativeRelationshipTarget({ collection, record, actorScope, read }) {
    const policy = collectionPolicy(collection);
    if (policy.category !== COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE) return true;
    return tenantDerivedResolution(collection, record, actorScope, read).ok;
  }

  function hasUserTenantProfileLink(user) {
    return Boolean(
      text(user?.ownerId)
      || text(user?.carrierId)
      || text(user?.assignedCarrierId)
      || text(user?.carrierKey)
    );
  }

  function exactUserMembershipScope(user) {
    const principalId = text(user?.id);
    const memberships = principalId
      ? activeMembershipScopesForPrincipal.all(principalId).map(row => text(row.companyId)).filter(Boolean)
      : [];
    if (memberships.length !== 1) {
      throw new TenantDataBoundaryError(
        'USER_TENANT_PROFILE_SCOPE_REQUIRED',
        'A tenant profile link requires exactly one active company membership.',
        409,
        { collection: 'users' },
      );
    }
    return { companyId: memberships[0], tenantId: memberships[0] };
  }

  function assertUserRelationshipRecord(user, scope, entries, originalValues) {
    const recordsToValidate = new Map((entries || []).map(entry => [
      entry.name,
      entry.name === 'users'
        ? [user]
        : (collectionPolicy(entry.name).shape === COLLECTION_SHAPE.MAP ? {} : []),
    ]));
    if (!recordsToValidate.has('users')) recordsToValidate.set('users', [user]);
    assertRelationships(entries, {
      actorScope: scope,
      readRawData,
      companyPrincipalIds: () => companyPrincipalIds(scope),
      originalValues,
      recordsToValidate,
      isTargetAuthoritative: isAuthoritativeRelationshipTarget,
      unscopedSourceCollections: ['users'],
    });
  }

  function assertReadableUserTenantProfile(user, expectedScope) {
    if (!hasUserTenantProfileLink(user)) return;
    const scope = exactUserMembershipScope(user);
    if (scope.companyId !== expectedScope.companyId || scope.tenantId !== expectedScope.tenantId) {
      throw new TenantDataBoundaryError(
        'USER_TENANT_PROFILE_SCOPE_MISMATCH',
        'The user tenant profile does not belong to the active company.',
        409,
        { collection: 'users' },
      );
    }
    assertUserRelationshipRecord(
      user,
      scope,
      [{ name: 'users', value: [user] }],
      new Map(),
    );
  }

  function assertSystemUserIntegrity(entries, originalValues) {
    const usersEntry = (entries || []).find(entry => entry.name === 'users');
    const users = Array.isArray(usersEntry?.value) ? usersEntry.value : [];
    for (const user of users) {
      if (!hasUserTenantProfileLink(user)) continue;
      const scope = exactUserMembershipScope(user);
      assertUserRelationshipRecord(user, scope, entries, originalValues);
    }
  }

  function assertFullIntegrity(prepared, originalValues, explicitScopes = []) {
    // Audit appends have already passed scope, append-only and concurrency
    // checks in prepareTenantEntries/preparePlatformEntries. They cannot alter
    // business relationships, so unrelated legacy damage must not prevent
    // recording authentication or security events. Mixed batches still receive
    // the complete relationship validation below.
    if (prepared.length > 0 && prepared.every(entry => entry.name === 'audit_logs')) return;

    const state = buildIntegrityState(prepared, originalValues);
    const mixedCatalogState = Object.fromEntries(state.entries
      .filter(entry => (
        collectionPolicy(entry.name).category
          === COLLECTION_SCOPE_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY
      ))
      .map(entry => [entry.name, entry.value]));
    assertValidCatalogFamilyState(mixedCatalogState);
    const scopes = integrityScopes(state.entries, explicitScopes);
    assertDerivedIntegrity(state.entries, state.originalValues, scopes);
    assertSystemUserIntegrity(state.entries, state.originalValues);
    for (const scope of scopes) {
      const recordsToValidate = new Map(state.entries.map(entry => {
        const policy = collectionPolicy(entry.name);
        const records = (
          policy.shape === COLLECTION_SHAPE.ARRAY
          || policy.shape === COLLECTION_SHAPE.MAP
        )
          && policy.category !== COLLECTION_SCOPE_CATEGORY.SYSTEM
          && policy.category !== COLLECTION_SCOPE_CATEGORY.GLOBAL_REFERENCE
          && policy.category !== COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY
          ? entry.value
          : (policy.shape === COLLECTION_SHAPE.MAP ? {} : []);
        return [entry.name, records];
      }));
      assertRelationships(state.entries, {
        actorScope: scope,
        readRawData,
        companyPrincipalIds: () => companyPrincipalIds(scope),
        originalValues: state.originalValues,
        recordsToValidate,
        isTargetAuthoritative: isAuthoritativeRelationshipTarget,
      });
    }
  }

  function prepareTenantEntries(entries, scope, context) {
    const trusted = assertCompleteActorScope(scope);
    const prepared = [];
    const originalValues = new Map();
    for (const entry of entries || []) {
      const name = text(entry?.name);
      const policy = collectionPolicy(name);
      const raw = readRawData(name);
      originalValues.set(name, raw);
      assertStoredCollectionShape(policy, raw);
      assertReadSnapshotCurrent(context, name, raw);
      let value = entry.value;
      if (name === 'users') value = mergeUsers(raw, value, trusted);
      else if (isLegacyIdempotencyCollection(name)) {
        throw new TenantDataBoundaryError(
          'LEGACY_IDEMPOTENCY_STORAGE_IMMUTABLE',
          'Legacy idempotency tombstones are immutable.',
          409,
          { collection: name },
        );
      }
      else if (policy.category === COLLECTION_SCOPE_CATEGORY.SYSTEM) {
        throw new TenantDataBoundaryError('SYSTEM_COLLECTION_POLICY_REQUIRED', 'System data cannot be written through a tenant collection writer.', 403, { collection: name });
      } else if (policy.category === COLLECTION_SCOPE_CATEGORY.GLOBAL_REFERENCE) {
        throw new TenantDataBoundaryError('GLOBAL_REFERENCE_WRITE_REQUIRES_PLATFORM', 'Global reference data requires the platform catalogue lifecycle.', 403, { collection: name });
      } else if (policy.category === COLLECTION_SCOPE_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY) {
        value = replaceTenantCatalogPartition({
          collection: name,
          records: Array.isArray(raw) ? raw : [],
          scope: trusted,
          input: value,
        }).records;
      } else if (
        policy.category === COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY
        && !context.allowedHistoryWrites?.has(name)
      ) {
        throw new TenantDataBoundaryError(
          'HISTORY_REPOSITORY_WRITE_REQUIRED',
          'History can only be written through its dedicated repository.',
          403,
          { collection: name },
        );
      } else if (policy.shape === COLLECTION_SHAPE.ARRAY) {
        const ownsStoredRecord = policy.category === COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE
          ? record => scopeMatches(record, trusted)
            && tenantDerivedResolution(name, record, trusted, readRawData).ok
          : undefined;
        value = mergeTenantArray(name, raw, value, trusted, ownsStoredRecord);
      }
      else if (policy.shape === COLLECTION_SHAPE.MAP) value = mergeTenantMap(name, raw, value, trusted);
      else if (policy.shape === COLLECTION_SHAPE.SINGLETON) value = mergeTenantSingleton(name, raw, value, trusted);
      else throw new TenantDataBoundaryError('TENANT_COLLECTION_SHAPE_INVALID', 'Unsupported collection shape.', 409);
      prepared.push({ name, value, expectedFingerprint: rawFingerprint(raw) });
    }
    assertFullIntegrity(prepared, originalValues, [trusted]);
    return prepared;
  }

  function preparePlatformEntries(entries, context) {
    const prepared = [];
    const originalValues = new Map();
    for (const entry of entries || []) {
      const name = text(entry?.name);
      const policy = collectionPolicy(name);
      if (!context.allowedWrites.has(name)) {
        throw new TenantDataBoundaryError('PLATFORM_COLLECTION_WRITE_NOT_ALLOWLISTED', 'This platform operation is not authorized to write the collection.', 403, { collection: name, reason: context.reason });
      }
      const raw = readRawData(name);
      let value = entry.value;
      originalValues.set(name, raw);
      assertStoredCollectionShape(policy, raw);
      assertNextCollectionShape(policy, value);
      assertReadSnapshotCurrent(context, name, raw);
      if (isLegacyIdempotencyCollection(name)) {
        if (rawFingerprint(value) !== rawFingerprint(raw)) {
          throw new TenantDataBoundaryError(
            'LEGACY_IDEMPOTENCY_STORAGE_IMMUTABLE',
            'Legacy idempotency tombstones are immutable.',
            409,
            { collection: name },
          );
        }
      } else if (name === 'users') {
        assertPlatformUserDirectory(value);
      } else if (policy.category === COLLECTION_SCOPE_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY) {
        value = replacePlatformCatalogDefaults({
          collection: name,
          records: Array.isArray(raw) ? raw : [],
          input: value,
          authority: TRUSTED_PLATFORM_CATALOG_AUTHORITY,
        }).records;
      } else if (
        policy.category === COLLECTION_SCOPE_CATEGORY.TENANT
        || policy.category === COLLECTION_SCOPE_CATEGORY.TENANT_TECHNICAL
        || policy.category === COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE
      ) {
        assertPlatformScopedRecords(policy, value);
      } else if (policy.category === COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY) {
        assertPlatformHistoryRecords(policy, raw, value);
      }
      if (policy.category === COLLECTION_SCOPE_CATEGORY.GLOBAL_REFERENCE) {
        if (!Array.isArray(value) || value.some(record => !isUnscopedRecord(record))) {
          throw new TenantDataBoundaryError('GLOBAL_REFERENCE_SCOPE_INVALID', 'Global reference rows must remain unscoped.', 409, { collection: name });
        }
      }
      prepared.push({
        name,
        value,
        expectedFingerprint: rawFingerprint(raw),
      });
    }
    assertFullIntegrity(prepared, originalValues);
    return prepared;
  }

  function appendMutationJournal(prepared, context) {
    const changedCollections = [...new Set((prepared || [])
      .map(entry => text(entry?.name))
      .filter(name => name && name !== 'audit_logs' && name !== 'audit_log'))]
      .sort();
    if (changedCollections.length === 0) return prepared;

    const existingEntry = prepared.find(entry => entry.name === 'audit_logs');
    const rawAudit = existingEntry ? null : readRawData('audit_logs');
    if (!existingEntry) assertReadSnapshotCurrent(context, 'audit_logs', rawAudit);
    const auditValue = existingEntry ? existingEntry.value : rawAudit;
    if (auditValue !== null && auditValue !== undefined && !Array.isArray(auditValue)) {
      throw new TenantDataBoundaryError(
        'AUDIT_HISTORY_SHAPE_INVALID',
        'Audit history is malformed; the mutation was not persisted.',
        409,
      );
    }
    const currentAudit = Array.isArray(auditValue) ? auditValue : [];
    const tenantScope = context.kind === 'tenant_actor'
      ? assertCompleteActorScope(context.actorScope)
      : null;
    const reason = tenantScope
      ? (context.repositoryReason || 'tenant-data-boundary')
      : context.reason;
    const journalEntry = {
      id: generateMutationAuditId(),
      userId: tenantScope?.principalId || null,
      membershipId: tenantScope?.membershipId || null,
      ...(tenantScope ? {
        companyId: tenantScope.companyId,
        tenantId: tenantScope.tenantId,
      } : {}),
      auditKind: tenantScope ? 'TENANT' : 'GLOBAL_SYSTEM',
      action: 'app_data.mutation',
      entityType: 'app_data',
      entityId: null,
      description: `Atomic app_data mutation: ${changedCollections.join(', ')}`,
      before: null,
      after: null,
      metadata: {
        reason,
        collections: changedCollections,
        mutationCount: changedCollections.length,
      },
      createdAt: nowIso(),
    };
    const nextAudit = [...currentAudit, journalEntry];
    if (existingEntry) {
      existingEntry.value = nextAudit;
    } else {
      prepared.push({
        name: 'audit_logs',
        value: nextAudit,
        expectedFingerprint: rawFingerprint(rawAudit),
      });
    }
    return prepared;
  }

  function persistPrepared(prepared, context) {
    if (prepared.length > 1) {
      const result = writeRawDataBatch(prepared);
      for (const entry of prepared) rememberPersisted(context, entry.name, entry.value);
      return result;
    }
    let result;
    for (const entry of prepared) {
      result = writeRawData(entry.name, entry.value, {
        expectedFingerprint: entry.expectedFingerprint,
      });
      rememberPersisted(context, entry.name, entry.value);
    }
    return result;
  }

  function assertUniqueBatchCollections(entries) {
    const seen = new Set();
    for (const entry of entries || []) {
      const name = text(entry?.name);
      if (seen.has(name)) {
        throw new TenantDataBoundaryError(
          'DUPLICATE_COLLECTION_BATCH_ENTRY',
          'Each collection may appear at most once in an atomic data batch.',
          409,
          { collection: name },
        );
      }
      seen.add(name);
    }
  }

  function prepareDataBatch(entries, context) {
    assertUniqueBatchCollections(entries);
    const prepared = context.kind === 'platform_system'
      ? preparePlatformEntries(entries, context)
      : prepareTenantEntries(entries, context.actorScope, context);
    return appendMutationJournal(prepared, context);
  }

  // Parent/child validation and the app_data compare-and-swap must share the
  // same SQLite write lock. Otherwise an untouched authoritative parent or a
  // newly inserted child could change after validation but before commit.
  const executeAtomicBoundaryWrite = db.transaction((entries, context) => (
    persistPrepared(prepareDataBatch(entries, context), context)
  ));

  function tenantCatalogLifecycleContext(collection) {
    const name = text(collection);
    const policy = collectionPolicy(name);
    const context = activeTenantContext();
    if (!context || context.kind !== 'tenant_actor') {
      throw new ActorScopeError(
        'ACTOR_SCOPE_INCOMPLETE',
        'Trusted company/tenant scope is required for tenant catalogue lifecycle operations.',
        403,
      );
    }
    if (policy.category !== COLLECTION_SCOPE_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY) {
      throw new TenantDataBoundaryError(
        'TENANT_CATALOG_LIFECYCLE_COLLECTION_UNSUPPORTED',
        'The collection does not use the platform-default/tenant-overlay lifecycle.',
        403,
        { collection: name },
      );
    }
    return { name, policy, context };
  }

  const executeAtomicTenantCatalogLifecycle = db.transaction(({
    name,
    policy,
    context,
    mutate,
    resultLogicalId,
  }) => {
    const rawValue = readRawData(name);
    assertStoredCollectionShape(policy, rawValue);
    const raw = Array.isArray(rawValue) ? rawValue : [];
    assertValidCatalogState({ collection: name, records: raw });
    assertReadSnapshotCurrent(context, name, rawValue);
    rememberRead(context, name, rawValue);
    const outcome = mutate({
      collection: name,
      records: raw,
      scope: context.actorScope,
    });
    const prepared = [{
      name,
      value: outcome.records,
      expectedFingerprint: rawFingerprint(rawValue),
    }];
    assertFullIntegrity(prepared, new Map([[name, rawValue]]), [context.actorScope]);
    appendMutationJournal(prepared, context);
    persistPrepared(prepared, context);
    const logicalId = typeof resultLogicalId === 'function'
      ? resultLogicalId(outcome)
      : resultLogicalId;
    return logicalId === null
      ? null
      : readEffectiveCatalogRecord({
        collection: name,
        records: outcome.records,
        scope: context.actorScope,
        id: logicalId,
      });
  });

  function runTenantCatalogLifecycle(collection, mutate, resultLogicalId) {
    const lifecycle = tenantCatalogLifecycleContext(collection);
    return executeAtomicTenantCatalogLifecycle.immediate({
      ...lifecycle,
      mutate,
      resultLogicalId,
    });
  }

  function createTenantCatalogEntry(collection, input) {
    return runTenantCatalogLifecycle(
      collection,
      options => createPhysicalTenantCatalogEntry({
        ...options,
        input,
        generateId: generateCatalogRecordId,
      }),
      outcome => outcome.record.id,
    );
  }

  function updateEffectiveTenantCatalogRecord(collection, logicalId, patch) {
    return runTenantCatalogLifecycle(
      collection,
      options => updateLogicalTenantCatalogRecord({
        ...options,
        logicalId,
        patch,
        generateId: generateCatalogRecordId,
      }),
      logicalId,
    );
  }

  function deleteEffectiveTenantCatalogRecord(collection, logicalId) {
    return runTenantCatalogLifecycle(
      collection,
      options => deleteLogicalTenantCatalogRecord({ ...options, logicalId }),
      logicalId,
    );
  }

  function archiveEffectiveTenantCatalogRecord(collection, logicalId, { archivedAt } = {}) {
    return runTenantCatalogLifecycle(
      collection,
      options => {
        const effective = readEffectiveCatalogRecord({
          ...options,
          id: logicalId,
        });
        if (!effective) {
          throw new PlatformDefaultTenantOverlayError(
            'CATALOG_LOGICAL_RECORD_NOT_FOUND',
            'No tenant-visible catalog record has this logical ID.',
            404,
            { collection: options.collection },
          );
        }
        if (effective.catalogOrigin?.kind === CATALOG_ORIGIN_KINDS.PLATFORM_DEFAULT) {
          throw new PlatformDefaultTenantOverlayError(
            'CATALOG_PLATFORM_DEFAULT_MUTATION_DENIED',
            'Archiving a logical platform default is forbidden.',
            403,
            { collection: options.collection },
          );
        }
        if (effective.catalogOrigin?.kind === CATALOG_ORIGIN_KINDS.TENANT_OVERRIDE) {
          return revertPhysicalTenantCatalogOverride({
            ...options,
            platformDefaultId: logicalId,
            mode: 'archive',
            archivedAt,
          });
        }
        return archivePhysicalTenantCatalogRecord({
          ...options,
          physicalId: logicalId,
          archivedAt,
        });
      },
      logicalId,
    );
  }

  function revertTenantCatalogOverride(
    collection,
    platformDefaultId,
    { mode = 'delete', archivedAt } = {},
  ) {
    return runTenantCatalogLifecycle(
      collection,
      options => revertPhysicalTenantCatalogOverride({
        ...options,
        platformDefaultId,
        mode,
        archivedAt,
      }),
      platformDefaultId,
    );
  }

  function writeData(collection, value) {
    const context = activeTenantContext();
    if (!context || !['tenant_actor', 'platform_system'].includes(context.kind)) {
      throw new ActorScopeError('ACTOR_SCOPE_INCOMPLETE', 'Trusted company/tenant or platform scope is required.', 403);
    }
    const entries = [{ name: collection, value }];
    return executeAtomicBoundaryWrite.immediate(entries, context);
  }

  function preflightDataBatch(entries) {
    const context = activeTenantContext();
    if (!context || !['tenant_actor', 'platform_system'].includes(context.kind)) {
      throw new ActorScopeError('ACTOR_SCOPE_INCOMPLETE', 'Trusted company/tenant or platform scope is required.', 403);
    }
    const prepared = prepareDataBatch(entries, context);
    return Object.freeze({
      ok: true,
      collections: Object.freeze(prepared.map(entry => entry.name)),
    });
  }

  function writeDataBatch(entries) {
    const context = activeTenantContext();
    if (!context || !['tenant_actor', 'platform_system'].includes(context.kind)) {
      throw new ActorScopeError('ACTOR_SCOPE_INCOMPLETE', 'Trusted company/tenant or platform scope is required.', 403);
    }
    return executeAtomicBoundaryWrite.immediate(entries, context);
  }

  function createBoundPublicTenantSingletonReader({
    collection,
    resolveTenantScope,
    project,
  } = {}) {
    if (activeTenantContext()) {
      throw new TenantDataBoundaryError(
        'PUBLIC_TENANT_CAPABILITY_CREATION_DENIED',
        'A public tenant read capability cannot be created inside an active data-access context.',
        403,
      );
    }
    const name = text(collection);
    const policy = collectionPolicy(name);
    if (!isTenantOwnedCollection(name) || policy.shape !== COLLECTION_SHAPE.SINGLETON) {
      throw new TenantDataBoundaryError(
        'PUBLIC_TENANT_SINGLETON_POLICY_REQUIRED',
        'A public tenant reader must be bound to one tenant-owned singleton collection.',
        403,
        { collection: name },
      );
    }
    if (typeof resolveTenantScope !== 'function' || typeof project !== 'function') {
      throw new TypeError('A public tenant reader requires fixed tenant resolution and projection functions.');
    }
    const allowedReads = new Set([name]);
    return Object.freeze(function readBoundPublicTenantSingleton(siteIdentity) {
      if (activeTenantContext()) {
        throw new TenantDataBoundaryError(
          'PUBLIC_TENANT_SCOPE_ELEVATION_DENIED',
          'An active data-access context cannot be replaced by public tenant scope.',
          403,
        );
      }
      const resolved = resolveTenantScope(siteIdentity);
      const companyId = text(resolved?.companyId);
      const tenantId = text(resolved?.tenantId);
      if (!companyId || companyId !== tenantId) {
        throw new TenantDataBoundaryError(
          'PUBLIC_SITE_IDENTITY_UNRESOLVED',
          'The public site identity does not resolve to one exact tenant.',
          404,
        );
      }
      const tenantScope = Object.freeze({ companyId, tenantId });
      return tenantContext.run(createContext('tenant_public_read', {
        tenantScope,
        allowedReads,
      }), () => project(readData(name)));
    });
  }

  return Object.freeze({
    archiveEffectiveTenantCatalogRecord,
    companyPrincipalIds,
    createBoundPublicTenantSingletonReader,
    createTenantCatalogEntry,
    deleteEffectiveTenantCatalogRecord,
    preflightDataBatch,
    readData,
    readTenantPhysicalData,
    revertTenantCatalogOverride,
    updateEffectiveTenantCatalogRecord,
    writeData,
    writeDataBatch,
  });
}

module.exports = {
  DERIVED_SCOPE_COLLECTIONS,
  GLOBAL_REFERENCE_COLLECTIONS,
  LEGACY_HISTORY_COLLECTIONS,
  PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS,
  SYSTEM_GLOBAL_COLLECTIONS,
  TENANT_OWNED_ARRAY_COLLECTIONS,
  TENANT_OWNED_MAP_COLLECTIONS,
  TENANT_OWNED_SINGLETON_COLLECTIONS,
  TenantDataBoundaryError,
  createTenantDataBoundary,
  createBoundPlatformSystemScopeRunner,
  currentTenantContext,
  isGlobalReferenceCollection,
  isTenantOwnedCollection,
  runWithDeniedTenantScope,
  runWithPlatformSystemScope,
  runWithTenantActorScope,
  runWithTenantHistoryRepositoryScope,
};
