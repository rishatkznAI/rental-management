import React from 'react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { Search, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { loadClients, CLIENTS_STORAGE_KEY } from '../mock-data';
import { formatCurrency, formatDate } from '../lib/utils';
import type { Client } from '../types';

export default function Clients() {
  const [clientList, setClientList] = React.useState<Client[]>(() => loadClients());
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === CLIENTS_STORAGE_KEY) setClientList(loadClients()); };
    const onFocus = () => setClientList(loadClients());
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('focus', onFocus); };
  }, []);

  const filteredClients = clientList.filter(client => {
    const matchesSearch = search === '' || 
      client.company.toLowerCase().includes(search.toLowerCase()) ||
      client.inn.includes(search) ||
      client.contact.toLowerCase().includes(search.toLowerCase());

    return matchesSearch;
  });

  return (
    <div className="space-y-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Клиенты</h1>
          <p className="mt-1 text-sm text-gray-500">База клиентов и контрагентов</p>
        </div>
        <Link to="/clients/new">
          <Button>
            <Plus className="h-4 w-4" />
            Новый клиент
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Поиск по названию, ИНН, контакту..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white">
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
                  <p className="text-xs text-gray-500">{client.phone}</p>
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
                    <span className="text-sm text-gray-400">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {client.lastRentalDate ? (
                    <p className="text-sm">{formatDate(client.lastRentalDate)}</p>
                  ) : (
                    <span className="text-sm text-gray-400">—</span>
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
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <Search className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">Клиенты не найдены</h3>
            <p className="mt-1 text-sm text-gray-500">
              Попробуйте изменить параметры поиска
            </p>
          </div>
        )}
      </div>

      {/* Results info */}
      {filteredClients.length > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <p>Показано {filteredClients.length} из {clientList.length} клиентов</p>
        </div>
      )}
    </div>
  );
}
