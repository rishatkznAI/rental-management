import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { localDateKey } from '../src/app/lib/serviceDayPlan.js';

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

test('Company Health uses canonical month revenue and only an authoritative fleet plan', () => {
  assert.match(dashboardSource, /import \{ localDateKey \} from '\.\.\/lib\/serviceDayPlan\.js'/);
  assert.match(dashboardSource, /const todayKey = toDateKey\(today\)/);
  assert.match(dashboardSource, /key: localDateKey\(cursor\)/);
  assert.match(dashboardSource, /const rentalRevenuePlanAvailable = activeEquipment > 0[\s\S]*equipmentWithPlannedRevenueCount === activeEquipment[\s\S]*fleetMonthlyRevenuePlan > 0/);
  assert.match(dashboardSource, /const companyHealthRentalRevenueActual = ganttRentalsQuery\.isSuccess[\s\S]*rentalsIntersectingThisMonth[\s\S]*calculateRentalBilling\(rental, \{[\s\S]*periodStart: toDateKey\(monthStart\),[\s\S]*periodEnd: todayKey/);
  const modelInputStart = dashboardSource.indexOf('const companyHealthModel = buildCompanyHealthModel({');
  const modelInputEnd = dashboardSource.indexOf('});', modelInputStart);
  const modelInput = dashboardSource.slice(modelInputStart, modelInputEnd);
  assert.match(modelInput, /rentalRevenueActual: companyHealthRentalRevenueActual/);
  assert.match(modelInput, /rentalRevenueActualAvailable: ganttRentalsQuery\.isSuccess/);
  assert.match(modelInput, /rentalRevenuePlanAvailable/);
  assert.doesNotMatch(modelInput, /rentalRevenueActual: monthlyRevenue/);
  assert.match(dashboardSource, /const executiveRevenuePlanAvailable = rentalRevenuePlanAvailable/);
});

test('Dashboard business date keeps local Moscow month boundaries', () => {
  const previousTimeZone = process.env.TZ;
  try {
    process.env.TZ = 'Europe/Moscow';
    const localMonthStart = new Date(2026, 7, 1, 0, 0, 0, 0);
    const localToday = new Date(2026, 7, 17, 0, 0, 0, 0);

    assert.equal(localMonthStart.toISOString().slice(0, 10), '2026-07-31');
    assert.equal(localToday.toISOString().slice(0, 10), '2026-08-16');
    assert.equal(localDateKey(localMonthStart), '2026-08-01');
    assert.equal(localDateKey(localToday), '2026-08-17');
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test('receivable drill-downs use canonical identity rather than debtor names', () => {
  assert.match(dashboardSource, /companyHealthDebtAging\.overdueReceivablesAvailable === true/);
  assert.match(dashboardSource, /executiveEligibleOverdueReceivables/);
  assert.match(dashboardSource, /topDebtorsByCounterparty = new Map/);
  assert.match(dashboardSource, /stableGroupId = client\?\.counterpartyId \|\| row\.clientId/);
  assert.match(dashboardSource, /`\/clients\/\$\{encodeURIComponent\(row\.clientId\)\}`/);
  assert.doesNotMatch(dashboardSource, /`\/clients\/\$\{encodeURIComponent\(row\.name\)\}`/);
});

test('Dashboard V2 deduplicates service blockers and gates panels and health links by permission', () => {
  assert.match(dashboardSource, /const serviceBlockerTicketIds = new Set\(\[[\s\S]*criticalTickets[\s\S]*unassignedServiceTickets[\s\S]*ticketsWaitingParts[\s\S]*overdueServiceTickets[\s\S]*ticket\.id[\s\S]*const serviceBlockersCount = serviceBlockerTicketIds\.size/);
  assert.match(dashboardSource, /fleet: canViewEquipment \?/);
  assert.match(dashboardSource, /money: canViewMoney \?/);
  assert.match(dashboardSource, /service: canViewService \?/);
  assert.match(dashboardSource, /executiveHealthDirectionVisibility\[direction\.key\] === true/);
  assert.match(cockpitSource, /props\.fleet \? <FleetEconomics/);
  assert.match(cockpitSource, /props\.money \? <MoneyPanel/);
  assert.match(cockpitSource, /props\.service \? <ServicePanel/);
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

test('Dashboard has one unconditional V2 return and no legacy renderer after it', () => {
  const marker = 'return <ExecutiveCockpitV2 {...executiveCockpitProps} />;';
  const activeReturn = dashboardSource.indexOf(marker);
  assert.notEqual(activeReturn, -1);
  const suffix = dashboardSource.slice(activeReturn + marker.length);

  assert.doesNotMatch(suffix, /return\s*\(/);
  assert.match(suffix, /^\s*\}\s*$/);
  for (const legacySymbol of ['DashboardKpiGrid', 'RiskSignalStrip', 'CompanyHealthCommandCenter', 'DashboardEmptyState', 'RENTAL_STATUS', 'kpiData']) {
    assert.doesNotMatch(dashboardSource, new RegExp(legacySymbol));
  }
});

test('Dynamics chart has a screen-reader table with distinct actual and forecast series', () => {
  assert.match(cockpitSource, /data-testid="dashboard-month-dynamics-data"/);
  assert.match(cockpitSource, /<caption>Данные графика «Динамика месяца»<\/caption>/);
  assert.match(cockpitSource, /<th scope="col">Дата<\/th>/);
  assert.match(cockpitSource, /<th scope="col">Начисления \(факт\)<\/th>/);
  assert.match(cockpitSource, /<th scope="col">Поступления \(факт\)<\/th>/);
  assert.match(cockpitSource, /<th scope="col">Прогноз начислений<\/th>/);
  assert.match(cockpitSource, /formatAccessibleMoney\(point\.revenue\)/);
  assert.match(cockpitSource, /formatAccessibleMoney\(point\.payments\)/);
  assert.match(cockpitSource, /formatAccessibleMoney\(point\.forecast\)/);
  assert.match(cockpitSource, /value === null \? 'Нет данных' : `\$\{value\.toLocaleString\('ru-RU'\)\} рублей`/);
  assert.match(cockpitSource, /className="h-full w-full" aria-hidden="true"/);
  assert.match(dashboardSource, /dateLabel: new Date\(`/);
});

test('Dashboard action links expose a mobile 44px contract and visible focus state', () => {
  assert.match(cockpitSource, /dashboard-card-action[\s\S]{0,220}min-h-\[46px\] min-w-11/);
  assert.match(cockpitSource, /sm:min-h-0 sm:min-w-0 sm:p-0/);
  assert.match(cockpitSource, /dashboard-attention-action[\s\S]{0,180}min-h-\[46px\]/);
  assert.match(cockpitSource, /dashboard-card-action[\s\S]{0,320}focus-visible:ring-2/);
  assert.match(cockpitSource, /dashboard-attention-action[\s\S]{0,320}focus-visible:ring-2/);
});
