import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDebtCollectionDashboardSummary,
  buildDebtCollectionRows,
  debtCollectionActionLabel,
  debtCollectionPriorityLabel,
  debtCollectionStatusLabel,
  isDebtCollectionActionOverdue,
} from '../src/app/lib/debtCollectionPlans.js';

test('debt collection helper formats labels and detects overdue actions', () => {
  const plan = {
    status: 'promised',
    priority: 'critical',
    nextActionType: 'call',
    nextActionDate: '2026-05-01',
  };
  assert.equal(debtCollectionStatusLabel(plan.status), 'Обещал оплатить');
  assert.equal(debtCollectionPriorityLabel(plan.priority), 'Критичный');
  assert.equal(debtCollectionActionLabel(plan.nextActionType), 'Позвонить');
  assert.equal(isDebtCollectionActionOverdue(plan, '2026-05-02'), true);
});

test('buildDebtCollectionRows handles legacy empty values without NaN undefined null', () => {
  const rows = buildDebtCollectionRows({
    today: '2026-05-02',
    clientDebtRows: [
      {
        clientId: 'C-1',
        client: 'ООО Должник',
        manager: '',
        debt: '100000',
        rentals: 1,
        overdueRentals: 1,
        maxOverdueDays: 45,
        ageBucketLabel: '31-60 дней',
        hasActiveRental: true,
      },
      {
        clientId: undefined,
        client: undefined,
        debt: Number.NaN,
        rentals: undefined,
        overdueRentals: undefined,
        maxOverdueDays: undefined,
      },
    ],
    plans: [{ id: 'DCP-1', clientId: 'C-1', clientName: 'ООО Должник', status: 'new', priority: 'high', nextActionType: 'call' }],
  });

  assert.equal(rows[0].client, 'ООО Должник');
  assert.equal(rows[0].hasPlan, true);
  assert.equal(rows[0].debt, 100000);
  assert.equal(rows[0].needsPlan, false);
  assert.doesNotMatch(JSON.stringify(rows), /NaN|undefined|null/);
});

test('dashboard summary counts promised today, overdue actions and missing plans', () => {
  const summary = buildDebtCollectionDashboardSummary({
    today: '2026-05-02',
    clientDebtRows: [
      { clientId: 'C-1', client: 'ООО 1', debt: 100, rentals: 1, overdueRentals: 1, maxOverdueDays: 35 },
      { clientId: 'C-2', client: 'ООО 2', debt: 200, rentals: 1, overdueRentals: 1, maxOverdueDays: 70 },
    ],
    plans: [
      { id: 'DCP-2', clientId: 'C-2', clientName: 'ООО 2', status: 'promised', priority: 'critical', nextActionType: 'call', nextActionDate: '2026-05-01', promisedPaymentDate: '2026-05-02' },
    ],
  });
  assert.equal(summary.overdueActions, 1);
  assert.equal(summary.promisedToday, 1);
  assert.equal(summary.withoutPlan30Plus, 1);
  assert.equal(summary.highPriority, 1);
});
