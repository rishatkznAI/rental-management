import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const { createServiceAuditLog } = require('../server/lib/service-audit-log.js');
const { registerServiceRoutes } = require('../server/routes/service.js');

function safeNonNegativeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function createState() {
  return {
    mechanics: [{ id: 'M-1', name: 'Петров', userId: 'U-mechanic' }],
    equipment: [{ id: 'EQ-1', inventoryNumber: '083', manufacturer: 'Mantall', model: 'HZ160' }],
    service: [{ id: 'S-1', assignedMechanicId: 'M-1', assignedMechanicName: 'Петров', status: 'new', equipmentId: 'EQ-1', reason: 'Гидравлика' }],
    service_works: [{ id: 'SW-1', name: 'Диагностика', normHours: 1.5, ratePerHour: 2500, isActive: true }],
    spare_parts: [{ id: 'SP-1', name: 'Фильтр', unit: 'шт', defaultPrice: 5000, isActive: true }],
    repair_work_items: [],
    repair_part_items: [],
    service_audit_log: [],
    service_field_trips: [],
  };
}

function normalizeServiceWorkRecord(record) {
  return {
    ...record,
    normHours: safeNonNegativeNumber(record.normHours, 0),
    ratePerHour: safeNonNegativeNumber(record.ratePerHour, 0),
    sortOrder: Number.isFinite(Number(record.sortOrder)) ? Number(record.sortOrder) : 0,
    isActive: record.isActive !== false,
  };
}

function normalizeSparePartRecord(record) {
  return {
    ...record,
    unit: String(record.unit || 'шт').trim() || 'шт',
    defaultPrice: safeNonNegativeNumber(record.defaultPrice, 0),
    isActive: record.isActive !== false,
  };
}

