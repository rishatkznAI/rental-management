import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { buildClient360Summary } from '../src/app/lib/client360.js';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const { registerDeliveryRoutes } = require('../server/routes/deliveries.js');
const { registerRentalRoutes } = require('../server/routes/rentals.js');
const { validateRentalPayload } = require('../server/lib/rental-validation.js');
const { buildFinanceReport } = require('../server/lib/finance-core.js');

function createState() {
  return {
    users: [{ id: 'U-admin', name: 'Админ', role: 'Администратор', status: 'Активен' }],
    clients: [
      { id: 'C-1', company: 'ООО Ромашка', manager: 'Админ' },
      { id: 'C-2', company: 'ООО Ромашка Плюс', manager: 'Админ' },
    ],
    client_objects: [
      { id: 'CO-1', clientId: 'C-1', name: 'Склад', address: 'Казань', status: 'active' },
      { id: 'CO-2', clientId: 'C-2', name: 'Чужой', address: 'Москва', status: 'active' },
    ],
    client_contracts: [
      { id: 'CC-1', clientId: 'C-1', objectId: 'CO-1', number: 'Д-1', status: 'active' },
      { id: 'CC-2', clientId: 'C-2', objectId: 'CO-2', number: 'Д-2', status: 'active' },
    ],
    equipment: [
      {
        id: 'EQ-1',
        inventoryNumber: 'INV-1',
        serialNumber: 'SN-1',
        manufacturer: 'Sky',
        model: 'Lift 1',
        status: 'available',
        activeInFleet: true,
        category: 'own',
      },
      {
        id: 'EQ-2',
        inventoryNumber: 'INV-2',
        serialNumber: 'SN-2',
        manufacturer: 'Sky',
        model: 'Lift 2',
        status: 'available',
        activeInFleet: true,
        category: 'own',
      },
    ],
    rentals: [],
    gantt_rentals: [],
    deliveries: [],
    delivery_carriers: [],
    service: [],
    documents: [],
    payments: [],
  };
}

function createApp(state = createState()) {
  const app = express();
  app.use(express.json());
  const apiRouter = express.Router();
  const readData = name => state[name] || [];
  const writeData = (name, value) => { state[name] = value; };
  const accessControl = createAccessControl({ readData });
  let idCounter = 0;

  function requireAuth(req, res, next) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (token !== 'admin-token') return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' };
    return next();
  }

  const deps = {
    readData,
    writeData,
    requireAuth,
    requireRead: () => (_req, _res, next) => next(),
    requireWrite: () => (_req, _res, next) => next(),
    validateRentalPayload,
    mergeRentalHistory: (_previous, next) => next,
    normalizeGanttRentalList: list => list,
    normalizeGanttRentalStatus: item => item,
    normalizeRecordClientLink: item => item,
    generateId: prefix => `${prefix}-${++idCounter}`,
    idPrefixes: { rentals: 'R', gantt_rentals: 'GR', deliveries: 'DL', rental_change_requests: 'RCR', service: 'S' },
    accessControl,
    auditLog: () => {},
    sendMessage: async () => ({ ok: true }),
    getBotUsers: () => ({}),
    saveBotUsers: () => {},
    nowIso: () => '2026-05-01T09:00:00.000Z',
  };

  apiRouter.use(registerRentalRoutes(deps));
  registerDeliveryRoutes(apiRouter, deps);
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

async function request(baseUrl, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: 'Bearer admin-token',
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function rentalPayload(overrides = {}) {
  return {
    clientId: 'C-1',
    client: 'ООО Ромашка',
    contact: 'Иван',
    startDate: '2026-05-10',
    plannedReturnDate: '2026-05-20',
    equipmentId: 'EQ-1',
    equipment: ['INV-1'],
    equipmentInv: 'INV-1',
    price: 100000,
    rate: '10000',
    discount: 0,
    manager: 'Админ',
    status: 'active',
    paymentStatus: 'unpaid',
    ...overrides,
  };
}

test('creating a client rental creates a linked planner row with stable ids', async () => {
  const { app, state } = createApp();

  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());

    assert.equal(response.status, 201);
    assert.equal(response.body.clientId, 'C-1');
    assert.equal(response.body.equipmentId, 'EQ-1');
    assert.equal(state.gantt_rentals.length, 1);
    assert.equal(state.gantt_rentals[0].rentalId, response.body.id);
    assert.equal(state.gantt_rentals[0].clientId, 'C-1');
    assert.equal(state.gantt_rentals[0].equipmentId, 'EQ-1');
    assert.equal(state.gantt_rentals[0].endDate, '2026-05-20');
  });
});

