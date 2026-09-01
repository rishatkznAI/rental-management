const crypto = require('crypto');
const {
  ALL_APP_DATA_COLLECTIONS,
  COLLECTION_SCOPE_CATEGORY,
  COLLECTION_SCOPE_REGISTRY,
  COLLECTION_SHAPE,
  PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS,
  collectionsForCategory,
} = require('./app-data-scope-registry');
const {
  assertValidCatalogFamilyState,
} = require('./platform-default-tenant-overlay');
const {
  IDENTITY_COUNT_TABLES,
  TARGET_COLLECTIONS,
  collectionFingerprint,
  databaseIdentity,
  recordContentFingerprint,
  recordFingerprint,
  stableJson,
} = require('./production-scope-remediation');
const {
  databaseContentFingerprint,
  sqliteFileSetFingerprint,
  sqliteObservedFileSetFingerprint,
} = require('./production-scope-remediation-runner');
const {
  buildUsersDirectorySnapshot,
  getSchemaFingerprint,
  planPlatformIdentityBootstrap,
} = require('./platform-identity-bootstrap-validation');
const {
  getProjectedSmokeIdentityUsers,
  planProductionSmokeIdentityTransition,
} = require('./production-smoke-identity');
const {
  PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
  PRODUCTION_BASELINE_CONTRACT,
  currentRepositorySourceBindingsFingerprint,
} = require('./production-scope-evidence-builder');
const {
  stableJsonSha256: baselineStableJsonSha256,
} = require('./production-scope-baseline-contract');
const {
  classificationAuthoritySnapshot,
} = require('./production-scope-evidence-classification');

const MANIFEST_VERSION = 2;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SHA40_PATTERN = /^[a-f0-9]{40}$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SQLITE_DURABLE_FILE_NAMES = Object.freeze(['app.sqlite', 'app.sqlite-wal']);
const SQLITE_OBSERVED_FILE_NAMES = Object.freeze([...SQLITE_DURABLE_FILE_NAMES, 'app.sqlite-shm']);
const SCOPE_UPDATE = 'UPDATE_SCOPE';
const VERIFY_SCOPE = 'VERIFY_SCOPE';
const PLATFORM_DEFAULT_TENANT_OVERLAY_SET = new Set(
  PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS,
);
const LEGACY_IDEMPOTENCY_COLLECTIONS = new Set([
  'inline_relation_idempotency',
  'rental_create_idempotency',
]);
const AUDIT_HISTORY_COLLECTIONS = new Set(
  collectionsForCategory(COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY),
);
const AUDIT_ENTITY_PARENT_COLLECTIONS = Object.freeze({
  clients: Object.freeze(['clients']),
  client_objects: Object.freeze(['client_objects']),
  documents: Object.freeze(['documents']),
  counterparty: Object.freeze(['counterparties']),
  counterparties: Object.freeze(['counterparties']),
  equipment: Object.freeze(['equipment']),
  rentals: Object.freeze(['rentals', 'gantt_rentals']),
  service: Object.freeze(['service']),
});

class ProductionScopeManifestError extends Error {
  constructor(code, message, blockers = []) {
    super(message);
    this.name = 'ProductionScopeManifestError';
    this.code = code;
    this.blockers = blockers;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function scopeOf(record) {
  return {
    companyId: text(record?.companyId) || null,
    tenantId: text(record?.tenantId) || null,
  };
}

function scopeState(scope) {
  if (!scope.companyId && !scope.tenantId) return 'UNSCOPED';
  if (!scope.companyId || !scope.tenantId) return 'PARTIAL_SCOPE';
  if (scope.companyId !== scope.tenantId) return 'SCOPE_MISMATCH';
  return 'FULLY_SCOPED';
}

function manifestHash(manifest) {
  const value = structuredClone(manifest);
  delete value.manifestSha256;
  return sha256(stableJson(value));
}

function readAppData(db) {
  const rows = db.prepare('SELECT name, json, updated_at FROM app_data ORDER BY name').all();
  const collections = new Map();
  for (const row of rows) {
    let value;
    try {
      value = JSON.parse(row.json);
    } catch {
      throw new ProductionScopeManifestError(
        'COLLECTION_JSON_INVALID',
        `Collection JSON is invalid: ${row.name}.`,
      );
    }
    collections.set(row.name, { ...row, value });
  }
  return collections;
}

function singletonEntries(value) {
  if (value === null || value === undefined) return [];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const envelope = value.__tenantScopedValues;
    if (envelope && typeof envelope === 'object' && !Array.isArray(envelope)) {
      return Object.entries(envelope).map(([key, record]) => ({ key, record }));
    }
    if (Object.keys(value).length === 0) return [];
  }
  return [{ key: 'singleton', record: value }];
}

function recordsForPolicy(policy, value) {
  if (policy.shape === COLLECTION_SHAPE.ARRAY) {
    if (!Array.isArray(value)) return null;
    return value.map((record, index) => ({ key: String(index), record }));
  }
  if (policy.shape === COLLECTION_SHAPE.MAP) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return Object.entries(value).map(([key, record]) => ({ key, record }));
  }
  return singletonEntries(value);
}

function exactRecordId(collection, policy, key, record) {
  const direct = text(record?.id || record?._id);
  if (direct) return direct;
  if (policy.shape === COLLECTION_SHAPE.MAP) return text(key);
  if (policy.shape === COLLECTION_SHAPE.SINGLETON) return `${collection}:${text(key) || 'singleton'}`;
  return `${collection}:anonymous:${recordFingerprint(record).slice(0, 16)}`;
}

function inventoryIndex(classificationInventory, blockers) {
  const index = new Map();
  for (const row of Array.isArray(classificationInventory) ? classificationInventory : []) {
    const collection = text(row?.collection);
    const recordId = text(row?.recordId);
    const key = `${collection}:${recordId}`;
    if (!collection || !recordId || index.has(key)) {
      blockers.push({ code: 'CLASSIFICATION_INVENTORY_KEY_INVALID', collection, recordId });
      continue;
    }
    index.set(key, row);
  }
  return index;
}

function dispositionAllowed({ collection, policy, inventory }) {
  const disposition = text(inventory?.disposition);
  const baselineCategory = text(inventory?.category);
  const baselineShape = text(inventory?.shape);
  if (baselineShape && baselineShape !== policy.shape) return false;
  const categoryMatches = !baselineCategory || baselineCategory === policy.category;
  if (disposition === 'TENANT_OWNERSHIP_CANDIDATE') {
    return categoryMatches && [
      COLLECTION_SCOPE_CATEGORY.TENANT,
      COLLECTION_SCOPE_CATEGORY.TENANT_TECHNICAL,
      COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE,
    ].includes(policy.category);
  }
  if (disposition === 'PLATFORM_DEFAULT_REFERENCE') {
    return PLATFORM_DEFAULT_TENANT_OVERLAY_SET.has(collection)
      && policy.category === COLLECTION_SCOPE_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY
      && categoryMatches;
  }
  if (
    disposition === 'TENANT_OWNED_CATALOG_ENTRY'
    || disposition === 'TENANT_CATALOG_OVERRIDE'
  ) {
    return PLATFORM_DEFAULT_TENANT_OVERLAY_SET.has(collection)
      && policy.category === COLLECTION_SCOPE_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY
      && categoryMatches;
  }
  if (/^AUDIT_[ABCD]_/.test(disposition)) {
    return AUDIT_HISTORY_COLLECTIONS.has(collection)
      && policy.category === COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY
      && categoryMatches;
  }
  if (disposition === 'LEGACY_IDEMPOTENCY_TOMBSTONE') {
    return LEGACY_IDEMPOTENCY_COLLECTIONS.has(collection)
      && policy.category === COLLECTION_SCOPE_CATEGORY.TENANT_TECHNICAL
      && categoryMatches;
  }
  if (disposition === 'FIXTURE_DEMO_TEST') {
    return categoryMatches && ![
      COLLECTION_SCOPE_CATEGORY.SYSTEM,
      COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY,
    ].includes(policy.category);
  }
  if (disposition === 'SYSTEM_RECORD') {
    return policy.category === COLLECTION_SCOPE_CATEGORY.SYSTEM && categoryMatches;
  }
  return false;
}

