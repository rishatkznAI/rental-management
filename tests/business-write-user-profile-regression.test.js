import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

import { createPlatformIdentityContext, seedAuthority, testActor } from './platform-identity-fixtures.js';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const { registerCrudRoutes } = require('../server/routes/crud.js');
const { registerAuthRoutes } = require('../server/routes/auth.js');
const { createAccessControl } = require('../server/lib/access-control.js');
const { createAuditLogger } = require('../server/lib/security-audit.js');
const { assertTenantRelationships } = require('../server/lib/tenant-relationship-guard.js');
const { createTrustedActorScopeResolver, resolveOptionalActorScope } = require('../server/lib/trusted-actor-scope.js');
const {
  createTenantDataBoundary,
  runWithPlatformSystemScope,
  runWithTenantActorScope,
  runWithTenantHistoryRepositoryScope,
} = require('../server/lib/tenant-data-boundary.js');

const COMPANY_A = 'COMPANY-A';
const COMPANY_B = 'COMPANY-B';
const scoped = (companyId, record) => ({ ...record, companyId, tenantId: companyId });
const unrelatedProfiles = {
  owner: { id: 'DEMO-UNRELATED-OWNER', role: 'Инвестор', ownerId: 'DEMO-OWNER', status: 'Активен' },
  carrier: { id: 'DEMO-UNRELATED-CARRIER', role: 'Перевозчик', carrierId: 'DEMO-CARRIER', status: 'Активен', botOnly: true },
};

function businessPayload(collection, suffix = 'NEW') {
  return collection === 'equipment'
    ? { manufacturer: 'Synthetic', model: `Test lift ${suffix}`, inventoryNumber: `TEST-${suffix}`, status: 'available', category: 'own' }
    : { company: `Synthetic client ${suffix}`, inn: '7707083893', status: 'active' };
}

