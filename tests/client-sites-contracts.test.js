import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const { registerCrudRoutes } = require('../server/routes/crud.js');
const { ensureClientCounterpartyFoundation } = require('../server/lib/counterparty.js');
const {
  buildClientObjectDebtBreakdown,
  enrichRecordFromRentalLinks,
  normalizeClientRelationLinks,
} = require('../server/lib/client-relations.js');

function makeCrudApp(initial = {}) {
  const state = {
    counterparties: [],
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
  const writeDataBatch = entries => {
    for (const entry of entries || []) writeData(entry.name, entry.value);
  };
  ensureClientCounterpartyFoundation({
    readData,
    writeDataBatch,
    logger: { log() {}, warn() {} },
    nowIso: () => '2026-05-07T12:00:00.000Z',
  });
  const accessControl = createAccessControl({ readData });
  const requireAuth = (req, _res, next) => {
    req.user = {
      userId: 'U-admin',
      userName: 'Администратор',
      userRole: 'Администратор',
      ...(req.get('x-company-id') ? { companyId: req.get('x-company-id') } : {}),
      ...(req.get('x-tenant-id') ? { tenantId: req.get('x-tenant-id') } : {}),
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
    writeDataBatch,
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

async function request(baseUrl, method, path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('inline client relation creation is idempotent across concurrent and unknown-outcome retries', async () => {
  const { app, state } = makeCrudApp({
    clients: [{ id: 'C-1', company: 'Клиент', inn: '7707083893', innNormalized: '7707083893' }],
  });

  await withServer(app, async baseUrl => {
    const objectPayload = {
      clientId: 'C-1',
      name: 'Склад',
      address: 'Казань',
      status: 'active',
    };
    const objectHeaders = { 'Idempotency-Key': 'object-retry-0001' };
    const [first, doubleClick] = await Promise.all([
      request(baseUrl, 'POST', '/api/client_objects', objectPayload, objectHeaders),
      request(baseUrl, 'POST', '/api/client_objects', objectPayload, objectHeaders),
    ]);

    assert.deepEqual([first.status, doubleClick.status].sort(), [200, 201]);
    assert.equal(first.body.id, doubleClick.body.id);
    assert.equal(first.body.counterpartyId, state.clients[0].counterpartyId);
    assert.equal(state.client_objects.length, 1);
    assert.equal(state.inline_relation_idempotency.length, 1);

    const contractPayload = {
      clientId: 'C-1',
      objectId: first.body.id,
      number: 'Д-1',
      status: 'active',
    };
    const contractHeaders = { 'Idempotency-Key': 'contract-retry-0001' };
    const createdContract = await request(baseUrl, 'POST', '/api/client_contracts', contractPayload, contractHeaders);
    const replayedContract = await request(baseUrl, 'POST', '/api/client_contracts', contractPayload, contractHeaders);
    const mismatchedRetry = await request(baseUrl, 'POST', '/api/client_contracts', {
      ...contractPayload,
      number: 'Д-2',
    }, contractHeaders);

    assert.equal(createdContract.status, 201);
    assert.equal(replayedContract.status, 200);
    assert.equal(replayedContract.body.id, createdContract.body.id);
    assert.equal(mismatchedRetry.status, 409);
    assert.equal(mismatchedRetry.body.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(state.client_contracts.length, 1);
  });
});

test('client_objects transitional API canonicalizes legacy writes and enforces dual-ID consistency', async () => {
  const { app, state } = makeCrudApp({
    clients: [{ id: 'C-1', company: 'Клиент', inn: '7707083893', innNormalized: '7707083893' }],
  });
  const counterpartyId = state.clients[0].counterpartyId;

  await withServer(app, async baseUrl => {
    const legacyCreate = await request(baseUrl, 'POST', '/api/client_objects', {
      clientId: 'C-1',
      name: 'Склад',
      address: 'Казань',
      status: 'active',
    });
    assert.equal(legacyCreate.status, 201);
    assert.equal(legacyCreate.body.clientId, 'C-1');
    assert.equal(legacyCreate.body.counterpartyId, counterpartyId);

    const matchingDualCreate = await request(baseUrl, 'POST', '/api/client_objects', {
      clientId: 'C-1',
      counterpartyId,
      name: 'Цех',
      address: 'Казань',
      status: 'active',
    });
    assert.equal(matchingDualCreate.status, 201);
    assert.equal(matchingDualCreate.body.counterpartyId, counterpartyId);

    const foreignCounterparty = state.counterparties.find(item => item.id !== counterpartyId) || {
      ...state.counterparties[0],
      id: 'CP-FOREIGN',
      legalName: 'ООО Другая компания',
      shortName: 'Другая компания',
      inn: '7707083894',
    };
    if (!state.counterparties.some(item => item.id === foreignCounterparty.id)) {
      state.counterparties.push(foreignCounterparty);
    }
    const mismatch = await request(baseUrl, 'POST', '/api/client_objects', {
      clientId: 'C-1',
      counterpartyId: foreignCounterparty.id,
      name: 'Чужой объект',
      address: 'Москва',
      status: 'active',
    });
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.code, 'COUNTERPARTY_RELATION_MISMATCH');

    const read = await request(baseUrl, 'GET', `/api/client_objects/${legacyCreate.body.id}`);
    assert.equal(read.status, 200);
    assert.equal(read.body.clientId, 'C-1');
    assert.equal(read.body.counterpartyId, counterpartyId);

    const updated = await request(baseUrl, 'PATCH', `/api/client_objects/${legacyCreate.body.id}`, {
      name: 'Склад № 2',
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.clientId, 'C-1');
    assert.equal(updated.body.counterpartyId, counterpartyId);

    const relationChange = await request(baseUrl, 'PATCH', `/api/client_objects/${legacyCreate.body.id}`, {
      clientId: '',
    });
    assert.equal(relationChange.status, 409);
    assert.equal(relationChange.body.code, 'COUNTERPARTY_RELATION_IMMUTABLE');

    const deleted = await request(baseUrl, 'DELETE', `/api/client_objects/${legacyCreate.body.id}`);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.ok, true);
    assert.equal(state.client_objects.some(item => item.id === legacyCreate.body.id), false);
    assert.equal(state.clients.length, 1);
    assert.equal(state.counterparties.length, 2);
  });
});

test('counterparty-native object accepts supplier-only identity without creating Client or duplicate Counterparty', async () => {
  const supplier = {
    id: 'CP-SUPPLIER',
    type: 'legal_entity',
    legalName: 'ООО Поставщик',
    shortName: 'Поставщик',
    inn: '7707083895',
    status: 'active',
    archivedAt: null,
    roles: ['supplier'],
  };
  const { app, state } = makeCrudApp({ counterparties: [supplier] });

  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/client_objects', {
      counterpartyId: supplier.id,
      name: 'Склад поставщика',
      address: 'Москва',
      status: 'active',
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.clientId, undefined);
    assert.equal(created.body.counterpartyId, supplier.id);
    assert.equal(state.clients.length, 0);
    assert.equal(state.counterparties.length, 1);
    assert.equal(state.counterparties[0], supplier);
  });
});

test('ClientContract accepts an active CP-only customer and rejects inactive or mismatched relations', async () => {
  const activeCustomer = {
    id: 'CP-CUSTOMER',
    type: 'legal_entity',
    legalName: 'ООО Клиент без профиля',
    status: 'active',
    archivedAt: null,
    roles: ['customer'],
  };
  const inactiveCustomer = {
    id: 'CP-INACTIVE',
    type: 'legal_entity',
    legalName: 'ООО Неактивный',
    status: 'active',
    archivedAt: null,
    roles: ['customer'],
  };
  const { app, state } = makeCrudApp({
    counterparties: [activeCustomer, inactiveCustomer],
    counterparty_role_assignments: [
      { id: 'A-1', counterpartyId: activeCustomer.id, roleCode: 'customer', status: 'active', validTo: null },
      { id: 'A-2', counterpartyId: inactiveCustomer.id, roleCode: 'customer', status: 'inactive', validTo: '2026-01-01' },
    ],
    clients: [{ id: 'C-1', counterpartyId: activeCustomer.id, company: 'ООО Клиент' }],
  });

  await withServer(app, async baseUrl => {
    const cpOnly = await request(baseUrl, 'POST', '/api/client_contracts', {
      counterpartyId: activeCustomer.id,
      number: 'CP-ONLY-1',
      status: 'active',
    });
    assert.equal(cpOnly.status, 201);
    assert.equal(cpOnly.body.counterpartyId, activeCustomer.id);
    assert.equal(cpOnly.body.clientId, undefined);
    assert.equal(state.clients.length, 1);

    const matching = await request(baseUrl, 'POST', '/api/client_contracts', {
      counterpartyId: activeCustomer.id,
      clientId: 'C-1',
      number: 'MATCH-1',
      status: 'active',
    });
    assert.equal(matching.status, 201);

    const mismatch = await request(baseUrl, 'POST', '/api/client_contracts', {
      counterpartyId: inactiveCustomer.id,
      clientId: 'C-1',
      number: 'BAD-1',
      status: 'active',
    });
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.code, 'COUNTERPARTY_RELATION_MISMATCH');

    const inactive = await request(baseUrl, 'POST', '/api/client_contracts', {
      counterpartyId: inactiveCustomer.id,
      number: 'BAD-2',
      status: 'active',
    });
    assert.equal(inactive.status, 409);
    assert.equal(inactive.body.code, 'COUNTERPARTY_RELATION_CUSTOMER_ROLE_REQUIRED');
  });
});

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
      contactName: 'Ильдар',
      contactPhone: '+7',
      comment: 'КПП №2',
    });
    assert.equal(firstObject.status, 201);
    assert.equal(firstObject.body.status, 'active');
    assert.equal(firstObject.body.address, undefined);
    assert.equal(firstObject.body.comment, 'КПП №2');

    const reloadedObject = await request(baseUrl, 'GET', `/api/client_objects/${firstObject.body.id}`);
    assert.equal(reloadedObject.status, 200);
    assert.equal(reloadedObject.body.name, 'Склад');
    assert.equal(reloadedObject.body.comment, 'КПП №2');

    const editedObject = await request(baseUrl, 'PATCH', `/api/client_objects/${firstObject.body.id}`, {
      name: 'Склад № 1',
      address: 'Казань, Промзона',
      contactName: 'Ильдар Сафин',
      contactPhone: '+7 900 000-00-00',
      comment: 'Въезд со стороны КПП №3',
    });
    assert.equal(editedObject.status, 200);
    assert.equal(editedObject.body.address, 'Казань, Промзона');
    assert.equal(editedObject.body.comment, 'Въезд со стороны КПП №3');
    assert.equal(editedObject.body.notes, 'Въезд со стороны КПП №3');

    const clearedOptionalFields = await request(baseUrl, 'PATCH', `/api/client_objects/${firstObject.body.id}`, {
      address: '',
      contactName: '',
      contactPhone: '',
      comment: '',
    });
    assert.equal(clearedOptionalFields.status, 200);
    assert.equal(clearedOptionalFields.body.address, undefined);
    assert.equal(clearedOptionalFields.body.comment, undefined);

    const legacyNotesUpdate = await request(baseUrl, 'PATCH', `/api/client_objects/${firstObject.body.id}`, {
      notes: 'Legacy consumer comment',
    });
    assert.equal(legacyNotesUpdate.status, 200);
    assert.equal(legacyNotesUpdate.body.comment, 'Legacy consumer comment');
    assert.equal(legacyNotesUpdate.body.notes, 'Legacy consumer comment');

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
    assert.equal(foreignContractObject.status, 409);

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

