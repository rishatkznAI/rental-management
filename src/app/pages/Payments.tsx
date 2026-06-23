import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { ClientCombobox } from '../components/ui/ClientCombobox';
import { Search, Plus, X, DollarSign, AlertTriangle, CheckCircle, Clock, TrendingDown, Wand2, Trash2, Edit2, ListChecks, Download, SlidersHorizontal, MoreVertical, CalendarDays, FileText, WalletCards, Hourglass, Settings2 } from 'lucide-react';
import { FilterButton, FilterDialog, FilterField } from '../components/ui/filter-dialog';
import { usePermissions } from '../lib/permissions';
import {
  PAYMENT_KEYS,
  useCreatePayment,
  useCreatePaymentAllocation,
  useDeletePaymentAllocation,
  usePaymentAllocationsList,
  usePaymentsList,
  usePaginatedPayments,
  useUpdatePayment,
  useUpdatePaymentAllocation,
} from '../hooks/usePayments';
import { useClientsList } from '../hooks/useClients';
import { useGanttData } from '../hooks/useRentals';
import { useClientContractsList, useClientObjectsList } from '../hooks/useClientRelations';
import { useDocumentsList, DOCUMENT_KEYS } from '../hooks/useDocuments';
import type { GanttRentalData } from '../mock-data';
import { formatDate, formatCurrency } from '../lib/utils';
import type { Client, ClientContract, ClientObject, Document, Payment, PaymentAllocation, PaymentStatus } from '../types';
import { buildClientReceivables, buildRentalDebtRows } from '../lib/finance';
import { financeService } from '../services/finance.service';
import {
  buildQuickActionContext,
  contextFilterLabel,
  hasClientContext,
  normalizeContextName,
} from '../lib/quickActionContext.js';
import { animationDurations, useAnimatedPresence } from '../lib/animations';
import { useServerPagination } from '../hooks/useServerPagination';
import { PaginationControls } from '../components/common/PaginationControls';
import { cn } from '../components/ui/utils';

// ─── helpers ─────────────────────────────────────────────────────────────────

