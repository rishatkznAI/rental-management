import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  Plus, TrendingUp, AlertTriangle, Wrench, DollarSign, Calendar,
  User, Target, FileText, CreditCard, RefreshCw, CheckCircle, Truck,
  ShieldAlert, Clock, Ban, ArrowRight, ChevronDown, ChevronUp,
  PackageX, ClipboardX, Zap, ListChecks, Activity,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency, formatDate, getRentalDays } from '../lib/utils';
import { assessServiceRisk } from '../lib/serviceRisk';
import { useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { useEquipmentList } from '../hooks/useEquipment';
import { useRentalsList, useGanttData } from '../hooks/useRentals';
import { rentalsService } from '../services/rentals.service';
import { equipmentService } from '../services/equipment.service';
import { financeService } from '../services/finance.service';
import { reportsService, type MechanicsWorkloadReport } from '../services/reports.service';
import { deliveriesService } from '../services/deliveries.service';
import { useServiceTicketsList } from '../hooks/useServiceTickets';
import { isRegularServiceTicket } from '../lib/serviceTicketKind.js';
import { useClientsList } from '../hooks/useClients';
import { usePaymentsList } from '../hooks/usePayments';
import { useDocumentsList } from '../hooks/useDocuments';
import { useDebtCollectionPlans } from '../hooks/useDebtCollectionPlans';
import { KPIDetailModal } from '../components/modals/KPIDetailModal';
import { ServiceRequestModal } from '../components/modals/ServiceRequestModal';
import { NewClientModal } from '../components/modals/NewClientModal';
import { NewRentalModal } from '../components/gantt/GanttModals';
import { useAuth } from '../contexts/AuthContext';
import { isMechanicRole } from '../lib/userStorage';
import { usePermissions } from '../lib/permissions';
import { appendRentalHistory, buildRentalCreationHistory, createRentalHistoryEntry } from '../lib/rental-history';
import { appendAuditHistory, createAuditEntry } from '../lib/entity-history';
import type {
  Equipment,
  Rental,
  ServiceTicket,
  Client,
  Payment,
  Document,
  EquipmentStatus,
  ManagerBreakdownResponse,
  Delivery,
} from '../types';
import type { GanttRentalData } from '../mock-data';
import { buildClientDebtAgingRows, buildClientFinancialSnapshots, buildRentalDebtRows } from '../lib/finance';
import { buildDashboardAttentionSummary } from '../lib/dashboardAttention.js';
import { buildDocumentControl } from '../lib/documentControl.js';
import { buildDebtCollectionDashboardSummary } from '../lib/debtCollectionPlans.js';
import { taskPrioritySummaryLabel } from '../lib/tasksCenter.js';
import { tasksCenterService } from '../services/tasks-center.service';
import {
  buildActiveRentalFleetLookup,
  calculateCurrentFleetUtilization,
  getRentalEquipmentKey,
  isActiveRentalFleetEquipment,
} from '../lib/fleetUtilization';

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

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return startOfDay(d);
}

function formatCountLabel(value: number, one: string, few: string, many: string) {
  const abs = Math.abs(value) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

function isUnsignedDocument(doc: Document) {
  return (doc.type === 'contract' || doc.type === 'act') && doc.status !== 'signed';
}

function toDateKey(value?: string | null) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

type RoleFocusCard = {
  id: string;
  title: string;
  value: string;
  hint: string;
  href: string;
  cta: string;
  onClick?: () => void;
  tone?: 'default' | 'warning' | 'danger' | 'success';
  icon: React.ElementType;
};

type DashboardTabId = 'overview' | 'rentals' | 'fleet' | 'service' | 'money' | 'documents' | 'deliveries';

const MONTH_LABELS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatCompactCurrency(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`;
  if (abs >= 1_000) return `${Math.round(value / 1_000).toLocaleString('ru-RU')} тыс`;
  return value.toLocaleString('ru-RU');
}

type DashboardTone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'violet';

type DashboardKpi = {
  id: string;
  label: string;
  value: string;
  hint: string;
  icon: React.ElementType;
  tone?: DashboardTone;
  onClick?: () => void;
  href?: string;
};

type DashboardRisk = {
  id: string;
  title: string;
  detail: string;
  value?: string;
  href?: string;
  tone?: DashboardTone;
};

const DASHBOARD_CHART_COLORS = ['#2563eb', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#64748b'];

const toneStyles: Record<DashboardTone, { bubble: string; accent: string; dot: string }> = {
  default: {
    bubble: 'bg-blue-50 text-blue-600 dark:bg-primary/12 dark:text-primary',
    accent: 'text-blue-600 dark:text-primary',
    dot: 'bg-blue-500',
  },
  success: {
    bubble: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/25 dark:text-emerald-300',
    accent: 'text-emerald-600 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  warning: {
    bubble: 'bg-amber-50 text-amber-600 dark:bg-amber-900/25 dark:text-amber-300',
    accent: 'text-amber-600 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  danger: {
    bubble: 'bg-red-50 text-red-600 dark:bg-red-900/25 dark:text-red-300',
    accent: 'text-red-600 dark:text-red-300',
    dot: 'bg-red-500',
  },
  info: {
    bubble: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-900/25 dark:text-cyan-300',
    accent: 'text-cyan-600 dark:text-cyan-300',
    dot: 'bg-cyan-500',
  },
  violet: {
    bubble: 'bg-violet-50 text-violet-600 dark:bg-violet-900/25 dark:text-violet-300',
    accent: 'text-violet-600 dark:text-violet-300',
    dot: 'bg-violet-500',
  },
};

function DashboardEmptyState({ text = 'Недостаточно данных для графика.' }: { text?: string }) {
  return (
    <div className="flex h-full min-h-48 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/35 px-4 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function DashboardKpiGrid({ cards }: { cards: DashboardKpi[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {cards.map(card => {
        const Icon = card.icon;
        const tone = toneStyles[card.tone ?? 'default'];
        const content = (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-muted-foreground">{card.label}</p>
                <p className="mt-2 text-2xl font-extrabold text-foreground">{card.value}</p>
              </div>
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${tone.bubble}`}>
                <Icon className="h-5 w-5" />
              </div>
            </div>
            <p className={`mt-4 line-clamp-2 text-sm ${tone.accent}`}>{card.hint}</p>
          </>
        );
        const className = 'rounded-2xl border border-border bg-white p-4 text-left shadow-[0_18px_44px_-36px_rgba(15,23,42,0.38)] transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_22px_54px_-38px_rgba(15,23,42,0.45)] dark:bg-card dark:shadow-none';

        if (card.href) {
          return <Link key={card.id} to={card.href} className={className}>{content}</Link>;
        }
        if (card.onClick) {
          return <button key={card.id} type="button" onClick={card.onClick} className={className}>{content}</button>;
        }
        return <div key={card.id} className={className}>{content}</div>;
      })}
    </div>
  );
}

