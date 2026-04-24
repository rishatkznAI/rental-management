/**
 * Планировщик подготовки техники к аренде
 *
 * Операционный экран для сервиса: показывает будущие отгрузки,
 * статус подготовки каждой единицы техники под конкретную аренду,
 * приоритет и признак риска срыва.
 */

import React, { useMemo, useState, useCallback, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  RefreshCw,
  Search,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { FilterButton, FilterDialog, FilterField } from '../components/ui/filter-dialog';
import { usePlannerRows, useUpdatePlannerItem } from '../hooks/usePlanner';
import { usePermissions } from '../lib/permissions';
import type { PlannerRow, PrepStatus, PlannerPriority, EquipmentType } from '../types';

// ── Словари ────────────────────────────────────────────────────────────────────

const PREP_STATUS_LABELS: Record<PrepStatus, string> = {
  planned:    'Запланирована',
  needs_prep: 'Требует подготовки',
  inspection: 'На осмотре',
  in_repair:  'В ремонте',
  ready:      'Готова к отгрузке',
  shipped:    'Отгружена',
  on_hold:    'Ожидает решения',
  conflict:   'Конфликт',
  not_ready:  'Не готова',
};

const PREP_STATUS_COLORS: Record<PrepStatus, string> = {
  planned:    'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  needs_prep: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  inspection: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  in_repair:  'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  ready:      'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  shipped:    'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
  on_hold:    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  conflict:   'bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-200',
  not_ready:  'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const PRIORITY_LABELS: Record<PlannerPriority, string> = {
  high:   'Высокий',
  medium: 'Средний',
  low:    'Низкий',
};

const PRIORITY_COLORS: Record<PlannerPriority, string> = {
  high:   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  low:    'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
};

const EQUIPMENT_TYPE_LABELS: Record<string, string> = {
  scissor:    'Ножничный',
  articulated:'Коленчатый',
  telescopic: 'Телескопический',
  mast: 'Мачтовый',
};

const EQUIPMENT_STATUS_LABELS: Record<string, string> = {
  available:  'Свободна',
  rented:     'В аренде',
  reserved:   'Резерв',
  in_service: 'В ремонте',
  inactive:   'Неактивна',
};

const EQUIPMENT_STATUS_COLORS: Record<string, string> = {
  available:  'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  rented:     'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  reserved:   'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  in_service: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  inactive:   'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
};

const OPERATION_LABELS: Record<NonNullable<PlannerRow['operationType']>, string> = {
  rental: 'Аренда',
  shipping: 'Отгрузка',
  receiving: 'Приёмка',
  service: 'Сервис',
};

const OPERATION_COLORS: Record<NonNullable<PlannerRow['operationType']>, string> = {
  rental: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  shipping: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  receiving: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  service: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
};

const ALL_PREP_STATUSES = Object.keys(PREP_STATUS_LABELS) as PrepStatus[];
const ALL_PRIORITIES = Object.keys(PRIORITY_LABELS) as PlannerPriority[];

// ── Типы фильтров ──────────────────────────────────────────────────────────────

type DateRange = 'today' | 'tomorrow' | 'week' | 'all' | 'custom';

interface Filters {
  dateRange:    DateRange;
  customFrom:   string;
  customTo:     string;
  prepStatuses: PrepStatus[];
  manager:      string;
  equipType:    EquipmentType | '';
  riskOnly:     boolean;
  search:       string;
}

const DEFAULT_FILTERS: Filters = {
  dateRange:    'week',
  customFrom:   '',
  customTo:     '',
  prepStatuses: [],
  manager:      '',
  equipType:    '',
  riskOnly:     false,
  search:       '',
};

// ── Вспомогательные функции ────────────────────────────────────────────────────

function formatDaysUntil(daysUntil: number): { label: string; className: string } {
  if (daysUntil < 0) {
    return {
      label: `Просрочено на ${Math.abs(daysUntil)} д.`,
      className: 'text-red-600 dark:text-red-400 font-semibold',
    };
  }
  if (daysUntil === 0) return { label: 'Сегодня', className: 'text-red-600 dark:text-red-400 font-bold' };
  if (daysUntil === 1) return { label: 'Завтра',  className: 'text-orange-600 dark:text-orange-400 font-semibold' };
  if (daysUntil <= 3) return {
    label: `+${daysUntil} дн.`,
    className: 'text-amber-600 dark:text-amber-400 font-medium',
  };
  return { label: `+${daysUntil} дн.`, className: 'text-gray-500 dark:text-gray-400' };
}

function formatDate(iso: string): string {
  try {
    return format(parseISO(iso), 'd MMM', { locale: ru });
  } catch {
    return iso;
  }
}

function getQuickCountTone(value: number, warningFrom = 1, criticalFrom = 3) {
  if (value >= criticalFrom) {
    return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
  }
  if (value >= warningFrom) {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
  }
  return 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300';
}

function matchesDateRange(row: PlannerRow, filters: Filters): boolean {
  const { dateRange, customFrom, customTo } = filters;
  if (dateRange === 'all') return true;

  const today = new Date(); today.setHours(0,0,0,0);
  const start = new Date(row.startDate); start.setHours(0,0,0,0);
  const diff = Math.round((start.getTime() - today.getTime()) / 86400000);

  if (dateRange === 'today')    return diff === 0;
  if (dateRange === 'tomorrow') return diff === 1;
  if (dateRange === 'week')     return diff >= 0 && diff <= 7;

  // custom
  if (dateRange === 'custom') {
    if (customFrom && start < new Date(customFrom)) return false;
    if (customTo   && start > new Date(customTo))   return false;
    return true;
  }
  return true;
}

function matchesSearch(row: PlannerRow, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  return (
    row.client.toLowerCase().includes(lower) ||
    row.equipmentLabel.toLowerCase().includes(lower) ||
    (row.inventoryNumber || '').toLowerCase().includes(lower) ||
    (row.serialNumber || '').toLowerCase().includes(lower)
  );
}

function isServiceRow(row: PlannerRow): boolean {
  return row.sourceType === 'service' || row.operationType === 'service';
}

function getRowAccentClasses(row: PlannerRow) {
  if (isServiceRow(row)) {
    return 'border-violet-200 bg-violet-50/40 dark:border-violet-900/50 dark:bg-violet-950/10';
  }
  return 'border-gray-200 dark:border-gray-700';
}

function getTableRowAccentClasses(row: PlannerRow) {
  if (isServiceRow(row)) {
    return 'bg-violet-50/35 dark:bg-violet-950/10 hover:bg-violet-50/70 dark:hover:bg-violet-900/20';
  }
  return 'bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/70';
}

// ── Компонент: бейдж-дропдаун статуса подготовки ─────────────────────────────

interface PrepStatusBadgeProps {
  rowId:      string;
  value:      PrepStatus;
  canEdit:    boolean;
  onSave:     (rowId: string, status: PrepStatus) => void;
}

function PrepStatusBadge({ rowId, value, canEdit, onSave }: PrepStatusBadgeProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Закрываем по клику снаружи
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!canEdit) {
    return (
      <span className={cn('px-2 py-0.5 rounded text-xs font-medium', PREP_STATUS_COLORS[value])}>
        {PREP_STATUS_LABELS[value]}
      </span>
    );
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-opacity hover:opacity-80',
          PREP_STATUS_COLORS[value],
        )}
      >
        {PREP_STATUS_LABELS[value]}
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 left-0 top-full mt-1 min-w-44 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
          {ALL_PREP_STATUSES.map(status => (
            <button
              key={status}
              onClick={() => { onSave(rowId, status); setOpen(false); }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors',
                status === value && 'font-semibold',
              )}
            >
              <span className={cn('inline-block px-1.5 py-0.5 rounded', PREP_STATUS_COLORS[status])}>
                {PREP_STATUS_LABELS[status]}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Компонент: инлайн-редактирование комментария ──────────────────────────────

interface CommentCellProps {
  rowId:   string;
  value:   string;
  canEdit: boolean;
  onSave:  (rowId: string, comment: string) => void;
}

function CommentCell({ rowId, value, canEdit, onSave }: CommentCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);
  const inputRef              = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!canEdit) {
    return <span className="text-xs text-gray-500 dark:text-gray-400">{value || '—'}</span>;
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { onSave(rowId, draft); setEditing(false); }}
        onKeyDown={e => {
          if (e.key === 'Enter')  { onSave(rowId, draft); setEditing(false); }
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
        className="w-full text-xs px-1 py-0.5 border border-blue-400 rounded outline-none bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
      />
    );
  }

  return (
    <button
      onClick={() => { setDraft(value); setEditing(true); }}
      className="text-left text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline decoration-dotted underline-offset-2 w-full"
    >
      {value || <span className="opacity-40">добавить…</span>}
    </button>
  );
}

