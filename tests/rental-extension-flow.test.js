import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const { createAuditLogger } = require('../server/lib/security-audit.js');
const { registerRentalRoutes } = require('../server/routes/rentals.js');
const { validateRentalPayload } = require('../server/lib/rental-validation.js');

function createState() {
  return {
    users: [
      { id: 'U-admin', name: 'Админ', role: 'Администратор' },
      { id: 'U-manager', name: 'Руслан', role: 'Менеджер по аренде' },
      { id: 'U-investor', name: 'Инвестор', role: 'Инвестор' },
    ],
    equipment: [
      { id: 'EQ-1', inventoryNumber: 'INV-1', serialNumber: 'SN-1', status: 'rented', activeInFleet: true, category: 'own' },
      { id: 'EQ-2', inventoryNumber: 'INV-2', serialNumber: 'SN-2', status: 'rented', activeInFleet: true, category: 'own' },
    ],
    rentals: [
      {
        id: 'R-1',
        clientId: 'C-1',
        client: 'ООО Строй',
        contact: 'Иван',
        startDate: '2026-06-01',
        plannedReturnDate: '2026-06-10',
        equipment: ['INV-1'],
        equipmentId: 'EQ-1',
        rate: '1000',
        price: 10000,
        discount: 0,
        deliveryAddress: 'Казань',
        manager: 'Админ',
        status: 'active',
        history: [],
      },
      {
        id: 'R-conflict',
        clientId: 'C-2',
        client: 'ООО Будущая бронь',
        contact: 'Пётр',
        startDate: '2026-06-12',
        plannedReturnDate: '2026-06-15',
        equipment: ['INV-1'],
        equipmentId: 'EQ-1',
        rate: '1000',
        price: 5000,
        discount: 0,
        deliveryAddress: 'Казань',
        manager: 'Админ',
        status: 'confirmed',
      },
      {
        id: 'R-closed',
        clientId: 'C-3',
        client: 'ООО Закрытая',
        contact: 'Мария',
        startDate: '2026-06-01',
        plannedReturnDate: '2026-06-10',
        equipment: ['INV-2'],
        equipmentId: 'EQ-2',
        rate: '1000',
        price: 8000,
        discount: 0,
        deliveryAddress: 'Казань',
        manager: 'Админ',
        status: 'closed',
      },
    ],
    gantt_rentals: [
      {
        id: 'GR-1',
        rentalId: 'R-1',
        clientId: 'C-1',
        client: 'ООО Строй',
        equipmentId: 'EQ-1',
        equipmentInv: 'INV-1',
        startDate: '2026-06-01',
        endDate: '2026-06-10',
        manager: 'Админ',
        status: 'active',
        comments: [],
      },
      {
        id: 'GR-conflict',
        rentalId: 'R-conflict',
        clientId: 'C-2',
        client: 'ООО Будущая бронь',
        equipmentId: 'EQ-1',
        equipmentInv: 'INV-1',
        startDate: '2026-06-12',
        endDate: '2026-06-15',
        manager: 'Админ',
        status: 'confirmed',
        comments: [],
      },
    ],
    rental_change_requests: [],
    audit_logs: [],
  };
}

function createApp(state = createState()) {
  const app = express();
  app.use(express.json());
  const readData = name => state[name] || [];
  const writeData = (name, value) => { state[name] = value; };
  const accessControl = createAccessControl({ readData });
  let counter = 0;

  function requireAuth(req, res, next) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = token === 'admin-token'
      ? state.users[0]
      : token === 'manager-token'
        ? state.users[1]
        : token === 'investor-token'
          ? state.users[2]
          : null;
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = { userId: user.id, userName: user.name, userRole: user.role };
    return next();
  }

  function requireRead() {
    return (_req, _res, next) => next();
  }

  const auditLog = createAuditLogger({
    readData,
    writeData,
    generateId: prefix => `${prefix}-${++counter}`,
    nowIso: () => '2026-05-02T12:00:00.000Z',
    logger: { warn: () => {} },
  });

  const apiRouter = express.Router();
  apiRouter.use(registerRentalRoutes({
    readData,
    writeData,
    requireAuth,
    requireRead,
    validateRentalPayload,
    mergeRentalHistory: (_previous, next, author) => ({
      ...next,
      comments: [...(Array.isArray(next.comments) ? next.comments : []), { date: '2026-05-02T12:00:00.000Z', text: 'Изменение аренды', author, type: 'system' }],
    }),
    normalizeGanttRentalList: list => list,
    normalizeGanttRentalStatus: item => item,
    normalizeRecordClientLink: item => item,
    generateId: prefix => `${prefix}-${++counter}`,
    idPrefixes: { rentals: 'R', gantt_rentals: 'GR', rental_change_requests: 'RCR' },
    accessControl,
    auditLog,
  }));
  app.use('/api', apiRouter);
  return { app, state };
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

