import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildReceivables,
  normalizeAction,
  normalizePaymentPlan,
} = require('../server/lib/receivables-core.js');

const clients = [
  { id: 'c-1', company: 'ООО Вектор', inn: '7701000000', contact: 'Иван', phone: '+7999', manager: 'Мария' },
  { id: 'c-2', company: 'ООО Старт', manager: 'Олег' },
];

const rentals = [
  {
    id: 'r-1',
    clientId: 'c-1',
    client: 'Старое имя',
    equipmentInv: 'A-1',
    manager: 'Мария',
    startDate: '2026-03-01',
    endDate: '2026-03-10',
    expectedPaymentDate: '2026-03-15',
    amount: 100000,
    status: 'closed',
  },
  {
    id: 'r-2',
    clientId: 'c-1',
    client: 'ООО Вектор',
    equipmentInv: 'A-2',
    manager: 'Мария',
    startDate: '2026-05-01',
    endDate: '2026-05-20',
    expectedPaymentDate: '2026-05-08',
    amount: 50000,
    status: 'active',
  },
  {
    id: 'r-3',
    clientId: 'c-2',
    client: 'ООО Старт',
    equipmentInv: 'B-1',
    manager: 'Олег',
    startDate: '2026-04-01',
    endDate: '2026-04-20',
    expectedPaymentDate: '2026-04-25',
    amount: 70000,
    status: 'active',
  },
];

test('buildReceivables groups debts by stable client id and computes aging', () => {
  const result = buildReceivables({
    clients,
    rentals,
    payments: [
      { id: 'p-1', rentalId: 'r-1', clientId: 'c-1', amount: 100000, paidAmount: 40000, status: 'partial' },
      { id: 'p-2', rentalId: 'r-2', clientId: 'c-1', amount: 50000, paidAmount: 50000, status: 'paid' },
    ],
    documents: [{ id: 'd-1', clientId: 'c-1', type: 'upd', number: '42', amount: 100000 }],
    actions: [],
    paymentPlans: [],
  }, '2026-05-09');

  const vector = result.rows.find(row => row.clientId === 'c-1');
  assert.ok(vector);
  assert.equal(vector.client, 'ООО Вектор');
  assert.equal(vector.totalDebt, 60000);
  assert.equal(vector.overdueDebt, 60000);
  assert.equal(vector.oldestOverdueDays, 55);
  assert.equal(vector.documents.length, 1);
  assert.equal(result.summary.totalDebt, 130000);
  assert.equal(result.summary.age31_60, 60000);
  assert.equal(result.summary.age8_30, 70000);
});

test('buildReceivables derives promise, plan and no-next-action workflow flags', () => {
  const result = buildReceivables({
    clients,
    rentals,
    payments: [],
    documents: [],
    actions: [
      {
        id: 'a-1',
        clientId: 'c-1',
        actionType: 'payment_promise',
        status: 'done',
        actionDate: '2026-05-01',
        promisedPaymentDate: '2026-05-05',
        promisedAmount: 50000,
      },
      {
        id: 'a-2',
        clientId: 'c-2',
        actionType: 'call',
        status: 'planned',
        actionDate: '2026-05-01',
        nextActionDate: '2026-05-02',
      },
    ],
    paymentPlans: [{ id: 'pp-1', clientId: 'c-2', paymentDate: '2026-05-20', amount: 30000, status: 'planned' }],
  }, '2026-05-09');

  const vector = result.rows.find(row => row.clientId === 'c-1');
  const start = result.rows.find(row => row.clientId === 'c-2');
  assert.equal(vector.collectionStatus, 'overdue_promise');
  assert.equal(vector.promisedAmount, 50000);
  assert.equal(start.collectionStatus, 'payment_plan');
  assert.equal(start.missedActions, 1);
  assert.equal(result.summary.paymentPlanAmount, 30000);
});

test('normalizeAction and normalizePaymentPlan validate workflow writes', () => {
  const context = {
    generateId: prefix => `${prefix}-1`,
    idPrefix: 'T',
    nowIso: () => '2026-05-09T12:00:00.000Z',
    userName: 'Office',
  };
  const action = normalizeAction({ clientId: 'c-1', actionType: 'call', nextActionDate: '2026-05-10' }, null, context);
  assert.equal(action.id, 'T-1');
  assert.equal(action.status, 'planned');

  const plan = normalizePaymentPlan({ clientId: 'c-1', paymentDate: '2026-05-20', amount: 10000 }, null, context);
  assert.equal(plan.amount, 10000);
  assert.equal(plan.status, 'planned');

  assert.throws(() => normalizeAction({ actionType: 'bad' }, null, context), /Некорректный тип/);
  assert.throws(() => normalizePaymentPlan({ paymentDate: '2026-05-20', amount: 0 }, null, context), /сумму/);
});
