import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
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
  PackageX, ClipboardX, Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatCurrency, formatDate } from '../lib/utils';
import { assessServiceRisk } from '../lib/serviceRisk';
import { useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { useEquipmentList } from '../hooks/useEquipment';
import { useRentalsList, useGanttData } from '../hooks/useRentals';
import { rentalsService } from '../services/rentals.service';
import { equipmentService } from '../services/equipment.service';
import { reportsService, type MechanicsWorkloadReport } from '../services/reports.service';
import { useServiceTicketsList } from '../hooks/useServiceTickets';
import { useClientsList } from '../hooks/useClients';
import { usePaymentsList } from '../hooks/usePayments';
import { useDocumentsList } from '../hooks/useDocuments';
import { KPIDetailModal } from '../components/modals/KPIDetailModal';
import { ServiceRequestModal } from '../components/modals/ServiceRequestModal';
import { NewClientModal } from '../components/modals/NewClientModal';
import { NewRentalModal } from '../components/gantt/GanttModals';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../lib/permissions';
import { appendRentalHistory, buildRentalCreationHistory, createRentalHistoryEntry } from '../lib/rental-history';
import { appendAuditHistory, createAuditEntry } from '../lib/entity-history';
import type { Equipment, Rental, ServiceTicket, Client, Payment, Document, EquipmentStatus } from '../types';
import type { GanttRentalData } from '../mock-data';
import { buildClientFinancialSnapshots, buildRentalDebtRows } from '../lib/finance';

// ─── helpers ───────────────────────────────────────────────────────────────────

function safeDiv(a: number, b: number, fallback = 0): number {
  return b > 0 ? a / b : fallback;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isOverdue(plannedReturnDate: string): boolean {
  return new Date(plannedReturnDate) < startOfDay(new Date());
}

function isOpenRentalStatus(status: GanttRentalData['status']): boolean {
  return status === 'active' || status === 'returned';
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

// ─── main component ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const qc = useQueryClient();

  // All data via react-query (auto-refetches on window focus by default)
  const { data: equipment = [] }  = useEquipmentList();
  const { data: rentals = [] }    = useRentalsList();
  const { data: tickets = [] }    = useServiceTicketsList();
  const { data: clients = [] }    = useClientsList();
  const { data: payments = [] }   = usePaymentsList();
  const { data: documents = [] }  = useDocumentsList();
  const { data: ganttRentals = [] } = useGanttData();
  const { data: mechanicWorkload } = useQuery<MechanicsWorkloadReport>({
    queryKey: ['reports', 'mechanicsWorkload'],
    queryFn: reportsService.getMechanicsWorkload,
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
  const [officeUpdUpdatingId, setOfficeUpdUpdatingId] = useState<string | null>(null);
  const [officeUpdManagerFilter, setOfficeUpdManagerFilter] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const dashboardCardClass = 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/60';
  const dashboardCardHeaderClass = 'space-y-2 px-5 pt-5 pb-3';
  const dashboardCardContentClass = 'space-y-2 px-5 pb-5';
  const dashboardSectionClass = 'space-y-4';
  const dashboardSectionHeaderClass = 'flex flex-col gap-1.5';

  const refresh = useCallback(() => {
    setRefreshing(true);
    qc.invalidateQueries();
    setTimeout(() => setRefreshing(false), 600);
  }, [qc]);

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
  const computedClients = useMemo(
    () => clients.map(client => {
      const financial = clientFinancials.find(item => item.client === client.company);
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
  const shouldShowRentalAttention = user?.role !== 'Механик';
  const viewRentals = isManagerRole && currentUserName
    ? rentals.filter(r => r.manager === currentUserName)
    : rentals;
  const viewPlannerRentals = isManagerRole && currentUserName
    ? ganttRentals.filter(r => r.manager === currentUserName)
    : ganttRentals;

  // Utilization
  const totalEquipment = equipment.length;
  const activeEquipment = equipment.filter(e => e.status !== 'inactive').length;
  const rentedEquipment = equipment.filter(e => e.status === 'rented').length;
  const availableEquipment = equipment.filter(e => e.status === 'available').length;
  const utilization = totalEquipment === 0
    ? 0
    : Math.round(safeDiv(rentedEquipment, activeEquipment > 0 ? activeEquipment : totalEquipment) * 100);

  // Dashboard operational KPIs should use planner rentals as the source of truth.
  const activeRentalsList = viewPlannerRentals.filter(r => r.status === 'active');

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
  const totalDebt = rentalDebtRows.reduce((sum, row) => sum + row.outstanding, 0);

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
  const myClientDebt = currentUserName
    ? rentalDebtRows
      .filter(row => row.manager === currentUserName)
      .reduce((sum, row) => sum + row.outstanding, 0)
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
        && (doc.type === 'contract' || doc.type === 'act')
        && doc.status !== 'signed',
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
  const officeUnsignedDocuments = documents.filter(doc =>
    (doc.type === 'contract' || doc.type === 'act') && doc.status !== 'signed',
  );
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

    if (user?.role === 'Механик') {
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
    if (user?.role === 'Менеджер по аренде') {
      return {
        badge: 'Роль: аренда',
        title: 'Мой дашборд менеджера аренды',
        description: 'Здесь закреплены ваши сделки, возвраты, оплаты и документы. Это стартовая точка для ежедневной работы.',
      };
    }
    if (user?.role === 'Механик') {
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
  }, [officePendingUpdManagerFilter, officePendingUpdRentals]);

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
    [officePendingUpdManagerFilter, officePendingUpdRentals],
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
    ])).sort((a, b) => a.localeCompare(b, 'ru'));

    return names.map(name => {
      const managerRentals = ganttRentals.filter(item => item.manager === name);
      const managerActiveRentals = managerRentals.filter(item => item.status === 'active');
      const managerMonthRentals = managerRentals.filter(item => new Date(item.startDate) >= monthStart);
      const managerDebtRows = rentalDebtRows.filter(item => item.manager === name);
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
        currentDebt: managerDebtRows.reduce((sum, item) => sum + item.outstanding, 0),
        overdueDebt: managerOverdueRows.reduce((sum, item) => sum + item.outstanding, 0),
        returnsSoon: managerReturnsSoon,
        unsignedDocs: managerUnsignedDocs.length,
      };
    }).sort((a, b) =>
      b.activeRentals - a.activeRentals
      || b.monthRevenue - a.monthRevenue
      || b.currentDebt - a.currentDebt
      || a.name.localeCompare(b.name, 'ru')
    );
  }, [dayAfterTomorrowStart, documents, ganttRentals, monthStart, overduePayments, rentalDebtRows, today, tomorrowStart]);

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
  const rentedOrReservedEquipment = equipment.filter(e => e.status === 'rented' || e.status === 'reserved').length;
  const reservedEquipment = equipment.filter(e => e.status === 'reserved').length;
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
  const idleEquipmentList = equipment.filter(e => e.status === 'available' || e.status === 'inactive');
  const serviceInDaysRows = openServiceTickets
    .map(ticket => {
      const createdAt = new Date(ticket.createdAt);
      const daysInService = Math.max(1, Math.ceil((today.getTime() - createdAt.getTime()) / 86400000));
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

  // Month revenue (role-aware)
  const monthRentals = viewRentals.filter(r => {
    const start = new Date(r.startDate);
    return start >= monthStart && (r.status === 'active' || r.status === 'closed' || r.status === 'confirmed');
  });
  const dashMonthRevenue = monthRentals.reduce((sum, r) => sum + (r.price || 0), 0);

  // Monthly plan (0 = not configured, shows no target bar)
  const MONTHLY_PLAN = 0;

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
  const unsignedDocs = documents.filter(d =>
    (d.type === 'contract' || d.type === 'act') && d.status !== 'signed'
  );
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
    const hasActive = activeRentalsList.some(r => r.client === c.company);
    if (hasActive) {
      alertItems.push({
        id: `blocked-client-${c.id}`,
        priority: 'critical',
        icon: Ban,
        category: 'Заблокированный клиент',
        title: c.company,
        entity: 'Есть активные аренды',
        detail: c.debt > 0 ? `Долг: ${formatCurrency(c.debt)}` : 'Риск срыва выдачи',
        link: `/clients/${c.id}`,
        linkLabel: 'Карточка клиента',
      });
    }
  });

  // 8. Долг превышает кредитный лимит
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
    utilization: { totalEquipment, rentedEquipment, availableEquipment, utilization },
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
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Дашборд</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Обновлено: {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Обновить</span>
          </Button>
          {can('create', 'rentals') && (
            <Button size="sm" onClick={() => setShowRentalModal(true)}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Новая аренда</span>
              <span className="sm:hidden">Аренда</span>
            </Button>
          )}
          {can('create', 'service') && (
            <Button size="sm" variant="secondary" onClick={() => setShowServiceModal(true)}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Заявка в сервис</span>
              <span className="sm:hidden">Сервис</span>
            </Button>
          )}
          {can('create', 'clients') && (
            <Button size="sm" variant="secondary" onClick={() => setShowClientModal(true)}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Новый клиент</span>
              <span className="sm:hidden">Клиент</span>
            </Button>
          )}
        </div>
      </div>

      {roleDashboardMeta && roleDashboardCards.length > 0 && (
        <Card className="border-gray-200 bg-white/90 dark:border-gray-700 dark:bg-gray-900/70">
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <Badge variant="secondary">{roleDashboardMeta.badge}</Badge>
                <CardTitle className="text-xl">{roleDashboardMeta.title}</CardTitle>
                <CardDescription className="max-w-3xl text-sm">
                  {roleDashboardMeta.description}
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="self-start lg:self-center">
                <Link to={user?.role === 'Механик' ? '/service' : user?.role === 'Офис-менеджер' ? '/documents' : '/rentals'}>
                  Открыть основной раздел
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 lg:grid-cols-4">
              {roleDashboardCards.map(item => {
                const Icon = item.icon;
                const toneClass =
                  item.tone === 'danger'
                    ? 'border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/20'
                    : item.tone === 'warning'
                    ? 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20'
                    : item.tone === 'success'
                    ? 'border-green-200 bg-green-50/70 dark:border-green-900 dark:bg-green-950/20'
                    : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/80';

                const iconClass =
                  item.tone === 'danger'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                    : item.tone === 'warning'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    : item.tone === 'success'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';

                return (
                  <div key={item.id} className={`rounded-xl border p-4 ${toneClass}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-full ${iconClass}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      {item.onClick ? (
                        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={item.onClick}>
                          {item.cta}
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button asChild size="sm" variant="ghost" className="h-8 px-2">
                          <Link to={item.href}>
                            {item.cta}
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      )}
                    </div>
                    <div className="mt-4">
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{item.title}</p>
                      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{item.value}</p>
                      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{item.hint}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {isAdminRole && (
        <section className={dashboardSectionClass}>
          <div className={dashboardSectionHeaderClass}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              Команда
            </p>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Результаты по каждому менеджеру и механику</h2>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
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

      {/* ── Priority Actions ─────────────────────────────────────────────────── */}
      <section className={dashboardSectionClass}>
        <div className={dashboardSectionHeaderClass}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
            Критично сейчас
          </p>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Срочные зоны внимания</h2>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          {shouldShowRentalAttention && (
            <Card
              className={`cursor-pointer border transition-all hover:shadow-lg ${
                overdueRentalsList.length > 0
                  ? 'border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20'
                  : dashboardCardClass
              }`}
              onClick={() => setSelectedKPI('overdueReturns')}
            >
              <CardHeader className={dashboardCardHeaderClass}>
                <CardDescription className="flex items-center justify-between">
                  <span className={overdueRentalsList.length > 0 ? 'text-red-600 dark:text-red-400' : ''}>Просроченные возвраты</span>
                  <AlertTriangle className={`h-4 w-4 ${overdueRentalsList.length > 0 ? 'text-red-500' : 'text-gray-400'}`} />
                </CardDescription>
                <CardTitle className={`text-4xl font-bold ${overdueRentalsList.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                  {overdueRentalsList.length}
                </CardTitle>
              </CardHeader>
              <CardContent className={dashboardCardContentClass}>
                {overdueRentalsList.length > 0 ? (
                  <>
                    <p className="text-sm font-medium text-red-700 dark:text-red-300">
                      Макс. просрочка: {maxOverdueDays} {maxOverdueDays === 1 ? 'день' : maxOverdueDays < 5 ? 'дня' : 'дней'}
                    </p>
                    <p className="text-sm text-red-500 dark:text-red-400">Приоритет на сегодня для менеджеров, офиса и руководителя.</p>
                  </>
                ) : (
                  <p className="text-sm text-green-600 dark:text-green-400">Возвраты идут по плану, просрочек нет.</p>
                )}
              </CardContent>
            </Card>
          )}

          <Card
            className={`cursor-pointer border transition-all hover:shadow-lg ${
              unassignedServiceTickets.length > 0
                ? 'border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20'
                : dashboardCardClass
            }`}
            onClick={() => setSelectedKPI('unassignedService')}
          >
            <CardHeader className={dashboardCardHeaderClass}>
              <CardDescription className="flex items-center justify-between">
                <span className={unassignedServiceTickets.length > 0 ? 'text-amber-700 dark:text-amber-400' : ''}>Заявки без механика</span>
                <User className={`h-4 w-4 ${unassignedServiceTickets.length > 0 ? 'text-amber-500' : 'text-gray-400'}`} />
              </CardDescription>
              <CardTitle className={`text-4xl font-bold ${unassignedServiceTickets.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white'}`}>
                {unassignedServiceTickets.length}
              </CardTitle>
            </CardHeader>
            <CardContent className={dashboardCardContentClass}>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {openServiceTickets.length} открытых заявок · {criticalTickets.length} крит./высоких
              </p>
              <p className={`text-sm ${unassignedServiceTickets.length > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-green-600 dark:text-green-400'}`}>
                {unassignedServiceTickets.length > 0 ? 'Нужно назначить исполнителей и снять узкое место.' : 'Все заявки уже распределены.'}
              </p>
            </CardContent>
          </Card>

          <Card
            className={`cursor-pointer border transition-all hover:shadow-lg ${
              totalDebt > 0
                ? 'border-orange-300 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/20'
                : dashboardCardClass
            }`}
            onClick={() => setSelectedKPI('totalDebt')}
          >
            <CardHeader className={dashboardCardHeaderClass}>
              <CardDescription className="flex items-center justify-between">
                <span className={totalDebt > 0 ? 'text-orange-700 dark:text-orange-400' : ''}>Просроченная дебиторка</span>
                <CreditCard className={`h-4 w-4 ${totalDebt > 0 ? 'text-orange-500' : 'text-gray-400'}`} />
              </CardDescription>
              <CardTitle className={`text-4xl font-bold ${
                totalDebt > 100_000 ? 'text-red-600 dark:text-red-400' :
                totalDebt > 0 ? 'text-orange-600 dark:text-orange-400' :
                'text-gray-900 dark:text-white'
              }`}>
                {totalDebt > 0 ? formatCurrency(totalDebt) : '0 ₽'}
              </CardTitle>
            </CardHeader>
            <CardContent className={dashboardCardContentClass}>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {overdueDebtClients.length} {formatCountLabel(overdueDebtClients.length, 'клиент', 'клиента', 'клиентов')} с долгом
              </p>
              <p className={`text-sm ${totalDebt > 0 ? 'text-orange-700 dark:text-orange-300' : 'text-green-600 dark:text-green-400'}`}>
                {totalDebt > 0 ? 'Нужно подтвердить оплаты и отработать просрочку.' : 'Критичной задолженности сейчас нет.'}
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Operational Layer ───────────────────────────────────────────────── */}
      <section className={dashboardSectionClass}>
        <div className={dashboardSectionHeaderClass}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
            Операционная работа
          </p>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Что происходит в аренде и сервисе</h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Card className={`cursor-pointer transition-all hover:shadow-lg ${dashboardCardClass}`} onClick={() => setSelectedKPI('utilization')}>
            <CardHeader className={dashboardCardHeaderClass}>
              <CardDescription className="flex items-center justify-between">
                <span>Загрузка парка</span>
                <TrendingUp className="h-3.5 w-3.5 text-gray-400" />
              </CardDescription>
              <CardTitle className={`text-3xl font-bold ${
                totalEquipment === 0 ? 'text-gray-400' :
                utilization >= UTILIZATION_TARGET ? 'text-green-600 dark:text-green-400' :
                utilization >= UTILIZATION_TARGET - 15 ? 'text-amber-600 dark:text-amber-400' :
                'text-orange-600 dark:text-orange-400'
              }`}>
                {totalEquipment === 0 ? '—' : `${utilization}%`}
              </CardTitle>
            </CardHeader>
            <CardContent className={dashboardCardContentClass}>
              {totalEquipment === 0 ? (
                <p className="text-sm text-gray-400">Техника не добавлена</p>
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

          <Card className={`cursor-pointer transition-all hover:shadow-lg ${dashboardCardClass}`} onClick={() => setSelectedKPI('openService')}>
            <CardHeader className={dashboardCardHeaderClass}>
              <CardDescription className="flex items-center justify-between">
                <span>Открытые заявки</span>
                <Wrench className="h-3.5 w-3.5 text-gray-400" />
              </CardDescription>
              <CardTitle className={`text-3xl font-bold ${openServiceTickets.length > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-400'}`}>
                {openServiceTickets.length}
              </CardTitle>
            </CardHeader>
            <CardContent className={dashboardCardContentClass}>
              <p className="text-sm text-gray-500 dark:text-gray-400">{criticalTickets.length} крит./высоких · {equipmentInServiceList.length} ед. в сервисе</p>
            </CardContent>
          </Card>

          <Card className={`cursor-pointer transition-all hover:shadow-lg ${dashboardCardClass}`} onClick={() => setSelectedKPI('waitingParts')}>
            <CardHeader className={dashboardCardHeaderClass}>
              <CardDescription className="flex items-center justify-between">
                <span>Ждут запчасти</span>
                <PackageX className="h-3.5 w-3.5 text-gray-400" />
              </CardDescription>
              <CardTitle className={`text-3xl font-bold ${ticketsWaitingParts.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}>
                {ticketsWaitingParts.length}
              </CardTitle>
            </CardHeader>
            <CardContent className={dashboardCardContentClass}>
              <p className="text-sm text-gray-500 dark:text-gray-400">{ticketsWaitingParts.length > 0 ? 'Нужен контроль поставки и сроков.' : 'Зависших заявок по запчастям нет.'}</p>
            </CardContent>
          </Card>

          <Card className={`cursor-pointer transition-all hover:shadow-lg ${dashboardCardClass}`} onClick={() => setSelectedKPI('serviceInDays')}>
            <CardHeader className={dashboardCardHeaderClass}>
              <CardDescription className="flex items-center justify-between">
                <span>Техника в сервисе по дням</span>
                <Clock className="h-3.5 w-3.5 text-gray-400" />
              </CardDescription>
              <CardTitle className={`text-3xl font-bold ${equipmentInServiceList.length > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-400'}`}>
                {equipmentInServiceList.length}
              </CardTitle>
            </CardHeader>
            <CardContent className={dashboardCardContentClass}>
              <p className="text-sm text-gray-500 dark:text-gray-400">Ср.: {averageServiceDays || 0} дн. · Макс.: {maxServiceDays || 0} дн.</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Summary Layer ───────────────────────────────────────────────────── */}
      <section className={dashboardSectionClass}>
        <div className={dashboardSectionHeaderClass}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
            Сводка
          </p>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Спокойные показатели для общей картины</h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card className={`cursor-pointer transition-all hover:shadow-lg ${dashboardCardClass}`} onClick={() => setSelectedKPI('weekRevenue')}>
            <CardHeader className={dashboardCardHeaderClass}>
              <CardDescription className="flex items-center justify-between">
                <span>Выручка за {new Date().toLocaleDateString('ru-RU', { month: 'long' })}</span>
                <DollarSign className="h-3.5 w-3.5 text-gray-400" />
              </CardDescription>
              <CardTitle className={`text-2xl font-bold ${dashMonthRevenue === 0 ? 'text-gray-400' : 'text-gray-900 dark:text-white'}`}>
                {dashMonthRevenue > 0 ? formatCurrency(Math.round(dashMonthRevenue)) : 'Нет данных'}
              </CardTitle>
            </CardHeader>
            <CardContent className={dashboardCardContentClass}>
              {MONTHLY_PLAN > 0 ? (
                <>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                    <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${Math.min(100, Math.round(safeDiv(dashMonthRevenue, MONTHLY_PLAN) * 100))}%` }} />
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">План {formatCurrency(MONTHLY_PLAN)} · {Math.round(safeDiv(dashMonthRevenue, MONTHLY_PLAN) * 100)}%</p>
                </>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {monthRentals.length > 0 ? `${monthRentals.length} аренд в этом месяце` : 'Нет аренд в этом месяце'}
                </p>
              )}
            </CardContent>
          </Card>

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

      {/* ── Manager Stats ─────────────────────────────────────────────────────── */}
      {!isAdminRole && (
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
              <Link to="/rentals/new" className="mt-3 inline-block">
                <Button size="sm" variant="secondary">
                  <Plus className="h-4 w-4" />
                  Создать аренду
                </Button>
              </Link>
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

      {(dashboardEquipmentRisk.length > 0 || dashboardModelRisk.length > 0) && (
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
                      {item.equipmentId ? (
                        <Link to={`/equipment/${item.equipmentId}`} className="font-medium text-[--color-primary] hover:underline">
                          {item.equipmentLabel}
                        </Link>
                      ) : (
                        <p className="font-medium text-gray-900 dark:text-white">{item.equipmentLabel}</p>
                      )}
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
              <Link to="/reports" className="inline-flex items-center text-sm text-[--color-primary] hover:underline">
                Открыть сервисную аналитику
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
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
              <Link to="/reports" className="inline-flex items-center text-sm text-[--color-primary] hover:underline">
                Перейти к рейтингу моделей
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Alerts + Recent rentals ───────────────────────────────────────────── */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">

        {/* ── Alerts Panel (redesigned) ─────────────────────────────────── */}
        <Card className={alertItems.length > 0 && criticalCount > 0
          ? 'border-red-200 dark:border-red-800'
          : alertItems.length > 0 && highCount > 0
          ? 'border-orange-200 dark:border-orange-800'
          : ''
        }>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                {alertItems.length === 0 ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : criticalCount > 0 ? (
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-orange-500" />
                )}
                Требует внимания
                {alertItems.length > 0 && (
                  <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                    criticalCount > 0
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                      : 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
                  }`}>
                    {alertItems.length}
                  </span>
                )}
              </CardTitle>

              {/* Priority counters */}
              {alertItems.length > 0 && (
                <div className="flex items-center gap-1.5 shrink-0">
                  {criticalCount > 0 && (
                    <span className="flex items-center gap-1 rounded-md bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-600 inline-block" />
                      {criticalCount}
                    </span>
                  )}
                  {highCount > 0 && (
                    <span className="flex items-center gap-1 rounded-md bg-orange-100 dark:bg-orange-900/30 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:text-orange-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-orange-500 inline-block" />
                      {highCount}
                    </span>
                  )}
                  {mediumCount > 0 && (
                    <span className="flex items-center gap-1 rounded-md bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 text-xs font-semibold text-yellow-700 dark:text-yellow-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-yellow-500 inline-block" />
                      {mediumCount}
                    </span>
                  )}
                </div>
              )}
            </div>
            <CardDescription>
              {alertItems.length === 0
                ? 'Все операции в штатном режиме'
                : `${criticalCount > 0 ? `${criticalCount} критичных · ` : ''}${highCount > 0 ? `${highCount} важных · ` : ''}${mediumCount > 0 ? `${mediumCount} обычных` : ''}`.replace(/ · $/, '')}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-0 p-0 pb-0">
            {alertItems.length === 0 ? (
              /* ── Empty state ── */
              <div className="flex flex-col items-center justify-center py-10 text-center px-6">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
                  <CheckCircle className="h-7 w-7 text-green-600" />
                </div>
                <p className="font-semibold text-gray-800 dark:text-gray-200">Всё под контролем</p>
                <p className="mt-1 text-sm text-gray-400">Критических задач и рисков нет.</p>
              </div>
            ) : (
              <>
                {/* ── Alert list ── */}
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {visibleAlerts.map(alert => {
                    const Icon = alert.icon;
                    const isCritical = alert.priority === 'critical';
                    const isHigh = alert.priority === 'high';
                    return (
                      <div
                        key={alert.id}
                        className={`flex items-start gap-3 px-6 py-3.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                          isCritical ? 'border-l-2 border-red-500' :
                          isHigh ? 'border-l-2 border-orange-400' :
                          'border-l-2 border-yellow-400'
                        }`}
                      >
                        {/* Icon */}
                        <div className={`mt-0.5 shrink-0 rounded-md p-1.5 ${
                          isCritical ? 'bg-red-100 dark:bg-red-900/30' :
                          isHigh ? 'bg-orange-100 dark:bg-orange-900/30' :
                          'bg-yellow-100 dark:bg-yellow-900/20'
                        }`}>
                          <Icon className={`h-3.5 w-3.5 ${
                            isCritical ? 'text-red-600 dark:text-red-400' :
                            isHigh ? 'text-orange-600 dark:text-orange-400' :
                            'text-yellow-600 dark:text-yellow-400'
                          }`} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[10px] font-semibold uppercase tracking-wide ${
                              isCritical ? 'text-red-600 dark:text-red-400' :
                              isHigh ? 'text-orange-600 dark:text-orange-400' :
                              'text-yellow-600 dark:text-yellow-400'
                            }`}>
                              {alert.category}
                            </span>
                          </div>
                          <p className="mt-0.5 text-sm font-medium text-gray-900 dark:text-white truncate">
                            {alert.title}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {alert.entity && (
                              <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                {alert.entity}
                              </span>
                            )}
                            {alert.entity && alert.detail && (
                              <span className="text-gray-300 dark:text-gray-600 text-xs">·</span>
                            )}
                            {alert.detail && (
                              <span className={`text-xs font-medium ${
                                isCritical ? 'text-red-600 dark:text-red-400' :
                                isHigh ? 'text-orange-600 dark:text-orange-400' :
                                'text-yellow-700 dark:text-yellow-400'
                              }`}>
                                {alert.detail}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Action link */}
                        <Link
                          to={alert.link}
                          className={`shrink-0 flex items-center gap-1 text-xs font-medium transition-colors hover:underline mt-0.5 ${
                            isCritical ? 'text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200' :
                            isHigh ? 'text-orange-600 dark:text-orange-400 hover:text-orange-800 dark:hover:text-orange-200' :
                            'text-yellow-700 dark:text-yellow-400 hover:text-yellow-900 dark:hover:text-yellow-200'
                          }`}
                        >
                          {alert.linkLabel}
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    );
                  })}
                </div>

                {/* ── Show more / collapse ── */}
                {alertItems.length > ALERTS_PREVIEW && (
                  <div className="border-t border-gray-100 dark:border-gray-800 px-6 py-3">
                    <button
                      onClick={() => setShowAllAlerts(v => !v)}
                      className="flex w-full items-center justify-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                    >
                      {showAllAlerts ? (
                        <>
                          <ChevronUp className="h-4 w-4" />
                          Свернуть
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-4 w-4" />
                          Показать ещё {alertItems.length - ALERTS_PREVIEW}
                        </>
                      )}
                    </button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Recent Rentals */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Последние аренды
            </CardTitle>
            <CardDescription>Недавно созданные договоры</CardDescription>
          </CardHeader>
          <CardContent>
            {recentRentals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
                  <FileText className="h-6 w-6 text-gray-300" />
                </div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Пока нет аренд</p>
                <p className="text-xs text-gray-400 mt-0.5 mb-3">Создайте первую аренду</p>
                <Button size="sm" variant="secondary" onClick={() => setShowRentalModal(true)}>
                  <Plus className="h-4 w-4" />
                  Создать аренду
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {recentRentals.map(rental => {
                  const rs = RENTAL_STATUS[rental.status] ?? { label: rental.status, color: 'bg-gray-100 text-gray-500' };
                  return (
                    <Link
                      key={rental.id}
                      to="/rentals"
                      className="flex items-center justify-between rounded-lg border border-transparent px-2 py-3 transition-colors hover:border-gray-200 hover:bg-gray-50 dark:hover:border-gray-700 dark:hover:bg-gray-700/50 -mx-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-gray-900 dark:text-white text-sm truncate">{rental.client}</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${rs.color}`}>{rs.label}</span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                          {rental.id} · {formatDate(rental.startDate)} — {formatDate(rental.endDate)}
                        </p>
                      </div>
                      <div className="ml-3 shrink-0 text-right">
                        <p className="font-semibold text-sm text-gray-900 dark:text-white">
                          {rental.amount > 0 ? formatCurrency(rental.amount) : '—'}
                        </p>
                        <span className="text-xs text-[--color-primary]">→</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Контроль УПД по завершённым арендам</DialogTitle>
            <DialogDescription>
              Здесь офис видит, у каких клиентов аренда уже завершилась, по каким сделкам УПД ещё не отмечен, и может сразу поставить отметку.
            </DialogDescription>
          </DialogHeader>

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

          <div className="max-h-[65vh] space-y-6 overflow-y-auto pr-1">
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

          const newRental: GanttRentalData = {
            id: `GR-${Date.now()}`,
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
          rentalsService.createGanttEntry(newRental).then(() => {
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
