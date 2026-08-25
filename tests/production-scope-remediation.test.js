import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  createPlatformIdentityContext,
} from './platform-identity-fixtures.js';

const require = createRequire(import.meta.url);
const {
  applyProductionScopeRemediation,
  collectionFingerprint,
  databaseIdentity,
  planProductionScopeRemediation,
  sqliteTotalChanges,
} = require('../server/lib/production-scope-remediation.js');
const {
  calculateBootstrapChecksum,
  getSchemaFingerprint,
} = require('../server/lib/platform-identity-bootstrap.js');
const { deriveCanonicalCompanyId } = require('../server/lib/canonical-company-id.js');

const COMPANY_ID = 'company-approved-a';
const COLLECTIONS = [
  'counterparties',
  'counterparty_role_assignments',
  'clients',
  'client_objects',
];

function seedCollections(db, overrides = {}) {
  const state = {
    counterparties: [{ id: 'CP-1', legalName: 'Approved customer' }],
    counterparty_role_assignments: [{ id: 'CPRA-1', counterpartyId: 'CP-1', role: 'customer' }],
    clients: [{ id: 'C-1', counterpartyId: 'CP-1', company: 'Approved customer' }],
    client_objects: [{ id: 'CO-1', clientId: 'C-1', counterpartyId: 'CP-1', name: 'Site' }],
    ...overrides,
  };
  const insert = db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)');
  for (const name of COLLECTIONS) insert.run(name, JSON.stringify(state[name]));
  return state;
}

function identityConfig(db) {
  const config = {
    configVersion: 1,
    company: {
      id: COMPANY_ID,
      displayName: 'Owner-approved Company A',
      receivablesTimezone: 'Europe/Moscow',
    },
    branches: [{
      id: 'branch-approved-head-office',
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
        branchIds: ['branch-approved-head-office'],
        capabilityAssignments: [],
      },
      {
        id: 'membership-u-finance',
        principalId: 'U-finance',
        status: 'active',
        roleTemplateKey: 'approved-operator',
        roleTemplateVersion: 1,
        companyWideBranchAuthority: false,
        branchIds: ['branch-approved-head-office'],
        capabilityAssignments: [],
      },
    ],
    intentionallyUnmappedUserIds: [],
    approval: {
      approvedBy: 'U-admin',
      approvedAt: '2026-08-25T00:00:00.000Z',
      approvalReference: 'owner-approved-remediation-test',
      backupReference: 'verified-backup-test',
    },
  };
  config.approval.schemaFingerprint = getSchemaFingerprint(db);
  config.approval.configChecksum = calculateBootstrapChecksum(db, config);
  return config;
}

function scopedState(state) {
  return Object.fromEntries(COLLECTIONS.map(name => [name, state[name].map(record => ({
    ...record,
    companyId: COMPANY_ID,
    tenantId: COMPANY_ID,
  }))]));
}

function resolvedPlan(context, state) {
  const scoped = scopedState(state);
  const users = context.readUsers();
  return {
    planVersion: 1,
    planId: 'production-scope-remediation-test-v1',
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
        ...Object.fromEntries(COLLECTIONS.map(name => [name, state[name].length])),
        users: users.length,
      },
      collectionFingerprints: {
        ...Object.fromEntries(COLLECTIONS.map(name => [name, [
          collectionFingerprint(state[name]),
          collectionFingerprint(scoped[name]),
        ]])),
        users: [collectionFingerprint(users)],
      },
    },
    authority: {
      status: 'APPROVED',
      companyId: COMPANY_ID,
      tenantId: COMPANY_ID,
      identityBootstrap: identityConfig(context.db),
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
      evidence: 'owner-approved stable-ID chain',
    })),
    relationMappings: [],
    backup: {
      verified: true,
      reference: 'test-backup-reference',
      sourceDbIdentity: `schema:${getSchemaFingerprint(context.db)}`,
      timestamp: '2026-08-25T00:00:00.000Z',
      sizeBytes: 4096,
      sha256: 'a'.repeat(64),
    },
  };
}

