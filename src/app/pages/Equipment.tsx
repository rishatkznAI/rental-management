import React from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { getEquipmentStatusBadge } from '../components/ui/badge';
import { Search, Filter, Download, MoreVertical, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { loadEquipment, EQUIPMENT_STORAGE_KEY } from '../mock-data';
import { formatDate } from '../lib/utils';
import type { EquipmentStatus, EquipmentType, EquipmentDrive, Equipment as EquipmentType_ } from '../types';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

export default function Equipment() {
  const [equipmentList, setEquipmentList] = React.useState<EquipmentType_[]>(() => loadEquipment());
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [typeFilter, setTypeFilter] = React.useState<string>('all');
  const [driveFilter, setDriveFilter] = React.useState<string>('all');

  // Обновляем список при изменении localStorage из другой вкладки или после добавления
  React.useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === EQUIPMENT_STORAGE_KEY) setEquipmentList(loadEquipment());
    };
    window.addEventListener('storage', handleStorage);
    // Также обновляем при фокусе на вкладке (после возврата с /equipment/new)
    const handleFocus = () => setEquipmentList(loadEquipment());
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const filteredEquipment = equipmentList.filter(eq => {
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
    <div className="space-y-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Техника</h1>
          <p className="mt-1 text-sm text-gray-500">Управление парком подъёмных платформ</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary">
            <Download className="h-4 w-4" />
            Экспорт
          </Button>
          <Link to="/equipment/new">
            <Button>
              <Plus className="h-4 w-4" />
              Добавить технику
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
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

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white">
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
                  <p className="text-sm text-gray-500">{equipment.model}</p>
                </TableCell>
                <TableCell>{getEquipmentTypeLabel(equipment.type)}</TableCell>
                <TableCell>{getEquipmentDriveLabel(equipment.drive)}</TableCell>
                <TableCell>{getEquipmentStatusBadge(equipment.status)}</TableCell>
                <TableCell>
                  <p className="text-sm">{equipment.location}</p>
                </TableCell>
                <TableCell>
                  <p className="text-sm">{formatDate(equipment.nextMaintenance)}</p>
                </TableCell>
                <TableCell>
                  {equipment.currentClient ? (
                    <p className="text-sm">{equipment.currentClient}</p>
                  ) : (
                    <span className="text-sm text-gray-400">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {equipment.returnDate ? (
                    <p className="text-sm">{formatDate(equipment.returnDate)}</p>
                  ) : (
                    <span className="text-sm text-gray-400">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button className="rounded p-1 hover:bg-gray-100">
                        <MoreVertical className="h-4 w-4 text-gray-500" />
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        className="min-w-[180px] rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
                        sideOffset={5}
                        align="end"
                      >
                        <DropdownMenu.Item className="cursor-pointer rounded px-3 py-2 text-sm hover:bg-gray-100 focus:outline-none">
                          Открыть
                        </DropdownMenu.Item>
                        <DropdownMenu.Item className="cursor-pointer rounded px-3 py-2 text-sm hover:bg-gray-100 focus:outline-none">
                          Сдать в аренду
                        </DropdownMenu.Item>
                        <DropdownMenu.Item className="cursor-pointer rounded px-3 py-2 text-sm hover:bg-gray-100 focus:outline-none">
                          Вернуть
                        </DropdownMenu.Item>
                        <DropdownMenu.Item className="cursor-pointer rounded px-3 py-2 text-sm hover:bg-gray-100 focus:outline-none">
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
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <Search className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">Техника не найдена</h3>
            <p className="mt-1 text-sm text-gray-500">
              Попробуйте изменить параметры поиска или фильтры
            </p>
          </div>
        )}
      </div>

      {/* Results info */}
      {filteredEquipment.length > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <p>Показано {filteredEquipment.length} из {equipmentList.length} единиц техники</p>
        </div>
      )}
    </div>
  );
}
