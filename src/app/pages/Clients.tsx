import React from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Search, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { usePermissions } from '../lib/permissions';
import { useClientsList } from '../hooks/useClients';
import { useGanttData } from '../hooks/useRentals';
import { usePaymentsList } from '../hooks/usePayments';
import { formatCurrency, formatDate } from '../lib/utils';
import type { Client } from '../types';
import { mergeClientsWithFinancials } from '../lib/finance';

export default function Clients() {
  const { can } = usePermissions();
  const { data: clientList = [] } = useClientsList();
  const { data: ganttRentals = [] } = useGanttData();
  const { data: payments = [] } = usePaymentsList();
  const [search, setSearch] = React.useState('');

  const computedClients = React.useMemo(
    () => mergeClientsWithFinancials(clientList, ganttRentals, payments),
    [clientList, ganttRentals, payments],
  );

  const filteredClients = computedClients.filter(client => {
    const matchesSearch = search === '' ||
      client.company.toLowerCase().includes(search.toLowerCase()) ||
      client.inn.includes(search) ||
      client.contact.toLowerCase().includes(search.toLowerCase());

    return matchesSearch;
  });

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Клиенты</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">База клиентов и контрагентов</p>
        </div>
        {can('create', 'clients') && (
          <Link to="/clients/new">
            <Button size="sm">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Новый клиент</span>
              <span className="sm:hidden">Добавить</span>
            </Button>
          </Link>
        )}
      </div>

      {/* Search */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <Input
            placeholder="Поиск по названию, ИНН, контакту..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Mobile: card list */}
      <div className="sm:hidden space-y-3">
        {filteredClients.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <Search className="h-8 w-8 text-gray-400 dark:text-gray-500 mb-3" />
            <h3 className="text-base font-medium text-gray-900 dark:text-white">Клиенты не найдены</h3>
          </div>
        ) : filteredClients.map((client) => (
          <Link
            key={client.id}
            to={`/clients/${client.id}`}
            className="block rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 dark:text-white text-sm truncate">{client.company}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">{client.inn}</p>
              </div>
              {client.debt > 0 && (
                <Badge variant="error" className="shrink-0 text-xs">{formatCurrency(client.debt)}</Badge>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
              <div><span className="font-medium text-gray-700 dark:text-gray-300">Контакт:</span> {client.contact}</div>
              <div><span className="font-medium text-gray-700 dark:text-gray-300">Телефон:</span> {client.phone}</div>
              <div><span className="font-medium text-gray-700 dark:text-gray-300">Оплата:</span> {client.paymentTerms}</div>
              <div><span className="font-medium text-gray-700 dark:text-gray-300">Аренд:</span> {client.totalRentals}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* Desktop: Table */}
      <div className="hidden sm:block rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Компания</TableHead>
              <TableHead>ИНН</TableHead>
              <TableHead>Контакт</TableHead>
              <TableHead>Условия оплаты</TableHead>
              <TableHead>Задолженность</TableHead>
              <TableHead>Последняя аренда</TableHead>
              <TableHead>Всего аренд</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredClients.map((client) => (
              <TableRow key={client.id}>
                <TableCell>
                  <Link
                    to={`/clients/${client.id}`}
                    className="font-medium text-[--color-primary] hover:underline"
                  >
                    {client.company}
                  </Link>
                </TableCell>
                <TableCell>
                  <p className="text-sm font-mono">{client.inn}</p>
                </TableCell>
                <TableCell>
                  <p className="text-sm">{client.contact}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{client.phone}</p>
                </TableCell>
                <TableCell>
                  <p className="text-sm">{client.paymentTerms}</p>
                </TableCell>
                <TableCell>
                  {client.debt > 0 ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="error">{formatCurrency(client.debt)}</Badge>
                    </div>
                  ) : (
                    <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {client.lastRentalDate ? (
                    <p className="text-sm">{formatDate(client.lastRentalDate)}</p>
                  ) : (
                    <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <p className="text-sm">{client.totalRentals}</p>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filteredClients.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
              <Search className="h-8 w-8 text-gray-400 dark:text-gray-500" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Клиенты не найдены</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Попробуйте изменить параметры поиска
            </p>
          </div>
        )}
      </div>

      {/* Results info */}
      {filteredClients.length > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <p>Показано {filteredClients.length} из {computedClients.length} клиентов</p>
        </div>
      )}
    </div>
  );
}
