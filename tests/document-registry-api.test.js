import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const { createAccessControl } = require('../server/lib/access-control.js');
const { registerDocumentRoutes } = require('../server/routes/documents.js');

function createApp() {
  let idCounter = 0;
  const state = {
    users: [
      { id: 'U-admin', name: 'Админ', role: 'Администратор', status: 'Активен' },
      { id: 'U-office', name: 'Офис', role: 'Офис-менеджер', status: 'Активен' },
      { id: 'U-manager', name: 'Руслан', role: 'Менеджер по аренде', status: 'Активен' },
      { id: 'U-mechanic', name: 'Петров', role: 'Механик', status: 'Активен' },
    ],
    clients: [{ id: 'C-1', company: 'ООО Клиент' }],
    rentals: [{ id: 'R-1', clientId: 'C-1', client: 'ООО Клиент', manager: 'Руслан', managerId: 'U-manager' }],
    gantt_rentals: [],
    equipment: [{ id: 'EQ-1', inventoryNumber: 'A-1' }],
    documents: [],
    app_settings: [],
  };
  const users = {
    admin: { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' },
    office: { userId: 'U-office', userName: 'Офис', userRole: 'Офис-менеджер' },
    manager: { userId: 'U-manager', userName: 'Руслан', userRole: 'Менеджер по аренде' },
    mechanic: { userId: 'U-mechanic', userName: 'Петров', userRole: 'Механик' },
  };
  const app = express();
  const router = express.Router();
  app.use(express.json());
  const readData = name => state[name] || [];
  const writeData = (name, value) => {
    state[name] = value;
  };
  const accessControl = createAccessControl({ readData });
  const requireAuth = (req, res, next) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = users[token];
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = user;
    next();
  };
  const requireRead = collection => (req, res, next) => {
    if (collection === 'documents' && ['Администратор', 'Офис-менеджер', 'Менеджер по аренде'].includes(req.user?.userRole)) return next();
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  };
  const requireWrite = collection => (req, res, next) => {
    if (collection === 'documents' && ['Администратор', 'Офис-менеджер', 'Менеджер по аренде'].includes(req.user?.userRole)) return next();
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  };

  registerDocumentRoutes(router, {
    readData,
    writeData,
    requireAuth,
    requireRead,
    requireWrite,
    accessControl,
    generateId: prefix => `${prefix}-${++idCounter}`,
    idPrefixes: { documents: 'D' },
    nowIso: () => '2026-05-09T10:00:00.000Z',
    auditLog: null,
    normalizeRecordClientLink: item => item,
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

async function request(baseUrl, method, path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { response, json };
}

test('documents API creates documents with automatic numbers and separate sequences', async () => {
  const { app, state } = createApp();
  await withServer(app, async (baseUrl) => {
    const act = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'act',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-1',
      date: '2026-05-09',
      status: 'draft',
    });
    assert.equal(act.response.status, 201);
    assert.equal(act.json.number, 'ACT-2026-0001');
    assert.equal(state.documents[0].history.some(entry => entry.action === 'number_assigned'), true);

    const invoice = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'invoice',
      clientId: 'C-1',
      client: 'ООО Клиент',
      date: '2026-05-09',
      status: 'draft',
    });
    assert.equal(invoice.response.status, 201);
    assert.equal(invoice.json.number, 'INVOICE-2026-0001');
  });
});