test('ClientContract PATCH edits business fields in place and preserves identity, ownership, history links, and lifecycle', async () => {
  const createdAt = '2026-01-02T03:04:05.000Z';
  const { app, state } = makeCrudApp({
    clients: [{
      id: 'C-1',
      company: 'Клиент',
      inn: '7707083893',
      innNormalized: '7707083893',
      history: [],
    }],
    client_objects: [
      { id: 'CO-1', clientId: 'C-1', name: 'Старый объект', status: 'active' },
      { id: 'CO-2', clientId: 'C-1', name: 'Новый объект', status: 'active' },
    ],
    client_contracts: [{
      id: 'CC-1',
      clientId: 'C-1',
      objectId: 'CO-1',
      objectIds: ['CO-1'],
      number: 'CTR-26-000002',
      date: '2026-01-10',
      title: 'Исходный договор',
      notes: 'Исходное примечание',
      status: 'active',
      companyId: 'COMPANY-A',
      tenantId: 'TENANT-A',
      createdAt,
    }],
    rentals: [{ id: 'R-1', clientId: 'C-1', contractId: 'CC-1' }],
    documents: [{ id: 'D-1', clientId: 'C-1', contractId: 'CC-1' }],
    service: [{ id: 'S-1', clientId: 'C-1', contractId: 'CC-1' }],
    deliveries: [{ id: 'DEL-1', clientId: 'C-1', contractId: 'CC-1' }],
    payment_allocations: [{ id: 'PA-1', clientId: 'C-1', contractId: 'CC-1' }],
  });
  const scopedHeaders = { 'x-company-id': 'COMPANY-A', 'x-tenant-id': 'TENANT-A' };
  const linkedSnapshots = Object.fromEntries(
    ['rentals', 'documents', 'service', 'deliveries', 'payment_allocations']
      .map(name => [name, structuredClone(state[name])]),
  );

  await withServer(app, async baseUrl => {
    const updated = await request(baseUrl, 'PATCH', '/api/client_contracts/CC-1', {
      date: '2026-02-20',
      title: 'Обновлённый договор',
      objectId: 'CO-2',
      objectIds: ['CO-2'],
      notes: 'Обновлённое примечание',
    }, scopedHeaders);

    assert.equal(updated.status, 200);
    assert.equal(updated.body.id, 'CC-1');
    assert.equal(updated.body.number, 'CTR-26-000002');
    assert.equal(updated.body.createdAt, createdAt);
    assert.equal(updated.body.companyId, 'COMPANY-A');
    assert.equal(updated.body.tenantId, 'TENANT-A');
    assert.equal(updated.body.date, '2026-02-20');
    assert.equal(updated.body.title, 'Обновлённый договор');
    assert.equal(updated.body.objectId, 'CO-2');
    assert.deepEqual(updated.body.objectIds, ['CO-2']);
    assert.equal(updated.body.notes, 'Обновлённое примечание');
    assert.equal(updated.body.status, 'active');

    const reloaded = await request(baseUrl, 'GET', '/api/client_contracts/CC-1', undefined, scopedHeaders);
    assert.equal(reloaded.status, 200);
    assert.equal(reloaded.body.title, 'Обновлённый договор');
    assert.equal(reloaded.body.date, '2026-02-20');

    for (const [name, snapshot] of Object.entries(linkedSnapshots)) {
      assert.deepEqual(state[name], snapshot, `${name} links must be preserved`);
    }
    assert.equal(state.clients[0].history.length, 1);
    assert.equal(state.clients[0].history[0].text, 'Договор изменён: CTR-26-000002');

    const noOp = await request(baseUrl, 'PATCH', '/api/client_contracts/CC-1', {
      date: '2026-02-20',
      title: 'Обновлённый договор',
      objectId: 'CO-2',
      objectIds: ['CO-2'],
      notes: 'Обновлённое примечание',
    }, scopedHeaders);
    assert.equal(noOp.status, 200);
    assert.equal(state.clients[0].history.length, 1, 'no-op update must not duplicate activity');

    for (const payload of [
      { id: 'CC-FORGED' },
      { number: 'CTR-99-999999' },
      { businessNumber: 'CTR-99-999999' },
      { createdAt: '2099-01-01T00:00:00.000Z' },
      { companyId: 'COMPANY-B' },
      { tenantId: 'TENANT-B' },
    ]) {
      const rejected = await request(baseUrl, 'PATCH', '/api/client_contracts/CC-1', payload, scopedHeaders);
      assert.equal(rejected.status, 409);
      assert.equal(rejected.body.code, 'CLIENT_CONTRACT_FIELD_IMMUTABLE');
    }
    assert.equal(state.client_contracts[0].id, 'CC-1');
    assert.equal(state.client_contracts[0].number, 'CTR-26-000002');
    assert.equal(state.client_contracts[0].createdAt, createdAt);

    const crossCompany = await request(baseUrl, 'PATCH', '/api/client_contracts/CC-1', {
      title: 'Чужое изменение',
    }, { 'x-company-id': 'COMPANY-B', 'x-tenant-id': 'TENANT-A' });
    assert.equal(crossCompany.status, 403);
    assert.equal(crossCompany.body.code, 'CLIENT_CONTRACT_SCOPE_FORBIDDEN');
    assert.equal(state.client_contracts[0].title, 'Обновлённый договор');

    const crossTenant = await request(baseUrl, 'PATCH', '/api/client_contracts/CC-1', {
      title: 'Чужое tenant-изменение',
    }, { 'x-company-id': 'COMPANY-A', 'x-tenant-id': 'TENANT-B' });
    assert.equal(crossTenant.status, 403);
    assert.equal(crossTenant.body.code, 'CLIENT_CONTRACT_SCOPE_FORBIDDEN');
    assert.equal(state.client_contracts[0].title, 'Обновлённый договор');

    const archived = await request(baseUrl, 'PATCH', '/api/client_contracts/CC-1', {
      status: 'archived',
    }, scopedHeaders);
    assert.equal(archived.status, 200);
    assert.equal(archived.body.status, 'archived');

    const editedArchived = await request(baseUrl, 'PATCH', '/api/client_contracts/CC-1', {
      title: 'Историческая редакция',
    }, scopedHeaders);
    assert.equal(editedArchived.status, 200);
    assert.equal(editedArchived.body.status, 'archived');
    assert.equal(editedArchived.body.id, 'CC-1');
    assert.equal(editedArchived.body.number, 'CTR-26-000002');

    assert.throws(
      () => normalizeClientRelationLinks(
        { clientId: 'C-1', contractId: 'CC-1' },
        'C-1',
        { readData: name => state[name] || [], requireActiveContract: true },
      ),
      error => error?.code === 'CLIENT_CONTRACT_ARCHIVED' && error?.status === 409,
    );

    const archivedPayment = await request(baseUrl, 'POST', '/api/payments', {
      clientId: 'C-1',
      contractId: 'CC-1',
      amount: 1000,
      paidAmount: 0,
      status: 'pending',
    });
    assert.equal(archivedPayment.status, 409);
    assert.equal(archivedPayment.body.code, 'CLIENT_CONTRACT_ARCHIVED');

    const archivedDocument = await request(baseUrl, 'POST', '/api/documents', {
      clientId: 'C-1',
      contractId: 'CC-1',
      type: 'contract',
      number: 'D-ARCHIVED',
      status: 'draft',
    });
    assert.equal(archivedDocument.status, 409);
    assert.equal(archivedDocument.body.code, 'CLIENT_CONTRACT_ARCHIVED');

    const archivedService = await request(baseUrl, 'POST', '/api/service', {
      clientId: 'C-1',
      contractId: 'CC-1',
      equipmentId: 'EQ-1',
      equipment: 'Подъемник',
      reason: 'Осмотр',
      description: 'Осмотр',
      priority: 'medium',
      sla: '24 ч',
      status: 'new',
    });
    assert.equal(archivedService.status, 409);
    assert.equal(archivedService.body.code, 'CLIENT_CONTRACT_ARCHIVED');

    const historicalLink = normalizeClientRelationLinks(
      { clientId: 'C-1', contractId: 'CC-1' },
      'C-1',
      {
        readData: name => state[name] || [],
        requireActiveContract: true,
        allowArchivedContractId: 'CC-1',
      },
    );
    assert.equal(historicalLink.contractId, 'CC-1');

    const protectedDelete = await request(baseUrl, 'DELETE', '/api/client_contracts/CC-1?clientId=C-1', undefined, scopedHeaders);
    assert.equal(protectedDelete.status, 409);
    assert.equal(protectedDelete.body.code, 'CONTRACT_HAS_HISTORY');
    assert.equal(state.client_contracts[0].id, 'CC-1');
  });
});

