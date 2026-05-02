import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const { normalizeRole } = require('../server/lib/role-groups.js');
const { registerTasksCenterRoutes } = require('../server/routes/tasks-center.js');

const READ_PERMISSIONS = {
  clients: ['Администратор', 'Менеджер по аренде', 'Менеджер по продажам', 'Офис-менеджер'],
  rentals: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  gantt_rentals: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  payments: ['Администратор', 'Менеджер по аренде', 'Менеджер по продажам', 'Офис-менеджер'],
  documents: ['Администратор', 'Менеджер по аренде', 'Менеджер по продажам', 'Офис-менеджер'],
  service: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер', 'Механик'],
  deliveries: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  debt_collection_plans: ['Администратор', 'Менеджер по аренде', 'Менеджер по продажам', 'Офис-менеджер'],
};

function createState(overrides = {}) {
  return {
    users: [
      { id: 'U-admin', name: 'Админ', email: 'admin@example.test', role: 'Администратор', status: 'Активен' },
      { id: 'U-manager', name: 'Руслан', email: 'manager@example.test', role: 'Менеджер по аренде', status: 'Активен' },
      { id: 'U-sales', name: 'Анна', email: 'sales@example.test', role: 'Менеджер по продажам', status: 'Активен' },
      { id: 'U-mechanic', name: 'Механик', email: 'mechanic@example.test', role: 'Механик', status: 'Активен' },
    ],
    clients: [
      { id: 'C-1', company: 'ООО Должник', manager: 'Руслан' },
      { id: 'C-2', company: 'ООО Чужой', manager: 'Анна' },
    ],
    rentals: [
      { id: 'R-closed', clientId: 'C-1', client: 'ООО Должник', manager: 'Руслан', equipmentInv: 'SKY-1', status: 'closed', startDate: '2026-03-01', plannedReturnDate: '2026-04-15', actualReturnDate: '2026-04-15' },
    ],
    gantt_rentals: [
      { id: 'GR-1', clientId: 'C-1', client: 'ООО Должник', manager: 'Руслан', equipmentInv: 'SKY-1', status: 'active', startDate: '2026-03-01', endDate: '2026-05-02', amount: 100000 },
      { id: 'GR-2', clientId: 'C-2', client: 'ООО Чужой', manager: 'Анна', equipmentInv: 'SKY-2', status: 'active', startDate: '2026-03-01', endDate: '2026-04-01', amount: 80000 },
    ],
    payments: [
      { id: 'P-1', rentalId: 'GR-1', clientId: 'C-1', amount: 100000, paidAmount: 0, status: 'pending', dueDate: '2026-03-15' },
      { id: 'P-2', rentalId: 'GR-2', clientId: 'C-2', amount: 80000, paidAmount: 0, status: 'pending', dueDate: '2026-03-15' },
    ],
    documents: [
      { id: 'D-1', type: 'contract', status: 'sent', clientId: 'C-1', client: 'ООО Должник', rentalId: 'GR-1', manager: 'Руслан', date: '2026-05-01' },
      { id: 'D-orphan', type: 'contract', status: 'signed', number: 'DOC-ORPHAN', manager: 'Руслан', date: '2026-05-01' },
    ],
    service: [
      { id: 'S-1', status: 'new', priority: 'high', equipment: 'SKY-1', reason: 'Не работает', createdAt: '2026-05-01' },
    ],
    deliveries: [
      { id: 'DL-1', clientId: 'C-1', client: 'ООО Должник', equipment: 'SKY-1', date: '2026-05-02', status: 'planned' },
    ],
    debt_collection_plans: [
      { id: 'DCP-1', clientId: 'C-1', clientName: 'ООО Должник', responsibleName: 'Руслан', status: 'promised', priority: 'critical', nextActionType: 'call', nextActionDate: '2026-05-01', promisedPaymentDate: '2026-05-02' },
    ],
    ...overrides,
  };
}

function createApp(state = createState()) {
  const app = express();
  app.use(express.json());
  const readData = name => state[name] || [];
  const accessControl = createAccessControl({ readData });
  const sessions = new Map([
    ['admin-token', 'U-admin'],
    ['manager-token', 'U-manager'],
    ['sales-token', 'U-sales'],
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

  app.use('/api', registerTasksCenterRoutes({
    readData,
    requireAuth,
    canReadCollection,
    accessControl,
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

async function request(baseUrl, token) {
  const response = await fetch(`${baseUrl}/api/tasks-center`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('tasks center requires auth and handles empty legacy data', async () => {
  const app = createApp(createState({
    clients: [],
    rentals: [],
    gantt_rentals: [],
    payments: [],
    documents: [],
    service: [],
    deliveries: [],
    debt_collection_plans: [],
  }));
  await withServer(app, async (baseUrl) => {
    assert.equal((await request(baseUrl)).status, 401);
    const response = await request(baseUrl, 'admin-token');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.tasks, []);
    assert.equal(response.body.summary.total, 0);
  });
});

test('admin sees tasks from available sections with finance amount', async () => {
  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'admin-token');
    assert.equal(response.status, 200);
    const types = response.body.tasks.map(task => task.type);
    assert.ok(types.includes('rentals.return_today'));
    assert.ok(types.includes('documents.sent_unsigned'));
    assert.ok(types.includes('documents.missing_contract'));
    assert.ok(types.includes('documents.closed_missing_closing_docs'));
    assert.ok(types.includes('documents.orphan'));
    assert.ok(types.includes('service.unassigned'));
    assert.ok(types.includes('deliveries.no_carrier'));
    assert.ok(types.includes('debt_collection.next_action_overdue'));
    assert.ok(types.includes('debt_collection.promised_today'));
    assert.equal(response.body.permissions.canViewFinance, true);
    assert.ok(response.body.tasks.some(task => typeof task.amount === 'number'));
    assert.doesNotMatch(JSON.stringify(response.body), /NaN|undefined|\[object Object\]/);
    for (const task of response.body.tasks) {
      for (const field of ['password', 'token', 'secret', 'session', 'cookie', 'apiKey']) {
        assert.equal(Object.prototype.hasOwnProperty.call(task, field), false);
      }
    }
  });
});

test('role without finance access does not receive debt amounts', async () => {
  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'manager-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.permissions.canViewFinance, false);
    assert.ok(response.body.tasks.length > 0);
    assert.equal(response.body.tasks.some(task => typeof task.amount === 'number'), false);
    assert.doesNotMatch(JSON.stringify(response.body), /100000|80000/);
  });
});

test('tasks are scoped by section permissions', async () => {
  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const sales = await request(baseUrl, 'sales-token');
    assert.equal(sales.status, 200);
    assert.equal(sales.body.tasks.some(task => task.section === 'service'), false);
    assert.equal(sales.body.tasks.some(task => task.section === 'deliveries'), false);
    assert.equal(sales.body.tasks.some(task => typeof task.amount === 'number'), false);

    const mechanic = await request(baseUrl, 'mechanic-token');
    assert.equal(mechanic.status, 200);
    assert.ok(mechanic.body.tasks.every(task => task.section === 'service'));
  });
});
