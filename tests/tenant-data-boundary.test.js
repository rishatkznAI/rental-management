import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import {
  createPlatformIdentityContext,
  seedAuthority,
  testActor,
} from './platform-identity-fixtures.js';

const require = createRequire(import.meta.url);
const {
  JSON_COLLECTIONS,
  cloneCollectionIfMissing,
  migrateJsonFilesToDb,
  resetAppData,
} = require('../server/db.js');
const {
  DERIVED_SCOPE_COLLECTIONS,
  GLOBAL_REFERENCE_COLLECTIONS,
  LEGACY_HISTORY_COLLECTIONS,
  SYSTEM_GLOBAL_COLLECTIONS,
  TENANT_OWNED_ARRAY_COLLECTIONS,
  TENANT_OWNED_MAP_COLLECTIONS,
  TENANT_OWNED_SINGLETON_COLLECTIONS,
  createBoundPlatformSystemScopeRunner,
  createTenantDataBoundary,
  currentTenantContext,
  runWithDeniedTenantScope,
  runWithPlatformSystemScope,
  runWithTenantActorScope,
  runWithTenantHistoryRepositoryScope,
} = require('../server/lib/tenant-data-boundary.js');
const {
  COLLECTION_SCOPE_REGISTRY,
  COLLECTION_SCOPE_CATEGORY,
  DERIVED_PARENT_RULES,
  PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS,
} = require('../server/lib/app-data-scope-registry.js');
const {
  COLLECTION_DYNAMIC_RELATION_FIELDS,
  COLLECTION_EXTERNAL_ID_FIELDS,
  COLLECTION_RELATION_FIELDS,
  COLLECTION_RELATION_SENTINELS,
  assertTenantRelationships,
} = require('../server/lib/tenant-relationship-guard.js');
const { REFERENCE_REGISTRY } = require('../server/lib/client-master-data-lifecycle.js');
const { buildClientInnDuplicateReport, assertClientInnUnique } = require('../server/lib/client-inn.js');
const {
  applyEquipmentGsmConfigurationProjection,
} = require('../server/lib/gsm/trusted-device-scope.js');

const SCOPE_A = Object.freeze({ companyId: 'COMPANY-A', tenantId: 'COMPANY-A' });
const SCOPE_B = Object.freeze({ companyId: 'COMPANY-B', tenantId: 'COMPANY-B' });

function scoped(scope, value) {
  return { ...value, companyId: scope.companyId, tenantId: scope.tenantId };
}

function canonicalGsmDevice(scope, { id, equipmentId, deviceId }) {
  return scoped(scope, {
    id,
    equipmentId,
    deviceId,
    imei: null,
    trackerId: null,
    sim1: null,
    protocol: null,
    status: 'unknown',
    bindingRevision: 1,
    bindingHistory: [{
      revision: 1,
      equipmentId,
      companyId: scope.companyId,
      tenantId: scope.tenantId,
      imei: null,
      deviceId,
      linkedAt: '2026-08-30T10:00:00.000Z',
      unlinkedAt: null,
      reason: 'test_fixture',
    }],
  });
}

function createBoundaryContext() {
  const context = createPlatformIdentityContext({
    users: [
      { id: 'U-admin', name: 'Platform bootstrap actor', email: 'platform@example.test', role: 'Администратор', status: 'Активен' },
      { id: 'U-A', name: 'Admin A', email: 'a@example.test', role: 'Администратор', status: 'Активен' },
      { id: 'U-B', name: 'Admin B', email: 'b@example.test', role: 'Администратор', status: 'Активен' },
      { id: 'U-NO-MEMBERSHIP', name: 'No company', email: 'none@example.test', role: 'Администратор', status: 'Активен' },
    ],
  });
  for (const [companyId, principalId] of [['COMPANY-A', 'U-A'], ['COMPANY-B', 'U-B']]) {
    seedAuthority(context, {
      companyId,
      branches: [{ id: `BRANCH-${companyId}`, displayName: `Head ${companyId}`, isHeadOffice: true }],
      templateKey: `TEMPLATE-${companyId}`,
      templateCapabilities: [],
    });
    context.repository.createMembership({
      id: `MEMBERSHIP-${companyId}`,
      companyId,
      principalId,
      status: 'active',
      roleTemplateKey: `TEMPLATE-${companyId}`,
      roleTemplateVersion: 1,
      companyWideBranchAuthority: true,
      branchIds: [],
      actorContext: testActor(),
      reason: 'tenant-data-boundary-test',
    });
  }

  const state = {
    users: context.readUsers(),
    bot_sessions: { preauth: { scenario: 'login_email' } },
  };
  const writes = [];
  let failNextBatch = false;
  const readRawData = name => state[name] ?? null;
  const writeRawData = (name, value) => {
    state[name] = structuredClone(value);
    writes.push({ name, value: structuredClone(value) });
  };
  const writeRawDataBatch = entries => {
    if (failNextBatch) {
      failNextBatch = false;
      const error = new Error('injected atomic batch failure');
      error.code = 'INJECTED_BATCH_FAILURE';
      throw error;
    }
    const staged = structuredClone(state);
    for (const entry of entries) staged[entry.name] = structuredClone(entry.value);
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, staged);
    for (const entry of entries) writes.push({ name: entry.name, value: structuredClone(entry.value) });
  };
  const boundary = createTenantDataBoundary({
    db: context.db,
    readRawData,
    writeRawData,
    writeRawDataBatch,
    assertRelationships: assertTenantRelationships,
  });
  return {
    ...context,
    boundary,
    state,
    writes,
    failNextBatch() { failNextBatch = true; },
  };
}

test('every app_data collection has one explicit tenant classification', () => {
  const classified = Object.keys(COLLECTION_SCOPE_REGISTRY);
  assert.equal(classified.length, 76);
  assert.equal(new Set(classified).size, classified.length, 'classifications must not overlap');
  assert.deepEqual([...new Set(JSON_COLLECTIONS)].sort(), classified.sort());
  for (const [name, policy] of Object.entries(COLLECTION_SCOPE_REGISTRY)) {
    assert.ok(policy.category, `${name}: category`);
    assert.ok(policy.shape, `${name}: shape`);
    assert.ok(policy.readPolicy, `${name}: read policy`);
    assert.ok(policy.writeAuthority, `${name}: write authority`);
    assert.ok(policy.mutationPolicy, `${name}: mutation policy`);
    if (policy.category === COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE) {
      assert.ok(Array.isArray(policy.parentResolver) && policy.parentResolver.length > 0, `${name}: parent resolver`);
    }
  }
  assert.equal(COLLECTION_SCOPE_REGISTRY.payroll_audit_events.mutationPolicy, 'APPEND_ONLY');
  for (const collection of LEGACY_HISTORY_COLLECTIONS) {
    assert.equal(COLLECTION_SCOPE_REGISTRY[collection].mutationPolicy, 'APPEND_ONLY', collection);
  }
  for (const collection of ['inline_relation_idempotency', 'rental_create_idempotency']) {
    assert.equal(COLLECTION_SCOPE_REGISTRY[collection].mutationPolicy, 'IMMUTABLE', collection);
  }
  for (const collection of DERIVED_SCOPE_COLLECTIONS) {
    const resolver = COLLECTION_SCOPE_REGISTRY[collection].parentResolver;
    assert.equal(Object.isFrozen(resolver), true, `${collection}: frozen parent resolver`);
    for (const rule of resolver) {
      assert.equal(Object.isFrozen(rule), true, `${collection}: frozen parent rule`);
      assert.equal(Object.isFrozen(rule.fields), true, `${collection}: frozen parent fields`);
      assert.equal(Object.isFrozen(rule.collections), true, `${collection}: frozen parent collections`);
    }
  }
});

test('every derived resolver has immutable, registered, array-shaped authoritative parents', () => {
  assert.deepEqual(Object.keys(DERIVED_PARENT_RULES).sort(), [...DERIVED_SCOPE_COLLECTIONS].sort());
  for (const [collection, rules] of Object.entries(DERIVED_PARENT_RULES)) {
    assert.ok(rules.length > 0, collection);
    for (const rule of rules) {
      assert.ok(rule.fields.length > 0, `${collection}: fields`);
      assert.equal(new Set(rule.fields).size, rule.fields.length, `${collection}: unique fields`);
      assert.ok(rule.collections.length > 0, `${collection}: collections`);
      assert.equal(new Set(rule.collections).size, rule.collections.length, `${collection}: unique collections`);
      for (const parentName of rule.collections) {
        const parent = COLLECTION_SCOPE_REGISTRY[parentName];
        assert.ok(parent, `${collection}: registered parent ${parentName}`);
        assert.equal(parent.shape, 'ARRAY', `${collection}: array parent ${parentName}`);
        assert.ok(
          parent.category === COLLECTION_SCOPE_CATEGORY.TENANT
          || parent.category === COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE
          || (parentName === 'users' && parent.category === COLLECTION_SCOPE_CATEGORY.SYSTEM),
          `${collection}: authoritative parent category ${parentName}`,
        );
      }
    }
  }
});

test('every dynamic lifecycle collection read is explicitly classified', () => {
  const referenced = [...new Set(REFERENCE_REGISTRY.map(entry => entry.collection))];
  for (const collection of referenced) {
    assert.ok(
      COLLECTION_SCOPE_REGISTRY[collection],
      `${collection}: dynamic lifecycle read must fail closed through an explicit policy`,
    );
  }
});

test('raw legacy import and collection cloning require the audited remediation runner', () => {
  for (const operation of [migrateJsonFilesToDb, cloneCollectionIfMissing, resetAppData]) {
    assert.throws(
      () => operation('target', 'source'),
      error => error?.code === 'AUDITED_MAINTENANCE_RUNNER_REQUIRED',
    );
  }
});

test('every literal server app_data access names a classified collection', () => {
  const serverDir = path.resolve(process.cwd(), 'server');
  const sourceFiles = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (/\.(?:js|cjs)$/.test(entry.name)) sourceFiles.push(target);
    }
  };
  visit(serverDir);
  const accessPattern = /\b(?:readData|writeData|getData|setData|cloneCollectionIfMissing)\(\s*['"]([^'"]+)['"]/g;
  const unknown = [];
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = accessPattern.exec(source))) {
      if (!COLLECTION_SCOPE_REGISTRY[match[1]]) unknown.push(`${path.relative(serverDir, file)}:${match[1]}`);
    }
  }
  assert.deepEqual(unknown, []);
});

test('direct tenant and tenant-technical arrays enforce list/create/update/delete centrally', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());

  const derived = new Set(DERIVED_SCOPE_COLLECTIONS);
  for (const collection of TENANT_OWNED_ARRAY_COLLECTIONS.filter(name => (
    !derived.has(name)
    && COLLECTION_SCOPE_REGISTRY[name].category !== COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY
    && COLLECTION_SCOPE_REGISTRY[name].writeAuthority !== 'PLATFORM_REMEDIATION_ONLY'
  ))) {
    context.state[collection] = [
      scoped(SCOPE_A, { id: `${collection}-A`, marker: 'A' }),
      scoped(SCOPE_B, { id: `${collection}-B`, marker: 'B' }),
      { id: `${collection}-LEGACY`, marker: 'legacy' },
    ];

    runWithTenantActorScope(SCOPE_A, () => {
      assert.deepEqual(context.boundary.readData(collection).map(item => item.marker), ['A'], `${collection}: list`);
      context.boundary.writeData(collection, [
        { ...context.boundary.readData(collection)[0], marker: 'A-updated' },
        { id: `${collection}-A-new`, marker: 'A-created' },
      ]);
    });

    assert.deepEqual(
      context.state[collection].map(item => item.marker),
      ['B', 'legacy', 'A-updated', 'A-created'],
      `${collection}: update/create must preserve Company B and legacy rows`,
    );
    assert.ok(context.state[collection]
      .filter(item => item.marker.startsWith('A-'))
      .every(item => item.companyId === 'COMPANY-A' && item.tenantId === 'COMPANY-A'));

    runWithTenantActorScope(SCOPE_A, () => {
      context.boundary.writeData(collection, []);
    });
    assert.deepEqual(
      context.state[collection].map(item => item.marker),
      ['B', 'legacy'],
      `${collection}: delete must affect only Company A`,
    );
  }
});

test('legacy JSON idempotency rows are immutable hidden tombstones', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  for (const collection of ['inline_relation_idempotency', 'rental_create_idempotency']) {
    context.state[collection] = [{ id: `${collection}-legacy`, key: 'reserved-key' }];
    assert.deepEqual(runWithTenantActorScope(SCOPE_A, () => context.boundary.readData(collection)), []);
    assert.throws(
      () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData(collection, [])),
      error => error?.code === 'LEGACY_IDEMPOTENCY_STORAGE_IMMUTABLE',
    );
    assert.equal(
      runWithPlatformSystemScope({ reason: 'legacy-idempotency-audit' }, () => context.boundary.readData(collection)).length,
      1,
    );
  }
});

test('payload spoofing, cross-tenant ID collisions and denied scope fail closed', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.equipment = [scoped(SCOPE_B, { id: 'EQ-B' }), { id: 'EQ-LEGACY' }];

  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('equipment', [
      { id: 'EQ-A', companyId: 'COMPANY-B', tenantId: 'COMPANY-B' },
    ])),
    error => error?.code === 'TENANT_SCOPE_SPOOFING_DENIED',
  );
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('equipment', [{ id: 'EQ-B' }])),
    error => error?.code === 'TENANT_RECORD_ID_COLLISION',
  );
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('equipment', [{ id: 'EQ-LEGACY' }])),
    error => error?.code === 'TENANT_RECORD_ID_COLLISION',
  );
  runWithDeniedTenantScope(() => {
    assert.deepEqual(context.boundary.readData('equipment'), []);
    assert.deepEqual(context.boundary.readData('users'), []);
    assert.throws(
      () => context.boundary.readData('unknown_legacy_collection'),
      error => error?.code === 'TENANT_COLLECTION_UNCLASSIFIED',
    );
    assert.throws(
      () => context.boundary.writeData('equipment', []),
      error => error?.code === 'ACTOR_SCOPE_INCOMPLETE',
    );
  });
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('unknown_legacy_collection', [])),
    error => error?.code === 'TENANT_COLLECTION_UNCLASSIFIED',
  );
  assert.throws(
    () => context.boundary.readData('equipment'),
    error => error?.code === 'DATA_ACCESS_CONTEXT_REQUIRED',
  );
  assert.throws(
    () => runWithTenantActorScope({ companyId: 'COMPANY-A', tenantId: 'COMPANY-B' }, () => {}),
    error => error?.code === 'ACTOR_SCOPE_INCOMPLETE',
  );
});

test('tenant map and singleton storage isolate both companies without overwriting peers', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.bot_users = {
    a: scoped(SCOPE_A, { userId: 'U-A' }),
    b: scoped(SCOPE_B, { userId: 'U-B' }),
  };
  context.state.snapshot = { legacyGlobalSnapshot: { generatedAt: 'legacy' } };

  runWithTenantActorScope(SCOPE_A, () => {
    assert.deepEqual(Object.keys(context.boundary.readData('bot_users')), ['a']);
    context.boundary.writeData('bot_users', { a2: { userId: 'U-A' } });
    context.boundary.writeData('snapshot', { generatedAt: 'A' });
  });
  runWithTenantActorScope(SCOPE_B, () => {
    assert.deepEqual(Object.keys(context.boundary.readData('bot_users')), ['b']);
    assert.equal(context.boundary.readData('snapshot'), null);
    context.boundary.writeData('snapshot', { generatedAt: 'B' });
  });
  runWithTenantActorScope(SCOPE_A, () => {
    assert.deepEqual(context.boundary.readData('snapshot'), { generatedAt: 'A' });
  });
  runWithTenantActorScope(SCOPE_B, () => {
    assert.deepEqual(context.boundary.readData('snapshot'), { generatedAt: 'B' });
  });
  assert.deepEqual(Object.keys(context.state.bot_users).sort(), ['a2', 'b']);
  assert.deepEqual(context.state.snapshot.legacyGlobalSnapshot, { generatedAt: 'legacy' });
});

