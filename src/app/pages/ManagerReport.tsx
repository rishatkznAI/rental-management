import React, { useMemo, useState, useCallback } from 'react';
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
import { type GanttRentalData } from '../mock-data';
import type { Equipment, Payment } from '../types';
import { formatCurrency } from '../lib/utils';
import { rentalsService } from '../services/rentals.service';
import { equipmentService } from '../services/equipment.service';
import { paymentsService } from '../services/payments.service';
import { RENTAL_KEYS } from '../hooks/useRentals';
import { EQUIPMENT_KEYS } from '../hooks/useEquipment';
import { PAYMENT_KEYS } from '../hooks/usePayments';

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
];

const EQ_TYPE_LABELS: Record<string, string> = {
  scissor: 'Ножничный',
  articulated: 'Коленчатый',
  telescopic: 'Телескопический',
};

const RENTAL_STATUS_LABELS: Record<string, string> = {
  created: 'Создана',
  active: 'Активна',
  returned: 'Возвращена',
  closed: 'Закрыта',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  paid: 'Оплачено',
  partial: 'Частично',
  unpaid: 'Не оплачено',
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReportRow {
  rentalId: string;
  monthLabel: string;
  monthKey: string;
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

const EMPTY_FILTERS: Filters = {
  dateFrom: '', dateTo: '', manager: 'all', client: 'all',
  paymentStatus: 'all', updStatus: 'all', rentalStatus: 'all',
  equipmentType: 'all', equipmentInv: 'all',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string): string {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`;
  } catch { return d; }
}

function buildRows(
  rentals: GanttRentalData[],
  equipmentList: Equipment[],
  payments: Payment[],
): ReportRow[] {
  const eqMap = new Map<string, Equipment>();
  for (const eq of equipmentList) eqMap.set(eq.inventoryNumber, eq);

  const paysByRental = new Map<string, Payment[]>();
  for (const p of payments) {
    if (p.rentalId) {
      const list = paysByRental.get(p.rentalId) ?? [];
      list.push(p);
      paysByRental.set(p.rentalId, list);
    }
  }

  return rentals.map(r => {
    const eq = eqMap.get(r.equipmentInv);
    const d = new Date(r.startDate);
    const valid = !isNaN(d.getTime());
    const monthKey = valid
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      : '9999-99';
    const monthLabel = valid
      ? `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
      : (r.startDate || '—');

    const related = paysByRental.get(r.id) ?? [];
    let paidAmount = related.reduce((sum, p) => {
      if (p.status === 'paid')    return sum + p.amount;
      if (p.status === 'partial') return sum + (p.paidAmount ?? 0);
      return sum;
    }, 0);
    let latestPaidDate = '';
    for (const p of related) {
      if (p.paidDate && p.paidDate > latestPaidDate) latestPaidDate = p.paidDate;
    }

    if (related.length === 0 && r.paymentStatus === 'paid') paidAmount = r.amount ?? 0;

    const debt = Math.max(0, (r.amount ?? 0) - paidAmount);

    let paymentStatus: 'paid' | 'partial' | 'unpaid';
    if (related.length > 0) {
      if (paidAmount >= (r.amount ?? 0))  paymentStatus = 'paid';
      else if (paidAmount > 0)            paymentStatus = 'partial';
      else                                paymentStatus = 'unpaid';
    } else {
      paymentStatus = r.paymentStatus ?? 'unpaid';
    }

    return {
      rentalId:        r.id,
      monthLabel,
      monthKey,
      manager:         r.manager     || '—',
      client:          r.client      || '—',
      equipmentInv:    r.equipmentInv || '—',
      equipmentType:   eq?.type      ?? '',
      equipmentLabel:  eq ? (EQ_TYPE_LABELS[eq.type] ?? eq.type) : '—',
      equipmentName:   eq ? `${eq.manufacturer} ${eq.model}` : (r.equipmentInv || '—'),
      startDate:       r.startDate,
      endDate:         r.endDate,
      amount:          r.amount ?? 0,
      paymentStatus,
      paymentLabel:    PAYMENT_STATUS_LABELS[paymentStatus] ?? paymentStatus,
      paidAmount,
      debt,
      paidDate:        latestPaidDate,
      updSigned:       r.updSigned,
      updDate:         r.updDate ?? '',
      rentalStatus:    r.status,
      rentalStatusLabel: RENTAL_STATUS_LABELS[r.status] ?? r.status,
    };
  });
}

