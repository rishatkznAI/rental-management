import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const { registerRentalChangeRequestRoutes } = require('../server/routes/rental-change-requests.js');
const { registerRentalRoutes } = require('../server/routes/rentals.js');
const { validateRentalPayload } = require('../server/lib/rental-validation.js');
const { canonicalizeRentalPatch } = require('../server/lib/rental-data-integrity.js');

const NOW = '2026-05-15T09:00:00.000Z';

function createState() {
  return {
    users: [
      { id: 'U-admin', name: 'Админ', role: 'Администратор', status: 'Активен' },
      { id: 'U-office', name: 'Офис', role: 'Офис-менеджер', status: 'Активен' },
      { id: 'U-rental', name: 'Аренда', role: 'Менеджер по аренде', status: 'Активен' },
    ],
    clients: [{ id: 'C-1', company: 'ООО Клиент', manager: 'Аренда', managerId: 'U-rental' }],
    client_objects: [{
      id: 'CO-1',
      clientId: 'C-1',
      name: 'Канонический объект',
      address: 'Канонический адрес',
      contactName: 'Канонический контакт',
      contactPhone: '+7 900 000-00-01',
      status: 'active',
    }],
    client_contracts: [{
      id: 'CC-1',
      clientId: 'C-1',
      objectId: 'CO-1',
      number: 'BUS-2026/15',
      status: 'active',
    }],
    equipment: [{
      id: 'EQ-1',
      inventoryNumber: 'INV-1',
      serialNumber: 'SN-1',
      manufacturer: 'Sky',
      model: 'Lift',
      status: 'available',
      activeInFleet: true,
      category: 'own',
    }],
    rentals: [],
    gantt_rentals: [],
    rental_change_requests: [],
    service: [],
    payments: [],
    payment_allocations: [],
    documents: [],
    audit_logs: [],
    audit_log: [],
  };
}

const ACTORS = {
  'admin-token': { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' },
  'office-token': { userId: 'U-office', userName: 'Офис', userRole: 'Офис-менеджер' },
  'rental-token': { userId: 'U-rental', userName: 'Аренда', userRole: 'Менеджер по аренде' },
};

function createApp(state = createState(), options = {}) {
  const app = express();
  app.use(express.json());
  const readData = name => state[name] || [];
  const writeData = (name, value) => { state[name] = value; };
  const writeDataBatch = entries => {
    if (options.failBatch) throw new Error('Injected batch failure');
    const pending = (entries || []).map(entry => [entry.name, entry.value]);
    for (const [name, value] of pending) state[name] = value;
  };
  const accessControl = createAccessControl({ readData });
  let idCounter = 0;

  function requireAuth(req, res, next) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const actor = ACTORS[token];
    if (!actor) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = actor;
    return next();
  }

  app.use('/api', registerRentalRoutes({
    readData,
    writeData,
    writeDataBatch,
    requireAuth,
    requireRead: () => (_req, _res, next) => next(),
    validateRentalPayload,
    mergeRentalHistory: (_previous, next) => next,
    normalizeGanttRentalList: list => list,
    normalizeGanttRentalStatus: item => item,
    normalizeRecordClientLink: item => item,
    generateId: prefix => `${prefix}-${++idCounter}`,
    idPrefixes: { rentals: 'R', gantt_rentals: 'GR', rental_change_requests: 'RCR', service: 'S' },
    accessControl,
    auditLog: () => {},
    nowIso: () => NOW,
  }));
  app.use('/api', registerRentalChangeRequestRoutes({
    readData,
    writeData,
    writeDataBatch,
    requireAuth,
    requireRead: () => (_req, _res, next) => next(),
    validateRentalPayload,
    generateId: prefix => `${prefix}-${++idCounter}`,
    idPrefixes: { rental_change_requests: 'RCR' },
    accessControl,
  }));
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

async function request(baseUrl, method, path, body, token = 'admin-token', extraHeaders = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function rentalPayload(overrides = {}) {
  return {
    clientId: 'C-1',
    objectId: 'CO-1',
    contractId: 'CC-1',
    client: 'ООО Клиент',
    contact: 'Контакт',
    startDate: '2026-05-10',
    plannedReturnDate: '2026-05-20',
    equipmentId: 'EQ-1',
    equipmentInv: 'INV-1',
    equipment: ['INV-1'],
    price: 100000,
    rate: '10000',
    discount: 0,
    manager: 'Аренда',
    managerId: 'U-rental',
    status: 'active',
    paymentStatus: 'unpaid',
    ...overrides,
  };
}

function forgedAuditFields() {
  return {
    creditRiskAcknowledged: true,
    creditRiskSnapshot: { currentDebt: 0, exceededLimit: false, forged: true },
    creditRiskAcknowledgedAt: '2000-01-01T00:00:00.000Z',
    creditRiskAcknowledgedBy: 'Злоумышленник',
    creditRiskAcknowledgedByUserId: 'U-forged',
    riskSnapshot: { forged: true },
    approvedBy: 'U-forged',
    approvedAt: '2000-01-01T00:00:00.000Z',
    createdBy: 'U-forged',
    createdByName: 'Злоумышленник',
    createdByUserName: 'Злоумышленник',
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedBy: 'U-forged',
    updatedByName: 'Злоумышленник',
    updatedByUserName: 'Злоумышленник',
    updatedAt: '2000-01-01T00:00:00.000Z',
    financialRiskApprovedBy: 'U-forged',
    auditTrail: [{ actor: 'U-forged' }],
    history: [{ author: 'U-forged', text: 'forged' }],
  };
}

test('POST ignores forged audit fields when no financial risk exists', async () => {
  const { app, state } = createApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/rentals', rentalPayload(forgedAuditFields()));

    assert.equal(response.status, 201);
    const stored = state.rentals[0];
    for (const field of Object.keys(forgedAuditFields())) assert.equal(stored[field], undefined, field);
  });
});

