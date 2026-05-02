import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const { normalizeRole } = require('../server/lib/role-groups.js');
const { registerDebtCollectionPlanRoutes } = require('../server/routes/debt-collection-plans.js');
const { createAuditLogger } = require('../server/lib/security-audit.js');

const READ_PERMISSIONS = {
  debt_collection_plans: ['Администратор', 'Менеджер по аренде', 'Менеджер по продажам', 'Офис-менеджер'],
  payments: ['Администратор', 'Менеджер по аренде', 'Менеджер по продажам', 'Офис-менеджер'],
};

const WRITE_PERMISSIONS = {
  debt_collection_plans: ['Администратор', 'Офис-менеджер'],
};

function createState(overrides = {}) {
  return {
    users: [
      { id: 'U-admin', name: 'Админ', email: 'admin@example.test', role: 'Администратор', status: 'Активен' },
      { id: 'U-office', name: 'Офис', email: 'office@example.test', role: 'Офис-менеджер', status: 'Активен' },
      { id: 'U-manager', name: 'Руслан', email: 'manager@example.test', role: 'Менеджер по аренде', status: 'Активен' },
      { id: 'U-mechanic', name: 'Петров', email: 'mechanic@example.test', role: 'Механик', status: 'Активен' },
    ],
    clients: [{ id: 'C-1', company: 'ООО Должник', manager: 'Руслан' }],
    rentals: [],
    gantt_rentals: [{ id: 'GR-1', clientId: 'C-1', client: 'ООО Должник', manager: 'Руслан' }],
    payments: [],
    debt_collection_plans: [],
    audit_logs: [],
    ...overrides,
  };
}

function createApp(state = createState()) {
  const app = express();
  app.use(express.json());
  const readData = name => state[name] || [];
  const writeData = (name, value) => { state[name] = value; };
  const accessControl = createAccessControl({ readData });
  const sessions = new Map([
    ['admin-token', 'U-admin'],
    ['office-token', 'U-office'],
    ['manager-token', 'U-manager'],
    ['mechanic-token', 'U-mechanic'],
  ]);

  function requireAuth(req, res, next) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const userId = sessions.get(token);
    const user = state.users.find(item => item.id === userId);
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = {
      userId: user.id,
      userName: user.name,
      userRole: normalizeRole(user.role),
      rawRole: user.role,
      normalizedRole: normalizeRole(user.role),
      email: user.email,
    };
    return next();
  }

  function canReadCollection(req, collection) {
    const allowed = READ_PERMISSIONS[collection] || ['Администратор'];
    return allowed.includes(normalizeRole(req.user?.userRole));
  }

  function requireRead(collection) {
    return (req, res, next) => canReadCollection(req, collection)
      ? next()
      : res.status(403).json({ ok: false, error: 'Forbidden' });
  }

  function requireWrite(collection) {
    return (req, res, next) => {
      const allowed = WRITE_PERMISSIONS[collection] || ['Администратор'];
      return allowed.includes(normalizeRole(req.user?.userRole))
        ? next()
        : res.status(403).json({ ok: false, error: 'Forbidden' });
    };
  }

  app.use('/api', registerDebtCollectionPlanRoutes({
    readData,
    writeData,
    requireAuth,
    requireRead,
    requireWrite,
    canReadCollection,
    accessControl,
    auditLog: createAuditLogger({
      readData,
      writeData,
      generateId: prefix => `${prefix}-${state.audit_logs.length + 1}`,
      nowIso: () => '2026-05-02T10:00:00.000Z',
      logger: { warn() {} },
    }),
    generateId: prefix => `${prefix}-1`,
    idPrefixes: { debt_collection_plans: 'DCP' },
    nowIso: () => '2026-05-02T10:00:00.000Z',
  }));
  return app;
}

async function withServer(app, fn) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function request(baseUrl, method, path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('debt collection plans API handles empty collection and auth', async () => {
  const app = createApp();
  await withServer(app, async (baseUrl) => {
    assert.equal((await request(baseUrl, 'GET', '/api/debt-collection-plans')).status, 401);
    assert.equal((await request(baseUrl, 'GET', '/api/debt-collection-plans', 'mechanic-token')).status, 403);
    const response = await request(baseUrl, 'GET', '/api/debt-collection-plans', 'manager-token');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.plans, []);
    assert.equal(response.body.permissions.canViewFinance, true);
  });
});

test('admin and office can create plan, manager cannot mutate', async () => {
  const state = createState();
  const app = createApp(state);
  await withServer(app, async (baseUrl) => {
    const forbidden = await request(baseUrl, 'POST', '/api/debt-collection-plans', 'manager-token', {
      clientId: 'C-1',
      clientName: 'ООО Должник',
    });
    assert.equal(forbidden.status, 403);

    const created = await request(baseUrl, 'POST', '/api/debt-collection-plans', 'office-token', {
      clientId: 'C-1',
      clientName: 'ООО Должник',
      status: 'new',
      priority: 'high',
      nextActionType: 'call',
      nextActionDate: '2026-05-03',
      comment: 'Позвонить бухгалтерии',
      password: 'must-not-persist',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.id, 'DCP-1');
    assert.equal(created.body.password, undefined);
    assert.equal(state.debt_collection_plans.length, 1);
    assert.equal(state.audit_logs[0].action, 'debt_collection_plans.create');
  });
});

test('status update writes safe audit without sensitive fields', async () => {
  const state = createState({
    debt_collection_plans: [{
      id: 'DCP-1',
      clientId: 'C-1',
      clientName: 'ООО Должник',
      status: 'new',
      priority: 'medium',
      nextActionType: 'call',
      createdAt: '2026-05-01T10:00:00.000Z',
      updatedAt: '2026-05-01T10:00:00.000Z',
    }],
  });
  const app = createApp(state);
  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'PATCH', '/api/debt-collection-plans/DCP-1', 'admin-token', {
      status: 'promised',
      promisedPaymentDate: '2026-05-10',
      comment: 'Обещал оплатить',
      token: 'hidden',
      apiKey: 'hidden',
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'promised');
    assert.equal(response.body.token, undefined);

    const actions = state.audit_logs.map(entry => entry.action);
    assert.ok(actions.includes('debt_collection_plans.update'));
    assert.ok(actions.includes('debt_collection_plans.status_change'));
    assert.ok(actions.includes('debt_collection_plans.comment'));
    assert.doesNotMatch(JSON.stringify(state.audit_logs), /hidden|token|apiKey|password/i);
  });
});

test('manager sees only scoped plans and no financial sums are returned by plan endpoint', async () => {
  const state = createState({
    clients: [
      { id: 'C-1', company: 'ООО Должник', manager: 'Руслан' },
      { id: 'C-2', company: 'ООО Чужой', manager: 'Анна' },
    ],
    debt_collection_plans: [
      { id: 'DCP-1', clientId: 'C-1', clientName: 'ООО Должник', responsibleName: 'Руслан', status: 'new', priority: 'high', nextActionType: 'call' },
      { id: 'DCP-2', clientId: 'C-2', clientName: 'ООО Чужой', responsibleName: 'Анна', status: 'new', priority: 'critical', nextActionType: 'email', amount: 999999 },
    ],
  });
  const app = createApp(state);
  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'GET', '/api/debt-collection-plans', 'manager-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.plans.length, 1);
    assert.equal(response.body.plans[0].id, 'DCP-1');
    assert.doesNotMatch(JSON.stringify(response.body), /999999|amount|debt/i);
  });
});