test('bot user maps enforce exact-tenant user relationships for tenant and platform writers', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.counterparties = [
    scoped(SCOPE_A, { id: 'CP-A' }),
    scoped(SCOPE_B, { id: 'CP-B' }),
  ];
  context.state.delivery_carriers = [
    scoped(SCOPE_A, { id: 'CARRIER-A', counterpartyId: 'CP-A' }),
    scoped(SCOPE_B, { id: 'CARRIER-B', counterpartyId: 'CP-B' }),
  ];
  context.state.bot_users = {
    b: scoped(SCOPE_B, { userId: 'U-B' }),
  };
  context.state.audit_logs = [];

  for (const [field, id] of [
    ['userId', 'U-B'],
    ['systemUserId', 'U-B'],
    ['carrierId', 'CARRIER-B'],
    ['assignedCarrierId', 'CARRIER-B'],
    ['carrierKey', 'CARRIER-B'],
  ]) {
    const beforeTenantWrite = structuredClone(context.state);
    assert.throws(
      () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('bot_users', {
        crossTenant: { [field]: id },
      })),
      error => error?.code === 'CROSS_TENANT_RELATION_DENIED',
      `bot_users.${field}`,
    );
    assert.deepEqual(context.state, beforeTenantWrite, `bot_users.${field}`);
  }

  const beforePlatformWrite = structuredClone(context.state);
  assert.throws(
    () => runWithPlatformSystemScope({
      reason: 'platform-bot-user-relation-test',
      writableCollections: ['bot_users'],
    }, () => context.boundary.writeData('bot_users', {
      ...context.state.bot_users,
      crossTenant: scoped(SCOPE_A, { userId: 'U-B' }),
    })),
    error => error?.code === 'CROSS_TENANT_RELATION_DENIED',
  );
  assert.deepEqual(context.state, beforePlatformWrite);

  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('bot_users', {
    ownUser: {
      userId: 'U-A',
      systemUserId: 'U-A',
      carrierId: 'CARRIER-A',
      assignedCarrierId: 'CARRIER-A',
      carrierKey: 'CARRIER-A',
    },
  }));
  assert.equal(context.state.bot_users.ownUser.userId, 'U-A');
  assert.equal(context.state.bot_users.b.userId, 'U-B');
});

test('malformed stored collection shapes are fail-closed and never normalized by a write', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.equipment = { corrupt: true };
  const beforeEquipment = structuredClone(context.state.equipment);

  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.readData('equipment')),
    error => error?.code === 'COLLECTION_STORED_SHAPE_INVALID',
  );
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('equipment', [])),
    error => error?.code === 'COLLECTION_STORED_SHAPE_INVALID',
  );
  assert.deepEqual(context.state.equipment, beforeEquipment);

  context.state.audit_logs = { corrupt: true };
  const beforeAudit = structuredClone(context.state.audit_logs);
  assert.throws(
    () => runWithTenantHistoryRepositoryScope({
      scope: SCOPE_A,
      reason: 'corrupt-audit-test',
      writableCollections: ['audit_logs'],
    }, () => context.boundary.writeData('audit_logs', [{ id: 'AUD-new' }])),
    error => error?.code === 'COLLECTION_STORED_SHAPE_INVALID',
  );
  assert.deepEqual(context.state.audit_logs, beforeAudit);

  for (const malformedEnvelope of [
    ['legacy-or-corrupt-payload'],
    { 'COMPANY-A': null },
    { 'COMPANY-A': { companyId: 'COMPANY-A', tenantId: 'COMPANY-B', value: {} } },
    { 'COMPANY-A': { companyId: 'COMPANY-A', tenantId: 'COMPANY-A', value: [] } },
  ]) {
    context.state.snapshot = {
      __tenantScopedValues: malformedEnvelope,
      legacyGlobalSnapshot: { mustSurvive: true },
    };
    const beforeSnapshot = structuredClone(context.state.snapshot);
    assert.throws(
      () => runWithTenantActorScope(SCOPE_A, () => context.boundary.readData('snapshot')),
      error => error?.code === 'COLLECTION_STORED_SHAPE_INVALID',
    );
    assert.throws(
      () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('snapshot', { generatedAt: 'A' })),
      error => error?.code === 'COLLECTION_STORED_SHAPE_INVALID',
    );
    assert.deepEqual(context.state.snapshot, beforeSnapshot);
  }
});

test('batch preflight uses the persistence preparation path without writing', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.equipment = [scoped(SCOPE_A, { id: 'EQ-A', name: 'Before' })];
  const beforeState = structuredClone(context.state);
  const beforeWrites = context.writes.length;

  const preview = runWithTenantActorScope(SCOPE_A, () => context.boundary.preflightDataBatch([
    { name: 'equipment', value: [{ id: 'EQ-A', name: 'After' }] },
  ]));

  assert.equal(preview.ok, true);
  assert.deepEqual(preview.collections, ['equipment', 'audit_logs']);
  assert.deepEqual(context.state, beforeState);
  assert.equal(context.writes.length, beforeWrites);

  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeDataBatch([
    { name: 'equipment', value: [{ id: 'EQ-A', name: 'After' }] },
  ]));
  assert.equal(context.state.equipment.find(item => item.id === 'EQ-A').name, 'After');
  assert.equal(context.state.audit_logs.at(-1).action, 'app_data.mutation');
});

test('tenant and platform batches reject duplicate collection entries before any write or journal mutation', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.equipment = [scoped(SCOPE_A, { id: 'EQ-A', name: 'Before' })];
  context.state.service_works = [{ id: 'WORK-BEFORE', name: 'Before' }];
  context.state.audit_logs = [];

  const assertRejectedWithoutMutation = operation => {
    const beforeState = structuredClone(context.state);
    const beforeWrites = context.writes.length;
    assert.throws(operation, error => (
      error?.code === 'DUPLICATE_COLLECTION_BATCH_ENTRY'
      && Boolean(error?.details?.collection)
    ));
    assert.deepEqual(context.state, beforeState);
    assert.equal(context.writes.length, beforeWrites);
  };

  const tenantEntries = [
    { name: 'equipment', value: [{ id: 'EQ-A', name: 'First' }] },
    { name: 'equipment', value: [{ id: 'EQ-A', name: 'Second' }] },
  ];
  assertRejectedWithoutMutation(() => runWithTenantActorScope(
    SCOPE_A,
    () => context.boundary.preflightDataBatch(tenantEntries),
  ));
  assertRejectedWithoutMutation(() => runWithTenantActorScope(
    SCOPE_A,
    () => context.boundary.writeDataBatch(tenantEntries),
  ));

  const platformEntries = [
    { name: 'service_works', value: [{ id: 'WORK-1', name: 'First' }] },
    { name: 'service_works', value: [{ id: 'WORK-2', name: 'Second' }] },
  ];
  const platformOperation = callback => runWithPlatformSystemScope({
    reason: 'duplicate-collection-test',
    writableCollections: ['service_works'],
  }, callback);
  assertRejectedWithoutMutation(() => platformOperation(
    () => context.boundary.preflightDataBatch(platformEntries),
  ));
  assertRejectedWithoutMutation(() => platformOperation(
    () => context.boundary.writeDataBatch(platformEntries),
  ));
});

test('batch preflight and apply reject the same append-only, parent, relation, and stored-root violations', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.payroll_periods = [scoped(SCOPE_A, { id: 'PERIOD-A' })];
  context.state.payroll_audit_events = [scoped(SCOPE_A, {
    id: 'PAY-AUDIT-A',
    payrollPeriodId: 'PERIOD-A',
    action: 'period.calculate',
  })];
  const gsmDeviceA = canonicalGsmDevice(SCOPE_A, {
    id: 'GDEV-A', equipmentId: 'EQ-A', deviceId: 'DEVICE-A',
  });
  const gsmDeviceB = canonicalGsmDevice(SCOPE_B, {
    id: 'GDEV-B', equipmentId: 'EQ-B', deviceId: 'DEVICE-B',
  });
  context.state.equipment = [
    applyEquipmentGsmConfigurationProjection(scoped(SCOPE_A, { id: 'EQ-A' }), gsmDeviceA),
    applyEquipmentGsmConfigurationProjection(scoped(SCOPE_B, { id: 'EQ-B' }), gsmDeviceB),
  ];
  context.state.gsm_devices = [gsmDeviceA, gsmDeviceB];
  context.state.gsm_packets = [];
  context.state.gsm_commands = [];
  context.state.equipment_downtimes = [];
  context.state.clients = [scoped(SCOPE_B, { id: 'CLIENT-B' })];
  context.state.rentals = [];

  const assertParity = (entries, expectedCode) => {
    const before = structuredClone(context.state);
    let preflightError;
    let applyError;
    try {
      runWithTenantActorScope(SCOPE_A, () => context.boundary.preflightDataBatch(entries));
    } catch (error) {
      preflightError = error;
    }
    try {
      runWithTenantActorScope(SCOPE_A, () => context.boundary.writeDataBatch(entries));
    } catch (error) {
      applyError = error;
    }
    assert.equal(preflightError?.code, expectedCode);
    assert.equal(applyError?.code, expectedCode);
    assert.equal(preflightError?.status, applyError?.status);
    assert.deepEqual(context.state, before);
  };

  assertParity([{
    name: 'payroll_audit_events',
    value: [
      scoped(SCOPE_A, { id: 'PAY-AUDIT-A', payrollPeriodId: 'PERIOD-A', action: 'period.calculate' }),
      { id: 'PAY-AUDIT-MISSING', payrollPeriodId: 'PERIOD-MISSING', action: 'period.approved' },
    ],
  }], 'DERIVED_SCOPE_PARENT_UNAVAILABLE');

  assertParity([{
    name: 'payroll_audit_events',
    value: [{ id: 'PAY-AUDIT-A', payrollPeriodId: 'PERIOD-A', action: 'forged.rewrite' }],
  }], 'TENANT_APPEND_ONLY_COLLECTION_MUTATION');

  assertParity([{
    name: 'equipment_downtimes',
    value: [{ id: 'DOWN-A', equipmentId: 'EQ-B', startAt: '2026-08-26T00:00:00.000Z' }],
  }], 'DERIVED_SCOPE_PARENT_UNAVAILABLE');

  assertParity([{
    name: 'rentals',
    value: [{ id: 'RENTAL-A', clientId: 'CLIENT-B' }],
  }], 'CROSS_TENANT_RELATION_DENIED');

  assertParity([{
    name: 'equipment',
    value: [{ id: 'EQ-SPOOF', companyId: 'COMPANY-B', tenantId: 'COMPANY-B' }],
  }], 'TENANT_SCOPE_SPOOFING_DENIED');

  context.state.snapshot = {
    __tenantScopedValues: {
      'COMPANY-A': { companyId: 'COMPANY-A', tenantId: 'COMPANY-B', value: {} },
    },
  };
  assertParity([{
    name: 'snapshot',
    value: { generatedAt: '2026-08-26T00:00:00.000Z' },
  }], 'COLLECTION_STORED_SHAPE_INVALID');
});

test('tenant history repository cannot switch scope and preserves outer read concurrency checks', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.equipment = [scoped(SCOPE_A, { id: 'EQ-A', name: 'Original' })];

  runWithTenantActorScope(SCOPE_A, () => {
    context.boundary.readData('equipment');
    assert.throws(
      () => runWithTenantHistoryRepositoryScope({
        scope: SCOPE_B,
        reason: 'cross-scope-attempt',
        writableCollections: ['audit_logs'],
      }, () => {}),
      error => error?.code === 'CROSS_TENANT_HISTORY_SCOPE_DENIED',
    );

    context.state.equipment = [
      ...context.state.equipment,
      scoped(SCOPE_A, { id: 'EQ-A-CONCURRENT', name: 'Concurrent' }),
    ];
    assert.throws(
      () => runWithTenantHistoryRepositoryScope({
        scope: SCOPE_A,
        reason: 'semantic-audit-test',
        writableCollections: ['audit_logs'],
      }, () => context.boundary.writeDataBatch([
        { name: 'equipment', value: [{ id: 'EQ-A', name: 'Stale overwrite' }] },
        { name: 'audit_logs', value: [{ id: 'AUD-A', action: 'equipment.update' }] },
      ])),
      error => error?.code === 'TENANT_COLLECTION_CONCURRENT_MODIFICATION',
    );
  });
  assert.equal(context.state.equipment.some(item => item.id === 'EQ-A-CONCURRENT'), true);
  assert.equal((context.state.audit_logs || []).some(item => item.id === 'AUD-A'), false);
});

test('user directory is membership-projected and generic writes cannot create, delete or cross-mutate identities', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());

  runWithTenantActorScope(SCOPE_A, () => {
    assert.deepEqual(context.boundary.readData('users').map(user => user.id), ['U-A']);
    context.boundary.writeData('users', [{ ...context.boundary.readData('users')[0], name: 'Admin A updated' }]);
    assert.throws(
      () => context.boundary.writeData('users', []),
      error => error?.code === 'USER_MEMBERSHIP_WORKFLOW_REQUIRED',
    );
    assert.throws(
      () => context.boundary.writeData('users', [context.boundary.readData('users')[0], { id: 'U-B' }]),
      error => error?.code === 'USER_MEMBERSHIP_WORKFLOW_REQUIRED',
    );
  });
  assert.equal(context.state.users.find(user => user.id === 'U-A').name, 'Admin A updated');
  assert.equal(context.state.users.find(user => user.id === 'U-B').name, 'Admin B');
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.readData('bot_sessions')),
    error => error?.code === 'SYSTEM_COLLECTION_POLICY_REQUIRED',
  );
  assert.equal(runWithPlatformSystemScope({ reason: 'bot-session-test' }, () => (
    context.boundary.readData('bot_sessions').preauth.scenario
  )), 'login_email');
});

test('relationship guard rejects cross-company scalar, array, nested, dynamic and user references', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.counterparties = [
    scoped(SCOPE_A, { id: 'CP-A' }),
    scoped(SCOPE_B, { id: 'CP-B' }),
  ];
  context.state.equipment = [
    scoped(SCOPE_A, { id: 'EQ-A' }),
    scoped(SCOPE_B, { id: 'EQ-B' }),
  ];
  context.state.owners = [scoped(SCOPE_A, { id: 'OWNER-A' })];
  context.state.clients = [];

  const rejected = [
    { id: 'C-1', counterpartyId: 'CP-B' },
    { id: 'C-2', counterpartyId: 'CP-A', equipmentIds: ['EQ-B'] },
    { id: 'C-3', counterpartyId: 'CP-A', equipment: [{ equipmentId: 'EQ-B' }] },
    { id: 'C-4', counterpartyId: 'CP-A', relatedEntityType: 'counterparty', relatedEntityId: 'CP-B' },
    { id: 'C-5', counterpartyId: 'CP-A', managerId: 'U-B' },
    { id: 'C-6', counterpartyId: 'CP-A', supplierCounterpartyId: 'CP-B' },
    { id: 'C-7', counterpartyId: 'CP-A', counterpartyIds: ['CP-B'] },
    { id: 'C-8', counterpartyId: 'CP-A', assignedToUserId: 'U-B' },
    { id: 'C-9', counterpartyId: 'CP-A', ownerId: 'U-A' },
    { id: 'C-10', counterpartyId: 'CP-A', ownerIds: ['U-A'] },
  ];
  for (const record of rejected) {
    assert.throws(
      () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('clients', [record])),
      error => [
        'CROSS_TENANT_RELATION_DENIED',
        'DERIVED_SCOPE_PARENT_UNAVAILABLE',
        'TENANT_RELATION_TARGET_REQUIRED',
      ].includes(error?.code),
    );
  }
  context.state.documents = [];
  const beforeResponsibleWrite = structuredClone(context.state);
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('documents', [{
      id: 'DOC-CROSS-RESPONSIBLE',
      responsibleId: 'U-B',
    }])),
    error => error?.code === 'CROSS_TENANT_RELATION_DENIED',
  );
  assert.deepEqual(context.state, beforeResponsibleWrite);
  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('clients', [{
    id: 'C-A',
    counterpartyId: 'CP-A',
    equipmentIds: ['EQ-A'],
    managerId: 'U-A',
    ownerId: 'OWNER-A',
  }]));
  assert.equal(context.state.clients.at(-1).companyId, 'COMPANY-A');

  context.state.rentals = [];
  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('rentals', [{
    id: 'R-INVENTORY-LABEL',
    equipmentId: 'EQ-A',
    equipment: ['INV-A'],
  }]));
  assert.deepEqual(context.state.rentals[0].equipment, ['INV-A']);
});

