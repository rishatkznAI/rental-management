const CONTOUR_LABELS = {
  equipment: 'Техника',
  rentals: 'Аренды',
  payments: 'Платежи',
  service: 'Сервис',
  documents: 'Документы',
  deliveries: 'Доставки',
};

const OPERATIONAL_CONTOURS = ['rentals', 'payments', 'service', 'documents', 'deliveries'];

function safeCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
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

  if (isEmpty) {
    return {
      score: null,
      label: 'Нет данных',
      subtitle: 'Недостаточно данных для расчёта здоровья компании',
      tone: 'default',
      availableContours,
      missingContours,
      contourStates,
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
      warning: criticalSignals > 0 || invalidCriticalSignals > 0 ? 'Есть сигналы без полного расчёта' : '',
    };
  }

  const utilization = clampPercent(safeCount(input.utilization));
  const scores = [
    utilization >= 60 ? 90 : utilization >= 40 ? 65 : 38,
    contourScore(contours.rentals.count > 0 ? contourStatus(contours.rentals) : 'no_data', 88),
    contourScore(contours.payments.count > 0 ? contourStatus(contours.payments) : 'no_data', 92, 62, 34),
    contourScore(contours.service.count > 0 ? contourStatus(contours.service) : 'no_data', 88, 58, 28),
    contourScore(contours.documents.count > 0 ? contourStatus(contours.documents) : 'no_data', 90, 58, 34),
    contourScore(contours.deliveries.count > 0 ? contourStatus(contours.deliveries) : 'no_data', 88, 60, 32),
  ].filter(value => value !== null);

  const signalPenalty = Math.min(22, criticalSignals * 4 + invalidCriticalSignals * 6);
  const score = clampPercent(Math.round(
    scores.reduce((sum, value) => sum + value, 0) / Math.max(scores.length, 1) - signalPenalty,
  ));

  return {
    score,
    label: score >= 80 ? 'Хорошо' : score >= 55 ? 'Зона внимания' : 'Критично',
    subtitle: 'Расчёт по доступным операционным данным',
    tone: score >= 80 ? 'success' : score >= 55 ? 'warning' : 'danger',
    availableContours,
    missingContours,
    contourStates,
    warning: invalidCriticalSignals > 0 ? 'Есть сигналы без полного расчёта' : '',
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
