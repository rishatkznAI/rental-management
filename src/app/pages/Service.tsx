import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
import { buildServiceQueue } from '../lib/serviceQueue';
import { equipmentService } from '../services/equipment.service';
import { rentalsService } from '../services/rentals.service';
import { clientsService } from '../services/clients.service';

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

function apiErrorMessage(error: unknown, fallback: string) {
  if (!error) return fallback;
  const status = typeof error === 'object' && error && 'status' in error ? `HTTP ${(error as { status?: number }).status}` : '';
  const message = error instanceof Error ? error.message : fallback;
  return [status, message].filter(Boolean).join(': ');
}

function serviceFilterReasons(
  ticket: ServiceTicket,
  filters: {
    search: string;
    priorityFilter: string;
    statusFilter: string;
    scenarioFilter: string;
    mechanicFilter: string;
    workflowFilter: ServiceWorkflowFilter;
    preset: 'all' | 'unassigned' | 'urgent' | 'waiting_parts' | 'maintenance';
    effectiveDateFrom: string;
    effectiveDateTo: string;
  },
) {
  const reasons: string[] = [];
  const query = normalizeSearch(filters.search);
  const ticketPriority = normalizeServicePriority(ticket.priority);
  const ticketStatus = normalizeServiceStatus(ticket.status);
  const assignedMechanic = ticket.assignedMechanicName || ticket.assignedTo || '';
  const createdDate = typeof ticket.createdAt === 'string' ? ticket.createdAt.slice(0, 10) : '';
  if (query && !getTicketSearchText(ticket).includes(query)) reasons.push('search');
  if (filters.priorityFilter !== 'all' && ticketPriority !== filters.priorityFilter) reasons.push('priority');
  if (filters.statusFilter !== 'all' && ticketStatus !== filters.statusFilter) reasons.push('status');
  if (filters.scenarioFilter !== 'all' && inferServiceKind(ticket) !== filters.scenarioFilter) reasons.push('scenario');
  if (filters.mechanicFilter !== 'all' && assignedMechanic !== filters.mechanicFilter) reasons.push('mechanic');
  if (filters.workflowFilter !== 'all' && getTicketWorkflowKind(ticket) !== filters.workflowFilter) reasons.push('workflow');
  if (filters.effectiveDateFrom && (!createdDate || createdDate < filters.effectiveDateFrom)) reasons.push('dateFrom');
  if (filters.effectiveDateTo && (!createdDate || createdDate > filters.effectiveDateTo)) reasons.push('dateTo');
  const matchesPreset =
    filters.preset === 'all'
    || (filters.preset === 'unassigned' && !ticket.assignedMechanicId && !ticket.assignedTo)
    || (filters.preset === 'urgent' && ['high', 'critical'].includes(ticketPriority))
    || (filters.preset === 'waiting_parts' && ticketStatus === 'waiting_parts')
    || (filters.preset === 'maintenance' && ['to', 'chto', 'pto'].includes(inferServiceKind(ticket)));
  if (!matchesPreset) reasons.push(`preset:${filters.preset}`);
  return reasons;
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

function equipmentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    available: 'Свободна',
    rented: 'В аренде',
    reserved: 'Бронь',
    in_service: 'В сервисе',
    inactive: 'Списана',
    unknown: 'Нет данных',
  };
  return labels[status] || status || 'Нет данных';
}

