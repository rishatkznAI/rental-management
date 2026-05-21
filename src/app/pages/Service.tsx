import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Filter,
  ImageIcon,
  MoreHorizontal,
  PackageSearch,
  Plus,
  Search,
  ShieldAlert,
  UserRound,
  Wrench,
} from 'lucide-react';
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
import { AuthenticatedImage } from '../components/ui/AuthenticatedImage';
import { ServiceDayPlanBoard } from '../components/service/ServiceDayPlanBoard';
import { WarrantyClaimsTab } from '../components/service/WarrantyClaimsTab';
import ServiceDetail from './ServiceDetail';
import { useAuth } from '../contexts/AuthContext';
import { canManageServiceDayPlan, canViewServiceDayPlan, usePermissions } from '../lib/permissions';
import { isMechanicRole, isWarrantyMechanicRole, normalizeUserRole } from '../lib/userStorage';
import { usePaginatedServiceTickets } from '../hooks/useServiceTickets';
import { formatDate } from '../lib/utils';
import { normalizePhotoForDisplay, type NormalizedPhoto } from '../lib/media';
import type { Client, Mechanic, ServiceTicket } from '../types';
import { getServiceScenarioLabel, inferServiceKind } from '../lib/serviceScenarios';
import { buildServiceQueue } from '../lib/serviceQueue';
import { isActiveServiceTicket, isArchivedServiceTicket, isRegularServiceTicket } from '../lib/serviceTicketKind.js';
import { equipmentService } from '../services/equipment.service';
import { rentalsService } from '../services/rentals.service';
import { clientsService } from '../services/clients.service';
import { mechanicsService } from '../services/mechanics.service';
import { serviceTicketsService, type ServiceRepeatBreakdownsResponse, type ServiceRepeatBreakdownItem } from '../services/service-tickets.service';
import { useServerPagination } from '../hooks/useServerPagination';
import { PaginationControls } from '../components/common/PaginationControls';

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
const SERVICE_DONUT_COLORS = {
  inProgress: '#2563EB',
  waitingParts: '#7C3AED',
  ready: '#059669',
  unassigned: '#F59E0B',
  overdue: '#DC2626',
  other: '#94A3B8',
} as const;

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
  return Number.isFinite(timestamp) ? formatDate(new Date(timestamp).toISOString()) : 'не указана';
}

