import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { buildClient360Summary } from '../src/app/lib/client360.js';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const Database = serverRequire('better-sqlite3');

const { createAccessControl } = require('../server/lib/access-control.js');
const { registerDeliveryRoutes } = require('../server/routes/deliveries.js');
const { registerRentalRoutes } = require('../server/routes/rentals.js');
const { validateRentalPayload } = require('../server/lib/rental-validation.js');
const { buildFinanceReport } = require('../server/lib/finance-core.js');
const { createNumberSequenceAllocator } = require('../server/lib/number-sequences.js');
const { createBusinessNumberingService } = require('../server/lib/business-numbering.js');

function createState() {
  return {
    users: [
      { id: 'U-admin', name: 'Админ', role: 'Администратор', status: 'Активен' },
      { id: 'U-office', name: 'Офис', role: 'Офис-менеджер', status: 'Активен' },
    ],
    counterparties: [
      { id: 'CP-C-1', legalName: 'ООО Ромашка', shortName: 'ООО Ромашка', status: 'active', roles: ['customer'] },
      { id: 'CP-C-2', legalName: 'ООО Ромашка Плюс', shortName: 'ООО Ромашка Плюс', status: 'active', roles: ['customer'] },
    ],
    counterparty_role_assignments: [
      { id: 'CPRA-C-1', counterpartyId: 'CP-C-1', roleCode: 'customer', status: 'active', validTo: null },
      { id: 'CPRA-C-2', counterpartyId: 'CP-C-2', roleCode: 'customer', status: 'active', validTo: null },
    ],
    clients: [
      { id: 'C-1', counterpartyId: 'CP-C-1', company: 'ООО Ромашка', manager: 'Админ' },
      { id: 'C-2', counterpartyId: 'CP-C-2', company: 'ООО Ромашка Плюс', manager: 'Админ' },
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
      {
        id: 'EQ-3',
        inventoryNumber: 'INV-3',
        serialNumber: 'SN-3',
        manufacturer: 'Sky',
        model: 'Lift 3',
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

function createApp(state = createState(), options = {}) {
  const app = express();
  app.use(express.json());
  const apiRouter = express.Router();
  const readData = name => state[name] || [];
  const writeData = (name, value) => { state[name] = value; };
  const writeDataBatch = entries => {
    if (options.failBatch) throw new Error('Injected delivery batch failure');
    for (const entry of entries || []) state[entry.name] = entry.value;
  };
  const accessControl = createAccessControl({ readData });
  const numberingDb = new Database(':memory:');
  const businessNumbering = createBusinessNumberingService({
    allocator: createNumberSequenceAllocator({
      db: numberingDb,
      scope: { scopeType: 'company', scopeId: 'SKYTECH' },
      nowIso: () => '2026-05-01T09:00:00.000Z',
    }),
    readData,
    nowIso: () => '2026-05-01T09:00:00.000Z',
  });
  let idCounter = 0;

  function requireAuth(req, res, next) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const actor = token === 'admin-token'
      ? { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' }
      : token === 'office-token'
        ? { userId: 'U-office', userName: 'Офис', userRole: 'Офис-менеджер' }
        : null;
    if (!actor) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = actor;
    return next();
  }

  const deps = {
    readData,
    writeData,
    writeDataBatch,
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
    businessNumbering,
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

async function request(baseUrl, method, path, body, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: 'Bearer admin-token',
      'content-type': 'application/json',
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

function rentalPayload(overrides = {}) {
  return {
    clientId: 'C-1',
    objectId: 'CO-1',
    contractId: 'CC-1',
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
    assert.equal(response.body.equipmentDetails.inventoryNumber, 'INV-1');
    assert.equal(response.body.equipmentDetails.serialNumber, 'SN-1');
    assert.equal(response.body.objectName, 'Склад');
    assert.equal(response.body.contractNumber, 'Д-1');
    assert.equal(response.body.number, 'RNT-26-000001');
    assert.equal(state.gantt_rentals.length, 1);
    assert.equal(state.gantt_rentals[0].rentalId, response.body.id);
    assert.equal(state.gantt_rentals[0].clientId, 'C-1');
    assert.equal(state.gantt_rentals[0].equipmentId, 'EQ-1');
    assert.equal(state.gantt_rentals[0].endDate, '2026-05-20');
    assert.equal(state.gantt_rentals[0].number, response.body.number);
  });
});

test('three Rental creates receive sequential numbers and reject client number mutation', async () => {
  const { app } = createApp();

  await withServer(app, async baseUrl => {
    const payloads = [
      rentalPayload({ equipmentId: 'EQ-1', equipment: ['INV-1'], equipmentInv: 'INV-1' }),
      rentalPayload({ equipmentId: 'EQ-2', equipment: ['INV-2'], equipmentInv: 'INV-2' }),
      rentalPayload({ equipmentId: 'EQ-3', equipment: ['INV-3'], equipmentInv: 'INV-3' }),
    ];
    const created = [];
    for (const payload of payloads) {
      const response = await request(baseUrl, 'POST', '/api/rentals', payload);
      assert.equal(response.status, 201, JSON.stringify(response.body));
      created.push(response.body);
    }
    assert.deepEqual(created.map(item => item.number), [
      'RNT-26-000001',
      'RNT-26-000002',
      'RNT-26-000003',
    ]);

    const forgedCreate = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({ number: 'RNT-26-999999' }));
    assert.equal(forgedCreate.status, 400);
    assert.equal(forgedCreate.body.code, 'BUSINESS_NUMBER_SERVER_OWNED');

    const forgedPatch = await request(baseUrl, 'PATCH', `/api/rentals/${created[0].id}`, { number: 'RNT-26-999999' });
    assert.equal(forgedPatch.status, 400);
    assert.equal(forgedPatch.body.code, 'BUSINESS_NUMBER_SERVER_OWNED');
  });
});

test('concurrent exact rental creates replay one idempotent result without duplicating lifecycle state', async () => {
  const { app, state } = createApp();
  const headers = { 'Idempotency-Key': 'rental-retry-0001' };

  await withServer(app, async baseUrl => {
    const responses = await Promise.all([
      request(baseUrl, 'POST', '/api/rentals', rentalPayload(), headers),
      request(baseUrl, 'POST', '/api/rentals', rentalPayload(), headers),
    ]);
    const first = responses.find(response => response.status === 201);
    const replay = responses.find(response => response.status === 200);

    assert.ok(first);
    assert.ok(replay);
    assert.equal(replay.body.id, first.body.id);
    assert.equal(replay.headers.get('idempotency-replayed'), 'true');
    assert.equal(state.rentals.length, 1);
    assert.equal(state.gantt_rentals.length, 1);
    assert.equal(state.equipment[0].history.length, 1);
    assert.equal(state.rental_create_idempotency.length, 1);
    assert.equal(state.rental_create_idempotency[0].rentalId, first.body.id);
  });
});

test('rental create rejects a changed payload under the same idempotency key', async () => {
  const { app, state } = createApp();
  const headers = { 'Idempotency-Key': 'rental-retry-0002' };

  await withServer(app, async baseUrl => {
    const first = await request(baseUrl, 'POST', '/api/rentals', rentalPayload(), headers);
    const mismatched = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      comments: 'changed logical payload',
    }), headers);

    assert.equal(first.status, 201);
    assert.equal(mismatched.status, 409);
    assert.equal(mismatched.body.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(state.rentals.length, 1);
    assert.equal(state.gantt_rentals.length, 1);
    assert.equal(state.rental_create_idempotency.length, 1);
  });
});

test('paginated rentals include stable equipment and relation display snapshots', async () => {
  const { app } = createApp();

  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
    assert.equal(created.status, 201);

    const page = await request(baseUrl, 'GET', '/api/rentals?paginated=true&page=1&pageSize=25');
    assert.equal(page.status, 200);
    assert.equal(page.body.items.length, 1);
    assert.equal(page.body.items[0].equipmentId, 'EQ-1');
    assert.equal(page.body.items[0].equipmentDetails.model, 'Lift 1');
    assert.equal(page.body.items[0].objectName, 'Склад');
    assert.equal(page.body.items[0].contractNumber, 'Д-1');
  });
});