// Synthetic credentials and sessions enter production auth/CRUD routes. Request
// authentication mirrors the server's canonical membership resolution and scope
// runner; access control, relationships, persistence and auditing are real modules.
function createBusinessWriteApp({ profileKinds = ['owner', 'carrier'] } = {}) {
  const users = ['admin', 'A', 'B', 'NONE', 'INACTIVE', 'AMBIGUOUS', 'INACTIVE-COMPANY'].map(id => ({
    id: `U-${id}`, name: `Synthetic ${id}`, email: `${id.toLowerCase()}@example.test`,
    role: 'Администратор', status: 'Активен', password: 'test-only-password',
    // Editable legacy labels are deliberately different from canonical authority.
    companyId: 'LEGACY-NOT-AUTHORITY', tenantId: 'LEGACY-NOT-AUTHORITY',
  }));
  const context = createPlatformIdentityContext({ users });
  for (const companyId of [COMPANY_A, COMPANY_B, 'COMPANY-INACTIVE']) {
    seedAuthority(context, {
      companyId,
      branches: [{ id: `BRANCH-${companyId}`, displayName: companyId, isHeadOffice: true }],
      templateKey: `TEMPLATE-${companyId}`, templateCapabilities: [],
    });
  }
  for (const [principalId, companyId] of [
    ['U-A', COMPANY_A], ['U-B', COMPANY_B], ['U-INACTIVE', COMPANY_A],
    ['U-AMBIGUOUS', COMPANY_A], ['U-AMBIGUOUS', COMPANY_B],
    ['U-INACTIVE-COMPANY', 'COMPANY-INACTIVE'],
  ]) {
    context.repository.createMembership({
      id: `MEMBERSHIP-${principalId}-${companyId}`, principalId, companyId,
      status: 'active', roleTemplateKey: `TEMPLATE-${companyId}`, roleTemplateVersion: 1,
      companyWideBranchAuthority: true, branchIds: [], actorContext: testActor({
        principalId: companyId === COMPANY_A && principalId !== 'U-A' ? 'U-A'
          : companyId === COMPANY_B && principalId !== 'U-B' ? 'U-B' : 'U-admin',
      }),
      reason: 'business-write-regression-fixture',
    });
  }
  context.db.prepare("UPDATE company_memberships SET status = 'inactive', version = version + 1 WHERE principalId = ?").run('U-INACTIVE');
  context.db.prepare("UPDATE canonical_companies SET status = 'inactive', version = version + 1 WHERE id = ?").run('COMPANY-INACTIVE');
  const state = {
    users: [...context.readUsers(), ...profileKinds.map(kind => structuredClone(unrelatedProfiles[kind]))],
    equipment: [scoped(COMPANY_B, { id: 'EQ-B', model: 'Foreign lift', inventoryNumber: 'FOREIGN-B', status: 'available' })],
    counterparties: [scoped(COMPANY_B, { id: 'CP-B', legalName: 'Foreign client', roles: ['customer'], status: 'active' })],
    clients: [scoped(COMPANY_B, { id: 'CLIENT-B', counterpartyId: 'CP-B', company: 'Foreign client', status: 'active' })],
    owners: [scoped(COMPANY_B, { id: 'OWNER-B', name: 'Foreign owner' })],
    audit_logs: [],
  };
  const selectRaw = context.db.prepare('SELECT json FROM app_data WHERE name = ?');
  const upsertRaw = context.db.prepare('INSERT OR REPLACE INTO app_data (name, json) VALUES (?, ?)');
  for (const [name, value] of Object.entries(state)) upsertRaw.run(name, JSON.stringify(value));
  const readRawData = name => {
    const row = selectRaw.get(name);
    return row ? JSON.parse(row.json) : null;
  };
  const rawWrites = [];
  const writeRawData = (name, value) => {
    upsertRaw.run(name, JSON.stringify(value));
    rawWrites.push(name);
  };
  const writeRawDataBatch = context.db.transaction(entries => {
    for (const { name, value } of entries) writeRawData(name, value);
  });
  const boundary = createTenantDataBoundary({
    db: context.db, readRawData, writeRawData, writeRawDataBatch,
    assertRelationships: assertTenantRelationships,
  });
  const resolveActorScope = createTrustedActorScopeResolver({ db: context.db });
  let sequence = 0;
  const generateId = prefix => `${prefix}-REGRESSION-${++sequence}`;
  const sessions = new Map(users.map(user => [`token-${user.id}`, { userId: user.id }]));
  const auditLog = createAuditLogger({
    readData: boundary.readData, writeData: boundary.writeData, generateId,
    withTenantScope: (scope, operation) => runWithTenantHistoryRepositoryScope({
      scope, reason: 'security-audit-event', writableCollections: ['audit_logs'],
    }, operation),
    withSystemScope: operation => runWithPlatformSystemScope({
      reason: 'security-audit-event', writableCollections: ['audit_logs'],
    }, operation),
  });
  const app = express();
  app.use(express.json());
  function requireAuth(req, res, next) {
    const session = sessions.get(String(req.headers.authorization || '').replace(/^Bearer /, ''));
    const user = session && readRawData('users').find(row => row.id === session.userId);
    if (!user || user.status !== 'Активен') return res.status(401).json({ code: 'UNAUTHORIZED' });
    const scope = resolveOptionalActorScope(resolveActorScope, user.id);
    if (!scope) return res.status(403).json({ code: 'ACTOR_SCOPE_INCOMPLETE' });
    req.actorScope = scope;
    req.user = { userId: user.id, userName: user.name, userRole: user.role, ...scope };
    return runWithTenantActorScope(scope, next);
  }
  const requireCollection = collection => (req, res, next) => (
    ['equipment', 'clients'].includes(collection) && req.user.userRole === 'Администратор'
      ? next() : res.status(403).json({ code: 'FORBIDDEN' })
  );
  registerAuthRoutes(app, {
    readAuthUsers: () => readRawData('users'),
    readData: boundary.readData, writeData: boundary.writeData,
    verifyPassword: (plain, stored) => plain === stored,
    needsPasswordRehash: () => false,
    resolveActorScope: principalId => resolveOptionalActorScope(resolveActorScope, principalId),
    requireActorScopeOnLogin: true,
    createSession: user => {
      const token = `login-${generateId('SESSION')}`;
      sessions.set(token, { userId: user.id });
      return token;
    },
    requireAuth, destroySession: token => sessions.delete(token), auditLog,
  });
  app.use('/api', registerCrudRoutes({
    collections: ['equipment', 'clients'], idPrefixes: { equipment: 'EQ', clients: 'CLIENT' },
    readData: boundary.readData, writeData: boundary.writeData, writeDataBatch: boundary.writeDataBatch,
    requireAuth, requireRead: requireCollection, requireWrite: requireCollection,
    accessControl: createAccessControl({ readData: boundary.readData }), auditLog,
    generateId, nowIso: () => '2026-09-06T12:00:00.000Z',
    mergeEntityHistory: (_collection, _previous, next) => next,
  }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code, error: error.message }));
  return {
    ...context, app, boundary, readRawData, rawWrites, resolveActorScope,
    snapshot: () => context.db.prepare('SELECT name, json FROM app_data ORDER BY name').all(),
  };
}

