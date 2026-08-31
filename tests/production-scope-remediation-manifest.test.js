import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createPlatformIdentityContext } from './platform-identity-fixtures.js';

const require = createRequire(import.meta.url);
const {
  applyProductionScopeRemediation,
  databaseIdentity,
  planProductionScopeRemediation,
  recordFingerprint,
  stableJson,
} = require('../server/lib/production-scope-remediation.js');
const {
  buildExecutionPlanFromManifest,
  buildProductionScopeManifest,
  calculateSourceSnapshotHash,
  manifestHash,
} = require('../server/lib/production-scope-remediation-manifest.js');
const {
  PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
  PRODUCTION_BASELINE_CONTRACT,
  currentRepositorySourceBindingsFingerprint,
} = require('../server/lib/production-scope-evidence-builder.js');
const {
  stableJsonSha256: baselineStableJsonSha256,
} = require('../server/lib/production-scope-baseline-contract.js');
const {
  classificationAuthoritySnapshot,
} = require('../server/lib/production-scope-evidence-classification.js');
const {
  buildProductionScopeExecutionBundle,
  executionBundleSha256,
  executionPlanSha256,
  validateProductionScopeExecutionBundle,
} = require('../server/lib/production-scope-execution-plan-bundle.js');
const {
  authorizeProductionScopeExecutionBundle,
} = require('../server/lib/production-scope-execution-authorization.js');
const {
  buildUsersDirectorySnapshot,
  calculateBootstrapChecksum,
  getSchemaFingerprint,
} = require('../server/lib/platform-identity-bootstrap-validation.js');
const { deriveCanonicalCompanyId } = require('../server/lib/canonical-company-id.js');
const {
  deriveCanonicalHeadOfficeId,
  deriveCanonicalMembershipId,
} = require('../server/lib/canonical-authority-id.js');
const {
  PRODUCTION_SMOKE_READER_EMAIL,
  PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
  PRODUCTION_SMOKE_READER_ROLE,
  PRODUCTION_SMOKE_READER_TEMPLATE_KEY,
  PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID,
  getProjectedSmokeIdentityUsers,
  planProductionSmokeIdentityTransition,
} = require('../server/lib/production-smoke-identity.js');
const { createTrustedActorScopeResolver } = require('../server/lib/trusted-actor-scope.js');
const {
  databaseContentFingerprint,
  sqliteFileSetFingerprint,
  sqliteObservedFileSetFingerprint,
} = require('../server/lib/production-scope-remediation-runner.js');
const {
  readIndexedJson,
  readHashBoundJson,
  selectCaptureRound,
  verifyEvidencePack,
  verifyManifestRecords,
  writeNewJsonSet,
} = require('../server/scripts/simulate-production-scope-remediation.js');

const COMPANY_ID = deriveCanonicalCompanyId({
  jurisdiction: 'ZZ',
  registry: 'TEST_FIXTURE',
  value: 'production-scope-remediation-manifest-v1',
}).companyId;
const HEAD_OFFICE_BRANCH_ID = deriveCanonicalHeadOfficeId({ companyId: COMPANY_ID }).branchId;
const BUSINESS_ADMIN_PRINCIPAL_ID = 'fixture-business-admin-principal-v1';
const BUSINESS_ADMIN_MEMBERSHIP_ID = deriveCanonicalMembershipId({
  companyId: COMPANY_ID,
  principalId: BUSINESS_ADMIN_PRINCIPAL_ID,
}).membershipId;
const DEMO_CARRIER_PRINCIPAL_ID = 'fixture-demo-carrier-principal-v1';
const DEMO_BOT_MAP_KEY = 'fixture-demo-bot-map-key-v1';
const DEMO_BOT_RECORD_ID = 'fixture-demo-bot-record-v1';
const DEMO_SNAPSHOT_RECORD_ID = 'fixture-demo-snapshot-record-v1';
const SYNTHETIC_INFRASTRUCTURE_IDS = Object.freeze({
  projectId: '00000000-0000-4000-8000-000000000001',
  environmentId: '00000000-0000-4000-8000-000000000002',
  serviceId: '00000000-0000-4000-8000-000000000003',
  volumeId: '00000000-0000-4000-8000-000000000004',
  serviceInstanceId: '00000000-0000-4000-8000-000000000005',
  deploymentInstanceId: '00000000-0000-4000-8000-000000000006',
  captureDeploymentId: '00000000-0000-4000-8000-000000000007',
});
const BASELINE_COMMITMENT_FIELDS = Object.freeze([
  'baselineContractSha256',
  'candidateKeySetSha256',
  'candidateAuthoritySha256',
  'canonicalScopeSha256',
]);
const AUTHORITY_COMMITMENT_FIELDS = Object.freeze([
  ...BASELINE_COMMITMENT_FIELDS,
  'classificationAuthorityFingerprint',
]);
const CURRENT_AUTHORITY_COMMITMENTS = Object.freeze({
  baselineContractSha256: baselineStableJsonSha256(PRODUCTION_BASELINE_CONTRACT),
  candidateKeySetSha256: PRODUCTION_BASELINE_CONTRACT.candidateKeySetSha256,
  candidateAuthoritySha256: PRODUCTION_BASELINE_CONTRACT.candidateAuthoritySha256,
  canonicalScopeSha256: PRODUCTION_BASELINE_CONTRACT.canonicalScopeSha256,
  classificationAuthorityFingerprint: crypto.createHash('sha256')
    .update(stableJson(classificationAuthoritySnapshot()))
    .digest('hex'),
});

function authorityCommitments(value) {
  return Object.fromEntries(AUTHORITY_COMMITMENT_FIELDS.map(field => [field, value?.[field]]));
}

function runnerFileSet(rows) {
  const byName = new Map(rows.map(row => [row.name, row]));
  const entry = name => {
    const row = byName.get(name);
    return row ? { name, sizeBytes: row.size, sha256: row.sha256 } : null;
  };
  return {
    database: entry('app.sqlite'),
    wal: entry('app.sqlite-wal'),
    shm: entry('app.sqlite-shm'),
  };
}

