import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const { normalizeRole } = require('../server/lib/role-groups.js');
const { registerPlannerRoutes } = require('../server/routes/planner.js');
const { resolvePlannerDateWindow } = require('../server/routes/planner.js');
const {
  buildPlannerRows,
  resolvePlannerRowSource,
  readScopedPlannerCollections,
} = require('../server/lib/planner-core.js');

const READ_PERMISSIONS = {
  planner_items: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер', 'Механик', 'Старший механик'],
};

const WRITE_PERMISSIONS = {
  planner_items: ['Администратор', 'Офис-менеджер'],
};

function createState(overrides = {}) {
  return {
    users: [
      { id: 'U-admin', name: 'Админ', email: 'admin@example.test', role: 'Администратор', status: 'Активен' },
      { id: 'U-office', name: 'Офис', email: 'office@example.test', role: 'Офис-менеджер', status: 'Активен' },
      { id: 'U-manager', name: 'Руслан', email: 'manager@example.test', role: 'Менеджер по аренде', status: 'Активен' },
      { id: 'U-mechanic', name: 'Петров', email: 'mechanic@example.test', role: 'Механик', status: 'Активен' },
      { id: 'U-carrier', name: 'Перевозчик', email: 'carrier@example.test', role: 'Перевозчик', status: 'Активен', carrierId: 'CARRIER-1' },
      { id: 'U-investor', name: 'Инвестор', email: 'investor@example.test', role: 'Инвестор', status: 'Активен', ownerId: 'OW-1' },
    ],
    mechanics: [{ id: 'M-1', name: 'Петров', userId: 'U-mechanic' }],
    equipment: [
      { id: 'EQ-1', inventoryNumber: 'INV-1', manufacturer: 'JCB', model: '3CX', ownerId: 'OW-1' },
      { id: 'EQ-2', inventoryNumber: 'INV-2', manufacturer: 'CAT', model: '428', ownerId: 'OW-2' },
      { id: 'EQ-3', inventoryNumber: 'INV-3', manufacturer: 'Bobcat', model: 'S530', ownerId: 'OW-2' },
    ],
    rentals: [
      {
        id: 'R-1',
        equipment: ['INV-1'],
        startDate: '2026-05-10',
        status: 'active',
        client: 'ООО Свой клиент',
        deliveryAddress: 'Секретный адрес аренды',
        manager: 'Руслан',
      },
      {
        id: 'R-2',
        equipment: ['INV-2'],
        startDate: '2026-05-11',
        status: 'active',
        client: 'ООО Чужой клиент',
        deliveryAddress: 'Чужой адрес аренды',
        manager: 'Анна',
      },
    ],
    deliveries: [
      {
        id: 'D-1',
        equipmentInv: 'INV-1',
        transportDate: '2026-05-09',
        status: 'new',
        type: 'shipping',
        client: 'ООО Доставка 1',
        origin: 'Склад А',
        destination: 'Адрес доставки 1',
        manager: 'Руслан',
        carrierId: 'CARRIER-1',
        cargo: 'Экскаватор',
      },
      {
        id: 'D-2',
        equipmentInv: 'INV-2',
        transportDate: '2026-05-09',
        status: 'new',
        type: 'shipping',
        client: 'ООО Доставка 2',
        origin: 'Склад Б',
        destination: 'Адрес доставки 2',
        manager: 'Анна',
        carrierId: 'CARRIER-2',
        cargo: 'Погрузчик',
      },
    ],
    service: [
      {
        id: 'S-own',
        equipmentId: 'EQ-3',
        plannedDate: '2026-05-08',
        status: 'in_progress',
        assignedMechanicId: 'M-1',
        assignedMechanicName: 'Петров',
        reason: 'ТО',
        description: 'Проверка',
      },
      {
        id: 'S-other',
        equipmentId: 'EQ-2',
        plannedDate: '2026-05-08',
        status: 'in_progress',
        assignedMechanicId: 'M-2',
        assignedMechanicName: 'Сидоров',
        reason: 'Ремонт',
        description: 'Чужая заявка',
      },
    ],
    planner_items: [],
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
    ['carrier-token', 'U-carrier'],
    ['investor-token', 'U-investor'],
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
      carrierId: user.carrierId,
      ownerId: user.ownerId,
    };
    return next();
  }

  function requireRead(collection) {
    return (req, res, next) => {
      const allowed = READ_PERMISSIONS[collection] || ['Администратор'];
      return allowed.includes(normalizeRole(req.user?.userRole))
        ? next()
        : res.status(403).json({ ok: false, error: 'Forbidden' });
    };
  }

  function requireWrite(collection) {
    return (req, res, next) => {
      const allowed = WRITE_PERMISSIONS[collection] || ['Администратор'];
      return allowed.includes(normalizeRole(req.user?.userRole))
        ? next()
        : res.status(403).json({ ok: false, error: 'Forbidden' });
    };
  }

  const apiRouter = express.Router();
  registerPlannerRoutes(apiRouter, {
    readData,
    writeData,
    requireAuth,
    requireRead,
    requireWrite,
    accessControl,
    generateId: prefix => `${prefix}-1`,
    nowIso: () => '2026-05-05T10:00:00.000Z',
  });
  app.use('/api', apiRouter);
  return app;
}

