import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const { createServiceCore } = require('../server/lib/service-core.js');
const { backfillServiceTicketCreatedAt, normalizeServiceTicketForWrite } = require('../server/lib/service-dto.js');
const { registerCrudRoutes } = require('../server/routes/crud.js');

function createState() {
  return {
    service: [],
    equipment: [{ id: 'EQ-1', inventoryNumber: '083', manufacturer: 'Mantall', model: 'HZ160' }],
    mechanics: [],
    users: [],
    clients: [],
    client_objects: [],
    client_contracts: [],
    rentals: [],
    gantt_rentals: [],
    payments: [],
    documents: [],
    service_audit_log: [],
  };
}

function createApp(state = createState()) {
  const app = express();
  app.use(express.json());
  const readData = name => state[name] || [];
  const writeData = (name, value) => { state[name] = value; };
  const accessControl = createAccessControl({ readData });
  const nowValues = [
    '2026-05-18T10:00:00.000Z',
    '2026-05-18T10:05:00.000Z',
    '2026-05-18T10:10:00.000Z',
  ];
  let nowIndex = 0;
  const nowIso = () => nowValues[Math.min(nowIndex++, nowValues.length - 1)];
  const serviceCore = createServiceCore({
    readData,
    writeData,
    nowIso: () => '2026-05-18T10:00:00.000Z',
    equipmentMatchesServiceTicket: (ticket, equipment) => ticket.equipmentId === equipment.id,
  });

  app.use((req, _res, next) => {
    req.user = { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' };
    next();
  });
  app.use('/api', registerCrudRoutes({
    collections: ['service'],
    idPrefixes: { service: 'S' },
    readData,
    writeData,
    deleteSessionsForUserIds: () => {},
    requireAuth: (_req, _res, next) => next(),
    requireRead: () => (_req, _res, next) => next(),
    requireWrite: () => (_req, _res, next) => next(),
    sanitizeUser: user => user,
    publicUserView: user => user,
    canReadFullUsers: () => true,
    hashPassword: value => value,
    normalizeServiceWorkRecord: record => record,
    normalizeSparePartRecord: record => record,
    validateRentalPayload: () => ({ ok: true }),
    mergeEntityHistory: (_collection, _previous, next) => next,
    requireNonEmptyString: () => {},
    generateId: prefix => `${prefix}-${readData('service').length + 1}`,
    nowIso,
    applyServiceTicketCreationEffects: serviceCore.applyServiceTicketCreationEffects,
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

const baseTicket = {
  equipmentId: 'EQ-1',
  equipment: 'Mantall HZ160',
  reason: 'Ремонт',
  description: 'Диагностика',
  priority: 'medium',
  status: 'new',
};

test('backend creates service ticket createdAt when payload omits it', async () => {
  const { app, state } = createApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/service', baseTicket);

    assert.equal(response.status, 201);
    assert.equal(response.body.createdAt, '2026-05-18T10:00:00.000Z');
    assert.equal(response.body.updatedAt, '2026-05-18T10:00:00.000Z');
    assert.equal(response.body.createdBy, 'Админ');
    assert.equal(response.body.createdByName, 'Админ');
    assert.equal(state.service[0].createdAt, '2026-05-18T10:00:00.000Z');
  });
});

test('backend creates service ticket createdAt when payload sends empty or null dates', async () => {
  for (const createdAt of ['', null]) {
    const { app } = createApp();
    await withServer(app, async baseUrl => {
      const response = await request(baseUrl, 'POST', '/api/service', { ...baseTicket, createdAt });

      assert.equal(response.status, 201);
      assert.equal(response.body.createdAt, '2026-05-18T10:00:00.000Z');
      assert.equal(response.body.updatedAt, '2026-05-18T10:00:00.000Z');
    });
  }
});

test('backend update preserves existing service createdAt and refreshes updatedAt', async () => {
  const { app, state } = createApp({
    ...createState(),
    service: [{
      id: 'S-1',
      ...baseTicket,
      createdAt: '2026-05-01T09:00:00.000Z',
      updatedAt: '2026-05-01T09:00:00.000Z',
    }],
  });

  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'PATCH', '/api/service/S-1', {
      reason: 'Обновлено',
      createdAt: '2030-01-01T00:00:00.000Z',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.createdAt, '2026-05-01T09:00:00.000Z');
    assert.equal(response.body.updatedAt, '2026-05-18T10:00:00.000Z');
    assert.equal(state.service[0].createdAt, '2026-05-01T09:00:00.000Z');
    assert.equal(state.service[0].updatedAt, '2026-05-18T10:00:00.000Z');
  });
});

test('service normalizer and backfill recover legacy service dates idempotently', () => {
  const legacy = [
    { id: 'S-created-date', createdDate: '2026-05-01T08:00:00.000Z' },
    { id: 'S-date', date: '2026-05-02' },
    { id: 'S-requested', requestedAt: '2026-05-03T08:00:00.000Z' },
    { id: 'S-updated', updatedAt: '2026-05-04T08:00:00.000Z' },
    { id: 'S-empty' },
  ];

  const first = backfillServiceTicketCreatedAt(legacy, { nowIso: () => '2026-05-18T12:00:00.000Z' });
  const second = backfillServiceTicketCreatedAt(first.items, { nowIso: () => '2027-01-01T00:00:00.000Z' });

  assert.equal(first.stats.changed, 5);
  assert.deepEqual(
    first.items.map(item => item.createdAt),
    ['2026-05-01T08:00:00.000Z', '2026-05-02', '2026-05-03T08:00:00.000Z', '2026-05-04T08:00:00.000Z', '2026-05-18T12:00:00.000Z'],
  );
  assert.equal(first.items[4].createdAtRestoredApproximate, true);
  assert.equal(second.stats.changed, 0);

  const normalized = normalizeServiceTicketForWrite({ id: 'S-new' }, {
    nowIso: () => '2026-05-18T12:30:00.000Z',
    actor: { userId: 'U-1', userName: 'Оператор' },
  });
  assert.equal(normalized.createdAt, '2026-05-18T12:30:00.000Z');
  assert.equal(normalized.createdByName, 'Оператор');
});
