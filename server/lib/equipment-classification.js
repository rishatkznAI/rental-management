const ACTIVE_IN_FLEET_ALIAS_KEYS = [
  'activeInFleet',
  'fleet',
  'rentalFleet',
  'isRentalFleet',
  'inRentalFleet',
  'availableForRent',
  'isRental',
];

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function coerceBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'да', 'активна', 'active', 'rental', 'rent', 'fleet', 'rental_fleet'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'нет', 'неактивна', 'inactive', 'sale', 'sales', 'sold', 'client', 'archive', 'archived'].includes(normalized)) return false;
  }
  return undefined;
}

function normalizeEquipmentActiveInFleet(equipment = {}, fallback = true) {
  for (const key of ACTIVE_IN_FLEET_ALIAS_KEYS) {
    if (!hasOwn(equipment, key)) continue;
    const normalized = coerceBoolean(equipment[key]);
    if (normalized !== undefined) return normalized;
  }
  return fallback;
}

function stripActiveInFleetAliases(target) {
  for (const key of ACTIVE_IN_FLEET_ALIAS_KEYS) {
    if (key !== 'activeInFleet') delete target[key];
  }
}

function normalizeEquipmentStoragePatch(patch = {}) {
  const next = { ...(patch || {}) };
  const hasActiveInFleet = ACTIVE_IN_FLEET_ALIAS_KEYS.some(key => hasOwn(next, key));
  if (hasActiveInFleet) {
    next.activeInFleet = normalizeEquipmentActiveInFleet(next, true);
  }
  stripActiveInFleetAliases(next);
  return next;
}

function normalizeEquipmentStorageRecord(record = {}) {
  const next = {
    ...(record || {}),
    category: record.category || 'own',
    activeInFleet: normalizeEquipmentActiveInFleet(record, true),
    priority: record.priority || 'medium',
  };
  stripActiveInFleetAliases(next);
  return {
    ...next,
  };
}

module.exports = {
  normalizeEquipmentActiveInFleet,
  normalizeEquipmentStoragePatch,
  normalizeEquipmentStorageRecord,
};