function genId() { return `pay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function genInvoice(payments: Payment[]) {
  const n = payments.length + 1;
  return `СЧ-${String(n).padStart(4, '0')}`;
}
function today() { return new Date().toISOString().slice(0, 10); }
function text(value: unknown) { return String(value ?? '').trim(); }
function money(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}
function paidAmount(payment: Payment) {
  if (typeof payment.paidAmount === 'number') return Math.max(0, payment.paidAmount);
  return payment.status === 'paid' ? Math.max(0, payment.amount) : 0;
}
function allocationCap(payment: Payment) {
  const paid = paidAmount(payment);
  return payment.amount > 0 ? Math.min(paid, payment.amount) : paid;
}

function safeLabel(value: unknown, fallback = '—') {
  const result = text(value);
  return result || fallback;
}

function paymentRecord(payment: Payment) {
  return payment as Payment & Record<string, unknown>;
}

function paymentNumber(payment: Payment) {
  const record = paymentRecord(payment);
  return safeLabel(payment.invoiceNumber || record.documentNumber || payment.id, 'Без номера');
}

function paymentClientName(payment: Payment) {
  const record = paymentRecord(payment);
  return safeLabel(record.clientName || payment.client, 'Контрагент не указан');
}

function paymentDateLabel(payment: Payment) {
  const record = paymentRecord(payment);
  const value = record.date || record.paymentDate || payment.paidDate || payment.dueDate;
  return value ? formatDate(value) : '—';
}

function paymentDueDateLabel(payment: Payment) {
  return payment.dueDate ? formatDate(payment.dueDate) : '—';
}

function paymentTypeLabel(payment: Payment) {
  const record = paymentRecord(payment);
  return safeLabel(record.type || record.method || record.documentType || 'Аренда', '—');
}

function paymentContractLabel(payment: Payment, rentalsById?: Map<string, GanttRentalData>) {
  const record = paymentRecord(payment);
  const rental = payment.rentalId ? rentalsById?.get(payment.rentalId) : undefined;
  const rentalRecord = (rental || {}) as GanttRentalData & Record<string, unknown>;
  const contract = safeLabel(record.contractNumber || payment.contractId || rentalRecord.contractNumber || rentalRecord.contractId, '');
  const rentalLabel = safeLabel(payment.rentalId || rental?.id, '');
  if (contract && rentalLabel) return `${contract} / ${rentalLabel}`;
  return contract || rentalLabel || '—';
}

function paymentPurpose(payment: Payment) {
  const record = paymentRecord(payment);
  return safeLabel(record.purpose || payment.comment || record.description || 'Платёж по аренде спецтехники', '—');
}

function paymentStatusLabel(status: unknown) {
  const value = text(status).toLowerCase();
  if (value === 'paid') return 'Оплачен';
  if (value === 'overdue') return 'Просрочен';
  if (value === 'partial') return 'Ожидает';
  if (value === 'pending') return 'К оплате';
  return safeLabel(status, 'Нет статуса');
}

function paymentStatusClass(status: unknown) {
  const value = text(status).toLowerCase();
  if (value === 'paid') return '!bg-emerald-50 !text-emerald-700 ring-emerald-100';
  if (value === 'overdue') return '!bg-red-50 !text-red-700 ring-red-100';
  if (value === 'partial') return '!bg-orange-50 !text-orange-700 ring-orange-100';
  if (value === 'pending') return '!bg-blue-50 !text-blue-700 ring-blue-100';
  return '!bg-slate-100 !text-slate-600 ring-slate-200';
}

function PaymentStatusPill({ status }: { status: unknown }) {
  return (
    <span className={cn('inline-flex max-w-full items-center rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', paymentStatusClass(status))}>
      {paymentStatusLabel(status)}
    </span>
  );
}

function paymentCountLabel(value: number) {
  const abs = Math.abs(value) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return 'платежей';
  if (last > 1 && last < 5) return 'платежа';
  if (last === 1) return 'платёж';
  return 'платежей';
}

function normalizedClientName(value: unknown) {
  return text(value).toLowerCase();
}

function resolveClientProfileId({
  clients,
  clientsById,
  clientId,
  clientName,
}: {
  clients: Client[];
  clientsById: Map<string, Client>;
  clientId?: unknown;
  clientName?: unknown;
}) {
  const stableClientId = text(clientId);
  if (stableClientId) return stableClientId;

  const name = normalizedClientName(clientName);
  if (!name) return '';

  const matches = clients.filter(client => normalizedClientName(client.company) === name);
  return matches.length === 1 && clientsById.has(matches[0].id) ? matches[0].id : '';
}

function PaymentKpiCard({
  icon: Icon,
  title,
  value,
  caption,
  tone,
  valueClassName,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  caption: string;
  tone: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex min-h-[116px] items-center gap-4 rounded-lg border border-slate-200 !bg-white p-5 !text-slate-950 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
      <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full', tone)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium !text-slate-500">{title}</p>
        <p className={cn('mt-1 truncate text-xl font-semibold !text-slate-950 sm:text-2xl', valueClassName)}>{value}</p>
        <p className="mt-1 text-sm !text-slate-500">{caption}</p>
      </div>
    </div>
  );
}

// ─── AddPaymentModal ─────────────────────────────────────────────────────────

interface AddPaymentModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (p: Payment) => void;
  existing: Payment[];
  rentals: GanttRentalData[];
  clients: Client[];
  allPayments: Payment[];
}

function AddPaymentModal({ open, onClose, onSave, existing, rentals, clients, allPayments }: AddPaymentModalProps) {
  const presence = useAnimatedPresence(open, animationDurations.base);
  const [clientError, setClientError] = useState('');
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({
    rentalId: '',
    clientId: '',
    client: '',
    amount: '',
    paidAmount: '',
    dueDate: today(),
    paidDate: today(),
    status: 'paid' as PaymentStatus,
    comment: '',
  });

  React.useEffect(() => {
    if (!open) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, open]);

  const set = (k: string, v: string) => {
    setForm(f => {
      const next = { ...f, [k]: v };
      // auto-fill client from rental
      if (k === 'rentalId') {
        const r = rentals.find(r => r.id === v);
        if (r) {
          next.clientId = r.clientId || '';
          next.client = r.client;
        }
      }
      return next;
    });
    if (k === 'client') {
      setClientError('');
    }
    setFormError('');
  };

  // Compute current client debt (excluding payments being created right now)
  const clientDebt = useMemo(() => {
    if (!form.clientId) return null;
    const debtRows = buildRentalDebtRows(rentals, allPayments);
    const receivables = buildClientReceivables(clients, debtRows);
    return receivables.find(r => r.clientId === form.clientId) ?? null;
  }, [form.clientId, rentals, allPayments, clients]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.clientId || !form.client.trim()) {
      setClientError('Выберите клиента из базы');
      return;
    }
    const amt = Number(form.amount);
    if (!Number.isFinite(amt) || amt < 0) {
      setFormError('Сумма к оплате должна быть числом не меньше 0');
      return;
    }
    const paid = form.paidAmount === '' ? amt : Number(form.paidAmount);
    if (!Number.isFinite(paid) || paid < 0) {
      setFormError('Оплачено должно быть числом не меньше 0');
      return;
    }
    const newPayment: Payment = {
      id: genId(),
      invoiceNumber: genInvoice(existing),
      rentalId: form.rentalId || undefined,
      clientId: form.clientId,
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

  if (!presence.shouldRender || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4 sm:p-6">
      <div data-state={presence.dataState} className="app-animate-overlay absolute inset-0 bg-slate-950/45 backdrop-blur-[3px]" onClick={onClose} />
      <div data-state={presence.dataState} onAnimationEnd={presence.onExitAnimationEnd} className="relative z-10 flex max-h-[min(92dvh,calc(100dvh-2rem))] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-0 shadow-[0_32px_90px_-46px_rgba(15,23,42,0.72)] transition duration-200 ease-out data-[state=closed]:scale-[0.98] data-[state=closed]:opacity-0 data-[state=open]:scale-100 data-[state=open]:opacity-100">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-6 py-5 pr-14">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Добавить платёж</h2>
            <p className="mt-1 text-sm text-slate-500">Свяжите оплату с клиентом и, при необходимости, с арендой.</p>
          </div>
          <button onClick={onClose} className="absolute right-4 top-4 inline-flex size-9 items-center justify-center rounded-xl border border-transparent text-slate-400 transition hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {formError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </div>
          )}
          {/* Rental link */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Аренда (необязательно)
            </label>
            <select
              value={form.rentalId}
              onChange={e => set('rentalId', e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/15"
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
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Клиент <span className="text-red-500">*</span>
            </label>
            <ClientCombobox
              clients={clients}
              value={form.client}
              valueId={form.clientId}
              onChange={value => set('client', value)}
              onClientSelect={(client) => {
                setForm(current => ({
                  ...current,
                  clientId: client?.id ?? '',
                  client: client?.company ?? '',
                }));
                setClientError('');
              }}
              placeholder="Выберите клиента из базы"
            />
            {clientError && (
              <p className="mt-1 text-xs text-red-600">{clientError}</p>
            )}
            {/* Debt banner */}
            {clientDebt && clientDebt.currentDebt > 0 && (
              <div className={`mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
                clientDebt.exceededLimit
                  ? 'bg-red-50 text-red-700'
                  : clientDebt.overdueRentals > 0
                  ? 'bg-orange-50 text-orange-700'
                  : 'bg-yellow-50 text-yellow-700'
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
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
                <CheckCircle className="h-4 w-4 shrink-0" />
                <span>Задолженность отсутствует</span>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Amount due */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
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
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
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
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
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
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Статус
            </label>
            <select
              value={form.status}
              onChange={e => set('status', e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/15"
            >
              <option value="paid">Оплачено</option>
              <option value="partial">Частично оплачено</option>
              <option value="pending">Не оплачено</option>
              <option value="overdue">Просрочено</option>
            </select>
          </div>

          {/* Comment */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Комментарий
            </label>
            <textarea
              rows={2}
              placeholder="Примечание к платежу..."
              value={form.comment}
              onChange={e => set('comment', e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/15"
            />
          </div>

          </div>
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 bg-white/95 px-6 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:flex-row">
            <Button type="button" variant="secondary" onClick={onClose}>Отмена</Button>
            <Button type="submit" className="flex-1">Сохранить платёж</Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

type AllocationDraft = {
  id?: string;
  objectId: string;
  contractId: string;
  rentalId: string;
  documentId: string;
  amount: string;
  periodStart: string;
  periodEnd: string;
  comment: string;
};

const emptyAllocationDraft: AllocationDraft = {
  objectId: '',
  contractId: '',
  rentalId: '',
  documentId: '',
  amount: '',
  periodStart: '',
  periodEnd: '',
  comment: '',
};

function PaymentAllocationPanel({
  payment,
  allPayments,
  allocations,
  rentals,
  objects,
  contracts,
  documents,
  onClose,
}: {
  payment: Payment;
  allPayments: Payment[];
  allocations: PaymentAllocation[];
  rentals: GanttRentalData[];
  objects: ClientObject[];
  contracts: ClientContract[];
  documents: Document[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const createAllocation = useCreatePaymentAllocation();
  const updateAllocation = useUpdatePaymentAllocation();
  const deleteAllocation = useDeletePaymentAllocation();
  const [draft, setDraft] = useState<AllocationDraft>(emptyAllocationDraft);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showDebtPicker, setShowDebtPicker] = useState(false);
  const [selectedDebt, setSelectedDebt] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Array<Partial<PaymentAllocation> & { reason?: string }>>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const paymentAllocations = useMemo(
    () => allocations.filter(item => text(item.paymentId) === text(payment.id) && text(item.status) !== 'cancelled'),
    [allocations, payment.id],
  );
  const paymentClientId = text(payment.clientId);
  const paid = allocationCap(payment);
  const allocated = paymentAllocations.reduce((sum, item) => sum + money(item.amount), 0);
  const unallocated = Math.max(0, paid - allocated);
  const allocationStatus = allocated <= 0 ? 'не распределён' : unallocated > 0 ? 'частично распределён' : 'распределён полностью';
  const clientObjects = objects.filter(item => text(item.clientId) === paymentClientId);
  const clientContracts = contracts.filter(item => text(item.clientId) === paymentClientId);
  const rentalDebtRows = useMemo(
    () => buildRentalDebtRows(rentals, allPayments, allocations),
    [allocations, allPayments, rentals],
  );
  const clientDebtRows = rentalDebtRows.filter(row => !paymentClientId || row.clientId === paymentClientId);
  const docsByRental = useMemo(() => {
    const map = new Map<string, Document[]>();
    documents.forEach(doc => {
      const rentalId = text(doc.rentalId || doc.rental);
      if (!rentalId) return;
      if (!map.has(rentalId)) map.set(rentalId, []);
      map.get(rentalId)!.push(doc);
    });
    return map;
  }, [documents]);
  const objectsById = useMemo(() => new Map(objects.map(item => [item.id, item])), [objects]);
  const contractsById = useMemo(() => new Map(contracts.map(item => [item.id, item])), [contracts]);
  const documentsById = useMemo(() => new Map(documents.map(item => [item.id, item])), [documents]);
  const rentalsById = useMemo(() => new Map(rentals.map(item => [item.id, item])), [rentals]);

  const filteredRentals = useMemo(() => rentals.filter(rental => {
    if (paymentClientId && text(rental.clientId) !== paymentClientId) return false;
    if (draft.objectId && text(rental.objectId) !== draft.objectId) return false;
    if (draft.contractId && text(rental.contractId) !== draft.contractId) return false;
    return true;
  }), [draft.contractId, draft.objectId, paymentClientId, rentals]);

  function resetDraft() {
    setDraft(emptyAllocationDraft);
    setError('');
  }

  function setDraftField(field: keyof AllocationDraft, value: string) {
    setDraft(current => {
      const next = { ...current, [field]: value };
      if (field === 'rentalId') {
        const rental = rentalsById.get(value);
        if (rental) {
          next.objectId = text(rental.objectId);
          next.contractId = text(rental.contractId);
          if (!next.periodStart) next.periodStart = text(rental.startDate);
          if (!next.periodEnd) next.periodEnd = text(rental.endDate || rental.plannedReturnDate);
          const rentalDocs = docsByRental.get(value) || [];
          if (!next.documentId && rentalDocs.length === 1) next.documentId = rentalDocs[0].id;
        }
      }
      return next;
    });
    setError('');
  }

  function allocationPayload(input: AllocationDraft): Omit<PaymentAllocation, 'id'> {
    const amount = money(input.amount);
    const rental = rentalsById.get(input.rentalId);
    const nextTotal = allocated - (input.id ? money(paymentAllocations.find(item => item.id === input.id)?.amount) : 0) + amount;
    if (!amount) throw new Error('Укажите сумму распределения больше 0');
    if (nextTotal > paid + 0.000001) throw new Error('Сумма распределений не может превышать сумму платежа');
    if (rental && paymentClientId && text(rental.clientId) !== paymentClientId) throw new Error('Нельзя выбрать аренду другого клиента');
    if (input.objectId) {
      const object = objectsById.get(input.objectId);
      if (!object || text(object.clientId) !== paymentClientId) throw new Error('Нельзя выбрать объект другого клиента');
    }
    if (input.contractId) {
      const contract = contractsById.get(input.contractId);
      if (!contract || text(contract.clientId) !== paymentClientId) throw new Error('Нельзя выбрать договор другого клиента');
    }
    return {
      paymentId: payment.id,
      clientId: paymentClientId || text(rental?.clientId) || undefined,
      objectId: input.objectId || text(rental?.objectId) || undefined,
      contractId: input.contractId || text(rental?.contractId) || undefined,
      rentalId: input.rentalId || undefined,
      documentId: input.documentId || undefined,
      managerId: text((rental as unknown as { managerId?: string })?.managerId) || undefined,
      periodStart: input.periodStart || undefined,
      periodEnd: input.periodEnd || undefined,
      amount,
      status: 'active',
      source: 'manual',
      comment: input.comment || undefined,
    };
  }

  function saveDraft() {
    try {
      const payload = allocationPayload(draft);
      const mutation = draft.id
        ? updateAllocation.mutateAsync({ id: draft.id, data: payload })
        : createAllocation.mutateAsync(payload);
      mutation
        .then(() => {
          setMessage(draft.id ? 'Распределение обновлено' : 'Распределение добавлено');
          resetDraft();
        })
        .catch(err => setError(err?.message || 'Не удалось сохранить распределение'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить распределение');
    }
  }

  function editAllocation(allocation: PaymentAllocation) {
    setDraft({
      id: allocation.id,
      objectId: text(allocation.objectId),
      contractId: text(allocation.contractId),
      rentalId: text(allocation.rentalId),
      documentId: text(allocation.documentId),
      amount: String(allocation.amount || ''),
      periodStart: text(allocation.periodStart),
      periodEnd: text(allocation.periodEnd),
      comment: text(allocation.comment),
    });
    setMessage('');
    setError('');
  }

  async function runPreview() {
    setPreviewLoading(true);
    setError('');
    try {
      const result = await financeService.previewPaymentAllocation(payment.id);
      setPreview((result.suggestedAllocations || []).map((item, index) => {
        const suggestion = item as Partial<PaymentAllocation>;
        return {
          ...suggestion,
          reason: [
            payment.contractId ? 'указан договор' : '',
            suggestion.documentId ? 'указан документ' : '',
            index === 0 ? 'старейшая просрочка' : 'следующий долг клиента',
          ].filter(Boolean).join(', '),
        };
      }));
      if (!result.suggestedAllocations?.length) setMessage('Автозачёт не нашёл подходящих долгов');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось получить предпросмотр автозачёта');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function applyPreview() {
    setError('');
    try {
      await financeService.applyPaymentAllocationPreview(payment.id, preview);
      setPreview([]);
      setMessage('Автозачёт применён');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PAYMENT_KEYS.allocations }),
        queryClient.invalidateQueries({ queryKey: PAYMENT_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: ['finance'] }),
        queryClient.invalidateQueries({ queryKey: DOCUMENT_KEYS.all }),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось применить автозачёт');
    }
  }

  async function allocateSelectedDebt() {
    setError('');
    let remaining = unallocated;
    const rows = clientDebtRows
      .map(row => ({ row, amount: Math.min(money(selectedDebt[row.rentalId]), row.outstanding, remaining) }))
      .filter(item => item.amount > 0);
    if (!rows.length) {
      setError('Выберите долги и суммы для распределения');
      return;
    }
    try {
      for (const item of rows) {
        if (remaining <= 0) break;
        const amount = Math.min(item.amount, remaining);
        const rental = rentalsById.get(item.row.rentalId);
        await createAllocation.mutateAsync({
          paymentId: payment.id,
          clientId: paymentClientId || item.row.clientId || undefined,
          objectId: item.row.objectId || undefined,
          contractId: item.row.contractId || undefined,
          rentalId: item.row.rentalId,
          documentId: text((docsByRental.get(item.row.rentalId) || [])[0]?.id) || undefined,
          managerId: text((rental as unknown as { managerId?: string })?.managerId) || undefined,
          periodStart: item.row.startDate || undefined,
          periodEnd: item.row.endDate || undefined,
          amount,
          status: 'active',
          source: 'manual',
          comment: 'Подбор долгов клиента',
        });
        remaining -= amount;
      }
      setSelectedDebt({});
      setMessage('Выбранные долги распределены');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось распределить выбранные долги');
    }
  }

  return (
    <div data-payment-detail-responsive="true" className="max-w-full overflow-hidden rounded-lg border border-blue-200 !bg-white p-4 !text-slate-950 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold !text-gray-900">Распределение оплаты</h2>
          <p className="mt-1 text-sm !text-gray-500">{payment.invoiceNumber || payment.id} · {payment.client}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /> Закрыть</Button>
      </div>

      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {message && <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{message}</div>}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-gray-200 !bg-white p-3"><p className="text-xs !text-gray-500">Сумма платежа</p><p className="font-semibold !text-slate-950">{formatCurrency(payment.amount)}</p></div>
        <div className="rounded-lg border border-gray-200 !bg-white p-3"><p className="text-xs !text-gray-500">Распределено</p><p className="font-semibold !text-green-600">{formatCurrency(allocated)}</p></div>
        <div className="rounded-lg border border-gray-200 !bg-white p-3"><p className="text-xs !text-gray-500">Не распределено</p><p className="font-semibold !text-orange-600">{formatCurrency(unallocated)}</p></div>
        <div className="rounded-lg border border-gray-200 !bg-white p-3"><p className="text-xs !text-gray-500">Статус</p><p className="font-semibold !text-slate-950">{allocationStatus}</p></div>
      </div>
      {unallocated > 0 && (
        <div className="mt-3 flex gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Часть платежа не распределена и не закрывает долг по арендам.</span>
        </div>
      )}

      <div data-payment-allocation-mobile-list="true" className="mt-5 space-y-3 md:hidden">
        {paymentAllocations.map(item => {
          const rental = item.rentalId ? rentalsById.get(item.rentalId) : null;
          const doc = item.documentId ? documentsById.get(item.documentId) : null;
          return (
            <div key={item.id} data-payment-allocation-mobile-card="true" className="rounded-xl border border-gray-200 !bg-white p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words font-semibold !text-gray-900">
                    {item.rentalId ? `${item.rentalId} · ${rental?.equipmentInv || 'аренда'}` : 'Без аренды'}
                  </p>
                  <p className="mt-1 break-words text-xs !text-gray-500">
                    {objectsById.get(text(item.objectId))?.name || 'Без объекта'} · {contractsById.get(text(item.contractId))?.number || text(item.contractId) || 'без договора'}
                  </p>
                </div>
                <p className="shrink-0 whitespace-nowrap font-semibold !text-gray-900">{formatCurrency(item.amount)}</p>
              </div>
              <div className="mt-3 grid gap-2 text-xs !text-gray-500">
                <p className="break-words">Документ: {doc ? `${doc.type} ${doc.number || doc.documentNumber || doc.id}` : text(item.documentId) || '—'}</p>
                <p>Период: {item.periodStart || rental?.startDate || '—'} — {item.periodEnd || rental?.endDate || rental?.plannedReturnDate || '—'}</p>
                <p className="break-words">Комментарий: {item.comment || '—'}</p>
                <p>Источник: {item.source || 'manual'}</p>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => editAllocation(item)}><Edit2 className="h-4 w-4" /> Изменить</Button>
                <Button size="sm" variant="ghost" onClick={() => deleteAllocation.mutate(item.id)}><Trash2 className="h-4 w-4" /> Удалить</Button>
              </div>
            </div>
          );
        })}
        {paymentAllocations.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 px-3 py-6 text-center text-sm text-gray-500">Распределений пока нет</div>
        )}
      </div>

      <div data-payment-allocation-desktop-table="true" className="mt-5 hidden overflow-x-auto rounded-lg border border-gray-200 md:block">
        <Table>
          <TableHeader><TableRow><TableHead>Объект</TableHead><TableHead>Договор</TableHead><TableHead>Аренда</TableHead><TableHead>Документ/УПД</TableHead><TableHead>Период</TableHead><TableHead>Сумма</TableHead><TableHead>Комментарий</TableHead><TableHead>Источник</TableHead><TableHead>Действия</TableHead></TableRow></TableHeader>
          <TableBody>
            {paymentAllocations.map(item => {
              const rental = item.rentalId ? rentalsById.get(item.rentalId) : null;
              const doc = item.documentId ? documentsById.get(item.documentId) : null;
              return (
                <TableRow key={item.id}>
                  <TableCell>{objectsById.get(text(item.objectId))?.name || '—'}</TableCell>
                  <TableCell>{contractsById.get(text(item.contractId))?.number || text(item.contractId) || '—'}</TableCell>
                  <TableCell>{item.rentalId ? `${item.rentalId} · ${rental?.equipmentInv || ''}` : '—'}</TableCell>
                  <TableCell>{doc ? `${doc.type} ${doc.number || doc.documentNumber || doc.id}` : text(item.documentId) || '—'}</TableCell>
                  <TableCell>{item.periodStart || rental?.startDate || '—'} — {item.periodEnd || rental?.endDate || rental?.plannedReturnDate || '—'}</TableCell>
                  <TableCell className="font-semibold">{formatCurrency(item.amount)}</TableCell>
                  <TableCell>{item.comment || '—'}</TableCell>
                  <TableCell>{item.source || 'manual'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => editAllocation(item)}><Edit2 className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteAllocation.mutate(item.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {paymentAllocations.length === 0 && <TableRow><TableCell colSpan={9} className="py-6 text-center text-sm text-gray-500">Распределений пока нет</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <div className="mt-5 rounded-lg border border-gray-200 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-semibold text-gray-900">{draft.id ? 'Изменить распределение' : 'Добавить распределение'}</h3>
          {draft.id && <Button size="sm" variant="secondary" onClick={resetDraft}>Новая строка</Button>}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <select value={draft.objectId} onChange={e => setDraftField('objectId', e.target.value)} className="app-filter-input">
            <option value="">Объект клиента</option>
            {clientObjects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select value={draft.contractId} onChange={e => setDraftField('contractId', e.target.value)} className="app-filter-input">
            <option value="">Договор клиента</option>
            {clientContracts.map(item => <option key={item.id} value={item.id}>{item.number}</option>)}
          </select>
          <select value={draft.rentalId} onChange={e => setDraftField('rentalId', e.target.value)} className="app-filter-input">
            <option value="">Аренда</option>
            {filteredRentals.map(rental => {
              const debt = rentalDebtRows.find(row => row.rentalId === rental.id);
              return <option key={rental.id} value={rental.id}>{rental.id} · {rental.equipmentInv} · долг {formatCurrency(debt?.outstanding || 0)}</option>;
            })}
          </select>
          <select value={draft.documentId} onChange={e => setDraftField('documentId', e.target.value)} className="app-filter-input">
            <option value="">Документ/УПД</option>
            {(draft.rentalId ? docsByRental.get(draft.rentalId) || [] : documents.filter(doc => text(doc.clientId) === paymentClientId)).map(doc => <option key={doc.id} value={doc.id}>{doc.type} · {doc.number || doc.documentNumber || doc.id}</option>)}
          </select>
          <Input type="number" min="0" placeholder="Сумма" value={draft.amount} onChange={e => setDraftField('amount', e.target.value)} />
          <Input placeholder="Комментарий" value={draft.comment} onChange={e => setDraftField('comment', e.target.value)} />
          <Input type="date" value={draft.periodStart} onChange={e => setDraftField('periodStart', e.target.value)} />
          <Input type="date" value={draft.periodEnd} onChange={e => setDraftField('periodEnd', e.target.value)} />
          <Button onClick={saveDraft} disabled={createAllocation.isPending || updateAllocation.isPending}>Сохранить распределение</Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setShowDebtPicker(value => !value)}><ListChecks className="h-4 w-4" /> Подобрать долги клиента</Button>
        <Button variant="secondary" onClick={runPreview} disabled={previewLoading || unallocated <= 0}><Wand2 className="h-4 w-4" /> Предпросмотр автозачёта</Button>
      </div>

      {showDebtPicker && (
        <div className="mt-4 rounded-lg border border-gray-200 p-4">
          <h3 className="mb-3 font-semibold">Долги клиента</h3>
          <div className="space-y-2">
            {clientDebtRows.map(row => {
              const rental = rentalsById.get(row.rentalId);
              const objectName = objectsById.get(text(row.objectId))?.name || 'Без объекта';
              const contractNumber = contractsById.get(text(row.contractId))?.number || 'Без договора';
              const doc = (docsByRental.get(row.rentalId) || [])[0];
              const dueDate = row.expectedPaymentDate || row.endDate;
              const overdueDays = dueDate && dueDate < today()
                ? Math.ceil((new Date(today()).getTime() - new Date(dueDate).getTime()) / 86400000)
                : 0;
              return (
                <div key={row.rentalId} className="grid gap-2 rounded-lg border border-gray-200 p-3 text-sm md:grid-cols-[1fr_150px]">
                  <div className="flex min-w-0 gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={money(selectedDebt[row.rentalId]) > 0}
                      onChange={event => setSelectedDebt(current => ({
                        ...current,
                        [row.rentalId]: event.target.checked ? String(Math.min(row.outstanding, unallocated)) : '',
                      }))}
                    />
                    <div className="min-w-0">
                    <p className="break-words font-medium">{payment.client} → {objectName} → {contractNumber} → {row.rentalId}</p>
                    <p className="break-words text-gray-500">{rental?.equipmentInv || row.equipmentInv} · {row.startDate} — {row.endDate} · менеджер {row.manager || '—'} · документ {doc?.number || doc?.id || '—'}</p>
                    <p className="break-words text-gray-500">Начислено {formatCurrency(row.amount)} · оплачено {formatCurrency(row.paidAmount)} · долг {formatCurrency(row.outstanding)} · просрочка {overdueDays > 0 ? `${overdueDays} дн.` : 'нет'}</p>
                    </div>
                  </div>
                  <Input type="number" min="0" value={selectedDebt[row.rentalId] || ''} onChange={e => setSelectedDebt(current => ({ ...current, [row.rentalId]: e.target.value }))} placeholder="Сумма" />
                </div>
              );
            })}
            {clientDebtRows.length === 0 && <p className="text-sm text-gray-500">Неоплаченных аренд клиента нет</p>}
          </div>
          <Button className="mt-3" onClick={allocateSelectedDebt}>Распределить выбранное</Button>
        </div>
      )}

      {preview.length > 0 && (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h3 className="mb-3 font-semibold text-blue-950">Предпросмотр автозачёта</h3>
          <div className="space-y-2">
            {preview.map((item, index) => (
              <div key={`${item.rentalId}-${index}`} className="rounded-lg bg-white p-3 text-sm">
                <div className="flex justify-between gap-3"><span>{item.rentalId} · {objectsById.get(text(item.objectId))?.name || 'объект'} · {contractsById.get(text(item.contractId))?.number || 'договор'}</span><b>{formatCurrency(item.amount || 0)}</b></div>
                <p className="mt-1 text-xs text-gray-500">Причина выбора: {item.reason || 'правило автозачёта'}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button onClick={applyPreview}>Применить автозачёт</Button>
            <Button variant="secondary" onClick={() => setPreview([])}>Отмена</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function Payments() {
  const [searchParams] = useSearchParams();
  const { can } = usePermissions();
  const { data: paymentAllocations = [] } = usePaymentAllocationsList();
  const { data: ganttRentals = [] } = useGanttData();
  const { data: clients = [] } = useClientsList();
  const { data: clientObjects = [] } = useClientObjectsList();
  const { data: clientContracts = [] } = useClientContractsList();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedPaymentId, setSelectedPaymentId] = useState('');
  const { data: documents = [] } = useDocumentsList({
    enabled: Boolean(selectedPaymentId),
  });
  const createPayment = useCreatePayment();
  const updatePayment = useUpdatePayment();
  const pagination = useServerPagination<{ status: string; clientId: string }>({
    initialSortBy: 'date',
    initialSortDir: 'desc',
    initialFilters: { status: 'all', clientId: 'all' },
    storageKey: 'payments',
  });
  const paymentsQuery = usePaginatedPayments({
    page: pagination.page,
    pageSize: pagination.pageSize,
    search: pagination.debouncedSearch,
    sortBy: pagination.sortBy,
    sortDir: pagination.sortDir,
    filters: pagination.filters,
  });
  const paymentList = paymentsQuery.data?.items ?? [];
  const paymentSummary = paymentsQuery.data?.summary as {
    pendingAmount?: number;
    paidAmount?: number;
    overdueAmount?: number;
    partialAmount?: number;
    count?: number;
  } | undefined;
  const { data: allPaymentsForAllocation = [] } = usePaymentsList({
    enabled: showAddModal || Boolean(selectedPaymentId),
  });
  const receivablesQuery = useQuery({
    queryKey: ['finance', 'receivables', 'payments-page'],
    queryFn: () => financeService.getReceivables(),
    enabled: can('view', 'payments') || can('view', 'finance'),
    staleTime: 1000 * 60,
  });
  const quickActionContext = React.useMemo(() => buildQuickActionContext(searchParams), [searchParams]);
  const hasQuickClientContext = hasClientContext(quickActionContext);
  const clientsById = useMemo(() => new Map(clients.map(client => [client.id, client])), [clients]);
  const setPaginationFilters = pagination.setFilters;

  React.useEffect(() => {
    if (!hasQuickClientContext) return;
    if (quickActionContext.clientId && clientsById.has(quickActionContext.clientId)) {
      setPaginationFilters({ clientId: quickActionContext.clientId });
      return;
    }
    const wantedName = normalizeContextName(quickActionContext.clientName);
    if (!wantedName) return;
    const client = clients.find(item => normalizeContextName(item.company) === wantedName);
    if (client) setPaginationFilters({ clientId: client.id });
  }, [clients, clientsById, hasQuickClientContext, quickActionContext.clientId, quickActionContext.clientName, setPaginationFilters]);

  const handleAddPayment = (p: Payment) => {
    // id is already pre-generated in the modal; pass it through
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, ...data } = p;
    createPayment.mutate(data as Omit<Payment, 'id'>, {
      onSuccess: () => setShowAddModal(false),
    });
  };

  const totalPending = paymentSummary?.pendingAmount ?? 0;
  const totalPaid = paymentSummary?.paidAmount ?? 0;
  const totalOverdue = paymentSummary?.overdueAmount ?? 0;
  const totalPartial = paymentSummary?.partialAmount ?? 0;
  const totalCount = paymentSummary?.count ?? paymentsQuery.data?.pagination.total ?? 0;
  const pendingPaymentsCount = paymentList.filter(payment => ['pending', 'partial'].includes(String(payment.status || '').toLowerCase())).length;
  const paidPaymentsCount = paymentList.filter(payment => ['paid', 'partial'].includes(String(payment.status || '').toLowerCase())).length;
  const overduePaymentsCount = paymentList.filter(payment => String(payment.status || '').toLowerCase() === 'overdue').length;
  const waitingPaymentsCount = paymentList.filter(payment => String(payment.status || '').toLowerCase() === 'partial').length;
  const forecastAmount = receivablesQuery.data?.summary?.totalDebt ?? totalPending + totalOverdue;
  const rentalsById = useMemo(() => new Map((ganttRentals as GanttRentalData[]).map(rental => [rental.id, rental])), [ganttRentals]);
  const selectedPayment = useMemo(
    () => paymentList.find(payment => payment.id === selectedPaymentId),
    [paymentList, selectedPaymentId],
  );
  const relatedDocuments = useMemo(() => {
    if (!selectedPayment) return [];
    const selectedClientId = text(selectedPayment.clientId);
    const selectedRentalId = text(selectedPayment.rentalId);
    return documents.filter(document => {
      const documentRecord = document as Document & Record<string, unknown>;
      return (
        (selectedRentalId && text(documentRecord.rentalId || documentRecord.rental) === selectedRentalId) ||
        (selectedClientId && text(documentRecord.clientId) === selectedClientId)
      );
    }).slice(0, 3);
  }, [documents, selectedPayment]);
  const invoiceDocument = relatedDocuments.find(document => text((document as Document & Record<string, unknown>).fileUrl));
  const activeFilterCount = [
    pagination.search.trim() !== '',
    pagination.filters.clientId !== 'all' || hasQuickClientContext,
    pagination.filters.status !== 'all',
  ].filter(Boolean).length;
  const tabs = [
    { value: 'all', label: 'Все платежи', count: totalCount },
    { value: 'pending', label: 'К оплате', count: paymentList.filter(payment => String(payment.status || '').toLowerCase() === 'pending').length },
    { value: 'partial', label: 'Ожидают', count: waitingPaymentsCount },
    { value: 'paid', label: 'Оплачено', count: paymentList.filter(payment => String(payment.status || '').toLowerCase() === 'paid').length },
    { value: 'overdue', label: 'Просрочено', count: overduePaymentsCount },
  ];

  function resetFilters() {
    pagination.setSearch('');
    pagination.setFilters({ clientId: 'all', status: 'all' });
  }

  function exportCurrentPayments() {
    const rows = paymentList.map(payment => [
      paymentDateLabel(payment),
      paymentNumber(payment),
      paymentClientName(payment),
      paymentContractLabel(payment, rentalsById),
      paymentTypeLabel(payment),
      String(payment.amount ?? 0),
      paymentStatusLabel(payment.status),
    ]);
    const csv = [
      ['Дата', 'Номер платежа', 'Контрагент', 'Договор / заказ', 'Тип', 'Сумма', 'Статус'],
      ...rows,
    ].map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(';')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `payments-${today()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function markSelectedPaid() {
    if (!selectedPayment || !can('update', 'payments')) return;
    updatePayment.mutate({
      id: selectedPayment.id,
      data: {
        status: 'paid',
        paidAmount: selectedPayment.amount,
        paidDate: today(),
      },
    });
  }

  return (
    <div data-payments-responsive-root="true" className="min-h-screen max-w-full space-y-6 overflow-x-clip !bg-[#f6f8fb] p-4 !text-slate-950 sm:p-6 md:p-8">
      <AddPaymentModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSave={handleAddPayment}
        existing={allPaymentsForAllocation}
        rentals={ganttRentals as GanttRentalData[]}
        clients={clients}
        allPayments={allPaymentsForAllocation}
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-normal !text-slate-950 sm:text-4xl">Платежи</h1>
          <p className="mt-2 text-sm !text-slate-500">Управление платежами и задолженностями</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            type="button"
            variant="outline"
            onClick={exportCurrentPayments}
            disabled={paymentList.length === 0}
            className="h-11 rounded-lg border-slate-200 !bg-white px-4 !text-slate-700 shadow-sm hover:!bg-slate-50"
          >
            <Download className="h-4 w-4" />
            Экспорт
          </Button>
          {can('create', 'payments') && (
            <Button
              size="lg"
              onClick={() => setShowAddModal(true)}
              className="h-11 rounded-lg bg-blue-600 px-5 font-semibold text-white shadow-[0_14px_28px_rgba(37,99,235,0.22)] hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Новый платеж
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <PaymentKpiCard
          icon={Clock}
          title="К оплате"
          value={formatCurrency(totalPending)}
          caption={`${pendingPaymentsCount} ${paymentCountLabel(pendingPaymentsCount)}`}
          tone="bg-blue-100 text-blue-600"
        />
        <PaymentKpiCard
          icon={CheckCircle}
          title="Оплачено"
          value={formatCurrency(totalPaid + totalPartial)}
          caption={`${paidPaymentsCount} ${paymentCountLabel(paidPaymentsCount)}`}
          tone="bg-emerald-100 text-emerald-600"
          valueClassName="!text-emerald-600"
        />
        <PaymentKpiCard
          icon={Hourglass}
          title="Ожидают"
          value={formatCurrency(totalPartial)}
          caption={`${waitingPaymentsCount} ${paymentCountLabel(waitingPaymentsCount)}`}
          tone="bg-orange-100 text-orange-600"
          valueClassName="!text-orange-600"
        />
        <PaymentKpiCard
          icon={AlertTriangle}
          title="Просрочено"
          value={formatCurrency(totalOverdue)}
          caption={`${overduePaymentsCount} ${paymentCountLabel(overduePaymentsCount)}`}
          tone="bg-red-100 text-red-500"
          valueClassName="!text-red-600"
        />
        <PaymentKpiCard
          icon={WalletCards}
          title="Прогноз поступлений"
          value={formatCurrency(forecastAmount)}
          caption="на 30 дней"
          tone="bg-violet-100 text-violet-600"
        />
      </div>

      <div className="rounded-lg border border-slate-200 !bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1.4fr)_repeat(4,minmax(150px,0.7fr))_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Поиск по платежам, договорам, контрагентам..."
              value={pagination.search}
              onChange={(event) => pagination.setSearch(event.target.value)}
              className="h-11 rounded-lg border-slate-200 !bg-white pl-10 !text-slate-700"
            />
          </div>
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <select className="h-11 w-full rounded-lg border border-slate-200 !bg-white px-3 pr-9 text-sm !text-slate-700 shadow-sm" defaultValue="all">
              <option value="all">Период: все</option>
            </select>
          </div>
          <select className="h-11 w-full rounded-lg border border-slate-200 !bg-white px-3 text-sm !text-slate-700 shadow-sm" defaultValue="all">
            <option value="all">Тип: все</option>
          </select>
          <select
            value={pagination.filters.status}
            onChange={(event) => pagination.setFilters({ status: event.target.value })}
            className="h-11 w-full rounded-lg border border-slate-200 !bg-white px-3 text-sm !text-slate-700 shadow-sm"
          >
            <option value="all">Статус: все</option>
            <option value="pending">К оплате</option>
            <option value="partial">Ожидают</option>
            <option value="paid">Оплачено</option>
            <option value="overdue">Просрочено</option>
          </select>
          <select
            value={pagination.filters.clientId}
            onChange={(event) => pagination.setFilters({ clientId: event.target.value })}
            className="h-11 w-full rounded-lg border border-slate-200 !bg-white px-3 text-sm !text-slate-700 shadow-sm"
          >
            <option value="all">Контрагент: все</option>
            {clients.map(client => (
              <option key={client.id} value={client.id}>{client.company}</option>
            ))}
          </select>
          <Button type="button" variant="outline" onClick={() => setShowFilters(true)} className="h-11 rounded-lg">
            <SlidersHorizontal className="h-4 w-4" />
            Ещё фильтры
          </Button>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {activeFilterCount > 0 && (
            <Button type="button" variant="ghost" onClick={resetFilters} className="h-9 rounded-lg text-slate-500">
              <X className="h-4 w-4" />
              Сбросить
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setShowFilters(true)} className="h-9 rounded-lg">
            <Settings2 className="h-4 w-4" />
            Настроить вид
          </Button>
        </div>
      </div>

      <FilterDialog
        open={showFilters}
        onOpenChange={setShowFilters}
        title="Фильтры платежей"
        description="Поиск по счёту, клиенту, аренде и статусу оплаты."
        onReset={() => {
          pagination.setSearch('');
          pagination.setFilters({ clientId: 'all', status: 'all' });
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <FilterField label="Поиск" className="md:col-span-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Поиск по счёту, клиенту, аренде..."
                value={pagination.search}
                onChange={(e) => pagination.setSearch(e.target.value)}
                className="app-filter-input pl-10"
              />
            </div>
          </FilterField>
          <FilterField label="Клиент">
            <select
              value={pagination.filters.clientId}
              onChange={(e) => pagination.setFilters({ clientId: e.target.value })}
              className="app-filter-input"
            >
              <option value="all">Все клиенты</option>
              {clients.map(client => (
                <option key={client.id} value={client.id}>{client.company}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Статус оплаты">
            <select
              value={pagination.filters.status}
              onChange={(e) => pagination.setFilters({ status: e.target.value })}
              className="app-filter-input"
            >
              <option value="all">Все статусы</option>
              <option value="pending">К оплате</option>
              <option value="partial">Ожидают</option>
              <option value="paid">Оплачено</option>
              <option value="overdue">Просрочено</option>
            </select>
          </FilterField>
        </div>
      </FilterDialog>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 !bg-white shadow-sm">
        <div className="flex max-w-full gap-5 overflow-x-auto border-b border-slate-100 !bg-white px-4 sm:px-6">
          {tabs.map(tab => (
            <button
              key={tab.value}
              type="button"
              onClick={() => pagination.setFilters({ status: tab.value })}
              className={cn(
                'flex h-14 shrink-0 items-center gap-2 border-b-2 px-1 text-sm font-semibold transition',
                pagination.filters.status === tab.value
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent !text-slate-500 hover:!text-slate-900',
              )}
            >
              {tab.label}
              <span className="rounded-full !bg-slate-100 px-2 py-0.5 text-xs !text-slate-500">{tab.count}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 border-b border-slate-100 !bg-white px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 className="text-lg font-semibold !text-slate-950">Регистр платежей</h2>
            <p className="mt-1 text-sm !text-slate-500">История счетов, оплат и распределений</p>
          </div>
          <div className="text-sm font-medium !text-slate-400">
            {paymentSummary?.count ?? paymentsQuery.data?.pagination.total ?? 0} записей
          </div>
        </div>
        <div data-payment-mobile-list="true" className="grid gap-3 p-3 md:hidden">
          {paymentList.map((payment) => {
            const clientProfileId = resolveClientProfileId({
              clients,
              clientsById,
              clientId: payment.clientId,
              clientName: paymentClientName(payment),
            });
            return (
              <article
                key={payment.id}
                data-payment-mobile-card="true"
                onClick={() => setSelectedPaymentId(payment.id)}
                className={cn(
                  'max-w-full cursor-pointer rounded-lg border border-slate-200 !bg-white p-4 shadow-sm transition hover:border-blue-200 hover:!bg-blue-50/30',
                  selectedPayment?.id === payment.id && 'border-blue-300 !bg-blue-50/60 ring-1 ring-blue-200',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs !text-slate-400">№ платежа</p>
                    <p className="mt-1 break-words font-semibold text-blue-700">{paymentNumber(payment)}</p>
                  </div>
                  <div data-payment-mobile-status="true" className="flex max-w-[52%] shrink-0 justify-end">
                    <PaymentStatusPill status={payment.status} />
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  <div data-payment-mobile-client="true" className="min-w-0">
                    <p className="text-xs !text-slate-400">Контрагент</p>
                    {clientProfileId ? (
                      <Link
                        to={`/clients/${clientProfileId}`}
                        onClick={(event) => event.stopPropagation()}
                        className="mt-1 block break-words rounded-md text-sm font-semibold !text-slate-800 transition hover:!text-blue-700"
                        aria-label={`Открыть карточку клиента ${paymentClientName(payment)}`}
                      >
                        {paymentClientName(payment)}
                      </Link>
                    ) : (
                      <p className="mt-1 break-words text-sm font-semibold !text-slate-800">{paymentClientName(payment)}</p>
                    )}
                  </div>

                  <div data-payment-mobile-rental="true" className="min-w-0">
                    <p className="text-xs !text-slate-400">Договор / заказ</p>
                    <p className="mt-1 break-all text-sm !text-slate-700">{paymentContractLabel(payment, rentalsById)}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div data-payment-mobile-amount="true" className="min-w-0 rounded-lg !bg-slate-50 p-3">
                      <p className="text-xs !text-slate-400">Сумма</p>
                      <p className="mt-1 break-words text-base font-semibold !text-slate-950">{formatCurrency(payment.amount || 0)}</p>
                    </div>
                    <div data-payment-mobile-date="true" className="min-w-0 rounded-lg !bg-slate-50 p-3">
                      <p className="text-xs !text-slate-400">Дата</p>
                      <p className="mt-1 text-sm font-semibold !text-slate-700">{paymentDateLabel(payment)}</p>
                    </div>
                  </div>
                </div>

                <div data-payment-mobile-actions="true" className="mt-4 flex justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(event) => { event.stopPropagation(); setSelectedPaymentId(payment.id); }}
                  >
                    Открыть детали
                  </Button>
                </div>
              </article>
            );
          })}
        </div>

        <div data-payment-desktop-table="true" className="hidden overflow-x-auto md:block">
        <table className="min-w-[1040px] w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 !bg-slate-50 !text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="w-12 px-4 py-3 text-left"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" aria-label="Выбрать все платежи" /></th>
              <th className="px-4 py-3 text-left text-xs font-semibold">Дата</th>
              <th className="px-4 py-3 text-left text-xs font-semibold">№ платежа</th>
              <th className="px-4 py-3 text-left text-xs font-semibold">Контрагент</th>
              <th className="px-4 py-3 text-left text-xs font-semibold">Договор / Заказ</th>
              <th className="px-4 py-3 text-left text-xs font-semibold">Тип</th>
              <th className="px-4 py-3 text-right text-xs font-semibold">Сумма</th>
              <th className="px-4 py-3 text-left text-xs font-semibold">Статус</th>
              <th className="w-12 px-4 py-3 text-right text-xs font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 !bg-white">
            {paymentList.map((payment) => {
              const clientProfileId = resolveClientProfileId({
                clients,
                clientsById,
                clientId: payment.clientId,
                clientName: paymentClientName(payment),
              });
              return (
                <tr
                  key={payment.id}
                  onClick={() => setSelectedPaymentId(payment.id)}
                  className={cn(
                    'cursor-pointer transition-colors hover:!bg-slate-50/90',
                    selectedPayment?.id === payment.id && '!bg-blue-50/80',
                  )}
                >
                  <td className="px-4 py-3 align-middle" onClick={(event) => event.stopPropagation()}>
                    <input type="checkbox" className="h-4 w-4 rounded border-slate-300" aria-label={`Выбрать ${paymentNumber(payment)}`} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 align-middle !text-slate-700">
                    {paymentDateLabel(payment)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 align-middle">
                    <button type="button" onClick={() => setSelectedPaymentId(payment.id)} className="font-semibold text-blue-700 hover:text-blue-800">
                      {paymentNumber(payment)}
                    </button>
                  </td>
                  <td className="max-w-[220px] px-4 py-3 align-middle">
                    {clientProfileId ? (
                      <Link
                        to={`/clients/${clientProfileId}`}
                        onClick={(event) => event.stopPropagation()}
                        className="block truncate rounded-md font-medium !text-slate-700 transition hover:!text-blue-700"
                        aria-label={`Открыть карточку клиента ${paymentClientName(payment)}`}
                      >
                        {paymentClientName(payment)}
                      </Link>
                    ) : (
                      <p className="truncate font-medium !text-slate-700">{paymentClientName(payment)}</p>
                    )}
                  </td>
                  <td className="max-w-[240px] px-4 py-3 align-middle">
                    <p className="truncate !text-slate-700">{paymentContractLabel(payment, rentalsById)}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 align-middle">
                    <span className="rounded-md !bg-blue-50 px-2.5 py-1 text-xs font-semibold !text-blue-700">{paymentTypeLabel(payment)}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right align-middle font-semibold !text-slate-950">{formatCurrency(payment.amount || 0)}</td>
                  <td className="whitespace-nowrap px-4 py-3 align-middle"><PaymentStatusPill status={payment.status} /></td>
                  <td className="px-4 py-3 text-right align-middle">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(event) => { event.stopPropagation(); setSelectedPaymentId(payment.id); }}
                      aria-label={`Открыть меню ${paymentNumber(payment)}`}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>

        {paymentList.length === 0 && (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full !bg-slate-100">
              <DollarSign className="h-8 w-8 !text-slate-400" />
            </div>
            <h3 className="text-base font-semibold !text-slate-950">
              {(paymentsQuery.data?.pagination.total ?? 0) === 0
                ? 'Платежей ещё нет'
                : hasQuickClientContext || pagination.filters.clientId !== 'all'
                  ? 'Платежи по клиенту не найдены'
                  : 'Платежи не найдены'}
            </h3>
            <p className="mt-1 text-sm !text-slate-500">
              {(paymentsQuery.data?.pagination.total ?? 0) === 0
                ? 'Добавьте первый платёж по аренде'
                : hasQuickClientContext || pagination.filters.clientId !== 'all'
                  ? `Для ${contextFilterLabel(pagination.filters.clientId !== 'all'
                    ? { clientId: pagination.filters.clientId, clientName: clientsById.get(pagination.filters.clientId)?.company }
                    : quickActionContext)} нет платежей по выбранным фильтрам`
                  : 'Попробуйте изменить параметры поиска или фильтры'}
            </p>
            {(paymentsQuery.data?.pagination.total ?? 0) === 0 && can('create', 'payments') && (
              <Button size="sm" className="mt-4" onClick={() => setShowAddModal(true)}>
                <Plus className="h-4 w-4" />
                Добавить платёж
              </Button>
            )}
            {(paymentsQuery.data?.pagination.total ?? 0) > 0 && activeFilterCount > 0 && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-4"
                onClick={() => {
                  pagination.setSearch('');
                  pagination.setFilters({ clientId: 'all', status: 'all' });
                }}
              >
                Сбросить фильтры
              </Button>
            )}
          </div>
        )}
      </div>

        <aside className="min-w-0 rounded-lg border border-slate-200 !bg-white p-4 !text-slate-950 shadow-sm xl:sticky xl:top-6 xl:self-start">
          {!selectedPayment ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 !bg-white px-5 text-center">
              <FileText className="mb-3 h-10 w-10 !text-slate-300" />
              <h2 className="text-base font-semibold !text-slate-950">Выберите платёж</h2>
              <p className="mt-2 text-sm !text-slate-500">Детали, документы и действия появятся здесь.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words text-lg font-semibold !text-slate-950">{paymentNumber(selectedPayment)}</h2>
                  <div className="mt-3"><PaymentStatusPill status={selectedPayment.status} /></div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => setSelectedPaymentId('')} aria-label="Закрыть детали">
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div>
                <p className="text-2xl font-semibold !text-slate-950">{formatCurrency(selectedPayment.amount || 0)}</p>
                <p className="mt-1 text-sm !text-slate-500">{paymentPurpose(selectedPayment)}</p>
              </div>

              <dl className="grid gap-3 text-sm">
                {[
                  ['Контрагент', paymentClientName(selectedPayment)],
                  ['Договор / Заказ', paymentContractLabel(selectedPayment, rentalsById)],
                  ['Дата платежа', paymentDateLabel(selectedPayment)],
                  ['Срок оплаты', paymentDueDateLabel(selectedPayment)],
                  ['Тип платежа', paymentTypeLabel(selectedPayment)],
                  ['Назначение', paymentPurpose(selectedPayment)],
                  ['Комментарий', safeLabel(selectedPayment.comment, '—')],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[104px_minmax(0,1fr)] gap-3">
                    <dt className="!text-slate-500">{label}</dt>
                    <dd className="min-w-0 break-words font-medium !text-slate-800">{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="rounded-lg border border-slate-200 !bg-white">
                <div className="flex items-center justify-between border-b border-slate-100 !bg-white px-3 py-3">
                  <h3 className="text-sm font-semibold !text-slate-950">Связанные документы ({relatedDocuments.length})</h3>
                </div>
                <div className="space-y-2 p-3">
                  {relatedDocuments.length > 0 ? relatedDocuments.map(document => {
                    const documentRecord = document as Document & Record<string, unknown>;
                    return (
                      <div key={document.id} className="flex min-w-0 items-center gap-2 text-sm">
                        <FileText className="h-4 w-4 shrink-0 text-red-500" />
                        <span className="min-w-0 flex-1 truncate !text-slate-700">
                          {safeLabel(documentRecord.type || documentRecord.documentType, 'Документ')} {safeLabel(documentRecord.number || documentRecord.documentNumber || document.id, '')}
                        </span>
                        <span className="text-xs text-slate-400">PDF</span>
                      </div>
                    );
                  }) : (
                    <p className="py-3 text-sm !text-slate-500">Связанных документов нет</p>
                  )}
                </div>
              </div>

              <PaymentAllocationPanel
                payment={selectedPayment}
                allPayments={allPaymentsForAllocation}
                allocations={paymentAllocations}
                rentals={ganttRentals as GanttRentalData[]}
                objects={clientObjects}
                contracts={clientContracts}
                documents={documents}
                onClose={() => setSelectedPaymentId('')}
              />

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!invoiceDocument}
                  onClick={() => {
                    const fileUrl = text((invoiceDocument as Document & Record<string, unknown> | undefined)?.fileUrl);
                    if (fileUrl) window.open(fileUrl, '_blank', 'noopener,noreferrer');
                  }}
                  className="rounded-lg"
                >
                  <Download className="h-4 w-4" />
                  Скачать счёт
                </Button>
                <Button
                  type="button"
                  onClick={markSelectedPaid}
                  disabled={!can('update', 'payments') || selectedPayment.status === 'paid' || updatePayment.isPending}
                  className="rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                >
                  Отметить оплаченным
                </Button>
              </div>
            </div>
          )}
        </aside>
      </div>

      <PaginationControls
        pagination={paymentsQuery.data?.pagination}
        loading={paymentsQuery.isFetching}
        onPageChange={pagination.setPage}
        onPageSizeChange={pagination.setPageSize}
      />
    </div>
  );
}
