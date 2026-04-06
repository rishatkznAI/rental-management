import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { RefreshCw, Truck, BarChart2, Wrench, TrendingUp } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import {
  loadEquipment, loadGanttRentals, loadServiceTickets,
  EQUIPMENT_STORAGE_KEY, GANTT_RENTALS_STORAGE_KEY, SERVICE_STORAGE_KEY,
} from '../mock-data';
import { formatCurrency } from '../lib/utils';
import type { Equipment, ServiceTicket } from '../types';
import type { GanttRentalData } from '../mock-data';
import ManagerReport from './ManagerReport';

// ─── helpers ────────────────────────────────────────────────────────────────

function formatTs(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function minutesAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 60000);
  if (diff < 1) return 'только что';
  if (diff === 1) return '1 мин. назад';
  if (diff < 60) return `${diff} мин. назад`;
  return `${Math.floor(diff / 60)} ч. назад`;
}

const MONTH_LABELS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

function lastNMonths(n: number) {
  const now = new Date();
  const result: { year: number; month: number; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push({ year: d.getFullYear(), month: d.getMonth(), label: MONTH_LABELS[d.getMonth()] });
  }
  return result;
}

function daysOverlap(start: string, end: string, mStart: Date, mEnd: Date): number {
  const s = Math.max(new Date(start).getTime(), mStart.getTime());
  const e = Math.min(new Date(end).getTime(), mEnd.getTime());
  return e >= s ? Math.ceil((e - s) / 86400000) + 1 : 0;
}

// ─── data types ─────────────────────────────────────────────────────────────

interface ReportData {
  equipment: Equipment[];
  ganttRentals: GanttRentalData[];
  tickets: ServiceTicket[];
  loadedAt: number;
}

function loadAll(): ReportData {
  return {
    equipment: loadEquipment(),
    ganttRentals: loadGanttRentals(),
    tickets: loadServiceTickets(),
    loadedAt: Date.now(),
  };
}

// ─── constants ───────────────────────────────────────────────────────────────

const TICKET_STATUS_LABELS: Record<string, string> = {
  new: 'Новые заявки',
  in_progress: 'В ремонте',
  waiting_parts: 'Ожидание запчастей',
  ready: 'Готово к выдаче',
};

const TICKET_STATUS_COLORS: Record<string, string> = {
  new: '#3b82f6',
  in_progress: '#ef4444',
  waiting_parts: '#f59e0b',
  ready: '#22c55e',
};

const FALLBACK_COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#22c55e', '#8b5cf6', '#6b7280'];

