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
  ].includes(normalized);
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
  if (equipment.category === 'sold') return 'Продана';
  const rawStatus = text(equipment.saleStatus || equipment.salesStatus);
  if (rawStatus) return rawStatus;
  if (lower(equipment.status) === 'reserved') return 'Резерв';
  if (hasSaleMarker(equipment.status)) return 'На продаже';
  if (equipment.isForSale) return 'На продаже';
  return 'Продажный статус не указан';
}

export function saleDocumentsReadiness(documents = []) {
  const count = Array.isArray(documents) ? documents.length : 0;
  return {
    count,
    label: count > 0 ? 'Есть' : 'Не хватает',
  };
}