for (const [principal, reason] of [
  ['U-NONE', 'missing membership'],
  ['U-INACTIVE', 'inactive membership'],
  ['U-AMBIGUOUS', 'ambiguous membership'],
  ['U-INACTIVE-COMPANY', 'inactive company'],
]) {
  test(`business writes fail closed for ${reason} despite forged request scope`, async t => {
    const context = createBusinessWriteApp();
    t.after(() => context.close());
    assert.throws(() => context.resolveActorScope(principal), error => error.code === 'ACTOR_SCOPE_INCOMPLETE');
    await withServer(context, async base => {
      const login = await request(base, 'POST', '/api/auth/login', {
        body: { email: `${principal.slice(2).toLowerCase()}@example.test`, password: 'test-only-password' },
      });
      assert.equal(login.status, 403, reason);
      assert.equal(login.body.code, 'ACTOR_SCOPE_INCOMPLETE', reason);
      assert.equal(Object.hasOwn(login.body, 'token'), false);
      for (const collection of ['equipment', 'clients']) {
        const before = context.snapshot();
        const response = await request(base, 'POST', `/api/${collection}?companyId=${COMPANY_A}&tenantId=${COMPANY_A}`, {
          principal,
          body: { ...businessPayload(collection), companyId: COMPANY_A, tenantId: COMPANY_A, ownerId: 'U-A' },
          headers: { 'x-company-id': COMPANY_A, 'x-tenant-id': COMPANY_A, 'x-user-id': 'U-A' },
        });
        assert.equal(response.status, 403, reason);
        assert.equal(response.body.code, 'ACTOR_SCOPE_INCOMPLETE', reason);
        assert.deepEqual(context.snapshot(), before, `${reason}: no partial writes`);
      }
    });
  });
}

for (const collection of ['equipment', 'clients']) {
  test(`${collection}: body companyId and tenantId cannot set or transfer scope`, async t => {
    const context = createBusinessWriteApp();
    t.after(() => context.close());
    await withServer(context, async base => {
      for (const spoof of [
        { companyId: COMPANY_B }, { tenantId: COMPANY_B },
        { companyId: COMPANY_B, tenantId: COMPANY_B },
      ]) {
        const before = context.snapshot();
        const response = await request(base, 'POST', `/api/${collection}`, {
          body: { ...businessPayload(collection), ...spoof },
        });
        assert.equal(response.status, collection === 'clients' ? 409 : 403, JSON.stringify(response.body));
        assert.equal(response.body.code, collection === 'clients'
          ? 'MASTER_DATA_SCOPE_CLIENT_SUPPLIED' : 'TENANT_SCOPE_SPOOFING_DENIED');
        assert.deepEqual(context.snapshot(), before);
      }
    });
  });

  test(`${collection}: foreign ownership field cannot grant another company's scope`, async t => {
    const context = createBusinessWriteApp();
    t.after(() => context.close());
    await withServer(context, async base => {
      const before = context.snapshot();
      const response = await request(base, 'POST', `/api/${collection}`, {
        body: { ...businessPayload(collection), ownerId: 'OWNER-B' },
      });
      assert.ok(response.status >= 400 && response.status < 500, JSON.stringify(response));
      if (collection === 'equipment') assert.equal(response.body.code, 'CROSS_TENANT_RELATION_DENIED');
      assert.deepEqual(context.snapshot(), before);
    });
  });

  test(`${collection}: query and headers cannot override trusted membership on create or list`, async t => {
    const context = createBusinessWriteApp();
    t.after(() => context.close());
    const query = `?companyId=${COMPANY_B}&tenantId=${COMPANY_B}&membershipId=MEMBERSHIP-U-B-${COMPANY_B}`;
    const headers = { 'x-company-id': COMPANY_B, 'x-tenant-id': COMPANY_B, 'x-user-id': 'U-B' };
    await withServer(context, async base => {
      const response = await request(base, 'POST', `/api/${collection}${query}`, {
        headers, body: businessPayload(collection),
      });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      const stored = context.readRawData(collection).find(row => row.id === response.body.id);
      assert.equal(stored.companyId, COMPANY_A);
      assert.equal(stored.tenantId, COMPANY_A);
      const list = await request(base, 'GET', `/api/${collection}${query}`, { headers });
      assert.equal(list.status, 200, JSON.stringify(list.body));
      assert.deepEqual(list.body.map(row => row.id), [stored.id]);
    });
  });

  test(`${collection}: foreign GET PATCH DELETE remain invisible and non-mutating`, async t => {
    const context = createBusinessWriteApp();
    t.after(() => context.close());
    const foreignId = collection === 'equipment' ? 'EQ-B' : 'CLIENT-B';
    await withServer(context, async base => {
      for (const method of ['GET', 'PATCH', 'DELETE']) {
        const before = context.snapshot();
        const response = await request(base, method, `/api/${collection}/${foreignId}?companyId=${COMPANY_B}&tenantId=${COMPANY_B}`, {
          headers: { 'x-company-id': COMPANY_B, 'x-tenant-id': COMPANY_B },
          ...(method === 'PATCH' ? { body: collection === 'equipment' ? { model: 'Spoofed update' } : { company: 'Spoofed update' } } : {}),
        });
        assert.equal(response.status, collection === 'clients' && method === 'DELETE' ? 405 : 404,
          `${method}: ${JSON.stringify(response.body)}`);
        if (collection === 'clients' && method === 'DELETE') {
          assert.equal(response.body.code, 'DOMAIN_LIFECYCLE_ENDPOINT_REQUIRED');
        }
        assert.deepEqual(context.snapshot(), before, `${method}: state changed`);
      }
    });
  });
}