test('rental creation requires and records acknowledgement for client credit risk', async () => {
  const state = createState();
  state.clients[0].creditLimit = 50000;
  state.clients[0].debt = 75000;
  const { app } = createApp(state);

  await withServer(app, async baseUrl => {
    const blocked = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'CLIENT_CREDIT_RISK_ACKNOWLEDGEMENT_REQUIRED');
    assert.equal(blocked.body.risk.exceededLimit, true);
    assert.equal(state.rentals.length, 0);

    const confirmed = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      creditRiskAcknowledged: true,
    }));
    assert.equal(confirmed.status, 201);
    assert.equal(confirmed.body.creditRiskSnapshot.exceededLimit, true);
    assert.equal(confirmed.body.creditRiskAcknowledgedByUserId, 'U-admin');
    assert.ok(confirmed.body.creditRiskAcknowledgedAt);
    assert.equal(state.rentals[0].creditRiskAcknowledged, undefined);
  });
});

test('created future rental atomically reserves equipment and blocks overlap', async () => {
  const { app, state } = createApp();

  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());

    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'created');
    assert.equal(state.equipment.find(item => item.id === 'EQ-1').status, 'reserved');
    assert.equal(state.equipment.find(item => item.id === 'EQ-1').currentClient, 'ООО Ромашка');
    assert.equal(state.equipment.find(item => item.id === 'EQ-1').returnDate, '2026-05-20');

    const plannerRows = await request(baseUrl, 'GET', '/api/gantt_rentals');
    assert.equal(plannerRows.status, 200);
    assert.equal(plannerRows.body.length, 1);
    assert.equal(plannerRows.body[0].rentalId, created.body.id);
    assert.equal(plannerRows.body[0].equipmentId, 'EQ-1');

    const overlapping = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      startDate: '2026-05-15',
      plannedReturnDate: '2026-05-25',
    }));

    assert.equal(overlapping.status, 409);
    assert.equal(overlapping.body.code, 'EQUIPMENT_AVAILABILITY_CONFLICT');
    assert.equal(overlapping.body.conflict.rentalId, created.body.id);
    assert.equal(overlapping.body.conflict.equipmentId, 'EQ-1');
    assert.equal(overlapping.body.conflict.endDate, '2026-05-20');
    assert.match(overlapping.body.error, /Техника уже занята/);
    assert.equal(state.rentals.length, 1);
    assert.equal(state.gantt_rentals.length, 1);
  });
});

