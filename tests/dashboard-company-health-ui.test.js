import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Dashboard.tsx'), 'utf8');
const cockpitSource = fs.readFileSync(path.join(process.cwd(), 'src/app/components/dashboard/ExecutiveCockpitV2.tsx'), 'utf8');
const themeSource = fs.readFileSync(path.join(process.cwd(), 'src/styles/theme.css'), 'utf8');
const healthModelSource = fs.readFileSync(path.join(process.cwd(), 'src/app/lib/dashboardCompanyHealth.js'), 'utf8');

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `start marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `end marker not found: ${endMarker}`);
  return source.slice(start, end);
}

test('Dashboard V2 renders one compact Company Health card', () => {
  const block = sourceBlock(cockpitSource, 'function CompactHealth', 'function FleetEconomics');

  assert.match(block, /data-testid="dashboard-company-health"/);
  assert.match(block, /data-testid="dashboard-company-health-score"/);
  assert.match(block, /data-testid="dashboard-company-health-status"/);
  assert.match(block, /data-testid="dashboard-company-health-coverage"/);
  assert.match(block, /data-testid="dashboard-company-health-directions"/);
  assert.match(block, /health\.directions\.map/);
  assert.match(block, /health\.score === null \? '—' : health\.score/);
  assert.match(block, /health\.primaryRisk/);
  assert.match(block, /health\.explanation/);
  assert.equal(cockpitSource.match(/data-testid="dashboard-company-health"/g)?.length, 1);
});

test('Company Health keeps canonical direction inputs and permission filtering', () => {
  assert.match(dashboardSource, /const executiveHealthDirections = companyHealthScoreBreakdown\.directions/);
  assert.match(dashboardSource, /executiveHealthDirectionVisibility\[direction\.key\] === true/);
  assert.match(dashboardSource, /health: \{[\s\S]*score: companyHealthDisplayScore/);
  assert.match(dashboardSource, /coverage: `Покрытие/);
  assert.match(dashboardSource, /Недоступные направления исключаются из оценки/);
  assert.doesNotMatch(dashboardSource, /нет данных, 50/);
});

test('Company Health financial explanation preserves factual and missing-plan semantics', () => {
  const modelInputBlock = sourceBlock(dashboardSource, 'const companyHealthModel = buildCompanyHealthModel({', '});');

  assert.match(modelInputBlock, /accruedRentalRevenueAmount: companyHealthRentalRevenueActual/);
  assert.match(modelInputBlock, /actualReceiptsAmount/);
  assert.match(modelInputBlock, /actualReceiptsAvailable/);
  assert.match(modelInputBlock, /actualOperatingInflowsAmount/);
  assert.match(modelInputBlock, /actualOperatingOutflowsAmount: factualOperatingOutflows/);
  for (const label of [
    'Поступило:',
    'Начислено:',
    'План поступлений:',
    'Просрочено:',
    'Денежный поток:',
    'Расходы:',
    'План расходов:',
    'Утверждённый план поступлений не задан',
    'Утверждённый план расходов не задан',
    'Денежный поток: недостаточно данных',
  ]) {
    assert.match(healthModelSource, new RegExp(label));
  }
});

test('Company Health risk explanation keeps exclusive debt aging states', () => {
  const modelInputBlock = sourceBlock(dashboardSource, 'const companyHealthModel = buildCompanyHealthModel({', '});');

  assert.match(dashboardSource, /buildCanonicalDebtAging\(mapRentalDebtRowsForCompanyHealth\(rentalDebtRows\)/);
  assert.match(modelInputBlock, /debtAging: companyHealthDebtAging/);
  for (const label of [
    'Общая дебиторка:',
    'Просроченная дебиторка:',
    'Не наступил срок:',
    '1–30 дней:',
    '31–60 дней:',
    '61–90 дней:',
    'Более 90 дней:',
    'Исключено из расчёта из-за неоднозначной даты:',
    'Источник aging:',
    'Доверие:',
  ]) {
    assert.match(healthModelSource, new RegExp(label));
  }
  assert.doesNotMatch(healthModelSource, /Долги старше 30\/60\/90 дней/);
});

test('Dashboard V2 Company Health layout is responsive without custom legacy geometry', () => {
  const block = sourceBlock(cockpitSource, 'function CompactHealth', 'function FleetEconomics');

  assert.match(block, /order-7 col-span-12[\s\S]*xl:order-4/);
  assert.match(block, /xl:grid-cols-\[220px_minmax\(0,1fr\)_minmax\(220px,0\.7fr\)\]/);
  assert.match(block, /grid-cols-2[\s\S]*sm:grid-cols-3[\s\S]*xl:grid-cols-6/);
  assert.doesNotMatch(block, /new ResizeObserver|window\.innerWidth|estimatedCardWidth/);
  assert.doesNotMatch(themeSource, /\.rentcore-dashboard-health\s*\{/);
});

test('legacy Company Health renderer and selectors are absent', () => {
  for (const legacyName of [
    'CompanyHealthCommandCenter',
    'CompanyHealthTrendOverview',
    'CompanyHealthSignalCard',
    'CompanyHealthBars',
  ]) {
    assert.doesNotMatch(dashboardSource, new RegExp(legacyName));
  }
  for (const legacyTestId of [
    'dashboard-radial-overview',
    'dashboard-company-health-visual',
    'dashboard-company-health-completeness',
    'dashboard-company-health-compact',
    'dashboard-company-health-segments',
  ]) {
    assert.doesNotMatch(cockpitSource, new RegExp(legacyTestId));
  }
});

test('dashboard reference mode cannot override global app shell sidebar or logo', () => {
  assert.doesNotMatch(themeSource, /rentcore-dashboard-reference-mode[\s\S]{0,220}rentcore-industrial-shell/);
  assert.doesNotMatch(themeSource, /rentcore-dashboard-reference-mode[\s\S]{0,220}>\s*aside/);
  assert.doesNotMatch(themeSource, /rentcore-dashboard-reference-mode[\s\S]{0,220}>\s*header/);
  assert.doesNotMatch(themeSource, /rentcore-dashboard-reference-mode[\s\S]{0,220}>\s*main/);
  assert.doesNotMatch(themeSource, /rentcore-dashboard-reference-mode[\s\S]{0,220}app-shell-title/);
});

test('Dashboard V2 KPI cards prefer readable wrapping over fixed-width legacy cards', () => {
  assert.match(cockpitSource, /rentcore-command-kpi group min-h-\[126px\]/);
  assert.match(cockpitSource, /dashboard-kpi-value/);
  assert.doesNotMatch(cockpitSource, /min-w-\[220px\]/);
  assert.match(themeSource, /\.dashboard-kpi-value\s*\{[\s\S]*word-break: normal;[\s\S]*overflow-wrap: normal;[\s\S]*hyphens: none;/);
  assert.doesNotMatch(themeSource, /\.rentcore-dashboard-kpi-grid\s*\{/);
});
