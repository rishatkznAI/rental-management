import React from 'react';
import { Link } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreVertical, Plus, RotateCcw, Search } from 'lucide-react';
import { Button } from '../components/ui/button';
import { usePermissions } from '../lib/permissions';
import { useEquipmentList } from '../hooks/useEquipment';
import { useGanttData } from '../hooks/useRentals';
import {
  ACTIVE_FLEET_LABELS,
  compareEquipmentByPriority,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_SALE_PDI_LABELS,
  normalizeEquipmentList,
} from '../lib/equipmentClassification';
import { formatCurrency, formatDate } from '../lib/utils';
import type {
  Equipment as EquipmentEntity,
  EquipmentDrive,
  EquipmentOwnerType,
  EquipmentSalePdiStatus,
  EquipmentStatus,
  EquipmentType,
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

function getEquipmentTypeLabel(type: EquipmentType): string {
  const labels: Record<EquipmentType, string> = {
    scissor: 'Ножничный',
    articulated: 'Коленчатый',
    telescopic: 'Телескопический',
  };
  return labels[type];
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

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 rounded-xl border border-border bg-secondary/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/40"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function EquipmentMobileCard({
  equipment,
  isSaleTab,
}: {
  equipment: EquipmentEntity;
  isSaleTab: boolean;
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
        <div>Тип: <span className="text-foreground">{getEquipmentTypeLabel(equipment.type)}</span></div>
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
  const { can } = usePermissions();
  const { data: equipmentList = [] } = useEquipmentList();
  const { data: ganttRentals = [] } = useGanttData();
  const [search, setSearch] = React.useState('');
  const [activeTab, setActiveTab] = React.useState<EquipmentTab>('active');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [typeFilter, setTypeFilter] = React.useState<string>('all');
  const [driveFilter, setDriveFilter] = React.useState<string>('all');
  const [categoryFilter, setCategoryFilter] = React.useState<string>('all');
  const [fleetFilter, setFleetFilter] = React.useState<string>('all');
  const [ownerFilter, setOwnerFilter] = React.useState<string>('all');
  const [locationFilter, setLocationFilter] = React.useState<string>('all');

  const enrichedEquipmentList = React.useMemo(
    () => normalizeEquipmentList(enrichEquipment(equipmentList, ganttRentals)),
    [equipmentList, ganttRentals],
  );

  const locationOptions = React.useMemo(
    () => Array.from(new Set(enrichedEquipmentList.map((eq) => eq.location).filter(Boolean))).sort(),
    [enrichedEquipmentList],
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

  const tabCounts = React.useMemo(() => ({
    active: enrichedEquipmentList.filter((item) => matchesTabType(item, 'active')).length,
    sale: enrichedEquipmentList.filter((item) => matchesTabType(item, 'sale')).length,
    sold: enrichedEquipmentList.filter((item) => matchesTabType(item, 'sold')).length,
    service: enrichedEquipmentList.filter((item) => matchesTabType(item, 'service')).length,
    all: enrichedEquipmentList.length,
  }), [enrichedEquipmentList]);

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
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 xl:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  placeholder={isSaleTab ? 'Поиск по модели, инв. №, SN, локации…' : 'Поиск по инв. №, модели, SN, клиенту…'}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-10 w-full rounded-xl border border-border bg-secondary/80 pl-10 pr-3 text-sm text-foreground outline-none transition focus:border-primary/40"
                />
              </div>
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-secondary/80 px-4 text-sm text-muted-foreground transition hover:text-foreground"
              >
                <RotateCcw className="h-4 w-4" />
                Сбросить
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
              <FilterSelect
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={[
                  { value: 'all', label: 'Все категории' },
                  { value: 'own', label: EQUIPMENT_CATEGORY_LABELS.own },
                  { value: 'sold', label: EQUIPMENT_CATEGORY_LABELS.sold },
                  { value: 'client', label: EQUIPMENT_CATEGORY_LABELS.client },
                  { value: 'partner', label: EQUIPMENT_CATEGORY_LABELS.partner },
                ]}
              />
              <FilterSelect
                value={fleetFilter}
                onChange={setFleetFilter}
                options={[
                  { value: 'all', label: 'Любое участие в парке' },
                  { value: 'true', label: `Активный парк — ${ACTIVE_FLEET_LABELS.yes}` },
                  { value: 'false', label: `Активный парк — ${ACTIVE_FLEET_LABELS.no}` },
                ]}
              />
              <FilterSelect
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: 'all', label: 'Все статусы' },
                  { value: 'available', label: 'Свободен' },
                  { value: 'rented', label: 'В аренде' },
                  { value: 'reserved', label: 'Бронь' },
                  { value: 'in_service', label: 'В сервисе' },
                  { value: 'inactive', label: 'Списан' },
                ]}
              />
              <FilterSelect
                value={typeFilter}
                onChange={setTypeFilter}
                options={[
                  { value: 'all', label: 'Все типы' },
                  { value: 'scissor', label: 'Ножничный' },
                  { value: 'articulated', label: 'Коленчатый' },
                  { value: 'telescopic', label: 'Телескопический' },
                ]}
              />
              <FilterSelect
                value={ownerFilter}
                onChange={setOwnerFilter}
                options={[
                  { value: 'all', label: 'Все собственники' },
                  { value: 'own', label: 'Собственная' },
                  { value: 'investor', label: 'Инвестор' },
                  { value: 'sublease', label: 'Субаренда' },
                ]}
              />
              <FilterSelect
                value={driveFilter}
                onChange={setDriveFilter}
                options={[
                  { value: 'all', label: 'Все приводы' },
                  { value: 'diesel', label: 'Дизель' },
                  { value: 'electric', label: 'Электро' },
                ]}
              />
              <FilterSelect
                value={locationFilter}
                onChange={setLocationFilter}
                options={[
                  { value: 'all', label: 'Все локации' },
                  ...locationOptions.map((location) => ({ value: location, label: location })),
                ]}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="space-y-3 sm:hidden">
        {totalVisible === 0 ? <EmptyState /> : filteredEquipment.map((equipment) => (
          <EquipmentMobileCard key={equipment.id} equipment={equipment} isSaleTab={isSaleTab} />
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
                              {getEquipmentTypeLabel(equipment.type)}
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
                        <div className="text-sm text-muted-foreground">{getEquipmentTypeLabel(equipment.type)}</div>
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