test('two concurrent rental creators produce one booking and one recoverable conflict', async () => {
  const { app, state } = createApp();

  await withServer(app, async baseUrl => {
    const [first, second] = await Promise.all([
      request(baseUrl, 'POST', '/api/rentals', rentalPayload({ client: 'Первый оператор' })),
      request(baseUrl, 'POST', '/api/rentals', rentalPayload({ client: 'Второй оператор' })),
    ]);
    const created = [first, second].find(result => result.status === 201);
    const conflicted = [first, second].find(result => result.status === 409);

    assert.ok(created);
    assert.ok(conflicted);
    assert.equal(conflicted.body.code, 'EQUIPMENT_AVAILABILITY_CONFLICT');
    assert.equal(conflicted.body.conflict.rentalId, created.body.id);
    assert.equal(state.rentals.length, 1);
    assert.equal(state.gantt_rentals.length, 1);
  });
});

test('direct Gantt projection creation is read-only regardless of rental link', async () => {
  const { app } = createApp();

  await withServer(app, async baseUrl => {
    const missingLink = await request(baseUrl, 'POST', '/api/gantt_rentals', {
      clientId: 'C-1',
      client: 'ООО Ромашка',
      equipmentId: 'EQ-1',
      equipmentInv: 'INV-1',
      startDate: '2026-05-10',
      endDate: '2026-05-20',
      status: 'active',
    });
    assert.equal(missingLink.status, 409);
    assert.equal(missingLink.body.code, 'GANTT_PROJECTION_READ_ONLY');

    const brokenLink = await request(baseUrl, 'POST', '/api/gantt_rentals', {
      rentalId: 'R-missing',
      clientId: 'C-1',
      client: 'ООО Ромашка',
      equipmentId: 'EQ-1',
      equipmentInv: 'INV-1',
      startDate: '2026-05-10',
      endDate: '2026-05-20',
      status: 'active',
    });
    assert.equal(brokenLink.status, 409);
    assert.equal(brokenLink.body.code, 'GANTT_PROJECTION_READ_ONLY');
  });
});

test('cannot create a linked Gantt projection outside the Rental lifecycle operation', async () => {
  const { app, state } = createApp();

  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
    assert.equal(created.status, 201);
    assert.equal(state.gantt_rentals.length, 1);

    const duplicate = await request(baseUrl, 'POST', '/api/gantt_rentals', {
      rentalId: created.body.id,
      clientId: 'C-1',
      client: 'ООО Ромашка',
      equipmentId: 'EQ-1',
      equipmentInv: 'INV-1',
      startDate: '2026-05-10',
      endDate: '2026-05-20',
      status: 'active',
    });

    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, 'GANTT_PROJECTION_READ_ONLY');
    assert.equal(state.gantt_rentals.length, 1);
  });
});

test('direct Gantt projection patch and bulk sync are read-only', async () => {
  const { app, state } = createApp();

  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
    assert.equal(created.status, 201);
    const gantt = state.gantt_rentals.find(item => item.rentalId === created.body.id);
    assert.ok(gantt);

    const orphanPatch = await request(baseUrl, 'PATCH', `/api/gantt_rentals/${gantt.id}`, {
      rentalId: '',
      sourceRentalId: '',
      originalRentalId: '',
    });
    assert.equal(orphanPatch.status, 409);
    assert.equal(orphanPatch.body.code, 'GANTT_PROJECTION_READ_ONLY');

    const bulk = await request(baseUrl, 'PUT', '/api/gantt_rentals', [
      {
        ...gantt,
        rentalId: 'R-missing',
        sourceRentalId: '',
        originalRentalId: '',
      },
    ]);
    assert.equal(bulk.status, 409);
    assert.equal(bulk.body.code, 'GANTT_PROJECTION_READ_ONLY');
  });
});