test('collection-aware relation fields reject every reviewed cross-tenant stable ID without treating MAX IDs as users', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.counterparties = [
    scoped(SCOPE_A, { id: 'CP-A' }),
    scoped(SCOPE_B, { id: 'CP-B' }),
  ];
  const gsmDeviceA = canonicalGsmDevice(SCOPE_A, {
    id: 'GDEV-A', equipmentId: 'EQ-A', deviceId: 'DEVICE-A',
  });
  const gsmDeviceB = canonicalGsmDevice(SCOPE_B, {
    id: 'GDEV-B', equipmentId: 'EQ-B', deviceId: 'DEVICE-B',
  });
  context.state.equipment = [
    applyEquipmentGsmConfigurationProjection(scoped(SCOPE_A, { id: 'EQ-A' }), gsmDeviceA),
    applyEquipmentGsmConfigurationProjection(scoped(SCOPE_B, { id: 'EQ-B' }), gsmDeviceB),
  ];
  context.state.gsm_devices = [gsmDeviceA, gsmDeviceB];
  context.state.rentals = [
    scoped(SCOPE_A, { id: 'R-A' }),
    scoped(SCOPE_B, { id: 'R-B' }),
  ];
  context.state.gantt_rentals = [
    scoped(SCOPE_A, { id: 'GR-A', rentalId: 'R-A' }),
    scoped(SCOPE_B, { id: 'GR-B', rentalId: 'R-B' }),
  ];
  context.state.service = [
    scoped(SCOPE_A, { id: 'S-A' }),
    scoped(SCOPE_B, { id: 'S-B' }),
  ];
  context.state.service_vehicles = [
    scoped(SCOPE_A, { id: 'VEH-A' }),
    scoped(SCOPE_B, { id: 'VEH-B' }),
  ];
  context.state.service_route_norms = [
    scoped(SCOPE_A, { id: 'NORM-A' }),
    scoped(SCOPE_B, { id: 'NORM-B' }),
  ];
  context.state.service_works = [
    scoped(SCOPE_A, { id: 'WORK-A' }),
    scoped(SCOPE_B, { id: 'WORK-B' }),
  ];
  context.state.spare_parts = [
    scoped(SCOPE_A, { id: 'PART-A' }),
    scoped(SCOPE_B, { id: 'PART-B' }),
  ];
  context.state.owners = [
    scoped(SCOPE_A, { id: 'OWNER-A' }),
    scoped(SCOPE_B, { id: 'OWNER-B' }),
  ];
  context.state.delivery_carriers = [
    scoped(SCOPE_A, { id: 'CARRIER-A', counterpartyId: 'CP-A' }),
    scoped(SCOPE_B, { id: 'CARRIER-B', counterpartyId: 'CP-B' }),
  ];
  context.state.equipment_operation_sessions = [
    scoped(SCOPE_B, { id: 'OPS-B', equipmentId: 'EQ-B' }),
  ];
  context.state.vehicle_trips = [
    scoped(SCOPE_B, { id: 'TRIP-B', vehicleId: 'VEH-B' }),
  ];
  context.state.crm_deals = [scoped(SCOPE_B, { id: 'DEAL-B' })];
  context.state.clients = [
    scoped(SCOPE_A, {
      id: 'CLIENT-A',
      counterpartyId: 'CP-A',
      contacts: [{ id: 'CONTACT-A', name: 'Contact A' }],
    }),
    scoped(SCOPE_B, {
      id: 'CLIENT-B',
      counterpartyId: 'CP-B',
      contacts: [{ id: 'CONTACT-B', name: 'Contact B' }],
    }),
  ];
  context.state.client_contracts = [
    scoped(SCOPE_B, { id: 'CONTRACT-B', clientId: 'CLIENT-B' }),
  ];
  for (const collection of [
    'shipping_photos',
    'rental_change_requests',
    'service_field_trips',
    'documents',
    'crm_activities',
    'counterparty_role_assignments',
    'manager_activity',
  ]) context.state[collection] = [];
  context.state.documents = [
    scoped(SCOPE_A, { id: 'DOC-A' }),
    scoped(SCOPE_B, { id: 'DOC-B' }),
  ];

  const reviewed = [
    ['shipping_photos', 'operationSessionId', 'OPS-B', { equipmentId: 'EQ-A' }],
    ['rental_change_requests', 'requestedBy', 'U-B', { rentalId: 'R-A' }],
    ['rental_change_requests', 'requestedById', 'U-B', { rentalId: 'R-A' }],
    ['rental_change_requests', 'initiatorId', 'U-B', { rentalId: 'R-A' }],
    ['rental_change_requests', 'decidedById', 'U-B', { rentalId: 'R-A' }],
    ['rental_change_requests', 'createdBy', 'U-B', { rentalId: 'R-A' }],
    ['rentals', 'creditRiskAcknowledgedByUserId', 'U-B', {}],
    ['rentals', 'creditRiskApprovedByUserId', 'U-B', {}],
    ['rentals', 'createdById', 'U-B', {}],
    ['rentals', 'updatedById', 'U-B', {}],
    ['rentals', 'equipmentItemId', 'EQ-B', {}],
    ['gantt_rentals', 'creditRiskAcknowledgedByUserId', 'U-B', {}],
    ['gantt_rentals', 'creditRiskApprovedByUserId', 'U-B', {}],
    ['gantt_rentals', 'createdById', 'U-B', {}],
    ['gantt_rentals', 'updatedById', 'U-B', {}],
    ['gantt_rentals', 'equipmentItemId', 'EQ-B', {}],
    ['gantt_rentals', 'entityId', 'R-B', {}],
    ['gantt_rentals', 'approvalEntityId', 'GR-B', {}],
    ['clients', 'openingReceivableCreatedByUserId', 'U-B', { counterpartyId: 'CP-A' }],
    ['clients', 'openingReceivableUpdatedByUserId', 'U-B', { counterpartyId: 'CP-A' }],
    ['service', 'serviceVehicleId', 'VEH-B', {}],
    ['service', 'revisionReturnedBy', 'U-B', {}],
    ['service', 'revisionResolvedBy', 'U-B', {}],
    ['service', 'assignedToId', 'U-B', {}],
    ['service', 'machineId', 'EQ-B', {}],
    ['service', 'counterparty_id', 'CP-B', {}],
    ['service', 'rental_id', 'R-B', {}],
    ['service_field_trips', 'serviceVehicleId', 'VEH-B', { serviceTicketId: 'S-A' }],
    ['service_field_trips', 'routeNormId', 'NORM-B', { serviceTicketId: 'S-A' }],
    ['documents', 'responsibleId', 'U-B', {}],
    ['documents', 'vehicleTripId', 'TRIP-B', {}],
    ['documents', 'parentId', 'DOC-B', {}],
    ['documents', 'specId', 'DOC-B', {}],
    ['documents', 'rental', 'R-B', {}],
    ['documents', 'serviceTicket', 'S-B', {}],
    ['payments', 'rental', 'R-B', { counterpartyId: 'CP-A' }],
    ['payments', 'document', 'DOC-B', { counterpartyId: 'CP-A' }],
    ['repair_work_items', 'ticketId', 'S-B', { repairId: 'S-A' }],
    ['repair_work_items', 'catalogId', 'WORK-B', { repairId: 'S-A' }],
    ['repair_part_items', 'ticketId', 'S-B', { repairId: 'S-A' }],
    ['repair_part_items', 'catalogId', 'PART-B', { repairId: 'S-A' }],
    ['vehicle_trips', 'serviceRequestId', 'S-B', { vehicleId: 'VEH-A' }],
    ['crm_activities', 'dealId', 'DEAL-B', {}],
    ['crm_activities', 'contactId', 'CONTACT-B', { clientId: 'CLIENT-A' }],
    ['crm_activities', 'createdBy', 'U-B', {}],
    ['crm_activities', 'updatedBy', 'U-B', {}],
    ['crm_activities', 'deletedBy', 'U-B', {}],
    ['counterparty_role_assignments', 'createdBy', 'U-B', {
      counterpartyId: 'CP-A', roleCode: 'customer', status: 'active',
    }],
    ['counterparty_role_assignments', 'deactivatedBy', 'U-B', {
      counterpartyId: 'CP-A', roleCode: 'customer', status: 'inactive',
    }],
    ['manager_activity', 'createdBy', 'U-B', {}],
    ['delivery_carriers', 'system_user_id', 'U-B', { counterpartyId: 'CP-A' }],
    ['deliveries', 'carrierKey', 'CARRIER-B', {}],
    ['deliveries', 'machineId', 'EQ-B', {}],
    ['gsm_packets', 'gsmDeviceRecordId', 'GDEV-B', { equipmentId: 'EQ-A', gsmBindingRevision: 1 }],
    ['gsm_commands', 'gsmDeviceRecordId', 'GDEV-B', { equipmentId: 'EQ-A', gsmBindingRevision: 1 }],
    ['bot_notifications', 'recipientId', 'U-B', { status: 'pending' }],
  ];

  const declared = [
    ...reviewed.map(([collection, field]) => `${collection}.${field}`),
    'users.ownerId',
    'users.carrierId',
    'users.assignedCarrierId',
    'users.carrierKey',
    'bot_users.userId',
    'bot_users.carrierId',
    'bot_users.assignedCarrierId',
    'bot_users.carrierKey',
    'bot_users.systemUserId',
    'delivery_carriers.systemUserId',
    'bot_notifications.userId',
  ].sort();
  const registry = Object.entries(COLLECTION_RELATION_FIELDS)
    .flatMap(([collection, fields]) => Object.keys(fields).map(field => `${collection}.${field}`))
    .sort();
  assert.deepEqual(registry, declared);

  for (const [collection, field, foreignId, base] of reviewed) {
    if (context.state[collection] === undefined) context.state[collection] = [];
    const before = structuredClone(context.state);
    let rejection;
    try {
      runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData(collection, [{
        id: `${collection}-${field}-A`,
        ...base,
        [field]: foreignId,
      }]));
    } catch (error) {
      rejection = error;
    }
    assert.ok(
      rejection?.code === 'CROSS_TENANT_RELATION_DENIED'
        || (
          rejection?.code === 'DERIVED_SCOPE_PARENT_UNAVAILABLE'
          && (
            field === 'ticketId'
            || (collection === 'payments' && ['rental', 'document'].includes(field))
            || ['gsm_packets', 'gsm_commands'].includes(collection)
          )
        )
        || (
          ['gsm_packets', 'gsm_commands'].includes(collection)
          && rejection?.code === 'GSM_DEVICE_EQUIPMENT_MISMATCH'
        ),
      `${collection}.${field}: ${rejection?.code || 'no rejection'}`,
    );
    assert.deepEqual(context.state, before, `${collection}.${field}`);
  }

  for (const [field, foreignId] of [
    ['customerId', 'CLIENT-B'],
    ['client_id', 'CLIENT-B'],
    ['equipment_id', 'EQ-B'],
    ['manager_id', 'U-B'],
    ['responsibleManagerId', 'U-B'],
    ['owner_id', 'OWNER-B'],
    ['createdById', 'U-B'],
  ]) {
    const before = structuredClone(context.state);
    assert.throws(
      () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('documents', [{
        id: `DOCUMENT-ALIAS-${field}`,
        [field]: foreignId,
      }])),
      error => error?.code === 'CROSS_TENANT_RELATION_DENIED',
      `documents.${field}`,
    );
    assert.deepEqual(context.state, before, `documents.${field}`);
  }

  for (const field of ['contractIds', 'clientContractIds']) {
    const before = structuredClone(context.state);
    assert.throws(
      () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('rentals', [{
        id: `RENTAL-${field}-A`,
        [field]: ['CONTRACT-B'],
      }])),
      error => error?.code === 'CROSS_TENANT_RELATION_DENIED',
      field,
    );
    assert.deepEqual(context.state, before, field);
  }

  const ownUser = runWithTenantActorScope(SCOPE_A, () => context.boundary.readData('users')[0]);
  for (const [field, foreignId] of [
    ['ownerId', 'OWNER-B'],
    ['carrierId', 'CARRIER-B'],
    ['assignedCarrierId', 'CARRIER-B'],
    ['carrierKey', 'CARRIER-B'],
  ]) {
    const before = structuredClone(context.state);
    assert.throws(
      () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('users', [{
        ...ownUser,
        [field]: foreignId,
      }])),
      error => error?.code === 'CROSS_TENANT_RELATION_DENIED',
      `users.${field}`,
    );
    assert.deepEqual(context.state, before, `users.${field}`);
  }

  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('users', [{
    ...ownUser,
    ownerId: 'OWNER-A',
    carrierId: 'CARRIER-A',
    assignedCarrierId: 'CARRIER-A',
    carrierKey: 'CARRIER-A',
  }]));
  assert.equal(
    runWithTenantActorScope(SCOPE_A, () => context.boundary.readData('users')[0].carrierId),
    'CARRIER-A',
  );

  for (const [label, mutate, expectedCode] of [
    ['platform-cross-tenant', users => users.map(user => (
      user.id === 'U-A' ? { ...user, carrierId: 'CARRIER-B' } : user
    )), 'CROSS_TENANT_RELATION_DENIED'],
    ['platform-no-membership', users => users.map(user => (
      user.id === 'U-NO-MEMBERSHIP' ? { ...user, ownerId: 'OWNER-A' } : user
    )), 'USER_TENANT_PROFILE_SCOPE_REQUIRED'],
  ]) {
    const before = structuredClone(context.state);
    assert.throws(
      () => runWithPlatformSystemScope({
        reason: `platform-user-profile-${label}`,
        writableCollections: ['users'],
      }, () => context.boundary.writeData('users', mutate(context.state.users))),
      error => error?.code === expectedCode,
      label,
    );
    assert.deepEqual(context.state, before, label);
  }

  assert.deepEqual(COLLECTION_EXTERNAL_ID_FIELDS.deliveries, ['carrierUserId']);
  assert.deepEqual(COLLECTION_EXTERNAL_ID_FIELDS.delivery_carriers, ['userId']);
  assert.deepEqual(COLLECTION_DYNAMIC_RELATION_FIELDS, { planner_items: ['rentalId'] });
  assert.deepEqual(COLLECTION_RELATION_SENTINELS.bot_notifications.userId, [{
    value: 'manager',
    status: 'skipped_no_manager',
    reason: 'no_responsible_manager',
  }]);
  assert.deepEqual(COLLECTION_RELATION_SENTINELS.counterparty_role_assignments, {
    createdBy: [
      { value: 'system:migration', source: 'stage_j_b_migration' },
      { value: 'system:import', source: 'system_data_import' },
    ],
    deactivatedBy: [{
      value: 'system',
      source: 'counterparty_archive',
      status: 'inactive',
      reason: 'counterparty_archived',
    }],
  });

  context.state.bot_notifications = [];
  const beforeCrossNotification = structuredClone(context.state);
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('bot_notifications', [{
      id: 'BOT-NOTIFICATION-CROSS',
      userId: 'U-B',
      status: 'pending',
    }])),
    error => error?.code === 'CROSS_TENANT_RELATION_DENIED',
  );
  assert.deepEqual(context.state, beforeCrossNotification);
  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('bot_notifications', [{
    id: 'BOT-NOTIFICATION-MISSING-MANAGER',
    userId: 'manager',
    status: 'skipped_no_manager',
    reason: 'no_responsible_manager',
  }]));
  const beforeSentinelDrift = structuredClone(context.state);
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('bot_notifications', [{
      ...context.boundary.readData('bot_notifications')[0],
      status: 'pending',
    }])),
    error => error?.code === 'TENANT_RELATION_TARGET_REQUIRED',
  );
  assert.deepEqual(context.state, beforeSentinelDrift);

  context.state.crm_activities = [];
  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('crm_activities', [{
    id: 'CRM-CONTACT-A',
    clientId: 'CLIENT-A',
    contactId: 'CONTACT-A',
  }]));
  const beforeContactOrphan = structuredClone(context.state);
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('clients', [{
      ...context.state.clients.find(client => client.id === 'CLIENT-A'),
      contacts: [],
    }])),
    error => error?.code === 'TENANT_PARENT_MUTATION_ORPHANS_CHILD',
  );
  assert.deepEqual(context.state, beforeContactOrphan);
  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeDataBatch([
    {
      name: 'clients',
      value: [{
        ...context.state.clients.find(client => client.id === 'CLIENT-A'),
        contacts: [],
      }],
    },
    { name: 'crm_activities', value: [] },
  ]));
  assert.equal(context.state.clients.find(client => client.id === 'CLIENT-A').contacts.length, 0);
  assert.equal(context.state.crm_activities.length, 0);

  context.state.deliveries = [];
  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('deliveries', [{
    id: 'DELIVERY-MAX-A',
    carrierUserId: 987654321,
  }]));
  assert.equal(context.state.deliveries[0].carrierUserId, 987654321);
});

