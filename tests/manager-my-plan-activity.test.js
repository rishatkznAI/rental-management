import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { registerManagerMyPlanRoutes } = require('../server/routes/manager-my-plan.js');
const { normalizeRole } = require('../server/lib/role-groups.js');

const READ_PERMISSIONS = {
  equipment: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  rentals: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер', 'Руководитель'],
  gantt_rentals: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер', 'Руководитель'],
  clients: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  payments: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  documents: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  service: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
};

function createState() {
  return {
    users: [
      { id: 'U-manager', name: 'Руслан', role: 'Менеджер по аренде', status: 'Активен' },
      { id: 'U-other', name: 'Анна', role: 'Менеджер по аренде', status: 'Активен' },
      { id: 'U-admin', name: 'Админ', role: 'Администратор', status: 'Активен' },
      { id: 'U-sales', name: 'Светлана', role: 'Менеджер по продажам', status: 'Активен' },
    ],
    equipment: Array.from({ length: 5 }, (_, index) => ({
      id: `EQ-${index + 1}`,
      inventoryNumber: `10${index + 1}`,
      status: 'available',
      activeInFleet: true,
      category: 'own',
    })),
    rentals: [],
    gantt_rentals: [
      { id: 'GR-1', managerId: 'U-manager', manager: 'Руслан', clientId: 'C-1', client: 'ООО План', equipmentId: 'EQ-1', status: 'active', plannedReturnDate: '2026-05-30' },
      { id: 'GR-2', managerId: 'U-manager', manager: 'Руслан', clientId: 'C-1', client: 'ООО План', equipmentId: 'EQ-2', status: 'active', plannedReturnDate: '2026-05-30' },
      { id: 'GR-3', managerId: 'U-manager', manager: 'Руслан', clientId: 'C-1', client: 'ООО План', equipmentId: 'EQ-3', status: 'active', plannedReturnDate: '2026-05-30' },
    ],
    clients: [{ id: 'C-1', company: 'ООО План', managerId: 'U-manager', manager: 'Руслан' }],
    payments: [],
    documents: [],
    service: [],
    manager_activity: [
      { id: 'MA-other', createdAt: '2026-05-23T08:00:00.000Z', userId: 'U-other', managerId: 'U-other', activityType: 'call', resultStatus: 'completed', comment: 'Чужая запись', activityDate: '2026-05-23', effectiveAt: '2026-05-23T08:00:00.000Z' },
    ],
  };
}

function accessSummary(role) {
  const normalizedRole = normalizeRole(role);
  return {
    normalizedRole,
    readableCollections: Object.entries(READ_PERMISSIONS)
      .filter(([, roles]) => roles.includes(normalizedRole))
      .map(([collection]) => collection),
    writableCollections: [],
  };
}

