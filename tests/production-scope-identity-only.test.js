import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import {
  createPlatformIdentityContext,
} from './platform-identity-fixtures.js';

const require = createRequire(import.meta.url);
const {
  IDENTITY_ONLY_EXECUTION_SCOPE,
  applyProductionScopeRemediation,
  collectionFingerprint,
  databaseIdentity,
  planProductionScopeRemediation,
  sqliteTotalChanges,
  stableJson,
} = require('../server/lib/production-scope-remediation.js');
const {
  buildExecutionPlan,
} = require('../server/lib/production-scope-remediation-runner.js');
const {
  executionBundleSha256,
  executionPlanSha256,
  validateProductionScopeExecutionBundle,
} = require('../server/lib/production-scope-execution-plan-bundle.js');
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
  calculateBootstrapChecksum,
  getSchemaFingerprint,
} = require('../server/lib/platform-identity-bootstrap.js');

const COMPANY_ID = 'cmp_7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ';
const HEAD_OFFICE_ID = 'brn_VRNOM4ABOTHKRJYODGZSPVE3WPN6CGOJITLZBD2SCYWODKFF5NYQ';
const OWNER_ID = '1775756913074';
const MEMBERSHIP_ID = 'mbr_G2QDD6FEGGZ7TVGHUJQGJJM3JE4DM3HS43RNCDPUXXQ3BNZGAI7Q';
const INTENTIONALLY_UNMAPPED_IDS = Object.freeze([
  '1776673416137',
  '1787547467703',
  'DEMO-USER-CARRIER',
  'production-smoke-admin',
]);

const USERS = Object.freeze([
  Object.freeze({
    id: OWNER_ID,
    status: 'Активен',
    role: 'Администратор',
    name: 'Хабибрахманов Ришат Ринатович',
  }),
  Object.freeze({
    id: '1776673416137',
    status: 'Активен',
    role: 'Офис-менеджер',
    name: 'Мениса',
    email: 'kmzh@mantall.ru',
  }),
  Object.freeze({
    id: '1787547467703',
    status: 'Активен',
    role: 'Менеджер по аренде',
    name: 'Айзат',
    email: 'mp2@mantall.ru',
  }),
  Object.freeze({
    id: 'DEMO-USER-CARRIER',
    status: 'Активен',
    role: 'Перевозчик',
    name: 'Demo Carrier User',
  }),
  Object.freeze({
    id: 'production-smoke-admin',
    status: 'Активен',
    role: 'Администратор',
    name: 'Production Smoke Admin',
  }),
]);

function identityBootstrapConfig(db) {
  const config = {
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
      capabilities: [
        'branches.manage',
        'companies.manage',
        'members.manage',
      ],
    }],
    memberships: [{
      id: MEMBERSHIP_ID,
      principalId: OWNER_ID,
      status: 'active',
      roleTemplateKey: 'company-administrator',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: true,
      branchIds: [],
      capabilityAssignments: [],
    }],
    intentionallyUnmappedUserIds: [...INTENTIONALLY_UNMAPPED_IDS],
    approval: {
      approvedBy: OWNER_ID,
      approvedAt: '2026-09-01T00:00:00.000Z',
      approvalReference: 'AUTHORITATIVE_PRINCIPAL_DISPOSITION_2026-09-01',
      backupReference: 'fresh-backup-receipt-test',
    },
  };
  config.approval.schemaFingerprint = getSchemaFingerprint(db);
  config.approval.configChecksum = calculateBootstrapChecksum(db, config);
  return config;
}

function identityCountsExpectation() {
  return {
    canonical_companies: [0, 1],
    canonical_branches: [0, 1],
    company_memberships: [0, 1],
    membership_branch_access: [0],
    role_templates: [0, 1],
    role_template_capabilities: [0, 3],
    membership_capability_assignments: [0],
    authorization_audit_events: [0, 4],
    identity_bootstrap_runs: [0, 1],
  };
}

