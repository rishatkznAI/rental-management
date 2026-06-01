import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { registerCrmActivityRoutes } = require('../server/routes/crm-activities.js');
const { normalizeRole } = require('../server/lib/role-groups.js');

function createState() {
  return {
    users: [
      { id: 'U-admin', name: 'Админ', role: 'Администратор', status: 'Активен' },
      { id: 'U-manager', name: 'Руслан', role: 'Менеджер по аренде', status: 'Активен' },
      { id: 'U-other', name: 'Анна', role: 'Менеджер по аренде', status: 'Активен' },
      { id: 'U-investor', name: 'Инвестор', role: 'Инвестор', status: 'Активен' },
    ],
    clients: [
      { id: 'C-1', company: 'ООО План', managerId: 'U-manager', manager: 'Руслан' },
      { id: 'C-2', company: 'ООО Чужой', managerId: 'U-other', manager: 'Анна' },
    ],
    crm_deals: [
      { id: 'D-1', title: 'Аренда XE', status: 'open', responsibleUserId: 'U-manager', responsibleUserName: 'Руслан', clientId: 'C-1', budget: 120000, createdAt: '2026-05-20T10:00:00.000Z' },
      { id: 'D-2', title: 'Выигранная', status: 'won', responsibleUserId: 'U-manager', responsibleUserName: 'Руслан', clientId: 'C-1', budget: 50000, updatedAt: '2026-05-23T10:00:00.000Z' },
    ],
    crm_activities: [],
    rentals: [],
    gantt_rentals: [
      { id: 'GR-1', managerId: 'U-manager', manager: 'Руслан', clientId: 'C-1', equipmentId: 'EQ-1', status: 'active', createdAt: '2026-05-23T10:00:00.000Z' },
    ],
    equipment: [
      { id: 'EQ-1', status: 'available', activeInFleet: true },
      { id: 'EQ-2', status: 'available', activeInFleet: true },
      { id: 'EQ-3', status: 'available', activeInFleet: true },
    ],
  };
}

