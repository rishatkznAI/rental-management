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
    counterparties: [],
    clients: [],
    rentals: [],
    gantt_rentals: [],
    payments: [],
    payment_allocations: [],
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
    if (collection === 'payments' && ['Администратор', 'Офис-менеджер', 'Менеджер по аренде', 'Менеджер по продажам'].includes(req.user?.userRole)) return next();
    if (['debt_collection_actions', 'receivable_payment_plans'].includes(collection) && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole)) return next();
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  };
  const requireWrite = collection => (req, res, next) => {
    if (collection === 'finance_accounts' && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole)) return next();
    if (collection === 'finance_operations' && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole)) return next();
    if (collection === 'payment_allocations' && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole)) return next();
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
  ];
  await withServer(app, async (baseUrl) => {
    for (const token of ['manager', 'sales', 'mechanic', 'investor']) {
      for (const path of deniedPaths) {
        const denied = await request(baseUrl, 'GET', path, token);
        assert.equal(denied.response.status, 403, `${token} should not read ${path}`);
      }
    }
    for (const token of ['manager', 'sales']) {
      const receivables = await request(baseUrl, 'GET', '/api/finance/receivables', token);
      assert.equal(receivables.response.status, 200, `${token} should read scoped receivables`);
      const summary = await request(baseUrl, 'GET', '/api/finance/receivables/summary', token);
      assert.equal(summary.response.status, 200, `${token} should read scoped receivables summary`);
    }
    for (const token of ['mechanic', 'investor']) {
      const receivables = await request(baseUrl, 'GET', '/api/finance/receivables', token);
      assert.equal(receivables.response.status, 403, `${token} should not read receivables`);
      const summary = await request(baseUrl, 'GET', '/api/finance/receivables/summary', token);
      assert.equal(summary.response.status, 403, `${token} should not read receivables summary`);
    }
  });
});

test('payment allocation preview is read-only and apply caps allocations by payment amount', async () => {
  const { app, state } = createApp();
  state.counterparties = [{ id: 'CP-1', legalName: 'Клиент', shortName: 'Клиент', roles: ['customer'], status: 'active' }];
  state.clients = [{ id: 'c-1', counterpartyId: 'CP-1', company: 'Клиент' }];
  state.rentals = [
    { id: 'classic-1', clientId: 'c-1', counterpartyId: 'CP-1' },
    { id: 'classic-2', clientId: 'c-1', counterpartyId: 'CP-1' },
  ];
  state.gantt_rentals = [
    { id: 'r-1', rentalId: 'classic-1', clientId: 'c-1', counterpartyId: 'CP-1', contractId: 'ct-1', objectId: 'o-1', client: 'Клиент', equipmentInv: '1', manager: 'Руслан', startDate: '2026-05-01', endDate: '2026-05-10', amount: 100000, status: 'active' },
    { id: 'r-2', rentalId: 'classic-2', clientId: 'c-1', counterpartyId: 'CP-1', contractId: 'ct-1', objectId: 'o-2', client: 'Клиент', equipmentInv: '2', manager: 'Анна', startDate: '2026-05-01', endDate: '2026-05-10', amount: 100000, status: 'active' },
  ];
  state.payments = [{ id: 'p-1', clientId: 'c-1', contractId: 'ct-1', amount: 120000, paidAmount: 150000, status: 'paid' }];

  await withServer(app, async (baseUrl) => {
    const preview = await request(baseUrl, 'POST', '/api/finance/payments/p-1/allocation-preview', 'office', {});
    assert.equal(preview.response.status, 200);
    assert.equal(preview.json.unallocatedAmount, 120000);
    assert.equal(state.payment_allocations.length, 0);

    const applied = await request(baseUrl, 'POST', '/api/finance/payments/p-1/apply-allocation-preview', 'office', {
      allocations: [
        { rentalId: 'r-1', clientId: 'c-1', contractId: 'ct-1', objectId: 'o-1', amount: 100000 },
        { rentalId: 'r-2', clientId: 'c-1', contractId: 'ct-1', objectId: 'o-2', amount: 100000 },
      ],
    });
    assert.equal(applied.response.status, 201);
    assert.equal(applied.json.allocations.reduce((sum, item) => sum + item.amount, 0), 120000);
    assert.equal(state.payment_allocations.reduce((sum, item) => sum + item.amount, 0), 120000);
  });
});