function allIdentityRows(db) {
  const tables = [
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
  return Object.fromEntries(tables.map(table => [
    table,
    db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  ]));
}

function appDataRows(db) {
  return db.prepare('SELECT name, json, updated_at FROM app_data ORDER BY name').all();
}

test('dry-run exposes exact explicit diff and performs zero writes', () => {
  const context = createPlatformIdentityContext();
  try {
    const state = seedCollections(context.db);
    const plan = resolvedPlan(context, state);
    const before = sqliteTotalChanges(context.db);
    const preview = planProductionScopeRemediation({ db: context.db, plan });

    assert.equal(preview.ok, true);
    assert.equal(preview.writes, 0);
    assert.equal(sqliteTotalChanges(context.db), before);
    assert.deepEqual(preview.plannedDiff.CREATE.map(item => item.type), [
      'Company',
      'Branch',
      'RoleTemplate',
      'Membership',
      'Membership',
    ]);
    assert.equal(preview.plannedDiff.UPDATE.length, 4);
    assert.equal(preview.plannedDiff.RELINK.length, 0);
    assert.equal(preview.plannedDiff.UNRESOLVED.length, 0);
    assert.deepEqual(preview.expectedPostState, {
      companies: 1,
      memberships: 2,
      scopedCounterparties: 1,
      scopedRoleAssignments: 1,
      scopedClients: 1,
      scopedClientObjects: 1,
      orphanCount: 0,
      scopeAnomalyCount: 0,
    });
  } finally {
    context.close();
  }
});

test('successful explicit backfill is transactional and repeated execution makes zero writes', () => {
  const context = createPlatformIdentityContext();
  try {
    const state = seedCollections(context.db);
    const plan = resolvedPlan(context, state);
    const preview = planProductionScopeRemediation({ db: context.db, plan });
    const first = applyProductionScopeRemediation({
      db: context.db,
      plan,
      explicitApply: true,
      expectedPlanChecksum: preview.planChecksum,
    });

    assert.equal(first.status, 'succeeded');
    assert.equal(first.collectionWrites, 4);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_companies').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM company_memberships').get().count, 2);
    for (const name of COLLECTIONS) {
      const rows = JSON.parse(context.db.prepare('SELECT json FROM app_data WHERE name = ?').get(name).json);
      assert.equal(rows.every(row => row.companyId === COMPANY_ID && row.tenantId === COMPANY_ID), true);
    }

    const repeatedPreview = planProductionScopeRemediation({ db: context.db, plan });
    assert.equal(repeatedPreview.readyToApply, true);
    assert.deepEqual(repeatedPreview.plannedDiff.CREATE, []);
    assert.deepEqual(repeatedPreview.plannedDiff.UPDATE, []);
    const beforeRepeat = sqliteTotalChanges(context.db);
    const repeated = applyProductionScopeRemediation({
      db: context.db,
      plan,
      explicitApply: true,
      expectedPlanChecksum: repeatedPreview.planChecksum,
    });
    assert.equal(repeated.status, 'noop');
    assert.equal(repeated.writes, 0);
    assert.equal(repeated.collectionWrites, 0);
    assert.equal(sqliteTotalChanges(context.db), beforeRepeat);
  } finally {
    context.close();
  }
});

test('an unscoped legacy record without explicit mapping aborts without writes', () => {
  const context = createPlatformIdentityContext();
  try {
    const state = seedCollections(context.db, {
      client_objects: [
        { id: 'CO-1', clientId: 'C-1', counterpartyId: 'CP-1' },
        { id: 'CO-UNMAPPED', clientId: 'C-1', counterpartyId: 'CP-1' },
      ],
    });
    const plan = resolvedPlan(context, state);
    plan.recordMappings = plan.recordMappings.filter(item => item.id !== 'CO-UNMAPPED');
    const beforeData = appDataRows(context.db);
    const beforeIdentity = allIdentityRows(context.db);
    const preview = planProductionScopeRemediation({ db: context.db, plan });

    assert.equal(preview.readyToApply, false);
    assert.equal(preview.blockers.some(item => (
      item.code === 'UNMAPPED_LEGACY_RECORD'
      && item.record === 'client_objects:CO-UNMAPPED'
    )), true);
    assert.throws(() => applyProductionScopeRemediation({
      db: context.db,
      plan,
      explicitApply: true,
      expectedPlanChecksum: preview.planChecksum,
    }), error => error.code === 'REMEDIATION_BLOCKED');
    assert.deepEqual(appDataRows(context.db), beforeData);
    assert.deepEqual(allIdentityRows(context.db), beforeIdentity);
  } finally {
    context.close();
  }
});