function passingAuthorizationSimulation(bundle) {
  return {
    status: 'PASS',
    productionWritePerformed: false,
    source: {
      sourceSnapshotHash: bundle.source.sourceSnapshotHash,
      sourceFileSetHash: bundle.source.sourceFileSetHash,
      sourceObservedFileSetHash: bundle.source.sourceObservedFileSetHash,
      databaseContentFingerprint: bundle.source.databaseContentFingerprint,
      schemaFingerprint: bundle.source.schemaFingerprint,
    },
    evidence: {
      artifactIndexSha256: bundle.evidence.artifactIndexSha256,
      packFingerprint: bundle.evidence.packFingerprint,
      approvedReconciliationFingerprint: bundle.evidence.approvedReconciliationFingerprint,
    },
    manifest: { sha256: bundle.scopeManifestSha256 },
    firstRun: { plannedScopeRecordCount: bundle.summary.semanticScopeWriteCount },
    secondRun: { semanticDiffCount: 0, sqliteWriteCount: 0 },
    integrity: {
      quickCheck: 'ok',
      foreignKeyViolationCount: 0,
      appDataShapeCountAndStableIdPreserved: true,
    },
    identity: {
      smokeReader: {
        sourceDeactivated: true,
        replacementActive: true,
        hashedLoginVerifierPreserved: true,
        replacementResolverAuthorized: true,
        sourceResolverDenied: true,
        secondRunAlreadyApplied: true,
      },
    },
    tenantVisibility: {
      status: 'PASS',
      productionWritePerformed: false,
      inputRemediatedCopyMutated: false,
      localWorkingCopiesMutated: true,
      fakeCompanyPersistedOutsideDisposableCopy: false,
      registryCollectionCount: bundle.summary.registryEntryCount,
      serviceBoundary: {
        rows: Array.from({ length: bundle.summary.registryEntryCount }, (_value, index) => ({ collection: `collection-${index}`, pass: true })),
        leakageCount: 0,
      },
      actualApi: {
        routes: Array.from({ length: 8 }, (_value, index) => ({ collection: `route-${index}`, pass: true })),
        exports: [{ scope: 'fixtureTenant', pass: true }, { scope: 'secondFixtureTenant', pass: true }],
        auditIsolation: { pass: true },
        leakageCount: 0,
        targetServerStartedAgainstRemediatedCopy: true,
      },
      crossTenantLeakageCount: 0,
    },
    executionPlanBundle: {
      bundleSha256: bundle.bundleSha256,
      executionPlanSha256: bundle.executionPlanSha256,
      productionExecutionAuthorized: false,
      status: 'REVIEW_REQUIRED',
      nonBackupPreflightBlockerCount: 0,
    },
    invariantViolations: [],
  };
}
const BASE_COLLECTIONS = {
  equipment: [],
  counterparties: [{ id: 'CP-1', legalName: 'Approved stable-ID customer' }],
  counterparty_role_assignments: [],
  clients: [],
  client_objects: [],
  documents: [],
  app_settings: [],
  knowledge_base_modules: [
    { id: 'KB-1', title: 'Platform default module' },
    {
      id: 'KB-TENANT-1',
      title: 'Tenant standalone module',
      companyId: COMPANY_ID,
      tenantId: COMPANY_ID,
    },
    {
      id: 'KB-OVERRIDE-1',
      title: 'Tenant override module',
      companyId: COMPANY_ID,
      tenantId: COMPANY_ID,
      platformDefaultId: 'KB-1',
    },
  ],
  audit_logs: [
    { id: 'AUDIT-1', entityType: 'counterparty', entityId: 'CP-1', action: 'created' },
    { id: 'AUDIT-2', entityType: 'business', userId: BUSINESS_ADMIN_PRINCIPAL_ID, action: 'viewed' },
  ],
  inline_relation_idempotency: [{ key: 'legacy-replay-key', result: 'preserved' }],
  bot_users: {
    [DEMO_BOT_MAP_KEY]: { id: DEMO_BOT_RECORD_ID, fixtureTag: 'DEMO-' },
  },
  snapshot: { id: DEMO_SNAPSHOT_RECORD_ID, fixtureTag: 'DEMO-', state: 'preserved' },
};

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createFixture() {
  const context = createPlatformIdentityContext({
    users: [
      { id: BUSINESS_ADMIN_PRINCIPAL_ID, status: 'Активен', role: 'Администратор' },
      { id: DEMO_CARRIER_PRINCIPAL_ID, status: 'Активен', role: 'Перевозчик', fixtureTag: 'DEMO-' },
    ],
  });
  const insert = context.db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)');
  for (const [name, value] of Object.entries(BASE_COLLECTIONS)) {
    insert.run(name, JSON.stringify(value));
  }
  const inventory = [
    {
      collection: 'counterparties',
      recordId: 'CP-1',
      canonicalRecordHash: recordFingerprint(BASE_COLLECTIONS.counterparties[0]),
      disposition: 'TENANT_OWNERSHIP_CANDIDATE',
      baselineClassification: 'TENANT_BUSINESS_DATA',
      ownershipRule: 'APPROVED_STABLE_ID_CHAIN',
      category: 'TENANT',
      shape: 'ARRAY',
    },
    {
      collection: 'knowledge_base_modules',
      recordId: 'KB-1',
      canonicalRecordHash: recordFingerprint(BASE_COLLECTIONS.knowledge_base_modules[0]),
      disposition: 'PLATFORM_DEFAULT_REFERENCE',
      ownershipRule: 'EXACT_UNSCOPED_PLATFORM_DEFAULT_POLICY:knowledge_base_modules',
      category: 'PLATFORM_DEFAULT_TENANT_OVERLAY',
      shape: 'ARRAY',
    },
    {
      collection: 'knowledge_base_modules',
      recordId: 'KB-TENANT-1',
      canonicalRecordHash: recordFingerprint(BASE_COLLECTIONS.knowledge_base_modules[1]),
      disposition: 'TENANT_OWNED_CATALOG_ENTRY',
      ownershipRule: 'EXACT_TENANT_CATALOG_SCOPE:knowledge_base_modules',
      category: 'PLATFORM_DEFAULT_TENANT_OVERLAY',
      shape: 'ARRAY',
    },
    {
      collection: 'knowledge_base_modules',
      recordId: 'KB-OVERRIDE-1',
      canonicalRecordHash: recordFingerprint(BASE_COLLECTIONS.knowledge_base_modules[2]),
      disposition: 'TENANT_CATALOG_OVERRIDE',
      ownershipRule: 'EXACT_TENANT_OVERRIDE_SCOPE:knowledge_base_modules',
      category: 'PLATFORM_DEFAULT_TENANT_OVERLAY',
      shape: 'ARRAY',
    },
    {
      collection: 'audit_logs',
      recordId: 'AUDIT-1',
      canonicalRecordHash: recordFingerprint(BASE_COLLECTIONS.audit_logs[0]),
      disposition: 'AUDIT_A_ENTITY_DERIVED',
      ownershipRule: 'AUTHORITATIVE_RETAINED_ENTITY',
      category: 'LEGACY_HISTORY',
      shape: 'ARRAY',
    },
    {
      collection: 'audit_logs',
      recordId: 'AUDIT-2',
      canonicalRecordHash: recordFingerprint(BASE_COLLECTIONS.audit_logs[1]),
      disposition: 'AUDIT_B_ACTOR_DERIVED_ONLY',
      ownershipRule: 'ACTOR_ONLY_NOT_HISTORICAL_TENANT_PROOF',
      category: 'LEGACY_HISTORY',
      shape: 'ARRAY',
    },
    {
      collection: 'inline_relation_idempotency',
      recordId: `inline_relation_idempotency:anonymous:${recordFingerprint(BASE_COLLECTIONS.inline_relation_idempotency[0]).slice(0, 16)}`,
      canonicalRecordHash: recordFingerprint(BASE_COLLECTIONS.inline_relation_idempotency[0]),
      disposition: 'LEGACY_IDEMPOTENCY_TOMBSTONE',
      ownershipRule: 'IMMUTABLE_GLOBAL_REPLAY_TOMBSTONE',
      category: 'TENANT_TECHNICAL',
      shape: 'ARRAY',
    },
    {
      collection: 'bot_users',
      recordId: DEMO_BOT_RECORD_ID,
      canonicalRecordHash: recordFingerprint(BASE_COLLECTIONS.bot_users[DEMO_BOT_MAP_KEY]),
      disposition: 'FIXTURE_DEMO_TEST',
      ownershipRule: 'EXPLICIT_FIXTURE_EVIDENCE',
      category: 'TENANT_TECHNICAL',
      shape: 'MAP',
    },
    {
      collection: 'snapshot',
      recordId: DEMO_SNAPSHOT_RECORD_ID,
      canonicalRecordHash: recordFingerprint(BASE_COLLECTIONS.snapshot),
      disposition: 'FIXTURE_DEMO_TEST',
      ownershipRule: 'EXPLICIT_FIXTURE_EVIDENCE',
      category: 'TENANT_TECHNICAL',
      shape: 'SINGLETON',
    },
  ];
  const identityBootstrap = {
    configVersion: 1,
    company: {
      id: COMPANY_ID,
      displayName: 'Manifest Test Company',
      receivablesTimezone: 'Europe/Moscow',
    },
    branches: [{
      id: HEAD_OFFICE_BRANCH_ID,
      displayName: 'Head Office',
      isHeadOffice: true,
      status: 'active',
    }],
    roleTemplates: [{
      templateKey: 'company-administrator',
      templateVersion: 1,
      displayName: 'Company Administrator',
      capabilities: ['companies.manage'],
    }],
    memberships: [{
      id: BUSINESS_ADMIN_MEMBERSHIP_ID,
      principalId: BUSINESS_ADMIN_PRINCIPAL_ID,
      status: 'active',
      roleTemplateKey: 'company-administrator',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: true,
      branchIds: [],
      capabilityAssignments: [],
    }],
    intentionallyUnmappedUserIds: [DEMO_CARRIER_PRINCIPAL_ID],
    approval: {
      approvedBy: BUSINESS_ADMIN_PRINCIPAL_ID,
      approvedAt: '2026-08-26T12:36:21.720Z',
      approvalReference: 'manifest-test-approval',
      backupReference: 'manifest-test-backup',
      schemaFingerprint: getSchemaFingerprint(context.db),
    },
  };
  identityBootstrap.approval.configChecksum = calculateBootstrapChecksum(context.db, identityBootstrap);
  const users = context.readUsers();
  const userDispositions = users.map(user => ({
    principalId: user.id,
    canonicalRecordHash: recordFingerprint(user),
    classification: user.id === BUSINESS_ADMIN_PRINCIPAL_ID ? 'BUSINESS_USER' : 'DEMO_FIXTURE',
    membership: user.id === BUSINESS_ADMIN_PRINCIPAL_ID ? 'YES' : 'NO',
    ...(user.id === BUSINESS_ADMIN_PRINCIPAL_ID ? {
      companyId: COMPANY_ID,
      tenantId: COMPANY_ID,
      branchIds: [],
      companyWideBranchAuthority: true,
      roleTemplateKey: 'company-administrator',
      roleTemplateVersion: 1,
    } : {}),
  }));
  const identity = {
    bootstrapConfigHash: hash(stableJson(identityBootstrap)),
    bootstrapConfig: structuredClone(identityBootstrap),
    userDispositionFingerprint: hash(stableJson(userDispositions)),
    reviewedPlanFileSha256: '8'.repeat(64),
    company: identityBootstrap.company,
    branches: identityBootstrap.branches,
    roleTemplates: identityBootstrap.roleTemplates,
    memberships: identityBootstrap.memberships,
    intentionallyUnmappedUserIds: identityBootstrap.intentionallyUnmappedUserIds,
    userDispositions,
  };
  const sourceFileSet = [
    { name: 'app.sqlite', size: 4096, sha256: 'e'.repeat(64) },
    { name: 'app.sqlite-wal', size: 0, sha256: 'f'.repeat(64) },
    { name: 'app.sqlite-shm', size: 32768, sha256: '1'.repeat(64) },
  ];
  const railwayIdentity = {
    projectId: SYNTHETIC_INFRASTRUCTURE_IDS.projectId,
    environmentId: SYNTHETIC_INFRASTRUCTURE_IDS.environmentId,
    serviceId: SYNTHETIC_INFRASTRUCTURE_IDS.serviceId,
    volumeId: SYNTHETIC_INFRASTRUCTURE_IDS.volumeId,
    volumeName: 'fixture-production-scope-volume',
    volumeMountPath: '/data',
  };
  const deploymentIdentity = {
    serviceInstanceId: SYNTHETIC_INFRASTRUCTURE_IDS.serviceInstanceId,
    deploymentInstanceId: SYNTHETIC_INFRASTRUCTURE_IDS.deploymentInstanceId,
  };
  const collectionFingerprints = Object.fromEntries(context.db
    .prepare('SELECT name, json FROM app_data ORDER BY name').all()
    .map(row => [row.name, hash(row.json)]));
  const source = {
    captureDeployedSha: 'a'.repeat(40),
    captureDeploymentId: SYNTHETIC_INFRASTRUCTURE_IDS.captureDeploymentId,
    railwayIdentity,
    deploymentIdentity,
    sourceFileSet,
    sourceFileSetHash: sqliteFileSetFingerprint(runnerFileSet(sourceFileSet)),
    sourceObservedFileSetHash: sqliteObservedFileSetFingerprint(runnerFileSet(sourceFileSet)),
    databaseContentFingerprint: databaseContentFingerprint(context.db),
    schemaFingerprint: getSchemaFingerprint(context.db),
  };
  source.sourceSnapshotHash = calculateSourceSnapshotHash({
    captureDeployedSha: source.captureDeployedSha,
    captureDeploymentId: source.captureDeploymentId,
    railwayIdentity,
    deploymentIdentity,
    sourceFileSet,
    collectionFingerprints,
  });
  const approvedReconciliation = [
    {
      collection: 'counterparties',
      recordId: 'CP-1',
      sourceRecordHash: inventory.find(row => row.recordId === 'CP-1').canonicalRecordHash,
      approvalClass: 'BASELINE_OWNERSHIP',
    },
    {
      collection: 'audit_logs',
      recordId: 'AUDIT-1',
      sourceRecordHash: inventory.find(row => row.recordId === 'AUDIT-1').canonicalRecordHash,
      approvalClass: 'AUDIT_ENTITY_DERIVED',
    },
  ].sort((left, right) => left.collection.localeCompare(right.collection) || left.recordId.localeCompare(right.recordId));
  const evidence = {
    artifactIndexSha256: '2'.repeat(64),
    ...CURRENT_AUTHORITY_COMMITMENTS,
    packFingerprint: '3'.repeat(64),
    summaryFileSha256: '4'.repeat(64),
    classificationFileSha256: '5'.repeat(64),
    classificationFingerprint: hash(stableJson(inventory)),
    userDispositionsFileSha256: '6'.repeat(64),
    ownershipCandidatesFileSha256: '7'.repeat(64),
    approvedReconciliationFingerprint: hash(stableJson(approvedReconciliation)),
    sourceBindingsFingerprint: currentRepositorySourceBindingsFingerprint(),
    platformDefaultTenantOverlaySemantics: structuredClone(
      PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
    ),
  };
  return {
    context,
    approvedReconciliation,
    evidence,
    identity,
    identityBootstrap,
    inventory,
    source,
    userDispositions,
  };
}

