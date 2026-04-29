import React from 'react';
import { Link } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreVertical, Plus, Search } from 'lucide-react';
import { Button } from '../components/ui/button';
import { FilterButton, FilterDialog, FilterField } from '../components/ui/filter-dialog';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../lib/permissions';
import { isWarrantyMechanicRole, normalizeUserRole } from '../lib/userStorage';
import { useEquipmentList } from '../hooks/useEquipment';
import { useGanttData } from '../hooks/useRentals';
import {
  ACTIVE_FLEET_LABELS,
  compareEquipmentByPriority,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_SALE_PDI_LABELS,
  normalizeEquipmentList,
} from '../lib/equipmentClassification';
import { findEquipmentTypeLabel, mergeEquipmentTypesWithExistingEquipment, useEquipmentTypeCatalog } from '../lib/equipmentTypes';
import { formatCurrency, formatDate } from '../lib/utils';
import type {
  Equipment as EquipmentEntity,
  EquipmentDrive,
  EquipmentOwnerType,
  EquipmentSalePdiStatus,
  EquipmentStatus,
} from '../types';
import type { GanttRentalData } from '../mock-data';

type EquipmentTab = 'active' | 'sale' | 'sold' | 'service' | 'all';

function enrichEquipment(eqList: EquipmentEntity[], ganttRentals: GanttRentalData[]): EquipmentEntity[] {
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

function getOwnerLabel(owner: EquipmentOwnerType): string {
  const labels: Record<EquipmentOwnerType, string> = {
    own: 'Собственная',
    investor: 'Инвестор',
    sublease: 'Субаренда',
  };
  return labels[owner];
}

function getEquipmentDriveLabel(drive: EquipmentDrive): string {
  const labels: Record<EquipmentDrive, string> = {
    diesel: 'Дизель',
    electric: 'Электро',
  };
  return labels[drive];
}

function getPriorityAppearance(priority: EquipmentEntity['priority']) {
  if (priority === 'critical' || priority === 'high') {
    return 'bg-red-500/12 text-red-300';
  }
  if (priority === 'medium') {
    return 'bg-blue-500/12 text-blue-300';
  }
  return 'bg-emerald-500/12 text-emerald-300';
}

function getPriorityLabel(priority: EquipmentEntity['priority']) {
  const labels: Record<EquipmentEntity['priority'], string> = {
    low: 'Низкий',
    medium: 'Средний',
    high: 'Высокий',
    critical: 'Критический',
  };
  return labels[priority];
}

function getStatusAppearance(status: EquipmentStatus) {
  if (status === 'rented') return 'bg-blue-500/12 text-blue-300';
  if (status === 'available') return 'bg-emerald-500/12 text-emerald-300';
  if (status === 'reserved') return 'bg-yellow-500/12 text-yellow-300';
  if (status === 'in_service') return 'bg-orange-500/12 text-orange-300';
  return 'bg-muted text-muted-foreground';
}

function getStatusLabel(status: EquipmentStatus) {
  const labels: Record<EquipmentStatus, string> = {
    available: 'Свободен',
    rented: 'В аренде',
    reserved: 'Бронь',
    in_service: 'В сервисе',
    inactive: 'Списан',
  };
  return labels[status];
}

function getSalePdiAppearance(status: EquipmentSalePdiStatus = 'not_started') {
  if (status === 'ready') return 'bg-emerald-500/12 text-emerald-300';
  if (status === 'in_progress') return 'bg-orange-500/12 text-orange-300';
  return 'bg-secondary text-muted-foreground';
}

function matchesTabType(equipment: EquipmentEntity, activeTab: EquipmentTab) {
  if (activeTab === 'active') return equipment.activeInFleet && (equipment.category === 'own' || equipment.category === 'partner');
  if (activeTab === 'sale') return equipment.isForSale && equipment.category !== 'sold';
  if (activeTab === 'sold') return equipment.category === 'sold';
  if (activeTab === 'service') return equipment.category === 'client' || (!equipment.activeInFleet && equipment.category !== 'sold');
  return true;
}

function shouldLogWarrantyDebug() {
  return import.meta.env.DEV || window.localStorage.getItem('warrantyDebug') === '1';
}

function equipmentFilterReasons(
  equipment: EquipmentEntity,
  filters: {
    activeTab: EquipmentTab;
    search: string;
    statusFilter: string;
    typeFilter: string;
    driveFilter: string;
    categoryFilter: string;
    fleetFilter: string;
    ownerFilter: string;
    locationFilter: string;
  },
) {
  const query = filters.search.toLowerCase().trim();
  const reasons: string[] = [];
  const matchesSearch = query === ''
    || equipment.inventoryNumber.toLowerCase().includes(query)
    || equipment.model.toLowerCase().includes(query)
    || equipment.manufacturer.toLowerCase().includes(query)
    || equipment.serialNumber.toLowerCase().includes(query)
    || equipment.currentClient?.toLowerCase().includes(query)
    || equipment.location?.toLowerCase().includes(query);
  if (!matchesSearch) reasons.push('search');
  if (filters.statusFilter !== 'all' && equipment.status !== filters.statusFilter) reasons.push('status');
  if (filters.typeFilter !== 'all' && equipment.type !== filters.typeFilter) reasons.push('type');
  if (filters.driveFilter !== 'all' && equipment.drive !== filters.driveFilter) reasons.push('drive');
  if (filters.categoryFilter !== 'all' && equipment.category !== filters.categoryFilter) reasons.push('category');
  if (filters.fleetFilter !== 'all' && String(equipment.activeInFleet) !== filters.fleetFilter) reasons.push('activeInFleet');
  if (filters.ownerFilter !== 'all' && equipment.owner !== filters.ownerFilter) reasons.push('owner');
  if (filters.locationFilter !== 'all' && equipment.location !== filters.locationFilter) reasons.push('location');
  if (!matchesTabType(equipment, filters.activeTab)) reasons.push(`tab:${filters.activeTab}`);
  return reasons;
}

function EquipmentMobileCard({
  equipment,
  isSaleTab,
  equipmentTypeLabel,
}: {
  equipment: EquipmentEntity;
  isSaleTab: boolean;
  equipmentTypeLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/95 p-4 shadow-[0_20px_40px_-32px_rgba(15,23,42,0.95)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link to={`/equipment/${equipment.id}`} className="app-shell-title text-base font-extrabold text-foreground hover:text-primary">
            {equipment.manufacturer} {equipment.model}
          </Link>
          <p className="mt-1 text-xs text-muted-foreground">
            Инв. № {equipment.inventoryNumber || '—'} · SN {equipment.serialNumber || 'не указан'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getStatusAppearance(equipment.status)}`}>
              {getStatusLabel(equipment.status)}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getPriorityAppearance(equipment.priority)}`}>
              {getPriorityLabel(equipment.priority)}
            </span>
            {equipment.isForSale ? (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getSalePdiAppearance(equipment.salePdiStatus)}`}>
                {EQUIPMENT_SALE_PDI_LABELS[equipment.salePdiStatus ?? 'not_started']}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div>Тип: <span className="text-foreground">{equipmentTypeLabel}</span></div>
        <div>Привод: <span className="text-foreground">{getEquipmentDriveLabel(equipment.drive)}</span></div>
        <div>Локация: <span className="text-foreground">{equipment.location || '—'}</span></div>
        <div>След. ТО: <span className={new Date(equipment.nextMaintenance) < new Date() ? 'text-red-300' : 'text-foreground'}>{formatDate(equipment.nextMaintenance)}</span></div>
        {isSaleTab ? (
          <div className="col-span-2">
            Цена 1: <span className="text-foreground">{formatCurrency(equipment.salePrice1 ?? 0)}</span>
          </div>
        ) : (
          <>
            <div className="col-span-2">Клиент: <span className="text-foreground">{equipment.currentClient || '—'}</span></div>
            <div className="col-span-2">Возврат: <span className="text-foreground">{equipment.returnDate ? formatDate(equipment.returnDate) : '—'}</span></div>
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-card/95 py-12 text-center shadow-[0_20px_40px_-32px_rgba(15,23,42,0.95)]">
      <Search className="mb-3 h-8 w-8 text-muted-foreground" />
      <h3 className="app-shell-title text-base font-extrabold text-foreground">Техника не найдена</h3>
      <p className="mt-1 text-sm text-muted-foreground">Попробуйте изменить фильтры</p>
    </div>
  );
}

export default function Equipment() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const { data: equipmentList = [] } = useEquipmentList();
  const { data: ganttRentals = [] } = useGanttData();
  const equipmentTypeCatalog = useEquipmentTypeCatalog();
  const [search, setSearch] = React.useState('');
  const [activeTab, setActiveTab] = React.useState<EquipmentTab>('active');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [typeFilter, setTypeFilter] = React.useState<string>('all');
  const [driveFilter, setDriveFilter] = React.useState<string>('all');
  const [categoryFilter, setCategoryFilter] = React.useState<string>('all');
  const [fleetFilter, setFleetFilter] = React.useState<string>('all');
  const [ownerFilter, setOwnerFilter] = React.useState<string>('all');
  const [locationFilter, setLocationFilter] = React.useState<string>('all');
  const [showFilters, setShowFilters] = React.useState(false);

  const enrichedEquipmentList = React.useMemo(
    () => normalizeEquipmentList(enrichEquipment(equipmentList, ganttRentals)),
    [equipmentList, ganttRentals],
  );

  const locationOptions = React.useMemo(
    () => Array.from(new Set(enrichedEquipmentList.map((eq) => eq.location).filter(Boolean))).sort(),
    [enrichedEquipmentList],
  );
  const equipmentTypeOptions = React.useMemo(
    () => mergeEquipmentTypesWithExistingEquipment(equipmentTypeCatalog, enrichedEquipmentList),
    [enrichedEquipmentList, equipmentTypeCatalog],
  );

  const filteredEquipment = React.useMemo(() => (
    enrichedEquipmentList
      .filter((equipment) => {
        const query = search.toLowerCase().trim();
        const matchesSearch = query === ''
          || equipment.inventoryNumber.toLowerCase().includes(query)
          || equipment.model.toLowerCase().includes(query)
          || equipment.manufacturer.toLowerCase().includes(query)
          || equipment.serialNumber.toLowerCase().includes(query)
          || equipment.currentClient?.toLowerCase().includes(query)
          || equipment.location?.toLowerCase().includes(query);

        const matchesStatus = statusFilter === 'all' || equipment.status === statusFilter;
        const matchesType = typeFilter === 'all' || equipment.type === typeFilter;
        const matchesDrive = driveFilter === 'all' || equipment.drive === driveFilter;
        const matchesCategory = categoryFilter === 'all' || equipment.category === categoryFilter;
        const matchesFleet = fleetFilter === 'all' || String(equipment.activeInFleet) === fleetFilter;
        const matchesOwner = ownerFilter === 'all' || equipment.owner === ownerFilter;
        const matchesLocation = locationFilter === 'all' || equipment.location === locationFilter;

        return matchesSearch
          && matchesStatus
          && matchesType
          && matchesDrive
          && matchesCategory
          && matchesFleet
          && matchesOwner
          && matchesLocation
          && matchesTabType(equipment, activeTab);
      })
      .sort(compareEquipmentByPriority)
  ), [
    activeTab,
    categoryFilter,
    driveFilter,
    enrichedEquipmentList,
    fleetFilter,
    locationFilter,
    ownerFilter,
    search,
    statusFilter,
    typeFilter,
  ]);

  React.useEffect(() => {
    if (!shouldLogWarrantyDebug() || !isWarrantyMechanicRole(user?.role)) return;
    const byTab = {
      active: enrichedEquipmentList.filter((item) => matchesTabType(item, 'active')).length,
      sale: enrichedEquipmentList.filter((item) => matchesTabType(item, 'sale')).length,
      sold: enrichedEquipmentList.filter((item) => matchesTabType(item, 'sold')).length,
      service: enrichedEquipmentList.filter((item) => matchesTabType(item, 'service')).length,
      all: enrichedEquipmentList.length,
    };
    const filters = { activeTab, search, categoryFilter, fleetFilter, statusFilter, typeFilter, ownerFilter, driveFilter, locationFilter };
    const excluded = enrichedEquipmentList
      .map(item => ({ id: item.id, inventoryNumber: item.inventoryNumber, reasons: equipmentFilterReasons(item, filters) }))
      .filter(item => item.reasons.length > 0)
      .slice(0, 5);
    console.debug('[warranty-mechanic/equipment]', {
      rawRole: user?.rawRole ?? user?.role,
      normalizedRole: normalizeUserRole(user?.role),
      beforeFilters: enrichedEquipmentList.length,
      afterFilters: filteredEquipment.length,
      activeTab,
      byTab,
      filters,
      excluded,
    });
  }, [
    activeTab,
    categoryFilter,
    driveFilter,
    enrichedEquipmentList,
    filteredEquipment.length,
    fleetFilter,
    locationFilter,
    ownerFilter,
    search,
    statusFilter,
    typeFilter,
    user?.rawRole,
    user?.role,
  ]);

  const tabCounts = React.useMemo(() => ({
    active: enrichedEquipmentList.filter((item) => matchesTabType(item, 'active')).length,
    sale: enrichedEquipmentList.filter((item) => matchesTabType(item, 'sale')).length,
    sold: enrichedEquipmentList.filter((item) => matchesTabType(item, 'sold')).length,
    service: enrichedEquipmentList.filter((item) => matchesTabType(item, 'service')).length,
    all: enrichedEquipmentList.length,
  }), [enrichedEquipmentList]);
  const activeFilterCount = [
    search.trim() !== '',
    categoryFilter !== 'all',
    fleetFilter !== 'all',
    statusFilter !== 'all',
    typeFilter !== 'all',
    ownerFilter !== 'all',
    driveFilter !== 'all',
    locationFilter !== 'all',
  ].filter(Boolean).length;

  const resetFilters = () => {
    setSearch('');
    setCategoryFilter('all');
    setFleetFilter('all');
    setStatusFilter('all');
    setTypeFilter('all');
    setDriveFilter('all');
    setOwnerFilter('all');
    setLocationFilter('all');
  };

  const isSaleTab = activeTab === 'sale';
  const totalVisible = filteredEquipment.length;
  const defaultRowColumns = '2.5fr 1.1fr .95fr .95fr 1fr 1fr 1.1fr 1.3fr 1.1fr 36px';
  const saleRowColumns = '2.6fr 1fr 1fr 1fr 1fr 1fr 1fr 36px';

  return (
    <div className="space-y-5 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <section className="app-panel overflow-hidden">
        <div className="border-b border-border/80 px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h1 className="app-shell-title text-3xl font-extrabold text-foreground">Техника</h1>
              <p className="mt-2 text-sm text-muted-foreground">Управление парком подъёмных платформ</p>
            </div>
            {can('create', 'equipment') && (
              <Link to="/equipment/new">
                <Button size="sm" className="app-button-primary rounded-xl px-4">
                  <Plus className="h-4 w-4" />
                  Добавить технику
                </Button>
              </Link>
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {[
              { key: 'active', label: 'Активный парк' },
              { key: 'sale', label: 'На продажу' },
              { key: 'sold', label: 'Проданная техника' },
              { key: 'service', label: 'Сервисная / клиентская техника' },
              { key: 'all', label: 'Вся техника' },
            ].map((tab) => {
              const count = tabCounts[tab.key as EquipmentTab];
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key as EquipmentTab)}
                  className={`rounded-xl border px-4 py-2 text-sm transition-colors ${
                    activeTab === tab.key
                      ? 'border-primary/30 bg-accent text-foreground'
                      : 'border-transparent bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  {tab.label}
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${
                    activeTab === tab.key ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'
                  }`}>
                    {count > 99 ? '99+' : count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-5 py-4 sm:px-6">
          <div className="flex justify-end">
            <FilterButton activeCount={activeFilterCount} onClick={() => setShowFilters(true)} />
          </div>
        </div>
      </section>

      <FilterDialog
        open={showFilters}
        onOpenChange={setShowFilters}
        title="Фильтры техники"
        description="Настрой выборку парка по поиску, статусу, типу, собственнику и локации."
        onReset={resetFilters}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <FilterField label="Поиск" className="md:col-span-2 xl:col-span-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                placeholder={isSaleTab ? 'Поиск по модели, инв. №, SN, локации…' : 'Поиск по инв. №, модели, SN, клиенту…'}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="app-filter-input pl-10"
              />
            </div>
          </FilterField>
          <FilterField label="Категория">
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="app-filter-input">
              <option value="all">Все категории</option>
              <option value="own">{EQUIPMENT_CATEGORY_LABELS.own}</option>
              <option value="sold">{EQUIPMENT_CATEGORY_LABELS.sold}</option>
              <option value="client">{EQUIPMENT_CATEGORY_LABELS.client}</option>
              <option value="partner">{EQUIPMENT_CATEGORY_LABELS.partner}</option>
            </select>
          </FilterField>
          <FilterField label="Активный парк">
            <select value={fleetFilter} onChange={(event) => setFleetFilter(event.target.value)} className="app-filter-input">
              <option value="all">Любое участие в парке</option>
              <option value="true">{`Активный парк — ${ACTIVE_FLEET_LABELS.yes}`}</option>
              <option value="false">{`Активный парк — ${ACTIVE_FLEET_LABELS.no}`}</option>
            </select>
          </FilterField>
          <FilterField label="Статус">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="app-filter-input">
              <option value="all">Все статусы</option>
              <option value="available">Свободен</option>
              <option value="rented">В аренде</option>
              <option value="reserved">Бронь</option>
              <option value="in_service">В сервисе</option>
              <option value="inactive">Списан</option>
            </select>
          </FilterField>
          <FilterField label="Тип">
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="app-filter-input">
              <option value="all">Все типы</option>
              {equipmentTypeOptions.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Собственник">
            <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} className="app-filter-input">
              <option value="all">Все собственники</option>
              <option value="own">Собственная</option>
              <option value="investor">Инвестор</option>
              <option value="sublease">Субаренда</option>
            </select>
          </FilterField>
          <FilterField label="Привод">
            <select value={driveFilter} onChange={(event) => setDriveFilter(event.target.value)} className="app-filter-input">
              <option value="all">Все приводы</option>
              <option value="diesel">Дизель</option>
              <option value="electric">Электро</option>
            </select>
          </FilterField>
          <FilterField label="Локация">
            <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} className="app-filter-input">
              <option value="all">Все локации</option>
              {locationOptions.map((location) => (
                <option key={location} value={location}>{location}</option>
              ))}
            </select>
          </FilterField>
        </div>
      </FilterDialog>

      <div className="space-y-3 sm:hidden">
        {totalVisible === 0 ? <EmptyState /> : filteredEquipment.map((equipment) => (
          <EquipmentMobileCard
            key={equipment.id}
            equipment={equipment}
            isSaleTab={isSaleTab}
            equipmentTypeLabel={findEquipmentTypeLabel(equipment.type, equipmentTypeOptions)}
          />
        ))}
      </div>

      <section className="hidden overflow-hidden rounded-2xl border border-border bg-card/95 shadow-[0_20px_40px_-32px_rgba(15,23,42,0.95)] sm:block">
        {isSaleTab ? (
          <>
            <div className="overflow-x-auto">
              <div className="min-w-[1080px]">
                <div className="border-b border-border bg-secondary/70 px-5 py-3">
                  <div className="grid gap-3 text-[10px] uppercase tracking-[0.16em] text-muted-foreground" style={{ gridTemplateColumns: saleRowColumns }}>
                    <div>Модель / Инв. № / Серийный №</div>
                    <div>PDI</div>
                    <div>Статус</div>
                    <div>Локация</div>
                    <div>Цена 1</div>
                    <div>Цена 2</div>
                    <div>Цена 3</div>
                    <div></div>
                  </div>
                </div>

                {totalVisible === 0 ? (
                  <div className="p-6"><EmptyState /></div>
                ) : (
                  filteredEquipment.map((equipment) => (
                    <div key={equipment.id} className="border-b border-border/80 px-5 py-4 transition-colors hover:bg-secondary/60">
                      <div className="grid items-center gap-3" style={{ gridTemplateColumns: saleRowColumns }}>
                        <div className="min-w-0">
                          <Link to={`/equipment/${equipment.id}`} className="app-shell-title text-[15px] font-extrabold text-foreground hover:text-primary">
                            {equipment.manufacturer} {equipment.model}
                          </Link>
                          <div className="mt-1 text-xs text-muted-foreground">Инв. № {equipment.inventoryNumber || '—'}</div>
                          <div className="text-xs text-muted-foreground">SN {equipment.serialNumber || 'не указан'}</div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                              {findEquipmentTypeLabel(equipment.type, equipmentTypeOptions)}
                            </span>
                            <span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                              {getEquipmentDriveLabel(equipment.drive)}
                            </span>
                          </div>
                        </div>
                        <div>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${getSalePdiAppearance(equipment.salePdiStatus)}`}>
                            {EQUIPMENT_SALE_PDI_LABELS[equipment.salePdiStatus ?? 'not_started']}
                          </span>
                        </div>
                        <div>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${getStatusAppearance(equipment.status)}`}>
                            {getStatusLabel(equipment.status)}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">{equipment.location || '—'}</div>
                        <div className="text-sm font-medium text-foreground">{formatCurrency(equipment.salePrice1 ?? 0)}</div>
                        <div className="text-sm font-medium text-foreground">{formatCurrency(equipment.salePrice2 ?? 0)}</div>
                        <div className="text-sm font-medium text-foreground">{formatCurrency(equipment.salePrice3 ?? 0)}</div>
                        <div>
                          <DropdownMenu.Root>
                            <DropdownMenu.Trigger asChild>
                              <button className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                                <MoreVertical className="h-4 w-4" />
                              </button>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content
                                className="min-w-[180px] rounded-xl border border-border bg-popover p-1 shadow-xl"
                                sideOffset={5}
                                align="end"
                              >
                                <DropdownMenu.Item asChild className="cursor-pointer rounded-lg px-3 py-2 text-sm text-foreground outline-none hover:bg-accent">
                                  <Link to={`/equipment/${equipment.id}`}>Открыть карточку</Link>
                                </DropdownMenu.Item>
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu.Root>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[1320px]">
              <div className="border-b border-border bg-secondary/70 px-5 py-3">
                <div className="grid gap-3 text-[10px] uppercase tracking-[0.16em] text-muted-foreground" style={{ gridTemplateColumns: defaultRowColumns }}>
                  <div>Модель / Инв. № / Серийный №</div>
                  <div>Тип</div>
                  <div>Приоритет</div>
                  <div>Привод</div>
                  <div>Статус</div>
                  <div>Локация</div>
                  <div>След. ТО</div>
                  <div>Текущий клиент</div>
                  <div>Дата возврата</div>
                  <div></div>
                </div>
              </div>

              {totalVisible === 0 ? (
                <div className="p-6"><EmptyState /></div>
              ) : (
                filteredEquipment.map((equipment) => {
                  const isOverdueMaintenance = new Date(equipment.nextMaintenance) < new Date();
                  return (
                    <div key={equipment.id} className="border-b border-border/80 px-5 py-4 transition-colors hover:bg-secondary/60">
                      <div className="grid items-center gap-3" style={{ gridTemplateColumns: defaultRowColumns }}>
                        <div className="min-w-0">
                          <Link to={`/equipment/${equipment.id}`} className="app-shell-title text-[15px] font-extrabold text-foreground hover:text-primary">
                            {equipment.manufacturer} {equipment.model}
                          </Link>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Инв. № {equipment.inventoryNumber || '—'}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            SN {equipment.serialNumber || 'не указан'}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                              {getOwnerLabel(equipment.owner)}
                            </span>
                            <span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                              Активный парк: {equipment.activeInFleet ? 'Да' : 'Нет'}
                            </span>
                            {equipment.isForSale ? (
                              <span className="rounded-md bg-orange-500/10 px-2 py-0.5 text-[10px] text-orange-300">
                                На продажу
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="text-sm text-muted-foreground">{findEquipmentTypeLabel(equipment.type, equipmentTypeOptions)}</div>
                        <div>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${getPriorityAppearance(equipment.priority)}`}>
                            {getPriorityLabel(equipment.priority)}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">{getEquipmentDriveLabel(equipment.drive)}</div>
                        <div>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${getStatusAppearance(equipment.status)}`}>
                            {getStatusLabel(equipment.status)}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">{equipment.location || '—'}</div>
                        <div className={`text-sm ${isOverdueMaintenance ? 'text-red-300' : 'text-muted-foreground'}`}>
                          {formatDate(equipment.nextMaintenance)}
                        </div>
                        <div className="truncate text-sm text-foreground">{equipment.currentClient || '—'}</div>
                        <div className="text-sm text-muted-foreground">{equipment.returnDate ? formatDate(equipment.returnDate) : '—'}</div>
                        <div>
                          <DropdownMenu.Root>
                            <DropdownMenu.Trigger asChild>
                              <button className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                                <MoreVertical className="h-4 w-4" />
                              </button>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content
                                className="min-w-[180px] rounded-xl border border-border bg-popover p-1 shadow-xl"
                                sideOffset={5}
                                align="end"
                              >
                                <DropdownMenu.Item asChild className="cursor-pointer rounded-lg px-3 py-2 text-sm text-foreground outline-none hover:bg-accent">
                                  <Link to={`/equipment/${equipment.id}`}>Открыть</Link>
                                </DropdownMenu.Item>
                                <DropdownMenu.Item className="cursor-pointer rounded-lg px-3 py-2 text-sm text-foreground outline-none hover:bg-accent">
                                  Сдать в аренду
                                </DropdownMenu.Item>
                                <DropdownMenu.Item className="cursor-pointer rounded-lg px-3 py-2 text-sm text-foreground outline-none hover:bg-accent">
                                  Вернуть
                                </DropdownMenu.Item>
                                <DropdownMenu.Item className="cursor-pointer rounded-lg px-3 py-2 text-sm text-foreground outline-none hover:bg-accent">
                                  Создать заявку
                                </DropdownMenu.Item>
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu.Root>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </section>

      {totalVisible > 0 ? (
        <div className="text-sm text-muted-foreground">
          Показано {totalVisible} из {equipmentList.length} единиц техники
        </div>
      ) : null}
    </div>
  );
}
