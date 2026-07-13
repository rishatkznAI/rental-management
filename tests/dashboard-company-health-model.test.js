import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  COMPANY_HEALTH_WEIGHTS,
  MIN_DIRECTION_COVERAGE_PERCENT,
  MIN_FINANCE_COVERAGE_PERCENT,
  MIN_RISKS_COVERAGE_PERCENT,
  alertHasValidSource,
  buildCompanyHealthModel,
  buildOperationalLoadModel,
  calculateCompanyHealthScore,
  isDirectionEligible,
} from '../src/app/lib/dashboardCompanyHealth.js';

const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Dashboard.tsx'), 'utf8');

function testMetric(key, score, weight = 1, sourceStatus = 'derived') {
  return { key, title: key, score, weight, sourceStatus, reason: `${key} source` };
}

function testDirection(key, subMetrics, overrides = {}) {
  return {
    key,
    subMetrics,
    shortReason: `${key} reason`,
    ...(key === 'finance'
      ? { financeEligibility: { actualReceiptsAvailable: true, overdueReceivablesAvailable: true } }
      : {}),
    ...overrides,
  };
}

const directionKeys = Object.keys(COMPANY_HEALTH_WEIGHTS);

function completeDirections(score = 80) {
  return directionKeys.map(key => testDirection(key, [testMetric(`${key}_complete`, score)]));
}

function reliableDebtAging(overrides = {}) {
  return {
    sourceStatus: 'derived',
    sourceConfidence: 'high',
    debtAgingReliable: true,
    overdueReceivablesAvailable: true,
    totalOutstandingAmount: 100_000,
    overdueOutstandingAmount: 100_000,
    currentAmount: 0,
    bucket1to30Amount: 100_000,
    bucket31to60Amount: 0,
    bucket61to90Amount: 0,
    bucketOver90Amount: 0,
    excludedAmbiguousAmount: 0,
    excludedAmbiguousCount: 0,
    largestClientOverdueAmount: 20_000,
    largestClientConcentrationAvailable: true,
    ...overrides,
  };
}

function riskModel(debtAging, overrides = {}) {
  return buildCompanyHealthModel({
    equipmentCount: 5,
    activeEquipment: 5,
    rentalsCount: 3,
    paymentsCount: 2,
    serviceCount: 1,
    documentsCount: 1,
    deliveriesCount: 1,
    clientsCount: 3,
    actualReceiptsAmount: 1_000_000,
    actualReceiptsAvailable: true,
    debtAging,
    ...overrides,
  });
}

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

test('direction eligibility threshold is explicit and uses raw unrounded coverage', () => {
  assert.equal(MIN_DIRECTION_COVERAGE_PERCENT, 30);
  assert.equal(isDirectionEligible({ score: 50, rawCoveragePercent: 29.49 }), false);
  assert.equal(isDirectionEligible({ score: 50, rawCoveragePercent: 29.99 }), false);
  assert.equal(isDirectionEligible({ score: 50, rawCoveragePercent: 30.00 }), true);
  assert.equal(isDirectionEligible({ score: 50, rawCoveragePercent: 30.01 }), true);
  assert.equal(isDirectionEligible({ score: null, rawCoveragePercent: 100 }), false);
  assert.equal(MIN_FINANCE_COVERAGE_PERCENT, 50);
  assert.equal(isDirectionEligible({
    key: 'finance',
    score: 50,
    rawCoveragePercent: 49.999,
    financeEligibility: { actualReceiptsAvailable: true, overdueReceivablesAvailable: true },
  }), false);
  assert.equal(isDirectionEligible({
    key: 'finance',
    score: 50,
    rawCoveragePercent: 50,
    financeEligibility: { actualReceiptsAvailable: true, overdueReceivablesAvailable: true },
  }), true);
});

test('rounding display coverage cannot make a 29.99 percent direction eligible', () => {
  const model = calculateCompanyHealthScore([
    testDirection('finance', [
      testMetric('available', 80, 0.2999),
      testMetric('missing', null, 0.7001, 'missing'),
    ]),
  ]);
  const finance = model.directions.find(item => item.key === 'finance');

  assert.equal(finance.coveragePercent, 30);
  assert.ok(finance.rawCoveragePercent < 30);
  assert.equal(finance.isEligible, false);
  assert.ok(model.excludedDirections.includes('finance'));
});

