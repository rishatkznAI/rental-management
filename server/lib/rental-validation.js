const {
  findEquipmentForRentalPayload,
  isUniqueInventoryNumber,
  rentalMatchesEquipment,
} = require('./equipment-matching');
const { normalizeEquipmentStorageRecord } = require('./equipment-classification');
const {
  canonicalRentalMoney,
  canonicalRentalRate,
} = require('./rental-data-integrity');

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
  try {
    canonicalRentalMoney(value, {
      field: 'numeric',
      label: fieldLabel,
      defaultValue: undefined,
    });
  } catch (error) {
    return {
      ok: false,
      status: error?.status || 400,
      code: error?.code,
      error: error.message,
    };
  }
  return { ok: true };
}

function validateRentalNumericFields(payload) {
  const checks = [
    ['amount', 'Сумма аренды'],
    ['price', 'Цена аренды'],
    ['discount', 'Скидка'],
    ['deposit', 'Залог'],
    ['dailyRate', 'Дневная ставка'],
    ['monthlyRate', 'Месячная ставка'],
  ];

  for (const [field, label] of checks) {
    const validation = parseOptionalNonNegativeNumber(payload?.[field], label);
    if (!validation.ok) return validation;
  }

  if (payload && Object.prototype.hasOwnProperty.call(payload, 'rate')) {
    try {
      canonicalRentalRate(payload.rate);
    } catch (error) {
      return {
        ok: false,
        status: error?.status || 400,
        code: error?.code,
        error: error.message,
      };
    }
  }

  return { ok: true };
}

function isBlockingRental(rental) {
  return !['returned', 'closed', 'cancelled', 'canceled', 'completed']
    .includes(String(rental?.status || '').trim().toLowerCase());
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

function buildAvailabilityConflictPayload(conflict, collection, equipment) {
  if (!conflict) return null;
  const { startDate, endDate } = getRentalDateRange(collection, conflict);
  return {
    rentalId: String(conflict.id || conflict.rentalId || ''),
    clientId: String(conflict.clientId || ''),
    client: String(conflict.client || conflict.clientName || ''),
    equipmentId: String(equipment?.id || conflict.equipmentId || ''),
    equipmentInv: String(equipment?.inventoryNumber || conflict.equipmentInv || conflict.inventoryNumber || ''),
    startDate,
    endDate,
    status: String(conflict.status || ''),
  };
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
      return {
        ok: false,
        status: 409,
        code: 'EQUIPMENT_AVAILABILITY_CONFLICT',
        error: formatConflictError(conflict, collection),
        conflict: buildAvailabilityConflictPayload(conflict, collection, matchedEquipment),
      };
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
  buildAvailabilityConflictPayload,
  validateRentalPayload,
};