test('linked Gantt contractual fields cannot bypass the classic rental authority', async () => {
  const { app, state } = createApp();

  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
    assert.equal(created.status, 201);
    const gantt = state.gantt_rentals[0];
    const before = structuredClone({ rental: state.rentals[0], gantt, equipment: state.equipment });

    const response = await request(baseUrl, 'PATCH', `/api/gantt_rentals/${gantt.id}`, {
      equipmentId: 'EQ-2',
      startDate: '2026-05-11',
      endDate: '2026-05-19',
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'GANTT_PROJECTION_READ_ONLY');
    assert.deepEqual(state.rentals[0], before.rental);
    assert.deepEqual(state.gantt_rentals[0], before.gantt);
    assert.deepEqual(state.equipment, before.equipment);
  });
});

test('standalone planning rows cannot share the gantt_rentals projection record type', async () => {
  const { app } = createApp();

  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/gantt_rentals', {
      sourceType: 'maintenance',
      operationType: 'maintenance',
      client: 'ТО',
      equipmentId: 'EQ-1',
      equipmentInv: 'INV-1',
      startDate: '2026-05-10',
      endDate: '2026-05-10',
      status: 'maintenance',
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'GANTT_PROJECTION_READ_ONLY');
    assert.match(response.body.error, /planner_items/);
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

    const clearedObject = await request(baseUrl, 'PATCH', `/api/rentals/${created.body.id}`, {
      objectId: '',
    });
    assert.equal(clearedObject.status, 200);
    assert.equal(clearedObject.body.objectId, undefined);
    assert.equal(clearedObject.body.objectName, null);
    assert.equal(clearedObject.body.objectAddress, null);
    const clearedGantt = state.gantt_rentals.find(item => item.rentalId === created.body.id);
    assert.equal(clearedGantt.objectId, undefined);
    assert.equal(clearedGantt.objectName, undefined);
  });
});

test('rental accepts same client contract on another client object', async () => {
  const { app, state } = createApp();

  await withServer(app, async baseUrl => {
    state.client_objects.push({ id: 'CO-3', clientId: 'C-1', name: 'Цех', address: 'Казань 2', status: 'active' });
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      objectId: 'CO-3',
      contractId: 'CC-1',
    }));

    assert.equal(created.status, 201);
    assert.equal(created.body.objectId, 'CO-3');
    assert.equal(created.body.contractId, 'CC-1');
  });
});

test('rental can be created without ClientObject while keeping Client and Contract links', async () => {
  const { app, state } = createApp();

  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({ objectId: undefined }));

    assert.equal(created.status, 201);
    assert.equal(created.body.clientId, 'C-1');
    assert.equal(created.body.objectId, undefined);
    assert.equal(created.body.contractId, 'CC-1');
    const projection = state.gantt_rentals.find(item => item.rentalId === created.body.id);
    assert.equal(projection.objectId, undefined);
    assert.equal(projection.contractId, 'CC-1');
  });
});

test('rental creation still requires a Client contract when ClientObject is omitted', async () => {
  const { app } = createApp();

  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      objectId: undefined,
      contractId: undefined,
    }));

    assert.equal(response.status, 400);
    assert.match(response.body.error, /клиента и договор/i);
  });
});