test('POST with risk accepts only approve decision and writes server snapshot, office actor and server time', async () => {
  const state = createState();
  state.clients[0].creditLimit = 50000;
  state.clients[0].debt = 75000;
  const { app } = createApp(state);

  await withServer(app, async baseUrl => {
    const blocked = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      creditRiskSnapshot: { exceededLimit: false },
      approvedBy: 'U-forged',
      approvedAt: '2000-01-01T00:00:00.000Z',
    }), 'office-token');
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'CLIENT_CREDIT_RISK_ACKNOWLEDGEMENT_REQUIRED');
    assert.equal(state.rentals.length, 0);

    const approved = await request(baseUrl, 'POST', '/api/rentals', rentalPayload(forgedAuditFields()), 'office-token');
    assert.equal(approved.status, 201);
    assert.equal(state.rentals[0].creditRiskSnapshot.exceededLimit, true);
    assert.equal(state.rentals[0].creditRiskSnapshot.forged, undefined);
    assert.equal(state.rentals[0].creditRiskAcknowledgedByUserId, 'U-office');
    assert.equal(state.rentals[0].creditRiskAcknowledgedBy, 'Офис');
    assert.equal(state.rentals[0].creditRiskAcknowledgedAt, NOW);
    assert.equal(state.rentals[0].approvedBy, undefined);
    assert.equal(state.rentals[0].approvedAt, undefined);
    assert.equal(state.rentals[0].creditRiskAcknowledged, undefined);
  });
});

test('ordinary rental manager cannot create a rental even with forged approval audit', async () => {
  const { app, state } = createApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/rentals', rentalPayload(forgedAuditFields()), 'rental-token');
    assert.equal(response.status, 403);
    assert.equal(state.rentals.length, 0);
    assert.equal(state.gantt_rentals.length, 0);
    assert.equal(state.equipment[0].status, 'available');
  });
});

test('generic PATCH rejects forged audit fields for rental manager, office manager and admin', async () => {
  for (const token of ['rental-token', 'office-token', 'admin-token']) {
    const state = createState();
    state.rentals.push({ id: 'R-existing', ...rentalPayload(), creditRiskSnapshot: { currentDebt: 75000 } });
    const before = structuredClone(state.rentals[0]);
    const { app } = createApp(state);
    await withServer(app, async baseUrl => {
      const response = await request(baseUrl, 'PATCH', '/api/rentals/R-existing', {
        comments: 'legitimate change mixed with forgery',
        creditRiskSnapshot: { currentDebt: 0 },
        approvedBy: 'U-forged',
        approvedAt: '2000-01-01T00:00:00.000Z',
      }, token);
      assert.equal(response.status, 403, token);
      assert.equal(response.body.code, 'RENTAL_AUDIT_FIELDS_IMMUTABLE');
      assert.deepEqual(state.rentals[0], before);
      assert.equal(state.rental_change_requests.length, 0);
    });
  }
});

test('planner rental projection write surfaces are read-only', async () => {
  const { app, state } = createApp();
  await withServer(app, async baseUrl => {
    const standalone = await request(baseUrl, 'POST', '/api/gantt_rentals', {
      sourceType: 'maintenance',
      operationType: 'maintenance',
      client: 'ТО',
      equipmentId: 'EQ-1',
      equipmentInv: 'INV-1',
      startDate: '2026-04-10',
      endDate: '2026-04-10',
      status: 'maintenance',
      ...forgedAuditFields(),
    });
    assert.equal(standalone.status, 409);
    assert.equal(standalone.body.code, 'GANTT_PROJECTION_READ_ONLY');
    assert.equal(state.gantt_rentals.length, 0);

    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
    assert.equal(created.status, 201);
    const linked = state.gantt_rentals.find(item => item.rentalId === created.body.id);
    const before = structuredClone(linked);
    const patched = await request(baseUrl, 'PATCH', `/api/gantt_rentals/${linked.id}`, {
      creditRiskSnapshot: { currentDebt: 0, forged: true },
      approvedBy: 'U-forged',
    });
    assert.equal(patched.status, 409);
    assert.equal(patched.body.code, 'GANTT_PROJECTION_READ_ONLY');
    assert.deepEqual(state.gantt_rentals.find(item => item.id === linked.id), before);
  });
});

