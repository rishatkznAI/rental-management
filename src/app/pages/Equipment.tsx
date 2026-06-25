import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  AlertTriangle,
  BadgeDollarSign,
  Boxes,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FileText,
  History,
  PenLine,
  Plus,
  RadioTower,
  RotateCcw,
  Search,
  Truck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../lib/permissions';
import { getInvestorBinding, isInvestorUser, isWarrantyMechanicRole, normalizeUserRole } from '../lib/userStorage';
import { useEquipmentList, useEquipmentReadiness, useManagementActionAssignees, useManagementActionQueue, useUpdateManagementActionState } from '../hooks/useEquipment';
import { useGanttData, useRentalsList } from '../hooks/useRentals';
import { useDocumentsList } from '../hooks/useDocuments';
import { useServiceTicketsList } from '../hooks/useServiceTickets';
import { equipmentService } from '../services/equipment.service';
import {
  ACTIVE_FLEET_LABELS,
  compareEquipmentByPriority,
  canEquipmentParticipateInRentals,
  EQUIPMENT_SALE_PDI_LABELS,
  normalizeEquipmentList,
} from '../lib/equipmentClassification';
import {
  buildEquipmentTabCounts,
  buildActiveRentalIndex,
  cleanText,
  documentMatchesEquipmentOrRentals,
  equipmentFilterReasons,
  equipmentMatchesInvestorBinding,
  enrichEquipment,
  formatPreviewDate,
  formatPreviewNumber,
  ganttRentalMatchesEquipment,
  getEquipmentCategoryLabel,
  getEquipmentDriveLabel,
  getEquipmentGsmDisplay,
  getEquipmentTypeGroup,
  getCurrentClassicRental,
  getCurrentGanttRental,
  getGanttRentalRouteId,
  getRegistryOwnerLabel,
  getRegistryPercent,
  getRegistryStatusKind,
  getOwnerLabel,
  getRentalStableIds,
  isEquipmentInventoryUnique,
  isOpenServiceTicket,
  isSaleRegistryEquipment,
  isSoldEquipment,
  lowerText,
  matchesDriveFilter,
  matchesEquipmentSearch,
  matchesEquipmentTypeFilter,
  matchesOwnerFilter,
  matchesStatusFilter,
  matchesTabType,
  rentalMatchesEquipment,
  serviceTicketMatchesEquipment,
} from './equipment/equipment.helpers';
import {
  DEFAULT_EQUIPMENT_PAGE_SIZE,
  EQUIPMENT_DRIVE_FILTER_OPTIONS,
  EQUIPMENT_EMPTY_STATE_COPY,
  EQUIPMENT_PAGE_SIZE_OPTIONS,
  EQUIPMENT_STATUS_BADGE_STYLES,
  EQUIPMENT_STATUS_FILTER_OPTIONS,
  EQUIPMENT_TABS,
  STANDARD_EQUIPMENT_TYPE_FILTER_OPTIONS,
} from './equipment/equipment.constants';
import { clampEquipmentPage, getEquipmentPageItems, getEquipmentPageRange } from './equipment/equipment.pagination';
import type {
  ActiveRentalIndex,
  EquipmentEmptyStateConfig,
  EquipmentPreviewQuickAction,
  EquipmentPreviewTab,
  EquipmentQuickViewPanelData,
  EquipmentRegistryStatusKind,
  EquipmentTab,
} from './equipment/equipment.types';
import { EquipmentFilters } from './equipment/EquipmentFilters';
import { EquipmentKpiCards, type EquipmentKpiCardConfig } from './equipment/EquipmentKpiCards';
import { EquipmentMobileCards } from './equipment/EquipmentMobileCards';
import { EquipmentQuickViewPanel } from './equipment/EquipmentQuickViewPanel';
import { EquipmentRegistryTable } from './equipment/EquipmentRegistryTable';
import { EquipmentStatusTabs } from './equipment/EquipmentStatusTabs';
import { findEquipmentTypeLabel, mergeEquipmentTypesWithExistingEquipment, useEquipmentTypeCatalog } from '../lib/equipmentTypes';
import { photoSource } from '../lib/media';
import { buildEquipmentQuickActions } from '../lib/quickActions.js';
import { formatCurrency } from '../lib/utils';
import type {
  Document,
  Equipment as EquipmentEntity,
  FleetReadinessItem,
  FleetReadinessResponsibleArea,
  FleetReadinessStatus,
  ManagementActionExecutionStatus,
  ManagementActionPriority,
  ManagementActionQueueItem,
  ManagementActionQueueSummary,
  EquipmentSalePdiStatus,
  PhotoReference,
  Rental,
  ServiceTicket,
  ShippingPhoto,
} from '../types';
import type { GanttRentalData } from '../mock-data';

type PermissionCan = ReturnType<typeof usePermissions>['can'];

const EQUIPMENT_REGISTRY_MATCH_OPTIONS = { canEquipmentParticipateInRentals };

type ManagementActionQueueFilter = 'all' | ManagementActionPriority | FleetReadinessResponsibleArea | ManagementActionExecutionStatus | 'unassigned' | 'overdue' | 'due_today' | 'stale' | 'my_actions';

const ACTION_QUEUE_FILTERS: Array<{ value: ManagementActionQueueFilter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'unassigned', label: 'Без ответственного' },
  { value: 'overdue', label: 'Просрочено' },
  { value: 'due_today', label: 'Сегодня' },
  { value: 'stale', label: 'Зависли' },
  { value: 'open', label: 'Открытые' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'resolved', label: 'Решено' },
  { value: 'my_actions', label: 'Мои' },
  { value: 'critical', label: 'Критичные' },
  { value: 'high', label: 'Высокие' },
  { value: 'service', label: 'Сервис' },
  { value: 'logistics', label: 'Логистика' },
  { value: 'office', label: 'Офис' },
  { value: 'admin', label: 'Админ' },
];

function normalizeActionQueueFilter(value: string | null | undefined): ManagementActionQueueFilter {
  return ACTION_QUEUE_FILTERS.some(option => option.value === value)
    ? value as ManagementActionQueueFilter
    : 'all';
}

const ACTION_EXECUTION_STATUS_OPTIONS: Array<{ value: ManagementActionExecutionStatus; label: string }> = [
  { value: 'open', label: 'Открыто' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'postponed', label: 'Отложено' },
  { value: 'resolved', label: 'Решено' },
  { value: 'ignored', label: 'Игнорировано' },
];

function readinessLossText(value: number | null, suffix = '') {
  if (value == null) return 'нет ставки';
  if (value <= 0) return '0 ₽';
  return `${formatCurrency(value)}${suffix}`;
}

function queuePriorityLabel(priority: ManagementActionPriority) {
  const labels: Record<ManagementActionPriority, string> = {
    critical: 'Критично',
    high: 'Высокий',
    medium: 'Средний',
    low: 'Низкий',
  };
  return labels[priority] || labels.low;
}

function queuePriorityVariant(priority: ManagementActionPriority) {
  if (priority === 'critical') return 'danger';
  if (priority === 'high') return 'warning';
  if (priority === 'medium') return 'info';
  return 'default';
}

function executionStatusLabel(status?: ManagementActionExecutionStatus, label?: string) {
  return label || ACTION_EXECUTION_STATUS_OPTIONS.find(option => option.value === status)?.label || 'Открыто';
}

function executionStatusVariant(status?: ManagementActionExecutionStatus) {
  if (status === 'resolved') return 'success';
  if (status === 'ignored') return 'default';
  if (status === 'postponed') return 'warning';
  if (status === 'in_progress') return 'info';
  return 'danger';
}

function actionDueHintLabel(daysUntilDue: number | null, dueDate?: string) {
  if (!dueDate) return 'Срок не задан';
  if (daysUntilDue === 0) return 'Сегодня';
  if (typeof daysUntilDue === 'number' && daysUntilDue < 0) return `Просрочено на ${Math.abs(daysUntilDue)} дн.`;
  if (typeof daysUntilDue === 'number') return `Осталось ${daysUntilDue} дн.`;
  return 'Срок указан';
}

function responsibleAreaLabel(area: FleetReadinessResponsibleArea) {
  const labels: Record<FleetReadinessResponsibleArea, string> = {
    service: 'Сервис',
    rental_manager: 'Менеджер аренды',
    logistics: 'Логистика',
    office: 'Офис',
    admin: 'Админ',
    unknown: 'Не назначен',
  };
  return labels[area] || labels.unknown;
}

function readinessTopBlockerLabel(status?: FleetReadinessStatus | null) {
  const labels: Record<FleetReadinessStatus, string> = {
    ready: 'Готова',
    rented: 'В аренде',
    needs_check: 'Проверка',
    in_service: 'Сервис',
    delivery_blocked: 'Доставка',
    document_blocked: 'Документы',
    gsm_attention: 'GSM',
    unknown: 'Не ясно',
  };
  return status ? labels[status] || '—' : '—';
}

