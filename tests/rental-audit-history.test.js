import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const { registerRentalRoutes } = require('../server/routes/rentals.js');
const { validateRentalPayload } = require('../server/lib/rental-validation.js');

const READ_PERMISSIONS = {
  rentals: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  gantt_rentals: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
};

function createState() {
  return {
    users: [
      { id: 'U-admin', name: 'Админ', role: 'Администратор', status: 'Активен' },
      { id: 'U-manager', name: 'Мария', email: 'manager@example.test', role: 'Менеджер по аренде', status: 'Активен' },
      { id: 'U-other', name: 'Олег', email: 'other@example.test', role: 'Менеджер по аренде', status: 'Активен' },
    ],
    equipment: [{ id: 'EQ-1', inventoryNumber: 'INV-1' }],
    rentals: [
      {
        id: 'R-1',
        clientId: 'C-1',
        client: 'ООО История',
        startDate: '2026-04-20',
        plannedReturnDate: '2026-04-25',
        equipment: ['INV-1'],
        price: 1000,
        manager: 'Мария',
        status: 'active',
      },
      {
        id: 'R-2',
        clientId: 'C-2',
        client: 'ООО Чужая',
        startDate: '2026-04-20',
        plannedReturnDate: '2026-04-25',
        equipment: ['INV-1'],
        price: 9000,
        manager: 'Олег',
        status: 'active',
      },
    ],
    gantt_rentals: [
      {
        id: 'GR-1',
        rentalId: 'R-1',
        clientId: 'C-1',
        client: 'ООО История',
        equipmentId: 'EQ-1',
        equipmentInv: 'INV-1',
        startDate: '2026-04-20',
        endDate: '2026-04-25',
        amount: 1000,
        manager: 'Мария',
        status: 'active',
      },
    ],
    audit_logs: [
      {
        id: 'AUD-1',
        userId: 'U-manager',
        userName: 'Мария',
        role: 'Менеджер по аренде',
        action: 'rentals.update',
        entityType: 'rentals',
        entityId: 'R-1',
        description: 'Изменение аренды R-1',
        before: { id: 'R-1', plannedReturnDate: '2026-04-25', price: 1000, password: 'leak' },
        after: { id: 'R-1', plannedReturnDate: '2026-04-30', price: 2000, token: 'leak' },
        metadata: { source: 'rental_detail', session: 'leak' },
        createdAt: '2026-05-02T08:00:00.000Z',
      },
      {
        id: 'AUD-2',
        userId: 'U-admin',
        userName: 'Админ',
        role: 'Администратор',
        action: 'gantt_rentals.update',
        entityType: 'gantt_rentals',
        entityId: 'GR-1',
        before: { id: 'GR-1', rentalId: 'R-1', status: 'active', amount: 1000 },
        after: { id: 'GR-1', rentalId: 'R-1', status: 'returned', amount: 1000 },
        createdAt: '2026-05-02T09:00:00.000Z',
      },
      {
        id: 'AUD-3',
        userId: 'U-admin',
        userName: 'Админ',
        role: 'Администратор',
        action: 'rentals.update',
        entityType: 'rentals',
        entityId: 'R-2',
        before: { id: 'R-2', price: 9000 },
        after: { id: 'R-2', price: 9500 },
        createdAt: '2026-05-02T10:00:00.000Z',
      },
    ],
  };
}

function createApp(state = createState()) {
  const app = express();
  app.use(express.json());
  const readData = name => state[name] || [];
  const writeData = (name, value) => { state[name] = value; };
  const accessControl = createAccessControl({ readData });

  function requireAuth(req, res, next) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = token === 'admin-token'
      ? state.users[0]
      : token === 'manager-token'
        ? state.users[1]
        : token === 'other-token'
          ? state.users[2]
          : null;
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = { userId: user.id, userName: user.name, userRole: user.role, email: user.email };
    return next();
  }

  function requireRead(collection) {
    return (req, res, next) => (
      (READ_PERMISSIONS[collection] || ['Администратор']).includes(req.user?.userRole)
        ? next()
        : res.status(403).json({ ok: false, error: 'Forbidden' })
    );
  }

  const apiRouter = express.Router();
  apiRouter.use(registerRentalRoutes({
    readData,
    writeData,
    requireAuth,
    requireRead,
    validateRentalPayload,
    mergeRentalHistory: (_previous, next) => next,
    normalizeGanttRentalList: list => list,
    normalizeGanttRentalStatus: item => item,
    generateId: prefix => `${prefix}-1`,
    idPrefixes: { rentals: 'R', gantt_rentals: 'GR', rental_change_requests: 'RCR', service: 'S' },
    accessControl,
    auditLog: () => {},
  }));
  app.use('/api', apiRouter);
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
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('rental audit history is scoped, linked and redacted for admin', async () => {
  await withServer(createApp(), async baseUrl => {
    const response = await getJson(baseUrl, '/api/rentals/R-1/audit', 'admin-token');

    assert.equal(response.status, 200);
    assert.equal(response.body.logs.length, 2);
    assert.deepEqual(response.body.logs.map(item => item.id), ['AUD-2', 'AUD-1']);
    assert.equal(response.body.logs.some(item => item.entityId === 'R-2'), false);
    assert.equal(JSON.stringify(response.body).includes('password'), false);
    assert.equal(JSON.stringify(response.body).includes('token'), false);
    assert.equal(JSON.stringify(response.body).includes('session'), false);
    assert.equal(response.body.logs[1].changes.some(item => item.field === 'price' && item.after === 2000), true);

    const ganttResponse = await getJson(baseUrl, '/api/rentals/GR-1/audit', 'admin-token');
    assert.equal(ganttResponse.status, 200);
    assert.equal(ganttResponse.body.rentalId, 'R-1');
    assert.equal(ganttResponse.body.ganttRentalId, 'GR-1');
    assert.equal(ganttResponse.body.logs.length, 2);
  });
});

test('rental audit history hides finance fields for rental manager', async () => {
  await withServer(createApp(), async baseUrl => {
    const response = await getJson(baseUrl, '/api/rentals/R-1/audit', 'manager-token');

    assert.equal(response.status, 200);
    assert.equal(response.body.canViewFinance, false);
    assert.equal(JSON.stringify(response.body).includes('2000'), false);
    assert.equal(response.body.logs.some(item => item.changes.some(change => change.field === 'price' && change.hidden === true)), true);
  });
});

test('rental audit history requires auth and rental scope', async () => {
  await withServer(createApp(), async baseUrl => {
    const unauthorized = await getJson(baseUrl, '/api/rentals/R-1/audit');
    assert.equal(unauthorized.status, 401);

    const forbidden = await getJson(baseUrl, '/api/rentals/R-1/audit', 'other-token');
    assert.equal(forbidden.status, 403);
  });
});