test('archived contract is rejected for new Rental while historical Rental keeps it by stable ID', async () => {
  const { app, state } = createApp();

  await withServer(app, async baseUrl => {
    state.client_contracts[0].status = 'archived';
    const rejectedCreate = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
    assert.equal(rejectedCreate.status, 409);
    assert.equal(rejectedCreate.body.code, 'CLIENT_CONTRACT_ARCHIVED');
    assert.equal(state.rentals.length, 0);

    state.client_contracts[0].status = 'active';
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
    assert.equal(created.status, 201);

    state.client_contracts[0].status = 'archived';
    const historicalUpdate = await request(baseUrl, 'PATCH', `/api/rentals/${created.body.id}`, {
      contact: 'Исторический контакт',
    });
    assert.equal(historicalUpdate.status, 200, JSON.stringify(historicalUpdate.body));
    assert.equal(historicalUpdate.body.contractId, 'CC-1');
    assert.equal(historicalUpdate.body.contractNumber, 'Д-1');

    state.client_contracts.push({
      id: 'CC-3',
      clientId: 'C-1',
      objectId: 'CO-1',
      number: 'Д-3',
      status: 'archived',
    });
    const rejectedPatch = await request(baseUrl, 'PATCH', `/api/rentals/${created.body.id}`, {
      contractId: 'CC-3',
    });
    assert.equal(rejectedPatch.status, 409);
    assert.equal(rejectedPatch.body.code, 'CLIENT_CONTRACT_ARCHIVED');
    assert.equal(state.rentals[0].contractId, 'CC-1');
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
    const second = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      equipmentId: 'EQ-2',
      equipmentInv: 'INV-2',
      equipment: ['INV-2'],
      creditRiskAcknowledged: true,
    }));

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

test('Stage H patch reconciles old and new equipment projections and canonical snapshots', async () => {
  const { app, state } = createApp();

  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
    assert.equal(created.status, 201);

    const reassigned = await request(baseUrl, 'PATCH', `/api/rentals/${created.body.id}`, {
      equipmentId: 'EQ-2',
      equipmentInv: 'FORGED-INV',
      inventoryNumber: 'FORGED-INV',
      serialNumber: 'FORGED-SERIAL',
      equipment: ['FORGED-INV'],
    });

    assert.equal(reassigned.status, 200);
    assert.equal(reassigned.body.equipmentId, 'EQ-2');
    assert.equal(reassigned.body.equipmentInv, 'INV-2');
    assert.equal(reassigned.body.serialNumber, 'SN-2');
    assert.deepEqual(reassigned.body.equipment, ['INV-2']);
    assert.equal(state.gantt_rentals[0].equipmentId, 'EQ-2');
    assert.equal(state.gantt_rentals[0].equipmentInv, 'INV-2');
    assert.equal(state.equipment.find(item => item.id === 'EQ-1').status, 'available');
    assert.equal(state.equipment.find(item => item.id === 'EQ-1').currentClient, undefined);
    assert.equal(state.equipment.find(item => item.id === 'EQ-2').status, 'reserved');
    assert.equal(state.equipment.find(item => item.id === 'EQ-2').currentClient, 'ООО Ромашка');
    assert.equal(state.equipment.find(item => item.id === 'EQ-2').returnDate, '2026-05-20');

    const shortened = await request(baseUrl, 'PATCH', `/api/rentals/${created.body.id}`, {
      plannedReturnDate: '2026-05-18',
    });
    assert.equal(shortened.status, 200);
    assert.equal(state.gantt_rentals[0].endDate, '2026-05-18');
    assert.equal(state.equipment.find(item => item.id === 'EQ-2').returnDate, '2026-05-18');

    const extended = await request(baseUrl, 'POST', `/api/rentals/${created.body.id}/extend`, {
      newEndDate: '2026-08-24',
      reason: 'Клиент продлил работы',
      confirmedByClient: true,
      invoiceSentToClient: true,
    });
    assert.equal(extended.status, 200, JSON.stringify(extended.body));
    assert.equal(state.gantt_rentals[0].endDate, '2026-08-24');
    assert.equal(state.equipment.find(item => item.id === 'EQ-2').returnDate, '2026-08-24');
  });
});

test('Stage H reassignment rejects service, downtime and inactive targets without partial writes', async () => {
  for (const scenario of ['service', 'downtime', 'inactive']) {
    const state = createState();
    const { app } = createApp(state);

    await withServer(app, async baseUrl => {
      const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
      assert.equal(created.status, 201);
      if (scenario === 'service') {
        state.service.push({ id: 'S-block', equipmentId: 'EQ-2', status: 'in_progress' });
      } else if (scenario === 'downtime') {
        state.equipment_downtimes = [{
          id: 'DT-block',
          equipmentId: 'EQ-2',
          startDate: '2026-05-12',
          endDate: '2026-05-14',
          status: 'active',
        }];
      } else {
        state.equipment[1] = { ...state.equipment[1], status: 'inactive', activeInFleet: false };
      }
      const before = structuredClone({
        rentals: state.rentals,
        gantt: state.gantt_rentals,
        equipment: state.equipment,
      });

      const response = await request(baseUrl, 'PATCH', `/api/rentals/${created.body.id}`, {
        equipmentId: 'EQ-2',
      });

      assert.equal(response.status, 409, scenario);
      assert.match(response.body.code, /RENTAL_EQUIPMENT_(IN_SERVICE|DOWNTIME_CONFLICT|INACTIVE)/);
      assert.deepEqual(state.rentals, before.rentals);
      assert.deepEqual(state.gantt_rentals, before.gantt);
      assert.deepEqual(state.equipment, before.equipment);
    });
  }
});

test('Stage H rental patch batch failure rolls back classic, planner and both equipment rows', async () => {
  const options = { failBatch: false };
  const { app, state } = createApp(createState(), options);

  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
    assert.equal(created.status, 201);
    const before = structuredClone({
      rentals: state.rentals,
      gantt: state.gantt_rentals,
      equipment: state.equipment,
    });
    options.failBatch = true;

    const response = await request(baseUrl, 'PATCH', `/api/rentals/${created.body.id}`, {
      equipmentId: 'EQ-2',
      plannedReturnDate: '2026-05-18',
    });

    assert.equal(response.status, 500);
    assert.deepEqual(state.rentals, before.rentals);
    assert.deepEqual(state.gantt_rentals, before.gantt);
    assert.deepEqual(state.equipment, before.equipment);
  });
});

