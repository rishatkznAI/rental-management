const crypto = require('crypto');

const BUNDLE_VERSION = 1;
const BUNDLE_KIND = 'skytech-identity-bootstrap-review';
const REVIEW_STATUS = 'REVIEW_ONLY_NON_AUTHORIZING';
const UNRESOLVED = 'UNRESOLVED_EXECUTION_TIME_BINDING';
const SEALED_REVIEW = 'SEALED_PREPARATION_ARTIFACT';
const HISTORICAL_ONLY = 'HISTORICAL_SIMULATION_ONLY';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SHA40_PATTERN = /^[a-f0-9]{40}$/;

const COMPANY_ID = 'cmp_7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ';
const HEAD_OFFICE_ID = 'brn_VRNOM4ABOTHKRJYODGZSPVE3WPN6CGOJITLZBD2SCYWODKFF5NYQ';
const OWNER_PRINCIPAL_ID = '1775756913074';
const OWNER_MEMBERSHIP_ID = 'mbr_G2QDD6FEGGZ7TVGHUJQGJJM3JE4DM3HS43RNCDPUXXQ3BNZGAI7Q';
const ROLE_TEMPLATE_ID = 'company-administrator:v1';
const APPROVAL_REFERENCE = 'AUTHORITATIVE_PRINCIPAL_DISPOSITION_2026-09-01';
const EXPECTED_AUTHORITY_SNAPSHOT_FINGERPRINT = 'd4c5bd8f49712e72614755c6e21c0c0a04b37b41bbd0efd29ee6bcb479657926';
const CAPABILITY_CATALOG_V1_CHECKSUM = '2edf4f8648295c89d29311089e1ee322c6c5463b716e7db8ee7192e253e0ccc6';

class IdentityBootstrapExecutionBundleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IdentityBootstrapExecutionBundleError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new IdentityBootstrapExecutionBundleError(code, message);
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function exactKeys(value, expected, code, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, `${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (stableJson(actual) !== stableJson(required)) {
    fail(code, `${label} contains missing or unapproved fields.`);
  }
}

function assertExact(value, expected, code, message) {
  if (stableJson(value) !== stableJson(expected)) fail(code, message);
}

function assertSha256(value, code, label) {
  if (!SHA256_PATTERN.test(String(value || ''))) fail(code, `${label} must be an exact SHA-256.`);
  return value;
}

const AUTHORITY = deepFreeze({
  configVersion: 1,
  company: {
    id: COMPANY_ID,
    displayName: 'ООО "СКАЙТЕХ КОМПАНИ"',
    receivablesTimezone: 'Europe/Moscow',
  },
  branches: [{
    id: HEAD_OFFICE_ID,
    displayName: 'Головной офис',
    isHeadOffice: true,
    status: 'active',
  }],
  roleTemplates: [{
    templateKey: 'company-administrator',
    templateVersion: 1,
    displayName: 'Company Administrator',
    capabilities: ['branches.manage', 'companies.manage', 'members.manage'],
  }],
  memberships: [{
    id: OWNER_MEMBERSHIP_ID,
    principalId: OWNER_PRINCIPAL_ID,
    status: 'active',
    roleTemplateKey: 'company-administrator',
    roleTemplateVersion: 1,
    companyWideBranchAuthority: true,
    branchIds: [],
    capabilityAssignments: [],
  }],
  intentionallyUnmappedUserIds: [
    '1776673416137',
    '1787547467703',
    'DEMO-USER-CARRIER',
    'production-smoke-admin',
  ],
});

const PRINCIPAL_DISPOSITIONS = deepFreeze([
  {
    principalId: OWNER_PRINCIPAL_ID,
    displayName: 'Хабибрахманов Ришат Ринатович',
    disposition: 'CREATE_EXACT_MEMBERSHIP',
    membershipId: OWNER_MEMBERSHIP_ID,
    companyId: COMPANY_ID,
    roleTemplateId: ROLE_TEMPLATE_ID,
  },
  {
    principalId: '1776673416137',
    displayName: 'Мениса',
    email: 'kmzh@mantall.ru',
    disposition: 'INTENTIONALLY_UNMAPPED',
    preserveUserRecordExactly: true,
    membershipAcrossAllCompanies: 'NONE',
  },
  {
    principalId: '1787547467703',
    displayName: 'Айзат',
    email: 'mp2@mantall.ru',
    disposition: 'INTENTIONALLY_UNMAPPED',
    preserveUserRecordExactly: true,
    membershipAcrossAllCompanies: 'NONE',
  },
  {
    principalId: 'DEMO-USER-CARRIER',
    displayName: 'Demo Carrier User',
    disposition: 'INTENTIONALLY_UNMAPPED',
    preserveUserRecordExactly: true,
    membershipAcrossAllCompanies: 'NONE',
  },
  {
    principalId: 'production-smoke-admin',
    displayName: 'Production Smoke Admin',
    disposition: 'INTENTIONALLY_UNMAPPED',
    preserveUserRecordExactly: true,
    membershipAcrossAllCompanies: 'NONE',
  },
]);

const EXPECTED_ROW_COUNT_DELTAS = deepFreeze({
  canonical_companies: 1,
  canonical_branches: 1,
  company_memberships: 1,
  membership_branch_access: 0,
  role_templates: 1,
  role_template_capabilities: 3,
  membership_capability_assignments: 0,
  authorization_audit_events: 4,
  identity_bootstrap_runs: 1,
});

const EXPECTED_EXACT_CHANGES = deepFreeze({
  companies: 1,
  branches: 1,
  roleTemplates: 1,
  roleTemplateCapabilities: 3,
  memberships: 1,
  branchGrants: 0,
  capabilityAssignments: 0,
  authorizationAuditEvents: 4,
  bootstrapRuns: 1,
});

const AUDIT_EVENT_MANIFEST = deepFreeze([
  {
    ordinal: 1,
    action: 'company.authority.created',
    targetType: 'company',
    targetId: COMPANY_ID,
    companyId: COMPANY_ID,
    branchId: HEAD_OFFICE_ID,
    actorPrincipalId: OWNER_PRINCIPAL_ID,
  },
  {
    ordinal: 2,
    action: 'branch.created',
    targetType: 'branch',
    targetId: HEAD_OFFICE_ID,
    companyId: COMPANY_ID,
    branchId: HEAD_OFFICE_ID,
    actorPrincipalId: OWNER_PRINCIPAL_ID,
  },
  {
    ordinal: 3,
    action: 'role_template.created',
    targetType: 'role_template',
    targetId: ROLE_TEMPLATE_ID,
    companyId: COMPANY_ID,
    branchId: HEAD_OFFICE_ID,
    actorPrincipalId: OWNER_PRINCIPAL_ID,
  },
  {
    ordinal: 4,
    action: 'membership.created',
    targetType: 'membership',
    targetId: OWNER_MEMBERSHIP_ID,
    companyId: COMPANY_ID,
    branchId: HEAD_OFFICE_ID,
    actorPrincipalId: OWNER_PRINCIPAL_ID,
  },
]);

const WRITE_MANIFEST = deepFreeze({
  scope: 'IDENTITY_ONLY',
  uniqueAffectedRowCount: 12,
  expectedSqliteTotalChanges: 13,
  collectionWriteCount: 0,
  businessDataMutationCount: 0,
  schemaMutationCount: 0,
  migrationMutationCount: 0,
  tenantGuardMutationCount: 0,
  environmentMutationCount: 0,
  smokeIdentityMutationCount: 0,
  operations: [
    { sequence: 1, table: 'canonical_companies', operation: 'INSERT_INACTIVE', rowIdentity: COMPANY_ID },
    { sequence: 2, table: 'canonical_branches', operation: 'INSERT', rowIdentity: HEAD_OFFICE_ID },
    { sequence: 3, table: 'canonical_companies', operation: 'UPDATE_ACTIVATE', rowIdentity: COMPANY_ID },
    { sequence: 4, table: 'authorization_audit_events', operation: 'INSERT', rowIdentity: 'runtime:audit:1', targetId: COMPANY_ID },
    { sequence: 5, table: 'authorization_audit_events', operation: 'INSERT', rowIdentity: 'runtime:audit:2', targetId: HEAD_OFFICE_ID },
    { sequence: 6, table: 'role_templates', operation: 'INSERT', rowIdentity: `${COMPANY_ID}:${ROLE_TEMPLATE_ID}` },
    { sequence: 7, table: 'role_template_capabilities', operation: 'INSERT', rowIdentity: `${COMPANY_ID}:${ROLE_TEMPLATE_ID}:branches.manage` },
    { sequence: 8, table: 'role_template_capabilities', operation: 'INSERT', rowIdentity: `${COMPANY_ID}:${ROLE_TEMPLATE_ID}:companies.manage` },
    { sequence: 9, table: 'role_template_capabilities', operation: 'INSERT', rowIdentity: `${COMPANY_ID}:${ROLE_TEMPLATE_ID}:members.manage` },
    { sequence: 10, table: 'authorization_audit_events', operation: 'INSERT', rowIdentity: 'runtime:audit:3', targetId: ROLE_TEMPLATE_ID },
    { sequence: 11, table: 'company_memberships', operation: 'INSERT', rowIdentity: OWNER_MEMBERSHIP_ID },
    { sequence: 12, table: 'authorization_audit_events', operation: 'INSERT', rowIdentity: 'runtime:audit:4', targetId: OWNER_MEMBERSHIP_ID },
    { sequence: 13, table: 'identity_bootstrap_runs', operation: 'INSERT', rowIdentity: 'runtime:bootstrap-run:1' },
  ],
});

const NON_WRITE_SET = deepFreeze({
  appData: {
    table: 'app_data',
    allRows: 'BYTE_IDENTICAL',
    preservedColumns: ['name', 'json', 'updated_at'],
    mutationCount: 0,
  },
  userRecords: {
    storage: 'app_data.users',
    allUsersByteIdentical: true,
    explicitlyProtectedPrincipalIds: [
      OWNER_PRINCIPAL_ID,
      '1776673416137',
      '1787547467703',
      'DEMO-USER-CARRIER',
      'production-smoke-admin',
    ],
    mutationCount: 0,
  },
  businessData: {
    scope: 'ALL_APP_DATA_BUSINESS_AND_OPERATIONAL_COLLECTIONS',
    mutationCount: 0,
  },
  financialData: {
    relationalTables: [
      'canonical_receivables',
      'financial_audit_events',
      'canonical_payments',
      'canonical_payment_allocations',
      'canonical_receivable_adjustments',
      'canonical_approval_requests',
    ],
    appDataCollections: [
      'payments',
      'payment_allocations',
      'finance_accounts',
      'finance_operations',
      'company_expenses',
      'equipment_finance',
      'leasing_contracts',
      'leasing_payment_schedule',
      'payroll_profiles',
      'payroll_periods',
      'payroll_records',
      'payroll_adjustments',
      'payroll_audit_events',
    ],
    mutationCount: 0,
  },
  unrelatedIdentity: {
    tables: [
      'capability_catalog_versions',
      'capability_catalog_entries',
      'membership_branch_access',
      'membership_capability_assignments',
    ],
    mutationCount: 0,
  },
  schema: {
    sqliteMasterByteIdentical: true,
    schemaVersionUnchanged: true,
    userVersionUnchanged: true,
    applicationIdUnchanged: true,
    ddlStatementCount: 0,
  },
  migrations: {
    table: 'sql_shadow_schema_migrations',
    allRowsByteIdentical: true,
    mutationCount: 0,
  },
  tenantGuards: {
    persistentAndTemporaryGuardDefinitionsUnchanged: true,
    mutationCount: 0,
  },
  environment: {
    railwayConfigurationChanges: 0,
    appDisabledChanges: 0,
    processEnvironmentChanges: 0,
    deploymentOperations: 0,
  },
  smokeIdentity: {
    transition: 'FORBIDDEN',
    userCreateCount: 0,
    userUpdateCount: 0,
    roleTemplateCreateCount: 0,
    membershipCreateCount: 0,
  },
});

const DETERMINISTIC_RUNTIME_IDS = deepFreeze({
  status: UNRESOLVED,
  seedBinding: 'executionPlanChecksum',
  algorithm: 'sha256(`${executionPlanChecksum}:${ordinal}:${prefix}`) with UUIDv4/version and a/variant bits projected by the guarded runner',
  auditEventIds: [1, 2, 3, 4].map(ordinal => ({
    ordinal,
    prefix: 'authorization-audit',
    value: null,
  })),
  bootstrapRunId: {
    ordinal: 5,
    prefix: 'identity-bootstrap',
    value: null,
  },
  timestampBinding: 'freshBackupReceipt.generatedAt',
});

const DETERMINISTIC_IDENTITY_POSTCONDITIONS = deepFreeze({
  authoritySnapshot: {
    version: 1,
    fingerprint: EXPECTED_AUTHORITY_SNAPSHOT_FINGERPRINT,
  },
  capabilityCatalog: {
    version: 1,
    checksum: CAPABILITY_CATALOG_V1_CHECKSUM,
    mutationCount: 0,
  },
  fullDatabaseExpectedPostStateFingerprint: {
    status: UNRESOLVED,
    value: null,
    binding: 'future receipt-bound read-only simulation of a fresh production backup copy',
  },
});

const REQUIRED_RUNTIME_BINDINGS = deepFreeze([
  'approvedAt',
  'backupReference',
  'authorityConfigChecksum',
  'schemaFingerprint',
  'usersDirectoryFingerprint',
  'userInventoryFingerprint',
  'captureDeployedSha',
  'captureDeploymentId',
  'sourceSnapshotSha256',
  'stateFingerprint',
  'appDataFingerprint',
  'databaseContentFingerprint',
  'durableFileSetFingerprint',
  'observedFileSetFingerprint',
  'authorizedExecutionSha',
  'executionPlanChecksum',
  'freshBackupReceipt',
  'expectedPostStateFingerprint',
]);

const IDENTITY_COUNT_KEYS = Object.freeze(Object.keys(EXPECTED_ROW_COUNT_DELTAS));
const FINANCIAL_TABLES = Object.freeze([...NON_WRITE_SET.financialData.relationalTables]);

function exactAuthorityProjection(normalized) {
  return {
    configVersion: normalized?.configVersion,
    company: normalized?.company,
    branches: normalized?.branches,
    roleTemplates: normalized?.roleTemplates,
    memberships: normalized?.memberships,
    intentionallyUnmappedUserIds: normalized?.intentionallyUnmappedUserIds,
  };
}

function canonicalAuthorityPayload() {
  return deepFreeze(clone(AUTHORITY));
}

function buildCanonicalIdentityBootstrapConfig({
  approvedAt,
  schemaFingerprint,
  backupReference = 'UNRESOLVED_FRESH_PRODUCTION_BACKUP',
  configChecksum,
} = {}) {
  if (typeof approvedAt !== 'string' || !approvedAt.trim()) {
    fail('IDENTITY_APPROVED_AT_REQUIRED', 'An explicit approval timestamp is required.');
  }
  assertSha256(
    schemaFingerprint,
    'IDENTITY_SCHEMA_FINGERPRINT_INVALID',
    'schemaFingerprint',
  );
  if (typeof backupReference !== 'string' || !backupReference.trim()) {
    fail('IDENTITY_BACKUP_REFERENCE_REQUIRED', 'A backup binding or explicit unresolved marker is required.');
  }
  if (configChecksum !== undefined && configChecksum !== null) {
    assertSha256(
      configChecksum,
      'IDENTITY_CONFIG_CHECKSUM_INVALID',
      'configChecksum',
    );
  }
  const payload = clone(AUTHORITY);
  payload.approval = {
    approvedBy: OWNER_PRINCIPAL_ID,
    approvedAt: approvedAt.trim(),
    approvalReference: APPROVAL_REFERENCE,
    backupReference: backupReference.trim(),
    schemaFingerprint,
    ...(configChecksum ? { configChecksum } : {}),
  };
  return deepFreeze(payload);
}

function exactCountProjection(value, keys, code, label) {
  exactKeys(value, keys, code, label);
  return Object.fromEntries(keys.map(key => [key, Number(value[key])]));
}

function resolvePlanInput({ identityPlan, sourceSnapshot } = {}) {
  if (identityPlan !== undefined && sourceSnapshot !== undefined) {
    fail('IDENTITY_REVIEW_SOURCE_AMBIGUOUS', 'Provide either an identity plan or a source snapshot, not both.');
  }
  if (identityPlan !== undefined) {
    return { sourceKind: 'planPlatformIdentityBootstrap', plan: identityPlan, snapshot: null };
  }
  if (sourceSnapshot !== undefined) {
    const plan = sourceSnapshot?.identityPlan
      || sourceSnapshot?.bootstrapPlan
      || sourceSnapshot?.bootstrapProjection
      || sourceSnapshot;
    return { sourceKind: 'sourceSnapshot', plan, snapshot: sourceSnapshot };
  }
  fail('IDENTITY_REVIEW_SOURCE_REQUIRED', 'A read-only bootstrap plan or source snapshot is required.');
}

function optionalSourceBinding(value, pattern, code, label) {
  if (value === undefined || value === null || value === '') return null;
  if (!pattern.test(String(value))) fail(code, `${label} is invalid.`);
  return String(value);
}

function projectIdentityBootstrapReview(input = {}) {
  const resolved = resolvePlanInput(input);
  const plan = resolved.plan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    fail('IDENTITY_PLAN_INVALID', 'The read-only identity plan is invalid.');
  }
  if (plan.mode !== 'plan' || plan.ok !== true || Number(plan.writes) !== 0) {
    fail('IDENTITY_PLAN_NOT_READ_ONLY_READY', 'The identity plan must be a successful zero-write plan projection.');
  }
  assertExact(
    exactAuthorityProjection(plan.normalized),
    AUTHORITY,
    'IDENTITY_AUTHORITY_DRIFT',
    'The projected identity authority differs from the owner-approved authority.',
  );
  assertExact(
    sorted(plan.mappedUserIds || []),
    [OWNER_PRINCIPAL_ID],
    'IDENTITY_MAPPED_PRINCIPAL_DRIFT',
    'The projected mapped-principal set is not exact.',
  );
  assertExact(
    sorted(plan.intentionallyUnmappedUserIds || []),
    sorted(AUTHORITY.intentionallyUnmappedUserIds),
    'IDENTITY_UNMAPPED_PRINCIPAL_DRIFT',
    'The intentionally-unmapped principal set is not exact.',
  );
  assertExact(
    sorted(plan.eligibleActiveUserIds || []),
    sorted([OWNER_PRINCIPAL_ID, ...AUTHORITY.intentionallyUnmappedUserIds]),
    'IDENTITY_ELIGIBLE_PRINCIPAL_DRIFT',
    'Every eligible active principal must have the exact approved disposition.',
  );
  if (plan.approvedBy !== OWNER_PRINCIPAL_ID) {
    fail('IDENTITY_APPROVER_DRIFT', 'The bootstrap approver must be the exact approved owner principal.');
  }
  if (plan.normalized?.approval?.approvalReference !== APPROVAL_REFERENCE) {
    fail(
      'IDENTITY_APPROVAL_REFERENCE_DRIFT',
      'The bootstrap plan must carry the exact authoritative principal-disposition reference.',
    );
  }
  const historicalApprovedAt = plan.normalized?.approval?.approvedAt;
  if (
    typeof historicalApprovedAt !== 'string'
    || !historicalApprovedAt.trim()
    || !Number.isFinite(Date.parse(historicalApprovedAt))
  ) {
    fail(
      'IDENTITY_HISTORICAL_APPROVAL_TIMESTAMP_INVALID',
      'The historical simulation approval timestamp must be valid evidence.',
    );
  }
  const historicalBackupReference = plan.normalized?.approval?.backupReference;
  if (typeof historicalBackupReference !== 'string' || !historicalBackupReference.trim()) {
    fail(
      'IDENTITY_HISTORICAL_BACKUP_REFERENCE_INVALID',
      'The historical simulation backup reference must be valid evidence.',
    );
  }

  const exactChanges = exactCountProjection(
    plan.exactChanges,
    Object.keys(EXPECTED_EXACT_CHANGES),
    'IDENTITY_CHANGE_MANIFEST_INVALID',
    'exactChanges',
  );
  assertExact(
    exactChanges,
    EXPECTED_EXACT_CHANGES,
    'IDENTITY_CHANGE_MANIFEST_DRIFT',
    'The read-only plan has an unapproved identity mutation.',
  );
  const beforeIdentityCounts = exactCountProjection(
    plan.beforeCounts,
    IDENTITY_COUNT_KEYS,
    'IDENTITY_BEFORE_COUNTS_INVALID',
    'beforeCounts',
  );
  assertExact(
    beforeIdentityCounts,
    Object.fromEntries(IDENTITY_COUNT_KEYS.map(key => [key, 0])),
    'IDENTITY_AUTHORITY_NOT_EMPTY',
    'The identity-only bootstrap requires an exact empty authority source.',
  );
  const afterIdentityCounts = exactCountProjection(
    plan.afterCounts,
    IDENTITY_COUNT_KEYS,
    'IDENTITY_AFTER_COUNTS_INVALID',
    'afterCounts',
  );
  assertExact(
    afterIdentityCounts,
    EXPECTED_ROW_COUNT_DELTAS,
    'IDENTITY_AFTER_COUNTS_DRIFT',
    'The projected post-state identity counts are not exact.',
  );
  const financialCounts = exactCountProjection(
    plan.financialCounts,
    FINANCIAL_TABLES,
    'IDENTITY_FINANCIAL_COUNTS_INVALID',
    'financialCounts',
  );
  assertExact(
    financialCounts,
    Object.fromEntries(FINANCIAL_TABLES.map(table => [table, 0])),
    'IDENTITY_FINANCIAL_STATE_NOT_EMPTY',
    'The identity-only bootstrap requires every guarded financial table to remain empty.',
  );

  assertSha256(plan.configChecksum, 'IDENTITY_CONFIG_CHECKSUM_INVALID', 'configChecksum');
  assertSha256(plan.schemaFingerprint, 'IDENTITY_SCHEMA_FINGERPRINT_INVALID', 'schemaFingerprint');
  assertSha256(
    plan.usersDirectoryFingerprint,
    'IDENTITY_USERS_FINGERPRINT_INVALID',
    'usersDirectoryFingerprint',
  );

  const snapshot = resolved.snapshot || {};
  const bindings = input.sourceBindings || snapshot.sourceBindings || snapshot.source || {};
  const sourceProjection = {
    projectionVersion: 1,
    sourceKind: resolved.sourceKind,
    evidenceClassification: HISTORICAL_ONLY,
    planMode: plan.mode,
    planOk: plan.ok,
    reportedWrites: Number(plan.writes),
    authorityConfigChecksum: plan.configChecksum,
    schemaFingerprint: plan.schemaFingerprint,
    usersDirectoryFingerprint: plan.usersDirectoryFingerprint,
    approvedBy: plan.approvedBy,
    approvalReference: plan.normalized.approval.approvalReference,
    historicalApprovedAt: historicalApprovedAt.trim(),
    historicalBackupReference: historicalBackupReference.trim(),
    eligibleActivePrincipalIds: sorted(plan.eligibleActiveUserIds),
    mappedPrincipalIds: sorted(plan.mappedUserIds),
    intentionallyUnmappedPrincipalIds: sorted(plan.intentionallyUnmappedUserIds),
    beforeIdentityCounts,
    afterIdentityCounts,
    financialCounts,
    exactChanges,
    sourceBindings: {
      captureDeployedSha: optionalSourceBinding(
        bindings.captureDeployedSha,
        SHA40_PATTERN,
        'IDENTITY_CAPTURE_SHA_INVALID',
        'captureDeployedSha',
      ),
      captureDeploymentId: (() => {
        const value = bindings.captureDeploymentId;
        if (value === undefined || value === null || value === '') return null;
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(value))) {
          fail('IDENTITY_CAPTURE_DEPLOYMENT_ID_INVALID', 'captureDeploymentId is invalid.');
        }
        return String(value).toLowerCase();
      })(),
      sourceSnapshotSha256: optionalSourceBinding(
        bindings.sourceSnapshotSha256,
        SHA256_PATTERN,
        'IDENTITY_SOURCE_SNAPSHOT_HASH_INVALID',
        'sourceSnapshotSha256',
      ),
      stateFingerprint: optionalSourceBinding(
        bindings.stateFingerprint,
        SHA256_PATTERN,
        'IDENTITY_STATE_FINGERPRINT_INVALID',
        'stateFingerprint',
      ),
      appDataFingerprint: optionalSourceBinding(
        bindings.appDataFingerprint,
        SHA256_PATTERN,
        'IDENTITY_APP_DATA_FINGERPRINT_INVALID',
        'appDataFingerprint',
      ),
      userInventoryFingerprint: optionalSourceBinding(
        bindings.userInventoryFingerprint,
        SHA256_PATTERN,
        'IDENTITY_USER_INVENTORY_FINGERPRINT_INVALID',
        'userInventoryFingerprint',
      ),
      databaseContentFingerprint: optionalSourceBinding(
        bindings.databaseContentFingerprint,
        SHA256_PATTERN,
        'IDENTITY_DATABASE_FINGERPRINT_INVALID',
        'databaseContentFingerprint',
      ),
      durableFileSetFingerprint: optionalSourceBinding(
        bindings.durableFileSetFingerprint,
        SHA256_PATTERN,
        'IDENTITY_DURABLE_FILE_SET_INVALID',
        'durableFileSetFingerprint',
      ),
      observedFileSetFingerprint: optionalSourceBinding(
        bindings.observedFileSetFingerprint,
        SHA256_PATTERN,
        'IDENTITY_OBSERVED_FILE_SET_INVALID',
        'observedFileSetFingerprint',
      ),
    },
  };
  return deepFreeze(sourceProjection);
}

function preparedPlanPayload(sourceProjection) {
  return {
    preparedPlanVersion: 1,
    approvalReference: APPROVAL_REFERENCE,
    authority: AUTHORITY,
    principalDispositions: PRINCIPAL_DISPOSITIONS,
    expectedRowCountDeltas: EXPECTED_ROW_COUNT_DELTAS,
    auditEventManifest: AUDIT_EVENT_MANIFEST,
    writeManifest: WRITE_MANIFEST,
    nonWriteSet: NON_WRITE_SET,
    deterministicRuntimeIds: DETERMINISTIC_RUNTIME_IDS,
    deterministicIdentityPostconditions: DETERMINISTIC_IDENTITY_POSTCONDITIONS,
    sourceProjection,
  };
}

function preparedPlanSha256(sourceProjection) {
  return sha256(stableJson(preparedPlanPayload(sourceProjection)));
}

function authorityDecisionSha256() {
  return sha256(stableJson({
    approvalReference: APPROVAL_REFERENCE,
    authority: AUTHORITY,
    principalDispositions: PRINCIPAL_DISPOSITIONS,
  }));
}

function historicalSimulationEvidenceFromProjection(sourceProjection) {
  return {
    classification: HISTORICAL_ONLY,
    productionAuthorizationValue: 'NONE',
    authorityConfigChecksum: sourceProjection.authorityConfigChecksum,
    schemaFingerprint: sourceProjection.schemaFingerprint,
    usersDirectoryFingerprint: sourceProjection.usersDirectoryFingerprint,
    approvedAt: sourceProjection.historicalApprovedAt,
    backupReference: sourceProjection.historicalBackupReference,
    captureDeployedSha: sourceProjection.sourceBindings.captureDeployedSha,
    captureDeploymentId: sourceProjection.sourceBindings.captureDeploymentId,
    sourceSnapshotSha256: sourceProjection.sourceBindings.sourceSnapshotSha256,
    stateFingerprint: sourceProjection.sourceBindings.stateFingerprint,
    appDataFingerprint: sourceProjection.sourceBindings.appDataFingerprint,
    userInventoryFingerprint: sourceProjection.sourceBindings.userInventoryFingerprint,
    databaseContentFingerprint: sourceProjection.sourceBindings.databaseContentFingerprint,
    durableFileSetFingerprint: sourceProjection.sourceBindings.durableFileSetFingerprint,
    observedFileSetFingerprint: sourceProjection.sourceBindings.observedFileSetFingerprint,
  };
}

function runtimeBindingsFromProjection(sourceProjection, sealedPreparedPlanSha256) {
  const unresolved = binding => ({ status: UNRESOLVED, value: null, binding });
  return {
    approvedAt: unresolved('future exact machine timestamp separately approved for execution'),
    backupReference: unresolved('freshBackupReceipt.reference'),
    authorityConfigChecksum: unresolved('fresh production planPlatformIdentityBootstrap.configChecksum'),
    schemaFingerprint: unresolved('fresh production planPlatformIdentityBootstrap.schemaFingerprint'),
    usersDirectoryFingerprint: unresolved('fresh production planPlatformIdentityBootstrap.usersDirectoryFingerprint'),
    userInventoryFingerprint: unresolved('fresh production complete users inventory fingerprint'),
    preparedPlanSha256: {
      status: SEALED_REVIEW,
      value: sealedPreparedPlanSha256,
      binding: 'deterministic read-only identity preparation payload',
    },
    captureDeployedSha: unresolved('fresh production source-capture deployed SHA'),
    captureDeploymentId: unresolved('fresh production source-capture deployment identity'),
    sourceSnapshotSha256: unresolved('fresh production source snapshot'),
    stateFingerprint: unresolved('fresh production guarded state/CAS fingerprint'),
    appDataFingerprint: unresolved('fresh production exact app_data non-write fingerprint'),
    databaseContentFingerprint: unresolved('fresh production logical database content'),
    durableFileSetFingerprint: unresolved('fresh production durable DB/WAL file set'),
    observedFileSetFingerprint: unresolved('fresh production observed DB/WAL/SHM file set'),
    authorizedExecutionSha: unresolved('future exact deployed main mechanism SHA; authorized bundle bytes stay external to Git and require an independently provisioned SHA-256 pin'),
    executionPlanChecksum: unresolved('receipt-bound guarded execution plan'),
    freshBackupReceipt: unresolved('future separately authorized coherent production backup receipt'),
    expectedPostStateFingerprint: unresolved('read-only simulation of the receipt-bound disposable backup copy'),
  };
}

function bindingCompleteness(runtimeBindings) {
  const unresolvedKeys = Object.entries(runtimeBindings)
    .filter(([, binding]) => binding.status === UNRESOLVED)
    .map(([key]) => key)
    .sort();
  for (const required of REQUIRED_RUNTIME_BINDINGS) {
    if (!unresolvedKeys.includes(required)) {
      fail(
        'IDENTITY_REVIEW_RUNTIME_BINDING_STATE_INVALID',
        'A review-only bundle cannot resolve an execution-time authorization binding.',
      );
    }
  }
  return {
    complete: false,
    authorizationReady: false,
    unresolvedKeys,
    nextCheckpoint: 'SEPARATE_EXPLICIT_PRODUCTION_STAGE_AUTHORIZATION_REQUIRED',
  };
}

const TOP_LEVEL_KEYS = Object.freeze([
  'bundleVersion',
  'kind',
  'status',
  'productionExecutionAuthorized',
  'executionCapability',
  'writesPerformed',
  'approvalReference',
  'authorityDecisionSha256',
  'preparedPlanSha256',
  'authority',
  'principalDispositions',
  'expectedRowCountDeltas',
  'auditEventManifest',
  'writeManifest',
  'nonWriteSet',
  'deterministicRuntimeIds',
  'deterministicIdentityPostconditions',
  'historicalSimulationEvidence',
  'runtimeBindings',
  'bindingCompleteness',
  'sourceProjection',
  'hashes',
]);

const HASH_KEYS = Object.freeze([
  'authoritySha256',
  'principalDispositionsSha256',
  'expectedRowCountDeltasSha256',
  'auditEventManifestSha256',
  'writeManifestSha256',
  'nonWriteSetSha256',
  'deterministicRuntimeIdsSha256',
  'deterministicIdentityPostconditionsSha256',
  'historicalSimulationEvidenceSha256',
  'runtimeBindingsSha256',
  'sourceProjectionSha256',
  'bundleSha256',
]);

function identityBootstrapExecutionBundleSha256(bundle) {
  const projected = clone(bundle);
  if (projected.hashes) delete projected.hashes.bundleSha256;
  return sha256(stableJson(projected));
}

function buildIdentityBootstrapExecutionBundle(input = {}) {
  const sourceProjection = projectIdentityBootstrapReview(input);
  const sealedPreparedPlanSha256 = preparedPlanSha256(sourceProjection);
  const historicalSimulationEvidence = historicalSimulationEvidenceFromProjection(
    sourceProjection,
  );
  const runtimeBindings = runtimeBindingsFromProjection(
    sourceProjection,
    sealedPreparedPlanSha256,
  );
  const completeness = bindingCompleteness(runtimeBindings);
  const bundle = {
    bundleVersion: BUNDLE_VERSION,
    kind: BUNDLE_KIND,
    status: REVIEW_STATUS,
    productionExecutionAuthorized: false,
    executionCapability: 'NONE',
    writesPerformed: 0,
    approvalReference: APPROVAL_REFERENCE,
    authorityDecisionSha256: authorityDecisionSha256(),
    preparedPlanSha256: sealedPreparedPlanSha256,
    authority: clone(AUTHORITY),
    principalDispositions: clone(PRINCIPAL_DISPOSITIONS),
    expectedRowCountDeltas: clone(EXPECTED_ROW_COUNT_DELTAS),
    auditEventManifest: clone(AUDIT_EVENT_MANIFEST),
    writeManifest: clone(WRITE_MANIFEST),
    nonWriteSet: clone(NON_WRITE_SET),
    deterministicRuntimeIds: clone(DETERMINISTIC_RUNTIME_IDS),
    deterministicIdentityPostconditions: clone(DETERMINISTIC_IDENTITY_POSTCONDITIONS),
    historicalSimulationEvidence,
    runtimeBindings,
    bindingCompleteness: completeness,
    sourceProjection: clone(sourceProjection),
    hashes: {
      authoritySha256: sha256(stableJson(AUTHORITY)),
      principalDispositionsSha256: sha256(stableJson(PRINCIPAL_DISPOSITIONS)),
      expectedRowCountDeltasSha256: sha256(stableJson(EXPECTED_ROW_COUNT_DELTAS)),
      auditEventManifestSha256: sha256(stableJson(AUDIT_EVENT_MANIFEST)),
      writeManifestSha256: sha256(stableJson(WRITE_MANIFEST)),
      nonWriteSetSha256: sha256(stableJson(NON_WRITE_SET)),
      deterministicRuntimeIdsSha256: sha256(stableJson(DETERMINISTIC_RUNTIME_IDS)),
      deterministicIdentityPostconditionsSha256: sha256(
        stableJson(DETERMINISTIC_IDENTITY_POSTCONDITIONS),
      ),
      historicalSimulationEvidenceSha256: sha256(stableJson(historicalSimulationEvidence)),
      runtimeBindingsSha256: sha256(stableJson(runtimeBindings)),
      sourceProjectionSha256: sha256(stableJson(sourceProjection)),
    },
  };
  bundle.hashes.bundleSha256 = identityBootstrapExecutionBundleSha256(bundle);
  validateIdentityBootstrapExecutionBundle(bundle);
  return deepFreeze(bundle);
}

function validateSourceProjection(sourceProjection) {
  exactKeys(sourceProjection, [
    'projectionVersion',
    'sourceKind',
    'evidenceClassification',
    'planMode',
    'planOk',
    'reportedWrites',
    'authorityConfigChecksum',
    'schemaFingerprint',
    'usersDirectoryFingerprint',
    'approvedBy',
    'approvalReference',
    'historicalApprovedAt',
    'historicalBackupReference',
    'eligibleActivePrincipalIds',
    'mappedPrincipalIds',
    'intentionallyUnmappedPrincipalIds',
    'beforeIdentityCounts',
    'afterIdentityCounts',
    'financialCounts',
    'exactChanges',
    'sourceBindings',
  ], 'IDENTITY_SOURCE_PROJECTION_INVALID', 'sourceProjection');
  if (
    sourceProjection.projectionVersion !== 1
    || !['planPlatformIdentityBootstrap', 'sourceSnapshot'].includes(sourceProjection.sourceKind)
    || sourceProjection.evidenceClassification !== HISTORICAL_ONLY
    || sourceProjection.planMode !== 'plan'
    || sourceProjection.planOk !== true
    || sourceProjection.reportedWrites !== 0
    || sourceProjection.approvedBy !== OWNER_PRINCIPAL_ID
    || sourceProjection.approvalReference !== APPROVAL_REFERENCE
  ) {
    fail('IDENTITY_SOURCE_PROJECTION_INVALID', 'The source projection is not an exact zero-write review input.');
  }
  assertSha256(sourceProjection.authorityConfigChecksum, 'IDENTITY_SOURCE_PROJECTION_INVALID', 'authorityConfigChecksum');
  assertSha256(sourceProjection.schemaFingerprint, 'IDENTITY_SOURCE_PROJECTION_INVALID', 'schemaFingerprint');
  assertSha256(sourceProjection.usersDirectoryFingerprint, 'IDENTITY_SOURCE_PROJECTION_INVALID', 'usersDirectoryFingerprint');
  if (
    typeof sourceProjection.historicalApprovedAt !== 'string'
    || !Number.isFinite(Date.parse(sourceProjection.historicalApprovedAt))
    || typeof sourceProjection.historicalBackupReference !== 'string'
    || !sourceProjection.historicalBackupReference.trim()
  ) {
    fail(
      'IDENTITY_SOURCE_PROJECTION_INVALID',
      'Historical approval and backup values must remain explicit simulation evidence.',
    );
  }
  assertExact(sourceProjection.mappedPrincipalIds, [OWNER_PRINCIPAL_ID], 'IDENTITY_SOURCE_PROJECTION_DRIFT', 'Mapped principals drifted.');
  assertExact(sourceProjection.intentionallyUnmappedPrincipalIds, sorted(AUTHORITY.intentionallyUnmappedUserIds), 'IDENTITY_SOURCE_PROJECTION_DRIFT', 'Unmapped principals drifted.');
  assertExact(sourceProjection.eligibleActivePrincipalIds, sorted([OWNER_PRINCIPAL_ID, ...AUTHORITY.intentionallyUnmappedUserIds]), 'IDENTITY_SOURCE_PROJECTION_DRIFT', 'Eligible principals drifted.');
  assertExact(sourceProjection.beforeIdentityCounts, Object.fromEntries(IDENTITY_COUNT_KEYS.map(key => [key, 0])), 'IDENTITY_SOURCE_PROJECTION_DRIFT', 'Before counts drifted.');
  assertExact(sourceProjection.afterIdentityCounts, EXPECTED_ROW_COUNT_DELTAS, 'IDENTITY_SOURCE_PROJECTION_DRIFT', 'After counts drifted.');
  assertExact(sourceProjection.exactChanges, EXPECTED_EXACT_CHANGES, 'IDENTITY_SOURCE_PROJECTION_DRIFT', 'Exact changes drifted.');
  assertExact(sourceProjection.financialCounts, Object.fromEntries(FINANCIAL_TABLES.map(table => [table, 0])), 'IDENTITY_SOURCE_PROJECTION_DRIFT', 'Financial counts drifted.');
  exactKeys(sourceProjection.sourceBindings, [
    'captureDeployedSha',
    'captureDeploymentId',
    'sourceSnapshotSha256',
    'stateFingerprint',
    'appDataFingerprint',
    'userInventoryFingerprint',
    'databaseContentFingerprint',
    'durableFileSetFingerprint',
    'observedFileSetFingerprint',
  ], 'IDENTITY_SOURCE_BINDINGS_INVALID', 'sourceProjection.sourceBindings');
  for (const [key, value] of Object.entries(sourceProjection.sourceBindings)) {
    if (value === null) continue;
    if (key === 'captureDeploymentId') {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) {
        fail('IDENTITY_SOURCE_BINDINGS_INVALID', `Invalid source binding: ${key}.`);
      }
      continue;
    }
    const pattern = key === 'captureDeployedSha' ? SHA40_PATTERN : SHA256_PATTERN;
    if (!pattern.test(value)) fail('IDENTITY_SOURCE_BINDINGS_INVALID', `Invalid source binding: ${key}.`);
  }
}

function validateIdentityBootstrapExecutionBundle(bundle) {
  exactKeys(bundle, TOP_LEVEL_KEYS, 'IDENTITY_BUNDLE_FIELDS_INVALID', 'bundle');
  if (
    bundle.bundleVersion !== BUNDLE_VERSION
    || bundle.kind !== BUNDLE_KIND
    || bundle.status !== REVIEW_STATUS
    || bundle.productionExecutionAuthorized !== false
    || bundle.executionCapability !== 'NONE'
    || bundle.writesPerformed !== 0
    || bundle.approvalReference !== APPROVAL_REFERENCE
  ) {
    fail(
      'IDENTITY_BUNDLE_AUTHORIZATION_FORBIDDEN',
      'This artifact is review-only, performs no writes, and cannot carry execution authorization.',
    );
  }
  if (bundle.authorityDecisionSha256 !== authorityDecisionSha256()) {
    fail('IDENTITY_BUNDLE_AUTHORITY_DECISION_HASH_MISMATCH', 'The authority-decision hash changed.');
  }
  assertExact(bundle.authority, AUTHORITY, 'IDENTITY_BUNDLE_AUTHORITY_DRIFT', 'The sealed authority changed.');
  assertExact(bundle.principalDispositions, PRINCIPAL_DISPOSITIONS, 'IDENTITY_BUNDLE_DISPOSITION_DRIFT', 'The principal dispositions changed.');
  assertExact(bundle.expectedRowCountDeltas, EXPECTED_ROW_COUNT_DELTAS, 'IDENTITY_BUNDLE_DELTA_DRIFT', 'The exact row-count deltas changed.');
  assertExact(bundle.auditEventManifest, AUDIT_EVENT_MANIFEST, 'IDENTITY_BUNDLE_AUDIT_DRIFT', 'The exact audit-event manifest changed.');
  assertExact(bundle.writeManifest, WRITE_MANIFEST, 'IDENTITY_BUNDLE_WRITE_MANIFEST_DRIFT', 'The exact SQL/write manifest changed.');
  assertExact(bundle.nonWriteSet, NON_WRITE_SET, 'IDENTITY_BUNDLE_NON_WRITE_DRIFT', 'The explicit non-write set changed.');
  assertExact(bundle.deterministicRuntimeIds, DETERMINISTIC_RUNTIME_IDS, 'IDENTITY_BUNDLE_RUNTIME_ID_DRIFT', 'The deterministic runtime-ID bindings changed.');
  assertExact(
    bundle.deterministicIdentityPostconditions,
    DETERMINISTIC_IDENTITY_POSTCONDITIONS,
    'IDENTITY_BUNDLE_DETERMINISTIC_POSTCONDITION_DRIFT',
    'The deterministic identity postconditions changed.',
  );
  validateSourceProjection(bundle.sourceProjection);
  const expectedHistoricalEvidence = historicalSimulationEvidenceFromProjection(
    bundle.sourceProjection,
  );
  assertExact(
    bundle.historicalSimulationEvidence,
    expectedHistoricalEvidence,
    'IDENTITY_BUNDLE_HISTORICAL_EVIDENCE_DRIFT',
    'Historical simulation evidence changed or was promoted to an execution binding.',
  );
  const expectedPreparedPlanSha256 = preparedPlanSha256(bundle.sourceProjection);
  if (bundle.preparedPlanSha256 !== expectedPreparedPlanSha256) {
    fail('IDENTITY_BUNDLE_PREPARED_PLAN_HASH_MISMATCH', 'The prepared-plan hash changed.');
  }
  const expectedRuntimeBindings = runtimeBindingsFromProjection(
    bundle.sourceProjection,
    expectedPreparedPlanSha256,
  );
  assertExact(bundle.runtimeBindings, expectedRuntimeBindings, 'IDENTITY_BUNDLE_RUNTIME_BINDING_DRIFT', 'The runtime bindings changed.');
  const expectedCompleteness = bindingCompleteness(expectedRuntimeBindings);
  assertExact(bundle.bindingCompleteness, expectedCompleteness, 'IDENTITY_BUNDLE_BINDING_COMPLETENESS_DRIFT', 'The binding-completeness state changed.');
  exactKeys(bundle.hashes, HASH_KEYS, 'IDENTITY_BUNDLE_HASH_FIELDS_INVALID', 'hashes');
  const expectedHashes = {
    authoritySha256: sha256(stableJson(AUTHORITY)),
    principalDispositionsSha256: sha256(stableJson(PRINCIPAL_DISPOSITIONS)),
    expectedRowCountDeltasSha256: sha256(stableJson(EXPECTED_ROW_COUNT_DELTAS)),
    auditEventManifestSha256: sha256(stableJson(AUDIT_EVENT_MANIFEST)),
    writeManifestSha256: sha256(stableJson(WRITE_MANIFEST)),
    nonWriteSetSha256: sha256(stableJson(NON_WRITE_SET)),
    deterministicRuntimeIdsSha256: sha256(stableJson(DETERMINISTIC_RUNTIME_IDS)),
    deterministicIdentityPostconditionsSha256: sha256(
      stableJson(DETERMINISTIC_IDENTITY_POSTCONDITIONS),
    ),
    historicalSimulationEvidenceSha256: sha256(stableJson(expectedHistoricalEvidence)),
    runtimeBindingsSha256: sha256(stableJson(expectedRuntimeBindings)),
    sourceProjectionSha256: sha256(stableJson(bundle.sourceProjection)),
  };
  for (const [key, expected] of Object.entries(expectedHashes)) {
    if (bundle.hashes[key] !== expected) {
      fail('IDENTITY_BUNDLE_SECTION_HASH_MISMATCH', `Section hash mismatch: ${key}.`);
    }
  }
  if (bundle.hashes.bundleSha256 !== identityBootstrapExecutionBundleSha256(bundle)) {
    fail('IDENTITY_BUNDLE_HASH_MISMATCH', 'The sealed review-bundle hash is inconsistent.');
  }
  return deepFreeze({
    valid: true,
    reviewOnly: true,
    productionExecutionAuthorized: false,
    bundleSha256: bundle.hashes.bundleSha256,
    bindingCompleteness: clone(bundle.bindingCompleteness),
  });
}

module.exports = {
  APPROVAL_REFERENCE,
  AUDIT_EVENT_MANIFEST,
  AUTHORITY,
  BUNDLE_KIND,
  BUNDLE_VERSION,
  CAPABILITY_CATALOG_V1_CHECKSUM,
  COMPANY_ID,
  DETERMINISTIC_IDENTITY_POSTCONDITIONS,
  DETERMINISTIC_RUNTIME_IDS,
  EXPECTED_AUTHORITY_SNAPSHOT_FINGERPRINT,
  EXPECTED_EXACT_CHANGES,
  EXPECTED_ROW_COUNT_DELTAS,
  HEAD_OFFICE_ID,
  IdentityBootstrapExecutionBundleError,
  NON_WRITE_SET,
  OWNER_MEMBERSHIP_ID,
  OWNER_PRINCIPAL_ID,
  PRINCIPAL_DISPOSITIONS,
  REVIEW_STATUS,
  ROLE_TEMPLATE_ID,
  WRITE_MANIFEST,
  buildIdentityBootstrapExecutionBundle,
  buildCanonicalIdentityBootstrapConfig,
  canonicalAuthorityPayload,
  identityBootstrapExecutionBundleSha256,
  preparedPlanSha256,
  projectIdentityBootstrapReview,
  validateIdentityBootstrapExecutionBundle,
};
