const RENTAL_FLEET_CATEGORIES = new Set(['own', 'partner']);
const INACTIVE_EQUIPMENT_STATUSES = new Set([
  'inactive',
  'sold',
  'written_off',
  'written-off',
  'archived',
  'decommissioned',
  'disposed',
  'scrapped',
]);
const CURRENT_RENTAL_STATUSES = new Set(['active']);
const HISTORICAL_RENTAL_STATUSES = new Set(['active', 'returned', 'closed']);
const MS_PER_DAY = 86400000;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function asStartOfDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function isActiveRentalFleetEquipment(equipment = {}) {
  const category = equipment.category ?? 'own';
  const status = normalizeText(equipment.status).toLowerCase();

  return equipment.activeInFleet !== false
    && RENTAL_FLEET_CATEGORIES.has(category)
    && !INACTIVE_EQUIPMENT_STATUSES.has(status);
}

export function buildActiveRentalFleetLookup(equipment = []) {
  const activeFleet = equipment.filter(isActiveRentalFleetEquipment);
  const byId = new Map();
  const inventoryCounts = new Map();
  const serialCounts = new Map();

  for (const item of activeFleet) {
    if (item.id) byId.set(String(item.id), item);
    const inventory = normalizeText(item.inventoryNumber);
    if (inventory) inventoryCounts.set(inventory, (inventoryCounts.get(inventory) || 0) + 1);
    const serial = normalizeText(item.serialNumber);
    if (serial) serialCounts.set(serial, (serialCounts.get(serial) || 0) + 1);
  }

  const uniqueByInventory = new Map();
  const uniqueBySerial = new Map();
  for (const item of activeFleet) {
    const inventory = normalizeText(item.inventoryNumber);
    if (inventory && inventoryCounts.get(inventory) === 1) uniqueByInventory.set(inventory, item);
    const serial = normalizeText(item.serialNumber);
    if (serial && serialCounts.get(serial) === 1) uniqueBySerial.set(serial, item);
  }

  return { activeFleet, byId, uniqueByInventory, uniqueBySerial };
}

export function getRentalEquipmentKey(rental = {}, lookup) {
  const equipmentId = normalizeText(rental.equipmentId);
  if (equipmentId && lookup.byId.has(equipmentId)) return equipmentId;

  const inventory = normalizeText(rental.equipmentInv || rental.inventoryNumber);
  const byInventory = inventory ? lookup.uniqueByInventory.get(inventory) : null;
  if (byInventory?.id) return String(byInventory.id);

  const serial = normalizeText(rental.serialNumber);
  const bySerial = serial ? lookup.uniqueBySerial.get(serial) : null;
  if (bySerial?.id) return String(bySerial.id);

  return '';
}

export function countActiveRentalFleetEquipment(equipment = []) {
  return equipment.filter(isActiveRentalFleetEquipment).length;
}

export function countOccupiedRentalFleetEquipment(equipment = [], rentals = [], statuses = CURRENT_RENTAL_STATUSES) {
  const lookup = buildActiveRentalFleetLookup(equipment);
  const keys = new Set();
  for (const rental of rentals) {
    if (!statuses.has(rental?.status)) continue;
    const key = getRentalEquipmentKey(rental, lookup);
    if (key) keys.add(key);
  }
  return keys.size;
}

export function calculateUtilizationPercent(occupied, denominator) {
  if (!Number.isFinite(occupied) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((occupied / denominator) * 100)));
}

export function calculateCurrentFleetUtilization(equipment = [], rentals = []) {
  const activeEquipment = countActiveRentalFleetEquipment(equipment);
  const rentedEquipment = countOccupiedRentalFleetEquipment(equipment, rentals, CURRENT_RENTAL_STATUSES);

  return {
    totalEquipment: equipment.length,
    activeEquipment,
    rentedEquipment,
    utilization: calculateUtilizationPercent(rentedEquipment, activeEquipment),
  };
}

export function calculateMonthlyFleetUtilization(equipment = [], rentals = [], monthStart, monthEnd) {
  const lookup = buildActiveRentalFleetLookup(equipment);
  const start = asStartOfDay(monthStart);
  const end = asStartOfDay(monthEnd);
  const activeEquipment = lookup.activeFleet.length;

  if (!start || !end || end < start || activeEquipment === 0) {
    return { activeEquipment, occupiedDays: 0, totalPossible: 0, utilization: 0 };
  }

  const occupiedEquipmentDays = new Set();
  for (const rental of rentals) {
    if (!HISTORICAL_RENTAL_STATUSES.has(rental?.status)) continue;
    const key = getRentalEquipmentKey(rental, lookup);
    if (!key) continue;

    const rentalStart = asStartOfDay(rental.startDate);
    const rentalEnd = asStartOfDay(rental.endDate || rental.plannedReturnDate);
    if (!rentalStart || !rentalEnd) continue;

    const overlapStart = new Date(Math.max(rentalStart.getTime(), start.getTime()));
    const overlapEnd = new Date(Math.min(rentalEnd.getTime(), end.getTime()));
    if (overlapEnd < overlapStart) continue;

    for (let day = overlapStart.getTime(); day <= overlapEnd.getTime(); day += MS_PER_DAY) {
      occupiedEquipmentDays.add(`${key}:${dateKey(new Date(day))}`);
    }
  }

  const totalPossible = activeEquipment * (Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1);
  return {
    activeEquipment,
    occupiedDays: occupiedEquipmentDays.size,
    totalPossible,
    utilization: calculateUtilizationPercent(occupiedEquipmentDays.size, totalPossible),
  };
}