test('referenced ClientObject can be archived but cannot be hard-deleted', async () => {
  const { app, state } = makeCrudApp({
    clients: [{ id: 'C-1', company: 'Клиент', inn: '7707083893', innNormalized: '7707083893' }],
    client_objects: [{ id: 'CO-1', clientId: 'C-1', name: 'Площадка', status: 'active' }],
    client_contracts: [{ id: 'CC-1', clientId: 'C-1', objectId: 'CO-1', number: 'Д-1', status: 'active' }],
    rentals: [{ id: 'R-1', clientId: 'C-1', objectId: 'CO-1', contractId: 'CC-1' }],
  });

  await withServer(app, async baseUrl => {
    const deleted = await request(baseUrl, 'DELETE', '/api/client_objects/CO-1');
    assert.equal(deleted.status, 409);
    assert.equal(deleted.body.code, 'CLIENT_OBJECT_HAS_HISTORY');
    assert.deepEqual(deleted.body.links, [
      { collection: 'rentals', count: 1 },
      { collection: 'client_contracts', count: 1 },
    ]);
    assert.equal(state.client_objects.length, 1);

    const archived = await request(baseUrl, 'PATCH', '/api/client_objects/CO-1', { status: 'archived' });
    assert.equal(archived.status, 200);
    assert.equal(archived.body.status, 'archived');
    assert.equal(state.rentals[0].objectId, 'CO-1');
    assert.equal(state.client_contracts[0].objectId, 'CO-1');
  });
});

