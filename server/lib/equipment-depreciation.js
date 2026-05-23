function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function dateOnly(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function monthsBetweenInclusive(startDate, endDate) {
  const start = dateOnly(startDate);
  const end = dateOnly(endDate);
  if (!start || !end || start > end) return 0;
  const startDateObj = new Date(`${start}T00:00:00.000Z`);
  const endDateObj = new Date(`${end}T00:00:00.000Z`);
  return Math.max(0, (endDateObj.getUTCFullYear() - startDateObj.getUTCFullYear()) * 12
    + (endDateObj.getUTCMonth() - startDateObj.getUTCMonth()) + 1);
}

function normalizeEquipmentFinance(input = {}, previous = {}, equipmentId = '') {
  const purchasePrice = toNumber(input.purchasePrice ?? previous.purchasePrice);
  const salvageValue = toNumber(input.salvageValue ?? previous.salvageValue);
  const usefulLifeMonths = Number(input.usefulLifeMonths ?? previous.usefulLifeMonths);
  const method = String(input.depreciationMethod ?? previous.depreciationMethod ?? 'straight_line').trim() || 'straight_line';

  if (purchasePrice < 0) {
    const error = new Error('Первоначальная стоимость не может быть отрицательной.');
    error.status = 400;
    throw error;
  }
  if (salvageValue < 0 || salvageValue > purchasePrice) {
    const error = new Error('Ликвидационная стоимость должна быть от 0 до первоначальной стоимости.');
    error.status = 400;
    throw error;
  }
  if (!['straight_line', 'manual'].includes(method)) {
    const error = new Error('Некорректный метод амортизации.');
    error.status = 400;
    throw error;
  }
  if (method === 'straight_line' && (!Number.isFinite(usefulLifeMonths) || usefulLifeMonths <= 0)) {
    const error = new Error('Срок полезного использования должен быть больше нуля.');
    error.status = 400;
    throw error;
  }

  return {
    ...(previous || {}),
    equipmentId: String(input.equipmentId || previous.equipmentId || equipmentId || '').trim(),
    purchasePrice,
    purchaseDate: dateOnly(input.purchaseDate ?? previous.purchaseDate) || undefined,
    commissioningDate: dateOnly(input.commissioningDate ?? previous.commissioningDate) || undefined,
    usefulLifeMonths: Number.isFinite(usefulLifeMonths) ? Math.round(usefulLifeMonths) : 0,
    depreciationMethod: method,
    salvageValue,
    accumulatedDepreciation: Math.max(0, toNumber(input.accumulatedDepreciation ?? previous.accumulatedDepreciation)),
    depreciationStartDate: dateOnly(input.depreciationStartDate ?? previous.depreciationStartDate) || undefined,
    depreciationPaused: Boolean(input.depreciationPaused ?? previous.depreciationPaused),
    comment: String(input.comment ?? previous.comment ?? '').trim() || undefined,
  };
}

function calculateEquipmentDepreciation(record = {}, asOfDate = new Date().toISOString().slice(0, 10)) {
  const purchasePrice = toNumber(record.purchasePrice);
  const salvageValue = toNumber(record.salvageValue);
  const usefulLifeMonths = Math.round(toNumber(record.usefulLifeMonths));
  if (purchasePrice <= 0 || usefulLifeMonths <= 0 || salvageValue < 0 || salvageValue > purchasePrice) {
    return {
      status: 'not_configured',
      monthlyDepreciation: 0,
      accumulatedDepreciation: 0,
      residualValue: purchasePrice > 0 ? purchasePrice : 0,
      reason: 'missing_depreciation_data',
    };
  }

  const base = Math.max(0, purchasePrice - salvageValue);
  const monthlyDepreciation = record.depreciationPaused ? 0 : Math.round((base / usefulLifeMonths) * 100) / 100;
  const startDate = dateOnly(record.depreciationStartDate || record.commissioningDate || record.purchaseDate);
  const elapsedMonths = record.depreciationMethod === 'manual'
    ? 0
    : Math.min(usefulLifeMonths, monthsBetweenInclusive(startDate, asOfDate));
  const calculatedAccumulated = record.depreciationMethod === 'manual'
    ? toNumber(record.accumulatedDepreciation)
    : monthlyDepreciation * elapsedMonths;
  const accumulatedDepreciation = Math.min(base, Math.max(0, Math.round(calculatedAccumulated * 100) / 100));
  const residualValue = Math.max(salvageValue, Math.round((purchasePrice - accumulatedDepreciation) * 100) / 100);

  return {
    status: 'configured',
    monthlyDepreciation,
    accumulatedDepreciation,
    residualValue,
    elapsedMonths,
    reason: record.depreciationPaused ? 'depreciation_paused' : 'depreciation_calculated',
  };
}

function buildEquipmentEconomics({ equipment = [], equipmentFinance = [], rentals = [], payments = [], service = [], asOfDate } = {}) {
  const financeByEquipmentId = new Map((equipmentFinance || []).map(item => [String(item.equipmentId || ''), item]));
  const paidByRentalId = new Map((payments || []).map(payment => [String(payment.rentalId || ''), Number(payment.paidAmount ?? payment.amount ?? 0) || 0]));
  return (equipment || []).map(item => {
    const finance = financeByEquipmentId.get(String(item.id || '')) || {};
    const depreciation = calculateEquipmentDepreciation(finance, asOfDate);
    const relatedRentals = (rentals || []).filter(rental => String(rental.equipmentId || '') === String(item.id || '')
      || (item.inventoryNumber && String(rental.equipmentInv || '') === String(item.inventoryNumber)));
    const revenue = relatedRentals.reduce((sum, rental) => sum + (Number(rental.amount) || 0), 0);
    const paidRevenue = relatedRentals.reduce((sum, rental) => sum + (paidByRentalId.get(String(rental.id || '')) || 0), 0);
    const serviceExpenses = (service || [])
      .filter(ticket => String(ticket.equipmentId || '') === String(item.id || '') || String(ticket.inventoryNumber || '') === String(item.inventoryNumber || ''))
      .reduce((sum, ticket) => sum + (Number(ticket.amount ?? ticket.cost ?? ticket.totalCost) || 0), 0);
    return {
      equipmentId: item.id,
      inventoryNumber: item.inventoryNumber || '',
      equipmentLabel: [item.manufacturer, item.model].filter(Boolean).join(' ') || item.inventoryNumber || item.id,
      finance,
      depreciation,
      revenue,
      paidRevenue,
      serviceExpenses,
      grossProfit: revenue - serviceExpenses,
      profitAfterDepreciation: revenue - serviceExpenses - depreciation.monthlyDepreciation,
      rentalCount: relatedRentals.length,
    };
  });
}

module.exports = {
  normalizeEquipmentFinance,
  calculateEquipmentDepreciation,
  buildEquipmentEconomics,
  monthsBetweenInclusive,
};