test('buildPlannerRows uses rental.equipmentId before stale legacy equipment refs', () => {
  const state = createState({
    rentals: [{
      id: 'R-stale',
      equipmentId: 'EQ-2',
      equipmentInv: 'INV-1',
      inventoryNumber: 'INV-1',
      equipment: ['INV-1'],
      startDate: '2026-05-11',
      status: 'active',
      client: 'ООО Клиент',
    }],
    deliveries: [],
    service: [],
    planner_items: [
      { id: 'PI-stale', rentalId: 'R-stale', equipmentRef: 'INV-1', prepStatus: 'ready' },
      { id: 'PI-canonical', rentalId: 'R-stale', equipmentRef: 'INV-2', prepStatus: 'on_hold' },
    ],
  });

  const rows = buildPlannerRows({
    rentals: state.rentals,
    deliveries: [],
    serviceTickets: [],
    equipment: state.equipment,
    plannerItems: state.planner_items,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].equipmentId, 'EQ-2');
  assert.equal(rows[0].inventoryNumber, 'INV-2');
  assert.equal(rows[0].prepStatus, 'on_hold');
});

test('resolvePlannerRowSource rejects stale row equipmentRef for canonical rental equipmentId', () => {
  const state = createState({
    rentals: [{
      id: 'R-stale',
      equipmentId: 'EQ-2',
      equipmentInv: 'INV-1',
      equipment: ['INV-1'],
      startDate: '2026-05-11',
      status: 'active',
    }],
  });

  assert.equal(resolvePlannerRowSource('R-stale__INV-1', {
    rentals: state.rentals,
    deliveries: [],
    serviceTickets: [],
    equipment: state.equipment,
  }), null);
  assert.equal(resolvePlannerRowSource('R-stale__INV-2', {
    rentals: state.rentals,
    deliveries: [],
    serviceTickets: [],
    equipment: state.equipment,
  })?.entity.id, 'R-stale');
});

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

function plannerItems(body) {
  return Array.isArray(body) ? body : body.items;
}

test('mechanic GET /api/planner returns only assigned service rows', async () => {
  await withServer(createApp(), async (baseUrl) => {
    const response = await request(baseUrl, 'GET', '/api/planner?dateFrom=2026-05-08&dateTo=2026-05-11', 'mechanic-token');
    assert.equal(response.status, 200);
    assert.deepEqual(plannerItems(response.body).map(row => row.id), ['service:S-own__INV-3']);
    assert.equal(plannerItems(response.body)[0].sourceType, 'service');
  });
});

test('mechanic GET /api/planner does not expose rental or delivery client/address data', async () => {
  await withServer(createApp(), async (baseUrl) => {
    const response = await request(baseUrl, 'GET', '/api/planner?dateFrom=2026-05-08&dateTo=2026-05-11', 'mechanic-token');
    assert.equal(response.status, 200);
    const rows = plannerItems(response.body);
    assert.equal(rows.some(row => row.sourceType === 'rental'), false);
    assert.equal(rows.some(row => row.sourceType === 'delivery'), false);
    const payload = JSON.stringify(rows);
    assert.equal(payload.includes('Секретный адрес аренды'), false);
    assert.equal(payload.includes('ООО Чужой клиент'), false);
    assert.equal(payload.includes('Адрес доставки 2'), false);
    assert.equal(payload.includes('ООО Доставка 2'), false);
  });
});

test('mechanic GET /api/planner keeps overlays only for accessible service rows', async () => {
  const state = createState({
    planner_items: [
      { id: 'PI-own', rentalId: 'service:S-own', equipmentRef: 'INV-3', prepStatus: 'ready' },
      { id: 'PI-other', rentalId: 'service:S-other', equipmentRef: 'INV-2', prepStatus: 'on_hold' },
    ],
  });
  await withServer(createApp(state), async (baseUrl) => {
    const response = await request(baseUrl, 'GET', '/api/planner?dateFrom=2026-05-08&dateTo=2026-05-11', 'mechanic-token');
    assert.equal(response.status, 200);
    assert.deepEqual(plannerItems(response.body).map(row => row.id), ['service:S-own__INV-3']);
    assert.equal(plannerItems(response.body)[0].prepStatus, 'ready');
  });
});

test('mechanic cannot PUT planner overlay for rental, delivery, or another service row', async () => {
  await withServer(createApp(), async (baseUrl) => {
    const rental = await request(baseUrl, 'PUT', '/api/planner/R-1__INV-1', 'mechanic-token', { prepStatus: 'ready' });
    const delivery = await request(baseUrl, 'PUT', '/api/planner/delivery:D-1__INV-1', 'mechanic-token', { prepStatus: 'ready' });
    const service = await request(baseUrl, 'PUT', '/api/planner/service:S-other__INV-2', 'mechanic-token', { prepStatus: 'ready' });
    assert.equal(rental.status, 403);
    assert.equal(delivery.status, 403);
    assert.equal(service.status, 403);
  });
});

