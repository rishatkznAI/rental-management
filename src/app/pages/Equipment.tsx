import React from 'react';
import { Link } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Filter, MoreVertical, Plus, Search } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge, getEquipmentPriorityBadge, getEquipmentStatusBadge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
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
  EquipmentType,
} from '../types';
import type { GanttRentalData } from '../mock-data';

type EquipmentTab = 'active' | 'sale' | 'sold' | 'service' | 'all';

// Для каждой единицы техники подтягивает currentClient и returnDate из активной аренды
// если эти поля не заполнены в самой записи техники (backward-compatibility)
function enrichEquipment(eqList: EquipmentEntity[], ganttRentals: GanttRentalData[]): EquipmentEntity[] {
  const inventoryCounts = new Map<string, number>();
  eqList.forEach((eq) => {
    inventoryCounts.set(eq.inventoryNumber, (inventoryCounts.get(eq.inventoryNumber) ?? 0) + 1);
  });

  const activeById = new Map<string, GanttRentalData>();
  const activeByUniqueInv = new Map<string, GanttRentalData>();
  for (const r of ganttRentals) {
    if (r.status === 'active' || r.status === 'created') {
      if (r.equipmentId) {
        const existing = activeById.get(r.equipmentId);
        if (!existing || r.status === 'active') {
          activeById.set(r.equipmentId, r);
        }
        continue;
      }

      if ((inventoryCounts.get(r.equipmentInv) ?? 0) === 1) {
        const existing = activeByUniqueInv.get(r.equipmentInv);
        if (!existing || r.status === 'active') {
          activeByUniqueInv.set(r.equipmentInv, r);
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

function getSalePdiBadge(status: EquipmentSalePdiStatus = 'not_started') {
  const variants: Record<EquipmentSalePdiStatus, 'default' | 'warning' | 'success'> = {
    not_started: 'default',
    in_progress: 'warning',
    ready: 'success',
  };
  return <Badge variant={variants[status]}>{EQUIPMENT_SALE_PDI_LABELS[status]}</Badge>;
}

function RentalEquipmentCard({ equipment }: { equipment: EquipmentEntity }) {
  return (
    <Link
      to={`/equipment/${equipment.id}`}
      className="block rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-500"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[--color-primary]">{equipment.manufacturer} {equipment.model}</span>
            {getEquipmentPriorityBadge(equipment.priority)}
            {getEquipmentStatusBadge(equipment.status)}
            {equipment.isForSale ? <Badge variant="warning">На продажу</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Инв.№: {equipment.inventoryNumber || '—'} · SN: {equipment.serialNumber || 'не указан'}
          </p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {getEquipmentTypeLabel(equipment.type)} · {getEquipmentDriveLabel(equipment.drive)}
          </p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {EQUIPMENT_CATEGORY_LABELS[equipment.category]} · {getOwnerLabel(equipment.owner)} · Активный парк: {equipment.activeInFleet ? 'Да' : 'Нет'}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
        <div><span className="font-medium text-gray-700 dark:text-gray-300">Локация:</span> {equipment.location}</div>
        {equipment.currentClient ? <div><span className="font-medium text-gray-700 dark:text-gray-300">Клиент:</span> {equipment.currentClient}</div> : null}
        <div><span className="font-medium text-gray-700 dark:text-gray-300">След. ТО:</span> {formatDate(equipment.nextMaintenance)}</div>
        {equipment.returnDate ? <div><span className="font-medium text-gray-700 dark:text-gray-300">Возврат:</span> {formatDate(equipment.returnDate)}</div> : null}
      </div>
    </Link>
  );
}

function SaleEquipmentCard({ equipment }: { equipment: EquipmentEntity }) {
  return (
    <Link
      to={`/equipment/${equipment.id}`}
      className="block rounded-xl border border-amber-200/70 bg-white p-4 transition-colors hover:border-amber-400 dark:border-amber-900/50 dark:bg-gray-800 dark:hover:border-amber-700"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">{equipment.manufacturer} {equipment.model}</span>
            {getSalePdiBadge(equipment.salePdiStatus)}
            {getEquipmentStatusBadge(equipment.status)}
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Инв.№: {equipment.inventoryNumber || '—'} · SN: {equipment.serialNumber || 'не указан'}
          </p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {getEquipmentTypeLabel(equipment.type)} · {getEquipmentDriveLabel(equipment.drive)} · {equipment.location}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-amber-50/80 p-3 dark:bg-amber-950/20">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <p className="text-gray-500 dark:text-gray-400">Цена 1</p>
            <p className="mt-1 font-semibold text-gray-900 dark:text-white">{formatCurrency(equipment.salePrice1 ?? 0)}</p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400">Цена 2</p>
            <p className="mt-1 font-semibold text-gray-900 dark:text-white">{formatCurrency(equipment.salePrice2 ?? 0)}</p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400">Цена 3</p>
            <p className="mt-1 font-semibold text-gray-900 dark:text-white">{formatCurrency(equipment.salePrice3 ?? 0)}</p>
          </div>
        </div>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-white py-12 text-center dark:border-gray-700 dark:bg-gray-800">
      <Search className="mb-3 h-8 w-8 text-gray-400 dark:text-gray-500" />
      <h3 className="text-base font-medium text-gray-900 dark:text-white">Техника не найдена</h3>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Попробуйте изменить фильтры</p>
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

  const matchesTab = React.useCallback((equipment: EquipmentEntity) => {
    if (activeTab === 'active') return equipment.activeInFleet && (equipment.category === 'own' || equipment.category === 'partner');
    if (activeTab === 'sale') return equipment.isForSale && equipment.category !== 'sold';
    if (activeTab === 'sold') return equipment.category === 'sold';
    if (activeTab === 'service') return equipment.category === 'client' || (!equipment.activeInFleet && equipment.category !== 'sold');
    return true;
  }, [activeTab]);

  const filteredEquipment = React.useMemo(() => (
    enrichedEquipmentList
      .filter((equipment) => {
        const query = search.toLowerCase();
        const matchesSearch = search === ''
          || equipment.inventoryNumber.toLowerCase().includes(query)
          || equipment.model.toLowerCase().includes(query)
          || equipment.manufacturer.toLowerCase().includes(query)
          || equipment.serialNumber.toLowerCase().includes(query)
          || equipment.currentClient?.toLowerCase().includes(query);

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
          && matchesTab(equipment);
      })
      .sort(compareEquipmentByPriority)
  ), [
    categoryFilter,
    driveFilter,
    enrichedEquipmentList,
    fleetFilter,
    locationFilter,
    matchesTab,
    ownerFilter,
    search,
    statusFilter,
    typeFilter,
  ]);

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

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Техника</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Управление парком подъёмных платформ</p>
        </div>
        <div className="flex gap-2">
          {can('create', 'equipment') && (
            <Link to="/equipment/new">
              <Button size="sm">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Добавить технику</span>
                <span className="sm:hidden">Добавить</span>
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { key: 'active', label: 'Активный парк' },
          { key: 'sale', label: 'На продажу' },
          { key: 'sold', label: 'Проданная техника' },
          { key: 'service', label: 'Сервисная / клиентская техника' },
          { key: 'all', label: 'Вся техника' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as EquipmentTab)}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-[--color-primary] text-white'
                : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800 sm:gap-4 sm:p-4">
        <div className="min-w-[200px] flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <Input
              placeholder={isSaleTab ? 'Поиск по модели, инв.№, SN, локации...' : 'Поиск по инв.№, модели, SN, клиенту...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <Select
          value={categoryFilter}
          onValueChange={setCategoryFilter}
          placeholder="Все категории"
          options={[
            { value: 'all', label: 'Все категории' },
            { value: 'own', label: EQUIPMENT_CATEGORY_LABELS.own },
            { value: 'sold', label: EQUIPMENT_CATEGORY_LABELS.sold },
            { value: 'client', label: EQUIPMENT_CATEGORY_LABELS.client },
            { value: 'partner', label: EQUIPMENT_CATEGORY_LABELS.partner },
          ]}
          className="w-[180px]"
        />
        <Select
          value={fleetFilter}
          onValueChange={setFleetFilter}
          placeholder="Активный парк"
          options={[
            { value: 'all', label: 'Любое участие в парке' },
            { value: 'true', label: `Активный парк — ${ACTIVE_FLEET_LABELS.yes}` },
            { value: 'false', label: `Активный парк — ${ACTIVE_FLEET_LABELS.no}` },
          ]}
          className="w-[220px]"
        />
        <Select
          value={statusFilter}
          onValueChange={setStatusFilter}
          placeholder="Все статусы"
          options={[
            { value: 'all', label: 'Все статусы' },
            { value: 'available', label: 'Свободен' },
            { value: 'rented', label: 'В аренде' },
            { value: 'reserved', label: 'Бронь' },
            { value: 'in_service', label: 'В сервисе' },
            { value: 'inactive', label: 'Списан' },
          ]}
          className="w-[180px]"
        />
        <Select
          value={typeFilter}
          onValueChange={setTypeFilter}
          placeholder="Все типы"
          options={[
            { value: 'all', label: 'Все типы' },
            { value: 'scissor', label: 'Ножничный' },
            { value: 'articulated', label: 'Коленчатый' },
            { value: 'telescopic', label: 'Телескопический' },
          ]}
          className="w-[180px]"
        />
        <Select
          value={ownerFilter}
          onValueChange={setOwnerFilter}
          placeholder="Все собственники"
          options={[
            { value: 'all', label: 'Все собственники' },
            { value: 'own', label: 'Собственная' },
            { value: 'investor', label: 'Инвестор' },
            { value: 'sublease', label: 'Субаренда' },
          ]}
          className="w-[180px]"
        />
        <Select
          value={driveFilter}
          onValueChange={setDriveFilter}
          placeholder="Все приводы"
          options={[
            { value: 'all', label: 'Все приводы' },
            { value: 'diesel', label: 'Дизель' },
            { value: 'electric', label: 'Электро' },
          ]}
          className="w-[160px]"
        />
        <Select
          value={locationFilter}
          onValueChange={setLocationFilter}
          placeholder="Все локации"
          options={[
            { value: 'all', label: 'Все локации' },
            ...locationOptions.map((location) => ({ value: location, label: location })),
          ]}
          className="w-[220px]"
        />
        <Button variant="ghost" size="sm" onClick={resetFilters}>
          <Filter className="h-4 w-4" />
          Сбросить
        </Button>
      </div>

      <div className="sm:hidden space-y-3">
        {totalVisible === 0 ? <EmptyState /> : filteredEquipment.map((equipment) => (
          isSaleTab
            ? <SaleEquipmentCard key={equipment.id} equipment={equipment} />
            : <RentalEquipmentCard key={equipment.id} equipment={equipment} />
        ))}
      </div>

      {isSaleTab ? (
        <div className="hidden sm:block overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Модель / Инв.№ / Серийный №</TableHead>
                <TableHead>PDI</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Локация</TableHead>
                <TableHead>Цена 1</TableHead>
                <TableHead>Цена 2</TableHead>
                <TableHead>Цена 3</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEquipment.map((equipment) => (
                <TableRow key={equipment.id}>
                  <TableCell>
                    <Link to={`/equipment/${equipment.id}`} className="font-medium text-amber-700 hover:underline dark:text-amber-300">
                      {equipment.manufacturer} {equipment.model}
                    </Link>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Инв.№: {equipment.inventoryNumber || '—'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">SN: {equipment.serialNumber || 'не указан'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {getEquipmentTypeLabel(equipment.type)} · {getEquipmentDriveLabel(equipment.drive)}
                    </p>
                  </TableCell>
                  <TableCell>{getSalePdiBadge(equipment.salePdiStatus)}</TableCell>
                  <TableCell>{getEquipmentStatusBadge(equipment.status)}</TableCell>
                  <TableCell className="text-gray-700 dark:text-gray-300">{equipment.location}</TableCell>
                  <TableCell className="font-medium text-gray-700 dark:text-gray-200">{formatCurrency(equipment.salePrice1 ?? 0)}</TableCell>
                  <TableCell className="font-medium text-gray-700 dark:text-gray-200">{formatCurrency(equipment.salePrice2 ?? 0)}</TableCell>
                  <TableCell className="font-medium text-gray-700 dark:text-gray-200">{formatCurrency(equipment.salePrice3 ?? 0)}</TableCell>
                  <TableCell>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700">
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          className="min-w-[180px] rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
                          sideOffset={5}
                          align="end"
                        >
                          <DropdownMenu.Item asChild className="cursor-pointer rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 focus:outline-none dark:text-gray-200 dark:hover:bg-gray-700">
                            <Link to={`/equipment/${equipment.id}`}>Открыть карточку</Link>
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {totalVisible === 0 ? <div className="p-6"><EmptyState /></div> : null}
        </div>
      ) : (
        <div className="hidden sm:block rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Модель / Инв.№ / Серийный №</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Приоритет</TableHead>
                <TableHead>Привод</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Локация</TableHead>
                <TableHead>След. ТО</TableHead>
                <TableHead>Текущий клиент</TableHead>
                <TableHead>Дата возврата</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEquipment.map((equipment) => (
                <TableRow key={equipment.id}>
                  <TableCell>
                    <Link to={`/equipment/${equipment.id}`} className="font-medium text-[--color-primary] hover:underline">
                      {equipment.manufacturer} {equipment.model}
                    </Link>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Инв.№: {equipment.inventoryNumber || '—'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">SN: {equipment.serialNumber || 'не указан'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {EQUIPMENT_CATEGORY_LABELS[equipment.category]} · {getOwnerLabel(equipment.owner)} · Активный парк: {equipment.activeInFleet ? 'Да' : 'Нет'}
                    </p>
                    {equipment.isForSale ? <div className="mt-2"><Badge variant="warning">На продажу</Badge></div> : null}
                  </TableCell>
                  <TableCell className="text-gray-700 dark:text-gray-300">{getEquipmentTypeLabel(equipment.type)}</TableCell>
                  <TableCell>{getEquipmentPriorityBadge(equipment.priority)}</TableCell>
                  <TableCell className="text-gray-700 dark:text-gray-300">{getEquipmentDriveLabel(equipment.drive)}</TableCell>
                  <TableCell>{getEquipmentStatusBadge(equipment.status)}</TableCell>
                  <TableCell className="text-gray-700 dark:text-gray-300">{equipment.location}</TableCell>
                  <TableCell className="text-gray-700 dark:text-gray-300">{formatDate(equipment.nextMaintenance)}</TableCell>
                  <TableCell>
                    {equipment.currentClient ? (
                      <p className="text-sm text-gray-700 dark:text-gray-300">{equipment.currentClient}</p>
                    ) : (
                      <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {equipment.returnDate ? (
                      <p className="text-sm text-gray-700 dark:text-gray-300">{formatDate(equipment.returnDate)}</p>
                    ) : (
                      <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700">
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          className="min-w-[180px] rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
                          sideOffset={5}
                          align="end"
                        >
                          <DropdownMenu.Item asChild className="cursor-pointer rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 focus:outline-none dark:text-gray-200 dark:hover:bg-gray-700">
                            <Link to={`/equipment/${equipment.id}`}>Открыть</Link>
                          </DropdownMenu.Item>
                          <DropdownMenu.Item className="cursor-pointer rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 focus:outline-none dark:text-gray-200 dark:hover:bg-gray-700">
                            Сдать в аренду
                          </DropdownMenu.Item>
                          <DropdownMenu.Item className="cursor-pointer rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 focus:outline-none dark:text-gray-200 dark:hover:bg-gray-700">
                            Вернуть
                          </DropdownMenu.Item>
                          <DropdownMenu.Item className="cursor-pointer rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 focus:outline-none dark:text-gray-200 dark:hover:bg-gray-700">
                            Создать заявку
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {totalVisible === 0 ? (
            <div className="p-6">
              <EmptyState />
            </div>
          ) : null}
        </div>
      )}

      {totalVisible > 0 ? (
        <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <p>Показано {totalVisible} из {equipmentList.length} единиц техники</p>
        </div>
      ) : null}
    </div>
  );
}