function storedMixedCatalogDisposition(record) {
  const companyId = text(record?.companyId);
  const tenantId = text(record?.tenantId);
  const linkPresent = Object.prototype.hasOwnProperty.call(record || {}, 'platformDefaultId');
  if (!companyId && !tenantId && !linkPresent) return 'PLATFORM_DEFAULT_REFERENCE';
  if (companyId && tenantId && companyId === tenantId) {
    return linkPresent ? 'TENANT_CATALOG_OVERRIDE' : 'TENANT_OWNED_CATALOG_ENTRY';
  }
  return null;
}

function classifyOperation({ collection, policy, inventory, scope, authority }) {
  const canonical = scope.companyId === authority.companyId
    && scope.tenantId === authority.tenantId;
  if (inventory.disposition === 'TENANT_OWNERSHIP_CANDIDATE') {
    return {
      operation: canonical ? VERIFY_SCOPE : SCOPE_UPDATE,
      classification: inventory.baselineClassification || 'TENANT_BUSINESS_DATA',
      derivationRule: inventory.ownershipRule,
      reason: 'Exact source record is approved as canonical Skytech tenant data.',
    };
  }
  if (
    PLATFORM_DEFAULT_TENANT_OVERLAY_SET.has(collection)
    && policy.category === COLLECTION_SCOPE_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY
    && inventory.disposition === 'PLATFORM_DEFAULT_REFERENCE'
  ) {
    return {
      operation: 'PRESERVE_PLATFORM_DEFAULT',
      classification: 'PLATFORM_DEFAULT_REFERENCE',
      derivationRule: inventory.ownershipRule,
      reason: 'The proven unscoped reference row remains an immutable platform default.',
    };
  }
  if (
    PLATFORM_DEFAULT_TENANT_OVERLAY_SET.has(collection)
    && policy.category === COLLECTION_SCOPE_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY
    && inventory.disposition === 'TENANT_OWNED_CATALOG_ENTRY'
  ) {
    return {
      operation: 'PRESERVE_EXACT_TENANT_ENTRY',
      classification: 'TENANT_OWNED_REFERENCE_DATA',
      derivationRule: inventory.ownershipRule,
      reason: 'The existing exact-tenant standalone entry remains byte-preserved and unlinked.',
    };
  }
  if (
    PLATFORM_DEFAULT_TENANT_OVERLAY_SET.has(collection)
    && policy.category === COLLECTION_SCOPE_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY
    && inventory.disposition === 'TENANT_CATALOG_OVERRIDE'
  ) {
    return {
      operation: 'PRESERVE_EXACT_TENANT_OVERRIDE',
      classification: 'TENANT_OVERRIDE_REFERENCE_DATA',
      derivationRule: inventory.ownershipRule,
      reason: 'The explicit same-family tenant override remains byte-preserved.',
    };
  }
  if (inventory.disposition === 'AUDIT_A_ENTITY_DERIVED') {
    return {
      operation: canonical ? VERIFY_SCOPE : SCOPE_UPDATE,
      classification: 'TENANT_AUDIT_ENTITY_DERIVED',
      derivationRule: null,
      reason: 'Historical tenant ownership is proven by an exact retained entity ID.',
    };
  }
  if (inventory.disposition === 'AUDIT_C_GLOBAL_SYSTEM') {
    return {
      operation: 'PRESERVE_GLOBAL_SYSTEM_HISTORY',
      classification: 'GLOBAL_SYSTEM_AUDIT',
      derivationRule: inventory.ownershipRule,
      reason: 'Platform-wide historical event remains unscoped under the explicit global audit policy.',
    };
  }
  if (
    inventory.disposition === 'AUDIT_B_ACTOR_DERIVED_ONLY'
    || inventory.disposition === 'AUDIT_D_INSUFFICIENT_OR_FIXTURE'
  ) {
    return {
      operation: 'PRESERVE_LEGACY_UNSCOPED',
      classification: 'LEGACY_UNSCOPED_AUDIT',
      derivationRule: inventory.ownershipRule,
      reason: 'Historical tenant ownership is not provable; content remains quarantined and unmodified.',
    };
  }
  if (inventory.disposition === 'LEGACY_IDEMPOTENCY_TOMBSTONE') {
    return {
      operation: 'PRESERVE_LEGACY_REPLAY_TOMBSTONE',
      classification: 'LEGACY_IDEMPOTENCY_TOMBSTONE',
      derivationRule: inventory.ownershipRule,
      reason: 'Immutable replay protection remains byte-preserved under compatibility lookup.',
    };
  }
  if (inventory.disposition === 'FIXTURE_DEMO_TEST') {
    return {
      operation: 'PRESERVE_FIXTURE_UNSCOPED',
      classification: 'SMOKE_TEST_FIXTURE',
      derivationRule: inventory.ownershipRule,
      reason: 'Explicit fixture evidence forbids promotion into the production tenant.',
    };
  }
  if (inventory.disposition === 'SYSTEM_RECORD') {
    return {
      operation: 'PRESERVE_SYSTEM_POLICY',
      classification: 'SYSTEM_RECORD',
      derivationRule: inventory.ownershipRule,
      reason: 'System state remains governed by its dedicated repository.',
    };
  }
  return {
    operation: 'UNRESOLVED',
    classification: inventory.disposition || 'UNRESOLVED',
    derivationRule: inventory.ownershipRule || null,
    reason: 'No approved deterministic ownership operation exists.',
  };
}

function normalizedSourceFileSet(value, blockers) {
  const rows = Array.isArray(value) ? value.map(row => ({
    name: text(row?.name),
    size: Number(row?.size),
    sha256: text(row?.sha256).toLowerCase(),
  })) : [];
  const expectedNames = SQLITE_OBSERVED_FILE_NAMES;
  if (
    rows.length !== expectedNames.length
    || stableJson(rows.map(row => row.name)) !== stableJson(expectedNames)
    || rows.some(row => !Number.isSafeInteger(row.size) || row.size < 0 || !SHA256_PATTERN.test(row.sha256))
  ) {
    blockers.push({ code: 'SOURCE_FILE_SET_INVALID' });
  }
  return rows;
}

