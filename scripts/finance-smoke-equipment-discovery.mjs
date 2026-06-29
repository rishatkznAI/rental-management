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
export const FINANCE_SMOKE_FIXTURE_INVENTORY_NUMBER = 'SMOKE-RENTAL-001';

export const FINANCE_SMOKE_FIXTURE_CONTRACT = {
  inventoryNumber: FINANCE_SMOKE_FIXTURE_INVENTORY_NUMBER,
  serialNumber: FINANCE_SMOKE_FIXTURE_INVENTORY_NUMBER,
  status: 'available',
  category: 'own',
  saleMode: 'absent/null/false',
  saleStatus: 'absent/null',
  salesStatus: 'absent/null',
  repairMode: false,
  endpoint: '/api/equipment?paginated=true&page=1&pageSize=100&saleState=available_for_rent',
};

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

function emptyLike(value) {
  return value === undefined || value === null || value === false || String(value).trim() === '';
}

export function isFinanceSmokeFixtureRecord(equipment = {}) {
  if (!equipment || typeof equipment !== 'object') return false;
  if (String(equipment.inventoryNumber || '').trim() !== FINANCE_SMOKE_FIXTURE_INVENTORY_NUMBER) return false;
  if (String(equipment.serialNumber || '').trim() !== FINANCE_SMOKE_FIXTURE_INVENTORY_NUMBER) return false;
  if (normalizedEquipmentText(equipment.status) !== 'available') return false;
  if (normalizedEquipmentText(equipment.category) !== 'own') return false;
  if (!emptyLike(equipment.saleMode)) return false;
  if (!emptyLike(equipment.saleStatus)) return false;
  if (!emptyLike(equipment.salesStatus)) return false;
  return isRentalModeEquipmentRecord(equipment);
}

export function financeSmokeFixtureDiagnostic(items = [], { source = 'unknown' } = {}) {
  const equipmentList = Array.isArray(items) ? items.filter(item => item && typeof item === 'object') : [];
  const matchingInventory = equipmentList.filter(item =>
    String(item.inventoryNumber || '').trim() === FINANCE_SMOKE_FIXTURE_INVENTORY_NUMBER ||
    String(item.serialNumber || '').trim() === FINANCE_SMOKE_FIXTURE_INVENTORY_NUMBER,
  );
  const valid = matchingInventory.find(isFinanceSmokeFixtureRecord) || null;
  return {
    source,
    expected: FINANCE_SMOKE_FIXTURE_CONTRACT,
    present: Boolean(valid),
    matchingRecords: matchingInventory.map(describeEquipmentCandidate),
    warning: valid
      ? ''
      : `Production data contract violation: ${FINANCE_SMOKE_FIXTURE_INVENTORY_NUMBER} must exist as available own rental-mode equipment visible to finance smoke.`,
  };
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
  let firstPageFixtureDiagnostic = null;

  for (let page = 1; page <= maxPages; page += 1) {
    const path = `/api/equipment?paginated=true&page=${page}&pageSize=${pageSize}&saleState=available_for_rent&sortBy=inventoryNumber&sortDir=asc`;
    const payload = await getJson(path);
    const items = payloadItems(payload);
    const pagination = payloadPagination(payload);
    mergeUniqueEquipment(fetched, items);
    const summary = summarizeEquipmentCandidates(items);
    const fixture = financeSmokeFixtureDiagnostic(items, { source: 'paginated_available_for_rent' });
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
      fixture: {
        expectedInventoryNumber: FINANCE_SMOKE_FIXTURE_INVENTORY_NUMBER,
        present: fixture.present,
      },
    };
    if (page === 1) {
      firstPageFixtureDiagnostic = financeSmokeFixtureDiagnostic(items, { source: 'paginated_available_for_rent_page_1' });
    }
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
          productionFixture: {
            page1: firstPageFixtureDiagnostic,
            fetched: financeSmokeFixtureDiagnostic(fetched, { source: 'fetched' }),
          },
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
      productionFixture: {
        page1: firstPageFixtureDiagnostic,
        fetched: financeSmokeFixtureDiagnostic(fetched, { source: 'fetched' }),
      },
      selected: describeEquipmentCandidate(selected),
    },
  };
}