async function request(baseUrl, token, body) {
  const response = await fetch(`${baseUrl}/api/rentals/R-1/extend`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('rental extension without conflict applies and synchronizes classic and gantt rentals', async () => {
  const { app, state } = createApp();
  state.rentals = state.rentals.filter(item => item.id !== 'R-conflict');
  state.gantt_rentals = state.gantt_rentals.filter(item => item.id !== 'GR-conflict');

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'admin-token', {
      newPlannedReturnDate: '2026-06-14',
      reason: 'Клиент продлевает работы',
      comment: 'Без изменения документов',
      token: 'must-not-leak',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.applied, true);
    assert.equal(state.rentals.find(item => item.id === 'R-1').plannedReturnDate, '2026-06-14');
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-1').endDate, '2026-06-14');
    assert.equal(state.rental_change_requests.length, 0);
  });
});

test('rental extension safely updates classic rental when linked gantt is missing', async () => {
  const { app, state } = createApp();
  state.rentals = state.rentals.filter(item => item.id !== 'R-conflict');
  state.gantt_rentals = [];

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'admin-token', {
      newPlannedReturnDate: '2026-06-14',
      reason: 'Клиент продлевает работы',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.applied, true);
    assert.equal(response.body.ganttRental, null);
    assert.equal(state.rentals.find(item => item.id === 'R-1').plannedReturnDate, '2026-06-14');
    assert.deepEqual(state.gantt_rentals, []);
  });
});

test('rental extension rejects past date and closed rental', async () => {
  const { app } = createApp();

  await withServer(app, async (baseUrl) => {
    const past = await request(baseUrl, 'admin-token', {
      newPlannedReturnDate: '2026-04-01',
      reason: 'Клиент продлевает работы',
    });
    assert.equal(past.status, 400);

    const closed = await fetch(`${baseUrl}/api/rentals/R-closed/extend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer admin-token' },
      body: JSON.stringify({ newPlannedReturnDate: '2026-06-12', reason: 'Клиент продлевает работы' }),
    });
    assert.equal(closed.status, 409);
  });
});

test('rental extension detects future equipment conflict and creates approval request', async () => {
  const { app, state } = createApp();

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'admin-token', {
      newPlannedReturnDate: '2026-06-14',
      reason: 'Задержка на объекте',
      comment: 'Проверить бронь',
    });

    assert.equal(response.status, 202);
    assert.equal(response.body.applied, false);
    assert.equal(response.body.conflict.rentalId, 'R-conflict');
    assert.equal(response.body.conflict.client, 'ООО Будущая бронь');
    assert.equal(state.rentals.find(item => item.id === 'R-1').plannedReturnDate, '2026-06-10');
    assert.equal(state.rental_change_requests.length, 1);
    assert.equal(state.rental_change_requests[0].field, 'plannedReturnDate');
  });
});

test('rental extension requires write access and writes safe audit events', async () => {
  const { app, state } = createApp();
  state.rentals = state.rentals.filter(item => item.id !== 'R-conflict');
  state.gantt_rentals = state.gantt_rentals.filter(item => item.id !== 'GR-conflict');

  await withServer(app, async (baseUrl) => {
    const forbidden = await request(baseUrl, 'investor-token', {
      newPlannedReturnDate: '2026-06-14',
      reason: 'Клиент продлевает работы',
    });
    assert.equal(forbidden.status, 403);

    const ok = await request(baseUrl, 'admin-token', {
      newPlannedReturnDate: '2026-06-14',
      reason: 'Клиент продлевает работы',
      comment: 'secret should stay ordinary text',
      password: 'hidden',
      apiKey: 'hidden',
    });
    assert.equal(ok.status, 200);

    const actions = state.audit_logs.map(entry => entry.action);
    assert.ok(actions.includes('rentals.extend'));
    assert.ok(actions.includes('rentals.planned_return_date_change'));
    assert.ok(actions.includes('gantt_rentals.extend'));
    assert.doesNotMatch(JSON.stringify(state.audit_logs), /password|apiKey|hidden/);
  });
});