test('closing rental documents snapshot downtime-adjusted billing amount', async () => {
  const { app, state } = createApp();
  state.rentals = [{
    id: 'R-metal',
    clientId: 'C-1',
    client: 'ООО Клиент',
    manager: 'Руслан',
    startDate: '2026-05-01',
    plannedReturnDate: '2026-05-31',
    price: 310000,
  }];
  state.gantt_rentals = [{
    id: 'GR-metal',
    rentalId: 'R-metal',
    clientId: 'C-1',
    client: 'ООО Клиент',
    manager: 'Руслан',
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    amount: 310000,
    downtimePeriods: [
      { id: 'DT-1', rentalId: 'R-metal', startDate: '2026-05-01', endDate: '2026-05-07', reason: 'ожидание клиента', affectsBilling: true, status: 'active' },
      { id: 'DT-2', rentalId: 'R-metal', startDate: '2026-05-13', endDate: '2026-05-17', reason: 'эвакуатор не мог забрать технику', affectsBilling: true, status: 'active' },
    ],
  }];

  await withServer(app, async (baseUrl) => {
    const act = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'act',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-metal',
      amount: 310000,
      date: '2026-05-31',
      status: 'draft',
    });

    assert.equal(act.response.status, 201);
    assert.equal(act.json.amount, 190000);
    assert.equal(act.json.rentalBillingSnapshot.grossRentalAmount, 310000);
    assert.equal(act.json.rentalBillingSnapshot.downtimeAdjustmentAmount, 120000);
    assert.equal(act.json.rentalBillingSnapshot.finalRentalAmount, 190000);
    assert.equal(act.json.rentalBillingSnapshot.billingDowntimeDays, 12);

    const upd = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'upd',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-metal',
      date: '2026-05-31',
      status: 'draft',
    });

    assert.equal(upd.response.status, 201);
    assert.equal(upd.json.amount, 190000);
    assert.equal(upd.json.billingSnapshot.billableDays, 19);
  });
});

test('document snapshots stay fixed and new documents use current downtime billing', async () => {
  const { app, state } = createApp();
  state.rentals = [{
    id: 'R-snapshot',
    clientId: 'C-1',
    client: 'ООО Клиент',
    manager: 'Руслан',
    startDate: '2026-05-01',
    plannedReturnDate: '2026-05-31',
    price: 310000,
  }];
  state.gantt_rentals = [{
    id: 'GR-snapshot',
    rentalId: 'R-snapshot',
    clientId: 'C-1',
    client: 'ООО Клиент',
    manager: 'Руслан',
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    amount: 310000,
    downtimePeriods: [
      { id: 'DT-1', rentalId: 'R-snapshot', startDate: '2026-05-01', endDate: '2026-05-07', reason: 'ожидание клиента', affectsBilling: true, status: 'active' },
    ],
  }];

  await withServer(app, async (baseUrl) => {
    const first = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'act',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-snapshot',
      date: '2026-05-31',
      status: 'draft',
    });
    assert.equal(first.response.status, 201);
    assert.equal(first.json.amount, 240000);

    state.gantt_rentals[0].downtimePeriods.push(
      { id: 'DT-2', rentalId: 'R-snapshot', startDate: '2026-05-13', endDate: '2026-05-17', reason: 'эвакуатор', affectsBilling: true, status: 'active' },
    );

    const oldDoc = await request(baseUrl, 'GET', `/api/documents/${first.json.id}`, 'office');
    assert.equal(oldDoc.response.status, 200);
    assert.equal(oldDoc.json.amount, 240000);
    assert.equal(oldDoc.json.rentalBillingSnapshot.finalRentalAmount, 240000);

    const second = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'act',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-snapshot',
      date: '2026-05-31',
      status: 'draft',
    });
    assert.equal(second.response.status, 201);
    assert.equal(second.json.amount, 190000);
    assert.equal(second.json.rentalBillingSnapshot.finalRentalAmount, 190000);
  });
});

