import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { getServicePriorityBadge, getServiceStatusBadge } from '../components/ui/badge';
import { FilterButton, FilterDialog, FilterField } from '../components/ui/filter-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ServiceDayPlanBoard } from '../components/service/ServiceDayPlanBoard';
import { WarrantyClaimsTab } from '../components/service/WarrantyClaimsTab';
import ServiceDetail from './ServiceDetail';
import type { AuthUser } from '../contexts/AuthContext';
import { useAuth } from '../contexts/AuthContext';
import { canManageServiceDayPlan, canViewServiceDayPlan, usePermissions } from '../lib/permissions';
import { isMechanicRole, isWarrantyMechanicRole, normalizeUserRole } from '../lib/userStorage';
import { useServiceTicketsList } from '../hooks/useServiceTickets';
import { formatDate } from '../lib/utils';
import type { Client, Mechanic, ServiceTicket } from '../types';
import { getServiceScenarioLabel, inferServiceKind } from '../lib/serviceScenarios';
import { buildServiceQueue } from '../lib/serviceQueue';
import { isRegularServiceTicket } from '../lib/serviceTicketKind.js';
import { equipmentService } from '../services/equipment.service';
import { rentalsService } from '../services/rentals.service';
import { clientsService } from '../services/clients.service';
import { mechanicsService } from '../services/mechanics.service';

const RESULT_BATCH_SIZE = 80;

const SERVICE_PRIORITY_ORDER: Record<ServiceTicket['priority'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const SERVICE_STATUS_ORDER: Record<ServiceTicket['status'], number> = {
  new: 0,
  in_progress: 1,
  waiting_parts: 2,
  needs_revision: 3,
  ready: 4,
  closed: 5,
};

const SERVICE_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
const SERVICE_STATUSES = ['new', 'in_progress', 'waiting_parts', 'needs_revision', 'ready', 'closed'] as const;

const WORKFLOW_FILTER_OPTIONS = [
  { value: 'all', label: 'Все' },
  { value: 'repair', label: 'Ремонт' },
  { value: 'diagnostics', label: 'Диагностика' },
  { value: 'receiving', label: 'Приёмка' },
] as const;

type ServiceWorkflowFilter = typeof WORKFLOW_FILTER_OPTIONS[number]['value'];
type ServiceWorkflowKind = Exclude<ServiceWorkflowFilter, 'all'> | 'maintenance';

function normalizeSearch(value: string) {
  return value.toLowerCase().replaceAll('ё', 'е').trim();
}

function truncateText(value: string, maxLength: number) {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function isActiveTicket(ticket: ServiceTicket) {
  return normalizeServiceStatus(ticket.status) !== 'closed';
}

function normalizeServicePriority(priority: ServiceTicket['priority']): ServiceTicket['priority'] {
  return SERVICE_PRIORITIES.includes(priority as typeof SERVICE_PRIORITIES[number]) ? priority : 'medium';
}

function normalizeServiceStatus(status: ServiceTicket['status']): ServiceTicket['status'] {
  return SERVICE_STATUSES.includes(status as typeof SERVICE_STATUSES[number]) ? status : 'new';
}

function getTicketSearchText(ticket: ServiceTicket) {
  return normalizeSearch([
    ticket.id,
    ticket.equipment,
    ticket.inventoryNumber,
    ticket.serialNumber,
    ticket.client,
    ticket.contractNumber,
    ticket.reason,
    ticket.description,
    ticket.assignedMechanicName,
    ticket.assignedTo,
    ticket.createdByUserName,
    ticket.createdBy,
    getServiceScenarioLabel(ticket),
  ].filter(Boolean).join(' '));
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (!error) return fallback;
  const status = typeof error === 'object' && error && 'status' in error ? `HTTP ${(error as { status?: number }).status}` : '';
  const message = error instanceof Error ? error.message : fallback;
  return [status, message].filter(Boolean).join(': ');
}

function serviceFilterReasons(
  ticket: ServiceTicket,
  filters: {
    search: string;
    priorityFilter: string;
    statusFilter: string;
    scenarioFilter: string;
    mechanicFilter: string;
    workflowFilter: ServiceWorkflowFilter;
    preset: 'all' | 'unassigned' | 'urgent' | 'waiting_parts' | 'needs_revision' | 'maintenance';
    effectiveDateFrom: string;
    effectiveDateTo: string;
  },
) {
  const reasons: string[] = [];
  const query = normalizeSearch(filters.search);
  const ticketPriority = normalizeServicePriority(ticket.priority);
  const ticketStatus = normalizeServiceStatus(ticket.status);
  const assignedMechanic = ticket.assignedMechanicName || ticket.assignedTo || '';
  const createdDate = typeof ticket.createdAt === 'string' ? ticket.createdAt.slice(0, 10) : '';
  if (query && !getTicketSearchText(ticket).includes(query)) reasons.push('search');
  if (filters.priorityFilter !== 'all' && ticketPriority !== filters.priorityFilter) reasons.push('priority');
  if (filters.statusFilter !== 'all' && ticketStatus !== filters.statusFilter) reasons.push('status');
  if (filters.scenarioFilter !== 'all' && inferServiceKind(ticket) !== filters.scenarioFilter) reasons.push('scenario');
  if (filters.mechanicFilter !== 'all' && assignedMechanic !== filters.mechanicFilter) reasons.push('mechanic');
  if (filters.workflowFilter !== 'all' && getTicketWorkflowKind(ticket) !== filters.workflowFilter) reasons.push('workflow');
  if (filters.effectiveDateFrom && (!createdDate || createdDate < filters.effectiveDateFrom)) reasons.push('dateFrom');
  if (filters.effectiveDateTo && (!createdDate || createdDate > filters.effectiveDateTo)) reasons.push('dateTo');
  const matchesPreset =
    filters.preset === 'all'
    || (filters.preset === 'unassigned' && !ticket.assignedMechanicId && !ticket.assignedTo)
    || (filters.preset === 'urgent' && ['high', 'critical'].includes(ticketPriority))
    || (filters.preset === 'waiting_parts' && ticketStatus === 'waiting_parts')
    || (filters.preset === 'needs_revision' && ticketStatus === 'needs_revision')
    || (filters.preset === 'maintenance' && ['to', 'chto', 'pto'].includes(inferServiceKind(ticket)));
  if (!matchesPreset) reasons.push(`preset:${filters.preset}`);
  return reasons;
}

function getTicketWorkflowKind(ticket: ServiceTicket): ServiceWorkflowKind {
  const kind = inferServiceKind(ticket);
  if (kind !== 'repair') return 'maintenance';

  const text = normalizeSearch(`${ticket.reason} ${ticket.description}`);
  if (text.includes('прием') || text.includes('возврат') || text.includes('аренд')) return 'receiving';
  if (text.includes('диагност')) return 'diagnostics';
  return 'repair';
}

function getTicketEquipmentTitle(ticket: ServiceTicket) {
  const equipment = ticket.equipment || '';
  const cleaned = equipment
    .replace(/\s*\(INV:.*?\)\s*/gi, ' ')
    .replace(/\s*·\s*INV.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || equipment || 'Техника не указана';
}

function getTicketInventory(ticket: ServiceTicket) {
  if (ticket.inventoryNumber) return ticket.inventoryNumber;
  const match = (ticket.equipment || '').match(/INV[:\s]*([^)·\s]+)/i);
  return match?.[1] || '—';
}

function equipmentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    available: 'Свободна',
    rented: 'В аренде',
    reserved: 'Бронь',
    in_service: 'В сервисе',
    inactive: 'Списана',
    unknown: 'Нет данных',
  };
  return labels[status] || status || 'Нет данных';
}

function serviceQueueGroupTone(group: string) {
  if (group === 'critical') return 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-200';
  if (group === 'high') return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200';
  if (group === 'waiting_parts') return 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-200';
  if (group === 'revision') return 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-200';
  if (group === 'unassigned') return 'border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-200';
  if (group === 'long_running') return 'border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-200';
  return 'border-gray-200 bg-gray-50 text-gray-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300';
}