test('planner source references resolve their encoded tenant namespace and preserve reverse integrity', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.rentals = [
    scoped(SCOPE_A, { id: 'R-A' }),
    scoped(SCOPE_B, { id: 'R-B' }),
  ];
  context.state.gantt_rentals = [
    scoped(SCOPE_A, { id: 'GR-A', rentalId: 'R-A' }),
    scoped(SCOPE_B, { id: 'GR-B', rentalId: 'R-B' }),
  ];
  context.state.service = [
    scoped(SCOPE_A, { id: 'S-A' }),
    scoped(SCOPE_B, { id: 'S-B' }),
  ];
  context.state.deliveries = [
    scoped(SCOPE_A, { id: 'D-A' }),
    scoped(SCOPE_B, { id: 'D-B' }),
  ];
  context.state.planner_items = [];

  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('planner_items', [
    { id: 'PI-R-A', rentalId: 'R-A', equipmentRef: 'EQ-B' },
    { id: 'PI-GR-A', rentalId: 'GR-A', equipmentRef: 'INV-GR-A' },
    { id: 'PI-S-A', rentalId: 'service:S-A', equipmentRef: 'INV-S-A' },
    { id: 'PI-D-A', rentalId: 'delivery:D-A', equipmentRef: 'INV-D-A' },
  ]));
  assert.deepEqual(
    context.state.planner_items.map(item => item.rentalId),
    ['R-A', 'GR-A', 'service:S-A', 'delivery:D-A'],
  );

  for (const [sourceId, expectedCode] of [
    ['R-B', 'CROSS_TENANT_RELATION_DENIED'],
    ['GR-B', 'CROSS_TENANT_RELATION_DENIED'],
    ['service:S-B', 'CROSS_TENANT_RELATION_DENIED'],
    ['delivery:D-B', 'CROSS_TENANT_RELATION_DENIED'],
    ['service:S-MISSING', 'TENANT_RELATION_TARGET_REQUIRED'],
    ['service:', 'TENANT_RELATION_TARGET_REQUIRED'],
    ['warranty:W-A', 'TENANT_RELATION_TYPE_UNCLASSIFIED'],
    [' service:S-A', 'TENANT_RELATION_TYPE_UNCLASSIFIED'],
  ]) {
    const before = structuredClone(context.state);
    assert.throws(
      () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData(
        'planner_items',
        context.boundary.readData('planner_items').map(item => (
          item.id === 'PI-R-A' ? { ...item, rentalId: sourceId } : item
        )),
      )),
      error => error?.code === expectedCode,
      sourceId,
    );
    assert.deepEqual(context.state, before, sourceId);
  }

  const beforeServiceDelete = structuredClone(context.state);
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('service', [])),
    error => error?.code === 'TENANT_PARENT_MUTATION_ORPHANS_CHILD',
  );
  assert.deepEqual(context.state, beforeServiceDelete);
  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeDataBatch([
    { name: 'service', value: [] },
    {
      name: 'planner_items',
      value: context.boundary.readData('planner_items').filter(item => item.id !== 'PI-S-A'),
    },
  ]));
  assert.equal(context.state.service.some(item => item.id === 'S-A'), false);
  assert.equal(context.state.planner_items.some(item => item.id === 'PI-S-A'), false);

  const beforeDeliveryDelete = structuredClone(context.state);
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('deliveries', [])),
    error => error?.code === 'TENANT_PARENT_MUTATION_ORPHANS_CHILD',
  );
  assert.deepEqual(context.state, beforeDeliveryDelete);

  context.state.planner_items = [scoped(SCOPE_A, {
    id: 'PI-LEGACY',
    rentalId: 'legacy:opaque',
    equipmentRef: 'LEGACY-REF',
  })];
  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('planner_items', [{
    ...context.boundary.readData('planner_items')[0],
    comment: 'unchanged legacy source retained',
  }]));
  assert.equal(context.state.planner_items[0].comment, 'unchanged legacy source retained');
  const beforeLegacyDrift = structuredClone(context.state);
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('planner_items', [{
      ...context.boundary.readData('planner_items')[0],
      rentalId: 'legacy:changed',
    }])),
    error => error?.code === 'TENANT_RELATION_TYPE_UNCLASSIFIED',
  );
  assert.deepEqual(context.state, beforeLegacyDrift);
});

test('Gantt canonical entity aliases are exact rental links with legacy and reverse-integrity protection', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.rentals = [
    scoped(SCOPE_A, { id: 'R-A' }),
    scoped(SCOPE_B, { id: 'R-B' }),
  ];
  context.state.gantt_rentals = [
    scoped(SCOPE_A, { id: 'GR-PARENT-A' }),
    scoped(SCOPE_A, {
      id: 'GR-CHILD-A',
      entityId: 'R-A',
      approvalEntityId: 'GR-PARENT-A',
    }),
    scoped(SCOPE_B, { id: 'GR-B' }),
  ];

  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData(
    'gantt_rentals',
    context.boundary.readData('gantt_rentals').map(item => (
      item.id === 'GR-CHILD-A' ? { ...item, note: 'valid aliases retained' } : item
    )),
  ));
  assert.equal(
    context.state.gantt_rentals.find(item => item.id === 'GR-CHILD-A').note,
    'valid aliases retained',
  );

  for (const [field, foreignId] of [
    ['entityId', 'R-B'],
    ['approvalEntityId', 'GR-B'],
  ]) {
    const before = structuredClone(context.state);
    assert.throws(
      () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData(
        'gantt_rentals',
        context.boundary.readData('gantt_rentals').map(item => (
          item.id === 'GR-CHILD-A' ? { ...item, [field]: foreignId } : item
        )),
      )),
      error => error?.code === 'CROSS_TENANT_RELATION_DENIED',
      field,
    );
    assert.deepEqual(context.state, before, field);
  }

  const beforeRentalDelete = structuredClone(context.state);
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('rentals', [])),
    error => error?.code === 'TENANT_PARENT_MUTATION_ORPHANS_CHILD',
  );
  assert.deepEqual(context.state, beforeRentalDelete);

  const beforeGanttParentDelete = structuredClone(context.state);
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData(
      'gantt_rentals',
      context.boundary.readData('gantt_rentals').filter(item => item.id !== 'GR-PARENT-A'),
    )),
    error => error?.code === 'TENANT_PARENT_MUTATION_ORPHANS_CHILD',
  );
  assert.deepEqual(context.state, beforeGanttParentDelete);

  context.state.gantt_rentals = [
    scoped(SCOPE_A, {
      id: 'GR-LEGACY',
      entityId: 'MISSING-RENTAL-LEGACY',
      approvalEntityId: 'MISSING-GANTT-LEGACY',
    }),
    scoped(SCOPE_B, { id: 'GR-B' }),
  ];
  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('gantt_rentals', [{
    ...context.boundary.readData('gantt_rentals')[0],
    note: 'legacy aliases retained',
  }]));
  assert.equal(
    context.state.gantt_rentals.find(item => item.id === 'GR-LEGACY').note,
    'legacy aliases retained',
  );
  const beforeLegacyDrift = structuredClone(context.state);
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('gantt_rentals', [{
      ...context.boundary.readData('gantt_rentals')[0],
      entityId: 'MISSING-RENTAL-CHANGED',
    }])),
    error => error?.code === 'TENANT_RELATION_TARGET_REQUIRED',
  );
  assert.deepEqual(context.state, beforeLegacyDrift);
});

test('actor relations allow only exact users, narrowly proven system sentinels, or unchanged legacy values', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.counterparties = [scoped(SCOPE_A, { id: 'CP-A' })];
  context.state.counterparty_role_assignments = [];

  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData(
    'counterparty_role_assignments',
    [
      {
        id: 'ROLE-MIGRATION',
        counterpartyId: 'CP-A',
        roleCode: 'customer',
        status: 'active',
        createdBy: 'system:migration',
        source: 'stage_j_b_migration',
      },
      {
        id: 'ROLE-IMPORT',
        counterpartyId: 'CP-A',
        roleCode: 'supplier',
        status: 'active',
        createdBy: 'system:import',
        source: 'system_data_import',
      },
      {
        id: 'ROLE-ARCHIVED',
        counterpartyId: 'CP-A',
        roleCode: 'contractor',
        status: 'inactive',
        createdBy: 'U-A',
        deactivatedBy: 'system',
        source: 'counterparty_archive',
        reason: 'counterparty_archived',
      },
    ],
  ));

  for (const mutate of [
    rows => rows.map(row => row.id === 'ROLE-MIGRATION' ? { ...row, source: 'role_api' } : row),
    rows => rows.map(row => row.id === 'ROLE-ARCHIVED' ? { ...row, reason: 'manual' } : row),
  ]) {
    const before = structuredClone(context.state);
    assert.throws(
      () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData(
        'counterparty_role_assignments',
        mutate(context.boundary.readData('counterparty_role_assignments')),
      )),
      error => error?.code === 'TENANT_RELATION_TARGET_REQUIRED',
    );
    assert.deepEqual(context.state, before);
  }

  context.state.counterparty_role_assignments.push(scoped(SCOPE_A, {
    id: 'ROLE-LEGACY-NAME',
    counterpartyId: 'CP-A',
    roleCode: 'customer',
    status: 'inactive',
    createdBy: 'Legacy Operator Name',
    source: 'legacy_projection',
    note: 'before',
  }));
  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData(
    'counterparty_role_assignments',
    context.boundary.readData('counterparty_role_assignments').map(row => (
      row.id === 'ROLE-LEGACY-NAME' ? { ...row, note: 'after' } : row
    )),
  ));
  assert.equal(
    context.state.counterparty_role_assignments.find(row => row.id === 'ROLE-LEGACY-NAME').note,
    'after',
  );
});

test('service revision-history actor links are slot-correlated and tenant-safe', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.service = [scoped(SCOPE_A, {
    id: 'SERVICE-LEGACY',
    note: 'before',
    revisionHistory: [{
      id: 'REVISION-LEGACY',
      createdBy: 'Legacy Operator Name',
      resolvedBy: 'Legacy Mechanic Name',
    }],
  })];

  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('service', [{
    ...context.boundary.readData('service')[0],
    note: 'after',
  }]));
  assert.equal(context.state.service[0].note, 'after');

  for (const revisionPatch of [
    { createdBy: 'U-B' },
    { resolvedBy: 'U-B' },
    { assignedMechanicId: 'U-B' },
    { id: 'REVISION-NEW-ID' },
  ]) {
    const before = structuredClone(context.state);
    assert.throws(
      () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('service', [{
        ...context.boundary.readData('service')[0],
        revisionHistory: [{
          ...context.boundary.readData('service')[0].revisionHistory[0],
          ...revisionPatch,
        }],
      }])),
      error => [
        'CROSS_TENANT_RELATION_DENIED',
        'TENANT_RELATION_TARGET_REQUIRED',
      ].includes(error?.code),
    );
    assert.deepEqual(context.state, before);
  }

  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('service', [{
    id: 'SERVICE-VALID',
    revisionReturnedBy: 'U-A',
    revisionResolvedBy: 'U-A',
    revisionHistory: [{
      id: 'REVISION-VALID',
      createdBy: 'U-A',
      resolvedBy: 'U-A',
      assignedMechanicId: 'U-A',
    }],
  }]));
  assert.equal(context.state.service[0].id, 'SERVICE-VALID');
});

test('nested document, receipt, and ticket-context user links are tenant-safe and preserve exact legacy slots', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());

  for (const [collection, record] of [
    ['documents', {
      id: 'DOCUMENT-CROSS-HISTORY',
      history: [{ id: 'DOC-EVENT-1', createdByUserId: 'U-B' }],
    }],
    ['equipment', {
      id: 'EQUIPMENT-CROSS-RECEIPT',
      receiptHistory: [{ date: '2026-08-28T08:00:00.000Z', userId: 'U-B' }],
    }],
    ['service', {
      id: 'SERVICE-CROSS-CONTEXT',
      ticketContext: { key: 'commercial_repair', selectedByUserId: 'U-B' },
    }],
  ]) {
    context.state[collection] = [];
    const before = structuredClone(context.state);
    assert.throws(
      () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData(collection, [record])),
      error => error?.code === 'CROSS_TENANT_RELATION_DENIED',
      collection,
    );
    assert.deepEqual(context.state, before, collection);
  }

  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeDataBatch([
    {
      name: 'documents',
      value: [{
        id: 'DOCUMENT-VALID-HISTORY',
        history: [{ id: 'DOC-EVENT-VALID', createdByUserId: 'U-A' }],
      }],
    },
    {
      name: 'equipment',
      value: [{
        id: 'EQUIPMENT-VALID-RECEIPT',
        receiptHistory: [{ date: '2026-08-28T09:00:00.000Z', userId: 'U-A' }],
      }],
    },
    {
      name: 'service',
      value: [{
        id: 'SERVICE-VALID-CONTEXT',
        ticketContext: { key: 'commercial_repair', selectedByUserId: 'U-A' },
      }],
    },
  ]));

  context.state.documents[0].history.push({
    id: 'DOC-EVENT-LEGACY',
    createdByUserId: 'Legacy Document Operator',
  });
  context.state.equipment[0].receiptHistory.push({
    date: '2026-08-28T10:00:00.000Z',
    userId: 'Legacy Receipt Operator',
  });
  context.state.service[0].ticketContext.selectedByUserId = 'Legacy Bot Operator';
  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeDataBatch([
    { name: 'documents', value: [{ ...context.boundary.readData('documents')[0], note: 'updated' }] },
    { name: 'equipment', value: [{ ...context.boundary.readData('equipment')[0], note: 'updated' }] },
    { name: 'service', value: [{ ...context.boundary.readData('service')[0], note: 'updated' }] },
  ]));
  assert.equal(context.state.documents[0].note, 'updated');
  assert.equal(context.state.equipment[0].note, 'updated');
  assert.equal(context.state.service[0].note, 'updated');

  const beforeSlotDrift = structuredClone(context.state);
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('documents', [{
      ...context.boundary.readData('documents')[0],
      history: context.boundary.readData('documents')[0].history.map(event => (
        event.id === 'DOC-EVENT-LEGACY' ? { ...event, id: 'DOC-EVENT-MOVED' } : event
      )),
    }])),
    error => error?.code === 'TENANT_RELATION_TARGET_REQUIRED',
  );
  assert.deepEqual(context.state, beforeSlotDrift);
});

test('rental downtime child links are slot-correlated and tenant-safe in Classic and Gantt projections', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.counterparties = [
    scoped(SCOPE_A, { id: 'CP-A' }),
    scoped(SCOPE_B, { id: 'CP-B' }),
  ];
  context.state.clients = [
    scoped(SCOPE_A, { id: 'CLIENT-A', counterpartyId: 'CP-A' }),
    scoped(SCOPE_B, { id: 'CLIENT-B', counterpartyId: 'CP-B' }),
  ];
  context.state.equipment = [
    scoped(SCOPE_A, { id: 'EQ-A' }),
    scoped(SCOPE_B, { id: 'EQ-B' }),
  ];
  context.state.rentals = [scoped(SCOPE_A, {
    id: 'R-A',
    clientId: 'CLIENT-A',
    equipmentId: 'EQ-A',
  }), scoped(SCOPE_B, {
    id: 'R-B',
    clientId: 'CLIENT-B',
    equipmentId: 'EQ-B',
  })];
  context.state.gantt_rentals = [scoped(SCOPE_A, {
    id: 'GR-A',
    rentalId: 'R-A',
    clientId: 'CLIENT-A',
    equipmentId: 'EQ-A',
  }), scoped(SCOPE_B, {
    id: 'GR-B',
    rentalId: 'R-B',
    clientId: 'CLIENT-B',
    equipmentId: 'EQ-B',
  })];

  const ownDowntime = {
    id: 'DOWNTIME-A',
    rentalId: 'R-A',
    ganttRentalId: 'GR-A',
    linkedGanttRentalId: 'GR-A',
    clientId: 'CLIENT-A',
    equipmentId: 'EQ-A',
  };
  for (const collection of ['rentals', 'gantt_rentals']) {
    for (const [field, foreignId] of [
      ['rentalId', 'R-B'],
      ['ganttRentalId', 'GR-B'],
      ['linkedGanttRentalId', 'GR-B'],
      ['clientId', 'CLIENT-B'],
      ['equipmentId', 'EQ-B'],
    ]) {
      const before = structuredClone(context.state);
      const ownRecord = runWithTenantActorScope(SCOPE_A, () => context.boundary.readData(collection)[0]);
      assert.throws(
        () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData(collection, [{
          ...ownRecord,
          downtimePeriods: [{ ...ownDowntime, [field]: foreignId }],
        }])),
        error => error?.code === 'CROSS_TENANT_RELATION_DENIED',
        `${collection}.downtimePeriods[].${field}`,
      );
      assert.deepEqual(context.state, before, `${collection}.downtimePeriods[].${field}`);
    }
  }

  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeDataBatch([
    {
      name: 'rentals',
      value: [{ ...context.boundary.readData('rentals')[0], downtimePeriods: [ownDowntime] }],
    },
    {
      name: 'gantt_rentals',
      value: [{ ...context.boundary.readData('gantt_rentals')[0], downtimePeriods: [ownDowntime] }],
    },
  ]));
  assert.equal(context.state.rentals.find(row => row.id === 'R-A').downtimePeriods[0].equipmentId, 'EQ-A');
  assert.equal(context.state.gantt_rentals.find(row => row.id === 'GR-A').downtimePeriods[0].clientId, 'CLIENT-A');

  context.state.rentals.find(row => row.id === 'R-A').downtimePeriods[0].equipmentId = 'LEGACY-EQUIPMENT';
  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('rentals', [{
    ...context.boundary.readData('rentals')[0],
    note: 'legacy-preserved',
  }]));
  assert.equal(context.state.rentals.find(row => row.id === 'R-A').note, 'legacy-preserved');
  const beforeLegacyDrift = structuredClone(context.state);
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('rentals', [{
      ...context.boundary.readData('rentals')[0],
      downtimePeriods: [{
        ...context.boundary.readData('rentals')[0].downtimePeriods[0],
        equipmentId: 'EQ-B',
      }],
    }])),
    error => error?.code === 'CROSS_TENANT_RELATION_DENIED',
  );
  assert.deepEqual(context.state, beforeLegacyDrift);
});

