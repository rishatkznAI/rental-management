import React from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
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

const FACTORY_ACTIVE_STATUSES: WarrantyClaimStatus[] = ['sent_to_factory', 'factory_review'];
const FINAL_STATUSES: WarrantyClaimStatus[] = ['approved', 'rejected', 'closed'];

type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];

const STATUS_META: Record<WarrantyClaimStatus, { label: string; variant: BadgeVariant; description: string }> = {
  draft: {
    label: 'Черновик',
    variant: 'default',
    description: 'Сбор данных, фото и описания поломки',
  },
  sent_to_factory: {
    label: 'Отправлено на завод',
    variant: 'info',
    description: 'Обращение передано производителю',
  },
  factory_review: {
    label: 'На рассмотрении',
    variant: 'warning',
    description: 'Завод проверяет гарантийный случай',
  },
  answer_received: {
    label: 'Ответ получен',
    variant: 'info',
    description: 'Есть официальный ответ или уточнение',
  },
  approved: {
    label: 'Одобрено',
    variant: 'success',
    description: 'Гарантийное решение принято',
  },
  rejected: {
    label: 'Отклонено',
    variant: 'error',
    description: 'Завод отказал в гарантии',
  },
  parts_shipping: {
    label: 'Запчасти едут',
    variant: 'warning',
    description: 'Ожидается поставка по решению завода',
  },
  closed: {
    label: 'Закрыто',
    variant: 'default',
    description: 'Рекламация завершена',
  },
};

const PRIORITY_OPTIONS: Array<{ value: ServicePriority; label: string }> = [
  { value: 'low', label: 'Низкий' },
  { value: 'medium', label: 'Средний' },
  { value: 'high', label: 'Высокий' },
  { value: 'critical', label: 'Критический' },
];

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
    claim.equipmentLabel,
    claim.inventoryNumber,
    claim.serialNumber,
    claim.manufacturer,
    claim.factoryName,
    claim.factoryCaseNumber,
    claim.failureDescription,
    claim.requestedResolution,
  ].filter(Boolean).join(' ').toLowerCase();
}

