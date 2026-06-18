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

function dateKeyFromToday(daysFromToday) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysFromToday))
    .toISOString()
    .slice(0, 10);
}

const DATES = {
  rentalStart: dateKeyFromToday(10),
  rentalEnd: dateKeyFromToday(19),
  extensionEnd: dateKeyFromToday(23),
  secondExtensionEnd: dateKeyFromToday(25),
  conflictStart: dateKeyFromToday(21),
  conflictEnd: dateKeyFromToday(24),
  pastExtensionEnd: dateKeyFromToday(-1),
};

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
        startDate: DATES.rentalStart,
        plannedReturnDate: DATES.rentalEnd,
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
        startDate: DATES.conflictStart,
        plannedReturnDate: DATES.conflictEnd,
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
        startDate: DATES.rentalStart,
        plannedReturnDate: DATES.rentalEnd,
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
        startDate: DATES.rentalStart,
        endDate: DATES.rentalEnd,
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
        startDate: DATES.conflictStart,
        endDate: DATES.conflictEnd,
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
      newPlannedReturnDate: DATES.extensionEnd,
      reason: 'Клиент продлевает работы',
      comment: 'Без изменения документов',
      confirmedByClient: true,
      invoiceSentToClient: true,
      token: 'must-not-leak',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.applied, true);
    assert.equal(state.rentals.find(item => item.id === 'R-1').plannedReturnDate, DATES.extensionEnd);
    assert.equal(state.rentals.find(item => item.id === 'R-1').endDate, DATES.extensionEnd);
    assert.equal(response.body.rental.endDate, DATES.extensionEnd);
    assert.equal(state.rentals.find(item => item.id === 'R-1').price, 14000);
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-1').amount, 14000);
    assert.equal(response.body.financialImpact.additionalAmount, 4000);
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-1').endDate, DATES.extensionEnd);
    assert.equal(state.rentals.find(item => item.id === 'R-1').extensionConfirmedByClient, true);
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-1').extensionConfirmedByClient, true);
    assert.equal(state.rental_change_requests.length, 0);
  });
});

test('rental extension requires invoice sent confirmation before applying dates', async () => {
  const { app, state } = createApp();
  state.rentals = state.rentals.filter(item => item.id !== 'R-conflict');
  state.gantt_rentals = state.gantt_rentals.filter(item => item.id !== 'GR-conflict');

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'admin-token', {
      newPlannedReturnDate: DATES.extensionEnd,
      reason: 'Клиент продлевает работы',
      confirmedByClient: true,
      invoiceSentToClient: false,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /счёт отправлен/);
    assert.equal(state.rentals.find(item => item.id === 'R-1').plannedReturnDate, DATES.rentalEnd);
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-1').endDate, DATES.rentalEnd);
  });
});

test('rental extension rejects zero financial delta when rate cannot be determined', async () => {
  const { app, state } = createApp();
  state.rentals = state.rentals.filter(item => item.id !== 'R-conflict');
  state.gantt_rentals = state.gantt_rentals.filter(item => item.id !== 'GR-conflict');
  const rental = state.rentals.find(item => item.id === 'R-1');
  rental.rate = '';
  rental.price = 0;
  const gantt = state.gantt_rentals.find(item => item.id === 'GR-1');
  delete gantt.amount;

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'admin-token', {
      newPlannedReturnDate: DATES.extensionEnd,
      reason: 'Клиент продлевает работы',
      confirmedByClient: true,
      invoiceSentToClient: true,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /доплату/);
    assert.equal(response.body.financialImpact.additionalAmount, 0);
    assert.equal(state.rentals.find(item => item.id === 'R-1').plannedReturnDate, DATES.rentalEnd);
  });
});

test('repeated rental extension appends history and keeps a single linked planner row', async () => {
  const { app, state } = createApp();
  state.rentals = state.rentals.filter(item => item.id !== 'R-conflict');
  state.gantt_rentals = state.gantt_rentals.filter(item => item.id !== 'GR-conflict');

  await withServer(app, async (baseUrl) => {
    const first = await request(baseUrl, 'admin-token', {
      newPlannedReturnDate: DATES.extensionEnd,
      reason: 'Клиент продлевает работы',
      comment: 'Первое продление',
      confirmedByClient: true,
      invoiceSentToClient: true,
    });
    const second = await request(baseUrl, 'admin-token', {
      newPlannedReturnDate: DATES.secondExtensionEnd,
      reason: 'Задержка на объекте',
      comment: 'Второе продление',
      confirmedByClient: true,
      invoiceSentToClient: true,
    });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const rental = state.rentals.find(item => item.id === 'R-1');
    assert.equal(rental.plannedReturnDate, DATES.secondExtensionEnd);
    assert.equal(rental.price, 16000);
    assert.equal(rental.history.length, 2);
    assert.match(rental.history[0].text, /Первое продление/);
    assert.match(rental.history[1].text, /Второе продление/);
    assert.equal(rental.extensionFinancials.last.additionalAmount, 2000);
    const linkedRows = state.gantt_rentals.filter(item => item.rentalId === 'R-1');
    assert.equal(linkedRows.length, 1);
    assert.equal(linkedRows[0].id, 'GR-1');
    assert.equal(linkedRows[0].endDate, DATES.secondExtensionEnd);
    assert.equal(linkedRows[0].amount, 16000);
  });
});

