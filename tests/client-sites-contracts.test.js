import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const { registerCrudRoutes } = require('../server/routes/crud.js');
const {
  buildClientObjectDebtBreakdown,
  enrichRecordFromRentalLinks,
} = require('../server/lib/client-relations.js');

function makeCrudApp(initial = {}) {
  const state = {
    clients: [],
    client_objects: [],
    client_contracts: [],
    rentals: [],
    gantt_rentals: [],
    payments: [],
    documents: [],
    crm_deals: [],
    equipment: [],
    users: [],
    service: [],
    ...initial,
  };
  const app = express();
  app.use(express.json());
  const readData = name => state[name] || [];
  const writeData = (name, value) => {
    state[name] = value;
  };
  const accessControl = createAccessControl({ readData });
  const requireAuth = (req, _res, next) => {
    req.user = {
      userId: 'U-admin',
      userName: 'Администратор',
      userRole: 'Администратор',
    };
    next();
  };
  const requirePass = () => (_req, _res, next) => next();
  app.use('/api', registerCrudRoutes({
    collections: ['clients', 'client_objects', 'client_contracts', 'rentals', 'gantt_rentals', 'payments', 'documents', 'service'],
    idPrefixes: {
      clients: 'C',
      client_objects: 'CO',
      client_contracts: 'CC',
      rentals: 'R',
      gantt_rentals: 'GR',
      payments: 'P',
      documents: 'D',
      service: 'S',
    },
    readData,
    writeData,
    deleteSessionsForUserIds: () => {},
    requireAuth,
    requireRead: requirePass,
    requireWrite: requirePass,
    sanitizeUser: value => value,
    publicUserView: value => value,
    canReadFullUsers: () => true,
    hashPassword: value => value,
    normalizeServiceWorkRecord: value => value,
    normalizeSparePartRecord: value => value,
    validateRentalPayload: () => ({ ok: true }),
    mergeEntityHistory: (_collection, _previous, next) => next,
    requireNonEmptyString: (value, label) => {
      if (!String(value || '').trim()) throw new Error(`${label} обязательно`);
    },
    generateId: prefix => `${prefix}-${state.__seq = (state.__seq || 0) + 1}`,
    nowIso: () => '2026-05-07T12:00:00.000Z',
    applyServiceTicketCreationEffects: () => {},
    accessControl,
    auditLog: () => {},
    serviceAuditLog: () => {},
    normalizeRecordClientLink: item => item,
    normalizeClientLinks: () => {},
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

async function request(baseUrl, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('client INN is required, normalized, length-validated, and unique', async () => {
  const { app, state } = makeCrudApp();
  await withServer(app, async (baseUrl) => {
    const missing = await request(baseUrl, 'POST', '/api/clients', { company: 'Без ИНН' });
    assert.equal(missing.status, 400);
    assert.match(missing.body.error, /Укажите корректный ИНН/);

    const invalid = await request(baseUrl, 'POST', '/api/clients', { company: 'Короткий', inn: '12345' });
    assert.equal(invalid.status, 400);
    assert.match(invalid.body.error, /Укажите корректный ИНН/);

    const legalEntity = await request(baseUrl, 'POST', '/api/clients', { company: 'Юрлицо', inn: '123-456 7890' });
    assert.equal(legalEntity.status, 201);
    assert.equal(legalEntity.body.inn, '1234567890');
    assert.equal(legalEntity.body.innNormalized, '1234567890');

    const person = await request(baseUrl, 'POST', '/api/clients', { company: 'ИП', inn: '123 456 789 012' });
    assert.equal(person.status, 201);
    assert.equal(person.body.inn, '123456789012');

    const duplicate = await request(baseUrl, 'POST', '/api/clients', { company: 'Дубль', inn: '123 456-7890' });
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.body.error, /Клиент с таким ИНН уже существует/);
    assert.equal(state.clients.length, 2);
  });
});

test('legacy client without INN can be read but cannot be saved without INN', async () => {
  const { app } = makeCrudApp({
    clients: [{ id: 'C-legacy', company: 'Старый клиент', inn: '' }],
  });
  await withServer(app, async (baseUrl) => {
    const read = await request(baseUrl, 'GET', '/api/clients/C-legacy');
    assert.equal(read.status, 200);
    assert.equal(read.body.company, 'Старый клиент');

    const saveWithoutInn = await request(baseUrl, 'PATCH', '/api/clients/C-legacy', { phone: '+7' });
    assert.equal(saveWithoutInn.status, 400);
    assert.match(saveWithoutInn.body.error, /Укажите корректный ИНН/);

    const saveWithInn = await request(baseUrl, 'PATCH', '/api/clients/C-legacy', { inn: '7707083893' });
    assert.equal(saveWithInn.status, 200);
    assert.equal(saveWithInn.body.inn, '7707083893');
  });
});

test('client objects and contracts are client-scoped and validated', async () => {
  const { app, state } = makeCrudApp({
    clients: [
      { id: 'C-1', company: 'Клиент', inn: '7707083893', innNormalized: '7707083893' },
      { id: 'C-2', company: 'Другой', inn: '123456789012', innNormalized: '123456789012' },
    ],
    client_objects: [{ id: 'CO-other', clientId: 'C-2', name: 'Чужой', address: 'Чужой адрес', status: 'active' }],
    client_contracts: [{ id: 'CC-other', clientId: 'C-2', number: 'Ч-1', status: 'active' }],
  });
  await withServer(app, async (baseUrl) => {
    const noClient = await request(baseUrl, 'POST', '/api/client_objects', { name: 'Объект', address: 'Адрес' });
    assert.equal(noClient.status, 400);

    const noNameAddress = await request(baseUrl, 'POST', '/api/client_objects', { clientId: 'C-1' });
    assert.equal(noNameAddress.status, 400);

    const firstObject = await request(baseUrl, 'POST', '/api/client_objects', {
      clientId: 'C-1',
      name: 'Склад',
      address: 'Казань, Промзона',
      contactName: 'Ильдар',
      contactPhone: '+7',
    });
    assert.equal(firstObject.status, 201);
    assert.equal(firstObject.body.status, 'active');

    const secondObject = await request(baseUrl, 'POST', '/api/client_objects', {
      clientId: 'C-1',
      name: 'Цех',
      address: 'Казань, Северная',
    });
    assert.equal(secondObject.status, 201);
    assert.equal(state.client_objects.length, 3);

    const contract = await request(baseUrl, 'POST', '/api/client_contracts', {
      clientId: 'C-1',
      objectId: firstObject.body.id,
      number: 'А-15/26',
      title: 'Договор аренды',
    });
    assert.equal(contract.status, 201);
    assert.equal(contract.body.objectId, firstObject.body.id);

    const foreignContractObject = await request(baseUrl, 'POST', '/api/client_contracts', {
      clientId: 'C-1',
      objectId: 'CO-other',
      number: 'Чужой объект',
    });
    assert.equal(foreignContractObject.status, 400);

    const foreignObjectContract = await request(baseUrl, 'POST', '/api/client_objects', {
      clientId: 'C-1',
      name: 'Объект с чужим договором',
      address: 'Казань',
      contractId: 'CC-other',
    });
    assert.equal(foreignObjectContract.status, 400);

    const secondContract = await request(baseUrl, 'POST', '/api/client_contracts', {
      clientId: 'C-1',
      number: 'Б-16/26',
    });
    assert.equal(secondContract.status, 201);
    assert.equal(state.client_contracts.length, 3);
  });
});

test('payments documents and service reject foreign object or contract links', async () => {
  const { app } = makeCrudApp({
    clients: [
      { id: 'C-1', company: 'Клиент', inn: '7707083893', innNormalized: '7707083893' },
      { id: 'C-2', company: 'Другой', inn: '123456789012', innNormalized: '123456789012' },
    ],
    client_objects: [
      { id: 'CO-1', clientId: 'C-1', name: 'Свой', address: 'Казань', status: 'active' },
      { id: 'CO-2', clientId: 'C-2', name: 'Чужой', address: 'Москва', status: 'active' },
    ],
    client_contracts: [
      { id: 'CC-1', clientId: 'C-1', objectId: 'CO-1', number: 'С-1', status: 'active' },
      { id: 'CC-2', clientId: 'C-2', objectId: 'CO-2', number: 'Ч-1', status: 'active' },
    ],
  });
  await withServer(app, async (baseUrl) => {
    const paymentObject = await request(baseUrl, 'POST', '/api/payments', {
      clientId: 'C-1',
      client: 'Клиент',
      objectId: 'CO-2',
      amount: 1000,
      paidAmount: 0,
      status: 'pending',
    });
    assert.equal(paymentObject.status, 400);

    const paymentContract = await request(baseUrl, 'POST', '/api/payments', {
      clientId: 'C-1',
      client: 'Клиент',
      contractId: 'CC-2',
      amount: 1000,
      paidAmount: 0,
      status: 'pending',
    });
    assert.equal(paymentContract.status, 400);

    const documentObject = await request(baseUrl, 'POST', '/api/documents', {
      clientId: 'C-1',
      client: 'Клиент',
      objectId: 'CO-2',
      type: 'act',
      number: 'D-1',
      status: 'draft',
    });
    assert.equal(documentObject.status, 400);

    const documentContract = await request(baseUrl, 'POST', '/api/documents', {
      clientId: 'C-1',
      client: 'Клиент',
      contractId: 'CC-2',
      type: 'contract',
      number: 'D-2',
      status: 'draft',
    });
    assert.equal(documentContract.status, 400);

    const service = await request(baseUrl, 'POST', '/api/service', {
      clientId: 'C-1',
      objectId: 'CO-2',
      equipmentId: 'EQ-1',
      equipment: 'Подъемник',
      reason: 'Осмотр',
      description: 'Осмотр',
      priority: 'medium',
      sla: '24 ч',
      status: 'new',
    });
    assert.equal(service.status, 400);
  });
});

test('rentals, deliveries, service, payments and documents can carry object and contract links', async () => {
  const row = enrichRecordFromRentalLinks({
    id: 'S-1',
    rentalId: 'GR-1',
    clientId: 'C-1',
  }, name => ({
    rentals: [],
    gantt_rentals: [{ id: 'GR-1', clientId: 'C-1', objectId: 'CO-1', contractId: 'CC-1' }],
  })[name] || []);

  assert.equal(row.objectId, 'CO-1');
  assert.equal(row.contractId, 'CC-1');
});

test('POST and GET /api/service keep client id and display snapshot', async () => {
  const { app } = makeCrudApp({
    clients: [{ id: 'C-1', company: 'ООО Клиент', inn: '7707083893', innNormalized: '7707083893' }],
  });

  await withServer(app, async (baseUrl) => {
    const created = await request(baseUrl, 'POST', '/api/service', {
      clientId: 'C-1',
      client: 'ООО Клиент',
      clientName: 'ООО Клиент',
      equipmentId: 'EQ-1',
      equipment: 'Подъемник',
      reason: 'Осмотр',
      description: 'Осмотр',
      priority: 'medium',
      sla: '24 ч',
      status: 'new',
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.clientId, 'C-1');
    assert.equal(created.body.clientName, 'ООО Клиент');

    const list = await request(baseUrl, 'GET', '/api/service');
    assert.equal(list.status, 200);
    assert.equal(list.body[0].clientId, 'C-1');
    assert.equal(list.body[0].clientName, 'ООО Клиент');
  });
});

test('client receivables stay client-based while object breakdown groups legacy rows as Без объекта', () => {
  const rows = [
    { rentalId: 'GR-1', clientId: 'C-1', client: 'Клиент', objectId: 'CO-1', outstanding: 100000 },
    { rentalId: 'GR-2', clientId: 'C-1', client: 'Клиент', outstanding: 50000 },
  ];
  const breakdown = buildClientObjectDebtBreakdown(
    [{ id: 'C-1', company: 'Клиент' }],
    rows,
    [{ id: 'CO-1', clientId: 'C-1', name: 'Склад' }],
  );

  assert.deepEqual(breakdown.map(item => [item.objectName, item.debt]), [
    ['Склад', 100000],
    ['Без объекта', 50000],
  ]);
});
