import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Plus, Search, Tag } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { FilterButton, FilterDialog, FilterField } from '../components/ui/filter-dialog';
import { useEquipmentList } from '../hooks/useEquipment';
import { usePermissions } from '../lib/permissions';
import { EQUIPMENT_SALE_PDI_LABELS, normalizeEquipmentList } from '../lib/equipmentClassification';
import { formatCurrency } from '../lib/utils';
import type { EquipmentSalePdiStatus } from '../types';

function getSalePdiBadge(status: EquipmentSalePdiStatus = 'not_started') {
  const variants: Record<EquipmentSalePdiStatus, 'default' | 'warning' | 'success'> = {
    not_started: 'default',
    in_progress: 'warning',
    ready: 'success',
  };
  return <Badge variant={variants[status]}>{EQUIPMENT_SALE_PDI_LABELS[status]}</Badge>;
}

function getSaleReadinessBadge(status: EquipmentSalePdiStatus = 'not_started') {
  return (
    <Badge variant={status === 'ready' ? 'success' : 'warning'}>
      {status === 'ready' ? 'PDI готов' : 'PDI не готов'}
    </Badge>
  );
}

export default function Sales() {
  const { can } = usePermissions();
  const { data: rawEquipment = [] } = useEquipmentList();
  const [search, setSearch] = React.useState('');
  const [pdiFilter, setPdiFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [quickFilter, setQuickFilter] = React.useState<'all' | 'pdi_ready' | 'pdi_in_progress' | 'no_price' | 'available_only'>('all');
  const [showFilters, setShowFilters] = React.useState(false);

  if (!can('view', 'sales')) {
    return <Navigate to="/" replace />;
  }

  const saleEquipment = React.useMemo(
    () => normalizeEquipmentList(rawEquipment).filter((equipment) => equipment.isForSale && equipment.category !== 'sold'),
    [rawEquipment],
  );

  const filteredEquipment = React.useMemo(
    () => saleEquipment.filter((equipment) => {
      const query = search.toLowerCase();
      const matchesSearch = search === ''
        || equipment.manufacturer.toLowerCase().includes(query)
        || equipment.model.toLowerCase().includes(query)
        || equipment.inventoryNumber.toLowerCase().includes(query)
        || equipment.serialNumber.toLowerCase().includes(query)
        || equipment.location.toLowerCase().includes(query);
      const matchesPdi = pdiFilter === 'all' || equipment.salePdiStatus === pdiFilter;
      const matchesStatus = statusFilter === 'all' || equipment.status === statusFilter;
      const hasNoPrices = !equipment.salePrice1 && !equipment.salePrice2 && !equipment.salePrice3;
      const matchesQuickFilter =
        quickFilter === 'all'
        || (quickFilter === 'pdi_ready' && equipment.salePdiStatus === 'ready')
        || (quickFilter === 'pdi_in_progress' && equipment.salePdiStatus === 'in_progress')
        || (quickFilter === 'no_price' && hasNoPrices)
        || (quickFilter === 'available_only' && equipment.status === 'available');
      return matchesSearch && matchesPdi && matchesStatus && matchesQuickFilter;
    }),
    [pdiFilter, quickFilter, saleEquipment, search, statusFilter],
  );

  const readyCount = saleEquipment.filter((equipment) => equipment.salePdiStatus === 'ready').length;
  const inProgressCount = saleEquipment.filter((equipment) => equipment.salePdiStatus === 'in_progress').length;
  const noPriceCount = saleEquipment.filter((equipment) => !equipment.salePrice1 && !equipment.salePrice2 && !equipment.salePrice3).length;
  const availableCount = saleEquipment.filter((equipment) => equipment.status === 'available').length;
  const activeFilterCount = [
    search.trim() !== '',
    pdiFilter !== 'all',
    statusFilter !== 'all',
    quickFilter !== 'all',
  ].filter(Boolean).length;

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Продажи</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Наличие техники на продажу для менеджера с PDI и тремя уровнями цены.
          </p>
        </div>
        {can('create', 'equipment') && (
          <Link to="/equipment/new">
            <Button className="app-button-primary h-10 rounded-xl px-4">
              <Plus className="h-4 w-4" />
              Добавить технику
            </Button>
          </Link>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">На продаже</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-gray-900 dark:text-white">{saleEquipment.length}</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Актуальные единицы в продаже</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">PDI готов</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-green-600 dark:text-green-400">{readyCount}</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Можно передавать в коммерческую работу</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">PDI в работе</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-amber-600 dark:text-amber-400">{inProgressCount}</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Единицы, которые нужно довести до готовности</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <FilterButton activeCount={activeFilterCount} onClick={() => setShowFilters(true)} />
      </div>

      <FilterDialog
        open={showFilters}
        onOpenChange={setShowFilters}
        title="Фильтры продаж"
        description="Настрой выборку техники на продаже по поиску, PDI, статусу и быстрым режимам."
        onReset={() => {
          setSearch('');
          setPdiFilter('all');
          setStatusFilter('all');
          setQuickFilter('all');
        }}
      >
        <div className="space-y-5">
          <FilterField label="Быстрый режим">
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'all', label: 'Все' },
                { value: 'pdi_ready', label: `PDI готово · ${readyCount}` },
                { value: 'pdi_in_progress', label: `PDI в работе · ${inProgressCount}` },
                { value: 'no_price', label: `Без цены · ${noPriceCount}` },
                { value: 'available_only', label: `Только свободная · ${availableCount}` },
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setQuickFilter(option.value as typeof quickFilter)}
                  className="app-filter-chip"
                  data-active={String(quickFilter === option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </FilterField>

          <div className="grid gap-4 md:grid-cols-2">
            <FilterField label="Поиск" className="md:col-span-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Поиск по модели, инв. №, SN, локации..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="app-filter-input pl-10"
                />
              </div>
            </FilterField>
            <FilterField label="PDI">
              <select value={pdiFilter} onChange={(e) => setPdiFilter(e.target.value)} className="app-filter-input">
                <option value="all">Все PDI</option>
                <option value="not_started">{EQUIPMENT_SALE_PDI_LABELS.not_started}</option>
                <option value="in_progress">{EQUIPMENT_SALE_PDI_LABELS.in_progress}</option>
                <option value="ready">{EQUIPMENT_SALE_PDI_LABELS.ready}</option>
              </select>
            </FilterField>
            <FilterField label="Статус техники">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="app-filter-input">
                <option value="all">Все статусы</option>
                <option value="available">Свободен</option>
                <option value="reserved">Бронь</option>
                <option value="in_service">В сервисе</option>
                <option value="inactive">Списан</option>
              </select>
            </FilterField>
          </div>
        </div>
      </FilterDialog>

      <div className="space-y-3 sm:hidden">
        {filteredEquipment.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-10 text-center dark:border-gray-700 dark:bg-gray-800">
            <Tag className="mx-auto h-8 w-8 text-gray-400 dark:text-gray-500" />
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Под выбранные фильтры техника на продажу не найдена.</p>
          </div>
        ) : filteredEquipment.map((equipment) => (
          <Link
            key={equipment.id}
            to={`/equipment/${equipment.id}`}
            className="block rounded-xl border border-amber-200/70 bg-white p-4 dark:border-amber-900/50 dark:bg-gray-800"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">{equipment.manufacturer} {equipment.model}</span>
              {getSalePdiBadge(equipment.salePdiStatus)}
              {getSaleReadinessBadge(equipment.salePdiStatus)}
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Инв.№: {equipment.inventoryNumber || '—'} · SN: {equipment.serialNumber || 'не указан'}
            </p>
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Локация: {equipment.location}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-amber-50/80 p-3 text-xs dark:bg-amber-950/20">
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
          </Link>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Техника</TableHead>
              <TableHead>PDI</TableHead>
              <TableHead>Готовность</TableHead>
              <TableHead>Локация</TableHead>
              <TableHead>Цена 1</TableHead>
              <TableHead>Цена 2</TableHead>
              <TableHead>Цена 3</TableHead>
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
                </TableCell>
                <TableCell>{getSalePdiBadge(equipment.salePdiStatus)}</TableCell>
                <TableCell>{getSaleReadinessBadge(equipment.salePdiStatus)}</TableCell>
                <TableCell className="text-gray-700 dark:text-gray-300">{equipment.location}</TableCell>
                <TableCell className="font-medium text-gray-700 dark:text-gray-200">{formatCurrency(equipment.salePrice1 ?? 0)}</TableCell>
                <TableCell className="font-medium text-gray-700 dark:text-gray-200">{formatCurrency(equipment.salePrice2 ?? 0)}</TableCell>
                <TableCell className="font-medium text-gray-700 dark:text-gray-200">{formatCurrency(equipment.salePrice3 ?? 0)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filteredEquipment.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Tag className="mx-auto h-8 w-8 text-gray-400 dark:text-gray-500" />
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Под выбранные фильтры техника на продажу не найдена.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