test('coverage-adjusted score returns raw and adjusted values', () => {
  const model = calculateCompanyHealthScore(completeDirections(84));

  assert.equal(model.rawScore, 84);
  assert.equal(model.adjustedScore, 84);
  assert.equal(model.totalScore, 84);
  assert.equal(model.totalCoveragePercent, 100);
  assert.ok(model.adjustedScore <= model.rawScore);
});

test('low-scoring metric becoming missing cannot increase displayed score', () => {
  const baseline = calculateCompanyHealthScore([
    testDirection('finance', [testMetric('high', 90, 0.5), testMetric('low', 10, 0.5)]),
    ...completeDirections(90).filter(item => item.key !== 'finance'),
  ]);
  const missing = calculateCompanyHealthScore([
    testDirection('finance', [testMetric('high', 90, 0.5), testMetric('low', null, 0.5, 'missing')]),
    ...completeDirections(90).filter(item => item.key !== 'finance'),
  ]);

  assert.ok(missing.totalScore <= baseline.totalScore);
  assert.ok(missing.totalCoveragePercent < baseline.totalCoveragePercent);
});

test('high-scoring metric becoming ambiguous cannot increase displayed score', () => {
  const baseline = calculateCompanyHealthScore([
    testDirection('finance', [testMetric('high', 90, 0.5), testMetric('low', 10, 0.5)]),
    ...completeDirections(70).filter(item => item.key !== 'finance'),
  ]);
  const missing = calculateCompanyHealthScore([
    testDirection('finance', [testMetric('high', null, 0.5, 'ambiguous'), testMetric('low', 10, 0.5)]),
    ...completeDirections(70).filter(item => item.key !== 'finance'),
  ]);

  assert.ok(missing.totalScore <= baseline.totalScore);
});

test('low-scoring direction becoming missing cannot increase displayed score', () => {
  const baselineDirections = completeDirections(90).map(item => item.key === 'clients'
    ? testDirection('clients', [testMetric('clients_low', 0)])
    : item);
  const missingDirections = baselineDirections.map(item => item.key === 'clients'
    ? testDirection('clients', [testMetric('clients_low', null, 1, 'missing')])
    : item);
  const baseline = calculateCompanyHealthScore(baselineDirections);
  const missing = calculateCompanyHealthScore(missingDirections);

  assert.equal(baseline.totalScore, 84);
  assert.equal(missing.totalScore, 84);
  assert.ok(missing.rawScore > baseline.rawScore);
});

test('high-scoring direction becoming missing cannot increase displayed score', () => {
  const baseline = calculateCompanyHealthScore(completeDirections(80));
  const missing = calculateCompanyHealthScore(completeDirections(80).map(item => item.key === 'rental'
    ? testDirection('rental', [testMetric('rental_high', null, 1, 'missing')])
    : item));

  assert.ok(missing.totalScore < baseline.totalScore);
});

test('multiple missing directions cannot increase displayed score', () => {
  const baseline = calculateCompanyHealthScore(completeDirections(75));
  const missing = calculateCompanyHealthScore(completeDirections(75).map(item => ['clients', 'fleet'].includes(item.key)
    ? testDirection(item.key, [testMetric(`${item.key}_missing`, null, 1, 'missing')])
    : item));

  assert.ok(missing.totalScore <= baseline.totalScore);
});

test('lower coverage reduces or preserves adjusted score while raw score stays explanatory', () => {
  const full = calculateCompanyHealthScore(completeDirections(90));
  const partial = calculateCompanyHealthScore(completeDirections(90).map(item => item.key === 'clients'
    ? testDirection('clients', [testMetric('clients_missing', null, 1, 'missing')])
    : item));

  assert.equal(partial.rawScore, 90);
  assert.ok(partial.adjustedScore < full.adjustedScore);
  assert.ok(partial.adjustedScore <= partial.rawScore);
});

