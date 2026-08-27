import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createPlatformIdentityContext } from './platform-identity-fixtures.js';

const require = createRequire(import.meta.url);
const {
  collectionFingerprint,
  databaseIdentity,
  sqliteTotalChanges,
} = require('../server/lib/production-scope-remediation.js');
const {
  calculateBootstrapChecksum,
  getSchemaFingerprint,
} = require('../server/lib/platform-identity-bootstrap.js');
const {
  databaseContentFingerprint,
  runApply,
  runBackup,
  runRemediation,
  runPreflight,
  runVerify,
} = require('../server/lib/production-scope-remediation-runner.js');
const {
  signOperationRequest,
} = require('../server/lib/production-scope-remediation-auth.js');
const {
  assertProductionWriteAllowed,
} = require('../server/db.js');
const {
  registerProductionScopeRemediationRoutes,
} = require('../server/routes/production-scope-remediation.js');
const bundledProductionPlan = require('../server/config/production-scope-remediation-plan.js');

const DEPLOYED_SHA = '1'.repeat(40);
const SIGNING_SECRET = 'test-remediation-signing-secret-that-is-long-enough';
const COMPANY_ID = 'company-approved-a';
const HEAD_OFFICE_ID = 'branch-approved-head-office';
const COLLECTIONS = [
  'counterparties',
  'counterparty_role_assignments',
  'clients',
  'client_objects',
];
const RAILWAY_IDENTITY = Object.freeze({
  projectId: 'project-production',
  environmentId: 'environment-production',
  serviceId: 'service-production',
  volumeId: 'volume-production',
  volumeName: 'production-volume',
  volumeMountPath: '/test-data',
});
const CONSERVATION_STATE = Object.freeze({
  appDisabled: true,
  botDisabled: true,
  gsmDisabled: true,
  storageWriteGuardEnabled: true,
  cleanResetDisabled: true,
  adminResetDisabled: true,
});

function seedCollections(db) {
  const values = {
    counterparties: [{ id: 'CP-1', legalName: 'Approved customer' }],
    counterparty_role_assignments: [{ id: 'CPRA-1', counterpartyId: 'CP-1', role: 'customer' }],
    clients: [{ id: 'C-1', counterpartyId: 'CP-1', company: 'Approved customer' }],
    client_objects: [{ id: 'CO-1', clientId: 'C-1', counterpartyId: 'CP-1', name: 'Site' }],
  };
  const insert = db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)');
  for (const name of COLLECTIONS) insert.run(name, JSON.stringify(values[name]));
  return values;
}

function scopedValues(values) {
  return Object.fromEntries(COLLECTIONS.map(name => [name, values[name].map(record => ({
    ...record,
    companyId: COMPANY_ID,
    tenantId: COMPANY_ID,
  }))]));
}