test('creating and patching rental preserves object and contract in linked planner row', async () => {
  const { app, state } = createApp();

  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      objectId: 'CO-1',
      contractId: 'CC-1',
    }));

    assert.equal(created.status, 201);
    const createdGantt = state.gantt_rentals.find(item => item.rentalId === created.body.id);
    assert.equal(created.body.objectId, 'CO-1');
    assert.equal(created.body.contractId, 'CC-1');
    assert.equal(createdGantt.objectId, 'CO-1');
    assert.equal(createdGantt.contractId, 'CC-1');

    const patchedDatesOnly = await request(baseUrl, 'PATCH', `/api/rentals/${created.body.id}`, {
      plannedReturnDate: '2026-05-18',
    });
    assert.equal(patchedDatesOnly.status, 200);
    const keptGantt = state.gantt_rentals.find(item => item.rentalId === created.body.id);
    assert.equal(patchedDatesOnly.body.objectId, 'CO-1');
    assert.equal(patchedDatesOnly.body.contractId, 'CC-1');
    assert.equal(keptGantt.objectId, 'CO-1');
    assert.equal(keptGantt.contractId, 'CC-1');

    state.client_objects.push({ id: 'CO-3', clientId: 'C-1', name: 'Цех', address: 'Казань 2', status: 'active' });
    state.client_contracts.push({ id: 'CC-3', clientId: 'C-1', objectId: 'CO-3', number: 'Д-3', status: 'active' });
    const patchedLinks = await request(baseUrl, 'PATCH', `/api/rentals/${created.body.id}`, {
      objectId: 'CO-3',
      contractId: 'CC-3',
    });
    assert.equal(patchedLinks.status, 200);
    const updatedGantt = state.gantt_rentals.find(item => item.rentalId === created.body.id);
    assert.equal(patchedLinks.body.objectId, 'CO-3');
    assert.equal(patchedLinks.body.contractId, 'CC-3');
    assert.equal(updatedGantt.objectId, 'CO-3');
    assert.equal(updatedGantt.contractId, 'CC-3');
  });
});

test('rental create and patch reject foreign object and contract links', async () => {
  const { app } = createApp();

  await withServer(app, async baseUrl => {
    const foreignObject = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({ objectId: 'CO-2' }));
    assert.equal(foreignObject.status, 400);

    const foreignContract = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({ contractId: 'CC-2' }));
    assert.equal(foreignContract.status, 400);

    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({ objectId: 'CO-1', contractId: 'CC-1' }));
    assert.equal(created.status, 201);

    const patchForeignObject = await request(baseUrl, 'PATCH', `/api/rentals/${created.body.id}`, { objectId: 'CO-2' });
    assert.equal(patchForeignObject.status, 400);

    const patchForeignContract = await request(baseUrl, 'PATCH', `/api/rentals/${created.body.id}`, { contractId: 'CC-2' });
    assert.equal(patchForeignContract.status, 400);
  });
});

test('same-client rentals keep their own equipment links', async () => {
  const { app, state } = createApp();

  await withServer(app, async baseUrl => {
    const first = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({ equipmentId: 'EQ-1', equipmentInv: 'INV-1', equipment: ['INV-1'] }));
    const second = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({ equipmentId: 'EQ-2', equipmentInv: 'INV-2', equipment: ['INV-2'] }));

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const firstGantt = state.gantt_rentals.find(item => item.rentalId === first.body.id);
    const secondGantt = state.gantt_rentals.find(item => item.rentalId === second.body.id);
    assert.equal(firstGantt.equipmentId, 'EQ-1');
    assert.equal(secondGantt.equipmentId, 'EQ-2');
    assert.notEqual(firstGantt.equipmentId, secondGantt.equipmentId);
  });
});

