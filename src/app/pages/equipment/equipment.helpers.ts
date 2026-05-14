import type { GanttRentalData } from '../../mock-data.ts';
import { isSaleModeEquipment, saleStatusKind } from '../../lib/equipmentSaleMode.js';
import { deriveSignalState } from '../../lib/gsm.ts';
import { formatDate } from '../../lib/utils.ts';
import type {
  Document,
  Equipment,
  EquipmentDrive,
  EquipmentOwnerType,
  Rental,
  ServiceTicket,
} from '../../types.ts';
import type { ActiveRentalIndex, EquipmentRegistryStatusKind, EquipmentTab, EquipmentTypeOptions } from './equipment.types.ts';

export type { ActiveRentalIndex, EquipmentRegistryStatusKind, EquipmentTab, EquipmentTypeOptions } from './equipment.types.ts';

type RegistryMatchOptions = {
  canEquipmentParticipateInRentals?: (equipment: Partial<Equipment>) => boolean;
};

const EQUIPMENT_CATEGORY_LABELS = {
  own: 'Собственная',
  sold: 'Проданная',
  client: 'Клиентская',
  partner: 'Партнёрская',
} as const;

export function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

export function lowerText(value: unknown) {
  return cleanText(value).toLowerCase();
}

export function isCurrentRentalStatus(status: GanttRentalData['status']) {
  return status === 'active' || status === 'created';
}

export function buildActiveRentalIndex(eqList: Equipment[], ganttRentals: GanttRentalData[]): ActiveRentalIndex {
  const inventoryCounts = new Map<string, number>();
  eqList.forEach((eq) => {
    inventoryCounts.set(eq.inventoryNumber, (inventoryCounts.get(eq.inventoryNumber) ?? 0) + 1);
  });

  const equipmentIds = new Set<string>();
  const uniqueInventoryNumbers = new Set<string>();
  for (const rental of ganttRentals) {
    if (!isCurrentRentalStatus(rental.status)) continue;
    if (rental.equipmentId) {
      equipmentIds.add(rental.equipmentId);
      continue;
    }
    if ((inventoryCounts.get(rental.equipmentInv) ?? 0) === 1) {
      uniqueInventoryNumbers.add(rental.equipmentInv);
    }
  }

  return { equipmentIds, uniqueInventoryNumbers };
}

export function hasCurrentRental(equipment: Equipment, activeRentalIndex: ActiveRentalIndex) {
  return activeRentalIndex.equipmentIds.has(equipment.id)
    || activeRentalIndex.uniqueInventoryNumbers.has(equipment.inventoryNumber);
}

export function enrichEquipment(eqList: Equipment[], ganttRentals: GanttRentalData[]): Equipment[] {
  const inventoryCounts = new Map<string, number>();
  eqList.forEach((eq) => {
    inventoryCounts.set(eq.inventoryNumber, (inventoryCounts.get(eq.inventoryNumber) ?? 0) + 1);
  });

  const activeById = new Map<string, GanttRentalData>();
  const activeByUniqueInv = new Map<string, GanttRentalData>();
  for (const rental of ganttRentals) {
    if (rental.status === 'active' || rental.status === 'created') {
      if (rental.equipmentId) {
        const existing = activeById.get(rental.equipmentId);
        if (!existing || rental.status === 'active') {
          activeById.set(rental.equipmentId, rental);
        }
        continue;
      }

      if ((inventoryCounts.get(rental.equipmentInv) ?? 0) === 1) {
        const existing = activeByUniqueInv.get(rental.equipmentInv);
        if (!existing || rental.status === 'active') {
          activeByUniqueInv.set(rental.equipmentInv, rental);
        }
      }
    }
  }

  return eqList.map((eq) => {
    const active = activeById.get(eq.id) ?? activeByUniqueInv.get(eq.inventoryNumber);
    if (!active) return eq;
    return {
      ...eq,
      currentClient: eq.currentClient || active.client || eq.currentClient,
      returnDate: eq.returnDate || active.endDate || eq.returnDate,
    };
  });
}