function formatShortDate(value?: string) {
  const text = String(value || '').trim();
  if (!text) return '—';
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return '—';
  return new Date(timestamp).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

function getTicketClientObject(ticket: ServiceTicket) {
  return ticket.objectName || ticket.location || ticket.objectAddress || ticket.contractNumber || '';
}

function getTicketDueLabel(ticket: ServiceTicket) {
  return ticket.dueDate || ticket.deadline || ticket.targetDate || ticket.plannedDate || ticket.scheduledDate || '';
}

function isTicketOverdue(ticket: ServiceTicket) {
  const due = getTicketDueLabel(ticket);
  if (!due || normalizeServiceStatus(ticket.status) === 'closed') return false;
  return due.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

function closureDays(ticket: ServiceTicket) {
  const created = Date.parse(String(ticket.createdAt || ''));
  const closed = Date.parse(String(ticket.closedAt || ''));
  if (!Number.isFinite(created) || !Number.isFinite(closed) || closed < created) return null;
  return Math.max(1, Math.ceil((closed - created) / 86_400_000));
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
  const meta = {
    critical: { label: 'Крит.', className: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300', dot: 'bg-red-500' },
    high: { label: 'Высок.', className: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300', dot: 'bg-red-500' },
    medium: { label: 'Сред.', className: 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300', dot: 'bg-orange-500' },
    low: { label: 'Низк.', className: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300', dot: 'bg-blue-500' },
  }[normalized];

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ring-black/5 dark:ring-white/10 ${meta.className}`} title={servicePriorityLabel(normalized)}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function getCompactServiceStatusPill(status: ServiceTicket['status']) {
  const normalized = normalizeServiceStatus(status);
  const meta = {
    new: { label: 'Новая', className: 'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300' },
    in_progress: { label: 'В работе', className: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-900' },
    waiting_parts: { label: 'Запчасти', className: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-900' },
    needs_revision: { label: 'Доработка', className: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-900' },
    ready: { label: 'Готово', className: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-900' },
    closed: { label: 'Закрыта', className: 'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300' },
  }[normalized];

  return (
    <span className={`inline-flex max-w-full truncate rounded-full px-2.5 py-1 text-xs font-medium ${meta.className}`} title={serviceStatusLabel(normalized)}>
      {meta.label}
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

function getMechanicInitials(name: string) {
  const normalized = name.trim();
  if (!normalized || normalized === 'Не назначен') return '—';
  return normalized
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
}

function getTicketPhoto(ticket: ServiceTicket): NormalizedPhoto | null {
  const [firstPhoto] = Array.isArray(ticket.photos) ? ticket.photos : [];
  if (!firstPhoto) return null;
  const photo = normalizePhotoForDisplay(firstPhoto, { idPrefix: `${ticket.id || 'service'}-thumbnail` });
  return photo.fullUrl || photo.isBroken ? photo : null;
}

function ServiceMetricCard({
  title,
  value,
  caption,
  tone,
  icon,
}: {
  title: string;
  value: number;
  caption: string;
  tone: 'lime' | 'blue' | 'green' | 'red' | 'amber' | 'orange' | 'purple' | 'neutral';
  icon?: React.ReactNode;
}) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const toneClasses = {
    lime: {
      value: 'text-[--color-primary]',
      accent: 'bg-[--color-primary]/20',
      icon: 'bg-[--color-primary]/12 text-[--color-primary]',
    },
    blue: {
      value: 'text-blue-600 dark:text-blue-300',
      accent: 'bg-blue-500/20',
      icon: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
    },
    green: {
      value: 'text-emerald-600 dark:text-emerald-300',
      accent: 'bg-emerald-500/20',
      icon: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    },
    red: {
      value: 'text-red-600 dark:text-red-300',
      accent: 'bg-red-500/20',
      icon: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
    },
    amber: {
      value: 'text-amber-600 dark:text-amber-300',
      accent: 'bg-amber-500/20',
      icon: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
    },
    orange: {
      value: 'text-orange-600 dark:text-orange-300',
      accent: 'bg-orange-500/20',
      icon: 'bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300',
    },
    purple: {
      value: 'text-violet-600 dark:text-violet-300',
      accent: 'bg-violet-500/20',
      icon: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
    },
    neutral: {
      value: 'text-gray-900 dark:text-white',
      accent: 'bg-gray-500/10',
      icon: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
    },
  }[tone];

  return (
    <div data-service-kpi-card="true" className="flex min-h-[104px] rounded-lg border border-[#E5EAF3] bg-white p-3.5 shadow-[0_8px_24px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${toneClasses.icon}`} aria-hidden="true">
          {icon ?? <span className={`h-2.5 w-2.5 rounded-full ${toneClasses.accent}`} />}
      </div>
      <div className="ml-3 min-w-0">
        <div className={`text-[26px] font-bold leading-none ${toneClasses.value}`}>{safeValue}</div>
        <div className="mt-1 truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</div>
        <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-500">{caption}</div>
      </div>
    </div>
  );
}

function TicketThumbnail({ ticket }: { ticket: ServiceTicket }) {
  const photo = getTicketPhoto(ticket);
  return (
    <div className="flex h-10 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-gray-200 bg-gray-100 dark:border-white/10 dark:bg-white/8">
      {photo ? (
        <AuthenticatedImage
          photo={photo}
          alt=""
          className="h-full w-full rounded-none border-0 bg-transparent"
          fallbackClassName="min-h-0 h-full rounded-none border-0 px-1 py-0 text-[10px]"
          imgClassName="h-full w-full object-cover"
        />
      ) : (
        <ImageIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
      )}
    </div>
  );
}

function MechanicAvatar({ name }: { name: string }) {
  const unassigned = !name || name === 'Не назначен';
  return (
    <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${
      unassigned
        ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-900'
        : 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-900'
    }`}>
      {getMechanicInitials(name || 'Не назначен')}
    </span>
  );
}

function RequestSubTabLabel({ label, count }: { label: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span>{label}</span>
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500 group-data-[active=true]:bg-[--color-primary]/15 group-data-[active=true]:text-[--color-primary] dark:bg-white/8 dark:text-gray-300">
        {count}
      </span>
    </span>
  );
}

function ServiceTabLabel({ label, count }: { label: string; count?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span>{label}</span>
      {typeof count === 'number' && (
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500 transition-colors group-data-[state=active]:bg-[--color-primary]/15 group-data-[state=active]:text-[--color-primary] dark:bg-white/8 dark:text-gray-300">
          {count}
        </span>
      )}
    </span>
  );
}

function ServiceStatDonut({
  metrics,
  queue,
}: {
  metrics: {
    inProgress: number;
    waitingParts: number;
    ready: number;
    unassigned: number;
    overdue: number;
    total: number;
  };
  queue: ReturnType<typeof buildServiceQueue>;
}) {
  const chartRows = React.useMemo(() => {
    const overdue = queue.rows.filter(item => item.ageDays >= 7).length;
    const waitingParts = queue.rows.filter(item => item.ageDays < 7 && item.waitingParts).length;
    const ready = queue.rows.filter(item => item.ageDays < 7 && !item.waitingParts && item.ticketStatus === 'ready').length;
    const unassigned = queue.rows.filter(item => item.ageDays < 7 && !item.waitingParts && item.ticketStatus !== 'ready' && item.unassigned).length;
    const inProgress = queue.rows.filter(item => item.ageDays < 7 && !item.waitingParts && item.ticketStatus === 'in_progress' && !item.unassigned).length;
    const used = overdue + waitingParts + ready + unassigned + inProgress;
    const other = Math.max(metrics.total - used, 0);
    return [
      { key: 'inProgress', label: 'В работе', value: inProgress, color: SERVICE_DONUT_COLORS.inProgress },
      { key: 'waitingParts', label: 'Ожидание запчастей', value: waitingParts, color: SERVICE_DONUT_COLORS.waitingParts },
      { key: 'ready', label: 'Готовы к закрытию', value: ready, color: SERVICE_DONUT_COLORS.ready },
      { key: 'unassigned', label: 'Без механика / Очередь', value: unassigned, color: SERVICE_DONUT_COLORS.unassigned },
      { key: 'overdue', label: 'Просрочено', value: overdue, color: SERVICE_DONUT_COLORS.overdue },
      { key: 'other', label: 'Прочие', value: other, color: SERVICE_DONUT_COLORS.other },
    ].filter(row => row.value > 0);
  }, [metrics.total, queue.rows]);
  const chartTotal = chartRows.reduce((sum, row) => sum + row.value, 0);
  const chartData = chartRows.length ? chartRows : [{ key: 'empty', label: 'Нет активных', value: 1, color: '#E5EAF3' }];

  return (
    <div className="mt-3">
      <div className="relative mx-auto h-40 w-full max-w-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={chartData} dataKey="value" nameKey="label" innerRadius="66%" outerRadius="88%" startAngle={90} endAngle={-270} paddingAngle={chartRows.length > 1 ? 3 : 0} stroke="none">
              {chartData.map(row => (
                <Cell key={row.key} fill={row.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-3xl font-bold leading-none text-gray-900 dark:text-white">{metrics.total}</div>
          <div className="mt-1 text-xs font-medium text-gray-500 dark:text-gray-400">актуальных</div>
        </div>
      </div>
      <div className="mt-2 space-y-2">
        {chartRows.length === 0 ? (
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:bg-white/[0.04] dark:text-gray-400">Активных заявок нет.</div>
        ) : (
          chartRows.map(row => {
            const percent = chartTotal > 0 ? Math.round((row.value / chartTotal) * 100) : 0;
            return (
              <div key={row.key} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                <span className="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300">{row.label}</span>
                <span className="font-semibold text-gray-900 dark:text-white">{row.value}</span>
                <span className="w-9 text-right text-xs text-gray-400">{percent}%</span>
              </div>
            );
          })
        )}
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

      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm shadow-slate-200/40 dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
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
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm shadow-slate-200/40 dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
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

function repeatSeverityLabel(severity: ServiceRepeatBreakdownItem['repeatSeverity']) {
  return {
    critical: 'Критично',
    high: 'Высокий',
    medium: 'Средний',
    low: 'Низкий',
  }[severity] || 'Низкий';
}

function repeatSeverityClass(severity: ServiceRepeatBreakdownItem['repeatSeverity']) {
  return {
    critical: 'bg-red-100 text-red-800 ring-1 ring-red-200 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-900',
    high: 'bg-orange-100 text-orange-800 ring-1 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-200 dark:ring-orange-900',
    medium: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-900',
    low: 'bg-gray-100 text-gray-700 ring-1 ring-gray-200 dark:bg-white/10 dark:text-gray-300 dark:ring-white/10',
  }[severity] || 'bg-gray-100 text-gray-700';
}

function safeRepeatText(value: string | number | undefined, fallback = '—') {
  const text = String(value ?? '').trim();
  if (!text || text === 'undefined' || text === 'null' || text === '[object Object]') return fallback;
  return text;
}

function RepeatBreakdownsTab({
  data,
  isLoading,
  error,
}: {
  data?: ServiceRepeatBreakdownsResponse;
  isLoading: boolean;
  error: unknown;
}) {
  const [periodFilter, setPeriodFilter] = React.useState<'7' | '14' | '30'>('30');
  const [severityFilter, setSeverityFilter] = React.useState('all');
  const [modelFilter, setModelFilter] = React.useState('all');
  const [mechanicFilter, setMechanicFilter] = React.useState('all');
  const [scenarioFilter, setScenarioFilter] = React.useState('all');
  const [highOnly, setHighOnly] = React.useState(false);

  const items = React.useMemo(() => data?.items ?? [], [data?.items]);
  const filteredItems = React.useMemo(() => {
    const period = Number(periodFilter);
    return items
      .filter(item => item.repeatWindow <= period)
      .filter(item => severityFilter === 'all' || item.repeatSeverity === severityFilter)
      .filter(item => modelFilter === 'all' || item.model === modelFilter)
      .filter(item => mechanicFilter === 'all' || item.mechanicName === mechanicFilter)
      .filter(item => scenarioFilter === 'all' || item.scenario === scenarioFilter)
      .filter(item => !highOnly || ['critical', 'high'].includes(item.repeatSeverity));
  }, [highOnly, items, mechanicFilter, modelFilter, periodFilter, scenarioFilter, severityFilter]);

  const modelOptions = React.useMemo(() => (
    Array.from(new Set(items.map(item => item.model).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'ru'))
  ), [items]);
  const mechanicOptions = React.useMemo(() => (
    Array.from(new Set(items.map(item => item.mechanicName).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'ru'))
  ), [items]);
  const scenarioOptions = React.useMemo(() => (
    Array.from(new Set(items.map(item => item.scenario).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'ru'))
  ), [items]);
  const filteredHighCritical = filteredItems.filter(item => item.repeatSeverity === 'critical' || item.repeatSeverity === 'high').length;
  const problematicEquipment = new Set(filteredItems.map(item => item.equipmentId).filter(Boolean)).size;
  const problematicModels = new Set(filteredItems.map(item => item.model).filter(Boolean)).size;
  const problematicMechanics = new Set(filteredItems.map(item => item.mechanicName).filter(Boolean)).size;

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-400">
        Загружаем аналитику качества ремонта...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-100">
        Не удалось загрузить аналитику повторных поломок. Попробуйте обновить страницу или проверьте права доступа.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <ServiceMetricCard title="Повторов за 7 дней" value={data?.summary.repeatWithin7 ?? 0} caption="После завершения ремонта" tone="red" icon={<AlertTriangle className="h-4 w-4" />} />
        <ServiceMetricCard title="Повторов за 30 дней" value={data?.summary.repeatWithin30 ?? 0} caption="Все окна контроля" tone="orange" icon={<CalendarClock className="h-4 w-4" />} />
        <ServiceMetricCard title="Критичные" value={data?.summary.critical ?? 0} caption="Максимальный риск" tone="red" icon={<ShieldAlert className="h-4 w-4" />} />
        <ServiceMetricCard title="Проблемная техника" value={problematicEquipment} caption="По текущим фильтрам" tone="blue" icon={<Wrench className="h-4 w-4" />} />
        <ServiceMetricCard title="Проблемные модели" value={problematicModels} caption="Модели с повторами" tone="purple" icon={<PackageSearch className="h-4 w-4" />} />
        <ServiceMetricCard title="Повторы по механику" value={problematicMechanics} caption="Затронутые механики" tone="amber" icon={<UserRound className="h-4 w-4" />} />
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm shadow-slate-200/40 dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[repeat(5,minmax(150px,1fr))_auto]">
          <Select value={periodFilter} onValueChange={(value) => setPeriodFilter(value as '7' | '14' | '30')}>
            <SelectTrigger><SelectValue placeholder="Период" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 дней</SelectItem>
              <SelectItem value="14">14 дней</SelectItem>
              <SelectItem value="30">30 дней</SelectItem>
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все уровни</SelectItem>
              <SelectItem value="critical">Критичные</SelectItem>
              <SelectItem value="high">Высокие</SelectItem>
              <SelectItem value="medium">Средние</SelectItem>
              <SelectItem value="low">Низкие</SelectItem>
            </SelectContent>
          </Select>
          <Select value={modelFilter} onValueChange={setModelFilter}>
            <SelectTrigger><SelectValue placeholder="Модель" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все модели</SelectItem>
              {modelOptions.map(model => <SelectItem key={model} value={model}>{model}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={mechanicFilter} onValueChange={setMechanicFilter}>
            <SelectTrigger><SelectValue placeholder="Механик" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все механики</SelectItem>
              {mechanicOptions.map(mechanic => <SelectItem key={mechanic} value={mechanic}>{mechanic}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={scenarioFilter} onValueChange={setScenarioFilter}>
            <SelectTrigger><SelectValue placeholder="Сценарий" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все сценарии</SelectItem>
              {scenarioOptions.map(scenario => <SelectItem key={scenario} value={scenario}>{scenario}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant={highOnly ? 'default' : 'secondary'}
            className="h-10 whitespace-nowrap"
            onClick={() => setHighOnly(value => !value)}
          >
            Только high/critical
          </Button>
        </div>
      </section>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm shadow-slate-200/40 dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
        <div className="hidden grid-cols-[minmax(180px,1fr)_minmax(128px,0.65fr)_minmax(128px,0.65fr)_86px_130px_110px_minmax(180px,1fr)_minmax(170px,0.9fr)_120px] gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 text-xs font-bold uppercase text-gray-500 dark:border-white/10 dark:bg-white/[0.04] 2xl:grid">
          <div>Техника</div>
          <div>Предыдущая заявка</div>
          <div>Повторная заявка</div>
          <div>Дней</div>
          <div>Механик</div>
          <div>Сценарий</div>
          <div>Причина</div>
          <div>Рекомендация</div>
          <div>Ссылки</div>
        </div>
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 dark:bg-white/8">
              <Search className="h-7 w-7 text-gray-400 dark:text-gray-500" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Повторных поломок за выбранный период не найдено</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Фильтры не нашли повторов или данных для вывода пока недостаточно.</p>
          </div>
        ) : (
          filteredItems.map(item => (
            <div key={`${item.previousTicketId}-${item.repeatTicketId}`} className="grid gap-3 border-b border-gray-100 px-4 py-4 last:border-b-0 dark:border-white/6 2xl:grid-cols-[minmax(180px,1fr)_minmax(128px,0.65fr)_minmax(128px,0.65fr)_86px_130px_110px_minmax(180px,1fr)_minmax(170px,0.9fr)_120px] 2xl:items-center">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-gray-900 dark:text-white">{safeRepeatText(item.equipmentLabel)}</div>
                <div className="mt-0.5 truncate text-xs text-gray-500">{safeRepeatText(item.model)} · INV: {safeRepeatText(item.inventoryNumber)}</div>
                <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${repeatSeverityClass(item.repeatSeverity)}`}>{repeatSeverityLabel(item.repeatSeverity)}</span>
              </div>
              <div className="min-w-0">
                <div className="font-mono text-sm font-bold text-[--color-primary]">{safeRepeatText(item.previousTicketNumber)}</div>
                <div className="mt-1 text-xs text-gray-500">{formatShortDate(item.previousClosedAt)}</div>
              </div>
              <div className="min-w-0">
                <div className="font-mono text-sm font-bold text-[--color-primary]">{safeRepeatText(item.repeatTicketNumber)}</div>
                <div className="mt-1 text-xs text-gray-500">{formatShortDate(item.repeatCreatedAt)}</div>
              </div>
              <div className="text-sm font-bold text-gray-900 dark:text-white">{Number.isFinite(item.daysBetween) ? item.daysBetween : 0}</div>
              <div className="truncate text-sm text-gray-700 dark:text-gray-200">{safeRepeatText(item.mechanicName, 'Не назначен')}</div>
              <div className="truncate text-sm text-gray-700 dark:text-gray-200">{safeRepeatText(item.scenario)}</div>
              <div className="text-sm text-gray-600 dark:text-gray-300">{safeRepeatText(item.reason)}</div>
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{safeRepeatText(item.recommendedAction)}</div>
              <div className="flex flex-wrap gap-2">
                {item.links.equipment && <Link className="text-sm font-semibold text-[--color-primary] hover:underline" to={item.links.equipment}>Техника</Link>}
                {item.links.previousServiceTicket && <Link className="text-sm font-semibold text-[--color-primary] hover:underline" to={item.links.previousServiceTicket}>Пред.</Link>}
                {item.links.repeatServiceTicket && <Link className="text-sm font-semibold text-[--color-primary] hover:underline" to={item.links.repeatServiceTicket}>Повтор</Link>}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {(data?.groups.byEquipment ?? []).slice(0, 4).map(group => (
          <div key={group.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm dark:border-white/10 dark:bg-white/[0.03]">
            <div className="truncate font-semibold text-gray-900 dark:text-white">{group.label}</div>
            <div className="mt-1 text-gray-500 dark:text-gray-400">Повторов: {group.count} · high/critical: {group.high + group.critical}</div>
          </div>
        ))}
      </div>

      <div className="text-xs text-gray-500 dark:text-gray-500">
        Показано {filteredItems.length} из {items.length}. High/critical по текущим фильтрам: {filteredHighCritical}.
      </div>
    </div>
  );
}

function ServiceManagementPanel({
  metrics,
  queue,
  canCreateService,
  canManageDayPlan,
  canManageWarrantyClaims,
  onOpenTicket,
  onShowPlanner,
  onShowWarranty,
}: {
  metrics: {
    inProgress: number;
    waitingParts: number;
    ready: number;
    unassigned: number;
    overdue: number;
    total: number;
  };
  queue: ReturnType<typeof buildServiceQueue>;
  canCreateService: boolean;
  canManageDayPlan: boolean;
  canManageWarrantyClaims: boolean;
  onOpenTicket: (ticketId: string) => void;
  onShowPlanner: () => void;
  onShowWarranty: () => void;
}) {
  const quickActions = [
    { label: 'Создать заявку', icon: <Plus className="h-4 w-4" />, to: '/service/new', show: canCreateService },
    { label: 'Создать рекламацию', icon: <ShieldAlert className="h-4 w-4" />, action: 'warranty', show: canManageWarrantyClaims },
    { label: 'Назначение через планировщик', icon: <CalendarClock className="h-4 w-4" />, action: 'planner', show: canManageDayPlan },
    { label: 'Заказать запчасти', icon: <PackageSearch className="h-4 w-4" />, action: 'parts', show: true },
    { label: 'Выезд механика', icon: <Wrench className="h-4 w-4" />, action: 'field-trip', show: true },
  ];
  const problemGroups = [
    {
      title: 'Просроченные заявки',
      icon: <AlertTriangle className="h-4 w-4 text-red-500" />,
      rows: queue.rows.filter(item => item.ageDays >= 7).slice(0, 4),
      empty: 'Просрочек нет.',
      accent: 'bg-red-500',
      label: (ageDays: number) => `${ageDays} дн. просрочки`,
    },
    {
      title: 'Ожидание запчастей',
      icon: <PackageSearch className="h-4 w-4 text-violet-500" />,
      rows: queue.rows.filter(item => item.waitingParts).slice(0, 4),
      empty: 'Нет заявок в ожидании.',
      accent: 'bg-violet-500',
      label: (ageDays: number) => `${ageDays} дн. ожидает`,
    },
  ];

  return (
    <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
      <section className="rounded-lg border border-[#E5EAF3] bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.07)] dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Быстрые действия</h3>
        <div className="mt-2 grid gap-1">
          {quickActions.filter(action => action.show).map(action => (
            action.to ? (
              <Link key={action.label} to={action.to}>
                <span className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-sm font-medium text-gray-700 transition hover:bg-blue-50 hover:text-[--color-primary] dark:text-gray-200 dark:hover:bg-blue-500/10">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[--color-primary] dark:bg-blue-500/15">{action.icon}</span>
                  {action.label}
                </span>
              </Link>
            ) : (
              <button
                key={action.label}
                type="button"
                className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm font-medium text-gray-700 transition hover:bg-blue-50 hover:text-[--color-primary] dark:text-gray-200 dark:hover:bg-blue-500/10"
                onClick={() => {
                  if (action.action === 'planner') onShowPlanner();
                  if (action.action === 'warranty') onShowWarranty();
                  if (action.action !== 'planner') {
                    if (action.action === 'warranty') return;
                    const target = action.action === 'parts'
                      ? queue.rows.find(item => item.waitingParts)
                      : queue.rows.find(item => item.unassigned) ?? queue.rows[0];
                    if (target) onOpenTicket(target.ticketId);
                  }
                }}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[--color-primary] dark:bg-blue-500/15">{action.icon}</span>
                {action.label}
              </button>
            )
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-[#E5EAF3] bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.07)] dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Статистика</h3>
        <ServiceStatDonut metrics={metrics} queue={queue} />
      </section>

      {problemGroups.map(group => (
        <section key={group.title} className="rounded-lg border border-[#E5EAF3] bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.07)] dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
          <div className="flex items-center gap-2">
            {group.icon}
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{group.title}</h3>
            <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500 dark:bg-white/8 dark:text-gray-300">{group.rows.length}</span>
          </div>
          {group.rows.length === 0 ? (
            <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:bg-white/[0.04] dark:text-gray-400">{group.empty}</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {group.rows.map(item => (
                <button
                  key={`${group.title}-${item.ticketId}`}
                  type="button"
                  onClick={() => onOpenTicket(item.ticketId)}
                  className="w-full rounded-lg border border-gray-100 p-2.5 text-left transition hover:border-[--color-primary]/40 hover:bg-[--color-primary]/5 dark:border-white/8"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-xs font-bold text-[--color-primary]">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${group.accent}`} />
                      {item.ticketId}
                    </span>
                    <span className="text-xs text-gray-500">{group.label(item.ageDays)}</span>
                  </div>
                  <div className="mt-1 truncate text-sm font-semibold text-gray-900 dark:text-white">{item.equipmentTitle}</div>
                  <div className="mt-0.5 truncate text-xs text-gray-500">{item.mechanic || item.groupLabel}</div>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  const [first] = group.rows;
                  if (first) onOpenTicket(first.ticketId);
                }}
                className="mt-1 text-xs font-semibold text-[--color-primary] hover:underline"
              >
                Смотреть все
              </button>
            </div>
          )}
        </section>
      ))}
    </aside>
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
  const servicePagination = useServerPagination<{
    priority: string;
    status: string;
    scenario: string;
    mechanic: string;
    workflow: string;
    preset: string;
  }>({
    initialSortBy: 'createdAt',
    initialSortDir: 'desc',
    initialFilters: {
      priority: 'all',
      status: 'all',
      scenario: 'all',
      mechanic: 'all',
      workflow: 'all',
      preset: 'all',
    },
    storageKey: 'service',
  });
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
  React.useEffect(() => {
    servicePagination.setSearch(search);
  }, [search, servicePagination.setSearch]);
  React.useEffect(() => {
    servicePagination.setFilters({
      priority: priorityFilter,
      status: statusFilter,
      scenario: scenarioFilter,
      mechanic: mechanicFilter,
      workflow: workflowFilter,
      preset,
    });
  }, [mechanicFilter, preset, priorityFilter, scenarioFilter, servicePagination.setFilters, statusFilter, workflowFilter]);
  React.useEffect(() => {
    servicePagination.setPage(1);
  }, [datePreset, dateFrom, dateTo, servicePagination.setPage]);
  const ticketsQuery = usePaginatedServiceTickets({
    page: servicePagination.page,
    pageSize: servicePagination.pageSize,
    search: servicePagination.debouncedSearch,
    sortBy: servicePagination.sortBy,
    sortDir: servicePagination.sortDir,
    dateFrom: effectiveDateFrom,
    dateTo: effectiveDateTo,
    filters: servicePagination.filters,
  });
  const ticketList = React.useMemo(
    () => (ticketsQuery.data?.items ?? []).filter(isRegularServiceTicket),
    [ticketsQuery.data],
  );
  const normalizedRole = normalizeUserRole(user?.role);
  const canManageWarrantyClaims = ['Администратор', 'Офис-менеджер'].includes(normalizedRole) || isWarrantyMechanicRole(normalizedRole);
  const canViewEquipment = can('view', 'equipment');
  const canViewRentals = can('view', 'rentals');
  const canViewClients = can('view', 'clients');
  const canViewFinance = can('view', 'finance');
  const showDayPlan = canViewServiceDayPlan(normalizedRole);
  const canManageDayPlan = canManageServiceDayPlan(normalizedRole);
  const [showFilters, setShowFilters] = React.useState(false);
  const [archiveSearch, setArchiveSearch] = React.useState('');
  const [archiveStatusFilter, setArchiveStatusFilter] = React.useState<'closed'>('closed');
  const [archiveVisibleCount, setArchiveVisibleCount] = React.useState(RESULT_BATCH_SIZE);
  const [viewMode, setViewMode] = React.useState<'list' | 'kanban'>('list');
  const [selectedTicketId, setSelectedTicketId] = React.useState<string | null>(null);
  const [openTicketId, setOpenTicketId] = React.useState<string | null>(null);
  const [activeTopTab, setActiveTopTab] = React.useState('tickets');
  const [requestTab, setRequestTab] = React.useState<'actual' | 'in_progress' | 'waiting_parts' | 'ready' | 'archive'>('actual');

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
  const repeatBreakdownsQuery = useQuery<ServiceRepeatBreakdownsResponse>({
    queryKey: ['service', 'repeat-breakdowns'],
    queryFn: serviceTicketsService.getRepeatBreakdowns,
    enabled: can('view', 'service'),
    staleTime: 1000 * 60 * 2,
  });


  const clientLookup = React.useMemo(() => {
    const lookup = new Map<string, Client>();
    clients.forEach(client => {
      lookup.set(`id:${client.id}`, client);
      if (client.company) lookup.set(`name:${normalizeSearch(client.company)}`, client);
    });
    return lookup;
  }, [clients]);

  const activeTickets = React.useMemo(
    () => ticketList.filter(isActiveServiceTicket),
    [ticketList],
  );

  const archivedTickets = React.useMemo(
    () => ticketList.filter(isArchivedServiceTicket),
    [ticketList],
  );

  const mechanicOptions = React.useMemo(() => (
    Array.from(new Set(
      activeTickets
        .map(ticket => ticket.assignedMechanicName || ticket.assignedTo || '')
        .map(value => value.trim())
        .filter(Boolean),
    )).sort((left, right) => left.localeCompare(right, 'ru'))
  ), [activeTickets]);

  const workflowCounts = React.useMemo(() => (
    WORKFLOW_FILTER_OPTIONS.reduce<Record<ServiceWorkflowFilter, number>>((acc, option) => {
      acc[option.value] = option.value === 'all'
        ? activeTickets.length
        : activeTickets.filter(ticket => getTicketWorkflowKind(ticket) === option.value).length;
      return acc;
    }, { all: 0, repair: 0, diagnostics: 0, receiving: 0 })
  ), [activeTickets]);

  const serviceSummary = ticketsQuery.data?.summary as {
    active?: number;
    inProgress?: number;
    waitingParts?: number;
    ready?: number;
    unassigned?: number;
    overdue?: number;
    archived?: number;
  } | undefined;
  const metrics = React.useMemo(() => ({
    total: serviceSummary?.active ?? ticketsQuery.data?.pagination.total ?? activeTickets.length,
    inProgress: serviceSummary?.inProgress ?? activeTickets.filter(ticket => normalizeServiceStatus(ticket.status) === 'in_progress').length,
    waitingParts: serviceSummary?.waitingParts ?? activeTickets.filter(ticket => normalizeServiceStatus(ticket.status) === 'waiting_parts').length,
    ready: serviceSummary?.ready ?? activeTickets.filter(ticket => normalizeServiceStatus(ticket.status) === 'ready').length,
    unassigned: serviceSummary?.unassigned ?? activeTickets.filter(ticket => !ticket.assignedMechanicId && !ticket.assignedTo && !ticket.assignedMechanicName).length,
    overdue: serviceSummary?.overdue ?? activeTickets.filter(isTicketOverdue).length,
  }), [activeTickets, serviceSummary, ticketsQuery.data?.pagination.total]);

  const archiveMetrics = React.useMemo(() => {
    const closedThisMonth = archivedTickets.filter(ticket => {
      const closedDate = String(ticket.closedAt || ticket.createdAt || '').slice(0, 10);
      return closedDate >= monthStartIso && closedDate <= todayIso;
    }).length;
    const closureValues = archivedTickets
      .map(closureDays)
      .filter((value): value is number => typeof value === 'number');
    const averageClosureDays = closureValues.length
      ? Math.round(closureValues.reduce((sum, value) => sum + value, 0) / closureValues.length)
      : 0;
    return {
      total: archivedTickets.length,
      closedThisMonth,
      averageClosureDays,
    };
  }, [archivedTickets, monthStartIso, todayIso]);

  const serviceQueue = React.useMemo(() => buildServiceQueue({
    serviceTickets: ticketList,
    equipment: canViewEquipment ? equipmentList : [],
    rentals: canViewRentals ? ganttRentals : [],
    clients: canViewClients ? clients : [],
    canViewFinance,
  }), [canViewClients, canViewEquipment, canViewFinance, canViewRentals, clients, equipmentList, ganttRentals, ticketList]);

  const filteredTickets = activeTickets;

  const filteredArchiveTickets = React.useMemo(() => {
    const query = normalizeSearch(archiveSearch);
    return archivedTickets
      .filter(ticket => archiveStatusFilter === 'closed' && isArchivedServiceTicket(ticket))
      .filter(ticket => !query || getTicketSearchText(ticket).includes(query))
      .sort((left, right) => (
        String(right.closedAt || right.createdAt || '').localeCompare(String(left.closedAt || left.createdAt || ''))
      ));
  }, [archiveSearch, archiveStatusFilter, archivedTickets]);

  React.useEffect(() => {
    setArchiveVisibleCount(RESULT_BATCH_SIZE);
  }, [archiveSearch, archiveStatusFilter]);

  const visibleTickets = filteredTickets;
  const visibleArchiveTickets = filteredArchiveTickets.slice(0, archiveVisibleCount);
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

  const handleRequestTabChange = (tab: typeof requestTab) => {
    setRequestTab(tab);
    if (tab === 'archive') return;
    const nextStatus = tab === 'actual' ? 'all' : tab;
    setStatusFilter(nextStatus);
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

  const serviceTabTriggerBaseClass = 'group flex-none rounded-none border-0 border-b-2 bg-transparent px-4 py-2.5 text-sm font-semibold shadow-none transition hover:bg-blue-50/60 hover:text-gray-900 dark:hover:bg-blue-500/10 dark:hover:text-white';
  const serviceTabTriggerClass = (tab: string) => `${serviceTabTriggerBaseClass} ${
    activeTopTab === tab
      ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-300'
      : 'border-transparent text-gray-500 dark:text-gray-400'
  }`;
  const requestTabCounts = {
    actual: activeTickets.length,
    in_progress: metrics.inProgress,
    waiting_parts: metrics.waitingParts,
    ready: metrics.ready,
    archive: archivedTickets.length,
  };
  const repeatHighCriticalCount = (repeatBreakdownsQuery.data?.summary.high ?? 0) + (repeatBreakdownsQuery.data?.summary.critical ?? 0);

  return (
    <div className="space-y-3 bg-slate-50/70 p-4 sm:p-5 md:p-6 dark:bg-gray-950">
      <section className="border-b border-gray-200 pb-3 dark:border-white/10">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Сервис</h1>
            <p className="sr-only">Заявки, рекламации и планирование механиков.</p>
          </div>
          <div className="flex flex-wrap gap-2">
          {can('create', 'service') && (
            <Link to="/service/new">
              <Button className="h-10">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Новая заявка</span>
                <span className="sm:hidden">Создать</span>
              </Button>
            </Link>
          )}
          </div>
        </div>
      </section>

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
                  className="app-filter-chip h-8 whitespace-nowrap px-2.5 py-1 text-xs"
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
                  className="app-filter-chip h-8 whitespace-nowrap px-2.5 py-1 text-xs"
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

      <Tabs value={activeTopTab} onValueChange={setActiveTopTab} className="space-y-3">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg border border-[#E5EAF3] bg-white px-2 pt-1 shadow-[0_8px_24px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/[0.03]">
          <TabsTrigger value="tickets" className={serviceTabTriggerClass('tickets')}>
            <ServiceTabLabel label="Заявки" count={activeTickets.length} />
          </TabsTrigger>
          {canManageWarrantyClaims && (
            <TabsTrigger value="warranty" className={serviceTabTriggerClass('warranty')}>
              <ServiceTabLabel label="Рекламации" />
            </TabsTrigger>
          )}
          <TabsTrigger value="repeat-breakdowns" className={serviceTabTriggerClass('repeat-breakdowns')}>
            <ServiceTabLabel label="Повторные поломки" count={repeatHighCriticalCount} />
          </TabsTrigger>
          {showDayPlan && (
            <TabsTrigger value="day-plan" className={serviceTabTriggerClass('day-plan')}>
              <ServiceTabLabel label="Планировщик" count={mechanicsQuery.data?.length ?? 0} />
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="tickets" className="space-y-3">
          <div className="flex gap-1 overflow-x-auto rounded-lg border border-[#E5EAF3] bg-white px-2 pt-1 shadow-[0_8px_24px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/[0.03]">
            {[
              { value: 'actual' as const, label: 'Актуальные' },
              { value: 'in_progress' as const, label: 'В работе' },
              { value: 'waiting_parts' as const, label: 'Ожидание запчастей' },
              { value: 'ready' as const, label: 'Готовы к закрытию' },
              { value: 'archive' as const, label: 'Архив' },
            ].map(tab => {
              const isActive = requestTab === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => handleRequestTabChange(tab.value)}
                  data-active={String(isActive)}
                  className={`group flex-none border-b-2 px-3 py-2 text-sm font-semibold transition hover:bg-blue-50/60 hover:text-gray-900 dark:hover:bg-blue-500/10 dark:hover:text-white ${
                    isActive
                      ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-300'
                      : 'border-transparent text-gray-500 dark:text-gray-400'
                  }`}
                >
                  <RequestSubTabLabel label={tab.label} count={requestTabCounts[tab.value]} />
                </button>
              );
            })}
          </div>

          {requestTab !== 'archive' ? (
            <>
          <section className="rounded-lg border border-[#E5EAF3] bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(280px,1.65fr)_repeat(5,minmax(116px,0.8fr))_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="№ заявки, техника, клиент, проблема..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 border-gray-200 bg-white pl-10 text-sm shadow-none dark:border-white/10"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 border-gray-200 bg-white text-sm shadow-none dark:border-white/10"><SelectValue placeholder="Статус" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все статусы</SelectItem>
                  <SelectItem value="new">Новая</SelectItem>
                  <SelectItem value="in_progress">В работе</SelectItem>
                  <SelectItem value="waiting_parts">Ожидает запчасти</SelectItem>
                  <SelectItem value="needs_revision">На доработке</SelectItem>
                  <SelectItem value="ready">Готова к выдаче</SelectItem>
                </SelectContent>
              </Select>
              <Select value={scenarioFilter} onValueChange={setScenarioFilter}>
                <SelectTrigger className="h-9 border-gray-200 bg-white text-sm shadow-none dark:border-white/10"><SelectValue placeholder="Тип работ" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все типы</SelectItem>
                  <SelectItem value="repair">Ремонт</SelectItem>
                  <SelectItem value="to">ТО</SelectItem>
                  <SelectItem value="chto">ЧТО</SelectItem>
                  <SelectItem value="pto">ПТО</SelectItem>
                </SelectContent>
              </Select>
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="h-9 border-gray-200 bg-white text-sm shadow-none dark:border-white/10"><SelectValue placeholder="Приоритет" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все приоритеты</SelectItem>
                  <SelectItem value="critical">Критический</SelectItem>
                  <SelectItem value="high">Высокий</SelectItem>
                  <SelectItem value="medium">Средний</SelectItem>
                  <SelectItem value="low">Низкий</SelectItem>
                </SelectContent>
              </Select>
              <Select value={mechanicFilter} onValueChange={setMechanicFilter}>
                <SelectTrigger className="h-9 border-gray-200 bg-white text-sm shadow-none dark:border-white/10"><SelectValue placeholder="Механик" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все мастера</SelectItem>
                  {mechanicOptions.map(mechanic => (
                    <SelectItem key={mechanic} value={mechanic}>{mechanic}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={datePreset} onValueChange={(value) => setDatePreset(value as typeof datePreset)}>
                <SelectTrigger className="h-9 border-gray-200 bg-white text-sm shadow-none dark:border-white/10"><SelectValue placeholder="Период" /></SelectTrigger>
                <SelectContent>
                  {datePresetOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="secondary" className="h-9 px-3 text-sm" onClick={() => setShowFilters(true)}>
                <Filter className="h-4 w-4" />
                Фильтры
                {activeFilterCount > 0 && (
                  <span className="ml-1 rounded-full bg-[--color-primary]/15 px-1.5 py-0.5 text-[11px] font-bold text-[--color-primary]">{activeFilterCount}</span>
                )}
              </Button>
            </div>
          </section>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <ServiceMetricCard title="Актуальные" value={metrics.total} caption="Активных сейчас" tone="blue" icon={<ClipboardList className="h-4 w-4" />} />
            <ServiceMetricCard title="В работе" value={metrics.inProgress} caption="У механиков" tone="orange" icon={<Wrench className="h-4 w-4" />} />
            <ServiceMetricCard title="Ожидают запчасти" value={metrics.waitingParts} caption="Требуют снабжения" tone="purple" icon={<PackageSearch className="h-4 w-4" />} />
            <ServiceMetricCard title="Готовы к выдаче" value={metrics.ready} caption="Можно закрывать" tone="green" icon={<CheckCircle2 className="h-4 w-4" />} />
            <ServiceMetricCard title="Без механика" value={metrics.unassigned} caption="Нужно назначить" tone="amber" icon={<UserRound className="h-4 w-4" />} />
            <ServiceMetricCard title="Просрочено" value={metrics.overdue} caption="Нарушен срок" tone="red" icon={<AlertTriangle className="h-4 w-4" />} />
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
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
              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 dark:border-white/10 dark:bg-white/[0.03]">
                <button type="button" onClick={() => setViewMode('list')} className="app-filter-chip h-8 px-2.5 py-1 text-xs" data-active={String(viewMode === 'list')}>Список</button>
                <button type="button" onClick={() => setViewMode('kanban')} className="app-filter-chip h-8 px-2.5 py-1 text-xs" data-active={String(viewMode === 'kanban')}>Канбан</button>
              </div>
              <FilterButton
                activeCount={activeFilterCount}
                onClick={() => setShowFilters(true)}
                className="h-9 rounded-lg px-4 text-sm font-bold"
              />
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_348px]">
            <div className="min-w-0 space-y-3">
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
                <div className="overflow-hidden rounded-lg border border-[#E5EAF3] bg-white shadow-[0_12px_34px_rgba(15,23,42,0.07)] dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
                  <div className="hidden gap-2 border-b border-gray-100 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-gray-500 dark:border-white/10 dark:bg-white/[0.04] xl:grid xl:grid-cols-[92px_minmax(160px,1fr)_minmax(138px,0.8fr)_90px_92px_86px_minmax(116px,0.7fr)_74px_74px_28px]">
                    <div>№ заявки</div>
                    <div>Техника</div>
                    <div>Клиент / Объект</div>
                    <div>Тип работ</div>
                    <div>Статус</div>
                    <div>Приоритет</div>
                    <div>Механик</div>
                    <div>Срок</div>
                    <div>Обновлено</div>
                    <div></div>
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
                      const objectLabel = getTicketClientObject(ticket);
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
                          className={`grid cursor-pointer gap-2 border-b border-gray-100 px-3 py-2.5 transition-colors last:border-b-0 hover:bg-blue-50/70 dark:border-white/6 dark:hover:bg-blue-500/10 md:grid-cols-[minmax(160px,0.9fr)_minmax(220px,1.1fr)] lg:grid-cols-[minmax(150px,0.7fr)_minmax(220px,1fr)_minmax(190px,0.9fr)_minmax(160px,0.8fr)] xl:grid-cols-[92px_minmax(160px,1fr)_minmax(138px,0.8fr)_90px_92px_86px_minmax(116px,0.7fr)_74px_74px_28px] lg:items-center ${
                            isSelected
                              ? 'bg-blue-50 ring-1 ring-inset ring-[--color-primary]/25 dark:bg-blue-500/10'
                              : index % 2 === 0 ? 'bg-white dark:bg-transparent' : 'bg-slate-50/35 dark:bg-white/[0.015]'
                          }`}
                        >
                          <div className="min-w-0 text-left">
                            <div className="truncate font-mono text-sm font-bold text-[--color-primary]">{ticket.id}</div>
                            <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">{formatTicketDate(ticket.createdAt)}</div>
                          </div>
                          <div className="flex min-w-0 items-center gap-3 text-left">
                            <TicketThumbnail ticket={ticket} />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-bold text-gray-900 dark:text-white">{getTicketEquipmentTitle(ticket)}</div>
                              <div className="mt-0.5 truncate font-mono text-xs text-gray-500">
                                INV: {inventory}{serialNumber ? ` · SN: ${serialNumber}` : ''}
                              </div>
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{clientDetails.name}</div>
                            <div className="mt-0.5 truncate text-xs text-gray-500">{objectLabel || (clientDetails.inn ? `ИНН ${clientDetails.inn}` : 'Объект не указан')}</div>
                          </div>
                          <div className="min-w-0 text-left">
                            <div className="truncate text-sm font-medium text-gray-700 dark:text-gray-200">{repairType}</div>
                            <div className="mt-0.5 truncate text-xs text-gray-500">{ticket.reason || '—'}</div>
                          </div>
                          <div>{getCompactServiceStatusPill(normalizeServiceStatus(ticket.status))}</div>
                          <div>{getServicePriorityPill(ticket.priority)}</div>
                          <div className="flex min-w-0 items-center gap-2">
                            <MechanicAvatar name={assignedMechanic || 'Не назначен'} />
                            <span className="min-w-0 truncate text-sm text-gray-600 dark:text-gray-300">{assignedMechanic || 'Не назначен'}</span>
                          </div>
                          <div>
                            <span className={`inline-flex flex-col rounded-lg px-2.5 py-1 text-xs font-semibold ${dueMeta.className}`}>
                              <span>{dueLabel ? formatShortDate(dueLabel) : '—'}</span>
                              <span className="font-medium opacity-75">{dueMeta.hint}</span>
                            </span>
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-300">{formatShortDate(ticket.completedAt || ticket.closedAt || ticket.createdAt)}</div>
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

            <ServiceManagementPanel
              metrics={metrics}
              queue={serviceQueue}
              canCreateService={can('create', 'service')}
              canManageDayPlan={canManageDayPlan}
              canManageWarrantyClaims={canManageWarrantyClaims}
              onOpenTicket={openTicketCard}
              onShowPlanner={() => setActiveTopTab('day-plan')}
              onShowWarranty={() => setActiveTopTab('warranty')}
            />
          </div>

          <PaginationControls
            pagination={ticketsQuery.data?.pagination}
            loading={ticketsQuery.isFetching}
            onPageChange={servicePagination.setPage}
            onPageSizeChange={servicePagination.setPageSize}
          />
            </>
          ) : (
            <>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-600 dark:text-gray-300">
                  <Archive className="h-4 w-4" />
                  Архивные заявки доступны только для просмотра и управленческого анализа.
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <ServiceMetricCard title="Всего в архиве" value={archiveMetrics.total} caption="Закрытые заявки" tone="neutral" icon={<Archive className="h-5 w-5" />} />
                <ServiceMetricCard title="Закрыто за месяц" value={archiveMetrics.closedThisMonth} caption="Финальный статус" tone="green" icon={<CheckCircle2 className="h-5 w-5" />} />
                <ServiceMetricCard title="Среднее закрытие" value={archiveMetrics.averageClosureDays} caption="Дней по закрытым" tone="amber" icon={<CalendarClock className="h-5 w-5" />} />
                <ServiceMetricCard title="Найдено" value={filteredArchiveTickets.length} caption="По текущим фильтрам" tone="blue" icon={<Search className="h-5 w-5" />} />
              </div>

              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm shadow-slate-200/40 dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
                <div className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_220px_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Поиск в архиве: № заявки, техника, клиент..."
                      value={archiveSearch}
                      onChange={(e) => setArchiveSearch(e.target.value)}
                      className="h-11 pl-10"
                    />
                  </div>
                  <Select value={archiveStatusFilter} onValueChange={(value) => setArchiveStatusFilter(value as 'closed')}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="Статус" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="closed">Закрыта</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="secondary" className="h-11" onClick={() => setArchiveSearch('')}>
                    Сбросить
                  </Button>
                </div>
              </section>

              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm shadow-slate-200/40 dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
                <div className="hidden grid-cols-[minmax(170px,0.8fr)_120px_minmax(220px,1fr)_minmax(180px,0.9fr)_120px_auto] gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 text-xs font-bold uppercase text-gray-500 dark:border-white/10 dark:bg-white/[0.04] lg:grid">
                  <div>№ заявки / дата</div>
                  <div>Статус</div>
                  <div>Техника</div>
                  <div>Клиент / проблема</div>
                  <div>Закрыта</div>
                  <div></div>
                </div>
                {visibleArchiveTickets.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-14 text-center">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 dark:bg-white/8">
                      <Search className="h-7 w-7 text-gray-400 dark:text-gray-500" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">Архивные заявки не найдены</h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Попробуйте изменить поиск по архиву.</p>
                  </div>
                ) : (
                  visibleArchiveTickets.map((ticket, index) => {
                    const inventory = getTicketInventory(ticket);
                    const serialNumber = ticket.serialNumber || '';
                    const clientDetails = getTicketClientDetails(ticket, clientLookup);
                    const description = ticket.description ? truncateText(ticket.description, 90) : '';
                    const openTicket = () => openTicketCard(ticket.id);

                    return (
                      <div
                        key={ticket.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Открыть архивную заявку ${ticket.id}`}
                        onClick={openTicket}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openTicket();
                          }
                        }}
                        className={`grid cursor-pointer gap-3 border-b border-gray-100 px-4 py-3 text-gray-600 transition-colors last:border-b-0 hover:bg-gray-50 dark:border-white/6 dark:text-gray-300 dark:hover:bg-white/[0.04] lg:grid-cols-[minmax(170px,0.8fr)_120px_minmax(220px,1fr)_minmax(180px,0.9fr)_120px_auto] lg:items-start ${
                          index % 2 === 0 ? 'bg-gray-50/60 dark:bg-white/[0.015]' : 'bg-white dark:bg-transparent'
                        }`}
                      >
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
                          <div className="mt-0.5 truncate text-xs text-gray-500">{ticket.reason || description || '—'}</div>
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-300">{ticket.closedAt ? formatShortDate(ticket.closedAt) : '—'}</div>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openTicket();
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[--color-primary] dark:hover:bg-white/10"
                          title="Открыть полную карточку"
                          aria-label={`Открыть полную карточку архивной заявки ${ticket.id}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {filteredArchiveTickets.length > 0 && (
                <div className="flex flex-col gap-3 text-sm text-gray-500 dark:text-gray-400 sm:flex-row sm:items-center sm:justify-between">
                  <p>Показано {visibleArchiveTickets.length} из {filteredArchiveTickets.length} архивных заявок</p>
                  {visibleArchiveTickets.length < filteredArchiveTickets.length && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setArchiveVisibleCount(count => count + RESULT_BATCH_SIZE)}
                      className="w-full rounded-full sm:w-auto"
                    >
                      <ArrowDown className="h-4 w-4" />
                      Показать ещё
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="archive" className="space-y-5">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center gap-2 text-sm font-bold text-gray-600 dark:text-gray-300">
              <Archive className="h-4 w-4" />
              Архивные заявки доступны только для просмотра и управленческого анализа.
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ServiceMetricCard title="Всего в архиве" value={archiveMetrics.total} caption="Закрытые заявки" tone="neutral" />
            <ServiceMetricCard title="Закрыто за месяц" value={archiveMetrics.closedThisMonth} caption="Финальный статус" tone="green" />
            <ServiceMetricCard title="Среднее закрытие" value={archiveMetrics.averageClosureDays} caption="Дней по закрытым" tone="amber" />
            <ServiceMetricCard title="Найдено" value={filteredArchiveTickets.length} caption="По текущим фильтрам" tone="blue" />
          </div>

          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm shadow-slate-200/40 dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
            <div className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_220px_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Поиск в архиве: № заявки, техника, клиент..."
                  value={archiveSearch}
                  onChange={(e) => setArchiveSearch(e.target.value)}
                  className="h-11 pl-10"
                />
              </div>
              <Select value={archiveStatusFilter} onValueChange={(value) => setArchiveStatusFilter(value as 'closed')}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Статус" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="closed">Закрыта</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" variant="secondary" className="h-11" onClick={() => setArchiveSearch('')}>
                Сбросить
              </Button>
            </div>
          </section>

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm shadow-slate-200/40 dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
            <div className="hidden grid-cols-[minmax(170px,0.8fr)_120px_minmax(220px,1fr)_minmax(180px,0.9fr)_120px_auto] gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 text-xs font-bold uppercase text-gray-500 dark:border-white/10 dark:bg-white/[0.04] lg:grid">
              <div>№ заявки / дата</div>
              <div>Статус</div>
              <div>Техника</div>
              <div>Клиент / проблема</div>
              <div>Закрыта</div>
              <div></div>
            </div>
            {visibleArchiveTickets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 dark:bg-white/8">
                  <Search className="h-7 w-7 text-gray-400 dark:text-gray-500" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">Архивные заявки не найдены</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Попробуйте изменить поиск по архиву.</p>
              </div>
            ) : (
              visibleArchiveTickets.map((ticket, index) => {
                const inventory = getTicketInventory(ticket);
                const serialNumber = ticket.serialNumber || '';
                const clientDetails = getTicketClientDetails(ticket, clientLookup);
                const description = ticket.description ? truncateText(ticket.description, 90) : '';
                const openTicket = () => openTicketCard(ticket.id);

                return (
                  <div
                    key={ticket.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Открыть архивную заявку ${ticket.id}`}
                    onClick={openTicket}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openTicket();
                      }
                    }}
                    className={`grid cursor-pointer gap-3 border-b border-gray-100 px-4 py-3 text-gray-600 transition-colors last:border-b-0 hover:bg-gray-50 dark:border-white/6 dark:text-gray-300 dark:hover:bg-white/[0.04] lg:grid-cols-[minmax(170px,0.8fr)_120px_minmax(220px,1fr)_minmax(180px,0.9fr)_120px_auto] lg:items-start ${
                      index % 2 === 0 ? 'bg-gray-50/60 dark:bg-white/[0.015]' : 'bg-white dark:bg-transparent'
                    }`}
                  >
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
                      <div className="mt-0.5 truncate text-xs text-gray-500">{ticket.reason || description || '—'}</div>
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-300">{ticket.closedAt ? formatShortDate(ticket.closedAt) : '—'}</div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openTicket();
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[--color-primary] dark:hover:bg-white/10"
                      title="Открыть полную карточку"
                      aria-label={`Открыть полную карточку архивной заявки ${ticket.id}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {filteredArchiveTickets.length > 0 && (
            <div className="flex flex-col gap-3 text-sm text-gray-500 dark:text-gray-400 sm:flex-row sm:items-center sm:justify-between">
              <p>Показано {visibleArchiveTickets.length} из {filteredArchiveTickets.length} архивных заявок</p>
              {visibleArchiveTickets.length < filteredArchiveTickets.length && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setArchiveVisibleCount(count => count + RESULT_BATCH_SIZE)}
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

        <TabsContent value="repeat-breakdowns" className="space-y-5">
          <RepeatBreakdownsTab
            data={repeatBreakdownsQuery.data}
            isLoading={repeatBreakdownsQuery.isFetching && !repeatBreakdownsQuery.data}
            error={repeatBreakdownsQuery.error}
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
