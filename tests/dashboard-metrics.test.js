import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dashboardSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/pages/Dashboard.tsx'),
  'utf8',
);

const kpiModalSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/components/modals/KPIDetailModal.tsx'),
  'utf8',
);

function objectBlockAfter(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `marker not found: ${marker}`);
  const nextObject = source.indexOf('},', start);
  assert.notEqual(nextObject, -1, `object end not found after: ${marker}`);
  return source.slice(start, nextObject);
}

test('dashboard overdue receivables cards use overdue debt, not total client debt', () => {
  assert.match(dashboardSource, /const overdueReceivablesAmount = overduePayments\.reduce/);
  assert.match(dashboardSource, /const totalDebt = clientFinancials\.reduce/);

  for (const marker of ["id: 'admin-debt'", "id: 'office-debt'", "id: 'overdue-debt'"]) {
    const block = objectBlockAfter(dashboardSource, marker);
    assert.match(block, /title: 'Просроченная дебиторка'|label: 'Просроченная дебиторка'/);
    assert.match(block, /overdueReceivablesAmount/);
    assert.doesNotMatch(block, /value: totalDebt > 0/);
    assert.doesNotMatch(block, /tone: totalDebt > 0/);
  }

  assert.match(dashboardSource, /setSelectedKPI\('overdueDebt'\)/);
  assert.match(kpiModalSource, /\| 'overdueDebt'/);
  assert.match(kpiModalSource, /case 'overdueDebt':/);
});

test('dashboard payment totals preserve explicit zero paidAmount and skip ignored statuses', () => {
  assert.match(dashboardSource, /function getDashboardPaidAmount\(payment: Payment\)/);
  assert.match(dashboardSource, /typeof payment\.paidAmount === 'number'/);
  assert.match(dashboardSource, /Number\.isFinite\(payment\.paidAmount\) \? Math\.max\(0, payment\.paidAmount\) : 0/);
  assert.match(dashboardSource, /DASHBOARD_IGNORED_PAYMENT_STATUSES\.has\(status\)/);
  assert.doesNotMatch(dashboardSource, /payment\.paidAmount \|\| \(payment\.status === 'paid' \? payment\.amount : 0\)/);
});

test('dashboard month revenue excludes cancelled archived rentals from money charts', () => {
  assert.match(dashboardSource, /import \{ buildClientDebtAgingRows, buildClientFinancialSnapshots, buildRentalDebtRows, shouldCountRental \}/);
  assert.match(dashboardSource, /const revenueRentalsStartedThisMonth = rentalsStartedThisMonth\.filter\(shouldCountRental\)/);
  assert.match(dashboardSource, /const monthlyRevenue = revenueRentalsStartedThisMonth\.reduce/);
  assert.match(dashboardSource, /label: 'Начислено за месяц'[\s\S]{0,220}hint: `\$\{revenueRentalsStartedThisMonth\.length\} аренд`/);
  assert.match(dashboardSource, /revenueRentalsStartedThisMonth\.forEach\(rental =>/);
});