export function getOwnerLabel(owner: EquipmentOwnerType | string | null | undefined): string {
  const labels: Record<EquipmentOwnerType, string> = {
    own: 'Собственная',
    investor: 'Инвестор',
    sublease: 'Субаренда',
  };
  if (!owner) return '—';
  return labels[owner as EquipmentOwnerType] || String(owner);
}

export function getEquipmentDriveKind(drive: EquipmentDrive | string | null | undefined) {
  const value = String(drive ?? '').trim().toLowerCase();
  if (!value) return 'other';
  if (value.includes('4x4') || value.includes('4х4')) return 'diesel_4x4';
  if (value === 'electric' || value.includes('электро') || value.includes('electro')) return 'electric';
  if (value === 'diesel' || value.includes('дизель')) return 'diesel';
  return 'other';
}

export function getEquipmentDriveLabel(drive: EquipmentDrive | string | null | undefined): string {
  const labels: Record<EquipmentDrive, string> = {
    diesel: 'Дизель',
    electric: 'Электро',
  };
  const kind = getEquipmentDriveKind(drive);
  if (kind === 'diesel_4x4') return 'Дизель 4x4';
  if (kind === 'other') return String(drive ?? '').trim() || 'Другое';
  return labels[kind as EquipmentDrive];
}

export function getEquipmentCategoryLabel(category: string | null | undefined) {
  if (!category) return '—';
  return EQUIPMENT_CATEGORY_LABELS[category as keyof typeof EQUIPMENT_CATEGORY_LABELS] || category;
}

export function getTypeSearchText(type: string | null | undefined, catalog: EquipmentTypeOptions) {
  const value = String(type ?? '').trim();
  if (!value) return '';
  const label = catalog.find(item => item.value === value)?.label || value;
  return `${value} ${label}`.toLowerCase();
}

export function getEquipmentTypeGroup(type: string | null | undefined, catalog: EquipmentTypeOptions) {
  const text = getTypeSearchText(type, catalog);
  if (!text) return 'other';
  if (text.includes('scissor') || text.includes('ножнич')) return 'scissor';
  if (text.includes('articulated') || text.includes('коленчат')) return 'articulated';
  if (text.includes('telescopic') || text.includes('телескоп')) return 'telescopic';
  if (text.includes('forklift') || text.includes('loader') || text.includes('погруз')) return 'forklift';
  return 'other';
}

export function matchesEquipmentTypeFilter(
  equipment: Equipment,
  typeFilter: string,
  catalog: EquipmentTypeOptions,
) {
  if (typeFilter === 'all') return true;
  if (typeFilter.startsWith('group:')) {
    return getEquipmentTypeGroup(equipment.type, catalog) === typeFilter.slice('group:'.length);
  }
  if (typeFilter.startsWith('exact:')) {
    return equipment.type === typeFilter.slice('exact:'.length);
  }
  return equipment.type === typeFilter;
}

export function matchesDriveFilter(equipment: Equipment, driveFilter: string) {
  if (driveFilter === 'all') return true;
  return getEquipmentDriveKind(equipment.drive) === driveFilter;
}

export function matchesOwnerFilter(equipment: Equipment, ownerFilter: string) {
  if (ownerFilter === 'all') return true;
  if (ownerFilter.startsWith('ownerName:')) {
    return (equipment.ownerName || '').trim() === ownerFilter.slice('ownerName:'.length);
  }
  return equipment.owner === ownerFilter;
}

export function getRegistryPercent(value: number, total: number) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

export function getStatusKindFromBaseStatus(status: Equipment['status']): EquipmentRegistryStatusKind {
  const normalized = lowerText(status);
  if (normalized === 'rented') return 'rented';
  if (normalized === 'reserved') return 'reserved';
  if (normalized === 'in_service') return 'service';
  if (['inactive', 'written_off', 'written-off', 'списан', 'списана', 'списанная'].includes(normalized)) return 'written_off';
  return 'available';
}

export function hasExplicitSaleMode(equipment: Partial<Equipment> & Record<string, unknown>) {
  const saleMode = equipment.saleMode;
  const normalized = String(saleMode ?? '').trim().toLowerCase();
  return saleMode === true || ['sale', 'sales', 'for_sale', 'on_sale', 'на продаже', 'на продажу'].includes(normalized);
}

