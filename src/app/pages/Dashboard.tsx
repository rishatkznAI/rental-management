import React, { useState, useCallback, useMemo } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
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
import { buildRentalCreationHistory } from '../lib/rental-history';
import { appendAuditHistory, createAuditEntry } from '../lib/entity-history';
import type { Equipment, Rental, ServiceTicket, Client, Payment, Document, EquipmentStatus } from '../types';
import type { GanttRentalData } from '../mock-data';
import { buildClientFinancialSnapshots } from '../lib/finance';

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

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return startOfDay(d);
}

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
    'utilization' | 'activeRentals' | 'overdueReturns' | 'inService' |
    'weekRevenue' | 'totalDebt' | 'monthDebt' | null
  >(null);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [showRentalModal, setShowRentalModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setRefreshing(true);
    qc.invalidateQueries();
    setTimeout(() => setRefreshing(false), 600);
  }, [qc]);

  const today = startOfDay(new Date());
  const weekAgo = daysAgo(7);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const clientFinancials = useMemo(
    () => buildClientFinancialSnapshots(clients, ganttRentals, payments),
    [clients, ganttRentals, payments],
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
  const currentUserName = user?.name ?? '';
  const viewRentals = isManagerRole && currentUserName
    ? rentals.filter(r => r.manager === currentUserName)
    : rentals;

  // Utilization
  const totalEquipment = equipment.length;
  const activeEquipment = equipment.filter(e => e.status !== 'inactive').length;
  const rentedEquipment = equipment.filter(e => e.status === 'rented').length;
  const availableEquipment = equipment.filter(e => e.status === 'available').length;
  const utilization = totalEquipment === 0
    ? 0
    : Math.round(safeDiv(rentedEquipment, activeEquipment > 0 ? activeEquipment : totalEquipment) * 100);

  // Active rentals (фильтруются по ролям: менеджер видит только свои)
  const activeRentalsList = viewRentals.filter(r =>
    r.status === 'active' || r.status === 'delivery' || r.status === 'confirmed'
  );

  // Overdue returns: active/delivery rentals with plannedReturnDate in the past
  const overdueRentalsList = viewRentals.filter(r =>
    (r.status === 'active' || r.status === 'delivery') && isOverdue(r.plannedReturnDate)
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
  const clientDebt = computedClients.reduce((sum, c) => sum + (c.debt || 0), 0);
  const overduePayments = payments.filter(p => p.status === 'overdue');
  const overduePaymentsTotal = overduePayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const totalDebt = clientDebt + overduePaymentsTotal;

  // Month debt: overdue payments this month
  const monthOverduePayments = payments.filter(p => {
    if (p.status !== 'overdue') return false;
    const dueDate = new Date(p.dueDate);
    return dueDate >= monthStart;
  });
  const monthDebt = monthOverduePayments.reduce((sum, p) => sum + (p.amount || 0), 0);

  // Upcoming returns (next 3 days, not overdue)
  const soon3 = new Date(today);
  soon3.setDate(soon3.getDate() + 3);
  const upcomingReturns = viewRentals.filter(r => {
    if (r.status !== 'active') return false;
    const ret = new Date(r.plannedReturnDate);
    return ret >= today && ret <= soon3;
  });

  // Critical service tickets
  const criticalTickets = tickets.filter(t =>
    (t.priority === 'critical' || t.priority === 'high') && t.status !== 'closed'
  );

  // Recent rentals (last 10, sorted newest first)
  const recentRentals = [...viewRentals]
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
    .slice(0, 5);

  // ── Manager stats for current user ─────────────────────────────────────────
  // (currentUserName уже объявлен выше)
  const myRentals = currentUserName
    ? rentals.filter(r => r.manager === currentUserName)
    : [];
  const myActiveRentals = myRentals.filter(r => r.status === 'active');
  const myMonthRentals = myRentals.filter(r => {
    const start = new Date(r.startDate);
    return start >= monthStart;
  });
  const myMonthRevenue = myMonthRentals.reduce((sum, r) => sum + (r.price || 0), 0);

  // Clients of this manager's rentals
  const myClientNames = [...new Set(myRentals.map(r => r.client))];
  const myClients = computedClients.filter(c => myClientNames.includes(c.company));
  const myClientDebt = myClients.reduce((sum, c) => sum + (c.debt || 0), 0);
  const myOverduePayments = payments.filter(p =>
    p.status === 'overdue' && myClientNames.includes(p.client)
  );

  const hasManagerData = myRentals.length > 0;

  // ── Extended KPIs ───────────────────────────────────────────────────────────
  const UTILIZATION_TARGET = 85;
  const utilizationDeviation = utilization - UTILIZATION_TARGET;

  // Equipment in active use (rented + reserved)
  const rentedOrReservedEquipment = equipment.filter(e => e.status === 'rented' || e.status === 'reserved').length;
  const reservedEquipment = equipment.filter(e => e.status === 'reserved').length;
  const inactiveEquipment = equipment.filter(e => e.status === 'inactive').length;

  // Rentals ending today
  const tomorrowStart = new Date(today);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const rentalsEndingToday = viewRentals.filter(r => {
    const ret = new Date(r.plannedReturnDate);
    return (r.status === 'active' || r.status === 'delivery') && ret >= today && ret < tomorrowStart;
  });

  // Max overdue days
  const maxOverdueDays = overdueRentalsList.length > 0
    ? Math.max(...overdueRentalsList.map(r => {
        const diffMs = today.getTime() - new Date(r.plannedReturnDate).getTime();
        return Math.max(1, Math.ceil(diffMs / 86400000));
      }))
    : 0;

  // Service tickets waiting for parts
  const ticketsWaitingParts = tickets.filter(t => t.status === 'waiting_parts');

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

  // Overdue debt clients
  const overdueDebtClients = computedClients.filter(c => (c.debt ?? 0) > 0);
  const overdueDebtCount = overdueDebtClients.length + overduePayments.length;

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
  overdueRentalsList.forEach(r => {
    const days = Math.max(1, Math.ceil((today.getTime() - new Date(r.plannedReturnDate).getTime()) / 86400000));
    alertItems.push({
      id: `overdue-return-${r.id}`,
      priority: 'critical',
      icon: Calendar,
      category: 'Просроченный возврат',
      title: r.client,
      entity: r.equipment?.slice(0, 2).join(', ') || r.id,
      detail: `Просрочка ${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}`,
      link: `/rentals/${r.id}`,
      linkLabel: 'Открыть аренду',
    });
  });

  // 2. Просроченные платежи (критично если > 7 дней, иначе высокий)
  overduePayments.forEach(p => {
    const days = Math.max(0, Math.ceil((today.getTime() - new Date(p.dueDate).getTime()) / 86400000));
    alertItems.push({
      id: `overdue-pay-${p.id}`,
      priority: days > 7 ? 'critical' : 'high',
      icon: DollarSign,
      category: 'Неоплаченный счёт',
      title: p.client,
      entity: p.invoiceNumber ? `Счёт ${p.invoiceNumber}` : (p.rentalId ? `Аренда ${p.rentalId}` : 'Платёж'),
      detail: `${formatCurrency(p.amount)} · ${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'} просрочки`,
      link: '/payments',
      linkLabel: 'К платежам',
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
  const startingSoonRentals = viewRentals.filter(r => {
    const s = new Date(r.startDate);
    return (r.status === 'confirmed' || r.status === 'new') && s >= today && s <= soon2;
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
    activeRentals: { activeRentals: activeRentalsList },
    overdueReturns: { overdueRentals: overdueRentalsList },
    inService: { equipmentInService: equipmentInServiceList },
    weekRevenue: {
      weekRevenue: Math.round(weekRevenue),
      activeRentalsCount: activeRentalsList.length,
      averagePrice: activeRentalsList.length > 0
        ? Math.round(activeRentalsList.reduce((s, r) => s + (r.price || 0), 0) / activeRentalsList.length)
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

      {/* ── KPI Row 1 — Операционные показатели ──────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">

        {/* 1. Утилизация парка */}
        <Card
          className={`cursor-pointer transition-all hover:shadow-lg ${
            totalEquipment > 0 && utilization < 50
              ? 'border-orange-200 dark:border-orange-800'
              : ''
          }`}
          onClick={() => setSelectedKPI('utilization')}
        >
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>Утилизация парка</span>
              <TrendingUp className="h-3.5 w-3.5 text-gray-400" />
            </CardDescription>
            <CardTitle className={`text-3xl font-bold ${
              totalEquipment === 0 ? 'text-gray-400' :
              utilization >= UTILIZATION_TARGET ? 'text-green-600 dark:text-green-400' :
              utilization >= UTILIZATION_TARGET - 15 ? 'text-yellow-600 dark:text-yellow-400' :
              'text-orange-600 dark:text-orange-400'
            }`}>
              {totalEquipment === 0 ? '—' : `${utilization}%`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {totalEquipment === 0 ? (
              <p className="text-sm text-gray-400">Техника не добавлена</p>
            ) : (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {rentedEquipment} из {activeEquipment} ед. в работе
                </p>
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                  <div
                    className="h-full rounded-full bg-[--color-primary] transition-all"
                    style={{ width: `${utilization}%` }}
                  />
                  <div
                    className="absolute top-0 h-full w-0.5 bg-gray-400 dark:bg-gray-500"
                    style={{ left: `${UTILIZATION_TARGET}%` }}
                    title={`Цель: ${UTILIZATION_TARGET}%`}
                  />
                </div>
                <p className={`text-xs font-medium ${
                  utilizationDeviation >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
                }`}>
                  {utilizationDeviation >= 0 ? `+${utilizationDeviation}%` : `${utilizationDeviation}%`} к цели {UTILIZATION_TARGET}%
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* 2. Активные аренды */}
        <Card
          className="cursor-pointer transition-all hover:shadow-lg"
          onClick={() => setSelectedKPI('activeRentals')}
        >
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>Активные аренды</span>
              <Calendar className="h-3.5 w-3.5 text-gray-400" />
            </CardDescription>
            <CardTitle className={`text-3xl font-bold ${activeRentalsList.length === 0 ? 'text-gray-400' : ''}`}>
              {activeRentalsList.length === 0 ? '0' : activeRentalsList.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {activeRentalsList.length === 0 ? (
              <p className="text-sm text-gray-400">Нет активных аренд</p>
            ) : (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {rentedOrReservedEquipment} ед. техники задействовано
                </p>
                {rentalsEndingToday.length > 0 ? (
                  <p className="text-xs font-medium text-orange-600 dark:text-orange-400">
                    ⚠ {rentalsEndingToday.length} возврат{rentalsEndingToday.length === 1 ? '' : 'а'} сегодня
                  </p>
                ) : upcomingReturns.length > 0 ? (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">
                    {upcomingReturns.length} завершений за 3 дня
                  </p>
                ) : (
                  <p className="text-xs text-gray-400">Возвратов сегодня нет</p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* 3. Просроченные возвраты — КРИТИЧНАЯ */}
        <Card
          className={`cursor-pointer transition-all hover:shadow-lg ${
            overdueRentalsList.length > 0
              ? 'border-red-300 dark:border-red-700 bg-red-50/40 dark:bg-red-950/20'
              : ''
          }`}
          onClick={() => setSelectedKPI('overdueReturns')}
        >
          <CardHeader className="pb-2">
            <CardDescription className={`flex items-center justify-between ${
              overdueRentalsList.length > 0 ? 'text-red-600 dark:text-red-400' : ''
            }`}>
              <span>Просроченные возвраты</span>
              <AlertTriangle className={`h-3.5 w-3.5 ${overdueRentalsList.length > 0 ? 'text-red-500' : 'text-gray-400'}`} />
            </CardDescription>
            <CardTitle className={`text-3xl font-bold ${
              overdueRentalsList.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'
            }`}>
              {overdueRentalsList.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {overdueRentalsList.length > 0 ? (
              <div className="space-y-1">
                <p className="text-sm font-medium text-red-700 dark:text-red-300">
                  Макс. просрочка: {maxOverdueDays}&nbsp;{maxOverdueDays === 1 ? 'день' : maxOverdueDays < 5 ? 'дня' : 'дней'}
                </p>
                <p className="text-xs text-red-500 dark:text-red-400">Требует немедленного внимания</p>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle className="h-4 w-4 shrink-0" />
                <span>Нет просрочек</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 4. Техника в сервисе */}
        <Card
          className={`cursor-pointer transition-all hover:shadow-lg ${
            equipmentInServiceList.length > 0 ? 'border-orange-200 dark:border-orange-800' : ''
          }`}
          onClick={() => setSelectedKPI('inService')}
        >
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>Техника в сервисе</span>
              <Wrench className="h-3.5 w-3.5 text-gray-400" />
            </CardDescription>
            <CardTitle className={`text-3xl font-bold ${
              equipmentInServiceList.length > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-900 dark:text-white'
            }`}>
              {equipmentInServiceList.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {equipmentInServiceList.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle className="h-4 w-4 shrink-0" />
                <span>Всё исправно</span>
              </div>
            ) : (
              <>
                {criticalInService > 0 && (
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">
                    {criticalInService} крит. · блокируют аренду
                  </p>
                )}
                {ticketsWaitingParts.length > 0 && (
                  <p className="text-xs text-orange-600 dark:text-orange-400">
                    {ticketsWaitingParts.length} ждут запчасти
                  </p>
                )}
                {criticalInService === 0 && ticketsWaitingParts.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">На обслуживании</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── KPI Row 2 — Финансы + Парк ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-3">

        {/* 5. Выручка за месяц */}
        <Card
          className="cursor-pointer transition-all hover:shadow-lg"
          onClick={() => setSelectedKPI('weekRevenue')}
        >
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>
                Выручка за {new Date().toLocaleDateString('ru-RU', { month: 'long' })}
              </span>
              <DollarSign className="h-3.5 w-3.5 text-gray-400" />
            </CardDescription>
            <CardTitle className={`text-2xl font-bold ${dashMonthRevenue === 0 ? 'text-gray-400' : ''}`}>
              {dashMonthRevenue > 0 ? formatCurrency(Math.round(dashMonthRevenue)) : 'Нет данных'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {MONTHLY_PLAN > 0 ? (
              <>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all"
                    style={{ width: `${Math.min(100, Math.round(safeDiv(dashMonthRevenue, MONTHLY_PLAN) * 100))}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  план {formatCurrency(MONTHLY_PLAN)} · {Math.round(safeDiv(dashMonthRevenue, MONTHLY_PLAN) * 100)}%
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {monthRentals.length > 0
                  ? `${monthRentals.length} аренд в этом месяце`
                  : 'Нет аренд в этом месяце'}
              </p>
            )}
          </CardContent>
        </Card>

        {/* 6. Просроченная дебиторка */}
        <Card
          className={`cursor-pointer transition-all hover:shadow-lg ${
            totalDebt > 0 ? 'border-orange-200 dark:border-orange-800' : ''
          }`}
          onClick={() => setSelectedKPI('totalDebt')}
        >
          <CardHeader className="pb-2">
            <CardDescription className={`flex items-center justify-between ${
              totalDebt > 0 ? 'text-orange-600 dark:text-orange-400' : ''
            }`}>
              <span>Просроченная дебиторка</span>
              <CreditCard className={`h-3.5 w-3.5 ${totalDebt > 0 ? 'text-orange-500' : 'text-gray-400'}`} />
            </CardDescription>
            <CardTitle className={`text-2xl font-bold ${
              totalDebt > 100_000 ? 'text-red-600 dark:text-red-400' :
              totalDebt > 0 ? 'text-orange-600 dark:text-orange-400' : ''
            }`}>
              {totalDebt > 0 ? formatCurrency(totalDebt) : 'Нет'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {totalDebt === 0 ? (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle className="h-4 w-4 shrink-0" />
                <span>Нет задолженности</span>
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {overdueDebtCount}&nbsp;{overdueDebtCount === 1 ? 'клиент' : overdueDebtCount < 5 ? 'клиента' : 'клиентов'} с задолженностью
              </p>
            )}
          </CardContent>
        </Card>

        {/* 7. Статус парка */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>Статус парка</span>
              <Truck className="h-3.5 w-3.5 text-gray-400" />
            </CardDescription>
            <CardTitle className="text-3xl font-bold">{totalEquipment}</CardTitle>
          </CardHeader>
          <CardContent>
            {totalEquipment === 0 ? (
              <p className="text-sm text-gray-400">Техника не добавлена</p>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 dark:text-gray-400">Свободно</span>
                  <span className="font-semibold text-green-600 dark:text-green-400">{availableEquipment}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 dark:text-gray-400">В аренде</span>
                  <span className="font-semibold text-blue-600 dark:text-blue-400">{rentedEquipment}</span>
                </div>
                {reservedEquipment > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 dark:text-gray-400">Резерв</span>
                    <span className="font-semibold text-yellow-600 dark:text-yellow-400">{reservedEquipment}</span>
                  </div>
                )}
                {equipmentInServiceList.length > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 dark:text-gray-400">В сервисе</span>
                    <span className="font-semibold text-orange-600 dark:text-orange-400">{equipmentInServiceList.length}</span>
                  </div>
                )}
                {inactiveEquipment > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 dark:text-gray-400">Простой</span>
                    <span className="font-semibold text-gray-500">{inactiveEquipment}</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Manager Stats ─────────────────────────────────────────────────────── */}
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
                <p className="text-xs text-gray-500 dark:text-gray-400">Дебиторка клиентов</p>
                <p className="mt-1 text-xl text-orange-700 dark:text-orange-300">
                  {myClientDebt > 0 ? formatCurrency(myClientDebt) : '0 ₽'}
                </p>
              </div>
              <div className="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
                <p className="text-xs text-gray-500 dark:text-gray-400">Просроч. оплаты</p>
                <p className="mt-1 text-2xl text-red-700 dark:text-red-300">{myOverduePayments.length}</p>
              </div>
              <div className="rounded-lg bg-purple-50 p-3 dark:bg-purple-900/20">
                <p className="text-xs text-gray-500 dark:text-gray-400">Всего аренд</p>
                <p className="mt-1 text-2xl text-purple-700 dark:text-purple-300">{myRentals.length}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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
                      to={`/rentals/${rental.id}`}
                      className="flex items-center justify-between rounded-lg border border-transparent px-2 py-3 transition-colors hover:border-gray-200 hover:bg-gray-50 dark:hover:border-gray-700 dark:hover:bg-gray-700/50 -mx-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-gray-900 dark:text-white text-sm truncate">{rental.client}</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${rs.color}`}>{rs.label}</span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                          {rental.id} · {formatDate(rental.startDate)} — {formatDate(rental.plannedReturnDate)}
                        </p>
                      </div>
                      <div className="ml-3 shrink-0 text-right">
                        <p className="font-semibold text-sm text-gray-900 dark:text-white">
                          {rental.price > 0 ? formatCurrency(rental.price) : '—'}
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
