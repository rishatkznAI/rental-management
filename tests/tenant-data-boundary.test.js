import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

import {
  createPlatformIdentityContext,
  seedAuthority,
  testActor,
} from './platform-identity-fixtures.js';

const require = createRequire(import.meta.url);
const { JSON_COLLECTIONS } = require('../server/db.js');
const {
  SYSTEM_GLOBAL_COLLECTIONS,
  TENANT_OWNED_ARRAY_COLLECTIONS,
  TENANT_OWNED_MAP_COLLECTIONS,
  TENANT_OWNED_SINGLETON_COLLECTIONS,
  createTenantDataBoundary,
  runWithDeniedTenantScope,
  runWithTenantActorScope,
} = require('../server/lib/tenant-data-boundary.js');
const { assertTenantRelationships } = require('../server/lib/tenant-relationship-guard.js');
const { buildClientInnDuplicateReport, assertClientInnUnique } = require('../server/lib/client-inn.js');

const SCOPE_A = Object.freeze({ companyId: 'COMPANY-A', tenantId: 'COMPANY-A' });
const SCOPE_B = Object.freeze({ companyId: 'COMPANY-B', tenantId: 'COMPANY-B' });

function scoped(scope, value) {
  return { ...value, companyId: scope.companyId, tenantId: scope.tenantId };
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
  const readRawData = name => state[name] ?? null;
  const writeRawData = (name, value) => {
    state[name] = structuredClone(value);
    writes.push({ name, value: structuredClone(value) });
  };
  const writeRawDataBatch = entries => {
    for (const entry of entries) writeRawData(entry.name, entry.value);
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
  };
}

test('every app_data collection has one explicit tenant classification', () => {
  const classified = [
    ...TENANT_OWNED_ARRAY_COLLECTIONS,
    ...TENANT_OWNED_MAP_COLLECTIONS,
    ...TENANT_OWNED_SINGLETON_COLLECTIONS,
    ...SYSTEM_GLOBAL_COLLECTIONS,
  ];
  assert.equal(new Set(classified).size, classified.length, 'classifications must not overlap');
  assert.deepEqual([...new Set(JSON_COLLECTIONS)].sort(), [...new Set(classified)].sort());
});

test('all tenant-owned array domains enforce list/create/update/delete and admin isolation centrally', t => {
  const context = createBoundaryContext();
  t.after(() => context.close());

  for (const collection of TENANT_OWNED_ARRAY_COLLECTIONS) {
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
    assert.equal(context.boundary.readData('unknown_legacy_collection'), null);
    context.boundary.writeData('bot_sessions', { pending: { scenario: 'login_password' } });
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
  assert.equal(runWithTenantActorScope(SCOPE_A, () => context.boundary.readData('bot_sessions').preauth.scenario), 'login_email');
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
  context.state.clients = [];

  const rejected = [
    { id: 'C-1', counterpartyId: 'CP-B' },
    { id: 'C-2', equipmentIds: ['EQ-B'] },
    { id: 'C-3', equipment: [{ equipmentId: 'EQ-B' }] },
    { id: 'C-4', relatedEntityType: 'counterparty', relatedEntityId: 'CP-B' },
    { id: 'C-5', managerId: 'U-B' },
    { id: 'C-6', supplierCounterpartyId: 'CP-B' },
    { id: 'C-7', counterpartyIds: ['CP-B'] },
    { id: 'C-8', assignedToUserId: 'U-B' },
  ];
  for (const record of rejected) {
    assert.throws(
      () => runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('clients', [record])),
      error => error?.code === 'CROSS_TENANT_RELATION_DENIED',
    );
  }
  runWithTenantActorScope(SCOPE_A, () => context.boundary.writeData('clients', [{
    id: 'C-A',
    counterpartyId: 'CP-A',
    equipmentIds: ['EQ-A'],
    managerId: 'U-A',
  }]));
  assert.equal(context.state.clients.at(-1).companyId, 'COMPANY-A');
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
