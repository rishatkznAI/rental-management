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
      { id: 'U-admin', name: 'Админ', role: 'Администратор', status: 'Активен' },
      { id: 'U-sales', name: 'Светлана', role: 'Менеджер по продажам', status: 'Активен' },
    ],
    equipment: [],
    rentals: [],
    gantt_rentals: [],
    clients: [],
    payments: [],
    documents: [],
    service: [],
    manager_activity: [],
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

async function getJson(baseUrl, path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

function addFleet(state, rentedCount) {
  state.equipment = Array.from({ length: 5 }, (_, index) => ({
    id: `EQ-${index + 1}`,
    inventoryNumber: `10${index + 1}`,
    manufacturer: 'JLG',
    model: `M${index + 1}`,
    status: 'available',
    activeInFleet: true,
    category: 'own',
  }));
  state.gantt_rentals = Array.from({ length: rentedCount }, (_, index) => ({
    id: `GR-${index + 1}`,
    managerId: 'U-manager',
    manager: 'Руслан',
    clientId: 'C-1',
    client: 'ООО План',
    equipmentId: `EQ-${index + 1}`,
    status: 'active',
    startDate: '2026-05-01',
    plannedReturnDate: index === 0 ? '2026-05-23' : '2026-05-30',
    debt: index === 0 ? 15000 : 0,
  }));
  state.clients = [
    { id: 'C-1', company: 'ООО План', managerId: 'U-manager', manager: 'Руслан', lastRentalDate: '2026-05-01' },
    { id: 'C-2', company: 'ООО Тихий', managerId: 'U-manager', manager: 'Руслан', lastRentalDate: '2026-03-01' },
  ];
  state.documents = [
    { id: 'D-1', type: 'rental_contract', status: 'signed', number: 'Д-1', clientId: 'C-1', rentalId: 'GR-1' },
    { id: 'D-2', type: 'upd', status: 'pending_signature', number: 'УПД-1', clientId: 'C-1', rentalId: 'GR-1' },
  ];
}

function assertNoNullUndefinedOrObjectString(value) {
  const json = JSON.stringify(value);
  assert.doesNotMatch(json, /undefined|null|\[object Object\]/);
}

function assertNoSecrets(value) {
  assert.doesNotMatch(JSON.stringify(value), /password|token|cookie|secret|private[_-]?key|authorization|hash/i);
}

test('manager can access own plan and response shape is stable', async () => {
  const state = createState();
  addFleet(state, 3);
  const before = JSON.stringify(state);

  await withServer(createApp(state), async baseUrl => {
    const response = await getJson(baseUrl, '/api/manager/my-plan', 'manager-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.summary.managerName, 'Руслан');
    assert.equal(response.body.summary.planStatus, 'needs_activity');
    assert.equal(response.body.activityTarget.required, true);
    assert.equal(response.body.activityTarget.dailyCallsTarget, 40);
    assert.equal(response.body.activityTarget.weeklySiteVisitsTarget, 2);
    assert.ok(Array.isArray(response.body.tasks));
    assert.ok(Array.isArray(response.body.rentals.endingToday));
    assert.ok(Array.isArray(response.body.money.debtors));
    assert.ok(Array.isArray(response.body.documents.unsigned));
    assert.ok(Array.isArray(response.body.clients.withoutRecentActivity));
    assertNoNullUndefinedOrObjectString(response.body);
    assertNoSecrets(response.body);
  });

  assert.equal(JSON.stringify(state), before);
});

test('unauthenticated gets 401 and forbidden role gets 403', async () => {
  const state = createState();
  addFleet(state, 4);

  await withServer(createApp(state), async baseUrl => {
    assert.equal((await getJson(baseUrl, '/api/manager/my-plan')).status, 401);
    assert.equal((await getJson(baseUrl, '/api/manager/my-plan', 'sales-token')).status, 403);
  });
});

test('utilization at 80 percent gives done without activity targets', async () => {
  const state = createState();
  addFleet(state, 4);

  await withServer(createApp(state), async baseUrl => {
    const response = await getJson(baseUrl, '/api/manager/my-plan', 'manager-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.summary.fleetUtilizationPercent, 80);
    assert.equal(response.body.summary.planStatus, 'done');
    assert.equal(response.body.activityTarget.required, false);
    assert.equal(response.body.activityTarget.dailyCallsTarget, 0);
    assert.match(response.body.activityTarget.message, /Парк загружен/);
  });
});

test('admin can request a safe manager slice', async () => {
  const state = createState();
  addFleet(state, 4);
  state.gantt_rentals.push({
    id: 'GR-other',
    managerId: 'U-other',
    manager: 'Анна',
    clientId: 'C-other',
    client: 'ООО Другое',
    equipmentId: 'EQ-5',
    status: 'active',
    plannedReturnDate: '2026-05-30',
  });

  await withServer(createApp(state), async baseUrl => {
    const response = await getJson(baseUrl, '/api/manager/my-plan?managerId=U-manager', 'admin-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.summary.managerName, 'Руслан');
    assert.equal(response.body.rentals.active.some(item => item.id === 'GR-other'), false);
  });
});

test('linked classic and gantt rentals are counted once and inactive fleet is excluded', async () => {
  const state = createState();
  state.equipment = [
    { id: 'EQ-1', inventoryNumber: '101', status: 'available', activeInFleet: true, category: 'own' },
    { id: 'EQ-2', inventoryNumber: '102', status: 'sold', activeInFleet: true, category: 'own' },
    { id: 'EQ-3', inventoryNumber: '103', status: 'available', activeInFleet: true, category: 'own', isForSale: true },
  ];
  state.rentals = [{
    id: 'R-1',
    managerId: 'U-manager',
    manager: 'Руслан',
    clientId: 'C-1',
    client: 'ООО План',
    equipmentId: 'EQ-1',
    status: 'active',
    plannedReturnDate: '2026-05-23',
  }];
  state.gantt_rentals = [{
    id: 'GR-1',
    rentalId: 'R-1',
    managerId: 'U-manager',
    manager: 'Руслан',
    clientId: 'C-1',
    client: 'ООО План',
    equipmentId: 'EQ-1',
    status: 'active',
    plannedReturnDate: '2026-05-23',
  }];

  await withServer(createApp(state), async baseUrl => {
    const response = await getJson(baseUrl, '/api/manager/my-plan', 'manager-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.summary.activeRentals, 1);
    assert.equal(response.body.rentals.active.length, 1);
    assert.equal(response.body.summary.fleetUtilizationPercent, 100);
    assert.equal(response.body.summary.planStatus, 'done');
  });
});

test('managerId query and equipment owner fields do not widen manager scope', async () => {
  const state = createState();
  state.equipment = [
    { id: 'EQ-1', inventoryNumber: '101', status: 'available', activeInFleet: true, category: 'own' },
    { id: 'EQ-2', inventoryNumber: '102', status: 'available', activeInFleet: true, category: 'own' },
  ];
  state.gantt_rentals = [
    {
      id: 'GR-own',
      managerId: 'U-manager',
      manager: 'Руслан',
      clientId: 'C-1',
      client: 'ООО Свой',
      equipmentId: 'EQ-1',
      status: 'active',
      plannedReturnDate: '2026-05-23',
    },
    {
      id: 'GR-owner-only',
      ownerId: 'U-manager',
      ownerName: 'Руслан',
      managerId: 'U-other',
      manager: 'Анна',
      clientId: 'C-2',
      client: 'ООО Чужой',
      equipmentId: 'EQ-2',
      status: 'active',
      plannedReturnDate: '2026-05-23',
    },
  ];

  await withServer(createApp(state), async baseUrl => {
    const response = await getJson(baseUrl, '/api/manager/my-plan?managerId=U-other', 'manager-token');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.rentals.active.map(item => item.id), ['GR-own']);
  });
});

test('my-plan recentActivity does not resolve labels for inaccessible related ids', async () => {
  const state = createState();
  addFleet(state, 3);
  state.clients.push({ id: 'C-other', company: 'ООО Чужой', managerId: 'U-other', manager: 'Анна' });
  state.equipment.push({ id: 'EQ-other', inventoryNumber: '999', name: 'Чужая техника', status: 'available', activeInFleet: true, category: 'own' });
  state.gantt_rentals.push({
    id: 'GR-other',
    managerId: 'U-other',
    manager: 'Анна',
    clientId: 'C-other',
    client: 'ООО Чужая аренда',
    equipmentId: 'EQ-other',
    status: 'active',
    plannedReturnDate: '2026-05-30',
  });
  state.manager_activity.push({
    id: 'MA-poison',
    createdAt: '2026-05-23T09:00:00.000Z',
    userId: 'U-manager',
    managerId: 'U-manager',
    activityType: 'note',
    resultStatus: 'info',
    relatedClientId: 'C-other',
    relatedRentalId: 'GR-other',
    relatedEquipmentId: 'EQ-other',
    comment: 'Старая запись с недоступными связями',
    activityDate: '2026-05-23',
    effectiveAt: '2026-05-23T09:00:00.000Z',
  });

  await withServer(createApp(state), async baseUrl => {
    const response = await getJson(baseUrl, '/api/manager/my-plan', 'manager-token');
    assert.equal(response.status, 200);
    const activity = response.body.recentActivity.find(item => item.id === 'MA-poison');
    assert.ok(activity);
    assert.equal(activity.relatedClientId, '');
    assert.equal(activity.relatedRentalId, '');
    assert.equal(activity.relatedEquipmentId, '');
    assert.equal(activity.relatedLabel, '');
    assert.doesNotMatch(JSON.stringify(response.body.recentActivity), /C-other|GR-other|EQ-other|ООО Чужой|Чужая техника|Чужая аренда/);
    assertNoNullUndefinedOrObjectString(response.body);
    assertNoSecrets(response.body);
  });
});
