const {
  findEquipmentForRentalPayload,
  isUniqueInventoryNumber,
} = require('./equipment-matching');

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

module.exports = {
  getRentalDateRange,
  hasDateOverlap,
  isBlockingRental,
  rentalMatchesEquipment,
  findConflictingRental,
  formatConflictError,
};