function createIdentityOnlyFixture() {
  const context = createPlatformIdentityContext({ users: USERS });
  const insert = context.db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)');
  insert.run('clients', '{ deliberately-invalid-business-json');
  insert.run('equipment', JSON.stringify([{ id: 'EQ-PRESERVE', status: 'available' }]));
  insert.run('app_settings', JSON.stringify({ preserve: true }));
  const users = context.readUsers();
  const config = identityBootstrapConfig(context.db);
  const plan = {
    executionScope: IDENTITY_ONLY_EXECUTION_SCOPE,
    planVersion: 1,
    planId: 'skytech-identity-only-test-v1',
    expected: {
      dbIdentity: databaseIdentity(context.db),
      identityCounts: identityCountsExpectation(),
      collectionCounts: { users: users.length },
      collectionFingerprints: { users: [collectionFingerprint(users)] },
    },
    authority: {
      status: 'APPROVED',
      companyId: COMPANY_ID,
      tenantId: COMPANY_ID,
      identityBootstrap: config,
    },
    actorMappings: [
      {
        userId: OWNER_ID,
        action: 'CREATE_MEMBERSHIP',
        membershipId: MEMBERSHIP_ID,
        companyId: COMPANY_ID,
        tenantId: COMPANY_ID,
      },
      ...INTENTIONALLY_UNMAPPED_IDS.map(userId => ({
        userId,
        action: 'NO_MEMBERSHIP',
        candidateForProductionMembership: false,
      })),
    ],
    recordMappings: [],
    relationMappings: [],
    backup: {
      verified: true,
      reference: 'fresh-backup-receipt-test',
      sourceDbIdentity: `schema:${getSchemaFingerprint(context.db)}`,
      timestamp: '2026-09-01T00:00:00.000Z',
      sizeBytes: 4096,
      sha256: 'a'.repeat(64),
    },
  };
  return { context, plan };
}

