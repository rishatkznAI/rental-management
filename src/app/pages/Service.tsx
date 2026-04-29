import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, Plus, Search } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { getServicePriorityBadge, getServiceStatusBadge } from '../components/ui/badge';
import { FilterButton, FilterDialog, FilterField } from '../components/ui/filter-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { WarrantyClaimsTab } from '../components/service/WarrantyClaimsTab';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../lib/permissions';
import { isWarrantyMechanicRole, normalizeUserRole } from '../lib/userStorage';
import { useServiceTicketsList } from '../hooks/useServiceTickets';
import { formatDate } from '../lib/utils';
import type { ServiceTicket } from '../types';
import { getServiceScenarioLabel, inferServiceKind } from '../lib/serviceScenarios';

const RESULT_BATCH_SIZE = 80;

const SERVICE_PRIORITY_ORDER: Record<ServiceTicket['priority'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const SERVICE_STATUS_ORDER: Record<ServiceTicket['status'], number> = {
  new: 0,
  in_progress: 1,
  waiting_parts: 2,
  ready: 3,
  closed: 4,
};

const SERVICE_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
const SERVICE_STATUSES = ['new', 'in_progress', 'waiting_parts', 'ready', 'closed'] as const;

const WORKFLOW_FILTER_OPTIONS = [
  { value: 'all', label: 'Все' },
  { value: 'repair', label: 'Ремонт' },
  { value: 'diagnostics', label: 'Диагностика' },
  { value: 'receiving', label: 'Приёмка' },
] as const;

type ServiceWorkflowFilter = typeof WORKFLOW_FILTER_OPTIONS[number]['value'];
type ServiceWorkflowKind = Exclude<ServiceWorkflowFilter, 'all'> | 'maintenance';

function normalizeSearch(value: string) {
  return value.toLowerCase().replaceAll('ё', 'е').trim();
}

function truncateText(value: string, maxLength: number) {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function isActiveTicket(ticket: ServiceTicket) {
  return normalizeServiceStatus(ticket.status) !== 'closed';
}

function normalizeServicePriority(priority: ServiceTicket['priority']): ServiceTicket['priority'] {
  return SERVICE_PRIORITIES.includes(priority as typeof SERVICE_PRIORITIES[number]) ? priority : 'medium';
}

function normalizeServiceStatus(status: ServiceTicket['status']): ServiceTicket['status'] {
  return SERVICE_STATUSES.includes(status as typeof SERVICE_STATUSES[number]) ? status : 'new';
}

function getTicketSearchText(ticket: ServiceTicket) {
  return normalizeSearch([
    ticket.id,
    ticket.equipment,
    ticket.inventoryNumber,
    ticket.serialNumber,
    ticket.reason,
    ticket.description,
    ticket.assignedMechanicName,
    ticket.assignedTo,
    ticket.createdByUserName,
    ticket.createdBy,
    getServiceScenarioLabel(ticket),
  ].filter(Boolean).join(' '));
}

function getTicketWorkflowKind(ticket: ServiceTicket): ServiceWorkflowKind {
  const kind = inferServiceKind(ticket);
  if (kind !== 'repair') return 'maintenance';

  const text = normalizeSearch(`${ticket.reason} ${ticket.description}`);
  if (text.includes('прием') || text.includes('возврат') || text.includes('аренд')) return 'receiving';
  if (text.includes('диагност')) return 'diagnostics';
  return 'repair';
}

function getTicketEquipmentTitle(ticket: ServiceTicket) {
  const equipment = ticket.equipment || '';
  const cleaned = equipment
    .replace(/\s*\(INV:.*?\)\s*/gi, ' ')
    .replace(/\s*·\s*INV.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || equipment || 'Техника не указана';
}

function getTicketInventory(ticket: ServiceTicket) {
  if (ticket.inventoryNumber) return ticket.inventoryNumber;
  const match = (ticket.equipment || '').match(/INV[:\s]*([^)·\s]+)/i);
  return match?.[1] || '—';
}

function formatTicketDate(value: ServiceTicket['createdAt']) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? formatDate(new Date(timestamp).toISOString()) : '—';
}

function ServiceMetricCard({
  title,
  value,
  caption,
  tone,
}: {
  title: string;
  value: number;
  caption: string;
  tone: 'lime' | 'red' | 'amber' | 'neutral';
}) {
  const toneClass = {
    lime: 'text-[--color-primary]',
    red: 'text-red-400',
    amber: 'text-amber-400',
    neutral: 'text-gray-900 dark:text-white',
  }[tone];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="text-xs font-bold uppercase text-gray-500 dark:text-gray-500">{title}</div>
      <div className={`mt-2 text-4xl font-black leading-none ${toneClass}`}>{value}</div>
      <div className="mt-3 text-sm text-gray-500 dark:text-gray-500">{caption}</div>
    </div>
  );
}

