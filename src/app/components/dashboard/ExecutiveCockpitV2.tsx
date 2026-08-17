import React from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  Wrench,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { cn } from '../ui/utils';

export type ExecutiveTone = 'default' | 'success' | 'warning' | 'danger' | 'info';
export type ExecutiveDataState = 'ready' | 'empty' | 'partial' | 'loading' | 'error' | 'stale';

export type ExecutiveKpi = {
  id: string;
  label: string;
  value: string;
  context: string;
  trend?: string;
  trendLabel?: string;
  forecast?: string;
  tone: ExecutiveTone;
  href: string;
  state?: ExecutiveDataState;
};

export type ExecutiveAttentionSignal = {
  id: string;
  severity: 'critical' | 'high' | 'medium';
  title: string;
  scale: string;
  moneyImpact?: string;
  context: string;
  href: string;
  action: string;
};

export type ExecutiveMonthPoint = {
  label: string;
  revenue: number | null;
  payments: number | null;
  forecast: number | null;
};

export type ExecutiveHealthDirection = {
  id: string;
  label: string;
  score: number | null;
  stateLabel: string;
  href: string;
};

export type ExecutiveFleetRow = {
  label: string;
  value: number;
  color: string;
};

export type ExecutiveAgingRow = {
  label: string;
  amount: number;
};

export type ExecutiveDebtor = {
  id: string;
  name: string;
  amount: string;
  age: string;
  href: string;
};

export type ExecutiveServiceRisk = {
  id: string;
  name: string;
  context: string;
  moneyImpact?: string;
  href: string;
};

export type ExecutiveSalesStage = {
  label: string;
  value: number;
};

export type ExecutiveCockpitV2Props = {
  contextLabel: string;
  periodLabel: string;
  periodRange: string;
  updatedLabel: string;
  healthBadge: string;
  healthTone: ExecutiveTone;
  dataStatus?: string;
  kpis: ExecutiveKpi[];
  attention: ExecutiveAttentionSignal[];
  attentionState: ExecutiveDataState;
  month: {
    points: ExecutiveMonthPoint[];
    state: ExecutiveDataState;
    plan: string;
    fact: string;
    forecast: string;
    explanation: string;
  };
  health: {
    score: number | null;
    label: string;
    coverage: string;
    primaryRisk: string;
    directions: ExecutiveHealthDirection[];
    explanation: string;
  };
  fleet: {
    state: ExecutiveDataState;
    utilization: string;
    context: string;
    delta: string;
    rows: ExecutiveFleetRow[];
    total: number;
    potentialLoss?: string;
    potentialLossNote?: string;
  };
  money: {
    state: ExecutiveDataState;
    totalDebt: string;
    overdue: string;
    over30: string;
    aging: ExecutiveAgingRow[];
    topDebtors: ExecutiveDebtor[];
    href: string;
  };
  service: {
    state: ExecutiveDataState;
    inRepair: string;
    readyToRent: string;
    slaBreaches: string;
    averageDays: string;
    risks: ExecutiveServiceRisk[];
    href: string;
  };
  sales?: {
    state: ExecutiveDataState;
    pipeline: string;
    forecast: string;
    activeDeals: string;
    conversion: string;
    forecastNote: string;
    stages: ExecutiveSalesStage[];
    href: string;
  };
  recentChanges?: {
    state: ExecutiveDataState;
    items: Array<{ id: string; label: string; value: string; href: string }>;
  };
};

const toneClasses: Record<ExecutiveTone, string> = {
  default: 'border-l-border-l-border',
  success: 'border-l-success text-success-foreground',
  warning: 'border-l-warning text-warning-foreground',
  danger: 'border-l-danger text-danger-foreground',
  info: 'border-l-info text-info-foreground',
};

const severityMeta = {
  critical: { label: 'Критично', className: 'border-danger/35 bg-danger-soft text-danger-foreground' },
  high: { label: 'Важно', className: 'border-warning/35 bg-warning-soft text-warning-foreground' },
  medium: { label: 'Контроль', className: 'border-info/35 bg-info-soft text-info-foreground' },
};

