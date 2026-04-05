import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import {
  Plus, TrendingUp, AlertTriangle, Wrench, DollarSign, Calendar,
  User, Target, FileText, CreditCard, RefreshCw, CheckCircle, Truck,
} from 'lucide-react';
import { Link } from 'react-router';
import { formatCurrency, formatDate } from '../lib/utils';
import {
  loadEquipment,
  saveEquipment,
  loadRentals,
  loadServiceTickets,
  loadClients,
  loadPayments,
  loadGanttRentals,
  saveGanttRentals,
  EQUIPMENT_STORAGE_KEY,
  RENTALS_STORAGE_KEY,
  SERVICE_STORAGE_KEY,
  CLIENTS_STORAGE_KEY,
  PAYMENTS_STORAGE_KEY,
  GANTT_RENTALS_STORAGE_KEY,
} from '../mock-data';
import { KPIDetailModal } from '../components/modals/KPIDetailModal';
import { ServiceRequestModal } from '../components/modals/ServiceRequestModal';
import { NewClientModal } from '../components/modals/NewClientModal';
import { NewRentalModal } from '../components/gantt/GanttModals';
import { useAuth } from '../contexts/AuthContext';
import type { Equipment, Rental, ServiceTicket, Client, Payment } from '../types';
import type { GanttRentalData } from '../mock-data';
import type { EquipmentStatus } from '../types';

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

// ─── live data hook ────────────────────────────────────────────────────────────

interface DashData {
  equipment: Equipment[];
  rentals: Rental[];
  tickets: ServiceTicket[];
  clients: Client[];
  payments: Payment[];
  loadedAt: number;
}

function loadAll(): DashData {
  return {
    equipment: loadEquipment(),
    rentals: loadRentals(),
    tickets: loadServiceTickets(),
    clients: loadClients(),
    payments: loadPayments(),
    loadedAt: Date.now(),
  };
}

