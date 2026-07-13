const CONTOUR_LABELS = {
  equipment: 'Техника',
  rentals: 'Аренды',
  payments: 'Платежи',
  service: 'Сервис',
  documents: 'Документы',
  deliveries: 'Доставки',
};

const OPERATIONAL_CONTOURS = ['rentals', 'payments', 'service', 'documents', 'deliveries'];

export const COMPANY_HEALTH_WEIGHTS = Object.freeze({
  finance: 0.30,
  rental: 0.25,
  risks: 0.20,
  service: 0.15,
  clients: 0.07,
  fleet: 0.03,
});

const COMPANY_HEALTH_DIRECTIONS = [
  { key: 'finance', title: 'Финансы' },
  { key: 'rental', title: 'Аренда' },
  { key: 'risks', title: 'Риски' },
  { key: 'service', title: 'Сервис' },
  { key: 'clients', title: 'Клиенты' },
  { key: 'fleet', title: 'Парк' },
];

// Provenance classifications come from docs/company-health-data-audit.md.
// Ambiguous sources remain visible for explanation, but are deliberately not scorable.
export const COMPANY_HEALTH_CRITICAL_METRICS = new Set([
  'finance_overdue_receivables',
  'rental_utilization',
  'risks_overdue_receivables',
  'risks_old_debt',
  'service_fleet_readiness',
  'fleet_health',
]);

export const MIN_DIRECTION_COVERAGE_PERCENT = 30;
export const MIN_FINANCE_COVERAGE_PERCENT = 50;

export function isDirectionEligible(direction = {}) {
  const hasScoreAndCoverage = direction.score !== null
    && direction.score !== undefined
    && Number(direction.rawCoveragePercent) >= (direction.key === 'finance'
      ? MIN_FINANCE_COVERAGE_PERCENT
      : MIN_DIRECTION_COVERAGE_PERCENT);
  if (!hasScoreAndCoverage) return false;
  if (direction.key !== 'finance') return true;
  return direction.financeEligibility?.actualReceiptsAvailable === true
    && direction.financeEligibility?.overdueReceivablesAvailable === true;
}

function isCriticalMetricGap(metric, subMetrics) {
  if (metric.key === 'risks_old_debt') return false;
  if (metric.key === 'risks_overdue_receivables') {
    return !subMetrics.some(item =>
      (item.key === 'risks_overdue_receivables' || item.key === 'risks_old_debt') && item.isScorable
    );
  }
  return COMPANY_HEALTH_CRITICAL_METRICS.has(metric.key) && !metric.isScorable;
}

function safeCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function operationalLoadLabel(score) {
  if (score > 85) return 'Критично';
  if (score >= 70) return 'Высокая';
  if (score >= 40) return 'Нормальная';
  return 'Низкая';
}

function operationalLoadTone(score, criticalIssues = 0) {
  if (safeCount(criticalIssues) > 0) {
    return score > 85 || safeCount(criticalIssues) >= 5 ? 'danger' : 'warning';
  }
  if (score > 85) return 'danger';
  if (score >= 70) return 'warning';
  if (score >= 40) return 'default';
  return 'success';
}

function contourStatus({ count = 0, risk = 0, critical = 0 }) {
  if (safeCount(count) <= 0) return 'no_data';
  if (safeCount(critical) > 0) return 'critical';
  if (safeCount(risk) > 0) return 'risk';
  return 'ok';
}

function contourTone(status) {
  if (status === 'critical') return 'danger';
  if (status === 'risk') return 'warning';
  if (status === 'ok') return 'success';
  return 'default';
}

function contourStateLabel(status) {
  if (status === 'critical') return 'Критично';
  if (status === 'risk') return 'Есть риск';
  if (status === 'ok') return 'ОК';
  return 'Нет данных';
}

function hasOwn(input, key) {
  return Object.prototype.hasOwnProperty.call(input || {}, key);
}

function hasFiniteInput(input, key) {
  if (!hasOwn(input, key)) return false;
  const numeric = Number(input[key]);
  return Number.isFinite(numeric);
}

function firstFiniteInput(input, keys) {
  for (const key of keys) {
    if (hasFiniteInput(input, key)) return Number(input[key]);
  }
  return null;
}

function hasAnyFiniteInput(input, keys) {
  return keys.some(key => hasFiniteInput(input, key));
}

