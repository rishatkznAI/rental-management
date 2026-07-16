import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlatformIdentityContext,
} from './platform-identity-fixtures.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  calculateBootstrapChecksum,
  getSchemaFingerprint,
  inspectPlatformIdentity,
  planPlatformIdentityBootstrap,
  runPlatformIdentityBootstrap,
  validateBootstrapConfig,
} = require('../server/lib/platform-identity-bootstrap.js');
const {
  FINANCIAL_TABLES,
} = require('../server/lib/platform-identity-schema.js');

function validConfig(context) {
  const config = {
    configVersion: 1,
    company: {
      id: 'approved-company-opaque-id',
      displayName: 'Approved company display name',
      receivablesTimezone: 'Europe/Moscow',
    },
    branches: [
      {
        id: 'approved-head-office-id',
        displayName: 'Approved Head Office',
        isHeadOffice: true,
        status: 'active',
      },
      {
        id: 'approved-branch-id',
        displayName: 'Approved operational branch',
        isHeadOffice: false,
        status: 'active',
      },
    ],
    roleTemplates: [{
      templateKey: 'approved-reader',
      templateVersion: 1,
      displayName: 'Approved reader',
      capabilities: ['receivables.read'],
    }],
    memberships: [{
      id: 'approved-membership-id',
      principalId: 'U-finance',
      status: 'active',
      roleTemplateKey: 'approved-reader',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['approved-branch-id'],
      capabilityAssignments: [],
    }],
    intentionallyUnmappedUserIds: ['U-admin'],
    approval: {
      approvedBy: 'U-admin',
      approvedAt: '2026-07-16T00:00:00.000Z',
      approvalReference: 'owner-approval-reference',
      backupReference: 'verified-backup-reference',
    },
  };
  config.approval.configChecksum = calculateBootstrapChecksum(config);
  config.approval.schemaFingerprint = getSchemaFingerprint(context.db);
  return config;
}

test('inspect, validate, and plan perform zero writes and expose deterministic redacted evidence', () => {
  const context = createPlatformIdentityContext({
    users: [
      {
        id: 'U-admin',
        status: 'Активен',
        role: 'Администратор',
        password: 'must-not-appear',
        token: 'must-not-appear',
      },
      { id: 'U-finance', status: 'Активен', role: 'Офис-менеджер' },
    ],
  });
  try {
    const config = validConfig(context);
    const beforeChanges = context.db.prepare('SELECT total_changes() AS count').get().count;
    const inspect = inspectPlatformIdentity(context.db, {
      CANONICAL_RECEIVABLES_READ_API_ENABLED: 'true',
    });
    const validation = validateBootstrapConfig(context.db, config);
    const firstPlan = planPlatformIdentityBootstrap(context.db, config);
    const secondPlan = runPlatformIdentityBootstrap({
      db: context.db,
      mode: 'plan',
      config,
    });
    const afterChanges = context.db.prepare('SELECT total_changes() AS count').get().count;

    assert.equal(beforeChanges, afterChanges);
    assert.equal(inspect.writes, 0);
    assert.equal(validation.writes, 0);
    assert.equal(firstPlan.writes, 0);
    assert.equal(validation.ok, true);
    assert.equal(firstPlan.ok, true);
    assert.deepEqual(firstPlan, secondPlan);
    assert.equal(firstPlan.configChecksum, config.approval.configChecksum);
    assert.equal(firstPlan.schemaFingerprint, config.approval.schemaFingerprint);
    assert.equal(firstPlan.exactChanges.companies, 1);
    assert.equal(firstPlan.exactChanges.branches, 2);
    assert.equal(firstPlan.exactChanges.memberships, 1);
    assert.equal(firstPlan.exactChanges.authorizationAuditEvents, 6);
    assert.equal(firstPlan.exactChanges.bootstrapRuns, 1);
    assert.equal(inspect.productionResolver, 'unconditional-null');
    assert.equal(inspect.canonicalReadFeatureEnabled, true);
    assert.doesNotMatch(JSON.stringify(inspect), /must-not-appear|password|token/i);
  } finally {
    context.close();
  }
});