export function getEquipmentSaleKind(equipment: Partial<Equipment> & Record<string, unknown>) {
  const kind = saleStatusKind(equipment);
  if (kind !== 'unknown') return kind;
  return hasExplicitSaleMode(equipment) || equipment.isForSale ? 'on_sale' : 'unknown';
}

function getExplicitSaleStatusKind(equipment: Partial<Equipment> & Record<string, unknown>) {
  if (!cleanText(equipment.saleStatus) && !cleanText(equipment.salesStatus)) return 'unknown';
  return saleStatusKind({
    saleStatus: equipment.saleStatus,
    salesStatus: equipment.salesStatus,
    category: equipment.category,
  });
}

function hasActiveSaleRegistrySignal(equipment: Partial<Equipment> & Record<string, unknown>) {
  const explicitSaleKind = getExplicitSaleStatusKind(equipment);
  return equipment.saleMode === true
    || equipment.forSale === true
    || equipment.isForSale === true
    || ['on_sale', 'reserved', 'in_deal'].includes(explicitSaleKind);
}

export function isSaleRegistryEquipment(equipment: Partial<Equipment> & Record<string, unknown>) {
  const saleKind = getEquipmentSaleKind(equipment);
  return Boolean(
    hasExplicitSaleMode(equipment)
    || isSaleModeEquipment(equipment)
    || saleKind !== 'unknown'
    || equipment.saleCondition
    || equipment.saleType
    || (equipment.salePdiStatus && equipment.salePdiStatus !== 'not_started')
    || equipment.saleReceiptStatus
    || equipment.salePrice1
    || equipment.salePrice2
    || equipment.salePrice3
    || equipment.category === 'sold',
  );
}

export function isHiddenRegistryRecord(equipment: Partial<Equipment> & Record<string, unknown>) {
  return equipment.hidden === true
    || equipment.isHidden === true
    || equipment.archived === true
    || equipment.isArchived === true
    || equipment.deleted === true
    || equipment.isDeleted === true
    || String(equipment.status) === 'archived';
}

export function isSoldEquipment(equipment: Partial<Equipment> & Record<string, unknown>) {
  return equipment.category === 'sold' || getExplicitSaleStatusKind(equipment) === 'sold' || lowerText(equipment.status) === 'sold';
}

export function isForSaleEquipment(equipment: Partial<Equipment> & Record<string, unknown>) {
  const explicitSaleKind = getExplicitSaleStatusKind(equipment);
  return !isSoldEquipment(equipment)
    && explicitSaleKind !== 'removed'
    && hasActiveSaleRegistrySignal(equipment);
}

export function isWrittenOffEquipment(equipment: Partial<Equipment> & Record<string, unknown>) {
  if (isSoldEquipment(equipment) || isForSaleEquipment(equipment)) return false;
  const statusKind = getStatusKindFromBaseStatus(equipment.status as Equipment['status']);
  return statusKind === 'written_off'
    || equipment.isWrittenOff === true
    || equipment.disposed === true
    || lowerText(equipment.writeOffStatus) === 'written_off'
    || lowerText(equipment.writeOffStatus) === 'written-off';
}

function resolveRegistryOptions(options: RegistryMatchOptions = {}) {
  return {
    canEquipmentParticipateInRentals: typeof options.canEquipmentParticipateInRentals === 'function'
      ? options.canEquipmentParticipateInRentals
      : () => true,
  };
}

export function getEquipmentRegistryBucket(equipment: Equipment, activeRentalIndex?: ActiveRentalIndex): EquipmentRegistryStatusKind {
  if (isSoldEquipment(equipment)) return 'sold';
  if (isForSaleEquipment(equipment)) return 'for_sale';
  if (isWrittenOffEquipment(equipment)) return 'written_off';
  if (activeRentalIndex && hasCurrentRental(equipment, activeRentalIndex)) return 'rented';
  return getStatusKindFromBaseStatus(equipment.status);
}

