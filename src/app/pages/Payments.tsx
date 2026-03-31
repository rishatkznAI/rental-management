import React from 'react';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { getPaymentStatusBadge } from '../components/ui/Badge';
import { Search } from 'lucide-react';
import { loadPayments, PAYMENTS_STORAGE_KEY } from '../mock-data';
import { formatDate, formatCurrency } from '../lib/utils';
import type { Payment } from '../types';

export default function Payments() {
  const [paymentList, setPaymentList] = React.useState<Payment[]>(() => loadPayments());
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');

  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === PAYMENTS_STORAGE_KEY) setPaymentList(loadPayments()); };
    const onFocus = () => setPaymentList(loadPayments());
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('focus', onFocus); };
  }, []);

  const filteredPayments = paymentList.filter(payment => {
    const matchesSearch = search === '' || 
      payment.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
      payment.client.toLowerCase().includes(search.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || payment.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Платежи</h1>
          <p className="mt-1 text-sm text-gray-500">Управление платежами и задолженностями</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Поиск по счёту, клиенту..."
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
            { value: 'pending', label: 'Ожидание' },
            { value: 'paid', label: 'Оплачено' },
            { value: 'overdue', label: 'Просрочено' },
          ]}
          className="w-[180px]"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Счёт</TableHead>
              <TableHead>Клиент</TableHead>
              <TableHead>Сумма</TableHead>
              <TableHead>Срок оплаты</TableHead>
              <TableHead>Дата оплаты</TableHead>
              <TableHead>Статус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPayments.map((payment) => (
              <TableRow 
                key={payment.id}
                className={payment.status === 'overdue' ? 'bg-red-50' : ''}
              >
                <TableCell>
                  <p className="font-medium text-gray-900">{payment.invoiceNumber}</p>
                </TableCell>
                <TableCell>
                  <p className="text-sm">{payment.client}</p>
                </TableCell>
                <TableCell>
                  <p className="font-semibold">{formatCurrency(payment.amount)}</p>
                </TableCell>
                <TableCell>
                  <p className="text-sm">{formatDate(payment.dueDate)}</p>
                </TableCell>
                <TableCell>
                  {payment.paidDate ? (
                    <p className="text-sm">{formatDate(payment.paidDate)}</p>
                  ) : (
                    <span className="text-sm text-gray-400">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {getPaymentStatusBadge(payment.status)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filteredPayments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <Search className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">Платежи не найдены</h3>
            <p className="mt-1 text-sm text-gray-500">
              Попробуйте изменить параметры поиска или фильтры
            </p>
          </div>
        )}
      </div>

      {/* Summary */}
      {filteredPayments.length > 0 && (
        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <p className="text-sm text-gray-500">Всего к оплате</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {formatCurrency(
                filteredPayments
                  .filter(p => p.status === 'pending')
                  .reduce((sum, p) => sum + p.amount, 0)
              )}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <p className="text-sm text-gray-500">Оплачено</p>
            <p className="mt-1 text-2xl font-bold text-green-600">
              {formatCurrency(
                filteredPayments
                  .filter(p => p.status === 'paid')
                  .reduce((sum, p) => sum + p.amount, 0)
              )}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <p className="text-sm text-gray-500">Просрочено</p>
            <p className="mt-1 text-2xl font-bold text-red-600">
              {formatCurrency(
                filteredPayments
                  .filter(p => p.status === 'overdue')
                  .reduce((sum, p) => sum + p.amount, 0)
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
