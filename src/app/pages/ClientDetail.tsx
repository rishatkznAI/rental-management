import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  ArrowLeft, Edit, FileText, TrendingUp, Clock, Phone, Mail,
  Building2, MapPin, User, CreditCard, CheckCircle, XCircle,
  AlertTriangle, Download, Plus, Save, Trash2, Upload, X, Wrench,
  ShieldAlert, MoreHorizontal, Printer, Paperclip,
  Star, CalendarDays, ReceiptText, BriefcaseBusiness, MapPinned,
} from 'lucide-react';
import { cn, formatDate, formatDateTime, formatCurrency } from '../lib/utils';
import { useClientById, useDeleteClient, useUpdateClient } from '../hooks/useClients';
import { useGanttData, useRentalsList } from '../hooks/useRentals';
import { usePaymentAllocationsList, usePaymentsList } from '../hooks/usePayments';
import { useDocumentsList } from '../hooks/useDocuments';
import { useServiceTicketsList } from '../hooks/useServiceTickets';
import { useDebtCollectionPlans } from '../hooks/useDebtCollectionPlans';
import { useCrmActivities } from '../hooks/useCrmActivities';
import { useClientContractsList, useClientObjectsList, useCreateClientContract, useCreateClientObject, useUpdateClientObject } from '../hooks/useClientRelations';
import type { Client, ClientStatus } from '../types';
import { ApiError } from '../lib/api';
import { isCrmEnabled } from '../lib/features';
import { usePermissions } from '../lib/permissions';
import { useAuth } from '../contexts/AuthContext';
import { appendAuditHistory, buildFieldDiffHistory } from '../lib/entity-history';
import { buildClientFinancialSnapshots, buildRentalDebtRows } from '../lib/finance';
import { getRentalBillingAmount } from '../lib/rentalDowntimeFlow.js';
import { buildClient360Summary } from '../lib/client360.js';
import { buildClientQuickActions } from '../lib/quickActions.js';
import { resolveRentalNavigationId } from '../lib/rentalNavigation.js';
import {
  debtCollectionActionLabel,
  debtCollectionPriorityLabel,
  debtCollectionStatusLabel,
  isDebtCollectionActionOverdue,
} from '../lib/debtCollectionPlans.js';
import {
  appendClientContact,
  appendClientNote,
  validateClientContactDraft,
  validateClientNoteDraft,
} from '../lib/clientRailActions.js';

// ─── helpers ───────────────────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'default';

const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  active: 'Активный',
  inactive: 'Архив',
  blocked: 'Проблемный',
  new: 'Новый',
};

function clientStatusVariant(s?: ClientStatus): BadgeVariant {
  if (s === 'active') return 'success';
  if (s === 'blocked') return 'error';
  if (s === 'new') return 'info';
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

function getDuplicateClient(error: unknown): { id?: string; company?: string } | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body as { code?: string; conflictClient?: { id?: string; company?: string } } | undefined;
  if (body?.code !== 'CLIENT_INN_DUPLICATE') return null;
  return body.conflictClient || {};
}

type ClientDeleteBlockedRental = {
  id?: string;
  rentalId?: string;
  equipmentId?: string;
  equipmentInv?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
};

type ClientDeleteHistoryLink = {
  collection: string;
  count: number;
};

type ClientContactDraft = {
  name: string;
  role: string;
  phone: string;
  email: string;
  comment: string;
};

type ClientFileDraft = {
  title: string;
  comment: string;
  file: File | null;
};

const emptyContactDraft: ClientContactDraft = {
  name: '',
  role: '',
  phone: '',
  email: '',
  comment: '',
};

const emptyFileDraft: ClientFileDraft = {
  title: '',
  comment: '',
  file: null,
};

function getClientDeleteConflict(error: unknown): { message: string; rentals: ClientDeleteBlockedRental[] } | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body as { error?: string; message?: string; rentals?: ClientDeleteBlockedRental[] } | undefined;
  if (body?.error !== 'CLIENT_HAS_RENTALS') return null;
  return {
    message: body.message || 'Нельзя удалить клиента, потому что у него есть связанные аренды',
    rentals: Array.isArray(body.rentals) ? body.rentals : [],
  };
}

function getClientHistoryConflict(error: unknown): { message: string; links: ClientDeleteHistoryLink[] } | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body as { error?: string; message?: string; links?: ClientDeleteHistoryLink[] } | undefined;
  if (body?.error !== 'CLIENT_HAS_HISTORY') return null;
  return {
    message: body.message || 'У клиента есть исторические связи. Переведите клиента в неактивный статус вместо удаления.',
    links: Array.isArray(body.links) ? body.links : [],
  };
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

const profileCardHeaderClassName = 'flex flex-row items-start justify-between gap-3 pb-0';
const profileCardTitleClassName = 'flex min-h-6 items-center gap-2 text-base font-semibold leading-6 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0';
const profileCardContentClassName = 'pt-0';
const profileFieldGridClassName = 'grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3';
const profileRailHeaderClassName = 'flex flex-row items-center justify-between gap-3 pb-0';
const profileRailContentClassName = 'space-y-3 pt-0';

function Field({
  label,
  value,
  mono,
  className,
  hideWhenEmpty = false,
}: {
  label: string;
  value?: React.ReactNode;
  mono?: boolean;
  className?: string;
  hideWhenEmpty?: boolean;
}) {
  const isEmpty = value === undefined || value === null || value === '';
  if (hideWhenEmpty && isEmpty) return null;
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <div className={cn(
        'min-h-5 break-words text-sm font-medium leading-5 text-gray-950 dark:text-white',
        mono && 'font-mono',
        isEmpty && 'font-normal text-gray-400 dark:text-gray-500',
      )}>
        {isEmpty ? '—' : value}
      </div>
    </div>
  );
}

const editInputClassName = 'h-11 rounded-xl border-blue-200 bg-white text-gray-950 shadow-sm focus-visible:border-blue-500 focus-visible:ring-blue-500/20 dark:border-blue-900/70 dark:bg-gray-950 dark:text-white dark:focus-visible:border-blue-400';
const editTextareaClassName = 'min-h-[92px] rounded-xl border-blue-200 bg-white text-gray-950 shadow-sm focus-visible:border-blue-500 focus-visible:ring-blue-500/20 dark:border-blue-900/70 dark:bg-gray-950 dark:text-white dark:focus-visible:border-blue-400';
const editSelectClassName = 'h-11 w-full rounded-xl border border-blue-200 bg-white px-3 text-sm text-gray-950 shadow-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 dark:border-blue-900/70 dark:bg-gray-950 dark:text-white dark:focus:border-blue-400';

function EditField({
  label,
  children,
  hint,
  readonly = false,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  readonly?: boolean;
}) {
  return (
    <label className={cn(
      'block rounded-2xl border p-3',
      readonly
        ? 'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/60'
        : 'border-blue-100 bg-blue-50/40 dark:border-blue-900/60 dark:bg-blue-950/20',
    )}>
      <span className={cn(
        'mb-1.5 block text-xs font-semibold uppercase tracking-wide',
        readonly ? 'text-gray-500 dark:text-gray-400' : 'text-blue-700 dark:text-blue-300',
      )}>
        {label}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-gray-500 dark:text-gray-400">{hint}</span>}
    </label>
  );
}

function ReadonlyEditValue({ value }: { value?: React.ReactNode }) {
  return (
    <span className="block min-h-11 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
      {value || 'Не указано'}
    </span>
  );
}