test('bootstrap validation blocks role inference, invalid mappings, unresolved users, and approval drift', () => {
  const context = createPlatformIdentityContext();
  try {
    const config = validConfig(context);
    config.roleMapping = { Администратор: 'approved-reader' };
    config.memberships[0].branchIds = ['missing-branch'];
    config.intentionallyUnmappedUserIds = [];
    config.approval.configChecksum = calculateBootstrapChecksum(config);
    const validation = validateBootstrapConfig(context.db, config);
    const codes = validation.blockers.map(item => item.code);
    assert.equal(validation.ok, false);
    assert.equal(codes.includes('LEGACY_ROLE_INFERENCE_FORBIDDEN'), true);
    assert.equal(codes.includes('MEMBERSHIP_BRANCH_INVALID'), true);
    assert.equal(codes.includes('ACTIVE_USER_UNRESOLVED'), true);

    const changed = validConfig(context);
    changed.company.displayName = 'Changed without reapproval';
    const changedValidation = validateBootstrapConfig(context.db, changed);
    assert.equal(
      changedValidation.blockers.some(item => item.code === 'APPROVAL_CHECKSUM_MISMATCH'),
      true,
    );
  } finally {
    context.close();
  }
});

test('bootstrap apply requires explicit confirmation and exact checksum', () => {
  const context = createPlatformIdentityContext();
  try {
    const config = validConfig(context);
    assert.throws(() => runPlatformIdentityBootstrap({
      db: context.db,
      mode: 'apply',
      config,
      explicitApply: false,
      expectedChecksum: config.approval.configChecksum,
    }), error => error.code === 'BOOTSTRAP_EXPLICIT_APPLY_REQUIRED');
    assert.throws(() => runPlatformIdentityBootstrap({
      db: context.db,
      mode: 'apply',
      config,
      explicitApply: true,
      expectedChecksum: '0'.repeat(64),
    }), error => error.code === 'BOOTSTRAP_CHECKSUM_CONFIRMATION_MISMATCH');
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_companies').get().count, 0);
  } finally {
    context.close();
  }
});

test('bootstrap apply is atomic, records audit/run evidence, creates no financial rows, and repeats as no-op', () => {
  const context = createPlatformIdentityContext();
  try {
    const config = validConfig(context);
    let sequence = 0;
    const options = {
      db: context.db,
      mode: 'apply',
      config,
      explicitApply: true,
      expectedChecksum: config.approval.configChecksum,
      nowIso: () => '2026-07-16T01:00:00.000Z',
      generateId: prefix => `${prefix}-bootstrap-${++sequence}`,
    };
    const applied = runPlatformIdentityBootstrap(options);
    assert.equal(applied.status, 'succeeded');
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_companies').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_branches').get().count, 2);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM company_memberships').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM membership_branch_access').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM authorization_audit_events').get().count, 6);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM identity_bootstrap_runs').get().count, 1);
    for (const table of FINANCIAL_TABLES) {
      assert.equal(context.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
    }
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);

    const repeated = runPlatformIdentityBootstrap(options);
    assert.equal(repeated.status, 'noop');
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM identity_bootstrap_runs').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM authorization_audit_events').get().count, 6);

    const changed = structuredClone(config);
    changed.company.displayName = 'Changed configuration';
    assert.throws(() => runPlatformIdentityBootstrap({
      ...options,
      config: changed,
      expectedChecksum: calculateBootstrapChecksum(changed),
    }), error => error.code === 'BOOTSTRAP_BLOCKED');
  } finally {
    context.close();
  }
});

test('forced bootstrap audit failure rolls back authority and bootstrap-run records', () => {
  const context = createPlatformIdentityContext();
  try {
    const config = validConfig(context);
    assert.throws(() => runPlatformIdentityBootstrap({
      db: context.db,
      mode: 'apply',
      config,
      explicitApply: true,
      expectedChecksum: config.approval.configChecksum,
      beforeAuditInsert() {
        throw new Error('forced-bootstrap-audit-failure');
      },
    }), /forced-bootstrap-audit-failure/);
    for (const table of [
      'canonical_companies',
      'canonical_branches',
      'role_templates',
      'company_memberships',
      'authorization_audit_events',
      'identity_bootstrap_runs',
    ]) {
      assert.equal(context.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
    }
  } finally {
    context.close();
  }
});
