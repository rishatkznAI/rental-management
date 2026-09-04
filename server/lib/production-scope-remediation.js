const crypto = require('crypto');
const {
  prepareSqliteReadonlyStatement,
} = require('./sqlite-readonly-statement');
const { deriveCanonicalCompanyId } = require('./canonical-company-id');
const {
  COLLECTION_SCOPE_CATEGORY,
  getCollectionScopePolicy,
} = require('./app-data-scope-registry');
const {
  buildUsersDirectorySnapshot,
  calculateBootstrapChecksum,
  getSchemaFingerprint,
  planPlatformIdentityBootstrap,
} = require('./platform-identity-bootstrap-validation');
const {
  runPlatformIdentityBootstrap,
} = require('./platform-identity-bootstrap');
const {
  APPROVAL_REFERENCE: IDENTITY_ONLY_APPROVAL_REFERENCE,
  AUTHORITY: IDENTITY_ONLY_AUTHORITY,
  COMPANY_ID: IDENTITY_ONLY_COMPANY_ID,
  OWNER_MEMBERSHIP_ID: IDENTITY_ONLY_OWNER_MEMBERSHIP_ID,
  OWNER_PRINCIPAL_ID: IDENTITY_ONLY_OWNER_PRINCIPAL_ID,
  WRITE_MANIFEST: IDENTITY_ONLY_WRITE_MANIFEST,
} = require('./identity-bootstrap-execution-bundle');
const {
  applyProductionSmokeIdentityTransition,
  getProjectedSmokeIdentityUsers,
  planProductionSmokeIdentityTransition,
  validateProductionSmokeBootstrapBinding,
} = require('./production-smoke-identity');

const TARGET_COLLECTIONS = Object.freeze([
  'equipment',
  'counterparties',
  'counterparty_role_assignments',
  'clients',
  'client_objects',
  'documents',
  'app_settings',
]);

const REMEDIATION_SCOPE_CATEGORIES = new Set([
  COLLECTION_SCOPE_CATEGORY.TENANT,
  COLLECTION_SCOPE_CATEGORY.TENANT_TECHNICAL,
  COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE,
  COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY,
]);

const IDENTITY_COUNT_TABLES = Object.freeze([
  'canonical_companies',
  'canonical_branches',
  'company_memberships',
  'membership_branch_access',
  'role_templates',
  'role_template_capabilities',
  'membership_capability_assignments',
  'authorization_audit_events',
  'identity_bootstrap_runs',
]);

const RECORD_ACTIONS = new Set(['UPDATE_SCOPE', 'LEAVE_UNSCOPED', 'UNRESOLVED']);
const RELATION_ACTIONS = new Set(['RELINK', 'LEAVE_UNCHANGED', 'UNRESOLVED']);
const RELATION_FIELDS = new Set(['clientId', 'counterpartyId']);
const IDENTITY_ONLY_EXECUTION_SCOPE = 'IDENTITY_ONLY';
const IDENTITY_ONLY_CREATE_TYPES = new Set([
  'Company',
  'Branch',
  'RoleTemplate',
  'Membership',
]);

