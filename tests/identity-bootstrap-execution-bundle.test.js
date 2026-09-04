import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createPlatformIdentityContext } from './platform-identity-fixtures.js';

const require = createRequire(import.meta.url);
const bundleApi = require('../server/lib/identity-bootstrap-execution-bundle.js');
const {
  APPROVAL_REFERENCE,
  AUTHORITY,
  CAPABILITY_CATALOG_V1_CHECKSUM,
  COMPANY_ID,
  DETERMINISTIC_IDENTITY_POSTCONDITIONS,
  EXPECTED_AUTHORITY_SNAPSHOT_FINGERPRINT,
  EXPECTED_EXACT_CHANGES,
  EXPECTED_ROW_COUNT_DELTAS,
  HEAD_OFFICE_ID,
  NON_WRITE_SET,
  OWNER_MEMBERSHIP_ID,
  OWNER_PRINCIPAL_ID,
  REVIEW_STATUS,
  ROLE_TEMPLATE_ID,
  WRITE_MANIFEST,
  buildCanonicalIdentityBootstrapConfig,
  buildIdentityBootstrapExecutionBundle,
  canonicalAuthorityPayload,
  identityBootstrapExecutionBundleSha256,
  projectIdentityBootstrapReview,
  validateIdentityBootstrapExecutionBundle,
} = bundleApi;
const {
  calculateBootstrapChecksum,
  getSchemaFingerprint,
  planPlatformIdentityBootstrap,
} = require('../server/lib/platform-identity-bootstrap.js');
const {
  buildExpectedAuthoritySnapshot,
  calculateAuthorityFingerprint,
} = require('../server/lib/platform-identity-bootstrap-validation.js');
const {
  CAPABILITY_CATALOG_V1_CHECKSUM: PLATFORM_CAPABILITY_CATALOG_V1_CHECKSUM,
} = require('../server/lib/platform-identity-schema.js');

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SOURCE_BINDINGS = Object.freeze({
  captureDeployedSha: '1'.repeat(40),
  captureDeploymentId: '11111111-1111-4111-8111-111111111111',
  sourceSnapshotSha256: '2'.repeat(64),
  stateFingerprint: '6'.repeat(64),
  appDataFingerprint: '7'.repeat(64),
  userInventoryFingerprint: '8'.repeat(64),
  databaseContentFingerprint: '3'.repeat(64),
  durableFileSetFingerprint: '4'.repeat(64),
  observedFileSetFingerprint: '5'.repeat(64),
});

test('accepted review artifacts remain byte-sealed and valid under the current validator', () => {
  const acceptedBundle = JSON.parse(readFileSync(new URL(
    '../server/config/skytech-identity-bootstrap-review-bundle.generated.json',
    import.meta.url,
  ), 'utf8'));
  const acceptedSimulation = JSON.parse(readFileSync(new URL(
    '../docs/skytech-identity-bootstrap-read-only-simulation-2026-09-01.json',
    import.meta.url,
  ), 'utf8'));
  for (const artifactBundle of [acceptedBundle, acceptedSimulation.bundle]) {
    const result = validateIdentityBootstrapExecutionBundle(artifactBundle);
    assert.equal(result.valid, true);
    assert.equal(result.reviewOnly, true);
    assert.equal(result.productionExecutionAuthorized, false);
  }
});

function exactUsers() {
  return [
    {
      id: OWNER_PRINCIPAL_ID,
      name: 'Хабибрахманов Ришат Ринатович',
      status: 'Активен',
      role: 'Администратор',
    },
    {
      id: '1776673416137',
      name: 'Мениса',
      email: 'kmzh@mantall.ru',
      status: 'Активен',
      role: 'Офис-менеджер',
    },
    {
      id: '1787547467703',
      name: 'Айзат',
      email: 'mp2@mantall.ru',
      status: 'Активен',
      role: 'Менеджер по аренде',
    },
    {
      id: 'DEMO-USER-CARRIER',
      name: 'Demo Carrier User',
      status: 'Активен',
      role: 'Перевозчик',
    },
    {
      id: 'production-smoke-admin',
      name: 'Production Smoke Admin',
      status: 'Активен',
      role: 'Администратор',
    },
  ];
}

