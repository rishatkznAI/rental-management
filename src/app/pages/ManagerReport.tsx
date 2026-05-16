import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
import {
  Download, ChevronDown, ChevronUp, RefreshCw,
  Users, BarChart2, CreditCard, FileCheck, FileX,
  ArrowUpDown, ArrowUp, ArrowDown, Filter, X,
} from 'lucide-react';
import { formatCurrency } from '../lib/utils';
import { reportsService } from '../services/reports.service';
import { PaginationControls } from '../components/common/PaginationControls';
import {
  buildManagerReportXLS,
  formatManagerReportDate,
} from '../lib/managerReport.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReportRow {
  rowId: string;
  rentalId: string;
  equipmentId: string;
  equipmentFilterKey: string;
  monthLabel: string;
  monthKey: string;
  allocationStartDate: string;
  allocationEndDate: string;
  allocationDays: number;
  manager: string;
  client: string;
  equipmentInv: string;
  equipmentType: string;
  equipmentLabel: string;
  equipmentName: string;
  startDate: string;
  endDate: string;
  amount: number;
  paymentStatus: 'paid' | 'partial' | 'unpaid';
  paymentLabel: string;
  paidAmount: number;
  debt: number;
  paidDate: string;
  updSigned: boolean;
  updDate: string;
  rentalStatus: string;
  rentalStatusLabel: string;
}

interface ManagerSummaryRow {
  manager: string;
  rentalsCount: number;
  clientsCount: number;
  totalAmount: number;
  paidAmount: number;
  debt: number;
  updSignedCount: number;
  updNotSignedCount: number;
}

interface Filters {
  dateFrom: string;
  dateTo: string;
  manager: string;
  client: string;
  paymentStatus: string;
  updStatus: string;
  rentalStatus: string;
  equipmentType: string;
  equipmentInv: string;
}

type SortKey = keyof ReportRow;
type SortDir = 'asc' | 'desc';
const DEFAULT_PAGE_SIZE = 25;

const EMPTY_FILTERS: Filters = {
  dateFrom: '', dateTo: '', manager: 'all', client: 'all',
  paymentStatus: 'all', updStatus: 'all', rentalStatus: 'all',
  equipmentType: 'all', equipmentInv: 'all',
};

// ── Excel (SpreadsheetML .xls) ────────────────────────────────────────────────