function buildManifest(fixture, overrides = {}) {
  return buildProductionScopeManifest({
    db: fixture.context.db,
    source: fixture.source,
    authority: { companyId: COMPANY_ID, tenantId: COMPANY_ID },
    classificationInventory: fixture.inventory,
    approvedReconciliation: fixture.approvedReconciliation,
    evidence: fixture.evidence,
    identity: fixture.identity,
    ...overrides,
  });
}

function refreshFixtureBindings(fixture) {
  fixture.source.databaseContentFingerprint = databaseContentFingerprint(fixture.context.db);
  const collectionFingerprints = Object.fromEntries(fixture.context.db
    .prepare('SELECT name, json FROM app_data ORDER BY name').all()
    .map(row => [row.name, hash(row.json)]));
  fixture.source.sourceSnapshotHash = calculateSourceSnapshotHash({
    captureDeployedSha: fixture.source.captureDeployedSha,
    captureDeploymentId: fixture.source.captureDeploymentId,
    railwayIdentity: fixture.source.railwayIdentity,
    deploymentIdentity: fixture.source.deploymentIdentity,
    sourceFileSet: fixture.source.sourceFileSet,
    collectionFingerprints,
  });
  fixture.evidence.classificationFingerprint = hash(stableJson(fixture.inventory));
  fixture.evidence.approvedReconciliationFingerprint = hash(stableJson(fixture.approvedReconciliation));
}

function buildPlan(fixture, manifest, overrides = {}) {
  return buildExecutionPlanFromManifest({
    db: fixture.context.db,
    manifest,
    identityBootstrap: fixture.identityBootstrap,
    userDispositions: fixture.userDispositions,
    reviewedPlanFileSha256: fixture.identity.reviewedPlanFileSha256,
    backup: {
      verified: true,
      reference: 'manifest-test-backup',
      sourceDbIdentity: hash(stableJson(databaseIdentity(fixture.context.db))),
      timestamp: '2026-08-26T12:36:21.720Z',
      sizeBytes: 4096,
      sha256: 'd'.repeat(64),
    },
    ...overrides,
  });
}

function enableSmokeIdentity(fixture) {
  const sourceUsers = fixture.context.readUsers();
  sourceUsers.push({
    id: PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID,
    name: 'Synthetic legacy smoke administrator',
    email: 'fixture-legacy-smoke@example.test',
    role: 'Администратор',
    status: 'Активен',
    password: 'h2:scrypt:c2FsdA:aGFzaA',
    tokenVersion: 3,
    allowFrontendLogin: true,
    frontendAccess: true,
  });
  fixture.context.db.prepare("UPDATE app_data SET json = ? WHERE name = 'users'")
    .run(JSON.stringify(sourceUsers));
  const branchId = fixture.identityBootstrap.branches[0].id;
  const membershipId = deriveCanonicalMembershipId({
    companyId: COMPANY_ID,
    principalId: PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
  }).membershipId;
  const smokeIdentityTransition = {
    transitionVersion: 1,
    status: 'APPROVED',
    sourcePrincipalId: PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID,
    expectedSourceRole: 'Администратор',
    replacement: {
      id: PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
      name: 'Synthetic Production Smoke Reader',
      email: PRODUCTION_SMOKE_READER_EMAIL,
      role: PRODUCTION_SMOKE_READER_ROLE,
    },
    membership: {
      id: membershipId,
      companyId: COMPANY_ID,
      branchId,
      roleTemplateKey: PRODUCTION_SMOKE_READER_TEMPLATE_KEY,
      roleTemplateVersion: 1,
    },
  };
  const usersRaw = fixture.context.db.prepare("SELECT json FROM app_data WHERE name = 'users'").get().json;
  const smokePreview = planProductionSmokeIdentityTransition({
    users: sourceUsers,
    config: smokeIdentityTransition,
    usersRawFingerprint: hash(usersRaw),
  });
  assert.equal(smokePreview.readyToApply, true, JSON.stringify(smokePreview.blockers));
  const projectedUsers = getProjectedSmokeIdentityUsers(smokePreview);
  fixture.identityBootstrap.roleTemplates.push({
    templateKey: PRODUCTION_SMOKE_READER_TEMPLATE_KEY,
    templateVersion: 1,
    displayName: 'Production Smoke Reader',
    capabilities: [],
  });
  fixture.identityBootstrap.memberships.push({
    id: membershipId,
    principalId: PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
    status: 'active',
    roleTemplateKey: PRODUCTION_SMOKE_READER_TEMPLATE_KEY,
    roleTemplateVersion: 1,
    companyWideBranchAuthority: false,
    branchIds: [branchId],
    capabilityAssignments: [],
  });
  fixture.identityBootstrap.intentionallyUnmappedUserIds.push(PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID);
  fixture.identityBootstrap.approval.configChecksum = calculateBootstrapChecksum(
    fixture.context.db,
    fixture.identityBootstrap,
    { usersDirectorySnapshot: buildUsersDirectorySnapshot(projectedUsers) },
  );
  fixture.userDispositions = projectedUsers.map(user => ({
    principalId: user.id,
    canonicalRecordHash: recordFingerprint(user),
    classification: user.id === PRODUCTION_SMOKE_READER_PRINCIPAL_ID
      ? 'TECHNICAL_AUDITOR_SMOKE_REPLACEMENT'
      : (user.id === PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID
        ? 'SMOKE_ACCOUNT_SOURCE_DEACTIVATED'
        : (user.id === BUSINESS_ADMIN_PRINCIPAL_ID ? 'BUSINESS_USER' : 'DEMO_FIXTURE')),
    membership: [BUSINESS_ADMIN_PRINCIPAL_ID, PRODUCTION_SMOKE_READER_PRINCIPAL_ID].includes(user.id) ? 'YES' : 'NO',
    ...([BUSINESS_ADMIN_PRINCIPAL_ID, PRODUCTION_SMOKE_READER_PRINCIPAL_ID].includes(user.id) ? {
      companyId: COMPANY_ID,
      tenantId: COMPANY_ID,
      branchIds: user.id === PRODUCTION_SMOKE_READER_PRINCIPAL_ID ? [branchId] : [],
      companyWideBranchAuthority: user.id === BUSINESS_ADMIN_PRINCIPAL_ID,
      roleTemplateKey: user.id === PRODUCTION_SMOKE_READER_PRINCIPAL_ID
        ? PRODUCTION_SMOKE_READER_TEMPLATE_KEY
        : 'company-administrator',
      roleTemplateVersion: 1,
    } : {}),
  }));
  fixture.identity = {
    bootstrapConfigHash: hash(stableJson(fixture.identityBootstrap)),
    bootstrapConfig: structuredClone(fixture.identityBootstrap),
    userDispositionFingerprint: hash(stableJson(fixture.userDispositions)),
    reviewedPlanFileSha256: '8'.repeat(64),
    company: fixture.identityBootstrap.company,
    branches: fixture.identityBootstrap.branches,
    roleTemplates: fixture.identityBootstrap.roleTemplates,
    memberships: fixture.identityBootstrap.memberships,
    intentionallyUnmappedUserIds: fixture.identityBootstrap.intentionallyUnmappedUserIds,
    userDispositions: fixture.userDispositions,
    smokeIdentity: {
      status: 'APPROVED',
      sourcePrincipalId: PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID,
      replacementPrincipalId: PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
      transition: structuredClone(smokeIdentityTransition),
      transitionConfigHash: hash(stableJson(smokeIdentityTransition)),
      transitionChecksum: smokePreview.transitionChecksum,
      projectedUsersFingerprint: hash(stableJson(projectedUsers)),
      projectedUserCount: projectedUsers.length,
    },
  };
  refreshFixtureBindings(fixture);
  return { projectedUsers, smokeIdentityTransition };
}