test('knowledge quiz correct options resolve exactly once inside their own question', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.knowledge_base_modules = [];

  const validModule = {
    id: 'KB-VALID',
    quiz: [
      {
        id: 'QUESTION-A',
        correctOptionId: 'OPTION-A-1',
        options: [{ id: 'OPTION-A-1' }, { id: 'OPTION-A-2' }],
      },
      {
        id: 'QUESTION-B',
        correctOptionId: 'OPTION-B-1',
        options: [{ id: 'OPTION-B-1' }, { id: 'OPTION-B-2' }],
      },
    ],
  };
  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData(
    'knowledge_base_modules',
    [validModule],
  ));

  for (const [label, mutate, expectedCode] of [
    ['another-question', module => ({
      ...module,
      quiz: module.quiz.map(question => question.id === 'QUESTION-A'
        ? { ...question, correctOptionId: 'OPTION-B-1' }
        : question),
    }), 'TENANT_LOCAL_RELATION_SCOPE_DENIED'],
    ['missing', module => ({
      ...module,
      quiz: module.quiz.map(question => question.id === 'QUESTION-A'
        ? { ...question, correctOptionId: 'OPTION-MISSING' }
        : question),
    }), 'TENANT_LOCAL_RELATION_TARGET_REQUIRED'],
    ['orphaned', module => ({
      ...module,
      quiz: module.quiz.map(question => question.id === 'QUESTION-A'
        ? { ...question, options: [{ id: 'OPTION-A-2' }] }
        : question),
    }), 'TENANT_PARENT_MUTATION_ORPHANS_CHILD'],
  ]) {
    const before = structuredClone(context.state);
    assert.throws(
      () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData(
        'knowledge_base_modules',
        [mutate(context.boundary.readData('knowledge_base_modules')[0])],
      )),
      error => error?.code === expectedCode,
      label,
    );
    assert.deepEqual(context.state, before, label);
  }

  context.state.knowledge_base_modules = [scoped(SCOPE_A, {
    id: 'KB-LEGACY',
    note: 'before',
    quiz: [{
      id: 'QUESTION-LEGACY',
      correctOptionId: 'OPTION-MISSING-LEGACY',
      options: [{ id: 'OPTION-LEGACY' }],
    }],
  })];
  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('knowledge_base_modules', [{
    ...context.boundary.readData('knowledge_base_modules')[0],
    note: 'after',
  }]));
  assert.equal(context.state.knowledge_base_modules[0].note, 'after');

  const beforeLegacyDrift = structuredClone(context.state);
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData(
      'knowledge_base_modules',
      [{
        ...context.boundary.readData('knowledge_base_modules')[0],
        quiz: [{
          ...context.boundary.readData('knowledge_base_modules')[0].quiz[0],
          id: 'QUESTION-LEGACY-MOVED',
        }],
      }],
    )),
    error => error?.code === 'TENANT_LOCAL_RELATION_TARGET_REQUIRED',
  );
  assert.deepEqual(context.state, beforeLegacyDrift);
});

test('new relations reject recursively invalid derived targets and leasing links across tenants', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.counterparties = [
    scoped(SCOPE_A, { id: 'CP-A' }),
    scoped(SCOPE_B, { id: 'CP-B' }),
  ];
  context.state.clients = [
    scoped(SCOPE_A, { id: 'C-ORPHAN', counterpartyId: 'CP-B' }),
  ];
  context.state.documents = [];
  assert.deepEqual(
    runWithTenantActorScope(SCOPE_A, () => context.boundary.readData('clients')),
    [],
  );
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('documents', [{
      id: 'DOC-ORPHAN-LINK',
      clientId: 'C-ORPHAN',
    }])),
    error => error?.code === 'CROSS_TENANT_RELATION_DENIED',
  );

  context.state.finance_accounts = [scoped(SCOPE_A, { id: 'ACC-A' })];
  context.state.leasing_contracts = [
    scoped(SCOPE_A, { id: 'LEASE-A' }),
    scoped(SCOPE_B, { id: 'LEASE-B' }),
  ];
  context.state.finance_operations = [];
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('finance_operations', [{
      id: 'FIN-A',
      accountId: 'ACC-A',
      relatedEntityType: 'leasing',
      relatedEntityId: 'LEASE-B',
    }])),
    error => error?.code === 'CROSS_TENANT_RELATION_DENIED',
  );
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('finance_operations', [{
      id: 'FIN-UNKNOWN-TYPE',
      accountId: 'ACC-A',
      relatedEntityType: 'leasnig',
      relatedEntityId: 'LEASE-A',
    }])),
    error => error?.code === 'TENANT_RELATION_TYPE_UNCLASSIFIED',
  );
  assert.doesNotThrow(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('finance_operations', [{
      id: 'FIN-EXTERNAL',
      accountId: 'ACC-A',
      relatedEntityType: 'other',
      relatedEntityId: 'EXTERNAL-REFERENCE',
    }])),
  );
});

test('mixed catalogues expose defaults plus exact-tenant rows and route writes by logical ID', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  assert.deepEqual(GLOBAL_REFERENCE_COLLECTIONS, []);
  for (const collection of PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS) {
    context.state[collection] = [
      { id: `${collection}-DEFAULT`, label: `${collection} platform default` },
      scoped(SCOPE_A, { id: `${collection}-A`, label: `${collection} A` }),
      scoped(SCOPE_B, { id: `${collection}-B`, label: `${collection} B` }),
    ];
    const forA = runWithTenantActorScope(SCOPE_A, () => context.boundary.readData(collection));
    const forB = runWithTenantActorScope(SCOPE_B, () => context.boundary.readData(collection));
    assert.deepEqual(
      forA.map(item => [item.id, item.catalogOrigin.kind]),
      [
        [`${collection}-DEFAULT`, 'platform_default'],
        [`${collection}-A`, 'tenant_entry'],
      ],
      collection,
    );
    assert.deepEqual(
      forB.map(item => [item.id, item.catalogOrigin.kind]),
      [
        [`${collection}-DEFAULT`, 'platform_default'],
        [`${collection}-B`, 'tenant_entry'],
      ],
      collection,
    );
  }

  const collection = 'service_works';
  runWithTenantActorScope(SCOPE_A, () => {
    const effective = context.boundary.readData(collection);
    context.boundary.writeData(collection, effective.map(record => (
      record.id === `${collection}-DEFAULT`
        ? { ...record, label: 'Company A override' }
        : record
    )));
  });
  const physicalOverride = context.state[collection].find(record => (
    record.companyId === SCOPE_A.companyId
    && record.platformDefaultId === `${collection}-DEFAULT`
  ));
  assert.ok(physicalOverride);
  assert.notEqual(physicalOverride.id, `${collection}-DEFAULT`);
  assert.equal(physicalOverride.companyId, SCOPE_A.companyId);
  assert.equal(physicalOverride.tenantId, SCOPE_A.tenantId);

  runWithTenantActorScope(SCOPE_A, () => {
    const logical = context.boundary.readData(collection)
      .find(record => record.id === `${collection}-DEFAULT`);
    assert.equal(logical.label, 'Company A override');
    assert.equal(logical.catalogOrigin.kind, 'tenant_override');
    assert.equal(logical.catalogOrigin.platformDefaultId, `${collection}-DEFAULT`);
    assert.equal(context.boundary.readData(collection).some(record => record.id === physicalOverride.id), false);
    assert.equal(
      context.boundary.readTenantPhysicalData(collection, physicalOverride.id).platformDefaultId,
      `${collection}-DEFAULT`,
    );
    assert.throws(
      () => context.boundary.readTenantPhysicalData(collection, `${collection}-DEFAULT`),
      error => error?.code === 'CATALOG_PLATFORM_DEFAULT_MUTATION_DENIED',
    );
    assert.throws(
      () => context.boundary.readTenantPhysicalData(collection, `${collection}-B`),
      error => error?.code === 'CATALOG_CROSS_TENANT_ACCESS_DENIED',
    );
  });
  assert.equal(
    runWithTenantActorScope(SCOPE_B, () => context.boundary.readData(collection))
      .find(record => record.id === `${collection}-DEFAULT`).label,
    `${collection} platform default`,
  );

  runWithPlatformSystemScope({
    reason: 'catalogue-platform-default-update-test',
    writableCollections: [collection],
  }, () => context.boundary.writeData(collection, [
    { id: `${collection}-DEFAULT`, label: 'Platform default v2' },
  ]));
  assert.equal(context.state[collection].some(record => record.id === physicalOverride.id), true);
  assert.equal(
    runWithTenantActorScope(SCOPE_A, () => context.boundary.readData(collection))
      .find(record => record.id === `${collection}-DEFAULT`).label,
    'Company A override',
  );
  assert.equal(
    runWithTenantActorScope(SCOPE_B, () => context.boundary.readData(collection))
      .find(record => record.id === `${collection}-DEFAULT`).label,
    'Platform default v2',
  );

  runWithTenantActorScope(SCOPE_A, () => {
    const withoutOverride = context.boundary.readData(collection)
      .filter(record => record.id !== `${collection}-DEFAULT`);
    context.boundary.writeData(collection, [
      ...withoutOverride,
      { id: `${collection}-A-NEW`, label: 'Company A standalone' },
    ]);
  });
  const fallback = runWithTenantActorScope(SCOPE_A, () => context.boundary.readData(collection));
  assert.equal(
    fallback.find(record => record.id === `${collection}-DEFAULT`).label,
    'Platform default v2',
  );
  const standalone = context.state[collection].find(record => record.id === `${collection}-A-NEW`);
  assert.equal(standalone.companyId, SCOPE_A.companyId);
  assert.equal(standalone.tenantId, SCOPE_A.tenantId);
  assert.equal(Object.hasOwn(standalone, 'platformDefaultId'), false);

  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData(collection, [
      { id: `${collection}-SPOOF`, companyId: SCOPE_B.companyId, tenantId: SCOPE_B.tenantId },
    ])),
    error => error?.code === 'CATALOG_CLIENT_RESERVED_FIELD_DENIED',
  );

  context.state[collection].push(
    scoped(SCOPE_A, {
      id: 'OVR-DUPLICATE-1',
      platformDefaultId: `${collection}-DEFAULT`,
      label: 'duplicate one',
    }),
    scoped(SCOPE_A, {
      id: 'OVR-DUPLICATE-2',
      platformDefaultId: `${collection}-DEFAULT`,
      label: 'duplicate two',
    }),
  );
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.readData(collection)),
    error => error?.code === 'CATALOG_ACTIVE_OVERRIDE_DUPLICATE',
  );

  runWithPlatformSystemScope({
    reason: 'catalogue-platform-scope-test',
    writableCollections: ['spare_parts'],
  }, () => assert.throws(
    () => context.boundary.writeData('spare_parts', [
      scoped(SCOPE_A, { id: 'PART-SCOPED' }),
    ]),
    error => error?.code === 'CATALOG_CLIENT_RESERVED_FIELD_DENIED',
  ));
});

test('mixed catalogue lifecycle methods expose logical records while keeping override physical IDs internal', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  const collection = 'service_works';
  context.state[collection] = [
    { id: 'WORK-DEFAULT', name: 'Platform work' },
    scoped(SCOPE_B, { id: 'WORK-B', name: 'Company B work' }),
  ];
  context.state.audit_logs = [];

  runWithTenantActorScope(SCOPE_A, () => {
    assert.throws(
      () => context.boundary.deleteEffectiveTenantCatalogRecord(collection, 'WORK-DEFAULT'),
      error => error?.code === 'CATALOG_PLATFORM_DEFAULT_MUTATION_DENIED',
    );
    assert.throws(
      () => context.boundary.archiveEffectiveTenantCatalogRecord(
        collection,
        'WORK-DEFAULT',
        { archivedAt: '2026-08-31T10:00:00.000Z' },
      ),
      error => error?.code === 'CATALOG_PLATFORM_DEFAULT_MUTATION_DENIED',
    );

    const created = context.boundary.createTenantCatalogEntry(collection, {
      name: 'Company A standalone',
    });
    assert.equal(created.catalogOrigin.kind, 'tenant_entry');
    assert.equal(Object.hasOwn(created, 'companyId'), false);
    assert.equal(Object.hasOwn(created, 'tenantId'), false);
    assert.equal(Object.hasOwn(created, 'platformDefaultId'), false);
    const createdRaw = context.state[collection].find(record => record.id === created.id);
    assert.equal(createdRaw.companyId, SCOPE_A.companyId);
    assert.equal(createdRaw.tenantId, SCOPE_A.tenantId);
    assert.equal(Object.hasOwn(createdRaw, 'platformDefaultId'), false);

    const updatedStandalone = context.boundary.updateEffectiveTenantCatalogRecord(
      collection,
      created.id,
      { name: 'Company A standalone v2' },
    );
    assert.equal(updatedStandalone.id, created.id);
    assert.equal(updatedStandalone.name, 'Company A standalone v2');
    assert.equal(updatedStandalone.catalogOrigin.kind, 'tenant_entry');

    const override = context.boundary.updateEffectiveTenantCatalogRecord(
      collection,
      'WORK-DEFAULT',
      { name: 'Company A override' },
    );
    assert.equal(override.id, 'WORK-DEFAULT');
    assert.equal(override.name, 'Company A override');
    assert.equal(override.catalogOrigin.kind, 'tenant_override');
    const physicalOverride = context.state[collection].find(record => (
      record.companyId === SCOPE_A.companyId
      && record.platformDefaultId === 'WORK-DEFAULT'
      && record.isActive !== false
    ));
    assert.ok(physicalOverride);
    assert.notEqual(physicalOverride.id, 'WORK-DEFAULT');
    assert.equal(override.id === physicalOverride.id, false);

    for (const operation of [
      () => context.boundary.updateEffectiveTenantCatalogRecord(
        collection,
        physicalOverride.id,
        { name: 'physical-id attack' },
      ),
      () => context.boundary.deleteEffectiveTenantCatalogRecord(collection, physicalOverride.id),
      () => context.boundary.archiveEffectiveTenantCatalogRecord(
        collection,
        physicalOverride.id,
        { archivedAt: '2026-08-31T10:01:00.000Z' },
      ),
    ]) {
      assert.throws(operation, error => error?.code === 'CATALOG_LOGICAL_RECORD_NOT_FOUND');
    }

    const fallbackAfterArchive = context.boundary.archiveEffectiveTenantCatalogRecord(
      collection,
      'WORK-DEFAULT',
      { archivedAt: '2026-08-31T10:02:00.000Z' },
    );
    assert.equal(fallbackAfterArchive.id, 'WORK-DEFAULT');
    assert.equal(fallbackAfterArchive.name, 'Platform work');
    assert.equal(fallbackAfterArchive.catalogOrigin.kind, 'platform_default');
    assert.equal(
      context.state[collection].find(record => record.id === physicalOverride.id).isActive,
      false,
    );

    context.boundary.updateEffectiveTenantCatalogRecord(
      collection,
      'WORK-DEFAULT',
      { name: 'Company A override two' },
    );
    const fallbackAfterDelete = context.boundary.deleteEffectiveTenantCatalogRecord(
      collection,
      'WORK-DEFAULT',
    );
    assert.equal(fallbackAfterDelete.catalogOrigin.kind, 'platform_default');
    assert.equal(fallbackAfterDelete.name, 'Platform work');

    context.boundary.updateEffectiveTenantCatalogRecord(
      collection,
      'WORK-DEFAULT',
      { name: 'Company A override three' },
    );
    const fallbackAfterExplicitRevert = context.boundary.revertTenantCatalogOverride(
      collection,
      'WORK-DEFAULT',
      { mode: 'delete' },
    );
    assert.equal(fallbackAfterExplicitRevert.catalogOrigin.kind, 'platform_default');
    assert.equal(fallbackAfterExplicitRevert.name, 'Platform work');

    const archivedStandalone = context.boundary.archiveEffectiveTenantCatalogRecord(
      collection,
      created.id,
      { archivedAt: '2026-08-31T10:03:00.000Z' },
    );
    assert.equal(archivedStandalone.catalogOrigin.kind, 'tenant_entry');
    assert.equal(archivedStandalone.isActive, false);
    assert.equal(
      context.state[collection].find(record => record.id === created.id).archivedAt,
      '2026-08-31T10:03:00.000Z',
    );

    const deletable = context.boundary.createTenantCatalogEntry(collection, {
      name: 'Delete me',
    });
    assert.equal(
      context.boundary.deleteEffectiveTenantCatalogRecord(collection, deletable.id),
      null,
    );
    assert.equal(context.state[collection].some(record => record.id === deletable.id), false);
  });

  assert.throws(
    () => runWithTenantActorScope(SCOPE_B, () => (
      context.boundary.updateEffectiveTenantCatalogRecord(
        collection,
        context.state[collection].find(record => (
          record.companyId === SCOPE_A.companyId && !record.platformDefaultId
        )).id,
        { name: 'Company B attack' },
      )
    )),
    error => error?.code === 'CATALOG_LOGICAL_RECORD_NOT_FOUND',
  );

  const beforeAtomicFailure = structuredClone(context.state);
  context.failNextBatch();
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => (
      context.boundary.createTenantCatalogEntry(collection, { name: 'Must roll back' })
    )),
    error => error?.code === 'INJECTED_BATCH_FAILURE',
  );
  assert.deepEqual(context.state, beforeAtomicFailure);

  runWithTenantActorScope(SCOPE_A, () => {
    context.boundary.readData(collection);
    context.state[collection] = [
      ...context.state[collection],
      scoped(SCOPE_B, { id: 'WORK-B-CONCURRENT', name: 'Concurrent foreign write' }),
    ];
    assert.throws(
      () => context.boundary.createTenantCatalogEntry(collection, { name: 'Stale write' }),
      error => error?.code === 'TENANT_COLLECTION_CONCURRENT_MODIFICATION',
    );
  });
});

