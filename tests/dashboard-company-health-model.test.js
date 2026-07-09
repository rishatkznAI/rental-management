import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  COMPANY_HEALTH_WEIGHTS,
  alertHasValidSource,
  buildCompanyHealthModel,
  buildOperationalLoadModel,
  calculateCompanyHealthScore,
} from '../src/app/lib/dashboardCompanyHealth.js';

const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Dashboard.tsx'), 'utf8');

test('company health weights are explicit and sum to 1.0', () => {
  assert.deepEqual(COMPANY_HEALTH_WEIGHTS, {
    finance: 0.30,
    rental: 0.25,
    risks: 0.20,
    service: 0.15,
    clients: 0.07,
    fleet: 0.03,
  });
  const sum = Object.values(COMPANY_HEALTH_WEIGHTS).reduce((total, value) => total + value, 0);

  assert.equal(Number(sum.toFixed(2)), 1);
});

test('company health formula calculates weighted total and contributions', () => {
  const model = calculateCompanyHealthScore([
    { key: 'finance', score: 8, primaryMetric: 'долг', shortReason: 'просрочка' },
    { key: 'rental', score: 35, primaryMetric: 'аренды', shortReason: 'возвраты' },
    { key: 'risks', score: 10, primaryMetric: 'риски', shortReason: 'сигналы' },
    { key: 'service', score: 30, primaryMetric: 'сервис', shortReason: 'блокеры' },
    { key: 'clients', score: 50, primaryMetric: 'клиенты', shortReason: 'нейтрально' },
    { key: 'fleet', score: 70, primaryMetric: 'парк', shortReason: 'загрузка' },
  ]);

  assert.equal(model.totalScore, 23);
  assert.equal(model.maxScore, 100);
  assert.equal(model.directions.find(item => item.key === 'finance')?.weightedContribution, 2.4);
  assert.equal(model.directions.find(item => item.key === 'rental')?.weightedContribution, 8.75);
  assert.equal(model.directions.find(item => item.key === 'risks')?.weightedContribution, 2);
  assert.equal(model.directions.find(item => item.key === 'service')?.weightedContribution, 4.5);
  assert.equal(model.directions.find(item => item.key === 'clients')?.weightedContribution, 3.5);
  assert.equal(model.directions.find(item => item.key === 'fleet')?.weightedContribution, 2.1);
});

test('company health formula clamps direction scores before weighting', () => {
  const model = calculateCompanyHealthScore([
    { key: 'finance', score: -20, primaryMetric: 'долг', shortReason: 'ниже нуля' },
    { key: 'rental', score: 140, primaryMetric: 'аренды', shortReason: 'выше ста' },
    { key: 'risks', score: 100, primaryMetric: 'риски', shortReason: 'чисто' },
    { key: 'service', score: 30, primaryMetric: 'сервис', shortReason: 'блокеры' },
    { key: 'clients', score: 50, primaryMetric: 'клиенты', shortReason: 'нейтрально' },
    { key: 'fleet', score: 70, primaryMetric: 'парк', shortReason: 'загрузка' },
  ]);

  assert.equal(model.directions.find(item => item.key === 'finance')?.score, 0);
  assert.equal(model.directions.find(item => item.key === 'rental')?.score, 100);
  assert.equal(model.totalScore, 55);
});

test('company health weakest and strongest directions are sorted by normalized score', () => {
  const model = calculateCompanyHealthScore([
    { key: 'finance', score: 8, primaryMetric: 'долг', shortReason: 'просрочка' },
    { key: 'rental', score: 35, primaryMetric: 'аренды', shortReason: 'возвраты' },
    { key: 'risks', score: 10, primaryMetric: 'риски', shortReason: 'сигналы' },
    { key: 'service', score: 30, primaryMetric: 'сервис', shortReason: 'блокеры' },
    { key: 'clients', score: 50, primaryMetric: 'клиенты', shortReason: 'нейтрально' },
    { key: 'fleet', score: 70, primaryMetric: 'парк', shortReason: 'загрузка' },
  ]);

  assert.deepEqual(model.weakestDirections.slice(0, 3).map(item => item.key), ['finance', 'risks', 'service']);
  assert.deepEqual(model.strongestDirections.slice(0, 2).map(item => item.key), ['fleet', 'clients']);
  assert.deepEqual(model.focusDirections.slice(0, 2).map(item => item.key), ['finance', 'risks']);
});

