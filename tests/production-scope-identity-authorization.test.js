import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  authorizeProductionScopeExecutionBundle,
  IDENTITY_SIMULATION_CLASSIFICATION,
} = require('../server/lib/production-scope-execution-authorization.js');
const {
  buildProductionScopeExecutionBundle,
  executionBundleSha256,
  executionPlanSha256,
  validateProductionScopeExecutionBundle,
} = require('../server/lib/production-scope-execution-plan-bundle.js');
const {
  COMPANY_ID,
  EXPECTED_EXACT_CHANGES,
  EXPECTED_ROW_COUNT_DELTAS,
  OWNER_MEMBERSHIP_ID,
  OWNER_PRINCIPAL_ID,
  buildCanonicalIdentityBootstrapConfig,
} = require('../server/lib/identity-bootstrap-execution-bundle.js');
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
const { stableJson } = require('../server/lib/production-scope-remediation.js');

const HASH = character => character.repeat(64);
const EXECUTION_SHA = '1'.repeat(40);
const UNMAPPED_PRINCIPAL_IDS = [
  '1776673416137',
  '1787547467703',
  'DEMO-USER-CARRIER',
  'production-smoke-admin',
];
const UNRESOLVED_PREPARATION_BINDINGS = [
  'appDataFingerprint',
  'approvedAt',
  'authorityConfigChecksum',
  'authorizedExecutionSha',
  'backupReference',
  'captureDeployedSha',
  'captureDeploymentId',
  'databaseContentFingerprint',
  'durableFileSetFingerprint',
  'executionPlanChecksum',
  'expectedPostStateFingerprint',
  'freshBackupReceipt',
  'observedFileSetFingerprint',
  'schemaFingerprint',
  'sourceSnapshotSha256',
  'stateFingerprint',
  'userInventoryFingerprint',
  'usersDirectoryFingerprint',
];
const SOURCE_BINDINGS_FINGERPRINT = currentRepositorySourceBindingsFingerprint();
const AUTHORITY_COMMITMENTS = Object.freeze({
  baselineContractSha256: baselineStableJsonSha256(PRODUCTION_BASELINE_CONTRACT),
  candidateKeySetSha256: PRODUCTION_BASELINE_CONTRACT.candidateKeySetSha256,
  candidateAuthoritySha256: PRODUCTION_BASELINE_CONTRACT.candidateAuthoritySha256,
  canonicalScopeSha256: PRODUCTION_BASELINE_CONTRACT.canonicalScopeSha256,
  classificationAuthorityFingerprint: crypto.createHash('sha256')
    .update(stableJson(classificationAuthoritySnapshot()))
    .digest('hex'),
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function manifestHash(manifest) {
  const projected = structuredClone(manifest);
  delete projected.manifestSha256;
  return sha256(stableJson(projected));
}

function identityCounts() {
  return Object.fromEntries(Object.entries(EXPECTED_ROW_COUNT_DELTAS).map(
    ([table, delta]) => [table, delta === 0 ? [0] : [0, delta]],
  ));
}

function reviewBundleFixture() {
  const schemaFingerprint = HASH('a');
  const source = {
    captureDeployedSha: '1'.repeat(40),
    captureDeploymentId: '12345678-1234-4123-8123-123456789abc',
    railwayIdentity: {
      projectId: '22345678-1234-4123-8123-123456789abc',
      environmentId: '32345678-1234-4123-8123-123456789abc',
      serviceId: '42345678-1234-4123-8123-123456789abc',
      volumeId: '52345678-1234-4123-8123-123456789abc',
      volumeName: 'skytech-production-data',
      volumeMountPath: '/data',
    },
    deploymentIdentity: {
      serviceInstanceId: '62345678-1234-4123-8123-123456789abc',
      deploymentInstanceId: '72345678-1234-4123-8123-123456789abc',
    },
    sourceSnapshotHash: HASH('b'),
    sourceFileSetHash: HASH('c'),
    sourceObservedFileSetHash: HASH('d'),
    databaseContentFingerprint: HASH('e'),
    schemaFingerprint,
  };
  const evidence = {
    artifactIndexSha256: HASH('1'),
    ...AUTHORITY_COMMITMENTS,
    packFingerprint: HASH('2'),
    sourceBindingsFingerprint: SOURCE_BINDINGS_FINGERPRINT,
    platformDefaultTenantOverlaySemantics: structuredClone(
      PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
    ),
    reviewedPlanFileSha256: HASH('3'),
    approvedReconciliationFingerprint: HASH('4'),
  };
  const manifest = {
    manifestVersion: 2,
    status: 'READY_FOR_DISPOSABLE_SIMULATION',
    productionExecutionAuthorized: false,
    platformDefaultTenantOverlaySemantics: structuredClone(
      PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
    ),
    source,
    canonicalScope: { companyId: COMPANY_ID, tenantId: COMPANY_ID },
    registry: { entryCount: 0, globalReferenceCollectionCount: 0 },
    evidence: {
      artifactIndexSha256: evidence.artifactIndexSha256,
      ...AUTHORITY_COMMITMENTS,
      packFingerprint: evidence.packFingerprint,
      approvedReconciliationFingerprint: evidence.approvedReconciliationFingerprint,
      sourceBindingsFingerprint: evidence.sourceBindingsFingerprint,
      platformDefaultTenantOverlaySemantics: structuredClone(
        evidence.platformDefaultTenantOverlaySemantics,
      ),
    },
    identity: { reviewedPlanFileSha256: evidence.reviewedPlanFileSha256 },
    summary: {
      classifiedRecordCount: 0,
      operationCounts: {},
      collectionWriteCounts: {},
      semanticScopeWriteCount: 0,
      unresolvedRecordCount: 0,
    },
    records: [],
    blockers: [],
  };
  manifest.manifestSha256 = manifestHash(manifest);

  const config = buildCanonicalIdentityBootstrapConfig({
    approvedAt: '2026-09-01T00:00:00.000Z',
    schemaFingerprint,
    backupReference: 'UNRESOLVED_FRESH_PRODUCTION_BACKUP',
    configChecksum: HASH('f'),
  });
  const plan = {
    executionScope: 'IDENTITY_ONLY',
    planVersion: 1,
    manifestVersion: 2,
    sourceBindingsFingerprint: SOURCE_BINDINGS_FINGERPRINT,
    platformDefaultTenantOverlaySemantics: structuredClone(
      PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
    ),
    planId: 'skytech-owner-approved-identity-bootstrap-v1',
    sourceDbPath: '/data/app.sqlite',
    expected: {
      dbIdentity: {
        applicationId: 0,
        pageSize: 4096,
        schemaFingerprint,
        userVersion: 0,
      },
      identityCounts: identityCounts(),
      collectionCounts: { users: 5 },
      collectionFingerprints: { users: [HASH('8')] },
    },
    authority: {
      status: 'APPROVED',
      companyId: COMPANY_ID,
      tenantId: COMPANY_ID,
      identityBootstrap: config,
    },
    actorMappings: [
      {
        userId: OWNER_PRINCIPAL_ID,
        action: 'CREATE_MEMBERSHIP',
        membershipId: OWNER_MEMBERSHIP_ID,
        companyId: COMPANY_ID,
        tenantId: COMPANY_ID,
      },
      ...UNMAPPED_PRINCIPAL_IDS.map(userId => ({
        userId,
        action: 'NO_MEMBERSHIP',
        candidateForProductionMembership: false,
      })),
    ],
    recordMappings: [],
    relationMappings: [],
    backup: {
      verified: false,
      reference: null,
      sourceDbIdentity: null,
      timestamp: null,
      sizeBytes: null,
      sha256: null,
    },
  };
  return buildProductionScopeExecutionBundle({ plan, manifest });
}

function identitySimulation(reviewBundle) {
  return {
    simulationVersion: 1,
    classification: IDENTITY_SIMULATION_CLASSIFICATION,
    status: 'PASS',
    executionScope: 'IDENTITY_ONLY',
    productionExecutionAuthorized: false,
    productionWritePerformed: false,
    writesPerformed: 0,
    authorizationBindingsComplete: true,
    authorizedExecutionSha: EXECUTION_SHA,
    authorityConfigChecksum:
      reviewBundle.executionPlan.authority.identityBootstrap.approval.configChecksum,
    unresolvedAuthorizationBindings: [],
    invariantViolations: [],
    source: structuredClone(reviewBundle.source),
    manifest: { sha256: reviewBundle.scopeManifestSha256 },
    executionPlanBundle: {
      bundleSha256: reviewBundle.bundleSha256,
      executionPlanSha256: reviewBundle.executionPlanSha256,
      scopeManifestSha256: reviewBundle.scopeManifestSha256,
      productionExecutionAuthorized: false,
      status: 'REVIEW_REQUIRED',
      nonBackupPreflightBlockerCount: 0,
    },
    readOnlyProof: {
      sourceDatabaseOpenedBySqlite: false,
      simulationDatabaseSource: 'EPHEMERAL_LOCAL_MIRROR',
      sqliteOpenMode: 'readonly',
      sqliteQueryOnly: true,
      sqliteForeignKeys: true,
      totalChangesBefore: 0,
      totalChangesAfter: 0,
      totalChangesDelta: 0,
      foreignKeyFailureCount: 0,
      sqliteFilesByteIdentical: true,
      ephemeralMirrorRemoved: true,
    },
    integrity: {
      quickCheck: 'ok',
      foreignKeyViolationCount: 0,
    },
    identity: {
      companyCount: EXPECTED_EXACT_CHANGES.companies,
      headOfficeCount: EXPECTED_EXACT_CHANGES.branches,
      roleTemplateCount: EXPECTED_EXACT_CHANGES.roleTemplates,
      roleTemplateCapabilityCount: EXPECTED_EXACT_CHANGES.roleTemplateCapabilities,
      membershipCount: EXPECTED_EXACT_CHANGES.memberships,
      branchGrantCount: EXPECTED_EXACT_CHANGES.branchGrants,
      directCapabilityAssignmentCount: EXPECTED_EXACT_CHANGES.capabilityAssignments,
      authorizationAuditEventCount: EXPECTED_EXACT_CHANGES.authorizationAuditEvents,
      identityBootstrapRunCount: EXPECTED_EXACT_CHANGES.bootstrapRuns,
      membershipPrincipalIds: [OWNER_PRINCIPAL_ID],
      mappedPrincipalIds: [OWNER_PRINCIPAL_ID],
      intentionallyUnmappedPrincipalIds: [...UNMAPPED_PRINCIPAL_IDS],
      unmappedMembershipCount: 0,
    },
    nonWriteSet: {
      appDataMutationCount: 0,
      businessDataMutationCount: 0,
      collectionWriteCount: 0,
      environmentMutationCount: 0,
      financialDataMutationCount: 0,
      migrationMutationCount: 0,
      recordMappingCount: 0,
      relationMappingCount: 0,
      schemaMutationCount: 0,
      smokeIdentityMutationCount: 0,
      tenantGuardMutationCount: 0,
      userRecordMutationCount: 0,
    },
  };
}

function approvalFixture(reviewBundle, simulationSha256 = HASH('7')) {
  return {
    approval: {
      approvalVersion: 1,
      status: 'APPROVED_FOR_GUARDED_EXECUTION',
      productionExecutionAuthorized: true,
      repository: 'rishatkznAI/rental-management',
      captureDeployedSha: reviewBundle.source.captureDeployedSha,
      captureDeploymentId: reviewBundle.source.captureDeploymentId,
      reviewBundleFileSha256: HASH('6'),
      reviewBundleSha256: reviewBundle.bundleSha256,
      reviewExecutionPlanSha256: reviewBundle.executionPlanSha256,
      scopeManifestSha256: reviewBundle.scopeManifestSha256,
      simulationOneSha256: simulationSha256,
      simulationTwoSha256: simulationSha256,
      independentAuditVerdict: 'PASS',
      approvedBy: 'independent-identity-reviewer',
      approvedAt: '2026-09-01T08:00:00.000Z',
      approvalReference: 'skytech-identity-execution-authorization-test',
      authorizedExecutionSha: EXECUTION_SHA,
      authorityConfigChecksum:
        reviewBundle.executionPlan.authority.identityBootstrap.approval.configChecksum,
    },
    approvalFileSha256: HASH('5'),
    reviewBundleFileSha256: HASH('6'),
  };
}

function authorizationInput(reviewBundle) {
  const simulationOne = identitySimulation(reviewBundle);
  const simulationTwo = structuredClone(simulationOne);
  const simulationSha256 = HASH('7');
  return {
    reviewBundle,
    ...approvalFixture(reviewBundle, simulationSha256),
    simulationOne,
    simulationOneSha256: simulationSha256,
    simulationTwo,
    simulationTwoSha256: simulationSha256,
  };
}

function rehashReviewBundle(bundle) {
  bundle.executionPlanSha256 = executionPlanSha256(bundle.executionPlan);
  bundle.bundleSha256 = executionBundleSha256(bundle);
  return bundle;
}

test('identity-only authorization accepts two identical pinned read-only proofs and seals exact bindings', () => {
  const reviewBundle = reviewBundleFixture();
  const authorized = authorizeProductionScopeExecutionBundle(authorizationInput(reviewBundle));

  assert.equal(authorized.productionExecutionAuthorized, true);
  assert.equal(authorized.executionPlan.productionExecutionAuthorized, true);
  assert.equal(authorized.authorization.authorizedExecutionSha, EXECUTION_SHA);
  assert.equal(
    authorized.authorization.authorityConfigChecksum,
    reviewBundle.executionPlan.authority.identityBootstrap.approval.configChecksum,
  );
  assert.equal(
    validateProductionScopeExecutionBundle(authorized, { requireAuthorized: true }).authorized,
    true,
  );
});

test('existing authorization CLI promotes exact identity files without changing its generic interface', () => {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), 'identity-authorization-'));
  try {
    const reviewBundle = reviewBundleFixture();
    const simulation = identitySimulation(reviewBundle);
    const writeJson = (name, value) => {
      const filePath = path.join(tempDirectory, name);
      const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
      writeFileSync(filePath, bytes, { mode: 0o600 });
      return { filePath, sha256: sha256(bytes) };
    };
    const review = writeJson('review.json', reviewBundle);
    const simulationOne = writeJson('simulation-one.json', simulation);
    const simulationTwo = writeJson('simulation-two.json', structuredClone(simulation));
    assert.equal(simulationOne.sha256, simulationTwo.sha256);

    const approvalValue = approvalFixture(reviewBundle, simulationOne.sha256).approval;
    approvalValue.reviewBundleFileSha256 = review.sha256;
    const approval = writeJson('approval.json', approvalValue);
    const outputBundle = path.join(tempDirectory, 'authorized.json');
    const outputSha256 = path.join(tempDirectory, 'authorized.sha256');
    const processResult = spawnSync(process.execPath, [
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
      '--output-sha256', outputSha256,
    ], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });

    assert.equal(processResult.status, 0, processResult.stderr);
    const authorized = JSON.parse(readFileSync(outputBundle, 'utf8'));
    assert.equal(authorized.authorization.authorizedExecutionSha, EXECUTION_SHA);
    assert.equal(
      validateProductionScopeExecutionBundle(authorized, { requireAuthorized: true }).authorized,
      true,
    );
    assert.equal(readFileSync(outputSha256, 'utf8').trim(), sha256(readFileSync(outputBundle)));
    assert.equal(statSync(outputBundle).mode & 0o777, 0o600);
    assert.equal(statSync(outputSha256).mode & 0o777, 0o600);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('identity-only authorization rejects divergent or differently pinned simulations', () => {
  const reviewBundle = reviewBundleFixture();
  const divergent = authorizationInput(reviewBundle);
  divergent.simulationTwo.identity.membershipCount = 2;
  assert.throws(
    () => authorizeProductionScopeExecutionBundle(divergent),
    error => error.code === 'IDENTITY_EXECUTION_AUTHORIZATION_SIMULATION_FAILED',
  );

  const differentlyPinned = authorizationInput(reviewBundle);
  differentlyPinned.simulationTwoSha256 = HASH('0');
  differentlyPinned.approval.simulationTwoSha256 = HASH('0');
  assert.throws(
    () => authorizeProductionScopeExecutionBundle(differentlyPinned),
    error => error.code === 'IDENTITY_EXECUTION_APPROVAL_BINDING_MISMATCH',
  );
});

test('identity-only authorization fails closed on writes and every exact binding drift', () => {
  const cases = [
    ['write count', input => { input.simulationOne.writesPerformed = 1; }, 'IDENTITY_EXECUTION_AUTHORIZATION_SIMULATION_FAILED'],
    ['non-write set', input => { input.simulationOne.nonWriteSet.appDataMutationCount = 1; }, 'IDENTITY_EXECUTION_AUTHORIZATION_SIMULATION_FAILED'],
    ['source', input => { input.simulationOne.source.sourceSnapshotHash = HASH('0'); }, 'IDENTITY_EXECUTION_AUTHORIZATION_SIMULATION_FAILED'],
    ['plan', input => { input.simulationOne.executionPlanBundle.executionPlanSha256 = HASH('0'); }, 'IDENTITY_EXECUTION_AUTHORIZATION_SIMULATION_FAILED'],
    ['authority', input => { input.simulationOne.authorityConfigChecksum = HASH('0'); }, 'IDENTITY_EXECUTION_AUTHORIZATION_SIMULATION_FAILED'],
    ['execution SHA', input => {
      input.simulationOne.authorizedExecutionSha = '0'.repeat(40);
      input.simulationTwo.authorizedExecutionSha = '0'.repeat(40);
    }, 'IDENTITY_EXECUTION_APPROVAL_BINDING_MISMATCH'],
    ['unresolved binding', input => {
      input.simulationOne.authorizationBindingsComplete = false;
      input.simulationOne.unresolvedAuthorizationBindings = ['authorizedExecutionSha'];
    }, 'IDENTITY_EXECUTION_AUTHORIZATION_SIMULATION_FAILED'],
  ];
  for (const [label, mutate, expectedCode] of cases) {
    const input = authorizationInput(reviewBundleFixture());
    mutate(input);
    assert.throws(
      () => authorizeProductionScopeExecutionBundle(input),
      error => error.code === expectedCode,
      label,
    );
  }
});

test('identity-only authorization rejects an altered membership disposition even after rehashing', () => {
  const reviewBundle = reviewBundleFixture();
  reviewBundle.executionPlan.actorMappings[1] = {
    userId: UNMAPPED_PRINCIPAL_IDS[0],
    action: 'CREATE_MEMBERSHIP',
    membershipId: 'unapproved-membership',
    companyId: COMPANY_ID,
    tenantId: COMPANY_ID,
  };
  rehashReviewBundle(reviewBundle);

  assert.throws(
    () => authorizeProductionScopeExecutionBundle(authorizationInput(reviewBundle)),
    error => error.code.startsWith('IDENTITY_ONLY_')
      || error.code === 'IDENTITY_EXECUTION_AUTHORITY_INVALID',
  );
});

test('sealed preparation artifact with 18 null runtime bindings cannot become an executable review bundle', () => {
  const preparation = JSON.parse(readFileSync(new URL(
    '../server/config/skytech-identity-bootstrap-review-bundle.generated.json',
    import.meta.url,
  ), 'utf8'));
  const before = stableJson(preparation);
  const nullBindings = Object.entries(preparation.runtimeBindings)
    .filter(([, binding]) => binding.value === null)
    .map(([name]) => name)
    .sort();

  assert.deepEqual(nullBindings, UNRESOLVED_PREPARATION_BINDINGS);
  assert.equal(preparation.productionExecutionAuthorized, false);
  assert.equal(preparation.bindingCompleteness.complete, false);
  assert.throws(() => validateProductionScopeExecutionBundle(preparation));
  assert.throws(() => authorizeProductionScopeExecutionBundle({
    ...authorizationInput(reviewBundleFixture()),
    reviewBundle: preparation,
  }));
  assert.equal(stableJson(preparation), before);
  assert.equal(preparation.productionExecutionAuthorized, false);
});
