import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  createPlatformIdentityContext,
} from './platform-identity-fixtures.js';

const require = createRequire(import.meta.url);
const {
  calculateBootstrapChecksum,
  getSchemaFingerprint,
  planPlatformIdentityBootstrap,
} = require('../server/lib/platform-identity-bootstrap.js');
const {
  createPlatformIdentityRepository,
} = require('../server/lib/platform-identity-repository.js');
const {
  FINANCIAL_TABLES,
} = require('../server/lib/platform-identity-schema.js');

const AUTHORITY_TABLES = [
  'canonical_companies',
  'canonical_branches',
  'company_memberships',
  'membership_branch_access',
  'role_templates',
  'role_template_capabilities',
  'membership_capability_assignments',
  'authorization_audit_events',
  'identity_bootstrap_runs',
];

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
  config.approval.schemaFingerprint = getSchemaFingerprint(context.db);
  config.approval.configChecksum = calculateBootstrapChecksum(context.db, config);
  return config;
}

function readUsers(db) {
  return JSON.parse(db.prepare("SELECT json FROM app_data WHERE name = 'users'").get().json);
}

function replaceUsers(db, users) {
  db.prepare("UPDATE app_data SET json = ? WHERE name = 'users'").run(JSON.stringify(users));
}

function protectedCounts(db) {
  return Object.fromEntries([...AUTHORITY_TABLES, ...FINANCIAL_TABLES].map(table => [
    table,
    Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
  ]));
}

function assertZeroProtectedWrites(db) {
  for (const [table, count] of Object.entries(protectedCounts(db))) {
    assert.equal(count, 0, table);
  }
}

function directRepository(context, overrides = {}) {
  return createPlatformIdentityRepository(context.db, {
    readUsers() {
      throw new Error('Bootstrap apply must not use caller-provided users.');
    },
    nowIso: () => '2026-07-16T05:00:00.000Z',
    ...overrides,
  });
}

function assertTransactionalRevalidationFailure(operation) {
  assert.throws(
    operation,
    error => error.code === 'BOOTSTRAP_TRANSACTIONAL_REVALIDATION_FAILED',
  );
}

test('direct repository apply succeeds without a validation callback and uses live DB state', () => {
  const context = createPlatformIdentityContext();
  try {
    const plan = planPlatformIdentityBootstrap(context.db, validConfig(context));
    const result = directRepository(context).applyBootstrapPlan(plan);
    assert.equal(result.status, 'succeeded');
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_companies').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM identity_bootstrap_runs').get().count, 1);
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);
  } finally {
    context.close();
  }
});

test('removed callback option is ignored and cannot replace repository validation', () => {
  const context = createPlatformIdentityContext();
  try {
    const plan = planPlatformIdentityBootstrap(context.db, validConfig(context));
    let callbackCalled = false;
    const repository = directRepository(context, {
      beforeBootstrapApply() {
        callbackCalled = true;
        throw new Error('Removed callback must never run.');
      },
    });
    assert.equal(repository.applyBootstrapPlan(plan).status, 'succeeded');
    assert.equal(callbackCalled, false);
  } finally {
    context.close();
  }
});

test('direct apply rejects every security-relevant live users-directory drift without writes', async t => {
  const scenarios = [
    {
      name: 'stale users fingerprint',
      mutate: users => users.map(user => (
        user.id === 'U-admin' ? { ...user, frontendAccess: true } : user
      )),
    },
    {
      name: 'approvedBy deactivated',
      mutate: users => users.map(user => (
        user.id === 'U-admin' ? { ...user, status: 'Отключен' } : user
      )),
    },
    {
      name: 'approvedBy removed',
      mutate: users => users.filter(user => user.id !== 'U-admin'),
    },
    {
      name: 'duplicate user ID introduced',
      mutate: users => [...users, { ...users.find(user => user.id === 'U-finance') }],
    },
    {
      name: 'new active unmapped user introduced',
      mutate: users => [...users, { id: 'U-unmapped', status: 'Активен' }],
    },
    {
      name: 'mapped user removed',
      mutate: users => users.filter(user => user.id !== 'U-finance'),
    },
    {
      name: 'mapped user inactivated',
      mutate: users => users.map(user => (
        user.id === 'U-finance' ? { ...user, status: 'Отключен' } : user
      )),
    },
    {
      name: 'bot and frontend eligibility changed',
      mutate: users => users.map(user => (
        user.id === 'U-admin'
          ? { ...user, botOnly: true, allowFrontendLogin: false, frontendAccess: false }
          : user
      )),
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      const context = createPlatformIdentityContext();
      try {
        const plan = planPlatformIdentityBootstrap(context.db, validConfig(context));
        replaceUsers(context.db, scenario.mutate(readUsers(context.db)));
        assertTransactionalRevalidationFailure(
          () => directRepository(context).applyBootstrapPlan(plan),
        );
        assertZeroProtectedWrites(context.db);
      } finally {
        context.close();
      }
    });
  }
});

test('direct apply rejects a stale schema fingerprint and a tampered plan checksum', async t => {
  await t.test('approved schema fingerprint is checksum-covered', () => {
    const context = createPlatformIdentityContext();
    try {
      const config = validConfig(context);
      const approvedChecksum = config.approval.configChecksum;
      config.approval.schemaFingerprint = '0'.repeat(64);
      assert.notEqual(calculateBootstrapChecksum(context.db, config), approvedChecksum);
    } finally {
      context.close();
    }
  });

  await t.test('stale schema fingerprint', () => {
    const context = createPlatformIdentityContext();
    try {
      const plan = planPlatformIdentityBootstrap(context.db, validConfig(context));
      context.db.exec(`
        CREATE INDEX uq_company_memberships_review_drift
        ON company_memberships(principalId)
      `);
      assertTransactionalRevalidationFailure(
        () => directRepository(context).applyBootstrapPlan(plan),
      );
      assertZeroProtectedWrites(context.db);
    } finally {
      context.close();
    }
  });

  await t.test('tampered plan checksum', () => {
    const context = createPlatformIdentityContext();
    try {
      const plan = structuredClone(planPlatformIdentityBootstrap(context.db, validConfig(context)));
      plan.configChecksum = '0'.repeat(64);
      assertTransactionalRevalidationFailure(
        () => directRepository(context).applyBootstrapPlan(plan),
      );
      assertZeroProtectedWrites(context.db);
    } finally {
      context.close();
    }
  });
});