test('company health formula marks missing directions with explicit neutral fallback', () => {
  const model = calculateCompanyHealthScore([
    { key: 'finance', score: 80, primaryMetric: 'платежи', shortReason: 'есть данные' },
  ]);
  const rental = model.directions.find(item => item.key === 'rental');

  assert.equal(model.directions.length, 6);
  assert.equal(model.totalScore, 59);
  assert.equal(rental?.score, 50);
  assert.equal(rental?.insufficientData, true);
  assert.equal(rental?.shortReason, 'Недостаточно данных');
});

test('company health directions expose weighted sub-metric methodology', () => {
  const model = buildCompanyHealthModel({
    equipmentCount: 10,
    activeEquipment: 9,
    availableEquipment: 2,
    equipmentInServiceCount: 1,
    inactiveEquipmentCount: 1,
    rentalsCount: 6,
    paymentsCount: 5,
    serviceCount: 3,
    documentsCount: 2,
    deliveriesCount: 2,
    clientsCount: 8,
    utilization: 78,
    monthlyRevenue: 1_000_000,
    monthlyPaidAmount: 920_000,
    overdueReceivablesAmount: 20_000,
    totalDebt: 80_000,
    debt30PlusAmount: 0,
    debt60PlusAmount: 0,
    largestProblemDebtAmount: 20_000,
    problemClientCount: 1,
    hasDebtSourceData: true,
    rentalRevenueActual: 900_000,
    rentalRevenuePlan: 1_000_000,
    rentalStartsThisMonth: 4,
    rentalReturnsThisMonth: 2,
    reservedRentalsCount: 2,
    openServiceTicketsCount: 3,
    overdueServiceTicketsCount: 0,
    repeatServiceFailuresCount: 0,
    averageServiceDays: 2,
    serviceLoadPercent: 64,
    newClientsThisMonth: 2,
    activeClientsCount: 4,
    repeatClientsCount: 3,
    agedEquipmentCount: 1,
    highHoursEquipmentCount: 0,
    equipmentWithPlannedRevenueCount: 8,
    fleetTopTypeShare: 40,
  });

  const expectedSubMetricCounts = {
    finance: 4,
    rental: 4,
    risks: 4,
    service: 5,
    clients: 4,
    fleet: 4,
  };

  for (const direction of model.scoreDetails.directions) {
    assert.equal(direction.totalWeight, COMPANY_HEALTH_WEIGHTS[direction.key]);
    assert.equal(direction.weightedContribution, Number((direction.score * direction.weight).toFixed(4)));
    assert.equal(direction.subMetrics.length, expectedSubMetricCounts[direction.key]);
    assert.ok(direction.reason);
    assert.ok(direction.recommendedAction);
    assert.match(direction.riskLevel, /^(critical|risk|stable|good|excellent)$/);

    const subMetricScore = Math.round(direction.subMetrics.reduce((sum, metric) => sum + metric.contribution, 0));
    assert.equal(direction.score, subMetricScore);
    for (const metric of direction.subMetrics) {
      assert.ok(metric.key);
      assert.ok(metric.title);
      assert.ok(metric.score >= 0 && metric.score <= 100);
      assert.ok(metric.weight > 0 && metric.weight <= 1);
      assert.equal(metric.contribution, Number((metric.score * metric.weight).toFixed(4)));
      assert.match(metric.sourceStatus, /^(real|derived|missing)$/);
      assert.ok(metric.reason);
    }
  }
});