class ProductionScopeRemediationError extends Error {
  constructor(code, message, blockers = []) {
    super(message);
    this.name = 'ProductionScopeRemediationError';
    this.code = code;
    this.blockers = blockers;
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function deterministicBootstrapIdGenerator(seed) {
  let counter = 0;
  return prefix => {
    counter += 1;
    const hex = sha256(`${seed}:${counter}:${prefix}`);
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    return `${prefix}-${uuid}`;
  };
}

function normalizedId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isIdentityOnlyPlan(plan) {
  return plan?.executionScope === IDENTITY_ONLY_EXECUTION_SCOPE;
}

function targetCollectionsForPlan(plan = {}) {
  if (isIdentityOnlyPlan(plan)) return [];
  const names = new Set(TARGET_COLLECTIONS);
  for (const mapping of [
    ...(Array.isArray(plan.recordMappings) ? plan.recordMappings : []),
    ...(Array.isArray(plan.relationMappings) ? plan.relationMappings : []),
  ]) {
    const name = normalizedId(mapping?.collection);
    if (name) names.add(name);
  }
  for (const name of Object.keys(plan?.expected?.collectionCounts || {})) {
    if (name !== 'users') names.add(normalizedId(name));
  }
  for (const name of Object.keys(plan?.expected?.collectionFingerprints || {})) {
    if (name !== 'users') names.add(normalizedId(name));
  }
  return [...names].filter(Boolean).sort();
}

function validateIdentityOnlyInput(plan, blockers) {
  if (!isIdentityOnlyPlan(plan)) return;
  const config = plan?.authority?.identityBootstrap;
  const authorityProjection = {
    configVersion: config?.configVersion,
    company: config?.company,
    branches: config?.branches,
    roleTemplates: config?.roleTemplates,
    memberships: config?.memberships,
    intentionallyUnmappedUserIds: config?.intentionallyUnmappedUserIds,
  };
  const expectedActorMappings = [
    {
      userId: IDENTITY_ONLY_OWNER_PRINCIPAL_ID,
      action: 'CREATE_MEMBERSHIP',
      membershipId: IDENTITY_ONLY_OWNER_MEMBERSHIP_ID,
      companyId: IDENTITY_ONLY_COMPANY_ID,
      tenantId: IDENTITY_ONLY_COMPANY_ID,
    },
    ...IDENTITY_ONLY_AUTHORITY.intentionallyUnmappedUserIds.map(userId => ({
      userId,
      action: 'NO_MEMBERSHIP',
      candidateForProductionMembership: false,
    })),
  ];
  if (
    plan?.authority?.status !== 'APPROVED'
    || plan?.authority?.companyId !== IDENTITY_ONLY_COMPANY_ID
    || plan?.authority?.tenantId !== IDENTITY_ONLY_COMPANY_ID
    || stableJson(authorityProjection) !== stableJson(IDENTITY_ONLY_AUTHORITY)
    || config?.approval?.approvedBy !== IDENTITY_ONLY_OWNER_PRINCIPAL_ID
    || config?.approval?.approvalReference !== IDENTITY_ONLY_APPROVAL_REFERENCE
    || stableJson(plan?.actorMappings) !== stableJson(expectedActorMappings)
  ) {
    pushBlocker(blockers, 'IDENTITY_ONLY_AUTHORITY_MISMATCH');
  }
  const mappingFields = [
    ['recordMappings', 'IDENTITY_ONLY_RECORD_MAPPINGS_FORBIDDEN'],
    ['relationMappings', 'IDENTITY_ONLY_RELATION_MAPPINGS_FORBIDDEN'],
  ];
  for (const [field, code] of mappingFields) {
    const value = plan?.[field];
    if (value != null && (!Array.isArray(value) || value.length > 0)) {
      pushBlocker(blockers, code);
    }
  }
  if (Object.prototype.hasOwnProperty.call(plan || {}, 'smokeIdentityTransition')) {
    pushBlocker(blockers, 'IDENTITY_ONLY_SMOKE_IDENTITY_TRANSITION_FORBIDDEN');
  }
  for (const field of ['collectionCounts', 'collectionFingerprints']) {
    for (const collection of Object.keys(plan?.expected?.[field] || {})) {
      if (collection !== 'users') {
        pushBlocker(blockers, 'IDENTITY_ONLY_COLLECTION_EXPECTATION_FORBIDDEN', {
          field,
          collection,
        });
      }
    }
  }
}

function validateTargetCollections(targetCollections, blockers) {
  for (const collection of targetCollections) {
    const policy = getCollectionScopePolicy(collection);
    if (!policy) {
      pushBlocker(blockers, 'REMEDIATION_COLLECTION_UNKNOWN', { collection });
      continue;
    }
    if (!REMEDIATION_SCOPE_CATEGORIES.has(policy.category)) {
      pushBlocker(blockers, 'REMEDIATION_COLLECTION_POLICY_REJECTED', {
        collection,
        category: policy.category,
      });
    }
    if (policy.shape !== 'ARRAY') {
      pushBlocker(blockers, 'REMEDIATION_COLLECTION_SHAPE_REJECTED', {
        collection,
        shape: policy.shape,
      });
    }
  }
}

function tableExists(db, table) {
  return Boolean(prepareSqliteReadonlyStatement(db, `
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(table));
}

function tableCount(db, table) {
  if (!tableExists(db, table)) return null;
  return Number(prepareSqliteReadonlyStatement(db, `SELECT COUNT(*) AS count FROM ${table}`).get().count);
}

function sqliteTotalChanges(db) {
  return Number(prepareSqliteReadonlyStatement(db, 'SELECT total_changes() AS count').get().count);
}

function readCollection(db, name) {
  const row = prepareSqliteReadonlyStatement(db, 'SELECT json FROM app_data WHERE name = ?').get(name);
  if (!row) return { exists: false, raw: null, value: null, error: 'COLLECTION_MISSING' };
  try {
    const value = JSON.parse(row.json);
    if (!Array.isArray(value)) {
      return { exists: true, raw: row.json, value, error: 'COLLECTION_NOT_ARRAY' };
    }
    return { exists: true, raw: row.json, value, error: null };
  } catch {
    return { exists: true, raw: row.json, value: null, error: 'COLLECTION_JSON_INVALID' };
  }
}

function appDataTableFingerprint(db) {
  if (!tableExists(db, 'app_data')) return null;
  const rows = prepareSqliteReadonlyStatement(
    db,
    'SELECT * FROM app_data ORDER BY name',
  ).all();
  return sha256(stableJson(rows));
}

function collectionFingerprint(value) {
  return sha256(stableJson(value));
}

function recordFingerprint(value) {
  return sha256(stableJson(value));
}

function recordContentFingerprint(value) {
  const content = value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : value;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    delete content.companyId;
    delete content.tenantId;
  }
  return recordFingerprint(content);
}

function identityCounts(db) {
  return Object.fromEntries(IDENTITY_COUNT_TABLES.map(table => [table, tableCount(db, table)]));
}

function databaseIdentity(db) {
  return {
    applicationId: Number(db.pragma('application_id', { simple: true })),
    pageSize: Number(db.pragma('page_size', { simple: true })),
    schemaFingerprint: getSchemaFingerprint(db),
    userVersion: Number(db.pragma('user_version', { simple: true })),
  };
}

function recordIndex(collections, targetCollections = Object.keys(collections)) {
  const indexes = {};
  for (const name of targetCollections) {
    const rows = collections[name]?.value;
    const index = new Map();
    if (Array.isArray(rows)) {
      rows.forEach((row, position) => {
        const id = normalizedId(row?.id);
        if (!id) return;
        const entries = index.get(id) || [];
        entries.push({ row, position });
        index.set(id, entries);
      });
    }
    indexes[name] = index;
  }
  return indexes;
}

function scopeAnomaly(row) {
  const companyId = normalizedId(row?.companyId);
  const tenantId = normalizedId(row?.tenantId);
  return !companyId || !tenantId || companyId !== tenantId;
}

function candidateKeys(collections, targetCollections = Object.keys(collections)) {
  const keys = [];
  for (const collection of targetCollections) {
    const rows = collections[collection]?.value;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!scopeAnomaly(row)) continue;
      keys.push(`${collection}:${normalizedId(row?.id) || '<missing-id>'}`);
    }
  }
  return keys.sort();
}

function stateMetrics(collections, db, targetCollections = Object.keys(collections)) {
  const clients = Array.isArray(collections.clients?.value) ? collections.clients.value : [];
  const objects = Array.isArray(collections.client_objects?.value)
    ? collections.client_objects.value
    : [];
  const clientIds = new Set(clients.map(item => normalizedId(item?.id)).filter(Boolean));
  const scoped = {};
  let scopeAnomalyCount = 0;
  for (const collection of targetCollections) {
    const rows = Array.isArray(collections[collection]?.value)
      ? collections[collection].value
      : [];
    scoped[collection] = rows.filter(row => !scopeAnomaly(row)).length;
    scopeAnomalyCount += rows.filter(scopeAnomaly).length;
  }
  return {
    companies: tableCount(db, 'canonical_companies'),
    memberships: tableCount(db, 'company_memberships'),
    scopedCounterparties: scoped.counterparties,
    scopedRoleAssignments: scoped.counterparty_role_assignments,
    scopedClients: scoped.clients,
    scopedClientObjects: scoped.client_objects,
    orphanCount: objects.filter(object => {
      const clientId = normalizedId(object?.clientId);
      return Boolean(clientId) && !clientIds.has(clientId);
    }).length,
    scopeAnomalyCount,
  };
}

function pushBlocker(blockers, code, details = {}) {
  blockers.push({ code, ...details });
}

function readObservedState(db, blockers, targetCollections, bindAppData = false) {
  if (!tableExists(db, 'app_data')) {
    pushBlocker(blockers, 'APP_DATA_TABLE_MISSING');
  }
  const collections = {};
  for (const name of targetCollections) {
    const collection = tableExists(db, 'app_data')
      ? readCollection(db, name)
      : { exists: false, raw: null, value: null, error: 'APP_DATA_TABLE_MISSING' };
    collections[name] = collection;
    if (collection.error) pushBlocker(blockers, collection.error, { collection: name });
  }
  const users = tableExists(db, 'app_data')
    ? readCollection(db, 'users')
    : { exists: false, raw: null, value: null, error: 'APP_DATA_TABLE_MISSING' };
  if (users.error) pushBlocker(blockers, users.error, { collection: 'users' });
  return {
    collections,
    users,
    dbIdentity: databaseIdentity(db),
    identityCounts: identityCounts(db),
    appDataFingerprint: bindAppData ? appDataTableFingerprint(db) : null,
  };
}

function compareExpectedState(plan, observed, blockers, targetCollections) {
  const expected = plan.expected || {};
  if (stableJson(expected.dbIdentity || {}) !== stableJson(observed.dbIdentity)) {
    pushBlocker(blockers, 'UNEXPECTED_DATABASE_IDENTITY', {
      expected: expected.dbIdentity || null,
      actual: observed.dbIdentity,
    });
  }
  const expectedCounts = expected.collectionCounts || {};
  const expectedFingerprints = expected.collectionFingerprints || {};
  const expectedIdentityCounts = expected.identityCounts || {};
  for (const table of IDENTITY_COUNT_TABLES) {
    const allowed = Array.isArray(expectedIdentityCounts[table])
      ? expectedIdentityCounts[table].map(Number)
      : [Number(expectedIdentityCounts[table])];
    if (!allowed.includes(observed.identityCounts[table])) {
      pushBlocker(blockers, 'UNEXPECTED_IDENTITY_COUNT', {
        table,
        expected: allowed,
        actual: observed.identityCounts[table],
      });
    }
  }
  for (const name of [...targetCollections, 'users']) {
    const collection = name === 'users' ? observed.users : observed.collections[name];
    if (!Array.isArray(collection?.value)) continue;
    const allowedCounts = Array.isArray(expectedCounts[name])
      ? expectedCounts[name].map(Number)
      : [Number(expectedCounts[name])];
    if (!allowedCounts.includes(collection.value.length)) {
      pushBlocker(blockers, 'UNEXPECTED_COLLECTION_COUNT', {
        collection: name,
        expected: allowedCounts,
        actual: collection.value.length,
      });
    }
    const actualFingerprint = collectionFingerprint(collection.value);
    const allowed = Array.isArray(expectedFingerprints[name])
      ? expectedFingerprints[name]
      : [expectedFingerprints[name]];
    if (!allowed.filter(Boolean).includes(actualFingerprint)) {
      pushBlocker(blockers, 'UNEXPECTED_COLLECTION_FINGERPRINT', {
        collection: name,
        expected: allowed.filter(Boolean),
        actual: actualFingerprint,
      });
    }
  }
}

function validateBackup(plan, blockers) {
  const backup = plan.backup || {};
  if (
    backup.verified !== true
    || !normalizedId(backup.reference)
    || !normalizedId(backup.sourceDbIdentity)
    || !normalizedId(backup.timestamp)
    || !Number.isSafeInteger(backup.sizeBytes)
    || backup.sizeBytes <= 0
    || !/^[a-f0-9]{64}$/.test(String(backup.sha256 || ''))
  ) {
    pushBlocker(blockers, 'RECOVERABLE_BACKUP_NOT_VERIFIED');
  }
}

function validateCanonicalCompanyIdentity(plan, blockers) {
  const strategy = plan.canonicalCompanyIdStrategy;
  if (!strategy || strategy.status !== 'APPROVED') return;
  let derived;
  try {
    derived = deriveCanonicalCompanyId(strategy.identity);
  } catch (error) {
    pushBlocker(blockers, 'CANONICAL_COMPANY_IDENTITY_INVALID', { detail: error.message });
    return;
  }
  const authorityCompanyId = normalizedId(plan.authority?.companyId);
  const valuesMatch = (
    strategy.canonicalIdentityKey === derived.canonicalIdentityKey
    && strategy.sha256Hex === derived.sha256Hex
    && strategy.base32Digest === derived.base32Digest
    && normalizedId(strategy.companyId) === derived.companyId
    && normalizedId(strategy.tenantId) === derived.companyId
    && authorityCompanyId === derived.companyId
    && normalizedId(plan.authority?.tenantId) === derived.companyId
  );
  if (!valuesMatch) {
    pushBlocker(blockers, 'CANONICAL_COMPANY_ID_MISMATCH', {
      expectedCompanyId: derived.companyId,
    });
  }
}

function validateActors(plan, usersDirectory, identityPlan, blockers, unresolved) {
  const users = Array.isArray(usersDirectory) ? usersDirectory : [];
  const usersById = new Map(users.map(user => [normalizedId(user?.id), user]));
  const actorMappings = Array.isArray(plan.actorMappings) ? plan.actorMappings : [];
  const actorIds = new Set();
  for (const mapping of actorMappings) {
    const userId = normalizedId(mapping?.userId);
    if (!userId || actorIds.has(userId)) {
      pushBlocker(blockers, 'ACTOR_MAPPING_INVALID', { userId: userId || null });
      continue;
    }
    actorIds.add(userId);
    const user = usersById.get(userId);
    if (!user || (mapping.action === 'CREATE_MEMBERSHIP' && user.status !== 'Активен')) {
      pushBlocker(blockers, 'ACTOR_NOT_ACTIVE', { userId });
    }
    if (mapping.action === 'UNRESOLVED') {
      pushBlocker(blockers, 'ACTOR_OWNERSHIP_UNRESOLVED', { userId });
      unresolved.push({ type: 'actor', id: userId, reason: mapping.reason || 'OWNERSHIP_NOT_PROVEN' });
      continue;
    }
    if (mapping.action === 'NO_MEMBERSHIP') {
      if (mapping.candidateForProductionMembership !== false) {
        pushBlocker(blockers, 'ACTOR_NO_MEMBERSHIP_DISPOSITION_INVALID', { userId });
      }
      continue;
    }
    if (mapping.action !== 'CREATE_MEMBERSHIP') {
      pushBlocker(blockers, 'ACTOR_MAPPING_ACTION_INVALID', { userId });
      continue;
    }
    if (
      normalizedId(mapping.companyId) !== normalizedId(plan.authority?.companyId)
      || normalizedId(mapping.tenantId) !== normalizedId(mapping.companyId)
      || !normalizedId(mapping.membershipId)
    ) {
      pushBlocker(blockers, 'ACTOR_SCOPE_MAPPING_INVALID', { userId });
    }
  }

  if (identityPlan?.normalized) {
    const memberships = new Map(identityPlan.normalized.memberships.map(membership => [
      membership.principalId,
      membership,
    ]));
    for (const mapping of actorMappings.filter(item => item.action === 'CREATE_MEMBERSHIP')) {
      const membership = memberships.get(normalizedId(mapping.userId));
      if (
        !membership
        || membership.id !== normalizedId(mapping.membershipId)
        || membership.status !== 'active'
      ) {
        pushBlocker(blockers, 'ACTOR_BOOTSTRAP_MAPPING_MISMATCH', {
          userId: normalizedId(mapping.userId),
        });
      }
    }
    const intentionallyUnmapped = new Set(
      identityPlan.normalized.intentionallyUnmappedUserIds || [],
    );
    for (const mapping of actorMappings.filter(item => item.action === 'NO_MEMBERSHIP')) {
      const userId = normalizedId(mapping.userId);
      if (!intentionallyUnmapped.has(userId)) {
        pushBlocker(blockers, 'ACTOR_INTENTIONALLY_UNMAPPED_MISMATCH', { userId });
      }
    }
    for (const membership of identityPlan.normalized.memberships) {
      const mapping = actorMappings.find(item => (
        item.action === 'CREATE_MEMBERSHIP'
        && normalizedId(item.userId) === membership.principalId
      ));
      if (!mapping) {
        pushBlocker(blockers, 'ACTOR_MAPPING_MISSING', {
          userId: membership.principalId,
        });
      }
    }
  }
}

function planSmokeIdentity(plan, observed, blockers) {
  const config = plan?.smokeIdentityTransition;
  const users = Array.isArray(observed.users?.value) ? observed.users.value : [];
  if (!config) {
    return {
      enabled: false,
      preview: null,
      effectiveUsers: users,
    };
  }
  const preview = planProductionSmokeIdentityTransition({
    users,
    config,
    usersRawFingerprint: observed.users?.raw ? sha256(observed.users.raw) : '',
  });
  preview.blockers.forEach(blocker => pushBlocker(blockers, 'SMOKE_IDENTITY_TRANSITION_BLOCKED', {
    detail: blocker,
  }));
  const binding = validateProductionSmokeBootstrapBinding({
    config,
    identityBootstrap: plan?.authority?.identityBootstrap,
  });
  binding.blockers.forEach(blocker => pushBlocker(blockers, 'SMOKE_IDENTITY_BOOTSTRAP_BINDING_BLOCKED', {
    detail: blocker,
  }));
  return {
    enabled: true,
    preview,
    effectiveUsers: preview.readyToApply
      ? getProjectedSmokeIdentityUsers(preview)
      : users,
  };
}

function identityCreateDiff(identityPlan, alreadyApplied) {
  if (!identityPlan?.normalized || alreadyApplied) return [];
  const normalized = identityPlan.normalized;
  return [
    {
      type: 'Company',
      id: normalized.company.id,
      value: normalized.company,
    },
    ...normalized.branches.map(branch => ({ type: 'Branch', id: branch.id, value: branch })),
    ...normalized.roleTemplates.map(template => ({
      type: 'RoleTemplate',
      id: `${template.templateKey}:v${template.templateVersion}`,
      value: template,
    })),
    ...normalized.memberships.map(membership => ({
      type: 'Membership',
      id: membership.id,
      value: { ...membership, companyId: normalized.company.id },
    })),
  ];
}

function validateIdentityOnlyProjection(
  plan,
  { create, updates, relinks, smokeIdentity },
  blockers,
) {
  if (!isIdentityOnlyPlan(plan)) return;
  for (const item of create) {
    const invalidType = !IDENTITY_ONLY_CREATE_TYPES.has(item?.type);
    const invalidBranch = item?.type === 'Branch'
      && (item?.value?.isHeadOffice !== true || item?.value?.status !== 'active');
    if (invalidType || invalidBranch) {
      pushBlocker(blockers, 'IDENTITY_ONLY_CREATE_PROJECTION_FORBIDDEN', {
        type: item?.type || null,
        id: item?.id || null,
      });
    }
  }
  if (updates.length > 0) {
    pushBlocker(blockers, 'IDENTITY_ONLY_UPDATE_PROJECTION_FORBIDDEN', {
      count: updates.length,
    });
  }
  if (relinks.length > 0) {
    pushBlocker(blockers, 'IDENTITY_ONLY_RELINK_PROJECTION_FORBIDDEN', {
      count: relinks.length,
    });
  }
  if (smokeIdentity.enabled) {
    pushBlocker(blockers, 'IDENTITY_ONLY_SMOKE_PROJECTION_FORBIDDEN');
  }
}

function planIdentity(db, plan, observed, usersDirectorySnapshot, blockers, unresolved) {
  if (plan.authority?.status !== 'APPROVED') {
    pushBlocker(blockers, 'OWNERSHIP_NOT_PROVEN');
    unresolved.push({
      type: 'authority',
      id: null,
      reason: plan.authority?.reason || 'CANONICAL_COMPANY_NOT_PROVEN',
    });
    return { identityPlan: null, alreadyApplied: false, create: [] };
  }
  const companyId = normalizedId(plan.authority.companyId);
  if (!companyId || normalizedId(plan.authority.tenantId) !== companyId) {
    pushBlocker(blockers, 'AUTHORITY_SCOPE_INVALID');
  }
  const config = plan.authority.identityBootstrap;
  if (!config || typeof config !== 'object') {
    pushBlocker(blockers, 'IDENTITY_BOOTSTRAP_CONFIG_REQUIRED');
    return { identityPlan: null, alreadyApplied: false, create: [] };
  }
  let identityPlan;
  try {
    identityPlan = planPlatformIdentityBootstrap(db, config, { usersDirectorySnapshot });
  } catch (error) {
    pushBlocker(blockers, 'IDENTITY_BOOTSTRAP_PLAN_FAILED', {
      detail: error.code || error.message,
    });
    return { identityPlan: null, alreadyApplied: false, create: [] };
  }
  identityPlan.blockers.forEach(blocker => pushBlocker(blockers, 'IDENTITY_BOOTSTRAP_BLOCKED', {
    detail: blocker,
  }));
  if (identityPlan.normalized?.company?.id !== companyId) {
    pushBlocker(blockers, 'AUTHORITY_COMPANY_BOOTSTRAP_MISMATCH');
  }

  const successfulRun = tableExists(db, 'identity_bootstrap_runs')
    ? prepareSqliteReadonlyStatement(db, `
        SELECT 1 FROM identity_bootstrap_runs
        WHERE configChecksum = ? AND status = 'succeeded'
      `).get(identityPlan.configChecksum)
    : null;
  const counts = observed.identityCounts;
  const initiallyEmpty = Object.values(counts).every(count => count === 0);
  const alreadyApplied = Boolean(successfulRun);
  if (!initiallyEmpty && !alreadyApplied) {
    pushBlocker(blockers, 'UNEXPECTED_IDENTITY_STATE', { counts });
  }
  return {
    identityPlan,
    alreadyApplied,
    create: identityCreateDiff(identityPlan, alreadyApplied),
  };
}

function cloneCollections(observed, targetCollections) {
  return Object.fromEntries(targetCollections.map(name => [name, {
    ...observed.collections[name],
    value: Array.isArray(observed.collections[name]?.value)
      ? structuredClone(observed.collections[name].value)
      : observed.collections[name]?.value,
  }]));
}

function validateAndPlanRecords(plan, observed, blockers, unresolved, targetCollections) {
  const mappings = Array.isArray(plan.recordMappings) ? plan.recordMappings : [];
  const indexes = recordIndex(observed.collections, targetCollections);
  const mappingKeys = new Set();
  const updates = [];
  for (const mapping of mappings) {
    const collection = normalizedId(mapping?.collection);
    const id = normalizedId(mapping?.id);
    const key = `${collection}:${id}`;
    if (!targetCollections.includes(collection) || !id || mappingKeys.has(key)) {
      pushBlocker(blockers, 'RECORD_MAPPING_INVALID', { collection, id });
      continue;
    }
    mappingKeys.add(key);
    if (!RECORD_ACTIONS.has(mapping.action)) {
      pushBlocker(blockers, 'RECORD_ACTION_INVALID', { collection, id });
      continue;
    }
    const matches = indexes[collection].get(id) || [];
    if (matches.length !== 1) {
      pushBlocker(blockers, matches.length === 0 ? 'MAPPED_RECORD_MISSING' : 'MAPPED_RECORD_DUPLICATE', {
        collection,
        id,
      });
      continue;
    }
    if (mapping.action === 'UNRESOLVED') {
      pushBlocker(blockers, 'RECORD_OWNERSHIP_UNRESOLVED', { collection, id });
      unresolved.push({
        type: 'record',
        collection,
        id,
        reason: mapping.reason || 'OWNERSHIP_NOT_PROVEN',
      });
      continue;
    }
    if (mapping.action === 'LEAVE_UNSCOPED') {
      const classification = normalizedId(mapping.classification);
      const current = matches[0].row;
      if (!/^(?:SMOKE_TEST_FIXTURE|SERVICE_SYSTEM|LEGACY_UNSCOPED_AUDIT|GLOBAL_SYSTEM_AUDIT)(?:_|$)/.test(classification)) {
        pushBlocker(blockers, 'UNSCOPED_EXCLUSION_CLASSIFICATION_INVALID', { collection, id });
      }
      if (normalizedId(current?.companyId) || normalizedId(current?.tenantId)) {
        pushBlocker(blockers, 'UNSCOPED_EXCLUSION_STATE_CONFLICT', { collection, id });
      }
      const expectedSourceHash = normalizedId(mapping.sourceRecordHash || mapping.canonicalRecordHash);
      const expectedContentHash = normalizedId(mapping.canonicalContentHash || mapping.canonicalRecordHash);
      if (plan.manifestVersion >= 2 && (!expectedSourceHash || !expectedContentHash)) {
        pushBlocker(blockers, 'RECORD_HASH_BINDING_REQUIRED', { collection, id });
      } else if (expectedSourceHash && recordFingerprint(current) !== expectedSourceHash) {
        pushBlocker(blockers, 'RECORD_SOURCE_HASH_MISMATCH', { collection, id });
      } else if (expectedContentHash && recordContentFingerprint(current) !== expectedContentHash) {
        pushBlocker(blockers, 'RECORD_CONTENT_HASH_MISMATCH', { collection, id });
      }
      continue;
    }
    const desiredCompanyId = normalizedId(mapping.companyId);
    const desiredTenantId = normalizedId(mapping.tenantId);
    if (
      !desiredCompanyId
      || desiredCompanyId !== desiredTenantId
      || desiredCompanyId !== normalizedId(plan.authority?.companyId)
    ) {
      pushBlocker(blockers, 'RECORD_SCOPE_MAPPING_INVALID', { collection, id });
      continue;
    }
    const current = matches[0].row;
    const currentCompanyId = normalizedId(current?.companyId);
    const currentTenantId = normalizedId(current?.tenantId);
    const expectedBefore = mapping.expectedBefore || {
      companyId: mapping.oldCompanyId ?? null,
      tenantId: mapping.oldTenantId ?? null,
    };
    const expectedCompanyId = normalizedId(expectedBefore.companyId);
    const expectedTenantId = normalizedId(expectedBefore.tenantId);
    const beforeIsLegacy = !currentCompanyId && !currentTenantId;
    const alreadyScoped = currentCompanyId === desiredCompanyId && currentTenantId === desiredTenantId;
    const expectedBeforeMatches = currentCompanyId === expectedCompanyId
      && currentTenantId === expectedTenantId;
    const expectedSourceHash = normalizedId(mapping.sourceRecordHash || mapping.canonicalRecordHash);
    const expectedContentHash = normalizedId(mapping.canonicalContentHash || mapping.canonicalRecordHash);
    const actualSourceHash = recordFingerprint(current);
    const actualContentHash = recordContentFingerprint(current);
    const sourceProjection = structuredClone(current);
    if (expectedCompanyId) sourceProjection.companyId = expectedCompanyId;
    else delete sourceProjection.companyId;
    if (expectedTenantId) sourceProjection.tenantId = expectedTenantId;
    else delete sourceProjection.tenantId;
    const projectedSourceHash = recordFingerprint(sourceProjection);
    if (plan.manifestVersion >= 2 && (!expectedSourceHash || !expectedContentHash)) {
      pushBlocker(blockers, 'RECORD_HASH_BINDING_REQUIRED', { collection, id });
      continue;
    }
    if (expectedContentHash && actualContentHash !== expectedContentHash) {
      pushBlocker(blockers, 'RECORD_CONTENT_HASH_MISMATCH', { collection, id });
      continue;
    }
    if (
      expectedSourceHash
      && actualSourceHash !== expectedSourceHash
      && projectedSourceHash !== expectedSourceHash
    ) {
      pushBlocker(blockers, 'RECORD_SOURCE_HASH_MISMATCH', { collection, id });
      continue;
    }
    if (!beforeIsLegacy && !alreadyScoped) {
      pushBlocker(blockers, 'RECORD_SCOPE_CONFLICT', {
        collection,
        id,
        current: { companyId: currentCompanyId || null, tenantId: currentTenantId || null },
      });
      continue;
    }
    if (!alreadyScoped && !expectedBeforeMatches) {
      pushBlocker(blockers, 'RECORD_EXPECTED_SCOPE_MISMATCH', {
        collection,
        id,
        expected: {
          companyId: expectedCompanyId || null,
          tenantId: expectedTenantId || null,
        },
        actual: {
          companyId: currentCompanyId || null,
          tenantId: currentTenantId || null,
        },
      });
      continue;
    }
    if (beforeIsLegacy) {
      updates.push({
        collection,
        id,
        before: { companyId: null, tenantId: null },
        after: { companyId: desiredCompanyId, tenantId: desiredTenantId },
        sourceRecordHash: expectedSourceHash || actualSourceHash,
        canonicalContentHash: expectedContentHash || actualContentHash,
        classification: normalizedId(mapping.classification) || null,
        derivationRule: normalizedId(mapping.derivationRule || mapping.ownershipRule) || null,
        reason: normalizedId(mapping.reason || mapping.evidence) || null,
        operation: 'UPDATE_SCOPE',
      });
    }
  }

  for (const key of candidateKeys(observed.collections, targetCollections)) {
    if (!mappingKeys.has(key)) pushBlocker(blockers, 'UNMAPPED_LEGACY_RECORD', { record: key });
  }
  return updates;
}

function validateAndPlanRelations(plan, observed, blockers, unresolved, targetCollections) {
  const mappings = Array.isArray(plan.relationMappings) ? plan.relationMappings : [];
  const indexes = recordIndex(observed.collections, targetCollections);
  const keys = new Set();
  const relinks = [];
  for (const mapping of mappings) {
    const collection = normalizedId(mapping?.collection);
    const id = normalizedId(mapping?.id);
    const field = normalizedId(mapping?.field);
    const key = `${collection}:${id}:${field}`;
    if (
      !targetCollections.includes(collection)
      || !id
      || !RELATION_FIELDS.has(field)
      || keys.has(key)
    ) {
      pushBlocker(blockers, 'RELATION_MAPPING_INVALID', { collection, id, field });
      continue;
    }
    keys.add(key);
    if (!RELATION_ACTIONS.has(mapping.action)) {
      pushBlocker(blockers, 'RELATION_ACTION_INVALID', { collection, id, field });
      continue;
    }
    const matches = indexes[collection].get(id) || [];
    if (matches.length !== 1) {
      pushBlocker(blockers, 'RELATION_RECORD_NOT_UNIQUE', { collection, id, field });
      continue;
    }
    if (mapping.action === 'UNRESOLVED') {
      pushBlocker(blockers, 'RELATION_UNRESOLVED', { collection, id, field });
      unresolved.push({
        type: 'relation',
        collection,
        id,
        field,
        reason: mapping.reason || 'RELATION_NOT_PROVEN',
      });
      continue;
    }
    if (mapping.action === 'LEAVE_UNCHANGED') {
      const current = matches[0].row?.[field] ?? null;
      const expectedBefore = mapping.before ?? null;
      if (current !== expectedBefore) {
        pushBlocker(blockers, 'RELATION_STATE_CONFLICT', {
          collection,
          id,
          field,
          expected: expectedBefore,
          actual: current,
        });
      }
      continue;
    }
    const current = matches[0].row?.[field] ?? null;
    const expectedBefore = mapping.before ?? null;
    const after = mapping.after ?? null;
    if (current === after) continue;
    if (current !== expectedBefore) {
      pushBlocker(blockers, 'RELATION_STATE_CONFLICT', {
        collection,
        id,
        field,
        expected: expectedBefore,
        actual: current,
      });
      continue;
    }
    relinks.push({ collection, id, field, before: current, after });
  }
  return relinks;
}

function applyDiffToCollections(collections, updates, relinks, targetCollections = Object.keys(collections)) {
  const next = Object.fromEntries(targetCollections.map(name => [name, {
    ...collections[name],
    value: structuredClone(collections[name].value),
  }]));
  const indexes = recordIndex(next, targetCollections);
  for (const update of updates) {
    const match = indexes[update.collection].get(update.id)[0];
    match.row.companyId = update.after.companyId;
    match.row.tenantId = update.after.tenantId;
  }
  for (const relink of relinks) {
    const match = indexes[relink.collection].get(relink.id)[0];
    match.row[relink.field] = relink.after;
  }
  return next;
}

function expectedMetrics(db, observed, create, updates, relinks, blocked, targetCollections) {
  if (blocked) return stateMetrics(observed.collections, db, targetCollections);
  const next = applyDiffToCollections(
    cloneCollections(observed, targetCollections),
    updates,
    relinks,
    targetCollections,
  );
  const metrics = stateMetrics(next, db, targetCollections);
  metrics.companies += create.filter(item => item.type === 'Company').length;
  metrics.memberships += create.filter(item => item.type === 'Membership').length;
  return metrics;
}

function deduplicateBlockers(blockers) {
  const seen = new Set();
  return blockers.filter(blocker => {
    const key = stableJson(blocker);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function planProductionScopeRemediation({ db, plan }) {
  if (!db || typeof db.prepare !== 'function') {
    throw new ProductionScopeRemediationError(
      'DATABASE_REQUIRED',
      'A better-sqlite3 database is required.',
    );
  }
  const blockers = [];
  const unresolved = [];
  const identityOnly = isIdentityOnlyPlan(plan);
  validateIdentityOnlyInput(plan || {}, blockers);
  const targetCollections = targetCollectionsForPlan(plan);
  validateTargetCollections(targetCollections, blockers);
  if (plan?.planVersion !== 1 || !normalizedId(plan?.planId)) {
    pushBlocker(blockers, 'PLAN_IDENTITY_INVALID');
  }
  const observed = readObservedState(db, blockers, targetCollections, identityOnly);
  compareExpectedState(plan || {}, observed, blockers, targetCollections);
  validateBackup(plan || {}, blockers);
  validateCanonicalCompanyIdentity(plan || {}, blockers);
  const smokeIdentity = identityOnly
    ? {
      enabled: false,
      preview: null,
      effectiveUsers: Array.isArray(observed.users?.value) ? observed.users.value : [],
    }
    : planSmokeIdentity(plan || {}, observed, blockers);
  const effectiveUsersSnapshot = buildUsersDirectorySnapshot(smokeIdentity.effectiveUsers);
  const identity = planIdentity(
    db,
    plan || {},
    observed,
    effectiveUsersSnapshot,
    blockers,
    unresolved,
  );
  validateActors(
    plan || {},
    smokeIdentity.effectiveUsers,
    identity.identityPlan,
    blockers,
    unresolved,
  );
  const updates = validateAndPlanRecords(
    plan || {},
    observed,
    blockers,
    unresolved,
    targetCollections,
  );
  const relinks = validateAndPlanRelations(
    plan || {},
    observed,
    blockers,
    unresolved,
    targetCollections,
  );
  validateIdentityOnlyProjection(
    plan || {},
    { create: identity.create, updates, relinks, smokeIdentity },
    blockers,
  );
  const uniqueBlockers = deduplicateBlockers(blockers);
  const blocked = uniqueBlockers.length > 0;
  const create = blocked ? [] : [
    ...identity.create,
    ...(smokeIdentity.preview?.plannedDiff.CREATE || []),
  ];
  const plannedUpdates = blocked ? [] : [
    ...updates,
    ...(smokeIdentity.preview?.plannedDiff.UPDATE || []),
  ];
  const plannedRelinks = blocked ? [] : relinks;
  const observedFingerprints = Object.fromEntries([
    ...targetCollections.map(name => [name, Array.isArray(observed.collections[name]?.value)
      ? collectionFingerprint(observed.collections[name].value)
      : null]),
    ['users', Array.isArray(observed.users?.value)
      ? collectionFingerprint(observed.users.value)
      : null],
  ]);
  const stateBinding = {
    dbIdentity: observed.dbIdentity,
    identityCounts: observed.identityCounts,
    collectionFingerprints: observedFingerprints,
  };
  if (identityOnly) stateBinding.appDataFingerprint = observed.appDataFingerprint;
  const stateFingerprint = sha256(stableJson(stateBinding));
  const planChecksum = sha256(stableJson({ plan, stateFingerprint }));
  return {
    ...(identityOnly ? { executionScope: IDENTITY_ONLY_EXECUTION_SCOPE } : {}),
    mode: 'dry-run',
    ok: !blocked,
    readyToApply: !blocked,
    writes: 0,
    planId: normalizedId(plan?.planId) || null,
    planChecksum,
    stateFingerprint,
    blockers: uniqueBlockers,
    observed: {
      dbIdentity: observed.dbIdentity,
      identityCounts: observed.identityCounts,
      collectionCounts: Object.fromEntries([
        ...targetCollections.map(name => [name, observed.collections[name]?.value?.length ?? null]),
        ['users', observed.users?.value?.length ?? null],
      ]),
      collectionFingerprints: observedFingerprints,
      ...(identityOnly ? { appDataFingerprint: observed.appDataFingerprint } : {}),
      legacyCandidates: candidateKeys(observed.collections, targetCollections),
      metrics: stateMetrics(observed.collections, db, targetCollections),
      targetCollections,
    },
    plannedDiff: {
      CREATE: create,
      UPDATE: plannedUpdates,
      RELINK: plannedRelinks,
      UNRESOLVED: unresolved,
    },
    expectedPostState: expectedMetrics(
      db,
      observed,
      create,
      updates,
      plannedRelinks,
      blocked,
      targetCollections,
    ),
    identity: {
      alreadyApplied: identity.alreadyApplied,
      configChecksum: identity.identityPlan?.configChecksum || null,
    },
    smokeIdentity: {
      enabled: smokeIdentity.enabled,
      status: smokeIdentity.preview?.status || 'disabled',
      transitionChecksum: smokeIdentity.preview?.transitionChecksum || null,
      projectedUsersDirectoryFingerprint:
        smokeIdentity.preview?.projectedUsersDirectoryFingerprint || null,
    },
  };
}

function persistCollectionDiff(db, initialPlan, faultInjector, mutationTimestamp) {
  const targetCollections = initialPlan?.observed?.targetCollections || [];
  const collectionUpdates = initialPlan.plannedDiff.UPDATE.filter(item => (
    targetCollections.includes(item.collection)
  ));
  const collectionRelinks = initialPlan.plannedDiff.RELINK.filter(item => (
    targetCollections.includes(item.collection)
  ));
  if (
    initialPlan?.executionScope === IDENTITY_ONLY_EXECUTION_SCOPE
    && (
      targetCollections.length > 0
      || collectionUpdates.length > 0
      || collectionRelinks.length > 0
    )
  ) {
    throw new ProductionScopeRemediationError(
      'IDENTITY_ONLY_NON_IDENTITY_MUTATION_FORBIDDEN',
      'Identity-only execution cannot persist app_data collection changes.',
    );
  }
  const changedCollections = new Set([
    ...collectionUpdates.map(item => item.collection),
    ...collectionRelinks.map(item => item.collection),
  ]);
  if (changedCollections.size === 0) return 0;
  const observedBlockers = [];
  const observed = readObservedState(db, observedBlockers, targetCollections);
  if (observedBlockers.length > 0) {
    throw new ProductionScopeRemediationError(
      'TRANSACTIONAL_STATE_INVALID',
      'Transactional collection state is invalid.',
      observedBlockers,
    );
  }
  const next = applyDiffToCollections(
    cloneCollections(observed, targetCollections),
    collectionUpdates,
    collectionRelinks,
    targetCollections,
  );
  let writes = 0;
  const update = db.prepare(`
    UPDATE app_data
    SET json = ?, updated_at = ?
    WHERE name = ? AND json = ?
  `);
  let mutationIndex = 0;
  for (const name of changedCollections) {
    const beforeRaw = observed.collections[name].raw;
    const result = update.run(JSON.stringify(next[name].value), mutationTimestamp, name, beforeRaw);
    if (result.changes !== 1) {
      throw new ProductionScopeRemediationError(
        'COLLECTION_COMPARE_AND_SWAP_FAILED',
        `Collection changed during remediation: ${name}.`,
      );
    }
    writes += result.changes;
    mutationIndex += 1;
    if (typeof faultInjector === 'function') {
      faultInjector({ stage: 'after_collection_mutation', mutationIndex, collection: name });
    }
  }
  return writes;
}

function assertIdentityOnlyApplyBoundary(plan, preview) {
  if (!isIdentityOnlyPlan(plan)) return;
  const invalidCreate = preview.plannedDiff.CREATE.some(item => (
    !IDENTITY_ONLY_CREATE_TYPES.has(item?.type)
    || (
      item?.type === 'Branch'
      && (item?.value?.isHeadOffice !== true || item?.value?.status !== 'active')
    )
  ));
  if (
    preview.observed.targetCollections.length > 0
    || preview.smokeIdentity.enabled
    || invalidCreate
    || preview.plannedDiff.UPDATE.length > 0
    || preview.plannedDiff.RELINK.length > 0
    || !/^[a-f0-9]{64}$/.test(preview.observed.appDataFingerprint || '')
  ) {
    throw new ProductionScopeRemediationError(
      'IDENTITY_ONLY_NON_IDENTITY_MUTATION_FORBIDDEN',
      'Identity-only execution contains a non-identity mutation projection.',
    );
  }
}

function applyProductionScopeRemediation({
  db,
  plan,
  explicitApply = false,
  expectedPlanChecksum,
  afterWrites,
  transactionalGuard,
  transactionalPostGuard,
  faultInjector,
}) {
  if (explicitApply !== true) {
    throw new ProductionScopeRemediationError(
      'EXPLICIT_APPLY_REQUIRED',
      'Production scope remediation requires explicit apply confirmation.',
    );
  }
  if (isIdentityOnlyPlan(plan)) {
    // Loaded lazily because execution-plan-bundle depends on stableJson from
    // this module. Only a fully validated, authorized exact bundle can place
    // an identity plan in the module-private authorization WeakSet.
    const { isAuthorizedIdentityExecutionPlan } = require('./production-scope-execution-plan-bundle');
    if (!isAuthorizedIdentityExecutionPlan(plan)) {
      throw new ProductionScopeRemediationError(
        'IDENTITY_ONLY_AUTHORIZED_EXECUTION_BUNDLE_REQUIRED',
        'Identity-only apply requires a plan produced by exact authorized bundle validation.',
      );
    }
  }
  const preview = planProductionScopeRemediation({ db, plan });
  if (!preview.readyToApply) {
    throw new ProductionScopeRemediationError(
      'REMEDIATION_BLOCKED',
      'Production scope remediation has blockers.',
      preview.blockers,
    );
  }
  if (expectedPlanChecksum !== preview.planChecksum) {
    throw new ProductionScopeRemediationError(
      'PLAN_CHECKSUM_MISMATCH',
      'Production scope remediation plan checksum confirmation mismatch.',
    );
  }
  assertIdentityOnlyApplyBoundary(plan, preview);
  const beforeTotalChanges = sqliteTotalChanges(db);
  const execute = db.transaction(() => {
    if (typeof transactionalGuard === 'function') transactionalGuard();
    const live = planProductionScopeRemediation({ db, plan });
    if (!live.readyToApply || live.planChecksum !== preview.planChecksum) {
      throw new ProductionScopeRemediationError(
        'TRANSACTIONAL_REVALIDATION_FAILED',
        'Production state changed after approval.',
        live.blockers,
      );
    }
    assertIdentityOnlyApplyBoundary(plan, live);
    const bootstrapConfig = plan.authority.identityBootstrap;
    const bootstrapTimestamp = normalizedId(plan.backup?.timestamp);
    const smokeIdentityResult = live.smokeIdentity.enabled
      ? applyProductionSmokeIdentityTransition({
        db,
        config: plan.smokeIdentityTransition,
        expectedTransitionChecksum: live.smokeIdentity.transitionChecksum,
        mutationTimestamp: bootstrapTimestamp,
      })
      : { status: 'noop', writes: 0 };
    if (typeof faultInjector === 'function') {
      faultInjector({ stage: 'after_smoke_identity_mutation', smokeIdentityResult });
    }
    const bootstrapGenerateId = deterministicBootstrapIdGenerator(live.planChecksum);
    const bootstrapResult = runPlatformIdentityBootstrap({
      db,
      mode: 'apply',
      config: bootstrapConfig,
      explicitApply: true,
      expectedChecksum: calculateBootstrapChecksum(db, bootstrapConfig),
      bootstrapNowIso: () => bootstrapTimestamp,
      bootstrapGenerateId,
    });
    if (typeof faultInjector === 'function') {
      faultInjector({ stage: 'after_identity_mutation', bootstrapResult });
    }
    const collectionWrites = persistCollectionDiff(
      db,
      live,
      faultInjector,
      bootstrapTimestamp,
    );
    if (typeof afterWrites === 'function') afterWrites({ bootstrapResult, collectionWrites });
    const postState = planProductionScopeRemediation({ db, plan });
    if (
      isIdentityOnlyPlan(plan)
      && postState.observed.appDataFingerprint !== live.observed.appDataFingerprint
    ) {
      throw new ProductionScopeRemediationError(
        'IDENTITY_ONLY_APP_DATA_MUTATION_DETECTED',
        'Identity-only execution changed app_data.',
      );
    }
    if (
      !postState.readyToApply
      || postState.plannedDiff.CREATE.length !== 0
      || postState.plannedDiff.UPDATE.length !== 0
      || postState.plannedDiff.RELINK.length !== 0
      || stableJson(postState.expectedPostState) !== stableJson(live.expectedPostState)
    ) {
      throw new ProductionScopeRemediationError(
        'POST_STATE_VERIFICATION_FAILED',
        'Applied remediation did not reach the exact approved post-state.',
        postState.blockers,
      );
    }
    if (typeof transactionalPostGuard === 'function') transactionalPostGuard();
    if (typeof faultInjector === 'function') {
      faultInjector({ stage: 'before_commit', bootstrapResult, collectionWrites });
    }
    if (
      isIdentityOnlyPlan(plan)
      && appDataTableFingerprint(db) !== live.observed.appDataFingerprint
    ) {
      throw new ProductionScopeRemediationError(
        'IDENTITY_ONLY_APP_DATA_MUTATION_DETECTED',
        'Identity-only execution changed app_data.',
      );
    }
    if (isIdentityOnlyPlan(plan)) {
      const identityWriteCount = sqliteTotalChanges(db) - beforeTotalChanges;
      if (
        identityWriteCount !== IDENTITY_ONLY_WRITE_MANIFEST.expectedSqliteTotalChanges
        || collectionWrites !== IDENTITY_ONLY_WRITE_MANIFEST.collectionWriteCount
        || bootstrapResult.status !== 'succeeded'
        || smokeIdentityResult.status !== 'noop'
      ) {
        throw new ProductionScopeRemediationError(
          'IDENTITY_ONLY_SQL_WRITE_MANIFEST_MISMATCH',
          'Identity-only execution differed from the sealed exact SQL/write manifest.',
        );
      }
    }
    return { bootstrapResult, collectionWrites, smokeIdentityResult };
  });
  const result = execute.immediate();
  return {
    status: result.bootstrapResult.status === 'noop'
        && result.smokeIdentityResult.status === 'noop'
        && result.collectionWrites === 0
      ? 'noop'
      : 'succeeded',
    writes: sqliteTotalChanges(db) - beforeTotalChanges,
    collectionWrites: result.collectionWrites,
    bootstrapStatus: result.bootstrapResult.status,
    smokeIdentityStatus: result.smokeIdentityResult.status,
  };
}

module.exports = {
  IDENTITY_ONLY_EXECUTION_SCOPE,
  IDENTITY_COUNT_TABLES,
  ProductionScopeRemediationError,
  TARGET_COLLECTIONS,
  applyProductionScopeRemediation,
  collectionFingerprint,
  databaseIdentity,
  identityCounts,
  planProductionScopeRemediation,
  recordContentFingerprint,
  recordFingerprint,
  sqliteTotalChanges,
  stableJson,
  targetCollectionsForPlan,
};