function buildPlan(context, dbPath, values) {
  const users = context.readUsers();
  const scoped = scopedValues(values);
  const identityBootstrap = {
    configVersion: 1,
    company: {
      id: COMPANY_ID,
      displayName: 'Owner-approved Company A',
      receivablesTimezone: 'Europe/Moscow',
    },
    branches: [{
      id: HEAD_OFFICE_ID,
      displayName: 'Owner-approved Head Office',
      isHeadOffice: true,
      status: 'active',
    }],
    roleTemplates: [{
      templateKey: 'approved-operator',
      templateVersion: 1,
      displayName: 'Approved operator',
      capabilities: ['receivables.read'],
    }],
    memberships: [
      {
        id: 'membership-u-admin',
        principalId: 'U-admin',
        status: 'active',
        roleTemplateKey: 'approved-operator',
        roleTemplateVersion: 1,
        companyWideBranchAuthority: false,
        branchIds: [HEAD_OFFICE_ID],
        capabilityAssignments: [],
      },
      {
        id: 'membership-u-finance',
        principalId: 'U-finance',
        status: 'active',
        roleTemplateKey: 'approved-operator',
        roleTemplateVersion: 1,
        companyWideBranchAuthority: false,
        branchIds: [HEAD_OFFICE_ID],
        capabilityAssignments: [],
      },
    ],
    intentionallyUnmappedUserIds: [],
    approval: {
      approvedBy: 'U-admin',
      approvedAt: '2026-08-25T00:00:00.000Z',
      approvalReference: 'owner-approved-remediation-test',
      backupReference: 'pending-fresh-backup',
      schemaFingerprint: getSchemaFingerprint(context.db),
    },
  };
  identityBootstrap.approval.configChecksum = calculateBootstrapChecksum(
    context.db,
    identityBootstrap,
  );
  return {
    planVersion: 1,
    planId: 'runner-test-plan-v1',
    sourceDbPath: dbPath,
    expected: {
      dbIdentity: databaseIdentity(context.db),
      identityCounts: {
        canonical_companies: [0, 1],
        canonical_branches: [0, 1],
        company_memberships: [0, 2],
        membership_branch_access: [0, 2],
        role_templates: [0, 1],
        role_template_capabilities: [0, 1],
        membership_capability_assignments: [0],
        authorization_audit_events: [0, 7],
        identity_bootstrap_runs: [0, 1],
      },
      collectionCounts: {
        ...Object.fromEntries(COLLECTIONS.map(name => [name, values[name].length])),
        users: users.length,
      },
      collectionFingerprints: {
        ...Object.fromEntries(COLLECTIONS.map(name => [name, [
          collectionFingerprint(values[name]),
          collectionFingerprint(scoped[name]),
        ]])),
        users: [collectionFingerprint(users)],
      },
    },
    authority: {
      status: 'APPROVED',
      companyId: COMPANY_ID,
      tenantId: COMPANY_ID,
      headOffice: { id: HEAD_OFFICE_ID },
      identityBootstrap,
    },
    actorMappings: [
      {
        userId: 'U-admin',
        action: 'CREATE_MEMBERSHIP',
        membershipId: 'membership-u-admin',
        companyId: COMPANY_ID,
        tenantId: COMPANY_ID,
      },
      {
        userId: 'U-finance',
        action: 'CREATE_MEMBERSHIP',
        membershipId: 'membership-u-finance',
        companyId: COMPANY_ID,
        tenantId: COMPANY_ID,
      },
    ],
    recordMappings: [
      ['counterparties', 'CP-1'],
      ['counterparty_role_assignments', 'CPRA-1'],
      ['clients', 'C-1'],
      ['client_objects', 'CO-1'],
    ].map(([collection, id]) => ({
      collection,
      id,
      action: 'UPDATE_SCOPE',
      companyId: COMPANY_ID,
      tenantId: COMPANY_ID,
    })),
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
}

function createFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-runner-test-'));
  const dbPath = path.join(dir, 'app.sqlite');
  const context = createPlatformIdentityContext({ dbPath });
  const values = seedCollections(context.db);
  const plan = buildPlan(context, dbPath, values);
  t.after(() => {
    context.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const readData = name => {
    const row = context.db.prepare('SELECT json FROM app_data WHERE name = ?').get(name);
    return row ? JSON.parse(row.json) : [];
  };
  return { context, dbPath, plan, readData };
}

function preflightOptions(fixture) {
  return {
    dbPath: fixture.dbPath,
    plan: fixture.plan,
    expectedDeployedSha: DEPLOYED_SHA,
    actualDeployedSha: DEPLOYED_SHA,
    railwayIdentity: RAILWAY_IDENTITY,
  };
}

async function createBackup(fixture) {
  const now = new Date();
  return runBackup({
    ...preflightOptions(fixture),
    conservationState: CONSERVATION_STATE,
    readData: fixture.readData,
    createSqliteBackup: target => fixture.context.db.backup(target),
    collections: ['users', ...COLLECTIONS],
    buildInfo: { commitFull: DEPLOYED_SHA },
    railwayIdentity: RAILWAY_IDENTITY,
    now,
  });
}

function applyOptions(fixture, backup) {
  const runId = '1234567890';
  return {
    ...preflightOptions(fixture),
    receipt: { backupId: backup.receipt.backupId, filename: backup.receipt.filename },
    expectedPlanChecksum: backup.executionPlanChecksum,
    expectedStateFingerprint: backup.receipt.stateFingerprint,
    expectedUserInventoryFingerprint: backup.receipt.userInventoryFingerprint,
    expectedDatabaseFingerprint: backup.receipt.databaseFingerprint,
    expectedSourceFileSetFingerprint: backup.receipt.sourceFileSetFingerprint,
    expectedPostDatabaseFingerprint: backup.receipt.expectedPostDatabaseFingerprint,
    approvedCompanyId: COMPANY_ID,
    confirmation: 'RENTCORE_PHASE_A_APPLY',
    independentBackupEvidence: {
      evidenceVersion: 1,
      provider: 'github-actions-encrypted-artifact',
      repository: 'rishatkznAI/rental-management',
      runId,
      artifactName: `production-scope-remediation-backup-${runId}`,
      artifactUrl: `https://github.com/rishatkznAI/rental-management/actions/runs/${runId}/artifacts/987654321`,
      encryptedArchiveSha256: 'd'.repeat(64),
      githubArtifactDigest: 'e'.repeat(64),
      encryptedArchiveSizeBytes: backup.receipt.sizeBytes + 100,
      backupId: backup.receipt.backupId,
      filename: backup.receipt.filename,
      backupSha256: backup.receipt.sha256,
      backupSizeBytes: backup.receipt.sizeBytes,
      deployedSha: backup.receipt.deployedSha,
      stateFingerprint: backup.receipt.stateFingerprint,
      userInventoryFingerprint: backup.receipt.userInventoryFingerprint,
      databaseFingerprint: backup.receipt.databaseFingerprint,
      sourceFileSetFingerprint: backup.receipt.sourceFileSetFingerprint,
      canonicalCompanyId: backup.receipt.canonicalCompanyId,
      bundledPlanChecksum: backup.receipt.bundledPlanChecksum,
      executionPlanChecksum: backup.receipt.executionPlanChecksum,
      expectedPostDatabaseFingerprint: backup.receipt.expectedPostDatabaseFingerprint,
      railwayIdentity: backup.receipt.railwayIdentity,
      verifiedAt: backup.receipt.generatedAt,
      operatorApprovalReference: 'change-control-test-reference',
      confirmation: 'INDEPENDENT_COPY_VERIFIED',
    },
    conservationState: CONSERVATION_STATE,
    ensureDb: () => fixture.context.db,
    now: new Date(backup.receipt.generatedAt),
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function createRouteHarness(fixture, overrides = {}) {
  const registered = new Map();
  const expectedEnvironment = {
    ...RAILWAY_IDENTITY,
    sourceDbPath: fixture.dbPath,
    canonicalCompanyId: COMPANY_ID,
    githubRepository: 'rishatkznAI/rental-management',
  };
  let enabled = overrides.enabled ?? true;
  let allowedMode = overrides.allowedMode || 'preflight';
  const runner = overrides.runner || {
    runPreflight: () => ({ mode: 'preflight', ok: true }),
    runBackup: async () => ({ mode: 'backup', ok: true }),
    runApply: () => ({ mode: 'apply', ok: true }),
    runVerify: () => ({ mode: 'verify', ok: true }),
  };
  registerProductionScopeRemediationRoutes({
    post(routePath, handler) {
      registered.set(routePath, handler);
    },
  }, {
    dbPath: fixture.dbPath,
    ensureDb: () => fixture.context.db,
    readData: fixture.readData,
    createSqliteBackup: target => fixture.context.db.backup(target),
    collections: ['users', ...COLLECTIONS],
    buildInfo: () => ({ commitFull: DEPLOYED_SHA }),
    plan: fixture.plan,
    expectedEnvironment,
    isEnabled: () => enabled,
    getAllowedMode: () => allowedMode,
    getSigningSecret: () => SIGNING_SECRET,
    getRuntimeIdentity: () => ({
      projectId: expectedEnvironment.projectId,
      environmentId: expectedEnvironment.environmentId,
      serviceId: expectedEnvironment.serviceId,
      volumeName: expectedEnvironment.volumeName,
      volumeMountPath: expectedEnvironment.volumeMountPath,
      replicaId: 'replica-production',
      gitCommitSha: DEPLOYED_SHA,
      ...(overrides.runtimeIdentity || {}),
    }),
    getConservationState: () => CONSERVATION_STATE,
    runner,
    now: () => new Date('2026-08-25T12:00:00.000Z'),
    logger: overrides.logger || { error() {} },
  });

  async function invoke(mode, {
    body = { expectedDeployedSha: DEPLOYED_SHA, railwayIdentity: RAILWAY_IDENTITY },
    requestId = crypto.randomUUID(),
    signature,
    issuedAt = 1787658900,
    expiresAt = 1787659500,
  } = {}) {
    const token = signature === undefined ? signOperationRequest({
      secret: SIGNING_SECRET,
      requestId,
      mode,
      issuedAt,
      expiresAt,
      body,
    }) : signature;
    const req = {
      body,
      headers: {
        'x-production-scope-remediation-token': token,
        'x-production-scope-remediation-request-id': requestId,
        'x-production-scope-remediation-issued-at': String(issuedAt),
        'x-production-scope-remediation-expires-at': String(expiresAt),
      },
    };
    const res = createResponse();
    await registered.get(`/admin/production-scope-remediation/${mode}`)(req, res);
    return res;
  }

  return {
    invoke,
    setEnabled(value) { enabled = value; },
    setAllowedMode(value) { allowedMode = value; },
  };
}

test('default runner mode is readonly preflight and reports zero writes', (t) => {
  const fixture = createFixture(t);
  const before = sqliteTotalChanges(fixture.context.db);
  const result = runRemediation(preflightOptions(fixture));
  assert.equal(result.mode, 'preflight');
  assert.equal(result.runtimeSafety.readonly, true);
  assert.equal(result.runtimeSafety.queryOnly, true);
  assert.equal(result.runtimeSafety.totalChangesDelta, 0);
  assert.equal(result.sqlite.databaseWalAndShmUnchanged, true);
  assert.equal(result.sqlite.beforeFileSetFingerprint, result.sqlite.afterFileSetFingerprint);
  assert.equal(sqliteTotalChanges(fixture.context.db), before);
  assert.equal(result.readyForBackup, true);
  assert.deepEqual(result.blockers.map(item => item.code), ['RECOVERABLE_BACKUP_NOT_VERIFIED']);
});

test('bundled production plan remains fail-closed and preflight-only releasable', () => {
  assert.equal(bundledProductionPlan.authority.status, 'PENDING_VERIFIED_PRODUCTION_DRY_RUN');
  assert.equal(bundledProductionPlan.authority.identityBootstrap, null);
  assert.equal(bundledProductionPlan.backup.verified, false);
  assert.equal(Object.isFrozen(bundledProductionPlan.authority), true);
  assert.equal(Object.isFrozen(bundledProductionPlan.actorMappings), true);
  assert.equal(
    bundledProductionPlan.actorMappings.some(mapping => (
      mapping.userId === 'production-smoke-admin' && mapping.action === 'UNRESOLVED'
    )),
    true,
  );
  assert.equal(
    bundledProductionPlan.recordMappings.some(mapping => mapping.action === 'UNRESOLVED'),
    true,
  );
});

test('legacy local remediation CLI has no apply write path', () => {
  const result = spawnSync(process.execPath, [
    path.resolve('server/scripts/production-scope-remediation.js'),
    '--apply',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /"code": "DIRECT_APPLY_DISABLED"/);
});

test('wrong or missing immutable deployed SHA aborts preflight', (t) => {
  const fixture = createFixture(t);
  assert.throws(
    () => runRemediation({ ...preflightOptions(fixture), expectedDeployedSha: '2'.repeat(40) }),
    error => error.code === 'DEPLOYED_SHA_MISMATCH',
  );
  assert.throws(
    () => runRemediation({ ...preflightOptions(fixture), expectedDeployedSha: '' }),
    error => error.code === 'DEPLOYED_SHA_REQUIRED',
  );
});

test('backup requires the complete central write-freeze state', async (t) => {
  const fixture = createFixture(t);
  for (const field of Object.keys(CONSERVATION_STATE)) {
    await assert.rejects(
      () => runBackup({
        ...preflightOptions(fixture),
        conservationState: { ...CONSERVATION_STATE, [field]: false },
        readData: fixture.readData,
        createSqliteBackup: target => fixture.context.db.backup(target),
        collections: ['users', ...COLLECTIONS],
        buildInfo: { commitFull: DEPLOYED_SHA },
        railwayIdentity: RAILWAY_IDENTITY,
      }),
      error => error.code === 'MAINTENANCE_WRITE_FREEZE_REQUIRED',
      field,
    );
  }
});

test('central storage guard denies application and session writes while remediation freeze is active', () => {
  assert.throws(() => assertProductionWriteAllowed('test write', {
    PRODUCTION_SCOPE_REMEDIATION_ENABLED: 'true',
    PRODUCTION_SCOPE_REMEDIATION_WRITE_FREEZE: 'true',
  }), error => error.code === 'PRODUCTION_SCOPE_WRITE_FREEZE_ACTIVE');
  assert.equal(assertProductionWriteAllowed('test write', {
    PRODUCTION_SCOPE_REMEDIATION_ENABLED: 'true',
    PRODUCTION_SCOPE_REMEDIATION_WRITE_FREEZE: 'false',
  }), true);
});

test('apply requires complete explicit approval material and a verified backup', (t) => {
  const fixture = createFixture(t);
  assert.throws(() => runApply({
    ...preflightOptions(fixture),
    conservationState: CONSERVATION_STATE,
    confirmation: '',
    approvedCompanyId: COMPANY_ID,
  }), error => error.code === 'EXPLICIT_APPLY_CONFIRMATION_REQUIRED');
  assert.throws(() => runApply({
    ...preflightOptions(fixture),
    conservationState: CONSERVATION_STATE,
    confirmation: 'RENTCORE_PHASE_A_APPLY',
    approvedCompanyId: COMPANY_ID,
    expectedPlanChecksum: 'a'.repeat(64),
    expectedStateFingerprint: 'b'.repeat(64),
    expectedUserInventoryFingerprint: 'c'.repeat(64),
    expectedDatabaseFingerprint: 'd'.repeat(64),
    expectedSourceFileSetFingerprint: 'e'.repeat(64),
    expectedPostDatabaseFingerprint: 'f'.repeat(64),
    independentBackupEvidence: {},
    railwayIdentity: RAILWAY_IDENTITY,
    ensureDb: () => fixture.context.db,
  }), error => error.code === 'VERIFIED_BACKUP_REQUIRED');
  assert.equal(sqliteTotalChanges(fixture.context.db) >= 0, true);
});

test('wrong plan checksum and state fingerprint abort before writes', async (t) => {
  const fixture = createFixture(t);
  const backup = await createBackup(fixture);
  const before = sqliteTotalChanges(fixture.context.db);
  assert.throws(() => runApply({
    ...applyOptions(fixture, backup),
    expectedPlanChecksum: 'f'.repeat(64),
  }), error => error.code === 'BACKUP_RECEIPT_APPROVAL_MISMATCH');
  assert.throws(() => runApply({
    ...applyOptions(fixture, backup),
    expectedStateFingerprint: 'e'.repeat(64),
  }), error => error.code === 'BACKUP_RECEIPT_APPROVAL_MISMATCH');
  assert.equal(sqliteTotalChanges(fixture.context.db), before);
});

test('wrong approved canonical Company ID aborts before writes', async (t) => {
  const fixture = createFixture(t);
  const backup = await createBackup(fixture);
  const before = databaseContentFingerprint(fixture.context.db);
  assert.throws(() => runApply({
    ...applyOptions(fixture, backup),
    approvedCompanyId: 'company-not-approved',
  }), error => error.code === 'APPROVED_COMPANY_ID_MISMATCH');
  assert.equal(databaseContentFingerprint(fixture.context.db), before);
});

test('changed user inventory aborts before writes', async (t) => {
  const fixture = createFixture(t);
  const backup = await createBackup(fixture);
  const users = fixture.context.readUsers();
  users.push({ id: 'U-new', name: 'New business user', status: 'Активен', role: 'Менеджер' });
  fixture.context.db.prepare("UPDATE app_data SET json = ? WHERE name = 'users'").run(JSON.stringify(users));
  const beforeApply = sqliteTotalChanges(fixture.context.db);
  assert.throws(
    () => runApply(applyOptions(fixture, backup)),
    error => error.code === 'USER_INVENTORY_CHANGED',
  );
  assert.equal(sqliteTotalChanges(fixture.context.db), beforeApply);
});

test('preflight explicitly classifies every new eligible active user as a human-disposition blocker', (t) => {
  const fixture = createFixture(t);
  const users = fixture.context.readUsers();
  users.push({ id: 'U-new-active', name: 'Unknown active actor', status: 'Активен', role: 'Менеджер' });
  fixture.context.db.prepare("UPDATE app_data SET json = ? WHERE name = 'users'").run(JSON.stringify(users));
  const result = runPreflight(preflightOptions(fixture));
  assert.equal(result.readyForBackup, false);
  assert.equal(
    result.blockers.some(blocker => (
      blocker.code === 'NEW_ACTOR_REQUIRES_HUMAN_DISPOSITION'
      && blocker.userId === 'U-new-active'
    )),
    true,
  );
});

test('a new unscoped business record aborts before writes', async (t) => {
  const fixture = createFixture(t);
  const backup = await createBackup(fixture);
  const counterparties = fixture.readData('counterparties');
  counterparties.push({ id: 'CP-NEW', legalName: 'Unexpected business record' });
  fixture.context.db.prepare("UPDATE app_data SET json = ? WHERE name = 'counterparties'")
    .run(JSON.stringify(counterparties));
  const beforeApply = sqliteTotalChanges(fixture.context.db);
  assert.throws(
    () => runApply(applyOptions(fixture, backup)),
    error => error.code === 'STATE_FINGERPRINT_MISMATCH',
  );
  assert.equal(sqliteTotalChanges(fixture.context.db), beforeApply);
});

test('any unrelated database/WAL state change after backup aborts before writes', async (t) => {
  const fixture = createFixture(t);
  const backup = await createBackup(fixture);
  fixture.context.db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)')
    .run('unrelated_runtime_state', JSON.stringify([{ id: 'unrelated-write' }]));
  const beforeApply = databaseContentFingerprint(fixture.context.db);
  assert.throws(
    () => runApply(applyOptions(fixture, backup)),
    error => error.code === 'DATABASE_FINGERPRINT_MISMATCH',
  );
  assert.equal(databaseContentFingerprint(fixture.context.db), beforeApply);
});

test('a logically identical WAL write in the final pre-transaction gap aborts before remediation writes', async (t) => {
  const fixture = createFixture(t);
  const backup = await createBackup(fixture);
  const beforeLogicalState = databaseContentFingerprint(fixture.context.db);
  assert.throws(
    () => runApply({
      ...applyOptions(fixture, backup),
      ensureDb() {
        const original = fixture.context.db.prepare(
          "SELECT updated_at AS updatedAt FROM app_data WHERE name = 'users'",
        ).get().updatedAt;
        fixture.context.db.transaction(() => {
          fixture.context.db.prepare(
            "UPDATE app_data SET updated_at = 'transaction-gap-probe' WHERE name = 'users'",
          ).run();
          fixture.context.db.prepare(
            "UPDATE app_data SET updated_at = ? WHERE name = 'users'",
          ).run(original);
        })();
        return fixture.context.db;
      },
    }),
    error => error.code === 'TRANSACTIONAL_SQLITE_FILE_SET_MISMATCH',
  );
  assert.equal(databaseContentFingerprint(fixture.context.db), beforeLogicalState);
  assert.equal(
    fixture.context.db.prepare('SELECT COUNT(*) AS count FROM canonical_companies').get().count,
    0,
  );
});

test('stale stored receipt and invalid independent-copy evidence abort before writes', async (t) => {
  const fixture = createFixture(t);
  const backup = await createBackup(fixture);
  const before = databaseContentFingerprint(fixture.context.db);
  assert.throws(
    () => runApply({
      ...applyOptions(fixture, backup),
      now: new Date(Date.parse(backup.receipt.generatedAt) + (25 * 60 * 60 * 1000)),
    }),
    error => error.code === 'BACKUP_NOT_FRESH',
  );
  assert.throws(
    () => runApply({
      ...applyOptions(fixture, backup),
      independentBackupEvidence: {
        ...applyOptions(fixture, backup).independentBackupEvidence,
        backupSha256: '0'.repeat(64),
      },
    }),
    error => error.code === 'INDEPENDENT_BACKUP_EVIDENCE_INVALID',
  );
  assert.equal(databaseContentFingerprint(fixture.context.db), before);
});

test('corrupted backup archive and forged backup identity are rejected', async (t) => {
  const fixture = createFixture(t);
  const backup = await createBackup(fixture);
  const before = databaseContentFingerprint(fixture.context.db);
  assert.throws(
    () => runApply({
      ...applyOptions(fixture, backup),
      receipt: { backupId: crypto.randomUUID(), filename: backup.receipt.filename },
    }),
    error => error.code === 'BACKUP_RECEIPT_MISMATCH',
  );
  fs.appendFileSync(path.join(path.dirname(fixture.dbPath), 'backups', backup.receipt.filename), 'corrupt');
  assert.throws(
    () => runApply(applyOptions(fixture, backup)),
    error => error.code === 'BACKUP_RECEIPT_MISMATCH',
  );
  assert.equal(databaseContentFingerprint(fixture.context.db), before);
});

test('faults after identity writes, mid-collection, and before commit roll back all state', async (t) => {
  const scenarios = [
    event => event.stage === 'after_identity_mutation',
    event => event.stage === 'after_collection_mutation' && event.mutationIndex === 2,
    event => event.stage === 'before_commit',
  ];
  for (let index = 0; index < scenarios.length; index += 1) {
    await t.test(`fault stage ${index + 1}`, async (subtest) => {
      const fixture = createFixture(subtest);
      const backup = await createBackup(fixture);
      const before = databaseContentFingerprint(fixture.context.db);
      assert.throws(() => runApply({
        ...applyOptions(fixture, backup),
        faultInjector(event) {
          if (scenarios[index](event)) throw new Error(`forced-fault-${index + 1}`);
        },
      }), new RegExp(`forced-fault-${index + 1}`));
      assert.equal(databaseContentFingerprint(fixture.context.db), before);
      assert.equal(
        fixture.context.db.prepare('SELECT COUNT(*) AS count FROM canonical_companies').get().count,
        0,
      );
    });
  }
});

test('backup, apply, and verify are separate; verify proves idempotent zero-diff state', async (t) => {
  const fixture = createFixture(t);
  const backup = await createBackup(fixture);
  assert.equal(backup.ok, true);
  assert.equal(backup.readyToApplyAfterIndependentCopy, true);
  assert.equal(backup.receipt.integrity, 'ok');
  assert.equal(backup.receipt.foreignKeyViolationCount, 0);
  assert.equal(backup.receipt.sha256.length, 64);
  assert.equal(
    fixture.context.db.prepare('SELECT COUNT(*) AS count FROM canonical_companies').get().count,
    0,
  );
  const applied = runApply(applyOptions(fixture, backup));
  assert.equal(applied.ok, true);
  assert.ok(applied.writes > 0);
  const verified = runVerify({
    ...preflightOptions(fixture),
    receipt: { backupId: backup.receipt.backupId, filename: backup.receipt.filename },
    conservationState: CONSERVATION_STATE,
    railwayIdentity: RAILWAY_IDENTITY,
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.summary.idempotentPlannedWriteCount, 0);
  assert.equal(verified.runtimeSafety.totalChangesDelta, 0);
  assert.equal(verified.verifyRuntimeSafety.totalChangesDelta, 0);
  assert.equal(verified.verifyRuntimeSafety.databaseWalAndShmUnchanged, true);

  const beforeRepeat = databaseContentFingerprint(fixture.context.db);
  assert.throws(
    () => runApply(applyOptions(fixture, backup)),
    error => ['STATE_FINGERPRINT_MISMATCH', 'DATABASE_FINGERPRINT_MISMATCH', 'SQLITE_FILE_SET_CHANGED']
      .includes(error.code),
  );
  assert.equal(databaseContentFingerprint(fixture.context.db), beforeRepeat);
});

test('verify is read-only and exposes any unexpected partial or unrelated post-apply mutation', async (t) => {
  const fixture = createFixture(t);
  const backup = await createBackup(fixture);
  runApply(applyOptions(fixture, backup));
  fixture.context.db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)')
    .run('unexpected_post_apply_state', JSON.stringify([{ id: 'unexpected' }]));
  const before = databaseContentFingerprint(fixture.context.db);
  const verified = runVerify({
    ...preflightOptions(fixture),
    receipt: { backupId: backup.receipt.backupId, filename: backup.receipt.filename },
    conservationState: CONSERVATION_STATE,
    railwayIdentity: RAILWAY_IDENTITY,
  });
  assert.equal(verified.ok, false);
  assert.equal(
    verified.blockers.some(blocker => blocker.code === 'UNEXPECTED_POST_DATABASE_FINGERPRINT'),
    true,
  );
  assert.equal(databaseContentFingerprint(fixture.context.db), before);
  assert.equal(verified.verifyRuntimeSafety.totalChangesDelta, 0);
});

test('preflight output cannot leak password, token, session, or secret fields', (t) => {
  const fixture = createFixture(t);
  const users = fixture.context.readUsers().map(user => ({
    ...user,
    password: 'plaintext-never-log',
    passwordHash: 'hash-never-log',
    apiToken: 'token-never-log',
    session: 'session-never-log',
  }));
  fixture.context.db.prepare("UPDATE app_data SET json = ? WHERE name = 'users'").run(JSON.stringify(users));
  fixture.plan.expected.collectionFingerprints.users.push(collectionFingerprint(users));
  const output = JSON.stringify(runRemediation(preflightOptions(fixture)));
  for (const forbidden of [
    'plaintext-never-log',
    'hash-never-log',
    'token-never-log',
    'session-never-log',
    'passwordHash',
    'apiToken',
  ]) {
    assert.equal(output.includes(forbidden), false, forbidden);
  }
});

test('route registration and normal startup wiring do not execute remediation', () => {
  const registered = [];
  let calls = 0;
  const router = { post: (...args) => registered.push(args) };
  const runner = {
    runPreflight: () => { calls += 1; },
    runBackup: () => { calls += 1; },
    runApply: () => { calls += 1; },
    runVerify: () => { calls += 1; },
  };
  registerProductionScopeRemediationRoutes(router, {
    dbPath: '/data/app.sqlite',
    ensureDb: () => null,
    readData: () => [],
    createSqliteBackup: async () => {},
    collections: [],
    buildInfo: () => ({ commitFull: DEPLOYED_SHA }),
    runner,
  });
  assert.equal(calls, 0);
  assert.deepEqual(registered.map(args => args[0]), [
    '/admin/production-scope-remediation/preflight',
    '/admin/production-scope-remediation/backup',
    '/admin/production-scope-remediation/apply',
    '/admin/production-scope-remediation/verify',
  ]);
});

test('route fails closed for disabled/missing mode, token, and every Railway identity field', async (t) => {
  const fixture = createFixture(t);

  const disabled = createRouteHarness(fixture, { enabled: false });
  assert.equal((await disabled.invoke('preflight')).statusCode, 404);

  const wrongMode = createRouteHarness(fixture, { allowedMode: 'backup' });
  assert.equal((await wrongMode.invoke('preflight')).statusCode, 404);

  const missingToken = createRouteHarness(fixture);
  const missingTokenResult = await missingToken.invoke('preflight', { signature: '' });
  assert.equal(missingTokenResult.statusCode, 403);
  assert.equal(missingTokenResult.body.code, 'OPERATION_TOKEN_INVALID');

  const invalidToken = createRouteHarness(fixture);
  const invalidTokenResult = await invalidToken.invoke('preflight', { signature: 'f'.repeat(64) });
  assert.equal(invalidTokenResult.statusCode, 403);
  assert.equal(invalidTokenResult.body.code, 'OPERATION_TOKEN_INVALID');

  for (const field of ['projectId', 'environmentId', 'serviceId', 'volumeName', 'volumeMountPath', 'replicaId', 'gitCommitSha']) {
    const harness = createRouteHarness(fixture, { runtimeIdentity: { [field]: '' } });
    const response = await harness.invoke('preflight');
    assert.equal(response.statusCode, 404, field);
    assert.equal(response.body.code, 'RAILWAY_RUNTIME_IDENTITY_MISMATCH', field);
  }

  for (const field of ['projectId', 'environmentId', 'serviceId', 'volumeId', 'volumeName', 'volumeMountPath']) {
    const harness = createRouteHarness(fixture);
    const body = {
      expectedDeployedSha: DEPLOYED_SHA,
      railwayIdentity: { ...RAILWAY_IDENTITY, [field]: 'wrong-target' },
    };
    const response = await harness.invoke('preflight', { body });
    assert.equal(response.statusCode, 403, field);
    assert.equal(response.body.code, 'RAILWAY_REQUEST_IDENTITY_MISMATCH', field);
  }
});

test('operation authorization is body/mode-bound, expires, and is single-use', async (t) => {
  const fixture = createFixture(t);
  const harness = createRouteHarness(fixture);
  const requestId = crypto.randomUUID();
  const first = await harness.invoke('preflight', { requestId });
  assert.equal(first.statusCode, 200);
  const replay = await harness.invoke('preflight', { requestId });
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.body.code, 'OPERATION_TOKEN_REPLAYED');

  const expired = await harness.invoke('preflight', {
    requestId: crypto.randomUUID(),
    issuedAt: 1787658000,
    expiresAt: 1787658300,
  });
  assert.equal(expired.statusCode, 403);
  assert.equal(expired.body.code, 'OPERATION_TOKEN_EXPIRED');

  const originalBody = { expectedDeployedSha: DEPLOYED_SHA, railwayIdentity: RAILWAY_IDENTITY };
  const tamperedBody = { ...originalBody, expectedDeployedSha: '2'.repeat(40) };
  const tamperedRequestId = crypto.randomUUID();
  const signature = signOperationRequest({
    secret: SIGNING_SECRET,
    requestId: tamperedRequestId,
    mode: 'preflight',
    issuedAt: 1787658900,
    expiresAt: 1787659500,
    body: originalBody,
  });
  const tampered = await harness.invoke('preflight', {
    body: tamperedBody,
    requestId: tamperedRequestId,
    signature,
  });
  assert.equal(tampered.statusCode, 403);
  assert.equal(tampered.body.code, 'OPERATION_TOKEN_INVALID');

  const crossModeHarness = createRouteHarness(fixture, { allowedMode: 'preflight,backup' });
  const crossModeRequestId = crypto.randomUUID();
  const crossModeSignature = signOperationRequest({
    secret: SIGNING_SECRET,
    requestId: crossModeRequestId,
    mode: 'preflight',
    issuedAt: 1787658900,
    expiresAt: 1787659500,
    body: originalBody,
  });
  const crossMode = await crossModeHarness.invoke('backup', {
    body: originalBody,
    requestId: crossModeRequestId,
    signature: crossModeSignature,
  });
  assert.equal(crossMode.statusCode, 403);
  assert.equal(crossMode.body.code, 'OPERATION_TOKEN_INVALID');
});

test('authorization failures redact signing material from logs and responses', async (t) => {
  const fixture = createFixture(t);
  const logs = [];
  const harness = createRouteHarness(fixture, {
    logger: { error: (...args) => logs.push(args) },
  });
  const interceptedToken = 'a'.repeat(64);
  const response = await harness.invoke('preflight', { signature: interceptedToken });
  const output = JSON.stringify({ logs, response: response.body });
  assert.equal(output.includes(interceptedToken), false);
  assert.equal(output.includes(SIGNING_SECRET), false);
  assert.equal(output.includes('authorization'), false);
});

test('concurrent replay cannot execute a privileged handler twice', async (t) => {
  const fixture = createFixture(t);
  let calls = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const harness = createRouteHarness(fixture, {
    runner: {
      async runPreflight() {
        calls += 1;
        await pending;
        return { mode: 'preflight', ok: true };
      },
      runBackup() {},
      runApply() {},
      runVerify() {},
    },
  });
  const requestId = crypto.randomUUID();
  const firstPromise = harness.invoke('preflight', { requestId });
  await Promise.resolve();
  const concurrent = await harness.invoke('preflight', { requestId });
  assert.equal(concurrent.statusCode, 409);
  assert.equal(concurrent.body.code, 'REMEDIATION_OPERATION_IN_PROGRESS');
  release();
  const first = await firstPromise;
  assert.equal(first.statusCode, 200);
  assert.equal(calls, 1);
  const replay = await harness.invoke('preflight', { requestId });
  assert.equal(replay.body.code, 'OPERATION_TOKEN_REPLAYED');
});

test('manual workflow is production-protected, target-pinned, and has no deploy or automatic trigger', () => {
  const source = fs.readFileSync(
    path.resolve('.github/workflows/production-scope-remediation.yml'),
    'utf8',
  );
  assert.match(source, /^on:\n  workflow_dispatch:/m);
  assert.match(source, /environment: production/);
  assert.match(source, /npm install --global @railway\/cli@5\.45\.0/);
  assert.match(source, /test "\$\(railway --version\)" = "railway 5\.45\.0"/);
  assert.doesNotMatch(source, /@railway\/cli@4\.60\.0/);
  assert.match(source, /1558b38d-bf16-4b50-9ee6-0871b7152116/);
  assert.match(source, /62833109-61cb-4600-9200-d624d6537a05/);
  assert.match(source, /b2016e92-3c50-4b00-800d-625a139b219c/);
  assert.match(source, /48b8768c-a8a9-4a87-8a4b-b980fff5d00c/);
  assert.match(
    source,
    /PRODUCTION_API_ORIGIN: https:\/\/rental-management-production-35bc\.up\.railway\.app/,
  );
  assert.doesNotMatch(source, /api\.skytech-rent\.ru/);
  assert.doesNotMatch(source, /--location\b/);
  assert.doesNotMatch(source, /\bwrangler\b/);
  assert.match(source, /\(\$services \| length\) == 1/);
  assert.match(source, /\(\$volumes \| length\) == 1/);
  assert.match(source, /select\(\.volume\.name == \$volumeName\)/);
  assert.match(source, /X-Production-Scope-Remediation-Request-Id/);
  assert.match(source, /createHmac\("sha256"/);
  assert.match(source, /railway volume files --volume/);
  assert.match(source, /gpg \\/);
  assert.match(source, /HUMAN_VERIFICATION_REQUIRED/);
  assert.match(source, /PRODUCTION_SCOPE_REMEDIATION_SIGNING_SECRET/);
  assert.match(source, /actions\/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f/);
  assert.doesNotMatch(source, /uses:\s+actions\/upload-artifact@v\d/);
  assert.doesNotMatch(source, /secrets\.PRODUCTION_SCOPE_REMEDIATION_TOKEN\b/);
  assert.doesNotMatch(source, /secrets\.PRODUCTION_API_URL\b/);
  assert.doesNotMatch(source, /\brailway\s+(?:up|redeploy|restart)\b/);
  assert.doesNotMatch(source, /\bssh\b/i);
  assert.doesNotMatch(source, /^\s+(?:push|pull_request|schedule):/m);
});