function exactPlanFixture() {
  const context = createPlatformIdentityContext({ users: exactUsers() });
  const approvalInput = {
    approvedAt: '2026-09-01T00:00:00.000Z',
    schemaFingerprint: getSchemaFingerprint(context.db),
  };
  const checksumInput = buildCanonicalIdentityBootstrapConfig(approvalInput);
  const configChecksum = calculateBootstrapChecksum(context.db, checksumInput);
  const config = buildCanonicalIdentityBootstrapConfig({
    ...approvalInput,
    configChecksum,
  });
  const plan = planPlatformIdentityBootstrap(context.db, config);
  assert.equal(plan.ok, true, JSON.stringify(plan.blockers));
  return { context, plan, config };
}

function mutableBundle(bundle) {
  return structuredClone(bundle);
}

function resealBundleHash(bundle) {
  bundle.hashes.bundleSha256 = identityBootstrapExecutionBundleSha256(bundle);
  return bundle;
}

test('canonical payload builder and review seal are deterministic and write-free', () => {
  const fixture = exactPlanFixture();
  try {
    assert.deepEqual(canonicalAuthorityPayload(), AUTHORITY);
    assert.equal(fixture.config.approval.approvalReference, APPROVAL_REFERENCE);
    assert.equal(fixture.config.approval.approvedBy, OWNER_PRINCIPAL_ID);
    assert.equal(fixture.config.approval.backupReference, 'UNRESOLVED_FRESH_PRODUCTION_BACKUP');

    const changesBefore = fixture.context.db.prepare('SELECT total_changes() AS count').get().count;
    const first = buildIdentityBootstrapExecutionBundle({ identityPlan: fixture.plan });
    const second = buildIdentityBootstrapExecutionBundle({ identityPlan: fixture.plan });
    const changesAfter = fixture.context.db.prepare('SELECT total_changes() AS count').get().count;

    assert.deepEqual(second, first);
    assert.equal(changesAfter, changesBefore);
    assert.equal(first.status, REVIEW_STATUS);
    assert.equal(first.productionExecutionAuthorized, false);
    assert.equal(first.executionCapability, 'NONE');
    assert.equal(first.writesPerformed, 0);
    assert.equal(first.approvalReference, APPROVAL_REFERENCE);
    assert.match(first.authorityDecisionSha256, SHA256_PATTERN);
    assert.match(first.preparedPlanSha256, SHA256_PATTERN);
    assert.match(first.hashes.bundleSha256, SHA256_PATTERN);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(validateIdentityBootstrapExecutionBundle(first).valid, true);
    assert.equal(Object.keys(bundleApi).some(key => /^apply/i.test(key)), false);
  } finally {
    fixture.context.close();
  }
});