test('editing rental dates and equipment updates linked planner row', async () => {
  const { app, state } = createApp();

  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
    const patched = await request(baseUrl, 'PATCH', `/api/rentals/${created.body.id}`, {
      plannedReturnDate: '2026-05-18',
      equipmentId: 'EQ-2',
      equipmentInv: 'INV-2',
      equipment: ['INV-2'],
    });

    assert.equal(patched.status, 200);
    const linkedGantt = state.gantt_rentals.find(item => item.rentalId === created.body.id);
    assert.equal(linkedGantt.endDate, '2026-05-18');
    assert.equal(linkedGantt.equipmentId, 'EQ-2');
    assert.equal(linkedGantt.equipmentInv, 'INV-2');
  });
});

test('delivery created from rental stores rentalId equipmentId and clientId from rental', async () => {
  const { app } = createApp();

  await withServer(app, async baseUrl => {
    const rental = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
    const delivery = await request(baseUrl, 'POST', '/api/deliveries', {
      type: 'shipping',
      rentalId: rental.body.id,
      transportDate: '2026-05-10',
      origin: 'Склад',
      destination: 'Объект',
      cargo: 'Подъемник',
      contactName: 'Иван',
      contactPhone: '+7 900 000-00-00',
    });

    assert.equal(delivery.status, 201);
    assert.equal(delivery.body.rentalId, rental.body.id);
    assert.equal(delivery.body.classicRentalId, rental.body.id);
    assert.equal(delivery.body.clientId, 'C-1');
    assert.equal(delivery.body.equipmentId, 'EQ-1');
    assert.equal(delivery.body.equipmentInv, 'INV-1');
  });
});

test('document linked by rental is visible in rental client summary', () => {
  const client = { id: 'C-1', company: 'ООО Ромашка' };
  const summary = buildClient360Summary({
    client,
    rentals: [rentalPayload({ id: 'R-1' })],
    documents: [{ id: 'D-1', rentalId: 'R-1', client: 'Legacy name', type: 'act', status: 'signed', date: '2026-05-20' }],
  });

  assert.equal(summary.documents.total, 1);
  assert.equal(summary.documents.latest[0].id, 'D-1');
  assert.equal(summary.documents.latest[0].rental, 'R-1');
});

test('payments and documents do not mix between similarly named clients', () => {
  const report = buildFinanceReport({
    clients: [
      { id: 'C-1', company: 'ООО Ромашка' },
      { id: 'C-2', company: 'ООО Ромашка Плюс' },
    ],
    rentals: [
      { id: 'R-1', clientId: 'C-1', client: 'ООО Ромашка', equipmentInv: 'INV-1', amount: 100000, status: 'closed', endDate: '2026-05-20' },
      { id: 'R-2', clientId: 'C-2', client: 'ООО Ромашка Плюс', equipmentInv: 'INV-2', amount: 100000, status: 'closed', endDate: '2026-05-20' },
    ],
    payments: [
      { id: 'P-1', rentalId: 'R-1', clientId: 'C-1', amount: 100000, paidAmount: 100000, status: 'paid' },
    ],
  }, '2026-05-21');

  assert.deepEqual(report.debtRows.map(row => row.rentalId), ['R-2']);
  assert.equal(report.clientSnapshots.find(item => item.clientId === 'C-1').currentDebt, 0);
  assert.equal(report.clientSnapshots.find(item => item.clientId === 'C-2').currentDebt, 100000);

  const c1Summary = buildClient360Summary({
    client: { id: 'C-1', company: 'ООО Ромашка' },
    rentals: [{ id: 'R-1', clientId: 'C-1', client: 'ООО Ромашка', status: 'closed' }],
    documents: [
      { id: 'D-1', rentalId: 'R-1', clientId: 'C-1', type: 'act', status: 'signed' },
      { id: 'D-2', rentalId: 'R-2', clientId: 'C-2', type: 'act', status: 'signed' },
    ],
  });

  assert.deepEqual(c1Summary.documents.latest.map(item => item.id), ['D-1']);
});