test('admin bulk replace cannot bypass rental audit immutability', async () => {
  const state = createState();
  state.rentals.push({ id: 'R-existing', ...rentalPayload() });
  const before = structuredClone(state.rentals);
  const { app } = createApp(state);
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'PUT', '/api/rentals', [{
      ...state.rentals[0],
      creditRiskSnapshot: { currentDebt: 0, forged: true },
    }]);
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'RENTAL_AUDIT_FIELDS_IMMUTABLE');
    assert.deepEqual(state.rentals, before);
  });
});

test('current rental becomes active and equipment becomes rented in the same batch', async () => {
  const { app, state } = createApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
    assert.equal(response.status, 201);
    assert.equal(state.rentals[0].status, 'active');
    assert.equal(state.gantt_rentals[0].status, 'active');
    assert.equal(state.equipment[0].status, 'rented');
    assert.equal(state.equipment[0].currentClient, 'ООО Клиент');
    assert.equal(state.equipment[0].returnDate, '2026-05-20');
  });
});

test('future rental becomes created and equipment becomes reserved', async () => {
  const { app, state } = createApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      startDate: '2026-06-01',
      plannedReturnDate: '2026-06-10',
      status: 'active',
    }));
    assert.equal(response.status, 201);
    assert.equal(state.rentals[0].status, 'created');
    assert.equal(state.gantt_rentals[0].status, 'created');
    assert.equal(state.equipment[0].status, 'reserved');
    assert.equal(state.equipment[0].returnDate, '2026-06-10');
  });
});

test('completed historical rental does not overwrite current equipment lifecycle', async () => {
  const { app, state } = createApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      startDate: '2026-04-01',
      plannedReturnDate: '2026-04-10',
      actualReturnDate: '2026-04-10',
      status: 'completed',
    }));
    assert.equal(response.status, 201);
    assert.equal(state.rentals[0].status, 'completed');
    assert.equal(state.gantt_rentals[0].status, 'closed');
    assert.equal(state.equipment[0].status, 'available');
    assert.equal(state.equipment[0].history, undefined);
  });
});

test('parallel overlapping creation commits exactly one rental and one lifecycle transition', async () => {
  const { app, state } = createApp();
  await withServer(app, async baseUrl => {
    const [left, right] = await Promise.all([
      request(baseUrl, 'POST', '/api/rentals', rentalPayload()),
      request(baseUrl, 'POST', '/api/rentals', rentalPayload()),
    ]);
    assert.deepEqual([left.status, right.status].sort(), [201, 409]);
    assert.equal(state.rentals.length, 1);
    assert.equal(state.gantt_rentals.length, 1);
    assert.equal(state.equipment[0].status, 'rented');
    assert.equal(state.equipment[0].history.length, 1);
  });
});

test('rental idempotency key is bound to the creating user', async () => {
  const { app, state } = createApp();
  const headers = { 'Idempotency-Key': 'rental-actor-0001' };
  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload(), 'admin-token', headers);
    const otherActor = await request(baseUrl, 'POST', '/api/rentals', rentalPayload(), 'office-token', headers);

    assert.equal(created.status, 201);
    assert.equal(otherActor.status, 409);
    assert.equal(otherActor.body.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(state.rentals.length, 1);
    assert.equal(state.gantt_rentals.length, 1);
    assert.equal(state.rental_create_idempotency.length, 1);
  });
});

test('rental create rejects adversarial numeric and date payloads before any lifecycle write', async t => {
  const cases = [
    { name: 'negative deposit', override: { deposit: -1 }, field: 'deposit' },
    { name: 'malformed price', override: { price: 'abc' }, field: 'price' },
    { name: 'non-finite price text', override: { price: '1e309' }, field: 'price' },
    { name: 'garbage around rate', override: { rate: 'garbage 10000/day' }, field: 'rate' },
    { name: 'missing dates', override: { startDate: undefined, plannedReturnDate: undefined }, field: 'startDate' },
    { name: 'date with valid prefix and garbage suffix', override: { startDate: '2026-05-10junk' }, field: 'startDate' },
    { name: 'conflicting gross amount aliases', override: { price: 100000, amount: 1 }, field: 'price' },
    { name: 'discount above gross price', override: { price: 1000, discount: 1001 }, field: 'discount' },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const { app, state } = createApp();
      await withServer(app, async baseUrl => {
        const response = await request(
          baseUrl,
          'POST',
          '/api/rentals',
          rentalPayload(scenario.override),
          'admin-token',
          { 'Idempotency-Key': `invalid-${scenario.name.replace(/\W+/g, '-').toLowerCase()}-0001` },
        );

        assert.equal(response.status, 400);
        assert.equal(response.body.code, 'RENTAL_PAYLOAD_VALIDATION_FAILED');
        assert.equal(response.body.field, scenario.field);
        assert.equal(typeof response.body.fieldErrors[scenario.field], 'string');
        assert.equal(state.rentals.length, 0);
        assert.equal(state.gantt_rentals.length, 0);
        assert.equal(state.equipment[0].status, 'available');
        assert.equal(state.equipment[0].history, undefined);
        assert.equal(state.rental_create_idempotency, undefined);
      });
    });
  }
});