test('unused ClientContract can be archived and deleted while legacy status reads as active', async () => {
  const { app, state } = makeCrudApp({
    clients: [
      { id: 'C-1', company: 'Клиент', inn: '7707083893', innNormalized: '7707083893' },
      { id: 'C-2', company: 'Другой', inn: '123456789012', innNormalized: '123456789012' },
    ],
    client_contracts: [
      { id: 'CC-unused', clientId: 'C-1', number: 'Д-1', status: 'active' },
      { id: 'CC-legacy', clientId: 'C-1', number: 'Д-legacy' },
      { id: 'CC-other', clientId: 'C-2', number: 'Д-2', status: 'active' },
    ],
  });
  state.client_contracts.find(item => item.id === 'CC-other').counterpartyId = state.clients.find(item => item.id === 'C-2').counterpartyId;

  await withServer(app, async baseUrl => {
    const legacy = await request(baseUrl, 'GET', '/api/client_contracts/CC-legacy');
    assert.equal(legacy.status, 200);
    assert.equal(legacy.body.status, 'active');

    const archived = await request(baseUrl, 'PATCH', '/api/client_contracts/CC-unused', { status: 'archived' });
    assert.equal(archived.status, 200);
    assert.equal(archived.body.status, 'archived');

    const reloaded = await request(baseUrl, 'GET', '/api/client_contracts/CC-unused');
    assert.equal(reloaded.status, 200);
    assert.equal(reloaded.body.status, 'archived');

    const newDocument = await request(baseUrl, 'POST', '/api/documents', {
      clientId: 'C-1',
      contractId: 'CC-unused',
      type: 'act',
      number: 'A-1',
      status: 'draft',
    });
    assert.equal(newDocument.status, 409);
    assert.equal(newDocument.body.code, 'CLIENT_CONTRACT_ARCHIVED');

    const missingContext = await request(baseUrl, 'DELETE', '/api/client_contracts/CC-unused');
    assert.equal(missingContext.status, 400);
    assert.equal(missingContext.body.code, 'CLIENT_CONTRACT_DELETE_CONTEXT_REQUIRED');

    const wrongClient = await request(baseUrl, 'DELETE', '/api/client_contracts/CC-other?clientId=C-1');
    assert.equal(wrongClient.status, 409);
    assert.equal(wrongClient.body.code, 'CLIENT_CONTRACT_RELATION_MISMATCH');
    assert.equal(state.client_contracts.some(item => item.id === 'CC-other'), true);

    const mixedContext = await request(
      baseUrl,
      'DELETE',
      `/api/client_contracts/CC-other?clientId=C-1&counterpartyId=${encodeURIComponent(state.client_contracts.find(item => item.id === 'CC-other').counterpartyId)}`,
    );
    assert.equal(mixedContext.status, 409);
    assert.equal(mixedContext.body.code, 'CLIENT_CONTRACT_RELATION_MISMATCH');

    const deleted = await request(baseUrl, 'DELETE', '/api/client_contracts/CC-unused?clientId=C-1');
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.ok, true);
    assert.equal(state.client_contracts.some(item => item.id === 'CC-unused'), false);
  });
});