function DashboardChartCard({
  title,
  description,
  children,
  empty,
  className,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  empty?: boolean;
  className?: string;
}) {
  return (
    <Card className={`app-panel overflow-hidden border-border/80 bg-card/95 ${className ?? ''}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="h-72">
        {empty ? <DashboardEmptyState /> : children}
      </CardContent>
    </Card>
  );
}

function DashboardRiskPanel({
  title,
  description,
  items,
  className,
}: {
  title: string;
  description: string;
  items: DashboardRisk[];
  className?: string;
}) {
  return (
    <Card className={`app-panel border-border/80 bg-card/95 ${className ?? ''}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-5 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300">
            Критичных сигналов нет.
          </div>
        ) : items.slice(0, 7).map(item => {
          const tone = toneStyles[item.tone ?? 'default'];
          const content = (
            <>
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{item.title}</span>
                <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.detail}</span>
              </span>
              {item.value ? <span className={`shrink-0 text-sm font-semibold ${tone.accent}`}>{item.value}</span> : null}
            </>
          );
          const className = 'flex items-start gap-3 rounded-2xl border border-border bg-white px-4 py-3 transition hover:border-blue-300 dark:bg-background/30';
          return item.href ? (
            <Link key={item.id} to={item.href} className={className}>{content}</Link>
          ) : (
            <div key={item.id} className={className}>{content}</div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function groupCountChart<T>(
  items: T[],
  getKey: (item: T) => string | undefined | null,
  labels: Record<string, string> = {},
  colors = DASHBOARD_CHART_COLORS,
) {
  const map = new Map<string, number>();
  items.forEach(item => {
    const key = getKey(item) || 'unknown';
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()]
    .map(([key, value], index) => ({
      key,
      label: labels[key] || key,
      value,
      fill: colors[index % colors.length],
    }))
    .sort((a, b) => b.value - a.value);
}

// ─── main component ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const qc = useQueryClient();
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

  // All data via react-query (auto-refetches on window focus by default)
  const { data: equipment = [] }  = useEquipmentList({ enabled: canViewEquipment });
  const { data: rentals = [] }    = useRentalsList({ enabled: canViewRentals });
  const { data: rawTickets = [] } = useServiceTicketsList({ enabled: canViewService });
  const tickets = useMemo(() => rawTickets.filter(isRegularServiceTicket), [rawTickets]);
  const { data: clients = [] }    = useClientsList({ enabled: canViewClients });
  const { data: payments = [] }   = usePaymentsList({ enabled: canViewMoney });
  const { data: documents = [] }  = useDocumentsList({ enabled: canViewDocuments });
  const { data: debtCollectionPlansResponse } = useDebtCollectionPlans({ enabled: canViewMoney });
  const debtCollectionPlans = debtCollectionPlansResponse?.plans ?? [];
  const { data: tasksCenterData } = useQuery({
    queryKey: ['tasks-center', 'dashboard-summary'],
    queryFn: tasksCenterService.getAll,
    enabled: canViewTasksCenter,
    staleTime: 60_000,
  });
  const { data: ganttRentals = [] } = useGanttData({ enabled: canViewRentals || canViewPlanner });
  const { data: deliveries = [] } = useQuery<Delivery[]>({
    queryKey: ['deliveries', 'dashboard'],
    queryFn: deliveriesService.getAll,
    enabled: canViewDeliveries,
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

  const [selectedKPI, setSelectedKPI] = useState<
    | 'utilization'
    | 'activeRentals'
    | 'returnsTodayTomorrow'
    | 'overdueReturns'
    | 'idleEquipment'
    | 'openService'
    | 'unassignedService'
    | 'waitingParts'
    | 'repeatFailures'
    | 'serviceInDays'
    | 'weekRevenue'
    | 'totalDebt'
    | 'monthDebt'
    | null
  >(null);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [showRentalModal, setShowRentalModal] = useState(false);
  const [showOfficeUpdModal, setShowOfficeUpdModal] = useState(false);
  const [activeDashboardTab, setActiveDashboardTab] = useState<DashboardTabId>('overview');
  const [officeUpdUpdatingId, setOfficeUpdUpdatingId] = useState<string | null>(null);
  const [officeUpdManagerFilter, setOfficeUpdManagerFilter] = useState('');
  const [managerBreakdownName, setManagerBreakdownName] = useState<string | null>(null);
  const dashboardCardClass = 'app-panel border-border/80 bg-card/95';
  const dashboardCardHeaderClass = 'space-y-2 px-5 pt-5 pb-3';
  const dashboardCardContentClass = 'space-y-2 px-5 pb-5';
  const dashboardSectionClass = 'space-y-4';
  const dashboardSectionHeaderClass = 'flex flex-col gap-1.5';

  const today = startOfDay(new Date());
  const weekAgo = daysAgo(7);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const tomorrowStart = new Date(today);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const dayAfterTomorrowStart = new Date(today);
  dayAfterTomorrowStart.setDate(dayAfterTomorrowStart.getDate() + 2);
  const clientFinancials = useMemo(
    () => buildClientFinancialSnapshots(clients, ganttRentals, payments),
    [clients, ganttRentals, payments],
  );
  const rentalDebtRows = useMemo(
    () => buildRentalDebtRows(ganttRentals, payments),
    [ganttRentals, payments],
  );
  const clientDebtAgingRows = useMemo(
    () => buildClientDebtAgingRows(clients, rentalDebtRows, today.toISOString().slice(0, 10)),
    [clients, rentalDebtRows, today],
  );
  const shouldShowAttentionSummary =
    user?.role === 'Администратор'
    || user?.role === 'Офис-менеджер'
    || user?.role === 'Коммерческий директор'
    || (canViewMoney && canViewDocuments);
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
  const isAdminRole = user?.role === 'Администратор';
  const currentUserName = user?.name ?? '';
  const shouldShowRentalAttention = !isMechanicRole(user?.role);
  const viewRentals = isManagerRole && currentUserName
    ? rentals.filter(r => r.manager === currentUserName)
    : rentals;
  const viewPlannerRentals = isManagerRole && currentUserName
    ? ganttRentals.filter(r => r.manager === currentUserName)
    : ganttRentals;
  const attentionSummary = useMemo(
    () => buildDashboardAttentionSummary({
      rentalDebtRows,
      clientDebtAgingRows,
      rentals: viewPlannerRentals,
      documents,
      tickets,
      equipment: equipmentList,
      today: today.toISOString().slice(0, 10),
    }),
    [clientDebtAgingRows, documents, equipmentList, rentalDebtRows, tickets, today, viewPlannerRentals],
  );
  const documentControl = useMemo(
    () => buildDocumentControl({
      rentals: viewRentals,
      documents,
      clients,
      equipment: equipmentList,
      today: today.toISOString().slice(0, 10),
      limit: 10,
    }),
    [clients, documents, equipmentList, today, viewRentals],
  );
  const debtCollectionSummary = useMemo(
    () => buildDebtCollectionDashboardSummary({
      clientDebtRows: clientDebtAgingRows,
      plans: debtCollectionPlans,
      today: today.toISOString().slice(0, 10),
    }),
    [clientDebtAgingRows, debtCollectionPlans, today],
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

  // Week revenue: sum of prices of rentals that started in the last 7 days, OR active rentals
  const weekStartedRentals = viewRentals.filter(r => {
    const start = new Date(r.startDate);
    return start >= weekAgo && (r.status === 'active' || r.status === 'closed' || r.status === 'confirmed');
  });
  const weekRevenue = weekStartedRentals.length > 0
    ? weekStartedRentals.reduce((sum, r) => sum + (r.price || 0), 0)
    : activeRentalsList.reduce((sum, r) => {
        // Approximate daily rate × 7 for active rentals
        const start = new Date(r.startDate);
        const end = new Date(r.plannedReturnDate);
        const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
        const dailyRate = (r.price || 0) / totalDays;
        return sum + dailyRate * 7;
      }, 0);

  // Debt
  const todayKey = today.toISOString().slice(0, 10);
  const overduePayments = rentalDebtRows.filter(row =>
    (row.expectedPaymentDate && row.expectedPaymentDate < todayKey) || row.endDate < todayKey,
  );
  const totalDebt = clientFinancials.reduce((sum, row) => sum + row.currentDebt, 0);
  const {
    data: managerBreakdown,
    isLoading: managerBreakdownLoading,
    isFetching: managerBreakdownFetching,
    error: managerBreakdownError,
  } = useQuery<ManagerBreakdownResponse>({
    queryKey: ['finance', 'manager-breakdown', managerBreakdownName, todayKey],
    queryFn: () => financeService.getManagerBreakdown(managerBreakdownName || '', todayKey),
    enabled: canViewMoney && !!managerBreakdownName,
    staleTime: 1000 * 60,
  });

  // Month debt: overdue rental debt this month
  const monthOverduePayments = overduePayments.filter(row => {
    const compareDate = row.expectedPaymentDate || row.endDate;
    const dueDate = new Date(compareDate);
    return dueDate >= monthStart;
  });
  const monthDebt = monthOverduePayments.reduce((sum, row) => sum + row.outstanding, 0);

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
  const recentRentals = [...viewPlannerRentals]
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
    .slice(0, 5);

  // ── Manager stats for current user ─────────────────────────────────────────
  // (currentUserName уже объявлен выше)
  const myRentals = currentUserName
    ? ganttRentals.filter(r => r.manager === currentUserName)
    : [];
  const myActiveRentals = myRentals.filter(r => r.status === 'active');
  const myMonthRentals = myRentals.filter(r => {
    const start = new Date(r.startDate);
    return start >= monthStart;
  });
  const myMonthRevenue = myMonthRentals.reduce((sum, r) => sum + (r.amount || 0), 0);

  // Debt for current manager
  const myManualDebt = currentUserName
    ? clientFinancials.reduce((sum, row) => {
      const sourceClient = clients.find(client => client.id === row.clientId);
      return sourceClient?.manager === currentUserName ? sum + (row.manualDebt || 0) : sum;
    }, 0)
    : 0;
  const myClientDebt = currentUserName
    ? rentalDebtRows
      .filter(row => row.manager === currentUserName)
      .reduce((sum, row) => sum + row.outstanding, myManualDebt)
    : 0;
  const myOverduePayments = currentUserName
    ? overduePayments.filter(row => row.manager === currentUserName)
    : [];
  const myReturnsToday = myActiveRentals.filter(rental => {
    const ret = new Date(rental.endDate);
    return ret >= today && ret < tomorrowStart;
  });
  const myReturnsTomorrow = myActiveRentals.filter(rental => {
    const ret = new Date(rental.endDate);
    return ret >= tomorrowStart && ret < dayAfterTomorrowStart;
  });
  const myUnsignedDocuments = currentUserName
    ? documents.filter(doc =>
        doc.manager === currentUserName
        && isUnsignedDocument(doc),
      )
    : [];
  const myAssignedServiceTickets = currentUserName
    ? tickets.filter(ticket =>
        ticket.status !== 'closed'
        && (ticket.assignedMechanicName === currentUserName || ticket.assignedTo === currentUserName)
      )
    : [];
  const myReadyServiceTickets = myAssignedServiceTickets.filter(ticket => ticket.status === 'ready');
  const myWaitingPartsTickets = myAssignedServiceTickets.filter(ticket => ticket.status === 'waiting_parts');
  const ticketsWaitingParts = tickets.filter(t => t.status === 'waiting_parts');
  const openServiceTickets = tickets.filter(t => t.status !== 'closed');
  const unassignedServiceTickets = openServiceTickets.filter(
    t => !t.assignedMechanicId && !t.assignedMechanicName && !t.assignedTo,
  );
  const officeUnsignedDocuments = documents.filter(isUnsignedDocument);
  const officeUpcomingPayments = rentalDebtRows.filter(row => {
    if (!row.outstanding) return false;
    const compareDate = row.expectedPaymentDate || row.endDate;
    if (!compareDate) return false;
    const dueDate = new Date(compareDate);
    const soonDate = new Date(today);
    soonDate.setDate(soonDate.getDate() + 3);
    return dueDate >= today && dueDate <= soonDate;
  });
  const officeReturnsQueue = viewPlannerRentals.filter(rental => {
    if (rental.status !== 'active') return false;
    const ret = new Date(rental.endDate);
    return (ret >= today && ret < tomorrowStart) || (ret >= tomorrowStart && ret < dayAfterTomorrowStart);
  }).length;
  const officeCompletedRentals = useMemo(
    () => viewPlannerRentals
      .filter(rental => rental.status === 'returned' || rental.status === 'closed')
      .sort((left, right) => new Date(right.endDate).getTime() - new Date(left.endDate).getTime()),
    [viewPlannerRentals],
  );
  const officePendingUpdRentals = useMemo(
    () => officeCompletedRentals.filter(rental => !rental.updSigned),
    [officeCompletedRentals],
  );
  const officeSignedUpdRentals = useMemo(
    () => officeCompletedRentals.filter(rental => rental.updSigned),
    [officeCompletedRentals],
  );
  const officeCompletedClientCount = useMemo(
    () => new Set(officeCompletedRentals.map(rental => rental.client).filter(Boolean)).size,
    [officeCompletedRentals],
  );
  const officePendingUpdClientCount = useMemo(
    () => new Set(officePendingUpdRentals.map(rental => rental.client).filter(Boolean)).size,
    [officePendingUpdRentals],
  );
  const overdueDebtClients = computedClients.filter(c => (c.debt ?? 0) > 0);
  const roleDashboardCards = useMemo<RoleFocusCard[]>(() => {
    if (user?.role === 'Администратор') {
      return [
        {
          id: 'admin-docs',
          title: 'Документы без подписи',
          value: String(officeUnsignedDocuments.length),
          hint: officeUnsignedDocuments.length > 0
            ? 'Есть договоры и акты, которые нужно довести до подписания'
            : 'Все ключевые документы подписаны',
          href: '/documents',
          cta: 'Открыть документы',
          tone: officeUnsignedDocuments.length > 0 ? 'warning' : 'success',
          icon: ClipboardX,
        },
      ];
    }

    if (user?.role === 'Менеджер по аренде') {
      return [
        {
          id: 'manager-active',
          title: 'Мои активные аренды',
          value: String(myActiveRentals.length),
          hint: myActiveRentals.length > 0
            ? `${myActiveRentals.length} ${formatCountLabel(myActiveRentals.length, 'сделка', 'сделки', 'сделок')} в работе`
            : 'Сейчас нет активных аренд',
          href: '/rentals',
          cta: 'Открыть аренды',
          tone: myActiveRentals.length > 0 ? 'default' : 'success',
          icon: Calendar,
        },
        {
          id: 'manager-returns',
          title: 'Мои возвраты',
          value: `${myReturnsToday.length}/${myReturnsTomorrow.length}`,
          hint: `Сегодня ${myReturnsToday.length}, завтра ${myReturnsTomorrow.length}`,
          href: '/rentals',
          cta: 'Контролировать возвраты',
          tone: myReturnsToday.length > 0 ? 'warning' : 'default',
          icon: Clock,
        },
        {
          id: 'manager-debt',
          title: 'Долг моих клиентов',
          value: myClientDebt > 0 ? formatCurrency(myClientDebt) : '0 ₽',
          hint: myOverduePayments.length > 0
            ? `${myOverduePayments.length} ${formatCountLabel(myOverduePayments.length, 'просрочка', 'просрочки', 'просрочек')} требует внимания`
            : 'Просрочек по моим клиентам нет',
          href: '/payments',
          cta: 'Перейти к оплатам',
          tone: myClientDebt > 0 ? 'warning' : 'success',
          icon: CreditCard,
        },
        {
          id: 'manager-docs',
          title: 'Документы по моим сделкам',
          value: String(myUnsignedDocuments.length),
          hint: myUnsignedDocuments.length > 0
            ? 'Есть договоры и УПД без подписи'
            : 'Все ключевые документы подписаны',
          href: '/documents',
          cta: 'Проверить документы',
          tone: myUnsignedDocuments.length > 0 ? 'warning' : 'success',
          icon: FileText,
        },
      ];
    }

    if (isMechanicRole(user?.role)) {
      return [
        {
          id: 'service-assigned',
          title: 'Мои заявки',
          value: String(myAssignedServiceTickets.length),
          hint: myAssignedServiceTickets.length > 0
            ? `${myAssignedServiceTickets.length} ${formatCountLabel(myAssignedServiceTickets.length, 'заявка', 'заявки', 'заявок')} в работе`
            : 'Сейчас нет назначенных заявок',
          href: '/service',
          cta: 'Открыть сервис',
          tone: myAssignedServiceTickets.length > 0 ? 'default' : 'success',
          icon: Wrench,
        },
        {
          id: 'service-ready',
          title: 'Готово к закрытию',
          value: String(myReadyServiceTickets.length),
          hint: myReadyServiceTickets.length > 0
            ? 'Можно завершать и закрывать работы'
            : 'Нет готовых заявок',
          href: '/service',
          cta: 'Закрыть заявки',
          tone: myReadyServiceTickets.length > 0 ? 'warning' : 'success',
          icon: CheckCircle,
        },
        {
          id: 'service-parts',
          title: 'Ждут запчасти',
          value: String(myWaitingPartsTickets.length),
          hint: myWaitingPartsTickets.length > 0
            ? 'Нужен контроль поставки или замена решения'
            : 'Зависших по запчастям нет',
          href: '/service',
          cta: 'Проверить заявки',
          tone: myWaitingPartsTickets.length > 0 ? 'danger' : 'success',
          icon: PackageX,
        },
        {
          id: 'service-unassigned',
          title: 'Очередь без механика',
          value: String(unassignedServiceTickets.length),
          hint: unassignedServiceTickets.length > 0
            ? 'Есть заявки, которые ещё не распределены'
            : 'Новые заявки уже назначены',
          href: '/service',
          cta: 'Посмотреть очередь',
          tone: unassignedServiceTickets.length > 0 ? 'warning' : 'default',
          icon: User,
        },
      ];
    }

    if (user?.role === 'Офис-менеджер') {
      return [
        {
          id: 'office-docs',
          title: 'Документы без подписи',
          value: String(officeUnsignedDocuments.length),
          hint: officeUnsignedDocuments.length > 0
            ? 'Нужно дожать подписание договоров и актов'
            : 'Все ключевые документы подписаны',
          href: '/documents',
          cta: 'Открыть документы',
          tone: officeUnsignedDocuments.length > 0 ? 'warning' : 'success',
          icon: ClipboardX,
        },
        {
          id: 'office-payments',
          title: 'Платежи на 3 дня',
          value: String(officeUpcomingPayments.length),
          hint: officeUpcomingPayments.length > 0
            ? 'Нужно подтвердить поступления и напомнить клиентам'
            : 'Ближайших платежей нет',
          href: '/payments',
          cta: 'Проверить оплаты',
          tone: officeUpcomingPayments.length > 0 ? 'warning' : 'success',
          icon: DollarSign,
        },
        {
          id: 'office-upd',
          title: 'Завершённые аренды без УПД',
          value: String(officePendingUpdRentals.length),
          hint: officePendingUpdRentals.length > 0
            ? `${officePendingUpdClientCount} ${formatCountLabel(officePendingUpdClientCount, 'клиент', 'клиента', 'клиентов')} ждут УПД`
            : officeCompletedRentals.length > 0
              ? `УПД отмечены по ${officeCompletedRentals.length} завершённым арендам`
              : 'Завершённых аренд под УПД пока нет',
          href: '/rentals',
          cta: 'Контролировать УПД',
          onClick: () => setShowOfficeUpdModal(true),
          tone: officePendingUpdRentals.length > 0 ? 'warning' : 'success',
          icon: FileText,
        },
        {
          id: 'office-debt',
          title: 'Просроченная дебиторка',
          value: totalDebt > 0 ? formatCurrency(totalDebt) : '0 ₽',
          hint: overdueDebtClients.length > 0
            ? `${overdueDebtClients.length} ${formatCountLabel(overdueDebtClients.length, 'клиент', 'клиента', 'клиентов')} с долгом`
            : 'Просроченной дебиторки нет',
          href: '/payments',
          cta: 'Работать с долгом',
          tone: totalDebt > 0 ? 'danger' : 'success',
          icon: ShieldAlert,
        },
      ];
    }

    return [];
  }, [
    myActiveRentals.length,
    myAssignedServiceTickets.length,
    myClientDebt,
    myOverduePayments.length,
    myReadyServiceTickets.length,
    myReturnsToday.length,
    myReturnsTomorrow.length,
    myUnsignedDocuments.length,
    myWaitingPartsTickets.length,
    officeCompletedRentals.length,
    officePendingUpdClientCount,
    officePendingUpdRentals.length,
    officeReturnsQueue,
    officeUnsignedDocuments.length,
    officeUpcomingPayments.length,
    overdueDebtClients.length,
    totalDebt,
    unassignedServiceTickets.length,
    user?.role,
  ]);
  const roleDashboardMeta = useMemo(() => {
    if (user?.role === 'Администратор') {
      return {
        badge: 'Роль: админ',
        title: 'Контроль операционных рисков',
        description: 'Сверху вынесены документы, которые требуют подписи и внимания офиса.',
      };
    }
    if (user?.role === 'Менеджер по аренде') {
      return {
        badge: 'Роль: аренда',
        title: 'Мой дашборд менеджера аренды',
        description: 'Здесь закреплены ваши сделки, возвраты, оплаты и документы. Это стартовая точка для ежедневной работы.',
      };
    }
    if (isMechanicRole(user?.role)) {
      return {
        badge: 'Роль: сервис',
        title: 'Мой сервисный дашборд',
        description: 'Сначала видны мои заявки, готовые работы, ожидание запчастей и неразобранная очередь.',
      };
    }
    if (user?.role === 'Офис-менеджер') {
      return {
        badge: 'Роль: офис',
        title: 'Мой офисный дашборд',
        description: 'Сверху закреплены документы, оплаты, завершённые аренды под УПД и дебиторка, чтобы офис видел, кому уже пора выпускать закрывающие.',
      };
    }
    return null;
  }, [user?.role]);

  const officePendingUpdGroups = useMemo(() => {
    const filteredRentals = officeUpdManagerFilter
      ? officePendingUpdRentals.filter(rental => rental.manager === officeUpdManagerFilter)
      : officePendingUpdRentals;
    const groups = new Map<string, GanttRentalData[]>();
    filteredRentals.forEach(rental => {
      const key = rental.client || 'Без клиента';
      groups.set(key, [...(groups.get(key) || []), rental]);
    });
    return Array.from(groups.entries())
      .map(([clientName, items]) => ({
        clientName,
        items: items.sort((left, right) => new Date(right.endDate).getTime() - new Date(left.endDate).getTime()),
      }))
      .sort((left, right) => right.items.length - left.items.length || left.clientName.localeCompare(right.clientName, 'ru'));
  }, [officeUpdManagerFilter, officePendingUpdRentals]);

  const officeSignedUpdGroups = useMemo(() => {
    const filteredRentals = officeUpdManagerFilter
      ? officeSignedUpdRentals.filter(rental => rental.manager === officeUpdManagerFilter)
      : officeSignedUpdRentals;
    const groups = new Map<string, GanttRentalData[]>();
    filteredRentals.forEach(rental => {
      const key = rental.client || 'Без клиента';
      groups.set(key, [...(groups.get(key) || []), rental]);
    });
    return Array.from(groups.entries())
      .map(([clientName, items]) => ({
        clientName,
        items: items.sort((left, right) => new Date(right.updDate || right.endDate).getTime() - new Date(left.updDate || left.endDate).getTime()),
      }))
      .sort((left, right) => right.items.length - left.items.length || left.clientName.localeCompare(right.clientName, 'ru'));
  }, [officeSignedUpdRentals, officeUpdManagerFilter]);

  const officeUpdManagerRows = useMemo(() => {
    const managerNames = Array.from(new Set(officeCompletedRentals.map(rental => rental.manager).filter(Boolean)))
      .sort((left, right) => left.localeCompare(right, 'ru'));
    return managerNames.map(name => {
      const managerCompleted = officeCompletedRentals.filter(rental => rental.manager === name);
      const managerPending = managerCompleted.filter(rental => !rental.updSigned);
      const managerSigned = managerCompleted.filter(rental => rental.updSigned);
      return {
        name,
        completedCount: managerCompleted.length,
        pendingCount: managerPending.length,
        signedCount: managerSigned.length,
      };
    }).sort((left, right) =>
      right.pendingCount - left.pendingCount
      || right.completedCount - left.completedCount
      || left.name.localeCompare(right.name, 'ru')
    );
  }, [officeCompletedRentals]);

  const officeFilteredCompletedRentals = useMemo(
    () => officeUpdManagerFilter
      ? officeCompletedRentals.filter(rental => rental.manager === officeUpdManagerFilter)
      : officeCompletedRentals,
    [officeCompletedRentals, officeUpdManagerFilter],
  );
  const officeFilteredPendingUpdRentals = useMemo(
    () => officeUpdManagerFilter
      ? officePendingUpdRentals.filter(rental => rental.manager === officeUpdManagerFilter)
      : officePendingUpdRentals,
    [officeUpdManagerFilter, officePendingUpdRentals],
  );
  const officeFilteredSignedUpdRentals = useMemo(
    () => officeUpdManagerFilter
      ? officeSignedUpdRentals.filter(rental => rental.manager === officeUpdManagerFilter)
      : officeSignedUpdRentals,
    [officeSignedUpdRentals, officeUpdManagerFilter],
  );
  const officeFilteredClientCount = useMemo(
    () => new Set(officeFilteredCompletedRentals.map(rental => rental.client).filter(Boolean)).size,
    [officeFilteredCompletedRentals],
  );

  useEffect(() => {
    if (!officeUpdManagerFilter) return;
    if (!officeUpdManagerRows.some(row => row.name === officeUpdManagerFilter)) {
      setOfficeUpdManagerFilter('');
    }
  }, [officeUpdManagerFilter, officeUpdManagerRows]);

  const handleOfficeUpdToggle = useCallback(async (rental: GanttRentalData, nextSigned: boolean) => {
    setOfficeUpdUpdatingId(rental.id);
    const signedDate = nextSigned ? new Date().toISOString().slice(0, 10) : undefined;
    const updatedRentals = ganttRentals.map(item =>
      item.id === rental.id
        ? appendRentalHistory(
            {
              ...item,
              updSigned: nextSigned,
              updDate: nextSigned ? (signedDate || item.updDate) : undefined,
            },
            createRentalHistoryEntry(
              user?.name || 'Система',
              nextSigned
                ? `УПД отмечен из офисного дашборда${signedDate ? ` (${signedDate})` : ''}`
                : 'Отметка УПД снята из офисного дашборда',
            ),
          )
        : item,
    );

    try {
      await rentalsService.bulkReplaceGantt(updatedRentals);
      await qc.invalidateQueries({ queryKey: RENTAL_KEYS.gantt });
    } finally {
      setOfficeUpdUpdatingId(null);
    }
  }, [ganttRentals, qc, user?.name]);

  const hasManagerData = myRentals.length > 0;
  const adminManagerRows = useMemo(() => {
    const names = Array.from(new Set([
      ...ganttRentals.map(item => item.manager).filter(Boolean),
      ...rentalDebtRows.map(item => item.manager).filter(Boolean),
      ...documents.map(item => item.manager).filter(Boolean),
      ...clients.map(item => item.manager).filter(Boolean),
    ])).sort((a, b) => a.localeCompare(b, 'ru'));

    return names.map(name => {
      const managerRentals = ganttRentals.filter(item => item.manager === name);
      const managerActiveRentals = managerRentals.filter(item => item.status === 'active');
      const managerMonthRentals = managerRentals.filter(item => new Date(item.startDate) >= monthStart);
      const managerDebtRows = rentalDebtRows.filter(item => item.manager === name);
      const managerManualDebt = clientFinancials.reduce((sum, row) => {
        const sourceClient = clients.find(item => item.id === row.clientId);
        return sourceClient?.manager === name ? sum + (row.manualDebt || 0) : sum;
      }, 0);
      const managerOverdueRows = overduePayments.filter(item => item.manager === name);
      const managerUnsignedDocs = documents.filter(item =>
        item.manager === name && (item.type === 'contract' || item.type === 'act') && item.status !== 'signed',
      );
      const managerReturnsSoon = managerActiveRentals.filter(item => {
        const ret = new Date(item.endDate);
        return (ret >= today && ret < tomorrowStart) || (ret >= tomorrowStart && ret < dayAfterTomorrowStart);
      }).length;

      return {
        name,
        activeRentals: managerActiveRentals.length,
        monthRentals: managerMonthRentals.length,
        monthRevenue: managerMonthRentals.reduce((sum, item) => sum + (item.amount || 0), 0),
        currentDebt: managerDebtRows.reduce((sum, item) => sum + item.outstanding, managerManualDebt),
        overdueDebt: managerOverdueRows.reduce((sum, item) => sum + item.outstanding, 0),
        returnsSoon: managerReturnsSoon,
        unsignedDocs: managerUnsignedDocs.length,
      };
    }).filter(row =>
      row.activeRentals > 0 ||
      row.monthRentals > 0 ||
      row.monthRevenue > 0 ||
      row.currentDebt > 0 ||
      row.overdueDebt > 0 ||
      row.returnsSoon > 0 ||
      row.unsignedDocs > 0
    ).sort((a, b) =>
      b.activeRentals - a.activeRentals
      || b.monthRevenue - a.monthRevenue
      || b.currentDebt - a.currentDebt
      || a.name.localeCompare(b.name, 'ru')
    );
  }, [clients, clientFinancials, dayAfterTomorrowStart, documents, ganttRentals, monthStart, overduePayments, rentalDebtRows, today, tomorrowStart]);

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
  const utilizationDeviation = utilization - UTILIZATION_TARGET;

  // Equipment in active use (rented + reserved)
  const rentedOrReservedEquipment = rentedEquipment + reservedEquipmentKeys.size;
  const reservedEquipment = reservedEquipmentKeys.size;
  const inactiveEquipment = equipment.filter(e => e.status === 'inactive').length;

  // Rentals ending today
  const rentalsEndingToday = viewPlannerRentals.filter(r => {
    const ret = new Date(r.endDate);
    return r.status === 'active' && ret >= today && ret < tomorrowStart;
  });
  const rentalsEndingTomorrow = viewPlannerRentals.filter(r => {
    const ret = new Date(r.endDate);
    return r.status === 'active' && ret >= tomorrowStart && ret < dayAfterTomorrowStart;
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
  const idleEquipmentList = equipmentList.filter(e =>
    e.status === 'inactive'
    || (
      e.status !== 'in_service'
      && !rentedEquipmentKeys.has(e.id)
      && !reservedEquipmentKeys.has(e.id)
    ),
  );
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
  const maxServiceDays = serviceInDaysRows.length > 0 ? serviceInDaysRows[0].daysInService : 0;
  const overdueServiceTickets = serviceInDaysRows.filter(row =>
    row.plannedDate && toDateKey(row.plannedDate) < todayKey,
  );
  const readyServiceTickets = openServiceTickets.filter(ticket => ticket.status === 'ready');
  const activeDeliveries = deliveries.filter(delivery =>
    delivery.status !== 'completed' && delivery.status !== 'cancelled',
  );
  const todayDeliveries = activeDeliveries.filter(delivery =>
    toDateKey(delivery.transportDate || delivery.neededBy) === todayKey,
  );
  const overdueDeliveries = activeDeliveries.filter(delivery => {
    const deliveryDate = toDateKey(delivery.transportDate || delivery.neededBy);
    return Boolean(deliveryDate) && deliveryDate < todayKey;
  });
  const unassignedDeliveries = activeDeliveries.filter(delivery => !delivery.carrierId && !delivery.carrierName);
  const todayPaymentRows = canViewMoney
    ? rentalDebtRows.filter(row => {
        if (!row.outstanding) return false;
        const compareDate = row.expectedPaymentDate || row.endDate;
        return toDateKey(compareDate) === todayKey;
      })
    : [];
  const todayServiceTickets = openServiceTickets.filter(ticket =>
    toDateKey(ticket.plannedDate || ticket.createdAt) === todayKey,
  );
  const tasksWithoutResponsible = (tasksCenterData?.tasks ?? []).filter(task =>
    task.status !== 'done' && !task.assignedTo && !task.responsible,
  );

  const operationalSummaryCards = [
    canViewRentals && {
      id: 'active-rentals',
      label: 'Активные аренды',
      value: String(activeRentalsList.length),
      hint: `${rentedOrReservedEquipment} ед. техники задействовано`,
      icon: Calendar,
      tone: 'default',
      onClick: () => setSelectedKPI('activeRentals'),
    },
    canViewRentals && {
      id: 'returns',
      label: 'Возвраты сегодня / завтра',
      value: `${rentalsEndingToday.length}/${rentalsEndingTomorrow.length}`,
      hint: rentalsEndingToday.length > 0 ? 'Проверить закрытие дня' : 'Ближайшие возвраты без пика',
      icon: Clock,
      tone: rentalsEndingToday.length > 0 ? 'warning' : 'default',
      onClick: () => setSelectedKPI('returnsTodayTomorrow'),
    },
    canViewRentals && {
      id: 'overdue-returns',
      label: 'Просроченные возвраты',
      value: String(overdueRentalsList.length),
      hint: overdueRentalsList.length > 0 ? `Макс. ${maxOverdueDays} дн.` : 'Просрочек нет',
      icon: AlertTriangle,
      tone: overdueRentalsList.length > 0 ? 'danger' : 'success',
      onClick: () => setSelectedKPI('overdueReturns'),
    },
    canViewEquipment && {
      id: 'available-equipment',
      label: 'Свободная техника',
      value: String(availableEquipment),
      hint: activeEquipment > 0 ? `Загрузка парка ${utilization}%` : 'Активный парк не сформирован',
      icon: Truck,
      tone: 'success',
      onClick: () => setSelectedKPI('utilization'),
    },
    canViewEquipment && {
      id: 'rented-equipment',
      label: 'Техника в аренде',
      value: String(rentedEquipment),
      hint: `${activeEquipment} ед. активного парка`,
      icon: Activity,
      tone: 'default',
      onClick: () => setSelectedKPI('utilization'),
    },
    canViewService && {
      id: 'service-equipment',
      label: 'Техника в сервисе',
      value: String(equipmentInServiceList.length),
      hint: `Ср. ${averageServiceDays || 0} дн. · макс. ${maxServiceDays || 0} дн.`,
      icon: Wrench,
      tone: equipmentInServiceList.length > 0 ? 'warning' : 'success',
      onClick: () => setSelectedKPI('serviceInDays'),
    },
    canViewMoney && {
      id: 'overdue-debt',
      label: 'Просроченная дебиторка',
      value: totalDebt > 0 ? formatCurrency(totalDebt) : '0 ₽',
      hint: `${overdueDebtClients.length} клиентов с долгом`,
      icon: CreditCard,
      tone: totalDebt > 0 ? 'danger' : 'success',
      onClick: () => setSelectedKPI('totalDebt'),
    },
    canViewDocuments && {
      id: 'unsigned-docs',
      label: 'Документы без подписи',
      value: String(officeUnsignedDocuments.length),
      hint: documentControl.kpi.closedRentalsWithoutClosingDocs > 0
        ? `${documentControl.kpi.closedRentalsWithoutClosingDocs} завершённых без УПД`
        : 'Контроль подписей',
      icon: FileText,
      tone: officeUnsignedDocuments.length > 0 ? 'warning' : 'success',
      href: '/documents',
    },
    canViewService && {
      id: 'service-blockers',
      label: 'Сервисные блокеры',
      value: `${openServiceTickets.length}/${unassignedServiceTickets.length}`,
      hint: `Просрочено ${overdueServiceTickets.length} · без механика ${unassignedServiceTickets.length}`,
      icon: PackageX,
      tone: unassignedServiceTickets.length + overdueServiceTickets.length > 0 ? 'warning' : 'success',
      onClick: () => setSelectedKPI('unassignedService'),
    },
  ].filter(Boolean) as Array<{
    id: string;
    label: string;
    value: string;
    hint: string;
    icon: React.ElementType;
    tone: 'default' | 'warning' | 'danger' | 'success';
    href?: string;
    onClick?: () => void;
  }>;
  const overviewSummaryCards = operationalSummaryCards.filter(item =>
    ['active-rentals', 'returns', 'overdue-returns', 'available-equipment', 'service-equipment', 'overdue-debt', 'unsigned-docs']
      .includes(item.id),
  ).slice(0, 7);

  const todayWorkRows = [
    canViewRentals && {
      id: 'today-returns',
      label: 'Возвраты сегодня',
      value: String(rentalsEndingToday.length),
      detail: rentalsEndingToday[0]?.client || 'План возвратов пуст',
      href: '/rentals',
      tone: rentalsEndingToday.length > 0 ? 'warning' : 'success',
    },
    canViewDeliveries && {
      id: 'today-deliveries',
      label: 'Доставки сегодня',
      value: String(todayDeliveries.length),
      detail: overdueDeliveries.length > 0
        ? `Просрочено ${overdueDeliveries.length}`
        : unassignedDeliveries.length > 0
          ? `Без перевозчика ${unassignedDeliveries.length}`
          : 'Без срочных блокеров',
      href: '/deliveries',
      tone: overdueDeliveries.length > 0 ? 'danger' : unassignedDeliveries.length > 0 ? 'warning' : 'default',
    },
    canViewMoney && {
      id: 'today-payments',
      label: 'Платежи сегодня',
      value: String(todayPaymentRows.length),
      detail: todayPaymentRows.length > 0
        ? formatCurrency(todayPaymentRows.reduce((sum, row) => sum + row.outstanding, 0))
        : 'Ожидаемых оплат нет',
      href: '/payments',
      tone: todayPaymentRows.length > 0 ? 'warning' : 'success',
    },
    canViewService && {
      id: 'today-service',
      label: 'Сервис сегодня',
      value: String(todayServiceTickets.length),
      detail: readyServiceTickets.length > 0
        ? `Готово к закрытию ${readyServiceTickets.length}`
        : ticketsWaitingParts.length > 0
          ? `Ждут запчасти ${ticketsWaitingParts.length}`
          : 'Без срочных закрытий',
      href: '/service',
      tone: readyServiceTickets.length + ticketsWaitingParts.length > 0 ? 'warning' : 'default',
    },
    canViewTasksCenter && {
      id: 'unassigned-tasks',
      label: 'Без ответственного',
      value: String(tasksWithoutResponsible.length),
      detail: tasksWithoutResponsible[0]?.title || 'Очередь распределена',
      href: '/tasks',
      tone: tasksWithoutResponsible.length > 0 ? 'warning' : 'success',
    },
  ].filter(Boolean) as Array<{
    id: string;
    label: string;
    value: string;
    detail: string;
    href: string;
    tone: 'default' | 'warning' | 'danger' | 'success';
  }>;

  const quickActions = [
    can('create', 'rentals') && { id: 'new-rental', label: 'Новая аренда', href: '/rentals/new', icon: Calendar },
    can('create', 'service') && { id: 'new-service', label: 'Новая заявка', href: '/service/new', icon: Wrench },
    can('create', 'deliveries') && { id: 'new-delivery', label: 'Новая доставка', href: '/deliveries/new', icon: Truck },
    can('create', 'clients') && { id: 'new-client', label: 'Новый клиент', href: '/clients/new', icon: User },
    can('create', 'equipment') && { id: 'new-equipment', label: 'Новая техника', href: '/equipment/new', icon: Plus },
    canViewPlanner && { id: 'planner', label: 'Планировщик', href: '/planner', icon: Target },
  ].filter(Boolean) as Array<{ id: string; label: string; href: string; icon: React.ElementType }>;

  const overviewKpiCards = overviewSummaryCards.slice(0, 6);
  const revenueTrendData = useMemo(() => {
    const now = new Date(today);
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      return {
        key: monthKey(date),
        label: MONTH_LABELS[date.getMonth()],
        revenue: 0,
      };
    });
    const monthMap = new Map(months.map(item => [item.key, item]));
    viewRentals.forEach(rental => {
      const parsed = new Date(rental.startDate || rental.createdAt || '');
      if (Number.isNaN(parsed.getTime())) return;
      const target = monthMap.get(monthKey(parsed));
      if (!target) return;
      target.revenue += Number(rental.price || rental.amount || 0);
    });
    return months;
  }, [today, viewRentals]);
  const hasRevenueTrend = revenueTrendData.some(item => item.revenue > 0);
  const receivablesAgingData = useMemo(() => ([
    { label: '0-7', value: clientDebtAgingRows.filter(row => row.ageBucket === '0_7').reduce((sum, row) => sum + row.debt, 0), fill: '#3b82f6' },
    { label: '8-30', value: clientDebtAgingRows.filter(row => row.ageBucket === '8_14' || row.ageBucket === '15_30').reduce((sum, row) => sum + row.debt, 0), fill: '#f59e0b' },
    { label: '31-60', value: clientDebtAgingRows.filter(row => row.ageBucket === '31_60').reduce((sum, row) => sum + row.debt, 0), fill: '#fb7185' },
    { label: '60+', value: clientDebtAgingRows.filter(row => row.ageBucket === '60_plus').reduce((sum, row) => sum + row.debt, 0), fill: '#ef4444' },
  ]), [clientDebtAgingRows]);
  const hasReceivablesAging = receivablesAgingData.some(item => item.value > 0);
  const serviceStatusChartData = [
    { label: 'Новые', value: openServiceTickets.filter(ticket => ticket.status === 'new').length, fill: '#60a5fa' },
    { label: 'В работе', value: openServiceTickets.filter(ticket => ticket.status === 'in_progress').length, fill: '#6366f1' },
    { label: 'Запчасти', value: ticketsWaitingParts.length, fill: '#f59e0b' },
    { label: 'Готово', value: readyServiceTickets.length, fill: '#10b981' },
    { label: 'Критич.', value: criticalTickets.length, fill: '#ef4444' },
  ];
  const hasServiceStatusData = serviceStatusChartData.some(item => item.value > 0);
  const fleetDonutData = [
    { label: 'Заняты', value: rentedEquipment, fill: '#2563eb' },
    { label: 'Доступны', value: availableEquipment, fill: '#8b5cf6' },
    { label: 'Сервис', value: equipmentInServiceList.length, fill: '#f59e0b' },
    { label: 'Резерв', value: reservedEquipment, fill: '#94a3b8' },
  ].filter(item => item.value > 0);
  const hasFleetDonutData = fleetDonutData.length > 0;
  const rentalStatusLabels: Record<string, string> = {
    active: 'Активные',
    created: 'Созданы',
    confirmed: 'Подтверждены',
    return_planned: 'Возврат',
    closed: 'Закрыты',
    completed: 'Завершены',
    returned: 'Возвращены',
    cancelled: 'Отменены',
  };
  const equipmentStatusLabels: Record<string, string> = {
    available: 'Доступно',
    rented: 'В аренде',
    reserved: 'Резерв',
    in_service: 'Сервис',
    inactive: 'Неактивно',
    sold: 'Продано',
  };
  const serviceStatusLabels: Record<string, string> = {
    new: 'Новые',
    in_progress: 'В работе',
    waiting_parts: 'Запчасти',
    ready: 'Готово',
    closed: 'Закрыто',
  };
  const priorityLabels: Record<string, string> = {
    low: 'Низкий',
    medium: 'Средний',
    high: 'Высокий',
    critical: 'Критичный',
  };
  const documentStatusLabels: Record<string, string> = {
    draft: 'Черновик',
    sent: 'Отправлен',
    signed: 'Подписан',
  };
  const documentTypeLabels: Record<string, string> = {
    contract: 'Договоры',
    act: 'Акты',
    invoice: 'Счета',
    upd: 'УПД',
    claim: 'Претензии',
    notice: 'Уведомления',
  };
  const deliveryStatusLabels: Record<string, string> = {
    new: 'Новые',
    sent: 'Отправлены',
    accepted: 'Приняты',
    in_transit: 'В пути',
    completed: 'Выполнены',
    cancelled: 'Отменены',
  };
  const nextReturnBuckets = useMemo(() => Array.from({ length: 10 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    const key = date.toISOString().slice(0, 10);
    return {
      key,
      label: index === 0 ? 'Сегодня' : date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
      value: viewPlannerRentals.filter(rental => toDateKey(rental.endDate) === key && rental.status === 'active').length,
    };
  }), [today, viewPlannerRentals]);
  const deliveryDayBuckets = useMemo(() => Array.from({ length: 10 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    const key = date.toISOString().slice(0, 10);
    return {
      key,
      label: index === 0 ? 'Сегодня' : date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
      value: activeDeliveries.filter(delivery => toDateKey(delivery.transportDate || delivery.neededBy) === key).length,
    };
  }), [activeDeliveries, today]);
  const rentalStatusChartData = useMemo(() => groupCountChart(viewPlannerRentals, item => item.status, rentalStatusLabels), [viewPlannerRentals]);
  const rentalManagerChartData = useMemo(() => groupCountChart(viewPlannerRentals, item => item.manager || 'Без менеджера').slice(0, 8), [viewPlannerRentals]);
  const rentalsWithDebtCount = rentalDebtRows.filter(row => row.outstanding > 0).length;
  const rentalsWithoutManager = viewPlannerRentals.filter(rental => !rental.manager);
  const rentalsRiskItems: DashboardRisk[] = [
    overdueRentalsList.length > 0 && {
      id: 'overdue-returns',
      title: 'Просроченные возвраты',
      detail: `${overdueRentalsList.length} аренд требуют закрытия возврата`,
      value: String(overdueRentalsList.length),
      href: '/rentals',
      tone: 'danger',
    },
    rentalsWithDebtCount > 0 && {
      id: 'rentals-debt',
      title: 'Аренды с долгом',
      detail: 'Есть открытая дебиторка по арендам',
      value: String(rentalsWithDebtCount),
      href: '/finance',
      tone: 'warning',
    },
    documentControl.kpi.rentalsWithoutContract > 0 && {
      id: 'rentals-docs',
      title: 'Аренды без договора',
      detail: 'Документный контроль показывает отсутствие договора',
      value: String(documentControl.kpi.rentalsWithoutContract),
      href: '/documents',
      tone: 'warning',
    },
    rentalsWithoutManager.length > 0 && {
      id: 'rentals-manager',
      title: 'Без ответственного',
      detail: 'В арендах не указан менеджер',
      value: String(rentalsWithoutManager.length),
      href: '/rentals',
      tone: 'warning',
    },
  ].filter(Boolean) as DashboardRisk[];
  const fleetStatusChartData = useMemo(() => groupCountChart(equipmentList, item => item.status, equipmentStatusLabels), [equipmentList]);
  const fleetTypeChartData = useMemo(() => groupCountChart(equipmentList, item => item.type || 'other').slice(0, 8), [equipmentList]);
  const maintenanceOverdueEquipment = equipmentList.filter(item =>
    [item.nextMaintenance, item.maintenanceCHTO, item.maintenancePTO].some(date => date && toDateKey(date) < todayKey),
  );
  const missingEquipmentIdentity = equipmentList.filter(item => !item.inventoryNumber || !item.serialNumber);
  const fleetRiskItems: DashboardRisk[] = [
    equipmentInServiceList.length > 0 && {
      id: 'fleet-service',
      title: 'Техника в сервисе',
      detail: 'Единицы парка сейчас недоступны для выдачи',
      value: String(equipmentInServiceList.length),
      href: '/service',
      tone: 'warning',
    },
    idleEquipmentList.length > 0 && {
      id: 'fleet-idle',
      title: 'Свободная техника',
      detail: 'Резерв для выдачи или перераспределения',
      value: String(idleEquipmentList.length),
      href: '/equipment',
      tone: 'info',
    },
    missingEquipmentIdentity.length > 0 && {
      id: 'fleet-identity',
      title: 'Нет INV/SN',
      detail: 'Есть карточки техники без ключевых идентификаторов',
      value: String(missingEquipmentIdentity.length),
      href: '/equipment',
      tone: 'warning',
    },
    maintenanceOverdueEquipment.length > 0 && {
      id: 'fleet-maintenance',
      title: 'Просроченное ТО',
      detail: 'По карточкам техники есть даты обслуживания в прошлом',
      value: String(maintenanceOverdueEquipment.length),
      href: '/equipment',
      tone: 'danger',
    },
  ].filter(Boolean) as DashboardRisk[];
  const servicePriorityChartData = useMemo(() => groupCountChart(openServiceTickets, item => item.priority, priorityLabels, ['#10b981', '#60a5fa', '#f59e0b', '#ef4444']), [openServiceTickets]);
  const mechanicWorkloadChartData = useMemo(() => {
    const source = adminMechanicRows.length > 0
      ? adminMechanicRows.map(row => ({ label: row.name, value: row.openTickets }))
      : groupCountChart(openServiceTickets, item => item.assignedMechanicName || item.assignedTo || 'Без механика').map(item => ({ label: item.label, value: item.value }));
    return source.filter(item => item.value > 0).slice(0, 8).map((item, index) => ({ ...item, fill: DASHBOARD_CHART_COLORS[index % DASHBOARD_CHART_COLORS.length] }));
  }, [adminMechanicRows, openServiceTickets]);
  const serviceRiskItems: DashboardRisk[] = [
    unassignedServiceTickets.length > 0 && {
      id: 'service-unassigned',
      title: 'Без механика',
      detail: 'Заявки ожидают распределения',
      value: String(unassignedServiceTickets.length),
      href: '/service',
      tone: 'warning',
    },
    ticketsWaitingParts.length > 0 && {
      id: 'service-parts',
      title: 'Ожидание запчастей',
      detail: 'Ремонт зависит от снабжения',
      value: String(ticketsWaitingParts.length),
      href: '/service',
      tone: 'warning',
    },
    criticalTickets.length > 0 && {
      id: 'service-critical',
      title: 'Критичные заявки',
      detail: 'Высокий или критичный приоритет',
      value: String(criticalTickets.length),
      href: '/service',
      tone: 'danger',
    },
    readyServiceTickets.length > 0 && {
      id: 'service-ready',
      title: 'Готово к закрытию',
      detail: 'Заявки можно довести до финального статуса',
      value: String(readyServiceTickets.length),
      href: '/service',
      tone: 'success',
    },
  ].filter(Boolean) as DashboardRisk[];
  const paymentTrendData = useMemo(() => {
    const now = new Date(today);
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      return { key: monthKey(date), label: MONTH_LABELS[date.getMonth()], value: 0 };
    });
    const monthMap = new Map(months.map(item => [item.key, item]));
    payments.forEach(payment => {
      const parsed = new Date(payment.paidDate || payment.dueDate || '');
      if (Number.isNaN(parsed.getTime())) return;
      const target = monthMap.get(monthKey(parsed));
      if (!target) return;
      target.value += Number(payment.paidAmount || payment.amount || 0);
    });
    return months;
  }, [payments, today]);
  const financeLoadData = [
    { label: 'Дебиторка', value: totalDebt, fill: '#ef4444' },
    { label: 'Просрочка', value: overduePayments.reduce((sum, row) => sum + row.outstanding, 0), fill: '#f59e0b' },
    { label: 'Сегодня', value: todayPaymentRows.reduce((sum, row) => sum + row.outstanding, 0), fill: '#2563eb' },
  ];
  const moneyRiskItems: DashboardRisk[] = [
    debtCollectionSummary.overdueActions > 0 && {
      id: 'money-actions',
      title: 'Просрочены действия',
      detail: 'Планы взыскания требуют обновления',
      value: String(debtCollectionSummary.overdueActions),
      href: '/finance',
      tone: 'danger',
    },
    debtCollectionSummary.withoutPlan30Plus > 0 && {
      id: 'money-plan',
      title: 'Нет плана 30+',
      detail: 'Клиенты с долгом без следующего шага',
      value: String(debtCollectionSummary.withoutPlan30Plus),
      href: '/finance',
      tone: 'warning',
    },
    debtCollectionSummary.promisedToday > 0 && {
      id: 'money-promises',
      title: 'Обещания сегодня',
      detail: 'Нужно проверить поступления и коммуникации',
      value: String(debtCollectionSummary.promisedToday),
      href: '/finance',
      tone: 'info',
    },
    todayPaymentRows.length > 0 && {
      id: 'money-due',
      title: 'Платежи сегодня',
      detail: 'Ожидаемые платежи по арендам',
      value: String(todayPaymentRows.length),
      href: '/payments',
      tone: 'warning',
    },
  ].filter(Boolean) as DashboardRisk[];
  const documentStatusChartData = useMemo(() => groupCountChart(documents, item => item.status, documentStatusLabels), [documents]);
  const documentTypeChartData = useMemo(() => groupCountChart(documents, item => item.type || item.documentType || 'other', documentTypeLabels).slice(0, 8), [documents]);
  const documentPeriodData = useMemo(() => {
    const now = new Date(today);
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      return { key: monthKey(date), label: MONTH_LABELS[date.getMonth()], value: 0 };
    });
    const monthMap = new Map(months.map(item => [item.key, item]));
    documents.forEach(document => {
      const parsed = new Date(document.documentDate || document.date || document.createdAt || '');
      if (Number.isNaN(parsed.getTime())) return;
      const target = monthMap.get(monthKey(parsed));
      if (!target) return;
      target.value += 1;
    });
    return months;
  }, [documents, today]);
  const documentNumberCounts = documents.reduce((map, document) => {
    const number = (document.documentNumber || document.number || '').trim();
    if (number) map.set(number, (map.get(number) || 0) + 1);
    return map;
  }, new Map<string, number>());
  const duplicateDocumentNumbers = [...documentNumberCounts.values()].filter(count => count > 1).length;
  const documentsWithoutNumber = documents.filter(document => !(document.documentNumber || document.number || '').trim()).length;
  const documentsWithoutFile = documents.filter(document => !document.fileUrl && !document.fileName && !document.signedScanDataUrl).length;
  const documentRiskItems: DashboardRisk[] = [
    documentsWithoutNumber > 0 && {
      id: 'doc-number',
      title: 'Без номера',
      detail: 'Документы требуют аккуратной нумерации',
      value: String(documentsWithoutNumber),
      href: '/documents',
      tone: 'warning',
    },
    duplicateDocumentNumbers > 0 && {
      id: 'doc-duplicates',
      title: 'Дубли номеров',
      detail: 'Одинаковые номера встречаются больше одного раза',
      value: String(duplicateDocumentNumbers),
      href: '/documents',
      tone: 'danger',
    },
    documentControl.kpi.unsignedDocuments > 0 && {
      id: 'doc-unsigned',
      title: 'Неподписанные',
      detail: 'Документы ждут подписи или закрытия',
      value: String(documentControl.kpi.unsignedDocuments),
      href: '/documents',
      tone: 'warning',
    },
    documentsWithoutFile > 0 && {
      id: 'doc-files',
      title: 'Без файла',
      detail: 'В карточках нет приложенного файла или скана',
      value: String(documentsWithoutFile),
      href: '/documents',
      tone: 'info',
    },
  ].filter(Boolean) as DashboardRisk[];
  const deliveryStatusChartData = useMemo(() => groupCountChart(deliveries, item => item.status, deliveryStatusLabels), [deliveries]);
  const carrierWorkloadChartData = useMemo(() => groupCountChart(activeDeliveries, item => item.carrierName || 'Без перевозчика').slice(0, 8), [activeDeliveries]);
  const tomorrowDeliveries = activeDeliveries.filter(delivery => toDateKey(delivery.transportDate || delivery.neededBy) === tomorrowStart.toISOString().slice(0, 10));
  const completedDeliveriesThisMonth = deliveries.filter(delivery => delivery.status === 'completed' && new Date(delivery.completedAt || delivery.transportDate || delivery.updatedAt || '') >= monthStart);
  const deliveriesWithoutAddress = activeDeliveries.filter(delivery => !(delivery.destination || delivery.objectAddress || '').trim());
  const deliveriesWithoutContact = activeDeliveries.filter(delivery => !(delivery.contactPhone || delivery.objectContactPhone || delivery.contactName || '').trim());
  const deliveryRiskItems: DashboardRisk[] = [
    unassignedDeliveries.length > 0 && {
      id: 'delivery-carrier',
      title: 'Без перевозчика',
      detail: 'Активные доставки не назначены перевозчику',
      value: String(unassignedDeliveries.length),
      href: '/deliveries',
      tone: 'warning',
    },
    overdueDeliveries.length > 0 && {
      id: 'delivery-overdue',
      title: 'Просрочены',
      detail: 'Дата доставки уже прошла',
      value: String(overdueDeliveries.length),
      href: '/deliveries',
      tone: 'danger',
    },
    deliveriesWithoutAddress.length > 0 && {
      id: 'delivery-address',
      title: 'Без адреса',
      detail: 'Нет понятного адреса назначения',
      value: String(deliveriesWithoutAddress.length),
      href: '/deliveries',
      tone: 'warning',
    },
    deliveriesWithoutContact.length > 0 && {
      id: 'delivery-contact',
      title: 'Без контакта',
      detail: 'Нет контакта клиента или объекта',
      value: String(deliveriesWithoutContact.length),
      href: '/deliveries',
      tone: 'info',
    },
  ].filter(Boolean) as DashboardRisk[];

  const dashboardTabs = [
    { id: 'overview' as const, label: 'Обзор', visible: true },
    { id: 'rentals' as const, label: 'Аренда', visible: canViewRentals },
    { id: 'fleet' as const, label: 'Техника', visible: canViewEquipment },
    { id: 'service' as const, label: 'Сервис', visible: canViewService },
    { id: 'money' as const, label: 'Деньги', visible: canViewMoney },
    { id: 'documents' as const, label: 'Документы', visible: canViewDocuments },
    { id: 'deliveries' as const, label: 'Доставка', visible: canViewDeliveries },
  ].filter(tab => tab.visible);
  const roleDashboardTab: DashboardTabId = isMechanicRole(user?.role)
    ? 'service'
    : user?.role === 'Офис-менеджер' || user?.role === 'Администратор'
      ? 'documents'
      : isManagerRole
        ? 'rentals'
        : 'overview';

  useEffect(() => {
    if (!dashboardTabs.some(tab => tab.id === activeDashboardTab)) {
      setActiveDashboardTab('overview');
    }
  }, [activeDashboardTab, dashboardTabs]);

  // Equipment in service with critical tickets (blocking rentals)
  const criticalInService = equipmentInServiceList.filter(e =>
    tickets.some(t =>
      (
        (t.equipmentId && t.equipmentId === e.id) ||
        (t.serialNumber && t.serialNumber === e.serialNumber) ||
        (!t.equipmentId && t.inventoryNumber && uniqueEquipmentByInventory.get(t.inventoryNumber)?.id === e.id)
      ) &&
      (t.priority === 'critical' || t.priority === 'high') &&
      t.status !== 'closed'
    )
  ).length;

  const overdueDebtCount = overduePayments.length;

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

  const alertItems: AlertItem[] = [];

  // 1. Просроченные возвраты (критично)
  if (shouldShowRentalAttention) {
    overdueRentalsList.forEach(r => {
      const days = Math.max(1, Math.ceil((today.getTime() - new Date(r.endDate).getTime()) / 86400000));
      alertItems.push({
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
      alertItems.push({
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
    alertItems.push({
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
    const blockedEq = (r.equipment || [])
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
      alertItems.push({
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
    alertItems.push({
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
        alertItems.push({
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
    const hasActive = activeRentalsList.some(r => r.clientId === c.id || (!r.clientId && r.client === c.company));
    if (hasActive) {
      alertItems.push({
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
      alertItems.push({
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
    alertItems.push({
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
  alertItems.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const ALERTS_PREVIEW = 7;
  const visibleAlerts = showAllAlerts ? alertItems : alertItems.slice(0, ALERTS_PREVIEW);
  const criticalCount = alertItems.filter(a => a.priority === 'critical').length;
  const highCount = alertItems.filter(a => a.priority === 'high').length;
  const mediumCount = alertItems.filter(a => a.priority === 'medium').length;

  // ── KPI data objects for modal ──────────────────────────────────────────────
  const kpiData = {
    utilization: { totalEquipment, activeEquipment, rentedEquipment, availableEquipment, utilization },
    activeRentals: {
      activeRentals: activeRentalsList.map(rental => ({
        ...rental,
        equipment: [rental.equipmentInv],
        plannedReturnDate: rental.endDate,
        price: rental.amount,
        link: '/rentals',
      })),
    },
    returnsTodayTomorrow: {
      todayRentals: rentalsEndingToday.map(rental => ({
        ...rental,
        plannedReturnDate: rental.endDate,
        link: '/rentals',
      })),
      tomorrowRentals: rentalsEndingTomorrow.map(rental => ({
        ...rental,
        plannedReturnDate: rental.endDate,
        link: '/rentals',
      })),
    },
    overdueReturns: {
      overdueRentals: overdueRentalsList.map(rental => ({
        ...rental,
        plannedReturnDate: rental.endDate,
        link: '/rentals',
      })),
    },
    idleEquipment: {
      idleEquipment: idleEquipmentList,
      availableCount: availableEquipment,
      inactiveCount: inactiveEquipment,
    },
    openService: {
      openTickets: openServiceTickets,
    },
    unassignedService: {
      unassignedTickets: unassignedServiceTickets,
    },
    waitingParts: {
      waitingTickets: ticketsWaitingParts,
    },
    repeatFailures: {
      repeatFailures: repeatFailureRows,
    },
    serviceInDays: {
      equipmentInService: equipmentInServiceList,
      rows: serviceInDaysRows,
      averageDays: averageServiceDays,
      maxDays: maxServiceDays,
    },
    weekRevenue: {
      weekRevenue: Math.round(weekRevenue),
      activeRentalsCount: activeRentalsList.length,
      averagePrice: activeRentalsList.length > 0
        ? Math.round(activeRentalsList.reduce((s, r) => s + (r.amount || 0), 0) / activeRentalsList.length)
        : 0,
    },
    totalDebt: {
      totalDebt,
      clients: computedClients.filter(c => (c.debt ?? 0) > 0),
      overduePayments,
    },
    monthDebt: { monthDebt, overduePayments: monthOverduePayments },
  };

  const dashboardEquipmentRisk = React.useMemo(() => {
    const rows = mechanicWorkload?.rows ?? [];
    const map = new Map<string, {
      equipmentId: string;
      equipmentLabel: string;
      inventoryNumber: string;
      serialNumber: string;
      repairs: Set<string>;
      totalNormHours: number;
      partsCost: number;
    }>();

    for (const row of rows) {
      const key = row.equipmentId || `${row.inventoryNumber}-${row.serialNumber}`;
      if (!map.has(key)) {
        map.set(key, {
          equipmentId: row.equipmentId,
          equipmentLabel: row.equipmentLabel,
          inventoryNumber: row.inventoryNumber,
          serialNumber: row.serialNumber,
          repairs: new Set(),
          totalNormHours: 0,
          partsCost: 0,
        });
      }
      const item = map.get(key)!;
      item.repairs.add(row.repairId);
      item.totalNormHours += row.totalNormHours;
      item.partsCost += row.partsCost;
    }

    return [...map.values()]
      .map(item => ({
        ...item,
        repairsCount: item.repairs.size,
        totalNormHours: Number(item.totalNormHours.toFixed(2)),
        partsCost: Number(item.partsCost.toFixed(2)),
        risk: assessServiceRisk({
          repairsCount: item.repairs.size,
          totalNormHours: Number(item.totalNormHours.toFixed(2)),
          partsCost: Number(item.partsCost.toFixed(2)),
        }),
      }))
      .filter(item => item.risk.level !== 'low')
      .sort((a, b) => {
        const score = { high: 2, medium: 1, low: 0 };
        return score[b.risk.level] - score[a.risk.level] || b.totalNormHours - a.totalNormHours;
      })
      .slice(0, 4);
  }, [mechanicWorkload]);

  const dashboardModelRisk = React.useMemo(() => {
    const rows = mechanicWorkload?.rows ?? [];
    const map = new Map<string, {
      label: string;
      units: Set<string>;
      repairs: Set<string>;
      totalNormHours: number;
      partsCost: number;
    }>();

    for (const row of rows) {
      const key = `${row.equipmentTypeLabel || row.equipmentType}__${row.equipmentLabel}`;
      if (!map.has(key)) {
        map.set(key, {
          label: row.equipmentLabel,
          units: new Set(),
          repairs: new Set(),
          totalNormHours: 0,
          partsCost: 0,
        });
      }
      const item = map.get(key)!;
      item.units.add(row.equipmentId || `${row.inventoryNumber}-${row.serialNumber}`);
      item.repairs.add(row.repairId);
      item.totalNormHours += row.totalNormHours;
      item.partsCost += row.partsCost;
    }

    return [...map.values()]
      .map(item => ({
        label: item.label,
        unitsCount: item.units.size,
        repairsCount: item.repairs.size,
        totalNormHours: Number(item.totalNormHours.toFixed(2)),
        partsCost: Number(item.partsCost.toFixed(2)),
        risk: assessServiceRisk({
          repairsCount: item.repairs.size,
          totalNormHours: Number(item.totalNormHours.toFixed(2)),
          partsCost: Number(item.partsCost.toFixed(2)),
        }),
      }))
      .filter(item => item.risk.level !== 'low')
      .sort((a, b) => {
        const score = { high: 2, medium: 1, low: 0 };
        return score[b.risk.level] - score[a.risk.level] || b.repairsCount - a.repairsCount;
      })
      .slice(0, 4);
  }, [mechanicWorkload]);

  // ── rental status badge ─────────────────────────────────────────────────────
  const RENTAL_STATUS: Record<string, { label: string; color: string }> = {
    new:            { label: 'Новая',     color: 'bg-gray-100 text-gray-700' },
    confirmed:      { label: 'Подтверждена', color: 'bg-blue-100 text-blue-700' },
    delivery:       { label: 'Доставка',  color: 'bg-yellow-100 text-yellow-700' },
    active:         { label: 'Активная',  color: 'bg-green-100 text-green-700' },
    return_planned: { label: 'Возврат',   color: 'bg-orange-100 text-orange-700' },
    closed:         { label: 'Закрыта',   color: 'bg-gray-100 text-gray-500' },
  };

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 p-4 sm:space-y-6 sm:p-6 md:p-8">

      <div className="app-panel overflow-hidden">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Главное</div>
            <h1 className="app-shell-title mt-1 text-3xl font-extrabold text-foreground sm:text-4xl">Дашборд</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Обновлено: {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="inline-flex min-w-max gap-2 rounded-2xl border border-border/80 bg-card/80 p-1">
          {dashboardTabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveDashboardTab(tab.id)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                activeDashboardTab === tab.id
                  ? 'bg-primary text-primary-foreground shadow-sm dark:bg-emerald-500/18 dark:text-emerald-200 dark:ring-1 dark:ring-emerald-400/30'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeDashboardTab === 'overview' && (
        <section className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Executive overview</p>
              <h2 className="app-shell-title mt-1 text-2xl font-extrabold text-foreground sm:text-3xl">
                Операционная сводка компании
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                Аренда, техника, сервис, документы и деньги в одном управленческом экране.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm shadow-[0_18px_44px_-36px_rgba(15,23,42,0.38)] dark:shadow-none">
              <span className="text-muted-foreground">Период</span>
              <span className="ml-3 font-semibold text-foreground">
                {today.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
              </span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {overviewKpiCards.map(item => {
              const Icon = item.icon;
              const tone = item.tone === 'danger'
                ? {
                    card: 'border-red-200/80 bg-white hover:border-red-300 dark:border-red-900/50 dark:bg-card',
                    bubble: 'bg-red-50 text-red-500 dark:bg-red-900/25 dark:text-red-300',
                    accent: 'text-red-600 dark:text-red-300',
                  }
                : item.tone === 'warning'
                  ? {
                      card: 'border-amber-200/80 bg-white hover:border-amber-300 dark:border-amber-900/50 dark:bg-card',
                      bubble: 'bg-amber-50 text-amber-500 dark:bg-amber-900/25 dark:text-amber-300',
                      accent: 'text-amber-600 dark:text-amber-300',
                    }
                  : item.tone === 'success'
                    ? {
                        card: 'border-emerald-200/80 bg-white hover:border-emerald-300 dark:border-emerald-900/50 dark:bg-card',
                        bubble: 'bg-emerald-50 text-emerald-500 dark:bg-emerald-900/25 dark:text-emerald-300',
                        accent: 'text-emerald-600 dark:text-emerald-300',
                      }
                    : {
                        card: 'border-border bg-white hover:border-blue-300 dark:bg-card',
                        bubble: 'bg-blue-50 text-blue-600 dark:bg-primary/12 dark:text-primary',
                        accent: 'text-blue-600 dark:text-primary',
                      };
              const content = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-muted-foreground">{item.label}</p>
                      <p className="mt-2 text-2xl font-extrabold text-foreground">{item.value}</p>
                    </div>
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${tone.bubble}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>
                  <p className={`mt-4 line-clamp-2 text-sm ${tone.accent}`}>{item.hint}</p>
                </>
              );
              const className = `rounded-2xl border p-4 text-left shadow-[0_18px_44px_-36px_rgba(15,23,42,0.38)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_54px_-38px_rgba(15,23,42,0.45)] dark:shadow-none ${tone.card}`;

              return item.href ? (
                <Link key={item.id} to={item.href} className={className}>
                  {content}
                </Link>
              ) : (
                <button key={item.id} type="button" onClick={item.onClick} className={className}>
                  {content}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <Card className="overflow-hidden border-border bg-card shadow-[0_20px_56px_-42px_rgba(15,23,42,0.45)] dark:shadow-none xl:col-span-8">
              <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="app-shell-title text-xl font-extrabold">Динамика выручки</CardTitle>
                  <CardDescription>Сумма аренд по датам начала за последние 6 месяцев.</CardDescription>
                </div>
                <Badge variant="info" className="w-fit bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                  {hasRevenueTrend ? formatCurrency(revenueTrendData.reduce((sum, item) => sum + item.revenue, 0)) : 'Нет данных'}
                </Badge>
              </CardHeader>
              <CardContent className="h-[300px] px-4 pb-5 pt-2 sm:px-6">
                {hasRevenueTrend ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={revenueTrendData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="dashboardRevenueGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#2563eb" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="currentColor" strokeDasharray="3 3" className="text-slate-200 dark:text-slate-800" vertical={false} />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'currentColor', fontSize: 12 }} className="text-muted-foreground" />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: 'currentColor', fontSize: 12 }} className="text-muted-foreground" tickFormatter={formatCompactCurrency} width={48} />
                      <Tooltip
                        formatter={(value) => [formatCurrency(Number(value)), 'Выручка']}
                        contentStyle={{ borderRadius: 14, borderColor: 'var(--border)', boxShadow: '0 18px 42px -28px rgba(15,23,42,.45)' }}
                      />
                      <Area type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={3} fill="url(#dashboardRevenueGradient)" dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border bg-muted/35 text-center text-sm text-muted-foreground">
                    Недостаточно данных по арендам для графика выручки.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border bg-card shadow-[0_20px_56px_-42px_rgba(15,23,42,0.45)] dark:shadow-none xl:col-span-4">
              <CardHeader className="pb-2">
                <CardTitle className="app-shell-title text-xl font-extrabold">Сегодня</CardTitle>
                <CardDescription>Задачи, риски и быстрые переходы.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {todayWorkRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                    Для текущей роли нет дневных задач на дашборде.
                  </div>
                ) : todayWorkRows.map(item => {
                  const marker = item.tone === 'danger'
                    ? 'bg-red-500'
                    : item.tone === 'warning'
                      ? 'bg-amber-500'
                      : item.tone === 'success'
                        ? 'bg-emerald-500'
                        : 'bg-blue-500';
                  return (
                    <Link key={item.id} to={item.href} className="flex items-center gap-3 rounded-2xl border border-border bg-white px-3 py-3 transition hover:border-blue-300 hover:bg-blue-50/45 dark:bg-background/30 dark:hover:bg-accent/40">
                      <span className={`h-9 w-1 rounded-full ${marker}`} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{item.label}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.detail}</p>
                      </div>
                      <span className="text-lg font-extrabold text-foreground">{item.value}</span>
                    </Link>
                  );
                })}

                {quickActions.length > 0 && (
                  <div className="border-t border-border pt-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Быстрые действия</p>
                    <div className="grid grid-cols-2 gap-2">
                      {quickActions.slice(0, 6).map(action => {
                        const Icon = action.icon;
                        return (
                          <Link
                            key={action.id}
                            to={action.href}
                            className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-white px-3 py-3 text-center text-xs font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-50 dark:bg-background/30 dark:text-primary dark:hover:bg-accent/40"
                          >
                            <Icon className="h-5 w-5" />
                            <span>{action.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <Card className="border-border bg-card shadow-[0_20px_56px_-42px_rgba(15,23,42,0.45)] dark:shadow-none xl:col-span-4">
              <CardHeader className="pb-2">
                <CardTitle className="app-shell-title text-lg font-extrabold">Загрузка техники</CardTitle>
                <CardDescription>{activeEquipment > 0 ? `${utilization}% текущей загрузки` : 'Активный парк не сформирован'}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="h-[210px]">
                  {hasFleetDonutData ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={fleetDonutData} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="82%" paddingAngle={4}>
                          {fleetDonutData.map(item => <Cell key={item.label} fill={item.fill} />)}
                        </Pie>
                        <Tooltip contentStyle={{ borderRadius: 14, borderColor: 'var(--border)' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border bg-muted/35 text-sm text-muted-foreground">Нет данных по парку.</div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {fleetDonutData.map(item => (
                    <div key={item.label} className="flex items-center gap-2 rounded-xl bg-muted/45 px-3 py-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.fill }} />
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="ml-auto font-semibold text-foreground">{item.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card shadow-[0_20px_56px_-42px_rgba(15,23,42,0.45)] dark:shadow-none xl:col-span-4">
              <CardHeader className="pb-2">
                <CardTitle className="app-shell-title text-lg font-extrabold">Возраст дебиторки</CardTitle>
                <CardDescription>Долг по возрастным buckets без изменения расчётов.</CardDescription>
              </CardHeader>
              <CardContent className="h-[270px]">
                {hasReceivablesAging ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={receivablesAgingData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="currentColor" strokeDasharray="3 3" className="text-slate-200 dark:text-slate-800" vertical={false} />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'currentColor', fontSize: 12 }} className="text-muted-foreground" />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: 'currentColor', fontSize: 12 }} className="text-muted-foreground" tickFormatter={formatCompactCurrency} width={48} />
                      <Tooltip formatter={(value) => [formatCurrency(Number(value)), 'Долг']} contentStyle={{ borderRadius: 14, borderColor: 'var(--border)' }} />
                      <Bar dataKey="value" radius={[10, 10, 4, 4]}>
                        {receivablesAgingData.map(item => <Cell key={item.label} fill={item.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border bg-muted/35 text-sm text-muted-foreground">Просроченной дебиторки нет.</div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border bg-card shadow-[0_20px_56px_-42px_rgba(15,23,42,0.45)] dark:shadow-none xl:col-span-4">
              <CardHeader className="pb-2">
                <CardTitle className="app-shell-title text-lg font-extrabold">Сервисные заявки</CardTitle>
                <CardDescription>Открытые статусы и критичные обращения.</CardDescription>
              </CardHeader>
              <CardContent className="h-[270px]">
                {hasServiceStatusData ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={serviceStatusChartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="currentColor" strokeDasharray="3 3" className="text-slate-200 dark:text-slate-800" vertical={false} />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'currentColor', fontSize: 12 }} className="text-muted-foreground" />
                      <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'currentColor', fontSize: 12 }} className="text-muted-foreground" width={32} />
                      <Tooltip formatter={(value) => [Number(value).toLocaleString('ru-RU'), 'Заявки']} contentStyle={{ borderRadius: 14, borderColor: 'var(--border)' }} />
                      <Bar dataKey="value" radius={[10, 10, 4, 4]}>
                        {serviceStatusChartData.map(item => <Cell key={item.label} fill={item.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border bg-muted/35 text-sm text-muted-foreground">Открытых сервисных заявок нет.</div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {activeDashboardTab === 'rentals' && (
        <section className="space-y-5">
          <DashboardKpiGrid cards={[
            { id: 'rentals-active', label: 'Активные аренды', value: String(activeRentalsList.length), hint: `${rentedOrReservedEquipment} ед. техники задействовано`, icon: Calendar, tone: 'default', onClick: () => setSelectedKPI('activeRentals') },
            { id: 'rentals-new', label: 'Новые / ожидают', value: String(reservedRentalsList.length), hint: 'Созданы или подтверждены к выдаче', icon: Clock, tone: 'info', href: '/rentals' },
            { id: 'rentals-today', label: 'Возвраты сегодня', value: String(rentalsEndingToday.length), hint: rentalsEndingToday.length > 0 ? 'Нужен контроль закрытия' : 'Пиков возврата нет', icon: RefreshCw, tone: rentalsEndingToday.length > 0 ? 'warning' : 'success', onClick: () => setSelectedKPI('returnsTodayTomorrow') },
            { id: 'rentals-soon', label: 'Возвраты завтра', value: String(rentalsEndingTomorrow.length), hint: 'Ближайшая операционная нагрузка', icon: Calendar, tone: 'violet', onClick: () => setSelectedKPI('returnsTodayTomorrow') },
            { id: 'rentals-overdue', label: 'Просроченные возвраты', value: String(overdueRentalsList.length), hint: maxOverdueDays > 0 ? `Макс. ${maxOverdueDays} дн.` : 'Просрочек нет', icon: AlertTriangle, tone: overdueRentalsList.length > 0 ? 'danger' : 'success', onClick: () => setSelectedKPI('overdueReturns') },
            { id: 'rentals-debt', label: 'Аренды с долгом', value: String(rentalsWithDebtCount), hint: canViewMoney ? formatCurrency(totalDebt) : 'Сумма скрыта правами', icon: DollarSign, tone: rentalsWithDebtCount > 0 ? 'warning' : 'success', href: '/finance' },
          ]} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <DashboardChartCard title="Аренды по статусам" description="Распределение текущего арендного портфеля." empty={rentalStatusChartData.length === 0} className="xl:col-span-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rentalStatusChartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.24)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip cursor={{ fill: 'rgba(37,99,235,0.08)' }} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>{rentalStatusChartData.map(item => <Cell key={item.key} fill={item.fill} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </DashboardChartCard>
            <DashboardChartCard title="Возвраты по дням" description="Нагрузка на ближайшие 10 дней." empty={!nextReturnBuckets.some(item => item.value > 0)} className="xl:col-span-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={nextReturnBuckets} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.24)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip cursor={{ fill: 'rgba(139,92,246,0.08)' }} />
                  <Bar dataKey="value" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </DashboardChartCard>
            <DashboardRiskPanel title="Риски аренды" description="Что может сорвать закрытие, оплату или документы." items={rentalsRiskItems} className="xl:col-span-4" />
          </div>
          <DashboardChartCard title="Аренды по менеджерам" description="Активность в арендном портфеле по ответственным." empty={rentalManagerChartData.length === 0}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rentalManagerChartData} layout="vertical" margin={{ top: 8, right: 16, left: 24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.24)" />
                <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} fontSize={12} width={120} />
                <Tooltip cursor={{ fill: 'rgba(16,185,129,0.08)' }} />
                <Bar dataKey="value" fill="#10b981" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </DashboardChartCard>
        </section>
      )}

      {activeDashboardTab === 'fleet' && (
        <section className="space-y-5">
          <DashboardKpiGrid cards={[
            { id: 'fleet-total', label: 'Всего техники', value: String(totalEquipment), hint: `${activeEquipment} ед. активного парка`, icon: Truck, tone: 'default' },
            { id: 'fleet-available', label: 'Доступно', value: String(availableEquipment), hint: 'Готово к выдаче', icon: CheckCircle, tone: 'success' },
            { id: 'fleet-rented', label: 'В аренде', value: String(rentedEquipment), hint: activeEquipment > 0 ? `${utilization}% загрузки` : 'Активный парк не сформирован', icon: TrendingUp, tone: 'info', onClick: () => setSelectedKPI('utilization') },
            { id: 'fleet-service', label: 'В сервисе', value: String(equipmentInServiceList.length), hint: `Ср. ${averageServiceDays || 0} дн.`, icon: Wrench, tone: equipmentInServiceList.length > 0 ? 'warning' : 'success', onClick: () => setSelectedKPI('serviceInDays') },
            { id: 'fleet-idle', label: 'Свободно / простой', value: String(idleEquipmentList.length), hint: 'Резерв и неактивные единицы', icon: PackageX, tone: idleEquipmentList.length > 0 ? 'violet' : 'success', onClick: () => setSelectedKPI('idleEquipment') },
            { id: 'fleet-inactive', label: 'Неактивно', value: String(inactiveEquipment), hint: 'Списано/не в работе по статусу', icon: Ban, tone: inactiveEquipment > 0 ? 'warning' : 'success' },
          ]} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <DashboardChartCard title="Статусы парка" description="Снимок текущего состояния техники." empty={fleetStatusChartData.length === 0} className="xl:col-span-4">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={fleetStatusChartData} dataKey="value" nameKey="label" innerRadius="56%" outerRadius="82%" paddingAngle={4}>
                    {fleetStatusChartData.map(item => <Cell key={item.key} fill={item.fill} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </DashboardChartCard>
            <DashboardChartCard title="Парк по типам" description="Структура техники по типам." empty={fleetTypeChartData.length === 0} className="xl:col-span-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fleetTypeChartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.24)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip cursor={{ fill: 'rgba(37,99,235,0.08)' }} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>{fleetTypeChartData.map(item => <Cell key={item.key} fill={item.fill} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </DashboardChartCard>
            <DashboardRiskPanel title="Риски парка" description="Сигналы по доступности, ТО и качеству карточек." items={fleetRiskItems} className="xl:col-span-4" />
          </div>
          <Card className="app-panel border-border/80 bg-card/95">
            <CardHeader>
              <CardTitle className="text-lg">Загрузка парка</CardTitle>
              <CardDescription>Snapshot текущей загрузки без искусственной динамики.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-end justify-between">
                  <span className="text-4xl font-extrabold text-foreground">{activeEquipment === 0 ? '—' : `${utilization}%`}</span>
                  <span className="text-sm text-muted-foreground">{rentedEquipment} из {activeEquipment} ед.</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-[linear-gradient(90deg,#2563eb,#8b5cf6)]" style={{ width: `${Math.min(100, Math.max(0, utilization))}%` }} />
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {activeDashboardTab === 'service' && (
        <section className="space-y-5">
          <DashboardKpiGrid cards={[
            { id: 'service-open', label: 'Открытые заявки', value: String(openServiceTickets.length), hint: `${criticalTickets.length} крит./высоких`, icon: Wrench, tone: openServiceTickets.length > 0 ? 'warning' : 'success', onClick: () => setSelectedKPI('openService') },
            { id: 'service-work', label: 'В работе', value: String(openServiceTickets.filter(ticket => ticket.status === 'in_progress').length), hint: 'Активная сервисная очередь', icon: Activity, tone: 'info' },
            { id: 'service-parts', label: 'Ждут запчасти', value: String(ticketsWaitingParts.length), hint: 'Зависит от снабжения', icon: Clock, tone: ticketsWaitingParts.length > 0 ? 'warning' : 'success', onClick: () => setSelectedKPI('waitingParts') },
            { id: 'service-ready', label: 'Готово к закрытию', value: String(readyServiceTickets.length), hint: 'Можно финализировать', icon: CheckCircle, tone: 'success' },
            { id: 'service-critical', label: 'Критичные', value: String(criticalTickets.length), hint: 'Высокий приоритет', icon: ShieldAlert, tone: criticalTickets.length > 0 ? 'danger' : 'success' },
            { id: 'service-age', label: 'Средний возраст', value: `${averageServiceDays || 0} дн.`, hint: maxServiceDays > 0 ? `Макс. ${maxServiceDays} дн.` : 'Открытых заявок нет', icon: Calendar, tone: averageServiceDays > 7 ? 'warning' : 'default', onClick: () => setSelectedKPI('serviceInDays') },
          ]} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <DashboardChartCard title="Заявки по статусам" description="Текущая сервисная воронка." empty={!hasServiceStatusData} className="xl:col-span-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serviceStatusChartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.24)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip cursor={{ fill: 'rgba(245,158,11,0.08)' }} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>{serviceStatusChartData.map(item => <Cell key={item.label} fill={item.fill} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </DashboardChartCard>
            <DashboardChartCard title="Заявки по приоритетам" description="Риск-профиль открытой очереди." empty={servicePriorityChartData.length === 0} className="xl:col-span-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={servicePriorityChartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.24)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip cursor={{ fill: 'rgba(239,68,68,0.08)' }} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>{servicePriorityChartData.map(item => <Cell key={item.key} fill={item.fill} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </DashboardChartCard>
            <DashboardRiskPanel title="Сервисные риски" description="Что тормозит возврат техники в парк." items={serviceRiskItems} className="xl:col-span-4" />
          </div>
          <DashboardChartCard title="Нагрузка по механикам" description="Открытые заявки по назначенным исполнителям." empty={mechanicWorkloadChartData.length === 0}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mechanicWorkloadChartData} layout="vertical" margin={{ top: 8, right: 16, left: 24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.24)" />
                <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} fontSize={12} width={120} />
                <Tooltip cursor={{ fill: 'rgba(99,102,241,0.08)' }} />
                <Bar dataKey="value" radius={[0, 8, 8, 0]}>{mechanicWorkloadChartData.map(item => <Cell key={item.label} fill={item.fill} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </DashboardChartCard>
        </section>
      )}

      {activeDashboardTab === 'money' && canViewMoney && (
        <section className="space-y-5">
          <DashboardKpiGrid cards={[
            { id: 'money-payments', label: 'Платежи', value: formatCurrency(payments.reduce((sum, payment) => sum + (payment.paidAmount || 0), 0)), hint: `${payments.length} записей`, icon: CreditCard, tone: 'success', href: '/payments' },
            { id: 'money-debt', label: 'Дебиторка', value: totalDebt > 0 ? formatCurrency(totalDebt) : '0 ₽', hint: `${clientDebtAgingRows.length} клиентов в aging`, icon: DollarSign, tone: totalDebt > 0 ? 'warning' : 'success', onClick: () => setSelectedKPI('totalDebt') },
            { id: 'money-overdue', label: 'Просрочка', value: formatCurrency(overduePayments.reduce((sum, row) => sum + row.outstanding, 0)), hint: `${overduePayments.length} строк`, icon: AlertTriangle, tone: overduePayments.length > 0 ? 'danger' : 'success' },
            { id: 'money-actions', label: 'Планы взыскания', value: String(debtCollectionSummary.overdueActions), hint: `${debtCollectionSummary.promisedToday} обещаний сегодня`, icon: ListChecks, tone: debtCollectionSummary.overdueActions > 0 ? 'danger' : 'info', href: '/finance' },
            { id: 'money-today', label: 'К оплате сегодня', value: String(todayPaymentRows.length), hint: todayPaymentRows.length > 0 ? formatCurrency(todayPaymentRows.reduce((sum, row) => sum + row.outstanding, 0)) : 'Нет ожидаемых оплат', icon: Clock, tone: todayPaymentRows.length > 0 ? 'warning' : 'success' },
            { id: 'money-month', label: 'Просрочка месяца', value: monthDebt > 0 ? formatCurrency(monthDebt) : '0 ₽', hint: `${monthOverduePayments.length} строк`, icon: TrendingUp, tone: monthDebt > 0 ? 'warning' : 'success', onClick: () => setSelectedKPI('monthDebt') },
          ]} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <DashboardChartCard title="Дебиторка по возрасту" description="Aging buckets без изменения финансовых расчётов." empty={!hasReceivablesAging} className="xl:col-span-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={receivablesAgingData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.24)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickFormatter={formatCompactCurrency} tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} cursor={{ fill: 'rgba(239,68,68,0.08)' }} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>{receivablesAgingData.map(item => <Cell key={item.label} fill={item.fill} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </DashboardChartCard>
            <DashboardChartCard title="Финансовая нагрузка" description="Краткая сводка по уже доступным финансовым данным." empty={!financeLoadData.some(item => item.value > 0)} className="xl:col-span-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={financeLoadData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.24)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickFormatter={formatCompactCurrency} tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} cursor={{ fill: 'rgba(37,99,235,0.08)' }} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>{financeLoadData.map(item => <Cell key={item.label} fill={item.fill} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </DashboardChartCard>
            <DashboardRiskPanel title="Финансовые риски" description="Куда перейти для детальной работы в финансах." items={moneyRiskItems} className="xl:col-span-4" />
          </div>
          <DashboardChartCard title="Платежи / поступления" description="Агрегация платежей по датам оплаты или срокам." empty={!paymentTrendData.some(item => item.value > 0)}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={paymentTrendData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="paymentTrendGradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.32} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.24)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickFormatter={formatCompactCurrency} tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={3} fill="url(#paymentTrendGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </DashboardChartCard>
        </section>
      )}

      {activeDashboardTab === 'documents' && (
        <section className="space-y-5">
          <DashboardKpiGrid cards={[
            { id: 'doc-total', label: 'Всего документов', value: String(documents.length), hint: 'Реестр документов', icon: FileText, tone: 'default', href: '/documents' },
            { id: 'doc-number', label: 'Без номера', value: String(documentsWithoutNumber), hint: 'Требуют аккуратной нумерации', icon: ClipboardX, tone: documentsWithoutNumber > 0 ? 'warning' : 'success' },
            { id: 'doc-duplicates', label: 'Дубли номеров', value: String(duplicateDocumentNumbers), hint: 'Нужно проверить реестр', icon: ShieldAlert, tone: duplicateDocumentNumbers > 0 ? 'danger' : 'success' },
            { id: 'doc-unsigned', label: 'Неподписанные', value: String(documentControl.kpi.unsignedDocuments), hint: `${documentControl.kpi.overdueSignature} просрочено`, icon: Clock, tone: documentControl.kpi.unsignedDocuments > 0 ? 'warning' : 'success' },
            { id: 'doc-signed', label: 'Подписанные', value: String(documents.filter(document => document.status === 'signed').length), hint: 'Закрытый документооборот', icon: CheckCircle, tone: 'success' },
            { id: 'doc-month', label: 'За месяц', value: String(documents.filter(document => new Date(document.documentDate || document.date || document.createdAt || '') >= monthStart).length), hint: today.toLocaleDateString('ru-RU', { month: 'long' }), icon: Calendar, tone: 'violet' },
          ]} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <DashboardChartCard title="Документы по статусам" description="Черновики, отправленные и подписанные документы." empty={documentStatusChartData.length === 0} className="xl:col-span-4">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={documentStatusChartData} dataKey="value" nameKey="label" innerRadius="56%" outerRadius="82%" paddingAngle={4}>
                    {documentStatusChartData.map(item => <Cell key={item.key} fill={item.fill} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </DashboardChartCard>
            <DashboardChartCard title="Документы по типам" description="Структура реестра по типам." empty={documentTypeChartData.length === 0} className="xl:col-span-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={documentTypeChartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.24)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip cursor={{ fill: 'rgba(139,92,246,0.08)' }} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>{documentTypeChartData.map(item => <Cell key={item.key} fill={item.fill} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </DashboardChartCard>
            <DashboardRiskPanel title="Документные риски" description="Что тормозит закрытие аренды и оплату." items={documentRiskItems} className="xl:col-span-4" />
          </div>
          <DashboardChartCard title="Документы за период" description="Создание документов по месяцам." empty={!documentPeriodData.some(item => item.value > 0)}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={documentPeriodData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="documentPeriodGradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.32} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.24)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip />
                <Area type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={3} fill="url(#documentPeriodGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </DashboardChartCard>
        </section>
      )}

      {activeDashboardTab === 'deliveries' && (
        <section className="space-y-5">
          <DashboardKpiGrid cards={[
            { id: 'delivery-active', label: 'Активные доставки', value: String(activeDeliveries.length), hint: 'В работе сейчас', icon: Truck, tone: 'default', href: '/deliveries' },
            { id: 'delivery-today', label: 'Сегодня', value: String(todayDeliveries.length), hint: 'План на текущий день', icon: Calendar, tone: todayDeliveries.length > 0 ? 'warning' : 'success' },
            { id: 'delivery-tomorrow', label: 'Завтра', value: String(tomorrowDeliveries.length), hint: 'Ближайшая нагрузка', icon: Clock, tone: 'info' },
            { id: 'delivery-overdue', label: 'Просрочено', value: String(overdueDeliveries.length), hint: overdueDeliveries.length > 0 ? 'Нужно вмешательство' : 'Просрочек нет', icon: AlertTriangle, tone: overdueDeliveries.length > 0 ? 'danger' : 'success' },
            { id: 'delivery-done', label: 'Выполнено за месяц', value: String(completedDeliveriesThisMonth.length), hint: 'Закрытые перевозки', icon: CheckCircle, tone: 'success' },
            { id: 'delivery-carrier', label: 'Без перевозчика', value: String(unassignedDeliveries.length), hint: 'Нужна диспетчеризация', icon: User, tone: unassignedDeliveries.length > 0 ? 'warning' : 'success' },
          ]} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <DashboardChartCard title="Доставки по статусам" description="Текущий логистический поток." empty={deliveryStatusChartData.length === 0} className="xl:col-span-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deliveryStatusChartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.24)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip cursor={{ fill: 'rgba(37,99,235,0.08)' }} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>{deliveryStatusChartData.map(item => <Cell key={item.key} fill={item.fill} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </DashboardChartCard>
            <DashboardChartCard title="Доставки по дням" description="Плановая нагрузка на ближайшие 10 дней." empty={!deliveryDayBuckets.some(item => item.value > 0)} className="xl:col-span-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deliveryDayBuckets} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.24)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip cursor={{ fill: 'rgba(139,92,246,0.08)' }} />
                  <Bar dataKey="value" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </DashboardChartCard>
            <DashboardRiskPanel title="Логистические риски" description="Что может сорвать доставку или приёмку." items={deliveryRiskItems} className="xl:col-span-4" />
          </div>
          <DashboardChartCard title="Нагрузка по перевозчикам" description="Активные доставки по назначенным перевозчикам." empty={carrierWorkloadChartData.length === 0}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={carrierWorkloadChartData} layout="vertical" margin={{ top: 8, right: 16, left: 24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.24)" />
                <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} fontSize={12} width={120} />
                <Tooltip cursor={{ fill: 'rgba(16,185,129,0.08)' }} />
                <Bar dataKey="value" fill="#10b981" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </DashboardChartCard>
        </section>
      )}

      {false && (
      <>
      {activeDashboardTab === roleDashboardTab && roleDashboardMeta && roleDashboardCards.length > 0 && (
        <Card className={dashboardCardClass}>
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <Badge variant="default" className="bg-primary/12 text-primary dark:bg-primary/12 dark:text-primary">{roleDashboardMeta.badge}</Badge>
                <CardTitle className="app-shell-title text-xl font-extrabold">{roleDashboardMeta.title}</CardTitle>
                <CardDescription className="max-w-3xl text-sm text-muted-foreground">
                  {roleDashboardMeta.description}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 lg:grid-cols-4">
              {roleDashboardCards.map(item => {
                const Icon = item.icon;
                const toneClass =
                  item.tone === 'danger'
                    ? 'border-red-500/20 bg-red-500/8'
                    : item.tone === 'warning'
                    ? 'border-orange-400/20 bg-orange-400/8'
                    : item.tone === 'success'
                    ? 'border-emerald-400/20 bg-emerald-400/8'
                    : 'border-border bg-secondary/70';

                const iconClass =
                  item.tone === 'danger'
                    ? 'bg-red-500/12 text-red-400'
                    : item.tone === 'warning'
                    ? 'bg-orange-400/12 text-orange-300'
                    : item.tone === 'success'
                    ? 'bg-emerald-400/12 text-emerald-300'
                    : 'bg-primary/12 text-primary';

                return (
                  <div key={item.id} className={`rounded-2xl border p-4 ${toneClass}`}>
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconClass}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="mt-4">
                      <p className="text-sm font-medium text-muted-foreground">{item.title}</p>
                      <p className="mt-1 text-2xl font-bold text-foreground">{item.value}</p>
                      <p className="mt-2 text-sm text-muted-foreground">{item.hint}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Header old block removed */}

      {activeDashboardTab === 'rentals' && canViewTasksCenter && (
        <Card className={dashboardCardClass}>
          <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <ListChecks className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Задачи на сегодня</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {taskPrioritySummaryLabel('critical')}: {tasksCenterData?.summary?.critical ?? 0} · {taskPrioritySummaryLabel('high')}: {tasksCenterData?.summary?.high ?? 0} · Просрочено: {tasksCenterData?.summary?.overdue ?? 0} · Сегодня: {tasksCenterData?.summary?.today ?? 0}
                </p>
              </div>
            </div>
            <Button asChild variant="secondary">
              <Link to="/tasks">Открыть центр задач</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {activeDashboardTab === 'money' && canViewMoney && shouldShowAttentionSummary && (
        <section className={dashboardSectionClass}>
          <div className={dashboardSectionHeaderClass}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              Управленческий контроль
            </p>
            <h2 className="app-shell-title text-lg font-extrabold text-gray-900 dark:text-white">Что требует внимания сегодня</h2>
          </div>

          <Card className={dashboardCardClass}>
            <CardContent className="space-y-4 p-5">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <div className={`rounded-xl border p-4 ${attentionSummary.receivables.overdueDebt > 0 ? 'border-red-300 bg-red-50/60 dark:border-red-900/70 dark:bg-red-950/20' : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/70 dark:bg-emerald-950/20'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">Просроченная дебиторка</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {attentionSummary.receivables.overdueClients} клиентов · {attentionSummary.receivables.overdueRentals} аренд
                      </p>
                    </div>
                    <Badge variant={attentionSummary.receivables.overdueDebt > 0 ? 'destructive' : 'default'}>
                      {attentionSummary.receivables.overdueDebt > 0 ? 'критично' : 'норма'}
                    </Badge>
                  </div>
                  <p className={`mt-3 text-2xl font-bold ${attentionSummary.receivables.overdueDebt > 0 ? 'text-red-600 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-300'}`}>
                    {canViewMoney ? formatCurrency(attentionSummary.receivables.overdueDebt) : 'Сумма скрыта'}
                  </p>
                  <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                    60+ дней: {attentionSummary.receivables.rentals60Plus} аренд
                    {canViewMoney ? ` · ${formatCurrency(attentionSummary.receivables.debt60Plus)}` : ' · без суммы'}
                  </p>
                </div>

                <div className={`rounded-xl border p-4 ${debtCollectionSummary.overdueActions + debtCollectionSummary.withoutPlan30Plus + debtCollectionSummary.highPriority > 0 ? 'border-red-300 bg-red-50/60 dark:border-red-900/70 dark:bg-red-950/20' : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/70 dark:bg-emerald-950/20'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">План взыскания дебиторки</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Просрочено действий: {debtCollectionSummary.overdueActions} · обещаний сегодня: {debtCollectionSummary.promisedToday}
                      </p>
                    </div>
                    <ShieldAlert className="h-5 w-5 text-red-500" />
                  </div>
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-lg bg-white/70 px-3 py-2 dark:bg-gray-900/60">Без плана 30+ дн.: <strong>{debtCollectionSummary.withoutPlan30Plus}</strong></div>
                    <div className="rounded-lg bg-white/70 px-3 py-2 dark:bg-gray-900/60">Высокий/критичный приоритет: <strong>{debtCollectionSummary.highPriority}</strong></div>
                  </div>
                  {debtCollectionSummary.rows.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {debtCollectionSummary.rows.slice(0, 3).map(row => (
                        <div key={row.clientId || row.client} className="rounded-lg bg-white/70 px-3 py-2 text-xs dark:bg-gray-900/60">
                          <p className="font-medium text-gray-900 dark:text-white">{row.client}</p>
                          <p className="text-gray-500 dark:text-gray-400">
                            {row.nextAction} · {row.nextActionDate ? formatDate(row.nextActionDate) : 'дата не назначена'}
                            {canViewMoney ? ` · ${formatCurrency(row.debt)}` : ' · сумма скрыта'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className={`rounded-xl border p-4 ${attentionSummary.returns.today > 0 ? 'border-amber-300 bg-amber-50/60 dark:border-amber-900/70 dark:bg-amber-950/20' : 'border-border bg-secondary/50'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">Возвраты сегодня и завтра</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Сегодня {attentionSummary.returns.today} · завтра {attentionSummary.returns.tomorrow}
                      </p>
                    </div>
                    <Clock className="h-5 w-5 text-amber-500" />
                  </div>
                  <div className="mt-3 space-y-2">
                    {attentionSummary.returns.upcoming.length === 0 ? (
                      <p className="text-sm text-emerald-600 dark:text-emerald-300">Ближайших возвратов нет.</p>
                    ) : attentionSummary.returns.upcoming.map(item => (
                      <div key={`${item.id}-${item.date}`} className="rounded-lg bg-white/70 px-3 py-2 text-xs dark:bg-gray-900/60">
                        <p className="font-medium text-gray-900 dark:text-white">{item.client}</p>
                        <p className="text-gray-500 dark:text-gray-400">{item.equipment} · {formatDate(item.date)} · {item.manager}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {canViewDocuments && (
                <div className={`rounded-xl border p-4 ${documentControl.kpi.unsignedDocuments + documentControl.kpi.closedRentalsWithoutClosingDocs + documentControl.kpi.overdueSignature > 0 ? 'border-amber-300 bg-amber-50/60 dark:border-amber-900/70 dark:bg-amber-950/20' : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/70 dark:bg-emerald-950/20'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">Контроль документов</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Без подписи: {documentControl.kpi.unsignedDocuments} · закрытые без акта/УПД: {documentControl.kpi.closedRentalsWithoutClosingDocs}
                      </p>
                    </div>
                    <FileText className="h-5 w-5 text-amber-500" />
                  </div>
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-lg bg-white/70 px-3 py-2 dark:bg-gray-900/60">Отправлено без подписи: <strong>{documentControl.kpi.sentWaiting}</strong></div>
                    <div className="rounded-lg bg-white/70 px-3 py-2 dark:bg-gray-900/60">Просрочено: <strong>{documentControl.kpi.overdueSignature}</strong></div>
                    <div className="rounded-lg bg-white/70 px-3 py-2 dark:bg-gray-900/60">Без договора: <strong>{documentControl.kpi.rentalsWithoutContract}</strong></div>
                    <div className="rounded-lg bg-white/70 px-3 py-2 dark:bg-gray-900/60">Без связи: <strong>{documentControl.kpi.orphanDocuments}</strong></div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {documentControl.rows.length === 0 ? (
                      <p className="text-sm text-emerald-600 dark:text-emerald-300">Критичных документных рисков нет.</p>
                    ) : documentControl.rows.slice(0, 5).map(item => (
                      <div key={item.id} className="rounded-lg bg-white/70 px-3 py-2 text-xs dark:bg-gray-900/60">
                        <p className="font-medium text-gray-900 dark:text-white">{item.statusLabel} · {item.client}</p>
                        <p className="text-gray-500 dark:text-gray-400">{item.rentalId || item.documentId || 'документ'} · {item.responsible}</p>
                      </div>
                    ))}
                  </div>
                  <Button asChild variant="secondary" size="sm" className="mt-3">
                    <Link to="/documents">Открыть контроль</Link>
                  </Button>
                </div>
                )}

                <div className={`rounded-xl border p-4 ${attentionSummary.service.unassigned + attentionSummary.service.waitingParts + attentionSummary.service.urgent > 0 ? 'border-orange-300 bg-orange-50/60 dark:border-orange-900/70 dark:bg-orange-950/20' : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/70 dark:bg-emerald-950/20'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">Сервисные блокеры</p>
                    <Wrench className="h-5 w-5 text-orange-500" />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-white/70 px-3 py-2 dark:bg-gray-900/60">Без механика: <strong>{attentionSummary.service.unassigned}</strong></div>
                    <div className="rounded-lg bg-white/70 px-3 py-2 dark:bg-gray-900/60">Ждут запчасти: <strong>{attentionSummary.service.waitingParts}</strong></div>
                    <div className="rounded-lg bg-white/70 px-3 py-2 dark:bg-gray-900/60">Срочные: <strong>{attentionSummary.service.urgent}</strong></div>
                    <div className="rounded-lg bg-white/70 px-3 py-2 dark:bg-gray-900/60">В сервисе: <strong>{attentionSummary.service.equipmentInService}</strong></div>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-secondary/50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">Техника простаивает</p>
                    <Truck className="h-5 w-5 text-gray-500" />
                  </div>
                  <p className="mt-3 text-2xl font-bold text-gray-900 dark:text-white">{attentionSummary.idleEquipment.available}</p>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    Свободная техника. Дней простоя нет в данных, поэтому показатель не рассчитывается.
                  </p>
                </div>

                <div className={`rounded-xl border p-4 ${attentionSummary.highRiskClients.count > 0 ? 'border-red-300 bg-red-50/60 dark:border-red-900/70 dark:bg-red-950/20' : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/70 dark:bg-emerald-950/20'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">Клиенты высокого риска</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        60+ дней: {attentionSummary.highRiskClients.sixtyPlus} · активная аренда с просрочкой: {attentionSummary.highRiskClients.activeWithOverdue}
                      </p>
                    </div>
                    <ShieldAlert className="h-5 w-5 text-red-500" />
                  </div>
                  <div className="mt-3 space-y-2">
                    {!canViewMoney ? (
                      <p className="text-sm text-gray-600 dark:text-gray-300">Детализация долга скрыта правами доступа.</p>
                    ) : attentionSummary.highRiskClients.top.length === 0 ? (
                      <p className="text-sm text-emerald-600 dark:text-emerald-300">Клиентов высокого риска нет.</p>
                    ) : attentionSummary.highRiskClients.top.map(item => (
                      <div key={item.clientId || item.client} className="rounded-lg bg-white/70 px-3 py-2 text-xs dark:bg-gray-900/60">
                        <p className="font-medium text-gray-900 dark:text-white">{item.client}</p>
                        <p className="text-gray-500 dark:text-gray-400">{formatCurrency(item.debt)} · {item.maxOverdueDays} дн. · {item.manager}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-border pt-4 sm:flex sm:flex-wrap">
                {canViewFinance && <Button asChild variant="secondary" size="sm" className="w-full sm:w-auto"><Link to="/finance">Финансы</Link></Button>}
                {can('view', 'rentals') && <Button asChild variant="secondary" size="sm" className="w-full sm:w-auto"><Link to="/rentals">Аренды</Link></Button>}
                {canViewDocuments && <Button asChild variant="secondary" size="sm" className="w-full sm:w-auto"><Link to="/documents">Документы</Link></Button>}
                {canViewService && <Button asChild variant="secondary" size="sm" className="w-full sm:w-auto"><Link to="/service">Сервис</Link></Button>}
                {canViewEquipment && <Button asChild variant="secondary" size="sm" className="w-full sm:w-auto"><Link to="/equipment">Техника</Link></Button>}
                {canViewClients && <Button asChild variant="secondary" size="sm" className="w-full sm:w-auto"><Link to="/clients">Клиенты</Link></Button>}
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {activeDashboardTab === 'rentals' && isAdminRole && (
        <section className={dashboardSectionClass}>
          <div className={dashboardSectionHeaderClass}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              Коммерция
            </p>
            <h2 className="app-shell-title text-lg font-extrabold text-gray-900 dark:text-white">Результаты менеджеров аренды</h2>
          </div>

          <div className="grid gap-4">
            <Card className={dashboardCardClass}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5 text-[--color-primary]" />
                  Менеджеры аренды
                </CardTitle>
                <CardDescription>Активные сделки, выручка месяца, долг и документы по каждому менеджеру.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {adminManagerRows.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Данных по менеджерам пока нет.</p>
                ) : (
                  adminManagerRows.map(row => (
                    <div key={row.name} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-gray-900 dark:text-white">{row.name}</p>
                          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            Активных аренд: {row.activeRentals} · Новых за месяц: {row.monthRentals}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs uppercase tracking-wide text-gray-400">Выручка месяца</p>
                          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(row.monthRevenue)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-4">
                        <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/80">
                          <p className="text-[11px] uppercase tracking-wide text-gray-400">Долг</p>
                          <p className={`mt-1 text-sm font-semibold ${row.currentDebt > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'}`}>
                            {formatCurrency(row.currentDebt)}
                          </p>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/80">
                          <p className="text-[11px] uppercase tracking-wide text-gray-400">Просрочка</p>
                          <p className={`mt-1 text-sm font-semibold ${row.overdueDebt > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-300'}`}>
                            {formatCurrency(row.overdueDebt)}
                          </p>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/80">
                          <p className="text-[11px] uppercase tracking-wide text-gray-400">Возвраты 2 дня</p>
                          <p className={`mt-1 text-sm font-semibold ${row.returnsSoon > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-300'}`}>
                            {row.returnsSoon}
                          </p>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/80">
                          <p className="text-[11px] uppercase tracking-wide text-gray-400">Документы</p>
                          <p className={`mt-1 text-sm font-semibold ${row.unsignedDocs > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-300'}`}>
                            {row.unsignedDocs} без подписи
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {activeDashboardTab === 'service' && isAdminRole && (
        <section className={dashboardSectionClass}>
          <div className={dashboardSectionHeaderClass}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              Сервисная команда
            </p>
            <h2 className="app-shell-title text-lg font-extrabold text-gray-900 dark:text-white">Механики и сервисная нагрузка</h2>
          </div>

          <div className="grid gap-4">
            <Card className={dashboardCardClass}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <Wrench className="h-5 w-5 text-[--color-primary]" />
                  Механики
                </CardTitle>
                <CardDescription>Текущая нагрузка, готовые заявки, ожидание запчастей и сервисная выработка.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {adminMechanicRows.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Данных по механикам пока нет.</p>
                ) : (
                  adminMechanicRows.map(row => (
                    <div key={row.name} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-gray-900 dark:text-white">{row.name}</p>
                          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            Открытых заявок: {row.openTickets} · Готово: {row.readyTickets} · Ждут запчасти: {row.waitingPartsTickets}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs uppercase tracking-wide text-gray-400">Выработка</p>
                          <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                            {row.totalNormHours.toFixed(1)} н/ч
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-4">
                        <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/80">
                          <p className="text-[11px] uppercase tracking-wide text-gray-400">Ремонты</p>
                          <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{row.repairsCount}</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/80">
                          <p className="text-[11px] uppercase tracking-wide text-gray-400">Работы</p>
                          <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{row.worksCount}</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/80">
                          <p className="text-[11px] uppercase tracking-wide text-gray-400">Критичные</p>
                          <p className={`mt-1 text-sm font-semibold ${row.criticalTickets > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-300'}`}>
                            {row.criticalTickets}
                          </p>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/80">
                          <p className="text-[11px] uppercase tracking-wide text-gray-400">Запчасти</p>
                          <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{formatCurrency(row.partsCost)}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* ── Operational Layer ───────────────────────────────────────────────── */}
      {activeDashboardTab === 'rentals' && (
      <section className={dashboardSectionClass}>
        <div className={dashboardSectionHeaderClass}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
            Операционная работа
          </p>
          <h2 className="app-shell-title text-lg font-extrabold text-gray-900 dark:text-white">Что происходит в аренде</h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Card className={`cursor-pointer transition-all hover:shadow-lg ${dashboardCardClass}`} onClick={() => setSelectedKPI('utilization')}>
            <CardHeader className={dashboardCardHeaderClass}>
              <CardDescription className="flex items-center justify-between">
                <span>Загрузка парка</span>
                <TrendingUp className="h-3.5 w-3.5 text-gray-400" />
              </CardDescription>
              <CardTitle className={`text-3xl font-bold ${
                activeEquipment === 0 ? 'text-gray-400' :
                utilization >= UTILIZATION_TARGET ? 'text-green-600 dark:text-green-400' :
                utilization >= UTILIZATION_TARGET - 15 ? 'text-amber-600 dark:text-amber-400' :
                'text-orange-600 dark:text-orange-400'
              }`}>
                {activeEquipment === 0 ? '—' : `${utilization}%`}
              </CardTitle>
            </CardHeader>
            <CardContent className={dashboardCardContentClass}>
              {activeEquipment === 0 ? (
                <p className="text-sm text-gray-400">Активный арендный парк не сформирован</p>
              ) : (
                <>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{rentedEquipment} из {activeEquipment} ед. в работе</p>
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                    <div className="h-full rounded-full bg-[--color-primary] transition-all" style={{ width: `${utilization}%` }} />
                    <div className="absolute top-0 h-full w-0.5 bg-gray-400 dark:bg-gray-500" style={{ left: `${UTILIZATION_TARGET}%` }} />
                  </div>
                  <p className={`text-xs font-medium ${utilizationDeviation >= 0 ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}>
                    {utilizationDeviation >= 0 ? `+${utilizationDeviation}%` : `${utilizationDeviation}%`} к цели {UTILIZATION_TARGET}%
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className={`cursor-pointer transition-all hover:shadow-lg ${dashboardCardClass}`} onClick={() => setSelectedKPI('activeRentals')}>
            <CardHeader className={dashboardCardHeaderClass}>
              <CardDescription className="flex items-center justify-between">
                <span>Активные аренды</span>
                <Calendar className="h-3.5 w-3.5 text-gray-400" />
              </CardDescription>
              <CardTitle className="text-3xl font-bold text-gray-900 dark:text-white">{activeRentalsList.length}</CardTitle>
            </CardHeader>
            <CardContent className={dashboardCardContentClass}>
              <p className="text-sm text-gray-500 dark:text-gray-400">{rentedOrReservedEquipment} ед. техники задействовано</p>
              <p className="text-xs text-gray-400">{upcomingReturns.length > 0 ? `${upcomingReturns.length} завершений за 3 дня` : 'На ближайшие дни резких пиков нет'}</p>
            </CardContent>
          </Card>

          <Card className={`cursor-pointer transition-all hover:shadow-lg ${dashboardCardClass}`} onClick={() => setSelectedKPI('returnsTodayTomorrow')}>
            <CardHeader className={dashboardCardHeaderClass}>
              <CardDescription className="flex items-center justify-between">
                <span>Возвраты сегодня и завтра</span>
                <Clock className="h-3.5 w-3.5 text-gray-400" />
              </CardDescription>
              <CardTitle className={`text-3xl font-bold ${rentalsEndingToday.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white'}`}>
                {rentalsEndingToday.length + rentalsEndingTomorrow.length}
              </CardTitle>
            </CardHeader>
            <CardContent className={dashboardCardContentClass}>
              <p className="text-sm text-gray-500 dark:text-gray-400">Сегодня: {rentalsEndingToday.length} · Завтра: {rentalsEndingTomorrow.length}</p>
              <p className={`text-xs ${rentalsEndingToday.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}>
                {rentalsEndingToday.length > 0 ? 'Есть возвраты, которые лучше закрыть в первую очередь.' : 'Ближайшие возвраты идут без перегруза.'}
              </p>
            </CardContent>
          </Card>

        </div>
      </section>
      )}

      {/* ── Summary Layer ───────────────────────────────────────────────────── */}
      {activeDashboardTab === 'fleet' && (
      <section className={dashboardSectionClass}>
        <div className={dashboardSectionHeaderClass}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
            Сводка
          </p>
          <h2 className="app-shell-title text-lg font-extrabold text-gray-900 dark:text-white">Спокойные показатели для общей картины</h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card className={`cursor-pointer transition-all hover:shadow-lg ${dashboardCardClass}`} onClick={() => setSelectedKPI('idleEquipment')}>
            <CardHeader className={dashboardCardHeaderClass}>
              <CardDescription className="flex items-center justify-between">
                <span>Техника в простое</span>
                <Truck className="h-3.5 w-3.5 text-gray-400" />
              </CardDescription>
              <CardTitle className={`text-3xl font-bold ${idleEquipmentList.length > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>
                {idleEquipmentList.length}
              </CardTitle>
            </CardHeader>
            <CardContent className={dashboardCardContentClass}>
              {idleEquipmentList.length === 0 ? (
                <p className="text-sm text-green-600 dark:text-green-400">Простоя нет.</p>
              ) : (
                <>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Свободно: {availableEquipment} · Неактивно: {inactiveEquipment}</p>
                  <p className="text-xs text-gray-400">Резерв для выдачи и перераспределения.</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className={`cursor-pointer transition-all hover:shadow-lg ${dashboardCardClass}`} onClick={() => setSelectedKPI('repeatFailures')}>
            <CardHeader className={dashboardCardHeaderClass}>
              <CardDescription className="flex items-center justify-between">
                <span>Повторные поломки</span>
                <ShieldAlert className="h-3.5 w-3.5 text-gray-400" />
              </CardDescription>
              <CardTitle className={`text-3xl font-bold ${repeatFailureRows.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
                {repeatFailureRows.length}
              </CardTitle>
            </CardHeader>
            <CardContent className={dashboardCardContentClass}>
              <p className="text-sm text-gray-500 dark:text-gray-400">{repeatFailureRows.length > 0 ? 'Есть техника с повтором причины.' : 'Повторов не найдено.'}</p>
            </CardContent>
          </Card>

          <Card className={dashboardCardClass}>
            <CardHeader className={dashboardCardHeaderClass}>
              <CardDescription className="flex items-center justify-between">
                <span>Статус парка</span>
                <Truck className="h-3.5 w-3.5 text-gray-400" />
              </CardDescription>
              <CardTitle className="text-3xl font-bold text-gray-900 dark:text-white">{totalEquipment}</CardTitle>
            </CardHeader>
            <CardContent className={dashboardCardContentClass}>
              {totalEquipment === 0 ? (
                <p className="text-sm text-gray-400">Техника не добавлена</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">Свободно</span>
                    <span className="font-semibold text-green-600 dark:text-green-400">{availableEquipment}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">В аренде</span>
                    <span className="font-semibold text-blue-600 dark:text-blue-400">{rentedEquipment}</span>
                  </div>
                  {reservedEquipment > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Резерв</span>
                      <span className="font-semibold text-amber-600 dark:text-amber-400">{reservedEquipment}</span>
                    </div>
                  )}
                  {equipmentInServiceList.length > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">В сервисе</span>
                      <span className="font-semibold text-orange-600 dark:text-orange-400">{equipmentInServiceList.length}</span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
      )}

      {/* ── Manager Stats ─────────────────────────────────────────────────────── */}
      {activeDashboardTab === 'rentals' && !isAdminRole && isManagerRole && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-[--color-primary]" />
            Результаты менеджера за текущий месяц
          </CardTitle>
          <CardDescription>
            {currentUserName
              ? `${currentUserName} · ${new Date().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}`
              : 'Войдите в систему для просмотра персональной статистики'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!currentUserName ? (
            <p className="text-sm text-gray-400 italic">Нет данных пользователя</p>
          ) : !hasManagerData ? (
            <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-6 text-center">
              <FileText className="mx-auto h-8 w-8 text-gray-300 mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                У менеджера <strong>{currentUserName}</strong> пока нет аренд в системе.
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Аренды привязываются к менеджеру при создании.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
                <p className="text-xs text-gray-500 dark:text-gray-400">Активные аренды</p>
                <p className="mt-1 text-2xl text-blue-700 dark:text-blue-300">{myActiveRentals.length}</p>
              </div>
              <div className="rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
                <p className="text-xs text-gray-500 dark:text-gray-400">Новые за месяц</p>
                <p className="mt-1 text-2xl text-green-700 dark:text-green-300">{myMonthRentals.length}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-900/20">
                <p className="text-xs text-gray-500 dark:text-gray-400">Выручка за месяц</p>
                <p className="mt-1 text-xl text-emerald-700 dark:text-emerald-300">
                  {myMonthRevenue > 0 ? formatCurrency(myMonthRevenue) : '0 ₽'}
                </p>
              </div>
              <div className="rounded-lg bg-orange-50 p-3 dark:bg-orange-900/20">
                <p className="text-xs text-gray-500 dark:text-gray-400">Моя дебиторка</p>
                <p className="mt-1 text-xl text-orange-700 dark:text-orange-300">
                  {myClientDebt > 0 ? formatCurrency(myClientDebt) : '0 ₽'}
                </p>
              </div>
              <div className="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
                <p className="text-xs text-gray-500 dark:text-gray-400">Моя просрочка</p>
                <p className="mt-1 text-xl text-red-700 dark:text-red-300">
                  {myOverduePayments.length > 0
                    ? formatCurrency(myOverduePayments.reduce((sum, row) => sum + row.outstanding, 0))
                    : '0 ₽'}
                </p>
              </div>
              <div className="rounded-lg bg-purple-50 p-3 dark:bg-purple-900/20">
                <p className="text-xs text-gray-500 dark:text-gray-400">Общая дебиторка</p>
                <p className="mt-1 text-xl text-purple-700 dark:text-purple-300">
                  {totalDebt > 0 ? formatCurrency(totalDebt) : '0 ₽'}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {activeDashboardTab === 'fleet' && (dashboardEquipmentRisk.length > 0 || dashboardModelRisk.length > 0) && (
        <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
          <Card className="border-amber-200 dark:border-amber-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-amber-600" />
                Риск по технике
              </CardTitle>
              <CardDescription>Единицы техники, которые чаще других попадают в сервис</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {dashboardEquipmentRisk.map(item => (
                <div key={`${item.inventoryNumber}-${item.serialNumber}`} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">{item.equipmentLabel}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        INV {item.inventoryNumber} · SN {item.serialNumber}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.risk.badgeClass}`}>
                        {item.risk.label}
                      </span>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {item.repairsCount} ремонтов · {item.totalNormHours.toFixed(1)} н/ч
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-red-200 dark:border-red-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                Проблемные модели
              </CardTitle>
              <CardDescription>Модели с повышенной частотой ремонтов и трудозатратами</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {dashboardModelRisk.map(item => (
                <div key={item.label} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">{item.label}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {item.unitsCount} ед. · {item.repairsCount} ремонтов
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.risk.badgeClass}`}>
                        {item.risk.label}
                      </span>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {item.totalNormHours.toFixed(1)} н/ч · {formatCurrency(item.partsCost)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Alerts + Recent rentals ───────────────────────────────────────────── */}
      {activeDashboardTab === 'rentals' && (
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">

        {/* ── Alerts Panel (redesigned) ─────────────────────────────────── */}
        <Card className={`overflow-hidden border bg-card/95 ${
          alertItems.length > 0 && criticalCount > 0
            ? 'border-red-500/70 shadow-[0_0_0_1px_rgba(239,68,68,0.06)]'
            : alertItems.length > 0 && highCount > 0
            ? 'border-orange-500/40'
            : 'border-border/80'
        }`}>
          <CardHeader className="gap-4 border-b border-white/6 px-8 pt-8 pb-6">
            <div className="space-y-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Требует внимания
              </div>
              {alertItems.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {criticalCount > 0 && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-red-500/16 px-3 py-1 text-sm font-semibold text-red-300">
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      {criticalCount} крит.
                    </span>
                  )}
                  {highCount > 0 && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-orange-500/16 px-3 py-1 text-sm font-semibold text-orange-300">
                      <span className="h-2 w-2 rounded-full bg-orange-400" />
                      {highCount} важных
                    </span>
                  )}
                  {mediumCount > 0 && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-lime-400/14 px-3 py-1 text-sm font-semibold text-lime-300">
                      <span className="h-2 w-2 rounded-full bg-lime-400" />
                      {mediumCount} обычных
                    </span>
                  )}
                </div>
              ) : null}
              <CardDescription className="text-sm text-muted-foreground">
                {alertItems.length === 0
                  ? 'Все операции в штатном режиме'
                  : `${criticalCount} критичных · ${highCount} важных · ${mediumCount} обычных`}
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="space-y-0 px-0 pb-0">
            {alertItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-500/12">
                  <CheckCircle className="h-7 w-7 text-green-600" />
                </div>
                <p className="font-semibold text-foreground">Всё под контролем</p>
                <p className="mt-1 text-sm text-muted-foreground">Критических задач и рисков нет.</p>
              </div>
            ) : (
              <>
                <div className="divide-y divide-white/8">
                  {visibleAlerts.map(alert => {
                    const isCritical = alert.priority === 'critical';
                    const isHigh = alert.priority === 'high';
                    return (
                      <div
                        key={alert.id}
                        className="flex items-start justify-between gap-4 px-8 py-5"
                      >
                        <div className="min-w-0">
                          <p className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${
                            isCritical ? 'text-red-400' :
                            isHigh ? 'text-orange-300' :
                            'text-yellow-300'
                          }`}>
                            {alert.category}
                          </p>
                          <p className="mt-1 truncate text-[17px] font-semibold text-foreground sm:text-[18px]">
                            {alert.title}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            {alert.entity && <span>{alert.entity}</span>}
                            {alert.entity && alert.detail && <span className="text-white/20">·</span>}
                            {alert.detail && <span>{alert.detail}</span>}
                          </div>
                        </div>

                        <div className="hidden shrink-0 items-center gap-4 self-center sm:flex">
                          <span className={`text-[15px] font-semibold ${
                            isCritical ? 'text-orange-300' :
                            isHigh ? 'text-orange-300' :
                            'text-yellow-300'
                          }`}>
                            {(alert.detail ?? '').replace('Просрочка ', '').replace(' просрочки', '')}
                          </span>
                          <span className="inline-flex items-center rounded-xl border border-white/10 bg-white/6 px-4 py-2 text-sm font-medium text-muted-foreground">
                            Открыть
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {alertItems.length > ALERTS_PREVIEW && (
                  <div className="border-t border-white/8 px-8 py-5 text-center text-base font-semibold text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <ChevronDown className="h-4 w-4" />
                      Показать ещё {alertItems.length - ALERTS_PREVIEW}
                    </span>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Recent Rentals */}
        <Card className="overflow-hidden border-border/80 bg-card/95">
          <CardHeader className="gap-2 px-8 pt-8 pb-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Последние аренды
            </div>
            <CardDescription className="text-sm text-muted-foreground">
              Недавно созданные договоры
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {recentRentals.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
                  <FileText className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">Пока нет аренд</p>
                <p className="mt-0.5 text-xs text-muted-foreground/80">Недавние договоры появятся здесь</p>
              </div>
            ) : (
              <div className="divide-y divide-white/8">
                {recentRentals.slice(0, 5).map(rental => {
                  const rs = RENTAL_STATUS[rental.status] ?? { label: rental.status, color: 'bg-gray-100 text-gray-500' };
                  return (
                    <div
                      key={rental.id}
                      className="flex items-start justify-between gap-4 px-8 py-5"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-[17px] font-semibold text-foreground sm:text-[18px]">{rental.client}</p>
                        <p className="mt-1 truncate text-sm text-muted-foreground">
                          {rental.id} · {formatDate(rental.startDate)} — {formatDate(rental.endDate)}
                        </p>
                      </div>
                      <div className="ml-3 shrink-0 text-right">
                        <p className="text-[17px] font-semibold text-foreground sm:text-[18px]">
                          {canViewMoney && rental.amount > 0 ? formatCurrency(rental.amount) : '—'}
                        </p>
                        <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${
                          rental.status === 'active'
                            ? 'bg-emerald-400/16 text-emerald-200'
                            : rental.status === 'closed' || rental.status === 'completed' || rental.status === 'returned'
                            ? 'bg-lime-400/14 text-lime-300'
                            : 'bg-white/10 text-slate-300'
                        }`}>
                          {rs.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      )}

      {activeDashboardTab === 'service' && (
        <section className={dashboardSectionClass}>
          <div className={dashboardSectionHeaderClass}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              Сервис
            </p>
            <h2 className="app-shell-title text-lg font-extrabold text-gray-900 dark:text-white">Что тормозит парк</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className={dashboardCardClass}>
              <CardHeader className={dashboardCardHeaderClass}>
                <CardDescription>Заявки в работе</CardDescription>
                <CardTitle className="text-3xl font-bold">{openServiceTickets.length}</CardTitle>
              </CardHeader>
              <CardContent className={dashboardCardContentClass}>
                <p className="text-sm text-muted-foreground">{criticalTickets.length} крит./высоких · {readyServiceTickets.length} готово</p>
              </CardContent>
            </Card>
            <Card className={unassignedServiceTickets.length > 0 ? 'border-amber-400/40 bg-amber-400/10' : dashboardCardClass}>
              <CardHeader className={dashboardCardHeaderClass}>
                <CardDescription>Без механика</CardDescription>
                <CardTitle className="text-3xl font-bold">{unassignedServiceTickets.length}</CardTitle>
              </CardHeader>
              <CardContent className={dashboardCardContentClass}>
                <p className="text-sm text-muted-foreground">{unassignedServiceTickets.length > 0 ? 'Нужно распределить очередь.' : 'Очередь распределена.'}</p>
              </CardContent>
            </Card>
            <Card className={ticketsWaitingParts.length > 0 ? 'border-orange-400/40 bg-orange-400/10' : dashboardCardClass}>
              <CardHeader className={dashboardCardHeaderClass}>
                <CardDescription>Ожидание запчастей</CardDescription>
                <CardTitle className="text-3xl font-bold">{ticketsWaitingParts.length}</CardTitle>
              </CardHeader>
              <CardContent className={dashboardCardContentClass}>
                <p className="text-sm text-muted-foreground">{overdueServiceTickets.length} просроченных заявок</p>
              </CardContent>
            </Card>
            <Card className={dashboardCardClass}>
              <CardHeader className={dashboardCardHeaderClass}>
                <CardDescription>В сервисе по дням</CardDescription>
                <CardTitle className="text-3xl font-bold">{equipmentInServiceList.length}</CardTitle>
              </CardHeader>
              <CardContent className={dashboardCardContentClass}>
                <p className="text-sm text-muted-foreground">Ср. {averageServiceDays || 0} дн. · макс. {maxServiceDays || 0} дн.</p>
              </CardContent>
            </Card>
          </div>
          {serviceInDaysRows.length > 0 ? (
            <Card className={dashboardCardClass}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Дольше всего в сервисе</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {serviceInDaysRows.slice(0, 6).map(row => (
                  <Link key={row.id} to={`/service/${row.id}`} className="rounded-xl border border-border bg-secondary/50 p-4 transition hover:border-primary/40">
                    <p className="font-semibold text-foreground">{row.equipmentLabel || row.equipment || row.id}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{row.inventoryLabel || 'Без INV'} · {row.daysInService} дн.</p>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : (
            <Card className={dashboardCardClass}>
              <CardContent className="p-6 text-sm text-muted-foreground">Открытых сервисных заявок сейчас нет.</CardContent>
            </Card>
          )}
        </section>
      )}

      {activeDashboardTab === 'documents' && (
        <section className={dashboardSectionClass}>
          <div className={dashboardSectionHeaderClass}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              Документы
            </p>
            <h2 className="app-shell-title text-lg font-extrabold text-gray-900 dark:text-white">Что тормозит закрытие и оплату</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card className={dashboardCardClass}>
              <CardHeader className={dashboardCardHeaderClass}>
                <CardDescription>Без подписи</CardDescription>
                <CardTitle className="text-3xl font-bold">{documentControl.kpi.unsignedDocuments}</CardTitle>
              </CardHeader>
            </Card>
            <Card className={dashboardCardClass}>
              <CardHeader className={dashboardCardHeaderClass}>
                <CardDescription>Завершённые без УПД</CardDescription>
                <CardTitle className="text-3xl font-bold">{officePendingUpdRentals.length}</CardTitle>
              </CardHeader>
            </Card>
            <Card className={dashboardCardClass}>
              <CardHeader className={dashboardCardHeaderClass}>
                <CardDescription>Просрочено</CardDescription>
                <CardTitle className="text-3xl font-bold">{documentControl.kpi.overdueSignature}</CardTitle>
              </CardHeader>
            </Card>
            <Card className={dashboardCardClass}>
              <CardHeader className={dashboardCardHeaderClass}>
                <CardDescription>Без договора</CardDescription>
                <CardTitle className="text-3xl font-bold">{documentControl.kpi.rentalsWithoutContract}</CardTitle>
              </CardHeader>
            </Card>
          </div>
          <Card className={dashboardCardClass}>
            <CardContent className="space-y-2 p-5">
              {documentControl.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Критичных документных рисков нет.</p>
              ) : documentControl.rows.slice(0, 8).map(item => (
                <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-border bg-secondary/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-foreground">{item.statusLabel} · {item.client}</p>
                    <p className="text-sm text-muted-foreground">{item.rentalId || item.documentId || 'документ'} · {item.responsible}</p>
                  </div>
                  <Button asChild size="sm" variant="secondary">
                    <Link to="/documents">Открыть</Link>
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {activeDashboardTab === 'deliveries' && (
        <section className={dashboardSectionClass}>
          <div className={dashboardSectionHeaderClass}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              Доставка
            </p>
            <h2 className="app-shell-title text-lg font-extrabold text-gray-900 dark:text-white">Транспортные задачи и блокеры</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card className={dashboardCardClass}>
              <CardHeader className={dashboardCardHeaderClass}>
                <CardDescription>Сегодня</CardDescription>
                <CardTitle className="text-3xl font-bold">{todayDeliveries.length}</CardTitle>
              </CardHeader>
            </Card>
            <Card className={overdueDeliveries.length > 0 ? 'border-red-500/30 bg-red-500/10' : dashboardCardClass}>
              <CardHeader className={dashboardCardHeaderClass}>
                <CardDescription>Просрочено</CardDescription>
                <CardTitle className="text-3xl font-bold">{overdueDeliveries.length}</CardTitle>
              </CardHeader>
            </Card>
            <Card className={unassignedDeliveries.length > 0 ? 'border-amber-400/40 bg-amber-400/10' : dashboardCardClass}>
              <CardHeader className={dashboardCardHeaderClass}>
                <CardDescription>Без перевозчика</CardDescription>
                <CardTitle className="text-3xl font-bold">{unassignedDeliveries.length}</CardTitle>
              </CardHeader>
            </Card>
            <Card className={dashboardCardClass}>
              <CardHeader className={dashboardCardHeaderClass}>
                <CardDescription>Активные</CardDescription>
                <CardTitle className="text-3xl font-bold">{activeDeliveries.length}</CardTitle>
              </CardHeader>
            </Card>
          </div>
          <Card className={dashboardCardClass}>
            <CardContent className="space-y-2 p-5">
              {activeDeliveries.length === 0 ? (
                <p className="text-sm text-muted-foreground">Активных доставок нет.</p>
              ) : activeDeliveries.slice(0, 8).map(delivery => (
                <Link key={delivery.id} to="/deliveries" className="flex flex-col gap-2 rounded-xl border border-border bg-secondary/50 px-4 py-3 transition hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-foreground">{delivery.client || delivery.cargo || delivery.id}</p>
                    <p className="text-sm text-muted-foreground">{formatDate(delivery.transportDate)} · {delivery.carrierName || 'перевозчик не назначен'}</p>
                  </div>
                  <Badge variant={delivery.status === 'new' ? 'warning' : 'default'}>{delivery.status}</Badge>
                </Link>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      </>
      )}

      <Sheet open={!!managerBreakdownName} onOpenChange={(open) => !open && setManagerBreakdownName(null)}>
        <SheetContent side="right" className="flex w-full flex-col overflow-hidden border-gray-200 bg-white p-0 sm:max-w-2xl dark:border-gray-700 dark:bg-gray-950">
          <SheetHeader className="shrink-0 border-b border-gray-200 pb-4 pr-12 dark:border-gray-700">
            <SheetTitle className="flex items-center gap-2 text-left">
              <User className="h-5 w-5 text-[--color-primary]" />
              Расшифровка карточки менеджера
            </SheetTitle>
            <SheetDescription className="text-left">
              {managerBreakdownName
                ? `Показываем, из каких аренд, платежей и документов сложились показатели менеджера ${managerBreakdownName}.`
                : 'Выберите менеджера на дашборде.'}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {managerBreakdownLoading ? (
              <div className="flex items-center gap-2 rounded-xl border border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Загружаем расшифровку...
              </div>
            ) : managerBreakdownError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                Не удалось загрузить расшифровку. Попробуй обновить страницу или открыть карточку ещё раз.
              </div>
            ) : managerBreakdown ? (
              <>
                <div className="grid gap-2 sm:grid-cols-4">
                  <div className="rounded-xl bg-gray-50 px-3 py-3 dark:bg-gray-800/80">
                    <p className="text-[11px] uppercase tracking-wide text-gray-400">Выручка месяца</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(managerBreakdown.summary.monthRevenue)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-3 dark:bg-gray-800/80">
                    <p className="text-[11px] uppercase tracking-wide text-gray-400">Долг</p>
                    <p className="mt-1 text-sm font-semibold text-orange-600 dark:text-orange-400">
                      {formatCurrency(managerBreakdown.summary.currentDebt)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-3 dark:bg-gray-800/80">
                    <p className="text-[11px] uppercase tracking-wide text-gray-400">Просрочка</p>
                    <p className="mt-1 text-sm font-semibold text-red-600 dark:text-red-400">
                      {formatCurrency(managerBreakdown.summary.overdueDebt)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-3 dark:bg-gray-800/80">
                    <p className="text-[11px] uppercase tracking-wide text-gray-400">Возвраты / документы</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                      {managerBreakdown.summary.returnsSoon} / {managerBreakdown.summary.unsignedDocs}
                    </p>
                  </div>
                </div>

                <section className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-gray-900 dark:text-white">Выручка месяца</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {managerBreakdown.summary.monthRentals} аренд вошло в расчёт.
                      </p>
                    </div>
                    <Badge>{formatCurrency(managerBreakdown.summary.monthRevenue)}</Badge>
                  </div>
                  {managerBreakdown.monthRevenueRentals.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">Нет аренд за текущий месяц.</p>
                  ) : (
                    <div className="space-y-2">
                      {managerBreakdown.monthRevenueRentals.map(item => (
                        <div key={item.rentalId} className="rounded-lg bg-gray-50 px-3 py-3 dark:bg-gray-800/80">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 dark:text-white">{item.client}</p>
                              <p className="text-sm text-gray-500 dark:text-gray-400">
                                {item.equipmentInv} · {formatDate(item.startDate)} - {formatDate(item.endDate)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(item.amount)}</p>
                              <p className="text-xs text-gray-400">{item.rentalId}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-gray-900 dark:text-white">Долг и платежи</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        По каждой аренде видно остаток и связанные платежи.
                      </p>
                    </div>
                    <Badge>{managerBreakdown.currentDebtRows.length}</Badge>
                  </div>
                  {managerBreakdown.currentDebtRows.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">Открытого долга по арендам нет.</p>
                  ) : (
                    <div className="space-y-3">
                      {managerBreakdown.currentDebtRows.map(row => (
                        <div key={row.rentalId} className="rounded-lg bg-gray-50 px-3 py-3 dark:bg-gray-800/80">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 dark:text-white">{row.client}</p>
                              <p className="text-sm text-gray-500 dark:text-gray-400">
                                {row.equipmentInv} · {formatDate(row.startDate)} - {formatDate(row.endDate)}
                              </p>
                              <p className="mt-1 text-xs text-gray-400">
                                К оплате {formatCurrency(row.amount)} · оплачено {formatCurrency(row.paidAmount)} · статус {row.paymentStatus}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold text-orange-600 dark:text-orange-400">{formatCurrency(row.outstanding)}</p>
                              <p className="text-xs text-gray-400">
                                {row.overdueDays > 0 ? `Просрочка ${row.overdueDays} дн.` : 'Не просрочено'}
                              </p>
                            </div>
                          </div>
                          {row.payments.length > 0 ? (
                            <div className="mt-3 space-y-2 border-t border-gray-200 pt-3 dark:border-gray-700">
                              {row.payments.map(payment => (
                                <div key={payment.id} className="flex items-start justify-between gap-3 text-sm">
                                  <div className="min-w-0">
                                    <p className="font-medium text-gray-700 dark:text-gray-200">{payment.invoiceNumber}</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                      Срок {formatDate(payment.dueDate)}{payment.paidDate ? ` · оплачено ${formatDate(payment.paidDate)}` : ''}
                                    </p>
                                    {payment.comment ? (
                                      <p className="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">{payment.comment}</p>
                                    ) : null}
                                  </div>
                                  <div className="text-right">
                                    <p className="font-medium text-gray-900 dark:text-white">{formatCurrency(payment.amount)}</p>
                                    <p className="text-xs text-gray-400">
                                      {payment.paidAmount > 0 ? `Оплачено ${formatCurrency(payment.paidAmount)}` : payment.status}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-3 text-xs text-gray-400">Платежей по этой аренде пока не создано.</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-gray-900 dark:text-white">Просрочка</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Только те аренды, где срок оплаты уже прошёл.
                      </p>
                    </div>
                    <Badge variant="danger">{managerBreakdown.overdueDebtRows.length}</Badge>
                  </div>
                  {managerBreakdown.overdueDebtRows.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">Просроченных аренд нет.</p>
                  ) : (
                    <div className="space-y-2">
                      {managerBreakdown.overdueDebtRows.map(row => (
                        <div key={row.rentalId} className="flex items-start justify-between gap-3 rounded-lg bg-red-50 px-3 py-3 dark:bg-red-950/30">
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 dark:text-white">{row.client}</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              {row.equipmentInv} · срок {formatDate(row.expectedPaymentDate || row.endDate)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-red-600 dark:text-red-400">{formatCurrency(row.outstanding)}</p>
                            <p className="text-xs text-red-500 dark:text-red-300">{row.overdueDays} дн.</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-gray-900 dark:text-white">Возвраты в ближайшие 2 дня</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Активные аренды, которые скоро вернутся.
                      </p>
                    </div>
                    <Badge>{managerBreakdown.returnsSoonRentals.length}</Badge>
                  </div>
                  {managerBreakdown.returnsSoonRentals.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">Ближайших возвратов нет.</p>
                  ) : (
                    <div className="space-y-2">
                      {managerBreakdown.returnsSoonRentals.map(item => (
                        <div key={item.rentalId} className="flex items-start justify-between gap-3 rounded-lg bg-amber-50 px-3 py-3 dark:bg-amber-950/30">
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 dark:text-white">{item.client}</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{item.equipmentInv}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-medium text-amber-700 dark:text-amber-300">{formatDate(item.endDate)}</p>
                            <p className="text-xs text-gray-400">{item.rentalId}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-gray-900 dark:text-white">Документы без подписи</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Договоры и акты, которые ещё не подписаны.
                      </p>
                    </div>
                    <Badge>{managerBreakdown.unsignedDocuments.length}</Badge>
                  </div>
                  {managerBreakdown.unsignedDocuments.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">Неподписанных документов нет.</p>
                  ) : (
                    <div className="space-y-2">
                      {managerBreakdown.unsignedDocuments.map(item => (
                        <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg bg-gray-50 px-3 py-3 dark:bg-gray-800/80">
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 dark:text-white">{item.number}</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              {item.client} · {item.type === 'contract' ? 'Договор' : 'Акт'}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium text-gray-900 dark:text-white">{formatDate(item.date)}</p>
                            <p className="text-xs text-gray-400">
                              {item.amount ? formatCurrency(item.amount) : item.status}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {managerBreakdownFetching ? (
                  <p className="text-xs text-gray-400">Обновляем данные...</p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">Нет данных для расшифровки.</p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Modals ───────────────────────────────────────────────────────────── */}
      <KPIDetailModal
        open={selectedKPI !== null}
        onOpenChange={(open) => !open && setSelectedKPI(null)}
        kpiType={selectedKPI}
        data={selectedKPI ? kpiData[selectedKPI] : {}}
      />
      <ServiceRequestModal open={showServiceModal} onOpenChange={setShowServiceModal} />
      <NewClientModal open={showClientModal} onOpenChange={setShowClientModal} />
      <Dialog
        open={showOfficeUpdModal}
        onOpenChange={(open) => {
          setShowOfficeUpdModal(open);
          if (!open) setOfficeUpdManagerFilter('');
        }}
      >
        <DialogContent className="!max-h-[85vh] !w-[calc(100vw-2rem)] !max-w-5xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0">
          <DialogHeader className="border-b border-gray-200 px-6 pb-4 pt-6 pr-12 dark:border-gray-700">
            <DialogTitle>Контроль УПД по завершённым арендам</DialogTitle>
            <DialogDescription>
              Здесь офис видит, у каких клиентов аренда уже завершилась, по каким сделкам УПД ещё не отмечен, и может сразу поставить отметку.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/20">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Нужно оформить УПД</p>
                <p className="mt-1 text-2xl font-bold text-amber-700 dark:text-amber-300">{officeFilteredPendingUpdRentals.length}</p>
                <p className="mt-1 text-sm text-amber-700/80 dark:text-amber-400/80">
                  {officeUpdManagerFilter
                    ? officeUpdManagerFilter
                    : `${officePendingUpdClientCount} ${formatCountLabel(officePendingUpdClientCount, 'клиент', 'клиента', 'клиентов')}`}
                </p>
              </div>
              <div className="rounded-xl border border-green-200 bg-green-50/70 px-4 py-3 dark:border-green-900 dark:bg-green-950/20">
                <p className="text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400">УПД уже отмечен</p>
                <p className="mt-1 text-2xl font-bold text-green-700 dark:text-green-300">{officeFilteredSignedUpdRentals.length}</p>
                <p className="mt-1 text-sm text-green-700/80 dark:text-green-400/80">
                  {officeUpdManagerFilter ? 'По выбранному менеджеру' : 'Контроль по завершённым арендам'}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/70">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Завершено всего</p>
                <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{officeFilteredCompletedRentals.length}</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {officeFilteredClientCount} {formatCountLabel(officeFilteredClientCount, 'клиент', 'клиента', 'клиентов')}
                </p>
              </div>
            </div>

            {officeUpdManagerRows.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Быстрый фильтр по менеджеру</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Помогает сразу увидеть, у кого зависли УПД чаще всего.</p>
                  </div>
                  {officeUpdManagerFilter && (
                    <Button size="sm" variant="ghost" onClick={() => setOfficeUpdManagerFilter('')}>
                      Сбросить
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setOfficeUpdManagerFilter('')}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      officeUpdManagerFilter === ''
                        ? 'border-[--color-primary] bg-[--color-primary]/10 text-[--color-primary]'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
                    }`}
                  >
                    <span>Все менеджеры</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {officePendingUpdRentals.length}
                    </span>
                  </button>
                  {officeUpdManagerRows.map(row => (
                    <button
                      key={row.name}
                      type="button"
                      onClick={() => setOfficeUpdManagerFilter(row.name)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                        officeUpdManagerFilter === row.name
                          ? 'border-[--color-primary] bg-[--color-primary]/10 text-[--color-primary]'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
                      }`}
                    >
                      <span>{row.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        row.pendingCount > 0
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                          : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                      }`}>
                        {row.pendingCount}/{row.completedCount}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-6">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Нужно сделать УПД</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Это завершённые аренды, по которым офису пора подготовить и отметить УПД.</p>
                </div>
                <Badge variant={officeFilteredPendingUpdRentals.length > 0 ? 'warning' : 'success'}>
                  {officeFilteredPendingUpdRentals.length}
                </Badge>
              </div>

              {officePendingUpdGroups.length === 0 ? (
                <div className="rounded-xl border border-dashed border-green-200 bg-green-50/60 px-4 py-5 text-sm text-green-700 dark:border-green-900 dark:bg-green-950/20 dark:text-green-300">
                  {officeUpdManagerFilter
                    ? `У менеджера ${officeUpdManagerFilter} сейчас нет хвоста по УПД.`
                    : 'По завершённым арендам сейчас нет хвоста по УПД.'}
                </div>
              ) : (
                officePendingUpdGroups.map(group => (
                  <div key={`pending-${group.clientName}`} className="rounded-xl border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">{group.clientName}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {group.items.length} {formatCountLabel(group.items.length, 'завершённая аренда', 'завершённые аренды', 'завершённых аренд')}
                        </p>
                      </div>
                      <Badge variant="warning">УПД не отмечен</Badge>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                      {group.items.map(rental => (
                        <div key={rental.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-gray-900 dark:text-white">{rental.id}</p>
                              <Badge variant="outline">{rental.equipmentInv || 'Без INV'}</Badge>
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {formatDate(rental.startDate)} — {formatDate(rental.endDate)}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                              Менеджер: {rental.manager || 'Не указан'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              onClick={() => void handleOfficeUpdToggle(rental, true)}
                              disabled={officeUpdUpdatingId === rental.id}
                            >
                              <CheckCircle className="h-4 w-4" />
                              {officeUpdUpdatingId === rental.id ? 'Сохраняю…' : 'УПД сделан'}
                            </Button>
                            <Button asChild size="sm" variant="secondary">
                              <Link to="/rentals">Открыть аренду</Link>
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Уже отмечено</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Чтобы офис видел, что закрывающие уже выпущены и отмечены в системе.</p>
                </div>
                <Badge variant="success">{officeFilteredSignedUpdRentals.length}</Badge>
              </div>

              {officeSignedUpdGroups.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-5 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  {officeUpdManagerFilter
                    ? `У менеджера ${officeUpdManagerFilter} пока нет завершённых аренд с отмеченным УПД.`
                    : 'Пока нет завершённых аренд с отмеченным УПД.'}
                </div>
              ) : (
                officeSignedUpdGroups.map(group => (
                  <div key={`signed-${group.clientName}`} className="rounded-xl border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">{group.clientName}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {group.items.length} {formatCountLabel(group.items.length, 'аренда с УПД', 'аренды с УПД', 'аренд с УПД')}
                        </p>
                      </div>
                      <Badge variant="success">УПД отмечен</Badge>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                      {group.items.map(rental => (
                        <div key={rental.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-gray-900 dark:text-white">{rental.id}</p>
                              <Badge variant="outline">{rental.equipmentInv || 'Без INV'}</Badge>
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {formatDate(rental.startDate)} — {formatDate(rental.endDate)}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                              УПД отмечен: {rental.updDate ? formatDate(rental.updDate) : 'дата не указана'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void handleOfficeUpdToggle(rental, false)}
                              disabled={officeUpdUpdatingId === rental.id}
                            >
                              {officeUpdUpdatingId === rental.id ? 'Сохраняю…' : 'Снять отметку'}
                            </Button>
                            <Button asChild size="sm" variant="ghost">
                              <Link to="/rentals">Открыть аренду</Link>
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </section>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <NewRentalModal
        open={showRentalModal}
        ganttRentals={ganttRentals}
        equipmentList={equipmentList}
        onClose={() => setShowRentalModal(false)}
        onConfirm={(formData) => {
          const todayStr = new Date().toISOString().split('T')[0];
          const initialStatus: GanttRentalData['status'] =
            (formData.startDate || '') <= todayStr ? 'active' : 'created';

          const newRental: Omit<GanttRentalData, 'id'> = {
            clientId: formData.clientId,
            client: formData.client || '',
            clientShort: (formData.client || '').substring(0, 20),
            equipmentId: formData.equipmentId || '',
            equipmentInv: formData.equipmentInv || '',
            startDate: formData.startDate || '',
            endDate: formData.endDate || '',
            manager: formData.manager || '',
            managerInitials: (formData.manager || '')
              .split(' ')
              .map((w: string) => w[0] ?? '')
              .join('')
              .toUpperCase(),
            status: initialStatus,
            paymentStatus: 'unpaid',
            updSigned: false,
            amount: Number(formData.amount) || 0,
            comments: [
              buildRentalCreationHistory(
                {
                  client: formData.client || '',
                  startDate: formData.startDate || '',
                  endDate: formData.endDate || '',
                  status: initialStatus,
                },
                user?.name || 'Система',
              ),
            ],
          };

          // Persist via API then invalidate queries to refresh all panels
          rentalsService.create({
            clientId: formData.clientId,
            client: formData.client || '',
            contact: '',
            startDate: formData.startDate || '',
            plannedReturnDate: formData.endDate || '',
            equipment: [formData.equipmentInv || ''],
            rate: formData.amount && formData.startDate && formData.endDate
              ? `${Math.round(Number(formData.amount) / Math.max(1, getRentalDays(formData.startDate, formData.endDate)))} ₽/день`
              : '0 ₽/день',
            price: Number(formData.amount) || 0,
            discount: 0,
            deliveryAddress: '',
            manager: formData.manager || '',
            status: 'new',
            comments: '',
          }).then((savedClassicRental) => rentalsService.createGanttEntry({
            ...newRental,
            rentalId: savedClassicRental.id,
          })).then(() => {
            if (formData.equipmentId) {
              const eqStatus: EquipmentStatus = initialStatus === 'active' ? 'rented' : 'reserved';
              const eq = equipmentList.find(e => e.id === formData.equipmentId);
              if (eq) {
                const equipmentWithHistory = appendAuditHistory(
                  {
                    ...eq,
                    status: eqStatus,
                    currentClient: initialStatus === 'active' ? newRental.client : eq.currentClient,
                    returnDate: initialStatus === 'active' ? newRental.endDate : eq.returnDate,
                  },
                  createAuditEntry(
                    user?.name || 'Система',
                    initialStatus === 'active'
                      ? `Создана аренда и техника выдана клиенту ${newRental.client}`
                      : `Создана бронь под клиента ${newRental.client}`,
                  ),
                );
                const { id: _equipmentId, ...equipmentUpdateData } = equipmentWithHistory;
                equipmentService.update(eq.id, {
                  ...equipmentUpdateData,
                });
              }
            }
            qc.invalidateQueries();
          }).catch(console.error);

          setShowRentalModal(false);
        }}
      />
    </div>
  );
}
