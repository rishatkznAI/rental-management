import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Search, Car, AlertTriangle, ChevronRight, RefreshCw } from 'lucide-react';
import { cn, formatDate } from '../lib/utils';
import { usePermissions } from '../lib/permissions';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useServiceVehicles } from '../hooks/useServiceVehicles';
import type { ServiceVehicle, VehicleStatus, VehicleType } from '../types';

// ── Labels ────────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<VehicleStatus, string> = {
  active:      'В работе',
  repair:      'На ремонте',
  unavailable: 'Недоступна',
  reserve:     'Резерв',
};

const TYPE_LABELS: Record<VehicleType, string> = {
  car:     'Легковой',
  van:     'Фургон',
  truck:   'Грузовой',
  minibus: 'Микроавтобус',
  other:   'Другой',
};

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'default';

function statusVariant(s: VehicleStatus): BadgeVariant {
  const map: Record<VehicleStatus, BadgeVariant> = {
    active:      'success',
    repair:      'error',
    unavailable: 'warning',
    reserve:     'default',
  };
  return map[s] ?? 'default';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isExpiringSoon(dateStr: string | null, daysAhead = 30): boolean {
  if (!dateStr) return false;
  const diff = (new Date(dateStr).getTime() - Date.now()) / 86400000;
  return diff >= 0 && diff <= daysAhead;
}

function isExpired(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return new Date(dateStr).getTime() < Date.now();
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ServiceVehicles() {
  const navigate     = useNavigate();
  const { can }      = usePermissions();
  const canEdit      = can('create', 'service_vehicles');

  const { data: vehicles = [], isLoading, isError, refetch } = useServiceVehicles();

  // Filters
  const [search,          setSearch]          = useState('');
  const [filterStatus,    setFilterStatus]    = useState<VehicleStatus | ''>('');
  const [filterType,      setFilterType]      = useState<VehicleType | ''>('');
  const [filterResponsible, setFilterResponsible] = useState('');

  const responsibles = useMemo(() =>
    [...new Set(vehicles.map(v => v.responsiblePerson).filter(Boolean))].sort(),
    [vehicles]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vehicles.filter(v => {
      if (filterStatus && v.status !== filterStatus) return false;
      if (filterType   && v.vehicleType !== filterType) return false;
      if (filterResponsible && v.responsiblePerson !== filterResponsible) return false;
      if (q) {
        const hay = `${v.make} ${v.model} ${v.plateNumber} ${v.vin ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [vehicles, search, filterStatus, filterType, filterResponsible]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Служебные машины</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Учёт транспорта сервисной службы
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Обновить"
          >
            <RefreshCw className="h-4 w-4 text-gray-500" />
          </button>
          {canEdit && (
            <Button onClick={() => navigate('/service-vehicles/new')}>
              <Plus className="h-4 w-4 mr-1.5" />
              Добавить машину
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <Input
            className="pl-8 w-56"
            placeholder="Марка, модель, госномер, VIN…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as VehicleStatus | '')}
          className="h-9 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Все статусы</option>
          {(Object.keys(STATUS_LABELS) as VehicleStatus[]).map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>

        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value as VehicleType | '')}
          className="h-9 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Все типы</option>
          {(Object.keys(TYPE_LABELS) as VehicleType[]).map(t => (
            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
          ))}
        </select>

        {responsibles.length > 0 && (
          <select
            value={filterResponsible}
            onChange={e => setFilterResponsible(e.target.value)}
            className="h-9 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Все ответственные</option>
            {responsibles.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        )}

        {(search || filterStatus || filterType || filterResponsible) && (
          <button
            onClick={() => { setSearch(''); setFilterStatus(''); setFilterType(''); setFilterResponsible(''); }}
            className="h-9 px-3 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
          >
            Сбросить
          </button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-500 dark:text-gray-400">
          <RefreshCw className="h-5 w-5 animate-spin mr-2" />
          Загрузка…
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center py-16 text-red-500">
          <AlertTriangle className="h-5 w-5 mr-2" />
          Ошибка загрузки данных
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
          <Car className="h-12 w-12 mb-3 opacity-40" />
          <p className="text-base font-medium">Нет машин</p>
          <p className="text-sm mt-1">
            {vehicles.length === 0
              ? 'Добавьте первую служебную машину'
              : 'Нет машин, соответствующих фильтрам'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Машина</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Тип</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Статус</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Пробег</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Ответственный</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Документы</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Обновлён</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(v => (
                <VehicleRow
                  key={v.id}
                  vehicle={v}
                  onClick={() => navigate(`/service-vehicles/${v.id}`)}
                />
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400">
            Показано {filtered.length} из {vehicles.length}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function VehicleRow({ vehicle: v, onClick }: { vehicle: ServiceVehicle; onClick: () => void }) {
  const docWarning =
    isExpired(v.osagoExpiresAt) ||
    isExpired(v.insuranceExpiresAt) ||
    isExpiringSoon(v.osagoExpiresAt) ||
    isExpiringSoon(v.insuranceExpiresAt) ||
    isExpiringSoon(v.nextServiceAt, 14);

  return (
    <tr
      onClick={onClick}
      className={cn(
        'border-b border-gray-100 dark:border-gray-700 last:border-0',
        'hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors',
        v.status === 'repair' && 'bg-red-50/40 dark:bg-red-900/10',
      )}
    >
      {/* Машина */}
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900 dark:text-white">
          {v.make} {v.model}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
          {v.plateNumber}{v.year ? ` · ${v.year}` : ''}
        </div>
      </td>

      {/* Тип */}
      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
        {TYPE_LABELS[v.vehicleType] ?? v.vehicleType}
      </td>

      {/* Статус */}
      <td className="px-4 py-3">
        <Badge variant={statusVariant(v.status)}>
          {STATUS_LABELS[v.status] ?? v.status}
        </Badge>
      </td>

      {/* Пробег */}
      <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200 tabular-nums">
        {v.currentMileage.toLocaleString('ru-RU')} км
      </td>

      {/* Ответственный */}
      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
        {v.responsiblePerson || '—'}
      </td>

      {/* Документы */}
      <td className="px-4 py-3">
        {docWarning ? (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            Требует внимания
          </span>
        ) : (
          <span className="text-xs text-green-600 dark:text-green-400">ОК</span>
        )}
      </td>

      {/* Обновлён */}
      <td className="px-4 py-3 text-xs text-gray-400">
        {formatDate(v.updatedAt)}
      </td>

      {/* Arrow */}
      <td className="px-4 py-3 text-gray-400">
        <ChevronRight className="h-4 w-4" />
      </td>
    </tr>
  );
}