function runnerSourceFileSet(sourceFileSet) {
  const byName = new Map(sourceFileSet.map(row => [row.name, row]));
  const entry = name => {
    const row = byName.get(name);
    return row ? { name: row.name, sizeBytes: row.size, sha256: row.sha256 } : null;
  };
  return {
    database: entry('app.sqlite'),
    wal: entry('app.sqlite-wal'),
    shm: entry('app.sqlite-shm'),
  };
}

function normalizedRailwayIdentity(value) {
  return {
    projectId: text(value?.projectId),
    environmentId: text(value?.environmentId),
    serviceId: text(value?.serviceId),
    volumeId: text(value?.volumeId),
    volumeName: text(value?.volumeName),
    volumeMountPath: text(value?.volumeMountPath),
  };
}

function normalizedDeploymentIdentity(value) {
  return {
    serviceInstanceId: text(value?.serviceInstanceId),
    deploymentInstanceId: text(value?.deploymentInstanceId),
  };
}

function validRailwayIdentity(value) {
  return ['projectId', 'environmentId', 'serviceId', 'volumeId'].every(field => UUID_PATTERN.test(value[field]))
    && Boolean(value.volumeName)
    && pathIsExactProductionVolume(value.volumeMountPath);
}

function pathIsExactProductionVolume(value) {
  return value === '/data';
}

function validDeploymentIdentity(value) {
  return UUID_PATTERN.test(value.serviceInstanceId) && UUID_PATTERN.test(value.deploymentInstanceId);
}

function sourceCollectionFingerprints(db) {
  return Object.fromEntries(db.prepare('SELECT name, json FROM app_data ORDER BY name').all().map(row => [
    row.name,
    sha256(row.json),
  ]));
}

function calculateSourceSnapshotHash({
  captureDeployedSha,
  captureDeploymentId,
  railwayIdentity,
  deploymentIdentity,
  sourceFileSet,
  collectionFingerprints,
}) {
  return sha256(stableJson({
    captureDeployedSha: text(captureDeployedSha).toLowerCase(),
    captureDeploymentId: text(captureDeploymentId),
    railwayIdentity: normalizedRailwayIdentity(railwayIdentity),
    deploymentIdentity: normalizedDeploymentIdentity(deploymentIdentity),
    // The DB and WAL are durable SQLite state. SHM is a transient WAL index and
    // is retained separately as forensic evidence, but cannot invalidate an
    // otherwise identical production snapshot merely because SQLite rebuilt it.
    durableSourceFileSet: (() => {
      const normalized = runnerSourceFileSet(sourceFileSet);
      return { database: normalized.database, wal: normalized.wal };
    })(),
    collectionFingerprints,
  }));
}

function validateSource(source, db, blockers) {
  const actualIdentity = databaseIdentity(db);
  const actualDatabaseFingerprint = databaseContentFingerprint(db);
  const sourceFileSet = normalizedSourceFileSet(source?.sourceFileSet, blockers);
  const normalizedFileSet = runnerSourceFileSet(sourceFileSet);
  const computedFileSetHash = sqliteFileSetFingerprint(normalizedFileSet);
  const computedObservedFileSetHash = sqliteObservedFileSetFingerprint(normalizedFileSet);
  const railwayIdentity = normalizedRailwayIdentity(source?.railwayIdentity);
  const deploymentIdentity = normalizedDeploymentIdentity(source?.deploymentIdentity);
  const collectionFingerprints = sourceCollectionFingerprints(db);
  const computedSnapshotHash = calculateSourceSnapshotHash({
    captureDeployedSha: source?.captureDeployedSha,
    captureDeploymentId: source?.captureDeploymentId,
    railwayIdentity,
    deploymentIdentity,
    sourceFileSet,
    collectionFingerprints,
  });
  if (!SHA40_PATTERN.test(text(source?.captureDeployedSha).toLowerCase())) {
    blockers.push({ code: 'SOURCE_CAPTURE_DEPLOYED_SHA_INVALID' });
  }
  if (!UUID_PATTERN.test(text(source?.captureDeploymentId))) {
    blockers.push({ code: 'SOURCE_CAPTURE_DEPLOYMENT_ID_INVALID' });
  }
  if (!validRailwayIdentity(railwayIdentity)) {
    blockers.push({ code: 'SOURCE_RAILWAY_IDENTITY_INVALID' });
  }
  if (!validDeploymentIdentity(deploymentIdentity)) {
    blockers.push({ code: 'SOURCE_DEPLOYMENT_IDENTITY_INVALID' });
  }
  for (const field of [
    'sourceSnapshotHash',
    'sourceFileSetHash',
    'sourceObservedFileSetHash',
    'databaseContentFingerprint',
    'schemaFingerprint',
  ]) {
    if (!SHA256_PATTERN.test(text(source?.[field]).toLowerCase())) {
      blockers.push({ code: 'SOURCE_HASH_INVALID', field });
    }
  }
  if (source?.databaseContentFingerprint !== actualDatabaseFingerprint) {
    blockers.push({ code: 'SOURCE_DATABASE_FINGERPRINT_MISMATCH' });
  }
  if (source?.schemaFingerprint !== actualIdentity.schemaFingerprint) {
    blockers.push({ code: 'SOURCE_SCHEMA_FINGERPRINT_MISMATCH' });
  }
  if (source?.sourceFileSetHash !== computedFileSetHash) {
    blockers.push({ code: 'SOURCE_FILE_SET_HASH_MISMATCH' });
  }
  if (source?.sourceObservedFileSetHash !== computedObservedFileSetHash) {
    blockers.push({ code: 'SOURCE_OBSERVED_FILE_SET_HASH_MISMATCH' });
  }
  if (source?.sourceSnapshotHash !== computedSnapshotHash) {
    blockers.push({ code: 'SOURCE_SNAPSHOT_HASH_MISMATCH' });
  }
  return {
    actualDatabaseFingerprint,
    actualIdentity,
    deploymentIdentity,
    railwayIdentity,
    sourceFileSet,
    sourceFileSetHash: computedFileSetHash,
    sourceObservedFileSetHash: computedObservedFileSetHash,
    sourceSnapshotHash: computedSnapshotHash,
  };
}

function validateAuditParent(record, tenantRecordsById, authority, blockers, manifestRecord) {
  const entityId = text(record?.entityId);
  const entityType = text(record?.entityType).toLowerCase();
  const allowedCollections = AUDIT_ENTITY_PARENT_COLLECTIONS[entityType] || [];
  const parents = entityId ? (tenantRecordsById.get(entityId) || []).filter(parent => (
    allowedCollections.includes(parent.collection)
    && parent._policyCategory !== COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY
    && parent._policyCategory !== COLLECTION_SCOPE_CATEGORY.SYSTEM
    && !(parent.collection === manifestRecord.collection && parent.recordId === manifestRecord.recordId)
  )) : [];
  if (allowedCollections.length === 0) {
    blockers.push({
      code: 'AUDIT_PARENT_ENTITY_TYPE_UNSUPPORTED',
      collection: manifestRecord.collection,
      recordId: manifestRecord.recordId,
      entityType: entityType || null,
    });
    return;
  }
  if (parents.length !== 1) {
    blockers.push({
      code: 'AUDIT_PARENT_NOT_EXACT',
      collection: manifestRecord.collection,
      recordId: manifestRecord.recordId,
      parentId: entityId || null,
      entityType,
      allowedCollections,
      matchCount: parents.length,
    });
    return;
  }
  const parent = parents[0];
  if (parent.newScope.companyId !== authority.companyId || parent.newScope.tenantId !== authority.tenantId) {
    blockers.push({
      code: 'AUDIT_PARENT_SCOPE_INVALID',
      collection: manifestRecord.collection,
      recordId: manifestRecord.recordId,
    });
    return;
  }
  manifestRecord.derivationRule = `AUTHORITATIVE_PARENT_ID:${parent.collection}:${parent.recordId}`;
  manifestRecord.parent = {
    collection: parent.collection,
    recordId: parent.recordId,
    sourceRecordHash: parent.sourceRecordHash,
    canonicalContentHash: parent.canonicalContentHash,
  };
}