export function getRegistryStatusKind(equipment: Equipment, activeRentalIndex?: ActiveRentalIndex): EquipmentRegistryStatusKind {
  return getEquipmentRegistryBucket(equipment, activeRentalIndex);
}

export function matchesTabType(
  equipment: Equipment,
  activeTab: EquipmentTab,
  activeRentalIndex: ActiveRentalIndex,
  options: RegistryMatchOptions = {},
) {
  if (isHiddenRegistryRecord(equipment)) return false;
  if (activeTab === 'all') return true;
  const registryOptions = resolveRegistryOptions(options);
  const bucket = getEquipmentRegistryBucket(equipment, activeRentalIndex);
  if (activeTab === 'available') {
    return bucket === 'available'
      && registryOptions.canEquipmentParticipateInRentals(equipment)
      && !hasCurrentRental(equipment, activeRentalIndex);
  }
  if (activeTab === 'reserved') return bucket === 'reserved' && registryOptions.canEquipmentParticipateInRentals(equipment);
  if (activeTab === 'rented' || activeTab === 'service' || activeTab === 'written_off' || activeTab === 'for_sale' || activeTab === 'sold') {
    return bucket === activeTab;
  }
  return true;
}

export function matchesStatusFilter(
  equipment: Equipment,
  statusFilter: string,
  activeRentalIndex: ActiveRentalIndex,
  options: RegistryMatchOptions = {},
) {
  if (statusFilter === 'all') return true;
  if (statusFilter === 'available') return matchesTabType(equipment, 'available', activeRentalIndex, options);
  if (statusFilter === 'rented') return matchesTabType(equipment, 'rented', activeRentalIndex, options);
  if (statusFilter === 'reserved') return matchesTabType(equipment, 'reserved', activeRentalIndex, options);
  if (statusFilter === 'in_service') return matchesTabType(equipment, 'service', activeRentalIndex, options);
  if (statusFilter === 'inactive') return matchesTabType(equipment, 'written_off', activeRentalIndex, options);
  if (statusFilter === 'for_sale') return matchesTabType(equipment, 'for_sale', activeRentalIndex, options);
  if (statusFilter === 'sold') return matchesTabType(equipment, 'sold', activeRentalIndex, options);
  return equipment.status === statusFilter;
}

export function matchesEquipmentSearch(equipment: Equipment, query: string) {
  const normalized = query.toLowerCase().trim();
  if (!normalized) return true;
  const fields = [
    equipment.model,
    equipment.manufacturer,
    equipment.inventoryNumber,
    equipment.serialNumber,
    equipment.owner,
    equipment.ownerName,
    getOwnerLabel(equipment.owner),
    equipment.location,
  ];
  return fields.some((value) => String(value ?? '').toLowerCase().includes(normalized));
}

export type EquipmentFilterState = {
  activeTab: EquipmentTab;
  search: string;
  statusFilter: string;
  typeFilter: string;
  driveFilter: string;
  categoryFilter: string;
  fleetFilter: string;
  ownerFilter: string;
  locationFilter: string;
  activeRentalIndex: ActiveRentalIndex;
  equipmentTypeOptions: EquipmentTypeOptions;
  registryOptions?: RegistryMatchOptions;
};

export function equipmentFilterReasons(equipment: Equipment, filters: EquipmentFilterState) {
  const reasons: string[] = [];
  if (!matchesEquipmentSearch(equipment, filters.search)) reasons.push('search');
  if (!matchesStatusFilter(equipment, filters.statusFilter, filters.activeRentalIndex, filters.registryOptions)) reasons.push('status');
  if (!matchesEquipmentTypeFilter(equipment, filters.typeFilter, filters.equipmentTypeOptions)) reasons.push('type');
  if (!matchesDriveFilter(equipment, filters.driveFilter)) reasons.push('drive');
  if (filters.categoryFilter !== 'all' && equipment.category !== filters.categoryFilter) reasons.push('category');
  if (filters.fleetFilter !== 'all' && String(equipment.activeInFleet) !== filters.fleetFilter) reasons.push('activeInFleet');
  if (!matchesOwnerFilter(equipment, filters.ownerFilter)) reasons.push('owner');
  if (filters.locationFilter !== 'all' && equipment.location !== filters.locationFilter) reasons.push('location');
  if (!matchesTabType(equipment, filters.activeTab, filters.activeRentalIndex, filters.registryOptions)) reasons.push(`tab:${filters.activeTab}`);
  return reasons;
}

