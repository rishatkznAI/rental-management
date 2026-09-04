const crypto = require('crypto');
const { stableJson } = require('./production-scope-remediation');
const {
  PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
  PRODUCTION_BASELINE_CONTRACT,
  currentRepositorySourceBindingsFingerprint,
} = require('./production-scope-evidence-builder');
const { stableJsonSha256: baselineStableJsonSha256 } = require('./production-scope-baseline-contract');
const { classificationAuthoritySnapshot } = require('./production-scope-evidence-classification');
const {
  APPROVAL_REFERENCE: IDENTITY_ONLY_APPROVAL_REFERENCE,
  AUTHORITY: IDENTITY_ONLY_AUTHORITY,
  COMPANY_ID: IDENTITY_ONLY_COMPANY_ID,
  EXPECTED_ROW_COUNT_DELTAS: IDENTITY_ONLY_ROW_COUNT_DELTAS,
  HEAD_OFFICE_ID: IDENTITY_ONLY_HEAD_OFFICE_ID,
  OWNER_MEMBERSHIP_ID: IDENTITY_ONLY_OWNER_MEMBERSHIP_ID,
  OWNER_PRINCIPAL_ID: IDENTITY_ONLY_OWNER_PRINCIPAL_ID,
} = require('./identity-bootstrap-execution-bundle');

const BUNDLE_VERSION = 1;
const IDENTITY_ONLY_EXECUTION_SCOPE = 'IDENTITY_ONLY';
const authorizedIdentityExecutionPlans = new WeakSet();
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SHA40_PATTERN = /^[a-f0-9]{40}$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const FORBIDDEN_KEY = /(password|passwd|secret|token|credential|cookie|session|api.?key)/i;
const AUTHORIZATION_KEYS = new Set([
  'authorizationVersion',
  'approvalFileSha256',
  'approvalReference',
  'approvedAt',
  'approvedBy',
  'authorityConfigChecksum',
  'authorizedExecutionSha',
  'captureDeployedSha',
  'independentAuditVerdict',
  'reviewBundleFileSha256',
  'reviewBundleSha256',
  'reviewExecutionPlanSha256',
  'scopeManifestSha256',
  'simulationOneSha256',
  'simulationTwoSha256',
]);
const IDENTITY_ONLY_UNMAPPED_PRINCIPAL_IDS = Object.freeze([
  ...IDENTITY_ONLY_AUTHORITY.intentionallyUnmappedUserIds,
]);
const IDENTITY_ONLY_BUNDLE_KEYS = Object.freeze([
  'authorization',
  'bundleSha256',
  'bundleVersion',
  'evidence',
  'executionPlan',
  'executionPlanSha256',
  'platformDefaultTenantOverlaySemantics',
  'productionExecutionAuthorized',
  'recordBindings',
  'scopeManifestSha256',
  'source',
  'sourceBindingsFingerprint',
  'status',
  'summary',
]);
const IDENTITY_ONLY_PLAN_KEYS = Object.freeze([
  'actorMappings',
  'authority',
  'backup',
  'exactSourceBinding',
  'executionScope',
  'expected',
  'manifestVersion',
  'planId',
  'planVersion',
  'platformDefaultTenantOverlaySemantics',
  'productionExecutionAuthorized',
  'recordMappings',
  'relationMappings',
  'scopeManifestSha256',
  'sourceBindingsFingerprint',
  'sourceDbPath',
]);

class ProductionScopeExecutionBundleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProductionScopeExecutionBundleError';
    this.code = code;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function exactText(value) {
  return typeof value === 'string' && value === value.trim() ? value : '';
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function forbiddenKeyPath(value, currentPath = '$') {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      const found = forbiddenKeyPath(child, `${currentPath}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) return `${currentPath}.${key}`;
    const found = forbiddenKeyPath(child, `${currentPath}.${key}`);
    if (found) return found;
  }
  return null;
}

function executionPlanSha256(plan) {
  return sha256(stableJson(plan));
}

function executionBundleSha256(bundle) {
  const projected = clone(bundle);
  delete projected.bundleSha256;
  return sha256(stableJson(projected));
}

function fail(code, message) {
  throw new ProductionScopeExecutionBundleError(code, message);
}

function isIdentityOnlyPlan(plan) {
  return plan?.executionScope === IDENTITY_ONLY_EXECUTION_SCOPE;
}

function isAuthorizedIdentityExecutionPlan(plan) {
  return Boolean(plan && authorizedIdentityExecutionPlans.has(plan));
}

function inheritAuthorizedIdentityExecutionPlan(basePlan, derivedPlan) {
  if (
    !isIdentityOnlyPlan(basePlan)
    || !isIdentityOnlyPlan(derivedPlan)
    || !isAuthorizedIdentityExecutionPlan(basePlan)
  ) return derivedPlan;
  const projected = clone(derivedPlan);
  projected.backup = clone(basePlan.backup);
  if (projected.authority?.identityBootstrap?.approval) {
    projected.authority.identityBootstrap.approval.backupReference = (
      basePlan.authority.identityBootstrap.approval.backupReference
    );
  }
  if (stableJson(projected) === stableJson(basePlan)) {
    authorizedIdentityExecutionPlans.add(derivedPlan);
  }
  return derivedPlan;
}

function exactObjectKeys(value, expectedKeys, code, label) {
  const keys = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
  const expected = [...expectedKeys].sort();
  if (stableJson(keys) !== stableJson(expected)) {
    fail(code, `${label} contains missing or unapproved fields.`);
  }
}

function exactValue(value, expected, code, message) {
  if (stableJson(value) !== stableJson(expected)) fail(code, message);
}

function validateIdentityOnlyBootstrapConfig(config, source) {
  exactObjectKeys(
    config,
    [
      'approval',
      'branches',
      'company',
      'configVersion',
      'intentionallyUnmappedUserIds',
      'memberships',
      'roleTemplates',
    ],
    'IDENTITY_ONLY_BOOTSTRAP_SHAPE_INVALID',
    'The identity-only bootstrap config',
  );
  exactValue(
    {
      configVersion: config.configVersion,
      company: config.company,
      branches: config.branches,
      roleTemplates: config.roleTemplates,
      memberships: config.memberships,
      intentionallyUnmappedUserIds: config.intentionallyUnmappedUserIds,
    },
    IDENTITY_ONLY_AUTHORITY,
    'IDENTITY_ONLY_BOOTSTRAP_AUTHORITY_MISMATCH',
    'The identity-only bootstrap differs from the exact owner-approved authority.',
  );
  exactObjectKeys(
    config.approval,
    [
      'approvalReference',
      'approvedAt',
      'approvedBy',
      'backupReference',
      'configChecksum',
      'schemaFingerprint',
    ],
    'IDENTITY_ONLY_BOOTSTRAP_APPROVAL_INVALID',
    'The identity-only bootstrap approval',
  );
  const approvedAt = exactText(config.approval.approvedAt);
  if (
    config.approval.approvedBy !== IDENTITY_ONLY_OWNER_PRINCIPAL_ID
    || config.approval.approvalReference !== IDENTITY_ONLY_APPROVAL_REFERENCE
    || config.approval.backupReference !== 'PENDING_VERIFIED_PRODUCTION_BACKUP'
    || !Number.isFinite(Date.parse(approvedAt))
    || new Date(approvedAt).toISOString() !== approvedAt
    || !SHA256_PATTERN.test(exactText(config.approval.configChecksum))
    || !SHA256_PATTERN.test(exactText(config.approval.schemaFingerprint))
    || config.approval.schemaFingerprint !== source.schemaFingerprint
  ) {
    fail(
      'IDENTITY_ONLY_BOOTSTRAP_APPROVAL_INVALID',
      'The identity-only bootstrap approval or source-schema binding is invalid.',
    );
  }
}

function validateIdentityOnlyExpectedState(expected, source) {
  exactObjectKeys(
    expected,
    ['collectionCounts', 'collectionFingerprints', 'dbIdentity', 'identityCounts'],
    'IDENTITY_ONLY_EXPECTED_STATE_INVALID',
    'The identity-only expected state',
  );
  exactObjectKeys(
    expected.dbIdentity,
    ['applicationId', 'pageSize', 'schemaFingerprint', 'userVersion'],
    'IDENTITY_ONLY_DATABASE_IDENTITY_INVALID',
    'The identity-only database identity',
  );
  if (
    !Number.isSafeInteger(expected.dbIdentity.applicationId)
    || !Number.isSafeInteger(expected.dbIdentity.pageSize)
    || expected.dbIdentity.pageSize <= 0
    || !Number.isSafeInteger(expected.dbIdentity.userVersion)
    || expected.dbIdentity.schemaFingerprint !== source.schemaFingerprint
  ) {
    fail('IDENTITY_ONLY_DATABASE_IDENTITY_INVALID', 'The identity-only database identity is invalid.');
  }
  exactObjectKeys(
    expected.identityCounts,
    Object.keys(IDENTITY_ONLY_ROW_COUNT_DELTAS),
    'IDENTITY_ONLY_IDENTITY_COUNTS_INVALID',
    'The identity-only relational count binding',
  );
  exactValue(
    expected.identityCounts,
    Object.fromEntries(Object.entries(IDENTITY_ONLY_ROW_COUNT_DELTAS).map(
      ([table, delta]) => [table, delta === 0 ? [0] : [0, delta]],
    )),
    'IDENTITY_ONLY_IDENTITY_COUNTS_INVALID',
    'The identity-only relational count deltas are not exact.',
  );
  exactObjectKeys(
    expected.collectionCounts,
    ['users'],
    'IDENTITY_ONLY_COLLECTION_EXPECTATION_INVALID',
    'The identity-only collection count binding',
  );
  exactObjectKeys(
    expected.collectionFingerprints,
    ['users'],
    'IDENTITY_ONLY_COLLECTION_EXPECTATION_INVALID',
    'The identity-only collection fingerprint binding',
  );
  const userCounts = Array.isArray(expected.collectionCounts.users)
    ? expected.collectionCounts.users
    : [expected.collectionCounts.users];
  const userFingerprints = Array.isArray(expected.collectionFingerprints.users)
    ? expected.collectionFingerprints.users
    : [expected.collectionFingerprints.users];
  if (
    userCounts.length !== 1
    || !Number.isSafeInteger(userCounts[0])
    || userCounts[0] < 5
    || userFingerprints.length !== 1
    || !SHA256_PATTERN.test(exactText(userFingerprints[0]))
  ) {
    fail(
      'IDENTITY_ONLY_COLLECTION_EXPECTATION_INVALID',
      'Identity-only execution may bind only one exact users-directory source state.',
    );
  }
}

function validateIdentityOnlyActorMappings(actorMappings) {
  exactValue(
    actorMappings,
    [
      {
        userId: IDENTITY_ONLY_OWNER_PRINCIPAL_ID,
        action: 'CREATE_MEMBERSHIP',
        membershipId: IDENTITY_ONLY_OWNER_MEMBERSHIP_ID,
        companyId: IDENTITY_ONLY_COMPANY_ID,
        tenantId: IDENTITY_ONLY_COMPANY_ID,
      },
      ...IDENTITY_ONLY_UNMAPPED_PRINCIPAL_IDS.map(userId => ({
        userId,
        action: 'NO_MEMBERSHIP',
        candidateForProductionMembership: false,
      })),
    ],
    'IDENTITY_ONLY_ACTOR_MAPPINGS_INVALID',
    'The identity-only actor mappings differ from the exact approved principal dispositions.',
  );
}

function validateIdentityOnlyPlanAndBundle(bundle, plan, source, evidence) {
  exactObjectKeys(
    bundle,
    IDENTITY_ONLY_BUNDLE_KEYS,
    'IDENTITY_ONLY_BUNDLE_SHAPE_INVALID',
    'The identity-only bundle',
  );
  exactObjectKeys(
    plan,
    IDENTITY_ONLY_PLAN_KEYS,
    'IDENTITY_ONLY_PLAN_MUTATION_FIELD_FORBIDDEN',
    'The identity-only plan',
  );
  if (
    plan.executionScope !== IDENTITY_ONLY_EXECUTION_SCOPE
    || plan.planVersion !== 1
    || !exactText(plan.planId)
    || Object.prototype.hasOwnProperty.call(plan, 'smokeIdentityTransition')
  ) {
    fail('IDENTITY_ONLY_PLAN_SHAPE_INVALID', 'The identity-only plan identity or scope is invalid.');
  }
  if (
    !Array.isArray(plan.recordMappings)
    || plan.recordMappings.length !== 0
    || !Array.isArray(plan.relationMappings)
    || plan.relationMappings.length !== 0
    || !Array.isArray(bundle.recordBindings)
    || bundle.recordBindings.length !== 0
  ) {
    fail(
      'IDENTITY_ONLY_DATA_MAPPING_FORBIDDEN',
      'Identity-only execution cannot carry record, relation, or manifest record bindings.',
    );
  }
  exactObjectKeys(
    plan.authority,
    ['companyId', 'identityBootstrap', 'status', 'tenantId'],
    'IDENTITY_ONLY_AUTHORITY_INVALID',
    'The identity-only authority',
  );
  if (
    plan.authority.status !== 'APPROVED'
    || plan.authority.companyId !== IDENTITY_ONLY_COMPANY_ID
    || plan.authority.tenantId !== IDENTITY_ONLY_COMPANY_ID
  ) {
    fail('IDENTITY_ONLY_AUTHORITY_INVALID', 'The identity-only company authority is invalid.');
  }
  validateIdentityOnlyBootstrapConfig(plan.authority.identityBootstrap, source);
  validateIdentityOnlyExpectedState(plan.expected, source);
  validateIdentityOnlyActorMappings(plan.actorMappings);
  exactObjectKeys(
    plan.backup,
    ['reference', 'sha256', 'sizeBytes', 'sourceDbIdentity', 'timestamp', 'verified'],
    'IDENTITY_ONLY_BACKUP_STATE_INVALID',
    'The identity-only backup state',
  );
  exactValue(
    plan.backup,
    {
      verified: false,
      reference: null,
      sourceDbIdentity: null,
      timestamp: null,
      sizeBytes: null,
      sha256: null,
    },
    'IDENTITY_ONLY_BACKUP_STATE_INVALID',
    'A review-only identity bundle must leave the fresh backup receipt unresolved.',
  );
  exactObjectKeys(
    source,
    [
      'captureDeployedSha',
      'captureDeploymentId',
      'databaseContentFingerprint',
      'deploymentIdentity',
      'railwayIdentity',
      'schemaFingerprint',
      'sourceFileSetHash',
      'sourceObservedFileSetHash',
      'sourceSnapshotHash',
    ],
    'IDENTITY_ONLY_SOURCE_SHAPE_INVALID',
    'The identity-only source binding',
  );
  exactObjectKeys(
    source.railwayIdentity,
    [
      'environmentId',
      'projectId',
      'serviceId',
      'volumeId',
      'volumeMountPath',
      'volumeName',
    ],
    'IDENTITY_ONLY_SOURCE_SHAPE_INVALID',
    'The identity-only Railway source binding',
  );
  exactObjectKeys(
    source.deploymentIdentity,
    ['deploymentInstanceId', 'serviceInstanceId'],
    'IDENTITY_ONLY_SOURCE_SHAPE_INVALID',
    'The identity-only deployment source binding',
  );
  exactObjectKeys(
    evidence,
    [
      'approvedReconciliationFingerprint',
      'artifactIndexSha256',
      'baselineContractSha256',
      'candidateAuthoritySha256',
      'candidateKeySetSha256',
      'canonicalScopeSha256',
      'classificationAuthorityFingerprint',
      'packFingerprint',
      'platformDefaultTenantOverlaySemantics',
      'reviewedPlanFileSha256',
      'sourceBindingsFingerprint',
    ],
    'IDENTITY_ONLY_EVIDENCE_SHAPE_INVALID',
    'The identity-only evidence binding',
  );
  exactObjectKeys(
    bundle.summary,
    [
      'classifiedRecordCount',
      'collectionWriteCounts',
      'executionRecordMappingCount',
      'globalReferenceCollectionCount',
      'operationCounts',
      'registryEntryCount',
      'registryWriteCount',
      'semanticScopeWriteCount',
    ],
    'IDENTITY_ONLY_WRITE_SUMMARY_INVALID',
    'The identity-only write summary',
  );
  if (
    bundle.summary.registryEntryCount !== 0
    || bundle.summary.registryWriteCount !== 0
    || bundle.summary.classifiedRecordCount !== 0
    || bundle.summary.executionRecordMappingCount !== 0
    || bundle.summary.semanticScopeWriteCount !== 0
    || bundle.summary.globalReferenceCollectionCount !== 0
    || stableJson(bundle.summary.operationCounts) !== '{}'
    || stableJson(bundle.summary.collectionWriteCounts) !== '{}'
  ) {
    fail(
      'IDENTITY_ONLY_WRITE_SUMMARY_INVALID',
      'Identity-only execution must have zero registry, semantic-scope, and collection writes.',
    );
  }
  if (stableJson(plan.exactSourceBinding) !== stableJson({ source, evidence })) {
    fail('IDENTITY_ONLY_SOURCE_BINDING_INVALID', 'The identity-only source binding is not exact.');
  }
}

function validateIdentityOnlyManifestForBuild(manifest) {
  exactObjectKeys(
    manifest,
    [
      'blockers',
      'canonicalScope',
      'evidence',
      'identity',
      'manifestSha256',
      'manifestVersion',
      'platformDefaultTenantOverlaySemantics',
      'productionExecutionAuthorized',
      'records',
      'registry',
      'source',
      'status',
      'summary',
    ],
    'IDENTITY_ONLY_MANIFEST_MUTATION_FIELD_FORBIDDEN',
    'The identity-only manifest',
  );
  const projected = JSON.parse(JSON.stringify(manifest));
  delete projected.manifestSha256;
  if (sha256(stableJson(projected)) !== manifest.manifestSha256) {
    fail('IDENTITY_ONLY_MANIFEST_HASH_MISMATCH', 'The exact identity-only manifest hash is inconsistent.');
  }
  exactValue(
    manifest.canonicalScope,
    { companyId: IDENTITY_ONLY_COMPANY_ID, tenantId: IDENTITY_ONLY_COMPANY_ID },
    'IDENTITY_ONLY_MANIFEST_AUTHORITY_INVALID',
    'The identity-only manifest has a different company authority.',
  );
  exactObjectKeys(
    manifest.identity,
    ['reviewedPlanFileSha256'],
    'IDENTITY_ONLY_MANIFEST_IDENTITY_INVALID',
    'The identity-only manifest identity binding',
  );
  exactObjectKeys(
    manifest.source,
    [
      'captureDeployedSha',
      'captureDeploymentId',
      'databaseContentFingerprint',
      'deploymentIdentity',
      'railwayIdentity',
      'schemaFingerprint',
      'sourceFileSetHash',
      'sourceObservedFileSetHash',
      'sourceSnapshotHash',
    ],
    'IDENTITY_ONLY_MANIFEST_MUTATION_FIELD_FORBIDDEN',
    'The identity-only manifest source binding',
  );
  exactObjectKeys(
    manifest.source.railwayIdentity,
    [
      'environmentId',
      'projectId',
      'serviceId',
      'volumeId',
      'volumeMountPath',
      'volumeName',
    ],
    'IDENTITY_ONLY_MANIFEST_MUTATION_FIELD_FORBIDDEN',
    'The identity-only manifest Railway source binding',
  );
  exactObjectKeys(
    manifest.source.deploymentIdentity,
    ['deploymentInstanceId', 'serviceInstanceId'],
    'IDENTITY_ONLY_MANIFEST_MUTATION_FIELD_FORBIDDEN',
    'The identity-only manifest deployment source binding',
  );
  exactObjectKeys(
    manifest.registry,
    ['entryCount', 'globalReferenceCollectionCount'],
    'IDENTITY_ONLY_MANIFEST_MUTATION_FIELD_FORBIDDEN',
    'The identity-only manifest registry summary',
  );
  exactObjectKeys(
    manifest.evidence,
    [
      'approvedReconciliationFingerprint',
      'artifactIndexSha256',
      'baselineContractSha256',
      'candidateAuthoritySha256',
      'candidateKeySetSha256',
      'canonicalScopeSha256',
      'classificationAuthorityFingerprint',
      'packFingerprint',
      'platformDefaultTenantOverlaySemantics',
      'sourceBindingsFingerprint',
    ],
    'IDENTITY_ONLY_MANIFEST_MUTATION_FIELD_FORBIDDEN',
    'The identity-only manifest evidence binding',
  );
  exactObjectKeys(
    manifest.summary,
    [
      'classifiedRecordCount',
      'collectionWriteCounts',
      'operationCounts',
      'semanticScopeWriteCount',
      'unresolvedRecordCount',
    ],
    'IDENTITY_ONLY_MANIFEST_MUTATION_FIELD_FORBIDDEN',
    'The identity-only manifest write summary',
  );
  if (
    !SHA256_PATTERN.test(exactText(manifest.identity.reviewedPlanFileSha256))
    || !Array.isArray(manifest.blockers)
    || manifest.blockers.length !== 0
    || !Array.isArray(manifest.records)
    || manifest.records.length !== 0
    || manifest.registry?.entryCount !== 0
    || manifest.registry?.globalReferenceCollectionCount !== 0
    || manifest.summary?.classifiedRecordCount !== 0
    || manifest.summary?.semanticScopeWriteCount !== 0
    || manifest.summary?.unresolvedRecordCount !== 0
    || stableJson(manifest.summary?.operationCounts) !== '{}'
    || stableJson(manifest.summary?.collectionWriteCounts) !== '{}'
  ) {
    fail(
      'IDENTITY_ONLY_MANIFEST_WRITE_SCOPE_INVALID',
      'The identity-only manifest must contain no registry, record, semantic-scope, or collection write.',
    );
  }
}

function validateAuthorizationBinding(authorization, bundle) {
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    fail('EXECUTION_AUTHORIZATION_EVIDENCE_REQUIRED', 'Authorized execution requires exact approval evidence.');
  }
  if (
    Object.keys(authorization).some(key => !AUTHORIZATION_KEYS.has(key))
    || authorization.authorizationVersion !== 1
    || authorization.independentAuditVerdict !== 'PASS'
    || !SHA256_PATTERN.test(exactText(authorization.approvalFileSha256))
    || !SHA256_PATTERN.test(exactText(authorization.reviewBundleFileSha256))
    || !SHA256_PATTERN.test(exactText(authorization.reviewBundleSha256))
    || !SHA256_PATTERN.test(exactText(authorization.reviewExecutionPlanSha256))
    || !SHA256_PATTERN.test(exactText(authorization.scopeManifestSha256))
    || !SHA256_PATTERN.test(exactText(authorization.simulationOneSha256))
    || !SHA256_PATTERN.test(exactText(authorization.simulationTwoSha256))
    || !SHA40_PATTERN.test(exactText(authorization.captureDeployedSha))
    || exactText(authorization.approvedBy).length < 3
    || exactText(authorization.approvalReference).length < 16
    || !Number.isFinite(Date.parse(exactText(authorization.approvedAt)))
    || new Date(exactText(authorization.approvedAt)).toISOString() !== authorization.approvedAt
  ) {
    fail('EXECUTION_AUTHORIZATION_EVIDENCE_INVALID', 'The execution approval evidence is incomplete or invalid.');
  }
  if (
    authorization.captureDeployedSha !== bundle.source?.captureDeployedSha
    || authorization.reviewBundleSha256 === bundle.bundleSha256
    || authorization.reviewExecutionPlanSha256 === bundle.executionPlanSha256
    || authorization.scopeManifestSha256 !== bundle.scopeManifestSha256
  ) {
    fail('EXECUTION_AUTHORIZATION_BINDING_MISMATCH', 'The execution approval does not bind the reviewed source bundle.');
  }
  const identityOnly = isIdentityOnlyPlan(bundle.executionPlan);
  if (identityOnly && (
    !SHA40_PATTERN.test(exactText(authorization.authorizedExecutionSha))
    || authorization.authorizedExecutionSha !== bundle.source?.captureDeployedSha
    || !SHA256_PATTERN.test(exactText(authorization.authorityConfigChecksum))
    || authorization.authorityConfigChecksum
      !== bundle.executionPlan?.authority?.identityBootstrap?.approval?.configChecksum
  )) {
    fail(
      'IDENTITY_ONLY_EXECUTION_AUTHORIZATION_BINDING_INVALID',
      'Identity-only authorization requires the exact execution SHA and authority checksum.',
    );
  }
  if (!identityOnly && (
    Object.prototype.hasOwnProperty.call(authorization, 'authorizedExecutionSha')
    || Object.prototype.hasOwnProperty.call(authorization, 'authorityConfigChecksum')
  )) {
    fail(
      'EXECUTION_AUTHORIZATION_SCOPE_FIELDS_FORBIDDEN',
      'Identity-only authorization fields are forbidden for a generic scope bundle.',
    );
  }
}

function validateProductionScopeExecutionBundle(bundle, { requireAuthorized = false } = {}) {
  if (!bundle || bundle.bundleVersion !== BUNDLE_VERSION) {
    fail('EXECUTION_BUNDLE_VERSION_INVALID', 'The exact execution bundle version is invalid.');
  }
  if (!SHA256_PATTERN.test(normalizedText(bundle.bundleSha256))) {
    fail('EXECUTION_BUNDLE_HASH_REQUIRED', 'The exact execution bundle hash is required.');
  }
  if (executionBundleSha256(bundle) !== bundle.bundleSha256) {
    fail('EXECUTION_BUNDLE_HASH_MISMATCH', 'The exact execution bundle hash is inconsistent.');
  }
  const plan = bundle.executionPlan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    fail('EXECUTION_PLAN_REQUIRED', 'The exact execution plan is missing.');
  }
  if (
    !SHA256_PATTERN.test(normalizedText(bundle.executionPlanSha256))
    || executionPlanSha256(plan) !== bundle.executionPlanSha256
  ) {
    fail('EXECUTION_PLAN_HASH_MISMATCH', 'The embedded execution plan hash is inconsistent.');
  }
  const authorized = bundle.productionExecutionAuthorized === true;
  if (
    plan.productionExecutionAuthorized !== authorized
    || (authorized && bundle.status !== 'APPROVED_FOR_GUARDED_EXECUTION')
    || (!authorized && bundle.status !== 'REVIEW_REQUIRED')
  ) {
    fail('EXECUTION_AUTHORIZATION_STATE_INVALID', 'The bundle authorization state is inconsistent.');
  }
  if (requireAuthorized && !authorized) {
    fail('PRODUCTION_EXECUTION_NOT_AUTHORIZED', 'The exact execution bundle is review-only.');
  }
  if (authorized) {
    validateAuthorizationBinding(bundle.authorization, bundle);
  } else if (bundle.authorization !== null) {
    fail(
      'EXECUTION_REVIEW_BUNDLE_AUTHORIZATION_FORBIDDEN',
      'A review-only bundle cannot carry execution approval evidence.',
    );
  }
  if (
    plan.manifestVersion !== 2
    || !SHA256_PATTERN.test(normalizedText(plan.scopeManifestSha256))
    || plan.scopeManifestSha256 !== bundle.scopeManifestSha256
  ) {
    fail('EXECUTION_MANIFEST_BINDING_INVALID', 'The execution plan is not bound to an exact v2 manifest.');
  }
  const source = bundle.source || {};
  const evidence = bundle.evidence || {};
  let currentSourceBindingsFingerprint;
  try {
    currentSourceBindingsFingerprint = currentRepositorySourceBindingsFingerprint();
  } catch (error) {
    fail(
      'EXECUTION_CURRENT_SOURCE_BINDINGS_UNAVAILABLE',
      `The current repository source binding cannot be verified: ${normalizedText(error?.code) || 'UNKNOWN'}.`,
    );
  }
  if (
    bundle.sourceBindingsFingerprint !== currentSourceBindingsFingerprint
    || evidence.sourceBindingsFingerprint !== currentSourceBindingsFingerprint
    || plan.sourceBindingsFingerprint !== currentSourceBindingsFingerprint
  ) {
    fail(
      'EXECUTION_SOURCE_BINDINGS_OBSOLETE',
      'The execution bundle predates or differs from the current repository source binding.',
    );
  }
  if (
    evidence.baselineContractSha256 !== baselineStableJsonSha256(PRODUCTION_BASELINE_CONTRACT)
    || evidence.candidateKeySetSha256 !== PRODUCTION_BASELINE_CONTRACT.candidateKeySetSha256
    || evidence.candidateAuthoritySha256 !== PRODUCTION_BASELINE_CONTRACT.candidateAuthoritySha256
    || evidence.canonicalScopeSha256 !== PRODUCTION_BASELINE_CONTRACT.canonicalScopeSha256
    || evidence.classificationAuthorityFingerprint
      !== sha256(stableJson(classificationAuthoritySnapshot()))
  ) {
    fail(
      'EXECUTION_AUTHORITY_CONTRACT_OBSOLETE',
      'The execution bundle differs from the current baseline or classification authority commitment.',
    );
  }
  if (
    stableJson(bundle.platformDefaultTenantOverlaySemantics)
      !== stableJson(PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT)
    || stableJson(evidence.platformDefaultTenantOverlaySemantics)
      !== stableJson(PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT)
    || stableJson(plan.platformDefaultTenantOverlaySemantics)
      !== stableJson(PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT)
  ) {
    fail(
      'EXECUTION_OVERLAY_SEMANTICS_CONTRACT_OBSOLETE',
      'The execution bundle does not bind the current platform-default/tenant-overlay semantics.',
    );
  }
  for (const [field, value] of Object.entries({
    sourceSnapshotHash: source.sourceSnapshotHash,
    sourceFileSetHash: source.sourceFileSetHash,
    sourceObservedFileSetHash: source.sourceObservedFileSetHash,
    databaseContentFingerprint: source.databaseContentFingerprint,
    schemaFingerprint: source.schemaFingerprint,
    artifactIndexSha256: evidence.artifactIndexSha256,
    baselineContractSha256: evidence.baselineContractSha256,
    candidateKeySetSha256: evidence.candidateKeySetSha256,
    candidateAuthoritySha256: evidence.candidateAuthoritySha256,
    canonicalScopeSha256: evidence.canonicalScopeSha256,
    classificationAuthorityFingerprint: evidence.classificationAuthorityFingerprint,
    packFingerprint: evidence.packFingerprint,
    sourceBindingsFingerprint: evidence.sourceBindingsFingerprint,
    reviewedPlanFileSha256: evidence.reviewedPlanFileSha256,
    approvedReconciliationFingerprint: evidence.approvedReconciliationFingerprint,
  })) {
    if (!SHA256_PATTERN.test(normalizedText(value))) {
      fail('EXECUTION_SOURCE_BINDING_INVALID', `Missing exact source binding: ${field}.`);
    }
  }
  if (!SHA40_PATTERN.test(exactText(source.captureDeployedSha))) {
    fail('EXECUTION_DEPLOYMENT_BINDING_INVALID', 'The capture deployment SHA is invalid.');
  }
  const railwayIdentity = source.railwayIdentity || {};
  const deploymentIdentity = source.deploymentIdentity || {};
  if (
    !['projectId', 'environmentId', 'serviceId', 'volumeId']
      .every(field => UUID_PATTERN.test(normalizedText(railwayIdentity[field])))
    || !normalizedText(railwayIdentity.volumeName)
    || normalizedText(railwayIdentity.volumeMountPath) !== '/data'
    || !UUID_PATTERN.test(normalizedText(deploymentIdentity.serviceInstanceId))
    || !UUID_PATTERN.test(normalizedText(deploymentIdentity.deploymentInstanceId))
  ) {
    fail('EXECUTION_RAILWAY_BINDING_INVALID', 'The exact Railway volume and deployment identity is invalid.');
  }
  if (!UUID_PATTERN.test(normalizedText(source.captureDeploymentId))
    || normalizedText(plan.sourceDbPath) !== '/data/app.sqlite') {
    fail('EXECUTION_TARGET_BINDING_INVALID', 'The deployment or exact production database path is invalid.');
  }
  if (
    stableJson(plan.exactSourceBinding) !== stableJson({ source, evidence })
    || plan.backup?.verified !== false
  ) {
    fail('EXECUTION_BASE_PLAN_INVALID', 'The base plan source binding or backup state is invalid.');
  }
  const recordMappings = Array.isArray(plan.recordMappings) ? plan.recordMappings : [];
  const actorMappings = Array.isArray(plan.actorMappings) ? plan.actorMappings : [];
  const recordBindings = Array.isArray(bundle.recordBindings) ? bundle.recordBindings : [];
  const identityOnly = isIdentityOnlyPlan(plan);
  // Identity-only changes mapping rules, never the common source, authority,
  // classification, tenant-overlay, target, or review-authorization guards above.
  if (identityOnly) {
    validateIdentityOnlyPlanAndBundle(bundle, plan, source, evidence);
  }
  if (
    !identityOnly
    && (
      !Number.isSafeInteger(bundle.summary?.registryEntryCount)
      || bundle.summary.registryEntryCount <= 0
      || recordMappings.length !== bundle.summary?.executionRecordMappingCount
      || recordBindings.length !== bundle.summary?.classifiedRecordCount
      || recordMappings.filter(row => row?.action === 'UPDATE_SCOPE').length
        !== recordBindings.filter(row => ['UPDATE_SCOPE', 'VERIFY_SCOPE'].includes(row?.operation)).length
      || recordBindings.filter(row => row?.operation === 'UPDATE_SCOPE').length
        !== bundle.summary?.semanticScopeWriteCount
      || bundle.summary?.globalReferenceCollectionCount !== 0
      || recordMappings.some(row => !['UPDATE_SCOPE', 'LEAVE_UNSCOPED'].includes(row?.action))
      || actorMappings.some(row => !['CREATE_MEMBERSHIP', 'NO_MEMBERSHIP'].includes(row?.action))
    )
  ) {
    fail('EXECUTION_MAPPING_COVERAGE_INVALID', 'The execution mappings are incomplete or unresolved.');
  }
  for (const row of identityOnly ? [] : recordMappings) {
    if (
      !normalizedText(row.collection)
      || !normalizedText(row.id)
      || !SHA256_PATTERN.test(normalizedText(row.sourceRecordHash))
      || !SHA256_PATTERN.test(normalizedText(row.canonicalContentHash))
    ) {
      fail('EXECUTION_RECORD_BINDING_INVALID', 'An execution record lacks exact identity or hashes.');
    }
    if (row.classification === 'TENANT_AUDIT_ENTITY_DERIVED' && (
      !normalizedText(row.derivationRule).startsWith('AUTHORITATIVE_PARENT_ID:')
      || !normalizedText(row.parent?.collection)
      || !normalizedText(row.parent?.recordId)
      || !SHA256_PATTERN.test(normalizedText(row.parent?.sourceRecordHash))
      || !SHA256_PATTERN.test(normalizedText(row.parent?.canonicalContentHash))
    )) {
      fail('EXECUTION_AUDIT_PARENT_BINDING_INVALID', 'A tenant audit mapping lacks exact parent evidence.');
    }
  }
  const bindingByKey = new Map();
  for (const row of identityOnly ? [] : recordBindings) {
    const key = `${normalizedText(row?.collection)}:${normalizedText(row?.recordId)}`;
    if (
      !normalizedText(row?.collection)
      || !normalizedText(row?.recordId)
      || bindingByKey.has(key)
      || !SHA256_PATTERN.test(normalizedText(row?.sourceRecordHash))
      || !SHA256_PATTERN.test(normalizedText(row?.canonicalContentHash))
      || !normalizedText(row?.locator?.shape)
      || !normalizedText(row?.locator?.key)
      || row.operation === 'UNRESOLVED'
    ) {
      fail('EXECUTION_MANIFEST_RECORD_BINDING_INVALID', 'A manifest record binding is incomplete or duplicate.');
    }
    if (row.classification === 'TENANT_AUDIT_ENTITY_DERIVED' && (
      !normalizedText(row.derivationRule).startsWith('AUTHORITATIVE_PARENT_ID:')
      || !normalizedText(row.parent?.collection)
      || !normalizedText(row.parent?.recordId)
      || !SHA256_PATTERN.test(normalizedText(row.parent?.sourceRecordHash))
      || !SHA256_PATTERN.test(normalizedText(row.parent?.canonicalContentHash))
    )) {
      fail('EXECUTION_AUDIT_PARENT_BINDING_INVALID', 'A tenant audit binding lacks exact parent evidence.');
    }
    bindingByKey.set(key, row);
  }
  for (const mapping of identityOnly ? [] : recordMappings) {
    const binding = bindingByKey.get(`${mapping.collection}:${mapping.id}`);
    const expectedAction = ['UPDATE_SCOPE', 'VERIFY_SCOPE'].includes(binding?.operation)
      ? 'UPDATE_SCOPE'
      : 'LEAVE_UNSCOPED';
    if (
      !binding
      || mapping.action !== expectedAction
      || mapping.sourceRecordHash !== binding.sourceRecordHash
      || mapping.canonicalContentHash !== binding.canonicalContentHash
    ) {
      fail('EXECUTION_RECORD_MANIFEST_MISMATCH', 'An execution mapping differs from its manifest binding.');
    }
  }
  if (!identityOnly && (!plan.smokeIdentityTransition || !plan.authority?.identityBootstrap)) {
    fail('EXECUTION_IDENTITY_BINDING_INVALID', 'The smoke transition or identity bootstrap is missing.');
  }
  const forbiddenPath = forbiddenKeyPath(bundle);
  if (forbiddenPath) {
    fail('EXECUTION_BUNDLE_SECRET_FIELD_FORBIDDEN', `Forbidden field in exact execution bundle: ${forbiddenPath}.`);
  }
  const validatedPlan = deepFreeze(clone(plan));
  if (requireAuthorized && authorized && identityOnly) {
    authorizedIdentityExecutionPlans.add(validatedPlan);
  }
  return deepFreeze({
    authorized,
    bundleSha256: bundle.bundleSha256,
    executionPlanSha256: bundle.executionPlanSha256,
    plan: validatedPlan,
  });
}

function buildProductionScopeExecutionBundle({ plan, manifest }) {
  if (
    !plan
    || !manifest
    || manifest.manifestVersion !== 2
    || manifest.status !== 'READY_FOR_DISPOSABLE_SIMULATION'
    || manifest.productionExecutionAuthorized !== false
    || !SHA256_PATTERN.test(normalizedText(manifest.manifestSha256))
  ) {
    fail('EXECUTION_BUNDLE_INPUT_INVALID', 'A reviewed, non-authorizing v2 manifest and plan are required.');
  }
  const identityOnly = isIdentityOnlyPlan(plan);
  if (identityOnly) validateIdentityOnlyManifestForBuild(manifest);
  let currentSourceBindingsFingerprint;
  try {
    currentSourceBindingsFingerprint = currentRepositorySourceBindingsFingerprint();
  } catch (error) {
    fail(
      'EXECUTION_CURRENT_SOURCE_BINDINGS_UNAVAILABLE',
      `The current repository source binding cannot be verified: ${normalizedText(error?.code) || 'UNKNOWN'}.`,
    );
  }
  if (
    manifest.evidence?.sourceBindingsFingerprint !== currentSourceBindingsFingerprint
    || plan.sourceBindingsFingerprint !== currentSourceBindingsFingerprint
    || stableJson(manifest.platformDefaultTenantOverlaySemantics)
      !== stableJson(PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT)
    || stableJson(manifest.evidence?.platformDefaultTenantOverlaySemantics)
      !== stableJson(PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT)
    || stableJson(plan.platformDefaultTenantOverlaySemantics)
      !== stableJson(PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT)
  ) {
    fail(
      'EXECUTION_BUNDLE_SOURCE_BINDINGS_OBSOLETE',
      'The manifest or plan predates the current repository source and overlay semantics contract.',
    );
  }
  // The reviewed hash must cover the exact JSON value written to disk, not an
  // in-memory object that may still contain non-JSON `undefined` values.
  const executionPlan = JSON.parse(JSON.stringify(clone(plan)));
  executionPlan.productionExecutionAuthorized = false;
  executionPlan.scopeManifestSha256 = manifest.manifestSha256;
  executionPlan.backup = {
    verified: false,
    reference: null,
    sourceDbIdentity: null,
    timestamp: null,
    sizeBytes: null,
    sha256: null,
  };
  if (executionPlan.authority?.identityBootstrap?.approval) {
    executionPlan.authority.identityBootstrap.approval.backupReference = 'PENDING_VERIFIED_PRODUCTION_BACKUP';
  }
  const source = {
    captureDeployedSha: manifest.source.captureDeployedSha,
    captureDeploymentId: manifest.source.captureDeploymentId,
    railwayIdentity: clone(manifest.source.railwayIdentity),
    deploymentIdentity: clone(manifest.source.deploymentIdentity),
    sourceSnapshotHash: manifest.source.sourceSnapshotHash,
    sourceFileSetHash: manifest.source.sourceFileSetHash,
    sourceObservedFileSetHash: manifest.source.sourceObservedFileSetHash,
    databaseContentFingerprint: manifest.source.databaseContentFingerprint,
    schemaFingerprint: manifest.source.schemaFingerprint,
  };
  const evidence = {
    artifactIndexSha256: manifest.evidence.artifactIndexSha256,
    baselineContractSha256: manifest.evidence.baselineContractSha256,
    candidateKeySetSha256: manifest.evidence.candidateKeySetSha256,
    candidateAuthoritySha256: manifest.evidence.candidateAuthoritySha256,
    canonicalScopeSha256: manifest.evidence.canonicalScopeSha256,
    classificationAuthorityFingerprint: manifest.evidence.classificationAuthorityFingerprint,
    packFingerprint: manifest.evidence.packFingerprint,
    sourceBindingsFingerprint: manifest.evidence.sourceBindingsFingerprint,
    platformDefaultTenantOverlaySemantics: clone(
      manifest.evidence.platformDefaultTenantOverlaySemantics,
    ),
    reviewedPlanFileSha256: manifest.identity.reviewedPlanFileSha256,
    approvedReconciliationFingerprint: manifest.evidence.approvedReconciliationFingerprint,
  };
  executionPlan.exactSourceBinding = { source, evidence };
  const bundle = {
    bundleVersion: BUNDLE_VERSION,
    status: 'REVIEW_REQUIRED',
    productionExecutionAuthorized: false,
    sourceBindingsFingerprint: manifest.evidence.sourceBindingsFingerprint,
    platformDefaultTenantOverlaySemantics: clone(
      manifest.platformDefaultTenantOverlaySemantics,
    ),
    authorization: null,
    scopeManifestSha256: manifest.manifestSha256,
    source,
    evidence,
    summary: {
      registryEntryCount: manifest.registry.entryCount,
      ...(identityOnly ? { registryWriteCount: 0 } : {}),
      classifiedRecordCount: manifest.summary.classifiedRecordCount,
      executionRecordMappingCount: executionPlan.recordMappings.length,
      semanticScopeWriteCount: manifest.summary.semanticScopeWriteCount,
      operationCounts: clone(manifest.summary.operationCounts),
      collectionWriteCounts: clone(manifest.summary.collectionWriteCounts),
      globalReferenceCollectionCount: manifest.registry.globalReferenceCollectionCount,
    },
    executionPlanSha256: executionPlanSha256(executionPlan),
    executionPlan,
    recordBindings: clone(manifest.records),
  };
  const serializableBundle = JSON.parse(JSON.stringify(bundle));
  serializableBundle.bundleSha256 = executionBundleSha256(serializableBundle);
  validateProductionScopeExecutionBundle(serializableBundle);
  return serializableBundle;
}

module.exports = {
  BUNDLE_VERSION,
  IDENTITY_ONLY_EXECUTION_SCOPE,
  ProductionScopeExecutionBundleError,
  buildProductionScopeExecutionBundle,
  executionBundleSha256,
  executionPlanSha256,
  inheritAuthorizedIdentityExecutionPlan,
  isAuthorizedIdentityExecutionPlan,
  validateAuthorizationBinding,
  validateProductionScopeExecutionBundle,
};
