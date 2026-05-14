import React, { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { ClientCombobox } from '../components/ui/ClientCombobox';
import { getPaymentStatusBadge } from '../components/ui/badge';
import { Search, Plus, X, DollarSign, AlertTriangle, CheckCircle, Clock, TrendingDown, Wand2, Trash2, Edit2, ListChecks } from 'lucide-react';
import { FilterButton, FilterDialog, FilterField } from '../components/ui/filter-dialog';
import { usePermissions } from '../lib/permissions';
import {
  PAYMENT_KEYS,
  useCreatePayment,
  useCreatePaymentAllocation,
  useDeletePaymentAllocation,
  usePaymentAllocationsList,
  usePaymentsList,
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
  matchesClientContext,
  normalizeContextName,
} from '../lib/quickActionContext.js';
import { animationDurations, useAnimatedPresence } from '../lib/animations';

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

  if (!presence.shouldRender) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div data-state={presence.dataState} className="app-animate-overlay absolute inset-0 bg-slate-950/45 backdrop-blur-[3px] dark:bg-black/60" onClick={onClose} />
      <div data-state={presence.dataState} onAnimationEnd={presence.onExitAnimationEnd} className="app-animate-modal fixed left-1/2 top-1/2 z-10 flex max-h-[min(92dvh,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-0 shadow-[0_32px_90px_-46px_rgba(15,23,42,0.72)] dark:border-gray-800 dark:bg-gray-950 dark:shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-6 py-5 pr-14 dark:border-gray-800">
          <div>
            <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Добавить платёж</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-gray-400">Свяжите оплату с клиентом и, при необходимости, с арендой.</p>
          </div>
          <button onClick={onClose} className="absolute right-4 top-4 inline-flex size-9 items-center justify-center rounded-xl border border-transparent text-slate-400 transition hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700 dark:text-gray-500 dark:hover:border-gray-800 dark:hover:bg-gray-900 dark:hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {formError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
              {formError}
            </div>
          )}
          {/* Rental link */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Аренда (необязательно)
            </label>
            <select
              value={form.rentalId}
              onChange={e => set('rentalId', e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/15 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:focus:border-blue-400"
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
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{clientError}</p>
            )}
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
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/15 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:focus:border-blue-400"
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
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/15 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:focus:border-blue-400"
            />
          </div>

          </div>
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 bg-white/95 px-6 py-4 sm:flex-row dark:border-gray-800 dark:bg-gray-950/95">
            <Button type="button" variant="secondary" onClick={onClose}>Отмена</Button>
            <Button type="submit" className="flex-1">Сохранить платёж</Button>
          </div>
        </form>
      </div>
    </div>
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
    <div className="rounded-lg border border-blue-200 bg-white p-4 shadow-sm dark:border-blue-900/60 dark:bg-gray-900">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Распределение оплаты</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{payment.invoiceNumber || payment.id} · {payment.client}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /> Закрыть</Button>
      </div>

      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
      {message && <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300">{message}</div>}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"><p className="text-xs text-gray-500">Сумма платежа</p><p className="font-semibold">{formatCurrency(payment.amount)}</p></div>
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"><p className="text-xs text-gray-500">Распределено</p><p className="font-semibold text-green-600">{formatCurrency(allocated)}</p></div>
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"><p className="text-xs text-gray-500">Не распределено</p><p className="font-semibold text-orange-600">{formatCurrency(unallocated)}</p></div>
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"><p className="text-xs text-gray-500">Статус</p><p className="font-semibold">{allocationStatus}</p></div>
      </div>
      {unallocated > 0 && (
        <div className="mt-3 flex gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Часть платежа не распределена и не закрывает долг по арендам.</span>
        </div>
      )}

      <div className="mt-5 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
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

      <div className="mt-5 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-semibold text-gray-900 dark:text-white">{draft.id ? 'Изменить распределение' : 'Добавить распределение'}</h3>
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
        <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
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
                <div key={row.rentalId} className="grid gap-2 rounded-lg border border-gray-200 p-3 text-sm md:grid-cols-[1fr_150px] dark:border-gray-700">
                  <div className="flex gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={money(selectedDebt[row.rentalId]) > 0}
                      onChange={event => setSelectedDebt(current => ({
                        ...current,
                        [row.rentalId]: event.target.checked ? String(Math.min(row.outstanding, unallocated)) : '',
                      }))}
                    />
                    <div>
                    <p className="font-medium">{payment.client} → {objectName} → {contractNumber} → {row.rentalId}</p>
                    <p className="text-gray-500">{rental?.equipmentInv || row.equipmentInv} · {row.startDate} — {row.endDate} · менеджер {row.manager || '—'} · документ {doc?.number || doc?.id || '—'}</p>
                    <p className="text-gray-500">Начислено {formatCurrency(row.amount)} · оплачено {formatCurrency(row.paidAmount)} · долг {formatCurrency(row.outstanding)} · просрочка {overdueDays > 0 ? `${overdueDays} дн.` : 'нет'}</p>
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
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/20">
          <h3 className="mb-3 font-semibold text-blue-950 dark:text-blue-100">Предпросмотр автозачёта</h3>
          <div className="space-y-2">
            {preview.map((item, index) => (
              <div key={`${item.rentalId}-${index}`} className="rounded-lg bg-white p-3 text-sm dark:bg-gray-900">
                <div className="flex justify-between gap-3"><span>{item.rentalId} · {objectsById.get(text(item.objectId))?.name || 'объект'} · {contractsById.get(text(item.contractId))?.number || 'договор'}</span><b>{formatCurrency(item.amount || 0)}</b></div>
                <p className="mt-1 text-xs text-gray-500">Причина выбора: {item.reason || 'правило автозачёта'}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
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
  const { data: paymentList = [] } = usePaymentsList();
  const { data: paymentAllocations = [] } = usePaymentAllocationsList();
  const { data: ganttRentals = [] } = useGanttData();
  const { data: clients = [] } = useClientsList();
  const { data: clientObjects = [] } = useClientObjectsList();
  const { data: clientContracts = [] } = useClientContractsList();
  const { data: documents = [] } = useDocumentsList();
  const createPayment = useCreatePayment();
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [clientFilter, setClientFilter] = React.useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedPaymentId, setSelectedPaymentId] = useState('');
  const quickActionContext = React.useMemo(() => buildQuickActionContext(searchParams), [searchParams]);
  const hasQuickClientContext = hasClientContext(quickActionContext);
  const clientsById = useMemo(() => new Map(clients.map(client => [client.id, client])), [clients]);

  React.useEffect(() => {
    if (!hasQuickClientContext) return;
    if (quickActionContext.clientId && clientsById.has(quickActionContext.clientId)) {
      setClientFilter(quickActionContext.clientId);
      return;
    }
    const wantedName = normalizeContextName(quickActionContext.clientName);
    if (!wantedName) return;
    const client = clients.find(item => normalizeContextName(item.company) === wantedName);
    if (client) setClientFilter(client.id);
  }, [clients, clientsById, hasQuickClientContext, quickActionContext.clientId, quickActionContext.clientName]);

  const filteredPayments = useMemo(() => paymentList.filter(p => {
    const q = search.toLowerCase();
    const selectedClient = clientFilter !== 'all' ? clientsById.get(clientFilter) : undefined;
    const clientContext = selectedClient
      ? { clientId: selectedClient.id, clientName: selectedClient.company }
      : quickActionContext;
    const matchesSearch = !search ||
      p.invoiceNumber.toLowerCase().includes(q) ||
      p.client.toLowerCase().includes(q) ||
      p.rentalId?.toLowerCase().includes(q) ||
      p.comment?.toLowerCase().includes(q);
    const matchesClient = matchesClientContext({
      clientId: p.clientId,
      clientName: p.client,
    }, clientContext);
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesClient && matchesStatus;
  }), [clientFilter, clientsById, paymentList, quickActionContext, search, statusFilter]);

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
  const rentalDebtRows = useMemo(() => buildRentalDebtRows(ganttRentals as GanttRentalData[], paymentList, paymentAllocations), [ganttRentals, paymentAllocations, paymentList]);
  const clientReceivables = useMemo(() => buildClientReceivables(clients, rentalDebtRows), [clients, rentalDebtRows]);
  const selectedPayment = useMemo(
    () => paymentList.find(payment => payment.id === selectedPaymentId),
    [paymentList, selectedPaymentId],
  );
  const overdueDebtRentals = useMemo(
    () => rentalDebtRows.filter(row => {
      const today = new Date().toISOString().slice(0, 10);
      return (row.expectedPaymentDate && row.expectedPaymentDate < today) || row.endDate < today;
    }),
    [rentalDebtRows],
  );
  const activeFilterCount = [
    search.trim() !== '',
    clientFilter !== 'all' || hasQuickClientContext,
    statusFilter !== 'all',
  ].filter(Boolean).length;

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <AddPaymentModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSave={handleAddPayment}
        existing={paymentList}
        rentals={ganttRentals as GanttRentalData[]}
        clients={clients}
        allPayments={paymentList}
      />

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

      <div className="flex justify-end">
        <FilterButton activeCount={activeFilterCount} onClick={() => setShowFilters(true)} />
      </div>

      {selectedPayment && (
        <PaymentAllocationPanel
          payment={selectedPayment}
          allPayments={paymentList}
          allocations={paymentAllocations}
          rentals={ganttRentals as GanttRentalData[]}
          objects={clientObjects}
          contracts={clientContracts}
          documents={documents}
          onClose={() => setSelectedPaymentId('')}
        />
      )}

      <FilterDialog
        open={showFilters}
        onOpenChange={setShowFilters}
        title="Фильтры платежей"
        description="Поиск по счёту, клиенту, аренде и статусу оплаты."
        onReset={() => {
          setSearch('');
          setClientFilter('all');
          setStatusFilter('all');
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <FilterField label="Поиск" className="md:col-span-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Поиск по счёту, клиенту, аренде..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="app-filter-input pl-10"
              />
            </div>
          </FilterField>
          <FilterField label="Клиент">
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
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
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="app-filter-input"
            >
              <option value="all">Все статусы</option>
              <option value="paid">Оплачено</option>
              <option value="partial">Частично</option>
              <option value="pending">Не оплачено</option>
              <option value="overdue">Просрочено</option>
            </select>
          </FilterField>
        </div>
      </FilterDialog>

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
              <TableHead>Распределение</TableHead>
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
                  <TableCell>
                    <Button size="sm" variant={selectedPayment?.id === payment.id ? 'default' : 'secondary'} onClick={() => setSelectedPaymentId(payment.id)}>
                      Открыть
                    </Button>
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
              {paymentList.length === 0
                ? 'Платежей ещё нет'
                : hasQuickClientContext || clientFilter !== 'all'
                  ? 'Платежи по клиенту не найдены'
                  : 'Платежи не найдены'}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {paymentList.length === 0
                ? 'Добавьте первый платёж по аренде'
                : hasQuickClientContext || clientFilter !== 'all'
                  ? `Для ${contextFilterLabel(clientFilter !== 'all'
                    ? { clientId: clientFilter, clientName: clientsById.get(clientFilter)?.company }
                    : quickActionContext)} нет платежей по выбранным фильтрам`
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
