const { resolveRentalEquipment } = require('./equipment-matching');
const { linkedRentalIds } = require('./gantt-rental-link-guard');

function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function compact(values) {
  return values.map(text).filter(Boolean);
}

const RENTAL_ACTIVE_STATUSES = new Set([
  'active',
  'created',
  'confirmed',
  'in_progress',
  'current',
  'ongoing',
  'действующая',
  'активная',
  'подтверждена',
  'подтверждено',
]);

const RENTED_EQUIPMENT_STATUSES = new Set(['rented', 'rent', 'in_rent', 'в аренде', 'аренда']);

const SOLD_STATUSES = new Set(['sold', 'продана', 'продано']);
const REMOVED_SALE_STATUSES = new Set(['removed', 'withdrawn', 'off_sale', 'off-sale', 'снята с продажи', 'снято с продажи']);
const ACTIVE_SALE_STATUSES = new Set([
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
  'pdi',
  'pre_sale',
  'pre-sale',
  'presale',
  'предпродажная',
  'предпродажная подготовка',
]);

const CUSTOMER_MARKERS = new Set([
  'client',
  'customer',
  'client_owned',
  'client-owned',
  'customer_owned',
  'customer-owned',
  'commercial_repair',
  'commercial-repair',
  'клиентская',
  'клиент',
  'сторонняя',
  'стороннего клиента',
]);

function saleStatusKind(equipment = {}) {
  const raw = lower(equipment.saleStatus || equipment.salesStatus || equipment.status || equipment.category);
  if (equipment.category === 'sold' || SOLD_STATUSES.has(raw)) return 'sold';
  if (REMOVED_SALE_STATUSES.has(raw)) return 'removed';
  if (['reserved', 'резерв'].includes(raw)) return 'reserved';
  if (['in_deal', 'deal', 'в сделке'].includes(raw)) return 'in_deal';
  if (ACTIVE_SALE_STATUSES.has(raw)) return 'on_sale';
  return 'unknown';
}

function hasActiveSaleFlag(equipment = {}) {
  return equipment.isForSale === true ||
    equipment.forSale === true ||
    equipment.saleMode === true ||
    ACTIVE_SALE_STATUSES.has(lower(equipment.saleMode)) ||
    ACTIVE_SALE_STATUSES.has(lower(equipment.salePdiStatus)) ||
    ACTIVE_SALE_STATUSES.has(lower(equipment.saleStatus)) ||
    ACTIVE_SALE_STATUSES.has(lower(equipment.salesStatus));
}

function isSoldEquipment(equipment = {}) {
  return saleStatusKind(equipment) === 'sold' ||
    SOLD_STATUSES.has(lower(equipment.status)) ||
    SOLD_STATUSES.has(lower(equipment.category)) ||
    equipment.sold === true ||
    equipment.isSold === true ||
    Boolean(equipment.soldAt || equipment.saleCompletedAt || equipment.salesCompletedAt);
}

function isForSaleEquipment(equipment = {}) {
  if (isSoldEquipment(equipment)) return false;
  if (saleStatusKind(equipment) === 'removed') return false;
  return hasActiveSaleFlag(equipment) ||
    ['reserved', 'in_deal', 'on_sale'].includes(saleStatusKind(equipment)) ||
    Boolean(equipment.saleCondition || equipment.saleReceiptStatus || equipment.salePrice1 || equipment.salePrice2 || equipment.salePrice3);
}

function hasCustomerOwnedSignal(equipment = {}) {
  const values = [
    equipment.category,
    equipment.owner,
    equipment.ownerType,
    equipment.ownership,
    equipment.source,
    equipment.serviceContext,
    equipment.repairContext,
    equipment.equipmentContext,
    equipment.typeContext,
  ].map(lower);
  if (values.some(value => CUSTOMER_MARKERS.has(value))) return true;
  if (equipment.clientOwned === true || equipment.customerOwned === true || equipment.isClientOwned === true) return true;
  if (text(equipment.clientId) || text(equipment.clientName) || text(equipment.customerId) || text(equipment.customerName)) {
    const owner = lower(equipment.owner || equipment.category);
    return !owner || CUSTOMER_MARKERS.has(owner);
  }
  return false;
}

function isActiveRentalStatus(status) {
  return RENTAL_ACTIVE_STATUSES.has(lower(status));
}

function rentalDateScore(rental, now = new Date()) {
  const today = Number.isFinite(now.getTime()) ? now : new Date();
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const start = Date.parse(rental?.startDate || rental?.dateFrom || rental?.createdAt || '');
  const end = Date.parse(rental?.endDate || rental?.plannedReturnDate || rental?.returnDate || '');
  if (Number.isFinite(start) && Number.isFinite(end) && start <= todayMs && todayMs <= end) return 0;
  if (Number.isFinite(start)) return Math.abs(start - todayMs);
  if (Number.isFinite(end)) return Math.abs(end - todayMs);
  return Number.MAX_SAFE_INTEGER;
}

