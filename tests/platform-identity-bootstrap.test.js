import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import {
  createPlatformIdentityContext,
} from './platform-identity-fixtures.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  calculateBootstrapChecksum,
  getSchemaFingerprint,
  getUsersDirectoryFingerprint,
  inspectPlatformIdentity,
  planPlatformIdentityBootstrap,
  runPlatformIdentityBootstrap,
  validateBootstrapConfig,
} = require('../server/lib/platform-identity-bootstrap.js');
const {
  FINANCIAL_TABLES,
} = require('../server/lib/platform-identity-schema.js');
const {
  createPlatformIdentityRepository,
} = require('../server/lib/platform-identity-repository.js');

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

function replaceUsers(db, users) {
  db.prepare("UPDATE app_data SET json = ? WHERE name = 'users'").run(JSON.stringify(users));
}

function readUsers(db) {
  return JSON.parse(db.prepare("SELECT json FROM app_data WHERE name = 'users'").get().json);
}

function allProtectedCounts(db) {
  return Object.fromEntries([
    'canonical_companies',
    'canonical_branches',
    'company_memberships',
    'membership_branch_access',
    'role_templates',
    'role_template_capabilities',
    'membership_capability_assignments',
    'authorization_audit_events',
    'identity_bootstrap_runs',
    ...FINANCIAL_TABLES,
  ].map(table => [
    table,
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  ]));
}

function applyOptions(db, config, overrides = {}) {
  return {
    db,
    mode: 'apply',
    config,
    explicitApply: true,
    expectedChecksum: config.approval.configChecksum,
    ...overrides,
  };
}

function installAuditInsertFailure(db, message) {
  db.exec(`
    CREATE TEMP TRIGGER fail_authorization_audit_insert
    BEFORE INSERT ON authorization_audit_events
    BEGIN
      SELECT RAISE(ABORT, '${message}');
    END;
  `);
}