test('company health missing sub-metrics use explicit neutral 50 fallback', () => {
  const model = buildCompanyHealthModel({
    equipmentCount: 4,
    rentalsCount: 2,
    paymentsCount: 1,
    serviceCount: 1,
    documentsCount: 1,
    deliveriesCount: 1,
    utilization: 55,
  });
  const finance = model.scoreDetails.directions.find(item => item.key === 'finance');
  const costPressure = finance?.subMetrics.find(metric => metric.key === 'finance_cost_pressure');

  assert.equal(typeof model.score, 'number');
  assert.equal(finance?.hasMissingSubMetrics, true);
  assert.equal(costPressure?.sourceStatus, 'missing');
  assert.equal(costPressure?.score, 50);
  assert.match(costPressure?.reason || '', /используется нейтральная оценка 50/);
});

test('company health risk score is strict for one large overdue debtor', () => {
  const model = buildCompanyHealthModel({
    equipmentCount: 10,
    activeEquipment: 10,
    availableEquipment: 2,
    equipmentInServiceCount: 1,
    rentalsCount: 5,
    paymentsCount: 4,
    serviceCount: 2,
    documentsCount: 1,
    deliveriesCount: 1,
    clientsCount: 6,
    utilization: 75,
    monthlyRevenue: 1_000_000,
    monthlyPaidAmount: 700_000,
    overdueReceivablesAmount: 650_000,
    totalDebt: 800_000,
    debt30PlusAmount: 0,
    debt60PlusAmount: 0,
    largestProblemDebtAmount: 650_000,
    problemClientCount: 1,
    hasDebtSourceData: true,
    rentalRevenueActual: 800_000,
    rentalRevenuePlan: 1_000_000,
    rentalStartsThisMonth: 1,
    rentalReturnsThisMonth: 1,
    reservedRentalsCount: 1,
    openServiceTicketsCount: 2,
    overdueServiceTicketsCount: 0,
    repeatServiceFailuresCount: 0,
    averageServiceDays: 2,
    serviceLoadPercent: 60,
    newClientsThisMonth: 1,
    activeClientsCount: 3,
    repeatClientsCount: 2,
    agedEquipmentCount: 1,
    highHoursEquipmentCount: 0,
    equipmentWithPlannedRevenueCount: 8,
    fleetTopTypeShare: 40,
  });
  const risks = model.scoreDetails.directions.find(item => item.key === 'risks');
  const overdue = risks?.subMetrics.find(metric => metric.key === 'risks_overdue_receivables');
  const concentration = risks?.subMetrics.find(metric => metric.key === 'risks_problem_clients');

  assert.ok((risks?.score ?? 100) <= 40);
  assert.equal(risks?.riskLevel, 'risk');
  assert.ok((overdue?.score ?? 100) <= 10);
  assert.ok((concentration?.score ?? 100) <= 20);
  assert.match(risks?.recommendedAction || '', /новые отгрузки/i);
});

test('empty dashboard data does not calculate a numeric company health score', () => {
  const model = buildCompanyHealthModel({});

  assert.equal(model.score, null);
  assert.equal(model.label, 'Нет данных');
  assert.equal(model.subtitle, 'Недостаточно данных для расчёта здоровья компании');
  assert.equal(model.contourStates.every(item => item.status === 'no_data'), true);
  assert.equal(model.scoreDetails.directions.length, 6);
  assert.equal(model.scoreDetails.directions.every(item => item.insufficientData), true);
});

test('equipment-only dashboard data is still insufficient for company health', () => {
  const model = buildCompanyHealthModel({
    equipmentCount: 4,
    utilization: 0,
  });

  assert.equal(model.score, null);
  assert.equal(model.label, 'Недостаточно данных');
  assert.deepEqual(model.availableContours, ['Техника']);
  assert.ok(model.missingContours.includes('Аренды'));
  assert.ok(model.missingContours.includes('Платежи'));
  assert.equal(model.scoreDetails.directions.find(item => item.key === 'fleet')?.insufficientData, false);
  assert.equal(model.scoreDetails.directions.find(item => item.key === 'finance')?.insufficientData, true);
});