function createServiceApp(state = createState(), user = { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' }) {
  const app = express();
  app.use(express.json());
  const readData = name => state[name] || [];
  const writeData = (name, value) => { state[name] = value; };
  const accessControl = createAccessControl({ readData });
  const serviceAuditLog = createServiceAuditLog({
    readData,
    writeData,
    generateId: prefix => `${prefix}-${state.service_audit_log.length + 1}`,
    nowIso: () => '2026-04-30T10:00:00.000Z',
  });
  const router = express.Router();

  router.use((req, _res, next) => {
    req.user = user;
    next();
  });

  registerServiceRoutes(router, {
    readData,
    writeData,
    requireAuth: (_req, _res, next) => next(),
    requireRead: () => (_req, _res, next) => next(),
    requireWrite: () => (_req, _res, next) => next(),
    normalizeServiceWorkRecord,
    normalizeSparePartRecord,
    requireNonEmptyString: (value, label) => {
      if (!String(value || '').trim()) throw new Error(`${label} required`);
    },
    nowIso: () => '2026-04-30T10:00:00.000Z',
    generateId: prefix => `${prefix}-new-${readData(prefix).length + 1}`,
    idPrefixes: { repair_work_items: 'repair_work_items', repair_part_items: 'repair_part_items' },
    findServiceTicketOr404: (id, res) => {
      const ticket = state.service.find(item => item.id === id);
      if (!ticket) {
        res.status(404).json({ ok: false, error: 'Заявка на ремонт не найдена' });
        return null;
      }
      return ticket;
    },
    migrateLegacyRepairFacts: () => ({ changed: false }),
    accessControl,
    auditLog: () => {},
    serviceAuditLog,
  });

  app.use('/api', router);
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

async function requestRaw(baseUrl, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function postPart(body) {
  const { app, state } = createServiceApp();
  return withServer(app, async baseUrl => ({
    response: await request(baseUrl, 'POST', '/api/repair_part_items', body),
    state,
  }));
}

test('repair_part_items rejects non-numeric priceSnapshot', async () => {
  const { response, state } = await postPart({ repairId: 'S-1', partId: 'SP-1', quantity: 1, priceSnapshot: 'abc' });
  assert.equal(response.status, 400);
  assert.equal(state.repair_part_items.length, 0);
});

test('repair_part_items rejects negative priceSnapshot', async () => {
  const { response, state } = await postPart({ repairId: 'S-1', partId: 'SP-1', quantity: 1, priceSnapshot: -1 });
  assert.equal(response.status, 400);
  assert.equal(state.repair_part_items.length, 0);
});

test('repair_part_items uses defaultPrice only when priceSnapshot is omitted or empty', async () => {
  const omitted = await postPart({ repairId: 'S-1', partId: 'SP-1', quantity: 1 });
  assert.equal(omitted.response.status, 201);
  assert.equal(omitted.response.body.priceSnapshot, 5000);

  const empty = await postPart({ repairId: 'S-1', partId: 'SP-1', quantity: 1, priceSnapshot: '' });
  assert.equal(empty.response.status, 201);
  assert.equal(empty.response.body.priceSnapshot, 5000);
});

test('repair_part_items rejects Infinity priceSnapshot', async () => {
  const { app, state } = createServiceApp();
  await withServer(app, async baseUrl => {
    const response = await requestRaw(
      baseUrl,
      'POST',
      '/api/repair_part_items',
      '{"repairId":"S-1","partId":"SP-1","quantity":1,"priceSnapshot":1e999}',
    );
    assert.equal(response.status, 400);
    assert.equal(state.repair_part_items.length, 0);
  });
});

test('repair_part_items rejects quantity less than or equal to zero', async () => {
  const zero = await postPart({ repairId: 'S-1', partId: 'SP-1', quantity: 0, priceSnapshot: 100 });
  assert.equal(zero.response.status, 400);

  const negative = await postPart({ repairId: 'S-1', partId: 'SP-1', quantity: -1, priceSnapshot: 100 });
  assert.equal(negative.response.status, 400);
});

test('repair_part_items rejects non-numeric quantity', async () => {
  const { response, state } = await postPart({ repairId: 'S-1', partId: 'SP-1', quantity: 'abc', priceSnapshot: 100 });
  assert.equal(response.status, 400);
  assert.equal(state.repair_part_items.length, 0);
});

test('repair item mutations are admin-only and write service audit entries', async () => {
  const { app, state } = createServiceApp();
  await withServer(app, async baseUrl => {
    const workCreate = await request(baseUrl, 'POST', '/api/repair_work_items', { repairId: 'S-1', workId: 'SW-1', quantity: 1 });
    assert.equal(workCreate.status, 201);
    assert.equal(state.service_audit_log.at(-1).action, 'work_added');
    assert.equal(state.service_audit_log.at(-1).snapshot.nameSnapshot, 'Диагностика');

    const workDelete = await request(baseUrl, 'DELETE', `/api/repair_work_items/${workCreate.body.id}`);
    assert.equal(workDelete.status, 200);
    assert.equal(state.service_audit_log.at(-1).action, 'work_deleted');
    assert.equal(state.service_audit_log.at(-1).entityId, workCreate.body.id);

    const partCreate = await request(baseUrl, 'POST', '/api/repair_part_items', { repairId: 'S-1', partId: 'SP-1', quantity: 1, priceSnapshot: 100 });
    assert.equal(partCreate.status, 201);
    assert.equal(state.service_audit_log.at(-1).action, 'part_added');

    const partDelete = await request(baseUrl, 'DELETE', `/api/repair_part_items/${partCreate.body.id}`);
    assert.equal(partDelete.status, 200);
    assert.equal(state.service_audit_log.at(-1).action, 'part_deleted');

    const audit = await request(baseUrl, 'GET', '/api/service/S-1/audit');
    assert.equal(audit.status, 200);
    assert.equal(audit.body.length, 4);
  });
});

test('mechanic can read repair items but cannot mutate them', async () => {
  const { app, state } = createServiceApp({
    ...createState(),
    repair_work_items: [{ id: 'RW-1', repairId: 'S-1', workId: 'SW-1', quantity: 1 }],
  }, { userId: 'U-mechanic', userName: 'Петров', userRole: 'Механик' });
  await withServer(app, async baseUrl => {
    const list = await request(baseUrl, 'GET', '/api/repair_work_items?repair_id=S-1');
    assert.equal(list.status, 200);

    const create = await request(baseUrl, 'POST', '/api/repair_work_items', { repairId: 'S-1', workId: 'SW-1', quantity: 1 });
    assert.equal(create.status, 403);
    assert.equal(create.body.error, 'Недостаточно прав. Работы и запчасти может изменять только администратор');

    const remove = await request(baseUrl, 'DELETE', '/api/repair_work_items/RW-1');
    assert.equal(remove.status, 403);
    assert.equal(remove.body.error, 'Недостаточно прав. Работы и запчасти может изменять только администратор');
    assert.equal(state.repair_work_items.length, 1);
    assert.equal(state.service_audit_log.length, 0);
  });
});

test('legacy non-numeric normHoursSnapshot does not return NaN in service work items', async () => {
  const { app } = createServiceApp({
    ...createState(),
    repair_work_items: [{ id: 'RW-1', repairId: 'S-1', workId: 'SW-1', quantity: 1, normHoursSnapshot: 'abc', ratePerHourSnapshot: 'abc' }],
  });
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'GET', '/api/repair_work_items?repair_id=S-1');
    assert.equal(response.status, 200);
    assert.equal(response.body[0].normHoursSnapshot, 0);
    assert.equal(response.body[0].ratePerHourSnapshot, 0);
  });
});