function downloadXLS(content: string, filename: string) {
  const blob = new Blob(['\ufeff', content], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── Badge helpers ─────────────────────────────────────────────────────────────

type BV = 'success' | 'warning' | 'danger' | 'info' | 'default';

function payBadge(status: string): BV {
  if (status === 'paid')    return 'success';
  if (status === 'partial') return 'warning';
  return 'danger';
}

function rentalBadge(status: string): BV {
  if (status === 'active')   return 'info';
  if (status === 'returned') return 'default';
  if (status === 'closed')   return 'default';
  return 'default';
}

// ── Summary Table ─────────────────────────────────────────────────────────────

function SummaryTable({
  summary,
  onSelectManager,
}: {
  summary: ManagerSummaryRow[];
  onSelectManager: (m: string) => void;
}) {
  const totalAmount  = summary.reduce((s, r) => s + r.totalAmount, 0);
  const totalPaid    = summary.reduce((s, r) => s + r.paidAmount, 0);
  const totalDebt    = summary.reduce((s, r) => s + r.debt, 0);
  const totalRentals = summary.reduce((s, r) => s + r.rentalsCount, 0);

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
            <BarChart2 className="h-3.5 w-3.5" /> Всего аренд
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{totalRentals}</p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
            <CreditCard className="h-3.5 w-3.5" /> Сумма аренд
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(totalAmount)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
            <FileCheck className="h-3.5 w-3.5" /> Оплачено
          </p>
          <p className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">{formatCurrency(totalPaid)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
            <FileX className="h-3.5 w-3.5" /> Дебиторка
          </p>
          <p className="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">{formatCurrency(totalDebt)}</p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                {['Менеджер','Аренд','Клиентов','Сумма аренд','Оплачено','Дебиторка','УПД ✓','УПД ✗',''].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {summary.map(row => (
                <tr key={row.manager} className="bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-white whitespace-nowrap">
                    {row.manager}
                  </td>
                  <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300 tabular-nums">{row.rentalsCount}</td>
                  <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300 tabular-nums">{row.clientsCount}</td>
                  <td className="px-3 py-2.5 text-gray-900 dark:text-white font-semibold tabular-nums whitespace-nowrap">
                    {formatCurrency(row.totalAmount)}
                  </td>
                  <td className="px-3 py-2.5 text-green-700 dark:text-green-400 font-semibold tabular-nums whitespace-nowrap">
                    {formatCurrency(row.paidAmount)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">
                    <span className={row.debt > 0 ? 'font-semibold text-red-600 dark:text-red-400' : 'text-gray-400'}>
                      {row.debt > 0 ? formatCurrency(row.debt) : '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-green-700 dark:text-green-400 tabular-nums">{row.updSignedCount}</td>
                  <td className="px-3 py-2.5 tabular-nums">
                    <span className={row.updNotSignedCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}>
                      {row.updNotSignedCount}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => onSelectManager(row.manager)}
                      className="text-xs text-[--color-primary] hover:underline whitespace-nowrap"
                    >
                      Детализация →
                    </button>
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="bg-gray-50 dark:bg-gray-900/50 font-semibold border-t-2 border-gray-300 dark:border-gray-600">
                <td className="px-3 py-2.5 text-gray-900 dark:text-white">Итого</td>
                <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300 tabular-nums">{totalRentals}</td>
                <td className="px-3 py-2.5 text-gray-400">—</td>
                <td className="px-3 py-2.5 text-gray-900 dark:text-white tabular-nums whitespace-nowrap">
                  {formatCurrency(totalAmount)}
                </td>
                <td className="px-3 py-2.5 text-green-700 dark:text-green-400 tabular-nums whitespace-nowrap">
                  {formatCurrency(totalPaid)}
                </td>
                <td className="px-3 py-2.5 text-red-600 dark:text-red-400 tabular-nums whitespace-nowrap">
                  {formatCurrency(totalDebt)}
                </td>
                <td className="px-3 py-2.5 text-green-700 dark:text-green-400 tabular-nums">
                  {summary.reduce((s, r) => s + r.updSignedCount, 0)}
                </td>
                <td className="px-3 py-2.5 text-amber-600 dark:text-amber-400 tabular-nums">
                  {summary.reduce((s, r) => s + r.updNotSignedCount, 0)}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Detail Table ──────────────────────────────────────────────────────────────

function DetailTable({
  rows,
  sortKey,
  sortDir,
  onSort,
}: {
  rows: ReportRow[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Group by manager
  const grouped = useMemo(() => {
    const map = new Map<string, ReportRow[]>();
    for (const r of rows) {
      const list = map.get(r.manager) ?? [];
      list.push(r);
      map.set(r.manager, list);
    }
    return [...map.entries()];
  }, [rows]);

  const toggleManager = (m: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m); else next.add(m);
      return next;
    });
  };
  const expandAll   = () => setExpanded(new Set(grouped.map(([m]) => m)));
  const collapseAll = () => setExpanded(new Set());
  const allExpanded = grouped.length > 0 && grouped.every(([m]) => expanded.has(m));

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === 'asc'
      ? <ArrowUp className="h-3 w-3 text-[--color-primary]" />
      : <ArrowDown className="h-3 w-3 text-[--color-primary]" />;
  };

  const th = (label: string, key?: SortKey, extra = '') => (
    <th
      className={`px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap ${key ? 'cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 select-none' : ''} ${extra}`}
      onClick={key ? () => onSort(key) : undefined}
    >
      <span className="flex items-center gap-1">
        {label}
        {key && <SortIcon k={key} />}
      </span>
    </th>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 justify-end">
        <button onClick={allExpanded ? collapseAll : expandAll}
          className="text-xs text-[--color-primary] hover:underline">
          {allExpanded ? 'Свернуть всё' : 'Развернуть всё'}
        </button>
      </div>

      {grouped.length === 0 ? (
        <EmptyState message="Нет данных для отображения по выбранным фильтрам." />
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {grouped.map(([manager, mRows]) => {
            const isOpen = expanded.has(manager);
            const rentalsCount = new Set(mRows.map(row => row.rentalId)).size;
            const totalAmt    = mRows.reduce((s, r) => s + r.amount, 0);
            const totalPaid   = mRows.reduce((s, r) => s + r.paidAmount, 0);
            const totalDebt   = mRows.reduce((s, r) => s + r.debt, 0);
            const updSigned   = mRows.filter(r => r.updSigned).length;
            const updUnsigned = mRows.filter(r => !r.updSigned).length;

            return (
              <div key={manager} className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
                {/* Group header */}
                <button
                  onClick={() => toggleManager(manager)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-900/50 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    {isOpen
                      ? <ChevronUp className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      : <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />}
                    <Users className="h-4 w-4 text-[--color-primary] flex-shrink-0" />
                    <span className="font-semibold text-gray-900 dark:text-white text-sm">{manager}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {rentalsCount} аренд · {mRows.length} начислений · {formatCurrency(totalAmt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                    <span className="text-green-600 dark:text-green-400">
                      ✓ {formatCurrency(totalPaid)}
                    </span>
                    {totalDebt > 0 && (
                      <span className="text-red-600 dark:text-red-400">
                        Долг {formatCurrency(totalDebt)}
                      </span>
                    )}
                    <span>УПД: {updSigned}/{updSigned + updUnsigned}</span>
                  </div>
                </button>

                {/* Rows */}
                {isOpen && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                        <tr>
                          {th('Месяц',          'monthKey')}
                          {th('Клиент',         'client')}
                          {th('INV',            'equipmentInv')}
                          {th('Тип техники',    'equipmentLabel')}
                          {th('Период аренды')}
                          {th('Сумма',          'amount')}
                          {th('Оплата',         'paymentStatus')}
                          {th('Оплачено',       'paidAmount')}
                          {th('Дебиторка',      'debt')}
                          {th('Дата оплаты')}
                          {th('УПД',            'updSigned')}
                          {th('Дата УПД')}
                          {th('Статус',         'rentalStatus')}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                        {mRows.map(row => (
                          <tr key={row.rowId}
                            className="bg-white dark:bg-gray-800 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-colors">
                            <td className="px-3 py-2 whitespace-nowrap text-gray-700 dark:text-gray-300">{row.monthLabel}</td>
                            <td className="px-3 py-2 max-w-[180px] truncate text-gray-900 dark:text-white font-medium" title={row.client}>{row.client}</td>
                            <td className="px-3 py-2 font-mono text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.equipmentInv}</td>
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{row.equipmentLabel}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400 text-xs">
                              {formatManagerReportDate(row.startDate)} — {formatManagerReportDate(row.endDate)}
                            </td>
                            <td className="px-3 py-2 font-semibold tabular-nums whitespace-nowrap text-gray-900 dark:text-white">
                              {formatCurrency(row.amount)}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <Badge variant={payBadge(row.paymentStatus)} className="text-xs">
                                {row.paymentLabel}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 tabular-nums whitespace-nowrap text-green-700 dark:text-green-400">
                              {row.paidAmount > 0 ? formatCurrency(row.paidAmount) : '—'}
                            </td>
                            <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                              {row.debt > 0
                                ? <span className="text-red-600 dark:text-red-400 font-medium">{formatCurrency(row.debt)}</span>
                                : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-3 py-2 text-xs whitespace-nowrap text-gray-600 dark:text-gray-400">
                              {row.paidDate ? formatManagerReportDate(row.paidDate) : '—'}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {row.updSigned
                                ? <span className="text-green-600 dark:text-green-400 text-xs font-medium">✓ Подписан</span>
                                : <span className="text-amber-600 dark:text-amber-400 text-xs">✗ Нет</span>}
                            </td>
                            <td className="px-3 py-2 text-xs whitespace-nowrap text-gray-600 dark:text-gray-400">
                              {row.updDate ? formatManagerReportDate(row.updDate) : '—'}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <Badge variant={rentalBadge(row.rentalStatus)} className="text-xs">
                                {row.rentalStatusLabel}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                        {/* Per-manager subtotal */}
                        <tr className="bg-gray-50 dark:bg-gray-900/30 border-t border-gray-200 dark:border-gray-600 font-semibold text-xs">
                          <td className="px-3 py-2 text-gray-500 dark:text-gray-400" colSpan={5}>
                            Итого по {manager}
                          </td>
                          <td className="px-3 py-2 tabular-nums whitespace-nowrap text-gray-900 dark:text-white">
                            {formatCurrency(totalAmt)}
                          </td>
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2 tabular-nums whitespace-nowrap text-green-700 dark:text-green-400">
                            {formatCurrency(totalPaid)}
                          </td>
                          <td className="px-3 py-2 tabular-nums whitespace-nowrap text-red-600 dark:text-red-400">
                            {totalDebt > 0 ? formatCurrency(totalDebt) : '—'}
                          </td>
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2 text-green-600 dark:text-green-400">
                            УПД: {updSigned}/{updSigned + updUnsigned}
                          </td>
                          <td colSpan={2} />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
        <BarChart2 className="h-7 w-7 text-gray-400 dark:text-gray-500" />
      </div>
      <p className="max-w-[280px] text-sm text-gray-500 dark:text-gray-400">{message}</p>
    </div>
  );
}

// ── Filter Bar ────────────────────────────────────────────────────────────────

function sel(
  value: string,
  onChange: (v: string) => void,
  placeholder: string,
  options: { value: string; label: string }[],
  className = 'w-[160px]',
) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`${className} dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm h-9`}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map(o => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ManagerReport() {
  const queryClient = useQueryClient();
  // ── Data state ─────────────────────────────────────────────────────────────
  const [isRefreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState(Date.now);

  // ── Filters ────────────────────────────────────────────────────────────────
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [view, setView] = useState<'summary' | 'detail'>('summary');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortKey, setSortKey] = useState<SortKey>('monthKey');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const managerParams = useMemo(() => ({
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    pageSize,
    sortBy: sortKey,
    sortDir,
    filters: {
      manager: filters.manager,
      client: filters.client,
      paymentStatus: filters.paymentStatus,
      updStatus: filters.updStatus,
      rentalStatus: filters.rentalStatus,
      equipmentType: filters.equipmentType,
      equipmentInv: filters.equipmentInv,
    },
  }), [filters, pageSize, sortDir, sortKey]);

  const { data: managerSummary, isFetching: summaryFetching } = useQuery({
    queryKey: ['reports', 'managers', 'summary', managerParams],
    queryFn: () => reportsService.getManagerSummary(managerParams),
    placeholderData: previous => previous,
  });

  const { data: managerDetails, isFetching: detailFetching } = useQuery({
    queryKey: ['reports', 'managers', 'details', managerParams, page],
    queryFn: () => reportsService.getManagerDetails('accruals', { ...managerParams, page }),
    placeholderData: previous => previous,
  });

  const refresh = useCallback(() => {
    setRefreshing(true);
    queryClient.invalidateQueries({ queryKey: ['reports', 'managers'] }).finally(() => {
      setLoadedAt(Date.now());
      setRefreshing(false);
    });
  }, [queryClient]);

  const setF = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setFilters(f => ({ ...f, [k]: v }));

  const resetFilters = () => setFilters(EMPTY_FILTERS);

  useEffect(() => {
    setPage(1);
  }, [filters, pageSize]);

  const hasActiveFilters = Object.entries(filters).some(([k, v]) => {
    if (k === 'dateFrom' || k === 'dateTo') return v !== '';
    return v !== 'all';
  });

  // ── Derived option lists ───────────────────────────────────────────────────
  const managerOptions = useMemo(() => {
    return [
      { value: 'all', label: 'Все менеджеры' },
      ...(managerSummary?.options?.managers ?? []).map(m => ({ value: m, label: m })),
    ];
  }, [managerSummary]);

  const clientOptions = useMemo(() => {
    return [
      { value: 'all', label: 'Все клиенты' },
      ...(managerSummary?.options?.clients ?? []).map(c => ({ value: c, label: c.length > 30 ? c.slice(0, 28) + '…' : c })),
    ];
  }, [managerSummary]);

  const invOptions = useMemo(() => {
    return [
      { value: 'all', label: 'Вся техника (INV)' },
      ...(managerSummary?.options?.equipment ?? []),
    ];
  }, [managerSummary]);

  const summary = (managerSummary?.summary ?? []) as ManagerSummaryRow[];
  const filteredRows = (managerDetails?.items ?? []) as ReportRow[];
  const totals = managerSummary?.totals ?? managerDetails?.summary ?? {};
  const filteredRentalsCount = Number(totals.rentalsCount ?? 0);

  // ── Period label for XLS ───────────────────────────────────────────────────
  const periodLabel = useMemo(() => {
    if (filters.dateFrom && filters.dateTo)
      return `${formatManagerReportDate(filters.dateFrom)} — ${formatManagerReportDate(filters.dateTo)}`;
    if (filters.dateFrom) return `с ${formatManagerReportDate(filters.dateFrom)}`;
    if (filters.dateTo)   return `по ${formatManagerReportDate(filters.dateTo)}`;
    return 'за выбранный период';
  }, [filters]);

  // ── Drill-down: click "Детализация →" in summary ───────────────────────────
  const drillToManager = (manager: string) => {
    setF('manager', manager);
    setView('detail');
  };

  const handleSort = (key: SortKey) => {
    setPage(1);
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  // ── Timestamp display ──────────────────────────────────────────────────────
  const fmtTs = (ts: number) => {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  // ── Export ─────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    const exportData = await reportsService.getManagerExport(managerParams);
    const content  = buildManagerReportXLS(exportData.summary as ManagerSummaryRow[], exportData.rows as ReportRow[], periodLabel);
    const dateTag  = new Date().toISOString().slice(0, 10);
    downloadXLS(content, `report-managers-${dateTag}.xls`);
  };

  return (
    <div className="space-y-5">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Отчёт по менеджерам</h2>
          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
            Обновлено: {fmtTs(loadedAt)} ·{' '}
            {filteredRentalsCount} аренд · {Number(totals.accrualsCount ?? 0)} начислений · {summary.length} менеджеров ·{' '}
            <span className="text-green-600 dark:text-green-400">реальные данные</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={refresh} disabled={isRefreshing}>
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Обновление…' : 'Обновить'}
          </Button>
          <Button
            size="sm"
            onClick={handleExport}
            disabled={summaryFetching || detailFetching || Number(totals.accrualsCount ?? 0) === 0}
            className="flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Выгрузить в Excel
          </Button>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Filter className="h-4 w-4" /> Фильтры
              {hasActiveFilters && (
                <Badge variant="info" className="text-xs">{
                  Object.entries(filters).filter(([k, v]) =>
                    (k === 'dateFrom' || k === 'dateTo') ? v !== '' : v !== 'all'
                  ).length
                } активных</Badge>
              )}
            </CardTitle>
            {hasActiveFilters && (
              <button onClick={resetFilters} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
                <X className="h-3 w-3" /> Сбросить
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {/* Dates */}
            <div className="flex items-center gap-1">
              <label className="text-xs text-gray-500 whitespace-nowrap">С:</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={e => setF('dateFrom', e.target.value)}
                className="h-9 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[--color-primary]"
              />
            </div>
            <div className="flex items-center gap-1">
              <label className="text-xs text-gray-500 whitespace-nowrap">По:</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={e => setF('dateTo', e.target.value)}
                className="h-9 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[--color-primary]"
              />
            </div>

            {sel(filters.manager, v => setF('manager', v), 'Менеджер', managerOptions)}
            {sel(filters.client,  v => setF('client',  v), 'Клиент',   clientOptions,  'w-[200px]')}

            {sel(filters.paymentStatus, v => setF('paymentStatus', v), 'Статус оплаты', [
              { value: 'all',     label: 'Все оплаты' },
              { value: 'paid',    label: 'Оплачено' },
              { value: 'partial', label: 'Частично' },
              { value: 'unpaid',  label: 'Не оплачено' },
            ])}

            {sel(filters.updStatus, v => setF('updStatus', v), 'УПД', [
              { value: 'all',      label: 'Все УПД' },
              { value: 'signed',   label: 'УПД подписан' },
              { value: 'unsigned', label: 'УПД не подписан' },
            ])}

            {sel(filters.rentalStatus, v => setF('rentalStatus', v), 'Статус аренды', [
              { value: 'all',      label: 'Все статусы' },
              { value: 'created',  label: 'Бронь' },
              { value: 'active',   label: 'Активна' },
              { value: 'returned', label: 'Возвращена' },
              { value: 'closed',   label: 'Закрыта' },
            ])}

            {sel(filters.equipmentType, v => setF('equipmentType', v), 'Тип техники', [
              { value: 'all',         label: 'Все типы' },
              { value: 'scissor',     label: 'Ножничный' },
              { value: 'articulated', label: 'Коленчатый' },
              { value: 'telescopic',  label: 'Телескопический' },
            ])}

            {sel(filters.equipmentInv, v => setF('equipmentInv', v), 'INV техники', invOptions)}
          </div>
        </CardContent>
      </Card>

      {/* ── View toggle ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
        <button
          onClick={() => setView('summary')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            view === 'summary'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          Сводно по менеджерам
        </button>
        <button
          onClick={() => setView('detail')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            view === 'detail'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          Детализация по арендам
        </button>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      {summaryFetching && !managerSummary ? (
        <EmptyState message="Загружаем отчёт по менеджерам." />
      ) : Number(totals.accrualsCount ?? 0) === 0 && !hasActiveFilters ? (
        <EmptyState message="Аренды не найдены. Создайте первые аренды через планировщик или «Новая аренда»." />
      ) : Number(totals.accrualsCount ?? 0) === 0 ? (
        <EmptyState message="Нет данных по выбранным фильтрам. Попробуйте изменить период или снять часть фильтров." />
      ) : view === 'summary' ? (
        <SummaryTable summary={summary} onSelectManager={drillToManager} />
      ) : (
        <>
          <DetailTable rows={filteredRows} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
          <PaginationControls
            pagination={managerDetails?.pagination}
            loading={detailFetching}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </>
      )}
    </div>
  );
}
