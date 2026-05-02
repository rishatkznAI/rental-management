import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import {
  ArrowLeft, Edit, FileText, TrendingUp, Clock, Phone, Mail,
  Building2, MapPin, User, CreditCard, CheckCircle, XCircle,
  AlertTriangle, Download, Plus, Save, Trash2, Upload, X, Wrench,
  ShieldAlert,
} from 'lucide-react';
import { formatDate, formatDateTime, formatCurrency } from '../lib/utils';
import { useClientById, useUpdateClient } from '../hooks/useClients';
import { useGanttData } from '../hooks/useRentals';
import { usePaymentsList } from '../hooks/usePayments';
import { useDocumentsList } from '../hooks/useDocuments';
import { useServiceTicketsList } from '../hooks/useServiceTickets';
import { useDebtCollectionPlans } from '../hooks/useDebtCollectionPlans';
import type { Client, ClientStatus } from '../types';
import { usePermissions } from '../lib/permissions';
import { useAuth } from '../contexts/AuthContext';
import { appendAuditHistory, buildFieldDiffHistory } from '../lib/entity-history';
import { buildClientFinancialSnapshots, buildRentalDebtRows } from '../lib/finance';
import { buildClient360Summary } from '../lib/client360.js';
import {
  debtCollectionActionLabel,
  debtCollectionPriorityLabel,
  debtCollectionStatusLabel,
  isDebtCollectionActionOverdue,
} from '../lib/debtCollectionPlans.js';

// ─── helpers ───────────────────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'default';

const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  active: 'Активен',
  inactive: 'Неактивен',
  blocked: 'Заблокирован',
};

function clientStatusVariant(s?: ClientStatus): BadgeVariant {
  if (s === 'active') return 'success';
  if (s === 'blocked') return 'error';
  return 'default';
}

function debtVariant(debt: number): BadgeVariant {
  if (debt === 0) return 'success';
  if (debt <= 50000) return 'warning';
  return 'error';
}

function debtLabel(debt: number) {
  if (debt === 0) return 'Нет задолженности';
  if (debt <= 50000) return 'Есть задолженность';
  return 'Высокая задолженность';
}

function debtRiskLabel(snapshot: { currentDebt: number; overdueRentals: number; exceededLimit: boolean } | null) {
  if (!snapshot || snapshot.currentDebt <= 0) return 'Низкий риск';
  if (snapshot.exceededLimit || snapshot.overdueRentals > 0) return 'Высокий риск';
  return 'Средний риск';
}

function debtRiskVariant(snapshot: { currentDebt: number; overdueRentals: number; exceededLimit: boolean } | null): BadgeVariant {
  if (!snapshot || snapshot.currentDebt <= 0) return 'success';
  if (snapshot.exceededLimit || snapshot.overdueRentals > 0) return 'error';
  return 'warning';
}

function client360RiskVariant(level: string): BadgeVariant {
  if (level === 'high') return 'error';
  if (level === 'medium') return 'warning';
  return 'success';
}

function paymentStatusVariant(status: string): BadgeVariant {
  if (status === 'Оплачен') return 'success';
  if (status === 'Частично') return 'info';
  if (status === 'Просрочен') return 'error';
  return 'warning';
}

function servicePriorityVariant(priority: string): BadgeVariant {
  const value = priority.toLowerCase();
  if (value === 'critical') return 'error';
  if (value === 'high') return 'warning';
  if (value === 'low') return 'default';
  return 'info';
}

function rentalStatusLabel(status: string) {
  return RENTAL_STATUS_LABELS[status]?.label ?? (status || 'Без статуса');
}

function rentalStatusVariant(status: string): BadgeVariant {
  return RENTAL_STATUS_LABELS[status]?.variant ?? 'default';
}

