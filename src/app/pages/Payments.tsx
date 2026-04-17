import React, { useState, useMemo } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { getPaymentStatusBadge } from '../components/ui/badge';
import { Search, Plus, X, DollarSign, AlertTriangle, CheckCircle, Clock, TrendingDown } from 'lucide-react';
import { usePermissions } from '../lib/permissions';
import { usePaymentsList, useCreatePayment } from '../hooks/usePayments';
import { useClientsList } from '../hooks/useClients';
import { useGanttData } from '../hooks/useRentals';
import type { GanttRentalData } from '../mock-data';
import { formatDate, formatCurrency } from '../lib/utils';
import type { Payment, PaymentStatus, Client } from '../types';
import { buildClientReceivables, buildRentalDebtRows } from '../lib/finance';

// ─── helpers ─────────────────────────────────────────────────────────────────

function genId() { return `pay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function genInvoice(payments: Payment[]) {
  const n = payments.length + 1;
  return `СЧ-${String(n).padStart(4, '0')}`;
}
function today() { return new Date().toISOString().slice(0, 10); }

// ─── AddPaymentModal ─────────────────────────────────────────────────────────

interface AddPaymentModalProps {
  onClose: () => void;
  onSave: (p: Payment) => void;
  existing: Payment[];
  rentals: GanttRentalData[];
  clients: Client[];
  allPayments: Payment[];
}

function AddPaymentModal({ onClose, onSave, existing, rentals, clients, allPayments }: AddPaymentModalProps) {
  const [form, setForm] = useState({
    rentalId: '',
    client: '',
    amount: '',
    paidAmount: '',
    dueDate: today(),
    paidDate: today(),
    status: 'paid' as PaymentStatus,
    comment: '',
  });

  const set = (k: string, v: string) => {
    setForm(f => {
      const next = { ...f, [k]: v };
      // auto-fill client from rental
      if (k === 'rentalId') {
        const r = rentals.find(r => r.id === v);
        if (r) next.client = r.client;
      }
      return next;
    });
  };

  // Compute current client debt (excluding payments being created right now)
  const clientDebt = useMemo(() => {
    if (!form.client) return null;
    const debtRows = buildRentalDebtRows(rentals, allPayments);
    const receivables = buildClientReceivables(clients, debtRows);
    return receivables.find(r => r.client === form.client) ?? null;
  }, [form.client, rentals, allPayments, clients]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(form.amount) || 0;
    const paid = Number(form.paidAmount) || amt;
    const newPayment: Payment = {
      id: genId(),
      invoiceNumber: genInvoice(existing),
      rentalId: form.rentalId || undefined,
      client: form.client,
      amount: amt,
      paidAmount: paid,
      dueDate: form.dueDate,
      paidDate: form.status === 'paid' || form.status === 'partial' ? form.paidDate : undefined,
      status: form.status,
      comment: form.comment || undefined,
    };
    onSave(newPayment);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Добавить платёж</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Rental link */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Аренда (необязательно)
            </label>
            <select
              value={form.rentalId}
              onChange={e => set('rentalId', e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              <option value="">— Выбрать аренду —</option>
              {rentals.map(r => (
                <option key={r.id} value={r.id}>
                  {r.id} · {r.client} · {r.equipmentInv}
                </option>
              ))}
            </select>
          </div>

          {/* Client */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Клиент <span className="text-red-500">*</span>
            </label>
            <Input
              required
              placeholder="Название клиента"
              value={form.client}
              onChange={e => set('client', e.target.value)}
            />
            {/* Debt banner */}
            {clientDebt && clientDebt.currentDebt > 0 && (
              <div className={`mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
                clientDebt.exceededLimit
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  : clientDebt.overdueRentals > 0
                  ? 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                  : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
              }`}>
                {clientDebt.exceededLimit
                  ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  : <TrendingDown className="mt-0.5 h-4 w-4 shrink-0" />
                }
                <div>
                  <span className="font-semibold">
                    Текущий долг: {formatCurrency(clientDebt.currentDebt)}
                  </span>
                  {clientDebt.overdueRentals > 0 && (
                    <span className="ml-1.5">· просрочено аренд: {clientDebt.overdueRentals}</span>
                  )}
                  {clientDebt.exceededLimit && clientDebt.creditLimit > 0 && (
                    <div className="mt-0.5 text-xs">
                      Лимит {formatCurrency(clientDebt.creditLimit)} превышен
                    </div>
                  )}
                </div>
              </div>
            )}
            {clientDebt && clientDebt.currentDebt === 0 && form.client && (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300">
                <CheckCircle className="h-4 w-4 shrink-0" />
                <span>Задолженность отсутствует</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Amount due */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Сумма к оплате <span className="text-red-500">*</span>
              </label>
              <Input
                required
                type="number"
                min="0"
                placeholder="0"
                value={form.amount}
                onChange={e => set('amount', e.target.value)}
              />
            </div>
            {/* Paid amount */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Оплачено
              </label>
              <Input
                type="number"
                min="0"
                placeholder="= Полная сумма"
                value={form.paidAmount}
                onChange={e => set('paidAmount', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Срок оплаты <span className="text-red-500">*</span>
              </label>
              <Input
                required
                type="date"
                value={form.dueDate}
                onChange={e => set('dueDate', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Дата оплаты
              </label>
              <Input
                type="date"
                value={form.paidDate}
                onChange={e => set('paidDate', e.target.value)}
              />
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Статус
            </label>
            <select
              value={form.status}
              onChange={e => set('status', e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              <option value="paid">Оплачено</option>
              <option value="partial">Частично оплачено</option>
              <option value="pending">Не оплачено</option>
              <option value="overdue">Просрочено</option>
            </select>
          </div>

          {/* Comment */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Комментарий
            </label>
            <textarea
              rows={2}
              placeholder="Примечание к платежу..."
              value={form.comment}
              onChange={e => set('comment', e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <Button type="submit" className="flex-1">Сохранить платёж</Button>
            <Button type="button" variant="secondary" onClick={onClose}>Отмена</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function Payments() {
  const { can } = usePermissions();
  const { data: paymentList = [] } = usePaymentsList();
  const { data: ganttRentals = [] } = useGanttData();
  const { data: clients = [] } = useClientsList();
  const createPayment = useCreatePayment();
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);

  const filteredPayments = useMemo(() => paymentList.filter(p => {
    const q = search.toLowerCase();
    const matchesSearch = !search ||
      p.invoiceNumber.toLowerCase().includes(q) ||
      p.client.toLowerCase().includes(q) ||
      p.rentalId?.toLowerCase().includes(q) ||
      p.comment?.toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [paymentList, search, statusFilter]);

  const handleAddPayment = (p: Payment) => {
    // id is already pre-generated in the modal; pass it through
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, ...data } = p;
    createPayment.mutate(data as Omit<Payment, 'id'>, {
      onSuccess: () => setShowAddModal(false),
    });
  };

  // KPI sums
  const totalPending = paymentList.filter(p => p.status === 'pending' || p.status === 'partial').reduce((s, p) => s + (p.amount - (p.paidAmount ?? 0)), 0);
  const totalPaid = paymentList.filter(p => p.status === 'paid').reduce((s, p) => s + (p.paidAmount ?? p.amount), 0);
  const totalOverdue = paymentList.filter(p => p.status === 'overdue').reduce((s, p) => s + (p.amount - (p.paidAmount ?? 0)), 0);
  const totalPartial = paymentList.filter(p => p.status === 'partial').reduce((s, p) => s + (p.paidAmount ?? 0), 0);
  const rentalDebtRows = useMemo(() => buildRentalDebtRows(ganttRentals as GanttRentalData[], paymentList), [ganttRentals, paymentList]);
  const clientReceivables = useMemo(() => buildClientReceivables(clients, rentalDebtRows), [clients, rentalDebtRows]);
  const overdueDebtRentals = useMemo(
    () => rentalDebtRows.filter(row => {
      const today = new Date().toISOString().slice(0, 10);
      return (row.expectedPaymentDate && row.expectedPaymentDate < today) || row.endDate < today;
    }),
    [rentalDebtRows],
  );

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      {showAddModal && (
        <AddPaymentModal
          onClose={() => setShowAddModal(false)}
          onSave={handleAddPayment}
          existing={paymentList}
          rentals={ganttRentals as GanttRentalData[]}
          clients={clients}
          allPayments={paymentList}
        />
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Платежи</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Управление платежами и задолженностями</p>
        </div>
        {can('create', 'payments') && (
          <Button size="sm" onClick={() => setShowAddModal(true)}>
            <Plus className="h-4 w-4" />
            Добавить платёж
          </Button>
        )}
      </div>

      {/* KPI summary */}
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/30">
            <Clock className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Ожидает оплаты</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(totalPending)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
            <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Оплачено</p>
            <p className="text-lg font-bold text-green-600 dark:text-green-400">{formatCurrency(totalPaid + totalPartial)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Просрочено</p>
            <p className="text-lg font-bold text-red-600 dark:text-red-400">{formatCurrency(totalOverdue)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
            <DollarSign className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Всего платежей</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{paymentList.length}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Дебиторка по клиентам</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Клиенты с текущей задолженностью по арендам</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 dark:text-gray-400">Всего должников</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{clientReceivables.length}</p>
            </div>
          </div>
          {clientReceivables.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
              Сейчас активной дебиторки нет
            </div>
          ) : (
            <div className="space-y-3">
              {clientReceivables.slice(0, 8).map(row => (
                <div
                  key={row.client}
                  className={`rounded-lg border px-4 py-3 ${
                    row.exceededLimit
                      ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
                      : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">{row.client}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Неоплаченных аренд: {row.unpaidRentals}
                        {row.overdueRentals > 0 && ` · просроченных: ${row.overdueRentals}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`font-semibold ${row.exceededLimit ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                        {formatCurrency(row.currentDebt)}
                      </p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Лимит: {row.creditLimit > 0 ? formatCurrency(row.creditLimit) : 'не задан'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Неоплаченные аренды</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Самые рискованные аренды по дебиторке</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 dark:text-gray-400">Всего</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{rentalDebtRows.length}</p>
            </div>
          </div>
          {rentalDebtRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
              Все аренды закрыты по оплате
            </div>
          ) : (
            <div className="space-y-3">
              {rentalDebtRows.slice(0, 8).map(row => {
                const isOverdue = overdueDebtRentals.some(item => item.rentalId === row.rentalId);
                return (
                  <div
                    key={row.rentalId}
                    className={`rounded-lg border px-4 py-3 ${
                      isOverdue
                        ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
                        : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{row.client}</p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {row.equipmentInv} · {row.startDate} — {row.endDate}
                        </p>
                        {row.expectedPaymentDate && (
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Ожидаемая оплата: {formatDate(row.expectedPaymentDate)}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold ${isOverdue ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                          {formatCurrency(row.outstanding)}
                        </p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Оплачено: {formatCurrency(row.paidAmount)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800 sm:gap-4 sm:p-4">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <Input
              placeholder="Поиск по счёту, клиенту, аренде..."
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
            { value: 'paid', label: 'Оплачено' },
            { value: 'partial', label: 'Частично' },
            { value: 'pending', label: 'Не оплачено' },
            { value: 'overdue', label: 'Просрочено' },
          ]}
          className="w-[180px]"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Счёт</TableHead>
              <TableHead>Аренда</TableHead>
              <TableHead>Клиент</TableHead>
              <TableHead>Сумма</TableHead>
              <TableHead>Оплачено</TableHead>
              <TableHead>Срок оплаты</TableHead>
              <TableHead>Дата оплаты</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Комментарий</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPayments.map((payment) => {
              const paid = payment.paidAmount ?? (payment.status === 'paid' ? payment.amount : 0);
              const remaining = payment.amount - paid;
              return (
                <TableRow
                  key={payment.id}
                  className={payment.status === 'overdue' ? 'bg-red-50 dark:bg-red-900/10' : ''}
                >
                  <TableCell>
                    <p className="font-medium text-[--color-primary]">{payment.invoiceNumber}</p>
                  </TableCell>
                  <TableCell>
                    {payment.rentalId ? (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                        {payment.rentalId}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <p className="text-sm text-gray-700 dark:text-gray-300">{payment.client}</p>
                  </TableCell>
                  <TableCell>
                    <p className="font-semibold text-gray-900 dark:text-white">{formatCurrency(payment.amount)}</p>
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium text-green-600 dark:text-green-400">{formatCurrency(paid)}</p>
                      {remaining > 0 && (
                        <p className="text-xs text-gray-400 dark:text-gray-500">Остаток: {formatCurrency(remaining)}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm text-gray-700 dark:text-gray-300">{formatDate(payment.dueDate)}</p>
                  </TableCell>
                  <TableCell>
                    {payment.paidDate ? (
                      <p className="text-sm text-gray-700 dark:text-gray-300">{formatDate(payment.paidDate)}</p>
                    ) : (
                      <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
                    )}
                  </TableCell>
                  <TableCell>{getPaymentStatusBadge(payment.status)}</TableCell>
                  <TableCell>
                    {payment.comment ? (
                      <p className="max-w-[160px] truncate text-sm text-gray-500 dark:text-gray-400">{payment.comment}</p>
                    ) : (
                      <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {filteredPayments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
              <DollarSign className="h-8 w-8 text-gray-400 dark:text-gray-500" />
            </div>
            <h3 className="text-base font-medium text-gray-900 dark:text-white">
              {paymentList.length === 0 ? 'Платежей ещё нет' : 'Платежи не найдены'}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {paymentList.length === 0
                ? 'Добавьте первый платёж по аренде'
                : 'Попробуйте изменить параметры поиска или фильтры'}
            </p>
            {paymentList.length === 0 && can('create', 'payments') && (
              <Button size="sm" className="mt-4" onClick={() => setShowAddModal(true)}>
                <Plus className="h-4 w-4" />
                Добавить платёж
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Results counter */}
      {filteredPayments.length > 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Показано {filteredPayments.length} из {paymentList.length} платежей
        </p>
      )}
    </div>
  );
}