// ─── empty state ─────────────────────────────────────────────────────────────

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-[250px] flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
        <BarChart2 className="h-7 w-7 text-gray-400 dark:text-gray-500" />
      </div>
      <p className="max-w-[240px] text-sm text-gray-500 dark:text-gray-400">{message}</p>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function Reports() {
  const [data, setData] = useState<ReportData>(loadAll);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    setTimeout(() => {
      setData(loadAll());
      setIsRefreshing(false);
    }, 450);
  }, []);

  // Auto-refresh on focus and cross-tab storage changes
  useEffect(() => {
    const watchKeys = [EQUIPMENT_STORAGE_KEY, GANTT_RENTALS_STORAGE_KEY, SERVICE_STORAGE_KEY];
    const onStorage = (e: StorageEvent) => {
      if (e.key && watchKeys.includes(e.key)) setData(loadAll());
    };
    const onFocus = () => setData(loadAll());
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const { equipment, ganttRentals, tickets, loadedAt } = data;

  // ─── KPI ──────────────────────────────────────────────────────────────────
  const totalEquipment = equipment.length;
  const activeEquipment = equipment.filter(e => e.status !== 'inactive').length;
  const rentedEquipment = equipment.filter(e => e.status === 'rented').length;
  const activeRentals = ganttRentals.filter(r => r.status === 'active').length;
  const openTickets = tickets.filter(t => t.status !== 'closed').length;
  const inProgressTickets = tickets.filter(t => t.status === 'in_progress').length;
  const utilization = activeEquipment === 0
    ? null
    : Math.round((rentedEquipment / activeEquipment) * 100);

  // ─── Utilization by month (last 6 months) ────────────────────────────────
  const utilizationData = useMemo(() => {
    const months = lastNMonths(6);
    return months.map(({ year, month, label }) => {
      const mStart = new Date(year, month, 1);
      const mEnd = new Date(year, month + 1, 0);
      const daysInMonth = mEnd.getDate();
      if (totalEquipment === 0) return { month: label, utilization: 0 };
      const totalPossible = totalEquipment * daysInMonth;
      const rentedDays = ganttRentals
        .filter(r => r.status === 'active' || r.status === 'returned' || r.status === 'closed')
        .reduce((sum, r) => sum + daysOverlap(r.startDate, r.endDate, mStart, mEnd), 0);
      const pct = totalPossible === 0 ? 0 : Math.min(100, Math.round((rentedDays / totalPossible) * 100));
      return { month: label, utilization: pct };
    });
  }, [ganttRentals, totalEquipment]);

  const hasUtilizationData = utilizationData.some(d => d.utilization > 0);

  const avgUtilization6m = utilizationData.length === 0 ? 0
    : Math.round(utilizationData.reduce((s, d) => s + d.utilization, 0) / utilizationData.length);

  // ─── Revenue by client (top 5) ────────────────────────────────────────────
  const revenueByClient = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of ganttRentals) {
      if (r.client && r.amount > 0) {
        map.set(r.client, (map.get(r.client) ?? 0) + r.amount);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([clientFull, revenue]) => ({
        clientFull,
        client: clientFull.length > 14 ? clientFull.substring(0, 12) + '…' : clientFull,
        revenue,
      }));
  }, [ganttRentals]);

  // ─── Downtime reasons — active service tickets grouped by status ──────────
  const downtimeData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tickets) {
      if (t.status === 'closed') continue;
      counts[t.status] = (counts[t.status] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([status, count], i) => ({
        reason: TICKET_STATUS_LABELS[status] ?? status,
        count,
        color: TICKET_STATUS_COLORS[status] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
      }))
      .sort((a, b) => b.count - a.count);
  }, [tickets]);

  // ─── Fleet structure ──────────────────────────────────────────────────────
  const fleetStats = useMemo(() => [
    { label: 'Ножничные', count: equipment.filter(e => e.type === 'scissor').length, colorClass: 'bg-blue-500' },
    { label: 'Коленчатые', count: equipment.filter(e => e.type === 'articulated').length, colorClass: 'bg-green-500' },
    { label: 'Телескопические', count: equipment.filter(e => e.type === 'telescopic').length, colorClass: 'bg-purple-500' },
  ], [equipment]);

  // ─── tooltip styles (dark-mode compatible via CSS vars) ───────────────────
  const tooltipStyle = {
    backgroundColor: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    color: 'var(--foreground)',
    fontSize: '13px',
  };
  const axisTickStyle = { fill: 'var(--muted-foreground)', fontSize: 12 };

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Отчёты</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Аналитика и управленческие отчёты
        </p>
      </div>

      <Tabs.Root defaultValue="analytics" className="space-y-6">
        <Tabs.List className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {[
            { value: 'analytics', label: 'Аналитика' },
            { value: 'managers',  label: 'По менеджерам' },
          ].map(tab => (
            <Tabs.Trigger
              key={tab.value}
              value={tab.value}
              className="border-b-2 border-transparent px-5 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 data-[state=active]:border-[--color-primary] data-[state=active]:text-[--color-primary] transition-colors"
            >
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* ── Analytics tab ───────────────────────────────────────────────── */}
        <Tabs.Content value="analytics" className="space-y-4 sm:space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Аналитика и статистика работы системы
          </p>
          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
            Обновлено: {formatTs(loadedAt)}&nbsp;·&nbsp;{minutesAgo(loadedAt)}&nbsp;·&nbsp;
            <span className="text-green-600 dark:text-green-400">реальные данные системы</span>
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={refresh}
          disabled={isRefreshing}
          className="self-start"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Обновление…' : 'Обновить данные'}
        </Button>
      </div>

      {/* ── KPI cards ───────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5" /> Всего техники
            </CardDescription>
            <CardTitle className="text-3xl">{totalEquipment}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {totalEquipment === 0
                ? 'Техника не добавлена'
                : `В аренде: ${rentedEquipment} · Свободно: ${equipment.filter(e => e.status === 'available').length}`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <BarChart2 className="h-3.5 w-3.5" /> Активные аренды
            </CardDescription>
            <CardTitle className="text-3xl">{activeRentals}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {activeRentals === 0 ? 'Нет активных аренд' : `Всего в системе: ${ganttRentals.length}`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Wrench className="h-3.5 w-3.5" /> Сервисных заявок
            </CardDescription>
            <CardTitle className="text-3xl">{openTickets}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {openTickets === 0
                ? 'Нет открытых заявок'
                : `В работе: ${inProgressTickets} · Ожидание: ${tickets.filter(t => t.status === 'waiting_parts').length}`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" /> Текущая утилизация
            </CardDescription>
            <CardTitle className="text-3xl">
              {utilization === null ? '—' : `${utilization}%`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {utilization === null
                ? 'Нет данных для расчёта'
                : `Ср. за 6 мес: ${avgUtilization6m}%`}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Charts ──────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">

        {/* Utilization by month */}
        <Card>
          <CardHeader>
            <CardTitle>Утилизация парка по месяцам</CardTitle>
            <CardDescription>
              Процент техники в аренде · последние 6 месяцев
              {hasUtilizationData && ` · ср. ${avgUtilization6m}%`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasUtilizationData ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={utilizationData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                  <XAxis dataKey="month" tick={axisTickStyle} />
                  <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={axisTickStyle} />
                  <Tooltip
                    formatter={(v: number) => [`${v}%`, 'Утилизация']}
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: 'var(--foreground)', fontWeight: 600 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="utilization"
                    stroke="#1e40af"
                    strokeWidth={2.5}
                    dot={{ fill: '#1e40af', r: 4, strokeWidth: 0 }}
                    activeDot={{ r: 6 }}
                    name="Утилизация (%)"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Нет данных для графика. Создайте первые аренды, чтобы появилась статистика утилизации." />
            )}
          </CardContent>
        </Card>

        {/* Revenue by client */}
        <Card>
          <CardHeader>
            <CardTitle>Выручка по клиентам</CardTitle>
            <CardDescription>
              {revenueByClient.length > 0
                ? `Топ-${revenueByClient.length} клиентов по объёму выручки`
                : 'Топ клиентов по объёму выручки'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {revenueByClient.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={revenueByClient} margin={{ top: 5, right: 20, left: -10, bottom: 65 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                  <XAxis
                    dataKey="client"
                    angle={-35}
                    textAnchor="end"
                    tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                    interval={0}
                  />
                  <YAxis
                    tickFormatter={(v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}М` : v >= 1000 ? `${Math.round(v / 1000)}к` : String(v)}
                    tick={axisTickStyle}
                  />
                  <Tooltip
                    formatter={(value: number, _name: string, props: { payload?: { clientFull?: string } }) => [
                      formatCurrency(value),
                      props.payload?.clientFull ?? 'Клиент',
                    ]}
                    contentStyle={tooltipStyle}
                    labelStyle={{ display: 'none' }}
                  />
                  <Bar dataKey="revenue" fill="#1e40af" radius={[4, 4, 0, 0]} name="Выручка" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Нет данных по выручке. Создайте аренды с указанием суммы." />
            )}
          </CardContent>
        </Card>

        {/* Downtime reasons */}
        <Card>
          <CardHeader>
            <CardTitle>Причины простоя техники</CardTitle>
            <CardDescription>
              {downtimeData.length > 0
                ? `Активные сервисные заявки по статусам · всего ${openTickets}`
                : 'Активные сервисные заявки по статусам'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {downtimeData.length > 0 ? (
              <div className="flex items-center gap-4">
                <div className="w-[45%] flex-shrink-0">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={downtimeData}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        dataKey="count"
                        label={({ value }: { value: number }) => value}
                        labelLine={false}
                      >
                        {downtimeData.map((entry, i) => (
                          <Cell key={`cell-${i}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, _name: string, props: { payload?: { reason?: string } }) => [
                          value,
                          props.payload?.reason ?? '',
                        ]}
                        contentStyle={tooltipStyle}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-2.5">
                  {downtimeData.map((item, i) => (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="h-3 w-3 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{item.reason}</span>
                      </div>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white flex-shrink-0">
                        {item.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyChart message="Нет активных сервисных заявок." />
            )}
          </CardContent>
        </Card>

        {/* Fleet structure */}
        <Card>
          <CardHeader>
            <CardTitle>Структура парка по типам</CardTitle>
            <CardDescription>
              {totalEquipment > 0
                ? `Распределение ${totalEquipment} единиц техники по типам`
                : 'Распределение техники по типам подъёмников'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {totalEquipment > 0 ? (
              <div className="space-y-5 pt-1">
                {fleetStats.map(item => (
                  <div key={item.label}>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="text-gray-700 dark:text-gray-300">{item.label}</span>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {item.count} ед.
                        {totalEquipment > 0 && (
                          <span className="ml-1 font-normal text-gray-400 dark:text-gray-500 text-xs">
                            ({Math.round((item.count / totalEquipment) * 100)}%)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-gray-100 dark:bg-gray-700">
                      <div
                        className={`h-2.5 rounded-full transition-all duration-500 ${item.colorClass}`}
                        style={{ width: item.count === 0 ? '0%' : `${Math.max(3, Math.round((item.count / totalEquipment) * 100))}%` }}
                      />
                    </div>
                  </div>
                ))}
                <p className="border-t border-gray-100 pt-2 text-xs text-gray-400 dark:border-gray-700 dark:text-gray-500">
                  Активных: {activeEquipment} · В аренде: {rentedEquipment} · В сервисе: {equipment.filter(e => e.status === 'in_service').length} · Списано: {equipment.filter(e => e.status === 'inactive').length}
                </p>
              </div>
            ) : (
              <EmptyChart message="Техника не добавлена в систему." />
            )}
          </CardContent>
        </Card>
      </div>

        </Tabs.Content>

        {/* ── Managers report tab ─────────────────────────────────────────── */}
        <Tabs.Content value="managers">
          <ManagerReport />
        </Tabs.Content>

      </Tabs.Root>
    </div>
  );
}
