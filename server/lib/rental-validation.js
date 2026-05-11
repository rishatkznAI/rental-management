const {
  findEquipmentForRentalPayload,
  isUniqueInventoryNumber,
  rentalMatchesEquipment,
} = require('./equipment-matching');
const { normalizeEquipmentStorageRecord } = require('./equipment-classification');

function normalizeEquipmentRecord(equipment) {
  if (!equipment) return equipment;
  return normalizeEquipmentStorageRecord(equipment);
}

function canEquipmentParticipateInRentals(equipment) {
  const normalized = normalizeEquipmentRecord(equipment);
  return normalized.activeInFleet && (normalized.category === 'own' || normalized.category === 'partner');
}

function getRentalDateRange(collection, rental) {
  if (!rental) return { startDate: '', endDate: '' };
  if (collection === 'rentals') {
    return {
      startDate: rental.startDate || '',
      endDate: rental.plannedReturnDate || rental.endDate || '',
    };
  }
  return {
    startDate: rental.startDate || '',
    endDate: rental.endDate || rental.plannedReturnDate || '',
  };
}

function hasDateOverlap(startDateA, endDateA, startDateB, endDateB) {
  if (!startDateA || !endDateA || !startDateB || !endDateB) return false;
  const startA = parseRentalDateMs(startDateA);
  const endA = parseRentalDateMs(endDateA);
  const startB = parseRentalDateMs(startDateB);
  const endB = parseRentalDateMs(endDateB);
  if ([startA, endA, startB, endB].some(value => value === null)) return false;
  return startA <= endB && endA >= startB;
}

function parseRentalDateMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const dateKey = raw.slice(0, 10);
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.getTime();
}

function parseOptionalNonNegativeNumber(value, fieldLabel) {
  if (value === undefined || value === null || value === '') return { ok: true };
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return {
      ok: false,
      status: 400,
      error: `${fieldLabel} должно быть числом не меньше 0`,
    };
  }
  return { ok: true };
}

function validateRentalNumericFields(payload) {
  const checks = [
    ['amount', 'Сумма аренды'],
    ['price', 'Цена аренды'],
    ['discount', 'Скидка'],
    ['dailyRate', 'Дневная ставка'],
    ['monthlyRate', 'Месячная ставка'],
  ];

  for (const [field, label] of checks) {
    const validation = parseOptionalNonNegativeNumber(payload?.[field], label);
    if (!validation.ok) return validation;
  }

  if (payload && Object.prototype.hasOwnProperty.call(payload, 'rate')) {
    const rate = payload.rate;
    const normalizedRate = typeof rate === 'string' ? rate.trim().replace(/\s+/g, '') : rate;
    const rateValue = typeof normalizedRate === 'string'
      ? normalizedRate.match(/-?\d+(?:[.,]\d+)?/)?.[0]
      : normalizedRate;
    if (normalizedRate !== undefined && normalizedRate !== null && normalizedRate !== '' && rateValue === undefined) {
      return {
        ok: false,
        status: 400,
        error: 'Ставка аренды должно быть числом не меньше 0',
      };
    }
    if (rateValue !== undefined && rateValue !== null && rateValue !== '') {
      const validation = parseOptionalNonNegativeNumber(String(rateValue).replace(',', '.'), 'Ставка аренды');
      if (!validation.ok) return validation;
    }
  }

  return { ok: true };
}

function isBlockingRental(rental) {
  return rental?.status !== 'returned' && rental?.status !== 'closed';
}

function findConflictingRental(collection, payload, rentals, equipmentList, excludeRentalId = '') {
  const equipment = findEquipmentForRentalPayload(payload, equipmentList);
  if (!equipment) return null;

  const { startDate, endDate } = getRentalDateRange(collection, payload);
  if (!startDate || !endDate) return null;

  return (rentals || []).find(rental => {
    if (!rental || rental.id === excludeRentalId) return false;
    if (!isBlockingRental(rental)) return false;
    if (!rentalMatchesEquipment(rental, equipment, equipmentList)) return false;

    const rentalDates = getRentalDateRange(collection, rental);
    return hasDateOverlap(startDate, endDate, rentalDates.startDate, rentalDates.endDate);
  }) || null;
}

function formatConflictError(conflict, collection) {
  if (!conflict) return 'Есть пересечение по аренде';
  const { startDate, endDate } = getRentalDateRange(collection, conflict);
  const client = conflict.client || 'без клиента';
  return `Техника уже занята в период ${startDate} — ${endDate} (${client})`;
}

function validateRentalPayload(collection, payload, rentals = [], equipment = [], excludeRentalId = '', options = {}) {
  const equipmentList = (equipment || []).map(normalizeEquipmentRecord);
  const equipmentId = payload?.equipmentId;
  const inventoryNumber =
    payload?.equipmentInv
    || payload?.inventoryNumber
    || (Array.isArray(payload?.equipment) ? payload.equipment[0] : null);

  const matchedEquipment = findEquipmentForRentalPayload({ equipmentId, inventoryNumber }, equipmentList);
  if (!matchedEquipment) {
    if (!equipmentId && inventoryNumber && !isUniqueInventoryNumber(inventoryNumber, equipmentList)) {
      return {
        ok: false,
        status: 400,
        error: `Нельзя привязать аренду только по INV ${inventoryNumber}: номер не уникален. Выберите конкретную технику.`,
      };
    }
    return { ok: false, status: 400, error: 'Техника для аренды не найдена' };
  }

  if (!canEquipmentParticipateInRentals(matchedEquipment)) {
    return {
      ok: false,
      status: 400,
      error: 'Эта техника не может участвовать в аренде: проверьте категорию и признак активного парка',
    };
  }

  const numericValidation = validateRentalNumericFields(payload);
  if (!numericValidation.ok) return numericValidation;

  const { startDate, endDate } = getRentalDateRange(collection, payload);
  if ((startDate && !endDate) || (!startDate && endDate)) {
    return { ok: false, status: 400, error: 'Для аренды нужно указать и дату начала, и дату окончания' };
  }
  if (startDate && endDate) {
    const startDateMs = parseRentalDateMs(startDate);
    const endDateMs = parseRentalDateMs(endDate);
    if (startDateMs === null || endDateMs === null) {
      return { ok: false, status: 400, error: 'Укажите корректные даты аренды в формате YYYY-MM-DD' };
    }
    if (startDateMs > endDateMs) {
      return { ok: false, status: 400, error: 'Дата окончания аренды не может быть раньше даты начала' };
    }
  }

  if (!options.skipConflictCheck) {
    const conflict = findConflictingRental(collection, payload, rentals, equipmentList, excludeRentalId);
    if (conflict) {
      return { ok: false, status: 409, error: formatConflictError(conflict, collection) };
    }
  }

  return { ok: true };
}

module.exports = {
  normalizeEquipmentRecord,
  canEquipmentParticipateInRentals,
  getRentalDateRange,
  hasDateOverlap,
  parseRentalDateMs,
  validateRentalNumericFields,
  isBlockingRental,
  rentalMatchesEquipment,
  findConflictingRental,
  formatConflictError,
  validateRentalPayload,
};
