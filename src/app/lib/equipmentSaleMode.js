function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function hasSaleMarker(value) {
  const normalized = lower(value);
  if (!normalized) return false;
  return [
    'sale',
    'sales',
    'for_sale',
    'for-sale',
    'on_sale',
    'on-sale',
    'на продаже',
    'на продажу',
    'продажа',
    'продается',
    'продаётся',
    'reserved',
    'резерв',
    'in_deal',
    'deal',
    'в сделке',
    'sold',
    'продана',
    'продано',
    'removed',
    'withdrawn',
    'снята с продажи',
    'снято с продажи',
  ].includes(normalized);
}

export const SALE_STATUS_LABELS = {
  on_sale: 'На продаже',
  reserved: 'Резерв',
  in_deal: 'В сделке',
  sold: 'Продана',
  removed: 'Снята с продажи',
};

export function saleStatusKind(equipment = {}) {
  const rawStatus = lower(equipment.saleStatus || equipment.salesStatus || equipment.status || equipment.category);
  if (equipment.category === 'sold' || rawStatus === 'sold' || rawStatus === 'продана' || rawStatus === 'продано') return 'sold';
  if (rawStatus === 'removed' || rawStatus === 'withdrawn' || rawStatus === 'снята с продажи' || rawStatus === 'снято с продажи') return 'removed';
  if (rawStatus === 'reserved' || rawStatus === 'резерв') return 'reserved';
  if (rawStatus === 'in_deal' || rawStatus === 'deal' || rawStatus === 'в сделке') return 'in_deal';
  if (hasSaleMarker(rawStatus) || equipment.isForSale) return 'on_sale';
  return 'unknown';
}

export function isSaleModeEquipment(equipment, context = {}) {
  if (context.salesContext === true || hasSaleMarker(context.source) || hasSaleMarker(context.context)) return true;
  if (!equipment) return false;

  if (equipment.isForSale === true) return true;
  if (text(equipment.saleStatus)) return true;
  if (text(equipment.salesStatus)) return true;
  if (hasSaleMarker(equipment.status)) return true;
  if (hasSaleMarker(equipment.category)) return true;
  if (hasSaleMarker(equipment.tag)) return true;
  if (Array.isArray(equipment.tags) && equipment.tags.some(hasSaleMarker)) return true;

  return false;
}

export function saleStatusLabel(equipment = {}) {
  const kind = saleStatusKind(equipment);
  if (SALE_STATUS_LABELS[kind]) return SALE_STATUS_LABELS[kind];
  const rawStatus = text(equipment.saleStatus || equipment.salesStatus);
  if (rawStatus) return rawStatus;
  return 'Продажный статус не указан';
}

export function buildSaleStatusPatch(equipment = {}, nextStatus) {
  const baseCategory = equipment.category === 'sold' ? 'own' : (equipment.category || 'own');
  if (nextStatus === 'on_sale') {
    return {
      category: baseCategory,
      isForSale: true,
      activeInFleet: false,
      status: 'available',
      saleStatus: SALE_STATUS_LABELS.on_sale,
    };
  }
  if (nextStatus === 'reserved') {
    return {
      category: baseCategory,
      isForSale: true,
      activeInFleet: false,
      status: 'reserved',
      saleStatus: SALE_STATUS_LABELS.reserved,
    };
  }
  if (nextStatus === 'in_deal') {
    return {
      category: baseCategory,
      isForSale: true,
      activeInFleet: false,
      status: 'reserved',
      saleStatus: SALE_STATUS_LABELS.in_deal,
    };
  }
  if (nextStatus === 'sold') {
    return {
      category: 'sold',
      isForSale: false,
      activeInFleet: false,
      status: 'inactive',
      saleStatus: SALE_STATUS_LABELS.sold,
    };
  }
  if (nextStatus === 'removed') {
    return {
      category: baseCategory,
      isForSale: false,
      activeInFleet: false,
      status: 'inactive',
      saleStatus: SALE_STATUS_LABELS.removed,
    };
  }
  return {};
}

export function saleDocumentsReadiness(documents = []) {
  const count = Array.isArray(documents) ? documents.length : 0;
  return {
    count,
    label: count > 0 ? 'Есть' : 'Не хватает',
  };
}