export function buildEquipmentTabCounts(
  equipmentList: Equipment[],
  tabs: Array<{ key: EquipmentTab }>,
  activeRentalIndex: ActiveRentalIndex,
  options: RegistryMatchOptions = {},
) {
  return tabs.reduce((counts, tab) => {
    counts[tab.key] = equipmentList.filter((item) => matchesTabType(item, tab.key, activeRentalIndex, options)).length;
    return counts;
  }, {} as Record<EquipmentTab, number>);
}

export function getRegistryOwnerLabel(equipment: Equipment) {
  if (equipment.ownerName?.trim()) return equipment.ownerName.trim();
  if (equipment.category === 'client') return 'Клиент';
  if (equipment.category === 'partner') return 'Партнёр';
  if (equipment.category === 'sold') return 'Продана';
  if (equipment.owner === 'own') return 'Скайтех';
  return getOwnerLabel(equipment.owner);
}

export function normalizeOwnerScopeKey(value: unknown) {
  return cleanText(value).toLowerCase();
}

export function equipmentMatchesInvestorBinding(
  equipment: Equipment,
  binding: { ownerId: string; ownerName: string },
) {
  const ownerId = normalizeOwnerScopeKey(binding.ownerId);
  const ownerName = normalizeOwnerScopeKey(binding.ownerName);
  const legacy = equipment as Equipment & Record<string, unknown>;
  const equipmentOwnerIds = [
    legacy.ownerId,
    legacy.owner_id,
  ].map(normalizeOwnerScopeKey).filter(Boolean);
  const equipmentOwnerNames = [
    equipment.ownerName,
    equipment.owner,
    legacy.ownerTitle,
  ].map(normalizeOwnerScopeKey).filter(Boolean);

  return Boolean(
    (ownerId && equipmentOwnerIds.includes(ownerId))
    || (ownerName && equipmentOwnerNames.includes(ownerName))
  );
}

export function hasEquipmentGsmData(equipment: Equipment) {
  const movementHistory = Array.isArray(equipment.gsmMovementHistory) ? equipment.gsmMovementHistory : [];
  return Boolean(
    equipment.gsmImei
    || equipment.gsmDeviceId
    || equipment.gsmTrackerId
    || equipment.gsmStatus
    || equipment.gsmSignalStatus
    || equipment.gsmLastSeenAt
    || equipment.gsmLastSignalAt
    || typeof equipment.gsmLastLat === 'number'
    || typeof equipment.gsmLastLng === 'number'
    || typeof equipment.gsmLatitude === 'number'
    || typeof equipment.gsmLongitude === 'number'
    || movementHistory.length > 0
  );
}

export function getEquipmentGsmDisplay(equipment: Equipment) {
  if (!hasEquipmentGsmData(equipment)) {
    return {
      label: 'Нет данных',
      className: 'bg-muted text-muted-foreground',
      dotClassName: 'bg-slate-400',
    };
  }

  const signalState = deriveSignalState(equipment, equipment.gsmLastSeenAt || equipment.gsmLastSignalAt || null);
  if (signalState === 'online') {
    return {
      label: 'Онлайн',
      className: 'bg-emerald-500/12 text-emerald-300',
      dotClassName: 'bg-emerald-400',
    };
  }
  if (signalState === 'location_only') {
    return {
      label: 'Нет связи',
      className: 'bg-yellow-500/12 text-yellow-300',
      dotClassName: 'bg-yellow-400',
    };
  }
  return {
    label: 'Офлайн',
    className: 'bg-red-500/12 text-red-300',
    dotClassName: 'bg-red-400',
  };
}

export function formatPreviewDate(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return formatDate(value);
}

export function formatPreviewNumber(value: unknown, suffix = '') {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return '—';
  return `${parsed.toLocaleString('ru-RU')}${suffix}`;
}

