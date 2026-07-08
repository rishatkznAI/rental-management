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

function contourScore(status, healthyValue, riskValue = 58, criticalValue = 32) {
  if (status === 'ok') return healthyValue;
  if (status === 'risk') return riskValue;
  if (status === 'critical') return criticalValue;
  return null;
}

function formatCountMetric(count, one, few, many) {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  const label = abs > 10 && abs < 20 ? many : last === 1 ? one : last > 1 && last < 5 ? few : many;
  return `${count} ${label}`;
}

function directionInput(key, score, primaryMetric, shortReason, options = {}) {
  return {
    key,
    score,
    primaryMetric,
    shortReason,
    insufficientData: Boolean(options.insufficientData),
  };
}

export function calculateCompanyHealthScore(directionScores = []) {
  const byKey = new Map(directionScores.map(item => [item?.key, item]).filter(([key]) => key));
  const directions = COMPANY_HEALTH_DIRECTIONS.map(({ key, title }) => {
    const source = byKey.get(key) || {};
    const numericScore = Number(source.score);
    const hasScore = source.score !== null && source.score !== undefined && source.score !== '' && Number.isFinite(numericScore);
    const insufficientData = Boolean(source.insufficientData || !hasScore);
    const score = clampPercent(hasScore ? numericScore : 50);
    const weight = COMPANY_HEALTH_WEIGHTS[key];
    const weightedContribution = Number((score * weight).toFixed(4));
    const weightedDeficit = Number(((100 - score) * weight).toFixed(4));

    return {
      key,
      title,
      score,
      weight,
      weightedContribution,
      weightedDeficit,
      primaryMetric: source.primaryMetric || 'Недостаточно данных',
      shortReason: insufficientData ? source.shortReason || 'Недостаточно данных' : source.shortReason || '',
      insufficientData,
    };
  });
  const total = directions.reduce((sum, item) => sum + item.weightedContribution, 0);
  const byWeakest = (left, right) => left.score - right.score || right.weight - left.weight || left.title.localeCompare(right.title, 'ru');
  const byStrongest = (left, right) => right.score - left.score || right.weight - left.weight || left.title.localeCompare(right.title, 'ru');
  const byFixImpact = (left, right) => right.weightedDeficit - left.weightedDeficit || byWeakest(left, right);

  return {
    totalScore: clampPercent(Math.round(total)),
    maxScore: 100,
    directions,
    weakestDirections: directions.slice().sort(byWeakest),
    strongestDirections: directions.slice().sort(byStrongest),
    focusDirections: directions.slice().sort(byFixImpact),
  };
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
  const utilization = clampPercent(safeCount(input.utilization));
  const financeStatus = contours.payments.count > 0 ? contourStatus(contours.payments) : 'no_data';
  const rentalStatus = contours.rentals.count > 0 ? contourStatus(contours.rentals) : 'no_data';
  const serviceStatus = contours.service.count > 0 ? contourStatus(contours.service) : 'no_data';
  const fleetStatus = contours.equipment.count > 0 ? contourStatus(contours.equipment) : 'no_data';
  const clientsCount = safeCount(input.clientsCount);
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
  const risksHaveSource = hasScoreBase || riskSignals > 0;
  const riskScore = risksHaveSource
    ? clampPercent(96 - Math.min(96, criticalRiskSignals * 18 + warningRiskSignals * 7))
    : null;

  return [
    directionInput(
      'finance',
      contourScore(financeStatus, 92, 62, 34),
      contours.payments.count > 0 ? formatCountMetric(contours.payments.count, 'платёж', 'платежа', 'платежей') : 'Нет платежей',
      financeStatus === 'no_data'
        ? 'Недостаточно данных'
        : financeStatus === 'critical'
          ? 'Старый долг или критичная просрочка давят на индекс.'
          : financeStatus === 'risk'
            ? 'Есть просроченная дебиторка, нужен контроль оплат.'
            : 'Платежи заведены, критичной просрочки по доступным данным нет.',
      { insufficientData: financeStatus === 'no_data' },
    ),
    directionInput(
      'rental',
      rentalStatus === 'no_data' ? null : safeCount(input.overdueReturnsCount) > 0 ? 35 : safeCount(input.returnsTodayCount) > 0 ? 65 : 90,
      contours.rentals.count > 0 ? formatCountMetric(contours.rentals.count, 'аренда', 'аренды', 'аренд') : 'Нет аренд',
      rentalStatus === 'no_data'
        ? 'Недостаточно данных'
        : safeCount(input.overdueReturnsCount) > 0
          ? 'Есть просроченные возвраты.'
          : safeCount(input.returnsTodayCount) > 0
            ? 'Есть возвраты сегодня, нужен операционный контроль.'
            : 'Активность аренды не создаёт срочных отклонений.',
      { insufficientData: rentalStatus === 'no_data' },
    ),
    directionInput(
      'risks',
      riskScore,
      riskSignals > 0 ? formatCountMetric(riskSignals, 'сигнал', 'сигнала', 'сигналов') : risksHaveSource ? '0 сигналов' : 'Нет сигналов',
      !risksHaveSource
        ? 'Недостаточно данных'
        : criticalRiskSignals > 0
          ? 'Есть критичные сигналы по срокам, долгам, сервису или данным.'
          : warningRiskSignals > 0
            ? 'Есть предупреждения, которые снижают запас устойчивости.'
            : 'Критичных рисков по доступным данным нет.',
      { insufficientData: !risksHaveSource },
    ),
    directionInput(
      'service',
      contourScore(serviceStatus, 88, 58, 28),
      contours.service.count > 0 ? formatCountMetric(contours.service.count, 'заявка', 'заявки', 'заявок') : 'Нет заявок',
      serviceStatus === 'no_data'
        ? 'Недостаточно данных'
        : serviceStatus === 'critical'
          ? 'Критичные или просроченные заявки блокируют технику.'
          : serviceStatus === 'risk'
            ? 'Есть заявки без механика, ожидание запчастей или другие блокеры.'
            : 'Сервисные заявки не создают критичных блокеров.',
      { insufficientData: serviceStatus === 'no_data' },
    ),
    directionInput(
      'clients',
      clientsCount > 0 ? 88 : null,
      clientsCount > 0 ? formatCountMetric(clientsCount, 'клиент', 'клиента', 'клиентов') : 'Нет клиентов',
      clientsCount > 0
        ? 'Клиентская база доступна для связки с арендами и платежами.'
        : 'Недостаточно данных',
      { insufficientData: clientsCount <= 0 },
    ),
    directionInput(
      'fleet',
      fleetStatus === 'no_data' ? null : safeCount(input.noActiveFleetCritical) > 0 ? 25 : utilization >= 60 ? 90 : utilization >= 40 ? 65 : 38,
      fleetStatus === 'no_data' ? 'Нет техники' : `${Math.round(utilization)}% загрузка`,
      fleetStatus === 'no_data'
        ? 'Недостаточно данных'
        : safeCount(input.noActiveFleetCritical) > 0
          ? 'Парк есть, но активной техники в работе нет.'
          : utilization < 40
            ? 'Низкая загрузка парка снижает индекс.'
            : utilization < 60
              ? 'Загрузка ниже целевой зоны.'
              : 'Парк работает в целевой зоне загрузки.',
      { insufficientData: fleetStatus === 'no_data' },
    ),
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

  if (isEmpty) {
    return {
      score: null,
      label: 'Нет данных',
      subtitle: 'Недостаточно данных для расчёта здоровья компании',
      tone: 'default',
      availableContours,
      missingContours,
      contourStates,
      scoreDetails,
      warning: criticalSignals > 0 || invalidCriticalSignals > 0 ? 'Есть сигналы без полного расчёта' : '',
    };
  }

  if (!hasEquipment || !hasOperationalData) {
    return {
      score: null,
      label: 'Недостаточно данных',
      subtitle: 'Недостаточно данных для расчёта здоровья компании',
      tone: 'default',
      availableContours,
      missingContours,
      contourStates,
      scoreDetails,
      warning: criticalSignals > 0 || invalidCriticalSignals > 0 ? 'Есть сигналы без полного расчёта' : '',
    };
  }

  const score = scoreDetails.totalScore;
  const missingDirections = scoreDetails.directions.filter(item => item.insufficientData).map(item => item.title);

  return {
    score,
    label: score >= 80 ? 'Хорошо' : score >= 55 ? 'Зона внимания' : 'Критично',
    subtitle: 'Формула: финансы 30%, аренда 25%, риски 20%, сервис 15%, клиенты 7%, парк 3%',
    tone: score >= 80 ? 'success' : score >= 55 ? 'warning' : 'danger',
    availableContours,
    missingContours,
    contourStates,
    scoreDetails,
    warning: invalidCriticalSignals > 0
      ? 'Есть сигналы без полного расчёта'
      : missingDirections.length > 0
        ? `Недостаточно данных: ${missingDirections.join(', ')}`
        : '',
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