function exactAuthorizedExecutionPlan(plan) {
  const sourceBindingsFingerprint = currentRepositorySourceBindingsFingerprint();
  const source = {
    captureDeployedSha: '1'.repeat(40),
    captureDeploymentId: '11111111-1111-4111-8111-111111111111',
    railwayIdentity: {
      projectId: '22222222-2222-4222-8222-222222222222',
      environmentId: '33333333-3333-4333-8333-333333333333',
      serviceId: '44444444-4444-4444-8444-444444444444',
      volumeId: '55555555-5555-4555-8555-555555555555',
      volumeName: 'skytech-production-data',
      volumeMountPath: '/data',
    },
    deploymentIdentity: {
      serviceInstanceId: '66666666-6666-4666-8666-666666666666',
      deploymentInstanceId: '77777777-7777-4777-8777-777777777777',
    },
    sourceSnapshotHash: '2'.repeat(64),
    sourceFileSetHash: '3'.repeat(64),
    sourceObservedFileSetHash: '4'.repeat(64),
    databaseContentFingerprint: '5'.repeat(64),
    schemaFingerprint: plan.expected.dbIdentity.schemaFingerprint,
  };
  const evidence = {
    artifactIndexSha256: '6'.repeat(64),
    baselineContractSha256: baselineStableJsonSha256(PRODUCTION_BASELINE_CONTRACT),
    candidateKeySetSha256: PRODUCTION_BASELINE_CONTRACT.candidateKeySetSha256,
    candidateAuthoritySha256: PRODUCTION_BASELINE_CONTRACT.candidateAuthoritySha256,
    canonicalScopeSha256: PRODUCTION_BASELINE_CONTRACT.canonicalScopeSha256,
    classificationAuthorityFingerprint: crypto.createHash('sha256')
      .update(stableJson(classificationAuthoritySnapshot()))
      .digest('hex'),
    packFingerprint: '7'.repeat(64),
    sourceBindingsFingerprint,
    platformDefaultTenantOverlaySemantics: structuredClone(
      PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
    ),
    reviewedPlanFileSha256: '8'.repeat(64),
    approvedReconciliationFingerprint: '9'.repeat(64),
  };
  const basePlan = structuredClone(plan);
  Object.assign(basePlan, {
    sourceDbPath: '/data/app.sqlite',
    manifestVersion: 2,
    sourceBindingsFingerprint,
    platformDefaultTenantOverlaySemantics: structuredClone(
      PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
    ),
    scopeManifestSha256: 'a'.repeat(64),
    productionExecutionAuthorized: true,
    exactSourceBinding: { source, evidence },
    backup: {
      verified: false,
      reference: null,
      sourceDbIdentity: null,
      timestamp: null,
      sizeBytes: null,
      sha256: null,
    },
  });
  basePlan.authority.identityBootstrap.approval.backupReference = (
    'PENDING_VERIFIED_PRODUCTION_BACKUP'
  );
  const bundle = {
    bundleVersion: 1,
    status: 'APPROVED_FOR_GUARDED_EXECUTION',
    productionExecutionAuthorized: true,
    sourceBindingsFingerprint,
    platformDefaultTenantOverlaySemantics: structuredClone(
      PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
    ),
    authorization: {
      authorizationVersion: 1,
      approvalFileSha256: 'b'.repeat(64),
      approvalReference: 'identity-only-core-test-approval',
      approvedAt: '2026-09-01T01:00:00.000Z',
      approvedBy: OWNER_ID,
      authorityConfigChecksum:
        basePlan.authority.identityBootstrap.approval.configChecksum,
      authorizedExecutionSha: source.captureDeployedSha,
      captureDeployedSha: source.captureDeployedSha,
      independentAuditVerdict: 'PASS',
      reviewBundleFileSha256: 'c'.repeat(64),
      reviewBundleSha256: 'd'.repeat(64),
      reviewExecutionPlanSha256: 'e'.repeat(64),
      scopeManifestSha256: basePlan.scopeManifestSha256,
      simulationOneSha256: 'f'.repeat(64),
      simulationTwoSha256: '0'.repeat(64),
    },
    scopeManifestSha256: basePlan.scopeManifestSha256,
    source,
    evidence,
    summary: {
      registryEntryCount: 0,
      registryWriteCount: 0,
      classifiedRecordCount: 0,
      executionRecordMappingCount: 0,
      semanticScopeWriteCount: 0,
      operationCounts: {},
      collectionWriteCounts: {},
      globalReferenceCollectionCount: 0,
    },
    executionPlanSha256: executionPlanSha256(basePlan),
    executionPlan: basePlan,
    recordBindings: [],
  };
  bundle.bundleSha256 = executionBundleSha256(bundle);
  const authorizedBase = validateProductionScopeExecutionBundle(
    bundle,
    { requireAuthorized: true },
  ).plan;
  return buildExecutionPlan(authorizedBase, {
    receiptVersion: 2,
    backupId: '88888888-8888-4888-8888-888888888888',
    filename: 'rentcore-phase-a-20260901T000000Z.zip',
    generatedAt: '2026-09-01T00:00:00.000Z',
    sizeBytes: 4096,
    sha256: '1'.repeat(64),
    sourceDbIdentity: plan.backup.sourceDbIdentity,
    databaseFingerprint: '2'.repeat(64),
    sourceFileSetFingerprint: '3'.repeat(64),
    sourceObservedFileSetFingerprint: '4'.repeat(64),
    stateFingerprint: '5'.repeat(64),
    userInventoryFingerprint: '6'.repeat(64),
    deployedSha: source.captureDeployedSha,
    bundledPlanChecksum: '7'.repeat(64),
    authorityConfigChecksum:
      basePlan.authority.identityBootstrap.approval.configChecksum,
    canonicalCompanyId: COMPANY_ID,
    railwayIdentity: source.railwayIdentity,
  });
}

function appDataRows(db) {
  return db.prepare('SELECT * FROM app_data ORDER BY name').all();
}

