const SALE_MARKERS = new Set([
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
]);

export function normalizedEquipmentText(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function hasEquipmentSaleMarker(value) {
  return SALE_MARKERS.has(normalizedEquipmentText(value));
}

export function isSaleModeEquipmentRecord(equipment = {}) {
  if (!equipment || typeof equipment !== 'object') return false;
  if (equipment.saleMode === true || hasEquipmentSaleMarker(equipment.saleMode)) return true;
  if (equipment.isForSale === true || equipment.forSale === true) return true;
  if (String(equipment.saleStatus || '').trim()) return true;
  if (String(equipment.salesStatus || '').trim()) return true;
  if (hasEquipmentSaleMarker(equipment.status)) return true;
  if (hasEquipmentSaleMarker(equipment.category)) return true;
  if (hasEquipmentSaleMarker(equipment.tag)) return true;
  return Array.isArray(equipment.tags) && equipment.tags.some(hasEquipmentSaleMarker);
}

export function isRepairModeEquipmentRecord(equipment = {}) {
  if (!equipment || typeof equipment !== 'object') return false;
  const category = normalizedEquipmentText(equipment.category);
  const status = normalizedEquipmentText(equipment.status);
  return category === 'client' || category === 'partner' || status === 'in_service';
}

export function isRentalModeEquipmentRecord(equipment = {}) {
  if (!String(equipment?.id || '').trim()) return false;
  return !isSaleModeEquipmentRecord(equipment) && !isRepairModeEquipmentRecord(equipment);
}

export function summarizeEquipmentCandidates(items = []) {
  const equipmentList = Array.isArray(items) ? items.filter(item => item && typeof item === 'object') : [];
  const rentalModeCandidates = equipmentList.filter(isRentalModeEquipmentRecord);
  const skippedSaleMode = equipmentList.filter(isSaleModeEquipmentRecord);
  const skippedRepairMode = equipmentList.filter(item => !isSaleModeEquipmentRecord(item) && isRepairModeEquipmentRecord(item));
  return {
    totalEquipment: equipmentList.length,
    rentalModeCandidates: rentalModeCandidates.length,
    skippedSaleMode: skippedSaleMode.length,
    skippedRepairMode: skippedRepairMode.length,
  };
}

export function describeEquipmentCandidate(equipment = null) {
  if (!equipment || typeof equipment !== 'object') return null;
  return {
    id: equipment.id || null,
    inventoryNumber: equipment.inventoryNumber || null,
    serialNumber: equipment.serialNumber || null,
    manufacturer: equipment.manufacturer || null,
    model: equipment.model || null,
    status: equipment.status || null,
    category: equipment.category || null,
    saleMode: equipment.saleMode ?? null,
    isForSale: equipment.isForSale ?? equipment.forSale ?? null,
    saleStatus: equipment.saleStatus || equipment.salesStatus || null,
  };
}

function payloadItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function payloadPagination(payload) {
  return payload && typeof payload === 'object' && payload.pagination ? payload.pagination : null;
}

function mergeUniqueEquipment(target, source) {
  const seen = new Set(target.map(item => String(item?.id || '')));
  for (const item of source) {
    const id = String(item?.id || '').trim();
    if (!id || seen.has(id)) continue;
    target.push(item);
    seen.add(id);
  }
}

export async function discoverRentalModeEquipment({
  getJson,
  maxPages = 5,
  pageSize = 100,
  log = () => {},
} = {}) {
  if (typeof getJson !== 'function') {
    throw new TypeError('discoverRentalModeEquipment requires getJson(path)');
  }

  const fetched = [];
  const requests = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const path = `/api/equipment?paginated=true&page=${page}&pageSize=${pageSize}&saleState=available_for_rent&sortBy=inventoryNumber&sortDir=asc`;
    const payload = await getJson(path);
    const items = payloadItems(payload);
    const pagination = payloadPagination(payload);
    mergeUniqueEquipment(fetched, items);
    const summary = summarizeEquipmentCandidates(items);
    const request = {
      path,
      source: 'paginated_available_for_rent',
      page,
      pageSize,
      items: items.length,
      pagination: pagination ? {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: pagination.total,
        totalPages: pagination.totalPages,
        hasNextPage: Boolean(pagination.hasNextPage),
      } : null,
      ...summary,
    };
    requests.push(request);
    log('equipmentEconomicsDiscoveryPage', request);

    const selectedFromPage = items.find(isRentalModeEquipmentRecord) || null;
    if (selectedFromPage) {
      return {
        selected: selectedFromPage,
        diagnostics: {
          strategy: 'paginated_available_for_rent',
          requests,
          fetched: summarizeEquipmentCandidates(fetched),
          selected: describeEquipmentCandidate(selectedFromPage),
        },
      };
    }

    if (!pagination?.hasNextPage) break;
  }

  const fallbackPath = '/api/equipment';
  const fallbackPayload = await getJson(fallbackPath);
  const fallbackItems = payloadItems(fallbackPayload);
  mergeUniqueEquipment(fetched, fallbackItems);
  const fallbackRequest = {
    path: fallbackPath,
    source: 'unpaginated_all',
    items: fallbackItems.length,
    pagination: payloadPagination(fallbackPayload),
    ...summarizeEquipmentCandidates(fallbackItems),
  };
  requests.push(fallbackRequest);
  log('equipmentEconomicsDiscoveryPage', fallbackRequest);

  const selected = fetched.find(isRentalModeEquipmentRecord) || null;
  return {
    selected,
    diagnostics: {
      strategy: selected ? 'combined' : 'not_found',
      requests,
      fetched: summarizeEquipmentCandidates(fetched),
      selected: describeEquipmentCandidate(selected),
    },
  };
}