function serviceQueueGroupTone(group: string) {
  if (group === 'critical') return 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-200';
  if (group === 'high') return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200';
  if (group === 'waiting_parts') return 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-200';
  if (group === 'unassigned') return 'border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-200';
  if (group === 'long_running') return 'border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-200';
  return 'border-gray-200 bg-gray-50 text-gray-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300';
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

function ServiceQueueTab({
  queue,
  mechanicOptions,
  canViewFinance,
  canViewRentals,
  canViewEquipment,
  canViewClients,
}: {
  queue: ReturnType<typeof buildServiceQueue>;
  mechanicOptions: string[];
  canViewFinance: boolean;
  canViewRentals: boolean;
  canViewEquipment: boolean;
  canViewClients: boolean;
}) {
  const [search, setSearch] = React.useState('');
  const [priorityFilter, setPriorityFilter] = React.useState('all');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [mechanicFilter, setMechanicFilter] = React.useState('all');
  const [typeFilter, setTypeFilter] = React.useState('all');
  const [flagFilter, setFlagFilter] = React.useState('all');

  const equipmentTypes = React.useMemo(() => (
    Array.from(new Set(queue.rows.map(item => item.equipmentType).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'ru'))
  ), [queue.rows]);

  const filteredRows = React.useMemo(() => {
    const query = normalizeSearch(search);
    return queue.rows.filter(item => {
      const searchText = normalizeSearch([
        item.ticketId,
        item.equipmentTitle,
        item.model,
        item.serialNumber,
        item.inventoryNumber,
        item.reason,
        item.description,
        item.mechanic,
        item.currentRental?.client,
        item.nextRental?.client,
      ].filter(Boolean).join(' '));
      if (query && !searchText.includes(query)) return false;
      if (priorityFilter !== 'all' && item.ticketPriority !== priorityFilter) return false;
      if (statusFilter !== 'all' && item.ticketStatus !== statusFilter) return false;
      if (mechanicFilter !== 'all' && item.mechanic !== mechanicFilter) return false;
      if (typeFilter !== 'all' && item.equipmentType !== typeFilter) return false;
      if (flagFilter === 'waiting_parts' && !item.waitingParts) return false;
      if (flagFilter === 'unassigned' && !item.unassigned) return false;
      if (flagFilter === 'old' && item.ageDays < 7) return false;
      return true;
    });
  }, [flagFilter, mechanicFilter, priorityFilter, queue.rows, search, statusFilter, typeFilter]);

  const groupedRows = React.useMemo(() => (
    queue.groups
      .map(group => ({
        ...group,
        items: filteredRows.filter(item => item.group === group.key),
      }))
      .filter(group => group.items.length > 0)
  ), [filteredRows, queue.groups]);

  const formatRisk = (amount: number) => new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(amount);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <ServiceMetricCard title="Открыто" value={queue.metrics.totalOpen} caption="В очереди" tone="lime" />
        <ServiceMetricCard title="Критично" value={queue.metrics.critical} caption="Первый фокус" tone="red" />
        <ServiceMetricCard title="Без механика" value={queue.metrics.unassigned} caption="Нужно назначить" tone="amber" />
        <ServiceMetricCard title="Запчасти" value={queue.metrics.waitingParts} caption="Блокер ремонта" tone="neutral" />
        <ServiceMetricCard title="В сервисе" value={queue.metrics.equipmentInService} caption="Статус техники" tone="neutral" />
        <ServiceMetricCard title="Средний возраст" value={queue.metrics.averageAgeDays} caption="Дней" tone="neutral" />
        <ServiceMetricCard title="7+ дней" value={queue.metrics.olderThan7Days} caption="Долго в работе" tone="amber" />
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.4fr)_repeat(5,minmax(140px,1fr))]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Модель, SN, INV, клиент..."
              className="pl-10"
            />
          </div>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger><SelectValue placeholder="Приоритет" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все приоритеты</SelectItem>
              <SelectItem value="critical">Критический</SelectItem>
              <SelectItem value="high">Высокий</SelectItem>
              <SelectItem value="medium">Средний</SelectItem>
              <SelectItem value="low">Низкий</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue placeholder="Статус" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="new">Новая</SelectItem>
              <SelectItem value="in_progress">В работе</SelectItem>
              <SelectItem value="waiting_parts">Ожидание запчастей</SelectItem>
              <SelectItem value="ready">Готово</SelectItem>
            </SelectContent>
          </Select>
          <Select value={mechanicFilter} onValueChange={setMechanicFilter}>
            <SelectTrigger><SelectValue placeholder="Механик" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все механики</SelectItem>
              <SelectItem value="Не назначен">Не назначен</SelectItem>
              {mechanicOptions.map(mechanic => (
                <SelectItem key={mechanic} value={mechanic}>{mechanic}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger><SelectValue placeholder="Тип" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все типы</SelectItem>
              {equipmentTypes.map(type => (
                <SelectItem key={type} value={type}>{type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={flagFilter} onValueChange={setFlagFilter}>
            <SelectTrigger><SelectValue placeholder="Флаги" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все флаги</SelectItem>
              <SelectItem value="waiting_parts">Ждут запчасти</SelectItem>
              <SelectItem value="unassigned">Без механика</SelectItem>
              <SelectItem value="old">7+ дней</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      {filteredRows.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white py-14 text-center dark:border-white/10 dark:bg-white/[0.03]">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">Открытых сервисных задач нет</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Или текущие фильтры скрыли все позиции очереди.</p>
        </div>
      ) : (
        groupedRows.map(group => (
          <section key={group.key} className="space-y-3">
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-bold ${serviceQueueGroupTone(group.key)}`}>
              {group.label}
              <span className="text-xs opacity-70">{group.items.length}</span>
            </div>
            <div className="grid gap-3">
              {group.items.map(item => (
                <article key={item.ticketId} className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-xs font-semibold text-gray-600 dark:bg-white/8 dark:text-gray-300">
                          score {item.score}
                        </span>
                        {getServicePriorityBadge(item.ticketPriority)}
                        {getServiceStatusBadge(item.ticketStatus)}
                        {item.waitingParts && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-200">Запчасти</span>}
                      </div>
                      <h3 className="mt-3 truncate text-lg font-black text-gray-900 dark:text-white">{item.equipmentTitle}</h3>
                      <p className="mt-1 truncate font-mono text-sm text-gray-500 dark:text-gray-400">
                        INV: {item.inventoryNumber || '—'} · SN: {item.serialNumber || '—'} · {equipmentStatusLabel(item.equipmentStatus)}
                      </p>
                      <p className="mt-3 text-sm font-semibold text-gray-900 dark:text-white">{item.reason}</p>
                      {item.description && <p className="mt-1 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">{item.description}</p>}
                    </div>

                    <div className="grid gap-2 text-sm text-gray-600 dark:text-gray-300 lg:min-w-[280px]">
                      <div>Создана: <span className="font-semibold">{item.createdAt ? formatDate(item.createdAt) : '—'}</span> · {item.ageDays} дн.</div>
                      <div>Механик: <span className="font-semibold">{item.mechanic}</span></div>
                      {canViewRentals && item.currentRental && (
                        <div>Аренда сейчас: <span className="font-semibold">{canViewClients ? item.currentRental.client : 'Клиент скрыт'}</span></div>
                      )}
                      {canViewRentals && item.nextRental && (
                        <div>Ближайшая аренда: <span className="font-semibold">{item.nextRental.startDate ? formatDate(item.nextRental.startDate) : '—'}</span></div>
                      )}
                      {canViewFinance && item.revenueRisk && (
                        <div>{item.revenueRisk.label}: <span className="font-semibold">{formatRisk(item.revenueRisk.amount)}</span></div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-3 dark:border-white/10 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap gap-2">
                      {(item.scoreReasons.length ? item.scoreReasons : ['без дополнительных факторов']).map(reason => (
                        <span key={reason} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/8 dark:text-gray-300">
                          {reason}
                        </span>
                      ))}
                      {item.redFlags.map(flag => (
                        <span key={flag} className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/15 dark:text-red-200">
                          {flag}
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link to={`/service/${item.ticketId}`}>
                        <Button size="sm" variant="secondary">Открыть заявку</Button>
                      </Link>
                      {canViewEquipment && item.equipmentId && (
                        <Link to={`/equipment/${item.equipmentId}`}>
                          <Button size="sm" variant="outline">Открыть технику</Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

export default function Service() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const ticketsQuery = useServiceTicketsList();
  const ticketList = ticketsQuery.data ?? [];
  const canManageWarrantyClaims = can('edit', 'service');
  const canViewEquipment = can('view', 'equipment');
  const canViewRentals = can('view', 'rentals');
  const canViewClients = can('view', 'clients');
  const canViewFinance = can('view', 'finance');
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

  const { data: equipmentList = [] } = useQuery({
    queryKey: ['equipment', 'service-queue'],
    queryFn: equipmentService.getAll,
    enabled: canViewEquipment,
    staleTime: 1000 * 60 * 2,
  });
  const { data: ganttRentals = [] } = useQuery({
    queryKey: ['ganttRentals', 'service-queue'],
    queryFn: rentalsService.getGanttData,
    enabled: canViewRentals,
    staleTime: 1000 * 60 * 2,
  });
  const { data: clients = [] } = useQuery({
    queryKey: ['clients', 'service-queue'],
    queryFn: clientsService.getAll,
    enabled: canViewClients,
    staleTime: 1000 * 60 * 2,
  });

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

  const serviceQueue = React.useMemo(() => buildServiceQueue({
    serviceTickets: ticketList,
    equipment: canViewEquipment ? equipmentList : [],
    rentals: canViewRentals ? ganttRentals : [],
    clients: canViewClients ? clients : [],
    canViewFinance,
  }), [canViewClients, canViewEquipment, canViewFinance, canViewRentals, clients, equipmentList, ganttRentals, ticketList]);

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

      {ticketsQuery.error && (
        <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-100">
          <div className="font-semibold">Не удалось загрузить сервисные заявки. Попробуйте обновить страницу или обратитесь к администратору.</div>
          <div className="mt-1 text-red-700/80 dark:text-red-100/80">
            {apiErrorMessage(ticketsQuery.error, 'Проверьте доступ к GET /api/service.')}
          </div>
          {isWarrantyMechanicRole(user?.role) && (
            <div className="mt-2 text-red-700/80 dark:text-red-100/80">
              Для диагностики под этим пользователем откройте в Network `GET /api/access-diagnostics`.
            </div>
          )}
        </section>
      )}

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
          <TabsTrigger
            value="queue"
            className="flex-none rounded-none border-0 border-b-4 border-transparent bg-transparent px-0 pb-4 pt-0 text-xl font-black text-gray-500 data-[state=active]:border-[--color-primary] data-[state=active]:bg-transparent data-[state=active]:text-[--color-primary] dark:data-[state=active]:bg-transparent"
          >
            Очередь сервиса
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

        <TabsContent value="queue" className="space-y-5">
          <ServiceQueueTab
            queue={serviceQueue}
            mechanicOptions={mechanicOptions}
            canViewFinance={canViewFinance}
            canViewRentals={canViewRentals}
            canViewEquipment={canViewEquipment}
            canViewClients={canViewClients}
          />
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
