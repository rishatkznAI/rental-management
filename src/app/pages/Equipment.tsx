import React from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { getEquipmentStatusBadge } from '../components/ui/badge';
import { Search, Filter, Download, MoreVertical, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { loadEquipment, loadGanttRentals, EQUIPMENT_STORAGE_KEY, GANTT_RENTALS_STORAGE_KEY } from '../mock-data';
import { formatDate } from '../lib/utils';
import type { EquipmentStatus, EquipmentType, EquipmentDrive, Equipment as EquipmentType_ } from '../types';
import type { GanttRentalData } from '../mock-data';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { usePermissions } from '../lib/permissions';

// Для каждой единицы техники подтягивает currentClient и returnDate из активной аренды
// если эти поля не заполнены в самой записи техники (backward-compatibility)
function enrichEquipment(eqList: EquipmentType_[], ganttRentals: GanttRentalData[]): EquipmentType_[] {
  const activeByInv = new Map<string, GanttRentalData>();
  for (const r of ganttRentals) {
    if (r.status === 'active' || r.status === 'created') {
      // Предпочитаем 'active' над 'created'
      const existing = activeByInv.get(r.equipmentInv);
      if (!existing || r.status === 'active') {
        activeByInv.set(r.equipmentInv, r);
      }
    }
  }
  return eqList.map(eq => {
    const active = activeByInv.get(eq.inventoryNumber);
    if (!active) return eq;
    return {
      ...eq,
      currentClient: eq.currentClient || active.client || eq.currentClient,
      returnDate: eq.returnDate || active.endDate || eq.returnDate,
    };
  });
}

export default function Equipment() {
  const { can } = usePermissions();
  const [equipmentList, setEquipmentList] = React.useState<EquipmentType_[]>(() => loadEquipment());
  const [ganttRentals, setGanttRentals] = React.useState<GanttRentalData[]>(() => loadGanttRentals());
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [typeFilter, setTypeFilter] = React.useState<string>('all');
  const [driveFilter, setDriveFilter] = React.useState<string>('all');

  // Обновляем список при изменении localStorage из другой вкладки или после добавления
  React.useEffect(() => {
    const reload = () => {
      setEquipmentList(loadEquipment());
      setGanttRentals(loadGanttRentals());
    };
    const handleStorage = (e: StorageEvent) => {
      if (e.key === EQUIPMENT_STORAGE_KEY || e.key === GANTT_RENTALS_STORAGE_KEY) reload();
    };
    window.addEventListener('storage', handleStorage);
    // Также обновляем при фокусе на вкладке (после возврата с /equipment/new или /rentals)
    window.addEventListener('focus', reload);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', reload);
    };
  }, []);

  // Список техники, обогащённый данными из активных аренд (fallback для устаревших записей)
  const enrichedEquipmentList = React.useMemo(
    () => enrichEquipment(equipmentList, ganttRentals),
    [equipmentList, ganttRentals],
  );

  const filteredEquipment = enrichedEquipmentList.filter(eq => {
    const matchesSearch = search === '' ||
      eq.inventoryNumber.toLowerCase().includes(search.toLowerCase()) ||
      eq.model.toLowerCase().includes(search.toLowerCase()) ||
      eq.serialNumber.toLowerCase().includes(search.toLowerCase()) ||
      eq.currentClient?.toLowerCase().includes(search.toLowerCase());

    const matchesStatus = statusFilter === 'all' || eq.status === statusFilter;
    const matchesType = typeFilter === 'all' || eq.type === typeFilter;
    const matchesDrive = driveFilter === 'all' || eq.drive === driveFilter;

    return matchesSearch && matchesStatus && matchesType && matchesDrive;
  });

  const getEquipmentTypeLabel = (type: EquipmentType): string => {
    const labels: Record<EquipmentType, string> = {
      scissor: 'Ножничный',
      articulated: 'Коленчатый',
      telescopic: 'Телескопический',
    };
    return labels[type];
  };

  const getEquipmentDriveLabel = (drive: EquipmentDrive): string => {
    const labels: Record<EquipmentDrive, string> = {
      diesel: 'Дизель',
      electric: 'Электро',
    };
    return labels[drive];
  };

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Техника</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Управление парком подъёмных платформ</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" className="hidden sm:flex">
            <Download className="h-4 w-4" />
            Экспорт
          </Button>
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

      {/* Filters */}
      <div className="flex flex-wrap gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800 sm:gap-4 sm:p-4">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <Input
              placeholder="Поиск по инв.№, модели, SN, клиенту..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
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
        <Button variant="ghost" size="sm">
          <Filter className="h-4 w-4" />
          Фильтры
        </Button>
      </div>

      {/* Mobile: card list */}
      <div className="sm:hidden space-y-3">
        {filteredEquipment.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <Search className="h-8 w-8 text-gray-400 dark:text-gray-500 mb-3" />
            <h3 className="text-base font-medium text-gray-900 dark:text-white">Техника не найдена</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Попробуйте изменить фильтры</p>
          </div>
        ) : filteredEquipment.map((eq) => (
          <Link
            key={eq.id}
            to={`/equipment/${eq.id}`}
            className="block rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-500"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[--color-primary] text-sm">{eq.inventoryNumber}</span>
                  {getEquipmentStatusBadge(eq.status)}
                </div>
                <p className="text-sm font-medium text-gray-900 dark:text-white mt-1 truncate">{eq.manufacturer} {eq.model}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{getEquipmentTypeLabel(eq.type)} · {getEquipmentDriveLabel(eq.drive)}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
              <div><span className="font-medium text-gray-700 dark:text-gray-300">Локация:</span> {eq.location}</div>
              {eq.currentClient && <div><span className="font-medium text-gray-700 dark:text-gray-300">Клиент:</span> {eq.currentClient}</div>}
              <div><span className="font-medium text-gray-700 dark:text-gray-300">След. ТО:</span> {formatDate(eq.nextMaintenance)}</div>
              {eq.returnDate && <div><span className="font-medium text-gray-700 dark:text-gray-300">Возврат:</span> {formatDate(eq.returnDate)}</div>}
            </div>
          </Link>
        ))}
      </div>

      {/* Desktop: Table */}
      <div className="hidden sm:block rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Инв.№ / Модель</TableHead>
              <TableHead>Тип</TableHead>
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
                  <Link
                    to={`/equipment/${equipment.id}`}
                    className="font-medium text-[--color-primary] hover:underline"
                  >
                    {equipment.inventoryNumber}
                  </Link>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{equipment.model}</p>
                </TableCell>
                <TableCell className="text-gray-700 dark:text-gray-300">{getEquipmentTypeLabel(equipment.type)}</TableCell>
                <TableCell className="text-gray-700 dark:text-gray-300">{getEquipmentDriveLabel(equipment.drive)}</TableCell>
                <TableCell>{getEquipmentStatusBadge(equipment.status)}</TableCell>
                <TableCell>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{equipment.location}</p>
                </TableCell>
                <TableCell>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{formatDate(equipment.nextMaintenance)}</p>
                </TableCell>
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
                        <DropdownMenu.Item className="cursor-pointer rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 focus:outline-none dark:text-gray-200 dark:hover:bg-gray-700">
                          Открыть
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

        {filteredEquipment.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
              <Search className="h-8 w-8 text-gray-400 dark:text-gray-500" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Техника не найдена</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Попробуйте изменить параметры поиска или фильтры
            </p>
          </div>
        )}
      </div>{/* end desktop table */}

      {/* Results info */}
      {filteredEquipment.length > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <p>Показано {filteredEquipment.length} из {equipmentList.length} единиц техники</p>
        </div>
      )}
    </div>
  );
}