test('exact manifest preserves mixed catalog partitions and binds tenant, audit, and replay semantics', () => {
  const fixture = createFixture();
  try {
    const manifest = buildManifest(fixture);
    assert.equal(manifest.status, 'READY_FOR_DISPOSABLE_SIMULATION');
    assert.equal(manifest.blockers.length, 0);
    assert.equal(
      manifest.evidence.sourceBindingsFingerprint,
      currentRepositorySourceBindingsFingerprint(),
    );
    assert.deepEqual(
      authorityCommitments(manifest.evidence),
      CURRENT_AUTHORITY_COMMITMENTS,
    );
    assert.deepEqual(
      manifest.platformDefaultTenantOverlaySemantics,
      PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
    );
    assert.deepEqual(
      manifest.evidence.platformDefaultTenantOverlaySemantics,
      PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
    );
    assert.equal(manifest.registry.globalReferenceCollectionCount, 0);
    assert.equal(manifest.registry.platformDefaultTenantOverlayCollectionCount, 8);
    assert.deepEqual(manifest.summary.operationCounts, {
      PRESERVE_EXACT_TENANT_ENTRY: 1,
      PRESERVE_EXACT_TENANT_OVERRIDE: 1,
      PRESERVE_FIXTURE_UNSCOPED: 2,
      PRESERVE_LEGACY_REPLAY_TOMBSTONE: 1,
      PRESERVE_LEGACY_UNSCOPED: 1,
      PRESERVE_PLATFORM_DEFAULT: 1,
      UPDATE_SCOPE: 2,
    });
    assert.equal(manifest.summary.collectionWriteCounts.knowledge_base_modules, undefined);
    assert.equal(manifest.summary.semanticScopeWriteCount, 2);
    assert.deepEqual(
      manifest.records
        .filter(row => row.collection === 'knowledge_base_modules')
        .map(row => [row.recordId, row.operation]),
      [
        ['KB-1', 'PRESERVE_PLATFORM_DEFAULT'],
        ['KB-OVERRIDE-1', 'PRESERVE_EXACT_TENANT_OVERRIDE'],
        ['KB-TENANT-1', 'PRESERVE_EXACT_TENANT_ENTRY'],
      ],
    );
    const auditUpdate = manifest.records.find(row => row.recordId === 'AUDIT-1');
    assert.deepEqual(auditUpdate.parent, {
      collection: 'counterparties',
      recordId: 'CP-1',
      sourceRecordHash: recordFingerprint(BASE_COLLECTIONS.counterparties[0]),
      canonicalContentHash: recordFingerprint(BASE_COLLECTIONS.counterparties[0]),
    });
    assert.equal(auditUpdate.derivationRule, 'AUTHORITATIVE_PARENT_ID:counterparties:CP-1');
    assert.equal(manifest.records.find(row => row.recordId === 'AUDIT-2').operation, 'PRESERVE_LEGACY_UNSCOPED');
  } finally {
    fixture.context.close();
  }
});

test('obsolete evidence and rehashed pre-contract v2 manifests fail closed', async t => {
  await t.test('a well-formed but non-current repository fingerprint is obsolete', () => {
    const fixture = createFixture();
    try {
      fixture.evidence.sourceBindingsFingerprint = '0'.repeat(64);
      const manifest = buildManifest(fixture);
      assert.equal(manifest.status, 'BLOCKED');
      assert.equal(
        manifest.blockers.some(row => row.code === 'EVIDENCE_SOURCE_BINDINGS_OBSOLETE'),
        true,
      );
    } finally {
      fixture.context.close();
    }
  });

  await t.test('an altered overlay contract is obsolete', () => {
    const fixture = createFixture();
    try {
      fixture.evidence.platformDefaultTenantOverlaySemantics = {
        ...fixture.evidence.platformDefaultTenantOverlaySemantics,
        naturalKeyLinking: 'ALLOWED',
      };
      const manifest = buildManifest(fixture);
      assert.equal(manifest.status, 'BLOCKED');
      assert.equal(
        manifest.blockers.some(row => (
          row.code === 'EVIDENCE_OVERLAY_SEMANTICS_CONTRACT_OBSOLETE'
        )),
        true,
      );
    } finally {
      fixture.context.close();
    }
  });

  await t.test('a pre-contract v2 manifest remains obsolete after its hash is recomputed', () => {
    const fixture = createFixture();
    try {
      const obsoleteManifest = buildManifest(fixture);
      delete obsoleteManifest.platformDefaultTenantOverlaySemantics;
      delete obsoleteManifest.evidence.sourceBindingsFingerprint;
      delete obsoleteManifest.evidence.platformDefaultTenantOverlaySemantics;
      obsoleteManifest.manifestSha256 = manifestHash(obsoleteManifest);
      assert.throws(
        () => buildPlan(fixture, obsoleteManifest),
        error => error.code === 'MANIFEST_SOURCE_BINDINGS_OBSOLETE',
      );
    } finally {
      fixture.context.close();
    }
  });
});

test('baseline and classification authority commitments fail closed when tampered or missing', async t => {
  function assertCommitmentRejected(field, { missing, obsoleteCode }) {
    const fixture = createFixture();
    try {
      if (missing) delete fixture.evidence[field];
      else fixture.evidence[field] = '0'.repeat(64);
      const manifest = buildManifest(fixture);
      assert.equal(manifest.status, 'BLOCKED');
      assert.equal(manifest.blockers.some(row => row.code === obsoleteCode), true);
      assert.equal(
        manifest.blockers.some(row => (
          row.code === 'EVIDENCE_HASH_BINDING_REQUIRED' && row.field === field
        )),
        missing,
      );
    } finally {
      fixture.context.close();
    }
  }

  for (const field of BASELINE_COMMITMENT_FIELDS) {
    await t.test(`tampered baseline commitment: ${field}`, () => {
      assertCommitmentRejected(field, {
        missing: false,
        obsoleteCode: 'EVIDENCE_BASELINE_CONTRACT_OBSOLETE',
      });
    });
    await t.test(`missing baseline commitment: ${field}`, () => {
      assertCommitmentRejected(field, {
        missing: true,
        obsoleteCode: 'EVIDENCE_BASELINE_CONTRACT_OBSOLETE',
      });
    });
  }

  await t.test('tampered classification authority commitment', () => {
    assertCommitmentRejected('classificationAuthorityFingerprint', {
      missing: false,
      obsoleteCode: 'EVIDENCE_CLASSIFICATION_AUTHORITY_OBSOLETE',
    });
  });
  await t.test('missing classification authority commitment', () => {
    assertCommitmentRejected('classificationAuthorityFingerprint', {
      missing: true,
      obsoleteCode: 'EVIDENCE_CLASSIFICATION_AUTHORITY_OBSOLETE',
    });
  });
});

test('full manifest apply is atomic and its second execution is a semantic no-op', () => {
  const fixture = createFixture();
  try {
    const manifest = buildManifest(fixture);
    const plan = buildPlan(fixture, manifest);
    const preview = planProductionScopeRemediation({ db: fixture.context.db, plan });
    assert.equal(preview.readyToApply, true);
    assert.equal(preview.plannedDiff.UPDATE.length, 2);
    const catalogBefore = fixture.context.db
      .prepare("SELECT json FROM app_data WHERE name = 'knowledge_base_modules'")
      .get().json;
    const first = applyProductionScopeRemediation({
      db: fixture.context.db,
      plan,
      explicitApply: true,
      expectedPlanChecksum: preview.planChecksum,
    });
    assert.equal(first.status, 'succeeded');
    for (const [collection, id] of [
      ['counterparties', 'CP-1'],
      ['audit_logs', 'AUDIT-1'],
    ]) {
      const rows = JSON.parse(fixture.context.db.prepare('SELECT json FROM app_data WHERE name = ?').get(collection).json);
      const row = rows.find(item => item.id === id);
      assert.equal(row.companyId, COMPANY_ID);
      assert.equal(row.tenantId, COMPANY_ID);
    }
    assert.equal(
      fixture.context.db.prepare("SELECT json FROM app_data WHERE name = 'knowledge_base_modules'").get().json,
      catalogBefore,
    );
    const preservedAudit = JSON.parse(
      fixture.context.db.prepare("SELECT json FROM app_data WHERE name = 'audit_logs'").get().json,
    ).find(row => row.id === 'AUDIT-2');
    assert.equal(recordFingerprint(preservedAudit), recordFingerprint(BASE_COLLECTIONS.audit_logs[1]));
    const repeatedPreview = planProductionScopeRemediation({ db: fixture.context.db, plan });
    assert.equal(repeatedPreview.plannedDiff.UPDATE.length, 0);
    const repeated = applyProductionScopeRemediation({
      db: fixture.context.db,
      plan,
      explicitApply: true,
      expectedPlanChecksum: repeatedPreview.planChecksum,
    });
    assert.equal(repeated.status, 'noop');
    assert.equal(repeated.writes, 0);
    const recordVerification = verifyManifestRecords(fixture.context.db, manifest);
    assert.deepEqual(recordVerification.violations, []);
    assert.equal(recordVerification.updatedScopeCount, 2);
    assert.equal(recordVerification.preservedByteEquivalentCount, 7);
  } finally {
    fixture.context.close();
  }
});

