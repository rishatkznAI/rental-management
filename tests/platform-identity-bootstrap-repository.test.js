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
const CATALOG_TABLES = [
  'capability_catalog_versions',
  'capability_catalog_entries',
];
const COMPLETE_BOOTSTRAP_TABLES = [
  ...AUTHORITY_TABLES,
  ...CATALOG_TABLES,
  ...FINANCIAL_TABLES,
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

function authorityDriftConfig(context) {
  const config = validConfig(context);
  config.branches.push({
    id: 'approved-branch-id-2',
    displayName: 'Approved alternate branch',
    isHeadOffice: false,
    status: 'active',
  });
  config.roleTemplates.push({
    templateKey: 'approved-reader-alt',
    templateVersion: 1,
    displayName: 'Approved alternate reader',
    capabilities: ['upd.form'],
  });
  config.memberships[0].branchIds = ['approved-branch-id', 'approved-branch-id-2'];
  config.memberships[0].capabilityAssignments = [{
    capabilityKey: 'forecast.read',
    effect: 'grant',
  }];
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

function directRepository(context, overrides = {}, db = context.db) {
  return createPlatformIdentityRepository(db, {
    readUsers() {
      throw new Error('Bootstrap apply must not use caller-provided users.');
    },
    nowIso() {
      throw new Error('Bootstrap apply must not use a caller-provided clock.');
    },
    generateId() {
      throw new Error('Bootstrap apply must not use a caller-provided ID generator.');
    },
    ...overrides,
  });
}

function readCompleteBootstrapState(db) {
  const usersRow = db.prepare("SELECT json FROM app_data WHERE name = 'users'").get();
  return {
    usersRaw: usersRow?.json ?? null,
    usersParsed: usersRow ? JSON.parse(usersRow.json) : null,
    tables: Object.fromEntries(COMPLETE_BOOTSTRAP_TABLES.map(table => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ])),
  };
}

function observeTransactionExecution(db, observer) {
  return new Proxy(db, {
    get(target, property) {
      if (property === 'transaction') {
        return operation => target.transaction((...args) => {
          observer();
          return operation(...args);
        });
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function assertPlanRejectedBeforeTransaction(context, approvedPlan) {
  const before = readCompleteBootstrapState(context.db);
  let transactionExecutions = 0;
  const observedDb = observeTransactionExecution(context.db, () => {
    transactionExecutions += 1;
  });
  const repository = directRepository(context, {}, observedDb);
  transactionExecutions = 0;
  assert.throws(
    () => repository.applyBootstrapPlan(approvedPlan),
    error => error.code === 'PLATFORM_IDENTITY_BOOTSTRAP_PLAN_NOT_INERT',
  );
  assert.equal(transactionExecutions, 0);
  assert.equal(context.db.inTransaction, false);
  assert.deepEqual(readCompleteBootstrapState(context.db), before);
}

function mutableApprovedPlan(context) {
  return structuredClone(planPlatformIdentityBootstrap(context.db, validConfig(context)));
}

function readProtectedState(db) {
  return Object.fromEntries([...AUTHORITY_TABLES, ...FINANCIAL_TABLES].map(table => [
    table,
    db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  ]));
}

function withTriggerDisabled(db, triggerName, mutate) {
  const trigger = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?
  `).get(triggerName);
  assert.equal(typeof trigger?.sql, 'string', triggerName);
  db.exec(`DROP TRIGGER ${triggerName}`);
  try {
    mutate();
  } finally {
    db.exec(trigger.sql);
  }
}

function mutateBootstrapSummary(db, mutate) {
  withTriggerDisabled(db, 'trg_identity_bootstrap_runs_no_update', () => {
    const row = db.prepare(`
      SELECT id, summaryJson FROM identity_bootstrap_runs WHERE status = 'succeeded'
    `).get();
    const summary = JSON.parse(row.summaryJson);
    mutate(summary);
    db.prepare(`
      UPDATE identity_bootstrap_runs SET summaryJson = ? WHERE id = ?
    `).run(JSON.stringify(summary), row.id);
  });
}

function assertTransactionalRevalidationFailure(operation) {
  assert.throws(
    operation,
    error => error.code === 'BOOTSTRAP_TRANSACTIONAL_REVALIDATION_FAILED',
  );
}

test('bootstrap plan materialization rejects executable and exotic caller input before transaction', async t => {
  const context = createPlatformIdentityContext();
  try {
    await t.test('top-level getter is rejected without executing', () => {
      const plan = mutableApprovedPlan(context);
      let getterCalls = 0;
      Object.defineProperty(plan, 'mode', {
        enumerable: true,
        get() {
          getterCalls += 1;
          return 'plan';
        },
      });
      assertPlanRejectedBeforeTransaction(context, plan);
      assert.equal(getterCalls, 0);
    });

    await t.test('nested getter is rejected without executing', () => {
      const plan = mutableApprovedPlan(context);
      let getterCalls = 0;
      Object.defineProperty(plan.approvedConfig.approval, 'approvedBy', {
        enumerable: true,
        get() {
          getterCalls += 1;
          return 'U-admin';
        },
      });
      assertPlanRejectedBeforeTransaction(context, plan);
      assert.equal(getterCalls, 0);
    });

    await t.test('setter-only descriptor is rejected without executing', () => {
      const plan = mutableApprovedPlan(context);
      let setterCalls = 0;
      Object.defineProperty(plan, 'mode', {
        enumerable: true,
        set() {
          setterCalls += 1;
        },
      });
      assertPlanRejectedBeforeTransaction(context, plan);
      assert.equal(setterCalls, 0);
    });

    await t.test('own toJSON is rejected without executing', () => {
      const plan = mutableApprovedPlan(context);
      let toJsonCalls = 0;
      plan.toJSON = () => {
        toJsonCalls += 1;
        return {};
      };
      assertPlanRejectedBeforeTransaction(context, plan);
      assert.equal(toJsonCalls, 0);
    });

    await t.test('inherited toJSON is rejected without executing', () => {
      const plan = mutableApprovedPlan(context);
      let toJsonCalls = 0;
      const approvalPrototype = {
        toJSON() {
          toJsonCalls += 1;
          return {};
        },
      };
      plan.approvedConfig.approval = Object.assign(
        Object.create(approvalPrototype),
        plan.approvedConfig.approval,
      );
      assertPlanRejectedBeforeTransaction(context, plan);
      assert.equal(toJsonCalls, 0);
    });

    const createCountingProxy = (target, counter) => new Proxy(target, {
      get(source, property, receiver) {
        counter.calls += 1;
        return Reflect.get(source, property, receiver);
      },
      getOwnPropertyDescriptor(source, property) {
        counter.calls += 1;
        return Reflect.getOwnPropertyDescriptor(source, property);
      },
      getPrototypeOf(source) {
        counter.calls += 1;
        return Reflect.getPrototypeOf(source);
      },
      has(source, property) {
        counter.calls += 1;
        return Reflect.has(source, property);
      },
      ownKeys(source) {
        counter.calls += 1;
        return Reflect.ownKeys(source);
      },
    });

    await t.test('top-level Proxy is rejected without invoking traps', () => {
      const counter = { calls: 0 };
      const plan = createCountingProxy(mutableApprovedPlan(context), counter);
      assertPlanRejectedBeforeTransaction(context, plan);
      assert.equal(counter.calls, 0);
    });

    await t.test('nested Proxy is rejected without invoking traps', () => {
      const counter = { calls: 0 };
      const plan = mutableApprovedPlan(context);
      plan.normalized.company = createCountingProxy(plan.normalized.company, counter);
      assertPlanRejectedBeforeTransaction(context, plan);
      assert.equal(counter.calls, 0);
    });

    await t.test('Proxy around Array is rejected without invoking traps', () => {
      const counter = { calls: 0 };
      const plan = mutableApprovedPlan(context);
      plan.mappedUserIds = createCountingProxy(plan.mappedUserIds, counter);
      assertPlanRejectedBeforeTransaction(context, plan);
      assert.equal(counter.calls, 0);
    });

    await t.test('Proxy around approval is rejected without invoking traps', () => {
      const counter = { calls: 0 };
      const plan = mutableApprovedPlan(context);
      plan.approvedConfig.approval = createCountingProxy(
        plan.approvedConfig.approval,
        counter,
      );
      assertPlanRejectedBeforeTransaction(context, plan);
      assert.equal(counter.calls, 0);
    });

    await t.test('custom class instance is rejected', () => {
      class CallerPlanValue {}
      const plan = mutableApprovedPlan(context);
      plan.callerValue = new CallerPlanValue();
      assertPlanRejectedBeforeTransaction(context, plan);
    });

    await t.test('cyclic plan is rejected', () => {
      const plan = mutableApprovedPlan(context);
      plan.cycle = plan;
      assertPlanRejectedBeforeTransaction(context, plan);
    });

    await t.test('sparse and custom-property arrays are rejected', () => {
      const sparsePlan = mutableApprovedPlan(context);
      sparsePlan.mappedUserIds = new Array(2);
      assertPlanRejectedBeforeTransaction(context, sparsePlan);

      const extraPropertyPlan = mutableApprovedPlan(context);
      extraPropertyPlan.mappedUserIds.extra = true;
      assertPlanRejectedBeforeTransaction(context, extraPropertyPlan);
    });

    await t.test('symbol and non-enumerable properties are rejected', () => {
      const symbolPlan = mutableApprovedPlan(context);
      symbolPlan[Symbol('caller')] = true;
      assertPlanRejectedBeforeTransaction(context, symbolPlan);

      const hiddenPlan = mutableApprovedPlan(context);
      Object.defineProperty(hiddenPlan, 'hidden', {
        enumerable: false,
        value: true,
      });
      assertPlanRejectedBeforeTransaction(context, hiddenPlan);
    });

    await t.test('non-JSON scalar and container values are rejected', () => {
      const values = [
        undefined,
        () => {},
        Symbol('value'),
        1n,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        new Date(),
        Buffer.from('value'),
        new Map(),
        new Set(),
        new WeakMap(),
        new WeakSet(),
        /value/,
        new Error('value'),
        Promise.resolve(),
        new Uint8Array(1),
        new ArrayBuffer(1),
        Object.create(null),
      ];
      for (const value of values) {
        const plan = mutableApprovedPlan(context);
        plan.callerValue = value;
        assertPlanRejectedBeforeTransaction(context, plan);
      }
    });

    await t.test('excessive depth, node count, and byte size are rejected', () => {
      const deepPlan = mutableApprovedPlan(context);
      let nested = deepPlan;
      for (let index = 0; index < 40; index += 1) {
        nested.child = {};
        nested = nested.child;
      }
      assertPlanRejectedBeforeTransaction(context, deepPlan);

      const largeNodePlan = mutableApprovedPlan(context);
      largeNodePlan.large = Array.from({ length: 10_001 }, () => null);
      assertPlanRejectedBeforeTransaction(context, largeNodePlan);

      const largeBytePlan = mutableApprovedPlan(context);
      largeBytePlan.large = 'x'.repeat((1024 * 1024) + 1);
      assertPlanRejectedBeforeTransaction(context, largeBytePlan);
    });
  } finally {
    context.close();
  }
});

test('safe deeply plain caller plan materializes before transaction and applies', () => {
  const context = createPlatformIdentityContext();
  try {
    const plan = mutableApprovedPlan(context);
    let transactionExecutions = 0;
    const observedDb = observeTransactionExecution(context.db, () => {
      transactionExecutions += 1;
    });
    const repository = directRepository(context, {}, observedDb);
    transactionExecutions = 0;
    assert.equal(repository.applyBootstrapPlan(plan).status, 'succeeded');
    assert.equal(transactionExecutions, 1);
    assert.equal(context.db.inTransaction, false);
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);
  } finally {
    context.close();
  }
});

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

test('removed callback options are ignored and cannot run inside bootstrap apply', () => {
  const context = createPlatformIdentityContext();
  try {
    const plan = planPlatformIdentityBootstrap(context.db, validConfig(context));
    let callbackCalled = false;
    const repository = directRepository(context, {
      beforeBootstrapApply() {
        callbackCalled = true;
        throw new Error('Removed callback must never run.');
      },
      beforeAuditInsert() {
        callbackCalled = true;
        throw new Error('Legacy audit callback must never run.');
      },
    });
    assert.equal(repository.applyBootstrapPlan(plan).status, 'succeeded');
    assert.equal(callbackCalled, false);
  } finally {
    context.close();
  }
});

test('same-checksum apply rejects deterministic authority drift and preserves live state', async t => {
  const scenarios = [
    {
      name: 'membership status changed with the same row counts',
      mutate(db) {
        db.prepare(`
          UPDATE company_memberships
          SET status = 'inactive', version = version + 1,
              inactivatedAt = '2026-07-17T00:00:00.000Z',
              updatedAt = '2026-07-17T00:00:00.000Z'
          WHERE id = 'approved-membership-id'
        `).run();
      },
    },
    {
      name: 'membership version changed',
      mutate(db) {
        db.prepare(`
          UPDATE company_memberships
          SET version = version + 1, updatedAt = '2026-07-17T00:00:00.000Z'
          WHERE id = 'approved-membership-id'
        `).run();
      },
    },
    {
      name: 'membership role-template binding changed',
      mutate(db) {
        db.prepare(`
          UPDATE company_memberships
          SET roleTemplateKey = 'approved-reader-alt', roleTemplateVersion = 1,
              version = version + 1, updatedAt = '2026-07-17T00:00:00.000Z'
          WHERE id = 'approved-membership-id'
        `).run();
      },
    },
    {
      name: 'membership company-wide authority changed',
      mutate(db) {
        db.prepare(`
          UPDATE company_memberships
          SET companyWideBranchAuthority = 1, version = version + 1,
              updatedAt = '2026-07-17T00:00:00.000Z'
          WHERE id = 'approved-membership-id'
        `).run();
      },
    },
    {
      name: 'retained branch grant revoked and another grant substituted',
      mutate(db) {
        db.prepare(`
          UPDATE membership_branch_access
          SET status = 'revoked', version = version + 1,
              revokedAt = '2026-07-17T00:00:00.000Z', revokedBy = 'U-admin'
          WHERE membershipId = 'approved-membership-id'
            AND branchId = 'approved-branch-id'
        `).run();
        db.prepare(`
          UPDATE membership_branch_access
          SET branchId = 'approved-head-office-id', version = version + 1
          WHERE membershipId = 'approved-membership-id'
            AND branchId = 'approved-branch-id-2'
        `).run();
      },
    },
    {
      name: 'branch status changed',
      mutate(db) {
        db.prepare(`
          UPDATE canonical_branches
          SET status = 'inactive', version = version + 1,
              updatedAt = '2026-07-17T00:00:00.000Z'
          WHERE id = 'approved-branch-id'
        `).run();
      },
    },
    {
      name: 'Head Office changed with the same branch count',
      mutate(db) {
        withTriggerDisabled(db, 'trg_canonical_branches_immutable_identity', () => {
          db.prepare(`
            UPDATE canonical_branches
            SET isHeadOffice = 0, version = version + 1,
                updatedAt = '2026-07-17T00:00:00.000Z'
            WHERE id = 'approved-head-office-id'
          `).run();
          db.prepare(`
            UPDATE canonical_branches
            SET isHeadOffice = 1, version = version + 1,
                updatedAt = '2026-07-17T00:00:00.000Z'
            WHERE id = 'approved-branch-id'
          `).run();
        });
      },
    },
    {
      name: 'company timezone changed',
      mutate(db) {
        db.prepare(`
          UPDATE canonical_companies
          SET receivablesTimezone = 'Asia/Yekaterinburg', version = version + 1,
              updatedAt = '2026-07-17T00:00:00.000Z'
          WHERE id = 'approved-company-opaque-id'
        `).run();
      },
    },
    {
      name: 'template capability changed with the same row count',
      mutate(db) {
        withTriggerDisabled(db, 'trg_role_template_capabilities_no_update', () => {
          db.prepare(`
            UPDATE role_template_capabilities
            SET capabilityKey = 'forecast.calculate'
            WHERE templateKey = 'approved-reader'
              AND capabilityKey = 'receivables.read'
          `).run();
        });
      },
    },
    {
      name: 'membership grant changed to deny with the same row count',
      mutate(db) {
        db.prepare(`
          UPDATE membership_capability_assignments
          SET effect = 'deny', version = version + 1
          WHERE membershipId = 'approved-membership-id'
            AND capabilityKey = 'forecast.read'
        `).run();
      },
    },
    {
      name: 'assignment status and version changed',
      mutate(db) {
        db.prepare(`
          UPDATE membership_capability_assignments
          SET status = 'revoked', version = version + 1,
              revokedAt = '2026-07-17T00:00:00.000Z', revokedBy = 'U-admin'
          WHERE membershipId = 'approved-membership-id'
            AND capabilityKey = 'forecast.read'
        `).run();
      },
    },
    {
      name: 'stored authority fingerprint tampered',
      mutate(db) {
        mutateBootstrapSummary(db, summary => {
          summary.authorityFingerprint = '0'.repeat(64);
        });
      },
    },
    {
      name: 'stored authority snapshot version is unknown',
      mutate(db) {
        mutateBootstrapSummary(db, summary => {
          summary.authoritySnapshotVersion = 999;
        });
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      const context = createPlatformIdentityContext();
      try {
        const plan = planPlatformIdentityBootstrap(
          context.db,
          authorityDriftConfig(context),
        );
        const repository = directRepository(context);
        assert.equal(repository.applyBootstrapPlan(plan).status, 'succeeded');
        scenario.mutate(context.db);
        const beforeRetry = readProtectedState(context.db);
        const beforeCounts = protectedCounts(context.db);
        assert.throws(
          () => repository.applyBootstrapPlan(plan),
          error => error.code === 'PLATFORM_IDENTITY_BOOTSTRAP_AUTHORITY_DRIFT',
        );
        assert.deepEqual(readProtectedState(context.db), beforeRetry);
        assert.deepEqual(protectedCounts(context.db), beforeCounts);
        assert.equal(context.db.inTransaction, false);
        assert.deepEqual(context.db.pragma('foreign_key_check'), []);
        for (const table of FINANCIAL_TABLES) {
          assert.equal(beforeCounts[table], 0, table);
        }
      } finally {
        context.close();
      }
    });
  }
});

test('matching live authority returns a valid same-checksum no-op', () => {
  const context = createPlatformIdentityContext();
  try {
    const plan = planPlatformIdentityBootstrap(context.db, authorityDriftConfig(context));
    const repository = directRepository(context);
    assert.equal(repository.applyBootstrapPlan(plan).status, 'succeeded');
    const beforeRetry = readProtectedState(context.db);
    assert.equal(repository.applyBootstrapPlan(plan).status, 'noop');
    assert.deepEqual(readProtectedState(context.db), beforeRetry);
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
  assert.doesNotMatch(productionSource, /beforeAuditInsert/);
  assert.doesNotMatch(productionSource, /applyBootstrap(?:Raw|Unsafe)|rawBootstrapApply/);
  assert.equal((repositorySource.match(/function applyBootstrapPlan/g) || []).length, 1);
  assert.match(repositorySource, /const \{ types \} = require\('util'\)/);
  assert.match(repositorySource, /types\.isProxy\(value\)/);
  assert.match(repositorySource, /Object\.getOwnPropertyDescriptors\(value\)/);
  assert.match(repositorySource, /const MATERIALIZED_BOOTSTRAP_PLANS = new WeakSet\(\)/);
  assert.match(repositorySource, /function materializeBootstrapPlanInput\(approvedPlan\)/);
  assert.match(
    repositorySource,
    /const inertApprovedPlan = materializeBootstrapPlanInput\(approvedPlan\)/,
  );
  const transactionalHelperStart = repositorySource.indexOf(
    'function applyMaterializedBootstrapPlanInTransaction(inertApprovedPlan)',
  );
  const publicBoundaryStart = repositorySource.indexOf(
    'function applyBootstrapPlan(approvedPlan = {})',
  );
  assert.notEqual(transactionalHelperStart, -1);
  assert.notEqual(publicBoundaryStart, -1);
  assert.equal(transactionalHelperStart < publicBoundaryStart, true);
  const transactionalHelperSource = repositorySource.slice(
    transactionalHelperStart,
    publicBoundaryStart,
  );
  assert.doesNotMatch(transactionalHelperSource, /\b(?:approvedPlan|callerPlan|originalPlan)\b/);
  assert.match(transactionalHelperSource, /MATERIALIZED_BOOTSTRAP_PLANS\.has\(inertApprovedPlan\)/);
  assert.match(transactionalHelperSource, /return transactionImmediate\(\(\) => \{/);
  assert.match(
    transactionalHelperSource,
    /planPlatformIdentityBootstrap\(db, inertApprovedPlan\.approvedConfig/,
  );
  const exportsSource = repositorySource.slice(repositorySource.indexOf('module.exports = {'));
  assert.doesNotMatch(
    exportsSource,
    /materializeBootstrapPlanInput|applyMaterializedBootstrapPlanInTransaction/,
  );
  assert.match(bootstrapSource, /repository\.applyBootstrapPlan\(plan\)/);
  assert.doesNotMatch(bootstrapSource, /\b(?:INSERT|UPDATE|DELETE)\b[\s\S]*canonical_/i);
  assert.doesNotMatch(bootstrapSource, /transactionImmediate|\.transaction\(/);
  assert.doesNotMatch(validationSource, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?/i);
  assert.match(cliSource, /runPlatformIdentityBootstrap\(/);
  assert.doesNotMatch(cliSource, /\b(?:INSERT|UPDATE|DELETE)\b[\s\S]*canonical_/i);
  assert.doesNotMatch(cliSource, /transactionImmediate|\.transaction\(/);
});