function formatTicketDate(value: ServiceTicket['createdAt']) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? formatDate(new Date(timestamp).toISOString()) : '—';
}

function formatShortDate(value?: string) {
  const text = String(value || '').trim();
  if (!text) return '—';
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return '—';
  return new Date(timestamp).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

function getTicketClientName(ticket: ServiceTicket) {
  return ticket.client || '—';
}

function getTicketDueLabel(ticket: ServiceTicket) {
  return ticket.dueDate || ticket.deadline || ticket.targetDate || ticket.plannedDate || ticket.scheduledDate || '';
}

function isTicketOverdue(ticket: ServiceTicket) {
  const due = getTicketDueLabel(ticket);
  if (!due || normalizeServiceStatus(ticket.status) === 'closed') return false;
  return due.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

function ticketResultWorksCount(ticket: ServiceTicket) {
  const resultWorks = ticket.resultData?.worksPerformed;
  if (Array.isArray(resultWorks)) return resultWorks.length;
  const legacyWorks = (ticket as ServiceTicket & { works?: unknown[] }).works;
  return Array.isArray(legacyWorks) ? legacyWorks.length : 0;
}

function ticketResultPartsCount(ticket: ServiceTicket) {
  const resultParts = ticket.resultData?.partsUsed;
  if (Array.isArray(resultParts)) return resultParts.length;
  return Array.isArray(ticket.parts) ? ticket.parts.length : 0;
}

function serviceStatusLabel(status: ServiceTicket['status']) {
  const labels: Record<ServiceTicket['status'], string> = {
    new: 'Новая',
    in_progress: 'В работе',
    waiting_parts: 'Ожидает запчасти',
    needs_revision: 'На доработке',
    ready: 'Готова к выдаче',
    closed: 'Закрыта',
  };
  return labels[normalizeServiceStatus(status)];
}

function servicePriorityLabel(priority: ServiceTicket['priority']) {
  const labels: Record<ServiceTicket['priority'], string> = {
    critical: 'Критический',
    high: 'Высокий',
    medium: 'Средний',
    low: 'Низкий',
  };
  return labels[normalizeServicePriority(priority)];
}

function getServicePriorityPill(priority: ServiceTicket['priority']) {
  const normalized = normalizeServicePriority(priority);
  const className = {
    critical: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
    high: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
    medium: 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300',
    low: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  }[normalized];

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
      {servicePriorityLabel(normalized)}
    </span>
  );
}

function getTicketClientDetails(ticket: ServiceTicket, clientLookup: Map<string, Client>) {
  const client = (ticket.clientId ? clientLookup.get(`id:${ticket.clientId}`) : undefined)
    ?? (ticket.client ? clientLookup.get(`name:${normalizeSearch(ticket.client)}`) : undefined);

  return {
    name: ticket.client || client?.company || '—',
    inn: client?.inn || '',
  };
}

function getTicketRepairTypeLabel(ticket: ServiceTicket) {
  const rawType = normalizeSearch(`${ticket.type || ''} ${ticket.scenario || ''} ${ticket.reason || ''}`);
  if (rawType.includes('гарант')) return 'Гарантийный';
  if (rawType.includes('платн')) return 'Платный';

  const workflowKind = getTicketWorkflowKind(ticket);
  if (workflowKind === 'diagnostics') return 'Диагностика';
  if (workflowKind === 'receiving') return 'Приёмка';
  if (['to', 'chto', 'pto'].includes(inferServiceKind(ticket))) return 'Сервисное ТО';
  return getServiceScenarioLabel(ticket);
}

function getTicketDueMeta(ticket: ServiceTicket) {
  const status = normalizeServiceStatus(ticket.status);
  if (status === 'ready' || status === 'closed') {
    return {
      className: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900',
      hint: status === 'ready' ? 'Готово' : 'Закрыто',
    };
  }
  if (isTicketOverdue(ticket)) {
    return {
      className: 'bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900',
      hint: 'Просрочено',
    };
  }
  if (status === 'waiting_parts' || status === 'needs_revision') {
    return {
      className: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:ring-orange-900',
      hint: status === 'waiting_parts' ? 'Ожидание' : 'Доработка',
    };
  }
  return {
    className: 'bg-gray-50 text-gray-700 ring-1 ring-gray-200 dark:bg-white/[0.04] dark:text-gray-300 dark:ring-white/10',
    hint: 'План',
  };
}

function queueRepairTypeLabel(item: ReturnType<typeof buildServiceQueue>['rows'][number]) {
  const text = normalizeSearch(`${item.reason || ''} ${item.description || ''}`);
  if (text.includes('диагност')) return 'Диагностика';
  if (text.includes('прием') || text.includes('возврат')) return 'Приёмка';
  if (['то', 'ч/то', 'что', 'пто'].some(marker => text === marker || text.includes(` ${marker}`))) return 'Сервисное ТО';
  return 'Ремонт';
}

function queueDueMeta(item: ReturnType<typeof buildServiceQueue>['rows'][number]) {
  if (item.ticketStatus === 'ready') {
    return {
      label: 'Готово',
      className: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900',
    };
  }
  if (item.ageDays >= 7) {
    return {
      label: `${item.ageDays} дн.`,
      className: 'bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900',
    };
  }
  if (item.waitingParts) {
    return {
      label: `${item.ageDays} дн.`,
      className: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:ring-orange-900',
    };
  }
  return {
    label: `${item.ageDays} дн.`,
    className: 'bg-gray-50 text-gray-700 ring-1 ring-gray-200 dark:bg-white/[0.04] dark:text-gray-300 dark:ring-white/10',
  };
}

function queueNextAction(item: ReturnType<typeof buildServiceQueue>['rows'][number]) {
  if (item.unassigned) return 'Назначить мастера';
  if (item.ticketStatus === 'new') return 'Взять в работу';
  if (item.waitingParts) return 'Заказать запчасть';
  if (item.ticketStatus === 'in_progress') return 'Перевести в готово';
  if (item.ticketStatus === 'ready') return 'Открыть выдачу';
  return 'Открыть заявку';
}

function formatRub(value: number) {
  const amount = Number.isFinite(value) ? Math.round(value) : 0;
  return `${amount.toLocaleString('ru-RU')} ₽`;
}

function getTicketMoneyValue(ticket: ServiceTicket, keys: string[]) {
  const source = ticket as ServiceTicket & Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    const numberValue = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) return numberValue;
  }
  return 0;
}

function getTicketActualCost(ticket: ServiceTicket) {
  const worksCost = (ticket.resultData?.worksPerformed ?? [])
    .reduce((sum, work) => sum + (Number.isFinite(work.totalCost) ? work.totalCost : 0), 0);
  const partsCost = (ticket.resultData?.partsUsed ?? ticket.parts ?? [])
    .reduce((sum, part) => {
      const qty = Number.isFinite(part.qty) ? part.qty : 0;
      const cost = Number.isFinite(part.cost) ? part.cost : 0;
      return sum + qty * cost;
    }, 0);

  return worksCost + partsCost;
}

function isCurrentUserAssignedToTicket(ticket: ServiceTicket, user: AuthUser | null) {
  if (!user) return false;
  return [user.id, user.name, user.email]
    .filter(Boolean)
    .some(value => [
      ticket.assignedMechanicId,
      ticket.assignedMechanicName,
      ticket.assignedTo,
      ticket.assignedUserId,
      ticket.responsibleUserId,
    ].filter(Boolean).some(ticketValue => String(ticketValue).trim().toLowerCase() === String(value).trim().toLowerCase()));
}