test('manifest-bound smoke replacement authorizes only the reader and remains an exact second-run no-op', () => {
  const fixture = createFixture();
  try {
    const { projectedUsers, smokeIdentityTransition } = enableSmokeIdentity(fixture);
    const manifest = buildManifest(fixture);
    assert.equal(manifest.status, 'READY_FOR_DISPOSABLE_SIMULATION');
    assert.equal(manifest.productionExecutionAuthorized, false);
    assert.throws(
      () => buildPlan(fixture, manifest),
      error => error.code === 'MANIFEST_SMOKE_IDENTITY_BINDING_MISMATCH',
    );
    const tamperedTransition = structuredClone(smokeIdentityTransition);
    tamperedTransition.replacement.name = 'Unapproved replacement name';
    assert.throws(
      () => buildPlan(fixture, manifest, { smokeIdentityTransition: tamperedTransition }),
      error => error.code === 'MANIFEST_SMOKE_IDENTITY_BINDING_MISMATCH',
    );

    const plan = buildPlan(fixture, manifest, {
      smokeIdentityTransition,
      sourceDbPath: '/data/app.sqlite',
    });
    assert.deepEqual(plan.expected.collectionCounts.users, [3, 4]);
    assert.equal(plan.actorMappings.filter(row => row.action === 'CREATE_MEMBERSHIP').length, 2);
    const executionBundle = buildProductionScopeExecutionBundle({ plan, manifest });
    assert.equal(executionBundle.productionExecutionAuthorized, false);
    assert.equal(executionBundle.executionPlan.productionExecutionAuthorized, false);
    assert.equal(executionBundle.executionPlan.backup.verified, false);
    assert.equal(
      executionBundle.source.sourceFileSetHash,
      sqliteFileSetFingerprint(runnerFileSet(fixture.source.sourceFileSet)),
    );
    assert.equal(
      executionBundle.source.sourceObservedFileSetHash,
      sqliteObservedFileSetFingerprint(runnerFileSet(fixture.source.sourceFileSet)),
    );
    assert.deepEqual(executionBundle.source.railwayIdentity, fixture.source.railwayIdentity);
    assert.deepEqual(executionBundle.source.deploymentIdentity, fixture.source.deploymentIdentity);
    assert.equal(
      executionBundle.sourceBindingsFingerprint,
      currentRepositorySourceBindingsFingerprint(),
    );
    assert.equal(
      executionBundle.executionPlan.sourceBindingsFingerprint,
      executionBundle.sourceBindingsFingerprint,
    );
    assert.equal(
      executionBundle.evidence.sourceBindingsFingerprint,
      executionBundle.sourceBindingsFingerprint,
    );
    assert.deepEqual(
      authorityCommitments(executionBundle.evidence),
      CURRENT_AUTHORITY_COMMITMENTS,
    );
    assert.deepEqual(
      authorityCommitments(executionBundle.executionPlan.exactSourceBinding.evidence),
      CURRENT_AUTHORITY_COMMITMENTS,
    );
    assert.deepEqual(
      executionBundle.platformDefaultTenantOverlaySemantics,
      PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
    );
    assert.deepEqual(
      executionBundle.executionPlan.platformDefaultTenantOverlaySemantics,
      PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
    );
    assert.equal(validateProductionScopeExecutionBundle(executionBundle).authorized, false);
    assert.throws(
      () => validateProductionScopeExecutionBundle(executionBundle, { requireAuthorized: true }),
      error => error.code === 'PRODUCTION_EXECUTION_NOT_AUTHORIZED',
    );
    const tamperedBundle = structuredClone(executionBundle);
    tamperedBundle.executionPlan.recordMappings[0].reason = 'tampered after review';
    tamperedBundle.bundleSha256 = executionBundleSha256(tamperedBundle);
    assert.throws(
      () => validateProductionScopeExecutionBundle(tamperedBundle),
      error => error.code === 'EXECUTION_PLAN_HASH_MISMATCH',
    );
    const downgradedBundle = structuredClone(executionBundle);
    downgradedBundle.bundleVersion = 0;
    downgradedBundle.bundleSha256 = executionBundleSha256(downgradedBundle);
    assert.throws(
      () => validateProductionScopeExecutionBundle(downgradedBundle),
      error => error.code === 'EXECUTION_BUNDLE_VERSION_INVALID',
    );
    for (const field of AUTHORITY_COMMITMENT_FIELDS) {
      for (const missing of [false, true]) {
        const obsoleteAuthorityBundle = structuredClone(executionBundle);
        if (missing) {
          delete obsoleteAuthorityBundle.evidence[field];
          delete obsoleteAuthorityBundle.executionPlan.exactSourceBinding.evidence[field];
        } else {
          obsoleteAuthorityBundle.evidence[field] = '0'.repeat(64);
          obsoleteAuthorityBundle.executionPlan.exactSourceBinding.evidence[field] = '0'.repeat(64);
        }
        obsoleteAuthorityBundle.executionPlanSha256 = executionPlanSha256(
          obsoleteAuthorityBundle.executionPlan,
        );
        obsoleteAuthorityBundle.bundleSha256 = executionBundleSha256(obsoleteAuthorityBundle);
        assert.throws(
          () => validateProductionScopeExecutionBundle(obsoleteAuthorityBundle),
          error => error.code === 'EXECUTION_AUTHORITY_CONTRACT_OBSOLETE',
          `${missing ? 'missing' : 'tampered'} execution authority commitment: ${field}`,
        );
      }
    }
    const obsoleteBundle = structuredClone(executionBundle);
    delete obsoleteBundle.sourceBindingsFingerprint;
    delete obsoleteBundle.platformDefaultTenantOverlaySemantics;
    delete obsoleteBundle.evidence.sourceBindingsFingerprint;
    delete obsoleteBundle.evidence.platformDefaultTenantOverlaySemantics;
    delete obsoleteBundle.executionPlan.sourceBindingsFingerprint;
    delete obsoleteBundle.executionPlan.platformDefaultTenantOverlaySemantics;
    delete obsoleteBundle.executionPlan.exactSourceBinding.evidence.sourceBindingsFingerprint;
    delete obsoleteBundle.executionPlan.exactSourceBinding.evidence
      .platformDefaultTenantOverlaySemantics;
    obsoleteBundle.executionPlanSha256 = executionPlanSha256(obsoleteBundle.executionPlan);
    obsoleteBundle.bundleSha256 = executionBundleSha256(obsoleteBundle);
    assert.throws(
      () => validateProductionScopeExecutionBundle(obsoleteBundle),
      error => error.code === 'EXECUTION_SOURCE_BINDINGS_OBSOLETE',
    );
    const missingForensicBinding = structuredClone(executionBundle);
    delete missingForensicBinding.source.sourceObservedFileSetHash;
    delete missingForensicBinding.executionPlan.exactSourceBinding.source.sourceObservedFileSetHash;
    missingForensicBinding.executionPlanSha256 = executionPlanSha256(
      missingForensicBinding.executionPlan,
    );
    missingForensicBinding.bundleSha256 = executionBundleSha256(missingForensicBinding);
    assert.throws(
      () => validateProductionScopeExecutionBundle(missingForensicBinding),
      error => error.code === 'EXECUTION_SOURCE_BINDING_INVALID',
    );
    const preview = planProductionScopeRemediation({ db: fixture.context.db, plan });
    assert.equal(preview.readyToApply, true, JSON.stringify(preview.blockers));
    assert.equal(preview.smokeIdentity.status, 'pending');
    const applied = applyProductionScopeRemediation({
      db: fixture.context.db,
      plan,
      explicitApply: true,
      expectedPlanChecksum: preview.planChecksum,
    });
    assert.equal(applied.smokeIdentityStatus, 'succeeded');
    assert.equal(
      hash(stableJson(fixture.context.readUsers())),
      hash(stableJson(projectedUsers)),
    );
    const resolver = createTrustedActorScopeResolver({ db: fixture.context.db });
    assert.equal(resolver(PRODUCTION_SMOKE_READER_PRINCIPAL_ID).companyId, COMPANY_ID);
    assert.throws(() => resolver(PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID));
    const users = fixture.context.readUsers();
    const source = users.find(user => user.id === PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID);
    const reader = users.find(user => user.id === PRODUCTION_SMOKE_READER_PRINCIPAL_ID);
    assert.equal(source.password, reader.password);
    assert.equal(source.allowFrontendLogin, false);
    assert.equal(reader.role, PRODUCTION_SMOKE_READER_ROLE);

    const repeatedPreview = planProductionScopeRemediation({ db: fixture.context.db, plan });
    assert.equal(repeatedPreview.plannedDiff.CREATE.length, 0);
    assert.equal(repeatedPreview.plannedDiff.UPDATE.length, 0);
    const repeated = applyProductionScopeRemediation({
      db: fixture.context.db,
      plan,
      explicitApply: true,
      expectedPlanChecksum: repeatedPreview.planChecksum,
    });
    assert.equal(repeated.status, 'noop');
    assert.equal(repeated.writes, 0);
  } finally {
    fixture.context.close();
  }
});

test('review bundle authorization is an exact approval-bound semantic-only transition', () => {
  const fixture = createFixture();
  try {
    const { smokeIdentityTransition } = enableSmokeIdentity(fixture);
    const manifest = buildManifest(fixture);
    const plan = buildPlan(fixture, manifest, {
      smokeIdentityTransition,
      sourceDbPath: '/data/app.sqlite',
    });
    const reviewBundle = buildProductionScopeExecutionBundle({ plan, manifest });
    const simulation = passingAuthorizationSimulation(reviewBundle);
    const reviewBundleFileSha256 = '1'.repeat(64);
    const approvalFileSha256 = '2'.repeat(64);
    const simulationOneSha256 = '3'.repeat(64);
    const simulationTwoSha256 = '4'.repeat(64);
    const approval = {
      approvalVersion: 1,
      status: 'APPROVED_FOR_GUARDED_EXECUTION',
      productionExecutionAuthorized: true,
      repository: 'rishatkznAI/rental-management',
      captureDeployedSha: reviewBundle.source.captureDeployedSha,
      captureDeploymentId: reviewBundle.source.captureDeploymentId,
      reviewBundleFileSha256,
      reviewBundleSha256: reviewBundle.bundleSha256,
      reviewExecutionPlanSha256: reviewBundle.executionPlanSha256,
      scopeManifestSha256: reviewBundle.scopeManifestSha256,
      simulationOneSha256,
      simulationTwoSha256,
      independentAuditVerdict: 'PASS',
      approvedBy: 'independent-audit-agent',
      approvedAt: '2026-08-26T18:00:00.000Z',
      approvalReference: 'production-scope-approval-test',
    };
    const authorized = authorizeProductionScopeExecutionBundle({
      reviewBundle,
      reviewBundleFileSha256,
      approval,
      approvalFileSha256,
      simulationOne: simulation,
      simulationOneSha256,
      simulationTwo: structuredClone(simulation),
      simulationTwoSha256,
    });
    assert.equal(authorized.productionExecutionAuthorized, true);
    assert.equal(authorized.executionPlan.productionExecutionAuthorized, true);
    assert.equal(authorized.status, 'APPROVED_FOR_GUARDED_EXECUTION');
    assert.equal(authorized.authorization.approvalFileSha256, approvalFileSha256);
    assert.equal(validateProductionScopeExecutionBundle(authorized, { requireAuthorized: true }).authorized, true);
    assert.deepEqual(authorized.executionPlan.recordMappings, reviewBundle.executionPlan.recordMappings);
    assert.deepEqual(authorized.recordBindings, reviewBundle.recordBindings);

    const divergentSimulation = structuredClone(simulation);
    divergentSimulation.integrity.quickCheck = 'corrupt';
    assert.throws(
      () => authorizeProductionScopeExecutionBundle({
        reviewBundle,
        reviewBundleFileSha256,
        approval,
        approvalFileSha256,
        simulationOne: simulation,
        simulationOneSha256,
        simulationTwo: divergentSimulation,
        simulationTwoSha256,
      }),
      error => error.code === 'EXECUTION_AUTHORIZATION_SIMULATION_FAILED',
    );
    const forged = structuredClone(authorized);
    forged.authorization.scopeManifestSha256 = 'f'.repeat(64);
    forged.bundleSha256 = executionBundleSha256(forged);
    assert.throws(
      () => validateProductionScopeExecutionBundle(forged, { requireAuthorized: true }),
      error => error.code === 'EXECUTION_AUTHORIZATION_BINDING_MISMATCH',
    );
    for (const [field, value] of [
      ['approvalReference', ` ${approval.approvalReference}`],
      ['captureDeployedSha', approval.captureDeployedSha.toUpperCase()],
      ['simulationOneSha256', `${approval.simulationOneSha256} `],
    ]) {
      assert.throws(
        () => authorizeProductionScopeExecutionBundle({
          reviewBundle,
          reviewBundleFileSha256,
          approval: { ...approval, [field]: value },
          approvalFileSha256,
          simulationOne: simulation,
          simulationOneSha256,
          simulationTwo: structuredClone(simulation),
          simulationTwoSha256,
        }),
        error => ['EXECUTION_APPROVAL_INVALID', 'EXECUTION_APPROVAL_BINDING_MISMATCH'].includes(error.code),
        field,
      );
    }
  } finally {
    fixture.context.close();
  }
});

