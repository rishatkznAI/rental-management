import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const { createAccessControl } = require('../server/lib/access-control.js');
const { registerLeasingRoutes } = require('../server/routes/leasing.js');
const {
  normalizeLeasingContract,
  normalizeLeasingPaymentScheduleRow,
  decorateLeasingContract,
  buildLeasingSummary,
} = require('../server/lib/leasing-core.js');

function createApp() {
  let idCounter = 0;
  let nextBatchError = null;
  const state = {
    leasing_contracts: [],
    leasing_payment_schedule: [],
  };
  const readData = name => state[name] || [];
  const writeDataBatch = entries => {
    if (nextBatchError) {
      const error = nextBatchError;
      nextBatchError = null;
      throw error;
    }
    const staged = structuredClone(state);
    for (const entry of entries || []) staged[entry.name] = structuredClone(entry.value);
    Object.assign(state, staged);
  };
  const accessControl = createAccessControl({ readData });
  const app = express();
  app.use(express.json());
  const router = express.Router();
  const users = {
    admin: { userId: 'U-admin', userName: 'Admin', userRole: 'Администратор' },
    office: { userId: 'U-office', userName: 'Office', userRole: 'Офис-менеджер' },
    mechanic: { userId: 'U-mechanic', userName: 'Mechanic', userRole: 'Механик' },
  };
  const requireAuth = (req, res, next) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = users[token];
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = user;
    next();
  };
  const requireRead = collection => (req, res, next) => {
    const allowed = collection === 'leasing_contracts' && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole);
    if (!allowed) return res.status(403).json({ ok: false, error: 'Forbidden: insufficient role' });
    next();
  };

  registerLeasingRoutes(router, {
    readData,
    writeDataBatch,
    requireAuth,
    requireRead,
    accessControl,
    generateId: prefix => `${prefix}-new-${++idCounter}`,
    idPrefixes: { leasing_contracts: 'LC', leasing_payment_schedule: 'LPS' },
    nowIso: () => '2026-05-09T12:00:00.000Z',
    normalizeLeasingContract,
    normalizeLeasingPaymentScheduleRow,
    decorateLeasingContract,
    buildLeasingSummary,
  });
  app.use('/api', router);
  return {
    app,
    state,
    failNextBatch(error = Object.assign(new Error('injected leasing batch failure'), { status: 503 })) {
      nextBatchError = error;
    },
  };
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

test('leasing API creates updates and summarizes contracts for finance users', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const create = await request(baseUrl, 'POST', '/api/leasing-contracts', 'office', {
      contractNumber: 'L-API-1',
      leasingCompany: 'Лизинг API',
      startDate: '2026-05-01',
      endDate: '2026-08-31',
      termMonths: 4,
      monthlyPayment: 100000,
      paymentDay: 10,
    });
    assert.equal(create.response.status, 201);
    assert.equal(create.json.contractNumber, 'L-API-1');
    assert.equal(create.json.remainingPayments, 4);

    const update = await request(baseUrl, 'PATCH', `/api/leasing-contracts/${create.json.id}`, 'office', {
      monthlyPayment: 120000,
    });
    assert.equal(update.response.status, 200);
    assert.equal(update.json.monthlyPayment, 120000);

    const summary = await request(baseUrl, 'GET', '/api/leasing-contracts/summary?today=2026-05-09', 'office');
    assert.equal(summary.response.status, 200);
    assert.equal(summary.json.currentMonthAmount, 120000);
    assert.equal(summary.json.activeContracts, 1);
  });
});

test('leasing API keeps paused contracts visible but outside financial workload', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const active = await request(baseUrl, 'POST', '/api/leasing-contracts', 'office', {
      contractNumber: 'L-ACTIVE',
      leasingCompany: 'Лизинг API',
      startDate: '2026-05-01',
      endDate: '2026-08-31',
      termMonths: 4,
      monthlyPayment: 100000,
      paymentDay: 10,
    });
    assert.equal(active.response.status, 201);

    const paused = await request(baseUrl, 'POST', '/api/leasing-contracts', 'office', {
      contractNumber: 'L-PAUSED',
      leasingCompany: 'Пауза API',
      startDate: '2026-04-01',
      endDate: '2026-08-31',
      termMonths: 5,
      monthlyPayment: 900000,
      paymentDay: 5,
      status: 'paused',
      schedule: [{
        dueDate: '2026-04-05',
        amount: 900000,
        status: 'planned',
        paidAmount: 0,
      }],
    });
    assert.equal(paused.response.status, 201);
    assert.equal(paused.json.status, 'paused');
    assert.equal(paused.json.overdueAmount, 0);
    assert.equal(paused.json.schedule[0].status, 'planned');

    const contracts = await request(baseUrl, 'GET', '/api/leasing-contracts?today=2026-05-09', 'office');
    assert.equal(contracts.response.status, 200);
    assert.equal(contracts.json.length, 2);
    assert.ok(contracts.json.find(item => item.contractNumber === 'L-PAUSED'));

    const summary = await request(baseUrl, 'GET', '/api/leasing-contracts/summary?today=2026-05-09', 'office');
    assert.equal(summary.response.status, 200);
    assert.equal(summary.json.activeContracts, 1);
    assert.equal(summary.json.pausedContracts, 1);
    assert.equal(summary.json.currentMonthAmount, 100000);
    assert.equal(summary.json.nextMonthAmount, 100000);
    assert.equal(summary.json.overdueAmount, 0);
    assert.equal(summary.json.remainingAmount, 400000);
  });
});

