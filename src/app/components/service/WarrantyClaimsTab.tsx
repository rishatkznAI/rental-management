import React from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  Factory,
  FileText,
  MessageSquareReply,
  Search,
  Send,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { EquipmentCombobox, eqLabel } from '../ui/EquipmentCombobox';
import { Input } from '../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Textarea } from '../ui/textarea';
import { useAuth } from '../../contexts/AuthContext';
import { useEquipmentList } from '../../hooks/useEquipment';
import {
  useCreateWarrantyClaim,
  useDeleteWarrantyClaim,
  useUpdateWarrantyClaim,
  useWarrantyClaimsList,
} from '../../hooks/useWarrantyClaims';
import { cn, formatDate } from '../../lib/utils';
import type {
  Equipment,
  ServicePriority,
  ServiceTicket,
  WarrantyClaim,
  WarrantyClaimStatus,
} from '../../types';

const NO_VALUE = '__none__';

const PROCESS_STEPS: WarrantyClaimStatus[] = [
  'draft',
  'sent_to_factory',
  'factory_review',
  'answer_received',
  'approved',
  'rejected',
  'parts_shipping',
  'closed',
];

const MANAGEMENT_ACTIVE_STATUSES = ['new', 'review', 'repair_required', 'waiting_client'] as const;
type ManagementClaimStatus = typeof MANAGEMENT_ACTIVE_STATUSES[number] | 'closed' | 'rejected';

type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];

const STATUS_META: Record<WarrantyClaimStatus, { label: string; variant: BadgeVariant; description: string }> = {
  draft: {
    label: 'Новая',
    variant: 'default',
    description: 'Рекламация принята в контур контроля качества',
  },
  sent_to_factory: {
    label: 'На рассмотрении',
    variant: 'warning',
    description: 'Ответственный разбирает причину и следующий шаг',
  },
  factory_review: {
    label: 'На рассмотрении',
    variant: 'warning',
    description: 'Рекламация требует управленческого решения',
  },
  answer_received: {
    label: 'Ожидание клиента',
    variant: 'info',
    description: 'Нужен ответ, подтверждение или согласование клиента',
  },
  approved: {
    label: 'Требует ремонта',
    variant: 'warning',
    description: 'По рекламации нужен ремонт или доработка',
  },
  rejected: {
    label: 'Отклонено',
    variant: 'error',
    description: 'Рекламация отклонена после проверки',
  },
  parts_shipping: {
    label: 'Требует ремонта',
    variant: 'warning',
    description: 'Рекламация требует ремонта, запчастей или доработки',
  },
  closed: {
    label: 'Закрыта',
    variant: 'default',
    description: 'Рекламация завершена',
  },
};

const MANAGEMENT_STATUS_META: Record<ManagementClaimStatus, { label: string; variant: BadgeVariant; description: string }> = {
  new: { label: 'Новая', variant: 'default', description: 'Новые обращения контроля качества' },
  review: { label: 'На рассмотрении', variant: 'warning', description: 'Требуют управленческого разбора' },
  repair_required: { label: 'Требует ремонта', variant: 'warning', description: 'Нужен повторный ремонт или доработка' },
  waiting_client: { label: 'Ожидание клиента', variant: 'info', description: 'Ожидается позиция или подтверждение клиента' },
  closed: { label: 'Закрыта', variant: 'success', description: 'Закрытые рекламации' },
  rejected: { label: 'Отклонена', variant: 'error', description: 'Отклоненные обращения' },
};

const PRIORITY_OPTIONS: Array<{ value: ServicePriority; label: string }> = [
  { value: 'low', label: 'Низкий' },
  { value: 'medium', label: 'Средний' },
  { value: 'high', label: 'Высокий' },
  { value: 'critical', label: 'Критический' },
];

const SECTION_CARD_CLASS = 'min-w-0 rounded-lg border-border bg-card shadow-sm';
const SURFACE_PANEL_CLASS = 'rounded-lg border border-border bg-muted/30';
const EMPTY_STATE_CLASS = 'rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground';
const FIELD_LABEL_CLASS = 'text-sm font-medium text-foreground';
const DETAIL_BLOCK_CLASS = 'rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground';

const KPI_TONE_CLASS = {
  default: {
    card: 'border-border bg-card/85',
    label: 'text-muted-foreground',
    value: 'text-foreground',
    caption: 'text-muted-foreground',
  },
  info: {
    card: 'border-info/30 bg-info/10',
    label: 'text-info-foreground',
    value: 'text-info-foreground',
    caption: 'text-info-foreground/80',
  },
  warning: {
    card: 'border-warning/30 bg-warning/10',
    label: 'text-warning-foreground',
    value: 'text-warning-foreground',
    caption: 'text-warning-foreground/80',
  },
  success: {
    card: 'border-success/30 bg-success/10',
    label: 'text-success-foreground',
    value: 'text-success-foreground',
    caption: 'text-success-foreground/80',
  },
  danger: {
    card: 'border-danger/30 bg-danger/10',
    label: 'text-danger-foreground',
    value: 'text-danger-foreground',
    caption: 'text-danger-foreground/80',
  },
} as const;

type ClaimFormState = {
  serviceTicketId: string;
  equipmentId: string;
  factoryName: string;
  factoryContact: string;
  factoryCaseNumber: string;
  priority: ServicePriority;
  responseDueDate: string;
  failureDescription: string;
  requestedResolution: string;
};