test('authorization CLI promotes only exact hash-pinned regular inputs to exclusive mode-0600 outputs', () => {
  const fixture = createFixture();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-bundle-authorization-'));
  try {
    const { smokeIdentityTransition } = enableSmokeIdentity(fixture);
    const manifest = buildManifest(fixture);
    const plan = buildPlan(fixture, manifest, {
      smokeIdentityTransition,
      sourceDbPath: '/data/app.sqlite',
    });
    const reviewBundle = buildProductionScopeExecutionBundle({ plan, manifest });
    const simulation = passingAuthorizationSimulation(reviewBundle);
    const writeJson = (name, value) => {
      const filePath = path.join(tempDir, name);
      const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
      fs.writeFileSync(filePath, bytes, { mode: 0o600 });
      return { filePath, sha256: hash(bytes) };
    };
    const review = writeJson('review.json', reviewBundle);
    const simulationOne = writeJson('simulation-one.json', simulation);
    const simulationTwo = writeJson('simulation-two.json', structuredClone(simulation));
    const approvalValue = {
      approvalVersion: 1,
      status: 'APPROVED_FOR_GUARDED_EXECUTION',
      productionExecutionAuthorized: true,
      repository: 'rishatkznAI/rental-management',
      captureDeployedSha: reviewBundle.source.captureDeployedSha,
      captureDeploymentId: reviewBundle.source.captureDeploymentId,
      reviewBundleFileSha256: review.sha256,
      reviewBundleSha256: reviewBundle.bundleSha256,
      reviewExecutionPlanSha256: reviewBundle.executionPlanSha256,
      scopeManifestSha256: reviewBundle.scopeManifestSha256,
      simulationOneSha256: simulationOne.sha256,
      simulationTwoSha256: simulationTwo.sha256,
      independentAuditVerdict: 'PASS',
      approvedBy: 'independent-audit-agent',
      approvedAt: '2026-08-26T18:00:00.000Z',
      approvalReference: 'production-scope-cli-approval-test',
    };
    const approval = writeJson('approval.json', approvalValue);
    const outputBundle = path.join(tempDir, 'authorized.json');
    const outputSidecar = path.join(tempDir, 'authorized.sha256');
    const args = [
      'server/scripts/authorize-production-scope-execution-bundle.js',
      '--review-bundle', review.filePath,
      '--review-bundle-sha256', review.sha256,
      '--approval', approval.filePath,
      '--approval-sha256', approval.sha256,
      '--simulation-one', simulationOne.filePath,
      '--simulation-one-sha256', simulationOne.sha256,
      '--simulation-two', simulationTwo.filePath,
      '--simulation-two-sha256', simulationTwo.sha256,
      '--output-bundle', outputBundle,
      '--output-sha256', outputSidecar,
    ];
    const promoted = spawnSync(process.execPath, args, { cwd: path.resolve('.'), encoding: 'utf8' });
    assert.equal(promoted.status, 0, promoted.stderr);
    const authorized = JSON.parse(fs.readFileSync(outputBundle, 'utf8'));
    assert.equal(validateProductionScopeExecutionBundle(authorized, { requireAuthorized: true }).authorized, true);
    assert.equal(fs.readFileSync(outputSidecar, 'utf8').trim(), hash(fs.readFileSync(outputBundle)));
    assert.equal(fs.statSync(outputBundle).mode & 0o777, 0o600);
    assert.equal(fs.statSync(outputSidecar).mode & 0o777, 0o600);

    const replay = spawnSync(process.execPath, args, { cwd: path.resolve('.'), encoding: 'utf8' });
    assert.notEqual(replay.status, 0);
    assert.match(replay.stderr, /OUTPUT_ALREADY_EXISTS/);

    const wrongCaseArgs = [...args];
    wrongCaseArgs[wrongCaseArgs.indexOf('--review-bundle-sha256') + 1] = review.sha256.toUpperCase();
    wrongCaseArgs[wrongCaseArgs.indexOf('--output-bundle') + 1] = path.join(tempDir, 'wrong-case.json');
    wrongCaseArgs[wrongCaseArgs.indexOf('--output-sha256') + 1] = path.join(tempDir, 'wrong-case.sha256');
    const wrongCase = spawnSync(process.execPath, wrongCaseArgs, { cwd: path.resolve('.'), encoding: 'utf8' });
    assert.notEqual(wrongCase.status, 0);
    assert.match(wrongCase.stderr, /INPUT_HASH_REQUIRED/);
    assert.equal(fs.existsSync(path.join(tempDir, 'wrong-case.json')), false);
  } finally {
    fixture.context.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('identity bindings reject internal drift and membership-scope claims that differ from bootstrap', async t => {
  await t.test('stored disposition rows must match their manifest fingerprint', () => {
    const fixture = createFixture();
    try {
      const identity = structuredClone(fixture.identity);
      identity.userDispositions[0].classification = 'UNAPPROVED_CLASSIFICATION';
      const manifest = buildManifest(fixture, { identity });
      assert.equal(manifest.status, 'BLOCKED');
      assert.equal(manifest.blockers.some(row => row.code === 'MANIFEST_IDENTITY_BINDING_REQUIRED'), true);
    } finally {
      fixture.context.close();
    }
  });

  await t.test('YES disposition must exactly match membership branch and role scope', () => {
    const fixture = createFixture();
    try {
      fixture.userDispositions.find(row => row.principalId === BUSINESS_ADMIN_PRINCIPAL_ID).branchIds = ['wrong-branch'];
      fixture.identity.userDispositionFingerprint = hash(stableJson(fixture.userDispositions));
      fixture.identity.userDispositions = structuredClone(fixture.userDispositions);
      const manifest = buildManifest(fixture);
      assert.equal(manifest.status, 'READY_FOR_DISPOSABLE_SIMULATION');
      assert.throws(
        () => buildPlan(fixture, manifest),
        error => error.code === 'USER_MEMBERSHIP_DISPOSITION_SCOPE_MISMATCH',
      );
    } finally {
      fixture.context.close();
    }
  });
});

test('manifest generation fails closed on missing classification, row drift, and non-exact audit parent', async t => {
  await t.test('missing classification', () => {
    const fixture = createFixture();
    try {
      const manifest = buildManifest(fixture, { classificationInventory: fixture.inventory.slice(1) });
      assert.equal(manifest.status, 'BLOCKED');
      assert.equal(manifest.blockers.some(row => row.code === 'CLASSIFICATION_MISSING'), true);
    } finally {
      fixture.context.close();
    }
  });
  await t.test('row hash drift', () => {
    const fixture = createFixture();
    try {
      const changed = [{ ...BASE_COLLECTIONS.knowledge_base_modules[0], title: 'Changed after classification' }];
      fixture.context.db.prepare("UPDATE app_data SET json = ? WHERE name = 'knowledge_base_modules'").run(JSON.stringify(changed));
      fixture.source.databaseContentFingerprint = databaseContentFingerprint(fixture.context.db);
      const manifest = buildManifest(fixture);
      assert.equal(manifest.status, 'BLOCKED');
      assert.equal(manifest.blockers.some(row => row.code === 'CLASSIFICATION_SOURCE_HASH_MISMATCH'), true);
    } finally {
      fixture.context.close();
    }
  });
  await t.test('audit parent must resolve one exact approved record', () => {
    const fixture = createFixture();
    try {
      const audits = structuredClone(BASE_COLLECTIONS.audit_logs);
      audits[0].entityId = 'MISSING-PARENT';
      fixture.context.db.prepare("UPDATE app_data SET json = ? WHERE name = 'audit_logs'").run(JSON.stringify(audits));
      fixture.source.databaseContentFingerprint = databaseContentFingerprint(fixture.context.db);
      fixture.inventory.find(row => row.recordId === 'AUDIT-1').canonicalRecordHash = recordFingerprint(audits[0]);
      const manifest = buildManifest(fixture);
      assert.equal(manifest.status, 'BLOCKED');
      assert.equal(manifest.blockers.some(row => row.code === 'AUDIT_PARENT_NOT_EXACT'), true);
    } finally {
      fixture.context.close();
    }
  });
});

test('manifest fails closed on malformed platform-default/tenant-overlay state', async t => {
  async function withCatalogMutation(name, mutate, expectedCatalogCode) {
    await t.test(name, () => {
      const fixture = createFixture();
      try {
        const collections = structuredClone(BASE_COLLECTIONS);
        mutate(collections);
        for (const collection of ['knowledge_base_modules', 'service_works']) {
          if (!Object.prototype.hasOwnProperty.call(collections, collection)) continue;
          fixture.context.db.prepare(`
            INSERT INTO app_data (name, json) VALUES (?, ?)
            ON CONFLICT(name) DO UPDATE SET json = excluded.json
          `).run(collection, JSON.stringify(collections[collection]));
        }
        refreshFixtureBindings(fixture);
        const manifest = buildManifest(fixture);
        assert.equal(manifest.status, 'BLOCKED');
        assert.equal(manifest.blockers.some(row => (
          row.code === 'PLATFORM_DEFAULT_TENANT_OVERLAY_STATE_INVALID'
          && row.catalogCode === expectedCatalogCode
        )), true, JSON.stringify(manifest.blockers));
      } finally {
        fixture.context.close();
      }
    });
  }

  await withCatalogMutation('dangling explicit override link', collections => {
    collections.knowledge_base_modules[2].platformDefaultId = 'KB-MISSING';
  }, 'CATALOG_OVERRIDE_DEFAULT_NOT_FOUND');

  await withCatalogMutation('duplicate active override', collections => {
    collections.knowledge_base_modules.push({
      ...collections.knowledge_base_modules[2],
      id: 'KB-OVERRIDE-2',
    });
  }, 'CATALOG_ACTIVE_OVERRIDE_DUPLICATE');

  await withCatalogMutation('cross-family default reference', collections => {
    collections.service_works = [{ id: 'WORK-DEFAULT-1', name: 'Platform work' }];
    collections.knowledge_base_modules[2].platformDefaultId = 'WORK-DEFAULT-1';
  }, 'CATALOG_OVERRIDE_CROSS_FAMILY_REFERENCE');

  await t.test('override evidence cannot be relabelled as a standalone tenant entry', () => {
    const fixture = createFixture();
    try {
      fixture.inventory.find(row => row.recordId === 'KB-OVERRIDE-1').disposition =
        'TENANT_OWNED_CATALOG_ENTRY';
      refreshFixtureBindings(fixture);
      const manifest = buildManifest(fixture);
      assert.equal(manifest.status, 'BLOCKED');
      assert.equal(manifest.blockers.some(row => (
        row.code === 'MIXED_CATALOG_CLASSIFICATION_MISMATCH'
        && row.recordId === 'KB-OVERRIDE-1'
      )), true);
    } finally {
      fixture.context.close();
    }
  });
});

test('manifest fails closed on duplicate record identity and scoped preserve-only evidence', async t => {
  await t.test('duplicate stable ID', () => {
    const fixture = createFixture();
    try {
      const rows = [
        ...BASE_COLLECTIONS.knowledge_base_modules,
        structuredClone(BASE_COLLECTIONS.knowledge_base_modules[0]),
      ];
      fixture.context.db.prepare("UPDATE app_data SET json = ? WHERE name = 'knowledge_base_modules'")
        .run(JSON.stringify(rows));
      refreshFixtureBindings(fixture);
      const manifest = buildManifest(fixture);
      assert.equal(manifest.status, 'BLOCKED');
      assert.equal(manifest.blockers.some(row => row.code === 'MANIFEST_RECORD_ID_DUPLICATE'), true);
    } finally {
      fixture.context.close();
    }
  });

  await t.test('preserve-only record cannot arrive already tenant scoped', () => {
    const fixture = createFixture();
    try {
      const audits = structuredClone(BASE_COLLECTIONS.audit_logs);
      audits[1].companyId = COMPANY_ID;
      audits[1].tenantId = COMPANY_ID;
      fixture.context.db.prepare("UPDATE app_data SET json = ? WHERE name = 'audit_logs'")
        .run(JSON.stringify(audits));
      fixture.inventory.find(row => row.recordId === 'AUDIT-2').canonicalRecordHash = recordFingerprint(audits[1]);
      refreshFixtureBindings(fixture);
      const manifest = buildManifest(fixture);
      assert.equal(manifest.status, 'BLOCKED');
      assert.equal(manifest.blockers.some(row => row.code === 'PRESERVED_RECORD_SCOPE_CONFLICT'), true);
    } finally {
      fixture.context.close();
    }
  });
});

test('audit ownership proof rejects wrong-domain and self/circular entity references', async t => {
  async function withChangedAudit(mutator, assertion) {
    const fixture = createFixture();
    try {
      const audits = structuredClone(BASE_COLLECTIONS.audit_logs);
      mutator(audits[0]);
      fixture.context.db.prepare("UPDATE app_data SET json = ? WHERE name = 'audit_logs'").run(JSON.stringify(audits));
      const inventory = fixture.inventory.find(row => row.recordId === 'AUDIT-1');
      const reconciliation = fixture.approvedReconciliation.find(row => row.recordId === 'AUDIT-1');
      inventory.recordId = audits[0].id;
      inventory.canonicalRecordHash = recordFingerprint(audits[0]);
      reconciliation.recordId = audits[0].id;
      reconciliation.sourceRecordHash = inventory.canonicalRecordHash;
      fixture.approvedReconciliation.sort((left, right) => (
        left.collection.localeCompare(right.collection) || left.recordId.localeCompare(right.recordId)
      ));
      refreshFixtureBindings(fixture);
      const manifest = buildManifest(fixture);
      assert.equal(manifest.status, 'BLOCKED');
      assertion(manifest.blockers);
    } finally {
      fixture.context.close();
    }
  }

  await t.test('entity type cannot borrow an ID from another domain', () => withChangedAudit(row => {
    row.entityType = 'equipment';
    row.entityId = 'CP-1';
  }, blockers => {
    assert.equal(blockers.some(row => row.code === 'AUDIT_PARENT_NOT_EXACT'), true);
  }));

  await t.test('history row cannot prove itself or form a circular parent', () => withChangedAudit(row => {
    row.id = 'SELF-AUDIT';
    row.entityType = 'documents';
    row.entityId = 'SELF-AUDIT';
  }, blockers => {
    assert.equal(blockers.some(row => row.code === 'AUDIT_PARENT_NOT_EXACT'), true);
  }));
});

test('same-count disposition swap cannot fabricate approved scope updates', () => {
  const fixture = createFixture();
  try {
    const business = fixture.inventory.find(row => row.recordId === 'CP-1');
    business.disposition = 'AUDIT_B_ACTOR_DERIVED_ONLY';
    const legacyAudit = fixture.inventory.find(row => row.recordId === 'AUDIT-2');
    legacyAudit.disposition = 'TENANT_OWNERSHIP_CANDIDATE';
    fixture.approvedReconciliation = fixture.approvedReconciliation
      .filter(row => row.recordId !== 'CP-1')
      .concat({
        collection: 'audit_logs',
        recordId: 'AUDIT-2',
        sourceRecordHash: legacyAudit.canonicalRecordHash,
        approvalClass: 'BASELINE_OWNERSHIP',
      })
      .sort((left, right) => (
        left.collection.localeCompare(right.collection) || left.recordId.localeCompare(right.recordId)
      ));
    refreshFixtureBindings(fixture);
    const manifest = buildManifest(fixture);
    assert.equal(manifest.status, 'BLOCKED');
    assert.equal(manifest.blockers.filter(row => row.code === 'CLASSIFICATION_POLICY_REJECTED').length, 2);
    assert.equal(fixture.approvedReconciliation.length, 2);
  } finally {
    fixture.context.close();
  }
});

test('claimed source file-set and snapshot hashes are recomputed and fail closed', async t => {
  await t.test('file-set hash', () => {
    const fixture = createFixture();
    try {
      fixture.source.sourceFileSetHash = '0'.repeat(64);
      const manifest = buildManifest(fixture);
      assert.equal(manifest.blockers.some(row => row.code === 'SOURCE_FILE_SET_HASH_MISMATCH'), true);
    } finally {
      fixture.context.close();
    }
  });
  await t.test('snapshot hash', () => {
    const fixture = createFixture();
    try {
      fixture.source.sourceSnapshotHash = '0'.repeat(64);
      const manifest = buildManifest(fixture);
      assert.equal(manifest.blockers.some(row => row.code === 'SOURCE_SNAPSHOT_HASH_MISMATCH'), true);
    } finally {
      fixture.context.close();
    }
  });
  await t.test('observed DB/WAL/SHM hash', () => {
    const fixture = createFixture();
    try {
      fixture.source.sourceObservedFileSetHash = '0'.repeat(64);
      const manifest = buildManifest(fixture);
      assert.equal(
        manifest.blockers.some(row => row.code === 'SOURCE_OBSERVED_FILE_SET_HASH_MISMATCH'),
        true,
      );
    } finally {
      fixture.context.close();
    }
  });
  await t.test('SHM drift is forensic-only and leaves the durable snapshot binding unchanged', () => {
    const fixture = createFixture();
    try {
      const expectedDurableHash = fixture.source.sourceFileSetHash;
      const expectedSnapshotHash = fixture.source.sourceSnapshotHash;
      fixture.source.sourceFileSet[2].sha256 = '9'.repeat(64);
      fixture.source.sourceObservedFileSetHash = sqliteObservedFileSetFingerprint(
        runnerFileSet(fixture.source.sourceFileSet),
      );
      const manifest = buildManifest(fixture);
      assert.equal(manifest.status, 'READY_FOR_DISPOSABLE_SIMULATION', JSON.stringify(manifest.blockers));
      assert.equal(manifest.source.sourceFileSetHash, expectedDurableHash);
      assert.notEqual(manifest.source.sourceObservedFileSetHash, sqliteObservedFileSetFingerprint(runnerFileSet([
        { name: 'app.sqlite', size: 4096, sha256: 'e'.repeat(64) },
        { name: 'app.sqlite-wal', size: 0, sha256: 'f'.repeat(64) },
        { name: 'app.sqlite-shm', size: 32768, sha256: '1'.repeat(64) },
      ])));
      assert.equal(manifest.source.sourceSnapshotHash, expectedSnapshotHash);
    } finally {
      fixture.context.close();
    }
  });
  for (const [name, index] of [['database', 0], ['WAL', 1]]) {
    await t.test(`${name} drift invalidates the durable file-set and snapshot bindings`, () => {
      const fixture = createFixture();
      try {
        fixture.source.sourceFileSet[index].sha256 = '9'.repeat(64);
        fixture.source.sourceObservedFileSetHash = sqliteObservedFileSetFingerprint(
          runnerFileSet(fixture.source.sourceFileSet),
        );
        const manifest = buildManifest(fixture);
        assert.equal(manifest.status, 'BLOCKED');
        assert.equal(manifest.blockers.some(row => row.code === 'SOURCE_FILE_SET_HASH_MISMATCH'), true);
        assert.equal(manifest.blockers.some(row => row.code === 'SOURCE_SNAPSHOT_HASH_MISMATCH'), true);
      } finally {
        fixture.context.close();
      }
    });
  }
});

test('post-state verifier locates MAP records by map key and verifies SINGLETON content', () => {
  const fixture = createFixture();
  try {
    const manifest = buildManifest(fixture);
    const plan = buildPlan(fixture, manifest);
    const preview = planProductionScopeRemediation({ db: fixture.context.db, plan });
    applyProductionScopeRemediation({
      db: fixture.context.db,
      plan,
      explicitApply: true,
      expectedPlanChecksum: preview.planChecksum,
    });
    const clean = verifyManifestRecords(fixture.context.db, manifest);
    assert.deepEqual(clean.violations, []);
    const changedMap = structuredClone(BASE_COLLECTIONS.bot_users);
    changedMap[DEMO_BOT_MAP_KEY].fixtureTag = 'CHANGED';
    fixture.context.db.prepare("UPDATE app_data SET json = ? WHERE name = 'bot_users'").run(JSON.stringify(changedMap));
    const changedSingleton = { ...BASE_COLLECTIONS.snapshot, state: 'changed' };
    fixture.context.db.prepare("UPDATE app_data SET json = ? WHERE name = 'snapshot'").run(JSON.stringify(changedSingleton));
    const drift = verifyManifestRecords(fixture.context.db, manifest);
    assert.equal(drift.violations.filter(row => row.code === 'POST_CONTENT_HASH_MISMATCH').length, 2);
  } finally {
    fixture.context.close();
  }
});

test('evidence swap is rejected by the externally pinned artifact-index hash chain', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-evidence-index-test-'));
  try {
    const analysis = path.join(directory, 'analysis');
    fs.mkdirSync(analysis);
    const evidencePath = path.join(analysis, 'scope-record-inventory.json');
    fs.writeFileSync(evidencePath, '[{"classification":"original"}]\n');
    const artifact = {
      relativePath: 'analysis/scope-record-inventory.json',
      size: fs.statSync(evidencePath).size,
      sha256: hash(fs.readFileSync(evidencePath)),
      sensitive: true,
    };
    const index = {
      indexVersion: 2,
      generatedAt: '2026-08-26T00:00:00.000Z',
      packPath: directory,
      packFingerprint: hash(stableJson([artifact])),
      artifacts: [artifact],
    };
    const indexPath = path.join(directory, 'artifact-index.json');
    fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
    const approvedIndexHash = hash(fs.readFileSync(indexPath));
    const verifiedPack = verifyEvidencePack(directory, approvedIndexHash);
    assert.equal(verifiedPack.indexSha256, approvedIndexHash);
    fs.writeFileSync(evidencePath, '[{"classification":"swapped!"}]\n');
    assert.throws(
      () => readIndexedJson(directory, verifiedPack, 'analysis/scope-record-inventory.json'),
      error => error.code === 'EVIDENCE_ARTIFACT_HASH_MISMATCH',
    );
    assert.throws(
      () => verifyEvidencePack(directory, approvedIndexHash),
      error => error.code === 'EVIDENCE_ARTIFACT_HASH_MISMATCH',
    );
    assert.throws(
      () => verifyEvidencePack(directory, '0'.repeat(64)),
      error => error.code === 'EVIDENCE_INDEX_HASH_MISMATCH',
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('reviewed identity plan input is regular-file and externally hash bound', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-identity-plan-test-'));
  try {
    const planPath = path.join(directory, 'identity-plan.json');
    fs.writeFileSync(planPath, '{"status":"APPROVED"}\n');
    const approvedHash = hash(fs.readFileSync(planPath));
    assert.deepEqual(readHashBoundJson(planPath, approvedHash, 'IDENTITY_PLAN'), {
      value: { status: 'APPROVED' },
      sha256: approvedHash,
    });
    const approvedPath = path.join(directory, 'identity-plan-approved.json');
    const originalOpenSync = fs.openSync;
    let swappedAfterOpen = false;
    fs.openSync = function swapPathAfterTrustedOpen(target, ...args) {
      const fd = originalOpenSync.call(this, target, ...args);
      if (!swappedAfterOpen && typeof target === 'string' && path.resolve(target) === planPath) {
        swappedAfterOpen = true;
        fs.renameSync(planPath, approvedPath);
        fs.writeFileSync(planPath, '{"status":"SWAPPED"}\n');
      }
      return fd;
    };
    try {
      assert.deepEqual(readHashBoundJson(planPath, approvedHash, 'IDENTITY_PLAN'), {
        value: { status: 'APPROVED' },
        sha256: approvedHash,
      });
      assert.equal(swappedAfterOpen, true);
    } finally {
      fs.openSync = originalOpenSync;
      fs.unlinkSync(planPath);
      fs.renameSync(approvedPath, planPath);
    }
    assert.throws(
      () => readHashBoundJson(planPath, '0'.repeat(64), 'IDENTITY_PLAN'),
      error => error.code === 'IDENTITY_PLAN_HASH_MISMATCH',
    );
    const symlinkPath = path.join(directory, 'identity-plan-link.json');
    fs.symlinkSync(planPath, symlinkPath);
    assert.throws(
      () => readHashBoundJson(symlinkPath, approvedHash, 'IDENTITY_PLAN'),
      error => error.code === 'IDENTITY_PLAN_FILE_INVALID',
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('capture selection permits SHM-only drift but rejects DB or WAL drift', () => {
  const roundA = [
    { name: 'app.sqlite', size: 100, sha256: '1'.repeat(64) },
    { name: 'app.sqlite-wal', size: 200, sha256: '2'.repeat(64) },
    { name: 'app.sqlite-shm', size: 300, sha256: '3'.repeat(64) },
  ];
  const roundB = structuredClone(roundA);
  roundB[2].sha256 = '4'.repeat(64);
  const sourceFileSetHash = sqliteFileSetFingerprint(runnerFileSet(roundA));
  const observedA = sqliteObservedFileSetFingerprint(runnerFileSet(roundA));
  const observedB = sqliteObservedFileSetFingerprint(runnerFileSet(roundB));
  const capture = {
    analysisRound: 'roundB',
    roundA,
    roundB,
    durableRoundsByteIdentical: true,
    shmObservationByteIdentical: false,
    sourceFileSetHash,
    sourceObservedFileSetHash: observedB,
    sourceObservedFileSetHashes: { roundA: observedA, roundB: observedB },
  };

  assert.throws(
    () => selectCaptureRound(capture, roundA),
    error => error.code === 'CAPTURE_ANALYSIS_ROUND_MISMATCH',
  );
  assert.deepEqual(selectCaptureRound(capture, roundB), {
    selectedRound: 'roundB',
    sourceFileSetHash,
    sourceObservedFileSetHash: observedB,
    sourceFileSet: roundB,
  });

  for (const index of [0, 1]) {
    const drifted = structuredClone(capture);
    drifted.roundB[index].sha256 = '9'.repeat(64);
    drifted.durableRoundsByteIdentical = false;
    assert.throws(
      () => selectCaptureRound(drifted, roundA),
      error => error.code === 'CAPTURE_DURABLE_ROUNDS_MISMATCH',
    );
  }
});

test('artifact publication is all-or-clean when an output is pre-existing or duplicated', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-artifact-publication-test-'));
  try {
    const manifestPath = path.join(directory, 'manifest.json');
    const existingPath = path.join(directory, 'simulation.json');
    fs.writeFileSync(existingPath, 'reviewed-existing-artifact\n', { mode: 0o600 });
    assert.throws(
      () => writeNewJsonSet([
        { filePath: manifestPath, value: { status: 'READY' } },
        { filePath: existingPath, value: { status: 'PASS' } },
      ]),
      error => error.code === 'ARTIFACT_OUTPUT_EXISTS',
    );
    assert.equal(fs.existsSync(manifestPath), false);
    assert.equal(fs.readFileSync(existingPath, 'utf8'), 'reviewed-existing-artifact\n');
    const invalidPath = path.join(directory, 'invalid.json');
    assert.throws(() => writeNewJsonSet([
      { filePath: manifestPath, value: { status: 'READY' } },
      { filePath: invalidPath, value: { unsupported: 1n } },
    ]));
    assert.equal(fs.existsSync(manifestPath), false);
    assert.equal(fs.existsSync(invalidPath), false);
    const protectedPath = path.join(directory, 'protected.json');
    writeNewJsonSet([{ filePath: protectedPath, value: { status: 'PASS' } }]);
    assert.equal(fs.statSync(protectedPath).mode & 0o777, 0o600);
    assert.throws(
      () => writeNewJsonSet([
        { filePath: manifestPath, value: {} },
        { filePath: manifestPath, value: {} },
      ]),
      error => error.code === 'ARTIFACT_OUTPUT_PATH_DUPLICATE',
    );
    assert.equal(fs.existsSync(manifestPath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