async function withServer(context, operation) {
  const server = context.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    await operation(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function request(base, method, route, { principal = 'U-A', token = `token-${principal}`, body, headers = {} } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

for (const profileKinds of [[], ['owner'], ['carrier'], ['owner', 'carrier']]) {
  for (const collection of ['equipment', 'clients']) {
    test(`business write: ${collection} create succeeds with ${profileKinds.join('+') || 'no'} unrelated invalid profiles`, async t => {
      const context = createBusinessWriteApp({ profileKinds });
      t.after(() => context.close());
      const usersBefore = context.readRawData('users');
      const membershipsBefore = context.db.prepare('SELECT * FROM company_memberships ORDER BY id').all();
      assert.equal(context.resolveActorScope('U-A').companyId, COMPANY_A);
      const foreignBefore = context.readRawData(collection).filter(row => row.companyId === COMPANY_B);
      await withServer(context, async base => {
        const login = await request(base, 'POST', '/api/auth/login', {
          body: { email: 'a@example.test', password: 'test-only-password' },
        });
        assert.equal(login.status, 200, JSON.stringify(login.body));
        const body = businessPayload(collection);
        assert.equal(Object.hasOwn(body, 'managerId'), false);
        assert.equal(Object.hasOwn(body, 'manager'), false);
        const created = await request(base, 'POST', `/api/${collection}`, { token: login.body.token, body });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        const stored = context.readRawData(collection).find(row => row.id === created.body.id);
        assert.equal(stored.companyId, COMPANY_A);
        assert.equal(stored.tenantId, COMPANY_A);
        if (collection === 'clients') {
          const counterparty = context.readRawData('counterparties').find(row => row.id === stored.counterpartyId);
          assert.equal(counterparty.companyId, COMPANY_A);
          assert.equal(counterparty.tenantId, COMPANY_A);
        }
        const reread = await request(base, 'GET', `/api/${collection}/${created.body.id}`);
        assert.equal(reread.status, 200);
        assert.equal(reread.body.id, stored.id);
        assert.deepEqual(context.readRawData('users'), usersBefore);
        assert.deepEqual(context.db.prepare('SELECT * FROM company_memberships ORDER BY id').all(), membershipsBefore);
        assert.deepEqual(context.readRawData(collection).filter(row => row.companyId === COMPANY_B), foreignBefore);
      });
    });
  }
}