test('manual rental total remains authoritative and money is persisted canonically', async () => {
  const { app, state } = createApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      price: '77777.50',
      rate: '10000 ₽/день',
      amount: '   ',
      pricingMode: '',
      dailyRate: '',
      discount: '0.00',
      deposit: '0.00',
    }));

    assert.equal(response.status, 201);
    assert.equal(state.rentals[0].price, 77777.5);
    assert.equal(state.rentals[0].rate, '10000 ₽/день');
    assert.equal(state.rentals[0].discount, 0);
    assert.equal(state.rentals[0].deposit, 0);
    assert.equal(state.rentals[0].amount, undefined);
    assert.equal(state.rentals[0].pricingMode, undefined);
    assert.equal(state.rentals[0].dailyRate, undefined);
    assert.equal(typeof state.rentals[0].price, 'number');
    assert.equal(state.gantt_rentals[0].amount, 77777.5);
  });
});

test('daily-rate create derives canonical total before fingerprint and exact lifecycle persistence', async () => {
  const { app, state } = createApp();
  const headers = { 'Idempotency-Key': 'canonical-daily-rate-0001' };
  await withServer(app, async baseUrl => {
    const first = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      startDate: '2026-06-10',
      plannedReturnDate: '2026-06-12',
      pricingMode: 'daily_rate',
      dailyRate: '2468.00',
      rate: '2468.0 ₽/день',
      price: 1,
      discount: '0',
      deposit: '9876.00',
    }), 'admin-token', headers);
    const replay = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      startDate: '2026-06-10',
      plannedReturnDate: '2026-06-12',
      pricingMode: 'daily_rate',
      dailyRate: 2468,
      rate: 2468,
      price: 7404,
      discount: 0,
      deposit: 9876,
    }), 'admin-token', headers);

    assert.equal(first.status, 201);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.id, first.body.id);
    assert.equal(state.rentals.length, 1);
    assert.equal(state.gantt_rentals.length, 1);
    assert.equal(state.equipment[0].history.length, 1);
    assert.equal(state.rental_create_idempotency.length, 1);
    assert.equal(state.rentals[0].pricingMode, 'daily_rate');
    assert.equal(state.rentals[0].dailyRate, 2468);
    assert.equal(state.rentals[0].rate, '2468 ₽/день');
    assert.equal(state.rentals[0].price, 7404);
    assert.equal(state.rentals[0].deposit, 9876);
    assert.equal(state.gantt_rentals[0].amount, 7404);
  });
});

test('patch canonicalization preserves partial semantics and enforces resulting pricing state', () => {
  const dailyRental = {
    id: 'R-daily',
    startDate: '2026-06-10',
    plannedReturnDate: '2026-06-12',
    pricingMode: 'daily_rate',
    dailyRate: 1000,
    rate: '1000 ₽/день',
    price: 3000,
    amount: 3000,
    discount: 100,
    deposit: 500,
    comments: 'keep me',
  };

  const omitted = canonicalizeRentalPatch(dailyRental, { comments: 'changed' }).rental;
  assert.equal(omitted.deposit, 500);
  assert.equal(omitted.price, 3000);
  assert.equal(omitted.comments, 'changed');

  const zero = canonicalizeRentalPatch(dailyRental, { deposit: 0 }).rental;
  assert.equal(zero.deposit, 0);
  const cleared = canonicalizeRentalPatch(dailyRental, { deposit: '' }).rental;
  assert.equal(cleared.deposit, 0);
  const nullCleared = canonicalizeRentalPatch(dailyRental, { deposit: null }).rental;
  assert.equal(nullCleared.deposit, 0);

  const newRate = canonicalizeRentalPatch(dailyRental, { dailyRate: '1250.50' }).rental;
  assert.equal(newRate.dailyRate, 1250.5);
  assert.equal(newRate.rate, '1250.5 ₽/день');
  assert.equal(newRate.price, 3751.5);
  assert.equal(newRate.amount, 3751.5);

  const shortened = canonicalizeRentalPatch(dailyRental, { plannedReturnDate: '2026-06-11' }).rental;
  assert.equal(shortened.price, 2000);
  assert.equal(shortened.amount, 2000);

  const manual = canonicalizeRentalPatch({
    ...dailyRental,
    pricingMode: 'manual_total',
    price: 7777.5,
    amount: 7777.5,
  }, { plannedReturnDate: '2026-06-11' }).rental;
  assert.equal(manual.price, 7777.5);
  assert.equal(manual.amount, 7777.5);

  assert.throws(
    () => canonicalizeRentalPatch(dailyRental, { startDate: '2026-06-13' }),
    error => error?.field === 'plannedReturnDate',
  );
  assert.throws(
    () => canonicalizeRentalPatch(dailyRental, { price: 10, amount: 11 }),
    error => Boolean(error?.fieldErrors?.price && error?.fieldErrors?.amount),
  );
});

