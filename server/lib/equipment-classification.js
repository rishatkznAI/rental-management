const ACTIVE_IN_FLEET_ALIAS_KEYS = [
  'activeInFleet',
  'fleet',
  'rentalFleet',
  'isRentalFleet',
  'inRentalFleet',
  'availableForRent',
  'isRental',
];

const SALE_STATUS_LABELS = {
  on_sale: 'На продаже',
  reserved: 'Резерв',
  in_deal: 'В сделке',
  sold: 'Продана',
  removed: 'Снята с продажи',
};

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

function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function saleStatusKind(record = {}) {
  const rawStatus = lower(record.saleStatus || record.salesStatus || record.status || record.category);
  if (record.category === 'sold' || rawStatus === 'sold' || rawStatus === 'продана' || rawStatus === 'продано') return 'sold';
  if (rawStatus === 'removed' || rawStatus === 'withdrawn' || rawStatus === 'снята с продажи' || rawStatus === 'снято с продажи') return 'removed';
  if (rawStatus === 'reserved' || rawStatus === 'резерв') return 'reserved';
  if (rawStatus === 'in_deal' || rawStatus === 'deal' || rawStatus === 'в сделке') return 'in_deal';
  if (['sale', 'sales', 'for_sale', 'for-sale', 'on_sale', 'on-sale', 'на продаже', 'на продажу', 'продажа', 'продается', 'продаётся'].includes(rawStatus)) return 'on_sale';
  return 'unknown';
}

function isExplicitSaleOn(value) {
  if (value === true || value === 1) return true;
  const normalized = lower(value);
  return ['true', '1', 'yes', 'y', 'да', 'sale', 'sales', 'for_sale', 'on_sale', 'на продаже', 'на продажу'].includes(normalized);
}

function isExplicitSaleOff(value) {
  if (value === false || value === 0) return true;
  const normalized = lower(value);
  return ['false', '0', 'no', 'n', 'нет', 'removed', 'withdrawn', 'off_sale', 'off-sale', 'снята с продажи', 'снято с продажи'].includes(normalized);
}

function normalizeEquipmentSalePatch(existing = {}, patch = {}) {
  const next = { ...(patch || {}) };
  const hasIsForSale = hasOwn(next, 'isForSale');
  const hasForSale = hasOwn(next, 'forSale');
  const hasSaleMode = hasOwn(next, 'saleMode');
  const hasSaleStatus = hasOwn(next, 'saleStatus') || hasOwn(next, 'salesStatus');
  const explicitStatusKind = saleStatusKind(next);
  const explicitOff = (hasIsForSale && isExplicitSaleOff(next.isForSale))
    || (hasForSale && isExplicitSaleOff(next.forSale))
    || (hasSaleStatus && explicitStatusKind === 'removed');
  const explicitOn = (hasIsForSale && isExplicitSaleOn(next.isForSale))
    || (hasForSale && isExplicitSaleOn(next.forSale))
    || (hasSaleMode && isExplicitSaleOn(next.saleMode) && !explicitOff)
    || (hasSaleStatus && ['on_sale', 'reserved', 'in_deal'].includes(explicitStatusKind));

  if (hasForSale && !hasIsForSale) {
    next.isForSale = isExplicitSaleOn(next.forSale);
  }

  if (explicitOn) {
    next.isForSale = true;
    next.forSale = true;
    next.saleMode = true;
    const effective = { ...existing, ...next };
    if (saleStatusKind(effective) === 'removed' || !text(effective.saleStatus)) {
      next.saleStatus = SALE_STATUS_LABELS.on_sale;
    }
  } else if (explicitOff) {
    next.isForSale = false;
    next.forSale = false;
    next.saleMode = true;
    if (!hasSaleStatus || saleStatusKind(next) === 'removed') {
      next.saleStatus = SALE_STATUS_LABELS.removed;
    }
  }

  return next;
}

function normalizeEquipmentStoragePatch(patch = {}) {
  const next = normalizeEquipmentSalePatch({}, patch);
  const hasActiveInFleet = ACTIVE_IN_FLEET_ALIAS_KEYS.some(key => hasOwn(next, key));
  if (hasActiveInFleet) {
    next.activeInFleet = normalizeEquipmentActiveInFleet(next, true);
  }
  stripActiveInFleetAliases(next);
  return next;
}

function normalizeEquipmentStorageRecord(record = {}) {
  const saleNormalized = normalizeEquipmentSalePatch(record, record);
  const next = {
    ...saleNormalized,
    category: saleNormalized.category || 'own',
    activeInFleet: normalizeEquipmentActiveInFleet(saleNormalized, true),
    priority: saleNormalized.priority || 'medium',
  };
  stripActiveInFleetAliases(next);
  return {
    ...next,
  };
}

module.exports = {
  normalizeEquipmentActiveInFleet,
  normalizeEquipmentSalePatch,
  normalizeEquipmentStoragePatch,
  normalizeEquipmentStorageRecord,
};
