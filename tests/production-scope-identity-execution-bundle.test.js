import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildProductionScopeExecutionBundle,
  executionBundleSha256,
  executionPlanSha256,
  isAuthorizedIdentityExecutionPlan,
  validateProductionScopeExecutionBundle,
} = require('../server/lib/production-scope-execution-plan-bundle.js');
const {
  AUTHORITY,
  COMPANY_ID,
  EXPECTED_ROW_COUNT_DELTAS,
  OWNER_MEMBERSHIP_ID,
  OWNER_PRINCIPAL_ID,
  buildCanonicalIdentityBootstrapConfig,
} = require('../server/lib/identity-bootstrap-execution-bundle.js');
const {
  stableJson,
} = require('../server/lib/production-scope-remediation.js');
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

const HASH = character => character.repeat(64);
const UNMAPPED_IDS = [
  '1776673416137',
  '1787547467703',
  'DEMO-USER-CARRIER',
  'production-smoke-admin',
];
const CURRENT_SOURCE_BINDINGS_FINGERPRINT = currentRepositorySourceBindingsFingerprint();
const CURRENT_AUTHORITY_COMMITMENTS = Object.freeze({
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

function fixture() {
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
    ...CURRENT_AUTHORITY_COMMITMENTS,
    packFingerprint: HASH('2'),
    sourceBindingsFingerprint: CURRENT_SOURCE_BINDINGS_FINGERPRINT,
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
    canonicalScope: {
      companyId: COMPANY_ID,
      tenantId: COMPANY_ID,
    },
    registry: {
      entryCount: 0,
      globalReferenceCollectionCount: 0,
    },
    evidence: {
      artifactIndexSha256: evidence.artifactIndexSha256,
      ...CURRENT_AUTHORITY_COMMITMENTS,
      packFingerprint: evidence.packFingerprint,
      approvedReconciliationFingerprint: evidence.approvedReconciliationFingerprint,
      sourceBindingsFingerprint: evidence.sourceBindingsFingerprint,
      platformDefaultTenantOverlaySemantics: structuredClone(
        evidence.platformDefaultTenantOverlaySemantics,
      ),
    },
    identity: {
      reviewedPlanFileSha256: evidence.reviewedPlanFileSha256,
    },
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
    sourceBindingsFingerprint: CURRENT_SOURCE_BINDINGS_FINGERPRINT,
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
      collectionFingerprints: { users: [HASH('9')] },
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
      ...UNMAPPED_IDS.map(userId => ({
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
  return { plan, manifest };
}

function rehash(bundle) {
  bundle.executionPlanSha256 = executionPlanSha256(bundle.executionPlan);
  bundle.bundleSha256 = executionBundleSha256(bundle);
  return bundle;
}

test('identity-only review bundle seals the exact single membership and carries zero non-identity writes', () => {
  const { plan, manifest } = fixture();
  const bundle = buildProductionScopeExecutionBundle({ plan, manifest });
  const validated = validateProductionScopeExecutionBundle(bundle);

  assert.equal(validated.authorized, false);
  assert.equal(validated.plan.executionScope, 'IDENTITY_ONLY');
  assert.equal(bundle.sourceBindingsFingerprint, CURRENT_SOURCE_BINDINGS_FINGERPRINT);
  assert.equal(bundle.evidence.sourceBindingsFingerprint, CURRENT_SOURCE_BINDINGS_FINGERPRINT);
  assert.equal(bundle.executionPlan.sourceBindingsFingerprint, CURRENT_SOURCE_BINDINGS_FINGERPRINT);
  assert.deepEqual(
    bundle.platformDefaultTenantOverlaySemantics,
    PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
  );
  assert.deepEqual(
    bundle.evidence.platformDefaultTenantOverlaySemantics,
    PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
  );
  assert.deepEqual(
    bundle.executionPlan.platformDefaultTenantOverlaySemantics,
    PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
  );
  for (const [field, value] of Object.entries(CURRENT_AUTHORITY_COMMITMENTS)) {
    assert.equal(bundle.evidence[field], value, field);
    assert.equal(bundle.executionPlan.exactSourceBinding.evidence[field], value, field);
  }
  assert.deepEqual(bundle.recordBindings, []);
  assert.deepEqual(bundle.executionPlan.recordMappings, []);
  assert.deepEqual(bundle.executionPlan.relationMappings, []);
  assert.equal(Object.hasOwn(bundle.executionPlan, 'smokeIdentityTransition'), false);
  assert.deepEqual(bundle.summary, {
    registryEntryCount: 0,
    registryWriteCount: 0,
    classifiedRecordCount: 0,
    executionRecordMappingCount: 0,
    semanticScopeWriteCount: 0,
    operationCounts: {},
    collectionWriteCounts: {},
    globalReferenceCollectionCount: 0,
  });
  assert.deepEqual(
    bundle.executionPlan.authority.identityBootstrap.memberships,
    AUTHORITY.memberships,
  );
  assert.deepEqual(
    bundle.executionPlan.actorMappings.map(row => [row.userId, row.action]),
    [
      [OWNER_PRINCIPAL_ID, 'CREATE_MEMBERSHIP'],
      ...UNMAPPED_IDS.map(id => [id, 'NO_MEMBERSHIP']),
    ],
  );
  assert.throws(
    () => validateProductionScopeExecutionBundle(bundle, { requireAuthorized: true }),
    error => error.code === 'PRODUCTION_EXECUTION_NOT_AUTHORIZED',
  );
});

test('identity-only bundle rejects data mappings and every nonzero non-identity write summary', () => {
  const { plan, manifest } = fixture();
  const exact = buildProductionScopeExecutionBundle({ plan, manifest });
  const cases = [
    ['record binding', bundle => bundle.recordBindings.push({ collection: 'clients' })],
    ['record mapping', bundle => bundle.executionPlan.recordMappings.push({ collection: 'clients' })],
    ['relation mapping', bundle => bundle.executionPlan.relationMappings.push({ collection: 'payments' })],
    ['registry write', bundle => { bundle.summary.registryWriteCount = 1; }],
    ['semantic write', bundle => { bundle.summary.semanticScopeWriteCount = 1; }],
    ['collection write', bundle => { bundle.summary.collectionWriteCounts = { clients: 1 }; }],
  ];
  for (const [label, mutate] of cases) {
    const tampered = structuredClone(exact);
    mutate(tampered);
    rehash(tampered);
    assert.throws(
      () => validateProductionScopeExecutionBundle(tampered),
      error => [
        'IDENTITY_ONLY_DATA_MAPPING_FORBIDDEN',
        'IDENTITY_ONLY_WRITE_SUMMARY_INVALID',
      ].includes(error.code),
      label,
    );
  }
});

test('identity-only bundle rejects smoke, extra memberships, actor drift, and unrelated mutation fields', () => {
  const { plan, manifest } = fixture();
  const exact = buildProductionScopeExecutionBundle({ plan, manifest });
  const cases = [
    ['smoke transition', bundle => { bundle.executionPlan.smokeIdentityTransition = {}; }],
    ['extra membership', bundle => {
      bundle.executionPlan.authority.identityBootstrap.memberships.push({
        ...AUTHORITY.memberships[0],
        id: 'unapproved-membership',
        principalId: UNMAPPED_IDS[0],
      });
    }],
    ['actor drift', bundle => {
      bundle.executionPlan.actorMappings[1] = {
        userId: UNMAPPED_IDS[0],
        action: 'CREATE_MEMBERSHIP',
        membershipId: 'unapproved-membership',
        companyId: COMPANY_ID,
        tenantId: COMPANY_ID,
      };
    }],
    ['business mutation', bundle => { bundle.executionPlan.businessMutations = []; }],
    ['financial mutation', bundle => { bundle.executionPlan.financialMutations = []; }],
    ['schema mutation', bundle => { bundle.executionPlan.schemaMutations = []; }],
    ['environment mutation', bundle => { bundle.executionPlan.environmentMutations = []; }],
    ['extra Railway source binding', bundle => {
      bundle.source.railwayIdentity.unreviewed = 'forbidden';
      bundle.executionPlan.exactSourceBinding.source.railwayIdentity.unreviewed = 'forbidden';
    }],
    ['extra deployment source binding', bundle => {
      bundle.source.deploymentIdentity.unreviewed = 'forbidden';
      bundle.executionPlan.exactSourceBinding.source.deploymentIdentity.unreviewed = 'forbidden';
    }],
  ];
  for (const [label, mutate] of cases) {
    const tampered = structuredClone(exact);
    mutate(tampered);
    rehash(tampered);
    assert.throws(
      () => validateProductionScopeExecutionBundle(tampered),
      error => error.code.startsWith('IDENTITY_ONLY_'),
      label,
    );
  }
});

test('identity-only builder rejects hash-valid manifest writes and unapproved nested fields', () => {
  const cases = [
    ['record write', manifest => {
      manifest.records.push({ collection: 'clients', operation: 'UPDATE_SCOPE' });
      manifest.summary.classifiedRecordCount = 1;
      manifest.summary.semanticScopeWriteCount = 1;
      manifest.summary.operationCounts = { UPDATE_SCOPE: 1 };
      manifest.summary.collectionWriteCounts = { clients: 1 };
    }, 'IDENTITY_ONLY_MANIFEST_WRITE_SCOPE_INVALID'],
    ['source field', manifest => { manifest.source.unreviewed = 'forbidden'; }],
    ['Railway source field', manifest => {
      manifest.source.railwayIdentity.unreviewed = 'forbidden';
    }],
    ['deployment source field', manifest => {
      manifest.source.deploymentIdentity.unreviewed = 'forbidden';
    }],
    ['registry field', manifest => { manifest.registry.unreviewed = 0; }],
    ['evidence field', manifest => { manifest.evidence.unreviewed = 'forbidden'; }],
    ['summary field', manifest => { manifest.summary.businessMutations = []; }],
  ];
  for (const [label, mutate, expectedCode = 'IDENTITY_ONLY_MANIFEST_MUTATION_FIELD_FORBIDDEN'] of cases) {
    const { plan, manifest } = fixture();
    mutate(manifest);
    manifest.manifestSha256 = manifestHash(manifest);
    assert.throws(
      () => buildProductionScopeExecutionBundle({ plan, manifest }),
      error => error.code === expectedCode,
      label,
    );
  }
});

test('identity-only validation retains every current-main source, authority, and overlay guard', () => {
  const { plan, manifest } = fixture();
  const exact = buildProductionScopeExecutionBundle({ plan, manifest });
  const cases = [
    ['bundle source binding', bundle => { bundle.sourceBindingsFingerprint = HASH('0'); }, 'EXECUTION_SOURCE_BINDINGS_OBSOLETE'],
    ['plan source binding', bundle => { bundle.executionPlan.sourceBindingsFingerprint = HASH('0'); }, 'EXECUTION_SOURCE_BINDINGS_OBSOLETE'],
    ['baseline authority', bundle => { bundle.evidence.baselineContractSha256 = HASH('0'); }, 'EXECUTION_AUTHORITY_CONTRACT_OBSOLETE'],
    ['classification authority', bundle => { bundle.evidence.classificationAuthorityFingerprint = HASH('0'); }, 'EXECUTION_AUTHORITY_CONTRACT_OBSOLETE'],
    ['overlay contract', bundle => {
      bundle.platformDefaultTenantOverlaySemantics = {
        ...bundle.platformDefaultTenantOverlaySemantics,
        contractVersion: 999,
      };
    }, 'EXECUTION_OVERLAY_SEMANTICS_CONTRACT_OBSOLETE'],
  ];
  for (const [label, mutate, expectedCode] of cases) {
    const tampered = structuredClone(exact);
    mutate(tampered);
    rehash(tampered);
    assert.throws(
      () => validateProductionScopeExecutionBundle(tampered),
      error => error.code === expectedCode,
      label,
    );
  }
});

test('identity-only authorization requires an exact execution SHA and authority checksum', () => {
  const { plan, manifest } = fixture();
  const review = buildProductionScopeExecutionBundle({ plan, manifest });
  const authorized = structuredClone(review);
  authorized.status = 'APPROVED_FOR_GUARDED_EXECUTION';
  authorized.productionExecutionAuthorized = true;
  authorized.executionPlan.productionExecutionAuthorized = true;
  authorized.authorization = {
    authorizationVersion: 1,
    approvalFileSha256: HASH('5'),
    approvalReference: 'identity-only-authorization-test',
    approvedAt: '2026-09-01T01:00:00.000Z',
    approvedBy: OWNER_PRINCIPAL_ID,
    authorityConfigChecksum:
      review.executionPlan.authority.identityBootstrap.approval.configChecksum,
    authorizedExecutionSha: review.source.captureDeployedSha,
    captureDeployedSha: review.source.captureDeployedSha,
    independentAuditVerdict: 'PASS',
    reviewBundleFileSha256: HASH('6'),
    reviewBundleSha256: review.bundleSha256,
    reviewExecutionPlanSha256: review.executionPlanSha256,
    scopeManifestSha256: review.scopeManifestSha256,
    simulationOneSha256: HASH('7'),
    simulationTwoSha256: HASH('8'),
  };
  rehash(authorized);
  const nonExecutingValidation = validateProductionScopeExecutionBundle(authorized);
  assert.equal(isAuthorizedIdentityExecutionPlan(nonExecutingValidation.plan), false);
  const executingValidation = validateProductionScopeExecutionBundle(
    authorized,
    { requireAuthorized: true },
  );
  assert.equal(executingValidation.authorized, true);
  assert.equal(isAuthorizedIdentityExecutionPlan(executingValidation.plan), true);
  assert.equal(isAuthorizedIdentityExecutionPlan(structuredClone(executingValidation.plan)), false);

  for (const field of ['authorizedExecutionSha', 'authorityConfigChecksum']) {
    const missing = structuredClone(authorized);
    delete missing.authorization[field];
    rehash(missing);
    assert.throws(
      () => validateProductionScopeExecutionBundle(missing, { requireAuthorized: true }),
      error => error.code === 'IDENTITY_ONLY_EXECUTION_AUTHORIZATION_BINDING_INVALID',
      field,
    );
  }
});
