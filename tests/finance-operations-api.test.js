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
    clients: [],
    gantt_rentals: [],
    payments: [],
    documents: [],
    client_objects: [],
    leasing_contracts: [],
    leasing_payment_schedule: [],
    debt_collection_actions: [],
    receivable_payment_plans: [],
    finance_operations: [],
    finance_accounts: [],
  };
  const users = {
    admin: { userId: 'u-admin', userName: 'Admin', userRole: 'Администратор' },
    office: { userId: 'u-office', userName: 'Office', userRole: 'Офис-менеджер' },
    manager: { userId: 'u-manager', userName: 'Manager', userRole: 'Менеджер по аренде' },
    sales: { userId: 'u-sales', userName: 'Sales', userRole: 'Менеджер по продажам' },
    investor: { userId: 'u-investor', userName: 'Investor', userRole: 'Инвестор' },
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
    if (collection === 'finance_accounts' && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole)) return next();
    if (collection === 'finance_operations' && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole)) return next();
    if (collection === 'payments' && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole)) return next();
    if (['debt_collection_actions', 'receivable_payment_plans'].includes(collection) && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole)) return next();
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  };
  const requireWrite = collection => (req, res, next) => {
    if (collection === 'finance_accounts' && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole)) return next();
    if (collection === 'finance_operations' && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole)) return next();
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
    idPrefixes: { finance_accounts: 'FA', finance_operations: 'FO', debt_collection_actions: 'DCA', receivable_payment_plans: 'RPP' },
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

test('finance operations API creates lists updates and archives manual operations', async () => {
  const { app, state } = createApp();
  await withServer(app, async (baseUrl) => {
    const created = await request(baseUrl, 'POST', '/api/finance/operations', 'office', {
      type: 'expense',
      date: '2026-05-09',
      amount: 12500,
      category: 'Транспорт',
      description: 'Такси до объекта',
      counterparty: 'Водитель',
      account: 'Касса',
      relatedEntityType: 'rental',
      relatedEntityId: 'R-1',
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.json.id, 'FO-1');
    assert.equal(state.finance_operations.length, 1);

    const list = await request(baseUrl, 'GET', '/api/finance/operations?from=2026-05-01&to=2026-05-31', 'office');
    assert.equal(list.response.status, 200);
    assert.equal(list.json.length, 1);
    assert.equal(list.json[0].amount, 12500);

    const updated = await request(baseUrl, 'PATCH', '/api/finance/operations/FO-1', 'admin', {
      amount: 13000,
      category: 'Транспорт',
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.json.amount, 13000);

    const archived = await request(baseUrl, 'PATCH', '/api/finance/operations/FO-1', 'office', {
      status: 'archived',
    });
    assert.equal(archived.response.status, 200);
    assert.equal(archived.json.status, 'archived');
  });
});

test('finance accounts API creates lists updates and transfers balances', async () => {
  const { app, state } = createApp();
  await withServer(app, async (baseUrl) => {
    const empty = await request(baseUrl, 'GET', '/api/finance/accounts', 'office');
    assert.equal(empty.response.status, 200);
    assert.deepEqual(empty.json, []);

    const cash = await request(baseUrl, 'POST', '/api/finance/accounts', 'office', {
      name: 'Касса',
      type: 'cash',
      balance: 50000,
      actualAt: '2026-05-09',
      status: 'active',
    });
    assert.equal(cash.response.status, 201);
    assert.equal(cash.json.id, 'FA-1');
    assert.equal(cash.json.currency, 'RUB');

    const bank = await request(baseUrl, 'POST', '/api/finance/accounts', 'admin', {
      name: 'Расчётный счёт',
      type: 'bank_account',
      currency: 'rub',
      balance: 100000,
      actualAt: '2026-05-09',
      comment: 'Основной',
    });
    assert.equal(bank.response.status, 201);
    assert.equal(bank.json.currency, 'RUB');

    const updated = await request(baseUrl, 'PATCH', '/api/finance/accounts/FA-1', 'office', {
      balance: 55000,
      actualAt: '2026-05-10',
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.json.balance, 55000);

    const transfer = await request(baseUrl, 'POST', '/api/finance/accounts/transfer', 'office', {
      accountFrom: 'FA-2',
      accountTo: 'FA-1',
      amount: 25000,
      date: '2026-05-10',
      comment: 'Пополнение кассы',
    });
    assert.equal(transfer.response.status, 201);
    assert.equal(transfer.json.from.balance, 75000);
    assert.equal(transfer.json.to.balance, 80000);
    assert.equal(transfer.json.operation.type, 'transfer');
    assert.equal(state.finance_operations.length, 1);

    const list = await request(baseUrl, 'GET', '/api/finance/accounts', 'office');
    assert.equal(list.response.status, 200);
    assert.equal(list.json.length, 2);
  });
});

test('finance accounts API validates balance transfer target and RBAC', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const invalidBalance = await request(baseUrl, 'POST', '/api/finance/accounts', 'office', {
      name: 'Карта',
      type: 'card',
      balance: 'не число',
      actualAt: '2026-05-09',
    });
    assert.equal(invalidBalance.response.status, 400);
    assert.match(invalidBalance.json.error, /числом/);

    const deniedList = await request(baseUrl, 'GET', '/api/finance/accounts', 'mechanic');
    assert.equal(deniedList.response.status, 403);

    const deniedCreate = await request(baseUrl, 'POST', '/api/finance/accounts', 'mechanic', {
      name: 'Касса',
      type: 'cash',
      balance: 1,
      actualAt: '2026-05-09',
    });
    assert.equal(deniedCreate.response.status, 403);

    await request(baseUrl, 'POST', '/api/finance/accounts', 'office', {
      name: 'Касса',
      type: 'cash',
      balance: 1000,
      actualAt: '2026-05-09',
    });
    const same = await request(baseUrl, 'POST', '/api/finance/accounts/transfer', 'office', {
      accountFrom: 'FA-1',
      accountTo: 'FA-1',
      amount: 100,
      date: '2026-05-10',
    });
    assert.equal(same.response.status, 400);
    assert.match(same.json.error, /тот же счёт/);
  });
});