test('identity-only dry-run and apply project only the approved identity creates and preserve app_data', () => {
  const { context, plan: reviewPlan } = createIdentityOnlyFixture();
  try {
    const plan = exactAuthorizedExecutionPlan(reviewPlan);
    const beforeAppData = appDataRows(context.db);
    const beforeDryRunChanges = sqliteTotalChanges(context.db);
    const preview = planProductionScopeRemediation({ db: context.db, plan });

    assert.equal(preview.readyToApply, true, JSON.stringify(preview.blockers));
    assert.equal(preview.writes, 0);
    assert.equal(sqliteTotalChanges(context.db), beforeDryRunChanges);
    assert.deepEqual(preview.observed.targetCollections, []);
    assert.deepEqual(Object.keys(preview.observed.collectionCounts), ['users']);
    assert.deepEqual(Object.keys(preview.observed.collectionFingerprints), ['users']);
    assert.match(preview.observed.appDataFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(preview.plannedDiff.CREATE.map(item => item.type), [
      'Company',
      'Branch',
      'RoleTemplate',
      'Membership',
    ]);
    assert.equal(preview.plannedDiff.CREATE[1].value.isHeadOffice, true);
    assert.equal(preview.plannedDiff.CREATE[2].id, 'company-administrator:v1');
    assert.equal(preview.plannedDiff.CREATE[3].value.principalId, OWNER_ID);
    assert.deepEqual(preview.plannedDiff.UPDATE, []);
    assert.deepEqual(preview.plannedDiff.RELINK, []);
    assert.deepEqual(preview.plannedDiff.UNRESOLVED, []);

    const applied = applyProductionScopeRemediation({
      db: context.db,
      plan,
      explicitApply: true,
      expectedPlanChecksum: preview.planChecksum,
    });

    assert.equal(applied.status, 'succeeded');
    assert.equal(applied.collectionWrites, 0);
    assert.equal(applied.smokeIdentityStatus, 'noop');
    assert.deepEqual(appDataRows(context.db), beforeAppData);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_companies').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_branches').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM role_templates').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM company_memberships').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM membership_branch_access').get().count, 0);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM membership_capability_assignments').get().count, 0);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM authorization_audit_events').get().count, 4);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM identity_bootstrap_runs').get().count, 1);
    assert.equal(context.db.prepare(`
      SELECT COUNT(*) AS count
      FROM company_memberships
      WHERE principalId IN (?, ?, ?, ?)
    `).get(...INTENTIONALLY_UNMAPPED_IDS).count, 0);
  } finally {
    context.close();
  }
});

test('identity-only input rejects every business, relation, smoke, and non-users collection surface', async t => {
  const cases = [
    {
      name: 'additional membership authority',
      code: 'IDENTITY_ONLY_AUTHORITY_MISMATCH',
      mutate(plan) {
        plan.authority.identityBootstrap.memberships.push({
          ...plan.authority.identityBootstrap.memberships[0],
          id: 'mbr_UNAPPROVED',
          principalId: '1776673416137',
        });
      },
    },
    {
      name: 'record mapping',
      code: 'IDENTITY_ONLY_RECORD_MAPPINGS_FORBIDDEN',
      mutate(plan) {
        plan.recordMappings = [{ collection: 'clients', id: 'C-1', action: 'UPDATE_SCOPE' }];
      },
    },
    {
      name: 'relation mapping',
      code: 'IDENTITY_ONLY_RELATION_MAPPINGS_FORBIDDEN',
      mutate(plan) {
        plan.relationMappings = [{
          collection: 'clients',
          id: 'C-1',
          field: 'counterpartyId',
          action: 'RELINK',
        }];
      },
    },
    {
      name: 'smoke identity transition',
      code: 'IDENTITY_ONLY_SMOKE_IDENTITY_TRANSITION_FORBIDDEN',
      mutate(plan) {
        plan.smokeIdentityTransition = {};
      },
    },
    {
      name: 'business collection count',
      code: 'IDENTITY_ONLY_COLLECTION_EXPECTATION_FORBIDDEN',
      mutate(plan) {
        plan.expected.collectionCounts.clients = 1;
      },
    },
    {
      name: 'business collection fingerprint',
      code: 'IDENTITY_ONLY_COLLECTION_EXPECTATION_FORBIDDEN',
      mutate(plan) {
        plan.expected.collectionFingerprints.equipment = ['b'.repeat(64)];
      },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const { context, plan } = createIdentityOnlyFixture();
      try {
        scenario.mutate(plan);
        const preview = planProductionScopeRemediation({ db: context.db, plan });
        assert.equal(preview.readyToApply, false);
        assert.ok(preview.blockers.some(blocker => blocker.code === scenario.code));
        assert.deepEqual(preview.observed.targetCollections, []);
        assert.deepEqual(preview.plannedDiff.CREATE, []);
        assert.deepEqual(preview.plannedDiff.UPDATE, []);
        assert.deepEqual(preview.plannedDiff.RELINK, []);
      } finally {
        context.close();
      }
    });
  }
});