function isResponseOverdue(claim: WarrantyClaim) {
  if (!claim.responseDueDate || FINAL_STATUSES.includes(claim.status)) return false;
  return claim.responseDueDate.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

function getStatusBadge(status: WarrantyClaimStatus) {
  const meta = STATUS_META[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
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
};

export function WarrantyClaimsTab({ tickets, canEdit, canDelete }: WarrantyClaimsTabProps) {
  const { user } = useAuth();
  const { data: claims = [], isLoading } = useWarrantyClaimsList();
  const { data: equipmentList = [] } = useEquipmentList();
  const createClaim = useCreateWarrantyClaim();
  const updateClaim = useUpdateWarrantyClaim();
  const deleteClaim = useDeleteWarrantyClaim();

  const [form, setForm] = React.useState<ClaimFormState>(EMPTY_FORM);
  const [statusFilter, setStatusFilter] = React.useState<WarrantyClaimStatus | 'all'>('all');
  const [search, setSearch] = React.useState('');
  const [selectedClaimId, setSelectedClaimId] = React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState<ClaimEditState | null>(null);

  const equipmentById = React.useMemo(() => new Map(equipmentList.map(item => [item.id, item])), [equipmentList]);
  const ticketById = React.useMemo(() => new Map(tickets.map(ticket => [ticket.id, ticket])), [tickets]);

  const filteredClaims = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return claims
      .filter(claim => statusFilter === 'all' || claim.status === statusFilter)
      .filter(claim => !query || getClaimSearchText(claim).includes(query))
      .sort((left, right) => {
        const leftTime = new Date(left.updatedAt || left.createdAt).getTime();
        const rightTime = new Date(right.updatedAt || right.createdAt).getTime();
        return rightTime - leftTime;
      });
  }, [claims, search, statusFilter]);

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
    setEditForm({
      status: selectedClaim.status,
      factoryCaseNumber: selectedClaim.factoryCaseNumber ?? '',
      responseDueDate: toDateInputValue(selectedClaim.responseDueDate),
      factoryResponse: selectedClaim.factoryResponse ?? '',
      decision: selectedClaim.decision ?? '',
    });
  }, [selectedClaim?.id]);

  const statusCounts = React.useMemo(() => {
    const counts = Object.fromEntries(PROCESS_STEPS.map(status => [status, 0])) as Record<WarrantyClaimStatus, number>;
    claims.forEach(claim => {
      counts[claim.status] = (counts[claim.status] ?? 0) + 1;
    });
    return counts;
  }, [claims]);

  const metrics = React.useMemo(() => ({
    total: claims.length,
    factoryActive: claims.filter(claim => FACTORY_ACTIVE_STATUSES.includes(claim.status)).length,
    answered: claims.filter(claim => ['answer_received', 'approved', 'rejected'].includes(claim.status)).length,
    overdue: claims.filter(isResponseOverdue).length,
  }), [claims]);

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
      toast.error('Укажите завод или производителя.');
      return;
    }
    if (!form.failureDescription.trim()) {
      toast.error('Опишите неисправность для завода.');
      return;
    }
    if (!form.requestedResolution.trim()) {
      toast.error('Укажите, какое решение запрашиваем у завода.');
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
            text: 'Создана рекламация по гарантийному обращению на завод.',
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
      history.push({
        date: updatedAt,
        text: `Статус изменён: ${STATUS_META[selectedClaim.status].label} → ${STATUS_META[editForm.status].label}.`,
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
    <div className="space-y-4 sm:space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Всего</p>
          <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{metrics.total}</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Гарантийных обращений</p>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-950/20">
          <p className="text-xs font-medium uppercase tracking-wide text-blue-700 dark:text-blue-300">На заводе</p>
          <p className="mt-2 text-2xl font-bold text-blue-900 dark:text-blue-100">{metrics.factoryActive}</p>
          <p className="mt-1 text-xs text-blue-700/80 dark:text-blue-300/80">Отправлены или на проверке</p>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900/50 dark:bg-green-950/20">
          <p className="text-xs font-medium uppercase tracking-wide text-green-700 dark:text-green-300">С ответом</p>
          <p className="mt-2 text-2xl font-bold text-green-900 dark:text-green-100">{metrics.answered}</p>
          <p className="mt-1 text-xs text-green-700/80 dark:text-green-300/80">Получено решение или отказ</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/20">
          <p className="text-xs font-medium uppercase tracking-wide text-red-700 dark:text-red-300">Просрочено</p>
          <p className="mt-2 text-2xl font-bold text-red-900 dark:text-red-100">{metrics.overdue}</p>
          <p className="mt-1 text-xs text-red-700/80 dark:text-red-300/80">Нужен повторный запрос</p>
        </div>
      </div>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Factory className="h-5 w-5 text-[--color-primary]" />
            Процесс обращения на завод
          </CardTitle>
          <CardDescription>
            Этапы помогают видеть, где находится гарантийный вопрос: от черновика до решения и закрытия.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {PROCESS_STEPS.map(status => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  statusFilter === status
                    ? 'border-[--color-primary] bg-[--color-primary]/10'
                    : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900/40 dark:hover:border-gray-600',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  {getStatusBadge(status)}
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">{statusCounts[status]}</span>
                </div>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{STATUS_META[status].description}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <div className="space-y-4">
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Send className="h-5 w-5 text-[--color-primary]" />
                Новая рекламация
              </CardTitle>
              <CardDescription>Сформируйте гарантийное обращение из сервисной заявки или напрямую по технике.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateClaim} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Сервисная заявка</span>
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
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Техника</span>
                    <EquipmentCombobox
                      equipment={equipmentList}
                      value={form.equipmentId}
                      onChange={handleEquipmentChange}
                      placeholder="Модель / INV / SN"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Завод / производитель</span>
                    <Input
                      value={form.factoryName}
                      onChange={(event) => setForm(prev => ({ ...prev, factoryName: event.target.value }))}
                      placeholder="Haulotte, JLG, Dingli..."
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Контакт завода</span>
                    <Input
                      value={form.factoryContact}
                      onChange={(event) => setForm(prev => ({ ...prev, factoryContact: event.target.value }))}
                      placeholder="email, телефон или менеджер"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Номер дела завода</span>
                    <Input
                      value={form.factoryCaseNumber}
                      onChange={(event) => setForm(prev => ({ ...prev, factoryCaseNumber: event.target.value }))}
                      placeholder="если уже присвоен"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Срок ответа</span>
                    <Input
                      type="date"
                      value={form.responseDueDate}
                      onChange={(event) => setForm(prev => ({ ...prev, responseDueDate: event.target.value }))}
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Приоритет</span>
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
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-300">
                    <p className="font-medium text-gray-900 dark:text-white">Что пойдёт в обращение</p>
                    <p className="mt-1">
                      {form.equipmentId && equipmentById.get(form.equipmentId)
                        ? eqLabel(equipmentById.get(form.equipmentId)!)
                        : 'Выберите технику или сервисную заявку'}
                    </p>
                  </div>
                </div>

                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Описание неисправности</span>
                  <Textarea
                    value={form.failureDescription}
                    onChange={(event) => setForm(prev => ({ ...prev, failureDescription: event.target.value }))}
                    placeholder="Симптомы, условия возникновения, что уже проверили..."
                    rows={4}
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Запрашиваемое решение</span>
                  <Textarea
                    value={form.requestedResolution}
                    onChange={(event) => setForm(prev => ({ ...prev, requestedResolution: event.target.value }))}
                    placeholder="Компенсация, гарантийная запчасть, техническое заключение..."
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

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5 text-[--color-primary]" />
                Журнал рекламаций
              </CardTitle>
              <CardDescription>Поиск по технике, номеру обращения, серийному номеру или описанию.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Поиск по рекламациям..."
                  className="pl-10"
                />
              </div>

              <div className="space-y-2">
                {isLoading ? (
                  <div className="rounded-lg border border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    Загружаем рекламации...
                  </div>
                ) : filteredClaims.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    Рекламации не найдены.
                  </div>
                ) : (
                  filteredClaims.map(claim => (
                    <button
                      key={claim.id}
                      type="button"
                      onClick={() => setSelectedClaimId(claim.id)}
                      className={cn(
                        'w-full rounded-lg border p-4 text-left transition-colors',
                        selectedClaim?.id === claim.id
                          ? 'border-[--color-primary] bg-[--color-primary]/10'
                          : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900/40 dark:hover:border-gray-600',
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-[--color-primary]">{claim.id}</span>
                            {getStatusBadge(claim.status)}
                            {isResponseOverdue(claim) && (
                              <Badge variant="error" className="gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                Просрочено
                              </Badge>
                            )}
                          </div>
                          <p className="mt-2 truncate text-sm font-medium text-gray-900 dark:text-white">
                            {claim.equipmentLabel}
                          </p>
                          <p className="mt-1 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">
                            {claim.failureDescription}
                          </p>
                        </div>
                        <div className="shrink-0 text-right text-xs text-gray-500 dark:text-gray-400">
                          <p>{getPriorityLabel(claim.priority)}</p>
                          <p className="mt-1">Ответ до: {formatDateSafe(claim.responseDueDate)}</p>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5 text-[--color-primary]" />
              Карточка обращения
            </CardTitle>
            <CardDescription>Фиксация номера завода, ответа, решения и текущего этапа.</CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedClaim || !editForm ? (
              <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                Выберите рекламацию из журнала.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[--color-primary]">{selectedClaim.id}</span>
                        {getStatusBadge(selectedClaim.status)}
                        <Badge variant="default">{getPriorityLabel(selectedClaim.priority)}</Badge>
                      </div>
                      <p className="mt-3 font-medium text-gray-900 dark:text-white">{selectedClaim.equipmentLabel}</p>
                      <div className="mt-2 grid gap-1 text-sm text-gray-500 dark:text-gray-400">
                        <p>Завод: {selectedClaim.factoryName}</p>
                        <p>INV: {selectedClaim.inventoryNumber || '—'} · SN: {selectedClaim.serialNumber || '—'}</p>
                        <p>Создано: {formatDateSafe(selectedClaim.createdAt)}</p>
                        {selectedClaim.serviceTicketId && (
                          <Link
                            to={`/service/${selectedClaim.serviceTicketId}`}
                            className="font-medium text-[--color-primary] hover:underline"
                          >
                            Открыть сервисную заявку {selectedClaim.serviceTicketId}
                          </Link>
                        )}
                      </div>
                    </div>
                    {isResponseOverdue(selectedClaim) && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
                        <div className="flex items-center gap-2">
                          <CalendarClock className="h-4 w-4" />
                          Срок ответа прошёл
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Статус</span>
                    <Select
                      value={editForm.status}
                      onValueChange={(value) => setEditForm(prev => prev ? ({ ...prev, status: value as WarrantyClaimStatus }) : prev)}
                      disabled={!canEdit}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PROCESS_STEPS.map(status => (
                          <SelectItem key={status} value={status}>
                            {STATUS_META[status].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Номер дела завода</span>
                    <Input
                      value={editForm.factoryCaseNumber}
                      onChange={(event) => setEditForm(prev => prev ? ({ ...prev, factoryCaseNumber: event.target.value }) : prev)}
                      disabled={!canEdit}
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Срок ответа</span>
                    <Input
                      type="date"
                      value={editForm.responseDueDate}
                      onChange={(event) => setEditForm(prev => prev ? ({ ...prev, responseDueDate: event.target.value }) : prev)}
                      disabled={!canEdit}
                    />
                  </label>

                  <div className="rounded-lg border border-gray-200 p-3 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">
                    <p className="font-medium text-gray-900 dark:text-white">Ключевые даты</p>
                    <p className="mt-1">Отправлено: {formatDateSafe(selectedClaim.sentAt)}</p>
                    <p>Закрыто: {formatDateSafe(selectedClaim.closedAt)}</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Неисправность</span>
                  <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
                    {selectedClaim.failureDescription}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Запрашиваемое решение</span>
                  <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
                    {selectedClaim.requestedResolution}
                  </div>
                </div>

                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Ответ завода</span>
                  <Textarea
                    value={editForm.factoryResponse}
                    onChange={(event) => setEditForm(prev => prev ? ({ ...prev, factoryResponse: event.target.value }) : prev)}
                    rows={4}
                    disabled={!canEdit}
                    placeholder="Что ответил завод, какие уточнения запросил..."
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Итоговое решение</span>
                  <Textarea
                    value={editForm.decision}
                    onChange={(event) => setEditForm(prev => prev ? ({ ...prev, decision: event.target.value }) : prev)}
                    rows={3}
                    disabled={!canEdit}
                    placeholder="Что делаем дальше: ремонт по гарантии, заказ запчастей, отказ..."
                  />
                </label>

                <div className="flex flex-wrap justify-between gap-2">
                  {canDelete && (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={handleDeleteClaim}
                      disabled={deleteClaim.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                      Удалить
                    </Button>
                  )}
                  <Button
                    type="button"
                    onClick={handleSaveClaim}
                    disabled={!canEdit || updateClaim.isPending}
                    className="ml-auto"
                  >
                    <MessageSquareReply className="h-4 w-4" />
                    {updateClaim.isPending ? 'Сохраняем...' : 'Сохранить'}
                  </Button>
                </div>

                <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
                  <p className="mb-3 text-sm font-medium text-gray-900 dark:text-white">История</p>
                  <div className="space-y-3">
                    {(selectedClaim.history || []).length === 0 ? (
                      <p className="text-sm text-gray-500 dark:text-gray-400">История пока пустая.</p>
                    ) : (
                      [...(selectedClaim.history || [])].reverse().map((entry, index) => (
                        <div key={`${entry.date}-${index}`} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-gray-900 dark:text-white">{entry.author}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{formatDateSafe(entry.date)}</p>
                          </div>
                          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{entry.text}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