test('contract and custom invoice amounts are not overwritten by downtime billing', async () => {
  const { app, state } = createApp();
  state.rentals = [{
    id: 'R-contract',
    clientId: 'C-1',
    client: 'ООО Клиент',
    startDate: '2026-05-01',
    plannedReturnDate: '2026-05-31',
    price: 310000,
  }];
  state.gantt_rentals = [{
    id: 'GR-contract',
    rentalId: 'R-contract',
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    amount: 310000,
    downtimePeriods: [
      { id: 'DT-1', rentalId: 'R-contract', startDate: '2026-05-01', endDate: '2026-05-07', reason: 'ожидание клиента', affectsBilling: true, status: 'active' },
    ],
  }];

  await withServer(app, async (baseUrl) => {
    const contract = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'contract',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-contract',
      amount: 310000,
      date: '2026-05-01',
      status: 'draft',
    });
    assert.equal(contract.response.status, 201);
    assert.equal(contract.json.amount, 310000);
    assert.equal(contract.json.rentalBillingSnapshot.finalRentalAmount, 240000);

    const invoice = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'invoice',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-contract',
      amount: 50000,
      date: '2026-05-10',
      status: 'draft',
    });
    assert.equal(invoice.response.status, 201);
    assert.equal(invoice.json.amount, 50000);
    assert.equal(invoice.json.rentalBillingSnapshot.finalRentalAmount, 240000);
  });
});

test('documents API rejects duplicate manual numbers and PATCH duplicates', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const first = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'contract',
      number: 'CONTRACT-2026-0007',
      clientId: 'C-1',
      client: 'ООО Клиент',
      date: '2026-05-09',
      status: 'draft',
    });
    assert.equal(first.response.status, 201);

    const duplicate = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'contract',
      number: 'CONTRACT-2026-0007',
      clientId: 'C-1',
      client: 'ООО Клиент',
      date: '2026-05-10',
      status: 'draft',
    });
    assert.equal(duplicate.response.status, 409);

    const second = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'contract',
      number: 'CONTRACT-2026-0008',
      clientId: 'C-1',
      client: 'ООО Клиент',
      date: '2026-05-10',
      status: 'draft',
    });
    assert.equal(second.response.status, 201);

    const patchDuplicate = await request(baseUrl, 'PATCH', `/api/documents/${second.json.id}`, 'office', {
      number: 'CONTRACT-2026-0007',
    });
    assert.equal(patchDuplicate.response.status, 409);
  });
});

test('documents API assigns number to legacy document and reports registry summary', async () => {
  const { app, state } = createApp();
  state.documents = [{
    id: 'D-legacy',
    type: 'upd',
    number: '',
    clientId: 'C-1',
    client: 'ООО Клиент',
    date: '2026-05-08',
    status: 'sent',
  }];
  await withServer(app, async (baseUrl) => {
    const before = await request(baseUrl, 'GET', '/api/documents/registry/summary', 'office');
    assert.equal(before.response.status, 200);
    assert.equal(before.json.withoutNumber, 1);

    const assigned = await request(baseUrl, 'POST', '/api/documents/D-legacy/assign-number', 'office');
    assert.equal(assigned.response.status, 200);
    assert.equal(assigned.json.number, 'UPD-2026-0001');
    assert.equal(assigned.json.history.some(entry => entry.action === 'number_changed'), true);

    const after = await request(baseUrl, 'GET', '/api/documents/registry/summary', 'office');
    assert.equal(after.json.withoutNumber, 0);
  });
});

test('documents API records status history and blocks forbidden roles', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const denied = await request(baseUrl, 'GET', '/api/documents', 'mechanic');
    assert.equal(denied.response.status, 403);

    const managerManual = await request(baseUrl, 'POST', '/api/documents', 'manager', {
      type: 'act',
      number: 'ACT-2026-0099',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-1',
      date: '2026-05-09',
      status: 'draft',
    });
    assert.equal(managerManual.response.status, 403);

    const auto = await request(baseUrl, 'POST', '/api/documents', 'manager', {
      type: 'act',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-1',
      date: '2026-05-09',
      status: 'draft',
    });
    assert.equal(auto.response.status, 201);

    const sent = await request(baseUrl, 'PATCH', `/api/documents/${auto.json.id}`, 'manager', { status: 'sent' });
    assert.equal(sent.response.status, 200);
    assert.equal(sent.json.sentAt, '2026-05-09T10:00:00.000Z');
    assert.equal(sent.json.history.some(entry => entry.field === 'status'), true);
  });
});