test('relationship consumers resolve mixed catalogues by tenant-effective logical ID only', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.service = [
    scoped(SCOPE_A, { id: 'SERVICE-A' }),
    scoped(SCOPE_B, { id: 'SERVICE-B' }),
  ];
  context.state.service_route_norms = [
    { id: 'ROUTE-DEFAULT', destination: 'Platform route' },
    scoped(SCOPE_A, {
      id: 'ROUTE-OVERRIDE-A-PHYSICAL',
      platformDefaultId: 'ROUTE-DEFAULT',
      destination: 'Company A route',
    }),
    scoped(SCOPE_A, { id: 'ROUTE-STANDALONE-A', destination: 'Company A only' }),
  ];
  context.state.service_field_trips = [];

  assert.doesNotThrow(() => runWithTenantActorScope(SCOPE_A, () => (
    context.boundary.writeData('service_field_trips', [{
      id: 'TRIP-A',
      serviceTicketId: 'SERVICE-A',
      routeNormId: 'ROUTE-DEFAULT',
    }])
  )));
  assert.equal(context.state.service_field_trips[0].routeNormId, 'ROUTE-DEFAULT');

  for (const routeNormId of ['ROUTE-OVERRIDE-A-PHYSICAL', 'ROUTE-STANDALONE-A']) {
    const scope = routeNormId === 'ROUTE-OVERRIDE-A-PHYSICAL' ? SCOPE_A : SCOPE_B;
    const serviceTicketId = scope === SCOPE_A ? 'SERVICE-A' : 'SERVICE-B';
    assert.throws(
      () => runWithTenantActorScope(scope, () => context.boundary.writeData('service_field_trips', [{
        id: `TRIP-${scope.companyId}`,
        serviceTicketId,
        routeNormId,
      }])),
      error => error?.code === 'CROSS_TENANT_RELATION_DENIED',
      routeNormId,
    );
  }

  assert.doesNotThrow(() => runWithTenantActorScope(SCOPE_B, () => (
    context.boundary.writeData('service_field_trips', [{
      id: 'TRIP-B',
      serviceTicketId: 'SERVICE-B',
      routeNormId: 'ROUTE-DEFAULT',
    }])
  )));
});

test('every derived collection requires an exact authoritative parent and rejects a foreign parent', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());

  function seedAuthoritativeParent(parentCollection, scope, suffix) {
    if (parentCollection === 'users') return scope === SCOPE_A ? 'U-A' : 'U-B';
    const id = `${parentCollection}-${scope.companyId}-${suffix}`;
    const policy = COLLECTION_SCOPE_REGISTRY[parentCollection];
    const record = { id };
    if (policy.category === COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE) {
      const parentRule = policy.parentResolver[0];
      const nextParentCollection = parentRule.collections[0];
      record[parentRule.fields[0]] = seedAuthoritativeParent(nextParentCollection, scope, suffix);
    }
    if (parentCollection === 'gsm_devices') {
      const deviceId = `DEVICE-${scope.companyId}-${suffix}`;
      Object.assign(record, {
        deviceId,
        status: 'unknown',
        bindingRevision: 1,
        bindingHistory: [{
          revision: 1,
          equipmentId: record.equipmentId,
          companyId: scope.companyId,
          tenantId: scope.tenantId,
          imei: null,
          deviceId,
          linkedAt: '2026-08-30T10:00:00.000Z',
          unlinkedAt: null,
          reason: 'test_fixture',
        }],
      });
      const projectedDevice = scoped(scope, record);
      context.state.equipment = context.state.equipment.map(item => (
        item.id === record.equipmentId
          ? applyEquipmentGsmConfigurationProjection(item, projectedDevice)
          : item
      ));
    }
    const rows = Array.isArray(context.state[parentCollection])
      ? context.state[parentCollection]
      : [];
    context.state[parentCollection] = [
      ...rows.filter(candidate => candidate.id !== id),
      scoped(scope, record),
    ];
    return id;
  }

  function derivedRecord(collection, id, field, parentId, scope) {
    const record = { id, [field]: parentId };
    if (collection === 'gsm_devices') {
      const deviceId = `DEVICE-${scope.companyId}-${id}`;
      Object.assign(record, {
        deviceId,
        status: 'unknown',
        bindingRevision: 1,
        bindingHistory: [{
          revision: 1,
          equipmentId: parentId,
          companyId: scope.companyId,
          tenantId: scope.tenantId,
          imei: null,
          deviceId,
          linkedAt: '2026-08-30T10:00:00.000Z',
          unlinkedAt: null,
          reason: 'test_fixture',
        }],
      });
      const projectedDevice = scoped(scope, record);
      context.state.equipment = context.state.equipment.map(item => (
        item.id === parentId
          ? applyEquipmentGsmConfigurationProjection(item, projectedDevice)
          : item
      ));
    }
    if (collection === 'gsm_packets' || collection === 'gsm_commands') {
      const device = context.state.gsm_devices.find(item => item.id === parentId);
      record.equipmentId = device?.equipmentId;
      record.gsmBindingRevision = device?.bindingRevision;
    }
    return record;
  }

  for (const collection of DERIVED_SCOPE_COLLECTIONS) {
    const policy = COLLECTION_SCOPE_REGISTRY[collection];
    const rule = policy.parentResolver[0];
    const field = rule.fields[0];
    const parentCollection = rule.collections[0];
    const valueA = seedAuthoritativeParent(parentCollection, SCOPE_A, collection);
    const valueB = seedAuthoritativeParent(parentCollection, SCOPE_B, collection);
    context.state[collection] = [];

    assert.doesNotThrow(
      () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData(collection, [
        derivedRecord(collection, `${collection}-A`, field, valueA, SCOPE_A),
      ])),
      collection,
    );
    assert.equal(context.state[collection][0].companyId, SCOPE_A.companyId, collection);

    assert.throws(
      () => runWithTenantActorScope(SCOPE_A, () => {
        const record = { id: `${collection}-missing` };
        const current = context.boundary.readData(collection);
        context.boundary.writeData(collection, policy.mutationPolicy === 'APPEND_ONLY' ? [...current, record] : [record]);
      }),
      error => error?.code === 'DERIVED_SCOPE_PARENT_REQUIRED',
      `${collection}: missing parent`,
    );
    assert.throws(
      () => runWithTenantActorScope(SCOPE_A, () => {
        const record = { id: `${collection}-foreign`, [field]: valueB };
        const current = context.boundary.readData(collection);
        context.boundary.writeData(collection, policy.mutationPolicy === 'APPEND_ONLY' ? [...current, record] : [record]);
      }),
      error => error?.code === 'DERIVED_SCOPE_PARENT_UNAVAILABLE',
      `${collection}: foreign parent`,
    );
  }
});

test('finance transfer scope is derived from both stable account IDs in the same batch', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.finance_accounts = [
    scoped(SCOPE_A, { id: 'FA-A-FROM', name: 'Касса', balance: 5000 }),
    scoped(SCOPE_A, { id: 'FA-A-TO', name: 'Банк', balance: 1000 }),
    scoped(SCOPE_B, { id: 'FA-B', name: 'Чужой счёт', balance: 9000 }),
  ];
  context.state.finance_operations = [];

  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeDataBatch([
    {
      name: 'finance_accounts',
      value: [
        { id: 'FA-A-FROM', name: 'Касса', balance: 4500 },
        { id: 'FA-A-TO', name: 'Банк', balance: 1500 },
      ],
    },
    {
      name: 'finance_operations',
      value: [{
        id: 'FO-A',
        type: 'transfer',
        accountFromId: 'FA-A-FROM',
        accountToId: 'FA-A-TO',
        accountFrom: 'Касса',
        accountTo: 'Банк',
        amount: 500,
      }],
    },
  ]));
  assert.equal(context.state.finance_operations[0].companyId, SCOPE_A.companyId);
  const before = structuredClone(context.state.finance_operations);

  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('finance_operations', [{
      id: 'FO-FOREIGN',
      type: 'transfer',
      accountFromId: 'FA-A-FROM',
      accountToId: 'FA-B',
      amount: 100,
    }])),
    error => error?.code === 'DERIVED_SCOPE_PARENT_UNAVAILABLE',
  );
  assert.deepEqual(context.state.finance_operations, before);
});

test('payroll audit events are tenant-isolated and append-only at the persistence boundary', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.payroll_audit_events = [
    scoped(SCOPE_A, { id: 'PAE-A-1', userId: 'U-A', action: 'period.calculate' }),
    scoped(SCOPE_B, { id: 'PAE-B-1', userId: 'U-B', action: 'period.calculate' }),
  ];

  runWithTenantActorScope(SCOPE_A, () => {
    const current = context.boundary.readData('payroll_audit_events');
    context.boundary.writeData('payroll_audit_events', [
      ...current,
      { id: 'PAE-A-2', userId: 'U-A', action: 'period.approved' },
    ]);

    const appended = context.boundary.readData('payroll_audit_events');
    assert.deepEqual(appended.map(item => item.id), ['PAE-A-1', 'PAE-A-2']);
    assert.throws(
      () => context.boundary.writeData('payroll_audit_events', [
        { ...appended[0], action: 'forged.rewrite' },
        appended[1],
      ]),
      error => error?.code === 'TENANT_APPEND_ONLY_COLLECTION_MUTATION',
    );
    assert.throws(
      () => context.boundary.writeData('payroll_audit_events', appended.slice(1)),
      error => error?.code === 'TENANT_APPEND_ONLY_COLLECTION_MUTATION',
    );
  });

  assert.deepEqual(
    context.state.payroll_audit_events.filter(item => item.companyId === SCOPE_B.companyId).map(item => item.id),
    ['PAE-B-1'],
  );
});

test('legacy unscoped audit history is quarantined from tenants while scoped history remains isolated', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  for (const collection of LEGACY_HISTORY_COLLECTIONS) {
    context.state[collection] = [
      { id: `${collection}-legacy`, auditKind: 'LEGACY_UNSCOPED' },
      scoped(SCOPE_A, { id: `${collection}-A`, auditKind: 'TENANT' }),
      scoped(SCOPE_B, { id: `${collection}-B`, auditKind: 'TENANT' }),
    ];
    assert.deepEqual(
      runWithTenantActorScope(SCOPE_A, () => context.boundary.readData(collection)).map(item => item.id),
      [`${collection}-A`],
    );
    assert.equal(
      runWithPlatformSystemScope({ reason: 'history-audit-test' }, () => context.boundary.readData(collection)).length,
      3,
    );
  }
});

test('legacy history writes require the dedicated tenant repository capability', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.audit_logs = [
    { id: 'AUD-legacy', auditKind: 'LEGACY_UNSCOPED' },
    scoped(SCOPE_B, { id: 'AUD-B', auditKind: 'TENANT' }),
  ];

  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('audit_logs', [])),
    error => error?.code === 'HISTORY_REPOSITORY_WRITE_REQUIRED',
  );

  runWithTenantHistoryRepositoryScope({
    scope: SCOPE_A,
    reason: 'security-audit-test',
    writableCollections: ['audit_logs'],
  }, () => context.boundary.writeData('audit_logs', [{ id: 'AUD-A', auditKind: 'TENANT' }]));

  assert.deepEqual(context.state.audit_logs.map(item => item.id), ['AUD-legacy', 'AUD-B', 'AUD-A']);
  assert.equal(context.state.audit_logs.at(-1).companyId, SCOPE_A.companyId);
  assert.throws(
    () => runWithTenantHistoryRepositoryScope({
      scope: SCOPE_A,
      reason: 'invalid-history-repository-test',
      writableCollections: ['equipment'],
    }, () => {}),
    error => error?.code === 'HISTORY_REPOSITORY_COLLECTION_INVALID',
  );
});

test('every legacy history repository preserves the exact stored prefix and only appends tenant rows', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());

  for (const collection of LEGACY_HISTORY_COLLECTIONS) {
    const initial = [
      { id: `${collection}-legacy`, auditKind: 'LEGACY_UNSCOPED' },
      scoped(SCOPE_A, { id: `${collection}-A-1`, auditKind: 'TENANT', action: 'created' }),
      scoped(SCOPE_B, { id: `${collection}-B-1`, auditKind: 'TENANT', action: 'created' }),
    ];
    context.state[collection] = structuredClone(initial);
    if (collection !== 'audit_logs') context.state.audit_logs = [];

    runWithTenantHistoryRepositoryScope({
      scope: SCOPE_A,
      reason: `append-only-${collection}`,
      writableCollections: [collection],
    }, () => {
      const current = context.boundary.readData(collection);
      context.boundary.writeData(collection, [
        ...current,
        { id: `${collection}-A-2`, auditKind: 'TENANT', action: 'updated' },
      ]);
    });

    assert.deepEqual(
      context.state[collection].map(entry => entry.id),
      [...initial.map(entry => entry.id), `${collection}-A-2`],
      collection,
    );
    const beforeAttacks = structuredClone(context.state[collection]);
    const currentTenantRows = beforeAttacks.filter(entry => entry.companyId === SCOPE_A.companyId);
    const attacks = [
      currentTenantRows.slice(1),
      [{ ...currentTenantRows[0], action: 'forged.rewrite' }, ...currentTenantRows.slice(1)],
      [...currentTenantRows].reverse(),
    ];
    for (const attack of attacks) {
      assert.throws(
        () => runWithTenantHistoryRepositoryScope({
          scope: SCOPE_A,
          reason: `immutable-${collection}`,
          writableCollections: [collection],
        }, () => context.boundary.writeData(collection, attack)),
        error => error?.code === 'TENANT_APPEND_ONLY_COLLECTION_MUTATION',
        collection,
      );
      assert.deepEqual(context.state[collection], beforeAttacks, collection);
    }
  }
});