function createApp(state = createState()) {
  const app = express();
  app.use(express.json());
  const sessions = new Map([
    ['manager-token', { userId: 'U-manager' }],
    ['admin-token', { userId: 'U-admin' }],
    ['sales-token', { userId: 'U-sales' }],
  ]);
  const readData = name => state[name] || [];
  const writeData = (name, value) => { state[name] = value; };
  function requireAuth(req, res, next) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    const session = sessions.get(auth.slice(7));
    const user = state.users.find(item => item.id === session?.userId && item.status === 'Активен');
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = {
      userId: user.id,
      userName: user.name,
      userRole: normalizeRole(user.role),
    };
    return next();
  }
  app.use('/api', registerManagerMyPlanRoutes({
    readData,
    writeData,
    requireAuth,
    getRoleAccessSummary: accessSummary,
    todayKey: '2026-05-23',
    nowIso: () => '2026-05-23T10:00:00.000Z',
    generateId: prefix => `${prefix}-${state.manager_activity.length + 1}`,
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
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

function assertNoUnsafePayload(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /undefined|null|\[object Object\]/);
  assert.doesNotMatch(serialized, /password|token|cookie|secret|private[_-]?key|authorization|hash/i);
}

test('manager can create own activity and spoofed managerId is ignored', async () => {
  const state = createState();

  await withServer(createApp(state), async baseUrl => {
    const response = await json(baseUrl, 'POST', '/api/manager/my-plan/activity', 'manager-token', {
      managerId: 'U-other',
      activityType: 'call',
      resultStatus: 'completed',
      relatedClientId: 'C-1',
      comment: 'Клиент подтвердил интерес',
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.item.managerId, 'U-manager');
    assert.equal(state.manager_activity.at(-1).managerId, 'U-manager');
    assert.equal(state.manager_activity.at(-1).activityType, 'call');
    assertNoUnsafePayload(response.body);
  });
});

test('manager cannot attach or read labels for another manager client', async () => {
  const state = createState();
  state.clients.push({ id: 'C-other', company: 'ООО Чужой', managerId: 'U-other', manager: 'Анна' });
  state.manager_activity.push({
    id: 'MA-poison-client',
    createdAt: '2026-05-23T09:30:00.000Z',
    userId: 'U-manager',
    managerId: 'U-manager',
    activityType: 'note',
    resultStatus: 'info',
    relatedClientId: 'C-other',
    comment: 'Старая запись с чужим clientId',
    activityDate: '2026-05-23',
    effectiveAt: '2026-05-23T09:30:00.000Z',
  });

  await withServer(createApp(state), async baseUrl => {
    const rejected = await json(baseUrl, 'POST', '/api/manager/my-plan/activity', 'manager-token', {
      activityType: 'note',
      resultStatus: 'info',
      relatedClientId: 'C-other',
      comment: 'Попытка привязать чужого клиента',
    });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.body.error, 'Связанная сущность недоступна');

    const response = await json(baseUrl, 'GET', '/api/manager/my-plan/activity', 'manager-token');
    assert.equal(response.status, 200);
    const item = response.body.items.find(row => row.id === 'MA-poison-client');
    assert.ok(item);
    assert.equal(item.relatedClientId, '');
    assert.equal(item.relatedLabel, '');
    assert.doesNotMatch(JSON.stringify(response.body), /C-other|ООО Чужой/);
    assertNoUnsafePayload(response.body);
  });
});

test('manager cannot attach or read labels for another manager rental', async () => {
  const state = createState();
  state.gantt_rentals.push({
    id: 'GR-other',
    managerId: 'U-other',
    manager: 'Анна',
    clientId: 'C-other',
    client: 'ООО Чужая аренда',
    equipmentId: 'EQ-5',
    status: 'active',
    plannedReturnDate: '2026-05-30',
  });
  state.manager_activity.push({
    id: 'MA-poison-rental',
    createdAt: '2026-05-23T09:30:00.000Z',
    userId: 'U-manager',
    managerId: 'U-manager',
    activityType: 'note',
    resultStatus: 'info',
    relatedRentalId: 'GR-other',
    comment: 'Старая запись с чужим rentalId',
    activityDate: '2026-05-23',
    effectiveAt: '2026-05-23T09:30:00.000Z',
  });

  await withServer(createApp(state), async baseUrl => {
    const rejected = await json(baseUrl, 'POST', '/api/manager/my-plan/activity', 'manager-token', {
      activityType: 'note',
      resultStatus: 'info',
      relatedRentalId: 'GR-other',
      comment: 'Попытка привязать чужую аренду',
    });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.body.error, 'Связанная сущность недоступна');

    const response = await json(baseUrl, 'GET', '/api/manager/my-plan/activity', 'manager-token');
    assert.equal(response.status, 200);
    const item = response.body.items.find(row => row.id === 'MA-poison-rental');
    assert.ok(item);
    assert.equal(item.relatedRentalId, '');
    assert.equal(item.relatedLabel, '');
    assert.doesNotMatch(JSON.stringify(response.body), /GR-other|ООО Чужая аренда/);
    assertNoUnsafePayload(response.body);
  });
});

test('manager cannot attach or read labels for equipment only tied to another manager', async () => {
  const state = createState();
  state.equipment[4] = {
    id: 'EQ-5',
    inventoryNumber: '999',
    name: 'Чужой подъемник',
    status: 'available',
    activeInFleet: true,
    category: 'own',
  };
  state.gantt_rentals.push({
    id: 'GR-other-equipment',
    managerId: 'U-other',
    manager: 'Анна',
    clientId: 'C-other',
    client: 'ООО Чужая техника',
    equipmentId: 'EQ-5',
    status: 'active',
    plannedReturnDate: '2026-05-30',
  });
  state.manager_activity.push({
    id: 'MA-poison-equipment',
    createdAt: '2026-05-23T09:30:00.000Z',
    userId: 'U-manager',
    managerId: 'U-manager',
    activityType: 'note',
    resultStatus: 'info',
    relatedEquipmentId: 'EQ-5',
    comment: 'Старая запись с чужим equipmentId',
    activityDate: '2026-05-23',
    effectiveAt: '2026-05-23T09:30:00.000Z',
  });

  await withServer(createApp(state), async baseUrl => {
    const rejected = await json(baseUrl, 'POST', '/api/manager/my-plan/activity', 'manager-token', {
      activityType: 'note',
      resultStatus: 'info',
      relatedEquipmentId: 'EQ-5',
      comment: 'Попытка привязать чужую технику',
    });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.body.error, 'Связанная сущность недоступна');

    const response = await json(baseUrl, 'GET', '/api/manager/my-plan/activity', 'manager-token');
    assert.equal(response.status, 200);
    const item = response.body.items.find(row => row.id === 'MA-poison-equipment');
    assert.ok(item);
    assert.equal(item.relatedEquipmentId, '');
    assert.equal(item.relatedLabel, '');
    assert.doesNotMatch(JSON.stringify(response.body), /EQ-5|999|Чужой подъемник|ООО Чужая техника/);
    assertNoUnsafePayload(response.body);
  });
});

