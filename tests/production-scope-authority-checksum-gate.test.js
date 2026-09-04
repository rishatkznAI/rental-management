import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createPlatformIdentityContext } from './platform-identity-fixtures.js';

const require = createRequire(import.meta.url);
const {
  collectionFingerprint,
  databaseIdentity,
} = require('../server/lib/production-scope-remediation.js');
const {
  calculateBootstrapChecksum,
  getSchemaFingerprint,
} = require('../server/lib/platform-identity-bootstrap.js');
const {
  buildExecutionPlan,
  planHash,
  runApply,
  runPreflight,
  sqliteFileSetFingerprint,
  sqliteObservedFileSetFingerprint,
} = require('../server/lib/production-scope-remediation-runner.js');

const DEPLOYED_SHA = '1'.repeat(40);
const COMPANY_ID = 'company-authority-checksum-test';
const HEAD_OFFICE_ID = 'branch-authority-checksum-test';
const COLLECTIONS = [
  'equipment',
  'counterparties',
  'counterparty_role_assignments',
  'clients',
  'client_objects',
  'documents',
  'app_settings',
];
const CONSERVATION_STATE = Object.freeze({
  appDisabled: true,
  botDisabled: true,
  gsmDisabled: true,
  storageWriteGuardEnabled: true,
  schemaCompatibilityDisabled: true,
  cleanResetDisabled: true,
  adminResetDisabled: true,
});