test('legacy negative normHoursSnapshot is normalized defensively', async () => {
  const { app } = createServiceApp({
    ...createState(),
    repair_work_items: [{ id: 'RW-1', repairId: 'S-1', workId: 'SW-1', quantity: 1, normHoursSnapshot: -2, ratePerHourSnapshot: -100 }],
  });
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'GET', '/api/repair_work_items?repair_id=S-1');
    assert.equal(response.body[0].normHoursSnapshot, 0);
    assert.equal(response.body[0].ratePerHourSnapshot, 0);
  });
});

test('legacy non-numeric priceSnapshot does not return NaN in repair part items', async () => {
  const { app } = createServiceApp({
    ...createState(),
    repair_part_items: [{ id: 'RP-1', repairId: 'S-1', partId: 'SP-1', quantity: 1, priceSnapshot: 'abc' }],
  });
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'GET', '/api/repair_part_items?repair_id=S-1');
    assert.equal(response.status, 200);
    assert.equal(response.body[0].priceSnapshot, 0);
  });
});

test('legacy negative priceSnapshot is normalized defensively', async () => {
  const { app } = createServiceApp({
    ...createState(),
    repair_part_items: [{ id: 'RP-1', repairId: 'S-1', partId: 'SP-1', quantity: 1, priceSnapshot: -100 }],
  });
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'GET', '/api/repair_part_items?repair_id=S-1');
    assert.equal(response.body[0].priceSnapshot, 0);
  });
});

test('service totals do not become negative from legacy negative snapshots', async () => {
  const { app } = createServiceApp({
    ...createState(),
    repair_work_items: [{ id: 'RW-1', repairId: 'S-1', workId: 'SW-1', quantity: 1, normHoursSnapshot: -2, ratePerHourSnapshot: -100 }],
    repair_part_items: [{ id: 'RP-1', repairId: 'S-1', partId: 'SP-1', quantity: 1, priceSnapshot: -100 }],
  });
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'GET', '/api/reports/mechanics-workload');
    assert.equal(response.status, 200);
    assert.equal(response.body.rows[0].totalNormHours, 0);
    assert.equal(response.body.summary[0].totalNormHours, 0);
    assert.equal(response.body.summary[0].partsCost, 0);
  });
});