function formatCompactMoney(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`;
  if (absolute >= 1_000) return `${Math.round(value / 1_000).toLocaleString('ru-RU')} тыс.`;
  return value.toLocaleString('ru-RU');
}

function OperationalState({ state, empty, partial }: { state: ExecutiveDataState; empty: string; partial?: string }) {
  if (state === 'loading') return <p className="text-sm text-muted-foreground" role="status">Обновляем данные…</p>;
  if (state === 'error') return <p className="text-sm text-danger-foreground" role="alert">Не удалось загрузить данные блока</p>;
  if (state === 'partial') return <p className="text-sm text-warning-foreground">{partial || 'Недостаточно данных для полного расчёта'}</p>;
  if (state === 'stale') return <p className="text-sm text-warning-foreground">Данные могли устареть; ожидается обновление</p>;
  if (state === 'empty') return <p className="text-sm text-muted-foreground">{empty}</p>;
  return <p className="text-sm text-muted-foreground">{empty}</p>;
}

function SectionHeader({ eyebrow, title, href }: { eyebrow?: string; title: string; href?: string }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{eyebrow}</p> : null}
        <h2 className="app-shell-title mt-0.5 text-base font-semibold text-foreground">{title}</h2>
      </div>
      {href ? (
        <Link to={href} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          Открыть <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

function ExecutiveKpiStrip({ kpis }: { kpis: ExecutiveKpi[] }) {
  return (
    <section className="executive-v2-kpis order-2 col-span-12 xl:order-1" data-testid="dashboard-top-cockpit" aria-label="Ключевые показатели">
      <div className="grid overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-2 xl:grid-cols-4" data-testid="dashboard-executive-cockpit">
        {kpis.map((kpi) => (
          <Link
            key={kpi.id}
            to={kpi.href}
            data-testid={kpi.id}
            className={cn(
              'rentcore-command-kpi group min-h-[126px] border-b border-l-2 border-border p-3.5 transition last:border-b-0 hover:bg-accent/35 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0',
              toneClasses[kpi.tone],
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-muted-foreground">{kpi.label}</p>
                <p className="dashboard-kpi-value mt-1.5 truncate text-[25px] font-black leading-none tracking-[-0.03em] text-foreground" title={kpi.value}>{kpi.value}</p>
              </div>
              {kpi.state === 'partial' ? <Badge variant="warning">частично</Badge> : null}
              {kpi.state === 'stale' ? <Badge variant="warning">устарело</Badge> : null}
              {kpi.state === 'error' ? <Badge variant="danger">ошибка</Badge> : null}
            </div>
            <p className="mt-2 line-clamp-1 text-xs font-semibold text-foreground/80">{kpi.context}</p>
            <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="truncate">{kpi.trend ? `${kpi.trend}${kpi.trendLabel ? ` · ${kpi.trendLabel}` : ''}` : kpi.trendLabel || 'Без базы сравнения'}</span>
              {kpi.forecast ? <span className="shrink-0 font-semibold text-foreground">{kpi.forecast}</span> : null}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function AttentionPanel({ signals, state }: { signals: ExecutiveAttentionSignal[]; state: ExecutiveDataState }) {
  return (
    <Card className="executive-v2-attention order-1 col-span-12 gap-0 overflow-hidden border-danger/25 lg:col-span-6 xl:order-2 xl:col-span-5" data-testid="dashboard-key-signals">
      <CardHeader className="border-b border-border bg-danger-soft/35 px-4 pb-3 pt-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-danger-foreground/80">Состояние → влияние → действие</p>
            <CardTitle className="mt-1 flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-danger-foreground" />
              Требует внимания
            </CardTitle>
          </div>
          <Badge variant={signals.length > 0 ? 'danger' : 'success'}>{signals.length > 0 ? signals.length : 'OK'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5 px-3 py-3" data-testid="dashboard-legacy-attention-list">
        {signals.length === 0 ? (
          <div className="rounded-md border border-success/25 bg-success-soft px-3 py-3 text-sm text-success-foreground">
            <OperationalState state={state} empty="Критичных отклонений по доступным данным нет" />
          </div>
        ) : signals.slice(0, 5).map((signal) => {
          const severity = severityMeta[signal.severity];
          return (
            <Link key={signal.id} to={signal.href} className="group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-md border border-border bg-background px-3 py-2.5 transition hover:border-primary/35 hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <span className="min-w-0">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className={cn('rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase', severity.className)}>{severity.label}</span>
                  <span className="min-w-0 truncate text-xs font-extrabold text-foreground">{signal.title}</span>
                </span>
                <span className="mt-1 block text-sm font-bold text-foreground">{signal.scale}</span>
                {signal.moneyImpact ? <span className="mt-0.5 block text-xs font-semibold text-danger-foreground">{signal.moneyImpact}</span> : null}
                <span className="mt-0.5 block line-clamp-1 text-xs text-muted-foreground">{signal.context}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end justify-between text-[10px] font-semibold text-muted-foreground">
                <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                <span>{signal.action}</span>
              </span>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}

function MonthDynamics({ month }: Pick<ExecutiveCockpitV2Props, 'month'>) {
  const hasChart = month.points.some(point => Number(point.revenue) > 0 || Number(point.payments) > 0 || Number(point.forecast) > 0);
  return (
    <Card className="executive-v2-month order-3 col-span-12 gap-0 overflow-hidden lg:col-span-6 xl:col-span-7" data-testid="dashboard-month-dynamics">
      <CardHeader className="px-4 pb-2 pt-3.5">
        <SectionHeader eyebrow="Направление бизнеса" title="Динамика месяца" />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-semibold text-muted-foreground" aria-label="Легенда графика">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" />Начисления</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-info" />Поступления</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 bg-warning" />Прогноз</span>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <div className="h-[210px] min-w-0 sm:h-[225px]">
          {hasChart ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={month.points} margin={{ top: 8, right: 6, bottom: 0, left: -8 }}>
                <defs>
                  <linearGradient id="executiveRevenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.24} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--rc-border)" strokeDasharray="2 7" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={12} tick={{ fill: 'var(--rc-text-muted)', fontSize: 10 }} />
                <YAxis axisLine={false} tickLine={false} width={46} tickFormatter={formatCompactMoney} tick={{ fill: 'var(--rc-text-muted)', fontSize: 10 }} />
                <Tooltip formatter={(value, name) => [`${Number(value).toLocaleString('ru-RU')} ₽`, name === 'payments' ? 'Поступления' : name === 'forecast' ? 'Прогноз начислений' : 'Начисления']} contentStyle={{ borderRadius: 8, borderColor: 'var(--rc-border)', background: 'var(--rc-surface-elevated)', color: 'var(--foreground)' }} />
                <Area type="monotone" dataKey="revenue" stroke="var(--primary)" strokeWidth={2.2} fill="url(#executiveRevenueFill)" connectNulls={false} dot={false} />
                <Line type="monotone" dataKey="payments" stroke="var(--info)" strokeWidth={2} dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="forecast" stroke="var(--warning)" strokeWidth={1.8} strokeDasharray="5 5" dot={false} connectNulls={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border bg-background px-4 text-center">
              <OperationalState state={month.state} empty="За выбранный период начислений и поступлений нет" partial="Недостаточно данных, чтобы построить динамику" />
            </div>
          )}
        </div>
        <div className="mt-2 grid grid-cols-3 divide-x divide-border rounded-md border border-border bg-background py-2 text-center">
          {[['План', month.plan], ['Факт', month.fact], ['Прогноз', month.forecast]].map(([label, value]) => (
            <div key={label} className="min-w-0 px-2">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p>
              <p className="mt-0.5 truncate text-sm font-extrabold text-foreground" title={value}>{value}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">{month.explanation}</p>
      </CardContent>
    </Card>
  );
}

function CompactHealth({ health }: Pick<ExecutiveCockpitV2Props, 'health'>) {
  return (
    <Card className="executive-v2-health order-7 col-span-12 gap-0 overflow-hidden xl:order-4" data-testid="dashboard-company-health">
      <CardContent className="grid gap-3 px-4 py-3.5 xl:grid-cols-[220px_minmax(0,1fr)_minmax(220px,0.7fr)] xl:items-center">
        <div data-testid="dashboard-company-health-score">
          <SectionHeader eyebrow="Executive summary" title="Здоровье компании" />
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black tracking-[-0.04em] text-foreground">{health.score === null ? '—' : health.score}</span>
            <span className="text-sm font-semibold text-muted-foreground">/ 100</span>
          </div>
          <p className="mt-1 text-xs font-semibold text-foreground" data-testid="dashboard-company-health-status">{health.label}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground" data-testid="dashboard-company-health-coverage">{health.coverage}</p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 xl:grid-cols-6" data-testid="dashboard-company-health-directions">
          {health.directions.map(direction => (
            <Link key={direction.id} to={direction.href} className="group min-w-0 rounded-md border border-border bg-background px-2.5 py-2 transition hover:border-primary/35" title={direction.stateLabel}>
              <div className="flex items-center justify-between gap-2 text-[10px] font-semibold text-muted-foreground">
                <span className="truncate">{direction.label}</span>
                <span className="font-black text-foreground">{direction.score === null ? '—' : direction.score}</span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${direction.score ?? 0}%` }} />
              </div>
            </Link>
          ))}
        </div>
        <div className="rounded-md border border-warning/25 bg-warning-soft px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warning-foreground/80">Главный риск</p>
          <p className="mt-1 text-sm font-bold text-foreground">{health.primaryRisk}</p>
          <details className="mt-1.5 text-[10px] text-muted-foreground">
            <summary className="cursor-pointer font-semibold text-foreground">Как рассчитано</summary>
            <p className="mt-1 leading-4">{health.explanation}</p>
          </details>
        </div>
      </CardContent>
    </Card>
  );
}