test('service audit history survives ticket deletion with tenant isolation and atomic rollback', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.service = [
    scoped(SCOPE_A, { id: 'SVC-A', status: 'new' }),
    scoped(SCOPE_B, { id: 'SVC-B', status: 'new' }),
  ];
  context.state.service_audit_log = [
    { id: 'SA-legacy', serviceId: 'SVC-legacy', action: 'ticket_created' },
    scoped(SCOPE_A, { id: 'SA-A-1', serviceId: 'SVC-A', action: 'ticket_created' }),
    scoped(SCOPE_B, { id: 'SA-B-1', serviceId: 'SVC-B', action: 'ticket_created' }),
  ];
  context.state.audit_logs = [
    scoped(SCOPE_B, { id: 'AUD-B-1', auditKind: 'TENANT', action: 'service.create', entityType: 'service' }),
  ];

  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData(
      'service_audit_log',
      context.boundary.readData('service_audit_log'),
    )),
    error => error?.code === 'HISTORY_REPOSITORY_WRITE_REQUIRED',
  );

  runWithTenantHistoryRepositoryScope({
    scope: SCOPE_A,
    reason: 'service-delete-semantic-audit-test',
    writableCollections: ['audit_logs', 'service_audit_log'],
  }, () => context.boundary.writeDataBatch([
    { name: 'service', value: [] },
    {
      name: 'service_audit_log',
      value: [
        ...context.boundary.readData('service_audit_log'),
        { id: 'SA-A-2', serviceId: 'SVC-A', action: 'ticket_deleted' },
      ],
    },
    {
      name: 'audit_logs',
      value: [{
        id: 'AUD-A-1',
        auditKind: 'TENANT',
        action: 'service.delete',
        entityType: 'service',
        entityId: 'SVC-A',
      }],
    },
  ]));

  assert.equal(context.state.service.some(item => item.id === 'SVC-A'), false);
  assert.equal(context.state.service.some(item => item.id === 'SVC-B'), true);
  assert.deepEqual(
    runWithTenantActorScope(SCOPE_A, () => context.boundary.readData('service_audit_log'))
      .map(item => item.id),
    ['SA-A-1', 'SA-A-2'],
  );
  assert.deepEqual(
    runWithTenantActorScope(SCOPE_B, () => context.boundary.readData('service_audit_log'))
      .map(item => item.id),
    ['SA-B-1'],
  );
  assert.equal(context.state.service_audit_log.some(item => item.id === 'SA-legacy'), true);

  const beforeFailure = structuredClone({
    service: context.state.service,
    serviceAudit: context.state.service_audit_log,
    securityAudit: context.state.audit_logs,
  });
  context.failNextBatch();
  assert.throws(
    () => runWithTenantHistoryRepositoryScope({
      scope: SCOPE_A,
      reason: 'service-create-rollback-test',
      writableCollections: ['audit_logs', 'service_audit_log'],
    }, () => context.boundary.writeDataBatch([
      { name: 'service', value: [{ id: 'SVC-A-ROLLBACK', status: 'new' }] },
      {
        name: 'service_audit_log',
        value: [
          ...context.boundary.readData('service_audit_log'),
          { id: 'SA-A-ROLLBACK', serviceId: 'SVC-A-ROLLBACK', action: 'ticket_created' },
        ],
      },
      {
        name: 'audit_logs',
        value: [
          ...context.boundary.readData('audit_logs'),
          {
            id: 'AUD-A-ROLLBACK',
            auditKind: 'TENANT',
            action: 'service.create',
            entityType: 'service',
            entityId: 'SVC-A-ROLLBACK',
          },
        ],
      },
    ])),
    error => error?.code === 'INJECTED_BATCH_FAILURE',
  );
  assert.deepEqual(context.state.service, beforeFailure.service);
  assert.deepEqual(context.state.service_audit_log, beforeFailure.serviceAudit);
  assert.deepEqual(context.state.audit_logs, beforeFailure.securityAudit);
});

test('every business mutation commits an exact-scope technical audit journal atomically', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.equipment = [];
  context.state.audit_logs = [
    { id: 'AUD-legacy', auditKind: 'LEGACY_UNSCOPED' },
    scoped(SCOPE_B, { id: 'AUD-B', auditKind: 'TENANT' }),
  ];

  runWithTenantActorScope({
    ...SCOPE_A,
    principalId: 'U-A',
    membershipId: 'MEMBERSHIP-COMPANY-A',
  }, () => context.boundary.writeData('equipment', [{ id: 'EQ-A' }]));

  assert.equal(context.state.equipment.length, 1);
  assert.deepEqual(context.state.audit_logs.slice(0, 2).map(item => item.id), ['AUD-legacy', 'AUD-B']);
  const journal = context.state.audit_logs.at(-1);
  assert.deepEqual(journal.metadata.collections, ['equipment']);
  assert.equal(journal.auditKind, 'TENANT');
  assert.equal(journal.companyId, SCOPE_A.companyId);
  assert.equal(journal.tenantId, SCOPE_A.tenantId);
  assert.equal(journal.userId, 'U-A');
  assert.equal(journal.membershipId, 'MEMBERSHIP-COMPANY-A');

  const before = structuredClone({
    equipment: context.state.equipment,
    audit_logs: context.state.audit_logs,
  });
  context.failNextBatch();
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('equipment', [
      { ...context.state.equipment[0], name: 'must-not-commit' },
    ])),
    error => error?.code === 'INJECTED_BATCH_FAILURE',
  );
  assert.deepEqual(context.state.equipment, before.equipment);
  assert.deepEqual(context.state.audit_logs, before.audit_logs);
});

test('a malformed audit collection blocks rather than erases a business mutation', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.equipment = [];
  context.state.audit_logs = { corrupt: true };
  const before = structuredClone(context.state);

  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('equipment', [{ id: 'EQ-A' }])),
    error => error?.code === 'AUDIT_HISTORY_SHAPE_INVALID',
  );
  assert.deepEqual(context.state, before);
});

test('generic platform and tenant-history scopes cannot replace an active security context', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.equipment = [
    scoped(SCOPE_A, { id: 'EQ-A' }),
    scoped(SCOPE_B, { id: 'EQ-B' }),
  ];
  context.state.audit_logs = [];
  const before = structuredClone(context.state);

  for (const enterParent of [
    operation => runWithTenantActorScope(SCOPE_A, operation),
    operation => runWithDeniedTenantScope(operation),
    operation => runWithPlatformSystemScope({ reason: 'outer-platform-scope' }, operation),
  ]) {
    assert.throws(
      () => enterParent(() => runWithPlatformSystemScope({
        reason: 'nested-platform-elevation',
        writableCollections: ['equipment'],
      }, () => context.boundary.writeData('equipment', []))),
      error => error?.code === 'PLATFORM_SCOPE_ELEVATION_DENIED',
    );
  }

  for (const enterParent of [
    operation => runWithDeniedTenantScope(operation),
    operation => runWithPlatformSystemScope({ reason: 'outer-platform-scope' }, operation),
  ]) {
    assert.throws(
      () => enterParent(() => runWithTenantHistoryRepositoryScope({
        scope: SCOPE_A,
        reason: 'nested-history-elevation',
        writableCollections: ['audit_logs'],
      }, () => context.boundary.readData('equipment'))),
      error => error?.code === 'HISTORY_SCOPE_ELEVATION_DENIED',
    );
  }
  for (const enterParent of [
    operation => runWithDeniedTenantScope(operation),
    operation => runWithPlatformSystemScope({ reason: 'outer-platform-scope' }, operation),
  ]) {
    assert.throws(
      () => enterParent(() => runWithTenantActorScope(SCOPE_A, () => (
        context.boundary.readData('equipment')
      ))),
      error => error?.code === 'TENANT_SCOPE_ELEVATION_DENIED',
    );
  }
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => runWithTenantActorScope(SCOPE_B, () => (
      context.boundary.readData('equipment')
    ))),
    error => error?.code === 'TENANT_SCOPE_ELEVATION_DENIED',
  );
  assert.deepEqual(context.state, before);
});

test('same-tenant re-entry preserves the authoritative principal and history capability', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.equipment = [];
  context.state.audit_logs = [];
  context.state.service_audit_log = [];
  const authoritative = {
    ...SCOPE_A,
    principalId: 'U-A',
    membershipId: 'MEMBERSHIP-COMPANY-A',
  };

  runWithTenantActorScope(authoritative, () => runWithTenantActorScope({
    ...SCOPE_A,
    principalId: 'FORGED',
    membershipId: 'FORGED',
  }, () => context.boundary.writeData('equipment', [{ id: 'EQ-A' }])));
  assert.equal(context.state.audit_logs.at(-1).userId, 'U-A');
  assert.equal(context.state.audit_logs.at(-1).membershipId, 'MEMBERSHIP-COMPANY-A');

  runWithTenantActorScope(authoritative, () => runWithTenantHistoryRepositoryScope({
    scope: authoritative,
    reason: 'audit-only-capability',
    writableCollections: ['audit_logs'],
  }, () => {
    assert.throws(
      () => runWithTenantHistoryRepositoryScope({
        scope: { ...SCOPE_A, principalId: 'FORGED' },
        reason: 'attempted-capability-widening',
        writableCollections: ['service_audit_log'],
      }, () => {}),
      error => error?.code === 'HISTORY_SCOPE_CAPABILITY_EXCEEDED',
    );
    const snapshot = currentTenantContext();
    snapshot.allowedHistoryWrites.add('service_audit_log');
    assert.throws(
      () => context.boundary.writeData('service_audit_log', []),
      error => error?.code === 'HISTORY_REPOSITORY_WRITE_REQUIRED',
    );
  }));
  assert.deepEqual(context.state.service_audit_log, []);
});

test('a bound platform runner can access only its fixed collection family when nested', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.equipment = [scoped(SCOPE_A, { id: 'EQ-A' })];
  context.state.audit_logs = [];
  const runWithBotSessionCapability = createBoundPlatformSystemScopeRunner({
    reasonPrefix: 'test-bot-session-',
    readableCollections: ['bot_sessions'],
    writableCollections: ['bot_sessions'],
    allowedParentKinds: ['tenant_actor', 'tenant_denied', 'platform_system'],
  });

  runWithTenantActorScope(SCOPE_A, () => {
    runWithBotSessionCapability({ reason: 'test-bot-session-detached-context' }, () => {
      const snapshot = currentTenantContext();
      snapshot.allowedReads.add('equipment');
      snapshot.allowedWrites.add('equipment');
      assert.throws(
        () => context.boundary.readData('equipment'),
        error => error?.code === 'PLATFORM_COLLECTION_READ_NOT_ALLOWLISTED',
      );
      assert.throws(
        () => context.boundary.writeData('equipment', []),
        error => error?.code === 'PLATFORM_COLLECTION_WRITE_NOT_ALLOWLISTED',
      );
    });
    assert.equal(
      runWithBotSessionCapability({ reason: 'test-bot-session-read' }, () => (
        context.boundary.readData('bot_sessions').preauth.scenario
      )),
      'login_email',
    );
    assert.throws(
      () => runWithBotSessionCapability({ reason: 'test-bot-session-read' }, () => (
        context.boundary.readData('equipment')
      )),
      error => error?.code === 'PLATFORM_COLLECTION_READ_NOT_ALLOWLISTED',
    );
    assert.throws(
      () => runWithBotSessionCapability({
        reason: 'test-bot-session-write',
        writableCollections: ['equipment'],
      }, () => {}),
      error => error?.code === 'PLATFORM_SCOPE_CAPABILITY_EXCEEDED',
    );
    assert.throws(
      () => runWithBotSessionCapability({ reason: 'wrong-purpose' }, () => {}),
      error => error?.code === 'PLATFORM_DATA_ACCESS_REASON_INVALID',
    );
    assert.throws(
      () => createBoundPlatformSystemScopeRunner({
        reasonPrefix: 'nested-capability-',
        readableCollections: ['equipment'],
      }),
      error => error?.code === 'PLATFORM_SCOPE_CAPABILITY_CREATION_DENIED',
    );
    assert.throws(
      () => runWithBotSessionCapability({ reason: 'test-bot-session-read' }, () => (
        runWithPlatformSystemScope({ reason: 'nested-generic-platform' }, () => context.boundary.readData('users'))
      )),
      error => error?.code === 'PLATFORM_SCOPE_ELEVATION_DENIED',
    );

    runWithBotSessionCapability({
      reason: 'test-bot-session-write',
      writableCollections: ['bot_sessions'],
    }, () => context.boundary.writeData('bot_sessions', {
      preauth: { scenario: 'confirm_code' },
    }));

    assert.deepEqual(context.boundary.readData('equipment').map(item => item.id), ['EQ-A']);
  });

  assert.equal(context.state.bot_sessions.preauth.scenario, 'confirm_code');
  assert.equal(context.state.audit_logs.length, 1);
  assert.equal(context.state.audit_logs[0].auditKind, 'GLOBAL_SYSTEM');
  assert.deepEqual(context.state.audit_logs[0].metadata.collections, ['bot_sessions']);
  assert.equal(
    runWithDeniedTenantScope(() => runWithBotSessionCapability({
      reason: 'test-bot-session-read-denied-parent',
    }, () => context.boundary.readData('bot_sessions').preauth.scenario)),
    'confirm_code',
  );
});

test('the first collection read remains the optimistic concurrency precondition', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.equipment = [scoped(SCOPE_A, { id: 'EQ-A', revision: 1 })];
  context.state.audit_logs = [];

  runWithTenantActorScope(SCOPE_A, () => {
    const stale = context.boundary.readData('equipment');
    context.state.equipment = [scoped(SCOPE_A, { id: 'EQ-A', revision: 2 })];
    assert.equal(context.boundary.readData('equipment')[0].revision, 2);
    assert.throws(
      () => context.boundary.writeData('equipment', [{ ...stale[0], revision: 3 }]),
      error => error?.code === 'TENANT_COLLECTION_CONCURRENT_MODIFICATION',
    );
  });
  assert.equal(context.state.equipment[0].revision, 2);
});

test('explicit platform maintenance replaces defaults only, preserves tenant catalogue rows, and journals atomically', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.service_works = [
    { id: 'WORK-DEFAULT', name: 'Platform inspection v1' },
    scoped(SCOPE_A, { id: 'WORK-A', name: 'Company A inspection' }),
  ];
  context.state.audit_logs = [];

  runWithPlatformSystemScope({
    reason: 'platform-catalogue-test',
    writableCollections: ['service_works'],
  }, () => context.boundary.writeData('service_works', [
    { id: 'WORK-DEFAULT', name: 'Platform inspection v2' },
    { id: 'WORK-DEFAULT-NEW', name: 'New platform inspection' },
  ]));

  assert.deepEqual(context.state.service_works, [
    { id: 'WORK-DEFAULT', name: 'Platform inspection v2' },
    { id: 'WORK-DEFAULT-NEW', name: 'New platform inspection' },
    scoped(SCOPE_A, { id: 'WORK-A', name: 'Company A inspection' }),
  ]);
  assert.equal(context.state.audit_logs.length, 1);
  assert.equal(context.state.audit_logs[0].auditKind, 'GLOBAL_SYSTEM');
  assert.equal(context.state.audit_logs[0].companyId, undefined);
  assert.equal(context.state.audit_logs[0].metadata.reason, 'platform-catalogue-test');
  assert.deepEqual(context.state.audit_logs[0].metadata.collections, ['service_works']);
});

test('platform maintenance enforces scope for every tenant-technical storage shape', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.audit_logs = [];
  context.state.app_settings = [];
  context.state.bot_users = {};
  context.state.snapshot = { __tenantScopedValues: {} };

  for (const [collection, invalid] of [
    ['app_settings', [{ id: 'SETTING-unscoped' }]],
    ['bot_users', { phone: { userId: 'U-A', companyId: 'COMPANY-A' } }],
    ['snapshot', { __tenantScopedValues: { 'COMPANY-A': { companyId: 'COMPANY-A', tenantId: 'COMPANY-B', value: {} } } }],
  ]) {
    assert.throws(
      () => runWithPlatformSystemScope({
        reason: 'platform-technical-scope-test',
        writableCollections: [collection],
      }, () => context.boundary.writeData(collection, invalid)),
      error => error?.code === 'PLATFORM_TENANT_SCOPE_INVALID',
      collection,
    );
  }

  runWithPlatformSystemScope({
    reason: 'platform-technical-scope-test',
    writableCollections: ['app_settings', 'bot_users', 'snapshot'],
  }, () => context.boundary.writeDataBatch([
    { name: 'app_settings', value: [scoped(SCOPE_A, { id: 'SETTING-A' })] },
    { name: 'bot_users', value: { phone: scoped(SCOPE_A, { userId: 'U-A' }) } },
    {
      name: 'snapshot',
      value: {
        __tenantScopedValues: {
          'COMPANY-A': scoped(SCOPE_A, { value: { generatedAt: 'now' } }),
        },
      },
    },
  ]));
  assert.equal(context.state.app_settings[0].companyId, SCOPE_A.companyId);
  assert.equal(context.state.bot_users.phone.tenantId, SCOPE_A.tenantId);
  assert.equal(context.state.snapshot.__tenantScopedValues['COMPANY-A'].tenantId, SCOPE_A.tenantId);

  context.state.inline_relation_idempotency = [{ id: 'legacy-tombstone', key: 'immutable' }];
  assert.throws(
    () => runWithPlatformSystemScope({
      reason: 'platform-idempotency-test',
      writableCollections: ['inline_relation_idempotency'],
    }, () => context.boundary.writeData('inline_relation_idempotency', [])),
    error => error?.code === 'LEGACY_IDEMPOTENCY_STORAGE_IMMUTABLE',
  );
});

test('system user identity is unique for platform writes and ambiguous tenant reads fail closed', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.audit_logs = [];
  const originalUsers = structuredClone(context.state.users);

  for (const [label, users, code] of [
    ['duplicate', [...originalUsers, { ...originalUsers.find(user => user.id === 'U-A') }], 'PLATFORM_RECORD_ID_DUPLICATE'],
    ['idless', [...originalUsers, { name: 'Missing stable identity' }], 'PLATFORM_USER_ID_REQUIRED'],
  ]) {
    const before = structuredClone(context.state);
    assert.throws(
      () => runWithPlatformSystemScope({
        reason: `platform-user-identity-${label}`,
        writableCollections: ['users'],
      }, () => context.boundary.writeData('users', users)),
      error => error?.code === code,
      label,
    );
    assert.deepEqual(context.state, before, label);
  }

  context.state.users = [
    ...originalUsers,
    { ...originalUsers.find(user => user.id === 'U-A'), name: 'Conflicting A' },
  ];
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.readData('users')),
    error => error?.code === 'USER_DIRECTORY_IDENTITY_AMBIGUOUS',
  );
});

