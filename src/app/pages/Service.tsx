import React from 'react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { getServiceStatusBadge, getServicePriorityBadge } from '../components/ui/Badge';
import { Search, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { loadServiceTickets, SERVICE_STORAGE_KEY } from '../mock-data';
import { formatDate } from '../lib/utils';
import type { ServiceTicket } from '../types';

export default function Service() {
  const [ticketList, setTicketList] = React.useState<ServiceTicket[]>(() => loadServiceTickets());
  const [search, setSearch] = React.useState('');
  const [priorityFilter, setPriorityFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');

  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === SERVICE_STORAGE_KEY) setTicketList(loadServiceTickets()); };
    const onFocus = () => setTicketList(loadServiceTickets());
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('focus', onFocus); };
  }, []);

  const filteredTickets = ticketList.filter(ticket => {
    const matchesSearch = search === '' || 
      ticket.id.toLowerCase().includes(search.toLowerCase()) ||
      ticket.equipment.toLowerCase().includes(search.toLowerCase()) ||
      ticket.reason.toLowerCase().includes(search.toLowerCase());
    
    const matchesPriority = priorityFilter === 'all' || ticket.priority === priorityFilter;
    const matchesStatus = statusFilter === 'all' || ticket.status === statusFilter;

    return matchesSearch && matchesPriority && matchesStatus;
  });

  return (
    <div className="space-y-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Сервис</h1>
          <p className="mt-1 text-sm text-gray-500">Управление сервисными заявками</p>
        </div>
        <Link to="/service/new">
          <Button>
            <Plus className="h-4 w-4" />
            Новая заявка
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Поиск по ID, технике, причине..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <Select
          value={priorityFilter}
          onValueChange={setPriorityFilter}
          placeholder="Все приоритеты"
          options={[
            { value: 'all', label: 'Все приоритеты' },
            { value: 'low', label: 'Низкий' },
            { value: 'medium', label: 'Средний' },
            { value: 'high', label: 'Высокий' },
            { value: 'critical', label: 'Критический' },
          ]}
          className="w-[180px]"
        />
        <Select
          value={statusFilter}
          onValueChange={setStatusFilter}
          placeholder="Все статусы"
          options={[
            { value: 'all', label: 'Все статусы' },
            { value: 'new', label: 'Новый' },
            { value: 'in_progress', label: 'В работе' },
            { value: 'waiting_parts', label: 'Ожидание запчастей' },
            { value: 'ready', label: 'Готово' },
            { value: 'closed', label: 'Закрыто' },
          ]}
          className="w-[200px]"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID заявки</TableHead>
              <TableHead>Техника</TableHead>
              <TableHead>Причина</TableHead>
              <TableHead>Приоритет</TableHead>
              <TableHead>SLA</TableHead>
              <TableHead>Назначен</TableHead>
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
                  <p className="text-xs text-gray-500 line-clamp-1">{ticket.description}</p>
                </TableCell>
                <TableCell>
                  {getServicePriorityBadge(ticket.priority)}
                </TableCell>
                <TableCell>
                  <p className="text-sm">{ticket.sla}</p>
                </TableCell>
                <TableCell>
                  {ticket.assignedTo ? (
                    <p className="text-sm">{ticket.assignedTo}</p>
                  ) : (
                    <span className="text-sm text-gray-400">Не назначен</span>
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
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <Search className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">Заявки не найдены</h3>
            <p className="mt-1 text-sm text-gray-500">
              Попробуйте изменить параметры поиска или фильтры
            </p>
          </div>
        )}
      </div>

      {/* Results info */}
      {filteredTickets.length > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <p>Показано {filteredTickets.length} из {ticketList.length} заявок</p>
        </div>
      )}
    </div>
  );
}