function normalizedReconciliationEntry(row) {
  return {
    collection: text(row?.collection),
    recordId: text(row?.recordId),
    sourceRecordHash: text(row?.sourceRecordHash || row?.canonicalRecordHash).toLowerCase(),
    approvalClass: text(row?.approvalClass),
  };
}

function reconciliationForManifestRecords(records) {
  return records.filter(row => row.operation === SCOPE_UPDATE || row.operation === VERIFY_SCOPE)
    .map(row => ({
      collection: row.collection,
      recordId: row.recordId,
      sourceRecordHash: row.sourceRecordHash,
      approvalClass: row.classification === 'TENANT_AUDIT_ENTITY_DERIVED'
        ? 'AUDIT_ENTITY_DERIVED'
        : 'BASELINE_OWNERSHIP',
    }))
    .sort((left, right) => (
      left.collection.localeCompare(right.collection) || left.recordId.localeCompare(right.recordId)
    ));
}

function validateEvidenceBinding(evidence, classificationInventory, approvedReconciliation, blockers) {
  const requiredHashes = [
    'artifactIndexSha256',
    'baselineContractSha256',
    'candidateAuthoritySha256',
    'candidateKeySetSha256',
    'canonicalScopeSha256',
    'classificationAuthorityFingerprint',
    'packFingerprint',
    'summaryFileSha256',
    'classificationFileSha256',
    'userDispositionsFileSha256',
    'ownershipCandidatesFileSha256',
  ];
  for (const field of requiredHashes) {
    if (!SHA256_PATTERN.test(text(evidence?.[field]).toLowerCase())) {
      blockers.push({ code: 'EVIDENCE_HASH_BINDING_REQUIRED', field });
    }
  }
  const currentBaselineContractSha256 = baselineStableJsonSha256(PRODUCTION_BASELINE_CONTRACT);
  const currentClassificationAuthorityFingerprint = sha256(stableJson(classificationAuthoritySnapshot()));
  if (
    text(evidence?.baselineContractSha256).toLowerCase() !== currentBaselineContractSha256
    || text(evidence?.candidateKeySetSha256).toLowerCase() !== PRODUCTION_BASELINE_CONTRACT.candidateKeySetSha256
    || text(evidence?.candidateAuthoritySha256).toLowerCase() !== PRODUCTION_BASELINE_CONTRACT.candidateAuthoritySha256
    || text(evidence?.canonicalScopeSha256).toLowerCase() !== PRODUCTION_BASELINE_CONTRACT.canonicalScopeSha256
  ) {
    blockers.push({ code: 'EVIDENCE_BASELINE_CONTRACT_OBSOLETE' });
  }
  if (
    text(evidence?.classificationAuthorityFingerprint).toLowerCase()
    !== currentClassificationAuthorityFingerprint
  ) {
    blockers.push({ code: 'EVIDENCE_CLASSIFICATION_AUTHORITY_OBSOLETE' });
  }
  const evidenceSourceBindingsFingerprint = text(evidence?.sourceBindingsFingerprint).toLowerCase();
  if (!SHA256_PATTERN.test(evidenceSourceBindingsFingerprint)) {
    blockers.push({ code: 'EVIDENCE_SOURCE_BINDINGS_FINGERPRINT_REQUIRED' });
  } else {
    let currentSourceBindingsFingerprint;
    try {
      currentSourceBindingsFingerprint = currentRepositorySourceBindingsFingerprint();
    } catch (error) {
      blockers.push({
        code: 'CURRENT_SOURCE_BINDINGS_UNAVAILABLE',
        sourceCode: text(error?.code) || null,
      });
    }
    if (
      currentSourceBindingsFingerprint
      && evidenceSourceBindingsFingerprint !== currentSourceBindingsFingerprint
    ) {
      blockers.push({ code: 'EVIDENCE_SOURCE_BINDINGS_OBSOLETE' });
    }
  }
  if (
    stableJson(evidence?.platformDefaultTenantOverlaySemantics)
    !== stableJson(PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT)
  ) {
    blockers.push({ code: 'EVIDENCE_OVERLAY_SEMANTICS_CONTRACT_OBSOLETE' });
  }
  const classificationFingerprint = sha256(stableJson(classificationInventory));
  const normalizedReconciliation = (Array.isArray(approvedReconciliation) ? approvedReconciliation : [])
    .map(normalizedReconciliationEntry)
    .sort((left, right) => (
      left.collection.localeCompare(right.collection) || left.recordId.localeCompare(right.recordId)
    ));
  const reconciliationFingerprint = sha256(stableJson(normalizedReconciliation));
  if (evidence?.classificationFingerprint !== classificationFingerprint) {
    blockers.push({ code: 'CLASSIFICATION_FINGERPRINT_MISMATCH' });
  }
  if (evidence?.approvedReconciliationFingerprint !== reconciliationFingerprint) {
    blockers.push({ code: 'APPROVED_RECONCILIATION_FINGERPRINT_MISMATCH' });
  }
  const reconciliationKeys = new Set();
  for (const row of normalizedReconciliation) {
    const key = `${row.collection}:${row.recordId}`;
    if (
      !row.collection
      || !row.recordId
      || !SHA256_PATTERN.test(row.sourceRecordHash)
      || !['BASELINE_OWNERSHIP', 'AUDIT_ENTITY_DERIVED'].includes(row.approvalClass)
      || reconciliationKeys.has(key)
    ) {
      blockers.push({ code: 'APPROVED_RECONCILIATION_INVALID', record: key });
    }
    reconciliationKeys.add(key);
  }
  return { classificationFingerprint, normalizedReconciliation, reconciliationFingerprint };
}