test('coverage below 60 is preliminary and below 30 has no management score', () => {
  const preliminary = calculateCompanyHealthScore([
    testDirection('finance', [testMetric('finance', 80)]),
    testDirection('rental', [testMetric('rental', 80)]),
  ]);
  const insufficient = calculateCompanyHealthScore([
    testDirection('fleet', [testMetric('fleet', 80)]),
  ]);

  assert.equal(preliminary.totalCoveragePercent, 55);
  assert.equal(preliminary.isPreliminary, true);
  assert.equal(preliminary.displayLabel, 'Предварительная оценка');
  assert.equal(insufficient.totalCoveragePercent, 3);
  assert.equal(insufficient.totalScore, null);
  assert.equal(insufficient.displayLabel, 'Недостаточно данных для оценки');
});

test('missing critical Finance receipts source caps high coverage confidence at low', () => {
  const directions = completeDirections(80);
  directions[0] = testDirection('finance', [
    testMetric('finance_receipts_to_plan', null, 0.1, 'missing'),
    testMetric('finance_other', 80, 0.9),
  ], {
    financeEligibility: { actualReceiptsAvailable: false, overdueReceivablesAvailable: true },
    missingCriticalSources: [{ key: 'finance_actual_receipts', title: 'Фактические поступления', sourceStatus: 'missing' }],
  });
  const model = calculateCompanyHealthScore(directions);

  assert.equal(model.totalCoveragePercent, 97);
  assert.equal(model.confidence, 'low');
  assert.deepEqual(model.missingCriticalMetrics.map(item => item.key), ['finance_actual_receipts']);
});

test('missing and ambiguous metrics have null score, are unscorable, and contribute zero', () => {
  const model = calculateCompanyHealthScore([
    testDirection('finance', [
      testMetric('missing', 100, 0.5, 'missing'),
      testMetric('ambiguous', 100, 0.5, 'ambiguous'),
    ]),
  ]);
  const metrics = model.directions.find(item => item.key === 'finance').subMetrics;

  for (const metric of metrics) {
    assert.equal(metric.score, null);
    assert.equal(metric.isScorable, false);
    assert.equal(metric.contribution, 0);
  }
});

