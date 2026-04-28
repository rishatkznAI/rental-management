import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const {
  classifyRentalFieldChange,
  splitRentalPatch,
} = require('../server/lib/rental-change-requests.js');
const { createAccessControl } = require('../server/lib/access-control.js');
const { registerRentalRoutes } = require('../server/routes/rentals.js');
const { registerRentalChangeRequestRoutes } = require('../server/routes/rental-change-requests.js');
const { validateRentalPayload } = require('../server/lib/rental-validation.js');

const rental = {
  id: 'R-1',
  client: 'ЭМ-СТРОЙ',
  contact: 'Иван',
  startDate: '2026-04-10',
  plannedReturnDate: '2026-04-20',
  equipment: ['083'],
  rate: '5000 ₽/день',
  price: 100000,
  discount: 0,
  deliveryAddress: 'Казань',
  manager: 'Руслан',
  status: 'active',
  comments: '',
};

test('classifyRentalFieldChange applies conflict-free extension immediately', () => {
  const result = classifyRentalFieldChange({
    previousRental: rental,
    field: 'plannedReturnDate',
    newValue: '2026-04-25',
    today: '2026-04-12',
  });

  assert.equal(result.mode, 'immediate');
  assert.equal(result.type, 'Продление аренды');
});

test('classifyRentalFieldChange sends shortening to approval', () => {
  const result = classifyRentalFieldChange({
    previousRental: rental,
    field: 'plannedReturnDate',
    newValue: '2026-04-18',
    today: '2026-04-12',
  });

  assert.equal(result.mode, 'approval');
  assert.equal(result.type, 'Сокращение аренды');
});

test('classifyRentalFieldChange sends active rental clientId changes to approval', () => {
  const result = classifyRentalFieldChange({
    previousRental: { ...rental, clientId: 'C-1' },
    field: 'clientId',
    newValue: 'C-2',
    today: '2026-04-12',
  });

  assert.equal(result.mode, 'approval');
  assert.equal(result.type, 'Изменение клиента в активной аренде');
});

test('splitRentalPatch separates immediate comments from protected price change', () => {
  const result = splitRentalPatch({
    previousRental: rental,
    patch: {
      comments: 'Клиент просит продлить',
      price: 120000,
    },
    payments: [],
    today: '2026-04-12',
  });

  assert.deepEqual(result.immediatePatch, { comments: 'Клиент просит продлить' });
  assert.equal(result.approvalChanges.length, 1);
  assert.equal(result.approvalChanges[0].field, 'price');
});

test('splitRentalPatch sends closing with debt to approval', () => {
  const result = splitRentalPatch({
    previousRental: rental,
    patch: { status: 'closed' },
    payments: [{ id: 'P-1', rentalId: 'R-1', amount: 100000, paidAmount: 20000, status: 'partial' }],
    today: '2026-04-12',
  });

  assert.deepEqual(result.immediatePatch, {});
  assert.equal(result.approvalChanges.length, 1);
  assert.equal(result.approvalChanges[0].type, 'Закрытие аренды с долгом');
});

function createApprovalApp() {
  const state = {
    users: [
      { id: 'U-admin', name: 'Админ', role: 'Администратор' },
      { id: 'U-manager', name: 'Руслан', role: 'Менеджер по аренде' },
    ],
    equipment: [
      { id: 'EQ-1', inventoryNumber: '083', category: 'own', activeInFleet: true },
    ],
    rentals: [
      {
        id: 'R-1',
        client: 'ЭМ-СТРОЙ',
        contact: 'Иван',
        startDate: '2026-04-10',
        plannedReturnDate: '2026-04-20',
        equipment: ['083'],
        manager: 'Руслан',
        managerId: 'U-manager',
        status: 'active',
        price: 100000,
        discount: 0,
        history: [],
      },
      {
        id: 'R-2',
        client: 'Будущая аренда',
        startDate: '2026-04-23',
        plannedReturnDate: '2026-04-25',
        equipment: ['083'],
        manager: 'Руслан',
        managerId: 'U-manager',
        status: 'created',
      },
    ],
    gantt_rentals: [
      {
        id: 'GR-1',
        client: 'ЭМ-СТРОЙ',
        startDate: '2026-04-10',
        endDate: '2026-04-20',
        equipmentId: 'EQ-1',
        equipmentInv: '083',
        manager: 'Руслан',
        managerId: 'U-manager',
        status: 'active',
        comments: [],
      },
      {
        id: 'GR-2',
        client: 'Будущая аренда',
        startDate: '2026-04-23',
        endDate: '2026-04-25',
        equipmentId: 'EQ-1',
        equipmentInv: '083',
        manager: 'Руслан',
        managerId: 'U-manager',
        status: 'created',
        comments: [],
      },
    ],
    payments: [],
    rental_change_requests: [],
  };
  const app = express();
  app.use(express.json());
  const readData = (name) => state[name] || [];
  const writeData = (name, value) => {
    state[name] = value;
  };
  const accessControl = createAccessControl({ readData });
  let requestCounter = 0;

  function requireAuth(req, res, next) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = token === 'admin-token'
      ? state.users[0]
      : token === 'manager-token'
        ? state.users[1]
        : null;
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = {
      userId: user.id,
      userName: user.name,
      userRole: user.role,
    };
    return next();
  }

  function requireRead() {
    return (_req, _res, next) => next();
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
    generateId: prefix => `${prefix}-${++requestCounter}`,
    idPrefixes: { rentals: 'R', gantt_rentals: 'GR', rental_change_requests: 'RCR' },
    accessControl,
    auditLog: () => {},
  }));
  apiRouter.use(registerRentalChangeRequestRoutes({
    readData,
    writeData,
    requireAuth,
    validateRentalPayload,
    generateId: prefix => `${prefix}-${++requestCounter}`,
    idPrefixes: { rental_change_requests: 'RCR' },
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

async function request(baseUrl, method, path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

test('approved rental date change applies even when it originally required conflict approval', async () => {
  const { app, state } = createApprovalApp();

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/R-1', 'manager-token', {
      plannedReturnDate: '2026-04-24',
      __linkedGanttRentalId: 'GR-1',
      __changeReason: 'Клиент просит продлить аренду',
    });

    assert.equal(update.status, 200);
    assert.equal(update.body.changeRequestSummary.pendingCount, 1);
    assert.equal(state.rentals.find(item => item.id === 'R-1').plannedReturnDate, '2026-04-20');
    assert.equal(state.rental_change_requests.length, 1);

    const changeRequest = state.rental_change_requests[0];
    assert.equal(changeRequest.field, 'plannedReturnDate');
    assert.equal(changeRequest.newValue, '2026-04-24');

    const approved = await request(baseUrl, 'POST', `/api/rental_change_requests/${changeRequest.id}/approve`, 'admin-token', {});

    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, 'approved');
    assert.equal(state.rentals.find(item => item.id === 'R-1').plannedReturnDate, '2026-04-24');
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-1').endDate, '2026-04-24');
  });
});