export function isEquipmentInventoryUnique(equipment: Equipment, allEquipment: Equipment[]) {
  const inventory = cleanText(equipment.inventoryNumber);
  if (!inventory) return false;
  return allEquipment.filter(item => cleanText(item.inventoryNumber) === inventory).length === 1;
}

export function recordMatchesEquipmentBySafeKey(
  record: Record<string, unknown> | null | undefined,
  equipment: Equipment,
  inventoryIsUnique: boolean,
) {
  if (!record) return false;
  if (record.equipmentId && equipment.id && cleanText(record.equipmentId) === equipment.id) return true;
  if (inventoryIsUnique && record.equipmentInv && cleanText(record.equipmentInv) === cleanText(equipment.inventoryNumber)) return true;
  if (inventoryIsUnique && record.inventoryNumber && cleanText(record.inventoryNumber) === cleanText(equipment.inventoryNumber)) return true;
  if (record.serialNumber && equipment.serialNumber && cleanText(record.serialNumber) === cleanText(equipment.serialNumber)) return true;
  return false;
}

export function rentalMatchesEquipment(rental: Rental, equipment: Equipment, inventoryIsUnique: boolean) {
  const legacy = rental as Rental & Record<string, unknown>;
  if (recordMatchesEquipmentBySafeKey(legacy, equipment, inventoryIsUnique)) return true;
  const equipmentRefs = Array.isArray(rental.equipment) ? rental.equipment : [];
  return equipmentRefs.some(ref => (
    cleanText(ref) === equipment.id
    || (inventoryIsUnique && cleanText(ref) === cleanText(equipment.inventoryNumber))
  ));
}

export function ganttRentalMatchesEquipment(rental: GanttRentalData, equipment: Equipment, inventoryIsUnique: boolean) {
  return recordMatchesEquipmentBySafeKey(rental as unknown as Record<string, unknown>, equipment, inventoryIsUnique);
}

export function getRentalStableIds(rentals: Rental[], ganttRentals: GanttRentalData[]) {
  const ids = new Set<string>();
  rentals.forEach((rental) => {
    if (rental.id) ids.add(rental.id);
  });
  ganttRentals.forEach((rental) => {
    [rental.id, rental.rentalId, rental.sourceRentalId, rental.originalRentalId]
      .filter(Boolean)
      .forEach(id => ids.add(String(id)));
  });
  return ids;
}

export function documentMatchesEquipmentOrRentals(
  document: Document,
  equipment: Equipment,
  inventoryIsUnique: boolean,
  rentalIds: Set<string>,
) {
  if (recordMatchesEquipmentBySafeKey(document as unknown as Record<string, unknown>, equipment, inventoryIsUnique)) return true;
  return Boolean(document.rentalId && rentalIds.has(document.rentalId));
}

export function serviceTicketMatchesEquipment(ticket: ServiceTicket, equipment: Equipment, inventoryIsUnique: boolean) {
  return recordMatchesEquipmentBySafeKey(ticket as unknown as Record<string, unknown>, equipment, inventoryIsUnique);
}

export function getGanttRentalRouteId(rental: GanttRentalData | null | undefined) {
  return cleanText(rental?.rentalId)
    || cleanText(rental?.sourceRentalId)
    || cleanText(rental?.originalRentalId)
    || cleanText(rental?.id);
}

export function getCurrentGanttRental(rentals: GanttRentalData[]) {
  return rentals.find(rental => rental.status === 'active')
    ?? rentals.find(rental => rental.status === 'created')
    ?? null;
}

export function isCurrentClassicRentalStatus(status: Rental['status']) {
  return status === 'active'
    || status === 'delivery'
    || status === 'confirmed'
    || status === 'return_planned';
}

export function getCurrentClassicRental(rentals: Rental[]) {
  return rentals.find(rental => isCurrentClassicRentalStatus(rental.status)) ?? null;
}

export function isOpenServiceTicket(ticket: ServiceTicket) {
  const status = lowerText(ticket.status);
  return status !== 'closed' && status !== 'cancelled' && status !== 'canceled';
}