test('PATCH rejects Stage F bypass payloads before mutating rental or planner state', async t => {
  const cases = [
    { name: 'negative deposit', patch: { deposit: -1 }, field: 'deposit' },
    { name: 'malformed money', patch: { price: '1000oops' }, field: 'price' },
    { name: 'money with more than two decimals', patch: { deposit: 1.001 }, field: 'deposit' },
    { name: 'malformed rate', patch: { rate: 'garbage 1000/day' }, field: 'rate' },
    { name: 'malformed date', patch: { plannedReturnDate: '2026-06-12junk' }, field: 'plannedReturnDate' },
    { name: 'invalid resulting date range', patch: { startDate: '2026-06-13' }, field: 'plannedReturnDate' },
    { name: 'contradictory gross aliases', patch: { price: 100, amount: 101 }, field: 'price' },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const { app, state } = createApp();
      await withServer(app, async baseUrl => {
        const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
          startDate: '2026-06-10',
          plannedReturnDate: '2026-06-12',
          pricingMode: 'daily_rate',
          dailyRate: 1000,
          rate: '1000 ₽/день',
          price: 1,
          deposit: 500,
        }));
        assert.equal(created.status, 201);
        const beforeRental = structuredClone(state.rentals[0]);
        const beforeGantt = structuredClone(state.gantt_rentals[0]);

        const response = await request(
          baseUrl,
          'PATCH',
          `/api/rentals/${created.body.id}`,
          scenario.patch,
        );

        assert.equal(response.status, 400);
        assert.equal(response.body.code, 'RENTAL_PAYLOAD_VALIDATION_FAILED');
        assert.equal(response.body.field, scenario.field);
        assert.deepEqual(state.rentals[0], beforeRental);
        assert.deepEqual(state.gantt_rentals[0], beforeGantt);
      });
    });
  }
});

test('PATCH recalculates daily pricing, preserves manual totals and synchronizes planner amount', async () => {
  const { app, state } = createApp();
  state.equipment.push({
    ...state.equipment[0],
    id: 'EQ-2',
    inventoryNumber: 'INV-2',
    serialNumber: 'SN-2',
  });
  await withServer(app, async baseUrl => {
    const daily = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      startDate: '2026-06-10',
      plannedReturnDate: '2026-06-12',
      pricingMode: 'daily_rate',
      dailyRate: 1000,
      rate: '1000 ₽/день',
      price: 1,
    }));
    assert.equal(daily.status, 201);

    const rateUpdate = await request(baseUrl, 'PATCH', `/api/rentals/${daily.body.id}`, {
      dailyRate: '1250.50',
      deposit: '',
    });
    assert.equal(rateUpdate.status, 200);
    assert.equal(rateUpdate.body.price, 3751.5);
    assert.equal(rateUpdate.body.deposit, 0);
    assert.equal(state.gantt_rentals.find(item => item.rentalId === daily.body.id).amount, 3751.5);

    const dateUpdate = await request(baseUrl, 'PATCH', `/api/rentals/${daily.body.id}`, {
      plannedReturnDate: '2026-06-11',
    });
    assert.equal(dateUpdate.status, 200);
    assert.equal(dateUpdate.body.price, 2501);
    assert.equal(state.gantt_rentals.find(item => item.rentalId === daily.body.id).endDate, '2026-06-11');
    assert.equal(state.gantt_rentals.find(item => item.rentalId === daily.body.id).amount, 2501);

    const manual = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      equipmentId: 'EQ-2',
      equipmentInv: 'INV-2',
      equipment: ['INV-2'],
      startDate: '2026-06-20',
      plannedReturnDate: '2026-06-22',
      pricingMode: 'manual_total',
      rate: '1000 ₽/день',
      price: 7777.5,
      creditRiskAcknowledged: true,
    }));
    assert.equal(manual.status, 201);
    const manualDateUpdate = await request(baseUrl, 'PATCH', `/api/rentals/${manual.body.id}`, {
      plannedReturnDate: '2026-06-21',
    });
    assert.equal(manualDateUpdate.status, 200);
    assert.equal(manualDateUpdate.body.price, 7777.5);
    assert.equal(state.gantt_rentals.find(item => item.rentalId === manual.body.id).amount, 7777.5);
  });
});

test('approval revalidates protected fields and keeps an invalid request pending without writes', async () => {
  const { app, state } = createApp();
  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({ deposit: 500 }));
    assert.equal(created.status, 201);
    const beforeRental = structuredClone(state.rentals[0]);
    const beforeGantt = structuredClone(state.gantt_rentals[0]);
    const changeRequest = await request(baseUrl, 'POST', '/api/rental_change_requests', {
      entityType: 'rental',
      rentalId: created.body.id,
      linkedGanttRentalId: state.gantt_rentals[0].id,
      field: 'deposit',
      fieldLabel: 'Залог',
      oldValue: 500,
      newValue: -1,
      status: 'pending',
    });
    assert.equal(changeRequest.status, 201);

    const approved = await request(
      baseUrl,
      'POST',
      `/api/rental_change_requests/${changeRequest.body.id}/approve`,
      { comment: 'must fail' },
    );
    assert.equal(approved.status, 400);
    assert.equal(approved.body.code, 'RENTAL_PAYLOAD_VALIDATION_FAILED');
    assert.equal(approved.body.field, 'deposit');
    assert.deepEqual(state.rentals[0], beforeRental);
    assert.deepEqual(state.gantt_rentals[0], beforeGantt);
    assert.equal(state.rental_change_requests[0].status, 'pending');
  });
});