function normalizeClientName(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function Divider() {
  return <hr className="border-gray-100 dark:border-gray-800" />;
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function Field({ label, value, mono, className }: { label: string; value?: string | null; mono?: boolean; className?: string }) {
  if (!value) return null;
  return (
    <div className={className}>
      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-sm font-medium text-gray-900 dark:text-white ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

const PAYMENT_TERMS_OPTIONS = [
  { value: 'Постоплата 14 дней', label: 'Постоплата 14 дней' },
  { value: 'Постоплата 30 дней', label: 'Постоплата 30 дней' },
  { value: 'Предоплата 100%', label: 'Предоплата 100%' },
  { value: 'Предоплата 50%', label: 'Предоплата 50%' },
  { value: 'Без предоплаты', label: 'Без предоплаты' },
];

const RENTAL_STATUS_LABELS: Record<string, { label: string; variant: BadgeVariant }> = {
  new: { label: 'Новая', variant: 'default' },
  confirmed: { label: 'Подтверждена', variant: 'info' },
  delivery: { label: 'Доставка', variant: 'warning' },
  active: { label: 'Активная', variant: 'success' },
  return_planned: { label: 'Возврат', variant: 'warning' },
  closed: { label: 'Закрыта', variant: 'default' },
};

// ─── main component ────────────────────────────────────────────────────────────

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { user } = useAuth();
  const canEdit = can('edit', 'clients');
  const canEditDebt = user?.role === 'Администратор';

  const { data: fetchedClient } = useClientById(id ?? '');
  const updateClient = useUpdateClient();

  // Local optimistic state
  const [client, setClient] = useState<Client | null>(null);
  React.useEffect(() => {
    if (fetchedClient) setClient(fetchedClient as Client);
  }, [fetchedClient]);

  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<Client>>({});

  // Related data via react-query
  const { data: ganttRentals = [] } = useGanttData();
  const { data: payments = [] } = usePaymentsList();
  const { data: serviceTickets = [] } = useServiceTicketsList();
  const { data: debtPlanResponse } = useDebtCollectionPlans();
  const debtCollectionPlans = debtPlanResponse?.plans ?? [];
  const clientNameKey = normalizeClientName(client?.company);
  const clientRentals = ganttRentals.filter(r =>
    client && (r.clientId === client.id || (!r.clientId && clientNameKey && normalizeClientName(r.client) === clientNameKey)),
  );
  const activeRentals = clientRentals.filter(r => r.status === 'active' || r.status === 'created');

  const { data: allDocs = [] } = useDocumentsList();

  const clientFinancial = React.useMemo(() => {
    if (!client) return null;
    return buildClientFinancialSnapshots([client], ganttRentals, payments)[0] ?? null;
  }, [client, ganttRentals, payments]);
  const rentalDebtRows = useMemo(
    () => buildRentalDebtRows(ganttRentals, payments),
    [ganttRentals, payments],
  );
  const client360 = useMemo(
    () => buildClient360Summary({
      client,
      rentals: ganttRentals,
      rentalDebtRows,
      payments,
      documents: allDocs,
      serviceTickets,
      today: new Date().toISOString().slice(0, 10),
    }),
    [allDocs, client, ganttRentals, payments, rentalDebtRows, serviceTickets],
  );
  const canViewFinance = can('view', 'finance');
  const canViewPayments = can('view', 'payments') || canViewFinance;
  const clientDebtPlan = useMemo(() => {
    if (!client) return null;
    const byId = debtCollectionPlans.find(plan => plan.clientId && plan.clientId === client.id);
    if (byId) return byId;
    const company = normalizeClientName(client.company);
    return debtCollectionPlans.find(plan => !plan.clientId && company && normalizeClientName(plan.clientName) === company) || null;
  }, [client, debtCollectionPlans]);

  const displayedDebt = clientFinancial?.currentDebt ?? client?.debt ?? 0;
  const displayedTotalRentals = clientFinancial?.totalRentals ?? client?.totalRentals ?? 0;
  const displayedActiveRentals = clientFinancial?.activeRentals ?? activeRentals.length;
  const displayedLastRentalDate = clientFinancial?.lastRentalDate ?? client?.lastRentalDate;

  // Persist changes — optimistic + server PATCH
  const persist = useCallback((updated: Client) => {
    setClient(updated);
    updateClient.mutate({ id: updated.id, data: updated });
  }, [updateClient]);

  const startEdit = () => {
    if (!client || !canEdit) return;
    setEditData({ ...client });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditData({});
  };

  const saveEdit = () => {
    if (!client || !canEdit) return;
    const nextClient = {
      ...client,
      ...editData,
      creditLimit: Math.max(0, Number(editData.creditLimit ?? client.creditLimit) || 0),
      debt: canEditDebt
        ? Math.max(0, Number(editData.debt ?? client.debt) || 0)
        : client.debt,
    };
    const historyEntries = buildFieldDiffHistory(
      client,
      nextClient,
      {
        company: 'компания',
        inn: 'ИНН',
        email: 'email',
        address: 'адрес',
        contact: 'контакт',
        phone: 'телефон',
        paymentTerms: 'условия оплаты',
        creditLimit: 'кредитный лимит',
        debt: 'задолженность',
        manager: 'менеджер',
        notes: 'примечание',
        status: 'статус',
      },
      user?.name || 'Система',
      'Обновлён клиент',
    );
    persist(appendAuditHistory(nextClient, ...historyEntries));
    setEditing(false);
    setEditData({});
  };

  async function handlePartnerCardUpload(event: React.ChangeEvent<HTMLInputElement>) {
    if (!client || !canEdit) return;
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const dataUrl = await fileToDataUrl(file);
      const nextClient = appendAuditHistory(
        {
          ...client,
          partnerCardFileName: file.name,
          partnerCardMimeType: file.type || undefined,
          partnerCardDataUrl: dataUrl,
          partnerCardUploadedAt: new Date().toISOString(),
          partnerCardUploadedBy: user?.name || 'Система',
        },
        {
          date: new Date().toISOString(),
          text: `Загружена карта партнёра: ${file.name}`,
          author: user?.name || 'Система',
          type: 'system',
        },
      );
      persist(nextClient);
      toast.success('Карта партнёра сохранена в карточке клиента.');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Не удалось загрузить карту партнёра.');
    }
  }

  function handlePartnerCardDelete() {
    if (!client || !canEdit || !client.partnerCardDataUrl) return;
    const nextClient = appendAuditHistory(
      {
        ...client,
        partnerCardFileName: undefined,
        partnerCardMimeType: undefined,
        partnerCardDataUrl: undefined,
        partnerCardUploadedAt: undefined,
        partnerCardUploadedBy: undefined,
      },
      {
        date: new Date().toISOString(),
        text: 'Удалена карта партнёра',
        author: user?.name || 'Система',
        type: 'system',
      },
    );
    persist(nextClient);
    toast.success('Карта партнёра удалена из карточки клиента.');
  }

  // ── "not found" screen ────────────────────────────────────────────────────

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 gap-4 text-center">
        <XCircle className="h-12 w-12 text-gray-300" />
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Клиент не найден</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Возможно, запись была удалена или ID указан некорректно.
        </p>
        <Button onClick={() => navigate('/clients')}>Вернуться к списку</Button>
      </div>
    );
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Button variant="secondary" onClick={() => navigate('/clients')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{client.company}</h1>
              {client.status && (
                <Badge variant={clientStatusVariant(client.status)}>
                  {CLIENT_STATUS_LABELS[client.status]}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">ИНН: {client.inn}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!editing ? (
            <>
              {canEdit && (
                <Button variant="secondary" onClick={startEdit}>
                  <Edit className="h-4 w-4" />
                  Редактировать
                </Button>
              )}
              <Link to={`/rentals/new?clientId=${encodeURIComponent(client.id)}`}>
                <Button>
                  <Plus className="h-4 w-4" />
                  Новая аренда
                </Button>
              </Link>
            </>
          ) : (
            <>
              <Button onClick={saveEdit}>
                <Save className="h-4 w-4" />
                Сохранить
              </Button>
              <Button variant="secondary" onClick={cancelEdit}>
                <X className="h-4 w-4" />
                Отмена
              </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            Сводка по клиенту
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Компания" value={client.company} />
            <Field label="ИНН" value={client.inn || '—'} mono />
            <Field label="Контактное лицо" value={client.contact || '—'} />
            <Field label="Ответственный менеджер" value={client.manager || 'Не назначен'} />
            <Field label="Телефон" value={client.phone || '—'} />
            <Field label="Email" value={client.email || '—'} />
            <Field label="Условия оплаты" value={client.paymentTerms || '—'} />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">Риск клиента</p>
              <Badge variant={client360RiskVariant(client360.debt.riskLevel)}>{client360.debt.riskLabel}</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
            <Link to={`/rentals/new?clientId=${encodeURIComponent(client.id)}`}>
              <Button size="sm">
                <Plus className="h-4 w-4" />
                Новая аренда
              </Button>
            </Link>
            <Link to="/rentals"><Button variant="secondary" size="sm">Открыть аренды</Button></Link>
            <Link to="/documents"><Button variant="secondary" size="sm">Открыть документы</Button></Link>
            {canViewPayments && <Link to="/payments"><Button variant="secondary" size="sm">Открыть платежи</Button></Link>}
            {canViewFinance && <Link to="/finance"><Button variant="secondary" size="sm">Финансы</Button></Link>}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className={client360.debt.riskLevel === 'high' ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20' : undefined}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4" />
              Риск и задолженность
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!canViewFinance ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Финансовые данные скрыты правами доступа.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Общий долг</p>
                  <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(client360.debt.total)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Просроченный долг</p>
                  <p className={`text-xl font-bold ${client360.debt.overdue > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    {formatCurrency(client360.debt.overdue)}
                  </p>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant={client360RiskVariant(client360.debt.riskLevel)}>{client360.debt.riskLabel} риск</Badge>
              <Badge variant={client360.debt.hasActiveRental ? 'info' : 'default'}>
                {client360.debt.hasActiveRental ? 'Есть активная аренда' : 'Активных аренд нет'}
              </Badge>
              <Badge variant={client360.debt.maxAgeDays > 60 ? 'error' : client360.debt.maxAgeDays > 0 ? 'warning' : 'success'}>
                Возраст долга: {client360.debt.maxAgeDays} дн.
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              Аренды клиента
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-gray-500">Активные</p><p className="text-2xl font-bold">{client360.rentals.active.length}</p></div>
            <div><p className="text-gray-500">Завершённые</p><p className="text-2xl font-bold">{client360.rentals.completed.length}</p></div>
            <div><p className="text-gray-500">Просроченные возвраты</p><p className="text-2xl font-bold text-red-600">{client360.rentals.overdueReturns.length}</p></div>
            <div>
              <p className="text-gray-500">Ближайший возврат</p>
              <p className="text-sm font-semibold">{client360.rentals.nextReturn ? formatDate(client360.rentals.nextReturn.date) : '—'}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4" />
              Красные флаги
            </CardTitle>
          </CardHeader>
          <CardContent>
            {client360.flags.length === 0 ? (
              <p className="text-sm text-green-600 dark:text-green-400">Критичных флагов по клиенту нет.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {client360.flags.map(flag => (
                  <Badge key={flag.id} variant={flag.severity === 'high' ? 'error' : 'warning'}>{flag.label}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Left (2/3) ─────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Main info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4" />
                Основная информация
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {editing ? (
                <div className="space-y-4">
                  <Input label="Наименование компании" value={editData.company ?? ''} onChange={e => setEditData({ ...editData, company: e.target.value })} />
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="ИНН" value={editData.inn ?? ''} onChange={e => setEditData({ ...editData, inn: e.target.value })} />
                    <Input label="Email" type="email" value={editData.email ?? ''} onChange={e => setEditData({ ...editData, email: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Адрес</label>
                    <textarea
                      className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                      rows={2}
                      value={editData.address ?? ''}
                      onChange={e => setEditData({ ...editData, address: e.target.value })}
                      placeholder="Юридический / фактический адрес"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <Field label="Компания" value={client.company} className="col-span-2" />
                  <Field label="ИНН" value={client.inn} mono />
                  <Field label="Email" value={client.email} />
                  {client.address && (
                    <div className="flex items-start gap-1.5 col-span-2">
                      <MapPin className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Адрес</p>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{client.address}</p>
                      </div>
                    </div>
                  )}
                  {client.createdAt && <Field label="Клиент с" value={formatDate(client.createdAt)} />}
                  {client.createdBy && <Field label="Кто создал" value={client.createdBy} />}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Contact */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4" />
                Контакт
              </CardTitle>
            </CardHeader>
            <CardContent>
              {editing ? (
                <div className="space-y-4">
                  <Input label="Контактное лицо" value={editData.contact ?? ''} onChange={e => setEditData({ ...editData, contact: e.target.value })} />
                  <Input label="Телефон" value={editData.phone ?? ''} onChange={e => setEditData({ ...editData, phone: e.target.value })} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Контактное лицо</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{client.contact}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Phone className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Телефон</p>
                      <a href={`tel:${client.phone}`} className="text-sm font-medium text-[--color-primary] hover:underline">
                        {client.phone}
                      </a>
                    </div>
                  </div>
                  {client.email && (
                    <div className="flex items-start gap-2">
                      <Mail className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Email</p>
                        <a href={`mailto:${client.email}`} className="text-sm font-medium text-[--color-primary] hover:underline">
                          {client.email}
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Commercial */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="h-4 w-4" />
                Коммерческие условия
              </CardTitle>
            </CardHeader>
            <CardContent>
              {editing ? (
                <div className="space-y-4">
                  <Select
                    label="Условия оплаты"
                    value={editData.paymentTerms ?? ''}
                    onValueChange={v => setEditData({ ...editData, paymentTerms: v })}
                    options={PAYMENT_TERMS_OPTIONS}
                  />
                  <div className={`grid gap-4 ${canEditDebt ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
                    <div>
                      <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Кредитный лимит, ₽</label>
                      <Input
                        type="number"
                        min={0}
                        value={String(editData.creditLimit ?? 0)}
                        onChange={e => setEditData({ ...editData, creditLimit: Number(e.target.value) })}
                      />
                    </div>
                    {canEditDebt && (
                      <div>
                        <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Ручная дебиторка, ₽</label>
                        <Input
                          type="number"
                          min={0}
                          value={String(editData.debt ?? 0)}
                          onChange={e => setEditData({ ...editData, debt: Number(e.target.value) })}
                        />
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Итоговая задолженность складывается из ручной дебиторки и неоплаченных аренд.
                  </p>
                  <Input
                    label="Ответственный менеджер"
                    value={editData.manager ?? ''}
                    onChange={e => setEditData({ ...editData, manager: e.target.value })}
                  />
                  <div>
                    <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Примечания</label>
                    <textarea
                      className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                      rows={2}
                      value={editData.notes ?? ''}
                      onChange={e => setEditData({ ...editData, notes: e.target.value })}
                      placeholder="Примечания..."
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <Field label="Условия оплаты" value={client.paymentTerms} />
                  {canViewFinance ? (
                    <>
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Кредитный лимит</p>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(client.creditLimit)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Задолженность</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(displayedDebt)}</p>
                          <Badge variant={debtVariant(displayedDebt)}>{debtLabel(displayedDebt)}</Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <Badge variant={debtRiskVariant(clientFinancial)}>{debtRiskLabel(clientFinancial)}</Badge>
                          {clientFinancial && displayedDebt > 0 && (
                            <span>
                              Неоплаченных: {clientFinancial.unpaidRentals}
                              {clientFinancial.overdueRentals > 0 && ` · просроченных: ${clientFinancial.overdueRentals}`}
                            </span>
                          )}
                        </div>
                      </div>
                      {(canEditDebt || (client.debt ?? 0) > 0) && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Ручная дебиторка</p>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(client.debt ?? 0)}</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="col-span-2">
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Финансы</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Финансовые данные скрыты правами доступа.</p>
                    </div>
                  )}
                  {client.manager && <Field label="Менеджер" value={client.manager} />}
                  {client.notes && (
                    <div className="col-span-3">
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Примечания</p>
                      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{client.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="h-4 w-4" />
                План взыскания
                {clientDebtPlan && (
                  <span className="ml-auto text-xs font-normal text-gray-500">{debtCollectionStatusLabel(clientDebtPlan.status)}</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!clientDebtPlan ? (
                <div className="rounded-lg border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  План взыскания по клиенту не создан.
                  {canViewFinance && client360.debt.maxAgeDays >= 30 && (
                    <span className="mt-1 block font-medium text-amber-700 dark:text-amber-300">
                      Есть долг 30+ дней, план взыскания стоит создать в разделе “Финансы”.
                    </span>
                  )}
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Статус" value={debtCollectionStatusLabel(clientDebtPlan.status)} />
                  <Field label="Приоритет" value={debtCollectionPriorityLabel(clientDebtPlan.priority)} />
                  <Field label="Ответственный" value={clientDebtPlan.responsibleName || 'Не назначен'} />
                  <Field label="Последний контакт" value={clientDebtPlan.lastContactDate ? formatDate(clientDebtPlan.lastContactDate) : 'Не указан'} />
                  <Field label="Обещанная оплата" value={clientDebtPlan.promisedPaymentDate ? formatDate(clientDebtPlan.promisedPaymentDate) : 'Не указана'} />
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Следующее действие</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {debtCollectionActionLabel(clientDebtPlan.nextActionType)}
                    </p>
                    <p className={`mt-1 text-xs ${isDebtCollectionActionOverdue(clientDebtPlan) ? 'font-medium text-red-600 dark:text-red-300' : 'text-gray-500 dark:text-gray-400'}`}>
                      {clientDebtPlan.nextActionDate ? formatDate(clientDebtPlan.nextActionDate) : 'Дата не назначена'}
                    </p>
                  </div>
                  {canViewFinance ? (
                    <Field label="Долг по клиенту" value={formatCurrency(client360.debt.total)} />
                  ) : (
                    <Field label="Финансы" value="Финансовые данные скрыты правами доступа." />
                  )}
                  <div className="md:col-span-2">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Комментарий</p>
                    <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{clientDebtPlan.comment || clientDebtPlan.result || 'Комментариев нет'}</p>
                  </div>
                  <div className="md:col-span-2">
                    <Link to="/finance" className="text-sm text-[--color-primary] hover:underline">Открыть план в Финансах</Link>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Rentals */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4" />
                Аренды клиента
                {client360.rentals.latest.length > 0 && (
                  <span className="ml-auto text-xs font-normal text-gray-500">{clientRentals.length} аренд</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {client360.rentals.latest.length === 0 ? (
                <p className="text-sm text-gray-400 italic">Аренд не найдено</p>
              ) : (
                <div className="space-y-3">
                  {client360.rentals.latest.map((rental) => {
                    return (
                      <div
                        key={rental.id}
                        className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-blue-400 cursor-pointer transition-colors"
                        onClick={() => navigate(`/rentals/${rental.id}`)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-medium text-gray-900 dark:text-white text-sm">{rental.id}</p>
                              <Badge variant={rentalStatusVariant(rental.status)}>{rentalStatusLabel(rental.status)}</Badge>
                            </div>
                            <p className="text-xs text-gray-500 truncate">{rental.equipment || '—'}</p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {formatDate(rental.startDate)} — {formatDate(rental.endDate)}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-semibold text-sm text-gray-900 dark:text-white">
                              {canViewFinance ? formatCurrency(rental.amount || 0) : 'Сумма скрыта'}
                            </p>
                            <p className="text-xs text-gray-500">{rental.manager || '—'}</p>
                            <Link to={`/rentals/${rental.id}`} className="mt-1 inline-block text-xs text-[--color-primary] hover:underline" onClick={event => event.stopPropagation()}>
                              Открыть аренду
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Документы
                {client360.documents.total > 0 && (
                  <span className="ml-auto text-xs font-normal text-gray-500">
                    {client360.documents.total} · без подписи {client360.documents.unsigned}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {client360.documents.latest.length === 0 ? (
                <p className="text-sm text-gray-400 italic">Документов не найдено</p>
              ) : (
                <div className="space-y-2">
                  {client360.documents.latest.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{doc.type}</p>
                        <p className="text-xs text-gray-400">{formatDate(doc.date)} · {doc.rental}</p>
                        <Link to="/documents" className="text-xs text-[--color-primary] hover:underline">Открыть документы</Link>
                      </div>
                      <Badge variant={doc.rawStatus === 'signed' ? 'success' : doc.rawStatus === 'sent' ? 'info' : 'default'}>{doc.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="h-4 w-4" />
                Платежи клиента
                {canViewPayments && client360.payments.total > 0 && (
                  <span className="ml-auto text-xs font-normal text-gray-500">{client360.payments.total}</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!canViewPayments ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">Платежи и суммы скрыты правами доступа.</p>
              ) : client360.payments.latest.length === 0 ? (
                <p className="text-sm text-gray-400 italic">Платежей не найдено</p>
              ) : (
                <div className="space-y-2">
                  {client360.payments.latest.map(payment => (
                    <div key={payment.id || payment.invoiceNumber} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{payment.invoiceNumber || payment.id}</p>
                        <p className="text-xs text-gray-400">{formatDate(payment.date)} · {payment.rentalId}</p>
                        <Link to="/payments" className="text-xs text-[--color-primary] hover:underline">Открыть платежи</Link>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatCurrency(payment.amount)}</p>
                        <Badge variant={paymentStatusVariant(payment.status)}>{payment.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wrench className="h-4 w-4" />
                Сервис по клиенту
                {client360.service.total > 0 && (
                  <span className="ml-auto text-xs font-normal text-gray-500">
                    {client360.service.total} · открытых {client360.service.open}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {client360.service.latest.length === 0 ? (
                <p className="text-sm text-gray-400 italic">Надёжно связанных сервисных заявок не найдено.</p>
              ) : (
                <div className="space-y-2">
                  {client360.service.latest.map(ticket => (
                    <div key={ticket.id} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{ticket.equipment}</p>
                        <p className="text-xs text-gray-400">{formatDate(ticket.date)} · {ticket.status}</p>
                        <Link to={`/service/${ticket.id}`} className="text-xs text-[--color-primary] hover:underline">Открыть заявку</Link>
                      </div>
                      <Badge variant={servicePriorityVariant(ticket.priority)}>{ticket.priority}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Карта партнёра
              </CardTitle>
              {canEdit ? (
                <label>
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
                    onChange={handlePartnerCardUpload}
                  />
                  <span className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700">
                    <Upload className="h-4 w-4" />
                    {client.partnerCardDataUrl ? 'Заменить файл' : 'Загрузить файл'}
                  </span>
                </label>
              ) : null}
            </CardHeader>
            <CardContent>
              {!client.partnerCardDataUrl ? (
                <p className="text-sm text-gray-400 italic">Карта партнёра ещё не загружена</p>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                          {client.partnerCardFileName || 'Карта партнёра'}
                        </p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <Field label="Загружен" value={client.partnerCardUploadedAt ? formatDateTime(client.partnerCardUploadedAt) : '—'} />
                          <Field label="Кто загрузил" value={client.partnerCardUploadedBy || '—'} />
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => downloadDataUrl(client.partnerCardDataUrl!, client.partnerCardFileName || 'partner-card')}
                        >
                          <Download className="h-4 w-4" />
                          Скачать
                        </Button>
                        {canEdit ? (
                          <Button variant="secondary" onClick={handlePartnerCardDelete}>
                            <Trash2 className="h-4 w-4" />
                            Удалить
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {client.partnerCardMimeType?.startsWith('image/') ? (
                    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
                      <img
                        src={client.partnerCardDataUrl}
                        alt={client.partnerCardFileName || 'Карта партнёра'}
                        className="max-h-[420px] w-full object-contain"
                      />
                    </div>
                  ) : client.partnerCardMimeType === 'application/pdf' ? (
                    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
                      <iframe
                        src={client.partnerCardDataUrl}
                        title={client.partnerCardFileName || 'Карта партнёра'}
                        className="h-[520px] w-full"
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Предпросмотр для этого формата не поддерживается, но файл сохранён в карточке клиента и доступен для скачивания.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right (1/3) ─────────────────────────────────────────────────── */}
        <div className="space-y-6">

          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4" />
                Статистика
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Всего аренд</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {clientRentals.length || displayedTotalRentals}
                </p>
              </div>
              <Divider />
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Активных аренд</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{displayedActiveRentals}</p>
              </div>
              {canViewFinance && displayedDebt > 0 && (
                <>
                  <Divider />
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Задолженность</p>
                    <p className="text-xl font-bold text-red-600">{formatCurrency(displayedDebt)}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" />
                Активность
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field
                label="Последняя аренда"
                value={displayedLastRentalDate ? formatDate(displayedLastRentalDate) : '—'}
              />
              {client.createdAt && (
                <>
                  <Divider />
                  <Field label="Клиент с" value={formatDate(client.createdAt)} />
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" />
                История изменений
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(client.history || []).length === 0 ? (
                <p className="text-sm text-gray-400 italic">История пока пуста</p>
              ) : (
                <div className="space-y-3">
                  {[...(client.history || [])]
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .map((entry, idx) => (
                      <div key={`${entry.date}-${idx}`} className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
                        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                          <span className="font-medium">{entry.author}</span>
                          <span>{formatDateTime(entry.date)}</span>
                        </div>
                        <p className="mt-1.5 text-sm text-gray-700 dark:text-gray-300">{entry.text}</p>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Debt alert */}
          {canViewFinance && displayedDebt > 50000 && (
            <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  <p className="text-sm font-semibold text-red-800 dark:text-red-200">Высокая задолженность</p>
                </div>
                <p className="text-xs text-red-600 dark:text-red-300">
                  Задолженность {formatCurrency(displayedDebt)} превышает допустимый порог. Рекомендуется связаться с клиентом.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Active rentals quick view */}
          {activeRentals.length > 0 && (
            <Card className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/10">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-4 w-4 text-blue-600" />
                  <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                    {activeRentals.length} активных {activeRentals.length === 1 ? 'аренда' : 'аренды'}
                  </p>
                </div>
                {activeRentals.slice(0, 2).map(r => (
                  <p key={r.id} className="text-xs text-blue-600 cursor-pointer hover:underline" onClick={() => navigate('/rentals')}>
                    {r.id} · {r.equipmentInv || '—'}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