function ServiceSidePanel({
  ticket,
  clientLookup,
  currentUser,
  canEditService,
  canViewDocuments,
  canCreateDocuments,
  onOpenTicket,
  onClose,
}: {
  ticket: ServiceTicket | null;
  clientLookup: Map<string, Client>;
  currentUser: AuthUser | null;
  canEditService: boolean;
  canViewDocuments: boolean;
  canCreateDocuments: boolean;
  onOpenTicket: (ticketId: string) => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = React.useState<'overview' | 'works' | 'parts' | 'documents' | 'history'>('overview');

  React.useEffect(() => {
    setActiveTab('overview');
  }, [ticket?.id]);

  if (!ticket) {
    return (
      <aside className="hidden rounded-lg border border-dashed border-gray-200 bg-white p-5 text-sm text-gray-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-400 2xl:block">
        Выберите заявку в списке, чтобы увидеть краткий обзор, работы, запчасти, документы и историю.
      </aside>
    );
  }

  const dueLabel = getTicketDueLabel(ticket);
  const worksCount = ticketResultWorksCount(ticket);
  const partsCount = ticketResultPartsCount(ticket);
  const clientDetails = getTicketClientDetails(ticket, clientLookup);
  const assignedMechanic = ticket.assignedMechanicName || ticket.assignedTo || 'Не назначен';
  const responsible = ticket.createdByUserName || ticket.createdBy || '—';
  const repairType = getTicketRepairTypeLabel(ticket);
  const estimateAmount = getTicketMoneyValue(ticket, ['preliminaryEstimate', 'estimatedAmount', 'estimateAmount', 'plannedCost']);
  const agreedAmount = getTicketMoneyValue(ticket, ['agreedAmount', 'approvedAmount', 'approvedCost', 'customerApprovedAmount']);
  const actualCost = getTicketActualCost(ticket);
  const normalizedRole = normalizeUserRole(currentUser?.normalizedRole || currentUser?.role || currentUser?.rawRole);
  const isAdmin = normalizedRole === 'Администратор';
  const isAssigned = isCurrentUserAssignedToTicket(ticket, currentUser);
  const canEditTicketFields = canEditService && (normalizeServiceStatus(ticket.status) !== 'closed' || isAdmin);
  const canAddRepairItems = canEditTicketFields && (isAdmin || (normalizeServiceStatus(ticket.status) === 'needs_revision' && isAssigned));
  const canCloseTicket = canEditService && normalizeServiceStatus(ticket.status) === 'ready';
  const openTicket = () => onOpenTicket(ticket.id);
  const panelTabs = [
    { id: 'overview', label: 'Обзор' },
    { id: 'works', label: 'Работы' },
    { id: 'parts', label: 'Запчасти' },
    { id: 'documents', label: 'Документы' },
    { id: 'history', label: 'История' },
  ] as const;

  return (
    <aside className="rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-4 dark:border-white/10">
        <div className="min-w-0">
          <div className="truncate font-mono text-sm font-bold text-[--color-primary]">Заявка {ticket.id}</div>
          <h3 className="mt-1 truncate text-lg font-black text-gray-900 dark:text-white">{getTicketEquipmentTitle(ticket)}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {getServiceStatusBadge(normalizeServiceStatus(ticket.status))}
            {getServicePriorityBadge(normalizeServicePriority(ticket.priority))}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-white"
          aria-label="Закрыть панель заявки"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-gray-100 px-3 py-2 dark:border-white/10">
        {panelTabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className="app-filter-chip whitespace-nowrap"
            data-active={String(activeTab === tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-4 p-4">
        {activeTab === 'overview' && (
          <>
            <div className="grid gap-3 text-sm">
              <div>
                <p className="text-xs font-bold uppercase text-gray-500">Техника</p>
                <p className="mt-1 font-semibold text-gray-900 dark:text-white">{getTicketEquipmentTitle(ticket)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-3 dark:bg-white/[0.04]">
                <div>
                  <p className="text-xs font-bold uppercase text-gray-500">INV</p>
                  <p className="mt-1 font-mono text-sm text-gray-900 dark:text-white">{getTicketInventory(ticket)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-gray-500">SN</p>
                  <p className="mt-1 font-mono text-sm text-gray-900 dark:text-white">{ticket.serialNumber || '—'}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-bold uppercase text-gray-500">Клиент</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{clientDetails.name}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-gray-500">ИНН</p>
                  <p className="mt-1 font-mono text-sm text-gray-900 dark:text-white">{clientDetails.inn || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-gray-500">Договор / аренда</p>
                  <p className="mt-1 text-sm text-gray-900 dark:text-white">{ticket.contractNumber || ticket.rentalId || ticket.contractId || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-gray-500">Дата заявки</p>
                  <p className="mt-1 text-sm text-gray-900 dark:text-white">{formatTicketDate(ticket.createdAt)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-gray-500">Плановый срок</p>
                  <p className={`mt-1 text-sm font-semibold ${isTicketOverdue(ticket) ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>
                    {dueLabel ? formatShortDate(dueLabel) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-gray-500">Тип ремонта</p>
                  <p className="mt-1 text-sm text-gray-900 dark:text-white">{repairType}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-gray-500">Приоритет</p>
                  <div className="mt-1">{getServicePriorityPill(ticket.priority)}</div>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-gray-500">Статус</p>
                  <div className="mt-1">{getServiceStatusBadge(normalizeServiceStatus(ticket.status))}</div>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-gray-500">Мастер</p>
                  <p className="mt-1 text-sm text-gray-900 dark:text-white">{assignedMechanic}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-gray-500">Ответственный</p>
                  <p className="mt-1 text-sm text-gray-900 dark:text-white">{responsible}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase text-gray-500">Описание проблемы</p>
                <p className="mt-1 line-clamp-5 text-gray-700 dark:text-gray-200">{ticket.description || ticket.reason || '—'}</p>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-gray-100 p-3 dark:border-white/10">
                <div>
                  <p className="text-[11px] font-bold uppercase text-gray-500">Предв. оценка</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{estimateAmount > 0 ? formatRub(estimateAmount) : '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase text-gray-500">Согласовано</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{agreedAmount > 0 ? formatRub(agreedAmount) : '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase text-gray-500">Факт. затраты</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{actualCost > 0 ? formatRub(actualCost) : '—'}</p>
                </div>
              </div>
            </div>

            <div className="grid gap-2">
              {canEditTicketFields && (
                <Button type="button" className="w-full" variant="secondary" onClick={openTicket}>Изменить заявку</Button>
              )}
              {canAddRepairItems && (
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" className="w-full" variant="secondary" onClick={openTicket}>Добавить работу</Button>
                  <Button type="button" className="w-full" variant="secondary" onClick={openTicket}>Заказать запчасть</Button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {canCreateDocuments && (
                  <Button type="button" className="w-full" variant="outline" onClick={openTicket}>Создать документ</Button>
                )}
                {canCloseTicket && (
                  <Button type="button" className="w-full" onClick={openTicket}>Закрыть заявку</Button>
                )}
              </div>
            </div>
            <Button type="button" className="w-full" variant="outline" onClick={openTicket}>Открыть полную карточку</Button>
          </>
        )}

        {activeTab === 'works' && (
          <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600 dark:bg-white/[0.04] dark:text-gray-300">
            <p className="font-semibold text-gray-900 dark:text-white">Работы: {worksCount}</p>
            <p className="mt-1">Подробное добавление и редактирование работ сохранено в полной карточке заявки.</p>
          </div>
        )}

        {activeTab === 'parts' && (
          <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600 dark:bg-white/[0.04] dark:text-gray-300">
            <p className="font-semibold text-gray-900 dark:text-white">Запчасти: {partsCount}</p>
            <p className="mt-1">Списание и подбор запчастей остаются в текущей карточке заявки и MAX-сценариях механика.</p>
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600 dark:bg-white/[0.04] dark:text-gray-300">
            <p className="font-semibold text-gray-900 dark:text-white">Документы</p>
            <p className="mt-1">{canViewDocuments ? 'Заказ-наряд и документы доступны в полной карточке.' : 'Для этой роли документы скрыты правами доступа.'}</p>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-2 text-sm">
            {(ticket.workLog ?? []).slice(-4).reverse().map((entry, index) => (
              <div key={`${entry.date}-${index}`} className="rounded-lg border border-gray-100 p-3 dark:border-white/10">
                <p className="text-gray-900 dark:text-white">{entry.text || 'Событие'}</p>
                <p className="mt-1 text-xs text-gray-500">{entry.author || 'Система'} · {formatTicketDate(entry.date)}</p>
              </div>
            ))}
            {(ticket.workLog ?? []).length === 0 && (
              <p className="rounded-lg bg-gray-50 p-4 text-gray-500 dark:bg-white/[0.04]">История пока пуста.</p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function ServiceMetricCard({
  title,
  value,
  caption,
  tone,
}: {
  title: string;
  value: number;
  caption: string;
  tone: 'lime' | 'blue' | 'green' | 'red' | 'amber' | 'orange' | 'purple' | 'neutral';
}) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const toneClasses = {
    lime: {
      value: 'text-[--color-primary]',
      accent: 'bg-[--color-primary]/20',
    },
    blue: {
      value: 'text-blue-600 dark:text-blue-300',
      accent: 'bg-blue-500/20',
    },
    green: {
      value: 'text-emerald-600 dark:text-emerald-300',
      accent: 'bg-emerald-500/20',
    },
    red: {
      value: 'text-red-600 dark:text-red-300',
      accent: 'bg-red-500/20',
    },
    amber: {
      value: 'text-amber-600 dark:text-amber-300',
      accent: 'bg-amber-500/20',
    },
    orange: {
      value: 'text-orange-600 dark:text-orange-300',
      accent: 'bg-orange-500/20',
    },
    purple: {
      value: 'text-violet-600 dark:text-violet-300',
      accent: 'bg-violet-500/20',
    },
    neutral: {
      value: 'text-gray-900 dark:text-white',
      accent: 'bg-gray-500/10',
    },
  }[tone];

  return (
    <div className="flex min-h-[112px] flex-col justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-bold uppercase text-gray-500 dark:text-gray-500">{title}</div>
        <span className={`h-2.5 w-2.5 rounded-full ${toneClasses.accent}`} aria-hidden="true" />
      </div>
      <div>
        <div className={`mt-2 text-3xl font-black leading-none ${toneClasses.value}`}>{safeValue}</div>
        <div className="mt-2 text-sm text-gray-500 dark:text-gray-500">{caption}</div>
      </div>
    </div>
  );
}

function ServiceQueueTab({
  queue,
  mechanicOptions,
  canViewFinance,
  canViewRentals,
  canViewEquipment,
  canViewClients,
  canEditService,
  canAssignServiceTasks,
  onOpenTicket,
}: {
  queue: ReturnType<typeof buildServiceQueue>;
  mechanicOptions: string[];
  canViewFinance: boolean;
  canViewRentals: boolean;
  canViewEquipment: boolean;
  canViewClients: boolean;
  canEditService: boolean;
  canAssignServiceTasks: boolean;
  onOpenTicket: (ticketId: string) => void;
}) {
  const [search, setSearch] = React.useState('');
  const [priorityFilter, setPriorityFilter] = React.useState('all');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [mechanicFilter, setMechanicFilter] = React.useState('all');
  const [typeFilter, setTypeFilter] = React.useState('all');
  const [dueFilter, setDueFilter] = React.useState('all');

  const repairTypes = React.useMemo(() => (
    Array.from(new Set(queue.rows.map(queueRepairTypeLabel))).sort((left, right) => left.localeCompare(right, 'ru'))
  ), [queue.rows]);

  const queueMetrics = React.useMemo(() => ({
    total: queue.metrics.totalOpen,
    unassigned: queue.metrics.unassigned,
    waitingParts: queue.metrics.waitingParts,
    ready: queue.rows.filter(item => item.ticketStatus === 'ready').length,
    overdue: queue.metrics.olderThan7Days,
  }), [queue.metrics.olderThan7Days, queue.metrics.totalOpen, queue.metrics.unassigned, queue.metrics.waitingParts, queue.rows]);

  const filteredRows = React.useMemo(() => {
    const query = normalizeSearch(search);
    return queue.rows.filter(item => {
      const searchText = normalizeSearch([
        item.ticketId,
        item.equipmentTitle,
        item.model,
        item.serialNumber,
        item.inventoryNumber,
        item.reason,
        item.description,
        item.mechanic,
        item.currentRental?.client,
        item.nextRental?.client,
      ].filter(Boolean).join(' '));
      if (query && !searchText.includes(query)) return false;
      if (priorityFilter !== 'all' && item.ticketPriority !== priorityFilter) return false;
      if (statusFilter !== 'all' && item.ticketStatus !== statusFilter) return false;
      if (mechanicFilter !== 'all' && item.mechanic !== mechanicFilter) return false;
      if (typeFilter !== 'all' && queueRepairTypeLabel(item) !== typeFilter) return false;
      if (dueFilter === 'today' && item.ageDays !== 0) return false;
      if (dueFilter === 'waiting' && !item.waitingParts) return false;
      if (dueFilter === 'overdue' && item.ageDays < 7) return false;
      if (dueFilter === 'ready' && item.ticketStatus !== 'ready') return false;
      return true;
    });
  }, [dueFilter, mechanicFilter, priorityFilter, queue.rows, search, statusFilter, typeFilter]);

  const formatRisk = (amount: number) => new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(amount);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <ServiceMetricCard title="В очереди" value={queueMetrics.total} caption="Открытые заявки" tone="blue" />
        <ServiceMetricCard title="Без мастера" value={queueMetrics.unassigned} caption="Нужно назначить" tone="orange" />
        <ServiceMetricCard title="Ожидают запчасти" value={queueMetrics.waitingParts} caption="Требуют снабжения" tone="purple" />
        <ServiceMetricCard title="Готовы к выдаче" value={queueMetrics.ready} caption="Можно закрывать" tone="green" />
        <ServiceMetricCard title="Просрочено" value={queueMetrics.overdue} caption="7+ дней в очереди" tone="red" />
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.4fr)_repeat(5,minmax(140px,1fr))]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Модель, SN, INV, клиент..."
              className="pl-10"
            />
          </div>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger><SelectValue placeholder="Приоритет" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все приоритеты</SelectItem>
              <SelectItem value="critical">Критический</SelectItem>
              <SelectItem value="high">Высокий</SelectItem>
              <SelectItem value="medium">Средний</SelectItem>
              <SelectItem value="low">Низкий</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue placeholder="Статус" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="new">Новая</SelectItem>
              <SelectItem value="in_progress">В работе</SelectItem>
              <SelectItem value="waiting_parts">Ожидание запчастей</SelectItem>
              <SelectItem value="needs_revision">На доработке</SelectItem>
              <SelectItem value="ready">Готово</SelectItem>
            </SelectContent>
          </Select>
          <Select value={mechanicFilter} onValueChange={setMechanicFilter}>
            <SelectTrigger><SelectValue placeholder="Механик" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все механики</SelectItem>
              <SelectItem value="Не назначен">Не назначен</SelectItem>
              {mechanicOptions.map(mechanic => (
                <SelectItem key={mechanic} value={mechanic}>{mechanic}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger><SelectValue placeholder="Тип ремонта" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все типы</SelectItem>
              {repairTypes.map(type => (
                <SelectItem key={type} value={type}>{type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={dueFilter} onValueChange={setDueFilter}>
            <SelectTrigger><SelectValue placeholder="Срок" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все сроки</SelectItem>
              <SelectItem value="today">Новые сегодня</SelectItem>
              <SelectItem value="waiting">Ожидание</SelectItem>
              <SelectItem value="ready">Готово к выдаче</SelectItem>
              <SelectItem value="overdue">Просрочено</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      {filteredRows.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white py-14 text-center dark:border-white/10 dark:bg-white/[0.03]">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">Открытых сервисных задач нет</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Или текущие фильтры скрыли все позиции очереди.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-white/[0.03]">
          <div className="hidden grid-cols-[minmax(120px,0.7fr)_minmax(180px,1fr)_minmax(220px,1.2fr)_120px_110px_minmax(130px,0.7fr)_95px_minmax(160px,0.8fr)_minmax(170px,0.9fr)] gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 text-xs font-bold uppercase text-gray-500 dark:border-white/10 dark:bg-white/[0.04] 2xl:grid">
            <div>Заявка</div>
            <div>Техника</div>
            <div>Причина в очереди</div>
            <div>Статус</div>
            <div>Приоритет</div>
            <div>Мастер</div>
            <div>Срок</div>
            <div>Следующее действие</div>
            <div></div>
          </div>
          {filteredRows.map(item => {
            const dueMeta = queueDueMeta(item);
            const nextAction = queueNextAction(item);
            const canRunNextAction = nextAction !== 'Открыть заявку'
              && (nextAction === 'Назначить мастера' ? canAssignServiceTasks : canEditService);
            return (
              <article
                key={item.ticketId}
                className="grid gap-3 border-b border-gray-100 px-4 py-4 last:border-b-0 dark:border-white/6 2xl:grid-cols-[minmax(120px,0.7fr)_minmax(180px,1fr)_minmax(220px,1.2fr)_120px_110px_minmax(130px,0.7fr)_95px_minmax(160px,0.8fr)_minmax(170px,0.9fr)] 2xl:items-center"
              >
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onOpenTicket(item.ticketId)}
                    className="font-mono text-sm font-bold text-[--color-primary] hover:underline"
                    aria-label={`Открыть заявку ${item.ticketId}`}
                  >
                    {item.ticketId}
                  </button>
                  <div className="mt-1 text-xs text-gray-500">{item.createdAt ? formatDate(item.createdAt) : '—'} · score {item.score}</div>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-gray-900 dark:text-white">{item.equipmentTitle}</div>
                  <div className="mt-0.5 truncate font-mono text-xs text-gray-500">
                    INV: {item.inventoryNumber || '—'} · SN: {item.serialNumber || '—'}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">{equipmentStatusLabel(item.equipmentStatus)}</div>
                </div>
                <div className="min-w-0">
                  <div className={`mb-2 inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${serviceQueueGroupTone(item.group)}`}>
                    {item.groupLabel}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(item.scoreReasons.length ? item.scoreReasons : ['без дополнительных факторов']).slice(0, 2).map(reason => (
                      <span key={reason} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-white/8 dark:text-gray-300">{reason}</span>
                    ))}
                    {item.redFlags.slice(0, 2).map(flag => (
                      <span key={flag} className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-500/15 dark:text-red-200">{flag}</span>
                    ))}
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-gray-600 dark:text-gray-300">{item.reason}</p>
                </div>
                <div>{getServiceStatusBadge(item.ticketStatus)}</div>
                <div>{getServicePriorityPill(item.ticketPriority)}</div>
                <div className="text-sm font-medium text-gray-700 dark:text-gray-200">{item.mechanic}</div>
                <div>
                  <span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${dueMeta.className}`}>{dueMeta.label}</span>
                </div>
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{nextAction}</div>
                <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
                  {canRunNextAction && (
                    <Button type="button" size="sm" variant="secondary" onClick={() => onOpenTicket(item.ticketId)}>{nextAction}</Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant={canRunNextAction ? 'outline' : 'secondary'}
                    onClick={() => onOpenTicket(item.ticketId)}
                  >
                    Открыть заявку
                  </Button>
                  {canViewEquipment && item.equipmentId && (
                    <Link to={`/equipment/${item.equipmentId}`}>
                      <Button size="sm" variant="outline">Техника</Button>
                    </Link>
                  )}
                  {canViewRentals && item.currentRental && (
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-white/8 dark:text-gray-300">
                      {canViewClients ? item.currentRental.client : 'Клиент скрыт'}
                    </span>
                  )}
                  {canViewRentals && item.nextRental && (
                    <span className="rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-700 dark:bg-blue-500/15 dark:text-blue-200">
                      Аренда {item.nextRental.startDate ? formatDate(item.nextRental.startDate) : '—'}
                    </span>
                  )}
                  {canViewFinance && item.revenueRisk && (
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                      Риск {formatRisk(item.revenueRisk.amount)}
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ServiceTicketCardModal({
  ticketId,
  onClose,
}: {
  ticketId: string | null;
  onClose: () => void;
}) {
  React.useEffect(() => {
    if (!ticketId) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, ticketId]);

  if (!ticketId) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-950/55 p-2 backdrop-blur-[3px] sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Карточка сервисной заявки ${ticketId}`}
        className="min-h-0 w-full max-w-7xl overflow-hidden rounded-xl border border-gray-200 bg-gray-50 shadow-2xl dark:border-white/10 dark:bg-gray-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="h-full max-h-[calc(100vh-1rem)] overflow-y-auto sm:max-h-[calc(100vh-2rem)]">
          <ServiceDetail ticketId={ticketId} embedded onClose={onClose} />
        </div>
      </section>
    </div>
  );
}

export default function Service() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const ticketsQuery = useServiceTicketsList();
  const ticketList = React.useMemo(
    () => (ticketsQuery.data ?? []).filter(isRegularServiceTicket),
    [ticketsQuery.data],
  );
  const canManageWarrantyClaims = can('edit', 'service');
  const canViewEquipment = can('view', 'equipment');
  const canViewRentals = can('view', 'rentals');
  const canViewClients = can('view', 'clients');
  const canViewFinance = can('view', 'finance');
  const canViewDocuments = can('view', 'documents');
  const normalizedRole = normalizeUserRole(user?.role);
  const showDayPlan = canViewServiceDayPlan(normalizedRole);
  const canManageDayPlan = canManageServiceDayPlan(normalizedRole);
  const [search, setSearch] = React.useState('');
  const [priorityFilter, setPriorityFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [scenarioFilter, setScenarioFilter] = React.useState<string>('all');
  const [mechanicFilter, setMechanicFilter] = React.useState<string>('all');
  const [workflowFilter, setWorkflowFilter] = React.useState<ServiceWorkflowFilter>('all');
  const [preset, setPreset] = React.useState<'all' | 'unassigned' | 'urgent' | 'waiting_parts' | 'needs_revision' | 'maintenance'>('all');
  const [datePreset, setDatePreset] = React.useState<'all' | 'today' | 'last7' | 'month'>('all');
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo, setDateTo] = React.useState('');
  const [showFilters, setShowFilters] = React.useState(false);
  const [visibleCount, setVisibleCount] = React.useState(RESULT_BATCH_SIZE);
  const [viewMode, setViewMode] = React.useState<'list' | 'kanban'>('list');
  const [selectedTicketId, setSelectedTicketId] = React.useState<string | null>(null);
  const [openTicketId, setOpenTicketId] = React.useState<string | null>(null);

  const openTicketCard = React.useCallback((ticketId: string) => {
    setSelectedTicketId(ticketId);
    setOpenTicketId(ticketId);
  }, []);

  const closeTicketCard = React.useCallback(() => {
    setOpenTicketId(null);
  }, []);

  const { data: equipmentList = [] } = useQuery({
    queryKey: ['equipment', 'service-queue'],
    queryFn: equipmentService.getAll,
    enabled: canViewEquipment,
    staleTime: 1000 * 60 * 2,
  });
  const { data: ganttRentals = [] } = useQuery({
    queryKey: ['ganttRentals', 'service-queue'],
    queryFn: rentalsService.getGanttData,
    enabled: canViewRentals,
    staleTime: 1000 * 60 * 2,
  });
  const { data: clients = [] } = useQuery({
    queryKey: ['clients', 'service-queue'],
    queryFn: clientsService.getAll,
    enabled: canViewClients,
    staleTime: 1000 * 60 * 2,
  });
  const mechanicsQuery = useQuery<Mechanic[]>({
    queryKey: ['mechanics', 'service-day-plan'],
    queryFn: mechanicsService.getAll,
    enabled: showDayPlan,
    staleTime: 1000 * 60 * 2,
  });

  const todayIso = React.useMemo(() => new Date().toISOString().slice(0, 10), []);
  const monthStartIso = React.useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  }, []);
  const last7StartIso = React.useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    return start.toISOString().slice(0, 10);
  }, []);

  const mechanicOptions = React.useMemo(() => (
    Array.from(new Set(
      ticketList
        .map(ticket => ticket.assignedMechanicName || ticket.assignedTo || '')
        .map(value => value.trim())
        .filter(Boolean),
    )).sort((left, right) => left.localeCompare(right, 'ru'))
  ), [ticketList]);

  const clientLookup = React.useMemo(() => {
    const lookup = new Map<string, Client>();
    clients.forEach(client => {
      lookup.set(`id:${client.id}`, client);
      if (client.company) lookup.set(`name:${normalizeSearch(client.company)}`, client);
    });
    return lookup;
  }, [clients]);

  const activeTickets = React.useMemo(
    () => ticketList.filter(isActiveTicket),
    [ticketList],
  );

  const workflowCounts = React.useMemo(() => (
    WORKFLOW_FILTER_OPTIONS.reduce<Record<ServiceWorkflowFilter, number>>((acc, option) => {
      acc[option.value] = option.value === 'all'
        ? activeTickets.length
        : activeTickets.filter(ticket => getTicketWorkflowKind(ticket) === option.value).length;
      return acc;
    }, { all: 0, repair: 0, diagnostics: 0, receiving: 0 })
  ), [activeTickets]);

  const metrics = React.useMemo(() => ({
    total: activeTickets.length,
    inProgress: activeTickets.filter(ticket => normalizeServiceStatus(ticket.status) === 'in_progress').length,
    waitingParts: activeTickets.filter(ticket => normalizeServiceStatus(ticket.status) === 'waiting_parts').length,
    ready: activeTickets.filter(ticket => normalizeServiceStatus(ticket.status) === 'ready').length,
    overdue: activeTickets.filter(isTicketOverdue).length,
  }), [activeTickets]);

  const serviceQueue = React.useMemo(() => buildServiceQueue({
    serviceTickets: ticketList,
    equipment: canViewEquipment ? equipmentList : [],
    rentals: canViewRentals ? ganttRentals : [],
    clients: canViewClients ? clients : [],
    canViewFinance,
  }), [canViewClients, canViewEquipment, canViewFinance, canViewRentals, clients, equipmentList, ganttRentals, ticketList]);

  const filteredTickets = React.useMemo(() => {
    const query = normalizeSearch(search);
    const effectiveDateFrom = dateFrom || (
      datePreset === 'today'
        ? todayIso
        : datePreset === 'last7'
          ? last7StartIso
          : datePreset === 'month'
            ? monthStartIso
            : ''
    );
    const effectiveDateTo = dateTo || (datePreset === 'all' ? '' : todayIso);

    return ticketList
      .filter(ticket => {
        const matchesSearch = query === '' || getTicketSearchText(ticket).includes(query);
        const ticketPriority = normalizeServicePriority(ticket.priority);
        const ticketStatus = normalizeServiceStatus(ticket.status);
        const matchesPriority = priorityFilter === 'all' || ticketPriority === priorityFilter;
        const matchesStatus = statusFilter === 'all' || ticketStatus === statusFilter;
        const matchesScenario = scenarioFilter === 'all' || inferServiceKind(ticket) === scenarioFilter;
        const assignedMechanic = ticket.assignedMechanicName || ticket.assignedTo || '';
        const matchesMechanic = mechanicFilter === 'all' || assignedMechanic === mechanicFilter;
        const matchesWorkflow = workflowFilter === 'all' || getTicketWorkflowKind(ticket) === workflowFilter;
        const createdDate = typeof ticket.createdAt === 'string' ? ticket.createdAt.slice(0, 10) : '';
        const matchesDate =
          (!effectiveDateFrom || (createdDate && createdDate >= effectiveDateFrom))
          && (!effectiveDateTo || (createdDate && createdDate <= effectiveDateTo));
        const matchesPreset =
          preset === 'all'
          || (preset === 'unassigned' && !ticket.assignedMechanicId && !ticket.assignedTo)
          || (preset === 'urgent' && ['high', 'critical'].includes(ticketPriority))
          || (preset === 'waiting_parts' && ticketStatus === 'waiting_parts')
          || (preset === 'needs_revision' && ticketStatus === 'needs_revision')
          || (preset === 'maintenance' && ['to', 'chto', 'pto'].includes(inferServiceKind(ticket)));

        return matchesSearch && matchesPriority && matchesStatus && matchesScenario && matchesMechanic && matchesWorkflow && matchesDate && matchesPreset;
      })
      .sort((left, right) => (
        (SERVICE_STATUS_ORDER[normalizeServiceStatus(left.status)] ?? 99) - (SERVICE_STATUS_ORDER[normalizeServiceStatus(right.status)] ?? 99)
        || (SERVICE_PRIORITY_ORDER[normalizeServicePriority(left.priority)] ?? 99) - (SERVICE_PRIORITY_ORDER[normalizeServicePriority(right.priority)] ?? 99)
        || String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
      ));
  }, [
    dateFrom,
    datePreset,
    dateTo,
    last7StartIso,
    mechanicFilter,
    monthStartIso,
    preset,
    priorityFilter,
    scenarioFilter,
    search,
    statusFilter,
    ticketList,
    todayIso,
    workflowFilter,
  ]);

  React.useEffect(() => {
    setVisibleCount(RESULT_BATCH_SIZE);
  }, [search, priorityFilter, statusFilter, scenarioFilter, mechanicFilter, workflowFilter, preset, datePreset, dateFrom, dateTo]);

  const visibleTickets = filteredTickets.slice(0, visibleCount);
  const selectedTicket = React.useMemo(() => (
    selectedTicketId
      ? filteredTickets.find(ticket => ticket.id === selectedTicketId) ?? null
      : null
  ), [filteredTickets, selectedTicketId]);

  const presetOptions = [
    { value: 'all', label: 'Все' },
    { value: 'unassigned', label: 'Без механика' },
    { value: 'urgent', label: 'Срочные' },
    { value: 'waiting_parts', label: 'Ждут запчасти' },
    { value: 'needs_revision', label: 'На доработке' },
    { value: 'maintenance', label: 'ТО / ЧТО / ПТО' },
  ] as const;

  const datePresetOptions = [
    { value: 'all', label: 'Все даты' },
    { value: 'today', label: 'Сегодня' },
    { value: 'last7', label: '7 дней' },
    { value: 'month', label: 'Этот месяц' },
  ] as const;

  const resetFilters = () => {
    setSearch('');
    setPriorityFilter('all');
    setStatusFilter('all');
    setScenarioFilter('all');
    setMechanicFilter('all');
    setWorkflowFilter('all');
    setPreset('all');
    setDatePreset('all');
    setDateFrom('');
    setDateTo('');
  };

  const activeFilterCount = [
    search.trim() !== '',
    priorityFilter !== 'all',
    statusFilter !== 'all',
    scenarioFilter !== 'all',
    mechanicFilter !== 'all',
    workflowFilter !== 'all',
    preset !== 'all',
    datePreset !== 'all',
    dateFrom !== '',
    dateTo !== '',
  ].filter(Boolean).length;

  return (
    <div className="space-y-5 p-4 sm:p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Сервис</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Сервисные заявки и гарантийные рекламации</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('create', 'service') && (
            <Link to="/service/new">
              <Button size="sm">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Новая заявка</span>
                <span className="sm:hidden">Создать</span>
              </Button>
            </Link>
          )}
        </div>
      </div>

      {ticketsQuery.error && (
        <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-100">
          <div className="font-semibold">Не удалось загрузить сервисные заявки. Попробуйте обновить страницу или обратитесь к администратору.</div>
          <div className="mt-1 text-red-700/80 dark:text-red-100/80">
            {apiErrorMessage(ticketsQuery.error, 'Проверьте доступ к GET /api/service.')}
          </div>
          {isWarrantyMechanicRole(user?.role) && (
            <div className="mt-2 text-red-700/80 dark:text-red-100/80">
              Для диагностики под этим пользователем откройте в Network `GET /api/access-diagnostics`.
            </div>
          )}
        </section>
      )}

      <FilterDialog
        open={showFilters}
        onOpenChange={setShowFilters}
        title="Фильтры сервиса"
        description="Отбери заявки по поиску, режиму, дате, приоритету, статусу, сценарию и механику."
        onReset={resetFilters}
      >
        <div className="space-y-5">
          <FilterField label="Быстрый режим">
            <div className="flex flex-wrap gap-2">
              {presetOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPreset(option.value)}
                  className="app-filter-chip"
                  data-active={String(preset === option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </FilterField>

          <FilterField label="Период">
            <div className="flex flex-wrap gap-2">
              {datePresetOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDatePreset(option.value)}
                  className="app-filter-chip"
                  data-active={String(datePreset === option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </FilterField>

          <div className="grid gap-4 md:grid-cols-2">
            <FilterField label="Поиск" className="md:col-span-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Поиск по ID, технике, причине..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="app-filter-input pl-10"
                />
              </div>
            </FilterField>
            <FilterField label="Дата с">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="app-filter-input"
              />
            </FilterField>
            <FilterField label="Дата по">
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="app-filter-input"
              />
            </FilterField>
            <FilterField label="Приоритет">
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="app-filter-input">
                  <SelectValue placeholder="Все приоритеты" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все приоритеты</SelectItem>
                  <SelectItem value="low">Низкий</SelectItem>
                  <SelectItem value="medium">Средний</SelectItem>
                  <SelectItem value="high">Высокий</SelectItem>
                  <SelectItem value="critical">Критический</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Статус">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="app-filter-input">
                  <SelectValue placeholder="Все статусы" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все статусы</SelectItem>
                  <SelectItem value="new">Новый</SelectItem>
                  <SelectItem value="in_progress">В работе</SelectItem>
                  <SelectItem value="waiting_parts">Ожидание запчастей</SelectItem>
                  <SelectItem value="needs_revision">На доработке</SelectItem>
                  <SelectItem value="ready">Готово</SelectItem>
                  <SelectItem value="closed">Закрыто</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Сценарий">
              <Select value={scenarioFilter} onValueChange={setScenarioFilter}>
                <SelectTrigger className="app-filter-input">
                  <SelectValue placeholder="Все сценарии" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все сценарии</SelectItem>
                  <SelectItem value="repair">Ремонт</SelectItem>
                  <SelectItem value="to">ТО</SelectItem>
                  <SelectItem value="chto">ЧТО</SelectItem>
                  <SelectItem value="pto">ПТО</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Механик">
              <Select value={mechanicFilter} onValueChange={setMechanicFilter}>
                <SelectTrigger className="app-filter-input">
                  <SelectValue placeholder="Все механики" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все механики</SelectItem>
                  {mechanicOptions.map(mechanic => (
                    <SelectItem key={mechanic} value={mechanic}>
                      {mechanic}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </div>
      </FilterDialog>

      <Tabs defaultValue="tickets" className="space-y-5">
        <TabsList className="h-auto w-full justify-start gap-8 overflow-x-auto rounded-none border-b border-gray-200 bg-transparent p-0 dark:border-white/10">
          <TabsTrigger
            value="tickets"
            className="flex-none rounded-none border-0 border-b-4 border-transparent bg-transparent px-0 pb-4 pt-0 text-xl font-black text-gray-500 data-[state=active]:border-[--color-primary] data-[state=active]:bg-transparent data-[state=active]:text-[--color-primary] dark:data-[state=active]:bg-transparent"
          >
            Заявки
          </TabsTrigger>
          <TabsTrigger
            value="queue"
            className="flex-none rounded-none border-0 border-b-4 border-transparent bg-transparent px-0 pb-4 pt-0 text-xl font-black text-gray-500 data-[state=active]:border-[--color-primary] data-[state=active]:bg-transparent data-[state=active]:text-[--color-primary] dark:data-[state=active]:bg-transparent"
          >
            Очередь сервиса
          </TabsTrigger>
          {showDayPlan && (
            <TabsTrigger
              value="day-plan"
              className="flex-none rounded-none border-0 border-b-4 border-transparent bg-transparent px-0 pb-4 pt-0 text-xl font-black text-gray-500 data-[state=active]:border-[--color-primary] data-[state=active]:bg-transparent data-[state=active]:text-[--color-primary] dark:data-[state=active]:bg-transparent"
            >
              План дня
            </TabsTrigger>
          )}
          {canManageWarrantyClaims && (
            <TabsTrigger
              value="warranty"
              className="flex-none rounded-none border-0 border-b-4 border-transparent bg-transparent px-0 pb-4 pt-0 text-xl font-black text-gray-500 data-[state=active]:border-[--color-primary] data-[state=active]:bg-transparent data-[state=active]:text-[--color-primary] dark:data-[state=active]:bg-transparent"
            >
              Рекламации
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="tickets" className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <ServiceMetricCard title="Всего заявок" value={metrics.total} caption="Активных сейчас" tone="blue" />
            <ServiceMetricCard title="В работе" value={metrics.inProgress} caption="У механиков" tone="orange" />
            <ServiceMetricCard title="Ожидают запчасти" value={metrics.waitingParts} caption="Требуют снабжения" tone="purple" />
            <ServiceMetricCard title="Готовы к выдаче" value={metrics.ready} caption="Можно закрывать/выдавать" tone="green" />
            <ServiceMetricCard title="Просрочено" value={metrics.overdue} caption="Нарушен срок" tone="red" />
          </div>

          <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-[minmax(240px,1.4fr)_repeat(4,minmax(120px,1fr))_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="№ заявки, техника, клиент, проблема..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-11 pl-10"
                />
              </div>
              <Select value={datePreset} onValueChange={(value) => setDatePreset(value as typeof datePreset)}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Период" /></SelectTrigger>
                <SelectContent>
                  {datePresetOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Статус" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все статусы</SelectItem>
                  <SelectItem value="new">Новая</SelectItem>
                  <SelectItem value="in_progress">В работе</SelectItem>
                  <SelectItem value="waiting_parts">Ожидает запчасти</SelectItem>
                  <SelectItem value="needs_revision">На доработке</SelectItem>
                  <SelectItem value="ready">Готова к выдаче</SelectItem>
                  <SelectItem value="closed">Закрыта</SelectItem>
                </SelectContent>
              </Select>
              <Select value={scenarioFilter} onValueChange={setScenarioFilter}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Тип ремонта" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все типы</SelectItem>
                  <SelectItem value="repair">Ремонт</SelectItem>
                  <SelectItem value="to">ТО</SelectItem>
                  <SelectItem value="chto">ЧТО</SelectItem>
                  <SelectItem value="pto">ПТО</SelectItem>
                </SelectContent>
              </Select>
              <Select value={mechanicFilter} onValueChange={setMechanicFilter}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Мастер" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все мастера</SelectItem>
                  {mechanicOptions.map(mechanic => (
                    <SelectItem key={mechanic} value={mechanic}>{mechanic}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="secondary" className="h-11" onClick={resetFilters}>
                Сбросить
              </Button>
            </div>
          </section>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {WORKFLOW_FILTER_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setWorkflowFilter(option.value)}
                  className="app-filter-chip"
                  data-active={String(workflowFilter === option.value)}
                >
                  {option.label}
                  <span className="ml-2 text-xs opacity-70">{workflowCounts[option.value]}</span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 dark:border-white/10 dark:bg-white/[0.03]">
                <button type="button" onClick={() => setViewMode('list')} className="app-filter-chip" data-active={String(viewMode === 'list')}>Список</button>
                <button type="button" onClick={() => setViewMode('kanban')} className="app-filter-chip" data-active={String(viewMode === 'kanban')}>Канбан</button>
              </div>
              <FilterButton
                activeCount={activeFilterCount}
                onClick={() => setShowFilters(true)}
                className="h-11 rounded-lg px-5 text-sm font-bold"
              />
            </div>
          </div>

          <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-4">
              {viewMode === 'kanban' ? (
                <div className="grid gap-3 lg:grid-cols-3">
                  {SERVICE_STATUSES.filter(status => status !== 'closed').map(status => {
                    const columnTickets = visibleTickets.filter(ticket => normalizeServiceStatus(ticket.status) === status);
                    return (
                      <section key={status} className="rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-white/[0.03]">
                        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-white/10">
                          <h3 className="text-sm font-black text-gray-900 dark:text-white">{serviceStatusLabel(status)}</h3>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500 dark:bg-white/8">{columnTickets.length}</span>
                        </div>
                        <div className="space-y-2 p-3">
                          {columnTickets.slice(0, 8).map(ticket => (
                            <button
                              key={ticket.id}
                              type="button"
                              onClick={() => openTicketCard(ticket.id)}
                              className={`w-full rounded-lg border p-3 text-left transition hover:border-[--color-primary]/50 ${
                                selectedTicket?.id === ticket.id
                                  ? 'border-[--color-primary] bg-[--color-primary]/10'
                                  : 'border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/[0.04]'
                              }`}
                            >
                              <div className="font-mono text-xs font-bold text-[--color-primary]">{ticket.id}</div>
                              <div className="mt-1 truncate text-sm font-semibold text-gray-900 dark:text-white">{getTicketEquipmentTitle(ticket)}</div>
                              <div className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{ticket.reason || 'Без описания'}</div>
                            </button>
                          ))}
                          {columnTickets.length === 0 && <p className="py-4 text-center text-sm text-gray-400">Нет заявок</p>}
                        </div>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="hidden grid-cols-[32px_minmax(170px,0.9fr)_110px_minmax(220px,1fr)_minmax(180px,0.8fr)] gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 text-xs font-bold uppercase text-gray-500 dark:border-white/10 dark:bg-white/[0.04] lg:grid">
                    <div></div>
                    <div>№ заявки / дата</div>
                    <div>Статус</div>
                    <div>Техника</div>
                    <div>Клиент / проблема</div>
                  </div>
                  {visibleTickets.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-14 text-center">
                      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 dark:bg-white/8">
                        <Search className="h-7 w-7 text-gray-400 dark:text-gray-500" />
                      </div>
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white">Заявки не найдены</h3>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Попробуйте изменить параметры поиска или фильтры
                      </p>
                    </div>
                  ) : (
                    visibleTickets.map((ticket, index) => {
                      const inventory = getTicketInventory(ticket);
                      const serialNumber = ticket.serialNumber || '';
                      const clientDetails = getTicketClientDetails(ticket, clientLookup);
                      const assignedMechanic = ticket.assignedMechanicName || ticket.assignedTo || '';
                      const description = ticket.description ? truncateText(ticket.description, 90) : '';
                      const dueLabel = getTicketDueLabel(ticket);
                      const dueMeta = getTicketDueMeta(ticket);
                      const repairType = getTicketRepairTypeLabel(ticket);
                      const isSelected = selectedTicket?.id === ticket.id;
                      const openTicket = () => openTicketCard(ticket.id);

                      return (
                        <div
                          key={ticket.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`Открыть заявку ${ticket.id}`}
                          onClick={openTicket}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openTicket();
                            }
                          }}
                          className={`grid cursor-pointer gap-3 border-b border-gray-100 px-4 py-3 transition-colors last:border-b-0 hover:bg-[--color-primary]/5 dark:border-white/6 md:grid-cols-[32px_minmax(170px,0.9fr)_110px_minmax(220px,1fr)] lg:grid-cols-[32px_minmax(180px,0.9fr)_115px_minmax(220px,1fr)_minmax(180px,0.8fr)] lg:items-start ${
                            isSelected
                              ? 'bg-[--color-primary]/10'
                              : index % 2 === 0 ? 'bg-gray-50/60 dark:bg-white/[0.015]' : 'bg-white dark:bg-transparent'
                          }`}
                        >
                          <div onClick={(event) => event.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`Выбрать заявку ${ticket.id}`}
                              checked={isSelected}
                              onChange={(event) => setSelectedTicketId(event.target.checked ? ticket.id : null)}
                              className="h-4 w-4 rounded border-gray-300 text-[--color-primary] focus:ring-[--color-primary]"
                            />
                          </div>
                          <div className="min-w-0 text-left">
                            <div className="truncate font-mono text-sm font-bold text-[--color-primary]">{ticket.id}</div>
                            <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">{formatTicketDate(ticket.createdAt)}</div>
                          </div>
                          <div>{getServiceStatusBadge(normalizeServiceStatus(ticket.status))}</div>
                          <div className="min-w-0 text-left">
                            <div className="truncate text-sm font-bold text-gray-900 dark:text-white">{getTicketEquipmentTitle(ticket)}</div>
                            <div className="mt-0.5 truncate font-mono text-xs text-gray-500">
                              INV: {inventory}{serialNumber ? ` · SN: ${serialNumber}` : ''}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{clientDetails.name}</div>
                            <div className="mt-0.5 truncate text-xs text-gray-500">{clientDetails.inn ? `ИНН ${clientDetails.inn}` : 'ИНН не указан'}</div>
                          </div>
                          <div className="min-w-0 text-left">
                            <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{ticket.reason || '—'}</div>
                            {description && <div className="mt-0.5 truncate text-xs text-gray-500">{description}</div>}
                          </div>
                          <div className="min-w-0 truncate text-sm text-gray-600 dark:text-gray-300">{assignedMechanic || 'Не назначен'}</div>
                          <div>
                            <span className={`inline-flex flex-col rounded-lg px-2.5 py-1 text-xs font-semibold ${dueMeta.className}`}>
                              <span>{dueLabel ? formatShortDate(dueLabel) : '—'}</span>
                              <span className="font-medium opacity-75">{dueMeta.hint}</span>
                            </span>
                          </div>
                          <div className="text-sm font-medium text-gray-600 dark:text-gray-300">{repairType}</div>
                          <div>{getServicePriorityPill(ticket.priority)}</div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openTicket();
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[--color-primary] dark:hover:bg-white/10"
                            title="Открыть полную карточку"
                            aria-label={`Открыть полную карточку заявки ${ticket.id}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            <ServiceSidePanel
              ticket={selectedTicket}
              clientLookup={clientLookup}
              currentUser={user}
              canEditService={can('edit', 'service')}
              canViewDocuments={canViewDocuments}
              canCreateDocuments={can('create', 'documents')}
              onOpenTicket={openTicketCard}
              onClose={() => setSelectedTicketId(null)}
            />
          </div>

          {filteredTickets.length > 0 && (
            <div className="flex flex-col gap-3 text-sm text-gray-500 dark:text-gray-400 sm:flex-row sm:items-center sm:justify-between">
              <p>Показано {visibleTickets.length} из {filteredTickets.length} заявок</p>
              {visibleTickets.length < filteredTickets.length && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setVisibleCount(count => count + RESULT_BATCH_SIZE)}
                  className="w-full rounded-full sm:w-auto"
                >
                  <ArrowDown className="h-4 w-4" />
                  Показать ещё
                </Button>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="queue" className="space-y-5">
          <ServiceQueueTab
            queue={serviceQueue}
            mechanicOptions={mechanicOptions}
            canViewFinance={canViewFinance}
            canViewRentals={canViewRentals}
            canViewEquipment={canViewEquipment}
            canViewClients={canViewClients}
            canEditService={can('edit', 'service')}
            canAssignServiceTasks={can('edit', 'service') && canManageDayPlan}
            onOpenTicket={openTicketCard}
          />
        </TabsContent>

        {showDayPlan && (
          <TabsContent value="day-plan" className="space-y-5">
            <ServiceDayPlanBoard
              tickets={ticketList}
              mechanics={mechanicsQuery.data ?? []}
              isLoading={ticketsQuery.isFetching || mechanicsQuery.isFetching}
              canCreateService={can('create', 'service')}
              canEditService={can('edit', 'service')}
              canManageDayPlan={canManageDayPlan}
              onOpenTicket={openTicketCard}
              onRefresh={() => {
                void ticketsQuery.refetch();
                void mechanicsQuery.refetch();
              }}
            />
            {!canManageDayPlan && !isMechanicRole(normalizedRole) && (
              <p className="text-xs text-gray-500 dark:text-gray-500">
                Быстрые изменения скрыты: для этой роли доступен только просмотр сервисного плана.
              </p>
            )}
          </TabsContent>
        )}

        {canManageWarrantyClaims && (
          <TabsContent value="warranty">
            <WarrantyClaimsTab
              tickets={ticketList}
              canEdit={canManageWarrantyClaims}
              canDelete={can('delete', 'service')}
              canCreateDocuments={can('create', 'documents')}
              onOpenTicket={openTicketCard}
            />
          </TabsContent>
        )}
      </Tabs>
      <ServiceTicketCardModal ticketId={openTicketId} onClose={closeTicketCard} />
    </div>
  );
}