test('identity-only apply detects an unexpected app_data mutation and rolls back every write', () => {
  const { context, plan: reviewPlan } = createIdentityOnlyFixture();
  try {
    const plan = exactAuthorizedExecutionPlan(reviewPlan);
    const beforeAppData = appDataRows(context.db);
    const preview = planProductionScopeRemediation({ db: context.db, plan });
    assert.equal(preview.readyToApply, true, JSON.stringify(preview.blockers));

    assert.throws(
      () => applyProductionScopeRemediation({
        db: context.db,
        plan,
        explicitApply: true,
        expectedPlanChecksum: preview.planChecksum,
        faultInjector({ stage }) {
          if (stage === 'before_commit') {
            context.db.prepare(`
              UPDATE app_data SET json = ?, updated_at = ? WHERE name = 'clients'
            `).run('[]', '2026-09-01T00:00:01.000Z');
          }
        },
      }),
      error => error?.code === 'IDENTITY_ONLY_APP_DATA_MUTATION_DETECTED',
    );

    assert.deepEqual(appDataRows(context.db), beforeAppData);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_companies').get().count, 0);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM company_memberships').get().count, 0);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM authorization_audit_events').get().count, 0);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM identity_bootstrap_runs').get().count, 0);
  } finally {
    context.close();
  }
});

test('a raw identity plan cannot call the apply core without exact bundle authorization', () => {
  const { context, plan } = createIdentityOnlyFixture();
  try {
    const preview = planProductionScopeRemediation({ db: context.db, plan });
    assert.throws(
      () => applyProductionScopeRemediation({
        db: context.db,
        plan,
        explicitApply: true,
        expectedPlanChecksum: preview.planChecksum,
      }),
      error => error?.code === 'IDENTITY_ONLY_AUTHORIZED_EXECUTION_BUNDLE_REQUIRED',
    );
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_companies').get().count, 0);
  } finally {
    context.close();
  }
});

test('identity-only apply rolls back a content-neutral extra SQL write', () => {
  const { context, plan: reviewPlan } = createIdentityOnlyFixture();
  try {
    const plan = exactAuthorizedExecutionPlan(reviewPlan);
    const preview = planProductionScopeRemediation({ db: context.db, plan });
    assert.throws(
      () => applyProductionScopeRemediation({
        db: context.db,
        plan,
        explicitApply: true,
        expectedPlanChecksum: preview.planChecksum,
        afterWrites() {
          context.db.prepare("UPDATE app_data SET json = json WHERE name = 'users'").run();
        },
      }),
      error => error?.code === 'IDENTITY_ONLY_SQL_WRITE_MANIFEST_MISMATCH',
    );
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_companies').get().count, 0);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM identity_bootstrap_runs').get().count, 0);
  } finally {
    context.close();
  }
});