test('approval canonicalizes a daily-rate date change and synchronizes planner billing fields', async () => {
  const { app, state } = createApp();
  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      startDate: '2026-06-10',
      plannedReturnDate: '2026-06-12',
      pricingMode: 'daily_rate',
      dailyRate: 1000,
      rate: '1000 ₽/день',
      price: 1,
    }));
    assert.equal(created.status, 201);
    const gantt = state.gantt_rentals.find(item => item.rentalId === created.body.id);
    const changeRequest = await request(baseUrl, 'POST', '/api/rental_change_requests', {
      entityType: 'rental',
      rentalId: created.body.id,
      linkedGanttRentalId: gantt.id,
      field: 'plannedReturnDate',
      fieldLabel: 'Дата окончания',
      oldValue: '2026-06-12',
      newValue: '2026-06-11',
      status: 'pending',
    });
    assert.equal(changeRequest.status, 201);

    const approved = await request(
      baseUrl,
      'POST',
      `/api/rental_change_requests/${changeRequest.body.id}/approve`,
      { comment: 'approved canonical update' },
    );
    assert.equal(approved.status, 200);
    assert.equal(state.rentals[0].plannedReturnDate, '2026-06-11');
    assert.equal(state.rentals[0].price, 2000);
    assert.equal(state.gantt_rentals[0].endDate, '2026-06-11');
    assert.equal(state.gantt_rentals[0].amount, 2000);
    assert.equal(state.rental_change_requests[0].status, 'approved');
  });
});

test('extension rejects a nonexistent calendar date before rental or planner writes', async () => {
  const { app, state } = createApp();
  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      startDate: '2026-06-10',
      plannedReturnDate: '2026-06-12',
      pricingMode: 'daily_rate',
      dailyRate: 1000,
      rate: '1000 ₽/день',
      price: 1,
    }));
    assert.equal(created.status, 201);
    const beforeRental = structuredClone(state.rentals[0]);
    const beforeGantt = structuredClone(state.gantt_rentals[0]);

    const response = await request(baseUrl, 'POST', `/api/rentals/${created.body.id}/extend`, {
      newPlannedReturnDate: '2026-06-31',
      reason: 'invalid date probe',
      confirmedByClient: true,
      invoiceSentToClient: true,
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'RENTAL_PAYLOAD_VALIDATION_FAILED');
    assert.equal(response.body.field, 'plannedReturnDate');
    assert.deepEqual(state.rentals[0], beforeRental);
    assert.deepEqual(state.gantt_rentals[0], beforeGantt);
  });
});

test('bulk replacement rejects invalid protected data and atomically resynchronizes changed daily pricing', async () => {
  const { app, state } = createApp();
  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      startDate: '2026-06-10',
      plannedReturnDate: '2026-06-12',
      pricingMode: 'daily_rate',
      dailyRate: 1000,
      rate: '1000 ₽/день',
      price: 1,
    }));
    assert.equal(created.status, 201);
    const beforeRental = structuredClone(state.rentals[0]);
    const beforeGantt = structuredClone(state.gantt_rentals[0]);

    const invalid = await request(baseUrl, 'PUT', '/api/rentals', [{
      ...state.rentals[0],
      deposit: -1,
    }]);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.field, 'deposit');
    assert.deepEqual(state.rentals[0], beforeRental);
    assert.deepEqual(state.gantt_rentals[0], beforeGantt);

    const valid = await request(baseUrl, 'PUT', '/api/rentals', [{
      ...state.rentals[0],
      plannedReturnDate: '2026-06-11',
    }]);
    assert.equal(valid.status, 200);
    assert.equal(state.rentals[0].price, 2000);
    assert.equal(state.gantt_rentals[0].endDate, '2026-06-11');
    assert.equal(state.gantt_rentals[0].amount, 2000);

    state.equipment.push({
      ...state.equipment[0],
      id: 'EQ-2',
      inventoryNumber: 'INV-2',
      serialNumber: 'SN-2',
      status: 'available',
      history: [],
    });
    const relationOnly = await request(baseUrl, 'PUT', '/api/rentals', [{
      ...state.rentals[0],
      equipmentId: 'EQ-2',
      equipmentInv: 'INV-2',
      equipment: ['INV-2'],
    }]);
    assert.equal(relationOnly.status, 200);
    assert.equal(state.rentals[0].equipmentId, 'EQ-2');
    assert.equal(state.gantt_rentals[0].equipmentId, 'EQ-2');
    assert.equal(state.gantt_rentals[0].equipmentInv, 'INV-2');
  });
});