// ─── main component ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth();

  const [data, setData] = useState<DashData>(loadAll);
  const [selectedKPI, setSelectedKPI] = useState<
    'utilization' | 'activeRentals' | 'overdueReturns' | 'inService' |
    'weekRevenue' | 'totalDebt' | 'monthDebt' | null
  >(null);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [showRentalModal, setShowRentalModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [ganttRentals, setGanttRentals] = useState<GanttRentalData[]>(() => loadGanttRentals());
  const [equipmentList, setEquipmentList] = useState<Equipment[]>(() => loadEquipment());

  const refresh = useCallback(() => {
    setRefreshing(true);
    setData(loadAll());
    setTimeout(() => setRefreshing(false), 400);
  }, []);

  // Auto-refresh on focus and when localStorage changes
  useEffect(() => {
    const onFocus = () => {
      setData(loadAll());
      setGanttRentals(loadGanttRentals());
      setEquipmentList(loadEquipment());
    };
    const watchKeys = [
      EQUIPMENT_STORAGE_KEY, RENTALS_STORAGE_KEY,
      SERVICE_STORAGE_KEY, CLIENTS_STORAGE_KEY, PAYMENTS_STORAGE_KEY,
      GANTT_RENTALS_STORAGE_KEY,
    ];
    const onStorage = (e: StorageEvent) => {
      if (e.key && watchKeys.includes(e.key)) {
        setData(loadAll());
        setGanttRentals(loadGanttRentals());
        setEquipmentList(loadEquipment());
      }
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // ── derived KPIs ─────────────────────────────────────────────────────────────
  const { equipment, rentals, tickets, clients, payments } = data;

  const today = startOfDay(new Date());
  const weekAgo = daysAgo(7);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  // Utilization
  const totalEquipment = equipment.length;
  const activeEquipment = equipment.filter(e => e.status !== 'inactive').length;
  const rentedEquipment = equipment.filter(e => e.status === 'rented').length;
  const availableEquipment = equipment.filter(e => e.status === 'available').length;
  const utilization = totalEquipment === 0
    ? 0
    : Math.round(safeDiv(rentedEquipment, activeEquipment > 0 ? activeEquipment : totalEquipment) * 100);

  // Active rentals
  const activeRentalsList = rentals.filter(r =>
    r.status === 'active' || r.status === 'delivery' || r.status === 'confirmed'
  );

  // Overdue returns: active/delivery rentals with plannedReturnDate in the past
  const overdueRentalsList = rentals.filter(r =>
    (r.status === 'active' || r.status === 'delivery') && isOverdue(r.plannedReturnDate)
  );

  // Equipment in service
  const equipmentInServiceList = equipment.filter(e => e.status === 'in_service');

  // Week revenue: sum of prices of rentals that started in the last 7 days, OR active rentals
  const weekStartedRentals = rentals.filter(r => {
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
  const clientDebt = clients.reduce((sum, c) => sum + (c.debt || 0), 0);
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
  const upcomingReturns = rentals.filter(r => {
    if (r.status !== 'active') return false;
    const ret = new Date(r.plannedReturnDate);
    return ret >= today && ret <= soon3;
  });

  // Critical service tickets
  const criticalTickets = tickets.filter(t =>
    (t.priority === 'critical' || t.priority === 'high') && t.status !== 'closed'
  );

  // Recent rentals (last 10, sorted newest first)
  const recentRentals = [...rentals]
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
    .slice(0, 5);

  // ── Manager stats for current user ─────────────────────────────────────────
  const currentUserName = user?.name ?? '';
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
  const myClients = clients.filter(c => myClientNames.includes(c.company));
  const myClientDebt = myClients.reduce((sum, c) => sum + (c.debt || 0), 0);
  const myOverduePayments = payments.filter(p =>
    p.status === 'overdue' && myClientNames.includes(p.client)
  );

  const hasManagerData = myRentals.length > 0;

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
      clients: clients.filter(c => (c.debt ?? 0) > 0),
      overduePayments,
    },
    monthDebt: { monthDebt, overduePayments: monthOverduePayments },
  };

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
            Обновлено: {new Date(data.loadedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Обновить</span>
          </Button>
          <Button size="sm" onClick={() => setShowRentalModal(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Новая аренда</span>
            <span className="sm:hidden">Аренда</span>
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setShowServiceModal(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Заявка в сервис</span>
            <span className="sm:hidden">Сервис</span>
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setShowClientModal(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Новый клиент</span>
            <span className="sm:hidden">Клиент</span>
          </Button>
        </div>
      </div>

      {/* ── KPI Row 1 ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">

        {/* Utilization */}
        <Card className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setSelectedKPI('utilization')}>
          <CardHeader className="pb-2">
            <CardDescription>Утилизация парка <span className="text-xs text-gray-400">· сейчас</span></CardDescription>
            <CardTitle className="text-3xl">
              {totalEquipment === 0 ? '—' : `${utilization}%`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <TrendingUp className="h-4 w-4 text-green-600 shrink-0" />
              {totalEquipment === 0
                ? <span>Техника не добавлена</span>
                : <span>{rentedEquipment} из {activeEquipment} ед.</span>
              }
            </div>
            {totalEquipment > 0 && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                <div className="h-full rounded-full bg-[--color-primary]" style={{ width: `${utilization}%` }} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active rentals */}
        <Card className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setSelectedKPI('activeRentals')}>
          <CardHeader className="pb-2">
            <CardDescription>Активные аренды</CardDescription>
            <CardTitle className="text-3xl">{activeRentalsList.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {activeRentalsList.length === 0 ? 'Нет активных аренд' : `из ${rentals.length} всего`}
            </p>
          </CardContent>
        </Card>

        {/* Overdue returns */}
        <Card className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setSelectedKPI('overdueReturns')}>
          <CardHeader className="pb-2">
            <CardDescription>Просроченные возвраты</CardDescription>
            <CardTitle className={`text-3xl ${overdueRentalsList.length > 0 ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>
              {overdueRentalsList.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {overdueRentalsList.length > 0 ? (
              <div className="flex items-center gap-2 text-sm text-red-600">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Требует внимания</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle className="h-4 w-4 shrink-0" />
                <span>Нет просрочек</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* In service */}
        <Card className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setSelectedKPI('inService')}>
          <CardHeader className="pb-2">
            <CardDescription>Техника в сервисе</CardDescription>
            <CardTitle className={`text-3xl ${equipmentInServiceList.length > 0 ? 'text-orange-500' : 'text-gray-900 dark:text-white'}`}>
              {equipmentInServiceList.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Wrench className="h-4 w-4 shrink-0" />
              <span>{equipmentInServiceList.length === 0 ? 'Всё исправно' : 'На обслуживании'}</span>
            </div>
          </CardContent>
        </Card>

        {/* Week revenue */}
        <Card className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setSelectedKPI('weekRevenue')}>
          <CardHeader className="pb-2">
            <CardDescription>Выручка за 7 дней</CardDescription>
            <CardTitle className="text-2xl">
              {weekRevenue > 0 ? formatCurrency(Math.round(weekRevenue)) : '0 ₽'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <DollarSign className="h-4 w-4 shrink-0" />
              <span>{weekStartedRentals.length > 0
                ? `${weekStartedRentals.length} аренд начато`
                : activeRentalsList.length > 0 ? 'оценка по активным' : 'нет данных'}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── KPI Row 2 — Debt ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Card className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setSelectedKPI('totalDebt')}>
          <CardHeader className="pb-2">
            <CardDescription>Общая дебиторка</CardDescription>
            <CardTitle className={`text-2xl ${totalDebt > 0 ? 'text-orange-600' : ''}`}>
              {formatCurrency(totalDebt)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <CreditCard className="h-4 w-4 text-orange-500 shrink-0" />
              <span>
                {clients.filter(c => (c.debt ?? 0) > 0).length + overduePayments.length > 0
                  ? `${clients.filter(c => (c.debt ?? 0) > 0).length + overduePayments.length} позиций`
                  : 'Нет задолженностей'}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setSelectedKPI('monthDebt')}>
          <CardHeader className="pb-2">
            <CardDescription>Дебиторка за месяц</CardDescription>
            <CardTitle className={`text-2xl ${monthDebt > 0 ? 'text-red-600' : ''}`}>
              {formatCurrency(monthDebt)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <AlertTriangle className={`h-4 w-4 shrink-0 ${monthDebt > 0 ? 'text-red-500' : 'text-gray-400'}`} />
              <span>{monthOverduePayments.length > 0
                ? `${monthOverduePayments.length} просроч. платежей`
                : 'Нет просрочек'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Equipment summary — bonus card */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Парк техники</CardDescription>
            <CardTitle className="text-3xl">{totalEquipment}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Truck className="h-4 w-4 shrink-0" />
              <span>{totalEquipment === 0 ? 'Не добавлена' : `${availableEquipment} свободно`}</span>
            </div>
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

      {/* ── Alerts + Recent rentals ───────────────────────────────────────────── */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">

        {/* Alerts Panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              Требует внимания
            </CardTitle>
            <CardDescription>Критические события и задачи</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">

            {/* Overdue returns */}
            {overdueRentalsList.length > 0 && (
              <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
                <div className="flex items-start gap-3">
                  <Calendar className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-red-900 dark:text-red-200">
                      Просроченные возвраты ({overdueRentalsList.length})
                    </p>
                    <div className="mt-1 space-y-0.5">
                      {overdueRentalsList.slice(0, 3).map(r => (
                        <p key={r.id} className="text-sm text-red-700 dark:text-red-300 truncate">
                          {r.client} — просрочен до {formatDate(r.plannedReturnDate)}
                        </p>
                      ))}
                    </div>
                    <Link to="/rentals" className="mt-2 inline-block text-sm font-medium text-red-800 dark:text-red-200 hover:underline">
                      Смотреть все →
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Overdue payments */}
            {overduePayments.length > 0 && (
              <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
                <div className="flex items-start gap-3">
                  <DollarSign className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-red-900 dark:text-red-200">
                      Просроченные платежи ({overduePayments.length})
                    </p>
                    <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                      Общая сумма: {formatCurrency(overduePaymentsTotal)}
                    </p>
                    <Link to="/payments" className="mt-2 inline-block text-sm font-medium text-red-800 dark:text-red-200 hover:underline">
                      Перейти к платежам →
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Upcoming returns */}
            {upcomingReturns.length > 0 && (
              <div className="rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 p-4">
                <div className="flex items-start gap-3">
                  <Calendar className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-yellow-900 dark:text-yellow-200">
                      Возвраты в ближайшие 3 дня ({upcomingReturns.length})
                    </p>
                    <div className="mt-1 space-y-0.5">
                      {upcomingReturns.slice(0, 3).map(r => (
                        <p key={r.id} className="text-sm text-yellow-700 dark:text-yellow-300 truncate">
                          {r.client} — {formatDate(r.plannedReturnDate)}
                        </p>
                      ))}
                    </div>
                    <Link to="/rentals" className="mt-2 inline-block text-sm font-medium text-yellow-800 dark:text-yellow-200 hover:underline">
                      Смотреть все →
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Critical tickets */}
            {criticalTickets.length > 0 && (
              <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 p-4">
                <div className="flex items-start gap-3">
                  <Wrench className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-orange-900 dark:text-orange-200">
                      Критические заявки сервиса ({criticalTickets.length})
                    </p>
                    <div className="mt-1 space-y-0.5">
                      {criticalTickets.slice(0, 2).map(t => (
                        <p key={t.id} className="text-sm text-orange-700 dark:text-orange-300 truncate">
                          {t.id} · {t.equipment}
                        </p>
                      ))}
                    </div>
                    <Link to="/service" className="mt-2 inline-block text-sm font-medium text-orange-800 dark:text-orange-200 hover:underline">
                      Открыть сервис →
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Equipment in service alert */}
            {equipmentInServiceList.length > 0 && criticalTickets.length === 0 && (
              <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 p-4">
                <div className="flex items-start gap-3">
                  <Wrench className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-orange-900 dark:text-orange-200">
                      Техника в сервисе: {equipmentInServiceList.length} ед.
                    </p>
                    <p className="text-sm text-orange-700 dark:text-orange-300 mt-0.5">
                      {equipmentInServiceList.slice(0, 2).map(e => e.inventoryNumber).join(', ')}
                      {equipmentInServiceList.length > 2 ? ` +${equipmentInServiceList.length - 2}` : ''}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* All clear */}
            {overdueRentalsList.length === 0 &&
              overduePayments.length === 0 &&
              upcomingReturns.length === 0 &&
              criticalTickets.length === 0 &&
              equipmentInServiceList.length === 0 && (
              <div className="flex items-center justify-center py-8 text-center">
                <div>
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
                    <CheckCircle className="h-6 w-6 text-green-600" />
                  </div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Всё в порядке!</p>
                  <p className="text-xs text-gray-400 mt-0.5">Критических задач нет.</p>
                </div>
              </div>
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
            comments: [],
          };

          const updatedRentals = [...ganttRentals, newRental];
          setGanttRentals(updatedRentals);
          saveGanttRentals(updatedRentals);

          if (formData.equipmentInv) {
            const eqStatus: EquipmentStatus = initialStatus === 'active' ? 'rented' : 'reserved';
            const updatedEq = equipmentList.map(e => {
              if (e.inventoryNumber !== formData.equipmentInv) return e;
              return {
                ...e,
                status: eqStatus,
                currentClient: initialStatus === 'active' ? newRental.client : e.currentClient,
                returnDate: initialStatus === 'active' ? newRental.endDate : e.returnDate,
              };
            });
            setEquipmentList(updatedEq);
            saveEquipment(updatedEq);
          }

          setData(loadAll());
          setShowRentalModal(false);
        }}
      />
    </div>
  );
}