function observeUsersRead(db, observer) {
  return new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') {
        return sql => {
          const statement = target.prepare(sql);
          if (!/SELECT json FROM app_data WHERE name = \?/.test(sql)) return statement;
          return new Proxy(statement, {
            get(statementTarget, statementProperty) {
              if (statementProperty === 'get') {
                return (...args) => {
                  observer();
                  return statementTarget.get(...args);
                };
              }
              const value = Reflect.get(statementTarget, statementProperty, statementTarget);
              return typeof value === 'function' ? value.bind(statementTarget) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function waitForFile(filePath, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(filePath)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${filePath}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
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
    config.approval.configChecksum = calculateBootstrapChecksum(context.db, config);
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
    const options = {
      db: context.db,
      mode: 'apply',
      config,
      explicitApply: true,
      expectedChecksum: config.approval.configChecksum,
    };
    const applied = runPlatformIdentityBootstrap(options);
    assert.equal(applied.status, 'succeeded');
    const summary = JSON.parse(applied.run.summaryJson);
    assert.equal(summary.authoritySnapshotVersion, 1);
    assert.match(summary.authorityFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(summary.configChecksum, config.approval.configChecksum);
    assert.equal(summary.schemaFingerprint, config.approval.schemaFingerprint);
    assert.equal(summary.usersDirectoryFingerprint, getUsersDirectoryFingerprint(context.db));
    assert.deepEqual(summary.authorityRowCounts, {
      canonical_branches: 2,
      canonical_companies: 1,
      company_memberships: 1,
      membership_branch_access: 1,
      membership_capability_assignments: 0,
      role_template_capabilities: 1,
      role_templates: 1,
    });
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
      expectedChecksum: calculateBootstrapChecksum(context.db, changed),
    }), error => error.code === 'BOOTSTRAP_BLOCKED');
  } finally {
    context.close();
  }
});

test('forced bootstrap audit failure rolls back authority and bootstrap-run records', () => {
  const context = createPlatformIdentityContext();
  try {
    const config = validConfig(context);
    installAuditInsertFailure(context.db, 'forced-bootstrap-audit-failure');
    assert.throws(() => runPlatformIdentityBootstrap({
      db: context.db,
      mode: 'apply',
      config,
      explicitApply: true,
      expectedChecksum: config.approval.configChecksum,
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

test('bootstrap operator must be exactly one eligible active human user', async t => {
  const cases = [
    {
      name: 'missing operator',
      users: [{ id: 'U-finance', status: 'Активен' }],
      expectedCodes: ['BOOTSTRAP_OPERATOR_INVALID'],
    },
    {
      name: 'inactive operator',
      users: [
        { id: 'U-admin', status: 'Отключен' },
        { id: 'U-finance', status: 'Активен' },
      ],
      expectedCodes: ['BOOTSTRAP_OPERATOR_INVALID'],
    },
    {
      name: 'duplicate operator',
      users: [
        { id: 'U-admin', status: 'Активен' },
        { id: 'U-admin', status: 'Активен' },
        { id: 'U-finance', status: 'Активен' },
      ],
      expectedCodes: ['USER_ID_DUPLICATE', 'BOOTSTRAP_OPERATOR_INVALID'],
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const context = createPlatformIdentityContext({ users: scenario.users });
      try {
        const config = validConfig(context);
        const validation = validateBootstrapConfig(context.db, config);
        const codes = validation.blockers.map(blocker => blocker.code);
        scenario.expectedCodes.forEach(code => assert.equal(codes.includes(code), true, code));
        assert.throws(
          () => runPlatformIdentityBootstrap(applyOptions(context.db, config)),
          error => error.code === 'BOOTSTRAP_BLOCKED',
        );
        assert.deepEqual(allProtectedCounts(context.db), Object.fromEntries(
          Object.keys(allProtectedCounts(context.db)).map(table => [table, 0]),
        ));
      } finally {
        context.close();
      }
    });
  }
});

test('bootstrap rejects explicit memberships bound to company-scoped capabilities', () => {
  const context = createPlatformIdentityContext();
  try {
    const config = validConfig(context);
    config.roleTemplates[0].capabilities = ['members.manage'];
    config.approval.configChecksum = calculateBootstrapChecksum(context.db, config);
    const validation = validateBootstrapConfig(context.db, config);
    assert.equal(
      validation.blockers.some(blocker => blocker.code === 'COMPANY_CAPABILITY_SCOPE_CONFLICT'),
      true,
    );
    assert.throws(
      () => runPlatformIdentityBootstrap(applyOptions(context.db, config)),
      error => error.code === 'BOOTSTRAP_BLOCKED',
    );
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_companies').get().count, 0);
  } finally {
    context.close();
  }
});

test('users-directory fingerprint excludes display metadata and secrets but covers eligibility fields', () => {
  const context = createPlatformIdentityContext();
  try {
    const original = getUsersDirectoryFingerprint(context.db);
    const displayOnly = readUsers(context.db).map(user => ({
      ...user,
      name: `${user.id} renamed`,
      role: 'Changed display role',
      password: 'excluded-from-fingerprint',
      sessionToken: 'excluded-from-fingerprint',
    }));
    replaceUsers(context.db, displayOnly);
    assert.equal(getUsersDirectoryFingerprint(context.db), original);

    const securityChanged = readUsers(context.db).map(user => (
      user.id === 'U-admin' ? { ...user, botOnly: true } : user
    ));
    replaceUsers(context.db, securityChanged);
    assert.notEqual(getUsersDirectoryFingerprint(context.db), original);
  } finally {
    context.close();
  }
});

test('bootstrap transaction rejects every security-relevant users-directory change after plan', async t => {
  const scenarios = [
    {
      name: 'approved operator deactivated',
      mutate(users) {
        return users.map(user => (
          user.id === 'U-admin' ? { ...user, status: 'Отключен' } : user
        ));
      },
    },
    {
      name: 'approved operator deleted',
      mutate(users) {
        return users.filter(user => user.id !== 'U-admin');
      },
    },
    {
      name: 'duplicate ID introduced',
      mutate(users) {
        return [...users, { ...users.find(user => user.id === 'U-admin') }];
      },
    },
    {
      name: 'new active unmapped user introduced',
      mutate(users) {
        return [...users, { id: 'U-new-active', status: 'Активен' }];
      },
    },
    {
      name: 'mapped user removed',
      mutate(users) {
        return users.filter(user => user.id !== 'U-finance');
      },
    },
    {
      name: 'security-relevant frontend eligibility changed',
      mutate(users) {
        return users.map(user => (
          user.id === 'U-admin'
            ? { ...user, botOnly: true, allowFrontendLogin: false, frontendAccess: false }
            : user
        ));
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-bootstrap-toctou-'));
      const dbPath = path.join(directory, 'bootstrap.sqlite');
      const context = createPlatformIdentityContext({ dbPath });
      const other = new Database(dbPath);
      try {
        other.pragma('foreign_keys = ON');
        const config = validConfig(context);
        const before = allProtectedCounts(context.db);
        assert.throws(
          () => runPlatformIdentityBootstrap(applyOptions(context.db, config, {
            afterPlanBeforeTransaction() {
              replaceUsers(other, scenario.mutate(readUsers(other)));
            },
          })),
          error => error.code === 'BOOTSTRAP_TRANSACTIONAL_REVALIDATION_FAILED',
        );
        assert.deepEqual(allProtectedCounts(context.db), before);
        assert.deepEqual(context.db.pragma('foreign_key_check'), []);
      } finally {
        other.close();
        context.close();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});

test('newly active previously irrelevant user invalidates intentionally-unmapped coverage', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-bootstrap-coverage-'));
  const dbPath = path.join(directory, 'bootstrap.sqlite');
  const context = createPlatformIdentityContext({
    dbPath,
    users: [
      { id: 'U-admin', status: 'Активен' },
      { id: 'U-finance', status: 'Активен' },
      { id: 'U-dormant', status: 'Отключен' },
    ],
  });
  const other = new Database(dbPath);
  try {
    const config = validConfig(context);
    assert.throws(
      () => runPlatformIdentityBootstrap(applyOptions(context.db, config, {
        afterPlanBeforeTransaction() {
          replaceUsers(other, readUsers(other).map(user => (
            user.id === 'U-dormant' ? { ...user, status: 'Активен' } : user
          )));
        },
      })),
      error => (
        error.code === 'BOOTSTRAP_TRANSACTIONAL_REVALIDATION_FAILED'
        && error.blockers.some(blocker => blocker.code === 'ACTIVE_USER_UNRESOLVED')
      ),
    );
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM identity_bootstrap_runs').get().count, 0);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_companies').get().count, 0);
  } finally {
    other.close();
    context.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('irrelevant user display changes preserve approval and apply successfully', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-bootstrap-display-'));
  const dbPath = path.join(directory, 'bootstrap.sqlite');
  const context = createPlatformIdentityContext({ dbPath });
  const other = new Database(dbPath);
  try {
    const config = validConfig(context);
    const result = runPlatformIdentityBootstrap(applyOptions(context.db, config, {
      afterPlanBeforeTransaction() {
        replaceUsers(other, readUsers(other).map(user => ({
          ...user,
          name: `Renamed ${user.id}`,
          role: 'Display-only role changed',
          passwordHash: 'excluded-from-fingerprint',
        })));
      },
    }));
    assert.equal(result.status, 'succeeded');
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM identity_bootstrap_runs').get().count, 1);
  } finally {
    other.close();
    context.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('BEGIN IMMEDIATE is acquired before revalidation and blocks a competing users writer', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-bootstrap-lock-'));
  const dbPath = path.join(directory, 'bootstrap.sqlite');
  const context = createPlatformIdentityContext({ dbPath });
  const other = new Database(dbPath);
  try {
    other.pragma('busy_timeout = 10');
    const config = validConfig(context);
    const plan = planPlatformIdentityBootstrap(context.db, config);
    let observed = false;
    const observedDb = observeUsersRead(context.db, () => {
      if (observed) return;
      observed = true;
        const visibleCounts = allProtectedCounts(other);
        Object.values(visibleCounts).forEach(count => assert.equal(count, 0));
        assert.throws(
          () => other.prepare("UPDATE app_data SET updated_at = CURRENT_TIMESTAMP WHERE name = 'users'").run(),
          error => error.code === 'SQLITE_BUSY',
        );
    });
    const repository = createPlatformIdentityRepository(observedDb, {
      readUsers: () => {
        throw new Error('Direct bootstrap apply must use DB-bound users.');
      },
    });
    const result = repository.applyBootstrapPlan(plan);
    assert.equal(observed, true);
    assert.equal(result.status, 'succeeded');
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM identity_bootstrap_runs').get().count, 1);
  } finally {
    other.close();
    context.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('same-checksum no-op still fails closed when the approved operator is no longer active', () => {
  const context = createPlatformIdentityContext();
  try {
    const config = validConfig(context);
    assert.equal(
      runPlatformIdentityBootstrap(applyOptions(context.db, config)).status,
      'succeeded',
    );
    replaceUsers(context.db, readUsers(context.db).map(user => (
      user.id === 'U-admin' ? { ...user, status: 'Отключен' } : user
    )));
    assert.throws(
      () => runPlatformIdentityBootstrap(applyOptions(context.db, config)),
      error => error.code === 'BOOTSTRAP_BLOCKED',
    );
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM identity_bootstrap_runs').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM authorization_audit_events').get().count, 6);
  } finally {
    context.close();
  }
});

test('concurrent bootstrap applies produce one success and one deterministic no-op', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-bootstrap-concurrent-'));
  const dbPath = path.join(directory, 'bootstrap.sqlite');
  const readyPath = path.join(directory, 'writer-ready');
  const releasePath = path.join(directory, 'writers-released');
  const context = createPlatformIdentityContext({ dbPath });
  const second = new Database(dbPath);
  try {
    context.db.pragma('busy_timeout = 3000');
    second.pragma('busy_timeout = 3000');
    const config = validConfig(context);
    const approvedPlan = planPlatformIdentityBootstrap(context.db, config);
    const childScript = `
      const fs = require('node:fs');
      const { createRequire } = require('node:module');
      const serverRequire = createRequire(process.cwd() + '/server/package.json');
      const Database = serverRequire('better-sqlite3');
      const { createPlatformIdentityRepository } = require('./server/lib/platform-identity-repository');
      const db = new Database(process.env.BOOTSTRAP_DB_PATH);
      db.pragma('foreign_keys = ON');
      db.pragma('busy_timeout = 3000');
      const approvedPlan = JSON.parse(process.env.BOOTSTRAP_PLAN);
      try {
        fs.writeFileSync(process.env.BOOTSTRAP_READY_PATH, 'ready');
        while (!fs.existsSync(process.env.BOOTSTRAP_RELEASE_PATH)) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
        const repository = createPlatformIdentityRepository(db, {
          readUsers: () => [],
        });
        const result = repository.applyBootstrapPlan(approvedPlan);
        process.stdout.write(JSON.stringify({ status: result.status }));
      } catch (error) {
        process.stderr.write(error.stack || error.message);
        process.exitCode = 1;
      } finally {
        db.close();
      }
    `;
    const child = spawn(process.execPath, ['-e', childScript], {
      cwd: path.resolve('.'),
      env: {
        ...process.env,
        BOOTSTRAP_DB_PATH: dbPath,
        BOOTSTRAP_PLAN: JSON.stringify(approvedPlan),
        BOOTSTRAP_READY_PATH: readyPath,
        BOOTSTRAP_RELEASE_PATH: releasePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });

    await waitForFile(readyPath);
    fs.writeFileSync(releasePath, 'released');
    const secondRepository = createPlatformIdentityRepository(second, {
      readUsers: () => [],
    });
    const concurrentResult = secondRepository.applyBootstrapPlan(approvedPlan);
    const [exitCode] = await once(child, 'exit');
    assert.equal(exitCode, 0, stderr);
    assert.deepEqual(
      [JSON.parse(stdout).status, concurrentResult.status].sort(),
      ['noop', 'succeeded'],
    );
    assert.equal(second.prepare('SELECT COUNT(*) AS count FROM identity_bootstrap_runs').get().count, 1);
    assert.equal(second.prepare('SELECT COUNT(*) AS count FROM canonical_companies').get().count, 1);
    assert.equal(second.prepare('SELECT COUNT(*) AS count FROM canonical_branches').get().count, 2);
    assert.equal(second.prepare('SELECT COUNT(*) AS count FROM authorization_audit_events').get().count, 6);
    assert.deepEqual(second.pragma('foreign_key_check'), []);
    for (const table of FINANCIAL_TABLES) {
      assert.equal(second.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
    }
  } finally {
    second.close();
    context.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
