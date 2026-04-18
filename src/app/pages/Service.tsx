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
import { Link } from 'react-router-dom';
import { usePermissions } from '../lib/permissions';
import { useServiceTicketsList } from '../hooks/useServiceTickets';
import { formatDate } from '../lib/utils';
import type { ServiceTicket } from '../types';
import { getServiceScenarioLabel, inferServiceKind } from '../lib/serviceScenarios';

export default function Service() {
  const { can } = usePermissions();
  const { data: ticketList = [] } = useServiceTicketsList();
  const [search, setSearch] = React.useState('');
  const [priorityFilter, setPriorityFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [scenarioFilter, setScenarioFilter] = React.useState<string>('all');
  const [preset, setPreset] = React.useState<'all' | 'unassigned' | 'urgent' | 'waiting_parts' | 'maintenance'>('all');

  const filteredTickets = ticketList.filter(ticket => {
    const matchesSearch = search === '' ||
      ticket.id.toLowerCase().includes(search.toLowerCase()) ||
      ticket.equipment.toLowerCase().includes(search.toLowerCase()) ||
      ticket.reason.toLowerCase().includes(search.toLowerCase());

    const matchesPriority = priorityFilter === 'all' || ticket.priority === priorityFilter;
    const matchesStatus = statusFilter === 'all' || ticket.status === statusFilter;
    const matchesScenario = scenarioFilter === 'all' || inferServiceKind(ticket) === scenarioFilter;
    const matchesPreset =
      preset === 'all'
      || (preset === 'unassigned' && !ticket.assignedMechanicId && !ticket.assignedTo)
      || (preset === 'urgent' && ['high', 'critical'].includes(ticket.priority))
      || (preset === 'waiting_parts' && ticket.status === 'waiting_parts')
      || (preset === 'maintenance' && ['to', 'chto', 'pto'].includes(inferServiceKind(ticket)));

    return matchesSearch && matchesPriority && matchesStatus && matchesScenario && matchesPreset;
  });

  const presetOptions = [
    { value: 'all', label: 'Все' },
    { value: 'unassigned', label: 'Без механика' },
    { value: 'urgent', label: 'Срочные' },
    { value: 'waiting_parts', label: 'Ждут запчасти' },
    { value: 'maintenance', label: 'ТО / ЧТО / ПТО' },
  ] as const;

  const resetFilters = () => {
    setSearch('');
    setPriorityFilter('all');
    setStatusFilter('all');
    setScenarioFilter('all');
    setPreset('all');
  };

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Сервис</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Управление сервисными заявками</p>
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

      <div className="flex flex-wrap items-center gap-2">
        {presetOptions.map(option => (
          <button
            key={option.value}
            type="button"
            onClick={() => setPreset(option.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              preset === option.value
                ? 'bg-[--color-primary] text-white'
                : 'border border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-600 dark:hover:text-blue-300'
            }`}
          >
            {option.label}
          </button>
        ))}
        {(search || priorityFilter !== 'all' || statusFilter !== 'all' || scenarioFilter !== 'all' || preset !== 'all') && (
          <button
            type="button"
            onClick={resetFilters}
            className="rounded-full border border-transparent px-3 py-1.5 text-xs font-medium text-red-500 hover:border-red-200 hover:bg-red-50 dark:hover:border-red-900/50 dark:hover:bg-red-950/20"
          >
            Сбросить фильтры
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 sm:gap-4 sm:p-4">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <Input
              placeholder="Поиск по ID, технике, причине..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[180px]">
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
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]">
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
        <Select value={scenarioFilter} onValueChange={setScenarioFilter}>
          <SelectTrigger className="w-[180px]">
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
                  <p className="text-sm">{ticket.reason}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">{ticket.description}</p>
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
    </div>
  );
}