test('rental extension safely updates classic rental when linked gantt is missing', async () => {
  const { app, state } = createApp();
  state.rentals = state.rentals.filter(item => item.id !== 'R-conflict');
  state.gantt_rentals = [];

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'admin-token', {
      newPlannedReturnDate: DATES.extensionEnd,
      reason: 'Клиент продлевает работы',
      confirmedByClient: true,
      invoiceSentToClient: true,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.applied, true);
    assert.equal(response.body.ganttRental, null);
    assert.equal(state.rentals.find(item => item.id === 'R-1').plannedReturnDate, DATES.extensionEnd);
    assert.equal(state.rentals.find(item => item.id === 'R-1').endDate, DATES.extensionEnd);
    assert.deepEqual(state.gantt_rentals, []);
  });
});

test('rental extension rejects past date and closed rental', async () => {
  const { app } = createApp();

  await withServer(app, async (baseUrl) => {
    const unconfirmed = await request(baseUrl, 'admin-token', {
      newEndDate: DATES.extensionEnd,
      reason: 'Клиент продлевает работы',
      confirmedByClient: false,
    });
    assert.equal(unconfirmed.status, 400);
    assert.match(unconfirmed.body.error, /согласовал/);

    const past = await request(baseUrl, 'admin-token', {
      newPlannedReturnDate: DATES.pastExtensionEnd,
      reason: 'Клиент продлевает работы',
      confirmedByClient: true,
      invoiceSentToClient: true,
    });
    assert.equal(past.status, 400);

    const closed = await fetch(`${baseUrl}/api/rentals/R-closed/extend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer admin-token' },
      body: JSON.stringify({ newPlannedReturnDate: DATES.extensionEnd, reason: 'Клиент продлевает работы', confirmedByClient: true }),
    });
    assert.equal(closed.status, 409);
  });
});

test('rental date extension is rejected through generic patch endpoints', async () => {
  const { app, state } = createApp();
  state.rentals = state.rentals.filter(item => item.id !== 'R-conflict');
  state.gantt_rentals = state.gantt_rentals.filter(item => item.id !== 'GR-conflict');

  await withServer(app, async (baseUrl) => {
    const classicPatch = await fetch(`${baseUrl}/api/rentals/R-1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: 'Bearer admin-token' },
      body: JSON.stringify({ plannedReturnDate: DATES.extensionEnd }),
    });
    assert.equal(classicPatch.status, 400);
    const classicBody = await classicPatch.json();
    assert.match(classicBody.error, /\/extend/);

    const ganttPatch = await fetch(`${baseUrl}/api/gantt_rentals/GR-1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: 'Bearer admin-token' },
      body: JSON.stringify({ endDate: DATES.extensionEnd }),
    });
    assert.equal(ganttPatch.status, 400);
    const ganttBody = await ganttPatch.json();
    assert.match(ganttBody.error, /\/extend/);

    assert.equal(state.rentals.find(item => item.id === 'R-1').plannedReturnDate, DATES.rentalEnd);
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-1').endDate, DATES.rentalEnd);
  });
});

test('rental extension detects future equipment conflict and creates approval request', async () => {
  const { app, state } = createApp();

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'admin-token', {
      newPlannedReturnDate: DATES.extensionEnd,
      reason: 'Задержка на объекте',
      comment: 'Проверить бронь',
      confirmedByClient: true,
      invoiceSentToClient: true,
    });

    assert.equal(response.status, 202);
    assert.equal(response.body.applied, false);
    assert.equal(response.body.conflict.rentalId, 'R-conflict');
    assert.equal(response.body.conflict.client, 'ООО Будущая бронь');
    assert.equal(response.body.financialImpact.additionalAmount, 4000);
    assert.equal(state.rentals.find(item => item.id === 'R-1').plannedReturnDate, DATES.rentalEnd);
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
      newPlannedReturnDate: DATES.extensionEnd,
      reason: 'Клиент продлевает работы',
      confirmedByClient: true,
      invoiceSentToClient: true,
    });
    assert.equal(forbidden.status, 403);

    const ok = await request(baseUrl, 'admin-token', {
      newPlannedReturnDate: DATES.extensionEnd,
      reason: 'Клиент продлевает работы',
      comment: 'secret should stay ordinary text',
      confirmedByClient: true,
      invoiceSentToClient: true,
      password: 'hidden',
      apiKey: 'hidden',
    });
    assert.equal(ok.status, 200);

    const actions = state.audit_logs.map(entry => entry.action);
    assert.ok(actions.includes('rentals.extend'));
    assert.ok(actions.includes('rentals.planned_return_date_change'));
    assert.ok(actions.includes('gantt_rentals.extend'));
    assert.equal(state.rentals.find(item => item.id === 'R-1').extensionInvoiceSentToClient, true);
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-1').extensionInvoiceSentToClient, true);
    assert.doesNotMatch(JSON.stringify(state.audit_logs), /password|apiKey|hidden/);
  });
});