test('update batch failure leaves rental, planner and approval decision unchanged', async t => {
  function populatedState() {
    const state = createState();
    state.rentals = [{
      id: 'R-existing',
      ...rentalPayload({
        startDate: '2026-06-10',
        plannedReturnDate: '2026-06-12',
        pricingMode: 'daily_rate',
        dailyRate: 1000,
        rate: '1000 ₽/день',
        price: 3000,
        deposit: 500,
      }),
    }];
    state.gantt_rentals = [{
      id: 'GR-existing',
      rentalId: 'R-existing',
      sourceRentalId: 'R-existing',
      originalRentalId: 'R-existing',
      clientId: 'C-1',
      client: 'ООО Клиент',
      equipmentId: 'EQ-1',
      equipmentInv: 'INV-1',
      startDate: '2026-06-10',
      endDate: '2026-06-12',
      amount: 3000,
      status: 'created',
    }];
    return state;
  }

  await t.test('direct PATCH rollback', async () => {
    const state = populatedState();
    const before = structuredClone(state);
    const { app } = createApp(state, { failBatch: true });
    await withServer(app, async baseUrl => {
      const response = await request(baseUrl, 'PATCH', '/api/rentals/R-existing', { deposit: 0 });
      assert.equal(response.status, 500);
      assert.match(response.body.error, /Injected batch failure/);
      assert.deepEqual(state.rentals, before.rentals);
      assert.deepEqual(state.gantt_rentals, before.gantt_rentals);
    });
  });

  await t.test('approval rollback', async () => {
    const state = populatedState();
    state.rental_change_requests = [{
      id: 'RCR-existing',
      entityType: 'rental',
      rentalId: 'R-existing',
      linkedGanttRentalId: 'GR-existing',
      field: 'deposit',
      fieldLabel: 'Залог',
      oldValue: 500,
      newValue: 0,
      status: 'pending',
    }];
    const before = structuredClone(state);
    const { app } = createApp(state, { failBatch: true });
    await withServer(app, async baseUrl => {
      const response = await request(
        baseUrl,
        'POST',
        '/api/rental_change_requests/RCR-existing/approve',
        { comment: 'must roll back' },
      );
      assert.equal(response.status, 500);
      assert.match(response.body.error, /Injected batch failure/);
      assert.deepEqual(state.rentals, before.rentals);
      assert.deepEqual(state.gantt_rentals, before.gantt_rentals);
      assert.deepEqual(state.rental_change_requests, before.rental_change_requests);
    });
  });
});

test('batch failure rolls back rental, planner row and equipment transition', async () => {
  const state = createState();
  const before = structuredClone(state);
  const { app } = createApp(state, { failBatch: true });
  await withServer(app, async baseUrl => {
    const response = await request(
      baseUrl,
      'POST',
      '/api/rentals',
      rentalPayload(),
      'admin-token',
      { 'Idempotency-Key': 'rental-rollback-0001' },
    );
    assert.equal(response.status, 500);
    assert.match(response.body.error, /Injected batch failure/);
    assert.deepEqual(state.rentals, before.rentals);
    assert.deepEqual(state.gantt_rentals, before.gantt_rentals);
    assert.deepEqual(state.equipment, before.equipment);
    assert.equal(state.rental_create_idempotency, undefined);
  });
});

test('object and contract snapshots are derived from authoritative ids on POST and PATCH', async () => {
  const { app, state } = createApp();
  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload({
      objectName: 'Ложный объект',
      objectAddress: 'Ложный адрес',
      objectContactName: 'Ложный контакт',
      objectContactPhone: '+0',
      contractNumber: 'FORGED-CONTRACT',
    }));
    assert.equal(created.status, 201);
    assert.equal(state.rentals[0].objectName, 'Канонический объект');
    assert.equal(state.rentals[0].objectAddress, 'Канонический адрес');
    assert.equal(state.rentals[0].objectContactName, 'Канонический контакт');
    assert.equal(state.rentals[0].objectContactPhone, '+7 900 000-00-01');
    assert.equal(state.rentals[0].contractNumber, 'BUS-2026/15');
    assert.equal(state.gantt_rentals[0].objectName, 'Канонический объект');
    assert.equal(state.gantt_rentals[0].contractNumber, 'BUS-2026/15');

    const patched = await request(baseUrl, 'PATCH', `/api/rentals/${created.body.id}`, {
      objectName: 'Повторная подмена',
      objectAddress: 'Повторная подмена',
      contractNumber: 'CC-FORGED',
    });
    assert.equal(patched.status, 200);
    assert.equal(state.rentals[0].objectName, 'Канонический объект');
    assert.equal(state.rentals[0].objectAddress, 'Канонический адрес');
    assert.equal(state.rentals[0].contractNumber, 'BUS-2026/15');
  });
});