function buildRentalRows(data = {}) {
  return [
    ...(Array.isArray(data.gantt_rentals) ? data.gantt_rentals : []),
    ...(Array.isArray(data.rentals) ? data.rentals : []),
  ].filter(row => isActiveRentalStatus(row?.status));
}

function rentalMatchesEquipment(rental, equipment, equipmentList) {
  if (!rental || !equipment) return false;
  const resolved = resolveRentalEquipment(rental, equipmentList);
  return resolved?.equipmentId && resolved.equipmentId === equipment.id;
}

function findBestRentalLinkForEquipment(equipment, data = {}) {
  const equipmentList = Array.isArray(data.equipment) ? data.equipment : [equipment].filter(Boolean);
  const activeRows = buildRentalRows(data)
    .filter(rental => rentalMatchesEquipment(rental, equipment, equipmentList))
    .sort((a, b) => rentalDateScore(a) - rentalDateScore(b));
  if (!activeRows.length) return null;

  const row = activeRows[0];
  const classicRentals = Array.isArray(data.rentals) ? data.rentals : [];
  const linkedIds = compact([row.rentalId, row.sourceRentalId, row.originalRentalId, row.id, ...linkedRentalIds(row)]);
  const classic = classicRentals.find(rental => linkedIds.includes(text(rental.id))) || null;
  const source = classic || row;
  const rentalId = text(row.rentalId || row.sourceRentalId || row.originalRentalId || classic?.id || row.id);

  return {
    rentalId,
    ganttRentalId: text(row.id),
    clientId: text(source.clientId || row.clientId),
    objectId: text(source.objectId || row.objectId || source.clientObjectId || row.clientObjectId),
    contractId: text(source.contractId || row.contractId || source.clientContractId || row.clientContractId),
    client: text(source.client || row.client || source.clientName || row.clientName),
    clientName: text(source.clientName || row.clientName || source.client || row.client),
  };
}

function getRentalEquipmentIds(data = {}) {
  const equipmentList = Array.isArray(data.equipment) ? data.equipment : [];
  const ids = new Set();
  for (const rental of buildRentalRows(data)) {
    const resolved = resolveRentalEquipment(rental, equipmentList);
    if (resolved?.equipmentId) ids.add(resolved.equipmentId);
  }
  return ids;
}

function hasWarrantyClaim(equipment, data = {}) {
  const claims = Array.isArray(data.warranty_claims) ? data.warranty_claims : [];
  return claims.some(claim =>
    text(claim.equipmentId) === text(equipment.id) ||
    (text(claim.inventoryNumber) && text(claim.inventoryNumber) === text(equipment.inventoryNumber)) ||
    (text(claim.serialNumber) && text(claim.serialNumber) === text(equipment.serialNumber)),
  );
}

function filterEquipmentByTicketContext(equipmentList, ticketContext, data = {}) {
  const items = Array.isArray(equipmentList) ? equipmentList : [];
  const key = ticketContext?.key || ticketContext;
  if (!key) {
    return { items, reason: 'Направление не выбрано.', isFallback: true };
  }

  if (key === 'rental') {
    const rentalEquipmentIds = getRentalEquipmentIds({ ...data, equipment: data.equipment || items });
    const filtered = items.filter(item => rentalEquipmentIds.has(text(item.id)) || RENTED_EQUIPMENT_STATUSES.has(lower(item.status)));
    return { items: filtered, reason: 'Показана техника в активной аренде.', isFallback: false };
  }

  if (key === 'sales') {
    const filtered = items.filter(item => isForSaleEquipment(item));
    return { items: filtered, reason: 'Показана техника в продаже или предпродажной подготовке.', isFallback: false };
  }

  if (key === 'commercial_repair') {
    const filtered = items.filter(hasCustomerOwnedSignal);
    if (filtered.length) {
      return { items: filtered, reason: 'Показана клиентская техника для коммерческого ремонта.', isFallback: false };
    }
    const allEquipment = Array.isArray(data.equipment) ? data.equipment : items;
    const hasAnyCustomerSignal = allEquipment.some(hasCustomerOwnedSignal);
    if (!hasAnyCustomerSignal) {
      return { items, reason: 'Клиентская техника не размечена в базе, доступен общий поиск.', isFallback: true };
    }
    return { items: filtered, reason: 'Клиентская техника по запросу не найдена.', isFallback: false };
  }

  if (key === 'after_sales') {
    const filtered = items.filter(item => isSoldEquipment(item) || hasWarrantyClaim(item, data));
    return { items: filtered, reason: 'Показана проданная техника и техника с рекламациями.', isFallback: false };
  }

  return { items, reason: 'Направление не распознано, доступен общий поиск.', isFallback: true };
}

module.exports = {
  filterEquipmentByTicketContext,
  findBestRentalLinkForEquipment,
  isForSaleEquipment,
  isSoldEquipment,
  hasCustomerOwnedSignal,
};