function getInitials(value?: string | null) {
  const words = String(value || '')
    .replace(/[«»"]/g, ' ')
    .split(/\s+/)
    .filter(word => word && !/^(ооо|ао|пао|ип|зао)$/iu.test(word));
  const initials = words.slice(0, 2).map(word => word[0]).join('').toUpperCase();
  return initials || 'КЛ';
}

function clientTypeLabel(client: Client) {
  if (client.clientType === 'individual_entrepreneur') return 'ИП';
  if (client.clientType === 'individual') return 'Физлицо';
  if (client.clientType === 'legal') return 'Юридическое лицо';
  const innLength = normalizeInn(client.inn).length;
  if (innLength === 12) return 'ИП';
  return 'Юридическое лицо';
}

function StatTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'danger' | 'success';
}) {
  return (
    <div className="flex min-h-[116px] flex-col justify-between rounded-2xl border border-gray-100 bg-white/80 p-4 shadow-[0_14px_34px_-30px_rgba(15,23,42,0.5)] dark:border-gray-800 dark:bg-gray-900/60">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <div
        className={cn(
          'mt-4 text-2xl font-bold leading-none text-gray-950 dark:text-white',
          tone === 'danger' && 'text-red-600 dark:text-red-300',
          tone === 'success' && 'text-emerald-600 dark:text-emerald-300',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function InfoPill({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: string | null }) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-gray-100 bg-gray-50/80 p-3.5 dark:border-gray-800 dark:bg-gray-900/60">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm dark:bg-gray-800 dark:text-blue-300">
        <Icon className="h-4 w-4" />
      </span>
      <Field label={label} value={value} />
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
const CLIENT_TYPE_OPTIONS = [
  { value: 'legal', label: 'Юридическое лицо' },
  { value: 'individual_entrepreneur', label: 'ИП' },
  { value: 'individual', label: 'Физлицо' },
];
const CLIENT_STATUS_OPTIONS: Array<{ value: ClientStatus; label: string }> = [
  { value: 'active', label: CLIENT_STATUS_LABELS.active },
  { value: 'new', label: CLIENT_STATUS_LABELS.new },
  { value: 'blocked', label: CLIENT_STATUS_LABELS.blocked },
  { value: 'inactive', label: CLIENT_STATUS_LABELS.inactive },
];
const INN_ERROR = 'Укажите корректный ИНН: 10 цифр для юрлица или 12 цифр для ИП';

function normalizeInn(value?: string | null) {
  return String(value || '').replace(/\D+/g, '');
}

function isValidInn(value?: string | null) {
  const normalized = normalizeInn(value);
  return normalized.length === 10 || normalized.length === 12;
}

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
  const canDelete = user?.role === 'Администратор' && can('delete', 'clients');
  const canEditDebt = user?.role === 'Администратор';
  const canCreateRentals = can('create', 'rentals');
  const canViewRentals = can('view', 'rentals');

  const { data: fetchedClient } = useClientById(id ?? '');
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();

  // Local optimistic state
  const [client, setClient] = useState<Client | null>(null);
  React.useEffect(() => {
    if (fetchedClient) setClient(fetchedClient as Client);
  }, [fetchedClient]);

  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<Client>>({});
  const [duplicateClient, setDuplicateClient] = useState<{ id?: string; company?: string } | null>(null);
  const [innError, setInnError] = useState('');
  const [deleteBlockedRentals, setDeleteBlockedRentals] = useState<ClientDeleteBlockedRental[]>([]);
  const [deleteHistoryLinks, setDeleteHistoryLinks] = useState<ClientDeleteHistoryLink[]>([]);
  const [objectForm, setObjectForm] = useState({ name: '', address: '', contactName: '', contactPhone: '', notes: '' });
  const [editingObjectId, setEditingObjectId] = useState('');
  const [editObjectForm, setEditObjectForm] = useState({ name: '', address: '', contactName: '', contactPhone: '', notes: '' });
  const [contractForm, setContractForm] = useState({ number: '', date: '', title: '', objectId: '', notes: '' });
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [contactDraft, setContactDraft] = useState<ClientContactDraft>(emptyContactDraft);
  const [contactErrors, setContactErrors] = useState<Record<string, string>>({});
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteError, setNoteError] = useState('');
  const [fileDialogOpen, setFileDialogOpen] = useState(false);
  const [fileDraft, setFileDraft] = useState<ClientFileDraft>(emptyFileDraft);
  const [fileError, setFileError] = useState('');
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // Related data via react-query
  const { data: rentals = [] } = useRentalsList({ enabled: canViewRentals });
  const { data: ganttRentals = [] } = useGanttData();
  const { data: payments = [] } = usePaymentsList();
  const { data: paymentAllocations = [] } = usePaymentAllocationsList();
  const { data: serviceTickets = [] } = useServiceTicketsList();
  const { data: clientObjectsAll = [] } = useClientObjectsList();
  const { data: clientContractsAll = [] } = useClientContractsList();
  const createClientObject = useCreateClientObject();
  const updateClientObject = useUpdateClientObject();
  const createClientContract = useCreateClientContract();
  const { data: debtPlanResponse } = useDebtCollectionPlans();
  const { data: crmActivities = [] } = useCrmActivities(client ? { clientId: client.id } : undefined, Boolean(isCrmEnabled && client && can('view', 'crm')));
  const debtCollectionPlans = debtPlanResponse?.plans ?? [];
  const clientNameKey = normalizeClientName(client?.company);
  const clientRentals = ganttRentals.filter(r =>
    client && (r.clientId === client.id || (!r.clientId && clientNameKey && normalizeClientName(r.client) === clientNameKey)),
  );
  const activeRentals = clientRentals.filter(r => r.status === 'active' || r.status === 'created');

  const { data: allDocs = [] } = useDocumentsList();
  const clientObjects = useMemo(
    () => clientObjectsAll.filter(item => client && item.clientId === client.id),
    [client, clientObjectsAll],
  );
  const clientContracts = useMemo(
    () => clientContractsAll.filter(item => client && item.clientId === client.id),
    [client, clientContractsAll],
  );
  const activeClientObjects = clientObjects.filter(item => item.status !== 'archived');

  const clientFinancial = React.useMemo(() => {
    if (!client) return null;
    return buildClientFinancialSnapshots([client], ganttRentals, payments, paymentAllocations)[0] ?? null;
  }, [client, ganttRentals, paymentAllocations, payments]);
  const rentalDebtRows = useMemo(
    () => buildRentalDebtRows(ganttRentals, payments, paymentAllocations),
    [ganttRentals, paymentAllocations, payments],
  );
  const debtByObject = useMemo(() => {
    if (!client) return [];
    const objectsById = new Map(clientObjects.map(object => [object.id, object]));
    const groups = new Map<string, { objectId?: string; objectName: string; debt: number; rentals: number }>();
    rentalDebtRows
      .filter(row => row.clientId === client.id)
      .forEach(row => {
        const objectId = String((row as { objectId?: string }).objectId || '');
        const object = objectId ? objectsById.get(objectId) : null;
        const key = objectId || 'none';
        const current = groups.get(key) || {
          objectId: objectId || undefined,
          objectName: object?.name || 'Без объекта',
          debt: 0,
          rentals: 0,
        };
        current.debt += row.outstanding || 0;
        current.rentals += 1;
        groups.set(key, current);
      });
    return [...groups.values()].sort((a, b) => b.debt - a.debt);
  }, [client, clientObjects, rentalDebtRows]);
  const unallocatedClientPayments = useMemo(() => {
    if (!client) return 0;
    return payments
      .filter(payment => payment.clientId === client.id)
      .reduce((sum, payment) => {
        const paid = typeof payment.paidAmount === 'number' ? Math.max(0, payment.paidAmount) : (payment.status === 'paid' ? Math.max(0, payment.amount) : 0);
        const cap = payment.amount > 0 ? Math.min(paid, payment.amount) : paid;
        const allocated = paymentAllocations
          .filter(item => item.paymentId === payment.id && item.status !== 'cancelled')
          .reduce((inner, item) => inner + Math.max(0, Number(item.amount) || 0), 0);
        return sum + Math.max(0, cap - allocated);
      }, 0);
  }, [client, paymentAllocations, payments]);
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
  const quickActions = useMemo(
    () => buildClientQuickActions({ client, can, role: user?.role }),
    [can, client, user?.role],
  );
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
  const primaryContacts = useMemo(() => {
    const contacts = Array.isArray(client?.contacts) ? client.contacts : [];
    const rows = contacts
      .filter(item => item?.name || item?.phone || item?.email)
      .slice(0, 3);
    if (rows.length > 0) return rows;
    return [{
      name: client?.contact || 'Контакт не указан',
      role: client?.clientType === 'individual_entrepreneur' ? 'ИП' : 'Контактное лицо',
      phone: client?.phone,
      email: client?.email,
    }];
  }, [client]);
  const visibleFiles = useMemo(() => {
    const files = [];
    if (client?.partnerCardDataUrl) {
      files.push({
        id: 'partner-card',
        title: client.partnerCardFileName || 'Карта партнёра',
        meta: [
          client.partnerCardMimeType || 'Файл',
          client.partnerCardUploadedAt ? formatDate(client.partnerCardUploadedAt) : '',
        ].filter(Boolean).join(' · '),
      });
    }
    client360.documents.latest.slice(0, 2).forEach(doc => {
      files.push({
        id: doc.id,
        title: doc.type || 'Документ',
        meta: [doc.status, doc.date ? formatDate(doc.date) : ''].filter(Boolean).join(' · '),
      });
    });
    return files.slice(0, 3);
  }, [client, client360.documents.latest]);
  const recentActivity = useMemo(() => {
    const crmRows = isCrmEnabled
      ? crmActivities.slice(0, 3).map(activity => ({
        id: activity.id,
        title: `${activity.type === 'call' ? 'Звонок' : activity.type === 'visit' ? 'Выезд' : activity.type === 'commercial_offer' ? 'КП' : 'CRM'}: ${activity.result || 'без результата'}`,
        meta: [activity.managerName, formatDateTime(activity.occurredAt), activity.nextAction ? `следующий шаг: ${activity.nextAction}` : ''].filter(Boolean).join(' · '),
        icon: activity.type === 'visit' ? MapPinned : Phone,
        tone: activity.weakNextStep ? 'amber' : 'blue',
      }))
      : [];
    if (crmRows.length > 0) return crmRows;
    const history = [...(client?.history || [])]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 3)
      .map(entry => ({
        id: `${entry.date}-${entry.author}-${entry.text}`,
        title: entry.text,
        meta: [entry.author, formatDateTime(entry.date)].filter(Boolean).join(' · '),
        icon: Clock,
        tone: 'blue',
      }));
    if (history.length > 0) return history;
    return client360.rentals.latest.slice(0, 3).map(rental => ({
      id: rental.id,
      title: `Аренда ${rentalStatusLabel(rental.status).toLowerCase()}`,
      meta: [rental.equipment, rental.endDate ? `до ${formatDate(rental.endDate)}` : ''].filter(Boolean).join(' · '),
      icon: TrendingUp,
      tone: 'green',
    }));
  }, [client?.history, client360.rentals.latest, crmActivities]);

  // Persist changes — optimistic + server PATCH
  const persist = useCallback((updated: Client) => {
    setClient(updated);
    updateClient.mutate({ id: updated.id, data: updated });
  }, [updateClient]);

  const startEdit = () => {
    if (!client || !canEdit) return;
    setEditData({ ...client });
    setDuplicateClient(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditData({});
    setDuplicateClient(null);
  };

  const saveEdit = () => {
    if (!client || !canEdit) return;
    const nextClient = {
      ...client,
      ...editData,
      inn: normalizeInn(editData.inn ?? client.inn),
      creditLimit: Math.max(0, Number(editData.creditLimit ?? client.creditLimit) || 0),
      debt: canEditDebt
        ? Math.max(0, Number(editData.debt ?? client.debt) || 0)
        : client.debt,
    };
    if (!isValidInn(nextClient.inn)) {
      setInnError(INN_ERROR);
      return;
    }
    setInnError('');
    const historyEntries = buildFieldDiffHistory(
      client,
      nextClient,
      {
        company: 'компания',
        inn: 'ИНН',
        kpp: 'КПП',
        ogrn: 'ОГРН',
        clientType: 'тип клиента',
        verified: 'проверка клиента',
        email: 'email',
        address: 'адрес',
        legalAddress: 'юридический адрес',
        actualAddress: 'фактический адрес',
        contact: 'контакт',
        phone: 'телефон',
        paymentTerms: 'условия оплаты',
        creditLimit: 'кредитный лимит',
        debt: 'задолженность',
        manager: 'менеджер',
        managerRole: 'роль менеджера',
        notes: 'примечание',
        status: 'статус',
      },
      user?.name || 'Система',
      'Обновлён клиент',
    );
    const updatedClient = appendAuditHistory(nextClient, ...historyEntries);
    setClient(updatedClient);
    setDuplicateClient(null);
    setInnError('');
    updateClient.mutate({ id: updatedClient.id, data: updatedClient }, {
      onSuccess: (savedClient) => {
        setClient(savedClient);
        setEditing(false);
        setEditData({});
      },
      onError: (error) => {
        setClient(client);
        const duplicate = getDuplicateClient(error);
        if (duplicate) {
          setDuplicateClient(duplicate);
          return;
        }
        toast.error(error instanceof Error ? error.message : 'Не удалось сохранить клиента.');
      },
    });
  };

  function openContactDialog() {
    if (!canEdit) return;
    setContactDraft(emptyContactDraft);
    setContactErrors({});
    setContactDialogOpen(true);
  }

  function handleSaveContact() {
    if (!client || !canEdit) return;
    const validation = validateClientContactDraft(contactDraft);
    if (!validation.ok) {
      setContactErrors({ [validation.field || 'form']: validation.message || 'Проверьте данные контакта.' });
      return;
    }

    const nextClient = appendAuditHistory(
      appendClientContact(client, validation.value) as Client,
      {
        date: new Date().toISOString(),
        text: `Добавлен контакт: ${validation.value.name}`,
        author: user?.name || 'Система',
        type: 'system',
      },
    );
    const previousClient = client;
    setClient(nextClient);
    updateClient.mutate({ id: nextClient.id, data: nextClient }, {
      onSuccess: (savedClient) => {
        setClient(savedClient);
        setContactDialogOpen(false);
        setContactDraft(emptyContactDraft);
        setContactErrors({});
        toast.success('Контакт добавлен.');
      },
      onError: (error) => {
        setClient(previousClient);
        toast.error(error instanceof Error ? error.message : 'Не удалось добавить контакт.');
      },
    });
  }

  function openNoteDialog() {
    if (!canEdit) return;
    setNoteDraft('');
    setNoteError('');
    setNoteDialogOpen(true);
  }

  function handleSaveNote() {
    if (!client || !canEdit) return;
    const validation = validateClientNoteDraft(noteDraft);
    if (!validation.ok) {
      setNoteError(validation.message || 'Введите текст заметки.');
      return;
    }

    const nextClient = appendAuditHistory(
      appendClientNote(client, validation.value, {
        author: user?.name || 'Система',
        createdAt: new Date().toISOString(),
      }) as Client,
      {
        date: new Date().toISOString(),
        text: 'Добавлена заметка по клиенту',
        author: user?.name || 'Система',
        type: 'comment',
      },
    );
    const previousClient = client;
    setClient(nextClient);
    updateClient.mutate({ id: nextClient.id, data: nextClient }, {
      onSuccess: (savedClient) => {
        setClient(savedClient);
        setNoteDialogOpen(false);
        setNoteDraft('');
        setNoteError('');
        toast.success('Заметка добавлена.');
      },
      onError: (error) => {
        setClient(previousClient);
        toast.error(error instanceof Error ? error.message : 'Не удалось добавить заметку.');
      },
    });
  }

  function openFileDialog() {
    if (!canEdit) return;
    setFileDraft(emptyFileDraft);
    setFileError('');
    setFileDialogOpen(true);
  }

  async function handleSaveFile() {
    if (!client || !canEdit) return;
    if (!fileDraft.file) {
      setFileError('Выберите файл для прикрепления.');
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(fileDraft.file);
      const displayName = fileDraft.title.trim() || fileDraft.file.name;
      const nextClient = appendAuditHistory(
        {
          ...client,
          partnerCardFileName: displayName,
          partnerCardMimeType: fileDraft.file.type || undefined,
          partnerCardDataUrl: dataUrl,
          partnerCardUploadedAt: new Date().toISOString(),
          partnerCardUploadedBy: user?.name || 'Система',
        },
        {
          date: new Date().toISOString(),
          text: `Загружена карта партнёра: ${displayName}${fileDraft.comment.trim() ? ` (${fileDraft.comment.trim()})` : ''}`,
          author: user?.name || 'Система',
          type: 'system',
        },
      );
      const previousClient = client;
      setClient(nextClient);
      updateClient.mutate({ id: nextClient.id, data: nextClient }, {
        onSuccess: (savedClient) => {
          setClient(savedClient);
          setFileDialogOpen(false);
          setFileDraft(emptyFileDraft);
          setFileError('');
          toast.success('Файл прикреплён к карточке клиента.');
        },
        onError: (error) => {
          setClient(previousClient);
          toast.error(error instanceof Error ? error.message : 'Не удалось прикрепить файл.');
        },
      });
    } catch (error) {
      console.error(error);
      setFileError(error instanceof Error ? error.message : 'Не удалось прочитать файл.');
    }
  }

  async function handleCopyClientLink() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Ссылка на клиента скопирована.');
    } catch {
      toast.error('Не удалось скопировать ссылку.');
    }
    setMoreMenuOpen(false);
  }

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

  function handleDeleteClient() {
    if (!client || !canDelete) return;
    setDeleteHistoryLinks([]);
    if (clientRentals.length > 0) {
      setDeleteBlockedRentals(clientRentals.map(rental => ({
        id: rental.id,
        rentalId: rental.rentalId || rental.id,
        equipmentId: rental.equipmentId,
        equipmentInv: rental.equipmentInv,
        startDate: rental.startDate,
        endDate: rental.endDate,
        status: rental.status,
      })));
      toast.error('Сначала замените клиента в связанных арендах.');
      return;
    }
    if (!window.confirm(`Удалить клиента "${client.company}"? Действие нельзя отменить.`)) return;
    deleteClient.mutate(client.id, {
      onSuccess: () => {
        toast.success('Клиент удалён.');
        navigate('/clients');
      },
      onError: (error) => {
        const conflict = getClientDeleteConflict(error);
        if (conflict) {
          setDeleteBlockedRentals(conflict.rentals);
          toast.error(conflict.message);
          return;
        }
        const historyConflict = getClientHistoryConflict(error);
        if (historyConflict) {
          setDeleteHistoryLinks(historyConflict.links);
          toast.error(historyConflict.message);
          return;
        }
        toast.error(error instanceof Error ? error.message : 'Не удалось удалить клиента.');
      },
    });
  }

  function handleCreateObject() {
    if (!client || !canEdit) return;
    createClientObject.mutate({
      clientId: client.id,
      name: objectForm.name,
      address: objectForm.address,
      contactName: objectForm.contactName || undefined,
      contactPhone: objectForm.contactPhone || undefined,
      notes: objectForm.notes || undefined,
      status: 'active',
    }, {
      onSuccess: () => {
        setObjectForm({ name: '', address: '', contactName: '', contactPhone: '', notes: '' });
        toast.success('Объект клиента добавлен.');
      },
      onError: error => toast.error(error instanceof Error ? error.message : 'Не удалось сохранить объект.'),
    });
  }

  function handleArchiveObject(objectId: string) {
    updateClientObject.mutate({ id: objectId, data: { status: 'archived' } }, {
      onSuccess: () => toast.success('Объект архивирован.'),
      onError: error => toast.error(error instanceof Error ? error.message : 'Не удалось архивировать объект.'),
    });
  }

  function startEditObject(object: { id: string; name: string; address: string; contactName?: string; contactPhone?: string; notes?: string }) {
    setEditingObjectId(object.id);
    setEditObjectForm({
      name: object.name || '',
      address: object.address || '',
      contactName: object.contactName || '',
      contactPhone: object.contactPhone || '',
      notes: object.notes || '',
    });
  }

  function handleSaveObject(objectId: string) {
    updateClientObject.mutate({ id: objectId, data: editObjectForm }, {
      onSuccess: () => {
        setEditingObjectId('');
        toast.success('Объект обновлён.');
      },
      onError: error => toast.error(error instanceof Error ? error.message : 'Не удалось обновить объект.'),
    });
  }

  function handleCreateContract() {
    if (!client || !canEdit) return;
    createClientContract.mutate({
      clientId: client.id,
      objectId: contractForm.objectId || undefined,
      number: contractForm.number,
      date: contractForm.date || undefined,
      title: contractForm.title || undefined,
      notes: contractForm.notes || undefined,
      status: 'active',
    }, {
      onSuccess: () => {
        setContractForm({ number: '', date: '', title: '', objectId: '', notes: '' });
        toast.success('Договор клиента добавлен.');
      },
      onError: error => toast.error(error instanceof Error ? error.message : 'Не удалось сохранить договор.'),
    });
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
    <>
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <Button variant="ghost" className="w-fit text-gray-600 hover:text-gray-950 dark:text-gray-300 dark:hover:text-white" onClick={() => navigate('/clients')}>
          <ArrowLeft className="h-4 w-4" />
          Назад к списку клиентов
        </Button>
        <div className="flex flex-wrap gap-2">
          {!editing ? (
            <>
              <div className="relative">
                <Button
                  variant="secondary"
                  aria-haspopup="menu"
                  aria-expanded={moreMenuOpen}
                  onClick={() => setMoreMenuOpen(open => !open)}
                >
                  <MoreHorizontal className="h-4 w-4" />
                  Ещё
                </Button>
                {moreMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl shadow-gray-900/10 dark:border-gray-800 dark:bg-gray-950"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-900"
                      onClick={handleCopyClientLink}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                      Скопировать ссылку на клиента
                    </button>
                    <Link
                      role="menuitem"
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-900"
                      to={`/documents?clientId=${encodeURIComponent(client.id)}&clientName=${encodeURIComponent(client.company)}`}
                      onClick={() => setMoreMenuOpen(false)}
                    >
                      <FileText className="h-4 w-4" />
                      Открыть документы клиента
                    </Link>
                    {canViewPayments && (
                      <Link
                        role="menuitem"
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-900"
                        to={`/payments?clientId=${encodeURIComponent(client.id)}&clientName=${encodeURIComponent(client.company)}`}
                        onClick={() => setMoreMenuOpen(false)}
                      >
                        <CreditCard className="h-4 w-4" />
                        Открыть дебиторку клиента
                      </Link>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-900"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        window.print();
                      }}
                    >
                      <Printer className="h-4 w-4" />
                      Печать карточки
                    </button>
                  </div>
                )}
              </div>
              {canEdit && (
                <Button variant="secondary" onClick={startEdit}>
                  <Edit className="h-4 w-4" />
                  Редактировать
                </Button>
              )}
              {canCreateRentals && (
                <Link to={`/rentals/new?clientId=${encodeURIComponent(client.id)}`}>
                  <Button>
                    <Plus className="h-4 w-4" />
                    Новая аренда
                  </Button>
                </Link>
              )}
              {isCrmEnabled && can('create', 'crm') && (
                <>
                  <Link to={`/crm?activity=call&clientId=${encodeURIComponent(client.id)}`}>
                    <Button variant="secondary">
                      <Phone className="h-4 w-4" />
                      Добавить звонок
                    </Button>
                  </Link>
                  <Link to={`/crm?activity=visit&clientId=${encodeURIComponent(client.id)}`}>
                    <Button variant="secondary">
                      <MapPinned className="h-4 w-4" />
                      Добавить выезд
                    </Button>
                  </Link>
                </>
              )}
              <Button variant="secondary" size="icon" onClick={() => window.print()} title="Печать">
                <Printer className="h-4 w-4" />
              </Button>
              {canDelete && (
                <Button
                  variant="secondary"
                  onClick={handleDeleteClient}
                  disabled={deleteClient.isPending}
                  title={clientRentals.length > 0 ? 'Сначала замените клиента в связанных арендах' : undefined}
                >
                  <Trash2 className="h-4 w-4" />
                  Удалить
                </Button>
              )}
            </>
          ) : (
            <>
              <Button onClick={saveEdit} disabled={updateClient.isPending} className="shadow-lg shadow-blue-500/20">
                <Save className="h-4 w-4" />
                {updateClient.isPending ? 'Сохранение...' : 'Сохранить'}
              </Button>
              <Button variant="secondary" onClick={cancelEdit}>
                <X className="h-4 w-4" />
                Отмена
              </Button>
            </>
          )}
        </div>
      </div>

      {editing && (
        <div className="rounded-3xl border border-blue-200 bg-blue-50/80 p-4 shadow-[0_18px_50px_-36px_rgba(37,99,235,0.8)] dark:border-blue-900/70 dark:bg-blue-950/30">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm">
                <Edit className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-blue-950 dark:text-blue-100">Режим редактирования клиента</h2>
                <p className="mt-1 text-sm text-blue-800 dark:text-blue-200">
                  Измените нужные поля и нажмите “Сохранить”. Серые поля ниже доступны только для просмотра.
                </p>
              </div>
            </div>
            <div className="flex gap-2 md:shrink-0">
              <Button onClick={saveEdit} disabled={updateClient.isPending}>
                <Save className="h-4 w-4" />
                {updateClient.isPending ? 'Сохранение...' : 'Сохранить'}
              </Button>
              <Button variant="secondary" onClick={cancelEdit}>
                <X className="h-4 w-4" />
                Отмена
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card className="overflow-hidden rounded-[24px] border-gray-200/80 bg-white shadow-[0_24px_80px_-56px_rgba(15,23,42,0.65)] dark:border-gray-800 dark:bg-gray-950">
            <CardContent className="p-0">
              <div className={cn(
                'flex flex-col gap-6 p-5 sm:p-7',
                editing ? 'lg:items-stretch' : 'lg:flex-row lg:items-center lg:justify-between',
              )}>
                <div className={cn(
                  'flex min-w-0 flex-1 flex-col gap-5 sm:flex-row',
                  editing ? 'sm:items-start' : 'sm:items-center',
                )}>
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-50 via-violet-50 to-emerald-50 text-3xl font-bold text-blue-700 ring-1 ring-blue-100 dark:from-blue-950/60 dark:via-violet-950/40 dark:to-emerald-950/30 dark:text-blue-200 dark:ring-blue-900/60">
                    {getInitials(client.company)}
                  </div>
                  <div className="min-w-0 flex-1">
                    {editing ? (
                      <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_190px]">
                        <EditField label="Название компании">
                          <Input
                            className={editInputClassName}
                            value={editData.company ?? ''}
                            onChange={e => setEditData({ ...editData, company: e.target.value })}
                            placeholder="ООО «Компания»"
                          />
                        </EditField>
                        <EditField label="Статус клиента">
                          <select
                            className={editSelectClassName}
                            value={editData.status || 'new'}
                            onChange={e => setEditData({ ...editData, status: e.target.value as ClientStatus })}
                          >
                            {CLIENT_STATUS_OPTIONS.map(option => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </EditField>
                        <EditField label="ИНН">
                          <Input
                            className={editInputClassName}
                            value={editData.inn ?? ''}
                            onChange={e => setEditData({ ...editData, inn: e.target.value })}
                            inputMode="numeric"
                          />
                        </EditField>
                        <EditField label="КПП">
                          <Input
                            className={editInputClassName}
                            value={editData.kpp ?? ''}
                            onChange={e => setEditData({ ...editData, kpp: e.target.value })}
                            inputMode="numeric"
                            placeholder="Если есть"
                          />
                        </EditField>
                        <EditField label="ОГРН">
                          <Input
                            className={editInputClassName}
                            value={editData.ogrn ?? ''}
                            onChange={e => setEditData({ ...editData, ogrn: e.target.value })}
                            inputMode="numeric"
                            placeholder="Если есть"
                          />
                        </EditField>
                        <EditField label="Тип клиента">
                          <select
                            className={editSelectClassName}
                            value={editData.clientType || 'legal'}
                            onChange={e => setEditData({ ...editData, clientType: e.target.value })}
                          >
                            {CLIENT_TYPE_OPTIONS.map(option => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </EditField>
                        <div className="lg:col-span-2">
                          <label className="flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-3 text-sm font-medium text-gray-800 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-gray-100">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-blue-300 text-blue-600 focus:ring-blue-500 dark:border-blue-800"
                              checked={Boolean(editData.verified)}
                              onChange={e => setEditData({ ...editData, verified: e.target.checked })}
                            />
                            Клиент проверен
                          </label>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-3">
                          <h1 className="min-w-0 break-words text-xl font-bold leading-tight text-gray-950 dark:text-white sm:text-2xl">
                            {client.company}
                          </h1>
                          {client.status && (
                            <Badge variant={clientStatusVariant(client.status)}>
                              {CLIENT_STATUS_LABELS[client.status]}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
                          {client.inn && <span>ИНН {client.inn}</span>}
                          {client.kpp && <><span className="text-gray-300 dark:text-gray-700">•</span><span>КПП {client.kpp}</span></>}
                          {client.ogrn && <><span className="text-gray-300 dark:text-gray-700">•</span><span>ОГРН {client.ogrn}</span></>}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                            {clientTypeLabel(client)}
                          </span>
                          {client.verified && (
                            <Badge variant="info">
                              <CheckCircle className="mr-1 h-3 w-3" />
                              Проверен
                            </Badge>
                          )}
                          <Badge variant={client360RiskVariant(client360.debt.riskLevel)}>
                            {client360.debt.riskLabel} риск
                          </Badge>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className={cn(
                  'rounded-2xl p-4',
                  editing ? 'border border-blue-100 bg-blue-50/50 dark:border-blue-900/60 dark:bg-blue-950/20' : 'bg-gray-50 dark:bg-gray-900/70',
                  editing ? 'w-full' : 'min-w-[220px]',
                )}>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Менеджер</p>
                  {editing ? (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <Input
                        className={editInputClassName}
                        value={editData.manager ?? ''}
                        onChange={e => setEditData({ ...editData, manager: e.target.value })}
                        placeholder="Имя менеджера"
                      />
                      <Input
                        className={editInputClassName}
                        value={editData.managerRole ?? ''}
                        onChange={e => setEditData({ ...editData, managerRole: e.target.value })}
                        placeholder="Роль менеджера"
                      />
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-white text-sm font-semibold text-blue-700 shadow-sm dark:bg-gray-800 dark:text-blue-200">
                        {client.managerAvatar ? (
                          <img src={client.managerAvatar} alt={client.manager || 'Менеджер'} className="h-full w-full object-cover" />
                        ) : (
                          getInitials(client.manager || user?.name || 'МН')
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-950 dark:text-white">{client.manager || 'Не назначен'}</p>
                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">{client.managerRole || 'Ответственный'}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-1 overflow-x-auto border-t border-gray-100 px-5 dark:border-gray-800 sm:px-7">
                {[
                  ['Обзор', null],
                  ['Аренды', clientRentals.length],
                  ['Платежи', canViewPayments ? client360.payments.total : null],
                  ['Документы', client360.documents.total],
                  ['Техника', client360.rentals.active.length],
                  ['История активности', (client.history || []).length],
                ].map(([label, count], index) => (
                  <button
                    key={String(label)}
                    type="button"
                    className={cn(
                      'flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors',
                      index === 0
                        ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-300'
                        : 'border-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white',
                    )}
                  >
                    {label}
                    {typeof count === 'number' && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        {count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
            <Card className={editing ? 'border-blue-200 bg-blue-50/20 dark:border-blue-900/70 dark:bg-blue-950/10' : undefined}>
              <CardHeader className={profileCardHeaderClassName}>
                <CardTitle className={profileCardTitleClassName}>
                  <Building2 className="h-4 w-4 text-blue-600" />
                  Основная информация
                  {editing && <Badge variant="info">Редактируется</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className={editing ? cn(profileCardContentClassName, 'space-y-4') : cn(profileCardContentClassName, 'grid gap-4 2xl:grid-cols-2')}>
                {editing ? (
                  <>
                    <div className="grid gap-3 md:grid-cols-2">
                      <EditField label="Контактное лицо">
                        <Input
                          className={editInputClassName}
                          value={editData.contact ?? ''}
                          onChange={e => setEditData({ ...editData, contact: e.target.value })}
                        />
                      </EditField>
                      <EditField label="Телефон">
                        <Input
                          className={editInputClassName}
                          value={editData.phone ?? ''}
                          onChange={e => setEditData({ ...editData, phone: e.target.value })}
                        />
                      </EditField>
                      <EditField label="Email">
                        <Input
                          className={editInputClassName}
                          type="email"
                          value={editData.email ?? ''}
                          onChange={e => setEditData({ ...editData, email: e.target.value })}
                        />
                      </EditField>
                      <EditField label="Дата регистрации" readonly>
                        <ReadonlyEditValue value={client.createdAt ? formatDate(client.createdAt) : 'Не указана'} />
                      </EditField>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <EditField label="Юридический адрес">
                        <Textarea
                          className={editTextareaClassName}
                          value={editData.legalAddress ?? editData.address ?? ''}
                          onChange={e => setEditData({ ...editData, legalAddress: e.target.value })}
                          placeholder="Юридический адрес"
                        />
                      </EditField>
                      <EditField label="Фактический адрес">
                        <Textarea
                          className={editTextareaClassName}
                          value={editData.actualAddress ?? editData.address ?? ''}
                          onChange={e => setEditData({ ...editData, actualAddress: e.target.value })}
                          placeholder="Фактический адрес"
                        />
                      </EditField>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <EditField label="ID клиента" readonly>
                        <ReadonlyEditValue value={client.id} />
                      </EditField>
                      <EditField label="Кто создал" readonly>
                        <ReadonlyEditValue value={client.createdBy || 'Не указано'} />
                      </EditField>
                    </div>
                  </>
                ) : (
                  <>
                    <InfoPill icon={BriefcaseBusiness} label="Полное название" value={client.company} />
                    <InfoPill icon={Building2} label="Тип клиента" value={clientTypeLabel(client)} />
                    <InfoPill icon={CalendarDays} label="Дата регистрации" value={client.createdAt ? formatDate(client.createdAt) : undefined} />
                    <InfoPill icon={Star} label="Рейтинг" value={client360.debt.riskLabel} />
                    <InfoPill icon={MapPinned} label="Юр. адрес" value={client.legalAddress || client.address} />
                    <InfoPill icon={MapPin} label="Факт. адрес" value={client.actualAddress || client.address} />
                    <InfoPill icon={Mail} label="Email" value={client.email} />
                    <InfoPill icon={Phone} label="Телефон" value={client.phone} />
                  </>
                )}
              </CardContent>
            </Card>

            <Card className={editing ? 'border-blue-200 bg-blue-50/20 dark:border-blue-900/70 dark:bg-blue-950/10' : undefined}>
              <CardHeader className={profileCardHeaderClassName}>
                <CardTitle className={profileCardTitleClassName}>
                  <CreditCard className="h-4 w-4 text-emerald-600" />
                  Финансовая сводка
                  {editing && <Badge variant="info">Редактируется</Badge>}
                </CardTitle>
                <span className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">На сегодня</span>
              </CardHeader>
              <CardContent className={cn(profileCardContentClassName, 'space-y-4')}>
                {editing ? (
                  <div className="space-y-4">
                    <EditField label="Условия оплаты">
                      <select
                        className={editSelectClassName}
                        value={editData.paymentTerms ?? ''}
                        onChange={e => setEditData({ ...editData, paymentTerms: e.target.value })}
                      >
                        <option value="">Не указано</option>
                        {PAYMENT_TERMS_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </EditField>
                    {canViewFinance ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <EditField label="Кредитный лимит, ₽">
                          <Input
                            className={editInputClassName}
                            type="number"
                            min={0}
                            value={String(editData.creditLimit ?? 0)}
                            onChange={e => setEditData({ ...editData, creditLimit: Number(e.target.value) })}
                          />
                        </EditField>
                        {canEditDebt ? (
                          <EditField label="Ручная дебиторка, ₽" hint="Итоговый долг также учитывает неоплаченные аренды.">
                            <Input
                              className={editInputClassName}
                              type="number"
                              min={0}
                              value={String(editData.debt ?? 0)}
                              onChange={e => setEditData({ ...editData, debt: Number(e.target.value) })}
                            />
                          </EditField>
                        ) : (
                          <EditField label="Текущая задолженность" readonly>
                            <ReadonlyEditValue value={formatCurrency(displayedDebt)} />
                          </EditField>
                        )}
                      </div>
                    ) : (
                      <EditField label="Финансовые данные" readonly>
                        <ReadonlyEditValue value="Скрыты правами доступа" />
                      </EditField>
                    )}
                  </div>
                ) : !canViewFinance ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Финансовые данные скрыты правами доступа.</p>
                ) : (
                  <>
                    <div>
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Общая задолженность</p>
                      <p className={cn('mt-1 text-3xl font-bold', displayedDebt > 0 ? 'text-red-600 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-300')}>
                        {formatCurrency(displayedDebt)}
                      </p>
                      {client360.debt.overdue > 0 && (
                        <span className="mt-2 inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-200">
                          Просрочено: {formatCurrency(client360.debt.overdue)}
                        </span>
                      )}
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="text-gray-500 dark:text-gray-400">Доступный лимит</span>
                        <span className="font-semibold text-gray-950 dark:text-white">{formatCurrency(Math.max(0, (client.creditLimit || 0) - displayedDebt))}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${Math.max(0, Math.min(100, client.creditLimit ? ((client.creditLimit - displayedDebt) / client.creditLimit) * 100 : 0))}%` }}
                        />
                      </div>
                    </div>
                    <Divider />
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Кредитный лимит</span>
                      <span className="font-semibold text-gray-950 dark:text-white">{formatCurrency(client.creditLimit || 0)}</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <StatTile label="Текущие аренды" value={displayedActiveRentals} />
            <StatTile label="Всего аренд" value={clientRentals.length || displayedTotalRentals} />
            <StatTile label="Открытых сервисных заявок" value={client360.service.open} tone={client360.service.open > 0 ? 'danger' : 'success'} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className={profileCardHeaderClassName}>
                <CardTitle className={profileCardTitleClassName}>
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                  Текущие аренды
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">{client360.rentals.active.length}</span>
                </CardTitle>
                <Link to="/rentals" className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-300">Смотреть все</Link>
              </CardHeader>
              <CardContent className={profileCardContentClassName}>
                {client360.rentals.latest.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Аренд не найдено.</p>
                ) : (
                  <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-100 dark:divide-gray-800 dark:border-gray-800">
                    {client360.rentals.latest.slice(0, 3).map(rental => {
                      const navigationId = canViewRentals ? resolveRentalNavigationId(rental, rentals, ganttRentals) : null;
                      const unavailableTitle = canViewRentals ? 'Нет связи с карточкой аренды' : 'Нет доступа к карточке аренды';
                      return (
                        <button
                          key={rental.id}
                          type="button"
                          disabled={!navigationId}
                          title={navigationId ? 'Открыть карточку аренды' : unavailableTitle}
                          className={cn(
                            'grid w-full grid-cols-[56px_minmax(0,1fr)] items-center gap-3 bg-white p-3 text-left transition-colors dark:bg-gray-950 sm:grid-cols-[64px_minmax(0,1fr)_auto] sm:gap-4',
                            navigationId
                              ? 'hover:bg-gray-50 dark:hover:bg-gray-900'
                              : 'cursor-not-allowed opacity-75',
                          )}
                          onClick={() => {
                            if (navigationId) navigate(`/rentals/${navigationId}`);
                          }}
                        >
                          <div className="flex h-14 w-16 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
                            <Wrench className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-gray-950 dark:text-white">{rental.equipment || rental.id}</p>
                            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                              {(navigationId || rental.id)} · {formatDate(rental.startDate)} — {formatDate(rental.endDate)}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <Badge variant={rentalStatusVariant(rental.status)}>{rentalStatusLabel(rental.status)}</Badge>
                              {!navigationId && (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-300">
                                  <AlertTriangle className="h-3 w-3" />
                                  {unavailableTitle}
                                </span>
                              )}
                            </div>
                          </div>
                          {canViewFinance && (
                            <div className="col-span-2 text-left text-sm font-semibold text-gray-950 dark:text-white sm:col-span-1 sm:self-start sm:pt-1 sm:text-right">
                              {formatCurrency(getRentalBillingAmount(rental))}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className={profileCardHeaderClassName}>
                <CardTitle className={profileCardTitleClassName}>
                  <Clock className="h-4 w-4 text-orange-500" />
                  История активности
                </CardTitle>
              </CardHeader>
              <CardContent className={profileCardContentClassName}>
                {recentActivity.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Активность пока не зафиксирована.</p>
                ) : (
                  <div className="space-y-4">
                    {recentActivity.map(item => {
                      const Icon = item.icon;
                      return (
                        <div key={item.id} className="grid grid-cols-[36px_minmax(0,1fr)] gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-300">
                            <Icon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="line-clamp-2 text-sm font-medium text-gray-950 dark:text-white">{item.title}</p>
                            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{item.meta}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className={profileRailHeaderClassName}>
              <CardTitle className={profileCardTitleClassName}>
                Контакты
                {editing && <Badge variant="info">Форма</Badge>}
              </CardTitle>
              {!editing && canEdit && (
                <Button
                  size="icon"
                  variant="ghost"
                  title="Добавить контакт"
                  aria-label="Добавить контакт"
                  onClick={openContactDialog}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className={profileRailContentClassName}>
              {editing ? (
                <div className="space-y-3">
                  <EditField label="Контактное лицо">
                    <Input
                      className={editInputClassName}
                      value={editData.contact ?? ''}
                      onChange={e => setEditData({ ...editData, contact: e.target.value })}
                    />
                  </EditField>
                  <EditField label="Телефон">
                    <Input
                      className={editInputClassName}
                      value={editData.phone ?? ''}
                      onChange={e => setEditData({ ...editData, phone: e.target.value })}
                    />
                  </EditField>
                  <EditField label="Email">
                    <Input
                      className={editInputClassName}
                      type="email"
                      value={editData.email ?? ''}
                      onChange={e => setEditData({ ...editData, email: e.target.value })}
                    />
                  </EditField>
                </div>
              ) : (
                primaryContacts.map((contact, index) => (
                  <div key={`${contact.name}-${index}`} className="rounded-2xl border border-gray-100 p-3.5 last:mb-0 dark:border-gray-800">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 break-words text-sm font-semibold leading-5 text-gray-950 dark:text-white">{contact.name}</p>
                      {contact.role && <Badge variant="success" className="shrink-0">{contact.role}</Badge>}
                    </div>
                    <div className="mt-3 grid gap-2">
                      {contact.phone && (
                        <a href={`tel:${contact.phone}`} className="grid grid-cols-[18px_minmax(0,1fr)] items-center gap-2 text-sm leading-5 text-gray-700 hover:text-blue-600 dark:text-gray-300 dark:hover:text-blue-300">
                          <Phone className="h-4 w-4 text-gray-400" />
                          <span className="truncate">{contact.phone}</span>
                        </a>
                      )}
                      {contact.email && (
                        <a href={`mailto:${contact.email}`} className="grid grid-cols-[18px_minmax(0,1fr)] items-center gap-2 text-sm leading-5 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-300">
                          <Mail className="h-4 w-4 text-gray-400" />
                          <span className="truncate">{contact.email}</span>
                        </a>
                      )}
                    </div>
                    {contact.comment && <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{contact.comment}</p>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className={profileRailHeaderClassName}>
              <CardTitle className={profileCardTitleClassName}>
                Заметки
                {editing && <Badge variant="info">Редактируется</Badge>}
              </CardTitle>
              {!editing && canEdit && (
                <Button
                  size="icon"
                  variant="ghost"
                  title="Добавить заметку"
                  aria-label="Добавить заметку"
                  onClick={openNoteDialog}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className={profileRailContentClassName}>
              {editing ? (
                <EditField label="Примечания">
                  <Textarea
                    className={editTextareaClassName}
                    value={editData.notes ?? ''}
                    onChange={e => setEditData({ ...editData, notes: e.target.value })}
                    placeholder="Внутренние заметки по клиенту"
                  />
                </EditField>
              ) : client.notes ? (
                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm leading-6 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                  <p className="whitespace-pre-wrap">{client.notes}</p>
                  <p className="mt-3 text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">{client.manager || user?.name || 'Система'}</p>
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">Заметок по клиенту пока нет.</p>
              )}
              {clientDebtPlan?.comment && (
                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100">
                  <p className="whitespace-pre-wrap">{clientDebtPlan.comment}</p>
                  <p className="mt-3 text-xs font-medium uppercase tracking-wide text-blue-700 dark:text-blue-300">План взыскания</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className={profileRailHeaderClassName}>
              <CardTitle className={profileCardTitleClassName}>Прикреплённые файлы</CardTitle>
              {canEdit ? (
                <Button
                  size="icon"
                  variant="ghost"
                  title="Добавить файл"
                  aria-label="Добавить файл"
                  onClick={openFileDialog}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className={profileRailContentClassName}>
              {visibleFiles.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">Файлы не прикреплены.</p>
              ) : (
                visibleFiles.map(file => (
                  <div key={file.id} className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3 rounded-2xl border border-gray-100 p-3 dark:border-gray-800">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300">
                      <Paperclip className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-blue-600 dark:text-blue-300">{file.title}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{file.meta}</p>
                    </div>
                  </div>
                ))
              )}
              {visibleFiles.length > 0 && (
                <Link to="/documents" className="block rounded-xl border border-gray-200 px-3 py-2 text-center text-sm font-medium text-blue-600 hover:bg-gray-50 dark:border-gray-700 dark:text-blue-300 dark:hover:bg-gray-900">
                  Все файлы
                </Link>
              )}
            </CardContent>
          </Card>

          {quickActions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">Быстрые действия</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {quickActions.map(action => (
                  <Link key={action.id} to={action.to}>
                    <Button variant={action.kind === 'primary' ? 'default' : 'secondary'} size="sm">
                      {action.id === 'client-create-rental' ? <Plus className="h-4 w-4" /> : <ReceiptText className="h-4 w-4" />}
                      {action.label}
                    </Button>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4" />
              Объекты
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {clientObjects.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Объекты клиента пока не заведены.</p>
            ) : (
              <div className="space-y-2">
                {clientObjects.map(object => {
                  const contract = object.contractId ? clientContracts.find(item => item.id === object.contractId) : null;
                  const isObjectEditing = editingObjectId === object.id;
                  return (
                    <div key={object.id} className="rounded-md border border-gray-200 p-3 text-sm dark:border-gray-800">
                      {isObjectEditing ? (
                        <div className="grid gap-3 md:grid-cols-2">
                          <Input label="Название объекта" value={editObjectForm.name} onChange={e => setEditObjectForm({ ...editObjectForm, name: e.target.value })} />
                          <Input label="Адрес объекта" value={editObjectForm.address} onChange={e => setEditObjectForm({ ...editObjectForm, address: e.target.value })} />
                          <Input label="Контакт" value={editObjectForm.contactName} onChange={e => setEditObjectForm({ ...editObjectForm, contactName: e.target.value })} />
                          <Input label="Телефон" value={editObjectForm.contactPhone} onChange={e => setEditObjectForm({ ...editObjectForm, contactPhone: e.target.value })} />
                          <div className="flex gap-2 md:col-span-2">
                            <Button size="sm" onClick={() => handleSaveObject(object.id)} disabled={!editObjectForm.name.trim() || !editObjectForm.address.trim()}>
                              <Save className="h-4 w-4" />
                              Сохранить
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setEditingObjectId('')}>
                              <X className="h-4 w-4" />
                              Отмена
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-gray-900 dark:text-white">{object.name}</p>
                              <p className="text-gray-500 dark:text-gray-400">{object.address}</p>
                              <p className="mt-1 text-xs text-gray-500">
                                {[object.contactName, object.contactPhone].filter(Boolean).join(' · ') || 'Контакт не указан'}
                              </p>
                              <p className="mt-1 text-xs text-gray-500">
                                Договор: {contract?.number || object.contractNumber || 'не привязан'}
                              </p>
                            </div>
                            <Badge variant={object.status === 'archived' ? 'default' : 'success'}>
                              {object.status === 'archived' ? 'Архив' : 'Активен'}
                            </Badge>
                          </div>
                          {canEdit && object.status !== 'archived' && (
                            <div className="mt-3 flex gap-2">
                              <Button variant="secondary" size="sm" onClick={() => startEditObject(object)}>
                                <Edit className="h-4 w-4" />
                                Изменить
                              </Button>
                              <Button variant="secondary" size="sm" onClick={() => handleArchiveObject(object.id)}>
                                Архивировать
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {canEdit && (
              <div className="grid gap-3 border-t border-gray-100 pt-4 dark:border-gray-800 md:grid-cols-2">
                <Input label="Название объекта" value={objectForm.name} onChange={e => setObjectForm({ ...objectForm, name: e.target.value })} />
                <Input label="Адрес объекта" value={objectForm.address} onChange={e => setObjectForm({ ...objectForm, address: e.target.value })} />
                <Input label="Контакт" value={objectForm.contactName} onChange={e => setObjectForm({ ...objectForm, contactName: e.target.value })} />
                <Input label="Телефон" value={objectForm.contactPhone} onChange={e => setObjectForm({ ...objectForm, contactPhone: e.target.value })} />
                <div className="md:col-span-2">
                  <Button onClick={handleCreateObject} disabled={createClientObject.isPending || !objectForm.name.trim() || !objectForm.address.trim()}>
                    <Plus className="h-4 w-4" />
                    Добавить объект
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              Договоры
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {clientContracts.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Договоры клиента пока не заведены.</p>
            ) : (
              <div className="space-y-2">
                {clientContracts.map(contract => {
                  const object = contract.objectId ? clientObjects.find(item => item.id === contract.objectId) : null;
                  return (
                    <div key={contract.id} className="rounded-md border border-gray-200 p-3 text-sm dark:border-gray-800">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-gray-900 dark:text-white">{contract.number}</p>
                          <p className="text-gray-500 dark:text-gray-400">{contract.title || 'Договор'}</p>
                          <p className="mt-1 text-xs text-gray-500">Объект: {object?.name || 'только клиент'}</p>
                        </div>
                        <Badge variant={contract.status === 'archived' ? 'default' : 'success'}>
                          {contract.status === 'archived' ? 'Архив' : 'Активен'}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {canEdit && (
              <div className="grid gap-3 border-t border-gray-100 pt-4 dark:border-gray-800 md:grid-cols-2">
                <Input label="Номер договора" value={contractForm.number} onChange={e => setContractForm({ ...contractForm, number: e.target.value })} />
                <Input label="Дата" type="date" value={contractForm.date} onChange={e => setContractForm({ ...contractForm, date: e.target.value })} />
                <Input label="Название" value={contractForm.title} onChange={e => setContractForm({ ...contractForm, title: e.target.value })} />
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Объект</label>
                  <select
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    value={contractForm.objectId}
                    onChange={e => setContractForm({ ...contractForm, objectId: e.target.value })}
                  >
                    <option value="">Только клиент</option>
                    {activeClientObjects.map(object => (
                      <option key={object.id} value={object.id}>{object.name}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <Button onClick={handleCreateContract} disabled={createClientContract.isPending || !contractForm.number.trim()}>
                    <Plus className="h-4 w-4" />
                    Добавить договор
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
                <div className="col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/20">
                  <p className="text-xs text-amber-700 dark:text-amber-300">Нераспределённые оплаты / авансы</p>
                  <p className="text-lg font-bold text-amber-800 dark:text-amber-200">{formatCurrency(unallocatedClientPayments)}</p>
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
            {canViewFinance && debtByObject.length > 0 && (
              <div className="space-y-2 border-t border-gray-100 pt-3 text-sm dark:border-gray-800">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Долг по объектам</p>
                {debtByObject.map(row => (
                  <div key={row.objectId || 'none'} className="flex items-center justify-between gap-3">
                    <span className="text-gray-600 dark:text-gray-300">{row.objectName}</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(row.debt)}</span>
                  </div>
                ))}
              </div>
            )}
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
          <Card className={editing ? 'border-blue-200 bg-blue-50/20 dark:border-blue-900/70 dark:bg-blue-950/10' : undefined}>
            <CardHeader className={profileCardHeaderClassName}>
              <CardTitle className={profileCardTitleClassName}>
                <Building2 className="h-4 w-4" />
                Основная информация
                {editing && <Badge variant="info">Форма</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className={cn(profileCardContentClassName, 'space-y-4')}>
              {editing ? (
                <div className="space-y-4">
                  <EditField label="Наименование компании">
                    <Input className={editInputClassName} value={editData.company ?? ''} onChange={e => setEditData({ ...editData, company: e.target.value })} />
                  </EditField>
                  <div className="grid grid-cols-2 gap-4">
                    <EditField label="ИНН">
                      <Input className={editInputClassName} value={editData.inn ?? ''} onChange={e => setEditData({ ...editData, inn: e.target.value })} />
                    </EditField>
                    <EditField label="Email">
                      <Input className={editInputClassName} type="email" value={editData.email ?? ''} onChange={e => setEditData({ ...editData, email: e.target.value })} />
                    </EditField>
                  </div>
                  {duplicateClient && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                      Клиент с таким ИНН уже существует
                      {duplicateClient.id && (
                        <>
                          :{' '}
                          <Link className="font-medium underline" to={`/clients/${duplicateClient.id}`}>
                            {duplicateClient.company || duplicateClient.id}
                          </Link>
                        </>
                      )}
                    </div>
                  )}
                  {innError && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                      {innError}
                    </div>
                  )}
                  <EditField label="Адрес">
                    <Textarea
                      className={editTextareaClassName}
                      value={editData.address ?? ''}
                      onChange={e => setEditData({ ...editData, address: e.target.value })}
                      placeholder="Юридический / фактический адрес"
                    />
                  </EditField>
                </div>
              ) : (
                <div className={profileFieldGridClassName}>
                  <Field label="Компания" value={client.company} className="col-span-2" />
                  <Field label="ИНН" value={client.inn} mono />
                  <Field label="Email" value={client.email} />
                  {client.address && (
                    <div className="col-span-2 grid grid-cols-[18px_minmax(0,1fr)] items-start gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                      <Field label="Адрес" value={client.address} />
                    </div>
                  )}
                  {client.createdAt && <Field label="Клиент с" value={formatDate(client.createdAt)} />}
                  {client.createdBy && <Field label="Кто создал" value={client.createdBy} />}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Contact */}
          <Card className={editing ? 'border-blue-200 bg-blue-50/20 dark:border-blue-900/70 dark:bg-blue-950/10' : undefined}>
            <CardHeader className={profileCardHeaderClassName}>
              <CardTitle className={profileCardTitleClassName}>
                <User className="h-4 w-4" />
                Контакт
                {editing && <Badge variant="info">Форма</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className={profileCardContentClassName}>
              {editing ? (
                <div className="space-y-4">
                  <EditField label="Контактное лицо">
                    <Input className={editInputClassName} value={editData.contact ?? ''} onChange={e => setEditData({ ...editData, contact: e.target.value })} />
                  </EditField>
                  <EditField label="Телефон">
                    <Input className={editInputClassName} value={editData.phone ?? ''} onChange={e => setEditData({ ...editData, phone: e.target.value })} />
                  </EditField>
                </div>
              ) : (
                <div className={profileFieldGridClassName}>
                  <Field label="Контактное лицо" value={client.contact} />
                  <div className="grid grid-cols-[18px_minmax(0,1fr)] items-start gap-2">
                    <Phone className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                    <Field
                      label="Телефон"
                      value={client.phone ? (
                        <a href={`tel:${client.phone}`} className="text-[--color-primary] hover:underline">
                        {client.phone}
                      </a>
                      ) : null}
                    />
                  </div>
                  <div className="grid grid-cols-[18px_minmax(0,1fr)] items-start gap-2">
                    <Mail className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                    <Field
                      label="Email"
                      value={client.email ? (
                        <a href={`mailto:${client.email}`} className="text-[--color-primary] hover:underline">
                          {client.email}
                        </a>
                      ) : null}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Commercial */}
          <Card className={editing ? 'border-blue-200 bg-blue-50/20 dark:border-blue-900/70 dark:bg-blue-950/10' : undefined}>
            <CardHeader className={profileCardHeaderClassName}>
              <CardTitle className={profileCardTitleClassName}>
                <CreditCard className="h-4 w-4" />
                Коммерческие условия
                {editing && <Badge variant="info">Форма</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className={profileCardContentClassName}>
              {editing ? (
                <div className="space-y-4">
                  <EditField label="Условия оплаты">
                    <select
                      className={editSelectClassName}
                      value={editData.paymentTerms ?? ''}
                      onChange={e => setEditData({ ...editData, paymentTerms: e.target.value })}
                    >
                      <option value="">Не указано</option>
                      {PAYMENT_TERMS_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </EditField>
                  <div className={`grid gap-4 ${canEditDebt ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
                    <EditField label="Кредитный лимит, ₽">
                      <Input
                        className={editInputClassName}
                        type="number"
                        min={0}
                        value={String(editData.creditLimit ?? 0)}
                        onChange={e => setEditData({ ...editData, creditLimit: Number(e.target.value) })}
                      />
                    </EditField>
                    {canEditDebt && (
                      <EditField label="Ручная дебиторка, ₽">
                        <Input
                          className={editInputClassName}
                          type="number"
                          min={0}
                          value={String(editData.debt ?? 0)}
                          onChange={e => setEditData({ ...editData, debt: Number(e.target.value) })}
                        />
                      </EditField>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Итоговая задолженность складывается из ручной дебиторки и неоплаченных аренд.
                  </p>
                  <EditField label="Ответственный менеджер">
                    <Input
                      className={editInputClassName}
                      value={editData.manager ?? ''}
                      onChange={e => setEditData({ ...editData, manager: e.target.value })}
                    />
                  </EditField>
                  <EditField label="Примечания">
                    <Textarea
                      className={editTextareaClassName}
                      value={editData.notes ?? ''}
                      onChange={e => setEditData({ ...editData, notes: e.target.value })}
                      placeholder="Примечания..."
                    />
                  </EditField>
                </div>
              ) : (
                <div className={profileFieldGridClassName}>
                  <Field label="Условия оплаты" value={client.paymentTerms} />
                  {canViewFinance ? (
                    <>
                      <Field label="Кредитный лимит" value={formatCurrency(client.creditLimit)} />
                      <div className="min-w-0 space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Задолженность</p>
                        <div className="flex min-h-6 flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold leading-5 text-gray-950 dark:text-white">{formatCurrency(displayedDebt)}</span>
                          <Badge variant={debtVariant(displayedDebt)} className="shrink-0">{debtLabel(displayedDebt)}</Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
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
                        <Field label="Ручная дебиторка" value={formatCurrency(client.debt ?? 0)} />
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
                    const navigationId = canViewRentals ? resolveRentalNavigationId(rental, rentals, ganttRentals) : null;
                    const unavailableTitle = canViewRentals ? 'Нет связи с карточкой аренды' : 'Нет доступа к карточке аренды';
                    return (
                      <div
                        key={rental.id}
                        className={cn(
                          'rounded-lg border border-gray-200 p-4 transition-colors dark:border-gray-700',
                          navigationId ? 'cursor-pointer hover:border-blue-400' : 'opacity-75',
                        )}
                        title={navigationId ? 'Открыть карточку аренды' : unavailableTitle}
                        onClick={() => {
                          if (navigationId) navigate(`/rentals/${navigationId}`);
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-medium text-gray-900 dark:text-white text-sm">{navigationId || rental.id}</p>
                              <Badge variant={rentalStatusVariant(rental.status)}>{rentalStatusLabel(rental.status)}</Badge>
                            </div>
                            <p className="text-xs text-gray-500 truncate">{rental.equipment || '—'}</p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {formatDate(rental.startDate)} — {formatDate(rental.endDate)}
                            </p>
                            {!navigationId && (
                              <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-300">
                                <AlertTriangle className="h-3 w-3" />
                                {unavailableTitle}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-semibold text-sm text-gray-900 dark:text-white">
                              {canViewFinance ? formatCurrency(getRentalBillingAmount(rental)) : 'Сумма скрыта'}
                            </p>
                            <p className="text-xs text-gray-500">{rental.manager || '—'}</p>
                            {navigationId ? (
                              <Link to={`/rentals/${navigationId}`} className="mt-1 inline-block text-xs text-[--color-primary] hover:underline" onClick={event => event.stopPropagation()}>
                                Открыть аренду
                              </Link>
                            ) : (
                              <span className="mt-1 inline-block text-xs text-gray-400">Связь повреждена</span>
                            )}
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

          {deleteBlockedRentals.length > 0 && (
            <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20">
              <CardContent className="space-y-3 pt-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">Удаление заблокировано</p>
                </div>
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  Сначала замените клиента в связанных арендах.
                </p>
                <div className="space-y-2">
                  {deleteBlockedRentals.slice(0, 5).map(rental => {
                    const rentalKey = rental.id || rental.rentalId || '';
                    return (
                      <Link
                        key={`${rentalKey}-${rental.equipmentId || rental.equipmentInv || ''}`}
                        to={rentalKey ? `/rentals/${rentalKey}` : '/rentals'}
                        className="block rounded-md border border-amber-200 bg-white px-3 py-2 text-xs text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-gray-900 dark:text-amber-100 dark:hover:bg-amber-950/40"
                      >
                        <span className="font-medium">{rental.rentalId || rental.id || 'Аренда'}</span>
                        <span className="block text-amber-700 dark:text-amber-300">
                          {rental.equipmentInv || rental.equipmentId || 'Техника не указана'} · {rentalStatusLabel(rental.status || '')}
                        </span>
                      </Link>
                    );
                  })}
                  {deleteBlockedRentals.length > 5 && (
                    <Link to="/rentals" className="text-xs font-medium text-amber-800 hover:underline dark:text-amber-200">
                      Показать все аренды
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {deleteHistoryLinks.length > 0 && (
            <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20">
              <CardContent className="space-y-3 pt-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">Есть история по клиенту</p>
                </div>
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  Физическое удаление заблокировано. Переведите клиента в неактивный статус.
                </p>
                <div className="flex flex-wrap gap-2">
                  {deleteHistoryLinks.map(link => (
                    <Badge key={link.collection} variant="warning">
                      {link.collection}: {link.count}
                    </Badge>
                  ))}
                </div>
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
    <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl rounded-2xl bg-white p-5 dark:bg-gray-950 sm:p-6">
        <DialogHeader>
          <DialogTitle>Добавить контакт</DialogTitle>
          <DialogDescription>Контакт сохранится в карточке клиента и появится в правом блоке.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto py-4 pr-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Имя / контактное лицо</span>
              <Input
                value={contactDraft.name}
                onChange={event => setContactDraft(current => ({ ...current, name: event.target.value }))}
                aria-invalid={Boolean(contactErrors.name)}
              />
              {contactErrors.name && <span className="text-xs text-red-600 dark:text-red-300">{contactErrors.name}</span>}
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Роль / должность</span>
              <Input
                value={contactDraft.role}
                onChange={event => setContactDraft(current => ({ ...current, role: event.target.value }))}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Телефон</span>
              <Input
                value={contactDraft.phone}
                onChange={event => setContactDraft(current => ({ ...current, phone: event.target.value }))}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Email</span>
              <Input
                type="email"
                value={contactDraft.email}
                onChange={event => setContactDraft(current => ({ ...current, email: event.target.value }))}
                aria-invalid={Boolean(contactErrors.email)}
              />
              {contactErrors.email && <span className="text-xs text-red-600 dark:text-red-300">{contactErrors.email}</span>}
            </label>
          </div>
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Комментарий</span>
            <Textarea
              className="min-h-24"
              value={contactDraft.comment}
              onChange={event => setContactDraft(current => ({ ...current, comment: event.target.value }))}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setContactDialogOpen(false)}>Отмена</Button>
          <Button onClick={handleSaveContact} disabled={updateClient.isPending}>Добавить контакт</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-xl rounded-2xl bg-white p-5 dark:bg-gray-950 sm:p-6">
        <DialogHeader>
          <DialogTitle>Добавить заметку</DialogTitle>
          <DialogDescription>Заметка добавится к текущим примечаниям клиента с автором и датой.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto py-4 pr-1">
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Текст заметки</span>
            <Textarea
              className="min-h-36"
              value={noteDraft}
              onChange={event => {
                setNoteDraft(event.target.value);
                if (noteError) setNoteError('');
              }}
              aria-invalid={Boolean(noteError)}
            />
            {noteError && <span className="text-xs text-red-600 dark:text-red-300">{noteError}</span>}
          </label>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setNoteDialogOpen(false)}>Отмена</Button>
          <Button onClick={handleSaveNote} disabled={updateClient.isPending}>Добавить заметку</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={fileDialogOpen} onOpenChange={setFileDialogOpen}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-xl rounded-2xl bg-white p-5 dark:bg-gray-950 sm:p-6">
        <DialogHeader>
          <DialogTitle>Добавить файл</DialogTitle>
          <DialogDescription>Сохранится файл карты партнёра в существующем поле карточки клиента.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto py-4 pr-1">
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Название файла</span>
            <Input
              value={fileDraft.title}
              onChange={event => setFileDraft(current => ({ ...current, title: event.target.value }))}
              placeholder={fileDraft.file?.name || 'Например: Карта партнёра'}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Файл</span>
            <Input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
              onChange={event => {
                setFileDraft(current => ({ ...current, file: event.target.files?.[0] || null }));
                setFileError('');
              }}
              aria-invalid={Boolean(fileError)}
            />
            {fileError && <span className="text-xs text-red-600 dark:text-red-300">{fileError}</span>}
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Комментарий</span>
            <Textarea
              className="min-h-24"
              value={fileDraft.comment}
              onChange={event => setFileDraft(current => ({ ...current, comment: event.target.value }))}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setFileDialogOpen(false)}>Отмена</Button>
          <Button onClick={handleSaveFile} disabled={updateClient.isPending}>Добавить файл</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