test('read-only projection consumes either a bootstrap plan or a hash-bound source snapshot', () => {
  const fixture = exactPlanFixture();
  try {
    const fromPlan = projectIdentityBootstrapReview({ identityPlan: fixture.plan });
    const fromSnapshot = projectIdentityBootstrapReview({
      sourceSnapshot: {
        identityPlan: fixture.plan,
        sourceBindings: SOURCE_BINDINGS,
      },
    });

    assert.equal(fromPlan.sourceKind, 'planPlatformIdentityBootstrap');
    assert.equal(fromSnapshot.sourceKind, 'sourceSnapshot');
    assert.equal(fromPlan.evidenceClassification, 'HISTORICAL_SIMULATION_ONLY');
    assert.equal(fromSnapshot.evidenceClassification, 'HISTORICAL_SIMULATION_ONLY');
    assert.equal(fromPlan.reportedWrites, 0);
    assert.equal(fromSnapshot.reportedWrites, 0);
    assert.equal(fromSnapshot.approvalReference, APPROVAL_REFERENCE);
    assert.equal(fromSnapshot.historicalApprovedAt, '2026-09-01T00:00:00.000Z');
    assert.equal(
      fromSnapshot.historicalBackupReference,
      'UNRESOLVED_FRESH_PRODUCTION_BACKUP',
    );
    assert.deepEqual(fromSnapshot.sourceBindings, SOURCE_BINDINGS);
    assert.equal(fromSnapshot.authorityConfigChecksum, fixture.plan.configChecksum);
    assert.deepEqual(fromSnapshot.exactChanges, EXPECTED_EXACT_CHANGES);
    assert.deepEqual(fromSnapshot.afterIdentityCounts, EXPECTED_ROW_COUNT_DELTAS);

    const sealed = buildIdentityBootstrapExecutionBundle({
      sourceSnapshot: {
        identityPlan: fixture.plan,
        sourceBindings: SOURCE_BINDINGS,
      },
    });
    assert.equal(validateIdentityBootstrapExecutionBundle(sealed).valid, true);
    assert.equal(sealed.historicalSimulationEvidence.classification, 'HISTORICAL_SIMULATION_ONLY');
    assert.equal(sealed.historicalSimulationEvidence.approvedAt, '2026-09-01T00:00:00.000Z');
    assert.equal(
      sealed.historicalSimulationEvidence.backupReference,
      'UNRESOLVED_FRESH_PRODUCTION_BACKUP',
    );
    assert.equal(sealed.historicalSimulationEvidence.captureDeployedSha, SOURCE_BINDINGS.captureDeployedSha);
    assert.equal(sealed.historicalSimulationEvidence.databaseContentFingerprint, SOURCE_BINDINGS.databaseContentFingerprint);
    assert.equal(sealed.runtimeBindings.captureDeployedSha.value, null);
    assert.equal(sealed.runtimeBindings.databaseContentFingerprint.value, null);
  } finally {
    fixture.context.close();
  }
});

