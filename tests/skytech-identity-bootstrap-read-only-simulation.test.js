import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createPlatformIdentityContext } from './platform-identity-fixtures.js';

const require = createRequire(import.meta.url);
const simulator = require('../server/scripts/simulate-skytech-identity-bootstrap-read-only.js');
const scriptPath = new URL(
  '../server/scripts/simulate-skytech-identity-bootstrap-read-only.js',
  import.meta.url,
);

const OWNER_PRINCIPAL_ID = '1775756913074';
const UNMAPPED_PRINCIPAL_IDS = Object.freeze([
  '1776673416137',
  '1787547467703',
  'DEMO-USER-CARRIER',
  'production-smoke-admin',
]);
const HISTORICAL_SHA = '1'.repeat(40);
const HISTORICAL_DEPLOYMENT_ID = '11111111-1111-4111-8111-111111111111';
const APPROVED_AT = '2026-09-01T00:00:00.000Z';

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

function createSimulationFixture(t, { retainOpenWal = false } = {}) {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'skytech-identity-readonly-'));
  const dbPath = join(tempDirectory, 'retained-snapshot.sqlite');
  const context = createPlatformIdentityContext({
    users: exactUsers(),
    dbPath,
  });
  if (retainOpenWal) {
    context.db.pragma('journal_mode = WAL');
    context.db.pragma('wal_autocheckpoint = 0');
  }
  context.db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)').run(
    'payments',
    JSON.stringify([{ id: 'payment-preserved', amount: 12345 }]),
  );
  if (!retainOpenWal) context.close();
  t.after(() => {
    if (context.db.open) context.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  });
  return { dbPath, tempDirectory };
}

function fileBytes(dbPath) {
  return Object.fromEntries([
    dbPath,
    `${dbPath}-wal`,
    `${dbPath}-shm`,
  ].map(filePath => [filePath, existsSync(filePath) ? readFileSync(filePath) : null]));
}

function exactSimulationArgs(dbPath) {
  return {
    db: dbPath,
    approvedAt: APPROVED_AT,
    captureDeployedSha: HISTORICAL_SHA,
    captureDeploymentId: HISTORICAL_DEPLOYMENT_ID,
  };
}

test('read-only simulation preserves every SQLite source byte and reports zero writes', t => {
  const { dbPath } = createSimulationFixture(t, { retainOpenWal: true });
  const before = fileBytes(dbPath);
  assert.notEqual(before[`${dbPath}-wal`], null);
  assert.notEqual(before[`${dbPath}-shm`], null);
  const result = simulator.simulate(exactSimulationArgs(dbPath));
  const after = fileBytes(dbPath);

  assert.deepEqual(after, before);
  assert.equal(result.writesPerformed, 0);
  assert.equal(result.readOnlyProof.sourceDatabaseOpenedBySqlite, false);
  assert.equal(result.readOnlyProof.simulationDatabaseSource, 'EPHEMERAL_LOCAL_MIRROR');
  assert.equal(result.readOnlyProof.sqliteOpenMode, 'readonly');
  assert.equal(result.readOnlyProof.sqliteQueryOnly, true);
  assert.equal(result.readOnlyProof.sqliteForeignKeys, true);
  assert.equal(result.readOnlyProof.totalChangesBefore, 0);
  assert.equal(result.readOnlyProof.totalChangesAfter, 0);
  assert.equal(result.readOnlyProof.totalChangesDelta, 0);
  assert.deepEqual(result.readOnlyProof.quickCheck, ['ok']);
  assert.equal(result.readOnlyProof.foreignKeyFailureCount, 0);
  assert.equal(result.readOnlyProof.sqliteFilesByteIdentical, true);
  assert.equal(result.readOnlyProof.ephemeralMirrorRemoved, true);
  assert.deepEqual(
    result.readOnlyProof.sqliteFilesAfter,
    result.readOnlyProof.sqliteFilesBefore,
  );
  assert.equal(result.appDataNonWriteEvidence.rowCount, 2);
  assert.deepEqual(
    Object.keys(result.appDataNonWriteEvidence.protectedPrincipalRecordSha256).sort(),
    [OWNER_PRINCIPAL_ID, ...UNMAPPED_PRINCIPAL_IDS].sort(),
  );
});