function nonNegative(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function formatFinanceAmount(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'нет данных';
  return `${Math.round(Number(value)).toLocaleString('ru-RU')} ₽`;
}

function ratioScore(ratio, bands) {
  const safeRatio = Number.isFinite(ratio) ? ratio : 0;
  const match = bands.find(([limit]) => safeRatio <= limit);
  return match ? match[1] : bands[bands.length - 1]?.[1] ?? 50;
}

function planPerformanceScore(actual, plan) {
  if (plan <= 0) return null;
  const ratio = actual / plan;
  if (ratio >= 1) return 100;
  if (ratio >= 0.9) return 92;
  if (ratio >= 0.75) return 78;
  if (ratio >= 0.6) return 62;
  if (ratio >= 0.4) return 42;
  return 20;
}

function overduePressureScore(overdueAmount, baseAmount, strict = false) {
  if (overdueAmount <= 0) return 100;
  const base = Math.max(baseAmount, overdueAmount, 1);
  const ratio = overdueAmount / base;
  return ratioScore(ratio, strict
    ? [[0.03, 88], [0.08, 72], [0.15, 52], [0.30, 30], [0.50, 14], [Infinity, 5]]
    : [[0.05, 90], [0.15, 74], [0.30, 52], [0.50, 30], [Infinity, 12]]);
}

function countAgainstTargetScore(count, target) {
  if (target <= 0) return 50;
  const ratio = count / target;
  if (ratio >= 1) return 100;
  if (ratio >= 0.75) return 82;
  if (ratio >= 0.5) return 65;
  if (ratio > 0) return 42;
  return 24;
}

function riskLevelForScore(score) {
  if (score <= 30) return 'critical';
  if (score <= 55) return 'risk';
  if (score <= 75) return 'stable';
  if (score <= 90) return 'good';
  return 'excellent';
}

function buildSubMetric({ key, title, score, weight, sourceStatus = 'derived', reason, isScorable, details }) {
  const status = ['real', 'derived', 'missing', 'ambiguous'].includes(sourceStatus)
    ? sourceStatus
    : 'ambiguous';
  const hasScore = score !== null && score !== undefined && score !== '' && Number.isFinite(Number(score));
  const approvedScorable = typeof isScorable === 'boolean'
    ? isScorable
    : (status === 'real' || status === 'derived');
  const scorable = approvedScorable && hasScore && status !== 'missing' && status !== 'ambiguous';
  const resolvedScore = scorable ? clampPercent(Math.round(Number(score))) : null;
  return {
    key,
    title,
    score: resolvedScore,
    isScorable: scorable,
    weight,
    contribution: scorable ? Number((resolvedScore * weight).toFixed(4)) : 0,
    sourceStatus: status,
    reason: reason || (status === 'missing' ? 'Недостаточно данных' : 'Источник требует проверки'),
    details: Array.isArray(details) ? details.filter(Boolean) : [],
  };
}

function weakestSubMetric(subMetrics) {
  return subMetrics
    .slice()
    .sort((left, right) => {
      if (left.isScorable !== right.isScorable) return left.isScorable ? 1 : -1;
      return (left.score ?? 101) - (right.score ?? 101) || right.weight - left.weight || left.title.localeCompare(right.title, 'ru');
    })[0];
}

function confidenceForCoverage(coveragePercent, hasCriticalAmbiguity = false) {
  let confidence = coveragePercent >= 85
    ? 'high'
    : coveragePercent >= 60
      ? 'medium'
      : coveragePercent >= 30
        ? 'low'
        : 'insufficient';
  if (hasCriticalAmbiguity && (confidence === 'high' || confidence === 'medium')) confidence = 'low';
  return confidence;
}

function buildDirection({ key, title, subMetrics, reason, recommendedAction }) {
  const availableWeight = subMetrics
    .filter(metric => metric.isScorable)
    .reduce((sum, metric) => sum + metric.weight, 0);
  const totalMetricWeight = subMetrics.reduce((sum, metric) => sum + metric.weight, 0);
  const rawCoveragePercent = totalMetricWeight > 0 ? (availableWeight / totalMetricWeight) * 100 : 0;
  const coveragePercent = Math.round(rawCoveragePercent);
  const score = availableWeight > 0
    ? clampPercent(Math.round(subMetrics.reduce((sum, metric) => sum + metric.contribution, 0) / availableWeight))
    : null;
  const weight = COMPANY_HEALTH_WEIGHTS[key];
  const weakest = weakestSubMetric(subMetrics);
  const allMissing = availableWeight === 0;
  const hasMissingSubMetrics = subMetrics.some(metric => !metric.isScorable);
  const hasCriticalAmbiguity = subMetrics.some(metric => isCriticalMetricGap(metric, subMetrics));
  const dataConfidence = confidenceForCoverage(rawCoveragePercent, hasCriticalAmbiguity);
  const isEligible = score !== null && rawCoveragePercent >= MIN_DIRECTION_COVERAGE_PERCENT;
  const coverageAdjustedScore = totalMetricWeight > 0
    ? clampPercent(Math.round(subMetrics.reduce((sum, metric) => sum + metric.contribution, 0) / totalMetricWeight))
    : null;
  const fallbackReason = allMissing
    ? 'Недостаточно данных'
    : weakest?.isScorable && weakest.score <= 55
      ? weakest.reason
      : hasMissingSubMetrics
        ? 'Часть источников отсутствует или неоднозначна.'
        : 'Отклонения по доступным данным в допустимой зоне.';
  const safeReason = reason || fallbackReason;

  return {
    key,
    title,
    score,
    weight,
    availableWeight: Number(availableWeight.toFixed(4)),
    totalWeight: Number(totalMetricWeight.toFixed(4)),
    rawCoveragePercent,
    coveragePercent,
    isEligible,
    coverageAdjustedScore,
    dataConfidence,
    status: dataConfidence,
    label: dataConfidence === 'insufficient'
      ? 'Недостаточно данных'
      : score >= 80
        ? 'Хорошо'
        : score >= 55
          ? 'Зона внимания'
          : 'Критично',
    weightedContribution: score === null ? 0 : Number((score * weight).toFixed(4)),
    weightedDeficit: score === null ? 0 : Number(((100 - score) * weight).toFixed(4)),
    subMetrics,
    primaryMetric: weakest?.isScorable ? `${weakest.title}: ${weakest.score}/100` : weakest?.title || 'Недостаточно данных',
    shortReason: safeReason,
    reason: safeReason,
    recommendedAction: recommendedAction || 'Проверьте направление и уточните исходные данные.',
    riskLevel: score === null ? 'insufficient' : riskLevelForScore(score),
    insufficientData: allMissing,
    hasMissingSubMetrics,
  };
}

function normalizeLegacyDirection(key, title, source = {}) {
  const numericScore = Number(source.score);
  const hasScore = source.score !== null && source.score !== undefined && source.score !== '' && Number.isFinite(numericScore);
  const subMetric = buildSubMetric({
    key: `${key}_legacy_score`,
    title: source.primaryMetric || title,
    score: hasScore ? numericScore : null,
    weight: 1,
    sourceStatus: source.insufficientData || !hasScore ? 'missing' : 'derived',
    reason: source.shortReason || (hasScore ? 'Оценка из доступных сигналов' : 'Недостаточно данных'),
  });

  return buildDirection({
    key,
    title,
    subMetrics: [subMetric],
    reason: source.insufficientData || !hasScore ? source.shortReason || 'Недостаточно данных' : source.shortReason || '',
    recommendedAction: source.recommendedAction,
  });
}

function normalizeDirection(key, title, source = {}) {
  if (Array.isArray(source.subMetrics) && source.subMetrics.length > 0) {
    const subMetrics = source.subMetrics.map(metric => buildSubMetric(metric));
    const direction = buildDirection({
      key,
      title,
      subMetrics,
      reason: source.reason || source.shortReason,
      recommendedAction: source.recommendedAction,
    });
    const normalized = {
      ...direction,
      financeEligibility: source.financeEligibility,
      missingCriticalSources: Array.isArray(source.missingCriticalSources) ? source.missingCriticalSources : [],
    };
    normalized.isEligible = isDirectionEligible(normalized);
    if (key === 'finance' && !normalized.isEligible) {
      normalized.availableDataScore = normalized.score;
      normalized.score = null;
      normalized.weightedContribution = 0;
      normalized.weightedDeficit = 0;
      normalized.riskLevel = 'insufficient';
      normalized.label = 'Недостаточно данных';
      normalized.shortReason = normalized.missingCriticalSources.length > 0
        ? `Недостаточно данных: ${normalized.missingCriticalSources.map(item => item.title).join(', ')}`
        : normalized.rawCoveragePercent < MIN_FINANCE_COVERAGE_PERCENT
          ? `Покрытие финансовых данных ниже ${MIN_FINANCE_COVERAGE_PERCENT}%`
          : normalized.shortReason;
      normalized.reason = normalized.shortReason;
    }
    return normalized;
  }

  const direction = normalizeLegacyDirection(key, title, source);
  const normalized = {
    ...direction,
    financeEligibility: source.financeEligibility,
    missingCriticalSources: Array.isArray(source.missingCriticalSources) ? source.missingCriticalSources : [],
  };
  normalized.isEligible = isDirectionEligible(normalized);
  if (key === 'finance' && !normalized.isEligible) {
    normalized.availableDataScore = normalized.score;
    normalized.score = null;
    normalized.weightedContribution = 0;
    normalized.weightedDeficit = 0;
    normalized.riskLevel = 'insufficient';
    normalized.label = 'Недостаточно данных';
  }
  return normalized;
}

export function calculateCompanyHealthScore(directionScores = []) {
  const byKey = new Map(directionScores.map(item => [item?.key, item]).filter(([key]) => key));
  const directions = COMPANY_HEALTH_DIRECTIONS.map(({ key, title }) => normalizeDirection(key, title, byKey.get(key) || {}));
  const eligibleDirections = directions.filter(isDirectionEligible);
  const availableCompanyWeight = eligibleDirections.reduce((sum, item) => sum + item.weight, 0);
  const rawTotalCoveragePercent = directions.reduce(
    (sum, item) => sum + item.weight * item.rawCoveragePercent,
    0,
  );
  const totalCoveragePercent = Math.round(rawTotalCoveragePercent);
  const rawScore = availableCompanyWeight > 0
    ? clampPercent(Math.round(eligibleDirections.reduce((sum, item) => sum + item.score * item.weight, 0) / availableCompanyWeight))
    : null;
  // Full-denominator coverage adjustment: unavailable company/sub-metric weight contributes zero.
  // This keeps missing or ambiguous data from improving the displayed management score.
  const adjustedScore = eligibleDirections.length > 0
    ? clampPercent(Math.round(eligibleDirections.reduce(
        (sum, item) => sum + item.coverageAdjustedScore * item.weight,
        0,
      )))
    : null;
  const missingCriticalMetrics = directions.flatMap(direction => [
    ...direction.subMetrics
      .filter(metric => isCriticalMetricGap(metric, direction.subMetrics))
      .map(metric => ({ key: metric.key, title: metric.title, direction: direction.title, sourceStatus: metric.sourceStatus })),
    ...(direction.missingCriticalSources || []).map(metric => ({
      key: metric.key,
      title: metric.title,
      direction: direction.title,
      sourceStatus: metric.sourceStatus || 'missing',
    })),
  ]);
  const hasCriticalMissing = missingCriticalMetrics.length > 0;
  const confidence = confidenceForCoverage(rawTotalCoveragePercent, hasCriticalMissing);
  const isPreliminary = rawTotalCoveragePercent < 60;
  const totalScore = rawTotalCoveragePercent < 30 ? null : adjustedScore;
  const displayLabel = rawTotalCoveragePercent < 30
    ? 'Недостаточно данных для оценки'
    : isPreliminary
      ? 'Предварительная оценка'
      : totalScore >= 80
        ? 'Хорошо'
        : totalScore >= 55
          ? 'Зона внимания'
          : 'Критично';
  const byWeakest = (left, right) => (left.score ?? 101) - (right.score ?? 101) || right.weight - left.weight || left.title.localeCompare(right.title, 'ru');
  const byStrongest = (left, right) => (right.score ?? -1) - (left.score ?? -1) || right.weight - left.weight || left.title.localeCompare(right.title, 'ru');
  const byFixImpact = (left, right) => right.weightedDeficit - left.weightedDeficit || byWeakest(left, right);

  return {
    totalScore,
    rawScore,
    adjustedScore: totalScore,
    maxScore: 100,
    rawTotalCoveragePercent,
    totalCoveragePercent,
    confidence,
    isPreliminary,
    displayLabel,
    directionScores: directions.map(item => ({ key: item.key, score: item.score, coveragePercent: item.coveragePercent, isEligible: item.isEligible })),
    excludedDirections: directions.filter(item => !isDirectionEligible(item)).map(item => item.key),
    missingCriticalMetrics,
    directions,
    weakestDirections: directions.slice().sort(byWeakest),
    strongestDirections: directions.slice().sort(byStrongest),
    focusDirections: directions.slice().sort(byFixImpact),
  };
}

function buildFinanceDirection(input, contours) {
  const actualReceipts = firstFiniteInput(input, ['actualReceiptsAmount']);
  const accruedRevenue = firstFiniteInput(input, ['accruedRentalRevenueAmount']);
  const invoicedAmount = firstFiniteInput(input, ['invoicedAmount']);
  const approvedRevenuePlan = firstFiniteInput(input, ['approvedRevenuePlanAmount']);
  const overdueAmount = firstFiniteInput(input, ['overdueReceivablesAmount', 'overdueDebtAmount']);
  const totalDebt = firstFiniteInput(input, ['totalDebt', 'receivablesAmount']);
  const operatingInflows = firstFiniteInput(input, ['actualOperatingInflowsAmount']);
  const operatingOutflows = firstFiniteInput(input, ['actualOperatingOutflowsAmount']);
  const actualExpenses = firstFiniteInput(input, ['actualExpenseAmount', 'actualOperatingOutflowsAmount']);
  const approvedExpensePlan = firstFiniteInput(input, ['approvedExpensePlanAmount']);
  const actualReceiptsAvailable = input.actualReceiptsAvailable === true && actualReceipts !== null;
  const overdueReceivablesAvailable = input.overdueReceivablesAvailable === true && overdueAmount !== null;
  const operatingInflowsAvailable = input.actualOperatingInflowsAvailable === true && operatingInflows !== null;
  const operatingOutflowsAvailable = input.actualOperatingOutflowsAvailable === true && operatingOutflows !== null;
  const actualExpensesAvailable = input.actualExpensesAvailable === true && actualExpenses !== null;

  const receiptsDetails = [
    `Поступило: ${actualReceiptsAvailable ? formatFinanceAmount(actualReceipts) : 'недостаточно данных'}`,
    `Начислено: ${formatFinanceAmount(accruedRevenue)}`,
    invoicedAmount !== null ? `Выставлено: ${formatFinanceAmount(invoicedAmount)}` : '',
    `План поступлений: ${approvedRevenuePlan !== null && approvedRevenuePlan > 0 ? formatFinanceAmount(approvedRevenuePlan) : 'не задан'}`,
  ];
  const receiptsScore = actualReceiptsAvailable && approvedRevenuePlan !== null && approvedRevenuePlan > 0
    ? planPerformanceScore(nonNegative(actualReceipts), nonNegative(approvedRevenuePlan))
    : null;
  const receiptsMetric = receiptsScore !== null
    ? buildSubMetric({
        key: 'finance_receipts_to_plan',
        title: 'Поступления к плану',
        score: receiptsScore,
        weight: 0.40,
        sourceStatus: 'derived',
        details: receiptsDetails,
        reason: receiptsScore < 75
          ? 'Низкие поступления к плану'
          : `Поступления ${Math.round((nonNegative(actualReceipts) / Math.max(nonNegative(approvedRevenuePlan), 1)) * 100)}% к утверждённому плану`,
      })
    : buildSubMetric({
        key: 'finance_receipts_to_plan',
        title: 'Поступления к плану',
        weight: 0.40,
        sourceStatus: 'missing',
        details: receiptsDetails,
        reason: approvedRevenuePlan === null || approvedRevenuePlan <= 0
          ? 'Утверждённый план поступлений не задан'
          : 'Нет фактических поступлений за текущий период',
      });

  const overdueMetric = overdueReceivablesAvailable
    ? buildSubMetric({
        key: 'finance_overdue_receivables',
        title: 'Просроченная дебиторка',
        score: overduePressureScore(nonNegative(overdueAmount), Math.max(nonNegative(totalDebt), nonNegative(accruedRevenue), nonNegative(overdueAmount))),
        weight: 0.30,
        sourceStatus: 'derived',
        details: [`Просрочено: ${formatFinanceAmount(overdueAmount)}`],
        reason: overdueAmount > 0 ? 'Высокая просроченная дебиторка' : 'Просроченная дебиторка не выявлена',
      })
    : buildSubMetric({
        key: 'finance_overdue_receivables',
        title: 'Просроченная дебиторка',
        weight: 0.30,
        sourceStatus: overdueAmount !== null ? 'ambiguous' : 'missing',
        details: [`Просрочено: ${overdueAmount !== null ? formatFinanceAmount(overdueAmount) : 'недостаточно данных'}`],
        reason: 'Источник просроченной дебиторской задолженности недоступен или неоднозначен',
      });

  const cashFlowMetric = operatingInflowsAvailable && operatingOutflowsAvailable
    ? (() => {
        const inflows = nonNegative(operatingInflows);
        const outflows = nonNegative(operatingOutflows);
        const netCashFlow = inflows - outflows;
        const pressure = Math.max(0, outflows - inflows) / Math.max(inflows, 1);
        return buildSubMetric({
          key: 'finance_cash_flow',
          title: 'Денежный поток',
          score: ratioScore(pressure, [[0.05, 98], [0.20, 84], [0.40, 62], [0.65, 38], [Infinity, 18]]),
          weight: 0.20,
          sourceStatus: 'derived',
          details: [
            `Операционные поступления: ${formatFinanceAmount(inflows)}`,
            `Операционные расходы: ${formatFinanceAmount(outflows)}`,
            `Денежный поток: ${formatFinanceAmount(netCashFlow)}`,
          ],
          reason: netCashFlow < 0 ? 'Фактические операционные расходы превышают поступления' : 'Фактический операционный денежный поток неотрицательный',
        });
      })()
    : buildSubMetric({
        key: 'finance_cash_flow',
        title: 'Денежный поток',
        weight: 0.20,
        sourceStatus: 'missing',
        details: [
          `Операционные поступления: ${operatingInflowsAvailable ? formatFinanceAmount(operatingInflows) : 'недостаточно данных'}`,
          `Операционные расходы: ${operatingOutflowsAvailable ? formatFinanceAmount(operatingOutflows) : 'недостаточно данных'}`,
          'Денежный поток: недостаточно данных',
        ],
        reason: 'Нет данных об операционных расходах для расчёта денежного потока',
      });

  const expenseDetails = [
    `Расходы: ${actualExpensesAvailable ? formatFinanceAmount(actualExpenses) : 'недостаточно данных'}`,
    `План расходов: ${approvedExpensePlan !== null && approvedExpensePlan > 0 ? formatFinanceAmount(approvedExpensePlan) : 'не задан'}`,
  ];
  const costMetric = actualExpensesAvailable && approvedExpensePlan !== null && approvedExpensePlan > 0
    ? (() => {
        const ratio = nonNegative(actualExpenses) / Math.max(nonNegative(approvedExpensePlan), 1);
        return buildSubMetric({
          key: 'finance_cost_pressure',
          title: 'Расходы к плану',
          score: ratioScore(ratio, [[0.8, 95], [1.0, 84], [1.15, 66], [1.30, 45], [Infinity, 24]]),
          weight: 0.10,
          sourceStatus: 'derived',
          details: expenseDetails,
          reason: ratio > 1.15 ? 'Расходы выше безопасного уровня' : 'Расходы в пределах безопасного уровня',
        });
      })()
    : buildSubMetric({
        key: 'finance_cost_pressure',
        title: 'Расходы к плану',
        weight: 0.10,
        sourceStatus: 'missing',
        details: expenseDetails,
        reason: approvedExpensePlan === null || approvedExpensePlan <= 0
          ? 'Утверждённый план расходов не задан'
          : 'Нет фактических расходов за текущий период',
      });

  const subMetrics = [receiptsMetric, overdueMetric, cashFlowMetric, costMetric];
  const weakest = weakestSubMetric(subMetrics);
  const actionByMetric = {
    finance_receipts_to_plan: 'Задайте утверждённый план поступлений и сверяйте его с фактическими оплатами.',
    finance_overdue_receivables: 'Разберите просроченную дебиторку и закрепите следующий шаг взыскания.',
    finance_cash_flow: 'Соберите ближайшие поступления и перенесите необязательные платежи.',
    finance_cost_pressure: 'Проверьте крупные расходы и лимиты закупок.',
  };

  const direction = buildDirection({
    key: 'finance',
    title: 'Финансы',
    subMetrics,
    reason: weakest?.score <= 55 || weakest?.sourceStatus === 'missing' ? weakest.reason : 'Финансовый контур в рабочей зоне по доступным данным.',
    recommendedAction: actionByMetric[weakest?.key] || 'Проверьте финансовые отклонения.',
  });
  const missingCriticalSources = [
    !actualReceiptsAvailable
      ? { key: 'finance_actual_receipts', title: 'Фактические поступления', sourceStatus: actualReceipts !== null ? 'ambiguous' : 'missing' }
      : null,
  ].filter(Boolean);

  return {
    ...direction,
    financeEligibility: {
      actualReceiptsAvailable,
      overdueReceivablesAvailable,
    },
    missingCriticalSources,
    isEligible: direction.score !== null
      && direction.rawCoveragePercent >= MIN_FINANCE_COVERAGE_PERCENT
      && actualReceiptsAvailable
      && overdueReceivablesAvailable,
  };
}

function utilizationScore(utilization) {
  const value = clampPercent(utilization);
  if (value >= 75 && value <= 90) return 100;
  if (value > 90) return 92;
  if (value >= 65) return 88;
  if (value >= 50) return 72;
  if (value >= 35) return 50;
  if (value > 0) return 32;
  return 20;
}

function buildRentalDirection(input, contours) {
  const rentalsCount = contours.rentals.count;
  const utilization = firstFiniteInput(input, ['utilization']);
  const activeEquipment = firstFiniteInput(input, ['activeEquipment', 'activeFleetCount']);
  const availableEquipment = firstFiniteInput(input, ['availableEquipment']);
  const rentalRevenueActual = firstFiniteInput(input, ['rentalRevenueActual', 'monthlyRevenue']);
  const rentalRevenuePlan = firstFiniteInput(input, ['rentalRevenuePlan', 'fleetMonthlyRevenuePlan']);
  const starts = firstFiniteInput(input, ['rentalStartsThisMonth', 'newRentalsCount']);
  const returns = firstFiniteInput(input, ['rentalReturnsThisMonth', 'rentalsReturningThisMonth']);
  const extensions = firstFiniteInput(input, ['rentalExtensionsThisMonth', 'extendedRentalsCount']);
  const reservations = firstFiniteInput(input, ['reservedRentalsCount']);

  const hasFleetBase = contours.equipment.count > 0 || (activeEquipment !== null && activeEquipment > 0);
  const utilizationMetric = utilization !== null && hasFleetBase
    ? buildSubMetric({
        key: 'rental_utilization',
        title: 'Загрузка техники',
        score: utilizationScore(utilization),
        weight: 0.50,
        sourceStatus: 'derived',
        reason: utilization < 60 ? 'Загрузка ниже целевого уровня' : 'Загрузка техники в целевой зоне',
      })
    : buildSubMetric({
        key: 'rental_utilization',
        title: 'Загрузка техники',
        weight: 0.50,
        sourceStatus: 'missing',
        reason: 'Недостаточно данных по загрузке техники',
      });

  const revenueMetric = rentalRevenuePlan !== null && rentalRevenuePlan > 0 && rentalRevenueActual !== null
    ? buildSubMetric({
        key: 'rental_revenue_to_plan',
        title: 'Выручка аренды к плану',
        score: planPerformanceScore(nonNegative(rentalRevenueActual), nonNegative(rentalRevenuePlan)),
        weight: 0.25,
        sourceStatus: 'ambiguous',
        reason: nonNegative(rentalRevenueActual) < nonNegative(rentalRevenuePlan) * 0.75
          ? 'Выручка аренды ниже плана'
          : 'Выручка аренды близка к плану',
      })
    : rentalRevenueActual !== null && rentalRevenueActual > 0
      ? buildSubMetric({
          key: 'rental_revenue_to_plan',
          title: 'Выручка аренды к плану',
          score: 82,
          weight: 0.25,
          sourceStatus: 'ambiguous',
          reason: 'Выручка аренды есть, но план сравнения не задан',
        })
      : buildSubMetric({
          key: 'rental_revenue_to_plan',
          title: 'Выручка аренды к плану',
          weight: 0.25,
          sourceStatus: 'missing',
          reason: 'Недостаточно данных по плану выручки аренды',
        });

  const idleMetric = activeEquipment !== null && activeEquipment > 0 && availableEquipment !== null
    ? (() => {
        const idleRatio = nonNegative(availableEquipment) / Math.max(nonNegative(activeEquipment), 1);
        return buildSubMetric({
          key: 'rental_idle_fleet',
          title: 'Простои',
          score: ratioScore(idleRatio, [[0.10, 96], [0.25, 82], [0.40, 62], [0.60, 38], [Infinity, 18]]),
          weight: 0.15,
          sourceStatus: 'derived',
          reason: idleRatio > 0.4 ? 'Много свободной техники' : 'Свободный парк в допустимых пределах',
        });
      })()
    : utilization !== null && hasFleetBase
      ? buildSubMetric({
          key: 'rental_idle_fleet',
          title: 'Простои',
          score: ratioScore(1 - clampPercent(utilization) / 100, [[0.10, 92], [0.25, 78], [0.40, 58], [0.60, 34], [Infinity, 18]]),
          weight: 0.15,
          sourceStatus: 'derived',
          reason: utilization < 60 ? 'Много свободной техники' : 'Простой оценен через загрузку',
        })
      : buildSubMetric({
          key: 'rental_idle_fleet',
          title: 'Простои',
          weight: 0.15,
          sourceStatus: 'missing',
          reason: 'Недостаточно данных по свободной технике',
        });

  const hasMovementSource = rentalsCount > 0 && [starts, returns, extensions, reservations].some(value => value !== null);
  const movementMetric = hasMovementSource
    ? (() => {
        const incoming = nonNegative(starts) + nonNegative(extensions) + nonNegative(reservations) * 0.5;
        const outgoing = nonNegative(returns);
        const score = outgoing <= 0
          ? incoming > 0 ? 100 : 78
          : ratioScore(incoming / Math.max(outgoing, 1), [[0.25, 32], [0.6, 55], [0.9, 76], [Infinity, 94]]);
        return buildSubMetric({
          key: 'rental_movement',
          title: 'Движение аренды',
          score,
          weight: 0.10,
          reason: outgoing > incoming ? 'Возвраты опережают новые выдачи' : 'Возвраты, продления и новые выдачи сбалансированы',
          sourceStatus: 'derived',
        });
      })()
    : rentalsCount > 0
      ? buildSubMetric({
          key: 'rental_movement',
          title: 'Движение аренды',
          score: safeCount(input.overdueReturnsCount) > 0 ? 45 : safeCount(input.returnsTodayCount) > 0 ? 68 : 80,
          weight: 0.10,
          sourceStatus: 'ambiguous',
          reason: safeCount(input.overdueReturnsCount) > 0
            ? 'Возвраты требуют контроля'
            : 'Движение аренды оценено по возвратам и активным записям',
        })
      : buildSubMetric({
          key: 'rental_movement',
          title: 'Движение аренды',
          weight: 0.10,
          sourceStatus: 'missing',
          reason: 'Недостаточно данных по движению аренды',
        });

  const subMetrics = [utilizationMetric, revenueMetric, idleMetric, movementMetric];
  const weakest = weakestSubMetric(subMetrics);
  const actionByMetric = {
    rental_utilization: 'Проверьте свободные единицы и ближайшие брони.',
    rental_revenue_to_plan: 'Сверьте план выручки и приоритетные сделки месяца.',
    rental_idle_fleet: 'Разберите свободную технику по типам и направьте в продажи аренды.',
    rental_movement: 'Сбалансируйте возвраты, продления и новые выдачи.',
  };

  return buildDirection({
    key: 'rental',
    title: 'Аренда',
    subMetrics,
    reason: weakest?.score <= 55 || weakest?.sourceStatus === 'missing' ? weakest.reason : 'Арендный контур работает без критичных отклонений.',
    recommendedAction: actionByMetric[weakest?.key] || 'Проверьте аренды и загрузку.',
  });
}

function buildRisksDirection(input, contours, hasScoreBase) {
  const overdueAmount = firstFiniteInput(input, ['overdueReceivablesAmount', 'overdueDebtAmount']);
  const totalDebt = firstFiniteInput(input, ['totalDebt', 'receivablesAmount']);
  const monthlyRevenue = firstFiniteInput(input, ['monthlyRevenue', 'financeRevenuePlan']);
  const debt30Plus = firstFiniteInput(input, ['debt30PlusAmount']);
  const debt60Plus = firstFiniteInput(input, ['debt60PlusAmount']);
  const debt90Plus = firstFiniteInput(input, ['debt90PlusAmount']);
  const largestDebt = firstFiniteInput(input, ['largestProblemDebtAmount', 'largestClientDebtAmount']);
  const problemClients = firstFiniteInput(input, ['problemClientCount', 'overdueReceivablesClients']);
  const criticalRiskSignals = safeCount(input.criticalSignals)
    + safeCount(input.invalidCriticalSignals)
    + safeCount(input.noActiveFleetCritical)
    + safeCount(input.overdueReturnsCount)
    + safeCount(input.oldDebtCount)
    + safeCount(input.serviceCriticalCount)
    + safeCount(input.overdueDocumentsCount)
    + safeCount(input.overdueDeliveriesCount);
  const warningRiskSignals = safeCount(input.lowUtilizationRisk)
    + safeCount(input.returnsTodayCount)
    + safeCount(input.overdueReceivablesCount)
    + safeCount(input.serviceRiskCount)
    + safeCount(input.unsignedDocumentsCount)
    + safeCount(input.unassignedDeliveriesCount);
  const riskSignals = criticalRiskSignals + warningRiskSignals;
  const hasDebtSource = Boolean(input.hasDebtSourceData)
    || hasAnyFiniteInput(input, ['overdueReceivablesAmount', 'totalDebt', 'debt30PlusAmount', 'debt60PlusAmount', 'debt90PlusAmount', 'largestProblemDebtAmount'])
    || contours.payments.count > 0;

  const overdueMetric = overdueAmount !== null
    ? buildSubMetric({
        key: 'risks_overdue_receivables',
        title: 'Просроченная дебиторка',
        score: overduePressureScore(nonNegative(overdueAmount), Math.max(nonNegative(totalDebt), nonNegative(monthlyRevenue), nonNegative(overdueAmount)), true),
        weight: 0.45,
        sourceStatus: 'derived',
        reason: overdueAmount > 0 ? 'Высокая просроченная дебиторка' : 'Просроченная дебиторка не выявлена',
      })
    : hasDebtSource && hasFiniteInput(input, 'overdueReceivablesCount')
      ? buildSubMetric({
          key: 'risks_overdue_receivables',
          title: 'Просроченная дебиторка',
          score: safeCount(input.overdueReceivablesCount) > 0 ? 35 : 100,
          weight: 0.45,
          sourceStatus: 'derived',
          reason: safeCount(input.overdueReceivablesCount) > 0 ? 'Есть просроченная дебиторка' : 'Просрочка не зафиксирована',
        })
      : hasDebtSource
        ? buildSubMetric({
            key: 'risks_overdue_receivables',
            title: 'Просроченная дебиторка',
            score: 100,
            weight: 0.45,
            sourceStatus: 'ambiguous',
            reason: 'Просрочка не зафиксирована',
          })
        : buildSubMetric({
            key: 'risks_overdue_receivables',
            title: 'Просроченная дебиторка',
            weight: 0.45,
            sourceStatus: 'missing',
            reason: 'Недостаточно данных по просрочке',
          });

  const ageMetric = [debt30Plus, debt60Plus, debt90Plus].some(value => value !== null)
    ? (() => {
        const base = Math.max(nonNegative(totalDebt), nonNegative(overdueAmount), nonNegative(debt30Plus), nonNegative(debt60Plus), nonNegative(debt90Plus), 1);
        const pressure = (nonNegative(debt30Plus) * 0.45 + nonNegative(debt60Plus) * 0.75 + nonNegative(debt90Plus)) / base;
        return buildSubMetric({
          key: 'risks_old_debt',
          title: 'Долги старше 30/60/90 дней',
          score: ratioScore(pressure, [[0.03, 92], [0.10, 72], [0.20, 48], [0.40, 26], [Infinity, 8]]),
          weight: 0.25,
          sourceStatus: 'ambiguous',
          reason: nonNegative(debt90Plus) > 0 || nonNegative(debt60Plus) > 0
            ? 'Долг старше 30 дней'
            : nonNegative(debt30Plus) > 0
              ? 'Есть долг старше 30 дней'
              : 'Старые долги не выявлены',
        });
      })()
    : safeCount(input.oldDebtCount) > 0
      ? buildSubMetric({
          key: 'risks_old_debt',
          title: 'Долги старше 30/60/90 дней',
          score: 30,
          weight: 0.25,
          sourceStatus: 'ambiguous',
          reason: 'Долг старше 30 дней',
        })
      : hasDebtSource
        ? buildSubMetric({
            key: 'risks_old_debt',
            title: 'Долги старше 30/60/90 дней',
            score: 100,
            weight: 0.25,
            sourceStatus: 'ambiguous',
            reason: 'Старые долги не выявлены',
          })
        : buildSubMetric({
            key: 'risks_old_debt',
            title: 'Долги старше 30/60/90 дней',
            weight: 0.25,
            sourceStatus: 'missing',
            reason: 'Недостаточно данных по возрасту долга',
          });

  const concentrationMetric = largestDebt !== null || problemClients !== null
    ? (() => {
        const base = Math.max(nonNegative(totalDebt), nonNegative(overdueAmount), nonNegative(largestDebt), 1);
        const concentration = nonNegative(largestDebt) / base;
        const count = nonNegative(problemClients);
        const score = nonNegative(largestDebt) > 0
          ? ratioScore(concentration, [[0.15, 88], [0.30, 64], [0.50, 38], [Infinity, 16]])
          : count > 0
            ? 62
            : 100;
        return buildSubMetric({
          key: 'risks_problem_clients',
          title: 'Крупные проблемные клиенты',
          score,
          weight: 0.20,
          sourceStatus: 'ambiguous',
          reason: nonNegative(largestDebt) > 0 && concentration >= 0.3
            ? 'Есть крупный проблемный долг'
            : count > 0
              ? 'Есть проблемные клиенты'
              : 'Крупных проблемных клиентов не выявлено',
        });
      })()
    : hasDebtSource
      ? buildSubMetric({
          key: 'risks_problem_clients',
          title: 'Крупные проблемные клиенты',
          score: 100,
          weight: 0.20,
          sourceStatus: 'ambiguous',
          reason: 'Крупная концентрация риска не выявлена',
        })
      : buildSubMetric({
          key: 'risks_problem_clients',
          title: 'Крупные проблемные клиенты',
          weight: 0.20,
          sourceStatus: 'missing',
          reason: 'Недостаточно данных по концентрации риска',
        });

  const operationalMetric = hasScoreBase || riskSignals > 0
    ? buildSubMetric({
        key: 'risks_critical_events',
        title: 'Критические операционные события',
        score: clampPercent(100 - Math.min(100, criticalRiskSignals * 20 + warningRiskSignals * 8)),
        weight: 0.10,
        sourceStatus: 'derived',
        reason: criticalRiskSignals > 0
          ? 'Нужны ограничения по новым отгрузкам'
          : warningRiskSignals > 0
            ? 'Есть операционные предупреждения'
            : 'Критические операционные события не выявлены',
      })
    : buildSubMetric({
        key: 'risks_critical_events',
        title: 'Критические операционные события',
        weight: 0.10,
        sourceStatus: 'missing',
        reason: 'Недостаточно данных по операционным событиям',
      });

  const subMetrics = [overdueMetric, ageMetric, concentrationMetric, operationalMetric];
  const weakest = weakestSubMetric(subMetrics);
  const actionByMetric = {
    risks_overdue_receivables: 'Остановите новые отгрузки клиентам с просрочкой до плана оплаты.',
    risks_old_debt: 'Назначьте план взыскания по долгам 30+ и 60+ дней.',
    risks_problem_clients: 'Разберите крупнейшего должника и проверьте кредитные лимиты.',
    risks_critical_events: 'Закройте критические операционные события до новых отгрузок.',
  };

  return buildDirection({
    key: 'risks',
    title: 'Риски',
    subMetrics,
    reason: weakest?.score <= 55 || weakest?.sourceStatus === 'missing' ? weakest.reason : 'Критичных рисков по доступным данным нет.',
    recommendedAction: actionByMetric[weakest?.key] || 'Проверьте риски перед новыми отгрузками.',
  });
}

function buildServiceDirection(input, contours) {
  const activeEquipment = firstFiniteInput(input, ['activeEquipment', 'activeFleetCount']);
  const inServiceEquipment = firstFiniteInput(input, ['equipmentInServiceCount']);
  const openTickets = firstFiniteInput(input, ['openServiceTicketsCount']);
  const overdueTickets = firstFiniteInput(input, ['overdueServiceTicketsCount']);
  const repeatFailures = firstFiniteInput(input, ['repeatServiceFailuresCount']);
  const averageDays = firstFiniteInput(input, ['averageServiceDays']);
  const serviceLoadPercent = firstFiniteInput(input, ['serviceLoadPercent']);
  const serviceCount = contours.service.count;
  const hasServiceSource = serviceCount > 0 || openTickets !== null;

  const readinessMetric = activeEquipment !== null && activeEquipment > 0 && inServiceEquipment !== null
    ? (() => {
        const readyRatio = Math.max(0, activeEquipment - nonNegative(inServiceEquipment)) / Math.max(nonNegative(activeEquipment), 1);
        return buildSubMetric({
          key: 'service_fleet_readiness',
          title: 'Готовность техники',
          score: ratioScore(1 - readyRatio, [[0.05, 96], [0.15, 82], [0.30, 58], [0.50, 34], [Infinity, 14]]),
          weight: 0.40,
          sourceStatus: 'ambiguous',
          reason: readyRatio < 0.75 ? 'Готовность техники ниже нормы' : 'Готовность техники в рабочей зоне',
        });
      })()
    : buildSubMetric({
        key: 'service_fleet_readiness',
        title: 'Готовность техники',
        weight: 0.40,
        sourceStatus: 'missing',
        reason: 'Недостаточно данных по готовности техники',
      });

  const overdueMetric = hasServiceSource && openTickets !== null && overdueTickets !== null
    ? (() => {
        const ratio = openTickets > 0 ? nonNegative(overdueTickets) / Math.max(nonNegative(openTickets), 1) : 0;
        return buildSubMetric({
          key: 'service_overdue_repairs',
          title: 'Просроченные ремонты',
          score: ratioScore(ratio, [[0, 100], [0.05, 88], [0.15, 66], [0.30, 42], [Infinity, 18]]),
          weight: 0.25,
          sourceStatus: 'derived',
          reason: overdueTickets > 0 ? 'Есть просроченные ремонты' : 'Просроченные ремонты не выявлены',
        });
      })()
    : hasServiceSource
      ? buildSubMetric({
          key: 'service_overdue_repairs',
          title: 'Просроченные ремонты',
          score: safeCount(input.serviceCriticalCount) > 0 ? 42 : 100,
          weight: 0.25,
          sourceStatus: 'ambiguous',
          reason: safeCount(input.serviceCriticalCount) > 0 ? 'Есть просроченные ремонты' : 'Просроченные ремонты не выявлены',
        })
      : buildSubMetric({
          key: 'service_overdue_repairs',
          title: 'Просроченные ремонты',
          weight: 0.25,
          sourceStatus: 'missing',
          reason: 'Недостаточно данных по просроченным ремонтам',
        });

  const repeatMetric = repeatFailures !== null
    ? buildSubMetric({
        key: 'service_repeat_repairs',
        title: 'Повторные ремонты',
        score: ratioScore(nonNegative(repeatFailures), [[0, 100], [1, 78], [3, 52], [6, 28], [Infinity, 12]]),
        weight: 0.15,
        sourceStatus: 'ambiguous',
        reason: repeatFailures > 0 ? 'Повторные ремонты растут' : 'Повторные ремонты не выявлены',
      })
    : buildSubMetric({
        key: 'service_repeat_repairs',
        title: 'Повторные ремонты',
        weight: 0.15,
        sourceStatus: 'missing',
        reason: 'Недостаточно данных по повторным ремонтам',
      });

  const durationMetric = averageDays !== null
    ? buildSubMetric({
        key: 'service_average_duration',
        title: 'Средний срок ремонта',
        score: ratioScore(nonNegative(averageDays), [[2, 96], [4, 82], [7, 62], [14, 34], [Infinity, 14]]),
        weight: 0.10,
        sourceStatus: 'ambiguous',
        reason: averageDays > 7 ? 'Средний срок ремонта выше безопасного уровня' : 'Средний срок ремонта в допустимой зоне',
      })
    : hasServiceSource
      ? buildSubMetric({
          key: 'service_average_duration',
          title: 'Средний срок ремонта',
          score: 78,
          weight: 0.10,
          sourceStatus: 'ambiguous',
          reason: 'Срок ремонта оценен без полной детализации',
        })
      : buildSubMetric({
          key: 'service_average_duration',
          title: 'Средний срок ремонта',
          weight: 0.10,
          sourceStatus: 'missing',
          reason: 'Недостаточно данных по срокам ремонта',
        });

  const loadMetric = serviceLoadPercent !== null
    ? buildSubMetric({
        key: 'service_sla_load',
        title: 'SLA / загрузка механиков',
        score: ratioScore(nonNegative(serviceLoadPercent) / 100, [[0.35, 92], [0.75, 86], [0.95, 72], [1.10, 52], [Infinity, 28]]),
        weight: 0.10,
        sourceStatus: 'ambiguous',
        reason: serviceLoadPercent > 100 ? 'SLA под давлением из-за загрузки механиков' : 'Загрузка механиков в рабочей зоне',
      })
    : hasServiceSource
      ? buildSubMetric({
          key: 'service_sla_load',
          title: 'SLA / загрузка механиков',
          score: safeCount(input.serviceRiskCount) > 0 ? 58 : 86,
          weight: 0.10,
          sourceStatus: 'ambiguous',
          reason: safeCount(input.serviceRiskCount) > 0 ? 'SLA под давлением из-за блокеров' : 'Загрузка механиков без критичных блокеров',
        })
      : buildSubMetric({
          key: 'service_sla_load',
          title: 'SLA / загрузка механиков',
          weight: 0.10,
          sourceStatus: 'missing',
          reason: 'Недостаточно данных по SLA и загрузке механиков',
        });

  const subMetrics = [readinessMetric, overdueMetric, repeatMetric, durationMetric, loadMetric];
  const weakest = weakestSubMetric(subMetrics);
  const actionByMetric = {
    service_fleet_readiness: 'Освободите технику из сервиса, которая блокирует аренды.',
    service_overdue_repairs: 'Назначьте ответственных и сроки по просроченным ремонтам.',
    service_repeat_repairs: 'Проверьте причины повторов и качество закрытия работ.',
    service_average_duration: 'Разберите длинные ремонты и ожидание запчастей.',
    service_sla_load: 'Перераспределите очередь между механиками.',
  };

  return buildDirection({
    key: 'service',
    title: 'Сервис',
    subMetrics,
    reason: weakest?.score <= 55 || weakest?.sourceStatus === 'missing' ? weakest.reason : 'Сервисный контур без критичных блокеров.',
    recommendedAction: actionByMetric[weakest?.key] || 'Проверьте сервисные блокеры.',
  });
}

function buildClientsDirection(input) {
  const clientsCount = firstFiniteInput(input, ['clientsCount']);
  const newLeads = firstFiniteInput(input, ['newLeadsCount', 'crmNewLeadsCount']);
  const newClients = firstFiniteInput(input, ['newClientsThisMonth']);
  const activeClients = firstFiniteInput(input, ['activeClientsCount']);
  const repeatClients = firstFiniteInput(input, ['repeatClientsCount']);
  const wonDeals = firstFiniteInput(input, ['wonDealsCount', 'convertedDealsCount']);
  const dealsCount = firstFiniteInput(input, ['crmDealsCount', 'qualifiedDealsCount']);
  const clientBase = Math.max(nonNegative(clientsCount), 1);

  const demandTarget = Math.max(3, Math.ceil(clientBase * 0.05));
  const demandMetric = newLeads !== null
    ? buildSubMetric({
        key: 'clients_new_demand',
        title: 'Новые лиды',
        score: countAgainstTargetScore(nonNegative(newLeads), demandTarget),
        weight: 0.30,
        sourceStatus: 'real',
        reason: newLeads < demandTarget ? 'Недостаточно новых лидов' : 'Новые лиды поддерживают будущую выручку',
      })
    : newClients !== null
      ? buildSubMetric({
          key: 'clients_new_demand',
          title: 'Новые лиды',
          score: countAgainstTargetScore(nonNegative(newClients), Math.max(2, Math.ceil(clientBase * 0.04))),
          weight: 0.30,
          sourceStatus: 'ambiguous',
          reason: newClients <= 0 ? 'Недостаточно новых лидов' : 'Новый спрос оценен по новым клиентам',
        })
      : buildSubMetric({
          key: 'clients_new_demand',
          title: 'Новые лиды',
          weight: 0.30,
          sourceStatus: 'missing',
          reason: 'Недостаточно данных по новым лидам',
        });

  const activeMetric = clientsCount !== null && clientsCount > 0 && activeClients !== null
    ? (() => {
        const ratio = nonNegative(activeClients) / Math.max(nonNegative(clientsCount), 1);
        return buildSubMetric({
          key: 'clients_active_clients',
          title: 'Активные клиенты',
          score: ratioScore(1 - ratio, [[0.35, 92], [0.55, 76], [0.70, 58], [0.85, 36], [Infinity, 20]]),
          weight: 0.25,
          sourceStatus: 'derived',
          reason: ratio < 0.3 ? 'Мало активных клиентов' : 'Активная клиентская база поддерживает аренду',
        });
      })()
    : clientsCount !== null && clientsCount > 0
      ? buildSubMetric({
          key: 'clients_active_clients',
          title: 'Активные клиенты',
          score: 78,
          weight: 0.25,
          sourceStatus: 'ambiguous',
          reason: 'Активность клиентов оценена по наличию клиентской базы',
        })
      : buildSubMetric({
          key: 'clients_active_clients',
          title: 'Активные клиенты',
          weight: 0.25,
          sourceStatus: 'missing',
          reason: 'Недостаточно данных по активным клиентам',
        });

  const repeatMetric = clientsCount !== null && clientsCount > 0 && repeatClients !== null
    ? (() => {
        const ratio = nonNegative(repeatClients) / Math.max(nonNegative(clientsCount), 1);
        return buildSubMetric({
          key: 'clients_repeat_clients',
          title: 'Повторные клиенты',
          score: ratioScore(1 - ratio, [[0.45, 92], [0.65, 76], [0.80, 54], [0.92, 34], [Infinity, 18]]),
          weight: 0.25,
          sourceStatus: 'derived',
          reason: ratio < 0.2 ? 'Слабая повторная база' : 'Повторная клиентская база есть',
        });
      })()
    : buildSubMetric({
        key: 'clients_repeat_clients',
        title: 'Повторные клиенты',
        weight: 0.25,
        sourceStatus: 'missing',
        reason: 'Недостаточно данных по повторным клиентам',
      });

  const conversionMetric = wonDeals !== null && dealsCount !== null && dealsCount > 0
    ? (() => {
        const ratio = nonNegative(wonDeals) / Math.max(nonNegative(dealsCount), 1);
        return buildSubMetric({
          key: 'clients_conversion',
          title: 'Конверсия в сделку',
          score: ratioScore(1 - ratio, [[0.45, 94], [0.65, 76], [0.80, 52], [0.92, 32], [Infinity, 16]]),
          weight: 0.20,
          sourceStatus: 'derived',
          reason: ratio < 0.2 ? 'Конверсия ниже нормы' : 'Конверсия поддерживает воронку',
        });
      })()
    : buildSubMetric({
        key: 'clients_conversion',
        title: 'Конверсия в сделку',
        weight: 0.20,
        sourceStatus: 'missing',
        reason: 'Недостаточно данных по CRM-конверсии',
      });

  const subMetrics = [demandMetric, activeMetric, repeatMetric, conversionMetric];
  const weakest = weakestSubMetric(subMetrics);
  const actionByMetric = {
    clients_new_demand: 'Запустите добор лидов и проверьте источники обращений.',
    clients_active_clients: 'Верните в работу клиентов без активных сделок.',
    clients_repeat_clients: 'Соберите предложения для повторных клиентов.',
    clients_conversion: 'Разберите причины потерь в CRM-воронке.',
  };

  return buildDirection({
    key: 'clients',
    title: 'Клиенты',
    subMetrics,
    reason: weakest?.score <= 55 || weakest?.sourceStatus === 'missing' ? weakest.reason : 'Клиентский контур поддерживает будущую выручку.',
    recommendedAction: actionByMetric[weakest?.key] || 'Проверьте клиентскую воронку.',
  });
}

function buildFleetDirection(input, contours) {
  const equipmentCount = contours.equipment.count || firstFiniteInput(input, ['equipmentCount']);
  const activeEquipment = firstFiniteInput(input, ['activeEquipment', 'activeFleetCount']);
  const inServiceEquipment = firstFiniteInput(input, ['equipmentInServiceCount']);
  const inactiveEquipment = firstFiniteInput(input, ['inactiveEquipmentCount']);
  const agedEquipment = firstFiniteInput(input, ['agedEquipmentCount', 'oldEquipmentCount']);
  const highHoursEquipment = firstFiniteInput(input, ['highHoursEquipmentCount']);
  const plannedRevenueEquipment = firstFiniteInput(input, ['equipmentWithPlannedRevenueCount']);
  const topTypeShare = firstFiniteInput(input, ['fleetTopTypeShare']);
  const utilization = firstFiniteInput(input, ['utilization']);

  const healthMetric = equipmentCount !== null && equipmentCount > 0
    ? (() => {
        const blocked = nonNegative(inServiceEquipment) + nonNegative(inactiveEquipment);
        const base = Math.max(nonNegative(activeEquipment) || nonNegative(equipmentCount), 1);
        const unavailableRatio = blocked / base;
        const score = activeEquipment !== null || inServiceEquipment !== null || inactiveEquipment !== null
          ? ratioScore(unavailableRatio, [[0.05, 96], [0.15, 82], [0.30, 58], [0.50, 34], [Infinity, 16]])
          : safeCount(input.noActiveFleetCritical) > 0
            ? 24
            : utilization !== null
              ? utilizationScore(utilization)
              : 78;
        return buildSubMetric({
          key: 'fleet_health',
          title: 'Исправность парка',
          score,
          weight: 0.40,
          sourceStatus: 'ambiguous',
          reason: score < 60 ? 'Часть парка недоступна' : 'Исправность парка в рабочей зоне',
        });
      })()
    : buildSubMetric({
        key: 'fleet_health',
        title: 'Исправность парка',
        weight: 0.40,
        sourceStatus: 'missing',
        reason: 'Недостаточно данных по парку',
      });

  const ageMetric = equipmentCount !== null && equipmentCount > 0 && (agedEquipment !== null || highHoursEquipment !== null)
    ? (() => {
        const pressure = (nonNegative(agedEquipment) + nonNegative(highHoursEquipment) * 0.6) / Math.max(nonNegative(equipmentCount), 1);
        return buildSubMetric({
          key: 'fleet_age_wear',
          title: 'Возраст / износ',
          score: ratioScore(pressure, [[0.10, 94], [0.25, 78], [0.45, 56], [0.65, 34], [Infinity, 16]]),
          weight: 0.25,
          sourceStatus: 'derived',
          reason: pressure > 0.45 ? 'Есть риск по возрасту и износу парка' : 'Возраст и износ без критичного давления',
        });
      })()
    : buildSubMetric({
        key: 'fleet_age_wear',
        title: 'Возраст / износ',
        weight: 0.25,
        sourceStatus: 'missing',
        reason: 'Недостаточно данных по возрасту и износу',
      });

  const liquidityMetric = equipmentCount !== null && equipmentCount > 0 && plannedRevenueEquipment !== null
    ? (() => {
        const ratio = nonNegative(plannedRevenueEquipment) / Math.max(nonNegative(activeEquipment) || nonNegative(equipmentCount), 1);
        return buildSubMetric({
          key: 'fleet_liquidity',
          title: 'Ликвидность техники',
          score: ratioScore(1 - ratio, [[0.10, 92], [0.25, 78], [0.45, 56], [0.70, 34], [Infinity, 18]]),
          weight: 0.20,
          sourceStatus: 'ambiguous',
          reason: ratio < 0.55 ? 'Низкая ликвидность части техники' : 'Ликвидность оценена по плановой выручке техники',
        });
      })()
    : buildSubMetric({
        key: 'fleet_liquidity',
        title: 'Ликвидность техники',
        weight: 0.20,
        sourceStatus: 'missing',
        reason: 'Недостаточно данных по ликвидности техники',
      });

  const concentrationMetric = equipmentCount !== null && equipmentCount > 0 && topTypeShare !== null
    ? buildSubMetric({
        key: 'fleet_structure',
        title: 'Структура парка',
        score: ratioScore(clampPercent(topTypeShare) / 100, [[0.35, 94], [0.50, 82], [0.65, 62], [0.80, 40], [Infinity, 22]]),
        weight: 0.15,
        sourceStatus: 'derived',
        reason: topTypeShare > 65 ? 'Есть риск по структуре парка' : 'Структура парка без высокой концентрации',
      })
    : equipmentCount !== null && equipmentCount > 0
      ? buildSubMetric({
          key: 'fleet_structure',
          title: 'Структура парка',
          score: 70,
          weight: 0.15,
          sourceStatus: 'ambiguous',
          reason: 'Парк есть, но его вклад ограничен без загрузки',
        })
      : buildSubMetric({
          key: 'fleet_structure',
          title: 'Структура парка',
          weight: 0.15,
          sourceStatus: 'missing',
          reason: 'Недостаточно данных по структуре парка',
        });

  const subMetrics = [healthMetric, ageMetric, liquidityMetric, concentrationMetric];
  const weakest = weakestSubMetric(subMetrics);
  const actionByMetric = {
    fleet_health: 'Верните недоступную технику в готовый парк.',
    fleet_age_wear: 'Проверьте старые и высоконаработанные единицы на замену или ремонт.',
    fleet_liquidity: 'Проверьте технику без плановой выручки и низколиквидные позиции.',
    fleet_structure: 'Сверьте структуру парка с текущим спросом.',
  };

  return buildDirection({
    key: 'fleet',
    title: 'Парк',
    subMetrics,
    reason: weakest?.score <= 55 || weakest?.sourceStatus === 'missing' ? weakest.reason : 'Парк поддерживает операционную устойчивость.',
    recommendedAction: actionByMetric[weakest?.key] || 'Проверьте структуру и готовность парка.',
  });
}

function buildContourInput(input = {}) {
  return {
    equipment: {
      count: safeCount(input.equipmentCount),
      risk: safeCount(input.lowUtilizationRisk),
      critical: safeCount(input.noActiveFleetCritical),
    },
    rentals: {
      count: safeCount(input.rentalsCount),
      risk: safeCount(input.returnsTodayCount),
      critical: safeCount(input.overdueReturnsCount),
    },
    payments: {
      count: safeCount(input.paymentsCount),
      risk: safeCount(input.overdueReceivablesCount),
      critical: safeCount(input.oldDebtCount),
    },
    service: {
      count: safeCount(input.serviceCount),
      risk: safeCount(input.serviceRiskCount),
      critical: safeCount(input.serviceCriticalCount),
    },
    documents: {
      count: safeCount(input.documentsCount),
      risk: safeCount(input.unsignedDocumentsCount),
      critical: safeCount(input.overdueDocumentsCount),
    },
    deliveries: {
      count: safeCount(input.deliveriesCount),
      risk: safeCount(input.unassignedDeliveriesCount),
      critical: safeCount(input.overdueDeliveriesCount),
    },
  };
}

function buildCompanyHealthDirectionInputs(input, contours, hasScoreBase) {
  return [
    buildFinanceDirection(input, contours),
    buildRentalDirection(input, contours),
    buildRisksDirection(input, contours, hasScoreBase),
    buildServiceDirection(input, contours),
    buildClientsDirection(input),
    buildFleetDirection(input, contours),
  ];
}

export function buildCompanyHealthModel(input = {}) {
  const contours = buildContourInput(input);
  const contourStates = Object.entries(contours).map(([id, facts]) => {
    const status = contourStatus(facts);
    return {
      id,
      label: CONTOUR_LABELS[id],
      count: facts.count,
      status,
      stateLabel: contourStateLabel(status),
      tone: contourTone(status),
    };
  });
  const availableContours = contourStates.filter(item => item.count > 0).map(item => item.label);
  const missingContours = contourStates.filter(item => item.count <= 0).map(item => item.label);
  const hasEquipment = contours.equipment.count > 0;
  const hasOperationalData = OPERATIONAL_CONTOURS.some(id => contours[id].count > 0);
  const isEmpty = contourStates.every(item => item.count <= 0);
  const criticalSignals = safeCount(input.criticalSignals);
  const invalidCriticalSignals = safeCount(input.invalidCriticalSignals);
  const hasScoreBase = hasEquipment && hasOperationalData;
  const scoreDetails = calculateCompanyHealthScore(buildCompanyHealthDirectionInputs(input, contours, hasScoreBase));

  const score = scoreDetails.totalScore;
  const tone = score === null
    ? 'default'
    : score >= 80
      ? 'success'
      : score >= 55
        ? 'warning'
        : 'danger';
  const warningParts = [
    invalidCriticalSignals > 0 ? 'Есть сигналы без полного расчёта' : '',
    scoreDetails.missingCriticalMetrics.length > 0
      ? `Критические источники без оценки: ${scoreDetails.missingCriticalMetrics.map(item => item.title).join(', ')}`
      : '',
  ].filter(Boolean);

  return {
    score,
    label: scoreDetails.displayLabel,
    subtitle: scoreDetails.rawTotalCoveragePercent < 30
      ? 'Недостаточно данных для расчёта здоровья компании'
      : 'Формула: финансы 30%, аренда 25%, риски 20%, сервис 15%, клиенты 7%, парк 3%',
    tone,
    availableContours,
    missingContours,
    contourStates,
    scoreDetails,
    warning: warningParts.join('. '),
  };
}

export function alertHasValidSource(alert) {
  if (!alert || typeof alert !== 'object') return false;
  const category = String(alert.category || '').trim();
  const detail = String(alert.detail || '').trim();
  const link = String(alert.link || '').trim();
  const entity = String(alert.entity || '').trim();
  if (!category || !detail || !link) return false;
  if (link === '/rentals/undefined' || link === '/rentals/null' || link === '/service/undefined') return false;
  return Boolean(entity || /^\/(clients|documents|equipment|rentals|service|deliveries)(\/|\?|$)/.test(link));
}

export function buildOperationalLoadModel(input = {}) {
  const baseSignals = [
    input.activeEquipment,
    input.totalRentals,
    input.totalServiceTickets,
    input.totalDeliveries,
    input.totalDocuments,
    input.totalTasks,
    input.totalAttentionActions,
    input.totalDebtRows,
  ].map(safeCount);
  const hasSufficientData = baseSignals.some(value => value > 0);

  if (!hasSufficientData) {
    return {
      score: null,
      label: 'Недостаточно данных',
      hint: 'Индекс N/A · недостаточно данных',
      tone: 'default',
      hasSufficientData: false,
    };
  }

  const activeRentals = safeCount(input.activeRentals);
  const openServiceTickets = safeCount(input.openServiceTickets);
  const returnPressure = safeCount(input.returnPressure);
  const deliveryPressure = safeCount(input.deliveryPressure);
  const documentPressure = safeCount(input.documentPressure);
  const taskPressure = safeCount(input.taskPressure);
  const criticalIssues = safeCount(input.criticalIssues);
  const score = clampPercent(Math.round(
    Math.min(activeRentals, 35) * 0.7
    + Math.min(openServiceTickets, 70) * 0.35
    + Math.min(returnPressure, 24) * 1.1
    + Math.min(deliveryPressure, 24) * 0.9
    + Math.min(documentPressure, 28) * 0.7
    + Math.min(taskPressure, 40) * 0.55,
  ));

  return {
    score,
    label: operationalLoadLabel(score),
    hint: `Индекс ${score}/100 · критично ${criticalIssues}`,
    tone: operationalLoadTone(score, criticalIssues),
    hasSufficientData: true,
  };
}