test('Stage H delete cascades planner row, retains history and frees equipment atomically', async () => {
  const { app, state } = createApp();

  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
    assert.equal(created.status, 201);
    state.payments.push({ id: 'P-history', rentalId: created.body.id, amount: 1000 });
    state.documents.push({ id: 'D-history', rentalId: created.body.id, type: 'act' });

    const linkedGanttDelete = await request(baseUrl, 'DELETE', `/api/gantt_rentals/${state.gantt_rentals[0].id}`);
    assert.equal(linkedGanttDelete.status, 409);
    assert.equal(linkedGanttDelete.body.code, 'GANTT_PROJECTION_READ_ONLY');

    const deleted = await request(baseUrl, 'DELETE', `/api/rentals/${created.body.id}`);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.cascadedGanttCount, 1);
    assert.deepEqual(deleted.body.retainedHistory, { payments: 1, documents: 1, service: 0, deliveries: 0 });
    assert.equal(state.rentals.length, 0);
    assert.equal(state.gantt_rentals.length, 0);
    assert.equal(state.equipment[0].status, 'available');
    assert.equal(state.equipment[0].currentClient, undefined);
    assert.equal(state.payments.length, 1);
    assert.equal(state.documents.length, 1);

    const repeated = await request(baseUrl, 'DELETE', `/api/rentals/${created.body.id}`);
    assert.equal(repeated.status, 404);
  });
});

test('Stage H delete and bulk removal honor dependency blockers and rollback', async () => {
  const options = { failBatch: false };
  const { app, state } = createApp(createState(), options);

  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
    assert.equal(created.status, 201);
    state.deliveries.push({ id: 'DL-active', rentalId: created.body.id, status: 'planned' });
    const blocked = await request(baseUrl, 'DELETE', `/api/rentals/${created.body.id}`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'RENTAL_DELETE_ACTIVE_DELIVERY');
    assert.equal(state.rentals.length, 1);

    state.deliveries[0].status = 'completed';
    const before = structuredClone({
      rentals: state.rentals,
      gantt: state.gantt_rentals,
      equipment: state.equipment,
    });
    options.failBatch = true;
    const failedDelete = await request(baseUrl, 'DELETE', `/api/rentals/${created.body.id}`);
    assert.equal(failedDelete.status, 500);
    assert.equal(failedDelete.body.code, 'RENTAL_DELETE_PERSISTENCE_FAILED');
    assert.deepEqual(state.rentals, before.rentals);
    assert.deepEqual(state.gantt_rentals, before.gantt);
    assert.deepEqual(state.equipment, before.equipment);

    const failedBulk = await request(baseUrl, 'PUT', '/api/rentals', []);
    assert.equal(failedBulk.status, 500);
    assert.equal(failedBulk.body.code, 'RENTAL_BULK_REPLACE_PERSISTENCE_FAILED');
    assert.deepEqual(state.rentals, before.rentals);
    assert.deepEqual(state.gantt_rentals, before.gantt);
    assert.deepEqual(state.equipment, before.equipment);

    options.failBatch = false;
    const bulkRemoved = await request(baseUrl, 'PUT', '/api/rentals', []);
    assert.equal(bulkRemoved.status, 200);
    assert.equal(state.rentals.length, 0);
    assert.equal(state.gantt_rentals.length, 0);
    assert.equal(state.equipment[0].status, 'available');
  });
});

test('Stage H managerId is authoritative while unrelated legacy edits remain compatible', async () => {
  const { app, state } = createApp();
  state.users.push({ id: 'U-manager', name: 'Мария Менеджер', role: 'Менеджер по аренде', status: 'Активен' });

  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      managerId: 'U-manager',
      manager: 'Подменённое имя',
    }));
    assert.equal(created.status, 201);
    assert.equal(created.body.managerId, 'U-manager');
    assert.equal(created.body.manager, 'Мария Менеджер');
    assert.equal(state.gantt_rentals[0].managerId, 'U-manager');
    assert.equal(state.gantt_rentals[0].manager, 'Мария Менеджер');

    state.users.find(item => item.id === 'U-manager').name = 'Мария После Переименования';
    const currentRead = await request(baseUrl, 'GET', `/api/rentals/${created.body.id}`);
    const currentPlannerRead = await request(baseUrl, 'GET', '/api/gantt_rentals');
    assert.equal(currentRead.body.manager, 'Мария После Переименования');
    assert.equal(currentPlannerRead.body[0].manager, 'Мария После Переименования');
    state.users.find(item => item.id === 'U-manager').name = 'Мария Менеджер';

    const missing = await request(baseUrl, 'PATCH', `/api/rentals/${created.body.id}`, {
      managerId: 'U-missing',
      manager: 'Мария Менеджер',
    });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.field, 'managerId');

    state.rentals[0] = { ...state.rentals[0], managerId: undefined, manager: 'Legacy Manager' };
    state.gantt_rentals[0] = { ...state.gantt_rentals[0], managerId: undefined, manager: 'Legacy Manager' };
    const legacyEdit = await request(baseUrl, 'PATCH', `/api/rentals/${created.body.id}`, {
      plannedReturnDate: '2026-05-19',
    });
    assert.equal(legacyEdit.status, 200);
    assert.equal(legacyEdit.body.managerId, undefined);
    assert.equal(legacyEdit.body.manager, 'Legacy Manager');
    assert.equal(state.gantt_rentals[0].manager, 'Legacy Manager');
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
    assert.equal(delivery.body.number, 'DLV-26-000001');

    const forgedPatch = await request(baseUrl, 'PATCH', `/api/deliveries/${delivery.body.id}`, {
      number: 'DLV-26-999999',
    });
    assert.equal(forgedPatch.status, 400);
    assert.equal(forgedPatch.body.code, 'BUSINESS_NUMBER_SERVER_OWNED');
  });
});