test('simulation seals the exact owner authority, four unmapped dispositions, and exact deltas', t => {
  const { dbPath } = createSimulationFixture(t);
  const result = simulator.simulate(exactSimulationArgs(dbPath));
  const { bundle } = result;

  assert.equal(bundle.authority.company.displayName, 'ООО "СКАЙТЕХ КОМПАНИ"');
  assert.equal(bundle.authority.branches.length, 1);
  assert.equal(bundle.authority.branches[0].displayName, 'Головной офис');
  assert.equal(bundle.authority.branches[0].isHeadOffice, true);
  assert.equal(bundle.authority.roleTemplates.length, 1);
  assert.equal(
    `${bundle.authority.roleTemplates[0].templateKey}:v${bundle.authority.roleTemplates[0].templateVersion}`,
    'company-administrator:v1',
  );
  assert.deepEqual(
    bundle.authority.roleTemplates[0].capabilities,
    ['branches.manage', 'companies.manage', 'members.manage'],
  );
  assert.equal(bundle.authority.memberships.length, 1);
  assert.deepEqual(bundle.authority.memberships[0], {
    id: 'mbr_G2QDD6FEGGZ7TVGHUJQGJJM3JE4DM3HS43RNCDPUXXQ3BNZGAI7Q',
    principalId: OWNER_PRINCIPAL_ID,
    status: 'active',
    roleTemplateKey: 'company-administrator',
    roleTemplateVersion: 1,
    companyWideBranchAuthority: true,
    branchIds: [],
    capabilityAssignments: [],
  });
  assert.deepEqual(
    bundle.authority.intentionallyUnmappedUserIds,
    UNMAPPED_PRINCIPAL_IDS,
  );
  const unmapped = bundle.principalDispositions.filter(
    disposition => disposition.disposition === 'INTENTIONALLY_UNMAPPED',
  );
  assert.deepEqual(unmapped.map(row => row.principalId), UNMAPPED_PRINCIPAL_IDS);
  assert.equal(unmapped.every(row => row.preserveUserRecordExactly === true), true);
  assert.equal(unmapped.every(row => row.membershipAcrossAllCompanies === 'NONE'), true);

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
  assert.equal(bundle.auditEventManifest.length, 4);
  assert.deepEqual(
    bundle.auditEventManifest.map(event => event.action),
    [
      'company.authority.created',
      'branch.created',
      'role_template.created',
      'membership.created',
    ],
  );
  assert.equal(bundle.writeManifest.uniqueAffectedRowCount, 12);
  assert.equal(bundle.writeManifest.expectedSqliteTotalChanges, 13);
  assert.equal(bundle.writeManifest.operations.length, 13);
  assert.equal(bundle.writeManifest.collectionWriteCount, 0);
  assert.equal(bundle.writeManifest.businessDataMutationCount, 0);
  assert.equal(bundle.writeManifest.schemaMutationCount, 0);
  assert.equal(bundle.writeManifest.migrationMutationCount, 0);
  assert.equal(bundle.writeManifest.tenantGuardMutationCount, 0);
  assert.equal(bundle.writeManifest.environmentMutationCount, 0);
  assert.equal(bundle.writeManifest.smokeIdentityMutationCount, 0);
  assert.equal(bundle.nonWriteSet.appData.mutationCount, 0);
  assert.equal(bundle.nonWriteSet.financialData.mutationCount, 0);
  assert.equal(bundle.nonWriteSet.unrelatedIdentity.mutationCount, 0);
});