type ClaimEditState = {
  status: WarrantyClaimStatus;
  factoryCaseNumber: string;
  responseDueDate: string;
  factoryResponse: string;
  decision: string;
};

const EMPTY_FORM: ClaimFormState = {
  serviceTicketId: '',
  equipmentId: '',
  factoryName: '',
  factoryContact: '',
  factoryCaseNumber: '',
  priority: 'medium',
  responseDueDate: '',
  failureDescription: '',
  requestedResolution: '',
};

function toDateInputValue(value?: string) {
  return value ? value.slice(0, 10) : '';
}

function nowIso() {
  return new Date().toISOString();
}

function formatDateSafe(value?: string) {
  return value ? formatDate(value) : '—';
}

function formatEquipmentLabel(equipment: Equipment) {
  return `${equipment.manufacturer} ${equipment.model} (INV: ${equipment.inventoryNumber})`;
}

function getClaimSearchText(claim: WarrantyClaim) {
  return [
    claim.id,
    claim.number,
    claim.serviceTicketId,
    claim.equipmentLabel,
    claim.inventoryNumber,
    claim.serialNumber,
    claim.manufacturer,
    claim.client,
    claim.clientName,
    claim.factoryName,
    claim.factoryCaseNumber,
    claim.reason,
    claim.failureDescription,
    claim.requestedResolution,
    claim.result,
    claim.decision,
  ].filter(Boolean).join(' ').toLowerCase();
}

function getClaimNumber(claim: WarrantyClaim) {
  return claim.number || claim.id;
}

function getClaimClient(claim: WarrantyClaim, ticketById: Map<string, ServiceTicket>) {
  const ticket = claim.serviceTicketId ? ticketById.get(claim.serviceTicketId) : undefined;
  return claim.clientName || claim.client || ticket?.client || '—';
}

function getClaimResponsible(claim: WarrantyClaim) {
  return claim.responsible || claim.responsibleUserName || claim.createdByUserName || claim.responsibleUserId || claim.createdByUserId || '—';
}

function getClaimReason(claim: WarrantyClaim) {
  return claim.reason || claim.failureDescription || '—';
}

function getClaimDeadline(claim: WarrantyClaim) {
  return claim.deadline || claim.responseDueDate;
}

function getClaimResult(claim: WarrantyClaim) {
  return claim.result || claim.decision || claim.factoryResponse || '—';
}

function normalizeManagementStatus(status?: string): ManagementClaimStatus {
  switch ((status || '').trim()) {
    case 'draft':
    case 'new':
    case 'created':
    case 'open':
      return 'new';
    case 'sent_to_factory':
    case 'factory_review':
    case 'in_review':
    case 'review':
    case 'investigation':
    case 'answer_received':
      return 'review';
    case 'approved':
    case 'parts_shipping':
    case 'repair_required':
    case 'needs_repair':
    case 'requires_repair':
    case 'in_repair':
      return 'repair_required';
    case 'waiting_client':
    case 'client_waiting':
    case 'waiting_for_client':
      return 'waiting_client';
    case 'rejected':
    case 'declined':
      return 'rejected';
    case 'closed':
    case 'completed':
    case 'done':
      return 'closed';
    default:
      return 'review';
  }
}