test('seal exposes the exact 12-row, 13-total_changes identity-only manifest', () => {
  const fixture = exactPlanFixture();
  try {
    const bundle = buildIdentityBootstrapExecutionBundle({ identityPlan: fixture.plan });
    assert.deepEqual(bundle.expectedRowCountDeltas, {
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
    assert.equal(bundle.writeManifest.uniqueAffectedRowCount, 12);
    assert.equal(bundle.writeManifest.expectedSqliteTotalChanges, 13);
    assert.equal(bundle.writeManifest.operations.length, 13);
    assert.equal(bundle.writeManifest.collectionWriteCount, 0);
    assert.equal(bundle.writeManifest.businessDataMutationCount, 0);
    assert.deepEqual(
      bundle.auditEventManifest.map(event => event.action),
      [
        'company.authority.created',
        'branch.created',
        'role_template.created',
        'membership.created',
      ],
    );
    assert.deepEqual(
      bundle.auditEventManifest.map(event => event.targetId),
      [COMPANY_ID, HEAD_OFFICE_ID, ROLE_TEMPLATE_ID, OWNER_MEMBERSHIP_ID],
    );
    assert.equal(
      bundle.writeManifest.operations.filter(row => row.table === 'role_template_capabilities').length,
      3,
    );
    assert.equal(
      bundle.writeManifest.operations.some(row => row.table === 'membership_branch_access'),
      false,
    );
    assert.equal(
      bundle.writeManifest.operations.some(row => row.table === 'membership_capability_assignments'),
      false,
    );
    const unmapped = bundle.principalDispositions.filter(row => (
      row.disposition === 'INTENTIONALLY_UNMAPPED'
    ));
    assert.equal(unmapped.length, 4);
    assert.equal(unmapped.every(row => row.membershipAcrossAllCompanies === 'NONE'), true);
    assert.deepEqual(bundle.nonWriteSet, NON_WRITE_SET);
    assert.equal(bundle.nonWriteSet.appData.allRows, 'BYTE_IDENTICAL');
    assert.equal(bundle.nonWriteSet.schema.ddlStatementCount, 0);
    assert.equal(bundle.nonWriteSet.migrations.mutationCount, 0);
    assert.equal(bundle.nonWriteSet.tenantGuards.mutationCount, 0);
    assert.equal(bundle.nonWriteSet.environment.deploymentOperations, 0);
    assert.equal(bundle.nonWriteSet.smokeIdentity.transition, 'FORBIDDEN');
    assert.deepEqual(bundle.deterministicIdentityPostconditions, {
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
        status: 'UNRESOLVED_EXECUTION_TIME_BINDING',
        value: null,
        binding: 'future receipt-bound read-only simulation of a fresh production backup copy',
      },
    });
    assert.deepEqual(
      bundle.deterministicIdentityPostconditions,
      DETERMINISTIC_IDENTITY_POSTCONDITIONS,
    );
    assert.equal(
      calculateAuthorityFingerprint(buildExpectedAuthoritySnapshot(fixture.plan.normalized, 1)),
      EXPECTED_AUTHORITY_SNAPSHOT_FINGERPRINT,
    );
    assert.equal(CAPABILITY_CATALOG_V1_CHECKSUM, PLATFORM_CAPABILITY_CATALOG_V1_CHECKSUM);
  } finally {
    fixture.context.close();
  }
});

test('projection and validator reject extra authority or any forbidden mutation family', async t => {
  const fixture = exactPlanFixture();
  try {
    await t.test('extra membership in source projection', () => {
      const drifted = structuredClone(fixture.plan);
      drifted.normalized.memberships.push({
        ...drifted.normalized.memberships[0],
        id: 'unapproved-membership',
        principalId: '1776673416137',
      });
      assert.throws(
        () => buildIdentityBootstrapExecutionBundle({ identityPlan: drifted }),
        error => error.code === 'IDENTITY_AUTHORITY_DRIFT',
      );
    });

    await t.test('branch grant or direct capability assignment', () => {
      for (const mutate of [
        plan => { plan.normalized.memberships[0].branchIds = [HEAD_OFFICE_ID]; },
        plan => {
          plan.normalized.memberships[0].capabilityAssignments = [{
            capabilityKey: 'receivables.read',
            effect: 'grant',
          }];
        },
      ]) {
        const drifted = structuredClone(fixture.plan);
        mutate(drifted);
        assert.throws(
          () => buildIdentityBootstrapExecutionBundle({ identityPlan: drifted }),
          error => error.code === 'IDENTITY_AUTHORITY_DRIFT',
        );
      }
    });

    await t.test('approval-reference drift', () => {
      const drifted = structuredClone(fixture.plan);
      drifted.normalized.approval.approvalReference = 'UNAPPROVED_REFERENCE';
      assert.throws(
        () => buildIdentityBootstrapExecutionBundle({ identityPlan: drifted }),
        error => error.code === 'IDENTITY_APPROVAL_REFERENCE_DRIFT',
      );
    });

    const sealed = buildIdentityBootstrapExecutionBundle({ identityPlan: fixture.plan });
    for (const field of [
      'businessMutations',
      'schemaMutations',
      'migrationMutations',
      'environmentMutations',
      'smokeIdentityTransition',
    ]) {
      await t.test(`forbidden top-level ${field}`, () => {
        const drifted = mutableBundle(sealed);
        drifted[field] = [];
        resealBundleHash(drifted);
        assert.throws(
          () => validateIdentityBootstrapExecutionBundle(drifted),
          error => error.code === 'IDENTITY_BUNDLE_FIELDS_INVALID',
        );
      });
    }

    await t.test('extra SQL write', () => {
      const drifted = mutableBundle(sealed);
      drifted.writeManifest.operations.push({
        sequence: 14,
        table: 'app_data',
        operation: 'UPDATE',
        rowIdentity: 'users',
      });
      resealBundleHash(drifted);
      assert.throws(
        () => validateIdentityBootstrapExecutionBundle(drifted),
        error => error.code === 'IDENTITY_BUNDLE_WRITE_MANIFEST_DRIFT',
      );
    });
  } finally {
    fixture.context.close();
  }
});

test('binding completeness is necessarily false and review artifact cannot be authorized', () => {
  const fixture = exactPlanFixture();
  try {
    const bundle = buildIdentityBootstrapExecutionBundle({
      sourceSnapshot: {
        identityPlan: fixture.plan,
        sourceBindings: SOURCE_BINDINGS,
      },
    });
    assert.equal(bundle.bindingCompleteness.complete, false);
    assert.equal(bundle.bindingCompleteness.authorizationReady, false);
    assert.equal(bundle.bindingCompleteness.unresolvedKeys.length, 18);
    for (const key of [
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
    ]) {
      assert.equal(bundle.runtimeBindings[key].status, 'UNRESOLVED_EXECUTION_TIME_BINDING');
      assert.equal(bundle.runtimeBindings[key].value, null);
      assert.equal(bundle.bindingCompleteness.unresolvedKeys.includes(key), true);
    }
    assert.equal(
      bundle.runtimeBindings.backupReference.binding,
      'freshBackupReceipt.reference',
    );
    assert.equal(
      bundle.historicalSimulationEvidence.approvedAt,
      '2026-09-01T00:00:00.000Z',
    );
    assert.equal(bundle.runtimeBindings.approvedAt.value, null);
    assert.equal(bundle.runtimeBindings.preparedPlanSha256.value, bundle.preparedPlanSha256);
    assert.notEqual(
      bundle.runtimeBindings.executionPlanChecksum.value,
      bundle.preparedPlanSha256,
    );

    const forged = mutableBundle(bundle);
    forged.productionExecutionAuthorized = true;
    forged.status = 'APPROVED_FOR_EXECUTION';
    forged.executionCapability = 'APPLY';
    resealBundleHash(forged);
    assert.throws(
      () => validateIdentityBootstrapExecutionBundle(forged),
      error => error.code === 'IDENTITY_BUNDLE_AUTHORIZATION_FORBIDDEN',
    );
  } finally {
    fixture.context.close();
  }
});

test('section and whole-bundle hashes fail closed on tampering', () => {
  const fixture = exactPlanFixture();
  try {
    const bundle = buildIdentityBootstrapExecutionBundle({ identityPlan: fixture.plan });
    const sectionTamper = mutableBundle(bundle);
    sectionTamper.hashes.authoritySha256 = '0'.repeat(64);
    assert.throws(
      () => validateIdentityBootstrapExecutionBundle(sectionTamper),
      error => error.code === 'IDENTITY_BUNDLE_SECTION_HASH_MISMATCH',
    );

    const bundleHashTamper = mutableBundle(bundle);
    bundleHashTamper.hashes.bundleSha256 = 'f'.repeat(64);
    assert.throws(
      () => validateIdentityBootstrapExecutionBundle(bundleHashTamper),
      error => error.code === 'IDENTITY_BUNDLE_HASH_MISMATCH',
    );

    const sourceTamper = mutableBundle(bundle);
    sourceTamper.sourceProjection.authorityConfigChecksum = 'a'.repeat(64);
    resealBundleHash(sourceTamper);
    assert.throws(
      () => validateIdentityBootstrapExecutionBundle(sourceTamper),
      error => [
        'IDENTITY_BUNDLE_HISTORICAL_EVIDENCE_DRIFT',
        'IDENTITY_BUNDLE_PREPARED_PLAN_HASH_MISMATCH',
        'IDENTITY_BUNDLE_RUNTIME_BINDING_DRIFT',
      ].includes(error.code),
    );

    const postconditionTamper = mutableBundle(bundle);
    postconditionTamper.deterministicIdentityPostconditions.authoritySnapshot.fingerprint = (
      'b'.repeat(64)
    );
    postconditionTamper.hashes.deterministicIdentityPostconditionsSha256 = (
      'c'.repeat(64)
    );
    resealBundleHash(postconditionTamper);
    assert.throws(
      () => validateIdentityBootstrapExecutionBundle(postconditionTamper),
      error => error.code === 'IDENTITY_BUNDLE_DETERMINISTIC_POSTCONDITION_DRIFT',
    );
  } finally {
    fixture.context.close();
  }
});