test('approved canonical identity blocks a remediation plan carrying a different Company ID', () => {
  const context = createPlatformIdentityContext();
  try {
    const state = seedCollections(context.db);
    const plan = resolvedPlan(context, state);
    const identity = { jurisdiction: 'RU', registry: 'INN', value: '1660217548' };
    const derived = deriveCanonicalCompanyId(identity);
    plan.canonicalCompanyIdStrategy = {
      status: 'APPROVED',
      identity,
      canonicalIdentityKey: derived.canonicalIdentityKey,
      sha256Hex: derived.sha256Hex,
      base32Digest: derived.base32Digest,
      companyId: derived.companyId,
      tenantId: derived.companyId,
    };
    const before = sqliteTotalChanges(context.db);

    const preview = planProductionScopeRemediation({ db: context.db, plan });

    assert.equal(preview.readyToApply, false);
    assert.equal(preview.writes, 0);
    assert.equal(sqliteTotalChanges(context.db), before);
    assert.equal(preview.blockers.some(blocker => (
      blocker.code === 'CANONICAL_COMPANY_ID_MISMATCH'
      && blocker.expectedCompanyId === derived.companyId
    )), true);
    assert.deepEqual(preview.plannedDiff.CREATE, []);
    assert.deepEqual(preview.plannedDiff.UPDATE, []);
  } finally {
    context.close();
  }
});

test('unexpected collection drift and partial scope conflict abort fail-closed', async t => {
  await t.test('fingerprint drift', () => {
    const context = createPlatformIdentityContext();
    try {
      const state = seedCollections(context.db);
      const plan = resolvedPlan(context, state);
      const changed = structuredClone(state.clients);
      changed[0].company = 'Changed after approval';
      context.db.prepare("UPDATE app_data SET json = ? WHERE name = 'clients'").run(JSON.stringify(changed));
      const preview = planProductionScopeRemediation({ db: context.db, plan });
      assert.equal(preview.readyToApply, false);
      assert.equal(preview.blockers.some(item => item.code === 'UNEXPECTED_COLLECTION_FINGERPRINT'), true);
    } finally {
      context.close();
    }
  });

  await t.test('partial scope conflict', () => {
    const context = createPlatformIdentityContext();
    try {
      const state = seedCollections(context.db, {
        counterparties: [{ id: 'CP-1', companyId: COMPANY_ID }],
      });
      const plan = resolvedPlan(context, state);
      const preview = planProductionScopeRemediation({ db: context.db, plan });
      assert.equal(preview.readyToApply, false);
      assert.equal(preview.blockers.some(item => item.code === 'RECORD_SCOPE_CONFLICT'), true);
    } finally {
      context.close();
    }
  });
});

test('failure after identity and master-data writes rolls the whole remediation back', () => {
  const context = createPlatformIdentityContext();
  try {
    const state = seedCollections(context.db);
    const plan = resolvedPlan(context, state);
    const preview = planProductionScopeRemediation({ db: context.db, plan });
    const beforeData = appDataRows(context.db);
    const beforeIdentity = allIdentityRows(context.db);

    assert.throws(() => applyProductionScopeRemediation({
      db: context.db,
      plan,
      explicitApply: true,
      expectedPlanChecksum: preview.planChecksum,
      afterWrites() {
        throw new Error('forced-remediation-failure');
      },
    }), /forced-remediation-failure/);

    assert.deepEqual(appDataRows(context.db), beforeData);
    assert.deepEqual(allIdentityRows(context.db), beforeIdentity);
    assert.equal(context.db.inTransaction, false);
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);
  } finally {
    context.close();
  }
});