test('leasing API validates dates and denies non-finance roles', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const denied = await request(baseUrl, 'GET', '/api/leasing-contracts', 'mechanic');
    assert.equal(denied.response.status, 403);

    const invalid = await request(baseUrl, 'POST', '/api/leasing-contracts', 'admin', {
      contractNumber: 'L-BAD',
      leasingCompany: 'Лизинг API',
      startDate: '2026-08-01',
      endDate: '2026-05-01',
      termMonths: 4,
      monthlyPayment: 100000,
      paymentDay: 10,
    });
    assert.equal(invalid.response.status, 400);
    assert.match(invalid.json.error, /Дата окончания/);
  });
});

test('leasing create update and delete persist contract and schedule atomically', async () => {
  const { app, state } = createApp();
  await withServer(app, async (baseUrl) => {
    const created = await request(baseUrl, 'POST', '/api/leasing-contracts', 'office', {
      contractNumber: 'L-ATOMIC',
      leasingCompany: 'Лизинг API',
      startDate: '2026-05-01',
      endDate: '2026-06-30',
      termMonths: 2,
      monthlyPayment: 100000,
      paymentDay: 10,
      schedule: [{ dueDate: '2026-05-10', amount: 100000, status: 'planned' }],
    });
    assert.equal(created.response.status, 201);
    assert.equal(state.leasing_contracts.length, 1);
    assert.equal(state.leasing_payment_schedule.length, 1);
    assert.equal(state.leasing_payment_schedule[0].leasingContractId, created.json.id);

    const updated = await request(baseUrl, 'PATCH', `/api/leasing-contracts/${created.json.id}`, 'office', {
      monthlyPayment: 120000,
      schedule: [{ dueDate: '2026-05-10', amount: 120000, status: 'planned' }],
    });
    assert.equal(updated.response.status, 200);
    assert.equal(state.leasing_contracts[0].monthlyPayment, 120000);
    assert.equal(state.leasing_payment_schedule[0].amount, 120000);

    const deleted = await request(baseUrl, 'DELETE', `/api/leasing-contracts/${created.json.id}`, 'office');
    assert.equal(deleted.response.status, 200);
    assert.deepEqual(state.leasing_contracts, []);
    assert.deepEqual(state.leasing_payment_schedule, []);
  });
});

test('leasing batch failures never expose a partial contract or schedule mutation', async () => {
  const { app, state, failNextBatch } = createApp();
  await withServer(app, async (baseUrl) => {
    failNextBatch();
    const failedCreate = await request(baseUrl, 'POST', '/api/leasing-contracts', 'office', {
      contractNumber: 'L-FAILED-CREATE',
      leasingCompany: 'Лизинг API',
      startDate: '2026-05-01',
      endDate: '2026-06-30',
      termMonths: 2,
      monthlyPayment: 100000,
      paymentDay: 10,
      schedule: [{ dueDate: '2026-05-10', amount: 100000, status: 'planned' }],
    });
    assert.equal(failedCreate.response.status, 503);
    assert.deepEqual(state.leasing_contracts, []);
    assert.deepEqual(state.leasing_payment_schedule, []);

    const created = await request(baseUrl, 'POST', '/api/leasing-contracts', 'office', {
      contractNumber: 'L-STABLE',
      leasingCompany: 'Лизинг API',
      startDate: '2026-05-01',
      endDate: '2026-06-30',
      termMonths: 2,
      monthlyPayment: 100000,
      paymentDay: 10,
      schedule: [{ dueDate: '2026-05-10', amount: 100000, status: 'planned' }],
    });
    assert.equal(created.response.status, 201);
    const before = structuredClone(state);

    failNextBatch();
    const failedUpdate = await request(baseUrl, 'PATCH', `/api/leasing-contracts/${created.json.id}`, 'office', {
      monthlyPayment: 250000,
      schedule: [{ dueDate: '2026-05-10', amount: 250000, status: 'planned' }],
    });
    assert.equal(failedUpdate.response.status, 503);
    assert.deepEqual(state, before);

    failNextBatch();
    const failedDelete = await request(baseUrl, 'DELETE', `/api/leasing-contracts/${created.json.id}`, 'office');
    assert.equal(failedDelete.response.status, 503);
    assert.deepEqual(state, before);
  });
});