test('payment allocation preview apply validates documentId before creating allocations', async () => {
  const { app, state } = createApp();
  state.counterparties = [{ id: 'CP-1', legalName: 'Клиент', shortName: 'Клиент', roles: ['customer'], status: 'active' }];
  state.clients = [{ id: 'c-1', counterpartyId: 'CP-1', company: 'Клиент' }];
  state.rentals = [{ id: 'classic-1', clientId: 'c-1', counterpartyId: 'CP-1' }];
  state.gantt_rentals = [
    { id: 'r-1', rentalId: 'classic-1', clientId: 'c-1', counterpartyId: 'CP-1', contractId: 'ct-1', objectId: 'o-1', client: 'Клиент', equipmentInv: '1', manager: 'Руслан', startDate: '2026-05-01', endDate: '2026-05-10', amount: 100000, status: 'active' },
  ];
  state.payments = [{ id: 'p-1', clientId: 'c-1', contractId: 'ct-1', amount: 100000, paidAmount: 100000, status: 'paid' }];
  state.documents = [{ id: 'd-1', clientId: 'c-1', rentalId: 'r-1', type: 'invoice' }];

  await withServer(app, async (baseUrl) => {
    const missingDocument = await request(baseUrl, 'POST', '/api/finance/payments/p-1/apply-allocation-preview', 'office', {
      allocations: [
        { rentalId: 'r-1', clientId: 'c-1', contractId: 'ct-1', objectId: 'o-1', documentId: 'd-missing', amount: 1000 },
      ],
    });
    assert.equal(missingDocument.response.status, 400);
    assert.match(missingDocument.json.error, /Invalid allocation documentId/);
    assert.equal(state.payment_allocations.length, 0);

    const validDocument = await request(baseUrl, 'POST', '/api/finance/payments/p-1/apply-allocation-preview', 'office', {
      allocations: [
        { rentalId: 'r-1', clientId: 'c-1', contractId: 'ct-1', objectId: 'o-1', documentId: 'd-1', amount: 1000 },
      ],
    });
    assert.equal(validDocument.response.status, 201);
    assert.equal(validDocument.json.allocations.length, 1);
    assert.equal(validDocument.json.allocations[0].documentId, 'd-1');
    assert.equal(state.payment_allocations.length, 1);
  });
});

function seedCounterpartyAllocationState(state) {
  state.counterparties = [
    { id: 'CP-A', legalName: 'Одинаковое имя', shortName: 'Одинаковое имя', roles: ['customer'], status: 'active' },
    { id: 'CP-B', legalName: 'Одинаковое имя', shortName: 'Одинаковое имя', roles: ['customer'], status: 'active' },
  ];
  state.clients = [
    { id: 'C-A', counterpartyId: 'CP-A', company: 'Одинаковое имя' },
    { id: 'C-B', counterpartyId: 'CP-B', company: 'Одинаковое имя' },
  ];
  state.rentals = [
    { id: 'classic-a', counterpartyId: 'CP-A' },
    { id: 'classic-a-legacy', clientId: 'C-A' },
    { id: 'classic-b', counterpartyId: 'CP-B' },
    { id: 'classic-dual', counterpartyId: 'CP-A' },
    { id: 'classic-unresolved' },
  ];
  const rentalBase = {
    objectId: 'object-1',
    client: 'Одинаковое имя',
    equipmentInv: '1',
    manager: 'Менеджер',
    startDate: '2026-05-01',
    endDate: '2026-05-10',
    amount: 10000,
    status: 'active',
  };
  state.gantt_rentals = [
    { ...rentalBase, id: 'r-a', rentalId: 'classic-a', counterpartyId: 'CP-A' },
    { ...rentalBase, id: 'r-a-legacy', rentalId: 'classic-a-legacy', clientId: 'C-A' },
    { ...rentalBase, id: 'r-b', rentalId: 'classic-b', counterpartyId: 'CP-B' },
    { ...rentalBase, id: 'r-dual', rentalId: 'classic-dual', clientId: 'C-B', counterpartyId: 'CP-A' },
    { ...rentalBase, id: 'r-unresolved', rentalId: 'classic-unresolved' },
  ];
  state.payments = [
    { id: 'p-direct', counterpartyId: 'CP-A', amount: 100000, paidAmount: 100000, status: 'paid' },
    { id: 'p-legacy', clientId: 'C-A', amount: 100000, paidAmount: 100000, status: 'paid' },
    { id: 'p-dual', clientId: 'C-B', counterpartyId: 'CP-A', amount: 100000, paidAmount: 100000, status: 'paid' },
    { id: 'p-unresolved', client: 'Одинаковое имя', amount: 100000, paidAmount: 100000, status: 'paid' },
    { id: 'p-batch', counterpartyId: 'CP-A', amount: 100000, paidAmount: 100000, status: 'paid' },
  ];
}

test('allocation preview uses canonical Counterparty identity for direct and legacy relations', async () => {
  const { app, state } = createApp();
  seedCounterpartyAllocationState(state);

  await withServer(app, async (baseUrl) => {
    const direct = await request(baseUrl, 'POST', '/api/finance/payments/p-direct/allocation-preview', 'office', {});
    assert.equal(direct.response.status, 200);
    assert.deepEqual(direct.json.suggestedAllocations.map(item => item.rentalId), ['r-a', 'r-a-legacy']);
    assert.equal(state.payment_allocations.length, 0);

    const legacy = await request(baseUrl, 'POST', '/api/finance/payments/p-legacy/allocation-preview', 'office', {});
    assert.equal(legacy.response.status, 200);
    assert.deepEqual(legacy.json.suggestedAllocations.map(item => item.rentalId), ['r-a', 'r-a-legacy']);

    const appliedDirect = await request(baseUrl, 'POST', '/api/finance/payments/p-direct/apply-allocation-preview', 'office', {
      allocations: [{ rentalId: 'r-a', amount: 1000 }],
    });
    assert.equal(appliedDirect.response.status, 201);

    const appliedLegacy = await request(baseUrl, 'POST', '/api/finance/payments/p-legacy/apply-allocation-preview', 'office', {
      allocations: [{ rentalId: 'r-a-legacy', amount: 1000 }],
    });
    assert.equal(appliedLegacy.response.status, 201);
  });
});