function buildPlan(context, dbPath) {
  const users = context.readUsers();
  const identityBootstrap = {
    configVersion: 1,
    company: {
      id: COMPANY_ID,
      displayName: 'Authority checksum test company',
      receivablesTimezone: 'Europe/Moscow',
    },
    branches: [{
      id: HEAD_OFFICE_ID,
      displayName: 'Head Office',
      isHeadOffice: true,
      status: 'active',
    }],
    roleTemplates: [{
      templateKey: 'company-administrator',
      templateVersion: 1,
      displayName: 'Company administrator',
      capabilities: ['receivables.read'],
    }],
    memberships: [{
      id: 'membership-authority-checksum-test',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'company-administrator',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: true,
      branchIds: [],
      capabilityAssignments: [],
    }],
    intentionallyUnmappedUserIds: ['U-finance'],
    approval: {
      approvedBy: 'U-admin',
      approvedAt: '2026-09-01T00:00:00.000Z',
      approvalReference: 'owner-authority-checksum-gate-test',
      backupReference: 'pending-fresh-backup',
      schemaFingerprint: getSchemaFingerprint(context.db),
    },
  };
  identityBootstrap.approval.configChecksum = calculateBootstrapChecksum(
    context.db,
    identityBootstrap,
  );
  const emptyFingerprint = collectionFingerprint([]);
  return {
    planVersion: 1,
    planId: 'authority-checksum-gate-test-v1',
    sourceDbPath: dbPath,
    expected: {
      dbIdentity: databaseIdentity(context.db),
      identityCounts: {
        canonical_companies: [0, 1],
        canonical_branches: [0, 1],
        company_memberships: [0, 1],
        membership_branch_access: [0],
        role_templates: [0, 1],
        role_template_capabilities: [0, 1],
        membership_capability_assignments: [0],
        authorization_audit_events: [0, 4],
        identity_bootstrap_runs: [0, 1],
      },
      collectionCounts: {
        ...Object.fromEntries(COLLECTIONS.map(name => [name, 0])),
        users: users.length,
      },
      collectionFingerprints: {
        ...Object.fromEntries(COLLECTIONS.map(name => [name, [emptyFingerprint]])),
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
        membershipId: 'membership-authority-checksum-test',
        companyId: COMPANY_ID,
        tenantId: COMPANY_ID,
      },
      {
        userId: 'U-finance',
        action: 'NO_MEMBERSHIP',
        companyId: null,
        tenantId: null,
      },
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
}

function createFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-checksum-gate-'));
  const dbPath = path.join(directory, 'app.sqlite');
  const context = createPlatformIdentityContext({ dbPath });
  const insert = context.db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)');
  for (const collection of COLLECTIONS) insert.run(collection, '[]');
  const plan = buildPlan(context, dbPath);
  t.after(() => {
    context.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { context, dbPath, plan };
}

function receiptFixture(plan, overrides = {}) {
  const sourceFileSet = {
    database: { name: 'app.sqlite', sizeBytes: 10, sha256: 'a'.repeat(64) },
    wal: null,
    shm: null,
  };
  return {
    receiptVersion: 2,
    backupId: '12345678-1234-4123-8123-123456789abc',
    filename: 'rentcore-phase-a-20260901T000000Z.zip',
    generatedAt: '2026-09-01T00:00:00.000Z',
    sizeBytes: 10,
    sha256: 'b'.repeat(64),
    sourceDbIdentity: 'source-db-identity',
    databaseFingerprint: 'c'.repeat(64),
    sourceFileSet,
    sourceFileSetFingerprint: sqliteFileSetFingerprint(sourceFileSet),
    sourceObservedFileSetFingerprint: sqliteObservedFileSetFingerprint(sourceFileSet),
    stateFingerprint: 'd'.repeat(64),
    userInventoryFingerprint: 'e'.repeat(64),
    deployedSha: DEPLOYED_SHA,
    bundledPlanChecksum: planHash(plan),
    authorityConfigChecksum: plan.authority.identityBootstrap.approval.configChecksum,
    canonicalCompanyId: COMPANY_ID,
    railwayIdentity: null,
    executionPlanChecksum: 'f'.repeat(64),
    expectedPostDatabaseFingerprint: '0'.repeat(64),
    ...overrides,
  };
}

function writeStoredReceipt(dbPath, receipt) {
  const backupDirectory = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(backupDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(backupDirectory, `${receipt.filename}.receipt.json`),
    JSON.stringify(receipt),
  );
}

function earlyApplyOptions(fixture, overrides = {}) {
  return {
    dbPath: fixture.dbPath,
    plan: fixture.plan,
    receipt: {
      backupId: '12345678-1234-4123-8123-123456789abc',
      filename: 'rentcore-phase-a-20260901T000000Z.zip',
    },
    expectedDeployedSha: DEPLOYED_SHA,
    actualDeployedSha: DEPLOYED_SHA,
    expectedPlanChecksum: 'f'.repeat(64),
    expectedStateFingerprint: 'd'.repeat(64),
    expectedUserInventoryFingerprint: 'e'.repeat(64),
    expectedDatabaseFingerprint: 'c'.repeat(64),
    expectedSourceFileSetFingerprint: 'a'.repeat(64),
    expectedPostDatabaseFingerprint: '0'.repeat(64),
    approvedCompanyId: COMPANY_ID,
    confirmation: 'RENTCORE_PHASE_A_APPLY',
    conservationState: CONSERVATION_STATE,
    ensureDb() {
      assert.fail('authority checksum rejection must precede database acquisition');
    },
    now: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

test('readonly preflight exposes the exact approved identity authority checksum', (t) => {
  const fixture = createFixture(t);
  const result = runPreflight({
    dbPath: fixture.dbPath,
    plan: fixture.plan,
    expectedDeployedSha: DEPLOYED_SHA,
    actualDeployedSha: DEPLOYED_SHA,
  });

  assert.equal(
    result.authorityConfigChecksum,
    fixture.plan.authority.identityBootstrap.approval.configChecksum,
  );
  assert.equal(
    result.blockers.some(blocker => blocker.code.startsWith('AUTHORITY_CONFIG_CHECKSUM')),
    false,
  );
});

test('execution-plan receipt binding fails closed on a missing or mismatched authority checksum', (t) => {
  const fixture = createFixture(t);
  const checksum = fixture.plan.authority.identityBootstrap.approval.configChecksum;

  assert.throws(
    () => buildExecutionPlan(fixture.plan, receiptFixture(fixture.plan, {
      authorityConfigChecksum: undefined,
    })),
    error => error.code === 'VERIFIED_BACKUP_REQUIRED',
  );
  assert.throws(
    () => buildExecutionPlan(fixture.plan, receiptFixture(fixture.plan, {
      authorityConfigChecksum: '9'.repeat(64),
    })),
    error => error.code === 'BACKUP_RECEIPT_AUTHORITY_CONFIG_CHECKSUM_MISMATCH',
  );
  assert.equal(
    buildExecutionPlan(fixture.plan, receiptFixture(fixture.plan))
      .backup.authorityConfigChecksum,
    checksum,
  );
});

test('apply requires the caller authority checksum before acquiring a writable database', (t) => {
  const fixture = createFixture(t);
  const before = fixture.context.db.prepare('SELECT total_changes() AS count').get().count;

  assert.throws(
    () => runApply(earlyApplyOptions(fixture)),
    error => error.code === 'AUTHORITY_CONFIG_CHECKSUM_REQUIRED',
  );
  assert.throws(
    () => runApply(earlyApplyOptions(fixture, {
      expectedAuthorityConfigChecksum: '9'.repeat(64),
    })),
    error => error.code === 'AUTHORITY_CONFIG_CHECKSUM_MISMATCH',
  );
  assert.equal(
    fixture.context.db.prepare('SELECT total_changes() AS count').get().count,
    before,
  );
});

test('independent-copy evidence must repeat the receipt authority checksum', (t) => {
  const fixture = createFixture(t);
  const receipt = receiptFixture(fixture.plan);
  writeStoredReceipt(fixture.dbPath, receipt);
  const runId = '1234567890';
  const independentBackupEvidence = {
    evidenceVersion: 1,
    provider: 'github-actions-encrypted-artifact',
    repository: 'rishatkznAI/rental-management',
    runId,
    artifactName: `production-scope-remediation-backup-${runId}`,
    artifactUrl: `https://github.com/rishatkznAI/rental-management/actions/runs/${runId}/artifacts/1`,
    encryptedArchiveSha256: '1'.repeat(64),
    githubArtifactDigest: '2'.repeat(64),
    encryptedArchiveSizeBytes: 11,
    decryptabilityVerified: true,
    decryptedArchiveSha256: receipt.sha256,
    decryptedArchiveSizeBytes: receipt.sizeBytes,
    backupId: receipt.backupId,
    filename: receipt.filename,
    backupSha256: receipt.sha256,
    backupSizeBytes: receipt.sizeBytes,
    deployedSha: receipt.deployedSha,
    stateFingerprint: receipt.stateFingerprint,
    userInventoryFingerprint: receipt.userInventoryFingerprint,
    databaseFingerprint: receipt.databaseFingerprint,
    sourceFileSetFingerprint: receipt.sourceFileSetFingerprint,
    sourceObservedFileSetFingerprint: receipt.sourceObservedFileSetFingerprint,
    canonicalCompanyId: receipt.canonicalCompanyId,
    bundledPlanChecksum: receipt.bundledPlanChecksum,
    executionPlanChecksum: receipt.executionPlanChecksum,
    expectedPostDatabaseFingerprint: receipt.expectedPostDatabaseFingerprint,
    railwayIdentity: receipt.railwayIdentity,
    verifiedAt: receipt.generatedAt,
    operatorApprovalReference: 'authority-checksum-copy-approval',
    confirmation: 'INDEPENDENT_COPY_VERIFIED',
  };

  assert.throws(
    () => runApply(earlyApplyOptions(fixture, {
      expectedAuthorityConfigChecksum: receipt.authorityConfigChecksum,
      expectedSourceFileSetFingerprint: receipt.sourceFileSetFingerprint,
      independentBackupEvidence,
    })),
    error => error.code === 'INDEPENDENT_BACKUP_EVIDENCE_INVALID',
  );
  assert.throws(
    () => runApply(earlyApplyOptions(fixture, {
      expectedAuthorityConfigChecksum: receipt.authorityConfigChecksum,
      expectedSourceFileSetFingerprint: receipt.sourceFileSetFingerprint,
      independentBackupEvidence: {
        ...independentBackupEvidence,
        authorityConfigChecksum: '9'.repeat(64),
      },
    })),
    error => error.code === 'INDEPENDENT_BACKUP_EVIDENCE_INVALID',
  );
});
