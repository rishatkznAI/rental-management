import React, { useState, useMemo, useEffect } from 'react';
import {
  Wrench, DollarSign, Calendar, ShieldAlert, Ban, PackageX, ClipboardX, Zap,
} from 'lucide-react';
import { formatCurrency, formatDate } from '../lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useEquipmentList, useManagementActionAttention } from '../hooks/useEquipment';
import { useRentalsList, useGanttData } from '../hooks/useRentals';
import { financeService } from '../services/finance.service';
import { managerMyPlanService, type ManagerMyPlanResponse } from '../services/manager-my-plan.service';
import { reportsService, type MechanicsWorkloadReport } from '../services/reports.service';
import { deliveriesService } from '../services/deliveries.service';
import { crmDealsService } from '../services/crm-deals.service';
import { useServiceTicketsList } from '../hooks/useServiceTickets';
import { isRegularServiceTicket } from '../lib/serviceTicketKind.js';
import { useClientsList } from '../hooks/useClients';
import { usePaymentAllocationsList, usePaymentsList } from '../hooks/usePayments';
import { useDocumentsList } from '../hooks/useDocuments';
import { useDebtCollectionPlans } from '../hooks/useDebtCollectionPlans';
import { useAuth } from '../contexts/AuthContext';
import { isMechanicRole } from '../lib/userStorage';
import { usePermissions } from '../lib/permissions';
import { isCrmEnabled } from '../lib/features';
import type {
  Equipment,
  Rental,
  ServiceTicket,
  Payment,
  PaymentAllocation,
  Delivery,
  ManagementActionAttentionItem,
  CrmDeal,
} from '../types';
import type { GanttRentalData } from '../mock-data';
import { buildClientDebtAgingRows, buildClientFinancialSnapshots, buildClientReceivables, buildRentalDebtRows, shouldCountRental } from '../lib/finance';
import { calculateRentalBilling, getRentalBillingAmount } from '../lib/rentalDowntimeFlow.js';
import { buildDocumentControl, isUnsignedDocument } from '../lib/documentControl.js';
import { alertHasValidSource, buildCompanyHealthModel } from '../lib/dashboardCompanyHealth.js';
import { buildCanonicalDebtAging, mapRentalDebtRowsForCompanyHealth } from '../lib/companyHealthDebtAging.js';
import { tasksCenterService } from '../services/tasks-center.service';
import {
  buildActiveRentalFleetLookup,
  calculateCurrentFleetUtilization,
  getRentalEquipmentKey,
  isActiveRentalFleetEquipment,
} from '../lib/fleetUtilization';
import { localDateKey } from '../lib/serviceDayPlan.js';
import {
  ExecutiveCockpitV2,
  type ExecutiveAttentionSignal,
  type ExecutiveCockpitV2Props,
  type ExecutiveDataState,
  type ExecutiveKpi,
} from '../components/dashboard/ExecutiveCockpitV2';

// ─── helpers ───────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isOverdue(plannedReturnDate: string): boolean {
  return new Date(plannedReturnDate) < startOfDay(new Date());
}

function isOpenRentalStatus(status: GanttRentalData['status']): boolean {
  return status === 'active' || status === 'confirmed' || status === 'return_planned';
}


function formatCountLabel(value: number, one: string, few: string, many: string) {
  const abs = Math.abs(value) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}


function estimateServiceTicketHours(ticket: ServiceTicket) {
  const text = [
    ticket.reason,
    ticket.description,
    ticket.type,
    ticket.scenario,
    ticket.serviceKind,
  ].filter(Boolean).join(' ').toLowerCase();
  let hours = 4;
  if (text.includes('диагност') || text.includes('diagnost')) hours = 1.5;
  else if (text.includes('пто') || text.includes('что')) hours = 4;
  else if (text.includes('то') || text.includes('maintenance')) hours = 3;
  else if (text.includes('pdi')) hours = 4;
  else if (text.includes('рекламац') || text.includes('warranty')) hours = 5;
  else if (text.includes('сроч') || text.includes('critical') || text.includes('авари')) hours = 8;
  else if (text.includes('ремонт') || text.includes('repair')) hours = 6;
  if (text.includes('выезд') || text.includes('field') || text.includes('site')) hours += 2;
  return hours;
}

function servicePriorityMultiplier(priority?: string | null) {
  const normalized = String(priority || '').toLowerCase();
  if (normalized === 'critical' || normalized.includes('крит')) return 1.6;
  if (normalized === 'high' || normalized.includes('выс')) return 1.3;
  if (normalized === 'low' || normalized.includes('низ')) return 0.8;
  return 1;
}

function serviceOverdueMultiplier(ticket: ServiceTicket, todayKey: string) {
  const deadline = toDateKey(ticket.dueDate || ticket.deadline || ticket.plannedDate || ticket.scheduledDate || ticket.targetDate);
  if (!deadline || deadline > todayKey) return 1;
  if (deadline === todayKey) return 1.15;
  const days = Math.max(1, Math.ceil((new Date(`${todayKey}T00:00:00`).getTime() - new Date(`${deadline}T00:00:00`).getTime()) / 86400000));
  if (days <= 2) return 1.3;
  if (days <= 5) return 1.5;
  return 1.8;
}

function toDateKey(value?: string | Date | null) {
  if (!value) return '';
  const raw = typeof value === 'string' ? value.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return localDateKey(parsed);
}



function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function parseOptionalDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isDateInRange(value: string | Date | null | undefined, start: Date, end: Date) {
  const parsed = value instanceof Date ? value : parseOptionalDate(value);
  if (!parsed) return false;
  return parsed >= start && parsed <= end;
}

function overlapsRange(startValue: string | null | undefined, endValue: string | null | undefined, rangeStart: Date, rangeEnd: Date) {
  const start = parseOptionalDate(startValue);
  const end = parseOptionalDate(endValue) ?? start;
  if (!start || !end) return false;
  return start <= rangeEnd && end >= rangeStart;
}

