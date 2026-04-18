export function rentalMatchesEquipment(rental, equipment, allowInventoryFallback = true) {
  if (!rental || !equipment) return false;
  if (rental.equipmentId) {
    return rental.equipmentId === equipment.id;
  }
  if (!allowInventoryFallback) return false;
  return rental.equipmentInv === equipment.inventoryNumber;
}

export function hasDateOverlap(startDateA, endDateA, startDateB, endDateB) {
  if (!startDateA || !endDateA || !startDateB || !endDateB) return false;
  const startA = new Date(startDateA).getTime();
  const endA = new Date(endDateA).getTime();
  const startB = new Date(startDateB).getTime();
  const endB = new Date(endDateB).getTime();
  if ([startA, endA, startB, endB].some(Number.isNaN)) return false;
  return startA <= endB && endA >= startB;
}

export function isBlockingRental(rental) {
  return rental?.status !== 'returned' && rental?.status !== 'closed';
}

export function isEquipmentBusy(equipment, startDate, endDate, rentals, excludeRentalId = '', allowInventoryFallback = true) {
  if (!equipment || !startDate || !endDate) return false;
  return (rentals || []).some(rental => {
    if (!rental || rental.id === excludeRentalId) return false;
    if (!rentalMatchesEquipment(rental, equipment, allowInventoryFallback)) return false;
    if (!isBlockingRental(rental)) return false;
    return hasDateOverlap(startDate, endDate, rental.startDate, rental.endDate);
  });
}

export function findConflictingRental(equipment, startDate, endDate, rentals, excludeRentalId = '', allowInventoryFallback = true) {
  return (rentals || []).find(rental => {
    if (!rental || rental.id === excludeRentalId) return false;
    if (!rentalMatchesEquipment(rental, equipment, allowInventoryFallback)) return false;
    if (!isBlockingRental(rental)) return false;
    return hasDateOverlap(startDate, endDate, rental.startDate, rental.endDate);
  }) || null;
}