test('platform maintenance rejects duplicate IDs and cross-tenant relationships', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.audit_logs = [];
  context.state.equipment = [];
  assert.throws(
    () => runWithPlatformSystemScope({
      reason: 'platform-duplicate-id-test',
      writableCollections: ['equipment'],
    }, () => context.boundary.writeData('equipment', [
      scoped(SCOPE_A, { id: 'EQ-DUP' }),
      scoped(SCOPE_B, { id: 'EQ-DUP' }),
    ])),
    error => error?.code === 'PLATFORM_RECORD_ID_DUPLICATE',
  );

  context.state.counterparties = [scoped(SCOPE_B, { id: 'CP-B' })];
  context.state.clients = [scoped(SCOPE_B, { id: 'CLIENT-B', counterpartyId: 'CP-B' })];
  context.state.rentals = [];
  assert.throws(
    () => runWithPlatformSystemScope({
      reason: 'platform-cross-tenant-link-test',
      writableCollections: ['rentals'],
    }, () => context.boundary.writeData('rentals', [
      scoped(SCOPE_A, { id: 'RENTAL-A', clientId: 'CLIENT-B' }),
    ])),
    error => error?.code === 'CROSS_TENANT_RELATION_DENIED',
  );
  assert.deepEqual(context.state.rentals, []);
  assert.deepEqual(context.state.audit_logs, []);
});

test('platform maintenance re-resolves every derived row to an exact-scope authoritative parent', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.audit_logs = [];
  context.state.equipment = [
    scoped(SCOPE_A, { id: 'EQ-A' }),
    scoped(SCOPE_B, { id: 'EQ-B' }),
  ];
  context.state.management_action_states = [];

  runWithPlatformSystemScope({
    reason: 'platform-derived-scope-test',
    writableCollections: ['management_action_states'],
  }, () => context.boundary.writeData('management_action_states', [
    scoped(SCOPE_A, { id: 'ACTION-A', equipmentId: 'EQ-A' }),
  ]));
  assert.equal(context.state.management_action_states[0].tenantId, SCOPE_A.tenantId);

  for (const invalid of [
    { id: 'ACTION-unscoped', equipmentId: 'EQ-A' },
    scoped(SCOPE_A, { id: 'ACTION-cross-parent', equipmentId: 'EQ-B' }),
    scoped(SCOPE_A, { id: 'ACTION-no-parent' }),
  ]) {
    assert.throws(
      () => runWithPlatformSystemScope({
        reason: 'platform-derived-scope-test',
        writableCollections: ['management_action_states'],
      }, () => context.boundary.writeData('management_action_states', [invalid])),
      error => [
        'PLATFORM_TENANT_SCOPE_INVALID',
        'DERIVED_SCOPE_PARENT_UNAVAILABLE',
        'DERIVED_SCOPE_PARENT_REQUIRED',
      ].includes(error?.code),
    );
  }
});

test('platform history permits exact tenant/global audit rows but cannot introduce unscoped tenant history', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  const preservedLegacy = { id: 'AUD-legacy-preserved', action: 'legacy' };
  context.state.audit_logs = [
    preservedLegacy,
    scoped(SCOPE_A, { id: 'AUD-A', auditKind: 'TENANT' }),
    { id: 'AUD-global', auditKind: 'GLOBAL_SYSTEM' },
  ];

  runWithPlatformSystemScope({
    reason: 'platform-history-scope-test',
    writableCollections: ['audit_logs'],
  }, () => context.boundary.writeData('audit_logs', [
    preservedLegacy,
    scoped(SCOPE_A, { id: 'AUD-A', auditKind: 'TENANT' }),
    { id: 'AUD-global', auditKind: 'GLOBAL_SYSTEM' },
    { id: 'AUD-global-next', auditKind: 'GLOBAL_SYSTEM' },
  ]));
  assert.equal(context.state.audit_logs.at(-1).id, 'AUD-global-next');

  const preservedHistory = structuredClone(context.state.audit_logs);
  for (const attack of [
    preservedHistory.slice(1),
    [{ ...preservedHistory[0], action: 'forged.rewrite' }, ...preservedHistory.slice(1)],
    [preservedHistory[1], preservedHistory[0], ...preservedHistory.slice(2)],
  ]) {
    assert.throws(
      () => runWithPlatformSystemScope({
        reason: 'platform-history-immutability-test',
        writableCollections: ['audit_logs'],
      }, () => context.boundary.writeData('audit_logs', attack)),
      error => error?.code === 'PLATFORM_HISTORY_IMMUTABLE',
    );
    assert.deepEqual(context.state.audit_logs, preservedHistory);
  }

  assert.throws(
    () => runWithPlatformSystemScope({
      reason: 'platform-history-scope-test',
      writableCollections: ['audit_logs'],
    }, () => context.boundary.writeData('audit_logs', [
      ...context.state.audit_logs,
      { id: 'AUD-new-unscoped', auditKind: 'TENANT' },
    ])),
    error => error?.code === 'PLATFORM_HISTORY_SCOPE_INVALID',
  );
});

test('reference relations resolve to tenant-effective catalogue logical IDs', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.service = [scoped(SCOPE_A, { id: 'SVC-A' })];
  context.state.service_works = [
    scoped(SCOPE_A, { id: 'SW-A' }),
    scoped(SCOPE_B, { id: 'SW-B' }),
    { id: 'SW-DEFAULT' },
  ];
  context.state.repair_work_items = [];
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('repair_work_items', [{
      id: 'RWI-CATALOG-WITHOUT-TICKET',
      catalogId: 'SW-A',
    }])),
    error => error?.code === 'DERIVED_SCOPE_PARENT_REQUIRED',
  );
  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('repair_work_items', [{
    id: 'RWI-A',
    serviceTicketId: 'SVC-A',
    catalogId: 'SW-A',
  }]));
  assert.equal(context.state.repair_work_items[0].companyId, SCOPE_A.companyId);
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('service_works', [])),
    error => error?.code === 'TENANT_PARENT_MUTATION_ORPHANS_CHILD',
  );
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('repair_work_items', [{
      id: 'RWI-SW-B',
      serviceTicketId: 'SVC-A',
      workId: 'SW-B',
    }])),
    error => error?.code === 'CROSS_TENANT_RELATION_DENIED',
  );
  assert.doesNotThrow(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('repair_work_items', [{
      id: 'RWI-SW-DEFAULT',
      serviceTicketId: 'SVC-A',
      workId: 'SW-DEFAULT',
    }])),
  );
});

test('management action state is equipment-derived, tenant-isolated, and quarantines unscoped legacy state', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.equipment = [
    scoped(SCOPE_A, { id: 'EQ-A', status: 'available' }),
    scoped(SCOPE_B, { id: 'EQ-B', status: 'available' }),
  ];
  context.state.management_action_states = [
    scoped(SCOPE_A, { id: 'MAS-A', equipmentId: 'EQ-A', actionId: 'action-a', status: 'open' }),
    scoped(SCOPE_B, { id: 'MAS-B', equipmentId: 'EQ-B', actionId: 'action-b', status: 'open' }),
    { id: 'MAS-legacy', equipmentId: 'EQ-A', actionId: 'legacy-action', status: 'open' },
  ];

  runWithTenantActorScope(SCOPE_A, () => {
    const visible = context.boundary.readData('management_action_states');
    assert.deepEqual(visible.map(item => item.id), ['MAS-A']);
    context.boundary.writeData('management_action_states', [
      { ...visible[0], status: 'resolved' },
      { id: 'MAS-A-2', equipmentId: 'EQ-A', actionId: 'action-a-2', status: 'open' },
    ]);
  });

  assert.equal(context.state.management_action_states.find(item => item.id === 'MAS-A').status, 'resolved');
  assert.equal(context.state.management_action_states.find(item => item.id === 'MAS-A-2').companyId, SCOPE_A.companyId);
  assert.equal(context.state.management_action_states.find(item => item.id === 'MAS-B').status, 'open');
  assert.ok(context.state.management_action_states.some(item => item.id === 'MAS-legacy'));

  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => {
      context.boundary.writeData('management_action_states', [{
        id: 'MAS-foreign-parent',
        equipmentId: 'EQ-B',
        actionId: 'foreign-action',
        status: 'open',
      }]);
    }),
    error => error?.code === 'DERIVED_SCOPE_PARENT_UNAVAILABLE',
  );
});

test('derived reads recursively quarantine invalid rows without deleting their raw bytes', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.equipment = [
    scoped(SCOPE_A, { id: 'EQ-A' }),
    scoped(SCOPE_B, { id: 'EQ-B' }),
  ];
  context.state.management_action_states = [
    scoped(SCOPE_A, { id: 'MAS-A', equipmentId: 'EQ-A', status: 'open' }),
    scoped(SCOPE_A, { id: 'MAS-CROSS', equipmentId: 'EQ-B', status: 'open' }),
    scoped(SCOPE_A, { id: 'MAS-DANGLING', equipmentId: 'EQ-MISSING', status: 'open' }),
    { id: 'MAS-LEGACY', equipmentId: 'EQ-A', status: 'open' },
    scoped(SCOPE_B, { id: 'MAS-B', equipmentId: 'EQ-B', status: 'open' }),
  ];
  const preserved = structuredClone(context.state.management_action_states.slice(1));

  runWithTenantActorScope(SCOPE_A, () => {
    const visible = context.boundary.readData('management_action_states');
    assert.deepEqual(visible.map(record => record.id), ['MAS-A']);
    context.boundary.writeData('management_action_states', [
      { ...visible[0], status: 'resolved' },
      { id: 'MAS-A-2', equipmentId: 'EQ-A', status: 'open' },
    ]);
  });
  assert.deepEqual(context.state.management_action_states.slice(0, 4), [
    ...preserved.slice(0, 3),
    preserved[3],
  ]);
  assert.deepEqual(
    context.state.management_action_states.slice(4).map(record => record.id),
    ['MAS-A', 'MAS-A-2'],
  );
  assert.deepEqual(
    runWithTenantActorScope(SCOPE_A, () => context.boundary.readData('management_action_states'))
      .map(record => record.id),
    ['MAS-A', 'MAS-A-2'],
  );
  const beforeCollision = structuredClone(context.state.management_action_states);
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData(
      'management_action_states',
      [{ id: 'MAS-CROSS', equipmentId: 'EQ-A', status: 'replacement' }],
    )),
    error => error?.code === 'TENANT_RECORD_ID_COLLISION',
  );
  assert.deepEqual(context.state.management_action_states, beforeCollision);
});

test('derived scope is recursive through authoritative parent chains', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.counterparties = [
    scoped(SCOPE_A, { id: 'CP-A' }),
    scoped(SCOPE_B, { id: 'CP-B' }),
  ];
  context.state.clients = [
    scoped(SCOPE_A, { id: 'CLIENT-A', counterpartyId: 'CP-A' }),
    scoped(SCOPE_A, { id: 'CLIENT-A-INVALID', counterpartyId: 'CP-B' }),
  ];
  context.state.payments = [
    scoped(SCOPE_A, { id: 'PAY-A', clientId: 'CLIENT-A' }),
    scoped(SCOPE_A, { id: 'PAY-A-INVALID', clientId: 'CLIENT-A-INVALID' }),
  ];
  assert.deepEqual(
    runWithTenantActorScope(SCOPE_A, () => context.boundary.readData('clients')).map(row => row.id),
    ['CLIENT-A'],
  );
  assert.deepEqual(
    runWithTenantActorScope(SCOPE_A, () => context.boundary.readData('payments')).map(row => row.id),
    ['PAY-A'],
  );
});

test('legacy missing relations are preserved but new, changed, or newly orphaned links are rejected', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.rentals = [scoped(SCOPE_A, {
    id: 'RENTAL-LEGACY',
    clientId: 'CLIENT-MISSING',
    note: 'before',
  })];
  context.state.clients = [];
  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('rentals', [{
    ...context.boundary.readData('rentals')[0],
    note: 'after',
  }]));
  assert.equal(context.state.rentals[0].note, 'after');
  assert.equal(context.state.rentals[0].clientId, 'CLIENT-MISSING');

  for (const value of [
    [context.state.rentals[0], { id: 'RENTAL-NEW', clientId: 'CLIENT-MISSING' }],
    [{ ...context.state.rentals[0], clientId: 'CLIENT-OTHER-MISSING' }],
  ]) {
    const before = structuredClone({ rentals: context.state.rentals, audit: context.state.audit_logs });
    assert.throws(
      () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('rentals', value)),
      error => error?.code === 'TENANT_RELATION_TARGET_REQUIRED',
    );
    assert.deepEqual(context.state.rentals, before.rentals);
    assert.deepEqual(context.state.audit_logs, before.audit);
  }

  context.state.equipment = [scoped(SCOPE_A, { id: 'EQ-A' })];
  context.state.deliveries = [scoped(SCOPE_A, { id: 'DEL-A', equipmentIds: ['EQ-A'] })];
  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeDataBatch([
      { name: 'equipment', value: [] },
      { name: 'deliveries', value: context.state.deliveries },
    ])),
    error => error?.code === 'TENANT_PARENT_MUTATION_ORPHANS_CHILD',
  );
  assert.equal(context.state.equipment.length, 1);
});

test('parent-only deletion is restricted while atomic child removal or retargeting succeeds', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.equipment = [
    scoped(SCOPE_A, { id: 'EQ-A-1' }),
    scoped(SCOPE_A, { id: 'EQ-A-2' }),
  ];
  context.state.equipment_downtimes = [
    scoped(SCOPE_A, { id: 'DOWN-A', equipmentId: 'EQ-A-1' }),
  ];
  context.state.documents = [
    scoped(SCOPE_A, { id: 'DOC-A', equipmentId: 'EQ-A-1' }),
  ];
  context.state.audit_logs = [];
  const before = structuredClone({
    equipment: context.state.equipment,
    downtimes: context.state.equipment_downtimes,
    documents: context.state.documents,
    audit: context.state.audit_logs,
  });

  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('equipment', [
      context.state.equipment[1],
    ])),
    error => error?.code === 'TENANT_PARENT_MUTATION_ORPHANS_CHILD',
  );
  assert.deepEqual(context.state.equipment, before.equipment);
  assert.deepEqual(context.state.equipment_downtimes, before.downtimes);
  assert.deepEqual(context.state.documents, before.documents);
  assert.deepEqual(context.state.audit_logs, before.audit);

  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeDataBatch([
    { name: 'equipment', value: [context.state.equipment[1]] },
    {
      name: 'equipment_downtimes',
      value: [{ ...context.state.equipment_downtimes[0], equipmentId: 'EQ-A-2' }],
    },
    {
      name: 'documents',
      value: [{ ...context.state.documents[0], equipmentId: 'EQ-A-2' }],
    },
  ]));
  assert.deepEqual(context.state.equipment.map(row => row.id), ['EQ-A-2']);
  assert.equal(context.state.equipment_downtimes[0].equipmentId, 'EQ-A-2');
  assert.equal(context.state.documents[0].equipmentId, 'EQ-A-2');

  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeDataBatch([
    { name: 'equipment', value: [] },
    { name: 'equipment_downtimes', value: [] },
    { name: 'documents', value: [] },
  ]));
  assert.deepEqual(context.state.equipment, []);
  assert.deepEqual(context.state.equipment_downtimes, []);
  assert.deepEqual(context.state.documents, []);
});

test('transitive derived chains prevent orphaning across multiple levels', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());
  context.state.counterparties = [scoped(SCOPE_A, { id: 'CP-A' })];
  context.state.clients = [scoped(SCOPE_A, { id: 'CLIENT-A', counterpartyId: 'CP-A' })];
  context.state.payments = [scoped(SCOPE_A, { id: 'PAY-A', clientId: 'CLIENT-A' })];
  context.state.payment_allocations = [scoped(SCOPE_A, { id: 'ALLOC-A', paymentId: 'PAY-A' })];
  context.state.audit_logs = [];
  const before = structuredClone(context.state);

  assert.throws(
    () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('counterparties', [])),
    error => error?.code === 'TENANT_PARENT_MUTATION_ORPHANS_CHILD',
  );
  assert.deepEqual(context.state, before);
});

test('client INN uniqueness is tenant-local and does not reveal another company', () => {
  const clients = [
    scoped(SCOPE_A, { id: 'C-A', inn: '7707083893' }),
    scoped(SCOPE_B, { id: 'C-B', inn: '7707083893' }),
  ];
  assert.deepEqual(buildClientInnDuplicateReport(clients), []);
  assert.doesNotThrow(() => assertClientInnUnique(clients, scoped(SCOPE_B, {
    id: 'C-B-2',
    inn: '7728168971',
  })));
  assert.throws(
    () => assertClientInnUnique(clients, scoped(SCOPE_A, { id: 'C-A-2', inn: '7707083893' })),
    error => error?.code === 'CLIENT_INN_DUPLICATE',
  );
});