test('company health formula calculates weighted total and contributions', () => {
  const model = calculateCompanyHealthScore([
    { key: 'finance', score: 8, primaryMetric: 'долг', shortReason: 'просрочка', financeEligibility: { actualReceiptsAvailable: true, overdueReceivablesAvailable: true } },
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
    { key: 'finance', score: -20, primaryMetric: 'долг', shortReason: 'ниже нуля', financeEligibility: { actualReceiptsAvailable: true, overdueReceivablesAvailable: true } },
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
    { key: 'finance', score: 8, primaryMetric: 'долг', shortReason: 'просрочка', financeEligibility: { actualReceiptsAvailable: true, overdueReceivablesAvailable: true } },
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

test('company health formula gives missing directions zero adjusted contribution', () => {
  const model = calculateCompanyHealthScore([
    { key: 'finance', score: 80, primaryMetric: 'платежи', shortReason: 'есть данные', financeEligibility: { actualReceiptsAvailable: true, overdueReceivablesAvailable: true } },
  ]);
  const rental = model.directions.find(item => item.key === 'rental');

  assert.equal(model.directions.length, 6);
  assert.equal(model.rawScore, 80);
  assert.equal(model.totalScore, 24);
  assert.equal(rental?.score, null);
  assert.equal(rental?.weightedContribution, 0);
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
    assert.equal(direction.weight, COMPANY_HEALTH_WEIGHTS[direction.key]);
    assert.equal(direction.totalWeight, 1);
    assert.equal(direction.weightedContribution, direction.score === null ? 0 : Number((direction.score * direction.weight).toFixed(4)));
    assert.equal(direction.subMetrics.length, expectedSubMetricCounts[direction.key]);
    assert.ok(direction.reason);
    assert.ok(direction.recommendedAction);
    assert.match(direction.riskLevel, /^(critical|risk|stable|good|excellent|insufficient)$/);

    const availableWeight = direction.subMetrics.filter(metric => metric.isScorable).reduce((sum, metric) => sum + metric.weight, 0);
    const subMetricScore = availableWeight > 0
      ? Math.round(direction.subMetrics.reduce((sum, metric) => sum + metric.contribution, 0) / availableWeight)
      : null;
    assert.equal(direction.isEligible ? direction.score : direction.availableDataScore ?? direction.score, subMetricScore);
    for (const metric of direction.subMetrics) {
      assert.ok(metric.key);
      assert.ok(metric.title);
      assert.equal(metric.score === null || (metric.score >= 0 && metric.score <= 100), true);
      assert.ok(metric.weight > 0 && metric.weight <= 1);
      assert.equal(metric.contribution, metric.isScorable ? Number((metric.score * metric.weight).toFixed(4)) : 0);
      assert.match(metric.sourceStatus, /^(real|derived|missing|ambiguous)$/);
      assert.ok(metric.reason);
    }
  }
});

test('company health missing sub-metrics have null score and zero contribution', () => {
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

  assert.equal(finance?.hasMissingSubMetrics, true);
  assert.equal(costPressure?.sourceStatus, 'missing');
  assert.equal(costPressure?.score, null);
  assert.equal(costPressure?.isScorable, false);
  assert.equal(costPressure?.contribution, 0);
  assert.doesNotMatch(costPressure?.reason || '', /нейтральная оценка 50/);
});

test('Finance never treats accrued revenue, forecast, or invoiced amount as an approved receipts plan', () => {
  const model = buildCompanyHealthModel({
    paymentsCount: 2,
    actualReceiptsAmount: 400_000,
    actualReceiptsAvailable: true,
    accruedRentalRevenueAmount: 900_000,
    invoicedAmount: 850_000,
    expectedMonthlyRevenue: 800_000,
    monthlyRevenuePlan: 800_000,
    forecastRevenueAmount: 800_000,
    overdueReceivablesAmount: 100_000,
    overdueReceivablesAvailable: true,
    totalDebt: 300_000,
  });
  const finance = model.scoreDetails.directions.find(item => item.key === 'finance');
  const receipts = finance?.subMetrics.find(metric => metric.key === 'finance_receipts_to_plan');

  assert.equal(receipts?.score, null);
  assert.equal(receipts?.isScorable, false);
  assert.equal(receipts?.sourceStatus, 'missing');
  assert.equal(receipts?.reason, 'Утверждённый план поступлений не задан');
  assert.ok(receipts?.details.includes('Поступило: 400 000 ₽'));
  assert.ok(receipts?.details.includes('Начислено: 900 000 ₽'));
  assert.ok(receipts?.details.includes('Выставлено: 850 000 ₽'));
});

test('invoiced amount cannot substitute for actual receipts', () => {
  const model = buildCompanyHealthModel({
    paymentsCount: 1,
    invoicedAmount: 500_000,
    approvedRevenuePlanAmount: 600_000,
    overdueReceivablesAmount: 0,
    overdueReceivablesAvailable: true,
  });
  const finance = model.scoreDetails.directions.find(item => item.key === 'finance');
  const receipts = finance?.subMetrics.find(metric => metric.key === 'finance_receipts_to_plan');

  assert.equal(receipts?.score, null);
  assert.equal(receipts?.reason, 'Нет фактических поступлений за текущий период');
  assert.equal(finance?.financeEligibility.actualReceiptsAvailable, false);
  assert.equal(finance?.isEligible, false);
});

test('missing approved expense plan is explicitly unscorable even when actual expenses exist', () => {
  const model = buildCompanyHealthModel({
    actualExpenseAmount: 120_000,
    actualExpensesAvailable: true,
  });
  const cost = model.scoreDetails.directions
    .find(item => item.key === 'finance')
    ?.subMetrics.find(metric => metric.key === 'finance_cost_pressure');

  assert.equal(cost?.score, null);
  assert.equal(cost?.isScorable, false);
  assert.equal(cost?.reason, 'Утверждённый план расходов не задан');
  assert.ok(cost?.details.includes('Расходы: 120 000 ₽'));
});

test('cash-flow score requires both factual operating inflows and factual operating outflows', () => {
  const complete = buildCompanyHealthModel({
    actualOperatingInflowsAmount: 500_000,
    actualOperatingInflowsAvailable: true,
    actualOperatingOutflowsAmount: 350_000,
    actualOperatingOutflowsAvailable: true,
  }).scoreDetails.directions.find(item => item.key === 'finance')
    ?.subMetrics.find(metric => metric.key === 'finance_cash_flow');
  const receiptsOnly = buildCompanyHealthModel({
    actualOperatingInflowsAmount: 500_000,
    actualOperatingInflowsAvailable: true,
  }).scoreDetails.directions.find(item => item.key === 'finance')
    ?.subMetrics.find(metric => metric.key === 'finance_cash_flow');

  assert.equal(complete?.isScorable, true);
  assert.equal(complete?.sourceStatus, 'derived');
  assert.ok(complete?.details.includes('Денежный поток: 150 000 ₽'));
  assert.equal(receiptsOnly?.score, null);
  assert.equal(receiptsOnly?.isScorable, false);
  assert.equal(receiptsOnly?.reason, 'Нет данных об операционных расходах для расчёта денежного потока');
  assert.ok(receiptsOnly?.details.includes('Денежный поток: недостаточно данных'));
});

test('overdue receivables alone give 30 percent raw Finance coverage but cannot make Finance eligible or show 100', () => {
  const finance = buildCompanyHealthModel({
    overdueReceivablesAmount: 0,
    overdueReceivablesAvailable: true,
    totalDebt: 0,
  }).scoreDetails.directions.find(item => item.key === 'finance');

  assert.ok(Math.abs((finance?.rawCoveragePercent ?? 0) - 30) < 1e-9);
  assert.equal(finance?.coveragePercent, 30);
  assert.equal(finance?.availableDataScore, 100);
  assert.equal(finance?.score, null);
  assert.equal(finance?.isEligible, false);
});

test('Finance becomes eligible only with both critical sources and at least 50 percent raw coverage', () => {
  const shared = {
    actualReceiptsAmount: 500_000,
    actualReceiptsAvailable: true,
    overdueReceivablesAmount: 100_000,
    overdueReceivablesAvailable: true,
    totalDebt: 600_000,
    actualOperatingInflowsAmount: 500_000,
    actualOperatingInflowsAvailable: true,
    actualOperatingOutflowsAmount: 300_000,
    actualOperatingOutflowsAvailable: true,
  };
  const eligible = buildCompanyHealthModel(shared).scoreDetails.directions.find(item => item.key === 'finance');
  const missingReceipts = buildCompanyHealthModel({ ...shared, actualReceiptsAvailable: false })
    .scoreDetails.directions.find(item => item.key === 'finance');
  const missingOverdue = buildCompanyHealthModel({ ...shared, overdueReceivablesAvailable: false })
    .scoreDetails.directions.find(item => item.key === 'finance');

  assert.ok(Math.abs((eligible?.rawCoveragePercent ?? 0) - 50) < 1e-9);
  assert.equal(eligible?.isEligible, true);
  assert.notEqual(eligible?.score, null);
  assert.equal(missingReceipts?.isEligible, false);
  assert.equal(missingReceipts?.score, null);
  assert.equal(missingOverdue?.isEligible, false);
  assert.equal(missingOverdue?.score, null);
});

test('missing or ineligible Finance data cannot increase the displayed Company Health score', () => {
  const baseline = calculateCompanyHealthScore(completeDirections(80));
  const missingFinance = calculateCompanyHealthScore([
    testDirection('finance', [
      testMetric('finance_receipts_to_plan', null, 0.4, 'missing'),
      testMetric('finance_overdue_receivables', 100, 0.3),
      testMetric('finance_cash_flow', null, 0.2, 'missing'),
      testMetric('finance_cost_pressure', null, 0.1, 'missing'),
    ]),
    ...completeDirections(80).filter(item => item.key !== 'finance'),
  ]);

  assert.equal(missingFinance.directions.find(item => item.key === 'finance')?.score, null);
  assert.ok(missingFinance.totalScore < baseline.totalScore);
});

test('company health risk score is strict for one large confirmed overdue debtor', () => {
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
    debtAging: {
      sourceStatus: 'derived',
      sourceConfidence: 'high',
      debtAgingReliable: true,
      overdueReceivablesAvailable: true,
      totalOutstandingAmount: 800_000,
      overdueOutstandingAmount: 650_000,
      currentAmount: 150_000,
      bucket1to30Amount: 650_000,
      bucket31to60Amount: 0,
      bucket61to90Amount: 0,
      bucketOver90Amount: 0,
      excludedAmbiguousAmount: 0,
      excludedAmbiguousCount: 0,
      largestClientOverdueAmount: 650_000,
      largestClientConcentrationAvailable: true,
    },
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
  assert.match(risks?.riskLevel || '', /^(critical|risk)$/);
  assert.ok((overdue?.score ?? 100) <= 10);
  assert.equal(concentration?.sourceStatus, 'derived');
  assert.equal(concentration?.score, 16);
  assert.equal(concentration?.isScorable, true);
  assert.ok(risks?.riskPriorityOverride);
});

test('Risks eligibility uses the explicit 55 percent raw unrounded coverage threshold', () => {
  assert.equal(MIN_RISKS_COVERAGE_PERCENT, 55);
  const eligibility = { overdueReceivablesAvailable: true, debtAgingReliable: true };
  assert.equal(isDirectionEligible({ key: 'risks', score: 50, rawCoveragePercent: 54.49, coveragePercent: 55, risksEligibility: eligibility }), false);
  assert.equal(isDirectionEligible({ key: 'risks', score: 50, rawCoveragePercent: 54.999, coveragePercent: 55, risksEligibility: eligibility }), false);
  assert.equal(isDirectionEligible({ key: 'risks', score: 50, rawCoveragePercent: 55, coveragePercent: 55, risksEligibility: eligibility }), true);
});

test('overdue total alone cannot manufacture Risks 99 and ambiguous aging excludes Risks', () => {
  const model = riskModel({
    sourceStatus: 'ambiguous',
    sourceConfidence: 'low',
    debtAgingReliable: false,
    overdueReceivablesAvailable: false,
    totalOutstandingAmount: 0,
    overdueOutstandingAmount: 0,
    currentAmount: 0,
    bucket1to30Amount: 0,
    bucket31to60Amount: 0,
    bucket61to90Amount: 0,
    bucketOver90Amount: 0,
    excludedAmbiguousAmount: 500_000,
    excludedAmbiguousCount: 2,
    largestClientConcentrationAvailable: false,
  }, {
    overdueReceivablesAmount: 500_000,
    totalDebt: 500_000,
    overdueReceivablesCount: 2,
  });
  const risks = model.scoreDetails.directions.find(item => item.key === 'risks');

  assert.equal(risks?.score, null);
  assert.equal(risks?.isEligible, false);
  assert.ok((risks?.rawCoveragePercent ?? 100) < MIN_RISKS_COVERAGE_PERCENT);
  assert.equal(risks?.shortReason, 'Недостаточно надёжных данных по срокам задолженности');
  assert.ok(model.scoreDetails.excludedDirections.includes('risks'));
});

test('confirmed old debt worsens the Risks score and over-90 is more severe than 1-30', () => {
  const recent = riskModel(reliableDebtAging());
  const middle = riskModel(reliableDebtAging({
    bucket1to30Amount: 0,
    bucket61to90Amount: 100_000,
  }));
  const old = riskModel(reliableDebtAging({
    bucket1to30Amount: 0,
    bucketOver90Amount: 100_000,
  }));
  const recentRisks = recent.scoreDetails.directions.find(item => item.key === 'risks');
  const middleRisks = middle.scoreDetails.directions.find(item => item.key === 'risks');
  const oldRisks = old.scoreDetails.directions.find(item => item.key === 'risks');
  const recentAge = recentRisks?.subMetrics.find(metric => metric.key === 'risks_old_debt');
  const oldAge = oldRisks?.subMetrics.find(metric => metric.key === 'risks_old_debt');

  assert.ok((middleRisks?.score ?? 100) < (recentRisks?.score ?? 0));
  assert.ok((oldRisks?.score ?? 100) < (middleRisks?.score ?? 0));
  assert.ok((oldAge?.score ?? 100) < (recentAge?.score ?? 0));
});

test('confirmed severe old debt and a large confirmed debtor receive focus priority', () => {
  const severe = riskModel(reliableDebtAging({
    totalOutstandingAmount: 200_000,
    overdueOutstandingAmount: 200_000,
    bucket1to30Amount: 0,
    bucketOver90Amount: 200_000,
    largestClientOverdueAmount: 150_000,
  }));
  const risks = severe.scoreDetails.directions.find(item => item.key === 'risks');

  assert.equal(risks?.hasSevereOldDebt, true);
  assert.equal(risks?.riskPriorityOverride, true);
  assert.equal(severe.scoreDetails.focusDirections[0]?.key, 'risks');
});

test('missing Risks data cannot improve the displayed Company Health score', () => {
  const confirmed = riskModel(reliableDebtAging({
    bucket1to30Amount: 0,
    bucketOver90Amount: 100_000,
  }));
  const missing = riskModel({
    sourceStatus: 'ambiguous',
    sourceConfidence: 'low',
    debtAgingReliable: false,
    overdueReceivablesAvailable: false,
    excludedAmbiguousAmount: 100_000,
    excludedAmbiguousCount: 1,
  });

  assert.ok((missing.scoreDetails.adjustedScore ?? 0) <= (confirmed.scoreDetails.adjustedScore ?? 0));
  assert.ok(missing.scoreDetails.rawTotalCoveragePercent < confirmed.scoreDetails.rawTotalCoveragePercent);
});

test('Risks sub-metric and Company Health weights remain unchanged', () => {
  const risks = riskModel(reliableDebtAging()).scoreDetails.directions.find(item => item.key === 'risks');

  assert.equal(COMPANY_HEALTH_WEIGHTS.risks, 0.20);
  assert.deepEqual(risks?.subMetrics.map(metric => [metric.key, metric.weight]), [
    ['risks_overdue_receivables', 0.45],
    ['risks_old_debt', 0.25],
    ['risks_problem_clients', 0.20],
    ['risks_critical_events', 0.10],
  ]);
});

test('empty dashboard data does not calculate a numeric company health score', () => {
  const model = buildCompanyHealthModel({});

  assert.equal(model.score, null);
  assert.equal(model.label, 'Недостаточно данных для оценки');
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
  assert.equal(model.label, 'Недостаточно данных для оценки');
  assert.deepEqual(model.availableContours, ['Техника']);
  assert.ok(model.missingContours.includes('Аренды'));
  assert.ok(model.missingContours.includes('Платежи'));
  assert.equal(model.scoreDetails.directions.find(item => item.key === 'fleet')?.isEligible, false);
  assert.equal(model.scoreDetails.directions.find(item => item.key === 'finance')?.insufficientData, true);
});

test('empty contours are not counted as healthy', () => {
  const model = buildCompanyHealthModel({
    equipmentCount: 3,
    rentalsCount: 2,
    utilization: 67,
  });

  assert.equal(model.score, null);
  assert.equal(model.contourStates.find(item => item.id === 'payments')?.status, 'no_data');
  assert.equal(model.contourStates.find(item => item.id === 'service')?.stateLabel, 'Нет данных');
  assert.notEqual(model.contourStates.find(item => item.id === 'payments')?.tone, 'success');
  assert.equal(model.scoreDetails.directions.find(item => item.key === 'finance')?.score, null);
  assert.equal(model.scoreDetails.directions.find(item => item.key === 'finance')?.insufficientData, true);
});

test('sparse operational contours do not manufacture a numeric company health score', () => {
  const model = buildCompanyHealthModel({
    equipmentCount: 8,
    rentalsCount: 5,
    paymentsCount: 4,
    serviceCount: 2,
    documentsCount: 3,
    deliveriesCount: 2,
    utilization: 75,
  });

  assert.equal(model.score, null);
  assert.equal(model.label, 'Недостаточно данных для оценки');
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

  assert.match(model.warning, /Есть сигналы без полного расчёта/);
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