test('linked ClientContract can be archived but every hard-delete path preserves history', async () => {
  const linkedContract = { id: 'CC-linked', clientId: 'C-1', number: 'Д-linked', status: 'active' };
  const { app, state } = makeCrudApp({
    clients: [{ id: 'C-1', company: 'Клиент', inn: '7707083893', innNormalized: '7707083893' }],
    client_contracts: [linkedContract],
    rentals: [{ id: 'R-1', clientId: 'C-1', contractId: linkedContract.id }],
    gantt_rentals: [{ id: 'GR-1', rentalId: 'R-1', clientId: 'C-1', contractId: linkedContract.id }],
    rental_change_requests: [{ id: 'RCR-1', rentalId: 'R-1', newValue: { contractId: linkedContract.id } }],
    deliveries: [{ id: 'DL-1', clientId: 'C-1', contractId: linkedContract.id }],
    service: [{ id: 'S-1', clientId: 'C-1', clientContractId: linkedContract.id }],
    warranty_claims: [{ id: 'W-1', clientId: 'C-1', contractId: linkedContract.id }],
    client_objects: [{ id: 'CO-1', clientId: 'C-1', name: 'Объект', contractId: linkedContract.id }],
    documents: [{
      id: 'D-1',
      clientId: 'C-1',
      type: 'rental_contract',
      contractId: linkedContract.id,
      snapshot: { clientContract: { id: linkedContract.id, number: linkedContract.number } },
    }],
    mechanic_documents: [{ id: 'MD-1', contractId: linkedContract.id }],
    payments: [{ id: 'P-1', clientId: 'C-1', contractId: linkedContract.id, amount: 1000 }],
    payment_allocations: [{ id: 'PA-1', paymentId: 'P-1', contractId: linkedContract.id, amount: 1000 }],
    debt_collection_plans: [{ id: 'DP-1', contractId: linkedContract.id }],
  });

  await withServer(app, async baseUrl => {
    const archived = await request(baseUrl, 'PATCH', '/api/client_contracts/CC-linked', { status: 'archived' });
    assert.equal(archived.status, 200);
    assert.equal(archived.body.status, 'archived');

    const deleted = await request(baseUrl, 'DELETE', '/api/client_contracts/CC-linked?clientId=C-1');
    assert.equal(deleted.status, 409);
    assert.equal(deleted.body.code, 'CONTRACT_HAS_HISTORY');
    assert.deepEqual(deleted.body.links.map(link => link.collection), [
      'rentals',
      'gantt_rentals',
      'rental_change_requests',
      'deliveries',
      'service',
      'warranty_claims',
      'client_objects',
      'documents',
      'mechanic_documents',
      'payments',
      'payment_allocations',
      'debt_collection_plans',
    ]);
    assert.equal(deleted.body.links.every(link => link.count === 1 && link.source === 'json'), true);
    assert.equal(state.client_contracts[0].status, 'archived');
    assert.equal(state.rentals[0].contractId, 'CC-linked');
    assert.equal(state.documents[0].snapshot.clientContract.number, 'Д-linked');
    assert.equal(state.payments[0].contractId, 'CC-linked');

    const bulkBypass = await request(baseUrl, 'PUT', '/api/client_contracts', []);
    assert.equal(bulkBypass.status, 409);
    assert.equal(bulkBypass.body.code, 'CLIENT_CONTRACT_BULK_DELETE_FORBIDDEN');
    assert.equal(state.client_contracts.length, 1);
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
    assert.equal(documentObject.status, 409);

    const documentContract = await request(baseUrl, 'POST', '/api/documents', {
      clientId: 'C-1',
      client: 'Клиент',
      contractId: 'CC-2',
      type: 'contract',
      number: 'D-2',
      status: 'draft',
    });
    assert.equal(documentContract.status, 409);

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
    assert.equal(service.status, 409);
    assert.equal(service.body.code, 'SERVICE_COUNTERPARTY_SOURCE_RELATION_MISSING');
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