test('admin keeps GET and PUT access to planner rows', async () => {
  const state = createState();
  await withServer(createApp(state), async (baseUrl) => {
    const list = await request(baseUrl, 'GET', '/api/planner?dateFrom=2026-05-08&dateTo=2026-05-11', 'admin-token');
    assert.equal(list.status, 200);
    assert.deepEqual(new Set(plannerItems(list.body).map(row => row.id)), new Set([
      'R-1__INV-1',
      'R-2__INV-2',
      'delivery:D-1__INV-1',
      'delivery:D-2__INV-2',
      'service:S-own__INV-3',
      'service:S-other__INV-2',
    ]));

    const updated = await request(baseUrl, 'PUT', '/api/planner/R-1__INV-1', 'admin-token', { prepStatus: 'ready', comment: 'ok' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.rentalId, 'R-1');
    assert.equal(updated.body.equipmentRef, 'INV-1');
    assert.equal(updated.body.updatedBy, 'Админ');
    assert.equal(state.planner_items.length, 1);
  });
});

test('office keeps GET and PUT access to planner rows', async () => {
  const state = createState();
  await withServer(createApp(state), async (baseUrl) => {
    const list = await request(baseUrl, 'GET', '/api/planner?dateFrom=2026-05-08&dateTo=2026-05-11', 'office-token');
    assert.equal(list.status, 200);
    assert.equal(plannerItems(list.body).length, 6);

    const updated = await request(baseUrl, 'PUT', '/api/planner/delivery:D-1__INV-1', 'office-token', { prepStatus: 'ready' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.rentalId, 'delivery:D-1');
    assert.equal(updated.body.equipmentRef, 'INV-1');
  });
});

test('PUT /api/planner returns 404 when source row does not exist', async () => {
  await withServer(createApp(), async (baseUrl) => {
    const response = await request(baseUrl, 'PUT', '/api/planner/R-missing__INV-1', 'admin-token', { prepStatus: 'ready' });
    assert.equal(response.status, 404);
  });
});

test('planner route applies a safe default date window and bounded response metadata', async () => {
  await withServer(createApp(), async (baseUrl) => {
    const response = await request(baseUrl, 'GET', '/api/planner?dateFrom=2026-05-08&dateTo=2026-05-11', 'admin-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.dateFrom <= response.body.dateTo, true);
    assert.equal(Array.isArray(response.body.items), true);
    assert.equal(response.body.items.every(row => row.startDate >= response.body.dateFrom && row.startDate <= response.body.dateTo), true);
  });
});

test('planner route honors explicit dateFrom/dateTo and rejects oversized windows', async () => {
  await withServer(createApp(), async (baseUrl) => {
    const bounded = await request(baseUrl, 'GET', '/api/planner?dateFrom=2026-05-09&dateTo=2026-05-10', 'admin-token');
    assert.equal(bounded.status, 200);
    assert.deepEqual(new Set(plannerItems(bounded.body).map(row => row.id)), new Set([
      'R-1__INV-1',
      'delivery:D-1__INV-1',
      'delivery:D-2__INV-2',
    ]));

    const tooLarge = await request(baseUrl, 'GET', '/api/planner?dateFrom=2026-01-01&dateTo=2026-12-31', 'admin-token');
    assert.equal(tooLarge.status, 400);
  });
});

test('resolvePlannerDateWindow defaults without exposing all history', () => {
  const window = resolvePlannerDateWindow({}, '2026-05-16');
  assert.equal(window.ok, true);
  assert.equal(window.dateFrom, '2026-05-09');
  assert.equal(window.dateTo, '2026-06-30');
});

test('investor planner collections are owner-scoped when planner access is enabled', () => {
  const state = createState();
  const accessControl = createAccessControl({ readData: name => state[name] || [] });
  const investor = {
    userId: 'U-investor',
    userName: 'Инвестор',
    userRole: 'Инвестор',
    ownerId: 'OW-1',
  };
  const collections = readScopedPlannerCollections({
    readData: name => state[name] || [],
    accessControl,
    user: investor,
  });
  const rows = buildPlannerRows(collections).map(row => row.id);
  assert.deepEqual(rows, ['R-1__INV-1']);
});

test('carrier planner collections are delivery-scoped when planner access is enabled', () => {
  const state = createState();
  const accessControl = createAccessControl({ readData: name => state[name] || [] });
  const carrier = {
    userId: 'U-carrier',
    userName: 'Перевозчик',
    userRole: 'Перевозчик',
    carrierId: 'CARRIER-1',
  };
  const collections = readScopedPlannerCollections({
    readData: name => state[name] || [],
    accessControl,
    user: carrier,
  });
  const rows = buildPlannerRows(collections).map(row => row.id);
  assert.deepEqual(rows, ['delivery:D-1__INV-1']);
});