test('finance operations API validates amount and transfer accounts', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const zero = await request(baseUrl, 'POST', '/api/finance/operations', 'office', {
      type: 'income',
      date: '2026-05-09',
      amount: 0,
      category: 'Оплата клиента',
    });
    assert.equal(zero.response.status, 400);

    const sameAccount = await request(baseUrl, 'POST', '/api/finance/operations', 'office', {
      type: 'transfer',
      date: '2026-05-09',
      amount: 1000,
      category: 'Перевод',
      accountFrom: 'Касса',
      accountTo: 'Касса',
    });
    assert.equal(sameAccount.response.status, 400);
    assert.match(sameAccount.json.error, /тот же счёт/);
  });
});

test('finance operations API denies roles without finance management access', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const list = await request(baseUrl, 'GET', '/api/finance/operations', 'mechanic');
    assert.equal(list.response.status, 403);

    const create = await request(baseUrl, 'POST', '/api/finance/operations', 'mechanic', {
      type: 'expense',
      date: '2026-05-09',
      amount: 1000,
      category: 'Прочее',
    });
    assert.equal(create.response.status, 403);
  });
});

test('finance endpoints do not expose amounts to roles without finance access', async () => {
  const { app } = createApp();
  const deniedPaths = [
    '/api/finance/operations',
    '/api/finance/accounts',
    '/api/finance/debt-rows',
    '/api/finance/clients',
    '/api/finance/client-snapshots',
    '/api/finance/managers',
    '/api/finance/manager-breakdown?manager=Office',
    '/api/finance/aging',
    '/api/finance/report',
    '/api/finance/receivables',
    '/api/finance/receivables/summary',
  ];
  await withServer(app, async (baseUrl) => {
    for (const token of ['manager', 'sales', 'mechanic', 'investor']) {
      for (const path of deniedPaths) {
        const denied = await request(baseUrl, 'GET', path, token);
        assert.equal(denied.response.status, 403, `${token} should not read ${path}`);
      }
    }
  });
});