test('historical evidence is never promoted and every execution-time binding remains unresolved', t => {
  const { dbPath } = createSimulationFixture(t);
  const result = simulator.simulate(exactSimulationArgs(dbPath));
  const { bundle } = result;

  assert.equal(result.classification, 'HISTORICAL_SIMULATION_ONLY');
  assert.equal(result.productionExecutionAuthorized, false);
  assert.equal(result.executionCapability, 'NONE');
  assert.equal(result.sourcePathDisclosure, 'OMITTED_FROM_SEALED_EVIDENCE');
  assert.equal(bundle.status, 'REVIEW_ONLY_NON_AUTHORIZING');
  assert.equal(bundle.productionExecutionAuthorized, false);
  assert.equal(bundle.executionCapability, 'NONE');
  assert.equal(bundle.historicalSimulationEvidence.classification, 'HISTORICAL_SIMULATION_ONLY');
  assert.equal(bundle.historicalSimulationEvidence.productionAuthorizationValue, 'NONE');
  assert.equal(bundle.historicalSimulationEvidence.captureDeployedSha, HISTORICAL_SHA);
  assert.equal(
    bundle.historicalSimulationEvidence.captureDeploymentId,
    HISTORICAL_DEPLOYMENT_ID,
  );
  assert.equal(bundle.sourceProjection.evidenceClassification, 'HISTORICAL_SIMULATION_ONLY');

  const requiredUnresolved = [
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
  ];
  assert.equal(bundle.bindingCompleteness.complete, false);
  assert.equal(bundle.bindingCompleteness.authorizationReady, false);
  assert.deepEqual(
    bundle.bindingCompleteness.unresolvedKeys,
    [...requiredUnresolved].sort(),
  );
  assert.deepEqual(result.unresolvedExecutionTimeBindings, [...requiredUnresolved].sort());
  for (const key of requiredUnresolved) {
    assert.deepEqual(
      bundle.runtimeBindings[key],
      {
        status: 'UNRESOLVED_EXECUTION_TIME_BINDING',
        value: null,
        binding: bundle.runtimeBindings[key].binding,
      },
    );
  }
  assert.equal(
    bundle.deterministicIdentityPostconditions.fullDatabaseExpectedPostStateFingerprint.status,
    'UNRESOLVED_EXECUTION_TIME_BINDING',
  );
  assert.equal(
    bundle.deterministicIdentityPostconditions.fullDatabaseExpectedPostStateFingerprint.value,
    null,
  );
});

test('simulator exposes no apply or output-file write surface and rejects such arguments', t => {
  const { dbPath, tempDirectory } = createSimulationFixture(t);
  const outputPath = join(tempDirectory, 'must-not-exist.json');

  assert.deepEqual(Object.keys(simulator).sort(), ['simulate']);
  assert.throws(
    () => simulator.simulate({ ...exactSimulationArgs(dbPath), apply: true }),
    error => error.code === 'ARGUMENT_INVALID',
  );
  assert.throws(
    () => simulator.simulate({ ...exactSimulationArgs(dbPath), output: outputPath }),
    error => error.code === 'ARGUMENT_INVALID',
  );
  assert.equal(existsSync(outputPath), false);

  for (const forbiddenArgument of ['--apply', '--output']) {
    const child = spawnSync(process.execPath, [scriptPath.pathname, forbiddenArgument, outputPath], {
      encoding: 'utf8',
    });
    assert.equal(child.status, 1);
    assert.equal(child.stdout, '');
    assert.equal(JSON.parse(child.stderr).code, 'ARGUMENT_INVALID');
    assert.equal(existsSync(outputPath), false);
  }

  const source = readFileSync(scriptPath, 'utf8');
  assert.doesNotMatch(source, /\b(?:writeFile|appendFile|createWriteStream)Sync?\b/);
  assert.doesNotMatch(source, /\.(?:run|exec)\s*\(/);
});