function getManagementStatusBadge(status?: string) {
  const meta = MANAGEMENT_STATUS_META[normalizeManagementStatus(status)];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

function toEditableStatus(status?: string): WarrantyClaimStatus {
  return PROCESS_STEPS.includes(status as WarrantyClaimStatus)
    ? status as WarrantyClaimStatus
    : 'factory_review';
}

function isClaimClosedThisMonth(claim: WarrantyClaim) {
  const status = normalizeManagementStatus(claim.status);
  if (status !== 'closed' && status !== 'rejected') return false;
  const dateKey = (claim.closedAt || claim.updatedAt || claim.createdAt || '').slice(0, 10);
  if (!dateKey) return false;
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const todayKey = today.toISOString().slice(0, 10);
  return dateKey >= monthStart && dateKey <= todayKey;
}

function getClaimDueTone(claim: WarrantyClaim) {
  if (normalizeManagementStatus(claim.status) === 'closed') return 'text-success-foreground';
  if (isResponseOverdue(claim)) return 'font-semibold text-danger-foreground';
  if (claim.status === 'factory_review' || claim.status === 'parts_shipping') return 'font-semibold text-warning-foreground';
  return 'text-muted-foreground';
}

function claimMatchesPeriod(claim: WarrantyClaim, period: string) {
  if (period === 'all') return true;
  const createdKey = (claim.createdAt || '').slice(0, 10);
  if (!createdKey) return false;
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  if (period === 'today') return createdKey === todayKey;
  const start = new Date(today);
  if (period === 'last7') start.setDate(start.getDate() - 6);
  if (period === 'month') start.setDate(1);
  const startKey = start.toISOString().slice(0, 10);
  return createdKey >= startKey && createdKey <= todayKey;
}

function isResponseOverdue(claim: WarrantyClaim) {
  const deadline = getClaimDeadline(claim);
  if (!deadline || ['closed', 'rejected'].includes(normalizeManagementStatus(claim.status))) return false;
  return deadline.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

function getPriorityLabel(priority: ServicePriority) {
  return PRIORITY_OPTIONS.find(option => option.value === priority)?.label ?? priority;
}

function resolveClaimEquipment(ticket: ServiceTicket | undefined, equipment: Equipment | undefined) {
  return {
    equipmentId: ticket?.equipmentId || equipment?.id || undefined,
    equipmentLabel: ticket?.equipment || (equipment ? formatEquipmentLabel(equipment) : ''),
    inventoryNumber: ticket?.inventoryNumber || equipment?.inventoryNumber || undefined,
    serialNumber: ticket?.serialNumber || equipment?.serialNumber || undefined,
    manufacturer: equipment?.manufacturer || undefined,
  };
}

type WarrantyClaimsTabProps = {
  tickets: ServiceTicket[];
  canEdit: boolean;
  canDelete: boolean;
  canCreateDocuments?: boolean;
  onOpenTicket?: (ticketId: string) => void;
};

export function WarrantyClaimsTab({ tickets, canEdit, canDelete, canCreateDocuments = false, onOpenTicket }: WarrantyClaimsTabProps) {
  const { user } = useAuth();
  const { data: claims = [], isLoading } = useWarrantyClaimsList();
  const { data: equipmentList = [] } = useEquipmentList();
  const createClaim = useCreateWarrantyClaim();
  const updateClaim = useUpdateWarrantyClaim();
  const deleteClaim = useDeleteWarrantyClaim();

  const [form, setForm] = React.useState<ClaimFormState>(EMPTY_FORM);
  const [statusFilter, setStatusFilter] = React.useState<ManagementClaimStatus | 'all'>('all');
  const [search, setSearch] = React.useState('');
  const [selectedClaimId, setSelectedClaimId] = React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState<ClaimEditState | null>(null);
  const [equipmentFilter, setEquipmentFilter] = React.useState('all');
  const [clientFilter, setClientFilter] = React.useState('all');
  const [factoryFilter, setFactoryFilter] = React.useState('all');
  const [responsibleFilter, setResponsibleFilter] = React.useState('all');
  const [periodFilter, setPeriodFilter] = React.useState('all');
  const [panelTab, setPanelTab] = React.useState<'overview' | 'works' | 'documents' | 'history' | 'decision'>('overview');

  const equipmentById = React.useMemo(() => new Map(equipmentList.map(item => [item.id, item])), [equipmentList]);
  const ticketById = React.useMemo(() => new Map(tickets.map(ticket => [ticket.id, ticket])), [tickets]);

  const filterOptions = React.useMemo(() => ({
    equipment: Array.from(new Set(claims.map(claim => claim.equipmentLabel).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'ru')),
    clients: Array.from(new Set(claims.map(claim => getClaimClient(claim, ticketById)).filter(value => value && value !== '—'))).sort((left, right) => left.localeCompare(right, 'ru')),
    factories: Array.from(new Set(claims.map(claim => claim.factoryName).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'ru')),
    responsible: Array.from(new Set(claims.map(getClaimResponsible).filter(value => value && value !== '—'))).sort((left, right) => left.localeCompare(right, 'ru')),
  }), [claims, ticketById]);

  const filteredClaims = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return claims
      .filter(claim => statusFilter === 'all' || normalizeManagementStatus(claim.status) === statusFilter)
      .filter(claim => equipmentFilter === 'all' || claim.equipmentLabel === equipmentFilter)
      .filter(claim => clientFilter === 'all' || getClaimClient(claim, ticketById) === clientFilter)
      .filter(claim => factoryFilter === 'all' || claim.factoryName === factoryFilter)
      .filter(claim => responsibleFilter === 'all' || getClaimResponsible(claim) === responsibleFilter)
      .filter(claim => claimMatchesPeriod(claim, periodFilter))
      .filter(claim => !query || getClaimSearchText(claim).includes(query))
      .sort((left, right) => {
        const leftTime = new Date(left.updatedAt || left.createdAt).getTime();
        const rightTime = new Date(right.updatedAt || right.createdAt).getTime();
        return rightTime - leftTime;
      });
  }, [claims, clientFilter, equipmentFilter, factoryFilter, periodFilter, responsibleFilter, search, statusFilter, ticketById]);

  const selectedClaim = React.useMemo(() => {
    if (!filteredClaims.length) return null;
    return filteredClaims.find(claim => claim.id === selectedClaimId) ?? filteredClaims[0];
  }, [filteredClaims, selectedClaimId]);

  React.useEffect(() => {
    if (!selectedClaim) {
      setEditForm(null);
      return;
    }
    setSelectedClaimId(selectedClaim.id);
    setPanelTab('overview');
    setEditForm({
      status: toEditableStatus(selectedClaim.status),
      factoryCaseNumber: selectedClaim.factoryCaseNumber ?? '',
      responseDueDate: toDateInputValue(selectedClaim.responseDueDate),
      factoryResponse: selectedClaim.factoryResponse ?? '',
      decision: selectedClaim.decision ?? '',
    });
  }, [selectedClaim?.id]);

  const statusCounts = React.useMemo(() => {
    const counts = Object.fromEntries(Object.keys(MANAGEMENT_STATUS_META).map(status => [status, 0])) as Record<ManagementClaimStatus, number>;
    claims.forEach(claim => {
      const status = normalizeManagementStatus(claim.status);
      counts[status] = (counts[status] ?? 0) + 1;
    });
    return counts;
  }, [claims]);

  const metrics = React.useMemo(() => ({
    active: claims.filter(claim => !['closed', 'rejected'].includes(normalizeManagementStatus(claim.status))).length,
    new: claims.filter(claim => normalizeManagementStatus(claim.status) === 'new').length,
    inReview: claims.filter(claim => normalizeManagementStatus(claim.status) === 'review').length,
    closedMonth: claims.filter(isClaimClosedThisMonth).length,
    overdue: claims.filter(isResponseOverdue).length,
  }), [claims]);

  const kpiCards = React.useMemo(() => [
    { label: 'Активные', value: metrics.active, caption: 'Требуют контроля', tone: 'default' as const },
    { label: 'Новые', value: metrics.new, caption: 'Первичная проверка', tone: 'info' as const },
    { label: 'На рассмотрении', value: metrics.inReview, caption: 'Разбор причины', tone: 'warning' as const },
    { label: 'Закрыты за месяц', value: metrics.closedMonth, caption: 'Итог за период', tone: 'success' as const },
    { label: 'Просрочены', value: metrics.overdue, caption: 'Нарушен срок реакции', tone: 'danger' as const },
  ], [metrics]);

  function handleTicketChange(value: string) {
    const serviceTicketId = value === NO_VALUE ? '' : value;
    const ticket = serviceTicketId ? ticketById.get(serviceTicketId) : undefined;
    const equipment = ticket?.equipmentId ? equipmentById.get(ticket.equipmentId) : undefined;
    const description = [ticket?.reason, ticket?.description].filter(Boolean).join('\n');

    setForm(prev => ({
      ...prev,
      serviceTicketId,
      equipmentId: ticket?.equipmentId ?? prev.equipmentId,
      priority: ticket?.priority ?? prev.priority,
      factoryName: prev.factoryName || equipment?.manufacturer || '',
      failureDescription: prev.failureDescription || description,
    }));
  }

  function handleEquipmentChange(equipmentId: string) {
    const equipment = equipmentById.get(equipmentId);
    setForm(prev => ({
      ...prev,
      equipmentId,
      factoryName: prev.factoryName || equipment?.manufacturer || '',
    }));
  }

  async function handleCreateClaim(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;

    const ticket = form.serviceTicketId ? ticketById.get(form.serviceTicketId) : undefined;
    const equipment = form.equipmentId ? equipmentById.get(form.equipmentId) : undefined;
    const claimEquipment = resolveClaimEquipment(ticket, equipment);

    if (!claimEquipment.equipmentLabel) {
      toast.error('Выберите сервисную заявку или технику.');
      return;
    }
    if (!form.factoryName.trim()) {
      toast.error('Укажите ответственного контрагента или производителя.');
      return;
    }
    if (!form.failureDescription.trim()) {
      toast.error('Опишите причину рекламации.');
      return;
    }
    if (!form.requestedResolution.trim()) {
      toast.error('Укажите ожидаемый управленческий итог.');
      return;
    }

    const author = user?.name || 'Сервис';
    const createdAt = nowIso();

    try {
      const created = await createClaim.mutateAsync({
        serviceTicketId: form.serviceTicketId || undefined,
        equipmentId: claimEquipment.equipmentId,
        equipmentLabel: claimEquipment.equipmentLabel,
        inventoryNumber: claimEquipment.inventoryNumber,
        serialNumber: claimEquipment.serialNumber,
        manufacturer: claimEquipment.manufacturer || form.factoryName.trim(),
        factoryName: form.factoryName.trim(),
        factoryContact: form.factoryContact.trim() || undefined,
        factoryCaseNumber: form.factoryCaseNumber.trim() || undefined,
        failureDescription: form.failureDescription.trim(),
        requestedResolution: form.requestedResolution.trim(),
        status: 'draft',
        priority: form.priority,
        responseDueDate: form.responseDueDate || undefined,
        createdAt,
        updatedAt: createdAt,
        createdByUserId: user?.id,
        createdByUserName: author,
        history: [
          {
            date: createdAt,
            text: 'Создана рекламация в контуре контроля качества.',
            author,
            type: 'status_change',
          },
        ],
      });
      setForm(EMPTY_FORM);
      setSelectedClaimId(created.id);
      toast.success('Рекламация создана.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось создать рекламацию.');
    }
  }

  async function handleSaveClaim() {
    if (!selectedClaim || !editForm || !canEdit) return;

    const author = user?.name || 'Сервис';
    const updatedAt = nowIso();
    const history = [...(selectedClaim.history || [])];
    const nextResponse = editForm.factoryResponse.trim();
    const nextDecision = editForm.decision.trim();

    if (selectedClaim.status !== editForm.status) {
      const previousLabel = STATUS_META[selectedClaim.status as WarrantyClaimStatus]?.label ?? MANAGEMENT_STATUS_META[normalizeManagementStatus(selectedClaim.status)].label;
      const nextLabel = STATUS_META[editForm.status]?.label ?? MANAGEMENT_STATUS_META[normalizeManagementStatus(editForm.status)].label;
      history.push({
        date: updatedAt,
        text: `Статус изменён: ${previousLabel} → ${nextLabel}.`,
        author,
        type: 'status_change',
      });
    }
    if ((selectedClaim.factoryResponse || '').trim() !== nextResponse && nextResponse) {
      history.push({
        date: updatedAt,
        text: 'Зафиксирован ответ завода.',
        author,
        type: 'factory_response',
      });
    }
    if ((selectedClaim.decision || '').trim() !== nextDecision && nextDecision) {
      history.push({
        date: updatedAt,
        text: 'Обновлено итоговое решение по рекламации.',
        author,
        type: 'comment',
      });
    }

    const payload: Partial<WarrantyClaim> = {
      status: editForm.status,
      factoryCaseNumber: editForm.factoryCaseNumber.trim() || undefined,
      responseDueDate: editForm.responseDueDate || undefined,
      factoryResponse: nextResponse || undefined,
      decision: nextDecision || undefined,
      updatedAt,
      history,
    };

    if (editForm.status === 'sent_to_factory' && !selectedClaim.sentAt) {
      payload.sentAt = updatedAt;
    }
    if (editForm.status === 'closed' && !selectedClaim.closedAt) {
      payload.closedAt = updatedAt;
    }

    try {
      await updateClaim.mutateAsync({ id: selectedClaim.id, data: payload });
      toast.success('Рекламация обновлена.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось обновить рекламацию.');
    }
  }

  async function handleDeleteClaim() {
    if (!selectedClaim || !canDelete) return;
    if (!window.confirm(`Удалить рекламацию ${selectedClaim.id}?`)) return;

    try {
      await deleteClaim.mutateAsync(selectedClaim.id);
      setSelectedClaimId(null);
      toast.success('Рекламация удалена.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось удалить рекламацию.');
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {kpiCards.map(card => {
          const tone = KPI_TONE_CLASS[card.tone];
          return (
            <div key={card.label} className={cn('min-h-[88px] rounded-lg border p-3 shadow-sm', tone.card)}>
              <p className={cn('text-xs font-semibold', tone.label)}>{card.label}</p>
              <p className={cn('mt-2 text-2xl font-black', tone.value)}>{card.value}</p>
              <p className={cn('mt-1 text-xs', tone.caption)}>{card.caption}</p>
            </div>
          );
        })}
      </div>

      <Card className={SECTION_CARD_CLASS}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Factory className="h-5 w-5 text-primary" />
            Управленческий контур рекламаций
          </CardTitle>
          <CardDescription>
            Отдельный журнал повторных поломок, претензий клиентов, гарантийных случаев и спорных ремонтов.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {(Object.keys(MANAGEMENT_STATUS_META) as ManagementClaimStatus[]).map(status => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  statusFilter === status
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-card/70 hover:border-primary/30 hover:bg-accent/40',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={MANAGEMENT_STATUS_META[status].variant}>{MANAGEMENT_STATUS_META[status].label}</Badge>
                  <span className="text-sm font-semibold text-foreground">{statusCounts[status]}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{MANAGEMENT_STATUS_META[status].description}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <div className="min-w-0 space-y-4">
          <Card className={SECTION_CARD_CLASS}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Send className="h-5 w-5 text-primary" />
                Новая рекламация
              </CardTitle>
              <CardDescription>Зафиксируйте повторную поломку, претензию клиента, гарантийный случай или спор по качеству ремонта.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateClaim} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className={FIELD_LABEL_CLASS}>Сервисная заявка</span>
                    <Select value={form.serviceTicketId || NO_VALUE} onValueChange={handleTicketChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Без заявки" />
                      </SelectTrigger>
                      <SelectContent className="max-h-80">
                        <SelectItem value={NO_VALUE}>Без сервисной заявки</SelectItem>
                        {tickets.map(ticket => (
                          <SelectItem key={ticket.id} value={ticket.id}>
                            {ticket.id} · {ticket.equipment}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="space-y-1.5">
                    <span className={FIELD_LABEL_CLASS}>Техника</span>
                    <EquipmentCombobox
                      equipment={equipmentList}
                      value={form.equipmentId}
                      onChange={handleEquipmentChange}
                      placeholder="Модель / INV / SN"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className={FIELD_LABEL_CLASS}>Контрагент / производитель</span>
                    <Input
                      value={form.factoryName}
                      onChange={(event) => setForm(prev => ({ ...prev, factoryName: event.target.value }))}
                      placeholder="Haulotte, JLG, Dingli..."
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className={FIELD_LABEL_CLASS}>Контакт</span>
                    <Input
                      value={form.factoryContact}
                      onChange={(event) => setForm(prev => ({ ...prev, factoryContact: event.target.value }))}
                      placeholder="email, телефон или менеджер"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className={FIELD_LABEL_CLASS}>Внешний номер</span>
                    <Input
                      value={form.factoryCaseNumber}
                      onChange={(event) => setForm(prev => ({ ...prev, factoryCaseNumber: event.target.value }))}
                      placeholder="если уже присвоен"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className={FIELD_LABEL_CLASS}>Срок реакции</span>
                    <Input
                      type="date"
                      value={form.responseDueDate}
                      onChange={(event) => setForm(prev => ({ ...prev, responseDueDate: event.target.value }))}
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className={FIELD_LABEL_CLASS}>Приоритет</span>
                    <Select
                      value={form.priority}
                      onValueChange={(value) => setForm(prev => ({ ...prev, priority: value as ServicePriority }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITY_OPTIONS.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <div className={DETAIL_BLOCK_CLASS}>
                    <p className="font-medium text-foreground">Что пойдёт в обращение</p>
                    <p className="mt-1">
                      {form.equipmentId && equipmentById.get(form.equipmentId)
                        ? eqLabel(equipmentById.get(form.equipmentId)!)
                        : 'Выберите технику или сервисную заявку'}
                    </p>
                  </div>
                </div>

                <label className="space-y-1.5">
                  <span className={FIELD_LABEL_CLASS}>Причина рекламации</span>
                  <Textarea
                    value={form.failureDescription}
                    onChange={(event) => setForm(prev => ({ ...prev, failureDescription: event.target.value }))}
                    placeholder="Повторная поломка, претензия клиента, гарантия, спор по качеству..."
                    rows={4}
                  />
                </label>

                <label className="space-y-1.5">
                  <span className={FIELD_LABEL_CLASS}>Ожидаемый итог</span>
                  <Textarea
                    value={form.requestedResolution}
                    onChange={(event) => setForm(prev => ({ ...prev, requestedResolution: event.target.value }))}
                    placeholder="Повторный ремонт, компенсация, отказ, согласование с клиентом..."
                    rows={3}
                  />
                </label>

                <div className="flex justify-end">
                  <Button type="submit" disabled={!canEdit || createClaim.isPending}>
                    <Send className="h-4 w-4" />
                    {createClaim.isPending ? 'Создаём...' : 'Создать рекламацию'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className={SECTION_CARD_CLASS}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5 text-primary" />
                Журнал рекламаций
              </CardTitle>
              <CardDescription>Поиск по номеру, технике, клиенту, связанной заявке и причине.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 lg:grid-cols-[minmax(240px,1.6fr)_repeat(5,minmax(120px,0.8fr))]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="№, техника, клиент, заявка, причина..."
                    className="h-9 pl-10 text-sm"
                  />
                </div>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as ManagementClaimStatus | 'all')}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Статус" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все статусы</SelectItem>
                    {(Object.keys(MANAGEMENT_STATUS_META) as ManagementClaimStatus[]).map(status => (
                      <SelectItem key={status} value={status}>{MANAGEMENT_STATUS_META[status].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={equipmentFilter} onValueChange={setEquipmentFilter}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Техника" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Вся техника</SelectItem>
                    {filterOptions.equipment.map(equipment => (
                      <SelectItem key={equipment} value={equipment}>{equipment}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={clientFilter} onValueChange={setClientFilter}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Клиент" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все клиенты</SelectItem>
                    {filterOptions.clients.map(client => (
                      <SelectItem key={client} value={client}>{client}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={factoryFilter} onValueChange={setFactoryFilter}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Поставщик" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все поставщики</SelectItem>
                    {filterOptions.factories.map(factory => (
                      <SelectItem key={factory} value={factory}>{factory}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={periodFilter} onValueChange={setPeriodFilter}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Период" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все даты</SelectItem>
                    <SelectItem value="today">Сегодня</SelectItem>
                    <SelectItem value="last7">7 дней</SelectItem>
                    <SelectItem value="month">Этот месяц</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Select value={responsibleFilter} onValueChange={setResponsibleFilter}>
                  <SelectTrigger className="w-full sm:w-[220px]"><SelectValue placeholder="Ответственный" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все ответственные</SelectItem>
                    {filterOptions.responsible.map(responsible => (
                      <SelectItem key={responsible} value={responsible}>{responsible}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setSearch('');
                    setStatusFilter('all');
                    setEquipmentFilter('all');
                    setClientFilter('all');
                    setFactoryFilter('all');
                    setResponsibleFilter('all');
                    setPeriodFilter('all');
                  }}
                >
                  Сбросить
                </Button>
              </div>

              <div className="space-y-2">
                {isLoading ? (
                  <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                    Загружаем рекламации...
                  </div>
                ) : filteredClaims.length === 0 ? (
                  <div className={EMPTY_STATE_CLASS}>
                    Рекламации не найдены.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                    <div className="hidden grid-cols-[minmax(110px,0.7fr)_minmax(160px,1fr)_minmax(130px,0.8fr)_minmax(110px,0.7fr)_minmax(190px,1.2fr)_130px_minmax(130px,0.8fr)_105px_minmax(110px,0.7fr)] gap-3 border-b border-border bg-muted/40 px-4 py-3 text-xs font-semibold text-muted-foreground xl:grid">
                      <div>№ рекламации</div>
                      <div>Техника</div>
                      <div>Клиент</div>
                      <div>Заявка</div>
                      <div>Причина</div>
                      <div>Статус</div>
                      <div>Ответственный</div>
                      <div>Срок реакции</div>
                      <div>Обновлено</div>
                    </div>
                    {filteredClaims.map(claim => (
                      <button
                        key={claim.id}
                        type="button"
                        onClick={() => setSelectedClaimId(claim.id)}
                        className={cn(
                          'grid w-full gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 xl:grid-cols-[minmax(110px,0.7fr)_minmax(160px,1fr)_minmax(130px,0.8fr)_minmax(110px,0.7fr)_minmax(190px,1.2fr)_130px_minmax(130px,0.8fr)_105px_minmax(110px,0.7fr)] xl:items-center',
                          selectedClaim?.id === claim.id
                            ? 'bg-primary/10'
                            : 'bg-card hover:bg-accent/35',
                        )}
                      >
                        <div className="font-mono text-sm font-bold text-primary">{getClaimNumber(claim)}</div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">{claim.equipmentLabel || '—'}</div>
                          <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                            INV: {claim.inventoryNumber || '—'} · SN: {claim.serialNumber || '—'}
                          </div>
                        </div>
                        <div className="truncate text-sm text-foreground">{getClaimClient(claim, ticketById)}</div>
                        <div className="font-mono text-sm text-foreground">{claim.serviceTicketId || '—'}</div>
                        <div className="min-w-0">
                          <div className="line-clamp-2 text-sm font-medium text-foreground">{getClaimReason(claim)}</div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">{getClaimResult(claim)}</div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {getManagementStatusBadge(claim.status)}
                          {isResponseOverdue(claim) && <Badge variant="error">Просрочено</Badge>}
                        </div>
                        <div className="truncate text-sm text-foreground">{getClaimResponsible(claim)}</div>
                        <div className={`text-sm ${getClaimDueTone(claim)}`}>{formatDateSafe(getClaimDeadline(claim))}</div>
                        <div className="text-sm text-muted-foreground">{formatDateSafe(claim.updatedAt || claim.createdAt)}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className={SECTION_CARD_CLASS}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck className="h-5 w-5 text-primary" />
              Карточка рекламации
              </CardTitle>
            <CardDescription>Детали причины, срока реакции, связанной заявки и управленческого итога.</CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedClaim || !editForm ? (
              <div className={EMPTY_STATE_CLASS}>
                Выберите рекламацию из журнала.
              </div>
            ) : (
              <div className="space-y-5">
                <div className={cn(SURFACE_PANEL_CLASS, 'p-4')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-primary">{selectedClaim.id}</span>
                        {getManagementStatusBadge(selectedClaim.status)}
                        <Badge variant="default">{getPriorityLabel(selectedClaim.priority)}</Badge>
                      </div>
                      <p className="mt-3 font-medium text-foreground">{selectedClaim.equipmentLabel}</p>
                      <div className="mt-2 grid gap-1 text-sm text-muted-foreground">
                        <p>Клиент: {getClaimClient(selectedClaim, ticketById)}</p>
                        <p>INV: {selectedClaim.inventoryNumber || '—'} · SN: {selectedClaim.serialNumber || '—'}</p>
                        <p>Создано: {formatDateSafe(selectedClaim.createdAt)}</p>
                        <p>Обновлено: {formatDateSafe(selectedClaim.updatedAt || selectedClaim.createdAt)}</p>
                        {selectedClaim.serviceTicketId && (
                          onOpenTicket ? (
                            <button
                              type="button"
                              onClick={() => onOpenTicket(selectedClaim.serviceTicketId!)}
                              className="text-left font-medium text-primary hover:underline"
                            >
                              Открыть сервисную заявку {selectedClaim.serviceTicketId}
                            </button>
                          ) : (
                            <Link
                              to={`/service/${selectedClaim.serviceTicketId}`}
                              className="font-medium text-primary hover:underline"
                            >
                              Открыть сервисную заявку {selectedClaim.serviceTicketId}
                            </Link>
                          )
                        )}
                      </div>
                    </div>
                    {isResponseOverdue(selectedClaim) && (
                      <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger-foreground">
                        <div className="flex items-center gap-2">
                          <CalendarClock className="h-4 w-4" />
                          Срок реакции прошёл
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-1 overflow-x-auto border-b border-border pb-2">
                  {[
                    { id: 'overview', label: 'Обзор' },
                    { id: 'works', label: 'Работы' },
                    { id: 'documents', label: 'Документы' },
                    { id: 'history', label: 'История' },
                    { id: 'decision', label: 'Решение' },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setPanelTab(tab.id as typeof panelTab)}
                      className="app-filter-chip whitespace-nowrap"
                      data-active={String(panelTab === tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {panelTab === 'overview' && (
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                      <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
                        <p className="font-medium text-foreground">Клиент</p>
                        <p className="mt-1">{getClaimClient(selectedClaim, ticketById)}</p>
                      </div>
                      <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
                        <p className="font-medium text-foreground">Ответственный</p>
                        <p className="mt-1">{getClaimResponsible(selectedClaim)}</p>
                      </div>
                      <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
                        <p className="font-medium text-foreground">Ключевые даты</p>
                        <p className="mt-1">Реакция до: {formatDateSafe(getClaimDeadline(selectedClaim))}</p>
                        <p>Отправлено: {formatDateSafe(selectedClaim.sentAt)}</p>
                        <p>Закрыто: {formatDateSafe(selectedClaim.closedAt)}</p>
                      </div>
                      <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
                        <p className="font-medium text-foreground">Связи</p>
                        <p className="mt-1">Заявка: {selectedClaim.serviceTicketId || '—'}</p>
                        <p>Аренда: {selectedClaim.rentalId || '—'}</p>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <span className={FIELD_LABEL_CLASS}>Причина</span>
                      <div className="rounded-lg border border-border bg-card/70 p-3 text-sm text-foreground">
                        {getClaimReason(selectedClaim)}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <span className={FIELD_LABEL_CLASS}>Итог / ожидаемое решение</span>
                      <div className="rounded-lg border border-border bg-card/70 p-3 text-sm text-foreground">
                        {getClaimResult(selectedClaim) !== '—' ? getClaimResult(selectedClaim) : selectedClaim.requestedResolution || '—'}
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {canEdit && <Button type="button" variant="secondary" onClick={() => setPanelTab('decision')}>Изменить рекламацию</Button>}
                      {canEdit && <Button type="button" variant="secondary" onClick={() => setPanelTab('history')}>Добавить комментарий</Button>}
                      {canCreateDocuments && selectedClaim.serviceTicketId && (
                        onOpenTicket ? (
                          <Button type="button" variant="outline" className="w-full" onClick={() => onOpenTicket(selectedClaim.serviceTicketId!)}>
                            Создать документ
                          </Button>
                        ) : (
                          <Link to={`/service/${selectedClaim.serviceTicketId}`}>
                            <Button type="button" variant="outline" className="w-full">Создать документ</Button>
                          </Link>
                        )
                      )}
                      {canEdit && !['closed', 'rejected'].includes(normalizeManagementStatus(selectedClaim.status)) && (
                        <Button
                          type="button"
                          onClick={() => {
                            setEditForm(prev => prev ? ({ ...prev, status: 'closed' }) : prev);
                            setPanelTab('decision');
                          }}
                        >
                          Закрыть рекламацию
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {panelTab === 'works' && (
                  <div className={cn(SURFACE_PANEL_CLASS, 'p-4 text-sm text-muted-foreground')}>
                    Работы по рекламации ведутся в связанной сервисной заявке.
                    {selectedClaim.serviceTicketId && (
                      onOpenTicket ? (
                        <button
                          type="button"
                          onClick={() => onOpenTicket(selectedClaim.serviceTicketId!)}
                          className="mt-2 block text-left font-medium text-primary hover:underline"
                        >
                          Открыть работы в заявке {selectedClaim.serviceTicketId}
                        </button>
                      ) : (
                        <Link to={`/service/${selectedClaim.serviceTicketId}`} className="mt-2 block font-medium text-primary hover:underline">
                          Открыть работы в заявке {selectedClaim.serviceTicketId}
                        </Link>
                      )
                    )}
                  </div>
                )}

                {panelTab === 'documents' && (
                  <div className={cn(SURFACE_PANEL_CLASS, 'p-4 text-sm text-muted-foreground')}>
                    Документы и заводская переписка остаются связанными с рекламацией и сервисной заявкой.
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedClaim.serviceTicketId && (
                        onOpenTicket ? (
                          <Button type="button" size="sm" variant="secondary" onClick={() => onOpenTicket(selectedClaim.serviceTicketId!)}>
                            Открыть документы заявки
                          </Button>
                        ) : (
                          <Link to={`/service/${selectedClaim.serviceTicketId}`}>
                            <Button size="sm" variant="secondary">Открыть документы заявки</Button>
                          </Link>
                        )
                      )}
                      {canCreateDocuments && selectedClaim.serviceTicketId && (
                        onOpenTicket ? (
                          <Button type="button" size="sm" variant="outline" onClick={() => onOpenTicket(selectedClaim.serviceTicketId!)}>
                            Создать документ
                          </Button>
                        ) : (
                          <Link to={`/service/${selectedClaim.serviceTicketId}`}>
                            <Button size="sm" variant="outline">Создать документ</Button>
                          </Link>
                        )
                      )}
                    </div>
                  </div>
                )}

                {panelTab === 'history' && (
                  <div className="space-y-3">
                    {canEdit && (
                      <div className={cn(SURFACE_PANEL_CLASS, 'p-3 text-sm text-muted-foreground')}>
                        Комментарии добавляются при сохранении ответа завода или решения.
                      </div>
                    )}
                    {(selectedClaim.history || []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">История пока пустая.</p>
                    ) : (
                      [...(selectedClaim.history || [])].reverse().map((entry, index) => (
                        <div key={`${entry.date}-${index}`} className="rounded-lg border border-border p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-foreground">{entry.author}</p>
                            <p className="text-xs text-muted-foreground">{formatDateSafe(entry.date)}</p>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{entry.text}</p>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {panelTab === 'decision' && (
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                      <label className="space-y-1.5">
                        <span className={FIELD_LABEL_CLASS}>Статус</span>
                        <Select
                          value={editForm.status}
                          onValueChange={(value) => setEditForm(prev => prev ? ({ ...prev, status: value as WarrantyClaimStatus }) : prev)}
                          disabled={!canEdit}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PROCESS_STEPS.map(status => (
                              <SelectItem key={status} value={status}>{STATUS_META[status].label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                      <label className="space-y-1.5">
                        <span className={FIELD_LABEL_CLASS}>Номер дела завода</span>
                        <Input value={editForm.factoryCaseNumber} onChange={(event) => setEditForm(prev => prev ? ({ ...prev, factoryCaseNumber: event.target.value }) : prev)} disabled={!canEdit} />
                      </label>
                      <label className="space-y-1.5">
                        <span className={FIELD_LABEL_CLASS}>Срок ответа</span>
                        <Input type="date" value={editForm.responseDueDate} onChange={(event) => setEditForm(prev => prev ? ({ ...prev, responseDueDate: event.target.value }) : prev)} disabled={!canEdit} />
                      </label>
                    </div>
                    <label className="space-y-1.5">
                      <span className={FIELD_LABEL_CLASS}>Ответ завода</span>
                      <Textarea value={editForm.factoryResponse} onChange={(event) => setEditForm(prev => prev ? ({ ...prev, factoryResponse: event.target.value }) : prev)} rows={4} disabled={!canEdit} placeholder="Что ответил завод, какие уточнения запросил..." />
                    </label>
                    <label className="space-y-1.5">
                      <span className={FIELD_LABEL_CLASS}>Итоговое решение</span>
                      <Textarea value={editForm.decision} onChange={(event) => setEditForm(prev => prev ? ({ ...prev, decision: event.target.value }) : prev)} rows={3} disabled={!canEdit} placeholder="Что делаем дальше: ремонт по гарантии, заказ запчастей, отказ..." />
                    </label>
                    <div className="flex flex-wrap justify-between gap-2">
                      {canDelete && (
                        <Button type="button" variant="destructive" onClick={handleDeleteClaim} disabled={deleteClaim.isPending}>
                          <Trash2 className="h-4 w-4" />
                          Удалить
                        </Button>
                      )}
                      <Button type="button" onClick={handleSaveClaim} disabled={!canEdit || updateClaim.isPending} className="ml-auto">
                        <MessageSquareReply className="h-4 w-4" />
                        {updateClaim.isPending ? 'Сохраняем...' : 'Сохранить'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