test('unproven authority, actors, records and relation produce a zero-diff blocked plan', () => {
  const context = createPlatformIdentityContext();
  try {
    const state = seedCollections(context.db);
    const users = context.readUsers();
    const plan = {
      planVersion: 1,
      planId: 'blocked-production-plan-test',
      expected: {
        dbIdentity: databaseIdentity(context.db),
        identityCounts: {
          canonical_companies: [0],
          canonical_branches: [0],
          company_memberships: [0],
          membership_branch_access: [0],
          role_templates: [0],
          role_template_capabilities: [0],
          membership_capability_assignments: [0],
          authorization_audit_events: [0],
          identity_bootstrap_runs: [0],
        },
        collectionCounts: {
          ...Object.fromEntries(COLLECTIONS.map(name => [name, state[name].length])),
          users: users.length,
        },
        collectionFingerprints: {
          ...Object.fromEntries(COLLECTIONS.map(name => [name, [collectionFingerprint(state[name])]])),
          users: [collectionFingerprint(users)],
        },
      },
      authority: { status: 'UNRESOLVED', reason: 'CANONICAL_COMPANY_NOT_PROVEN' },
      actorMappings: users.map(user => ({
        userId: user.id,
        action: 'UNRESOLVED',
        reason: 'COMPANY_MEMBERSHIP_NOT_PROVEN',
      })),
      recordMappings: [
        ['counterparties', 'CP-1'],
        ['counterparty_role_assignments', 'CPRA-1'],
        ['clients', 'C-1'],
        ['client_objects', 'CO-1'],
      ].map(([collection, id]) => ({
        collection,
        id,
        action: 'UNRESOLVED',
        reason: 'OWNERSHIP_NOT_PROVEN',
      })),
      relationMappings: [{
        collection: 'client_objects',
        id: 'CO-1',
        field: 'clientId',
        action: 'UNRESOLVED',
        reason: 'RELINK_NOT_PROVEN',
      }],
      backup: { verified: false },
    };
    const before = sqliteTotalChanges(context.db);
    const preview = planProductionScopeRemediation({ db: context.db, plan });
    assert.equal(preview.readyToApply, false);
    assert.equal(sqliteTotalChanges(context.db), before);
    assert.deepEqual(preview.plannedDiff.CREATE, []);
    assert.deepEqual(preview.plannedDiff.UPDATE, []);
    assert.deepEqual(preview.plannedDiff.RELINK, []);
    assert.equal(preview.plannedDiff.UNRESOLVED.length, 8);
    assert.deepEqual(preview.expectedPostState, preview.observed.metrics);
  } finally {
    context.close();
  }
});

test('explicit smoke/service exclusions remain unscoped without becoming wildcard backfill candidates', () => {
  const context = createPlatformIdentityContext({
    users: [
      { id: 'U-admin', status: 'Активен', role: 'Администратор', name: 'Admin' },
      { id: 'U-finance', status: 'Активен', role: 'Офис-менеджер', name: 'Finance' },
      { id: 'U-smoke', status: 'Активен', role: 'Администратор', name: 'Smoke' },
    ],
  });
  try {
    const state = seedCollections(context.db, {
      counterparties: [
        { id: 'CP-1', legalName: 'Approved customer' },
        { id: 'CP-smoke', legalName: 'Smoke fixture' },
      ],
    });
    const plan = resolvedPlan(context, state);
    plan.authority.identityBootstrap.intentionallyUnmappedUserIds = ['U-smoke'];
    plan.authority.identityBootstrap.approval.configChecksum = calculateBootstrapChecksum(
      context.db,
      plan.authority.identityBootstrap,
    );
    plan.actorMappings.push({
      userId: 'U-smoke',
      action: 'NO_MEMBERSHIP',
      candidateForProductionMembership: false,
      actorType: 'smoke/test',
    });
    plan.recordMappings.push({
      collection: 'counterparties',
      id: 'CP-smoke',
      action: 'LEAVE_UNSCOPED',
      classification: 'SMOKE_TEST_FIXTURE',
    });
    const scoped = scopedState(state);
    scoped.counterparties[1] = state.counterparties[1];
    plan.expected.collectionFingerprints.counterparties = [
      collectionFingerprint(state.counterparties),
      collectionFingerprint(scoped.counterparties),
    ];
    const preview = planProductionScopeRemediation({ db: context.db, plan });
    assert.equal(preview.readyToApply, true);
    assert.deepEqual(preview.plannedDiff.UPDATE.map(item => `${item.collection}:${item.id}`), [
      'counterparties:CP-1',
      'counterparty_role_assignments:CPRA-1',
      'clients:C-1',
      'client_objects:CO-1',
    ]);
    assert.equal(preview.plannedDiff.UPDATE.some(item => item.id === 'CP-smoke'), false);
  } finally {
    context.close();
  }
});