test('allocation preview and crafted apply fail closed for foreign or unresolved identity', async () => {
  const { app, state } = createApp();
  seedCounterpartyAllocationState(state);

  await withServer(app, async (baseUrl) => {
    const beforeForeign = financeCore.buildRentalDebtRows(state.gantt_rentals, state.payments, {
      paymentAllocations: state.payment_allocations,
    }).find(row => row.rentalId === 'r-b');
    const foreign = await request(baseUrl, 'POST', '/api/finance/payments/p-direct/apply-allocation-preview', 'office', {
      allocations: [{ rentalId: 'r-b', amount: 1000 }],
    });
    assert.equal(foreign.response.status, 409);
    assert.match(foreign.json.error, /different counterparties/);
    assert.equal(state.payment_allocations.length, 0);
    const afterForeign = financeCore.buildRentalDebtRows(state.gantt_rentals, state.payments, {
      paymentAllocations: state.payment_allocations,
    }).find(row => row.rentalId === 'r-b');
    assert.equal(afterForeign.paidAmount, beforeForeign.paidAmount);
    assert.equal(afterForeign.outstanding, beforeForeign.outstanding);

    const missingRental = await request(baseUrl, 'POST', '/api/finance/payments/p-direct/apply-allocation-preview', 'office', {
      allocations: [{ amount: 1000 }],
    });
    assert.equal(missingRental.response.status, 409);
    assert.equal(missingRental.json.code, 'COUNTERPARTY_RELATION_ID_REQUIRED');
    assert.equal(state.payment_allocations.length, 0);

    const unknownRental = await request(baseUrl, 'POST', '/api/finance/payments/p-direct/apply-allocation-preview', 'office', {
      allocations: [{ rentalId: 'r-missing', amount: 1000 }],
    });
    assert.equal(unknownRental.response.status, 409);
    assert.equal(unknownRental.json.code, 'COUNTERPARTY_RELATION_ENDPOINT_NOT_FOUND');
    assert.equal(state.payment_allocations.length, 0);

    const unresolvedPaymentPreview = await request(baseUrl, 'POST', '/api/finance/payments/p-unresolved/allocation-preview', 'office', {});
    assert.equal(unresolvedPaymentPreview.response.status, 400);
    const unresolvedPaymentApply = await request(baseUrl, 'POST', '/api/finance/payments/p-unresolved/apply-allocation-preview', 'office', {
      allocations: [{ rentalId: 'r-a', amount: 1000 }],
    });
    assert.equal(unresolvedPaymentApply.response.status, 400);

    const unresolvedRental = await request(baseUrl, 'POST', '/api/finance/payments/p-direct/apply-allocation-preview', 'office', {
      allocations: [{ rentalId: 'r-unresolved', amount: 1000 }],
    });
    assert.equal(unresolvedRental.response.status, 400);

    const paymentMismatch = await request(baseUrl, 'POST', '/api/finance/payments/p-dual/apply-allocation-preview', 'office', {
      allocations: [{ rentalId: 'r-a', amount: 1000 }],
    });
    assert.equal(paymentMismatch.response.status, 409);

    const rentalMismatch = await request(baseUrl, 'POST', '/api/finance/payments/p-direct/apply-allocation-preview', 'office', {
      allocations: [{ rentalId: 'r-dual', amount: 1000 }],
    });
    assert.equal(rentalMismatch.response.status, 409);
    assert.equal(state.payment_allocations.length, 0);
  });
});

test('allocation apply validates the whole batch before the first write', async () => {
  const { app, state } = createApp();
  seedCounterpartyAllocationState(state);
  const before = financeCore.buildRentalDebtRows(state.gantt_rentals, state.payments, {
    paymentAllocations: state.payment_allocations,
  }).find(row => row.rentalId === 'r-a');

  await withServer(app, async (baseUrl) => {
    const result = await request(baseUrl, 'POST', '/api/finance/payments/p-batch/apply-allocation-preview', 'office', {
      allocations: [
        { rentalId: 'r-a', amount: 1000 },
        { rentalId: 'r-b', amount: 1000 },
      ],
    });
    assert.equal(result.response.status, 409);
    assert.equal(state.payment_allocations.length, 0);
    const after = financeCore.buildRentalDebtRows(state.gantt_rentals, state.payments, {
      paymentAllocations: state.payment_allocations,
    }).find(row => row.rentalId === 'r-a');
    assert.equal(after.paidAmount, before.paidAmount);
    assert.equal(after.outstanding, before.outstanding);
  });
});
