import React from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { getServiceStatusBadge, getServicePriorityBadge } from '../components/ui/badge';
import { Search, Plus } from 'lucide-react';
import { FilterButton, FilterDialog, FilterField } from '../components/ui/filter-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { WarrantyClaimsTab } from '../components/service/WarrantyClaimsTab';
import { Link } from 'react-router-dom';
import { usePermissions } from '../lib/permissions';
import { useServiceTicketsList } from '../hooks/useServiceTickets';
import { formatDate } from '../lib/utils';
import type { ServiceTicket } from '../types';
import { getServiceScenarioLabel, inferServiceKind } from '../lib/serviceScenarios';

function truncateText(value: string, maxLength: number) {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

export default function Service() {
  const { can } = usePermissions();
  const { data: ticketList = [] } = useServiceTicketsList();
  const canManageWarrantyClaims = can('edit', 'service');
  const [search, setSearch] = React.useState('');
  const [priorityFilter, setPriorityFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [scenarioFilter, setScenarioFilter] = React.useState<string>('all');
  const [mechanicFilter, setMechanicFilter] = React.useState<string>('all');
  const [preset, setPreset] = React.useState<'all' | 'unassigned' | 'urgent' | 'waiting_parts' | 'maintenance'>('all');
  const [datePreset, setDatePreset] = React.useState<'all' | 'today' | 'last7' | 'month'>('all');
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo, setDateTo] = React.useState('');
  const [showFilters, setShowFilters] = React.useState(false);

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

  const filteredTickets = ticketList.filter(ticket => {
    const matchesSearch = search === '' ||
      ticket.id.toLowerCase().includes(search.toLowerCase()) ||
      ticket.equipment.toLowerCase().includes(search.toLowerCase()) ||
      ticket.reason.toLowerCase().includes(search.toLowerCase());

    const matchesPriority = priorityFilter === 'all' || ticket.priority === priorityFilter;
    const matchesStatus = statusFilter === 'all' || ticket.status === statusFilter;
    const matchesScenario = scenarioFilter === 'all' || inferServiceKind(ticket) === scenarioFilter;
    const assignedMechanic = ticket.assignedMechanicName || ticket.assignedTo || '';
    const matchesMechanic = mechanicFilter === 'all' || assignedMechanic === mechanicFilter;
    const createdDate = typeof ticket.createdAt === 'string' ? ticket.createdAt.slice(0, 10) : '';
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
    const matchesDate =
      (!effectiveDateFrom || (createdDate && createdDate >= effectiveDateFrom))
      && (!effectiveDateTo || (createdDate && createdDate <= effectiveDateTo));
    const matchesPreset =
      preset === 'all'
      || (preset === 'unassigned' && !ticket.assignedMechanicId && !ticket.assignedTo)
      || (preset === 'urgent' && ['high', 'critical'].includes(ticket.priority))
      || (preset === 'waiting_parts' && ticket.status === 'waiting_parts')
      || (preset === 'maintenance' && ['to', 'chto', 'pto'].includes(inferServiceKind(ticket)));

    return matchesSearch && matchesPriority && matchesStatus && matchesScenario && matchesMechanic && matchesDate && matchesPreset;
  });

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
    preset !== 'all',
    datePreset !== 'all',
    dateFrom !== '',
    dateTo !== '',
  ].filter(Boolean).length;

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
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

      <Tabs defaultValue="tickets" className="space-y-4">
        <TabsList className="w-full justify-start overflow-x-auto rounded-lg bg-gray-100 p-1 dark:bg-gray-800 sm:w-fit">
          <TabsTrigger value="tickets" className="flex-none px-4">
            Заявки
          </TabsTrigger>
          {canManageWarrantyClaims && (
            <TabsTrigger value="warranty" className="flex-none px-4">
              Рекламации
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="tickets" className="space-y-4">
          <div className="flex justify-end">
            <FilterButton activeCount={activeFilterCount} onClick={() => setShowFilters(true)} />
          </div>

          {/* Mobile: card list */}
          <div className="sm:hidden space-y-3">
            {filteredTickets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                <Search className="h-8 w-8 text-gray-400 dark:text-gray-500 mb-3" />
                <h3 className="text-base font-medium text-gray-900 dark:text-white">Заявки не найдены</h3>
              </div>
            ) : filteredTickets.map((ticket) => (
              <Link
                key={ticket.id}
                to={`/service/${ticket.id}`}
                className="block rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[--color-primary] text-sm">{ticket.id}</span>
                      {getServiceStatusBadge(ticket.status)}
                      {getServicePriorityBadge(ticket.priority)}
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-200">
                        {getServiceScenarioLabel(ticket)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-200 mt-1 font-medium truncate">{ticket.equipment}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{ticket.reason}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <div><span className="font-medium text-gray-700 dark:text-gray-300">SLA:</span> {ticket.sla}</div>
                  {(ticket.assignedMechanicName || ticket.assignedTo) && <div><span className="font-medium text-gray-700 dark:text-gray-300">Назначен:</span> {ticket.assignedMechanicName || ticket.assignedTo}</div>}
                  <div><span className="font-medium text-gray-700 dark:text-gray-300">Автор:</span> {ticket.createdByUserName || ticket.createdBy || '—'}</div>
                  <div><span className="font-medium text-gray-700 dark:text-gray-300">Создана:</span> {formatDate(ticket.createdAt)}</div>
                </div>
              </Link>
            ))}
          </div>

          {/* Desktop: Table */}
          <div className="hidden sm:block rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID заявки</TableHead>
                  <TableHead>Техника</TableHead>
                  <TableHead>Причина</TableHead>
                  <TableHead>Сценарий</TableHead>
                  <TableHead>Приоритет</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Назначен</TableHead>
                  <TableHead>Автор</TableHead>
                  <TableHead>Дата создания</TableHead>
                  <TableHead>Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTickets.map((ticket) => (
                  <TableRow key={ticket.id}>
                    <TableCell>
                      <Link
                        to={`/service/${ticket.id}`}
                        className="font-medium text-[--color-primary] hover:underline"
                      >
                        {ticket.id}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{ticket.equipment}</p>
                    </TableCell>
                    <TableCell>
                      <p
                        className="max-w-[460px] truncate text-sm"
                        title={ticket.reason}
                      >
                        {truncateText(ticket.reason, 90)}
                      </p>
                      {ticket.description && (
                        <p
                          className="max-w-[460px] truncate text-xs text-gray-500 dark:text-gray-400"
                          title={ticket.description}
                        >
                          {truncateText(ticket.description, 110)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{getServiceScenarioLabel(ticket)}</p>
                    </TableCell>
                    <TableCell>
                      {getServicePriorityBadge(ticket.priority)}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{ticket.sla}</p>
                    </TableCell>
                    <TableCell>
                      {ticket.assignedMechanicName || ticket.assignedTo ? (
                        <p className="text-sm">{ticket.assignedMechanicName || ticket.assignedTo}</p>
                      ) : (
                        <span className="text-sm text-gray-400 dark:text-gray-500">Не назначен</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{ticket.createdByUserName || ticket.createdBy || '—'}</p>
                      {ticket.reporterContact && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">{ticket.reporterContact}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{formatDate(ticket.createdAt)}</p>
                    </TableCell>
                    <TableCell>
                      {getServiceStatusBadge(ticket.status)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {filteredTickets.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
                  <Search className="h-8 w-8 text-gray-400 dark:text-gray-500" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">Заявки не найдены</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Попробуйте изменить параметры поиска или фильтры
                </p>
              </div>
            )}
          </div>

          {/* Results info */}
          {filteredTickets.length > 0 && (
            <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
              <p>Показано {filteredTickets.length} из {ticketList.length} заявок</p>
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