export default function Service() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const { data: ticketList = [] } = useServiceTicketsList();
  const canManageWarrantyClaims = can('edit', 'service');
  const [search, setSearch] = React.useState('');
  const [priorityFilter, setPriorityFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [scenarioFilter, setScenarioFilter] = React.useState<string>('all');
  const [mechanicFilter, setMechanicFilter] = React.useState<string>('all');
  const [workflowFilter, setWorkflowFilter] = React.useState<ServiceWorkflowFilter>('all');
  const [preset, setPreset] = React.useState<'all' | 'unassigned' | 'urgent' | 'waiting_parts' | 'maintenance'>('all');
  const [datePreset, setDatePreset] = React.useState<'all' | 'today' | 'last7' | 'month'>('all');
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo, setDateTo] = React.useState('');
  const [showFilters, setShowFilters] = React.useState(false);
  const [visibleCount, setVisibleCount] = React.useState(RESULT_BATCH_SIZE);

  const todayIso = React.useMemo(() => new Date().toISOString().slice(0, 10), []);
  const monthStartIso = React.useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  }, []);
  const last7StartIso = React.useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    return start.toISOString().slice(0, 10);
  }, []);

  const mechanicOptions = React.useMemo(() => (
    Array.from(new Set(
      ticketList
        .map(ticket => ticket.assignedMechanicName || ticket.assignedTo || '')
        .map(value => value.trim())
        .filter(Boolean),
    )).sort((left, right) => left.localeCompare(right, 'ru'))
  ), [ticketList]);

  const activeTickets = React.useMemo(
    () => ticketList.filter(isActiveTicket),
    [ticketList],
  );

  const workflowCounts = React.useMemo(() => (
    WORKFLOW_FILTER_OPTIONS.reduce<Record<ServiceWorkflowFilter, number>>((acc, option) => {
      acc[option.value] = option.value === 'all'
        ? activeTickets.length
        : activeTickets.filter(ticket => getTicketWorkflowKind(ticket) === option.value).length;
      return acc;
    }, { all: 0, repair: 0, diagnostics: 0, receiving: 0 })
  ), [activeTickets]);

  const metrics = React.useMemo(() => ({
    total: activeTickets.length,
    high: activeTickets.filter(ticket => ['critical', 'high'].includes(normalizeServicePriority(ticket.priority))).length,
    medium: activeTickets.filter(ticket => normalizeServicePriority(ticket.priority) === 'medium').length,
    low: activeTickets.filter(ticket => normalizeServicePriority(ticket.priority) === 'low').length,
  }), [activeTickets]);

  const filteredTickets = React.useMemo(() => {
    const query = normalizeSearch(search);
    const effectiveDateFrom = dateFrom || (
      datePreset === 'today'
        ? todayIso
        : datePreset === 'last7'
          ? last7StartIso
          : datePreset === 'month'
            ? monthStartIso
            : ''
    );
    const effectiveDateTo = dateTo || (datePreset === 'all' ? '' : todayIso);

    return ticketList
      .filter(ticket => {
        const matchesSearch = query === '' || getTicketSearchText(ticket).includes(query);
        const ticketPriority = normalizeServicePriority(ticket.priority);
        const ticketStatus = normalizeServiceStatus(ticket.status);
        const matchesPriority = priorityFilter === 'all' || ticketPriority === priorityFilter;
        const matchesStatus = statusFilter === 'all' || ticketStatus === statusFilter;
        const matchesScenario = scenarioFilter === 'all' || inferServiceKind(ticket) === scenarioFilter;
        const assignedMechanic = ticket.assignedMechanicName || ticket.assignedTo || '';
        const matchesMechanic = mechanicFilter === 'all' || assignedMechanic === mechanicFilter;
        const matchesWorkflow = workflowFilter === 'all' || getTicketWorkflowKind(ticket) === workflowFilter;
        const createdDate = typeof ticket.createdAt === 'string' ? ticket.createdAt.slice(0, 10) : '';
        const matchesDate =
          (!effectiveDateFrom || (createdDate && createdDate >= effectiveDateFrom))
          && (!effectiveDateTo || (createdDate && createdDate <= effectiveDateTo));
        const matchesPreset =
          preset === 'all'
          || (preset === 'unassigned' && !ticket.assignedMechanicId && !ticket.assignedTo)
          || (preset === 'urgent' && ['high', 'critical'].includes(ticketPriority))
          || (preset === 'waiting_parts' && ticketStatus === 'waiting_parts')
          || (preset === 'maintenance' && ['to', 'chto', 'pto'].includes(inferServiceKind(ticket)));

        return matchesSearch && matchesPriority && matchesStatus && matchesScenario && matchesMechanic && matchesWorkflow && matchesDate && matchesPreset;
      })
      .sort((left, right) => (
        (SERVICE_STATUS_ORDER[normalizeServiceStatus(left.status)] ?? 99) - (SERVICE_STATUS_ORDER[normalizeServiceStatus(right.status)] ?? 99)
        || (SERVICE_PRIORITY_ORDER[normalizeServicePriority(left.priority)] ?? 99) - (SERVICE_PRIORITY_ORDER[normalizeServicePriority(right.priority)] ?? 99)
        || String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
      ));
  }, [
    dateFrom,
    datePreset,
    dateTo,
    last7StartIso,
    mechanicFilter,
    monthStartIso,
    preset,
    priorityFilter,
    scenarioFilter,
    search,
    statusFilter,
    ticketList,
    todayIso,
    workflowFilter,
  ]);

  React.useEffect(() => {
    if (!import.meta.env.DEV || !isWarrantyMechanicRole(user?.role)) return;
    console.debug('[warranty-mechanic/service]', {
      rawRole: user?.rawRole ?? user?.role,
      normalizedRole: normalizeUserRole(user?.role),
      beforeFilters: ticketList.length,
      activeTickets: activeTickets.length,
      afterFilters: filteredTickets.length,
      filters: { search, priorityFilter, statusFilter, scenarioFilter, mechanicFilter, workflowFilter, preset, datePreset, dateFrom, dateTo },
      unassigned: ticketList.filter(ticket => !ticket.assignedMechanicId && !ticket.assignedTo).length,
    });
  }, [
    activeTickets.length,
    dateFrom,
    datePreset,
    dateTo,
    filteredTickets.length,
    mechanicFilter,
    preset,
    priorityFilter,
    scenarioFilter,
    search,
    statusFilter,
    ticketList,
    user?.rawRole,
    user?.role,
    workflowFilter,
  ]);

  React.useEffect(() => {
    setVisibleCount(RESULT_BATCH_SIZE);
  }, [search, priorityFilter, statusFilter, scenarioFilter, mechanicFilter, workflowFilter, preset, datePreset, dateFrom, dateTo]);

  const visibleTickets = filteredTickets.slice(0, visibleCount);

  const presetOptions = [
    { value: 'all', label: 'Все' },
    { value: 'unassigned', label: 'Без механика' },
    { value: 'urgent', label: 'Срочные' },
    { value: 'waiting_parts', label: 'Ждут запчасти' },
    { value: 'maintenance', label: 'ТО / ЧТО / ПТО' },
  ] as const;

  const datePresetOptions = [
    { value: 'all', label: 'Все даты' },
    { value: 'today', label: 'Сегодня' },
    { value: 'last7', label: '7 дней' },
    { value: 'month', label: 'Этот месяц' },
  ] as const;

  const resetFilters = () => {
    setSearch('');
    setPriorityFilter('all');
    setStatusFilter('all');
    setScenarioFilter('all');
    setMechanicFilter('all');
    setWorkflowFilter('all');
    setPreset('all');
    setDatePreset('all');
    setDateFrom('');
    setDateTo('');
  };

  const activeFilterCount = [
    search.trim() !== '',
    priorityFilter !== 'all',
    statusFilter !== 'all',
    scenarioFilter !== 'all',
    mechanicFilter !== 'all',
    workflowFilter !== 'all',
    preset !== 'all',
    datePreset !== 'all',
    dateFrom !== '',
    dateTo !== '',
  ].filter(Boolean).length;

  return (
    <div className="space-y-5 p-4 sm:p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Сервис</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Сервисные заявки и гарантийные рекламации</p>
        </div>
        {can('create', 'service') && (
          <Link to="/service/new">
            <Button size="sm">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Новая заявка</span>
              <span className="sm:hidden">Создать</span>
            </Button>
          </Link>
        )}
      </div>

      <FilterDialog
        open={showFilters}
        onOpenChange={setShowFilters}
        title="Фильтры сервиса"
        description="Отбери заявки по поиску, режиму, дате, приоритету, статусу, сценарию и механику."
        onReset={resetFilters}
      >
        <div className="space-y-5">
          <FilterField label="Быстрый режим">
            <div className="flex flex-wrap gap-2">
              {presetOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPreset(option.value)}
                  className="app-filter-chip"
                  data-active={String(preset === option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </FilterField>

          <FilterField label="Период">
            <div className="flex flex-wrap gap-2">
              {datePresetOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDatePreset(option.value)}
                  className="app-filter-chip"
                  data-active={String(datePreset === option.value)}
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
                  placeholder="Поиск по ID, технике, причине..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="app-filter-input pl-10"
                />
              </div>
            </FilterField>
            <FilterField label="Дата с">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="app-filter-input"
              />
            </FilterField>
            <FilterField label="Дата по">
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="app-filter-input"
              />
            </FilterField>
            <FilterField label="Приоритет">
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="app-filter-input">
                  <SelectValue placeholder="Все приоритеты" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все приоритеты</SelectItem>
                  <SelectItem value="low">Низкий</SelectItem>
                  <SelectItem value="medium">Средний</SelectItem>
                  <SelectItem value="high">Высокий</SelectItem>
                  <SelectItem value="critical">Критический</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Статус">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="app-filter-input">
                  <SelectValue placeholder="Все статусы" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все статусы</SelectItem>
                  <SelectItem value="new">Новый</SelectItem>
                  <SelectItem value="in_progress">В работе</SelectItem>
                  <SelectItem value="waiting_parts">Ожидание запчастей</SelectItem>
                  <SelectItem value="ready">Готово</SelectItem>
                  <SelectItem value="closed">Закрыто</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Сценарий">
              <Select value={scenarioFilter} onValueChange={setScenarioFilter}>
                <SelectTrigger className="app-filter-input">
                  <SelectValue placeholder="Все сценарии" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все сценарии</SelectItem>
                  <SelectItem value="repair">Ремонт</SelectItem>
                  <SelectItem value="to">ТО</SelectItem>
                  <SelectItem value="chto">ЧТО</SelectItem>
                  <SelectItem value="pto">ПТО</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Механик">
              <Select value={mechanicFilter} onValueChange={setMechanicFilter}>
                <SelectTrigger className="app-filter-input">
                  <SelectValue placeholder="Все механики" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все механики</SelectItem>
                  {mechanicOptions.map(mechanic => (
                    <SelectItem key={mechanic} value={mechanic}>
                      {mechanic}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </div>
      </FilterDialog>

      <Tabs defaultValue="tickets" className="space-y-5">
        <TabsList className="h-auto w-full justify-start gap-8 overflow-x-auto rounded-none border-b border-gray-200 bg-transparent p-0 dark:border-white/10">
          <TabsTrigger
            value="tickets"
            className="flex-none rounded-none border-0 border-b-4 border-transparent bg-transparent px-0 pb-4 pt-0 text-xl font-black text-gray-500 data-[state=active]:border-[--color-primary] data-[state=active]:bg-transparent data-[state=active]:text-[--color-primary] dark:data-[state=active]:bg-transparent"
          >
            Заявки
          </TabsTrigger>
          {canManageWarrantyClaims && (
            <TabsTrigger
              value="warranty"
              className="flex-none rounded-none border-0 border-b-4 border-transparent bg-transparent px-0 pb-4 pt-0 text-xl font-black text-gray-500 data-[state=active]:border-[--color-primary] data-[state=active]:bg-transparent data-[state=active]:text-[--color-primary] dark:data-[state=active]:bg-transparent"
            >
              Рекламации
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="tickets" className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ServiceMetricCard title="Всего заявок" value={metrics.total} caption="Активных сейчас" tone="lime" />
            <ServiceMetricCard title="Высокий приоритет" value={metrics.high} caption="Требуют внимания" tone="red" />
            <ServiceMetricCard title="Средний приоритет" value={metrics.medium} caption="SLA 24ч" tone="amber" />
            <ServiceMetricCard title="Низкий приоритет" value={metrics.low} caption="В очереди" tone="neutral" />
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2">
              {WORKFLOW_FILTER_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setWorkflowFilter(option.value)}
                  className={`inline-flex h-10 items-center rounded-full border px-4 text-sm font-bold transition-colors ${
                    workflowFilter === option.value
                      ? 'border-[--color-primary] bg-[--color-primary]/15 text-[--color-primary]'
                      : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-900 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-400 dark:hover:text-white'
                  }`}
                >
                  {option.label}
                  <span className="ml-2 text-xs opacity-70">{workflowCounts[option.value]}</span>
                </button>
              ))}
            </div>

            <FilterButton
              activeCount={activeFilterCount}
              onClick={() => setShowFilters(true)}
              className="h-12 rounded-lg px-5 text-base font-bold"
            />
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-white/[0.03]">
            {visibleTickets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 dark:bg-white/8">
                  <Search className="h-7 w-7 text-gray-400 dark:text-gray-500" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">Заявки не найдены</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Попробуйте изменить параметры поиска или фильтры
                </p>
              </div>
            ) : (
              visibleTickets.map((ticket, index) => {
                const inventory = getTicketInventory(ticket);
                const assignedMechanic = ticket.assignedMechanicName || ticket.assignedTo || '';
                const description = ticket.description ? truncateText(ticket.description, 95) : '';

                return (
                  <Link
                    key={ticket.id}
                    to={`/service/${ticket.id}`}
                    className={`grid min-h-[72px] gap-2 border-b border-gray-100 px-4 py-3 transition-colors last:border-b-0 hover:bg-[--color-primary]/8 dark:border-white/6 dark:hover:bg-white/[0.05] md:grid-cols-[minmax(150px,0.75fr)_minmax(210px,1fr)_minmax(280px,1.4fr)_minmax(180px,0.85fr)] md:items-center ${
                      index % 2 === 0 ? 'bg-gray-50/60 dark:bg-white/[0.015]' : 'bg-white dark:bg-transparent'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm text-gray-500 dark:text-gray-500">{ticket.id}</div>
                      <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">{formatTicketDate(ticket.createdAt)}</div>
                    </div>

                    <div className="min-w-0">
                      <div className="truncate text-base font-bold text-gray-900 dark:text-white">
                        {getTicketEquipmentTitle(ticket)}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-sm text-gray-500 dark:text-gray-500">
                        INV: {inventory}{ticket.serialNumber ? ` · SN ${ticket.serialNumber}` : ''}
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="truncate text-base font-bold text-gray-900 dark:text-white">{ticket.reason}</div>
                      {description && (
                        <div className="mt-0.5 truncate text-sm text-gray-500 dark:text-gray-500">{description}</div>
                      )}
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
                      {getServicePriorityBadge(normalizeServicePriority(ticket.priority))}
                      {getServiceStatusBadge(normalizeServiceStatus(ticket.status))}
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/8 dark:text-gray-300">
                        {getServiceScenarioLabel(ticket)}
                      </span>
                      {assignedMechanic && (
                        <span className="max-w-[160px] truncate rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-white/8 dark:text-gray-400">
                          {assignedMechanic}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })
            )}
          </div>

          {filteredTickets.length > 0 && (
            <div className="flex flex-col gap-3 text-sm text-gray-500 dark:text-gray-400 sm:flex-row sm:items-center sm:justify-between">
              <p>Показано {visibleTickets.length} из {filteredTickets.length} заявок</p>
              {visibleTickets.length < filteredTickets.length && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setVisibleCount(count => count + RESULT_BATCH_SIZE)}
                  className="w-full rounded-full sm:w-auto"
                >
                  <ArrowDown className="h-4 w-4" />
                  Показать ещё
                </Button>
              )}
            </div>
          )}
        </TabsContent>

        {canManageWarrantyClaims && (
          <TabsContent value="warranty">
            <WarrantyClaimsTab
              tickets={ticketList}
              canEdit={canManageWarrantyClaims}
              canDelete={can('delete', 'service')}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