test('delivery created after office manager clears Rental object uses only manual operational fields', async () => {
  const { app, state } = createApp();
  state.client_objects[0] = {
    ...state.client_objects[0],
    contactName: 'Контакт старого объекта',
    contactPhone: '+7 900 111-22-33',
  };
  const clientObjectBefore = structuredClone(state.client_objects[0]);

  await withServer(app, async baseUrl => {
    const rental = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
    assert.equal(rental.status, 201);
    const linkedGanttRental = state.gantt_rentals.find(item => item.rentalId === rental.body.id);
    assert.ok(linkedGanttRental);

    const cleared = await request(baseUrl, 'PATCH', `/api/rentals/${rental.body.id}`, {
      objectId: '',
      rentalId: rental.body.id,
      __rentalId: rental.body.id,
      __linkedGanttRentalId: linkedGanttRental.id,
      __ganttRentalId: linkedGanttRental.id,
      __sourceRentalId: linkedGanttRental.id,
      entityType: 'rental',
      actionType: 'rental_detail_update',
    }, { authorization: 'Bearer office-token' });
    assert.equal(cleared.status, 200);

    const reloadedRental = await request(baseUrl, 'GET', `/api/rentals/${rental.body.id}`);
    assert.equal(reloadedRental.body.objectId, undefined);
    assert.equal(reloadedRental.body.objectName, null);
    assert.equal(reloadedRental.body.objectAddress, null);
    assert.equal(reloadedRental.body.objectContactName, null);
    assert.equal(reloadedRental.body.objectContactPhone, null);

    const delivery = await request(baseUrl, 'POST', '/api/deliveries', {
      type: 'shipping',
      rentalId: rental.body.id,
      transportDate: '2026-05-10',
      origin: 'Склад',
      destination: 'Ручной адрес доставки',
      cargo: 'Подъемник',
      contactName: 'Ручной контакт',
      contactPhone: '+7 900 999-88-77',
    });

    assert.equal(delivery.status, 201);
    assert.equal(delivery.body.objectId, null);
    assert.equal(delivery.body.objectName, null);
    assert.equal(delivery.body.objectAddress, null);
    assert.equal(delivery.body.objectContactName, null);
    assert.equal(delivery.body.objectContactPhone, null);
    assert.equal(delivery.body.destination, 'Ручной адрес доставки');
    assert.equal(delivery.body.contactName, 'Ручной контакт');
    assert.equal(delivery.body.contactPhone, '+7 900 999-88-77');
    assert.deepEqual(state.client_objects[0], clientObjectBefore);
  });
});

test('shipping delivery date change recalculates daily pricing and keeps classic and planner rows in sync', async () => {
  const { app, state } = createApp();

  await withServer(app, async baseUrl => {
    const rental = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      startDate: '2026-05-10',
      plannedReturnDate: '2026-05-12',
      pricingMode: 'daily_rate',
      rate: '1000',
      dailyRate: 1000,
      price: 3000,
    }));
    assert.equal(rental.status, 201);

    const delivery = await request(baseUrl, 'POST', '/api/deliveries', {
      type: 'shipping',
      rentalId: rental.body.id,
      transportDate: '2026-05-11',
      origin: 'Склад',
      destination: 'Объект',
      cargo: 'Подъемник',
      contactName: 'Иван',
      contactPhone: '+7 900 000-00-00',
    });

    assert.equal(delivery.status, 201);
    const classic = state.rentals.find(item => item.id === rental.body.id);
    const planner = state.gantt_rentals.find(item => item.rentalId === rental.body.id);
    assert.equal(classic.startDate, '2026-05-11');
    assert.equal(classic.price, 2000);
    assert.equal(planner.startDate, '2026-05-11');
    assert.equal(planner.amount, 2000);
    assert.equal(state.deliveries.length, 1);
  });
});

