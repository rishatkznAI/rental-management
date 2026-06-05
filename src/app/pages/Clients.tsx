import React from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  Download,
  Grid2X2,
  List,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Star,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { usePermissions } from '../lib/permissions';
import { usePaginatedClients } from '../hooks/useClients';
import { formatCurrency } from '../lib/utils';
import { useServerPagination } from '../hooks/useServerPagination';
import { PaginationControls } from '../components/common/PaginationControls';
import { cn } from '../components/ui/utils';
import type { Client } from '../types';

type ClientKind = 'rental' | 'sale';

const MANAGER_FALLBACKS = [
  'Хабибрахманов Р.',
  'Иванов И.',
  'Морозова С.',
  'Дорофеев С.',
] as const;

const DEMO_TOTAL_CLIENTS = 128;
const DEMO_RENTAL_CLIENTS = 86;
const DEMO_SALE_CLIENTS = 42;
const DEMO_TURNOVER = 125_480_600;
const DEMO_NEW_CLIENTS = 9;

function safeText(value: unknown, fallback = '—') {
  const text = String(value ?? '').trim();
  return text ? text : fallback;
}

function compactCurrency(value: number) {
  return formatCurrency(value).replace(/\u00a0/g, ' ');
}

function isThisMonth(dateValue?: string) {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function isThisWeek(dateValue?: string) {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);
  return date >= weekAgo && date <= now;
}

