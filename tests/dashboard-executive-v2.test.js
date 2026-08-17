import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Dashboard.tsx'), 'utf8');
const cockpitSource = fs.readFileSync(path.join(process.cwd(), 'src/app/components/dashboard/ExecutiveCockpitV2.tsx'), 'utf8');

test('Dashboard V2 has the prescribed executive hierarchy and mobile priority', () => {
  for (const section of [
    'Требует внимания',
    'Динамика месяца',
    'Здоровье компании',
    'Парк',
    'Деньги',
    'Сервис',
    'Продажи',
    'С момента последнего входа',
  ]) {
    assert.match(cockpitSource, new RegExp(section));
  }
  assert.match(cockpitSource, /executive-v2-attention order-1/);
  assert.match(cockpitSource, /executive-v2-kpis order-2/);
  assert.match(cockpitSource, /executive-v2-money order-4/);
  assert.match(cockpitSource, /executive-v2-fleet order-5/);
  assert.match(cockpitSource, /executive-v2-service order-6/);
  assert.match(cockpitSource, /executive-v2-health order-7/);
  assert.match(cockpitSource, /\{props\.contextLabel\} · \{props\.periodLabel\}/);
  assert.match(dashboardSource, /contextLabel: user\?\.role \|\| 'Операционный центр'/);
});

test('Dashboard V2 exposes exactly the four prescribed KPI definitions for an authorized executive', () => {
  const start = dashboardSource.indexOf('const executiveKpis: ExecutiveKpi[] = [');
  const end = dashboardSource.indexOf('].filter(Boolean) as ExecutiveKpi[];', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const kpiBlock = dashboardSource.slice(start, end);
  assert.equal((kpiBlock.match(/id: 'dashboard-kpi-/g) || []).length, 4);
  for (const label of ['Выручка месяца', 'Загрузка парка', 'Просроченная дебиторка', 'Поступления месяца']) {
    assert.match(kpiBlock, new RegExp(`label: '${label}'`));
  }
});

test('revenue and receipts keep distinct date and accounting semantics', () => {
  assert.match(dashboardSource, /executiveRevenueRentals = rentalsIntersectingThisMonth\.filter\(shouldCountRental\)/);
  assert.match(dashboardSource, /calculateRentalBilling\(rental, \{[\s\S]*periodStart: monthStartKey,[\s\S]*periodEnd: todayKey/);
  assert.match(dashboardSource, /executiveRevenueForecast[\s\S]*periodEnd: monthEndKey/);
  assert.match(dashboardSource, /actualReceiptPayments = payments\.filter\(payment =>[\s\S]*Boolean\(payment\.paidDate\)[\s\S]*getDashboardPaidAmount\(payment\) > 0/);
  assert.doesNotMatch(dashboardSource, /actualReceiptPayments = payments\.filter\(payment =>[\s\S]{0,180}payment\.dueDate/);
  assert.match(dashboardSource, /Прогноз — детерминированная сумма уже известных договоров/);
});

test('receivable drill-downs use canonical identity rather than debtor names', () => {
  assert.match(dashboardSource, /companyHealthDebtAging\.overdueReceivablesAvailable === true/);
  assert.match(dashboardSource, /executiveEligibleOverdueReceivables/);
  assert.match(dashboardSource, /topDebtorsByCounterparty = new Map/);
  assert.match(dashboardSource, /stableGroupId = client\?\.counterpartyId \|\| row\.clientId/);
  assert.match(dashboardSource, /`\/clients\/\$\{encodeURIComponent\(row\.clientId\)\}`/);
  assert.doesNotMatch(dashboardSource, /`\/clients\/\$\{encodeURIComponent\(row\.name\)\}`/);
});

test('monetary risk is only displayed when a proven amount source exists', () => {
  assert.match(dashboardSource, /executiveOverdueReceivablesAmount[\s\S]*moneyImpact: `Деньги под риском:/);
  assert.match(dashboardSource, /Number\(item\.estimatedLoss\) > 0/);
  assert.doesNotMatch(dashboardSource, /plannedMonthlyRevenue \/ 30\) \* ticket\.daysInService/);
  assert.match(cockpitSource, /signal\.moneyImpact \?/);
  assert.match(cockpitSource, /risk\.moneyImpact \?/);
});

test('Sales and Since Last Visit remain honestly gated by production data availability', () => {
  assert.match(dashboardSource, /const canViewCrm = isCrmEnabled && can\('view', 'crm'\) && canReadCollection\('crm_deals'\)/);
  assert.match(dashboardSource, /sales: canViewCrm \?/);
  assert.match(dashboardSource, /recentChanges: undefined/);
  assert.match(dashboardSource, /there is no reliable per-user last-seen business snapshot yet/);
});

test('Dashboard V2 uses compact operational empty and partial states', () => {
  assert.match(cockpitSource, /За выбранный период начислений и поступлений нет/);
  assert.match(cockpitSource, /Недостаточно данных для полного расчёта/);
  assert.match(cockpitSource, /Не удалось загрузить данные блока/);
  assert.match(cockpitSource, /Данные могли устареть; ожидается обновление/);
  assert.match(dashboardSource, /dataUpdatedAt/);
  assert.match(cockpitSource, /signals\.length === 0 && 'self-start'/);
  assert.match(cockpitSource, /hasChart \? 'h-\[210px\] sm:h-\[225px\]' : 'h-\[68px\] sm:h-\[60px\]'/);
  assert.doesNotMatch(cockpitSource, /text-(?:5xl|6xl|7xl)[\s\S]{0,120}Нет данных/);
});
