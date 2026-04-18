const {
  findEquipmentForRentalPayload,
  isUniqueInventoryNumber,
} = require('./equipment-matching');

function normalizeEquipmentRecord(equipment) {
  if (!equipment) return equipment;
  return {
    ...equipment,
    category: equipment.category || 'own',
    activeInFleet: equipment.activeInFleet !== false,
    priority: equipment.priority || 'medium',
  };
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
  const startA = new Date(startDateA).getTime();
  const endA = new Date(endDateA).getTime();
  const startB = new Date(startDateB).getTime();
  const endB = new Date(endDateB).getTime();
  if ([startA, endA, startB, endB].some(Number.isNaN)) return false;
  return startA <= endB && endA >= startB;
}

function isBlockingRental(rental) {
  return rental?.status !== 'returned' && rental?.status !== 'closed';
}

function rentalMatchesEquipment(rental, equipment, equipmentList) {
  if (!rental || !equipment) return false;
  if (rental.equipmentId) return rental.equipmentId === equipment.id;
  if (rental.serialNumber && equipment.serialNumber) {
    return rental.serialNumber === equipment.serialNumber;
  }

  const inventoryNumber =
    rental.equipmentInv
    || rental.inventoryNumber
    || (Array.isArray(rental.equipment) ? rental.equipment[0] : null);

  return Boolean(
    inventoryNumber &&
    equipment.inventoryNumber &&
    isUniqueInventoryNumber(inventoryNumber, equipmentList) &&
    inventoryNumber === equipment.inventoryNumber
  );
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

function validateRentalPayload(collection, payload, rentals = [], equipment = [], excludeRentalId = '') {
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

  const { startDate, endDate } = getRentalDateRange(collection, payload);
  if ((startDate && !endDate) || (!startDate && endDate)) {
    return { ok: false, status: 400, error: 'Для аренды нужно указать и дату начала, и дату окончания' };
  }
  if (startDate && endDate && new Date(startDate).getTime() > new Date(endDate).getTime()) {
    return { ok: false, status: 400, error: 'Дата окончания аренды не может быть раньше даты начала' };
  }

  const conflict = findConflictingRental(collection, payload, rentals, equipmentList, excludeRentalId);
  if (conflict) {
    return { ok: false, status: 409, error: formatConflictError(conflict, collection) };
  }

  return { ok: true };
}

module.exports = {
  normalizeEquipmentRecord,
  canEquipmentParticipateInRentals,
  getRentalDateRange,
  hasDateOverlap,
  isBlockingRental,
  rentalMatchesEquipment,
  findConflictingRental,
  formatConflictError,
  validateRentalPayload,
};