test('receiving delivery cannot create an invalid rental range and leaves all linked collections unchanged', async () => {
  const { app, state } = createApp();

  await withServer(app, async baseUrl => {
    const rental = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      startDate: '2026-05-10',
      plannedReturnDate: '2026-05-12',
      pricingMode: 'daily_rate',
      rate: '1000',
      dailyRate: 1000,
      price: 3000,
    }));
    assert.equal(rental.status, 201);
    const beforeRentals = structuredClone(state.rentals);
    const beforeGantt = structuredClone(state.gantt_rentals);

    const delivery = await request(baseUrl, 'POST', '/api/deliveries', {
      type: 'receiving',
      rentalId: rental.body.id,
      transportDate: '2026-05-09',
      origin: 'Объект',
      destination: 'Склад',
      cargo: 'Подъемник',
      contactName: 'Иван',
      contactPhone: '+7 900 000-00-00',
    });

    assert.equal(delivery.status, 400);
    assert.equal(delivery.body.code, 'RENTAL_PAYLOAD_VALIDATION_FAILED');
    assert.equal(delivery.body.field, 'plannedReturnDate');
    assert.deepEqual(state.rentals, beforeRentals);
    assert.deepEqual(state.gantt_rentals, beforeGantt);
    assert.deepEqual(state.deliveries, []);
  });
});

test('delivery batch failure leaves rental, planner and delivery collections unchanged', async () => {
  const state = createState();
  const { app } = createApp(state, { failBatch: true });
  state.rentals = [{
    id: 'R-existing',
    ...rentalPayload({
      startDate: '2026-05-10',
      plannedReturnDate: '2026-05-12',
      pricingMode: 'daily_rate',
      rate: '1000 ₽/день',
      dailyRate: 1000,
      price: 3000,
    }),
  }];
  state.gantt_rentals = [{
    id: 'GR-existing',
    rentalId: 'R-existing',
    sourceRentalId: 'R-existing',
    originalRentalId: 'R-existing',
    clientId: 'C-1',
    client: 'ООО Ромашка',
    equipmentId: 'EQ-1',
    equipmentInv: 'INV-1',
    startDate: '2026-05-10',
    endDate: '2026-05-12',
    amount: 3000,
    status: 'created',
  }];
  const beforeRentals = structuredClone(state.rentals);
  const beforeGantt = structuredClone(state.gantt_rentals);

  await withServer(app, async baseUrl => {
    const delivery = await request(baseUrl, 'POST', '/api/deliveries', {
      type: 'shipping',
      rentalId: 'R-existing',
      transportDate: '2026-05-11',
      origin: 'Склад',
      destination: 'Объект',
      cargo: 'Подъемник',
      contactName: 'Иван',
      contactPhone: '+7 900 000-00-00',
    });

    assert.equal(delivery.status, 500);
    assert.match(delivery.body.error, /Injected delivery batch failure/);
    assert.deepEqual(state.rentals, beforeRentals);
    assert.deepEqual(state.gantt_rentals, beforeGantt);
    assert.deepEqual(state.deliveries, []);
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
  const clients = [
    { id: 'C-1', counterpartyId: 'CP-1', company: 'ООО Ромашка' },
    { id: 'C-2', counterpartyId: 'CP-2', company: 'ООО Ромашка Плюс' },
  ];
  const rentals = [
    { id: 'R-1', counterpartyId: 'CP-1', clientId: 'C-1', client: 'ООО Ромашка', equipmentInv: 'INV-1', amount: 100000, status: 'closed', endDate: '2026-05-20' },
    { id: 'R-2', counterpartyId: 'CP-2', clientId: 'C-2', client: 'ООО Ромашка Плюс', equipmentInv: 'INV-2', amount: 100000, status: 'closed', endDate: '2026-05-20' },
  ];
  const payments = [
    { id: 'P-1', counterpartyId: 'CP-1', rentalId: 'R-1', clientId: 'C-1', amount: 100000, paidAmount: 100000, status: 'paid' },
  ];
  const counterparties = [
    { id: 'CP-1', roles: ['customer'], status: 'active' },
    { id: 'CP-2', roles: ['customer'], status: 'active' },
  ];
  const report = buildFinanceReport({
    clients,
    rentals,
    payments,
    relationData: { clients, gantt_rentals: rentals, payments, counterparties },
  }, '2026-05-21');

  assert.deepEqual(report.debtRows.map(row => row.rentalId), ['R-2']);
  assert.equal(report.clientSnapshots.find(item => item.clientId === 'C-1').currentDebt, 0);
  assert.equal(report.clientSnapshots.find(item => item.clientId === 'C-2').currentDebt, 100000);

  const c1Summary = buildClient360Summary({
    client: { id: 'C-1', counterpartyId: 'CP-1', company: 'ООО Ромашка' },
    rentals: [{ id: 'R-1', counterpartyId: 'CP-1', clientId: 'C-1', client: 'ООО Ромашка', status: 'closed' }],
    documents: [
      { id: 'D-1', rentalId: 'R-1', clientId: 'C-1', type: 'act', status: 'signed' },
      { id: 'D-2', rentalId: 'R-2', clientId: 'C-2', type: 'act', status: 'signed' },
    ],
  });

  assert.deepEqual(c1Summary.documents.latest.map(item => item.id), ['D-1']);
});