function buildProductionScopeManifest({
  db,
  source,
  authority,
  classificationInventory,
  approvedReconciliation,
  evidence,
  identity,
}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new ProductionScopeManifestError('DATABASE_REQUIRED', 'A better-sqlite3 database is required.');
  }
  const blockers = [];
  if (!text(authority?.companyId) || authority.companyId !== authority?.tenantId) {
    blockers.push({ code: 'CANONICAL_SCOPE_INVALID' });
  }
  if (
    !identity
    || !SHA256_PATTERN.test(text(identity.bootstrapConfigHash))
    || !SHA256_PATTERN.test(text(identity.userDispositionFingerprint))
    || !SHA256_PATTERN.test(text(identity.reviewedPlanFileSha256))
    || !identity.bootstrapConfig
    || typeof identity.bootstrapConfig !== 'object'
    || identity.bootstrapConfigHash !== sha256(stableJson(identity.bootstrapConfig))
    || !Array.isArray(identity.userDispositions)
    || identity.userDispositionFingerprint !== sha256(stableJson(identity.userDispositions))
  ) {
    blockers.push({ code: 'MANIFEST_IDENTITY_BINDING_REQUIRED' });
  }
  if (identity?.smokeIdentity !== undefined && (
    identity.smokeIdentity?.status !== 'APPROVED'
    || !text(identity.smokeIdentity?.sourcePrincipalId)
    || !text(identity.smokeIdentity?.replacementPrincipalId)
    || !SHA256_PATTERN.test(text(identity.smokeIdentity?.transitionConfigHash))
    || !SHA256_PATTERN.test(text(identity.smokeIdentity?.transitionChecksum))
    || !SHA256_PATTERN.test(text(identity.smokeIdentity?.projectedUsersFingerprint))
    || !identity.smokeIdentity?.transition
    || typeof identity.smokeIdentity.transition !== 'object'
    || identity.smokeIdentity.transitionConfigHash !== sha256(stableJson(identity.smokeIdentity.transition))
    || !Number.isSafeInteger(identity.smokeIdentity?.projectedUserCount)
    || identity.smokeIdentity.projectedUserCount <= 0
  )) {
    blockers.push({ code: 'MANIFEST_SMOKE_IDENTITY_BINDING_INVALID' });
  }
  const evidenceValidation = validateEvidenceBinding(
    evidence,
    classificationInventory,
    approvedReconciliation,
    blockers,
  );
  const sourceValidation = validateSource(source || {}, db, blockers);
  const appData = readAppData(db);
  const unknownCollections = [...appData.keys()].filter(name => !COLLECTION_SCOPE_REGISTRY[name]);
  unknownCollections.forEach(collection => blockers.push({
    code: 'UNKNOWN_PHYSICAL_COLLECTION',
    collection,
  }));
  const mixedCatalogState = Object.fromEntries(
    PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS
      .filter(collection => appData.has(collection))
      .map(collection => [collection, appData.get(collection).value]),
  );
  try {
    assertValidCatalogFamilyState(mixedCatalogState);
  } catch (error) {
    blockers.push({
      code: 'PLATFORM_DEFAULT_TENANT_OVERLAY_STATE_INVALID',
      catalogCode: text(error?.code) || 'CATALOG_STATE_INVALID',
      details: error?.details && typeof error.details === 'object'
        ? structuredClone(error.details)
        : undefined,
    });
  }
  const classifications = inventoryIndex(classificationInventory, blockers);
  const seenClassifications = new Set();
  const materialized = [];
  const globalReferenceCollections = ALL_APP_DATA_COLLECTIONS.filter(name => (
    COLLECTION_SCOPE_REGISTRY[name].category === COLLECTION_SCOPE_CATEGORY.GLOBAL_REFERENCE
  ));
  if (globalReferenceCollections.length !== 0) {
    blockers.push({
      code: 'GLOBAL_REFERENCE_POLICY_REMAINS',
      collections: globalReferenceCollections,
    });
  }

  for (const collection of ALL_APP_DATA_COLLECTIONS) {
    const policy = COLLECTION_SCOPE_REGISTRY[collection];
    if (policy.category === COLLECTION_SCOPE_CATEGORY.SYSTEM) continue;
    const sourceCollection = appData.get(collection);
    if (!sourceCollection) continue;
    const entries = recordsForPolicy(policy, sourceCollection.value);
    if (!entries) {
      blockers.push({ code: 'COLLECTION_SHAPE_MISMATCH', collection, shape: policy.shape });
      continue;
    }
    for (const { key, record } of entries) {
      const recordId = exactRecordId(collection, policy, key, record);
      const inventoryKey = `${collection}:${recordId}`;
      const inventory = classifications.get(inventoryKey);
      if (!inventory) {
        blockers.push({ code: 'CLASSIFICATION_MISSING', collection, recordId });
        continue;
      }
      seenClassifications.add(inventoryKey);
      if (policy.category === COLLECTION_SCOPE_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY) {
        const expectedDisposition = storedMixedCatalogDisposition(record);
        if (!expectedDisposition || inventory.disposition !== expectedDisposition) {
          blockers.push({
            code: 'MIXED_CATALOG_CLASSIFICATION_MISMATCH',
            collection,
            recordId,
            expectedDisposition,
            actualDisposition: text(inventory.disposition) || null,
          });
          continue;
        }
      }
      if (!dispositionAllowed({ collection, policy, inventory })) {
        blockers.push({
          code: 'CLASSIFICATION_POLICY_REJECTED',
          collection,
          recordId,
          disposition: text(inventory.disposition) || null,
          category: policy.category,
        });
        continue;
      }
      const sourceRecordHash = recordFingerprint(record);
      if (inventory.canonicalRecordHash !== sourceRecordHash) {
        blockers.push({ code: 'CLASSIFICATION_SOURCE_HASH_MISMATCH', collection, recordId });
        continue;
      }
      const oldScope = scopeOf(record);
      const disposition = classifyOperation({ collection, policy, inventory, scope: oldScope, authority });
      const isScopeOperation = disposition.operation === SCOPE_UPDATE || disposition.operation === VERIFY_SCOPE;
      if (isScopeOperation && policy.shape !== COLLECTION_SHAPE.ARRAY) {
        blockers.push({ code: 'MIGRATION_SHAPE_UNSUPPORTED', collection, recordId, shape: policy.shape });
      }
      if (isScopeOperation && recordId.includes(':anonymous:')) {
        blockers.push({ code: 'MIGRATION_STABLE_ID_REQUIRED', collection, recordId });
      }
      if (isScopeOperation && !(
        (!oldScope.companyId && !oldScope.tenantId)
        || (oldScope.companyId === authority.companyId && oldScope.tenantId === authority.tenantId)
      )) {
        blockers.push({
          code: 'MIGRATION_SCOPE_CONFLICT',
          collection,
          recordId,
          scopeState: scopeState(oldScope),
        });
      }
      const preservesPlatformDefault = disposition.operation === 'PRESERVE_PLATFORM_DEFAULT';
      const preservesTenantCatalogRow = disposition.operation === 'PRESERVE_EXACT_TENANT_ENTRY'
        || disposition.operation === 'PRESERVE_EXACT_TENANT_OVERRIDE';
      if (preservesPlatformDefault && (oldScope.companyId || oldScope.tenantId)) {
        blockers.push({
          code: 'PLATFORM_DEFAULT_SCOPE_CONFLICT',
          collection,
          recordId,
          scopeState: scopeState(oldScope),
        });
      }
      if (preservesTenantCatalogRow && (
        !oldScope.companyId
        || !oldScope.tenantId
        || oldScope.companyId !== oldScope.tenantId
      )) {
        blockers.push({
          code: 'TENANT_CATALOG_SCOPE_CONFLICT',
          collection,
          recordId,
          scopeState: scopeState(oldScope),
        });
      }
      if (
        !isScopeOperation
        && !preservesPlatformDefault
        && !preservesTenantCatalogRow
        && (oldScope.companyId || oldScope.tenantId)
      ) {
        blockers.push({
          code: 'PRESERVED_RECORD_SCOPE_CONFLICT',
          collection,
          recordId,
          scopeState: scopeState(oldScope),
        });
      }
      materialized.push({
        collection,
        recordId,
        locator: { shape: policy.shape, key },
        sourceRecordHash,
        canonicalContentHash: recordContentFingerprint(record),
        oldScope,
        newScope: isScopeOperation
          ? { companyId: authority.companyId, tenantId: authority.tenantId }
          : oldScope,
        classification: disposition.classification,
        operation: disposition.operation,
        derivationRule: disposition.derivationRule,
        reason: disposition.reason,
        _policyCategory: policy.category,
        _record: record,
      });
    }
  }

  for (const inventoryKey of classifications.keys()) {
    if (!seenClassifications.has(inventoryKey)) {
      blockers.push({ code: 'CLASSIFICATION_RECORD_MISSING', record: inventoryKey });
    }
  }
  const tenantRecordsById = new Map();
  for (const row of materialized.filter(item => (
    item.operation === SCOPE_UPDATE || item.operation === VERIFY_SCOPE
  ))) {
    const list = tenantRecordsById.get(row.recordId) || [];
    list.push(row);
    tenantRecordsById.set(row.recordId, list);
  }
  for (const row of materialized.filter(item => item.classification === 'TENANT_AUDIT_ENTITY_DERIVED')) {
    validateAuditParent(row._record, tenantRecordsById, authority, blockers, row);
  }
  materialized.forEach(row => {
    delete row._record;
    delete row._policyCategory;
  });
  materialized.sort((left, right) => (
    left.collection.localeCompare(right.collection) || left.recordId.localeCompare(right.recordId)
  ));
  const materializedKeys = new Set();
  for (const row of materialized) {
    const key = `${row.collection}:${row.recordId}`;
    if (materializedKeys.has(key)) {
      blockers.push({ code: 'MANIFEST_RECORD_ID_DUPLICATE', collection: row.collection, recordId: row.recordId });
    }
    materializedKeys.add(key);
  }
  const actualReconciliation = reconciliationForManifestRecords(materialized);
  if (stableJson(actualReconciliation) !== stableJson(evidenceValidation.normalizedReconciliation)) {
    blockers.push({
      code: 'APPROVED_RECONCILIATION_MISMATCH',
      expectedCount: evidenceValidation.normalizedReconciliation.length,
      actualCount: actualReconciliation.length,
    });
  }
  const operationCounts = {};
  const collectionWriteCounts = {};
  for (const row of materialized) {
    operationCounts[row.operation] = (operationCounts[row.operation] || 0) + 1;
    if (row.operation === SCOPE_UPDATE) {
      collectionWriteCounts[row.collection] = (collectionWriteCounts[row.collection] || 0) + 1;
    }
  }
  if (materialized.some(row => row.operation === 'UNRESOLVED')) {
    blockers.push({ code: 'UNRESOLVED_RECORDS_REMAIN' });
  }
  const collectionFingerprints = Object.fromEntries([...appData.entries()].map(([name, row]) => [
    name,
    collectionFingerprint(row.value),
  ]));
  const manifest = {
    manifestVersion: MANIFEST_VERSION,
    status: blockers.length === 0 ? 'READY_FOR_DISPOSABLE_SIMULATION' : 'BLOCKED',
    productionExecutionAuthorized: false,
    platformDefaultTenantOverlaySemantics: structuredClone(
      evidence?.platformDefaultTenantOverlaySemantics ?? null,
    ),
    source: {
      captureDeployedSha: text(source?.captureDeployedSha).toLowerCase(),
      captureDeploymentId: text(source?.captureDeploymentId),
      railwayIdentity: sourceValidation.railwayIdentity,
      deploymentIdentity: sourceValidation.deploymentIdentity,
      sourceSnapshotHash: sourceValidation.sourceSnapshotHash,
      sourceFileSetHash: sourceValidation.sourceFileSetHash,
      sourceObservedFileSetHash: sourceValidation.sourceObservedFileSetHash,
      sourceFileSet: sourceValidation.sourceFileSet,
      databaseContentFingerprint: sourceValidation.actualDatabaseFingerprint,
      schemaFingerprint: sourceValidation.actualIdentity.schemaFingerprint,
      databaseIdentity: sourceValidation.actualIdentity,
      appDataCanonicalFingerprint: sha256(stableJson(collectionFingerprints)),
    },
    canonicalScope: {
      companyId: text(authority?.companyId),
      tenantId: text(authority?.tenantId),
    },
    registry: {
      entryCount: ALL_APP_DATA_COLLECTIONS.length,
      globalReferenceCollectionCount: globalReferenceCollections.length,
      platformDefaultTenantOverlayCollectionCount:
        PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS.length,
      registryFingerprint: sha256(stableJson(COLLECTION_SCOPE_REGISTRY)),
    },
    evidence: {
      artifactIndexSha256: text(evidence?.artifactIndexSha256).toLowerCase(),
      baselineContractSha256: text(evidence?.baselineContractSha256).toLowerCase(),
      candidateKeySetSha256: text(evidence?.candidateKeySetSha256).toLowerCase(),
      candidateAuthoritySha256: text(evidence?.candidateAuthoritySha256).toLowerCase(),
      canonicalScopeSha256: text(evidence?.canonicalScopeSha256).toLowerCase(),
      classificationAuthorityFingerprint: text(evidence?.classificationAuthorityFingerprint).toLowerCase(),
      packFingerprint: text(evidence?.packFingerprint).toLowerCase(),
      summaryFileSha256: text(evidence?.summaryFileSha256).toLowerCase(),
      classificationFileSha256: text(evidence?.classificationFileSha256).toLowerCase(),
      classificationFingerprint: evidenceValidation.classificationFingerprint,
      userDispositionsFileSha256: text(evidence?.userDispositionsFileSha256).toLowerCase(),
      ownershipCandidatesFileSha256: text(evidence?.ownershipCandidatesFileSha256).toLowerCase(),
      approvedReconciliationFingerprint: evidenceValidation.reconciliationFingerprint,
      approvedReconciliationCount: evidenceValidation.normalizedReconciliation.length,
      sourceBindingsFingerprint: text(evidence?.sourceBindingsFingerprint).toLowerCase(),
      platformDefaultTenantOverlaySemantics: structuredClone(
        evidence?.platformDefaultTenantOverlaySemantics ?? null,
      ),
    },
    identity: identity ? structuredClone(identity) : null,
    summary: {
      classifiedRecordCount: materialized.length,
      operationCounts: Object.fromEntries(Object.entries(operationCounts).sort()),
      collectionWriteCounts: Object.fromEntries(Object.entries(collectionWriteCounts).sort()),
      semanticScopeWriteCount: operationCounts[SCOPE_UPDATE] || 0,
      unresolvedRecordCount: materialized.filter(row => row.operation === 'UNRESOLVED').length,
    },
    records: materialized,
    blockers,
  };
  // Hash and return the exact JSON value that can cross the review/CI boundary.
  // In-memory `undefined` values (especially inside arrays) otherwise serialize
  // differently and make a valid-looking artifact unverifiable after a read.
  const serializableManifest = JSON.parse(JSON.stringify(manifest));
  serializableManifest.manifestSha256 = manifestHash(serializableManifest);
  return serializableManifest;
}

