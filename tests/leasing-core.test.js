import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeLeasingContract,
  buildLeasingSummary,
  decorateLeasingContract,
  isLeasingContractFinanciallyActive,
} = require('../server/lib/leasing-core.js');

test('leasing contract normalizes safe numeric fields and calculates totals', () => {
  const contract = normalizeLeasingContract({
    id: 'LC-1',
    contractNumber: 'L-001',
    leasingCompany: 'Лизинг Плюс',
    startDate: '2026-05-01',
    endDate: '2027-04-30',
    termMonths: '12',
    monthlyPayment: '100000',
    paymentDay: '15',
    initialPayment: '',
    buyoutPayment: '50000',
  }, null, { nowIso: '2026-05-09T10:00:00.000Z' });

  assert.equal(contract.monthlyPayment, 100000);
  assert.equal(contract.initialPayment, 0);
  assert.equal(contract.buyoutPayment, 50000);
  assert.equal(contract.totalAmount, 1250000);
  assert.equal(contract.remainingAmount, 1250000);
});

test('leasing contract rejects invalid dates and NaN-like numbers safely', () => {
  assert.throws(() => normalizeLeasingContract({
    id: 'LC-2',
    contractNumber: 'L-002',
    leasingCompany: 'Лизинг Плюс',
    startDate: '2026-06-01',
    endDate: '2026-05-01',
    termMonths: 12,
    monthlyPayment: 100,
    paymentDay: 10,
  }), /Дата окончания/);

  const contract = normalizeLeasingContract({
    id: 'LC-3',
    contractNumber: 'L-003',
    leasingCompany: 'Лизинг Плюс',
    startDate: '2026-05-01',
    endDate: '2026-12-31',
    termMonths: 8,
    monthlyPayment: 'not-a-number',
    paymentDay: 10,
  });
  assert.equal(contract.monthlyPayment, 0);
});

test('leasing summary calculates current month next month remaining and overdue load only for financially active contracts', () => {
  const active = normalizeLeasingContract({
    id: 'LC-active',
    contractNumber: 'L-active',
    leasingCompany: 'Лизинг Плюс',
    startDate: '2026-05-01',
    endDate: '2026-08-31',
    termMonths: 4,
    monthlyPayment: 100000,
    paymentDay: 10,
  });
  const closed = normalizeLeasingContract({
    id: 'LC-closed',
    contractNumber: 'L-closed',
    leasingCompany: 'Архив Лизинг',
    startDate: '2026-05-01',
    endDate: '2026-08-31',
    termMonths: 4,
    monthlyPayment: 999999,
    paymentDay: 10,
    status: 'closed',
  });
  const paused = normalizeLeasingContract({
    id: 'LC-paused',
    contractNumber: 'L-paused',
    leasingCompany: 'Пауза Лизинг',
    startDate: '2026-05-01',
    endDate: '2026-08-31',
    termMonths: 4,
    monthlyPayment: 777777,
    paymentDay: 10,
    status: 'paused',
  });
  const archived = normalizeLeasingContract({
    id: 'LC-archived',
    contractNumber: 'L-archived',
    leasingCompany: 'Архив Лизинг',
    startDate: '2026-05-01',
    endDate: '2026-08-31',
    termMonths: 4,
    monthlyPayment: 888888,
    paymentDay: 10,
    status: 'archived',
  });

  const summary = buildLeasingSummary([active, closed, paused, archived], [], '2026-05-09');
  assert.equal(isLeasingContractFinanciallyActive(active), true);
  assert.equal(isLeasingContractFinanciallyActive(paused), false);
  assert.equal(isLeasingContractFinanciallyActive(closed), false);
  assert.equal(isLeasingContractFinanciallyActive(archived), false);
  assert.equal(summary.activeContracts, 1);
  assert.equal(summary.pausedContracts, 1);
  assert.equal(summary.currentMonthAmount, 100000);
  assert.equal(summary.nextMonthAmount, 100000);
  assert.equal(summary.remainingAmount, 400000);
});

test('paused leasing contract remains visible but does not create financial load or overdue from schedule', () => {
  const paused = normalizeLeasingContract({
    id: 'LC-paused-overdue',
    contractNumber: 'L-paused-overdue',
    leasingCompany: 'Пауза Лизинг',
    startDate: '2026-04-01',
    endDate: '2026-08-31',
    termMonths: 5,
    monthlyPayment: 100000,
    paymentDay: 5,
    status: 'paused',
  });
  const schedule = [{
    id: 'LPS-paused-1',
    leasingContractId: paused.id,
    dueDate: '2026-04-05',
    amount: 100000,
    status: 'planned',
    paidAmount: 0,
  }];

  const decorated = decorateLeasingContract(paused, schedule, '2026-05-09');
  const summary = buildLeasingSummary([paused], schedule, '2026-05-09');
  assert.equal(decorated.status, 'paused');
  assert.equal(decorated.schedule[0].status, 'planned');
  assert.equal(decorated.overdueAmount, 0);
  assert.equal(summary.contracts.length, 1);
  assert.equal(summary.pausedContracts, 1);
  assert.equal(summary.activeContracts, 0);
  assert.equal(summary.currentMonthAmount, 0);
  assert.equal(summary.nextMonthAmount, 0);
  assert.equal(summary.overdueAmount, 0);
  assert.equal(summary.remainingAmount, 0);
  assert.equal(summary.averageMonthlyLoad, 0);
});

test('leasing overdue payment is detected and exposed on decorated contract', () => {
  const contract = normalizeLeasingContract({
    id: 'LC-overdue',
    contractNumber: 'L-overdue',
    leasingCompany: 'Лизинг Плюс',
    startDate: '2026-05-01',
    endDate: '2026-08-31',
    termMonths: 4,
    monthlyPayment: 100000,
    paymentDay: 5,
  });

  const decorated = decorateLeasingContract(contract, [], '2026-05-09');
  assert.equal(decorated.status, 'overdue');
  assert.equal(decorated.overduePayments, 1);
  assert.equal(decorated.overdueAmount, 100000);
  assert.equal(decorated.nextPayment?.dueDate, '2026-06-05');
});
