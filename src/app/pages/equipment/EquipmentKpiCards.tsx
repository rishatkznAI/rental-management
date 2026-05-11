import type { LucideIcon } from 'lucide-react';

export type EquipmentKpiTone = 'neutral' | 'available' | 'rented' | 'service' | 'sale' | 'sold';

export type EquipmentKpiCardConfig = {
  title: string;
  value: number;
  caption: string;
  icon: LucideIcon;
  tone: EquipmentKpiTone;
  percent?: number;
};

const EQUIPMENT_KPI_TONE_STYLES: Record<EquipmentKpiTone, {
  card: string;
  icon: string;
  value: string;
  progress: string;
}> = {
  neutral: {
    card: 'border-blue-200/70 bg-blue-50/35 dark:border-blue-900/45 dark:bg-blue-950/12',
    icon: 'bg-blue-100 text-blue-700 ring-blue-500/10 dark:bg-blue-500/14 dark:text-blue-300 dark:ring-blue-300/10',
    value: 'text-blue-950 dark:text-blue-50',
    progress: 'bg-blue-500 dark:bg-blue-400',
  },
  available: {
    card: 'border-emerald-200/80 bg-emerald-50/45 dark:border-emerald-900/55 dark:bg-emerald-950/18',
    icon: 'bg-emerald-100 text-emerald-700 ring-emerald-500/10 dark:bg-emerald-500/14 dark:text-emerald-300 dark:ring-emerald-300/10',
    value: 'text-emerald-950 dark:text-emerald-50',
    progress: 'bg-emerald-500 dark:bg-emerald-400',
  },
  rented: {
    card: 'border-blue-200/80 bg-blue-50/45 dark:border-blue-900/55 dark:bg-blue-950/18',
    icon: 'bg-blue-100 text-blue-700 ring-blue-500/10 dark:bg-blue-500/14 dark:text-blue-300 dark:ring-blue-300/10',
    value: 'text-blue-950 dark:text-blue-50',
    progress: 'bg-blue-500 dark:bg-blue-400',
  },
  service: {
    card: 'border-orange-200/85 bg-orange-50/45 dark:border-orange-900/55 dark:bg-orange-950/18',
    icon: 'bg-orange-100 text-orange-700 ring-orange-500/10 dark:bg-orange-500/14 dark:text-orange-300 dark:ring-orange-300/10',
    value: 'text-orange-950 dark:text-orange-50',
    progress: 'bg-orange-500 dark:bg-orange-400',
  },
  sale: {
    card: 'border-violet-200/80 bg-violet-50/45 dark:border-violet-900/55 dark:bg-violet-950/18',
    icon: 'bg-violet-100 text-violet-700 ring-violet-500/10 dark:bg-violet-500/14 dark:text-violet-300 dark:ring-violet-300/10',
    value: 'text-violet-950 dark:text-violet-50',
    progress: 'bg-violet-500 dark:bg-violet-400',
  },
  sold: {
    card: 'border-slate-200/85 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/35',
    icon: 'bg-slate-100 text-slate-700 ring-slate-500/10 dark:bg-slate-500/14 dark:text-slate-300 dark:ring-slate-300/10',
    value: 'text-slate-950 dark:text-slate-50',
    progress: 'bg-slate-500 dark:bg-slate-400',
  },
};

function formatKpiCount(value: number) {
  return value.toLocaleString('ru-RU');
}

function EquipmentKpiCard({
  title,
  value,
  caption,
  icon: Icon,
  tone,
  percent,
}: EquipmentKpiCardConfig) {
  const toneStyle = EQUIPMENT_KPI_TONE_STYLES[tone];
  const hasPercent = typeof percent === 'number' && Number.isFinite(percent);

  return (
    <div className={`group flex min-h-[136px] min-w-0 flex-col justify-between rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md ${toneStyle.card}`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-muted-foreground">{title}</div>
          <div className={`mt-3 text-3xl font-extrabold leading-none tracking-normal ${toneStyle.value}`}>
            {formatKpiCount(value)}
          </div>
        </div>
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ${toneStyle.icon}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>

      <div className="mt-4 min-w-0">
        <div className="flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
          <span className="truncate">{caption}</span>
          {hasPercent ? <span className="shrink-0 tabular-nums">{percent}%</span> : null}
        </div>
        {hasPercent ? (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border/70">
            <div className={`h-full rounded-full ${toneStyle.progress}`} style={{ width: `${percent}%` }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

type EquipmentKpiCardsProps = {
  cards: EquipmentKpiCardConfig[];
};

export function EquipmentKpiCards({ cards }: EquipmentKpiCardsProps) {
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {cards.map((card) => (
        <EquipmentKpiCard key={card.title} {...card} />
      ))}
    </div>
  );
}