function ManagementActionQueueSection({
  items,
  summary,
  isLoading,
  error,
  currentUser,
  canManageActions = false,
  initialFilter = 'all',
}: {
  items: ManagementActionQueueItem[];
  summary?: ManagementActionQueueSummary;
  isLoading: boolean;
  error: unknown;
  currentUser?: { id?: string; name?: string } | null;
  canManageActions?: boolean;
  initialFilter?: ManagementActionQueueFilter;
}) {
  const [filter, setFilter] = React.useState<ManagementActionQueueFilter>(initialFilter);
  const [editingItem, setEditingItem] = React.useState<ManagementActionQueueItem | null>(null);
  const updateState = useUpdateManagementActionState();
  const assigneesQuery = useManagementActionAssignees({ enabled: canManageActions });
  const [form, setForm] = React.useState({
    status: 'open' as ManagementActionExecutionStatus,
    assignedToUserId: '',
    assignedToName: '',
    dueDate: '',
    comment: '',
  });

  React.useEffect(() => {
    setFilter(initialFilter);
  }, [initialFilter]);

  const openEditor = React.useCallback((item: ManagementActionQueueItem) => {
    if (!canManageActions) return;
    setEditingItem(item);
    setForm({
      status: item.executionStatus || 'open',
      assignedToUserId: item.assignedToUserId || '',
      assignedToName: item.assignedToName || '',
      dueDate: item.dueDate || '',
      comment: item.executionComment || '',
    });
  }, [canManageActions]);

  const updateActionStatus = React.useCallback((item: ManagementActionQueueItem, status: ManagementActionExecutionStatus) => {
    if (!canManageActions) return;
    updateState.mutate({
      actionId: item.actionId,
      data: {
        status,
        assignedToUserId: item.assignedToUserId || currentUser?.id || '',
        assignedToName: item.assignedToName || currentUser?.name || '',
        dueDate: item.dueDate || '',
        comment: item.executionComment || '',
      },
    });
  }, [canManageActions, currentUser?.id, currentUser?.name, updateState]);

  const responsibleOptions = React.useMemo(() => {
    const options = new Map<string, { label: string; name: string }>();
    for (const user of assigneesQuery.data?.items || []) {
      options.set(user.userId, { label: user.role ? `${user.name} · ${user.role}` : user.name, name: user.name });
    }
    if (currentUser?.id) options.set(currentUser.id, { label: currentUser.name || 'Текущий пользователь', name: currentUser.name || 'Текущий пользователь' });
    for (const item of items) {
      if (item.assignedToUserId) options.set(item.assignedToUserId, { label: item.assignedToName || item.assignedToUserId, name: item.assignedToName || item.assignedToUserId });
    }
    return Array.from(options, ([value, option]) => ({ value, ...option }));
  }, [assigneesQuery.data?.items, currentUser?.id, currentUser?.name, items]);
  const hasSafeAssigneeSource = Boolean(assigneesQuery.data?.items?.length);

  const filteredItems = React.useMemo(() => {
    const list = filter === 'all'
      ? items
      : filter === 'open' || filter === 'in_progress' || filter === 'postponed' || filter === 'resolved' || filter === 'ignored'
        ? items.filter(item => (item.executionStatus || 'open') === filter)
      : filter === 'unassigned'
        ? items.filter(item => item.isUnassigned)
      : filter === 'overdue'
        ? items.filter(item => item.isOverdue || item.executionOverdue)
      : filter === 'due_today'
        ? items.filter(item => item.isDueToday)
      : filter === 'stale'
        ? items.filter(item => item.isStale)
      : filter === 'my_actions'
        ? items.filter(item => currentUser?.id && item.assignedToUserId === currentUser.id)
      : filter === 'critical' || filter === 'high'
        ? items.filter(item => item.priority === filter)
        : items.filter(item => item.responsibleArea === filter);
    return list.slice(0, 10);
  }, [currentUser?.id, filter, items]);

  const executionKpis = React.useMemo(() => ({
    inProgress: summary?.inProgress ?? items.filter(item => item.executionStatus === 'in_progress').length,
    overdue: summary?.overdue ?? items.filter(item => item.isOverdue || item.executionOverdue).length,
    resolved: summary?.resolved ?? items.filter(item => item.executionStatus === 'resolved').length,
    unassigned: summary?.unassigned ?? items.filter(item => item.isUnassigned).length,
    dueToday: summary?.dueToday ?? items.filter(item => item.isDueToday).length,
    stale: summary?.stale ?? items.filter(item => item.isStale).length,
  }), [items, summary]);

  const kpis = [
    { label: 'Без ответственного', value: executionKpis.unassigned, icon: PenLine, className: 'text-orange-400' },
    { label: 'Просрочено', value: executionKpis.overdue, icon: AlertTriangle, className: 'text-red-400' },
    { label: 'Сегодня', value: executionKpis.dueToday, icon: CalendarPlus, className: 'text-blue-400' },
    { label: 'Зависли', value: executionKpis.stale, icon: ClipboardList, className: 'text-yellow-400' },
  ];
  const activeFilterLabel = ACTION_QUEUE_FILTERS.find(option => option.value === filter)?.label || 'Все';

  const formDaysUntilDue = React.useMemo(() => {
    if (!form.dueDate) return null;
    const today = new Date().toISOString().slice(0, 10);
    return Math.round((new Date(`${form.dueDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000);
  }, [form.dueDate]);
  const savingHighPriorityWithoutAssignee = Boolean(
    editingItem &&
    ['critical', 'high'].includes(editingItem.priority) &&
    !form.assignedToUserId.trim() &&
    !form.assignedToName.trim() &&
    !['resolved', 'ignored'].includes(form.status)
  );

  const handleSave = React.useCallback(() => {
    if (!editingItem) return;
    updateState.mutate({
      actionId: editingItem.actionId,
      data: {
        status: form.status,
        assignedToUserId: form.assignedToUserId,
        assignedToName: form.assignedToName,
        dueDate: form.dueDate,
        comment: form.comment,
      },
    }, {
      onSuccess: () => setEditingItem(null),
    });
  }, [editingItem, form, updateState]);

  return (
    <section className="app-panel overflow-hidden" data-testid="management-action-queue-section">
      <div className="border-b border-border/80 px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="app-shell-title text-xl font-extrabold text-foreground">Очередь управленческих действий</h2>
            <p className="mt-1 text-sm text-muted-foreground">Контроль исполнения управленческих действий по готовности техники</p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Фильтр очереди управленческих действий">
            {ACTION_QUEUE_FILTERS.map(option => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  filter === option.value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 text-xs font-semibold text-muted-foreground">Активный фильтр: {activeFilterLabel}</div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map(({ label, value, icon: Icon, className }) => (
            <div key={label} className="rounded-lg border border-border bg-secondary/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">{label}</span>
                <Icon className={`h-4 w-4 ${className}`} />
              </div>
              <div className="mt-2 text-xl font-extrabold text-foreground">{isLoading ? '…' : value}</div>
            </div>
          ))}
        </div>
      </div>

      {error ? (
        <div className="p-5 text-sm text-red-200">
          Не удалось загрузить очередь действий. {apiErrorMessage(error, 'Проверьте доступ к /api/management/action-queue.')}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="p-5 text-sm text-muted-foreground">
          {isLoading ? 'Загружаем очередь действий…' : 'Критичных действий нет'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="border-b border-border bg-secondary/60 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Приоритет</th>
                <th className="px-3 py-3 font-medium">Действие</th>
                <th className="px-3 py-3 font-medium">Ответственный</th>
                <th className="px-3 py-3 font-medium">Срок</th>
                <th className="px-3 py-3 font-medium">Статус исполнения</th>
                <th className="px-3 py-3 font-medium">Техника</th>
                <th className="px-3 py-3 font-medium">Ответственный блок</th>
                <th className="px-3 py-3 font-medium">Потеря</th>
                <th className="px-3 py-3 font-medium">Потеря/день</th>
                <th className="px-5 py-3 font-medium">Ссылка</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/80">
              {filteredItems.map(item => (
                <tr key={item.actionId} className={`align-top ${item.isOverdue ? 'bg-red-950/10' : ''}`}>
                  <td className="px-5 py-3">
                    <Badge variant={queuePriorityVariant(item.priority)}>{item.urgencyLabel || queuePriorityLabel(item.priority)}</Badge>
                    <div className="mt-1 text-xs text-muted-foreground">{item.dueHint || 'Плановая проверка'}</div>
                  </td>
                  <td className="max-w-[360px] px-3 py-3">
                    <div className="font-semibold text-foreground">{item.title || 'Уточнить действие'}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.description || item.recommendedAction || 'Проверьте блокер техники.'}</div>
                    {canManageActions ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Button size="sm" type="button" onClick={() => updateActionStatus(item, 'in_progress')} disabled={updateState.isPending}>
                          В работу
                        </Button>
                        <Button size="sm" variant="outline" type="button" onClick={() => updateActionStatus(item, 'postponed')} disabled={updateState.isPending}>
                          Отложить
                        </Button>
                        <Button size="sm" variant="secondary" type="button" onClick={() => updateActionStatus(item, 'resolved')} disabled={updateState.isPending}>
                          Решено
                        </Button>
                        <Button size="sm" variant="ghost" type="button" onClick={() => openEditor(item)}>
                          Изменить
                        </Button>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    <div className="flex flex-col gap-1.5">
                      <span className="font-semibold text-foreground">{item.assignedToName || 'Ответственный не назначен'}</span>
                      {item.isUnassigned ? <Badge variant="warning">Без ответственного</Badge> : null}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    <div className="flex flex-col gap-1.5">
                      <span>{item.dueDate || 'Срок не задан'}</span>
                      <span className="font-semibold text-foreground">{actionDueHintLabel(item.daysUntilDue, item.dueDate)}</span>
                      {item.isOverdue ? <Badge variant="danger">Просрочено</Badge> : null}
                      {item.isDueToday ? <Badge variant="info">Сегодня</Badge> : null}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={executionStatusVariant(item.executionStatus)}>{executionStatusLabel(item.executionStatus, item.executionLabel)}</Badge>
                        {item.isStale ? <Badge variant="warning">Зависло</Badge> : null}
                      </div>
                      <span>{item.accountabilityLabel || 'Открыто'}</span>
                      {item.executionComment ? <span className="line-clamp-2 text-muted-foreground">{item.executionComment}</span> : null}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{item.equipmentId || 'Не указана'}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{responsibleAreaLabel(item.responsibleArea)}</td>
                  <td className="px-3 py-3 text-xs font-semibold text-foreground">{readinessLossText(item.estimatedLoss, item.estimatedLoss && item.estimatedLoss > 0 ? ' оценочно' : '')}</td>
                  <td className="px-3 py-3 text-xs font-semibold text-foreground">{readinessLossText(item.estimatedDailyLoss)}</td>
                  <td className="px-5 py-3 text-xs">
                    <div className="flex flex-wrap gap-2">
                      <Link className="inline-flex items-center gap-1 text-primary hover:underline" to={item.links.equipment || `/equipment/${item.equipmentId}`}>
                        Техника <ExternalLink className="h-3 w-3" />
                      </Link>
                      {item.links.serviceTicket ? <Link className="text-primary hover:underline" to={item.links.serviceTicket}>Сервис</Link> : null}
                      {item.links.rental ? <Link className="text-primary hover:underline" to={item.links.rental}>Аренда</Link> : null}
                      {item.links.delivery ? <Link className="text-primary hover:underline" to={item.links.delivery}>Доставка</Link> : null}
                      {item.links.document ? <Link className="text-primary hover:underline" to={item.links.document}>Документ</Link> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={Boolean(editingItem)} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Исполнение действия</DialogTitle>
            <DialogDescription>{editingItem?.title || 'Уточнить действие'}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 overflow-y-auto py-2">
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Статус
              <Select value={form.status} onValueChange={(value) => setForm(prev => ({ ...prev, status: value as ManagementActionExecutionStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTION_EXECUTION_STATUS_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Ответственный
              <Select
                value={form.assignedToUserId || 'manual'}
                onValueChange={(value) => {
                  if (value === 'manual') {
                    setForm(prev => ({ ...prev, assignedToUserId: '' }));
                    return;
                  }
                  const option = responsibleOptions.find(item => item.value === value);
                  setForm(prev => ({ ...prev, assignedToUserId: value, assignedToName: option?.name || '' }));
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">{hasSafeAssigneeSource ? 'Указать вручную' : 'Ответственный не назначен'}</SelectItem>
                  {hasSafeAssigneeSource ? responsibleOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  )) : null}
                </SelectContent>
              </Select>
              {!hasSafeAssigneeSource ? (
                <span className="text-xs font-normal text-muted-foreground">Назначить ответственного можно после подключения безопасного списка пользователей.</span>
              ) : null}
              <Input
                value={form.assignedToName}
                onChange={(event) => setForm(prev => ({ ...prev, assignedToName: event.target.value, assignedToUserId: '' }))}
                placeholder="Имя ответственного"
                disabled={!hasSafeAssigneeSource}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Срок
              <Input type="date" value={form.dueDate} onChange={(event) => setForm(prev => ({ ...prev, dueDate: event.target.value }))} />
              <span className="text-xs font-normal text-muted-foreground">{actionDueHintLabel(formDaysUntilDue, form.dueDate)}</span>
            </label>
            {savingHighPriorityWithoutAssignee ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                Высокий риск сохраняется без ответственного.
              </div>
            ) : null}
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Комментарий
              <Textarea value={form.comment} maxLength={1000} onChange={(event) => setForm(prev => ({ ...prev, comment: event.target.value }))} />
            </label>
            {updateState.error ? (
              <div className="text-sm text-red-200">Не удалось сохранить. {apiErrorMessage(updateState.error, 'Проверьте права на изменение действия.')}</div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditingItem(null)}>Отмена</Button>
            <Button type="button" onClick={handleSave} disabled={updateState.isPending}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function FleetReadinessSection({
  items,
  summary,
  isLoading,
  error,
}: {
  items: FleetReadinessItem[];
  summary?: {
    ready: number;
    needsCheck: number;
    inService: number;
    deliveryBlocked: number;
    gsmAttention: number;
    loss?: {
      totalEstimatedDailyLoss: number;
      totalEstimatedLoss: number;
      blockedItemsWithoutRate: number;
      topLossStatus: FleetReadinessStatus | null;
    };
  };
  isLoading: boolean;
  error: unknown;
}) {
  const allGood = !isLoading && !error && items.length > 0 && items.every(item => item.readinessStatus === 'ready');
  const kpis = [
    { label: 'Готова к аренде', value: summary?.ready ?? 0, icon: CheckCircle2, className: 'text-emerald-400' },
    { label: 'Требует проверки', value: summary?.needsCheck ?? 0, icon: AlertTriangle, className: 'text-amber-400' },
    { label: 'В сервисе', value: summary?.inService ?? 0, icon: Wrench, className: 'text-red-400' },
    { label: 'Блокеры доставки', value: summary?.deliveryBlocked ?? 0, icon: Truck, className: 'text-orange-400' },
    { label: 'GSM офлайн', value: summary?.gsmAttention ?? 0, icon: RadioTower, className: 'text-blue-400' },
    { label: 'Потеря в день', value: readinessLossText(summary?.loss?.totalEstimatedDailyLoss ?? 0, ' оценочно'), icon: BadgeDollarSign, className: 'text-red-400' },
    { label: 'Оценка потерь', value: readinessLossText(summary?.loss?.totalEstimatedLoss ?? 0, ' оценочно'), icon: AlertTriangle, className: 'text-orange-400' },
    { label: 'Без ставки', value: summary?.loss?.blockedItemsWithoutRate ?? 0, icon: ClipboardList, className: 'text-amber-400' },
    { label: 'Главный блокер', value: readinessTopBlockerLabel(summary?.loss?.topLossStatus), icon: Wrench, className: 'text-blue-400' },
  ];

  return (
    <section className="app-panel overflow-hidden px-4 py-3 sm:px-5" data-testid="fleet-readiness-section">
      {error ? (
        <div className="text-sm text-red-200">
          Не удалось загрузить готовность парка. {apiErrorMessage(error, 'Проверьте доступ к /api/equipment/readiness.')}
        </div>
      ) : allGood ? (
        <div className="flex items-center gap-2 text-sm text-emerald-200">
          <CheckCircle2 className="h-4 w-4" />
          Критичных блокеров по парку нет.
        </div>
      ) : (
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex shrink-0 items-center gap-2">
            <span className="app-shell-title text-sm font-extrabold text-foreground">Готовность парка</span>
            <span className="text-xs text-muted-foreground">{isLoading ? 'загрузка' : 'операционная сводка'}</span>
          </div>
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 xl:pb-0">
            {kpis.map(({ label, value, icon: Icon, className }) => (
              <div key={label} className="flex min-w-max items-center gap-2 rounded-lg border border-border bg-secondary/45 px-3 py-2 text-xs">
                <Icon className={`h-3.5 w-3.5 ${className}`} />
                <span className="text-muted-foreground">{label}</span>
                <span className="font-extrabold text-foreground">{isLoading ? '…' : value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function getPriorityAppearance(priority: EquipmentEntity['priority']) {
  if (priority === 'critical' || priority === 'high') {
    return 'bg-red-500/12 text-red-300';
  }
  if (priority === 'medium') {
    return 'bg-blue-500/12 text-blue-300';
  }
  return 'bg-emerald-500/12 text-emerald-300';
}

function getPriorityLabel(priority: EquipmentEntity['priority']) {
  const labels: Record<EquipmentEntity['priority'], string> = {
    low: 'Низкий',
    medium: 'Средний',
    high: 'Высокий',
    critical: 'Критический',
  };
  return labels[priority];
}

function getSalePdiAppearance(status: EquipmentSalePdiStatus = 'not_started') {
  if (status === 'ready') return 'bg-emerald-500/12 text-emerald-300';
  if (status === 'in_progress') return 'bg-orange-500/12 text-orange-300';
  if (status === 'issues') return 'bg-red-500/12 text-red-300';
  return 'bg-secondary text-muted-foreground';
}

function getEquipmentDetailPath(equipment: EquipmentEntity) {
  return isSaleRegistryEquipment(equipment)
    ? `/sales/equipment/${equipment.id}`
    : `/equipment/${equipment.id}`;
}

function getRegistryStatusLabel(equipment: EquipmentEntity, activeRentalIndex?: ActiveRentalIndex) {
  return EQUIPMENT_STATUS_BADGE_STYLES[getRegistryStatusKind(equipment, activeRentalIndex) as EquipmentRegistryStatusKind].label;
}

function getRegistryStatusAppearance(equipment: EquipmentEntity, activeRentalIndex?: ActiveRentalIndex) {
  return EQUIPMENT_STATUS_BADGE_STYLES[getRegistryStatusKind(equipment, activeRentalIndex) as EquipmentRegistryStatusKind].className;
}

function getPriorityDotClass(priority: EquipmentEntity['priority']) {
  if (priority === 'critical' || priority === 'high') return 'bg-red-500';
  if (priority === 'medium') return 'bg-blue-500';
  return 'bg-emerald-500';
}

function buildEquipmentContextPath(
  path: string,
  equipment: EquipmentEntity,
  extra?: Record<string, string | number | boolean | null | undefined>,
) {
  const params = new URLSearchParams();
  params.set('equipmentId', equipment.id);
  if (equipment.inventoryNumber) params.set('equipmentInv', equipment.inventoryNumber);
  Object.entries(extra || {}).forEach(([key, value]) => {
    const text = cleanText(value);
    if (text) params.set(key, text);
  });
  return `${path}?${params.toString()}`;
}

function getDocumentTypeLabel(document: Document) {
  const type = document.documentType || document.type;
  const labels: Record<string, string> = {
    contract: document.contractKind === 'supply' ? 'Договор поставки' : 'Договор аренды',
    commercial_offer: 'Коммерческое предложение',
    act: 'Акт',
    upd: 'УПД',
    invoice: 'Счёт',
    service_act: 'Акт сервиса',
    work_order: 'Наряд',
    debt_notification: 'Уведомление о долге',
    pretrial_claim: 'Претензия',
    court_document: 'Судебный документ',
    court_decision: 'Решение суда',
    enforcement_writ: 'Исполнительный лист',
    other: 'Документ',
  };
  return labels[type] || type || 'Документ';
}

function getDocumentNumber(document: Document) {
  return cleanText(document.documentNumber || document.number) || 'Без номера';
}

function getDocumentDate(document: Document) {
  return document.documentDate || document.date || document.createdAt || '';
}

function documentSearchText(document: Document) {
  return [
    document.type,
    document.documentType,
    document.contractKind,
    document.number,
    document.documentNumber,
    document.fileName,
    document.comment,
    document.equipment,
    document.serviceTicket,
    getDocumentTypeLabel(document),
  ].map(lowerText).join(' ');
}

function documentSlotCount(documents: Document[], slot: 'passport' | 'certificate' | 'commissioning' | 'sale') {
  return documents.filter((document) => {
    const text = documentSearchText(document);
    if (slot === 'passport') return text.includes('паспорт');
    if (slot === 'certificate') return text.includes('сертификат') || text.includes('certificate');
    if (slot === 'commissioning') return text.includes('акт ввода') || text.includes('ввод в эксплуатац');
    return text.includes('продаж') || text.includes('поставк') || text.includes('коммерческ') || text.includes('кп')
      || document.documentType === 'commercial_offer'
      || document.type === 'commercial_offer'
      || document.contractKind === 'supply';
  }).length;
}

function getGanttRentalStatusLabel(status: GanttRentalData['status']) {
  if (status === 'active') return 'Активна';
  if (status === 'created') return 'Бронь';
  if (status === 'returned') return 'Возвращена';
  if (status === 'closed') return 'Закрыта';
  return status;
}

function getClassicRentalStatusLabel(status: Rental['status']) {
  const labels: Record<Rental['status'], string> = {
    new: 'Новая',
    confirmed: 'Подтверждена',
    delivery: 'Доставка',
    active: 'Активна',
    return_planned: 'Возврат',
    closed: 'Закрыта',
  };
  return labels[status] || status;
}

function getServiceStatusLabel(status: ServiceTicket['status']) {
  const value = lowerText(status);
  if (value === 'new') return 'Новая';
  if (value === 'assigned') return 'Назначена';
  if (value === 'in_progress') return 'В работе';
  if (value === 'waiting_parts') return 'Ожидание запчастей';
  if (value === 'needs_revision') return 'На доработке';
  if (value === 'ready') return 'Готово';
  if (value === 'closed') return 'Закрыта';
  return cleanText(status) || 'Без статуса';
}

type EquipmentPreviewPhoto = {
  id: string;
  label: string;
  src: string;
  caption?: string;
  date?: string;
};

function collectEquipmentPreviewPhotos(
  equipment: EquipmentEntity,
  shippingPhotos: ShippingPhoto[],
  serviceTickets: ServiceTicket[],
) {
  const result: EquipmentPreviewPhoto[] = [];
  const seen = new Set<string>();

  const pushPhoto = (photo: PhotoReference | null | undefined, label: string, caption?: string, date?: string) => {
    const src = photoSource(photo);
    if (!src || seen.has(src)) return;
    seen.add(src);
    result.push({ id: `${label}:${result.length}`, label, caption, date, src });
  };

  pushPhoto(equipment.photo, 'Фото техники', `${equipment.manufacturer} ${equipment.model}`);

  Object.entries(equipment.acceptancePhotos || {}).forEach(([category, photos]) => {
    (Array.isArray(photos) ? photos : []).forEach(photo => pushPhoto(photo, 'Фото приёмки', category));
  });

  shippingPhotos.forEach((event) => {
    const label = event.type === 'receiving' ? 'Фото возврата' : 'Фото отгрузки';
    (event.photos || []).forEach(photo => pushPhoto(photo, label, event.damageDescription || event.comment, event.date));
    Object.entries(event.photoCategories || {}).forEach(([category, photos]) => {
      (Array.isArray(photos) ? photos : []).forEach(photo => pushPhoto(photo, label, category, event.date));
    });
  });

  serviceTickets.forEach((ticket) => {
    (ticket.repairPhotos?.before || []).forEach(photo => pushPhoto(photo, 'Фото дефектов', ticket.reason, ticket.createdAt));
    (ticket.repairPhotos?.after || []).forEach(photo => pushPhoto(photo, 'Фото после ремонта', ticket.reason, ticket.closedAt || ticket.completedAt));
  });

  return result;
}

type EquipmentTimelineItem = {
  id: string;
  date: string;
  title: string;
  description: string;
};

function buildEquipmentTimeline({
  equipment,
  documents,
  ganttRentals,
  rentals,
  serviceTickets,
}: {
  equipment: EquipmentEntity;
  documents: Document[];
  ganttRentals: GanttRentalData[];
  rentals: Rental[];
  serviceTickets: ServiceTicket[];
}) {
  const items: EquipmentTimelineItem[] = [];

  ganttRentals.forEach((rental) => {
    items.push({
      id: `gantt:${rental.id}`,
      date: rental.startDate,
      title: `Аренда: ${getGanttRentalStatusLabel(rental.status)}`,
      description: `${rental.client || 'Клиент не указан'} · ${formatPreviewDate(rental.startDate)} — ${formatPreviewDate(rental.endDate)}`,
    });
  });

  rentals.forEach((rental) => {
    items.push({
      id: `rental:${rental.id}`,
      date: rental.startDate,
      title: `Аренда: ${getClassicRentalStatusLabel(rental.status)}`,
      description: `${rental.client || 'Клиент не указан'} · ${formatPreviewDate(rental.startDate)} — ${formatPreviewDate(rental.actualReturnDate || rental.plannedReturnDate)}`,
    });
  });

  serviceTickets.forEach((ticket) => {
    items.push({
      id: `service:${ticket.id}`,
      date: ticket.createdAt || ticket.plannedDate || ticket.closedAt || '',
      title: `Сервис: ${getServiceStatusLabel(ticket.status)}`,
      description: ticket.reason || ticket.description || 'Сервисная заявка',
    });
  });

  documents.forEach((document) => {
    items.push({
      id: `document:${document.id}`,
      date: getDocumentDate(document),
      title: `Документ: ${getDocumentTypeLabel(document)}`,
      description: getDocumentNumber(document),
    });
  });

  (equipment.history || []).forEach((entry, index) => {
    items.push({
      id: `history:${index}`,
      date: entry.date,
      title: entry.type === 'system' ? 'Изменение статуса' : 'Комментарий',
      description: [entry.text, entry.author].filter(Boolean).join(' · '),
    });
  });

  (equipment.receiptHistory || []).forEach((entry, index) => {
    items.push({
      id: `sale:${index}`,
      date: entry.date,
      title: 'Продажное событие',
      description: [entry.oldStatusLabel, entry.newStatusLabel].filter(Boolean).join(' → ') || entry.comment || 'Изменение статуса продажи',
    });
  });

  if (isSaleRegistryEquipment(equipment)) {
    items.push({
      id: 'sale:current',
      date: equipment.acceptedAt || equipment.actualArrivalDate || equipment.plannedArrivalDate || '',
      title: 'Продажный статус',
      description: getRegistryStatusLabel(equipment),
    });
  }

  return items
    .filter(item => item.date || item.description)
    .sort((left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime())
    .slice(0, 18);
}

function canPerform(
  can: PermissionCan,
  action: Parameters<PermissionCan>[0],
  section: Parameters<PermissionCan>[1],
) {
  return typeof can === 'function' && Boolean(can(action, section));
}

function getSourceQuickAction(
  actions: Array<{ id?: string; to?: string; disabled?: boolean; reason?: string }>,
  id: string,
) {
  return actions.find(action => action?.id === id);
}

function buildEquipmentPreviewQuickActions({
  equipment,
  activeRentalIndex,
  can,
  canViewDocuments,
  canViewRentals,
  canViewService,
  currentRentalId,
  openServiceTicket,
  onShowHistory,
}: {
  equipment: EquipmentEntity;
  activeRentalIndex: ActiveRentalIndex;
  can: PermissionCan;
  canViewDocuments: boolean;
  canViewRentals: boolean;
  canViewService: boolean;
  currentRentalId: string;
  openServiceTicket: ServiceTicket | null;
  onShowHistory: () => void;
}) {
  const statusKind = getRegistryStatusKind(equipment, activeRentalIndex);
  const saleRegistry = isSaleRegistryEquipment(equipment);
  const quickActionSource = buildEquipmentQuickActions({
    equipment: { ...equipment, saleMode: saleRegistry },
    can,
    currentRental: currentRentalId ? { id: currentRentalId } : undefined,
  }) as Array<{ id?: string; to?: string; disabled?: boolean; reason?: string }>;
  const actions: EquipmentPreviewQuickAction[] = [];
  const detailPath = getEquipmentDetailPath(equipment);
  const editPath = `${detailPath}?action=edit`;
  const documentsPath = buildEquipmentContextPath('/documents', equipment);
  const serviceNewPath = buildEquipmentContextPath('/service/new', equipment);
  const salePath = `/sales/equipment/${encodeURIComponent(equipment.id)}`;
  const saleEditPath = `${salePath}?action=edit`;
  const createRentalAction = getSourceQuickAction(quickActionSource, 'equipment-create-rental');
  const createServiceAction = getSourceQuickAction(quickActionSource, 'equipment-create-service');
  const salePdiAction = getSourceQuickAction(quickActionSource, 'equipment-sale-pdi');
  const canViewSales = canPerform(can, 'view', 'sales');
  const canCreateSales = canPerform(can, 'create', 'sales');
  const canEditSales = canPerform(can, 'edit', 'sales');
  const canEditEquipment = canPerform(can, 'edit', 'equipment');
  const canCreateDocuments = canPerform(can, 'create', 'documents');
  const canManageSaleEquipment = canEditSales || canEditEquipment;

  const addDocumentsAction = (label = 'Документы') => {
    if (!canViewDocuments) return;
    actions.push({ id: 'documents', label, icon: FileText, to: documentsPath });
  };

  const addCreateServiceAction = () => {
    if (!canPerform(can, 'create', 'service')) return;
    actions.push({
      id: 'create-service',
      label: 'Создать сервисную заявку',
      icon: Wrench,
      to: createServiceAction?.to || serviceNewPath,
      tone: statusKind === 'service' ? 'default' : 'primary',
    });
  };

  if (statusKind === 'sold') {
    if (canViewSales) {
      actions.push({ id: 'open-sale', label: 'Открыть сделку/продажу', icon: BadgeDollarSign, to: salePath, tone: 'primary' });
    }
    addDocumentsAction('Документы продажи');
    actions.push({ id: 'history', label: 'История', icon: History, onClick: onShowHistory });
    if (canManageSaleEquipment && getSourceQuickAction(quickActionSource, 'equipment-sale-return')) {
      actions.push({
        id: 'return-to-sale',
        label: 'Вернуть в продажу',
        icon: RotateCcw,
        disabled: true,
        reason: 'Оформляется в полной карточке продажи',
      });
    }
    return actions;
  }

  if (statusKind === 'for_sale') {
    if (canViewSales) {
      actions.push({ id: 'open-sale', label: 'Открыть карточку продажи', icon: BadgeDollarSign, to: salePath, tone: 'primary' });
    }
    if (canViewSales && canCreateSales && canCreateDocuments) {
      actions.push({
        id: 'create-quote',
        label: 'Создать КП',
        icon: FileText,
        to: buildEquipmentContextPath('/documents', equipment, { action: 'create', type: 'commercial_offer' }),
      });
    }
    if (canManageSaleEquipment) {
      actions.push({
        id: 'edit-price',
        label: 'Редактировать цену',
        icon: PenLine,
        to: saleEditPath,
      });
      actions.push({
        id: 'remove-from-sale',
        label: 'Снять с продажи',
        icon: RotateCcw,
        disabled: true,
        reason: 'Статус продажи меняется в полной карточке продажи',
        tone: 'danger',
      });
    }
    if (canViewSales && canPerform(can, 'create', 'service')) {
      actions.push({
        id: 'create-pdi',
        label: 'Создать PDI',
        icon: Wrench,
        to: buildEquipmentContextPath('/service/new', equipment, { mode: 'sales_pdi' }),
        disabled: Boolean(salePdiAction?.disabled),
        reason: salePdiAction?.reason,
      });
    }
    addDocumentsAction();
    return actions;
  }

  if (statusKind === 'rented') {
    if (canViewRentals && currentRentalId) {
      actions.push({
        id: 'open-rental',
        label: 'Открыть аренду',
        icon: Truck,
        to: `/rentals/${encodeURIComponent(currentRentalId)}`,
        tone: 'primary',
      });
    }
    if (canPerform(can, 'edit', 'rentals') && currentRentalId) {
      actions.push({
        id: 'plan-return',
        label: 'Запланировать возврат',
        icon: RotateCcw,
        disabled: true,
        reason: 'Возврат планируется в карточке аренды',
      });
    }
    addCreateServiceAction();
    addDocumentsAction();
    return actions;
  }

  if (statusKind === 'service') {
    if (canViewService && openServiceTicket) {
      actions.push({
        id: 'open-service-ticket',
        label: 'Открыть заявку',
        icon: ClipboardList,
        to: `/service/${encodeURIComponent(openServiceTicket.id)}`,
        tone: 'primary',
      });
    }
    if (canPerform(can, 'edit', 'service') && openServiceTicket) {
      actions.push({
        id: 'assign-mechanic',
        label: 'Назначить механика',
        icon: PenLine,
        disabled: true,
        reason: 'Назначение выполняется в карточке заявки',
      });
    }
    if (canViewService) {
      actions.push({ id: 'repair-history', label: 'История ремонта', icon: History, onClick: onShowHistory });
    }
    addDocumentsAction();
    return actions;
  }

  if (statusKind === 'available') {
    if (canEditEquipment) {
      actions.push({ id: 'edit', label: 'Редактировать', icon: PenLine, to: editPath });
    }
    if (createRentalAction && canPerform(can, 'create', 'rentals')) {
      actions.push({
        id: 'create-rental',
        label: 'Создать аренду',
        icon: CalendarPlus,
        to: createRentalAction.to || buildEquipmentContextPath('/rentals/new', equipment),
        disabled: Boolean(createRentalAction.disabled),
        reason: createRentalAction.reason,
        tone: 'primary',
      });
    }
    addCreateServiceAction();
    if (canManageSaleEquipment) {
      actions.push({
        id: 'put-for-sale',
        label: 'Выставить на продажу',
        icon: BadgeDollarSign,
        disabled: true,
        reason: 'Перевод в продажу выполняется в полной карточке техники',
      });
    }
    addDocumentsAction();
    return actions;
  }

  if (statusKind === 'reserved') {
    if (canViewRentals && currentRentalId) {
      actions.push({
        id: 'open-reservation',
        label: 'Открыть бронь',
        icon: Truck,
        to: `/rentals/${encodeURIComponent(currentRentalId)}`,
        tone: 'primary',
      });
    }
    addCreateServiceAction();
    addDocumentsAction();
    return actions;
  }

  if (canPerform(can, 'edit', 'equipment')) {
    actions.push({ id: 'edit', label: 'Редактировать', icon: PenLine, to: editPath });
  }
  if (canViewRentals) {
    actions.push({ id: 'rental-history', label: 'История аренд', icon: History, onClick: onShowHistory });
  }
  addDocumentsAction();
  return actions;
}

function shouldLogWarrantyDebug() {
  return import.meta.env.DEV || window.localStorage.getItem('warrantyDebug') === '1';
}

function EmptyState({
  title,
  description,
  icon: Icon = Search,
  action,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-border bg-card/95 px-4 py-12 text-center shadow-[0_20px_40px_-32px_rgba(15,23,42,0.95)]">
      <Icon className="mb-3 h-8 w-8 text-muted-foreground" />
      <h3 className="app-shell-title max-w-md text-base font-extrabold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? (
        <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (!error) return fallback;
  const status = typeof error === 'object' && error && 'status' in error ? `HTTP ${(error as { status?: number }).status}` : '';
  const message = error instanceof Error ? error.message : fallback;
  return [status, message].filter(Boolean).join(': ');
}

export default function Equipment() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { can, canView, canReadCollection } = usePermissions();
  const canViewRentals = canView('rentals');
  const canViewService = canView('service');
  const canViewDocuments = canView('documents');
  const canViewSales = canView('sales');
  const canCreateEquipment = can('create', 'equipment');
  const canManageActionQueue = can('edit', 'equipment');
  const normalizedRole = normalizeUserRole(user?.role);
  const canViewShippingPhotos = canReadCollection('shipping_photos');
  const [search, setSearch] = React.useState('');
  const [activeTab, setActiveTab] = React.useState<EquipmentTab>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [typeFilter, setTypeFilter] = React.useState<string>('all');
  const [driveFilter, setDriveFilter] = React.useState<string>('all');
  const [categoryFilter, setCategoryFilter] = React.useState<string>('all');
  const [fleetFilter, setFleetFilter] = React.useState<string>('all');
  const [ownerFilter, setOwnerFilter] = React.useState<string>('all');
  const [locationFilter, setLocationFilter] = React.useState<string>('all');
  const [gsmFilter, setGsmFilter] = React.useState<string>('all');
  const [priorityFilter, setPriorityFilter] = React.useState<string>('all');
  const [showFilters, setShowFilters] = React.useState(false);
  const [pageSize, setPageSize] = React.useState(DEFAULT_EQUIPMENT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = React.useState(1);
  const actionQueueFilterParam = searchParams.get('actionQueueFilter') || searchParams.get('actionQueue');
  const initialActionQueueFilter = React.useMemo(
    () => normalizeActionQueueFilter(actionQueueFilterParam),
    [actionQueueFilterParam],
  );
  const equipmentQuery = useEquipmentList();
  const readinessQuery = useEquipmentReadiness();
  const actionQueueQuery = useManagementActionQueue();
  const ganttQuery = useGanttData({ enabled: canViewRentals });
  const rentalsQuery = useRentalsList({ enabled: canViewRentals });
  const documentsQuery = useDocumentsList({ enabled: canViewDocuments });
  const serviceTicketsQuery = useServiceTicketsList({ enabled: canViewService });
  const equipmentList = equipmentQuery.data ?? [];
  const ganttRentals = ganttQuery.data ?? [];
  const rentals = rentalsQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const serviceTickets = serviceTicketsQuery.data ?? [];
  const equipmentTypeCatalog = useEquipmentTypeCatalog();
  const [selectedEquipmentId, setSelectedEquipmentId] = React.useState<string | null>(null);
  const [activeQuickViewTab, setActiveQuickViewTab] = React.useState<EquipmentPreviewTab>('overview');
  const investorBinding = React.useMemo(() => getInvestorBinding({
    role: normalizedRole,
    status: 'Активен',
    ownerId: user?.ownerId,
    ownerName: user?.ownerName,
    name: user?.name,
  }), [normalizedRole, user?.name, user?.ownerId, user?.ownerName]);
  const isInvestorScope = isInvestorUser({
    role: normalizedRole,
    status: 'Активен',
    ownerId: user?.ownerId,
    ownerName: user?.ownerName,
    name: user?.name,
  });
  const scopedEquipmentList = React.useMemo(
    () => isInvestorScope && investorBinding
      ? equipmentList.filter(item => equipmentMatchesInvestorBinding(item, investorBinding))
      : equipmentList,
    [equipmentList, investorBinding, isInvestorScope],
  );

  const enrichedEquipmentList = React.useMemo(
    () => normalizeEquipmentList(enrichEquipment(scopedEquipmentList, ganttRentals)),
    [scopedEquipmentList, ganttRentals],
  );
  const activeRentalIndex = React.useMemo(
    () => buildActiveRentalIndex(enrichedEquipmentList, ganttRentals),
    [enrichedEquipmentList, ganttRentals],
  );
  const selectedEquipment = React.useMemo(
    () => enrichedEquipmentList.find(equipment => equipment.id === selectedEquipmentId) ?? null,
    [enrichedEquipmentList, selectedEquipmentId],
  );
  const shippingPhotosQuery = useQuery({
    queryKey: ['shippingPhotos', selectedEquipment?.id],
    queryFn: () => equipmentService.getShippingPhotos(String(selectedEquipment?.id ?? '')),
    enabled: Boolean(selectedEquipment?.id && canViewShippingPhotos),
  });
  const selectedShippingPhotos = shippingPhotosQuery.data ?? [];

  React.useEffect(() => {
    if (selectedEquipmentId && !selectedEquipment) {
      setSelectedEquipmentId(null);
    }
  }, [selectedEquipment, selectedEquipmentId]);

  React.useEffect(() => {
    setActiveQuickViewTab('overview');
  }, [selectedEquipmentId]);

  const locationOptions = React.useMemo(
    () => Array.from(new Set(enrichedEquipmentList.map((eq) => eq.location).filter(Boolean))).sort(),
    [enrichedEquipmentList],
  );
  const equipmentTypeOptions = React.useMemo(
    () => mergeEquipmentTypesWithExistingEquipment(equipmentTypeCatalog, enrichedEquipmentList),
    [enrichedEquipmentList, equipmentTypeCatalog],
  );
  const categoryOptions = React.useMemo(() => {
    const base = ['own', 'client', 'partner', 'sold'];
    const values = new Set<string>(base);
    enrichedEquipmentList.forEach((equipment) => {
      const value = String(equipment.category ?? '').trim();
      if (value) values.add(value);
    });
    return Array.from(values).map((value) => ({ value, label: getEquipmentCategoryLabel(value) }));
  }, [enrichedEquipmentList]);
  const typeFilterOptions = React.useMemo(() => {
    const result = [...STANDARD_EQUIPMENT_TYPE_FILTER_OPTIONS];
    const existingValues = new Set(result.map((option) => option.value));
    for (const item of equipmentTypeOptions) {
      if (getEquipmentTypeGroup(item.value, equipmentTypeOptions) !== 'other') continue;
      const value = `exact:${item.value}`;
      if (existingValues.has(value)) continue;
      existingValues.add(value);
      result.push({ value, label: item.label });
    }
    return result;
  }, [equipmentTypeOptions]);
  const ownerOptions = React.useMemo(() => {
    const base = [
      { value: 'own', label: 'Собственная' },
      { value: 'investor', label: 'Инвестор' },
      { value: 'sublease', label: 'Субаренда' },
    ];
    const seen = new Set(base.map((option) => option.value));
    const result = [...base];

    for (const equipment of enrichedEquipmentList) {
      const owner = String(equipment.owner ?? '').trim();
      if (owner && !seen.has(owner)) {
        seen.add(owner);
        result.push({ value: owner, label: getOwnerLabel(owner) });
      }

      const ownerName = String(equipment.ownerName ?? '').trim();
      if (!ownerName) continue;
      const value = `ownerName:${ownerName}`;
      if (seen.has(value)) continue;
      seen.add(value);
      result.push({ value, label: ownerName });
    }

    return result;
  }, [enrichedEquipmentList]);

  const quickViewPanelData = React.useMemo<EquipmentQuickViewPanelData | null>(() => {
    if (!selectedEquipment) return null;

    const inventoryIsUnique = isEquipmentInventoryUnique(selectedEquipment, enrichedEquipmentList);
    const relatedGanttRentals = canViewRentals
      ? ganttRentals.filter(rental => ganttRentalMatchesEquipment(rental, selectedEquipment, inventoryIsUnique))
      : [];
    const relatedRentals = canViewRentals
      ? rentals.filter(rental => rentalMatchesEquipment(rental, selectedEquipment, inventoryIsUnique))
      : [];
    const rentalIds = getRentalStableIds(relatedRentals, relatedGanttRentals);
    const relatedDocuments = canViewDocuments
      ? documents
        .filter(document => documentMatchesEquipmentOrRentals(document, selectedEquipment, inventoryIsUnique, rentalIds))
        .sort((left, right) => getDocumentDate(right).localeCompare(getDocumentDate(left)))
      : [];
    const relatedServiceTickets = canViewService
      ? serviceTickets
        .filter(ticket => serviceTicketMatchesEquipment(ticket, selectedEquipment, inventoryIsUnique))
        .sort((left, right) => cleanText(right.createdAt || right.plannedDate).localeCompare(cleanText(left.createdAt || left.plannedDate)))
      : [];
    const currentGanttRental = getCurrentGanttRental(relatedGanttRentals);
    const currentClassicRental = getCurrentClassicRental(relatedRentals);
    const currentRentalId = getGanttRentalRouteId(currentGanttRental) || cleanText(currentClassicRental?.id);
    const openServiceTicket = relatedServiceTickets.find(isOpenServiceTicket) ?? null;
    const title = [selectedEquipment.manufacturer, selectedEquipment.model].filter(Boolean).join(' ') || 'Без модели';
    const equipmentPhotoSrc = photoSource(selectedEquipment.photo);
    const previewPhotos = canViewShippingPhotos
      ? collectEquipmentPreviewPhotos(selectedEquipment, selectedShippingPhotos, relatedServiceTickets)
      : equipmentPhotoSrc
        ? [{ id: 'main-photo', label: 'Фото техники', src: equipmentPhotoSrc, caption: title }]
        : [];
    const timeline = buildEquipmentTimeline({
      equipment: selectedEquipment,
      documents: relatedDocuments,
      ganttRentals: relatedGanttRentals,
      rentals: relatedRentals,
      serviceTickets: relatedServiceTickets,
    });
    const detailPath = getEquipmentDetailPath(selectedEquipment);
    const mainPhoto = previewPhotos[0]?.src || equipmentPhotoSrc;
    const gsmDisplay = getEquipmentGsmDisplay(selectedEquipment);
    const statusLabel = getRegistryStatusLabel(selectedEquipment, activeRentalIndex);
    const equipmentTypeLabel = findEquipmentTypeLabel(selectedEquipment.type, equipmentTypeOptions);
    const driveLabel = getEquipmentDriveLabel(selectedEquipment.drive);
    const docsPath = `/documents?equipmentId=${encodeURIComponent(selectedEquipment.id)}&equipmentInv=${encodeURIComponent(selectedEquipment.inventoryNumber || '')}`;
    const saleDocumentsCount = isSoldEquipment(selectedEquipment) || isSaleRegistryEquipment(selectedEquipment)
      ? documentSlotCount(relatedDocuments, 'sale')
      : null;
    const quickActions = buildEquipmentPreviewQuickActions({
      equipment: selectedEquipment,
      activeRentalIndex,
      can,
      canViewDocuments,
      canViewRentals,
      canViewService,
      currentRentalId,
      openServiceTicket,
      onShowHistory: () => setActiveQuickViewTab('history'),
    });

    return {
      title,
      detailPath,
      mainPhoto,
      statusLabel,
      statusClassName: getRegistryStatusAppearance(selectedEquipment, activeRentalIndex),
      inventoryNumber: selectedEquipment.inventoryNumber,
      serialNumber: selectedEquipment.serialNumber,
      quickActions,
      overviewFields: [
        { label: 'Тип техники', value: equipmentTypeLabel },
        { label: 'Привод', value: driveLabel },
        { label: 'Год выпуска', value: selectedEquipment.year || '—' },
        { label: 'Категория', value: getEquipmentCategoryLabel(selectedEquipment.category) },
        { label: 'Собственник', value: getRegistryOwnerLabel(selectedEquipment) },
        { label: 'Локация', value: selectedEquipment.location || '—' },
        { label: 'Наработка', value: formatPreviewNumber(selectedEquipment.hours, ' м/ч') },
        { label: 'Следующее ТО', value: formatPreviewDate(selectedEquipment.nextMaintenance) },
        { label: 'Приоритет', value: getPriorityLabel(selectedEquipment.priority) },
        { label: 'Примечание', value: selectedEquipment.notes || '—' },
      ],
      specFields: [
        { label: 'Рабочая высота', value: formatPreviewNumber(selectedEquipment.workingHeight, ' м') },
        { label: 'Высота платформы', value: formatPreviewNumber(selectedEquipment.liftHeight, ' м') },
        { label: 'Грузоподъёмность', value: formatPreviewNumber(selectedEquipment.loadCapacity, ' кг') },
        { label: 'Масса', value: formatPreviewNumber(selectedEquipment.weight, ' кг') },
        { label: 'Габариты', value: selectedEquipment.dimensions || '—' },
        { label: 'Год выпуска', value: selectedEquipment.year || '—' },
        { label: 'Наработка', value: formatPreviewNumber(selectedEquipment.hours, ' м/ч') },
        { label: 'Питание', value: driveLabel },
      ],
      canViewDocuments,
      documentSlots: [
        { label: 'Паспорт', count: documentSlotCount(relatedDocuments, 'passport') },
        { label: 'Сертификат', count: documentSlotCount(relatedDocuments, 'certificate') },
        { label: 'Акт ввода', count: documentSlotCount(relatedDocuments, 'commissioning') },
        ...(saleDocumentsCount === null ? [] : [{ label: 'Договор / документы продажи', count: saleDocumentsCount }]),
      ],
      documents: relatedDocuments.map(document => ({
        id: document.id,
        typeLabel: getDocumentTypeLabel(document),
        number: getDocumentNumber(document),
        dateLabel: formatPreviewDate(getDocumentDate(document)),
      })),
      docsPath,
      canViewPhotos: canViewShippingPhotos,
      photos: previewPhotos.map(photo => ({
        id: photo.id,
        label: photo.label,
        src: photo.src,
        metaLabel: [photo.caption, formatPreviewDate(photo.date)].filter(value => value && value !== '—').join(' · ') || '—',
      })),
      timeline: timeline.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description,
        dateLabel: formatPreviewDate(item.date),
      })),
    };
  }, [
    activeRentalIndex,
    can,
    canViewDocuments,
    canViewRentals,
    canViewService,
    canViewShippingPhotos,
    documents,
    enrichedEquipmentList,
    equipmentTypeOptions,
    ganttRentals,
    rentals,
    selectedEquipment,
    selectedShippingPhotos,
    serviceTickets,
  ]);

  const filteredEquipment = React.useMemo(() => (
    enrichedEquipmentList
      .filter((equipment) => {
        const matchesSearch = matchesEquipmentSearch(equipment, search);
        const matchesStatus = matchesStatusFilter(equipment, statusFilter, activeRentalIndex, EQUIPMENT_REGISTRY_MATCH_OPTIONS);
        const matchesType = matchesEquipmentTypeFilter(equipment, typeFilter, equipmentTypeOptions);
        const matchesDrive = matchesDriveFilter(equipment, driveFilter);
        const matchesCategory = categoryFilter === 'all' || equipment.category === categoryFilter;
        const matchesFleet = fleetFilter === 'all' || String(equipment.activeInFleet) === fleetFilter;
        const matchesOwner = matchesOwnerFilter(equipment, ownerFilter);
        const matchesLocation = locationFilter === 'all' || equipment.location === locationFilter;
        const gsmLabel = getEquipmentGsmDisplay(equipment).label;
        const matchesGsm = gsmFilter === 'all'
          || (gsmFilter === 'online' && gsmLabel === 'Онлайн')
          || (gsmFilter === 'offline' && (gsmLabel === 'Офлайн' || gsmLabel === 'Нет связи'))
          || (gsmFilter === 'unknown' && gsmLabel === 'Нет данных');
        const matchesPriority = priorityFilter === 'all' || equipment.priority === priorityFilter;

        return matchesSearch
          && matchesStatus
          && matchesType
          && matchesDrive
          && matchesCategory
          && matchesFleet
          && matchesOwner
          && matchesLocation
          && matchesGsm
          && matchesPriority
          && matchesTabType(equipment, activeTab, activeRentalIndex, EQUIPMENT_REGISTRY_MATCH_OPTIONS);
      })
      .sort(compareEquipmentByPriority)
  ), [
    activeTab,
    activeRentalIndex,
    categoryFilter,
    driveFilter,
    enrichedEquipmentList,
    equipmentTypeOptions,
    fleetFilter,
    gsmFilter,
    locationFilter,
    ownerFilter,
    priorityFilter,
    search,
    statusFilter,
    typeFilter,
  ]);

  React.useEffect(() => {
    if (!shouldLogWarrantyDebug() || !isWarrantyMechanicRole(user?.role)) return;
    const byTab = Object.fromEntries(
      EQUIPMENT_TABS.map((tab) => [
        tab.key,
        enrichedEquipmentList.filter((item) => matchesTabType(item, tab.key, activeRentalIndex, EQUIPMENT_REGISTRY_MATCH_OPTIONS)).length,
      ]),
    );
    const filters = {
      activeTab,
      search,
      categoryFilter,
      fleetFilter,
      statusFilter,
      typeFilter,
      ownerFilter,
      driveFilter,
      locationFilter,
      activeRentalIndex,
      equipmentTypeOptions,
      registryOptions: EQUIPMENT_REGISTRY_MATCH_OPTIONS,
    };
    const excluded = enrichedEquipmentList
      .map(item => ({ id: item.id, inventoryNumber: item.inventoryNumber, reasons: equipmentFilterReasons(item, filters) }))
      .filter(item => item.reasons.length > 0)
      .slice(0, 5);
    console.debug('[warranty-mechanic/equipment]', {
      rawRole: user?.rawRole ?? user?.role,
      normalizedRole: normalizeUserRole(user?.role),
      beforeFilters: enrichedEquipmentList.length,
      afterFilters: filteredEquipment.length,
      activeTab,
      byTab,
      filters,
      excluded,
    });
  }, [
    activeTab,
    activeRentalIndex,
    categoryFilter,
    driveFilter,
    enrichedEquipmentList,
    equipmentTypeOptions,
    filteredEquipment.length,
    fleetFilter,
    locationFilter,
    ownerFilter,
    search,
    statusFilter,
    typeFilter,
    user?.rawRole,
    user?.role,
  ]);

  const tabCounts = React.useMemo(() => (
    buildEquipmentTabCounts(enrichedEquipmentList, EQUIPMENT_TABS, activeRentalIndex, EQUIPMENT_REGISTRY_MATCH_OPTIONS)
  ), [activeRentalIndex, enrichedEquipmentList]);
  const totalPark = tabCounts.all ?? 0;
  const activeTabTotal = tabCounts[activeTab] ?? 0;
  const attentionCount = React.useMemo(() => {
    const readinessBlocked = new Set(
      (readinessQuery.data?.items ?? [])
        .filter(item => item.readinessStatus !== 'ready' && item.readinessStatus !== 'rented')
        .map(item => item.equipmentId),
    );
    return enrichedEquipmentList.filter((equipment) => (
      readinessBlocked.has(equipment.id)
      || equipment.priority === 'critical'
      || equipment.priority === 'high'
      || getRegistryStatusKind(equipment, activeRentalIndex) === 'service'
    )).length;
  }, [activeRentalIndex, enrichedEquipmentList, readinessQuery.data?.items]);
  const kpiCards = React.useMemo<EquipmentKpiCardConfig[]>(() => [
    {
      title: 'Всего техники',
      value: totalPark,
      caption: 'Единиц в реестре',
      icon: Boxes,
      tone: 'neutral',
    },
    {
      title: 'Готова к аренде',
      value: tabCounts.available ?? 0,
      caption: 'Доля от общего парка',
      icon: CheckCircle2,
      tone: 'available',
      percent: getRegistryPercent(tabCounts.available ?? 0, totalPark),
    },
    {
      title: 'В аренде',
      value: tabCounts.rented ?? 0,
      caption: 'Доля от общего парка',
      icon: Truck,
      tone: 'rented',
      percent: getRegistryPercent(tabCounts.rented ?? 0, totalPark),
    },
    {
      title: 'В сервисе',
      value: tabCounts.service ?? 0,
      caption: 'Доля от общего парка',
      icon: Wrench,
      tone: 'service',
      percent: getRegistryPercent(tabCounts.service ?? 0, totalPark),
    },
    {
      title: 'На продажу',
      value: tabCounts.for_sale ?? 0,
      caption: 'Доля от общего парка',
      icon: BadgeDollarSign,
      tone: 'sale',
      percent: getRegistryPercent(tabCounts.for_sale ?? 0, totalPark),
    },
    {
      title: 'Требует внимания',
      value: attentionCount,
      caption: 'Блокеры и высокий приоритет',
      icon: AlertTriangle,
      tone: 'attention',
      percent: getRegistryPercent(attentionCount, totalPark),
    },
  ], [attentionCount, tabCounts, totalPark]);
  const activeFilterCount = [
    search.trim() !== '',
    categoryFilter !== 'all',
    fleetFilter !== 'all',
    statusFilter !== 'all',
    typeFilter !== 'all',
    ownerFilter !== 'all',
    driveFilter !== 'all',
    locationFilter !== 'all',
    gsmFilter !== 'all',
    priorityFilter !== 'all',
  ].filter(Boolean).length;

  const resetFilters = () => {
    setSearch('');
    setCategoryFilter('all');
    setFleetFilter('all');
    setStatusFilter('all');
    setTypeFilter('all');
    setDriveFilter('all');
    setOwnerFilter('all');
    setLocationFilter('all');
    setGsmFilter('all');
    setPriorityFilter('all');
  };

  const isEquipmentLoading = equipmentQuery.isLoading || (canViewRentals && ganttQuery.isLoading);
  const emptyState: EquipmentEmptyStateConfig = (() => {
    if (isEquipmentLoading && totalPark === 0) {
      return {
        ...EQUIPMENT_EMPTY_STATE_COPY.loading,
        icon: Boxes,
      };
    }

    if (totalPark === 0) {
      return {
        ...EQUIPMENT_EMPTY_STATE_COPY.emptyRegistry,
        icon: Boxes,
        action: canCreateEquipment ? (
          <Link to="/equipment/new">
            <Button className="app-button-primary rounded-xl px-4">
              <Plus className="h-4 w-4" />
              Добавить технику
            </Button>
          </Link>
        ) : undefined,
      };
    }

    if (activeTab === 'for_sale' && activeTabTotal === 0) {
      return {
        ...EQUIPMENT_EMPTY_STATE_COPY.forSaleEmpty,
        icon: BadgeDollarSign,
        action: canViewSales ? (
          <Link to="/sales">
            <Button variant="outline" className="rounded-xl px-4">
              <BadgeDollarSign className="h-4 w-4" />
              Перейти к продажам
            </Button>
          </Link>
        ) : undefined,
      };
    }

    if (activeTab === 'sold' && activeTabTotal === 0) {
      return {
        ...EQUIPMENT_EMPTY_STATE_COPY.soldEmpty,
        icon: Archive,
      };
    }

    return {
      ...EQUIPMENT_EMPTY_STATE_COPY.noResults,
      icon: Search,
      action: activeFilterCount > 0 ? (
        <Button type="button" variant="outline" className="rounded-xl px-4" onClick={resetFilters}>
          <RotateCcw className="h-4 w-4" />
          Сбросить фильтры
        </Button>
      ) : undefined,
    };
  })();

  const isSaleTab = activeTab === 'for_sale' || activeTab === 'sold';
  const totalVisible = filteredEquipment.length;
  const { totalPages, visibleCurrentPage, pageStart, pageEnd } = getEquipmentPageRange(totalVisible, currentPage, pageSize);
  const paginatedEquipment = React.useMemo(
    () => getEquipmentPageItems(filteredEquipment, visibleCurrentPage, pageSize),
    [filteredEquipment, pageSize, visibleCurrentPage],
  );

  React.useEffect(() => {
    setCurrentPage(1);
  }, [
    activeTab,
    categoryFilter,
    driveFilter,
    fleetFilter,
    gsmFilter,
    locationFilter,
    ownerFilter,
    priorityFilter,
    search,
    statusFilter,
    typeFilter,
  ]);

  React.useEffect(() => {
    setCurrentPage((page) => clampEquipmentPage(page, totalPages));
  }, [totalPages]);

  return (
    <div className="space-y-3 overflow-x-hidden p-4 sm:space-y-4 sm:p-5 md:p-6">
      <section className="app-panel overflow-hidden">
        <div className="border-b border-border/70 px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h1 className="app-shell-title text-2xl font-extrabold text-foreground">Техника</h1>
              <p className="mt-1 max-w-2xl text-xs font-medium text-foreground/58">Единый реестр парка, готовности и операционных блокеров</p>
            </div>
            {canCreateEquipment && (
              <Link to="/equipment/new">
                <Button size="sm" className="app-button-primary rounded-xl px-4">
                  <Plus className="h-4 w-4" />
                  Добавить технику
                </Button>
              </Link>
            )}
          </div>

          <EquipmentStatusTabs
            activeTab={activeTab}
            tabs={EQUIPMENT_TABS}
            counts={tabCounts}
            onTabChange={setActiveTab}
          />

          <EquipmentKpiCards cards={kpiCards} />
        </div>

        <EquipmentFilters
          search={search}
          onSearchChange={setSearch}
          activeFilterCount={activeFilterCount}
          open={showFilters}
          onOpenChange={setShowFilters}
          onReset={resetFilters}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={setCategoryFilter}
          fleetFilter={fleetFilter}
          onFleetFilterChange={setFleetFilter}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          ownerFilter={ownerFilter}
          onOwnerFilterChange={setOwnerFilter}
          driveFilter={driveFilter}
          onDriveFilterChange={setDriveFilter}
          locationFilter={locationFilter}
          onLocationFilterChange={setLocationFilter}
          gsmFilter={gsmFilter}
          onGsmFilterChange={setGsmFilter}
          priorityFilter={priorityFilter}
          onPriorityFilterChange={setPriorityFilter}
          categoryOptions={categoryOptions}
          statusOptions={EQUIPMENT_STATUS_FILTER_OPTIONS}
          typeOptions={typeFilterOptions}
          ownerOptions={ownerOptions}
          driveOptions={EQUIPMENT_DRIVE_FILTER_OPTIONS}
          locationOptions={locationOptions}
          activeFleetLabels={ACTIVE_FLEET_LABELS}
        />
      </section>

      {(equipmentQuery.error || ganttQuery.error) && (
        <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          <div className="font-semibold">Не удалось загрузить данные техники</div>
          <div className="mt-1 text-red-100/80">
            {apiErrorMessage(equipmentQuery.error || ganttQuery.error, 'Проверьте доступ к /api/equipment и /api/gantt_rentals.')}
          </div>
          {isWarrantyMechanicRole(user?.role) && (
            <div className="mt-2 text-red-100/80">
              Для диагностики под этим пользователем откройте в Network `GET /api/access-diagnostics`.
            </div>
          )}
        </section>
      )}

      <FleetReadinessSection
        items={readinessQuery.data?.items ?? []}
        summary={readinessQuery.data?.summary}
        isLoading={readinessQuery.isLoading}
        error={readinessQuery.error}
      />

      <div className="space-y-3 sm:hidden">
        {totalVisible === 0 ? (
          <EmptyState {...emptyState} />
        ) : (
          <EquipmentMobileCards
            equipmentItems={paginatedEquipment}
            isSaleTab={isSaleTab}
            activeRentalIndex={activeRentalIndex}
            getEquipmentDetailPath={getEquipmentDetailPath}
            getEquipmentTypeLabel={(equipment) => findEquipmentTypeLabel(equipment.type, equipmentTypeOptions)}
            getEquipmentDriveLabel={getEquipmentDriveLabel}
            getRegistryStatusLabel={getRegistryStatusLabel}
            getRegistryStatusAppearance={getRegistryStatusAppearance}
            getPriorityLabel={getPriorityLabel}
            getPriorityAppearance={getPriorityAppearance}
            getRegistryOwnerLabel={getRegistryOwnerLabel}
            getEquipmentGsmDisplay={getEquipmentGsmDisplay}
            getSalePdiAppearance={getSalePdiAppearance}
            isSaleRegistryEquipment={isSaleRegistryEquipment}
            salePdiLabels={EQUIPMENT_SALE_PDI_LABELS}
            selectedEquipmentId={selectedEquipmentId}
            onSelectEquipment={(equipment) => setSelectedEquipmentId(equipment.id)}
          />
        )}
      </div>

      <section className="hidden overflow-hidden rounded-2xl border border-border/85 bg-card/92 shadow-[0_18px_42px_-36px_rgba(15,23,42,0.9)] sm:block">
        {totalVisible === 0 ? (
          <div className="p-6"><EmptyState {...emptyState} /></div>
        ) : (
          <div className={`grid min-w-0 grid-cols-1 ${
            quickViewPanelData ? 'xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_420px]' : ''
          }`}>
            <EquipmentRegistryTable
              equipmentItems={paginatedEquipment}
              activeRentalIndex={activeRentalIndex}
              selectedEquipmentId={selectedEquipmentId}
              onSelectEquipment={(equipment) => setSelectedEquipmentId(equipment.id)}
              getEquipmentDetailPath={getEquipmentDetailPath}
              getEquipmentTypeLabel={(equipment) => findEquipmentTypeLabel(equipment.type, equipmentTypeOptions)}
              getEquipmentDriveLabel={getEquipmentDriveLabel}
              getRegistryStatusLabel={getRegistryStatusLabel}
              getRegistryStatusAppearance={getRegistryStatusAppearance}
              getEquipmentCategoryLabel={getEquipmentCategoryLabel}
              getRegistryOwnerLabel={getRegistryOwnerLabel}
              getPriorityLabel={getPriorityLabel}
              getPriorityDotClass={getPriorityDotClass}
              getEquipmentGsmDisplay={getEquipmentGsmDisplay}
            />
            {quickViewPanelData ? (
              <div className="hidden xl:block">
                <EquipmentQuickViewPanel
                  selectedEquipment={selectedEquipment}
                  activeTab={activeQuickViewTab}
                  onTabChange={setActiveQuickViewTab}
                  onClose={() => setSelectedEquipmentId(null)}
                  mode="embedded"
                  {...quickViewPanelData}
                />
              </div>
            ) : null}
          </div>
        )}
      </section>

      {quickViewPanelData ? (
        <EquipmentQuickViewPanel
          selectedEquipment={selectedEquipment}
          activeTab={activeQuickViewTab}
          onTabChange={setActiveQuickViewTab}
          onClose={() => setSelectedEquipmentId(null)}
          {...quickViewPanelData}
        />
      ) : null}

      <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div>
          {totalVisible > 0
            ? `Показано ${pageStart}–${pageEnd} из ${totalVisible} найденных, всего в базе ${scopedEquipmentList.length}`
            : `Найдено 0 из ${scopedEquipmentList.length} единиц техники`}
        </div>
        {totalVisible > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>Строк на странице</span>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setCurrentPage(1);
              }}
              className="h-9 rounded-lg border border-border bg-secondary px-2 text-sm text-foreground outline-none transition focus:border-primary"
            >
              {EQUIPMENT_PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={visibleCurrentPage <= 1}
              onClick={() => setCurrentPage((page) => clampEquipmentPage(page - 1, totalPages))}
            >
              Назад
            </Button>
            <span className="min-w-[72px] text-center tabular-nums text-foreground">
              {visibleCurrentPage} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={visibleCurrentPage >= totalPages}
              onClick={() => setCurrentPage((page) => clampEquipmentPage(page + 1, totalPages))}
            >
              Вперёд
            </Button>
          </div>
        ) : null}
      </div>

      <ManagementActionQueueSection
        items={actionQueueQuery.data?.items ?? []}
        summary={actionQueueQuery.data?.summary}
        isLoading={actionQueueQuery.isLoading}
        error={actionQueueQuery.error}
        currentUser={user}
        canManageActions={canManageActionQueue}
        initialFilter={initialActionQueueFilter}
      />
    </div>
  );
}