function createApp(state = createState()) {
  const app = express();
  app.use(express.json());
  const sessions = new Map([
    ['admin-token', 'U-admin'],
    ['manager-token', 'U-manager'],
    ['other-token', 'U-other'],
    ['investor-token', 'U-investor'],
  ]);
  function requireAuth(req, res, next) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/, '');
    const userId = sessions.get(token);
    const user = state.users.find(item => item.id === userId && item.status === 'Активен');
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = { userId: user.id, userName: user.name, userRole: normalizeRole(user.role) };
    return next();
  }
  app.use('/api', registerCrmActivityRoutes({
    readData: name => state[name] || [],
    writeData: (name, value) => { state[name] = value; },
    requireAuth,
    nowIso: () => '2026-05-23T12:00:00.000Z',
    generateId: prefix => `${prefix}-${state.crm_activities.length + 1}`,
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

async function json(baseUrl, method, path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

test('creates call activity and ignores spoofed managerId', async () => {
  const state = createState();
  await withServer(createApp(state), async baseUrl => {
    const response = await json(baseUrl, 'POST', '/api/crm/activities', 'manager-token', {
      type: 'call',
      managerId: 'U-other',
      clientId: 'C-1',
      dealId: 'D-1',
      result: 'completed',
      comment: 'Клиент подтвердил потребность',
      occurredAt: '2026-05-23T09:00:00.000Z',
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.item.managerId, 'U-manager');
    assert.equal(response.body.item.clientName, 'ООО План');
    assert.equal(state.crm_activities.length, 1);
  });
});

test('validates required call and visit fields', async () => {
  await withServer(createApp(), async baseUrl => {
    const noClient = await json(baseUrl, 'POST', '/api/crm/activities', 'manager-token', {
      type: 'call',
      result: 'completed',
      comment: 'Есть итог',
    });
    assert.equal(noClient.status, 400);

    const noResult = await json(baseUrl, 'POST', '/api/crm/activities', 'manager-token', {
      type: 'visit',
      clientId: 'C-1',
      comment: 'На объекте',
    });
    assert.equal(noResult.status, 400);
  });
});

test('creates visit activity and filters by manager date and type', async () => {
  const state = createState();
  state.crm_activities = [
    { id: 'CA-old', type: 'call', managerId: 'U-manager', clientId: 'C-1', result: 'completed', occurredAt: '2026-05-20T10:00:00.000Z', createdAt: '2026-05-20T10:00:00.000Z' },
  ];
  await withServer(createApp(state), async baseUrl => {
    const created = await json(baseUrl, 'POST', '/api/crm/activities', 'manager-token', {
      type: 'visit',
      clientId: 'C-1',
      result: 'completed',
      address: 'Объект на МКАД',
      comment: 'Осмотрели площадку',
      occurredAt: '2026-05-23T10:00:00.000Z',
    });
    assert.equal(created.status, 201);

    const list = await json(baseUrl, 'GET', '/api/crm/activities?managerId=U-manager&type=visit&dateFrom=2026-05-23&dateTo=2026-05-23', 'admin-token');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.items.map(item => item.id), ['CA-2']);
  });
});

test('manager cannot see or attach another manager client while admin sees all kpi', async () => {
  const state = createState();
  state.crm_activities = [
    { id: 'CA-own', type: 'call', managerId: 'U-manager', clientId: 'C-1', result: 'completed', comment: 'ok', occurredAt: '2026-05-23T09:00:00.000Z', createdAt: '2026-05-23T09:00:00.000Z' },
    { id: 'CA-other', type: 'call', managerId: 'U-other', clientId: 'C-2', result: 'completed', comment: 'other', occurredAt: '2026-05-23T09:00:00.000Z', createdAt: '2026-05-23T09:00:00.000Z' },
  ];
  await withServer(createApp(state), async baseUrl => {
    const rejected = await json(baseUrl, 'POST', '/api/crm/activities', 'manager-token', {
      type: 'call',
      clientId: 'C-2',
      result: 'completed',
      comment: 'Чужой клиент',
    });
    assert.equal(rejected.status, 403);

    const managerList = await json(baseUrl, 'GET', '/api/crm/activities', 'manager-token');
    assert.equal(managerList.status, 200);
    assert.deepEqual(managerList.body.items.map(item => item.id), ['CA-own']);

    const adminKpi = await json(baseUrl, 'GET', '/api/crm/manager-kpi?dateFrom=2026-05-23&dateTo=2026-05-23', 'admin-token');
    assert.equal(adminKpi.status, 200);
    assert.equal(adminKpi.body.rows.reduce((sum, row) => sum + row.callsTotal, 0), 2);
  });
});

test('kpi counts qualified calls, unique clients, visits and commercial offers', async () => {
  const state = createState();
  state.crm_activities = [
    { id: 'CA-1', type: 'call', managerId: 'U-manager', clientId: 'C-1', result: 'completed', comment: 'ok', occurredAt: '2026-05-23T09:00:00.000Z', createdAt: '2026-05-23T09:00:00.000Z' },
    { id: 'CA-2', type: 'call', managerId: 'U-manager', clientId: 'C-1', result: 'completed', comment: 'duplicate', occurredAt: '2026-05-23T09:05:00.000Z', createdAt: '2026-05-23T09:05:00.000Z' },
    { id: 'CA-3', type: 'visit', managerId: 'U-manager', clientId: 'C-1', result: 'completed', comment: 'visit', occurredAt: '2026-05-23T11:00:00.000Z', createdAt: '2026-05-23T11:00:00.000Z' },
    { id: 'CA-4', type: 'commercial_offer', managerId: 'U-manager', clientId: 'C-1', result: 'sent', comment: 'kp', occurredAt: '2026-05-23T12:00:00.000Z', createdAt: '2026-05-23T12:00:00.000Z' },
  ];
  await withServer(createApp(state), async baseUrl => {
    const response = await json(baseUrl, 'GET', '/api/crm/manager-kpi?managerId=U-manager&dateFrom=2026-05-23&dateTo=2026-05-23', 'admin-token');
    const row = response.body.rows.find(item => item.managerId === 'U-manager');
    assert.equal(row.callsTotal, 2);
    assert.equal(row.qualifiedCalls, 1);
    assert.equal(row.duplicateCalls, 1);
    assert.equal(row.uniqueCallClients, 1);
    assert.equal(row.visits, 1);
    assert.equal(row.commercialOffers, 1);
    assert.equal(row.createdDeals, 0);
    assert.equal(row.wonDeals, 1);
  });
});

test('investor cannot access crm activities', async () => {
  await withServer(createApp(), async baseUrl => {
    const response = await json(baseUrl, 'GET', '/api/crm/activities', 'investor-token');
    assert.equal(response.status, 403);
  });
});
