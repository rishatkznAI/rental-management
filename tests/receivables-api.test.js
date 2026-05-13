import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const { createAccessControl } = require('../server/lib/access-control.js');
const { registerFinanceRoutes } = require('../server/routes/finance.js');
const financeCore = require('../server/lib/finance-core.js');
const receivablesCore = require('../server/lib/receivables-core.js');

function createApp() {
  let idCounter = 0;
  const state = {
    clients: [{ id: 'c-1', company: 'ООО Долг', inn: '7701000000', manager: 'Office' }],
    rentals: [{
      id: 'r-1',
      clientId: 'c-1',
      client: 'ООО Долг',
      equipmentInv: 'A-1',
      manager: 'Office',
      startDate: '2026-04-01',
      plannedReturnDate: '2026-04-10',
      status: 'active',
    }],
    gantt_rentals: [{
      id: 'gr-1',
      rentalId: 'r-1',
      sourceRentalId: 'r-1',
      originalRentalId: 'r-1',
      clientId: 'c-1',
      client: 'ООО Долг',
      equipmentInv: 'A-1',
      manager: 'Office',
      startDate: '2026-04-01',
      endDate: '2026-04-10',
      expectedPaymentDate: '2026-04-15',
      amount: 100000,
      status: 'active',
    }],
    payments: [],
    documents: [],
    client_objects: [],
    leasing_contracts: [],
    leasing_payment_schedule: [],
    debt_collection_actions: [],
    receivable_payment_plans: [],
  };
  const users = {
    admin: { userId: 'u-admin', userName: 'Admin', userRole: 'Администратор' },
    office: { userId: 'u-office', userName: 'Office', userRole: 'Офис-менеджер' },
    mechanic: { userId: 'u-mechanic', userName: 'Mechanic', userRole: 'Механик' },
  };
  const readData = name => state[name] || [];
  const writeData = (name, value) => {
    state[name] = value;
  };
  const accessControl = createAccessControl({ readData });
  const app = express();
  const router = express.Router();
  app.use(express.json());
  const requireAuth = (req, res, next) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = users[token];
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = user;
    next();
  };
  const requireRead = collection => (req, res, next) => {
    if (collection === 'finance_operations' && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole)) return next();
    if (collection === 'payments' && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole)) return next();
    if (['debt_collection_actions', 'receivable_payment_plans'].includes(collection) && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole)) return next();
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  };
  const requireWrite = collection => (req, res, next) => {
    if (['debt_collection_actions', 'receivable_payment_plans'].includes(collection) && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole)) return next();
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  };
  registerFinanceRoutes(router, {
    requireAuth,
    requireRead,
    requireWrite,
    readData,
    writeData,
    accessControl,
    generateId: prefix => `${prefix}-${++idCounter}`,
    idPrefixes: { debt_collection_actions: 'DCA', receivable_payment_plans: 'RPP' },
    nowIso: () => '2026-05-09T12:00:00.000Z',
    auditLog: null,
    ...financeCore,
    ...receivablesCore,
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

test('receivables API lists debt and persists collection actions and payment plans', async () => {
  const { app, state } = createApp();
  await withServer(app, async (baseUrl) => {
    const list = await request(baseUrl, 'GET', '/api/finance/receivables?today=2026-05-09', 'office');
    assert.equal(list.response.status, 200);
    assert.equal(list.json.summary.totalDebt, 100000);
    assert.equal(list.json.rows[0].clientId, 'c-1');

    const action = await request(baseUrl, 'POST', '/api/finance/receivables/actions', 'office', {
      clientId: 'c-1',
      actionType: 'payment_promise',
      status: 'done',
      actionDate: '2026-05-09',
      promisedPaymentDate: '2026-05-20',
      promisedAmount: 50000,
      comment: 'Клиент обещал оплату',
    });
    assert.equal(action.response.status, 201);
    assert.equal(state.debt_collection_actions.length, 1);

    const plan = await request(baseUrl, 'POST', '/api/finance/receivables/payment-plans', 'office', {
      clientId: 'c-1',
      paymentDate: '2026-05-25',
      amount: 50000,
      status: 'planned',
    });
    assert.equal(plan.response.status, 201);
    assert.equal(state.receivable_payment_plans.length, 1);

    const after = await request(baseUrl, 'GET', '/api/finance/receivables?today=2026-05-09', 'office');
    assert.equal(after.response.status, 200);
    assert.equal(after.json.rows[0].collectionStatus, 'payment_plan');
    assert.equal(after.json.summary.promisedAmount, 50000);
    assert.equal(after.json.summary.paymentPlanAmount, 50000);
  });
});

test('receivables API denies roles without finance payment access', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const deniedList = await request(baseUrl, 'GET', '/api/finance/receivables', 'mechanic');
    assert.equal(deniedList.response.status, 403);

    const deniedWrite = await request(baseUrl, 'POST', '/api/finance/receivables/actions', 'mechanic', {
      clientId: 'c-1',
      actionType: 'call',
    });
    assert.equal(deniedWrite.response.status, 403);
  });
});