test('empty contours are not counted as healthy', () => {
  const model = buildCompanyHealthModel({
    equipmentCount: 3,
    rentalsCount: 2,
    utilization: 67,
  });

  assert.equal(typeof model.score, 'number');
  assert.equal(model.contourStates.find(item => item.id === 'payments')?.status, 'no_data');
  assert.equal(model.contourStates.find(item => item.id === 'service')?.stateLabel, 'Нет данных');
  assert.notEqual(model.contourStates.find(item => item.id === 'payments')?.tone, 'success');
  assert.equal(model.scoreDetails.directions.find(item => item.key === 'finance')?.score, 50);
  assert.equal(model.scoreDetails.directions.find(item => item.key === 'finance')?.insufficientData, true);
});

test('real operational and financial data calculates a numeric company health score', () => {
  const model = buildCompanyHealthModel({
    equipmentCount: 8,
    rentalsCount: 5,
    paymentsCount: 4,
    serviceCount: 2,
    documentsCount: 3,
    deliveriesCount: 2,
    utilization: 75,
  });

  assert.equal(typeof model.score, 'number');
  assert.ok(model.score >= 80);
  assert.equal(model.label, 'Хорошо');
  assert.deepEqual(model.scoreDetails.directions.map(item => item.key), ['finance', 'rental', 'risks', 'service', 'clients', 'fleet']);
});

test('critical signals without source are excluded and can produce a warning', () => {
  assert.equal(alertHasValidSource({ category: 'Сервис', detail: 'Высокий приоритет', link: '/service/S-1', entity: 'S-1' }), true);
  assert.equal(alertHasValidSource({ category: 'Сервис', detail: 'Высокий приоритет', link: '/service/undefined', entity: '' }), false);

  const model = buildCompanyHealthModel({
    equipmentCount: 2,
    rentalsCount: 1,
    utilization: 50,
    invalidCriticalSignals: 1,
  });

  assert.equal(model.warning, 'Есть сигналы без полного расчёта');
});

test('dashboard source has no decorative fallback company health score', () => {
  assert.doesNotMatch(dashboardSource, /companyHealthDisplayScore\s*=\s*dashboardLooksDemoSafe[\s\S]*\?\s*68/);
  assert.doesNotMatch(dashboardSource, /companyHealthDisplayScore[\s\S]{0,120}\?\s*72/);
  assert.doesNotMatch(dashboardSource, /roleDashboardUtilizationPercent = activeEquipment > 0 \? utilization : 62/);
});

test('insufficient operational load data does not show a low management conclusion', () => {
  const model = buildOperationalLoadModel({});

  assert.equal(model.score, null);
  assert.equal(model.label, 'Недостаточно данных');
  assert.equal(model.hint, 'Индекс N/A · недостаточно данных');
  assert.notEqual(model.label, 'Низкая');
});

test('valid empty operational load can show low only when calculation base exists', () => {
  const model = buildOperationalLoadModel({
    activeEquipment: 6,
    totalRentals: 0,
    totalServiceTickets: 0,
    totalDeliveries: 0,
    totalDocuments: 0,
    totalTasks: 0,
    totalAttentionActions: 0,
    activeRentals: 0,
    openServiceTickets: 0,
    returnPressure: 0,
    deliveryPressure: 0,
    documentPressure: 0,
    taskPressure: 0,
    criticalIssues: 0,
  });

  assert.equal(model.score, 0);
  assert.equal(model.label, 'Низкая');
  assert.equal(model.hint, 'Индекс 0/100 · критично 0');
});

test('dashboard source renders N/A for uncalculated operational load index', () => {
  assert.match(dashboardSource, /operationalLoadScore === null \? 'Индекс N\/A'/);
  assert.doesNotMatch(dashboardSource, /hint: `Индекс \$\{operationalLoadScore\}\/100/);
});