// ── Основная страница ─────────────────────────────────────────────────────────

export default function Planner() {
  const { can } = usePermissions();
  const canEdit = can('edit', 'planner');

  const [includeShipped, setIncludeShipped] = useState(false);
  const { data: rows = [], isLoading, isFetching, refetch } = usePlannerRows(includeShipped);
  const { mutate: updateItem } = useUpdatePlannerItem(includeShipped);

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  // Уникальные менеджеры из данных
  const managers = useMemo(() => {
    const set = new Set(rows.map(r => r.manager).filter(Boolean));
    return Array.from(set).sort();
  }, [rows]);

  // Применяем фильтры
  const filtered = useMemo<PlannerRow[]>(() => {
    return rows.filter(row => {
      if (!matchesDateRange(row, filters)) return false;
      if (filters.prepStatuses.length > 0 && !filters.prepStatuses.includes(row.prepStatus)) return false;
      if (filters.manager  && row.manager !== filters.manager) return false;
      if (filters.equipType && row.equipmentType !== filters.equipType) return false;
      if (filters.riskOnly && !row.risk) return false;
      if (!matchesSearch(row, filters.search)) return false;
      return true;
    });
  }, [rows, filters]);

  // Счётчики
  const riskCount  = useMemo(() => filtered.filter(r => r.risk).length, [filtered]);
  const highCount  = useMemo(() => filtered.filter(r => r.priority === 'high').length, [filtered]);

  const handlePrepStatusSave = useCallback((rowId: string, prepStatus: PrepStatus) => {
    updateItem({ rowId, payload: { prepStatus } }, {
      onSuccess: () => toast.success('Статус подготовки обновлён'),
      onError:   () => toast.error('Не удалось сохранить'),
    });
  }, [updateItem]);

  const handleCommentSave = useCallback((rowId: string, comment: string) => {
    updateItem({ rowId, payload: { comment } }, {
      onError: () => toast.error('Не удалось сохранить'),
    });
  }, [updateItem]);

  const handleRiskToggle = useCallback((row: PlannerRow) => {
    updateItem({ rowId: row.id, payload: { riskOverride: !row.risk } }, {
      onSuccess: () => toast.success('Риск обновлён'),
      onError:   () => toast.error('Не удалось сохранить'),
    });
  }, [updateItem]);

  const clearFilter = <K extends keyof Filters>(key: K, defaultValue: Filters[K]) => {
    setFilters(f => ({ ...f, [key]: defaultValue }));
  };

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.dateRange !== 'week') n++;
    if (filters.prepStatuses.length > 0) n++;
    if (filters.manager) n++;
    if (filters.equipType) n++;
    if (filters.riskOnly) n++;
    if (includeShipped) n++;
    if (filters.search.trim()) n++;
    return n;
  }, [filters, includeShipped]);

  const quickFilterCounts = useMemo(() => ({
    today: rows.filter(row => matchesDateRange(row, { ...DEFAULT_FILTERS, dateRange: 'today' })).length,
    week: rows.filter(row => matchesDateRange(row, { ...DEFAULT_FILTERS, dateRange: 'week' })).length,
    risks: rows.filter(row => row.risk).length,
  }), [rows]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Заголовок ── */}
      <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Планировщик</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Очередь подготовки техники, логистики и запланированных сервисных работ
          </p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          {riskCount > 0 && (
            <span className="flex items-center gap-1 px-2 py-1 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg text-xs font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              {riskCount} риск{riskCount === 1 ? '' : riskCount < 5 ? 'а' : 'ов'}
            </span>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400"
            title="Обновить"
          >
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* ── Фильтры ── */}
      <div className="px-6 pb-3">
        <div className="flex justify-end">
          <FilterButton activeCount={activeFilterCount} onClick={() => setShowFilters(true)} />
        </div>
      </div>

      <FilterDialog
        open={showFilters}
        onOpenChange={setShowFilters}
        title="Фильтры планировщика"
        description="Настрой период, поиск и дополнительные условия отображения подготовки техники."
        onReset={() => {
          setFilters(DEFAULT_FILTERS);
          setIncludeShipped(false);
        }}
      >
        <div className="space-y-5">
          <FilterField label="Поиск">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={filters.search}
                onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                placeholder="Клиент, модель, инв. №, серийный №…"
                className="app-filter-input pl-10"
              />
            </div>
          </FilterField>

          <FilterField label="Период">
            <div className="flex flex-wrap gap-2">
              {(['today', 'tomorrow', 'week', 'all'] as DateRange[]).map(range => (
                <button
                  key={range}
                  type="button"
                  onClick={() => setFilters(f => ({ ...f, dateRange: range }))}
                  className="app-filter-chip"
                  data-active={String(filters.dateRange === range)}
                >
                  {range === 'today' && 'Сегодня'}
                  {range === 'tomorrow' && 'Завтра'}
                  {range === 'week' && '7 дней'}
                  {range === 'all' && 'Все'}
                </button>
              ))}
            </div>
          </FilterField>

          <FilterField label="Статус подготовки">
            <div className="flex flex-wrap gap-2">
              {ALL_PREP_STATUSES.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFilters(f => ({
                    ...f,
                    prepStatuses: f.prepStatuses.includes(s)
                      ? f.prepStatuses.filter(x => x !== s)
                      : [...f.prepStatuses, s],
                  }))}
                  className="app-filter-chip"
                  data-active={String(filters.prepStatuses.includes(s))}
                >
                  {PREP_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </FilterField>

          <div className="grid gap-4 md:grid-cols-2">
            {managers.length > 0 && (
              <FilterField label="Менеджер">
                <select
                  value={filters.manager}
                  onChange={e => setFilters(f => ({ ...f, manager: e.target.value }))}
                  className="app-filter-input"
                >
                  <option value="">Все</option>
                  {managers.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </FilterField>
            )}

            <FilterField label="Тип техники">
              <select
                value={filters.equipType}
                onChange={e => setFilters(f => ({ ...f, equipType: e.target.value as EquipmentType | '' }))}
                className="app-filter-input"
              >
                <option value="">Все</option>
                {Object.entries(EQUIPMENT_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </FilterField>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-2 rounded-xl border border-border bg-secondary/70 px-4 py-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={filters.riskOnly}
                onChange={e => setFilters(f => ({ ...f, riskOnly: e.target.checked }))}
                className="rounded"
              />
              Только с риском
            </label>

            <label className="flex items-center gap-2 rounded-xl border border-border bg-secondary/70 px-4 py-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={includeShipped}
                onChange={e => setIncludeShipped(e.target.checked)}
                className="rounded"
              />
              Показать отгруженные
            </label>
          </div>
        </div>
      </FilterDialog>

      {/* ── Статистика ── */}
      {!isLoading && filtered.length > 0 && (
        <div className="px-6 pb-2 flex gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span>Всего: {filtered.length}</span>
          {highCount > 0 && (
            <span className="text-red-600 dark:text-red-400 font-medium">
              🔴 Высокий приоритет: {highCount}
            </span>
          )}
          {riskCount > 0 && (
            <span className="text-orange-600 dark:text-orange-400 font-medium">
              ⚠ Рисков: {riskCount}
            </span>
          )}
        </div>
      )}

      {/* ── Контент ── */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-gray-400">
            <RefreshCw className="h-6 w-6 animate-spin mr-2" />
            Загрузка…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 dark:text-gray-500">
            <Calendar className="h-12 w-12 mb-3 opacity-40" />
            <p className="text-sm font-medium">Нет записей</p>
            <p className="text-xs mt-1">
              {rows.length === 0
                ? 'Нет будущих операций и запланированных работ'
                : 'Попробуйте изменить фильтры'}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3 sm:hidden">
              {filtered.map(row => {
                const { label: daysLabel, className: daysClass } = formatDaysUntil(row.daysUntil);

                return (
                  <div
                    key={row.id}
                    className={cn(
                      'rounded-xl border bg-white p-4 shadow-sm dark:bg-gray-900',
                      row.risk
                        ? 'border-red-200 dark:border-red-800'
                        : getRowAccentClasses(row),
                      row.prepStatus === 'shipped' && 'opacity-70',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        {isServiceRow(row) && (
                          <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
                            <Wrench className="h-3 w-3" />
                            Запланированная работа
                          </span>
                        )}
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {row.equipmentLabel || '—'}
                        </div>
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {row.inventoryNumber || '—'}{row.serialNumber ? ` · ${row.serialNumber}` : ''}
                        </div>
                      </div>
                      <span className={cn('rounded px-2 py-0.5 text-xs font-medium', PRIORITY_COLORS[row.priority])}>
                        {PRIORITY_LABELS[row.priority]}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800">
                          <div className="text-gray-400 dark:text-gray-500">Дата операции</div>
                          <div className="mt-1 font-medium text-gray-900 dark:text-gray-100">
                            {formatDate(row.startDate)}
                          </div>
                          <div className={cn('mt-0.5', daysClass)}>{daysLabel}</div>
                          {row.operationType && (
                            <span className={cn('mt-2 inline-flex rounded px-2 py-0.5 text-xs font-medium', OPERATION_COLORS[row.operationType])}>
                              {OPERATION_LABELS[row.operationType]}
                            </span>
                          )}
                        </div>
                      <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800">
                        <div className="text-gray-400 dark:text-gray-500">Статус техники</div>
                        <div className="mt-1">
                          {row.equipmentStatus ? (
                            <span className={cn(
                              'inline-flex rounded px-2 py-0.5 text-xs font-medium',
                              EQUIPMENT_STATUS_COLORS[row.equipmentStatus] || 'bg-gray-100 text-gray-600',
                            )}>
                              {EQUIPMENT_STATUS_LABELS[row.equipmentStatus] || row.equipmentStatus}
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2 text-xs">
                      <div>
                        <span className="text-gray-400 dark:text-gray-500">Клиент</span>
                        <div className="mt-0.5 font-medium text-gray-900 dark:text-gray-100">{row.client || '—'}</div>
                        {row.deliveryAddress && (
                          <div className="mt-0.5 text-gray-500 dark:text-gray-400">{row.deliveryAddress}</div>
                        )}
                      </div>
                      <div>
                        <span className="text-gray-400 dark:text-gray-500">Менеджер</span>
                        <div className="mt-0.5 text-gray-900 dark:text-gray-100">{row.manager || '—'}</div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <PrepStatusBadge
                        rowId={row.id}
                        value={row.prepStatus}
                        canEdit={canEdit}
                        onSave={handlePrepStatusSave}
                      />
                      {row.risk ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300">
                          <AlertTriangle className="h-3 w-3" />
                          Риск
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                          Без риска
                        </span>
                      )}
                    </div>

                    <div className="mt-3">
                      <CommentCell
                        rowId={row.id}
                        value={row.comment}
                        canEdit={canEdit}
                        onSave={handleCommentSave}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 sm:block">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    Дата операции
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">
                    Техника
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    Инв. / SN
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">
                    Клиент / работа
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">
                    Менеджер
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    Статус техники
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    Статус подготовки
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">
                    Приоритет
                  </th>
                  <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">
                    Риск
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">
                    Комментарий
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.map(row => {
                  const { label: daysLabel, className: daysClass } = formatDaysUntil(row.daysUntil);
                  const isHighRisk = row.risk;
                  const isHighPriority = row.priority === 'high';

                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        'transition-colors',
                        getTableRowAccentClasses(row),
                        isHighRisk && 'border-l-2 border-l-red-400',
                        !isHighRisk && isServiceRow(row) && 'border-l-2 border-l-violet-400',
                        row.prepStatus === 'shipped' && 'opacity-60',
                      )}
                    >
                      {/* Дата отгрузки */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          {formatDate(row.startDate)}
                        </div>
                        <div className={cn('text-xs', daysClass)}>
                          {daysLabel}
                        </div>
                        {row.operationType && (
                          <span className={cn('mt-1 inline-flex rounded px-2 py-0.5 text-[11px] font-medium', OPERATION_COLORS[row.operationType])}>
                            {OPERATION_LABELS[row.operationType]}
                          </span>
                        )}
                      </td>

                      {/* Техника */}
                      <td className="px-3 py-2.5">
                        {isServiceRow(row) && (
                          <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
                            <Wrench className="h-3 w-3" />
                            Сервис
                          </span>
                        )}
                        <div className="font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                          {row.equipmentLabel || '—'}
                        </div>
                        {row.equipmentType && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {EQUIPMENT_TYPE_LABELS[row.equipmentType] || row.equipmentType}
                          </div>
                        )}
                      </td>

                      {/* Инв. / SN */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="text-gray-900 dark:text-gray-100 font-mono text-xs">
                          {row.inventoryNumber || '—'}
                        </div>
                        {row.serialNumber && (
                          <div className="text-xs text-gray-400 dark:text-gray-500 font-mono">
                            {row.serialNumber}
                          </div>
                        )}
                      </td>

                      {/* Клиент */}
                      <td className="px-3 py-2.5">
                        <div className="text-gray-900 dark:text-gray-100 max-w-36 truncate" title={row.client}>
                          {row.client || '—'}
                        </div>
                        {row.deliveryAddress && (
                          <div className="text-xs text-gray-400 dark:text-gray-500 max-w-36 truncate" title={row.deliveryAddress}>
                            {row.deliveryAddress}
                          </div>
                        )}
                      </td>

                      {/* Менеджер */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="text-gray-700 dark:text-gray-300 text-xs">
                          {row.manager || '—'}
                        </span>
                      </td>

                      {/* Общий статус техники */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {row.equipmentStatus ? (
                          <span className={cn(
                            'px-2 py-0.5 rounded text-xs font-medium',
                            EQUIPMENT_STATUS_COLORS[row.equipmentStatus] || 'bg-gray-100 text-gray-600',
                          )}>
                            {EQUIPMENT_STATUS_LABELS[row.equipmentStatus] || row.equipmentStatus}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>

                      {/* Статус подготовки */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <PrepStatusBadge
                          rowId={row.id}
                          value={row.prepStatus}
                          canEdit={canEdit}
                          onSave={handlePrepStatusSave}
                        />
                      </td>

                      {/* Приоритет */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={cn(
                          'px-2 py-0.5 rounded text-xs font-medium',
                          PRIORITY_COLORS[row.priority],
                        )}>
                          {PRIORITY_LABELS[row.priority]}
                        </span>
                      </td>

                      {/* Риск */}
                      <td className="px-3 py-2.5 text-center">
                        {canEdit ? (
                          <button
                            onClick={() => handleRiskToggle(row)}
                            title={row.risk ? 'Снять риск' : 'Поставить риск'}
                            className={cn(
                              'inline-flex items-center justify-center rounded transition-opacity hover:opacity-70',
                            )}
                          >
                            {row.risk ? (
                              <AlertTriangle className="h-4 w-4 text-red-500 dark:text-red-400" />
                            ) : (
                              <span className="text-gray-300 dark:text-gray-600 text-sm">—</span>
                            )}
                          </button>
                        ) : (
                          row.risk
                            ? <AlertTriangle className="h-4 w-4 text-red-500 dark:text-red-400 mx-auto" />
                            : <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>

                      {/* Комментарий */}
                      <td className="px-3 py-2.5 max-w-48">
                        <CommentCell
                          rowId={row.id}
                          value={row.comment}
                          canEdit={canEdit}
                          onSave={handleCommentSave}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      <div className="sticky bottom-0 z-20 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95 sm:hidden">
        <div className="flex items-center justify-end gap-2">
          <FilterButton size="sm" activeCount={activeFilterCount} onClick={() => setShowFilters(true)} />
        </div>
      </div>
    </div>
  );
}