function projectedCollections(db, manifest, targetCollections) {
  const writes = new Map(manifest.records.filter(row => row.operation === SCOPE_UPDATE).map(row => [
    `${row.collection}:${row.recordId}`,
    row,
  ]));
  const result = {};
  for (const collection of targetCollections) {
    const row = db.prepare('SELECT json FROM app_data WHERE name = ?').get(collection);
    if (!row) throw new ProductionScopeManifestError('COLLECTION_MISSING', `Collection is missing: ${collection}.`);
    const value = JSON.parse(row.json);
    if (!Array.isArray(value)) {
      throw new ProductionScopeManifestError('COLLECTION_SHAPE_MISMATCH', `Collection is not an array: ${collection}.`);
    }
    const projected = structuredClone(value);
    for (const record of projected) {
      const id = text(record?.id || record?._id);
      const update = writes.get(`${collection}:${id}`);
      if (!update) continue;
      record.companyId = update.newScope.companyId;
      record.tenantId = update.newScope.tenantId;
    }
    result[collection] = { before: value, after: projected };
  }
  return result;
}

function executionMapping(row) {
  if (row.operation === SCOPE_UPDATE || row.operation === VERIFY_SCOPE) {
    return {
      collection: row.collection,
      id: row.recordId,
      action: 'UPDATE_SCOPE',
      expectedBefore: row.oldScope,
      companyId: row.newScope.companyId,
      tenantId: row.newScope.tenantId,
      sourceRecordHash: row.sourceRecordHash,
      canonicalContentHash: row.canonicalContentHash,
      classification: row.classification,
      derivationRule: row.derivationRule,
      reason: row.reason,
      ...(row.parent ? { parent: structuredClone(row.parent) } : {}),
    };
  }
  return {
    collection: row.collection,
    id: row.recordId,
    action: 'LEAVE_UNSCOPED',
    expectedBefore: row.oldScope,
    sourceRecordHash: row.sourceRecordHash,
    canonicalContentHash: row.canonicalContentHash,
    classification: row.classification,
    derivationRule: row.derivationRule,
    reason: row.reason,
    ...(row.parent ? { parent: structuredClone(row.parent) } : {}),
  };
}