function buildManagerSummary(rows: ReportRow[]): ManagerSummaryRow[] {
  const map = new Map<string, ManagerSummaryRow & { _clients: Set<string> }>();
  for (const row of rows) {
    if (!map.has(row.manager)) {
      map.set(row.manager, {
        manager: row.manager, rentalsCount: 0, clientsCount: 0,
        _clients: new Set(), totalAmount: 0, paidAmount: 0, debt: 0,
        updSignedCount: 0, updNotSignedCount: 0,
      });
    }
    const s = map.get(row.manager)!;
    s.rentalsCount++;
    s._clients.add(row.client);
    s.totalAmount  += row.amount;
    s.paidAmount   += row.paidAmount;
    s.debt         += row.debt;
    if (row.updSigned) s.updSignedCount++; else s.updNotSignedCount++;
  }
  return [...map.values()]
    .map(s => ({ ...s, clientsCount: s._clients.size }))
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

// ── Excel (SpreadsheetML .xls) ────────────────────────────────────────────────

function escXML(v: string | number | null | undefined): string {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function hCell(v: string): string {
  return `<Cell ss:StyleID="hdr"><Data ss:Type="String">${escXML(v)}</Data></Cell>`;
}
function dCell(v: string | number | null | undefined, num = false): string {
  return `<Cell><Data ss:Type="${num ? 'Number' : 'String'}">${escXML(v)}</Data></Cell>`;
}

function buildXLS(
  summary: ManagerSummaryRow[],
  detail: ReportRow[],
  periodLabel: string,
): string {
  const today = fmtDate(new Date().toISOString());

  const sumRows = summary.map(s => `<Row>
      ${dCell(s.manager)}${dCell(s.rentalsCount,true)}${dCell(s.clientsCount,true)}
      ${dCell(s.totalAmount,true)}${dCell(s.paidAmount,true)}${dCell(s.debt,true)}
      ${dCell(s.updSignedCount,true)}${dCell(s.updNotSignedCount,true)}
    </Row>`).join('\n');

  const totRent   = summary.reduce((a, r) => a + r.rentalsCount, 0);
  const totAmt    = summary.reduce((a, r) => a + r.totalAmount,  0);
  const totPaid   = summary.reduce((a, r) => a + r.paidAmount,   0);
  const totDebt   = summary.reduce((a, r) => a + r.debt,         0);
  const totSigned = summary.reduce((a, r) => a + r.updSignedCount, 0);
  const totUnsign = summary.reduce((a, r) => a + r.updNotSignedCount, 0);
  const totRow = `<Row ss:StyleID="total">
      ${dCell('ИТОГО')}${dCell(totRent,true)}${dCell('')}
      ${dCell(totAmt,true)}${dCell(totPaid,true)}${dCell(totDebt,true)}
      ${dCell(totSigned,true)}${dCell(totUnsign,true)}
    </Row>`;

  const detRows = detail.map(r => `<Row>
      ${dCell(r.monthLabel)}${dCell(r.manager)}${dCell(r.client)}
      ${dCell(r.equipmentInv)}${dCell(r.equipmentLabel)}${dCell(r.equipmentName)}
      ${dCell(fmtDate(r.startDate))}${dCell(fmtDate(r.endDate))}
      ${dCell(r.amount,true)}${dCell(r.paymentLabel)}
      ${dCell(r.paidAmount,true)}${dCell(r.debt,true)}
      ${dCell(r.paidDate ? fmtDate(r.paidDate) : '')}
      ${dCell(r.updSigned ? 'Да' : 'Нет')}${dCell(r.updDate ? fmtDate(r.updDate) : '')}
      ${dCell(r.rentalStatusLabel)}
    </Row>`).join('\n');

  const titleCell = (text: string, span: number) =>
    `<Cell ss:MergeAcross="${span - 1}" ss:StyleID="title"><Data ss:Type="String">${escXML(text)}</Data></Cell>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
  <Style ss:ID="hdr">
    <Font ss:Bold="1" ss:Color="#FFFFFF"/>
    <Interior ss:Color="#1E3A5F" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="total">
    <Font ss:Bold="1"/>
    <Interior ss:Color="#DCE6F1" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="title">
    <Font ss:Bold="1" ss:Size="12"/>
  </Style>
</Styles>
<Worksheet ss:Name="Сводно">
  <Table>
    <Row>${titleCell(`Отчёт по менеджерам · ${periodLabel} · Выгружен: ${today}`, 8)}</Row>
    <Row/>
    <Row>
      ${hCell('Менеджер')}${hCell('Аренд')}${hCell('Клиентов')}
      ${hCell('Сумма аренд, ₽')}${hCell('Оплачено, ₽')}${hCell('Дебиторка, ₽')}
      ${hCell('УПД подписано')}${hCell('УПД не подписано')}
    </Row>
    ${sumRows}
    ${totRow}
  </Table>
</Worksheet>
<Worksheet ss:Name="Детализация">
  <Table>
    <Row>${titleCell(`Детализация аренд · ${periodLabel} · Выгружен: ${today}`, 16)}</Row>
    <Row/>
    <Row>
      ${hCell('Месяц')}${hCell('Менеджер')}${hCell('Клиент')}
      ${hCell('INV')}${hCell('Тип техники')}${hCell('Техника')}
      ${hCell('Начало аренды')}${hCell('Окончание аренды')}
      ${hCell('Сумма аренды, ₽')}${hCell('Статус оплаты')}
      ${hCell('Оплачено, ₽')}${hCell('Дебиторка, ₽')}${hCell('Дата оплаты')}
      ${hCell('УПД подписано')}${hCell('Дата УПД')}${hCell('Статус аренды')}
    </Row>
    ${detRows}
  </Table>
</Worksheet>
</Workbook>`;
}

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

// ── Sort helper ───────────────────────────────────────────────────────────────

function sortRows(rows: ReportRow[], key: SortKey, dir: SortDir): ReportRow[] {
  return [...rows].sort((a, b) => {
    const va = a[key] as string | number | boolean;
    const vb = b[key] as string | number | boolean;
    let cmp = 0;
    if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
    else cmp = String(va ?? '').localeCompare(String(vb ?? ''), 'ru');
    return dir === 'asc' ? cmp : -cmp;
  });
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

function DetailTable({ rows }: { rows: ReportRow[] }) {
  const [sortKey, setSortKey]   = useState<SortKey>('monthKey');
  const [sortDir, setSortDir]   = useState<SortDir>('desc');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => sortRows(rows, sortKey, sortDir), [rows, sortKey, sortDir]);

  // Group by manager
  const grouped = useMemo(() => {
    const map = new Map<string, ReportRow[]>();
    for (const r of sorted) {
      const list = map.get(r.manager) ?? [];
      list.push(r);
      map.set(r.manager, list);
    }
    return [...map.entries()];
  }, [sorted]);

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

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === 'asc'
      ? <ArrowUp className="h-3 w-3 text-[--color-primary]" />
      : <ArrowDown className="h-3 w-3 text-[--color-primary]" />;
  };

  const th = (label: string, key?: SortKey, extra = '') => (
    <th
      className={`px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap ${key ? 'cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 select-none' : ''} ${extra}`}
      onClick={key ? () => handleSort(key) : undefined}
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
                      {mRows.length} аренд · {formatCurrency(totalAmt)}
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
                          <tr key={row.rentalId}
                            className="bg-white dark:bg-gray-800 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-colors">
                            <td className="px-3 py-2 whitespace-nowrap text-gray-700 dark:text-gray-300">{row.monthLabel}</td>
                            <td className="px-3 py-2 max-w-[180px] truncate text-gray-900 dark:text-white font-medium" title={row.client}>{row.client}</td>
                            <td className="px-3 py-2 font-mono text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.equipmentInv}</td>
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{row.equipmentLabel}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400 text-xs">
                              {fmtDate(row.startDate)} — {fmtDate(row.endDate)}
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
                              {row.paidDate ? fmtDate(row.paidDate) : '—'}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {row.updSigned
                                ? <span className="text-green-600 dark:text-green-400 text-xs font-medium">✓ Подписан</span>
                                : <span className="text-amber-600 dark:text-amber-400 text-xs">✗ Нет</span>}
                            </td>
                            <td className="px-3 py-2 text-xs whitespace-nowrap text-gray-600 dark:text-gray-400">
                              {row.updDate ? fmtDate(row.updDate) : '—'}
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
  const { data: rentals = [] } = useQuery<GanttRentalData[]>({
    queryKey: RENTAL_KEYS.gantt,
    queryFn: rentalsService.getGanttData,
  });
  const { data: equipment = [] } = useQuery<Equipment[]>({
    queryKey: EQUIPMENT_KEYS.all,
    queryFn: equipmentService.getAll,
  });
  const { data: payments = [] } = useQuery<Payment[]>({
    queryKey: PAYMENT_KEYS.all,
    queryFn: paymentsService.getAll,
  });

  const refresh = useCallback(() => {
    setRefreshing(true);
    Promise.all([
      queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt }),
      queryClient.invalidateQueries({ queryKey: EQUIPMENT_KEYS.all }),
      queryClient.invalidateQueries({ queryKey: PAYMENT_KEYS.all }),
    ]).finally(() => {
      setLoadedAt(Date.now());
      setRefreshing(false);
    });
  }, [queryClient]);

  // ── Filters ────────────────────────────────────────────────────────────────
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [view, setView] = useState<'summary' | 'detail'>('summary');

  const setF = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setFilters(f => ({ ...f, [k]: v }));

  const resetFilters = () => setFilters(EMPTY_FILTERS);

  const hasActiveFilters = Object.entries(filters).some(([k, v]) => {
    if (k === 'dateFrom' || k === 'dateTo') return v !== '';
    return v !== 'all';
  });

  // ── Build all rows from real data ──────────────────────────────────────────
  const allRows = useMemo(
    () => buildRows(rentals, equipment, payments),
    [rentals, equipment, payments],
  );

  // ── Derived option lists ───────────────────────────────────────────────────
  const managerOptions = useMemo(() => {
    const set = new Set(allRows.map(r => r.manager));
    return [
      { value: 'all', label: 'Все менеджеры' },
      ...[...set].sort().map(m => ({ value: m, label: m })),
    ];
  }, [allRows]);

  const clientOptions = useMemo(() => {
    const set = new Set(allRows.map(r => r.client));
    return [
      { value: 'all', label: 'Все клиенты' },
      ...[...set].sort().map(c => ({ value: c, label: c.length > 30 ? c.slice(0, 28) + '…' : c })),
    ];
  }, [allRows]);

  const invOptions = useMemo(() => {
    const set = new Set(allRows.map(r => r.equipmentInv));
    return [
      { value: 'all', label: 'Вся техника (INV)' },
      ...[...set].sort().map(v => ({ value: v, label: v })),
    ];
  }, [allRows]);

  // ── Month options from real data ───────────────────────────────────────────
  const monthOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const r of allRows) if (r.monthKey !== '9999-99') set.set(r.monthKey, r.monthLabel);
    const sorted = [...set.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    return [{ value: 'all', label: 'Все периоды' }, ...sorted.map(([v, l]) => ({ value: v, label: l }))];
  }, [allRows]);

  // ── Apply filters ──────────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    return allRows.filter(row => {
      if (filters.dateFrom && row.startDate < filters.dateFrom) return false;
      if (filters.dateTo   && row.startDate > filters.dateTo)   return false;
      if (filters.manager !== 'all' && row.manager !== filters.manager) return false;
      if (filters.client  !== 'all' && row.client  !== filters.client)  return false;
      if (filters.equipmentType !== 'all' && row.equipmentType !== filters.equipmentType) return false;
      if (filters.equipmentInv  !== 'all' && row.equipmentInv  !== filters.equipmentInv)  return false;
      if (filters.paymentStatus !== 'all' && row.paymentStatus !== filters.paymentStatus)  return false;
      if (filters.updStatus !== 'all') {
        if (filters.updStatus === 'signed'   && !row.updSigned) return false;
        if (filters.updStatus === 'unsigned' && row.updSigned)  return false;
      }
      if (filters.rentalStatus !== 'all' && row.rentalStatus !== filters.rentalStatus) return false;
      return true;
    });
  }, [allRows, filters]);

  const summary = useMemo(() => buildManagerSummary(filteredRows), [filteredRows]);

  // ── Period label for XLS ───────────────────────────────────────────────────
  const periodLabel = useMemo(() => {
    if (filters.dateFrom && filters.dateTo)
      return `${fmtDate(filters.dateFrom)} — ${fmtDate(filters.dateTo)}`;
    if (filters.dateFrom) return `с ${fmtDate(filters.dateFrom)}`;
    if (filters.dateTo)   return `по ${fmtDate(filters.dateTo)}`;
    if (monthOptions.find(m => m.value === 'all')) return 'за всё время';
    return '';
  }, [filters, monthOptions]);

  // ── Drill-down: click "Детализация →" in summary ───────────────────────────
  const drillToManager = (manager: string) => {
    setF('manager', manager);
    setView('detail');
  };

  // ── Timestamp display ──────────────────────────────────────────────────────
  const fmtTs = (ts: number) => {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  // ── Export ─────────────────────────────────────────────────────────────────
  const handleExport = () => {
    const content  = buildXLS(summary, filteredRows, periodLabel);
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
            {filteredRows.length} аренд · {summary.length} менеджеров ·{' '}
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
            disabled={filteredRows.length === 0}
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
              { value: 'created',  label: 'Создана' },
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
      {rentals.length === 0 ? (
        <EmptyState message="Аренды не найдены. Создайте первые аренды через планировщик или «Новая аренда»." />
      ) : filteredRows.length === 0 ? (
        <EmptyState message="Нет данных по выбранным фильтрам. Попробуйте изменить период или снять часть фильтров." />
      ) : view === 'summary' ? (
        <SummaryTable summary={summary} onSelectManager={drillToManager} />
      ) : (
        <DetailTable rows={filteredRows} />
      )}
    </div>
  );
}