test('server-side approval workflow cannot persist a forged relation snapshot', async () => {
  const { app, state } = createApp();
  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
    assert.equal(created.status, 201);

    const changeRequest = await request(baseUrl, 'POST', '/api/rental_change_requests', {
      entityType: 'rental',
      rentalId: created.body.id,
      field: 'contractNumber',
      fieldLabel: 'Номер договора',
      oldValue: 'BUS-2026/15',
      newValue: 'FORGED-BY-WORKFLOW',
      status: 'pending',
    });
    assert.equal(changeRequest.status, 201);

    const approved = await request(
      baseUrl,
      'POST',
      `/api/rental_change_requests/${changeRequest.body.id}/approve`,
      { comment: 'approve' },
    );
    assert.equal(approved.status, 200);
    assert.equal(state.rentals[0].contractNumber, 'BUS-2026/15');
    assert.equal(state.gantt_rentals[0].contractNumber, 'BUS-2026/15');
  });
});

test('generic approval workflow cannot mutate server-owned rental audit fields', async () => {
  const { app, state } = createApp();
  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/rentals', rentalPayload());
    assert.equal(created.status, 201);

    const changeRequest = await request(baseUrl, 'POST', '/api/rental_change_requests', {
      entityType: 'rental',
      rentalId: created.body.id,
      field: 'creditRiskSnapshot',
      oldValue: null,
      newValue: { currentDebt: 0, forged: true },
      status: 'pending',
    });
    assert.equal(changeRequest.status, 201);

    const approved = await request(
      baseUrl,
      'POST',
      `/api/rental_change_requests/${changeRequest.body.id}/approve`,
      { comment: 'approve forged audit' },
    );
    assert.equal(approved.status, 403);
    assert.equal(state.rentals[0].creditRiskSnapshot, undefined);
    assert.equal(state.rental_change_requests[0].status, 'pending');
  });
});

test('all rental API read views preserve stored business contract number when relations are unavailable', async () => {
  const state = createState();
  state.client_objects = [];
  state.client_contracts = [];
  state.rentals = [rentalPayload({
    id: 'R-legacy',
    objectId: 'CO-gone',
    objectName: 'Legacy object snapshot',
    objectAddress: 'Legacy address snapshot',
    contractId: 'CC-gone',
    contractNumber: 'BUS-LEGACY-77',
    status: 'closed',
  })];
  state.gantt_rentals = [{
    id: 'GR-legacy',
    rentalId: 'R-legacy',
    sourceRentalId: 'R-legacy',
    originalRentalId: 'R-legacy',
    clientId: 'C-1',
    client: 'ООО Клиент',
    equipmentId: 'EQ-1',
    equipmentInv: 'INV-1',
    objectId: 'CO-gone',
    contractId: 'CC-gone',
    startDate: '2026-04-01',
    endDate: '2026-04-10',
    status: 'closed',
  }];
  const { app } = createApp(state);

  await withServer(app, async baseUrl => {
    const classicList = await request(baseUrl, 'GET', '/api/rentals');
    const classicDetail = await request(baseUrl, 'GET', '/api/rentals/R-legacy');
    const context = await request(baseUrl, 'GET', '/api/rentals/R-legacy/context');
    const ganttList = await request(baseUrl, 'GET', '/api/gantt_rentals');
    const ganttDetail = await request(baseUrl, 'GET', '/api/gantt_rentals/GR-legacy');

    assert.equal(classicList.body[0].contractNumber, 'BUS-LEGACY-77');
    assert.equal(classicDetail.body.contractNumber, 'BUS-LEGACY-77');
    assert.equal(context.body.rental.contractNumber, 'BUS-LEGACY-77');
    assert.equal(context.body.ganttRentals[0].contractNumber, 'BUS-LEGACY-77');
    assert.equal(ganttList.body[0].contractNumber, 'BUS-LEGACY-77');
    assert.equal(ganttDetail.body.contractNumber, 'BUS-LEGACY-77');
    assert.equal(classicDetail.body.objectName, 'Legacy object snapshot');
    assert.notEqual(classicDetail.body.contractNumber, 'CC-gone');
  });
});

test('SQLite setDataBatch rolls back earlier collection writes when a later write fails', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'rental-data-integrity-'));
  const dbPath = join(tempDir, 'app.sqlite');
  const dbModule = fileURLToPath(new URL('../server/db.js', import.meta.url));
  const script = `
    const db = require(${JSON.stringify(dbModule)});
    db.setData('rentals', [{ id: 'R-before' }]);
    db.setData('equipment', [{ id: 'EQ-1', status: 'available' }]);
    const circular = {}; circular.self = circular;
    let error = '';
    try {
      db.setDataBatch([
        { name: 'rentals', value: [{ id: 'R-after' }] },
        { name: 'equipment', value: circular },
      ]);
    } catch (caught) {
      error = caught.message;
    }
    process.stdout.write(JSON.stringify({ error, rentals: db.getData('rentals'), equipment: db.getData('equipment') }));
  `;
  try {
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, DB_PATH: dbPath },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.match(output.error, /circular/i);
    assert.deepEqual(output.rentals, [{ id: 'R-before' }]);
    assert.deepEqual(output.equipment, [{ id: 'EQ-1', status: 'available' }]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