function buildExecutionPlanFromManifest({
  db,
  manifest,
  identityBootstrap,
  smokeIdentityTransition,
  userDispositions,
  reviewedPlanFileSha256,
  backup,
  canonicalCompanyIdStrategy,
  sourceDbPath,
}) {
  if (manifest?.manifestVersion !== MANIFEST_VERSION || manifestHash(manifest) !== manifest.manifestSha256) {
    throw new ProductionScopeManifestError('MANIFEST_HASH_MISMATCH', 'The exact scope manifest is invalid.');
  }
  let currentSourceBindingsFingerprint;
  try {
    currentSourceBindingsFingerprint = currentRepositorySourceBindingsFingerprint();
  } catch (error) {
    throw new ProductionScopeManifestError(
      'CURRENT_SOURCE_BINDINGS_UNAVAILABLE',
      `The current repository source binding cannot be verified: ${text(error?.code) || 'UNKNOWN'}.`,
    );
  }
  if (
    manifest.evidence?.sourceBindingsFingerprint !== currentSourceBindingsFingerprint
    || manifest.evidence?.baselineContractSha256
      !== baselineStableJsonSha256(PRODUCTION_BASELINE_CONTRACT)
    || manifest.evidence?.candidateKeySetSha256
      !== PRODUCTION_BASELINE_CONTRACT.candidateKeySetSha256
    || manifest.evidence?.candidateAuthoritySha256
      !== PRODUCTION_BASELINE_CONTRACT.candidateAuthoritySha256
    || manifest.evidence?.canonicalScopeSha256
      !== PRODUCTION_BASELINE_CONTRACT.canonicalScopeSha256
    || manifest.evidence?.classificationAuthorityFingerprint
      !== sha256(stableJson(classificationAuthoritySnapshot()))
    || stableJson(manifest.platformDefaultTenantOverlaySemantics)
      !== stableJson(PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT)
    || stableJson(manifest.evidence?.platformDefaultTenantOverlaySemantics)
      !== stableJson(PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT)
  ) {
    throw new ProductionScopeManifestError(
      'MANIFEST_SOURCE_BINDINGS_OBSOLETE',
      'The manifest predates or differs from the current source and overlay semantics contract.',
    );
  }
  if (manifest.status !== 'READY_FOR_DISPOSABLE_SIMULATION' || manifest.blockers.length !== 0) {
    throw new ProductionScopeManifestError('MANIFEST_BLOCKED', 'The scope manifest has blockers.', manifest.blockers);
  }
  if (databaseContentFingerprint(db) !== manifest.source.databaseContentFingerprint) {
    throw new ProductionScopeManifestError('MANIFEST_SOURCE_DRIFT', 'The SQLite source differs from the manifest.');
  }
  if (
    manifest.identity?.bootstrapConfigHash !== sha256(stableJson(identityBootstrap))
    || manifest.identity?.userDispositionFingerprint !== sha256(stableJson(userDispositions))
    || manifest.identity?.reviewedPlanFileSha256 !== text(reviewedPlanFileSha256).toLowerCase()
  ) {
    throw new ProductionScopeManifestError(
      'MANIFEST_IDENTITY_BINDING_MISMATCH',
      'Identity inputs differ from the exact manifest binding.',
    );
  }
  const usersRow = db.prepare("SELECT json FROM app_data WHERE name = 'users'").get();
  let users;
  try {
    users = JSON.parse(usersRow?.json);
  } catch {
    throw new ProductionScopeManifestError('USERS_DIRECTORY_INVALID', 'The source user directory is invalid.');
  }
  if (!Array.isArray(users)) {
    throw new ProductionScopeManifestError('USERS_DIRECTORY_INVALID', 'The source user directory is not an array.');
  }
  const smokeBinding = manifest.identity?.smokeIdentity || null;
  const smokeEnabled = smokeIdentityTransition !== undefined && smokeIdentityTransition !== null;
  if (Boolean(smokeBinding) !== smokeEnabled) {
    throw new ProductionScopeManifestError(
      'MANIFEST_SMOKE_IDENTITY_BINDING_MISMATCH',
      'The approved smoke identity transition is missing or unexpected.',
    );
  }
  let effectiveUsers = users;
  if (smokeEnabled) {
    const smokePreview = planProductionSmokeIdentityTransition({
      users,
      config: smokeIdentityTransition,
      usersRawFingerprint: sha256(usersRow.json),
    });
    if (!smokePreview.readyToApply) {
      throw new ProductionScopeManifestError(
        'SMOKE_IDENTITY_TRANSITION_BLOCKED',
        'The approved smoke identity transition cannot be projected from this source.',
        smokePreview.blockers,
      );
    }
    effectiveUsers = getProjectedSmokeIdentityUsers(smokePreview);
    if (
      smokeBinding.status !== 'APPROVED'
      || stableJson(smokeBinding.transition) !== stableJson(smokeIdentityTransition)
      || smokeBinding.transitionConfigHash !== sha256(stableJson(smokeIdentityTransition))
      || smokeBinding.transitionChecksum !== smokePreview.transitionChecksum
      || smokeBinding.projectedUsersFingerprint !== collectionFingerprint(effectiveUsers)
      || smokeBinding.projectedUserCount !== effectiveUsers.length
      || smokeBinding.sourcePrincipalId !== text(smokeIdentityTransition.sourcePrincipalId)
      || smokeBinding.replacementPrincipalId !== text(smokeIdentityTransition.replacement?.id)
    ) {
      throw new ProductionScopeManifestError(
        'MANIFEST_SMOKE_IDENTITY_BINDING_MISMATCH',
        'The smoke identity source, projection, or transition checksum differs from the manifest.',
      );
    }
  }
  const identityPlan = planPlatformIdentityBootstrap(db, identityBootstrap, {
    usersDirectorySnapshot: buildUsersDirectorySnapshot(effectiveUsers),
  });
  if (!identityPlan.ok) {
    throw new ProductionScopeManifestError(
      'IDENTITY_BOOTSTRAP_BLOCKED',
      'The identity bootstrap plan has blockers.',
      identityPlan.blockers,
    );
  }
  const changedCollections = new Set(manifest.records.filter(row => (
    row.operation === SCOPE_UPDATE || row.operation === VERIFY_SCOPE
  )).map(row => row.collection));
  const targetCollections = [...new Set([...TARGET_COLLECTIONS, ...changedCollections])].sort();
  const projections = projectedCollections(db, manifest, targetCollections);
  const dispositionRows = Array.isArray(userDispositions) ? userDispositions : [];
  const dispositions = new Map();
  for (const row of dispositionRows) {
    const principalId = text(row?.principalId);
    if (!principalId || dispositions.has(principalId)) {
      throw new ProductionScopeManifestError(
        'USER_DISPOSITION_KEY_INVALID',
        'User dispositions must contain one exact row per projected principal.',
      );
    }
    dispositions.set(principalId, row);
  }
  const memberships = new Map(identityPlan.normalized.memberships.map(row => [row.principalId, row]));
  const actorMappings = [];
  for (const user of effectiveUsers) {
    const userId = text(user?.id);
    const disposition = dispositions.get(userId);
    if (!disposition) {
      throw new ProductionScopeManifestError('USER_DISPOSITION_MISSING', `Missing user disposition: ${userId}.`);
    }
    if (disposition.canonicalRecordHash !== recordFingerprint(user)) {
      throw new ProductionScopeManifestError('USER_DISPOSITION_HASH_MISMATCH', `User disposition drift: ${userId}.`);
    }
    const membership = memberships.get(userId);
    if (disposition.membership === 'YES' && membership) {
      const claimedBranchIds = Array.isArray(disposition.branchIds)
        ? [...new Set(disposition.branchIds.map(text))].filter(Boolean).sort()
        : null;
      const membershipBranchIds = [...membership.branchIds].sort();
      if (
        text(disposition.companyId) !== manifest.canonicalScope.companyId
        || text(disposition.tenantId) !== manifest.canonicalScope.tenantId
        || text(disposition.roleTemplateKey) !== membership.roleTemplateKey
        || Number(disposition.roleTemplateVersion) !== membership.roleTemplateVersion
        || disposition.companyWideBranchAuthority !== membership.companyWideBranchAuthority
        || stableJson(claimedBranchIds) !== stableJson(membershipBranchIds)
      ) {
        throw new ProductionScopeManifestError(
          'USER_MEMBERSHIP_DISPOSITION_SCOPE_MISMATCH',
          `User membership disposition differs from the exact bootstrap scope: ${userId}.`,
        );
      }
      actorMappings.push({
        userId,
        action: 'CREATE_MEMBERSHIP',
        membershipId: membership.id,
        companyId: manifest.canonicalScope.companyId,
        tenantId: manifest.canonicalScope.tenantId,
      });
    } else if (disposition.membership === 'NO' && !membership) {
      actorMappings.push({
        userId,
        action: 'NO_MEMBERSHIP',
        candidateForProductionMembership: false,
        classification: disposition.classification,
      });
    } else {
      throw new ProductionScopeManifestError('USER_MEMBERSHIP_DISPOSITION_CONFLICT', `User mapping conflict: ${userId}.`);
    }
  }
  if (actorMappings.length !== dispositions.size || actorMappings.length !== effectiveUsers.length) {
    throw new ProductionScopeManifestError('USER_DISPOSITION_COVERAGE_MISMATCH', 'User disposition coverage is not exact.');
  }
  const mappedRecords = manifest.records.filter(row => changedCollections.has(row.collection));
  const expectedIdentityCounts = Object.fromEntries(IDENTITY_COUNT_TABLES.map(table => [
    table,
    [...new Set([identityPlan.beforeCounts[table], identityPlan.afterCounts[table]])],
  ]));
  return {
    planVersion: 1,
    manifestVersion: MANIFEST_VERSION,
    productionExecutionAuthorized: false,
    sourceBindingsFingerprint: manifest.evidence.sourceBindingsFingerprint,
    platformDefaultTenantOverlaySemantics: structuredClone(
      manifest.platformDefaultTenantOverlaySemantics,
    ),
    planId: `production-scope-remediation-${manifest.manifestSha256.slice(0, 16)}`,
    scopeManifestSha256: manifest.manifestSha256,
    sourceDbPath: sourceDbPath || undefined,
    expected: {
      dbIdentity: databaseIdentity(db),
      identityCounts: expectedIdentityCounts,
      collectionCounts: {
        ...Object.fromEntries(targetCollections.map(name => [name, projections[name].before.length])),
        users: [...new Set([users.length, effectiveUsers.length])],
      },
      collectionFingerprints: {
        ...Object.fromEntries(targetCollections.map(name => [name, [...new Set([
          collectionFingerprint(projections[name].before),
          collectionFingerprint(projections[name].after),
        ])]])),
        users: [...new Set([
          collectionFingerprint(users),
          collectionFingerprint(effectiveUsers),
        ])],
      },
    },
    authority: {
      status: 'APPROVED',
      companyId: manifest.canonicalScope.companyId,
      tenantId: manifest.canonicalScope.tenantId,
      headOffice: identityPlan.normalized.branches.find(branch => branch.isHeadOffice) || null,
      identityBootstrap,
    },
    actorMappings,
    ...(smokeEnabled ? { smokeIdentityTransition: structuredClone(smokeIdentityTransition) } : {}),
    recordMappings: mappedRecords.map(executionMapping),
    relationMappings: [],
    backup,
    canonicalCompanyIdStrategy,
  };
}

module.exports = {
  MANIFEST_VERSION,
  ProductionScopeManifestError,
  buildExecutionPlanFromManifest,
  buildProductionScopeManifest,
  calculateSourceSnapshotHash,
  manifestHash,
};