test('same-checksum direct apply validates the live operator before returning no-op', () => {
  const context = createPlatformIdentityContext();
  try {
    const plan = planPlatformIdentityBootstrap(context.db, validConfig(context));
    const repository = directRepository(context);
    assert.equal(repository.applyBootstrapPlan(plan).status, 'succeeded');
    const before = protectedCounts(context.db);
    replaceUsers(context.db, readUsers(context.db).map(user => (
      user.id === 'U-admin' ? { ...user, status: 'Отключен' } : user
    )));
    assertTransactionalRevalidationFailure(() => repository.applyBootstrapPlan(plan));
    assert.deepEqual(protectedCounts(context.db), before);
  } finally {
    context.close();
  }
});

test('same-checksum direct apply rejects invalid live approval metadata before no-op', () => {
  const context = createPlatformIdentityContext();
  try {
    const plan = planPlatformIdentityBootstrap(context.db, validConfig(context));
    const repository = directRepository(context);
    assert.equal(repository.applyBootstrapPlan(plan).status, 'succeeded');
    const before = protectedCounts(context.db);
    const invalidApprovalPlan = structuredClone(plan);
    invalidApprovalPlan.approvedConfig.approval.approvalReference = '';
    assert.equal(invalidApprovalPlan.configChecksum, plan.configChecksum);
    assertTransactionalRevalidationFailure(
      () => repository.applyBootstrapPlan(invalidApprovalPlan),
    );
    assert.deepEqual(protectedCounts(context.db), before);
  } finally {
    context.close();
  }
});

test('direct bootstrap authorization ignores a fake caller users directory', () => {
  const context = createPlatformIdentityContext();
  try {
    const approvedUsers = readUsers(context.db);
    const plan = planPlatformIdentityBootstrap(context.db, validConfig(context));
    replaceUsers(context.db, approvedUsers.filter(user => user.id !== 'U-admin'));
    const repository = directRepository(context, { readUsers: () => approvedUsers });
    assertTransactionalRevalidationFailure(() => repository.applyBootstrapPlan(plan));
    assertZeroProtectedWrites(context.db);
  } finally {
    context.close();
  }
});

test('invalid or missing live users storage rolls back before protected writes', async t => {
  for (const scenario of [
    {
      name: 'invalid users JSON',
      mutate: db => db.prepare("UPDATE app_data SET json = '{' WHERE name = 'users'").run(),
    },
    {
      name: 'missing users row',
      mutate: db => db.prepare("DELETE FROM app_data WHERE name = 'users'").run(),
    },
  ]) {
    await t.test(scenario.name, () => {
      const context = createPlatformIdentityContext();
      try {
        const plan = planPlatformIdentityBootstrap(context.db, validConfig(context));
        scenario.mutate(context.db);
        assertTransactionalRevalidationFailure(
          () => directRepository(context).applyBootstrapPlan(plan),
        );
        assertZeroProtectedWrites(context.db);
      } finally {
        context.close();
      }
    });
  }
});

test('production source exposes only repository-owned safe bootstrap apply', () => {
  const repositorySource = fs.readFileSync(
    new URL('../server/lib/platform-identity-repository.js', import.meta.url),
    'utf8',
  );
  const bootstrapSource = fs.readFileSync(
    new URL('../server/lib/platform-identity-bootstrap.js', import.meta.url),
    'utf8',
  );
  const validationSource = fs.readFileSync(
    new URL('../server/lib/platform-identity-bootstrap-validation.js', import.meta.url),
    'utf8',
  );
  const cliSource = fs.readFileSync(
    new URL('../server/scripts/platform-identity-bootstrap.js', import.meta.url),
    'utf8',
  );
  const productionSource = `${repositorySource}\n${bootstrapSource}\n${validationSource}\n${cliSource}`;

  assert.doesNotMatch(productionSource, /beforeBootstrapApply/);
  assert.doesNotMatch(productionSource, /applyBootstrap(?:Raw|Unsafe)|rawBootstrapApply/);
  assert.equal((repositorySource.match(/function applyBootstrapPlan/g) || []).length, 1);
  assert.match(repositorySource, /return transactionImmediate\(\(\) => \{/);
  assert.match(repositorySource, /planPlatformIdentityBootstrap\(db, approvedPlan\.approvedConfig/);
  assert.match(bootstrapSource, /repository\.applyBootstrapPlan\(plan\)/);
  assert.doesNotMatch(bootstrapSource, /\b(?:INSERT|UPDATE|DELETE)\b[\s\S]*canonical_/i);
  assert.doesNotMatch(bootstrapSource, /transactionImmediate|\.transaction\(/);
  assert.doesNotMatch(validationSource, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?/i);
  assert.match(cliSource, /runPlatformIdentityBootstrap\(/);
  assert.doesNotMatch(cliSource, /\b(?:INSERT|UPDATE|DELETE)\b[\s\S]*canonical_/i);
  assert.doesNotMatch(cliSource, /transactionImmediate|\.transaction\(/);
});