test('manager can attach and read labels for own scoped client rental and equipment', async () => {
  const state = createState();

  await withServer(createApp(state), async baseUrl => {
    const created = await json(baseUrl, 'POST', '/api/manager/my-plan/activity', 'manager-token', {
      activityType: 'site_visit',
      resultStatus: 'completed',
      relatedClientId: 'C-1',
      relatedRentalId: 'GR-1',
      relatedEquipmentId: 'EQ-1',
      comment: 'Выезд по своей аренде',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.item.relatedClientId, 'C-1');
    assert.equal(created.body.item.relatedRentalId, 'GR-1');
    assert.equal(created.body.item.relatedEquipmentId, 'EQ-1');
    assert.equal(created.body.item.relatedLabel, 'ООО План');

    const response = await json(baseUrl, 'GET', '/api/manager/my-plan/activity', 'manager-token');
    assert.equal(response.status, 200);
    const item = response.body.items.find(row => row.id === created.body.item.id);
    assert.ok(item);
    assert.equal(item.relatedLabel, 'ООО План');
    assertNoUnsafePayload(response.body);
  });
});

test('admin can attach and read broader related activity labels', async () => {
  const state = createState();
  state.clients.push({ id: 'C-other', company: 'ООО Чужой', managerId: 'U-other', manager: 'Анна' });
  state.gantt_rentals.push({
    id: 'GR-other',
    managerId: 'U-other',
    manager: 'Анна',
    clientId: 'C-other',
    client: 'ООО Чужой',
    equipmentId: 'EQ-5',
    status: 'active',
    plannedReturnDate: '2026-05-30',
  });

  await withServer(createApp(state), async baseUrl => {
    const created = await json(baseUrl, 'POST', '/api/manager/my-plan/activity', 'admin-token', {
      activityType: 'note',
      resultStatus: 'info',
      relatedClientId: 'C-other',
      relatedRentalId: 'GR-other',
      relatedEquipmentId: 'EQ-5',
      comment: 'Админская проверка связанной сущности',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.item.relatedLabel, 'ООО Чужой');

    const response = await json(baseUrl, 'GET', '/api/manager/my-plan/activity', 'admin-token');
    assert.equal(response.status, 200);
    assert.ok(response.body.items.some(item => item.relatedLabel === 'ООО Чужой'));
    assertNoUnsafePayload(response.body);
  });
});

test('activity endpoint auth and role checks are enforced', async () => {
  await withServer(createApp(), async baseUrl => {
    assert.equal((await json(baseUrl, 'GET', '/api/manager/my-plan/activity')).status, 401);
    assert.equal((await json(baseUrl, 'POST', '/api/manager/my-plan/activity')).status, 401);
    assert.equal((await json(baseUrl, 'GET', '/api/manager/my-plan/activity', 'sales-token')).status, 403);
    assert.equal((await json(baseUrl, 'POST', '/api/manager/my-plan/activity', 'sales-token', { activityType: 'call' })).status, 403);
  });
});

test('manager cannot read another manager activity via query param', async () => {
  const state = createState();
  state.manager_activity.push({
    id: 'MA-own',
    createdAt: '2026-05-23T09:00:00.000Z',
    userId: 'U-manager',
    managerId: 'U-manager',
    activityType: 'site_visit',
    resultStatus: 'completed',
    comment: 'Выезд на объект',
    activityDate: '2026-05-23',
    effectiveAt: '2026-05-23T09:00:00.000Z',
  });

  await withServer(createApp(state), async baseUrl => {
    const response = await json(baseUrl, 'GET', '/api/manager/my-plan/activity?managerId=U-other', 'manager-token');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.items.map(item => item.id), ['MA-own']);
    assert.equal(response.body.items.some(item => item.id === 'MA-other'), false);
    assertNoUnsafePayload(response.body);
  });
});

test('GET my-plan aggregates activity progress and low utilization targets', async () => {
  const state = createState();
  state.manager_activity.push(
    { id: 'MA-1', createdAt: '2026-05-23T09:00:00.000Z', userId: 'U-manager', managerId: 'U-manager', activityType: 'call', resultStatus: 'completed', comment: 'Звонок', activityDate: '2026-05-23', effectiveAt: '2026-05-23T09:00:00.000Z' },
    { id: 'MA-2', createdAt: '2026-05-20T09:00:00.000Z', userId: 'U-manager', managerId: 'U-manager', activityType: 'site_visit', resultStatus: 'completed', comment: 'Выезд', activityDate: '2026-05-20', effectiveAt: '2026-05-20T09:00:00.000Z' },
  );

  await withServer(createApp(state), async baseUrl => {
    const response = await json(baseUrl, 'GET', '/api/manager/my-plan', 'manager-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.summary.planStatus, 'needs_activity');
    assert.equal(response.body.activityTarget.dailyCallsTarget, 40);
    assert.equal(response.body.activityTarget.weeklySiteVisitsTarget, 2);
    assert.equal(response.body.activityTarget.todayCallsDone, 1);
    assert.equal(response.body.activityTarget.todayCallsTarget, 40);
    assert.equal(response.body.activityTarget.weekSiteVisitsDone, 1);
    assert.equal(response.body.activityTarget.weekSiteVisitsTarget, 2);
    assert.equal(response.body.activityTarget.activityProgressStatus, 'in_progress');
    assert.ok(Array.isArray(response.body.recentActivity));
    assertNoUnsafePayload(response.body);
  });
});