function FleetEconomics({ fleet }: Pick<ExecutiveCockpitV2Props, 'fleet'>) {
  return (
    <Card className="executive-v2-fleet order-5 col-span-12 gap-0 lg:col-span-6 xl:order-5 xl:col-span-4" data-testid="dashboard-fleet-utilization">
      <CardHeader className="px-4 pb-2 pt-3.5"><SectionHeader eyebrow="Экономика актива" title="Парк" href="/equipment" /></CardHeader>
      <CardContent className="px-4 pb-3.5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-3xl font-black tracking-[-0.04em] text-foreground">{fleet.utilization}</p>
            <p className="text-xs font-semibold text-muted-foreground">Utilization</p>
          </div>
          <div className="text-right text-xs">
            <p className="font-bold text-foreground">{fleet.context}</p>
            <p className="mt-0.5 text-muted-foreground">{fleet.delta}</p>
          </div>
        </div>
        {fleet.state === 'ready' || fleet.state === 'partial' || fleet.state === 'stale' ? (
          <div className="mt-3 space-y-2">
            {fleet.rows.map(row => (
              <div key={row.label} className="grid grid-cols-[82px_minmax(0,1fr)_28px] items-center gap-2 text-[11px]">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, (row.value / Math.max(1, fleet.total)) * 100)}%`, background: row.color }} /></span>
                <span className="text-right font-bold text-foreground">{row.value}</span>
              </div>
            ))}
          </div>
        ) : <div className="mt-3"><OperationalState state={fleet.state} empty="Активный парк не сформирован" /></div>}
        <div className="mt-3 rounded-md border border-border bg-background px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Потенциал свободного парка</p>
          <p className="mt-0.5 text-sm font-extrabold text-foreground">{fleet.potentialLoss || 'Недостаточно данных'}</p>
          {fleet.potentialLossNote ? <p className="mt-0.5 text-[10px] text-muted-foreground">{fleet.potentialLossNote}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function MoneyPanel({ money }: Pick<ExecutiveCockpitV2Props, 'money'>) {
  const agingTotal = money.aging.reduce((sum, row) => sum + row.amount, 0);
  return (
    <Card className="executive-v2-money order-4 col-span-12 gap-0 lg:col-span-6 xl:order-6 xl:col-span-4" data-testid="dashboard-receivables-aging">
      <CardHeader className="px-4 pb-2 pt-3.5"><SectionHeader eyebrow="Cash & receivables" title="Деньги" href={money.href} /></CardHeader>
      <CardContent className="px-4 pb-3.5">
        <div className="grid grid-cols-3 divide-x divide-border rounded-md border border-border bg-background py-2">
          {[['Дебиторка', money.totalDebt], ['Просрочено', money.overdue], ['>30 дней', money.over30]].map(([label, value]) => (
            <div key={label} className="min-w-0 px-2">
              <p className="text-[9px] font-semibold uppercase text-muted-foreground">{label}</p>
              <p className="mt-0.5 truncate text-xs font-extrabold text-foreground" title={value}>{value}</p>
            </div>
          ))}
        </div>
        {agingTotal > 0 ? (
          <div className="mt-3">
            <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-label="Возраст дебиторки">
              {money.aging.map((row, index) => (
                <span key={row.label} className={cn('h-full', index === 0 ? 'bg-info' : index === 1 ? 'bg-warning' : index === 2 ? 'bg-[color:var(--chart-3)]' : 'bg-danger')} style={{ width: `${(row.amount / agingTotal) * 100}%` }} />
              ))}
            </div>
            <div className="mt-1.5 grid grid-cols-4 gap-1 text-center text-[9px] text-muted-foreground">
              {money.aging.map(row => <span key={row.label}>{row.label}<b className="ml-1 text-foreground">{formatCompactMoney(row.amount)}</b></span>)}
            </div>
          </div>
        ) : <div className="mt-3"><OperationalState state={money.state} empty="Просроченной дебиторки нет" partial="Недостаточно данных по срокам задолженности" /></div>}
        <div className="mt-3 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Крупнейшие должники</p>
          {money.topDebtors.length === 0 ? <p className="text-xs text-muted-foreground">{money.state === 'ready' || money.state === 'empty' || money.state === 'stale' ? 'Канонические должники с долгом не найдены' : 'Список должников недоступен при текущем покрытии данных'}</p> : money.topDebtors.slice(0, 3).map(debtor => (
            <Link key={debtor.id} to={debtor.href} className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 transition hover:border-primary/35">
              <span className="min-w-0 truncate text-xs font-semibold text-foreground">{debtor.name}</span>
              <span className="shrink-0 text-right text-[10px] text-muted-foreground"><b className="text-foreground">{debtor.amount}</b> · {debtor.age}</span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ServicePanel({ service }: Pick<ExecutiveCockpitV2Props, 'service'>) {
  return (
    <Card className="executive-v2-service order-6 col-span-12 gap-0 lg:col-span-6 xl:order-7 xl:col-span-4" data-testid="dashboard-service-executive">
      <CardHeader className="px-4 pb-2 pt-3.5"><SectionHeader eyebrow="Надёжность парка" title="Сервис" href={service.href} /></CardHeader>
      <CardContent className="px-4 pb-3.5">
        <div className="grid grid-cols-2 gap-2">
          {[
            ['В ремонте', service.inRepair],
            ['Ready-to-Rent', service.readyToRent],
            ['SLA нарушено', service.slaBreaches],
            ['Средний цикл', service.averageDays],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-border bg-background px-2.5 py-2">
              <p className="text-[10px] text-muted-foreground">{label}</p>
              <p className="mt-0.5 text-lg font-black text-foreground">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1.5">
          {service.risks.length === 0 ? <OperationalState state={service.state} empty="Критичных сервисных ситуаций нет" partial="Часть сервисных данных недоступна" /> : service.risks.slice(0, 3).map(risk => (
            <Link key={risk.id} to={risk.href} className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2 transition hover:border-primary/35">
              <Wrench className="h-3.5 w-3.5 shrink-0 text-warning-foreground" />
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-foreground">{risk.name}</span><span className="block truncate text-[10px] text-muted-foreground">{risk.context}</span></span>
              {risk.moneyImpact ? <span className="shrink-0 text-[10px] font-semibold text-danger-foreground">{risk.moneyImpact}</span> : null}
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SalesPanel({ sales }: { sales: NonNullable<ExecutiveCockpitV2Props['sales']> }) {
  const maxStage = Math.max(1, ...sales.stages.map(stage => stage.value));
  return (
    <Card className="executive-v2-sales order-8 col-span-12 gap-0 lg:col-span-6 xl:order-8 xl:col-span-8" data-testid="dashboard-sales-executive">
      <CardHeader className="px-4 pb-2 pt-3.5"><SectionHeader eyebrow="Opportunity-centric CRM" title="Продажи" href={sales.href} /></CardHeader>
      <CardContent className="grid gap-3 px-4 pb-3.5 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="grid grid-cols-2 gap-2">
          {[
            ['Pipeline', sales.pipeline], ['Forecast', sales.forecast], ['Активные сделки', sales.activeDeals], ['Конверсия', sales.conversion],
          ].map(([label, value]) => <div key={label} className="rounded-md border border-border bg-background px-2.5 py-2"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-0.5 text-base font-black text-foreground">{value}</p></div>)}
        </div>
        <div>
          <div className="grid grid-cols-4 gap-2">
            {sales.stages.map(stage => (
              <div key={stage.label} className="min-w-0 text-center">
                <div className="flex h-20 items-end justify-center rounded-md bg-background px-2 pb-2">
                  <span className="w-full rounded-sm bg-primary/75" style={{ height: `${Math.max(8, (stage.value / maxStage) * 100)}%` }} />
                </div>
                <p className="mt-1 truncate text-[10px] text-muted-foreground">{stage.label}</p>
                <p className="text-sm font-black text-foreground">{stage.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">{sales.forecastNote}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function RecentChanges({ recentChanges }: { recentChanges: NonNullable<ExecutiveCockpitV2Props['recentChanges']> }) {
  return (
    <Card className="executive-v2-recent order-9 col-span-12 gap-0 lg:col-span-6 xl:order-9 xl:col-span-4" data-testid="dashboard-since-last-visit">
      <CardHeader className="px-4 pb-2 pt-3.5"><SectionHeader eyebrow="Изменения бизнеса" title="С момента последнего входа" /></CardHeader>
      <CardContent className="space-y-1.5 px-4 pb-3.5">
        {recentChanges.items.map(item => <Link key={item.id} to={item.href} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-xs"><span className="truncate text-muted-foreground">{item.label}</span><b className="shrink-0 text-foreground">{item.value}</b></Link>)}
      </CardContent>
    </Card>
  );
}

export function ExecutiveCockpitV2(props: ExecutiveCockpitV2Props) {
  return (
    <div className="rentcore-command-screen min-w-0" data-testid="dashboard-executive-v2">
      <div className="mx-auto w-full max-w-[1760px] space-y-3 px-3 py-3 sm:px-4 lg:px-5">
        <header className="executive-v2-header flex min-h-[68px] flex-col justify-between gap-3 rounded-lg border border-border bg-card/95 px-4 py-3 sm:flex-row sm:items-center" data-testid="dashboard-executive-header">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="app-shell-title text-xl font-semibold tracking-[-0.02em] text-foreground sm:text-2xl">Dashboard</h1>
              <span className="hidden h-1 w-1 rounded-full bg-border sm:block" />
              <p role="heading" aria-level={2} className="text-sm font-semibold text-muted-foreground">Операционный центр</p>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">{props.contextLabel} · {props.periodLabel} · {props.periodRange}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {props.dataStatus ? <Badge variant="warning">{props.dataStatus}</Badge> : null}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-semibold text-muted-foreground"><Clock3 className="h-3 w-3" />Обновлено {props.updatedLabel}</span>
            <Badge variant={props.healthTone === 'danger' ? 'danger' : props.healthTone === 'warning' ? 'warning' : props.healthTone === 'success' ? 'success' : 'default'}>{props.healthBadge}</Badge>
          </div>
        </header>

        <main className="grid min-w-0 grid-cols-12 gap-3" data-testid="dashboard-command-board">
          <AttentionPanel signals={props.attention} state={props.attentionState} />
          <ExecutiveKpiStrip kpis={props.kpis} />
          <MonthDynamics month={props.month} />
          <CompactHealth health={props.health} />
          <FleetEconomics fleet={props.fleet} />
          <MoneyPanel money={props.money} />
          <ServicePanel service={props.service} />
          {props.sales ? <SalesPanel sales={props.sales} /> : null}
          {props.recentChanges ? <RecentChanges recentChanges={props.recentChanges} /> : null}
        </main>
      </div>
    </div>
  );
}