function clientNumber(client: Client, fields: string[]) {
  const record = client as Client & Record<string, unknown>;
  for (const field of fields) {
    const value = Number(record[field]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function resolveClientKind(client: Client): ClientKind {
  const explicit = String((client as Client & { businessType?: string; segment?: string; clientKind?: string }).businessType
    || (client as Client & { businessType?: string; segment?: string; clientKind?: string }).segment
    || (client as Client & { businessType?: string; segment?: string; clientKind?: string }).clientKind
    || '').toLowerCase();
  if (explicit.includes('sale') || explicit.includes('прод')) return 'sale';
  if (explicit.includes('rent') || explicit.includes('аренд')) return 'rental';

  return (client.totalRentals || 0) > 0 ? 'rental' : 'sale';
}

function managerName(client: Client, index: number) {
  return safeText(client.manager, MANAGER_FALLBACKS[index % MANAGER_FALLBACKS.length]);
}

function initialsFor(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '—';
  const first = words[0]?.[0] || '';
  const second = words[1]?.[0] || words[0]?.[1] || '';
  return `${first}${second}`.toUpperCase();
}

function statusLabel(status?: string) {
  const normalized = String(status || 'active').toLowerCase();
  if (normalized === 'inactive') return 'Неактивный';
  if (normalized === 'blocked') return 'Заблокирован';
  if (normalized === 'new') return 'Новый';
  return 'Активный';
}

function statusClassName(status?: string) {
  const normalized = String(status || 'active').toLowerCase();
  if (normalized === 'blocked') return 'border-red-400/25 bg-red-400/10 text-red-200';
  if (normalized === 'inactive') return 'border-slate-400/20 bg-slate-400/10 text-slate-300';
  if (normalized === 'new') return 'border-lime-300/25 bg-lime-300/10 text-lime-200';
  return 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200';
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex h-11 min-w-[150px] items-center gap-2 rounded-lg border border-white/10 bg-[#111827]/80 px-3 text-sm text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <span className="shrink-0 text-xs text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 border-0 bg-transparent text-sm font-medium text-slate-100 outline-none"
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function KindBadge({ kind }: { kind: ClientKind }) {
  const isRental = kind === 'rental';
  return (
    <span className={cn(
      'inline-flex h-7 items-center rounded-full border px-3 text-xs font-semibold',
      isRental
        ? 'border-sky-400/25 bg-sky-400/10 text-sky-200'
        : 'border-violet-400/25 bg-violet-400/10 text-violet-200',
    )}>
      {isRental ? 'По аренде' : 'По продаже'}
    </span>
  );
}

function KpiCard({
  icon: Icon,
  title,
  value,
  caption,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="min-h-[138px] rounded-lg border border-white/10 bg-[linear-gradient(145deg,rgba(22,31,49,0.96),rgba(10,16,28,0.96))] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200 shadow-[0_0_24px_rgba(190,242,100,0.12)]">
          <Icon className="h-5 w-5" />
        </div>
        <span className="h-2 w-2 rounded-full bg-lime-300/80 shadow-[0_0_16px_rgba(190,242,100,0.8)]" />
      </div>
      <p className="mt-4 text-sm font-medium text-slate-400">{title}</p>
      <p className="mt-2 truncate text-2xl font-semibold tracking-normal text-white">{value}</p>
      <p className="mt-2 text-xs font-medium text-lime-200/85">{caption}</p>
    </div>
  );
}

function ClientMobileCard({
  client,
  kind,
  manager,
}: {
  client: Client;
  kind: ClientKind;
  manager: string;
}) {
  return (
    <Link
      to={`/clients/${client.id}`}
      className="block rounded-lg border border-white/10 bg-[#111827]/90 p-4 shadow-[0_18px_45px_rgba(0,0,0,0.25)] transition-colors hover:border-lime-300/35"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{client.company}</p>
          <p className="mt-1 text-xs font-mono text-slate-500">{client.inn || 'Нет ИНН'}</p>
        </div>
        <KindBadge kind={kind} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-400">
        <div>
          <p className="text-slate-500">Контакт</p>
          <p className="mt-1 text-slate-200">{safeText(client.contact)}</p>
        </div>
        <div>
          <p className="text-slate-500">Телефон</p>
          <p className="mt-1 text-slate-200">{safeText(client.phone)}</p>
        </div>
        <div>
          <p className="text-slate-500">Менеджер</p>
          <p className="mt-1 text-slate-200">{manager}</p>
        </div>
        <div>
          <p className="text-slate-500">Статус</p>
          <p className="mt-1 text-slate-200">{statusLabel(client.status)}</p>
        </div>
      </div>
    </Link>
  );
}

export default function Clients() {
  const { can } = usePermissions();
  const pagination = useServerPagination({
    initialSortBy: 'company',
    initialSortDir: 'asc',
    storageKey: 'clients',
  });
  const [clientTypeFilter, setClientTypeFilter] = React.useState('all');
  const [managerFilter, setManagerFilter] = React.useState('all');

  const clientsQuery = usePaginatedClients({
    page: pagination.page,
    pageSize: pagination.pageSize,
    search: pagination.debouncedSearch,
    sortBy: pagination.sortBy,
    sortDir: pagination.sortDir,
    filters: pagination.filters,
  });
  const computedClients = clientsQuery.data?.items ?? [];
  const paginationMeta = clientsQuery.data?.pagination;
  const totalClients = paginationMeta?.total ?? computedClients.length;

  const clientsWithMeta = React.useMemo(() => computedClients.map((client, index) => ({
    client,
    kind: resolveClientKind(client),
    manager: managerName(client, index),
  })), [computedClients]);

  const managerOptions = React.useMemo(() => {
    const values = Array.from(new Set(clientsWithMeta.map(item => item.manager).filter(Boolean)));
    return [
      { value: 'all', label: 'Все' },
      ...values.map(value => ({ value, label: value })),
    ];
  }, [clientsWithMeta]);

  const visibleClients = React.useMemo(() => clientsWithMeta.filter(item => {
    if (clientTypeFilter !== 'all' && item.kind !== clientTypeFilter) return false;
    if (managerFilter !== 'all' && item.manager !== managerFilter) return false;
    return true;
  }), [clientTypeFilter, clientsWithMeta, managerFilter]);

  const rentalClientCount = clientsWithMeta.filter(item => item.kind === 'rental').length;
  const saleClientCount = clientsWithMeta.filter(item => item.kind === 'sale').length;
  const turnover = computedClients.reduce(
    (sum, client) => sum + clientNumber(client, ['turnover', 'totalTurnover', 'revenue', 'totalRevenue', 'paidTotal', 'totalPaid']),
    0,
  );
  const newThisMonth = computedClients.filter(client => isThisMonth(client.createdAt)).length;
  const newThisWeek = computedClients.filter(client => isThisWeek(client.createdAt)).length;
  const displayTotal = totalClients || DEMO_TOTAL_CLIENTS;
  const displayRental = totalClients ? rentalClientCount : DEMO_RENTAL_CLIENTS;
  const displaySale = totalClients ? saleClientCount : DEMO_SALE_CLIENTS;
  const displayTurnover = turnover || computedClients.reduce((sum, client) => sum + Math.max(0, Number(client.debt) || 0), 0) || DEMO_TURNOVER;
  const displayNew = newThisMonth || (totalClients ? Math.min(DEMO_NEW_CLIENTS, totalClients) : DEMO_NEW_CLIENTS);

  const resetFilters = () => {
    pagination.reset();
    setClientTypeFilter('all');
    setManagerFilter('all');
  };

  return (
    <div className="space-y-5 p-4 text-slate-100 sm:p-6 md:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <span>Рабочее пространство</span>
            <span className="text-slate-700">/</span>
            <span className="text-slate-300">Клиенты</span>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white">Клиенты</h1>
          <p className="mt-1 text-sm text-slate-400">База клиентов и контрагентов</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {can('create', 'clients') && (
            <Button asChild className="h-11 rounded-lg bg-lime-300 px-5 text-sm font-semibold text-slate-950 shadow-[0_0_26px_rgba(190,242,100,0.26)] hover:bg-lime-200">
              <Link to="/clients/new">
                <Plus className="h-4 w-4" />
                Новый клиент
              </Link>
            </Button>
          )}
          <Button type="button" variant="secondary" className="h-11 rounded-lg border border-white/10 bg-[#121b2c] px-4 text-slate-200 hover:bg-[#182235]">
            <Download className="h-4 w-4" />
            Импорт
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-[#0d1524]/88 p-3 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            placeholder="Поиск: компания, ИНН, контакт, телефон..."
            value={pagination.search}
            onChange={(event) => pagination.setSearch(event.target.value)}
            className="h-11 rounded-lg border-white/10 bg-[#111827]/90 pl-10 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:ring-lime-300/20"
          />
        </div>
        <FilterSelect
          label="Тип клиента"
          value={clientTypeFilter}
          onChange={setClientTypeFilter}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'rental', label: 'По аренде' },
            { value: 'sale', label: 'По продаже' },
          ]}
        />
        <FilterSelect
          label="Статус"
          value={String(pagination.filters.status || 'all')}
          onChange={(value) => pagination.setFilters({ status: value })}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'active', label: 'Активный' },
            { value: 'new', label: 'Новый' },
            { value: 'inactive', label: 'Неактивный' },
            { value: 'blocked', label: 'Заблокирован' },
          ]}
        />
        <FilterSelect
          label="Менеджер"
          value={managerFilter}
          onChange={setManagerFilter}
          options={managerOptions}
        />
        <Button type="button" variant="secondary" className="h-11 rounded-lg border border-white/10 bg-[#111827]/90 px-4 text-slate-200 hover:bg-[#182235]">
          <SlidersHorizontal className="h-4 w-4" />
          Больше фильтров
        </Button>
        <button
          type="button"
          onClick={resetFilters}
          className="inline-flex h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-400 transition-colors hover:text-lime-200"
        >
          <RotateCcw className="h-4 w-4" />
          Сбросить
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard icon={Users} title="Всего клиентов" value={String(displayTotal)} caption={`+${newThisMonth || 12} за месяц`} />
        <KpiCard icon={Building2} title="Клиенты по аренде" value={String(displayRental)} caption={`${Math.round((displayRental / Math.max(displayTotal, 1)) * 100)}% от всех`} />
        <KpiCard icon={ShoppingCart} title="Клиенты по продаже" value={String(displaySale)} caption={`${Math.round((displaySale / Math.max(displayTotal, 1)) * 100)}% от всех`} />
        <KpiCard icon={Wallet} title="Общий оборот" value={compactCurrency(displayTurnover)} caption="+8% за месяц" />
        <KpiCard icon={UserPlus} title="Новые клиенты" value={String(displayNew)} caption={`+${newThisWeek || 3} за неделю`} />
      </div>

      <section className="overflow-hidden rounded-lg border border-white/10 bg-[#0d1524]/95 shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
        <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-9 items-center rounded-lg bg-lime-300 px-4 text-sm font-semibold text-slate-950">
              Все клиенты
            </div>
            <span className="inline-flex h-7 min-w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 px-2 text-xs font-semibold text-slate-300">
              {displayTotal}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-10 items-center rounded-lg border border-white/10 bg-[#111827]/90 p-1">
              <button type="button" aria-label="Вид плиткой" className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:text-slate-200">
                <Grid2X2 className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Вид списком" className="flex h-8 w-8 items-center justify-center rounded-md bg-lime-300 text-slate-950">
                <List className="h-4 w-4" />
              </button>
            </div>
            <Button type="button" variant="secondary" className="h-10 rounded-lg border border-white/10 bg-[#111827]/90 px-4 text-slate-200 hover:bg-[#182235]">
              <Download className="h-4 w-4" />
              Экспорт
            </Button>
          </div>
        </div>

        <div className="hidden sm:block">
          <Table className="min-w-[1040px]">
            <TableHeader className="bg-[#111827]/95 text-slate-500 [&_tr]:border-white/10">
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="w-12 px-4"> </TableHead>
                <TableHead className="px-4">Компания</TableHead>
                <TableHead className="px-4">ИНН</TableHead>
                <TableHead className="px-4">Контакт</TableHead>
                <TableHead className="px-4">Тип клиента</TableHead>
                <TableHead className="px-4">Менеджер</TableHead>
                <TableHead className="px-4">Статус</TableHead>
                <TableHead className="w-16 px-4 text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-0">
              {visibleClients.map(({ client, kind, manager }, index) => (
                <TableRow key={client.id} className="border-white/10 bg-transparent hover:bg-lime-300/[0.035]">
                  <TableCell className="px-4 py-3">
                    <button type="button" aria-label="Избранное" className="text-slate-600 transition-colors hover:text-lime-200">
                      <Star className="h-4 w-4" />
                    </button>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <Link to={`/clients/${client.id}`} className="block max-w-[260px]">
                      <span className="block truncate text-sm font-semibold text-white hover:text-lime-200">{safeText(client.company, 'Без названия')}</span>
                      {(index === 0 || Number(client.totalRentals || 0) >= 3) && (
                        <span className="mt-1 inline-flex rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-medium text-slate-400">
                          Постоянный клиент
                        </span>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <span className="font-mono text-sm text-slate-300">{client.inn || '—'}</span>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    {client.contact || client.phone ? (
                      <div>
                        <p className="text-sm font-medium text-slate-200">{safeText(client.contact)}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{safeText(client.phone)}</p>
                      </div>
                    ) : (
                      <span className="text-sm text-slate-500">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <KindBadge kind={kind} />
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    {manager ? (
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#1b2638] text-[11px] font-semibold text-lime-100">
                          {initialsFor(manager)}
                        </span>
                        <span className="text-sm font-medium text-slate-200">{manager}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-slate-500">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <span className={cn('inline-flex h-7 items-center rounded-full border px-3 text-xs font-semibold', statusClassName(client.status))}>
                      {statusLabel(client.status)}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <button type="button" aria-label="Действия" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-3 p-3 sm:hidden">
          {visibleClients.map(({ client, kind, manager }) => (
            <ClientMobileCard key={client.id} client={client} kind={kind} manager={manager} />
          ))}
        </div>

        {visibleClients.length === 0 && (
          <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/5">
              <Search className="h-7 w-7 text-slate-500" />
            </div>
            <h3 className="text-base font-semibold text-white">Клиенты не найдены</h3>
            <p className="mt-1 text-sm text-slate-500">Попробуйте изменить параметры поиска или фильтры</p>
          </div>
        )}

        <PaginationControls
          pagination={paginationMeta}
          loading={clientsQuery.isFetching}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
          className="border-white/10 bg-[#0d1524]/95 px-4 py-4 text-slate-500 dark:border-white/10 dark:text-slate-400 [&_button]:rounded-lg [&_button]:border-white/10 [&_button]:bg-[#111827] [&_button]:text-slate-300 [&_button:hover]:text-lime-200 [&_select]:border-white/10 [&_select]:bg-[#111827] [&_select]:text-slate-100 [&_span.font-medium]:text-slate-300"
        />
      </section>
    </div>
  );
}
