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

test('finance core exports company economics builder for production route wiring', () => {
  assert.equal(typeof financeCore.buildCompanyEconomics, 'function');
});

function createApp() {
  const state = {
    equipment: [
      {
        id: 'eq-1',
        manufacturer: 'Mantall',
        model: 'XE140W',
        inventoryNumber: '061',
        status: 'rented',
        activeInFleet: true,
        finance: { monthlyDepreciation: 1000, purchasePrice: 100000, residualValue: 90000 },
      },
      {
        id: 'eq-2',
        manufacturer: 'Dingli',
        model: 'JCPT',
        inventoryNumber: '062',
        status: 'available',
        activeInFleet: true,
      },
    ],
    equipment_finance: [],
    rentals: [
      {
        id: 'r-1',
        clientId: 'c-1',
        client: 'ООО Альфа',
        startDate: '2026-05-01',
        plannedReturnDate: '2026-05-10',
        equipmentId: 'eq-1',
        equipmentInv: '061',
        price: 10000,
        status: 'active',
      },
    ],
    gantt_rentals: [
      {
        id: 'g-1',
        rentalId: 'r-1',
        sourceRentalId: 'r-1',
        clientId: 'c-1',
        client: 'ООО Альфа',
        startDate: '2026-05-01',
        endDate: '2026-05-10',
        equipmentId: 'eq-1',
        equipmentInv: '061',
        amount: 10000,
        status: 'active',
      },
    ],
    payments: [
      { id: 'p-1', rentalId: 'r-1', clientId: 'c-1', client: 'ООО Альфа', amount: 5000, paidAmount: 5000, status: 'paid', paidDate: '2026-05-05' },
    ],
    payment_allocations: [],
    company_expenses: [
      { id: 'ce-1', name: 'Офис', category: 'Аренда', amount: 2000, frequency: 'monthly', status: 'active' },
    ],
    leasing_payment_schedule: [
      { id: 'lp-1', leasingContractId: 'lc-1', dueDate: '2026-05-15', amount: 3000, status: 'planned' },
    ],
    service: [
      {
        id: 's-1',
        equipmentId: 'eq-1',
        equipment: 'Mantall',
        status: 'closed',
        createdAt: '2026-05-06T10:00:00.000Z',
        resultData: { partsUsed: [{ name: 'Фильтр', qty: 1, cost: 500 }], worksPerformed: [{ name: 'Работа', totalCost: 700 }] },
      },
    ],
    repair_work_items: [],
    repair_part_items: [],
    deliveries: [],
    finance_operations: [],
  };
  const users = {
    admin: { userId: 'u-admin', userName: 'Admin', userRole: 'Администратор' },
    office: { userId: 'u-office', userName: 'Office', userRole: 'Офис-менеджер' },
    mechanic: { userId: 'u-mechanic', userName: 'Mechanic', userRole: 'Механик' },
  };
  const readData = name => state[name] || [];
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
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  };
  registerFinanceRoutes(router, {
    requireAuth,
    requireRead,
    requireWrite: () => (_req, res) => res.status(403).json({ ok: false, error: 'Forbidden' }),
    readData,
    writeData: (name, value) => { state[name] = value; },
    accessControl,
    generateId: prefix => `${prefix}-1`,
    getEffectivePaidAmount: financeCore.getEffectivePaidAmount,
    getRentalDebtOverdueDays: financeCore.getRentalDebtOverdueDays,
    buildRentalDebtRows: financeCore.buildRentalDebtRows,
    buildClientReceivables: financeCore.buildClientReceivables,
    buildClientFinancialSnapshots: financeCore.buildClientFinancialSnapshots,
    buildManagerReceivables: financeCore.buildManagerReceivables,
    buildOverdueBuckets: financeCore.buildOverdueBuckets,
    buildFinanceReport: financeCore.buildFinanceReport,
    buildCompanyEconomics: financeCore.buildCompanyEconomics,
    buildReceivables: receivablesCore.buildReceivables,
    normalizeAction: receivablesCore.normalizeAction,
    normalizePaymentPlan: receivablesCore.normalizePaymentPlan,
    validateStageTransition: receivablesCore.validateStageTransition,
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

async function request(baseUrl, token = 'office') {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const response = await fetch(`${baseUrl}/api/finance/economics?dateFrom=2026-05-01&dateTo=2026-05-31&groupBy=month&includeDepreciation=true`, { headers });
  const json = await response.json().catch(() => null);
  return { response, json };
}

test('finance and admin can access company economics endpoint', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    assert.equal((await request(baseUrl, 'office')).response.status, 200);
    assert.equal((await request(baseUrl, 'admin')).response.status, 200);
  });
});

test('company economics endpoint rejects forbidden and unauthenticated roles', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    assert.equal((await request(baseUrl, 'mechanic')).response.status, 403);
    assert.equal((await request(baseUrl, '')).response.status, 401);
  });
});

test('company economics summary shape is stable and separates depreciation from cash flow', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const { response, json } = await request(baseUrl, 'office');
    assert.equal(response.status, 200);
    for (const key of [
      'revenueTotal',
      'cashInTotal',
      'directExpensesTotal',
      'serviceExpensesTotal',
      'deliveryExpensesTotal',
      'leasingExpensesTotal',
      'companyExpensesTotal',
      'depreciationTotal',
      'profitBeforeDepreciation',
      'profitAfterDepreciation',
      'marginBeforeDepreciationPercent',
      'marginAfterDepreciationPercent',
      'paybackProgressPercent',
      'equipmentCount',
      'profitableEquipmentCount',
      'lossMakingEquipmentCount',
      'notConfiguredDepreciationCount',
    ]) {
      assert.ok(Object.hasOwn(json.summary, key), `missing summary.${key}`);
    }
    assert.equal(json.summary.revenueTotal, 10000);
    assert.equal(json.summary.cashInTotal, 5000);
    assert.equal(json.summary.depreciationTotal, 1000);
    assert.equal(json.summary.profitAfterDepreciation, json.summary.profitBeforeDepreciation - json.summary.depreciationTotal);
    assert.equal(Object.hasOwn(json.summary, 'cashFlowTotal'), false);
  });
});

test('company economics marks missing depreciation and does not duplicate rentals with gantt rows', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const { json } = await request(baseUrl, 'office');
    assert.equal(json.summary.revenueTotal, 10000);
    const missing = json.equipment.find(item => item.label.includes('Dingli'));
    assert.equal(missing.status, 'not_configured');
    assert.match(json.warnings.map(item => item.message).join('\n'), /Амортизация не настроена/);
  });
});

test('company economics response is presentation-safe', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const { json } = await request(baseUrl, 'office');
    const payload = JSON.stringify(json);
    assert.doesNotMatch(payload, /undefined|\[object Object\]/);
    assert.doesNotMatch(payload, /password|token|secret|credential|DB_PATH|APP_DISABLED/i);
  });
});