function buildDayBuckets(start: Date, end: Date) {
  const buckets: Array<{ key: string; label: string }> = [];
  const cursor = startOfDay(start);
  const last = startOfDay(end);
  while (cursor <= last) {
    buckets.push({
      key: localDateKey(cursor),
      label: cursor.toLocaleDateString('ru-RU', { day: '2-digit' }),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return buckets;
}


const DASHBOARD_IGNORED_PAYMENT_STATUSES = new Set([
  'cancelled',
  'canceled',
  'void',
  'error',
  'failed',
  'closed',
  'deleted',
  'reversed',
]);

function getDashboardPaidAmount(payment: Payment) {
  const status = String(payment.status || '').trim().toLowerCase();
  if (DASHBOARD_IGNORED_PAYMENT_STATUSES.has(status)) return 0;
  if (typeof payment.paidAmount === 'number') {
    return Number.isFinite(payment.paidAmount) ? Math.max(0, payment.paidAmount) : 0;
  }
  if (status === 'paid') {
    const amount = Number(payment.amount);
    return Number.isFinite(amount) ? Math.max(0, amount) : 0;
  }
  return 0;
}

function normalizeRentalEquipmentRefs(value: Rental['equipment'] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}




function attentionAssigneeLabel(item: ManagementActionAttentionItem) {
  return item.assignedToName || (item.isUnassigned ? 'Без ответственного' : 'Назначен');
}

function attentionDueLabel(item: ManagementActionAttentionItem) {
  if (item.isOverdue) return item.dueDate ? `Просрочено с ${formatDate(item.dueDate)}` : 'Просрочено';
  if (item.isDueToday) return 'Сегодня';
  return item.dueDate ? formatDate(item.dueDate) : item.accountabilityLabel || 'Срок не задан';
}


type DashboardTone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'violet';

































type CompanyHealthScoreDirection = {
  key: string;
  title: string;
  score: number | null;
  weight: number;
  availableWeight?: number;
  totalWeight?: number;
  rawCoveragePercent?: number;
  coveragePercent?: number;
  dataConfidence?: 'high' | 'medium' | 'low' | 'insufficient';
  isEligible?: boolean;
  coverageAdjustedScore?: number | null;
  weightedContribution: number;
  weightedDeficit?: number;
  primaryMetric: string;
  shortReason: string;
  reason?: string;
  recommendedAction?: string;
  riskLevel?: 'critical' | 'risk' | 'stable' | 'good' | 'excellent' | 'insufficient';
  insufficientData?: boolean;
  hasMissingSubMetrics?: boolean;
  subMetrics?: Array<{
    key: string;
    title: string;
    score: number | null;
    isScorable: boolean;
    weight: number;
    contribution: number;
    sourceStatus: 'real' | 'derived' | 'missing' | 'ambiguous';
    reason: string;
    details?: string[];
  }>;
};

type CompanyHealthScoreBreakdown = {
  totalScore: number | null;
  rawScore?: number | null;
  adjustedScore?: number | null;
  rawTotalCoveragePercent?: number;
  totalCoveragePercent?: number;
  confidence?: 'high' | 'medium' | 'low' | 'insufficient';
  isPreliminary?: boolean;
  displayLabel?: string;
  excludedDirections?: string[];
  missingCriticalMetrics?: Array<{ key: string; title: string; direction: string; sourceStatus: 'real' | 'derived' | 'missing' | 'ambiguous' }>;
  maxScore: number;
  directions: CompanyHealthScoreDirection[];
  weakestDirections: CompanyHealthScoreDirection[];
  strongestDirections: CompanyHealthScoreDirection[];
  focusDirections?: CompanyHealthScoreDirection[];
};





function formatHealthConfidence(confidence?: 'high' | 'medium' | 'low' | 'insufficient') {
  if (confidence === 'high') return 'высокое';
  if (confidence === 'medium') return 'среднее';
  if (confidence === 'low') return 'низкое';
  return 'недостаточно данных';
}






// ─── main component ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth();
  const { can, canReadCollection } = usePermissions();
  const [executiveFreshnessNow, setExecutiveFreshnessNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setExecutiveFreshnessNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const canViewReports = can('view', 'reports');
  const canViewFinance = can('view', 'finance');
  const canViewPayments = can('view', 'payments');
  const canViewMoney = canViewFinance || canViewPayments;
  const canViewDocuments = can('view', 'documents');
  const canViewService = can('view', 'service');
  const canViewEquipment = can('view', 'equipment');
  const canViewClients = can('view', 'clients');
  const canViewRentals = can('view', 'rentals');
  const canViewPlanner = can('view', 'planner');
  const canViewDeliveries = can('view', 'deliveries');
  const canViewTasksCenter = can('view', 'tasks_center');
  const canViewCrm = isCrmEnabled && can('view', 'crm') && canReadCollection('crm_deals');
  const canReadFinanceOperations = canReadCollection('finance_operations');
  const canViewManagerMyPlan = Boolean(
    canViewRentals && (
      user?.role === 'Менеджер по аренде'
      || user?.role === 'Администратор'
      || user?.role === 'Офис-менеджер'
      || user?.role === 'Руководитель'
    )
  );

  // All data via react-query (auto-refetches on window focus by default)
  const equipmentQuery = useEquipmentList({ enabled: canViewEquipment });
  const equipment = equipmentQuery.data ?? [];
  const rentalsQuery = useRentalsList({ enabled: canViewRentals });
  const rentals = rentalsQuery.data ?? [];
  const serviceTicketsQuery = useServiceTicketsList({ enabled: canViewService });
  const rawTickets = serviceTicketsQuery.data ?? [];
  const tickets = useMemo(() => rawTickets.filter(isRegularServiceTicket), [rawTickets]);
  const clientsQuery = useClientsList({ enabled: canViewClients });
  const clients = clientsQuery.data ?? [];
  const paymentsQuery = usePaymentsList({ enabled: canViewMoney });
  const payments = paymentsQuery.data ?? [];
  const paymentAllocationsQuery = usePaymentAllocationsList({ enabled: canViewMoney });
  const paymentAllocations = paymentAllocationsQuery.data ?? [];
  const documentsQuery = useDocumentsList({ enabled: canViewDocuments });
  const documents = documentsQuery.data ?? [];
  useDebtCollectionPlans({ enabled: canViewMoney });
  useQuery({
    queryKey: ['tasks-center', 'dashboard-summary'],
    queryFn: tasksCenterService.getAll,
    enabled: canViewTasksCenter,
    staleTime: 60_000,
  });
  const canViewAttentionBlock = Boolean(
    user?.role === 'Администратор'
    || user?.role === 'Руководитель'
    || user?.role === 'Коммерческий директор'
    || user?.role === 'Офис-менеджер'
    || user?.role === 'Менеджер по аренде'
  );
  const actionAttentionQuery = useManagementActionAttention({
    enabled: canViewAttentionBlock && canViewEquipment,
  });
  const ganttRentalsQuery = useGanttData({ enabled: canViewRentals || canViewPlanner });
  const ganttRentals = ganttRentalsQuery.data ?? [];
  const companyHealthCashFlowMonth = monthKey(new Date());
  const companyHealthCashFlowQuery = useQuery({
    queryKey: ['finance', 'cash-flow', 'company-health', companyHealthCashFlowMonth],
    queryFn: () => {
      const current = new Date();
      const dateFrom = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
      const dateTo = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return financeService.getCashFlow({
        dateFrom,
        dateTo,
        groupBy: 'month',
        mode: 'factual',
        includeVat: true,
        includeDepreciation: false,
      });
    },
    enabled: canViewFinance && canReadFinanceOperations,
    staleTime: 1000 * 60 * 2,
  });
  const deliveriesQuery = useQuery<Delivery[]>({
    queryKey: ['deliveries', 'dashboard'],
    queryFn: deliveriesService.getAll,
    enabled: canViewDeliveries && canReadCollection('deliveries'),
    staleTime: 1000 * 60 * 2,
  });
  const deliveries = deliveriesQuery.data ?? [];
  const crmDealsQuery = useQuery<CrmDeal[]>({
    queryKey: ['crm-deals', 'dashboard-executive'],
    queryFn: crmDealsService.getAll,
    enabled: canViewCrm,
    staleTime: 1000 * 60 * 2,
  });
  useQuery<ManagerMyPlanResponse>({
    queryKey: ['manager-my-plan', user?.id],
    queryFn: managerMyPlanService.get,
    enabled: canViewManagerMyPlan,
    staleTime: 1000 * 60 * 2,
  });
  const { data: mechanicWorkload } = useQuery<MechanicsWorkloadReport>({
    queryKey: ['reports', 'mechanicsWorkload'],
    queryFn: reportsService.getMechanicsWorkload,
    enabled: canViewReports,
  });

  // For modal props that expect Equipment[]
  const equipmentList = equipment as Equipment[];
  const equipmentById = useMemo(
    () => new Map(equipmentList.map(item => [item.id, item])),
    [equipmentList],
  );
  const uniqueEquipmentByInventory = useMemo(() => {
    const counts = new Map<string, number>();
    equipmentList.forEach(item => {
      if (!item.inventoryNumber) return;
      counts.set(item.inventoryNumber, (counts.get(item.inventoryNumber) || 0) + 1);
    });
    const uniqueMap = new Map<string, Equipment>();
    equipmentList.forEach(item => {
      if (!item.inventoryNumber) return;
      if ((counts.get(item.inventoryNumber) || 0) === 1) {
        uniqueMap.set(item.inventoryNumber, item);
      }
    });
    return uniqueMap;
  }, [equipmentList]);
  const activeRentalFleetLookup = useMemo(
    () => buildActiveRentalFleetLookup(equipmentList),
    [equipmentList],
  );

  const today = startOfDay(new Date());
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = endOfMonth(today);
  const monthDayBuckets = useMemo(() => buildDayBuckets(monthStart, monthEnd), [monthStart, monthEnd]);
  const monthPeriodLabel = today.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  const monthRangeLabel = `${monthStart.toLocaleDateString('ru-RU')} — ${monthEnd.toLocaleDateString('ru-RU')}`;
  const tomorrowStart = new Date(today);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const dayAfterTomorrowStart = new Date(today);
  dayAfterTomorrowStart.setDate(dayAfterTomorrowStart.getDate() + 2);
  const clientFinancials = useMemo(
    () => buildClientFinancialSnapshots(clients, ganttRentals, payments, paymentAllocations as PaymentAllocation[]),
    [clients, ganttRentals, paymentAllocations, payments],
  );
  const rentalDebtRows = useMemo(
    () => buildRentalDebtRows(ganttRentals, payments, paymentAllocations as PaymentAllocation[]),
    [ganttRentals, paymentAllocations, payments],
  );
  const clientReceivables = useMemo(
    () => buildClientReceivables(clients, rentalDebtRows),
    [clients, rentalDebtRows],
  );
  const companyHealthDebtAging = useMemo(
    () => buildCanonicalDebtAging(mapRentalDebtRowsForCompanyHealth(rentalDebtRows), {
      sourceAvailable: paymentsQuery.isSuccess && paymentAllocationsQuery.isSuccess && ganttRentalsQuery.isSuccess,
      asOfDate: toDateKey(today),
      // app_settings has no proven company timezone contract; the aging model keeps this ambiguous.
      companyTimeZone: undefined,
    }),
    [ganttRentalsQuery.isSuccess, paymentAllocationsQuery.isSuccess, paymentsQuery.isSuccess, rentalDebtRows, today],
  );
  const clientDebtAgingRows = useMemo(
    () => buildClientDebtAgingRows(clients, rentalDebtRows, toDateKey(today)),
    [clients, rentalDebtRows, today],
  );
  const computedClients = useMemo(
    () => clients.map(client => {
      const financial = clientFinancials.find(item => item.clientId === client.id);
      return financial
        ? { ...client, debt: financial.currentDebt, totalRentals: financial.totalRentals, lastRentalDate: financial.lastRentalDate }
        : client;
    }),
    [clients, clientFinancials],
  );

  // Менеджер по аренде видит только свои аренды в KPI
  const isManagerRole = user?.role === 'Менеджер по аренде';
  const currentUserName = user?.name ?? '';
  const shouldShowRentalAttention = !isMechanicRole(user?.role);
  const viewRentals = isManagerRole && currentUserName
    ? rentals.filter(r => r.manager === currentUserName)
    : rentals;
  const viewPlannerRentals = isManagerRole && currentUserName
    ? ganttRentals.filter(r => r.manager === currentUserName)
    : ganttRentals;
  const actionAttention = actionAttentionQuery.data;
  const topAttentionActions = useMemo(() => {
    const byId = new Map<string, ManagementActionAttentionItem>();
    [
      ...(actionAttention?.groups?.critical ?? []),
      ...(actionAttention?.groups?.topLoss ?? []),
      ...(actionAttention?.groups?.unassigned ?? []),
      ...(actionAttention?.groups?.today ?? []),
    ].forEach(item => {
      if (item?.actionId && !byId.has(item.actionId)) byId.set(item.actionId, item);
    });
    const priorityRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    return Array.from(byId.values())
      .sort((left, right) =>
        Number(right.isOverdue) - Number(left.isOverdue)
        || Number((priorityRank[right.priority] || 0) >= 3) - Number((priorityRank[left.priority] || 0) >= 3)
        || Number(right.estimatedLoss || 0) - Number(left.estimatedLoss || 0)
        || Number(right.isUnassigned) - Number(left.isUnassigned)
        || Number(right.isDueToday) - Number(left.isDueToday)
        || (priorityRank[right.priority] || 0) - (priorityRank[left.priority] || 0)
      )
      .slice(0, 3);
  }, [actionAttention]);
  const documentControl = useMemo(
    () => buildDocumentControl({
      rentals: viewRentals,
      documents,
      clients,
      equipment: equipmentList,
      today: toDateKey(today),
      limit: 10,
    }),
    [clients, documents, equipmentList, today, viewRentals],
  );

  // Dashboard operational KPIs should use planner rentals as the source of truth.
  const activeRentalsList = useMemo(
    () => viewPlannerRentals.filter(r => r.status === 'active'),
    [viewPlannerRentals],
  );
  const reservedRentalsList = useMemo(
    () => viewPlannerRentals.filter(r => r.status === 'created'),
    [viewPlannerRentals],
  );
  const rentedEquipmentKeys = useMemo(() => {
    const keys = new Set<string>();
    activeRentalsList.forEach(rental => {
      const key = getRentalEquipmentKey(rental, activeRentalFleetLookup);
      if (key) keys.add(key);
    });
    return keys;
  }, [activeRentalFleetLookup, activeRentalsList]);
  const reservedEquipmentKeys = useMemo(() => {
    const keys = new Set<string>();
    reservedRentalsList.forEach(rental => {
      const key = getRentalEquipmentKey(rental, activeRentalFleetLookup);
      if (key && !rentedEquipmentKeys.has(key)) keys.add(key);
    });
    return keys;
  }, [activeRentalFleetLookup, rentedEquipmentKeys, reservedRentalsList]);

  // Utilization
  const totalEquipment = equipment.length;
  const fleetUtilization = useMemo(
    () => calculateCurrentFleetUtilization(equipmentList, activeRentalsList),
    [activeRentalsList, equipmentList],
  );
  const activeEquipment = fleetUtilization.activeEquipment;
  const rentedEquipment = fleetUtilization.rentedEquipment;
  const availableEquipment = equipmentList.filter(e =>
    isActiveRentalFleetEquipment(e)
    && e.status !== 'in_service'
    && !rentedEquipmentKeys.has(e.id)
    && !reservedEquipmentKeys.has(e.id),
  ).length;
  const utilization = fleetUtilization.utilization;

  const overdueRentalsList = viewPlannerRentals.filter(r =>
    isOpenRentalStatus(r.status) && isOverdue(r.endDate)
  );

  // Equipment in service
  const equipmentInServiceList = equipment.filter(e => e.status === 'in_service');
  const todayKey = toDateKey(today);

  // Week revenue: sum of prices of rentals that started in the last 7 days, OR active rentals

  // Debt
  const overduePayments = rentalDebtRows.filter(row =>
    (row.expectedPaymentDate && row.expectedPaymentDate < todayKey) || row.endDate < todayKey,
  );
  const overdueReceivablesAmount = overduePayments.reduce((sum, row) => sum + row.outstanding, 0);
  const overdueReceivablesClients = new Set(
    overduePayments
      .map(row => row.clientId || row.client)
      .filter(Boolean),
  ).size;
  const totalDebt = clientReceivables.reduce((sum, row) => sum + row.currentDebt, 0);
  const totalReceivablesAvailable = clientsQuery.isSuccess
    && paymentsQuery.isSuccess
    && paymentAllocationsQuery.isSuccess
    && ganttRentalsQuery.isSuccess;
  const hasUnagedOrUnresolvedReceivables = clientReceivables.some(row =>
    row.currentDebt > 0 && (row.manualDebt > 0 || !row.counterpartyId),
  );
  // Month debt: overdue rental debt this month

  // Upcoming returns (next 3 days, not overdue)
  const soon3 = new Date(today);
  soon3.setDate(soon3.getDate() + 3);
  const upcomingReturns = viewPlannerRentals.filter(r => {
    if (r.status !== 'active') return false;
    const ret = new Date(r.endDate);
    return ret >= today && ret <= soon3;
  });

  // Critical service tickets
  const criticalTickets = tickets.filter(t =>
    (t.priority === 'critical' || t.priority === 'high') && t.status !== 'closed'
  );

  // Recent rentals (last 10, sorted newest first)

  // ── Manager stats for current user ─────────────────────────────────────────
  // (currentUserName уже объявлен выше)

  // Debt for current manager
  const ticketsWaitingParts = tickets.filter(t => t.status === 'waiting_parts');
  const openServiceTickets = tickets.filter(t => t.status !== 'closed');
  const unassignedServiceTickets = openServiceTickets.filter(
    t => !t.assignedMechanicId && !t.assignedMechanicName && !t.assignedTo,
  );
  const unsignedDocumentsCount = documentControl.kpi.unsignedDocuments;
  const adminMechanicRows = useMemo(() => {
    const workloadSummary = mechanicWorkload?.summary ?? [];
    const names = Array.from(new Set([
      ...workloadSummary.map(item => item.mechanicName).filter(Boolean),
      ...tickets.map(item => item.assignedMechanicName || item.assignedTo).filter(Boolean),
    ])).sort((a, b) => a.localeCompare(b, 'ru'));

    return names.map(name => {
      const summary = workloadSummary.find(item => item.mechanicName === name);
      const assignedTickets = tickets.filter(item =>
        item.status !== 'closed' && (item.assignedMechanicName === name || item.assignedTo === name),
      );
      const readyTickets = assignedTickets.filter(item => item.status === 'ready').length;
      const waitingPartsTickets = assignedTickets.filter(item => item.status === 'waiting_parts').length;
      const criticalTicketsCount = assignedTickets.filter(item => item.priority === 'critical' || item.priority === 'high').length;

      return {
        name,
        openTickets: assignedTickets.length,
        readyTickets,
        waitingPartsTickets,
        criticalTickets: criticalTicketsCount,
        repairsCount: summary?.repairsCount ?? 0,
        worksCount: summary?.worksCount ?? 0,
        totalNormHours: summary?.totalNormHours ?? 0,
        partsCost: summary?.partsCost ?? 0,
        equipmentCount: summary?.equipmentCount ?? 0,
      };
    }).sort((a, b) =>
      b.openTickets - a.openTickets
      || b.repairsCount - a.repairsCount
      || b.totalNormHours - a.totalNormHours
      || a.name.localeCompare(b.name, 'ru')
    );
  }, [mechanicWorkload, tickets]);

  // ── Extended KPIs ───────────────────────────────────────────────────────────
  const UTILIZATION_TARGET = 85;

  // Equipment in active use (rented + reserved)
  const inactiveEquipment = equipment.filter(e => e.status === 'inactive').length;

  // Rentals ending today
  const rentalsEndingToday = viewPlannerRentals.filter(r => {
    const ret = new Date(r.endDate);
    return r.status === 'active' && ret >= today && ret < tomorrowStart;
  });

  // Max overdue days
  const maxOverdueDays = overdueRentalsList.length > 0
    ? Math.max(...overdueRentalsList.map(r => {
        const diffMs = today.getTime() - new Date(r.endDate).getTime();
        return Math.max(1, Math.ceil(diffMs / 86400000));
      }))
    : 0;

  // Service tickets waiting for parts
  const repeatFailureRows = (mechanicWorkload?.repeatFailures ?? []).filter(item => item.repairsCount > 1);
  const serviceInDaysRows = openServiceTickets
    .map(ticket => {
      const createdAt = new Date(ticket.createdAt);
      const createdAtTime = Number.isNaN(createdAt.getTime()) ? today.getTime() : createdAt.getTime();
      const daysInService = Math.max(1, Math.ceil((today.getTime() - createdAtTime) / 86400000));
      const linkedEquipment =
        (ticket.equipmentId && equipmentById.get(ticket.equipmentId)) ||
        (ticket.inventoryNumber && uniqueEquipmentByInventory.get(ticket.inventoryNumber)) ||
        null;
      return {
        ...ticket,
        daysInService,
        equipmentLinkId: linkedEquipment?.id || ticket.equipmentId || '',
        equipmentLabel: linkedEquipment ? `${linkedEquipment.manufacturer} ${linkedEquipment.model}` : ticket.equipment,
        inventoryLabel: linkedEquipment?.inventoryNumber || ticket.inventoryNumber || '',
      };
    })
    .sort((a, b) => b.daysInService - a.daysInService);
  const averageServiceDays = serviceInDaysRows.length > 0
    ? Math.round(serviceInDaysRows.reduce((sum, row) => sum + row.daysInService, 0) / serviceInDaysRows.length)
    : 0;
  const overdueServiceTickets = serviceInDaysRows.filter(row =>
    row.plannedDate && toDateKey(row.plannedDate) < todayKey,
  );
  const activeDeliveries = deliveries.filter(delivery =>
    delivery.status !== 'completed' && delivery.status !== 'cancelled',
  );
  const overdueDeliveries = activeDeliveries.filter(delivery => {
    const deliveryDate = toDateKey(delivery.transportDate || delivery.neededBy);
    return Boolean(deliveryDate) && deliveryDate < todayKey;
  });
  const unassignedDeliveries = activeDeliveries.filter(delivery => !delivery.carrierId && !delivery.carrierName);

  const rentalsStartedThisMonth = viewPlannerRentals.filter(rental =>
    isDateInRange(rental.startDate, monthStart, monthEnd),
  );
  const rentalsIntersectingThisMonth = viewPlannerRentals.filter(rental =>
    overlapsRange(rental.startDate, rental.endDate, monthStart, monthEnd),
  );
  const rentalsReturningThisMonth = viewPlannerRentals.filter(rental =>
    isDateInRange(rental.endDate, monthStart, monthEnd),
  );
  const revenueRentalsStartedThisMonth = rentalsStartedThisMonth.filter(shouldCountRental);
  const monthlyRevenue = revenueRentalsStartedThisMonth.reduce((sum, rental) => sum + getRentalBillingAmount(rental), 0);
  const monthlyPayments = payments.filter(payment =>
    isDateInRange(payment.paidDate || payment.dueDate, monthStart, monthEnd),
  );
  const monthlyPaidAmount = monthlyPayments.reduce((sum, payment) => sum + getDashboardPaidAmount(payment), 0);
  const actualReceiptPayments = payments.filter(payment =>
    Boolean(payment.paidDate) && isDateInRange(payment.paidDate, monthStart, monthEnd) && getDashboardPaidAmount(payment) > 0,
  );
  const actualReceiptsAmount = actualReceiptPayments.reduce((sum, payment) => sum + getDashboardPaidAmount(payment), 0);
  const hasUndatedActualReceipts = payments.some(payment => getDashboardPaidAmount(payment) > 0 && !payment.paidDate);
  const actualReceiptsAvailable = paymentsQuery.isSuccess && !hasUndatedActualReceipts;
  const overdueReceivablesAvailable = companyHealthDebtAging.overdueReceivablesAvailable === true;
  const factualCashFlowItems = companyHealthCashFlowQuery.data?.items ?? [];
  const factualManualInflows = factualCashFlowItems
    .filter(item => item.direction === 'incoming' && item.source === 'finance_operations')
    .reduce((sum, item) => sum + Math.max(0, Number(item.amount) || 0), 0);
  const factualOperatingOutflows = factualCashFlowItems
    .filter(item => item.direction === 'outgoing')
    .reduce((sum, item) => sum + Math.max(0, Number(item.amount) || 0), 0);
  const hasRecordedOperatingOutflow = factualCashFlowItems.some(item => item.direction === 'outgoing');
  const actualOperatingInflowsAmount = actualReceiptsAmount + factualManualInflows;
  const actualOperatingInflowsAvailable = actualReceiptsAvailable && companyHealthCashFlowQuery.isSuccess;
  const actualOperatingOutflowsAvailable = companyHealthCashFlowQuery.isSuccess && hasRecordedOperatingOutflow;





  const serviceLoadTotal = openServiceTickets.length;
  const serviceCapacityHours = adminMechanicRows.length * 6;
  const serviceEstimatedHours = openServiceTickets.reduce((sum, ticket) => {
    if (ticket.status === 'waiting_parts') return sum;
    return sum + estimateServiceTicketHours(ticket) * servicePriorityMultiplier(ticket.priority) * serviceOverdueMultiplier(ticket, todayKey);
  }, 0);
  const serviceLoadPercent = serviceCapacityHours > 0
    ? Math.min(140, Math.round((serviceEstimatedHours / serviceCapacityHours) * 100))
    : serviceLoadTotal > 0
      ? null
      : 0;

  useEffect(() => {
    document.body.classList.add('rentcore-dashboard-reference-mode');
    return () => document.body.classList.remove('rentcore-dashboard-reference-mode');
  }, []);

  // Equipment in service with critical tickets (blocking rentals)


  // ── Alert items ─────────────────────────────────────────────────────────────
  type AlertPriority = 'critical' | 'high' | 'medium';
  interface AlertItem {
    id: string;
    priority: AlertPriority;
    icon: React.ElementType;
    category: string;
    title: string;
    entity: string;
    detail: string;
    link: string;
    linkLabel: string;
  }

  const rawAlertItems: AlertItem[] = [];

  // 1. Просроченные возвраты (критично)
  if (shouldShowRentalAttention) {
    overdueRentalsList.forEach(r => {
      const days = Math.max(1, Math.ceil((today.getTime() - new Date(r.endDate).getTime()) / 86400000));
      rawAlertItems.push({
        id: `overdue-return-${r.id}`,
        priority: 'critical',
        icon: Calendar,
        category: 'Просроченный возврат',
        title: r.client,
        entity: r.equipmentInv || r.id,
        detail: `Просрочка ${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}`,
        link: '/rentals',
        linkLabel: 'Открыть планировщик',
      });
    });
  }

  // 2. Просроченные платежи (критично если > 7 дней, иначе высокий)
  if (canViewMoney) {
    overduePayments.forEach(p => {
      const compareDate = p.expectedPaymentDate || p.endDate;
      const days = Math.max(0, Math.ceil((today.getTime() - new Date(compareDate).getTime()) / 86400000));
      rawAlertItems.push({
        id: `overdue-pay-${p.rentalId}`,
        priority: days > 7 ? 'critical' : 'high',
        icon: DollarSign,
        category: 'Неоплаченный счёт',
        title: p.client,
        entity: p.rentalId ? `Аренда ${p.rentalId}` : 'Дебиторка',
        detail: `${formatCurrency(p.outstanding)} · ${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'} просрочки`,
        link: `/rentals/${p.rentalId}`,
        linkLabel: 'Открыть аренду',
      });
    });
  }

  // 3. Критические сервисные заявки
  criticalTickets.forEach(t => {
    rawAlertItems.push({
      id: `ticket-${t.id}`,
      priority: t.priority === 'critical' ? 'critical' : 'high',
      icon: Wrench,
      category: 'Сервисная заявка',
      title: t.equipment,
      entity: `${t.id} · ${t.reason}`,
      detail: t.status === 'waiting_parts' ? 'Ожидание запчастей' : t.priority === 'critical' ? 'Критический приоритет' : 'Высокий приоритет',
      link: `/service/${t.id}`,
      linkLabel: 'Открыть заявку',
    });
  });

  // 4. Техника не готова к выдаче (аренды стартующие сегодня/завтра, но техника в сервисе)
  const soon2 = new Date(today);
  soon2.setDate(soon2.getDate() + 2);
  const startingSoonRentals = viewPlannerRentals.filter(r => {
    const s = new Date(r.startDate);
    return r.status === 'created' && s >= today && s <= soon2;
  });
  startingSoonRentals.forEach(r => {
    const blockedEq = normalizeRentalEquipmentRefs(r.equipment)
      .map(eqName => {
        const byUniqueInventory = uniqueEquipmentByInventory.get(eqName);
        if (byUniqueInventory) return byUniqueInventory;
        const exactById = equipmentById.get(eqName);
        if (exactById) return exactById;
        return null;
      })
      .filter((item): item is Equipment => Boolean(item))
      .filter(item => item.status === 'in_service')
      .map(item => item.inventoryNumber || `${item.manufacturer} ${item.model}`);
    if (blockedEq.length > 0) {
      const isToday = new Date(r.startDate) < tomorrowStart;
      rawAlertItems.push({
        id: `not-ready-${r.id}`,
        priority: isToday ? 'critical' : 'high',
        icon: PackageX,
        category: 'Техника не готова',
        title: r.client,
        entity: blockedEq.slice(0, 2).join(', '),
        detail: isToday ? 'Старт аренды сегодня' : 'Старт аренды завтра',
        link: `/rentals/${r.id}`,
        linkLabel: 'Открыть аренду',
      });
    }
  });

  // 5. Неподписанные документы (договоры без статуса signed)
  const unsignedDocs = documents.filter(isUnsignedDocument);
  unsignedDocs.slice(0, 5).forEach(d => {
    const typeLabel = d.type === 'contract' ? 'Договор' : d.type === 'act' ? 'УПД/Акт' : 'Документ';
    rawAlertItems.push({
      id: `doc-${d.id}`,
      priority: 'medium',
      icon: ClipboardX,
      category: `Не подписан: ${typeLabel}`,
      title: d.client,
      entity: d.number ? `№${d.number}` : (d.rental ? `Аренда ${d.rental}` : ''),
      detail: d.date ? `от ${formatDate(d.date)}` : 'Требует подписи',
      link: '/documents',
      linkLabel: 'К документам',
    });
  });

  // 6. Просроченное ТО (nextMaintenance / maintenanceCHTO / maintenancePTO в прошлом)
  equipment.forEach(e => {
    const checks: { label: string; date: string | undefined }[] = [
      { label: 'Плановое ТО', date: e.nextMaintenance },
      { label: 'ЧТО', date: e.maintenanceCHTO },
      { label: 'ПТО', date: e.maintenancePTO },
    ];
    checks.forEach(({ label, date }) => {
      if (!date) return;
      const d = new Date(date);
      if (d < today) {
        const days = Math.ceil((today.getTime() - d.getTime()) / 86400000);
        rawAlertItems.push({
          id: `maint-${e.id}-${label}`,
          priority: days > 30 ? 'high' : 'medium',
          icon: Zap,
          category: `Просрочено ${label}`,
          title: `${e.manufacturer} ${e.model}`,
          entity: e.inventoryNumber,
          detail: `${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'} просрочки`,
          link: `/equipment/${e.id}`,
          linkLabel: 'Карточка техники',
        });
      }
    });
  });

  // 7. Клиенты со статусом blocked + активными арендами
  const blockedClientsWithRentals = computedClients.filter(c => c.status === 'blocked');
  blockedClientsWithRentals.forEach(c => {
    const hasActive = activeRentalsList.some(r => (
      r.counterpartyId || c.counterpartyId
        ? Boolean(r.counterpartyId && c.counterpartyId && r.counterpartyId === c.counterpartyId)
        : r.clientId === c.id
    ));
    if (hasActive) {
      rawAlertItems.push({
        id: `blocked-client-${c.id}`,
        priority: 'critical',
        icon: Ban,
        category: 'Заблокированный клиент',
        title: c.company,
        entity: 'Есть активные аренды',
        detail: canViewMoney && c.debt > 0 ? `Долг: ${formatCurrency(c.debt)}` : 'Риск срыва выдачи',
        link: `/clients/${c.id}`,
        linkLabel: 'Карточка клиента',
      });
    }
  });

  // 8. Долг превышает кредитный лимит
  if (canViewMoney) {
    computedClients.filter(c => c.creditLimit > 0 && c.debt > c.creditLimit).forEach(c => {
      rawAlertItems.push({
        id: `credit-limit-${c.id}`,
        priority: 'high',
        icon: ShieldAlert,
        category: 'Превышен кредитный лимит',
        title: c.company,
        entity: `Лимит: ${formatCurrency(c.creditLimit)}`,
        detail: `Долг: ${formatCurrency(c.debt)}`,
        link: `/clients/${c.id}`,
        linkLabel: 'К клиенту',
      });
    });
  }

  // 9. Аренды с флагом риска
  viewRentals.filter(r => r.risk && (r.status === 'active' || r.status === 'confirmed')).forEach(r => {
    rawAlertItems.push({
      id: `risk-rental-${r.id}`,
      priority: 'medium',
      icon: ShieldAlert,
      category: 'Риск по аренде',
      title: r.client,
      entity: r.id,
      detail: r.risk!.slice(0, 60),
      link: `/rentals/${r.id}`,
      linkLabel: 'Открыть аренду',
    });
  });

  // Sort: critical → high → medium
  const priorityOrder: Record<AlertPriority, number> = { critical: 0, high: 1, medium: 2 };
  const invalidAlertItems = rawAlertItems.filter(item => !alertHasValidSource(item));
  const alertItems = rawAlertItems
    .filter(alertHasValidSource)
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const criticalCount = alertItems.filter(a => a.priority === 'critical').length;
  const highCount = alertItems.filter(a => a.priority === 'high').length;
  const mediumCount = alertItems.filter(a => a.priority === 'medium').length;
  const debt60PlusAmount = clientDebtAgingRows
    .filter(row => row.ageBucket === '60_plus')
    .reduce((sum, row) => sum + row.debt, 0);
  const debt30PlusAmount = clientDebtAgingRows
    .filter(row => row.ageBucket === '31_60' || row.ageBucket === '60_plus')
    .reduce((sum, row) => sum + row.debt, 0);
  const largestProblemDebtAmount = clientDebtAgingRows.reduce((max, row) => Math.max(max, row.debt || 0), 0);
  const fleetMonthlyRevenuePlan = activeRentalFleetLookup.activeFleet.reduce((sum, item) => sum + (Number(item.plannedMonthlyRevenue) || 0), 0);
  const equipmentWithPlannedRevenueCount = activeRentalFleetLookup.activeFleet.filter(item => Number(item.plannedMonthlyRevenue) > 0).length;
  const rentalRevenuePlanAvailable = activeEquipment > 0
    && equipmentWithPlannedRevenueCount === activeEquipment
    && fleetMonthlyRevenuePlan > 0;
  const companyHealthRentalRevenueActual = ganttRentalsQuery.isSuccess
    ? rentalsIntersectingThisMonth
        .filter(shouldCountRental)
        .reduce((sum, rental) => sum + calculateRentalBilling(rental, {
          periodStart: toDateKey(monthStart),
          periodEnd: todayKey,
        }).finalRentalAmount, 0)
    : null;
  const agedEquipmentCount = equipmentList.filter(item => {
    const year = Number(item.year);
    return Number.isFinite(year) && today.getFullYear() - year >= 8;
  }).length;
  const highHoursEquipmentCount = equipmentList.filter(item => Number(item.hours) >= 3000).length;
  const fleetTypeCounts = equipmentList.reduce((map, item) => {
    const type = String(item.type || 'unknown');
    map.set(type, (map.get(type) || 0) + 1);
    return map;
  }, new Map<string, number>());
  const fleetTopTypeShare = totalEquipment > 0
    ? Math.round((Math.max(0, ...fleetTypeCounts.values()) / totalEquipment) * 100)
    : 0;
  const newClientsThisMonth = computedClients.filter(client => isDateInRange(client.createdAt, monthStart, monthEnd)).length;
  const activeClientIds = new Set(activeRentalsList.map(rental => rental.clientId).filter(Boolean));
  const repeatClientsCount = clientFinancials.filter(row => row.totalRentals > 1).length;
  const hasDebtSourceData = rentalDebtRows.length > 0 || clientDebtAgingRows.length > 0;
  const utilizationTone: DashboardTone = activeEquipment === 0
    ? 'default'
    : utilization < 40
      ? 'danger'
      : utilization < 60 || utilization > UTILIZATION_TARGET
        ? 'warning'
        : 'success';
  const serviceBlockerTicketIds = new Set([
    ...criticalTickets,
    ...unassignedServiceTickets,
    ...ticketsWaitingParts,
    ...overdueServiceTickets,
  ].map(ticket => String(ticket.id || '')).filter(Boolean));
  const serviceBlockersCount = serviceBlockerTicketIds.size;
  const riskSignalCounts = {
    critical: actionAttention?.summary?.critical ?? criticalCount,
    high: actionAttention?.summary?.high ?? highCount,
    medium: actionAttention?.summary?.medium ?? mediumCount,
  };
  const companyHealthModel = buildCompanyHealthModel({
    equipmentCount: totalEquipment,
    rentalsCount: viewPlannerRentals.length || viewRentals.length,
    paymentsCount: payments.length,
    serviceCount: tickets.length,
    documentsCount: documents.length,
    deliveriesCount: deliveries.length,
    clientsCount: clients.length,
    financeOperationsCount: factualCashFlowItems.length,
    businessStateExactEmpty: totalEquipment === 0
      && viewPlannerRentals.length === 0
      && viewRentals.length === 0
      && payments.length === 0
      && tickets.length === 0
      && documents.length === 0
      && deliveries.length === 0
      && clients.length === 0
      && factualCashFlowItems.length === 0,
    activeEquipment,
    availableEquipment,
    equipmentInServiceCount: equipmentInServiceList.length,
    inactiveEquipmentCount: inactiveEquipment,
    agedEquipmentCount,
    highHoursEquipmentCount,
    equipmentWithPlannedRevenueCount,
    fleetTopTypeShare,
    utilization,
    monthlyRevenue,
    monthlyPaidAmount,
    accruedRentalRevenueAmount: companyHealthRentalRevenueActual,
    actualReceiptsAmount,
    actualReceiptsAvailable,
    actualOperatingInflowsAmount,
    actualOperatingInflowsAvailable,
    actualOperatingOutflowsAmount: factualOperatingOutflows,
    actualOperatingOutflowsAvailable,
    actualExpenseAmount: factualOperatingOutflows,
    actualExpensesAvailable: actualOperatingOutflowsAvailable,
    rentalRevenueActual: companyHealthRentalRevenueActual,
    rentalRevenueActualAvailable: ganttRentalsQuery.isSuccess,
    rentalRevenuePlan: fleetMonthlyRevenuePlan,
    fleetMonthlyRevenuePlan,
    rentalRevenuePlanAvailable,
    totalDebt,
    overdueReceivablesAmount,
    overdueReceivablesAvailable,
    debtAging: companyHealthDebtAging,
    debt30PlusAmount,
    debt60PlusAmount,
    largestProblemDebtAmount,
    problemClientCount: clientDebtAgingRows.length,
    overdueReceivablesClients,
    hasDebtSourceData,
    rentalStartsThisMonth: rentalsStartedThisMonth.length,
    rentalReturnsThisMonth: rentalsReturningThisMonth.length,
    reservedRentalsCount: reservedRentalsList.length,
    newClientsThisMonth,
    activeClientsCount: activeClientIds.size,
    repeatClientsCount,
    openServiceTicketsCount: openServiceTickets.length,
    overdueServiceTicketsCount: overdueServiceTickets.length,
    repeatServiceFailuresCount: Array.isArray(mechanicWorkload?.repeatFailures) ? repeatFailureRows.length : undefined,
    averageServiceDays,
    serviceLoadPercent: serviceLoadPercent ?? undefined,
    noActiveFleetCritical: totalEquipment > 0 && activeEquipment === 0 ? 1 : 0,
    lowUtilizationRisk: activeEquipment > 0 && utilization < 40 ? 1 : 0,
    overdueReturnsCount: overdueRentalsList.length,
    returnsTodayCount: rentalsEndingToday.length,
    overdueReceivablesCount: overduePayments.length,
    oldDebtCount: debt60PlusAmount > 0 ? 1 : 0,
    serviceRiskCount: unassignedServiceTickets.length + ticketsWaitingParts.length,
    serviceCriticalCount: criticalTickets.length + overdueServiceTickets.length,
    unsignedDocumentsCount,
    overdueDocumentsCount: documentControl.kpi.overdueSignature + documentControl.kpi.closedRentalsWithoutClosingDocs,
    unassignedDeliveriesCount: unassignedDeliveries.length,
    overdueDeliveriesCount: overdueDeliveries.length,
    criticalSignals: riskSignalCounts.critical,
    invalidCriticalSignals: invalidAlertItems.length,
  });
  const companyHealthScore = companyHealthModel.score;
  const companyHealthDisplayScore = companyHealthScore;
  const companyHealthLabel = companyHealthModel.label;
  const companyHealthTone = companyHealthModel.tone as DashboardTone;
  const companyHealthWarning = companyHealthModel.warning;
  const companyHealthScoreBreakdown = companyHealthModel.scoreDetails as CompanyHealthScoreBreakdown;

  // Dashboard V2 executive model. The model reuses canonical billing, debtor identity,
  // fleet denominator and service lifecycle data; it does not persist or reclassify records.
  const monthStartKey = toDateKey(monthStart);
  const monthEndKey = toDateKey(monthEnd);
  const executiveRevenueRentals = rentalsIntersectingThisMonth.filter(shouldCountRental);
  const executiveRevenueSourceReady = ganttRentalsQuery.isSuccess;
  const executiveRevenueActual = executiveRevenueSourceReady
    ? executiveRevenueRentals.reduce((sum, rental) => sum + calculateRentalBilling(rental, {
        periodStart: monthStartKey,
        periodEnd: todayKey,
      }).finalRentalAmount, 0)
    : null;
  const executiveRevenueForecast = executiveRevenueSourceReady
    ? executiveRevenueRentals.reduce((sum, rental) => sum + calculateRentalBilling(rental, {
        periodStart: monthStartKey,
        periodEnd: monthEndKey,
      }).finalRentalAmount, 0)
    : null;
  const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const previousMonthEnd = endOfMonth(previousMonthStart);
  const previousComparableEnd = new Date(
    previousMonthStart.getFullYear(),
    previousMonthStart.getMonth(),
    Math.min(today.getDate(), previousMonthEnd.getDate()),
    23,
    59,
    59,
    999,
  );
  const previousComparableRevenue = viewPlannerRentals
    .filter(shouldCountRental)
    .filter(rental => overlapsRange(rental.startDate, rental.endDate, previousMonthStart, previousComparableEnd))
    .reduce((sum, rental) => sum + calculateRentalBilling(rental, {
      periodStart: toDateKey(previousMonthStart),
      periodEnd: toDateKey(previousComparableEnd),
    }).finalRentalAmount, 0);
  const executiveRevenueDelta = executiveRevenueActual !== null && previousComparableRevenue > 0
    ? ((executiveRevenueActual - previousComparableRevenue) / previousComparableRevenue) * 100
    : null;
  const executiveRevenuePlanAvailable = rentalRevenuePlanAvailable;

  const utilizationComparisonDate = new Date(today);
  utilizationComparisonDate.setDate(utilizationComparisonDate.getDate() - 30);
  const utilizationComparisonEnd = new Date(utilizationComparisonDate);
  utilizationComparisonEnd.setHours(23, 59, 59, 999);
  const utilizationComparisonKeys = new Set(
    viewPlannerRentals
      .filter(shouldCountRental)
      .filter(rental => overlapsRange(rental.startDate, rental.endDate, utilizationComparisonDate, utilizationComparisonEnd))
      .map(rental => getRentalEquipmentKey(rental, activeRentalFleetLookup))
      .filter(Boolean),
  );
  const utilizationThirtyDaysAgo = activeEquipment > 0
    ? Math.round((utilizationComparisonKeys.size / activeEquipment) * 100)
    : null;
  const utilizationDeltaPoints = utilizationThirtyDaysAgo === null ? null : utilization - utilizationThirtyDaysAgo;

  let cumulativeRevenue = 0;
  let cumulativeReceipts = 0;
  const executiveMonthPoints = monthDayBuckets.map(bucket => {
    const dailyRevenue = executiveRevenueRentals.reduce((sum, rental) => sum + calculateRentalBilling(rental, {
      periodStart: bucket.key,
      periodEnd: bucket.key,
    }).finalRentalAmount, 0);
    const dailyReceipts = actualReceiptPayments
      .filter(payment => toDateKey(payment.paidDate) === bucket.key)
      .reduce((sum, payment) => sum + getDashboardPaidAmount(payment), 0);
    cumulativeRevenue += dailyRevenue;
    cumulativeReceipts += dailyReceipts;
    const isFuture = bucket.key > todayKey;
    return {
      label: bucket.label,
      dateLabel: new Date(`${bucket.key}T12:00:00`).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
      revenue: executiveRevenueSourceReady && !isFuture ? Math.round(cumulativeRevenue) : null,
      payments: paymentsQuery.isSuccess && !isFuture ? Math.round(cumulativeReceipts) : null,
      forecast: executiveRevenueSourceReady && bucket.key >= todayKey ? Math.round(cumulativeRevenue) : null,
    };
  });

  const executiveOverdueReceivablesAmount = overdueReceivablesAvailable
    ? companyHealthDebtAging.overdueOutstandingAmount
    : null;
  const executiveDebt30PlusAmount = overdueReceivablesAvailable
    ? companyHealthDebtAging.bucket31to60Amount
      + companyHealthDebtAging.bucket61to90Amount
      + companyHealthDebtAging.bucketOver90Amount
    : null;
  const executiveDebt60PlusAmount = overdueReceivablesAvailable
    ? companyHealthDebtAging.bucket61to90Amount + companyHealthDebtAging.bucketOver90Amount
    : null;
  const executiveEligibleOverdueReceivables = overdueReceivablesAvailable
    ? companyHealthDebtAging.eligibleReceivables.filter(row => row.overdueDays > 0)
    : [];
  const executiveClientById = new Map(clients.map(client => [client.id, client]));
  const executiveOverdueReceivablesClients = overdueReceivablesAvailable
    ? new Set(executiveEligibleOverdueReceivables.map(row => {
        if (!row.clientId) return '';
        return executiveClientById.get(row.clientId)?.counterpartyId || row.clientId;
      }).filter(Boolean)).size
    : null;
  const oldestOverdueDebtDays = overdueReceivablesAvailable
    ? executiveEligibleOverdueReceivables.reduce((max, row) => Math.max(max, row.overdueDays), 0)
    : null;
  const executiveReceivablesHref = canViewFinance ? '/finance?tab=receivables' : '/payments';
  const topDebtorsByCounterparty = new Map<string, {
    id: string;
    name: string;
    amount: number;
    maxOverdueDays: number;
    clientId?: string;
  }>();
  executiveEligibleOverdueReceivables.forEach(row => {
    if (!row.clientId) return;
    const client = executiveClientById.get(row.clientId);
    const stableGroupId = client?.counterpartyId || row.clientId;
    const existing = topDebtorsByCounterparty.get(stableGroupId) ?? {
      id: stableGroupId,
      name: client?.company || `Клиент ${row.clientId}`,
      amount: 0,
      maxOverdueDays: 0,
      clientId: row.clientId,
    };
    existing.amount += row.outstandingBalance;
    existing.maxOverdueDays = Math.max(existing.maxOverdueDays, row.overdueDays);
    topDebtorsByCounterparty.set(stableGroupId, existing);
  });
  const executiveTopDebtors = clientReceivables
    .filter(row => row.currentDebt > 0 && Boolean(row.counterpartyId))
    .sort((left, right) => right.currentDebt - left.currentDebt)
    .slice(0, 3)
    .map(row => ({
      id: String(row.counterpartyId),
      name: row.client,
      amount: formatCurrency(row.currentDebt),
      age: (topDebtorsByCounterparty.get(String(row.counterpartyId))?.maxOverdueDays || 0) > 0
        ? `${topDebtorsByCounterparty.get(String(row.counterpartyId))?.maxOverdueDays} дн.`
        : row.manualDebt > 0
          ? 'срок не определён'
          : 'срок не наступил',
      href: canViewClients && row.clientId
        ? `/clients/${encodeURIComponent(row.clientId)}`
        : canViewFinance
          ? `/finance?tab=receivables&counterpartyId=${encodeURIComponent(String(row.counterpartyId))}`
          : '/payments',
    }));
  const executiveAvailableFleet = activeRentalFleetLookup.activeFleet.filter(item =>
    item.status !== 'in_service'
    && !rentedEquipmentKeys.has(String(item.id || ''))
    && !reservedEquipmentKeys.has(String(item.id || '')),
  );
  const availableFleetRevenueCoverage = executiveAvailableFleet.length > 0
    && executiveAvailableFleet.every(item => Number(item.plannedMonthlyRevenue) > 0);
  const availableFleetPotentialRevenue = availableFleetRevenueCoverage
    ? executiveAvailableFleet.reduce((sum, item) => sum + Number(item.plannedMonthlyRevenue || 0), 0)
    : null;
  const transitEquipmentCount = new Set(
    activeDeliveries.map(delivery => String(delivery.equipmentId || '')).filter(id => id && activeRentalFleetLookup.byId.has(id)),
  ).size;
  const activeFleetServiceCount = activeRentalFleetLookup.activeFleet.filter(item => item.status === 'in_service').length;
  const executiveUnavailableFleetCount = equipmentList.filter(item => !isActiveRentalFleetEquipment(item)).length;
  const readyToRentPercent = activeEquipment > 0
    ? Math.round(((activeEquipment - activeFleetServiceCount) / activeEquipment) * 100)
    : null;

  const executiveServiceRisks = serviceInDaysRows
    .filter(ticket => ticket.priority === 'critical' || ticket.priority === 'high' || (ticket.plannedDate && toDateKey(ticket.plannedDate) < todayKey))
    .slice(0, 3)
    .map(ticket => {
      return {
        id: ticket.id,
        name: ticket.equipmentLabel || ticket.equipment || `Заявка ${ticket.id}`,
        context: `В сервисе ${ticket.daysInService} дн.${ticket.plannedDate && toDateKey(ticket.plannedDate) < todayKey ? ' · SLA нарушен' : ''}`,
        href: `/service/${encodeURIComponent(ticket.id)}`,
      };
    });

  const executiveAttentionSignals: ExecutiveAttentionSignal[] = [];
  if (overdueReceivablesAvailable && executiveOverdueReceivablesAmount && executiveOverdueReceivablesAmount > 0) {
    executiveAttentionSignals.push({
      id: 'attention-overdue-receivables',
      severity: executiveDebt60PlusAmount && executiveDebt60PlusAmount > 0 ? 'critical' : 'high',
      title: 'Просроченная дебиторка',
      scale: `${formatCurrency(executiveOverdueReceivablesAmount)} · ${executiveOverdueReceivablesClients} ${formatCountLabel(executiveOverdueReceivablesClients || 0, 'клиент', 'клиента', 'клиентов')}`,
      moneyImpact: `Деньги под риском: ${formatCurrency(executiveOverdueReceivablesAmount)}`,
      context: oldestOverdueDebtDays && oldestOverdueDebtDays > 0 ? `Старейший подтверждённый долг: ${oldestOverdueDebtDays} дн.` : 'Требуется контроль оплаты',
      href: executiveReceivablesHref,
      action: 'К дебиторке',
    });
  }
  if (overdueRentalsList.length > 0) {
    executiveAttentionSignals.push({
      id: 'attention-overdue-returns',
      severity: 'critical',
      title: 'Просроченные возвраты',
      scale: `${overdueRentalsList.length} ${formatCountLabel(overdueRentalsList.length, 'аренда', 'аренды', 'аренд')}`,
      context: `Максимальная задержка: ${maxOverdueDays} дн.`,
      href: '/rentals',
      action: 'К арендам',
    });
  }
  if (serviceBlockersCount > 0) {
    executiveAttentionSignals.push({
      id: 'attention-service-blockers',
      severity: criticalTickets.length + overdueServiceTickets.length > 0 ? 'critical' : 'high',
      title: 'Сервисные блокеры',
      scale: `${serviceBlockersCount} ${formatCountLabel(serviceBlockersCount, 'ситуация', 'ситуации', 'ситуаций')}`,
      context: `${overdueServiceTickets.length} SLA нарушено · ${unassignedServiceTickets.length} без механика · ${ticketsWaitingParts.length} ждут запчасти`,
      href: '/service',
      action: 'В сервис',
    });
  }
  if (upcomingReturns.length > 0) {
    executiveAttentionSignals.push({
      id: 'attention-ending-rentals',
      severity: 'medium',
      title: 'Аренды завершаются в ближайшие 3 дня',
      scale: `${upcomingReturns.length} ${formatCountLabel(upcomingReturns.length, 'аренда', 'аренды', 'аренд')}`,
      context: 'Нужно подтвердить возврат, продление или следующую загрузку техники',
      href: '/rentals',
      action: 'Проверить',
    });
  }
  if (overdueDeliveries.length > 0) {
    executiveAttentionSignals.push({
      id: 'attention-overdue-deliveries',
      severity: 'high',
      title: 'Просроченные доставки',
      scale: `${overdueDeliveries.length} ${formatCountLabel(overdueDeliveries.length, 'задача', 'задачи', 'задач')}`,
      context: 'Терминальные доставки исключены; показаны только активные задачи',
      href: '/deliveries',
      action: 'К доставкам',
    });
  }
  if (topAttentionActions.some(item => Number(item.estimatedLoss) > 0)) {
    const lossAction = topAttentionActions.find(item => Number(item.estimatedLoss) > 0)!;
    executiveAttentionSignals.push({
      id: `attention-action-${lossAction.actionId}`,
      severity: lossAction.priority === 'critical' ? 'critical' : 'high',
      title: lossAction.title || 'Управленческое действие',
      scale: lossAction.accountabilityLabel || attentionDueLabel(lossAction),
      moneyImpact: `Оценённый риск: ${formatCurrency(Number(lossAction.estimatedLoss))}`,
      context: `${attentionAssigneeLabel(lossAction)} · ${attentionDueLabel(lossAction)}`,
      href: lossAction.links.serviceTicket
        || lossAction.links.delivery
        || lossAction.links.document
        || lossAction.links.equipment
        || `/equipment?actionQueueFilter=${lossAction.isOverdue ? 'overdue' : 'all'}`,
      action: 'В очередь',
    });
  }
  const attentionSeverityRank = { critical: 0, high: 1, medium: 2 };
  executiveAttentionSignals.sort((left, right) => attentionSeverityRank[left.severity] - attentionSeverityRank[right.severity]);

  const healthDirectionHref: Record<string, string> = {
    finance: executiveReceivablesHref,
    rental: '/rentals',
    risks: executiveReceivablesHref,
    service: '/service',
    clients: '/clients',
    fleet: '/equipment',
  };
  const executiveHealthDirectionVisibility: Record<string, boolean> = {
    finance: canViewMoney,
    rental: canViewRentals,
    risks: canViewMoney,
    service: canViewService,
    clients: canViewClients,
    fleet: canViewEquipment,
  };
  const executiveHealthDirections = companyHealthScoreBreakdown.directions
    .filter(direction => executiveHealthDirectionVisibility[direction.key] === true)
    .map(direction => ({
      id: direction.key,
      label: direction.title,
      score: direction.isEligible === false ? null : direction.score,
      stateLabel: direction.shortReason,
      href: healthDirectionHref[direction.key],
    }));
  const executiveHealthFocus = [
    ...(companyHealthScoreBreakdown.focusDirections ?? []),
    ...(companyHealthScoreBreakdown.weakestDirections ?? []),
  ].find(direction => executiveHealthDirectionVisibility[direction.key] === true);
  const executiveHealthExplanation = companyHealthScoreBreakdown.directions
    .map(direction => `${direction.title} ${Math.round(direction.weight * 100)}%`)
    .join(' · ');

  const crmDeals = crmDealsQuery.data ?? [];
  const openCrmDeals = crmDeals.filter(deal => deal.status === 'open');
  const pipelineAmount = openCrmDeals.reduce((sum, deal) => sum + Math.max(0, Number(deal.budget) || 0), 0);
  const forecastableCrmDeals = openCrmDeals.filter(deal => Number.isFinite(Number(deal.budget)) && Number.isFinite(Number(deal.probability)));
  const weightedPipelineForecast = forecastableCrmDeals.reduce((sum, deal) => (
    sum + Math.max(0, Number(deal.budget) || 0) * Math.max(0, Math.min(100, Number(deal.probability) || 0)) / 100
  ), 0);
  const wonCrmDeals = crmDeals.filter(deal => deal.status === 'won').length;
  const lostCrmDeals = crmDeals.filter(deal => deal.status === 'lost').length;
  const closedCrmDeals = wonCrmDeals + lostCrmDeals;
  const crmConversion = closedCrmDeals > 0 ? Math.round((wonCrmDeals / closedCrmDeals) * 100) : null;

  const executiveUpdatedAtCandidates = [
    canViewEquipment ? equipmentQuery.dataUpdatedAt : 0,
    canViewRentals ? ganttRentalsQuery.dataUpdatedAt : 0,
    canViewMoney ? paymentsQuery.dataUpdatedAt : 0,
    canViewMoney ? paymentAllocationsQuery.dataUpdatedAt : 0,
    canViewService ? serviceTicketsQuery.dataUpdatedAt : 0,
  ].filter(value => Number(value) > 0);
  const executiveOldestUpdatedAt = executiveUpdatedAtCandidates.length > 0
    ? Math.min(...executiveUpdatedAtCandidates)
    : null;
  const executiveDataStale = executiveOldestUpdatedAt !== null
    && executiveFreshnessNow - executiveOldestUpdatedAt > 5 * 60 * 1000;
  const executiveUpdatedLabel = executiveOldestUpdatedAt === null
    ? '—'
    : new Date(executiveOldestUpdatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  const executiveKpis: ExecutiveKpi[] = [
    canViewRentals && {
      id: 'dashboard-kpi-month-revenue',
      label: 'Выручка месяца',
      value: executiveRevenueActual === null || executiveRevenueActual <= 0 ? '—' : formatCurrency(executiveRevenueActual),
      context: executiveRevenueActual === null
        ? 'Недостаточно данных по начислениям'
        : executiveRevenueActual > 0
          ? `Начислено с ${monthStart.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} по ${today.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`
          : 'За выбранный период начислений нет',
      trend: executiveRevenueDelta === null ? undefined : `${executiveRevenueDelta >= 0 ? '+' : ''}${executiveRevenueDelta.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`,
      trendLabel: executiveRevenueDelta === null ? 'Нет сопоставимого прошлого периода' : 'к тому же периоду прошлого месяца',
      forecast: executiveRevenueForecast === null ? undefined : `Прогноз ${formatCurrency(executiveRevenueForecast)}`,
      tone: executiveRevenueActual && executiveRevenueActual > 0 ? 'success' : 'default',
      href: '/rentals',
      state: ganttRentalsQuery.isError ? 'error' : ganttRentalsQuery.isLoading ? 'loading' : executiveDataStale ? 'stale' : executiveRevenueActual ? 'ready' : 'empty',
    },
    canViewEquipment && {
      id: 'dashboard-kpi-fleet-utilization',
      label: 'Загрузка парка',
      value: activeEquipment > 0 ? `${utilization}%` : '—',
      context: activeEquipment > 0 ? `${rentedEquipment} из ${activeEquipment} ед. на аренде` : 'Активный арендный парк не сформирован',
      trend: utilizationDeltaPoints === null ? undefined : `${utilizationDeltaPoints >= 0 ? '+' : ''}${utilizationDeltaPoints} п.п.`,
      trendLabel: utilizationDeltaPoints === null ? 'Нет базы сравнения' : 'к срезу 30 дней назад',
      tone: utilizationTone === 'violet' ? 'info' : utilizationTone,
      href: '/equipment?status=rented',
      state: equipmentQuery.isError ? 'error' : equipmentQuery.isLoading ? 'loading' : executiveDataStale ? 'stale' : activeEquipment > 0 ? 'ready' : 'empty',
    },
    canViewMoney && {
      id: 'dashboard-kpi-overdue-debt',
      label: 'Просроченная дебиторка',
      value: overdueReceivablesAvailable && executiveOverdueReceivablesAmount !== null ? formatCurrency(executiveOverdueReceivablesAmount) : '—',
      context: overdueReceivablesAvailable
        ? executiveOverdueReceivablesAmount && executiveOverdueReceivablesAmount > 0
          ? `${executiveOverdueReceivablesClients} ${formatCountLabel(executiveOverdueReceivablesClients || 0, 'должник', 'должника', 'должников')}`
          : 'Подтверждённой просрочки нет'
        : companyHealthDebtAging.sourceStatus === 'ambiguous'
          ? 'Не подтверждены договорные сроки или календарь компании'
          : 'Недостаточно данных для расчёта',
      trendLabel: executiveOverdueReceivablesAmount && executiveOverdueReceivablesAmount > 0 && oldestOverdueDebtDays && oldestOverdueDebtDays > 0 ? `Старейший долг ${oldestOverdueDebtDays} дн.` : overdueReceivablesAvailable ? 'На текущую дату' : 'Просрочка не рассчитана',
      tone: !overdueReceivablesAvailable ? 'default' : executiveOverdueReceivablesAmount && executiveOverdueReceivablesAmount > 0 ? 'danger' : 'success',
      href: executiveReceivablesHref,
      state: paymentsQuery.isError || paymentAllocationsQuery.isError || ganttRentalsQuery.isError
        ? 'error'
        : paymentsQuery.isLoading || paymentAllocationsQuery.isLoading || ganttRentalsQuery.isLoading
          ? 'loading'
          : !overdueReceivablesAvailable
            ? 'partial'
            : executiveDataStale
              ? 'stale'
              : executiveOverdueReceivablesAmount && executiveOverdueReceivablesAmount > 0 ? 'ready' : 'empty',
    },
    canViewMoney && {
      id: 'dashboard-kpi-month-payments',
      label: 'Поступления месяца',
      value: !paymentsQuery.isSuccess
        ? '—'
        : actualReceiptsAmount > 0
          ? `${actualReceiptsAvailable ? '' : '≥ '}${formatCurrency(actualReceiptsAmount)}`
          : '—',
      context: !paymentsQuery.isSuccess
        ? 'Недостаточно данных по поступлениям'
        : actualReceiptsAmount > 0
          ? `${actualReceiptPayments.length} ${formatCountLabel(actualReceiptPayments.length, 'платёж', 'платежа', 'платежей')} с датой оплаты`
          : 'За выбранный период поступлений нет',
      trend: actualReceiptsAvailable && executiveRevenueActual && executiveRevenueActual > 0
        ? `${Math.round((actualReceiptsAmount / executiveRevenueActual) * 100)}%`
        : undefined,
      trendLabel: actualReceiptsAvailable && executiveRevenueActual && executiveRevenueActual > 0 ? 'от начисленной выручки' : 'План поступлений не задан',
      tone: actualReceiptsAmount > 0 ? 'info' : 'default',
      href: '/payments',
      state: paymentsQuery.isError
        ? 'error'
        : paymentsQuery.isLoading
          ? 'loading'
          : !actualReceiptsAvailable
            ? 'partial'
            : executiveDataStale
              ? 'stale'
              : actualReceiptsAmount > 0 ? 'ready' : 'empty',
    },
  ].filter(Boolean) as ExecutiveKpi[];

  const attentionState: ExecutiveDataState = actionAttentionQuery.isError
    || paymentsQuery.isError
    || ganttRentalsQuery.isError
    || serviceTicketsQuery.isError
      ? 'partial'
      : actionAttentionQuery.isLoading || paymentsQuery.isLoading || ganttRentalsQuery.isLoading || serviceTicketsQuery.isLoading
        ? 'loading'
        : executiveDataStale
          ? 'stale'
          : executiveAttentionSignals.length > 0 ? 'ready' : 'empty';
  const moneyState: ExecutiveDataState = clientsQuery.isError || paymentsQuery.isError || paymentAllocationsQuery.isError || ganttRentalsQuery.isError
    ? 'error'
    : clientsQuery.isLoading || paymentsQuery.isLoading || paymentAllocationsQuery.isLoading || ganttRentalsQuery.isLoading
      ? 'loading'
      : companyHealthDebtAging.sourceStatus !== 'derived' || hasUnagedOrUnresolvedReceivables
        ? 'partial'
        : executiveDataStale
          ? 'stale'
          : totalDebt > 0 ? 'ready' : 'empty';
  const serviceState: ExecutiveDataState = serviceTicketsQuery.isError
    ? 'error'
    : serviceTicketsQuery.isLoading
      ? 'loading'
      : executiveDataStale
        ? 'stale'
        : tickets.length > 0 ? 'ready' : 'empty';
  const fleetState: ExecutiveDataState = equipmentQuery.isError
    ? 'error'
    : equipmentQuery.isLoading
      ? 'loading'
      : activeEquipment > 0
        ? executiveDataStale
          ? 'stale'
          : availableFleetRevenueCoverage || executiveAvailableFleet.length === 0 ? 'ready' : 'partial'
        : 'empty';
  const anyCoreDashboardError = equipmentQuery.isError
    || ganttRentalsQuery.isError
    || paymentsQuery.isError
    || paymentAllocationsQuery.isError
    || serviceTicketsQuery.isError;
  const executiveCockpitProps: ExecutiveCockpitV2Props = {
    contextLabel: user?.role || 'Операционный центр',
    periodLabel: monthPeriodLabel,
    periodRange: monthRangeLabel,
    updatedLabel: executiveUpdatedLabel,
    healthBadge: companyHealthDisplayScore === null ? companyHealthLabel : `Health ${companyHealthDisplayScore}/100`,
    healthTone: companyHealthTone === 'violet' ? 'info' : companyHealthTone,
    dataStatus: anyCoreDashboardError ? 'Часть данных недоступна' : executiveDataStale ? 'Данные могли устареть' : undefined,
    kpis: executiveKpis,
    attention: executiveAttentionSignals.slice(0, 5),
    attentionState,
    month: {
      points: executiveMonthPoints,
      state: ganttRentalsQuery.isError || paymentsQuery.isError
        ? 'partial'
        : ganttRentalsQuery.isLoading || paymentsQuery.isLoading
          ? 'loading'
          : executiveDataStale
            ? 'stale'
            : executiveRevenueActual || actualReceiptsAmount ? 'ready' : 'empty',
      plan: executiveRevenuePlanAvailable ? formatCurrency(fleetMonthlyRevenuePlan) : 'Не задан',
      fact: executiveRevenueActual === null ? '—' : formatCurrency(executiveRevenueActual),
      forecast: executiveRevenueForecast === null ? '—' : formatCurrency(executiveRevenueForecast),
      explanation: 'Факт — начисления по дням с учётом downtime. Прогноз — детерминированная сумма уже известных договоров до конца месяца; новые сделки не предполагаются.',
    },
    health: {
      score: companyHealthDisplayScore,
      label: companyHealthLabel,
      coverage: `Покрытие ${companyHealthScoreBreakdown.totalCoveragePercent ?? 0}% · доверие ${formatHealthConfidence(companyHealthScoreBreakdown.confidence)}`,
      primaryRisk: executiveHealthFocus?.shortReason || companyHealthWarning || 'Критических отклонений по доступным данным нет',
      directions: executiveHealthDirections,
      explanation: `${executiveHealthExplanation}. Недоступные направления исключаются из оценки; итог корректируется на покрытие данных.`,
    },
    fleet: canViewEquipment ? {
      state: fleetState,
      utilization: activeEquipment > 0 ? `${utilization}%` : '—',
      context: activeEquipment > 0 ? `${rentedEquipment} из ${activeEquipment} на аренде` : 'Нет расчётной базы',
      delta: utilizationDeltaPoints === null ? 'Нет среза для сравнения' : `${utilizationDeltaPoints >= 0 ? '+' : ''}${utilizationDeltaPoints} п.п. за 30 дней`,
      rows: [
        { label: 'В аренде', value: rentedEquipment, color: 'var(--primary)' },
        { label: 'Свободно', value: executiveAvailableFleet.length, color: 'var(--info)' },
        { label: 'В сервисе', value: activeFleetServiceCount, color: 'var(--warning)' },
        { label: 'В доставке', value: transitEquipmentCount, color: 'var(--chart-3)' },
        { label: 'Недоступно', value: executiveUnavailableFleetCount, color: 'var(--danger)' },
      ],
      total: Math.max(activeEquipment, totalEquipment, 1),
      potentialLoss: availableFleetPotentialRevenue === null ? undefined : `${formatCurrency(availableFleetPotentialRevenue)} / мес`,
      potentialLossNote: availableFleetPotentialRevenue === null
        ? executiveAvailableFleet.length > 0 ? 'Плановая выручка настроена не для всех свободных единиц' : 'Свободных единиц нет'
        : 'Сумма плановой месячной выручки свободных единиц',
    } : undefined,
    money: canViewMoney ? {
      state: moneyState,
      totalDebt: totalReceivablesAvailable ? formatCurrency(totalDebt) : '—',
      overdue: overdueReceivablesAvailable && executiveOverdueReceivablesAmount !== null ? formatCurrency(executiveOverdueReceivablesAmount) : '—',
      over30: overdueReceivablesAvailable && executiveDebt30PlusAmount !== null ? formatCurrency(executiveDebt30PlusAmount) : '—',
      aging: [
        { label: '1–30', amount: overdueReceivablesAvailable ? companyHealthDebtAging.bucket1to30Amount : 0 },
        { label: '31–60', amount: overdueReceivablesAvailable ? companyHealthDebtAging.bucket31to60Amount : 0 },
        { label: '61–90', amount: overdueReceivablesAvailable ? companyHealthDebtAging.bucket61to90Amount : 0 },
        { label: '90+', amount: overdueReceivablesAvailable ? companyHealthDebtAging.bucketOver90Amount : 0 },
      ],
      topDebtors: executiveTopDebtors,
      href: executiveReceivablesHref,
    } : undefined,
    service: canViewService ? {
      state: serviceState,
      inRepair: serviceState === 'error' || serviceState === 'loading' ? '—' : String(activeFleetServiceCount),
      readyToRent: readyToRentPercent === null ? '—' : `${readyToRentPercent}%`,
      slaBreaches: serviceState === 'error' || serviceState === 'loading' ? '—' : String(overdueServiceTickets.length),
      averageDays: serviceState === 'error' || serviceState === 'loading' ? '—' : `${averageServiceDays} дн.`,
      risks: executiveServiceRisks,
      href: '/service',
    } : undefined,
    sales: canViewCrm ? {
      state: crmDealsQuery.isError ? 'error' : crmDealsQuery.isLoading ? 'loading' : crmDeals.length > 0 ? (forecastableCrmDeals.length < openCrmDeals.length ? 'partial' : 'ready') : 'empty',
      pipeline: crmDealsQuery.isSuccess ? formatCurrency(pipelineAmount) : '—',
      forecast: crmDealsQuery.isSuccess && forecastableCrmDeals.length > 0 ? formatCurrency(weightedPipelineForecast) : '—',
      activeDeals: crmDealsQuery.isSuccess ? String(openCrmDeals.length) : '—',
      conversion: crmConversion === null ? '—' : `${crmConversion}%`,
      forecastNote: forecastableCrmDeals.length === openCrmDeals.length
        ? 'Forecast = бюджет × заданная вероятность по открытым сделкам.'
        : `Forecast рассчитан по ${forecastableCrmDeals.length} из ${openCrmDeals.length} открытых сделок с заданной вероятностью.`,
      stages: [
        { label: 'Новые', value: openCrmDeals.filter(deal => deal.stage === 'lead' || deal.stage === 'qualified').length },
        { label: 'КП', value: openCrmDeals.filter(deal => deal.stage === 'proposal' || deal.stage === 'demo').length },
        { label: 'Переговоры', value: openCrmDeals.filter(deal => deal.stage === 'negotiation').length },
        { label: 'Решение', value: openCrmDeals.filter(deal => deal.stage === 'reserved' || deal.stage === 'invoice').length },
      ],
      href: '/crm',
    } : undefined,
    // Deferred intentionally: there is no reliable per-user last-seen business snapshot yet.
    recentChanges: undefined,
  };

  // ── render ──────────────────────────────────────────────────────────────────

  return <ExecutiveCockpitV2 {...executiveCockpitProps} />;
}
