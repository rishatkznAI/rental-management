import React from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Archive,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  BarChart3,
  Calculator,
  CalendarDays,
  CheckCircle2,
  Download,
  Edit3,
  History,
  PauseCircle,
  Plus,
  ReceiptText,
  Search,
  Settings2,
  Trash2,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { FilterButton, FilterDialog, FilterField } from '../components/ui/filter-dialog';
import { LeasingPanel } from '../components/finance/LeasingPanel';
import { ReceivablesPanel } from '../components/finance/ReceivablesPanel';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../lib/permissions';
import {
  getAdminForm,
  getAdminListLabel,
  getAdminListOptions,
  useAdminSettings,
  type AdminFormFieldSetting,
  type AdminListOption,
} from '../lib/adminConfig';
import { formatCurrency, formatDate } from '../lib/utils';
import { COMPANY_EXPENSE_KEYS, companyExpensesService } from '../services/company-expenses.service';
import { financeService } from '../services/finance.service';
import { LEASING_KEYS, leasingService } from '../services/leasing.service';
import { paymentsService } from '../services/payments.service';
import type {
  CompanyExpense,
  CompanyExpenseFrequency,
  CompanyExpenseStatus,
  CompanyTaxSettings,
  FinanceAccount,
  FinanceAccountStatus,
  FinanceAccountType,
  FinanceEconomicsEquipmentStatus,
  FinanceOperation,
  FinanceOperationType,
  LeasingPaymentScheduleItem,
  Payment,
} from '../types';

const FREQUENCY_LABELS: Record<CompanyExpenseFrequency, string> = {
  monthly: 'Ежемесячно',
  quarterly: 'Ежеквартально',
  yearly: 'Ежегодно',
};

const STATUS_LABELS: Record<CompanyExpenseStatus, string> = {
  active: 'Активен',
  paused: 'Пауза',
  archived: 'Архив',
};

type ExpenseFormState = {
  name: string;
  category: string;
  amount: string;
  frequency: CompanyExpenseFrequency;
  paymentDay: string;
  nextPaymentDate: string;
  counterparty: string;
  account: string;
  status: CompanyExpenseStatus;
  comment: string;
  customFields: Record<string, string>;
};

type FinanceOperationRow = {
  id: string;
  date: string;
  type: FinanceOperationType;
  category: string;
  description: string;
  counterparty: string;
  amount: number;
  account: string;
  relatedEntity: string;
  status: string;
  source: 'payments' | 'expenses' | 'leasing' | 'manual';
  manual?: FinanceOperation;
};

type FlowBucket = {
  key: string;
  label: string;
  income: number;
  expenses: number;
  profit: number;
};

type Grouping = 'day' | 'week' | 'month';
type CashFlowMode = 'expected' | 'factual' | 'all';
type EconomicsGrouping = 'month' | 'quarter' | 'year';
type EconomicsEquipmentGroup = 'all' | 'rented' | 'idle' | 'service' | 'sale';

type OperationFormState = {
  type: FinanceOperationType;
  date: string;
  amount: string;
  category: string;
  description: string;
  counterparty: string;
  account: string;
  accountFrom: string;
  accountTo: string;
  relatedEntityType: NonNullable<FinanceOperation['relatedEntityType']>;
  relatedEntityId: string;
  relatedEntityLabel: string;
  comment: string;
};

type AccountFormState = {
  name: string;
  type: FinanceAccountType;
  currency: string;
  balance: string;
  actualAt: string;
  comment: string;
  status: FinanceAccountStatus;
};

type TransferFormState = {
  accountFrom: string;
  accountTo: string;
  amount: string;
  date: string;
  comment: string;
};

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  transport: 'Транспорт',
  salary: 'Зарплата',
  payroll: 'Зарплата',
  service: 'Сервис и запчасти',
  parts: 'Сервис и запчасти',
  rent: 'Аренда и коммунальные',
  utilities: 'Аренда и коммунальные',
  insurance: 'Страхование',
  leasing: 'Лизинг',
  other: 'Прочее',
};

const MANAGER_EXPENSE_CATEGORIES = [
  'Транспорт',
  'Зарплата',
  'Сервис и запчасти',
  'Аренда и коммунальные',
  'Страхование',
  'Лизинг',
  'Прочее',
];

const OPERATION_TYPE_LABELS: Record<FinanceOperationType, string> = {
  income: 'Доход',
  expense: 'Расход',
  transfer: 'Перевод',
};

const ACCOUNT_TYPE_LABELS: Record<FinanceAccountType, string> = {
  bank_account: 'Расчётный счёт',
  cash: 'Касса',
  card: 'Карта',
  deposit: 'Депозит',
  other: 'Прочее',
};

const ACCOUNT_STATUS_LABELS: Record<FinanceAccountStatus, string> = {
  active: 'Активен',
  archived: 'Архив',
};

const ECONOMICS_GROUP_LABELS: Record<EconomicsGrouping, string> = {
  month: 'Месяц',
  quarter: 'Квартал',
  year: 'Год',
};

const ECONOMICS_EQUIPMENT_GROUP_LABELS: Record<EconomicsEquipmentGroup, string> = {
  all: 'Весь парк',
  rented: 'В аренде',
  idle: 'Свободная',
  service: 'Сервис',
  sale: 'Продажа',
};

const ECONOMICS_STATUS_LABELS: Record<FinanceEconomicsEquipmentStatus, string> = {
  profitable: 'Плюс',
  loss: 'Минус',
  not_configured: 'Без амортизации',
  unknown: 'Нет данных',
};

function createEmptyAccountForm(defaultDate = dateKey(new Date())): AccountFormState {
  return {
    name: '',
    type: 'bank_account',
    currency: 'RUB',
    balance: '',
    actualAt: defaultDate,
    comment: '',
    status: 'active',
  };
}

function createEmptyTransferForm(defaultDate = dateKey(new Date())): TransferFormState {
  return {
    accountFrom: '',
    accountTo: '',
    amount: '',
    date: defaultDate,
    comment: '',
  };
}

function createEmptyOperationForm(defaultDate = dateKey(new Date())): OperationFormState {
  return {
    type: 'expense',
    date: defaultDate,
    amount: '',
    category: '',
    description: '',
    counterparty: '',
    account: '',
    accountFrom: '',
    accountTo: '',
    relatedEntityType: '',
    relatedEntityId: '',
    relatedEntityLabel: '',
    comment: '',
  };
}

function createTaxSettingsForm(settings?: CompanyTaxSettings): Required<CompanyTaxSettings> {
  return {
    companyName: settings?.companyName || '',
    taxRegime: settings?.taxRegime || '',
    vatMode: settings?.vatMode || 'none',
    defaultVatRate: Number(settings?.defaultVatRate || 0),
    inputVatEnabled: Boolean(settings?.inputVatEnabled),
    outputVatEnabled: Boolean(settings?.outputVatEnabled),
    vatIncludedByDefault: Boolean(settings?.vatIncludedByDefault),
    effectiveFrom: settings?.effectiveFrom || '',
    comment: settings?.comment || '',
  };
}

function createEmptyForm(defaults?: Partial<Pick<ExpenseFormState, 'category' | 'frequency' | 'status'>>): ExpenseFormState {
  return {
    name: '',
    category: defaults?.category || 'Прочее',
    amount: '',
    frequency: defaults?.frequency || 'monthly',
    paymentDay: '',
    nextPaymentDate: '',
    counterparty: '',
    account: '',
    status: defaults?.status || 'active',
    comment: '',
    customFields: {},
  };
}

function dateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthStartKey(value = new Date()): string {
  return dateKey(new Date(value.getFullYear(), value.getMonth(), 1));
}

function monthEndKey(value = new Date()): string {
  return dateKey(new Date(value.getFullYear(), value.getMonth() + 1, 0));
}

function isDateInRange(date: string | undefined, from: string, to: string): boolean {
  if (!date) return false;
  return date >= from && date <= to;
}

function getPaymentDate(payment: Payment): string {
  return payment.paidDate || payment.dueDate || '';
}

function getPaymentIncome(payment: Payment): number {
  const amount = payment.paidAmount ?? (payment.status === 'paid' ? payment.amount : 0);
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function normalizeExpenseCategory(category: string): string {
  const key = String(category || '').trim().toLowerCase();
  if (!key) return 'Прочее';
  if (key.includes('лизинг')) return 'Лизинг';
  if (key.includes('зарп') || key.includes('фот') || key.includes('оклад')) return 'Зарплата';
  if (key.includes('транспорт') || key.includes('достав')) return 'Транспорт';
  if (key.includes('сервис') || key.includes('запчаст') || key.includes('ремонт')) return 'Сервис и запчасти';
  if (key.includes('аренд') || key.includes('коммун')) return 'Аренда и коммунальные';
  if (key.includes('страх')) return 'Страхование';
  return EXPENSE_CATEGORY_LABELS[key] || category || 'Прочее';
}

function expenseDueDate(expense: CompanyExpense, from: string, to: string): string {
  if (expense.nextPaymentDate && isDateInRange(expense.nextPaymentDate, from, to)) return expense.nextPaymentDate;
  if (!expense.paymentDay) return from;
  const base = new Date(`${from}T00:00:00`);
  const day = Math.min(31, Math.max(1, expense.paymentDay));
  const due = new Date(base.getFullYear(), base.getMonth(), day);
  const key = dateKey(due);
  return isDateInRange(key, from, to) ? key : from;
}

function buildExpenseOperations(expenses: CompanyExpense[], from: string, to: string): FinanceOperationRow[] {
  return expenses
    .filter(expense => expense.status === 'active')
    .map(expense => ({
      id: `expense-${expense.id}`,
      date: expenseDueDate(expense, from, to),
      type: 'expense' as const,
      category: normalizeExpenseCategory(expense.category),
      description: expense.name,
      counterparty: expense.counterparty || '—',
      amount: monthlyEquivalent(expense),
      account: expense.account || '—',
      relatedEntity: 'Постоянный расход',
      status: STATUS_LABELS[expense.status] || expense.status,
      source: 'expenses' as const,
    }))
    .filter(operation => isDateInRange(operation.date, from, to) && operation.amount > 0);
}

function buildLeasingOperations(schedule: LeasingPaymentScheduleItem[] | undefined, from: string, to: string): FinanceOperationRow[] {
  return (schedule || [])
    .filter(row => row.status !== 'paid' && row.status !== 'skipped' && isDateInRange(row.dueDate, from, to))
    .map(row => ({
      id: `leasing-${row.id}`,
      date: row.dueDate,
      type: 'expense' as const,
      category: 'Лизинг',
      description: row.comment || 'Лизинговый платёж',
      counterparty: 'Лизинг',
      amount: Number(row.outstanding ?? row.amount ?? 0),
      account: '—',
      relatedEntity: row.leasingContractId || 'Лизинг',
      status: row.status === 'overdue' ? 'Просрочено' : row.status === 'paid' ? 'Оплачено' : 'План',
      source: 'leasing' as const,
    }))
    .filter(operation => operation.amount > 0);
}

function buildPaymentOperations(payments: Payment[], from: string, to: string): FinanceOperationRow[] {
  return payments
    .map(payment => ({
      id: `payment-${payment.id}`,
      date: getPaymentDate(payment),
      type: 'income' as const,
      category: 'Оплата клиента',
      description: payment.invoiceNumber || 'Платёж',
      counterparty: payment.client || '—',
      amount: getPaymentIncome(payment),
      account: '—',
      relatedEntity: payment.rentalId ? `Аренда ${payment.rentalId}` : payment.clientId ? `Клиент ${payment.clientId}` : '—',
      status: payment.status === 'paid' ? 'Оплачено' : payment.status === 'partial' ? 'Частично' : payment.status === 'overdue' ? 'Просрочено' : 'Ожидает',
      source: 'payments' as const,
    }))
    .filter(operation => operation.amount > 0 && isDateInRange(operation.date, from, to));
}

function weekKey(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  const first = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - first.getTime()) / 86400000);
  return `${date.getFullYear()}-W${String(Math.ceil((days + first.getDay() + 1) / 7)).padStart(2, '0')}`;
}

function groupOperationDate(date: string, grouping: Grouping): string {
  if (grouping === 'month') return date.slice(0, 7);
  if (grouping === 'week') return weekKey(date);
  return date;
}

function buildManualOperationRow(operation: FinanceOperation): FinanceOperationRow {
  const relatedEntity = [
    operation.relatedEntityType ? {
      rental: 'Аренда',
      client: 'Клиент',
      document: 'Документ',
      equipment: 'Техника',
      leasing: 'Лизинг',
      other: 'Другое',
      '': '',
    }[operation.relatedEntityType] : '',
    operation.relatedEntityLabel || operation.relatedEntityId || '',
  ].filter(Boolean).join(': ');
  return {
    id: `manual-${operation.id}`,
    date: operation.date,
    type: operation.type,
    category: operation.category,
    description: operation.description || 'Финансовая операция',
    counterparty: operation.counterparty || '—',
    amount: operation.amount,
    account: operation.type === 'transfer'
      ? [operation.accountFrom, operation.accountTo].filter(Boolean).join(' → ') || '—'
      : operation.account || '—',
    relatedEntity: relatedEntity || '—',
    status: operation.status === 'archived' ? 'Архив' : 'Активна',
    source: 'manual',
    manual: operation,
  };
}

function buildFlowBuckets(operations: FinanceOperationRow[], from: string, to: string, grouping: Grouping): FlowBucket[] {
  const map = new Map<string, FlowBucket>();
  const seed = (key: string) => {
    if (!map.has(key)) map.set(key, { key, label: key, income: 0, expenses: 0, profit: 0 });
    return map.get(key)!;
  };
  if (grouping === 'day') {
    const cursor = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    while (cursor <= end) {
      seed(dateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  operations.forEach(operation => {
    const bucket = seed(groupOperationDate(operation.date, grouping));
    if (operation.type === 'income') bucket.income += operation.amount;
    if (operation.type === 'expense') bucket.expenses += operation.amount;
    bucket.profit = bucket.income - bucket.expenses;
  });
  return Array.from(map.values())
    .map(item => ({ ...item, profit: item.income - item.expenses }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function exportOperationsCsv(operations: FinanceOperationRow[], from: string, to: string) {
  const rows = [
    ['Дата', 'Тип', 'Категория', 'Описание', 'Контрагент', 'Сумма'],
    ...operations.map(item => [
      item.date,
      item.type === 'income' ? 'Доход' : item.type === 'expense' ? 'Расход' : 'Перевод',
      item.category,
      item.description,
      item.counterparty,
      String(item.amount),
    ]),
  ];
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `finance-operations-${from}-${to}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function parseDateOnly(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthlyEquivalent(expense: CompanyExpense): number {
  if (expense.frequency === 'quarterly') return expense.amount / 3;
  if (expense.frequency === 'yearly') return expense.amount / 12;
  return expense.amount;
}

function getStatusBadge(status: CompanyExpenseStatus, label: string) {
  const variant = status === 'active' ? 'success' : status === 'paused' ? 'warning' : 'default';
  return <Badge variant={variant}>{label}</Badge>;
}

function toForm(expense: CompanyExpense): ExpenseFormState {
  return {
    name: expense.name,
    category: expense.category,
    amount: String(expense.amount || ''),
    frequency: expense.frequency,
    paymentDay: expense.paymentDay ? String(expense.paymentDay) : '',
    nextPaymentDate: expense.nextPaymentDate ?? '',
    counterparty: expense.counterparty ?? '',
    account: expense.account ?? '',
    status: expense.status,
    comment: expense.comment ?? '',
    customFields: expense.customFields ?? {},
  };
}

function getDayLabel(day?: number): string {
  if (!day) return 'Не задан';
  return `${day} число`;
}

function getNextPaymentLabel(expense: CompanyExpense): string {
  if (expense.nextPaymentDate) return formatDate(expense.nextPaymentDate);
  return getDayLabel(expense.paymentDay);
}

function resolveExpenseDueDate(expense: CompanyExpense): string {
  if (expense.nextPaymentDate) return expense.nextPaymentDate;
  if (!expense.paymentDay) return '';
  const today = new Date();
  const day = Math.min(31, Math.max(1, expense.paymentDay));
  return dateKey(new Date(today.getFullYear(), today.getMonth(), day));
}

function getDaysUntil(dateValue: string): number | null {
  const date = parseDateOnly(dateValue);
  if (!date) return null;
  const today = parseDateOnly(new Date().toISOString().slice(0, 10));
  if (!today) return null;
  return Math.round((date.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function isExpenseOverdue(expense: CompanyExpense): boolean {
  if (expense.status !== 'active') return false;
  const days = getDaysUntil(resolveExpenseDueDate(expense));
  return days != null && days < 0;
}

function isUpcoming(expense: CompanyExpense, daysAhead = 7): boolean {
  if (expense.status !== 'active') return false;
  const days = getDaysUntil(resolveExpenseDueDate(expense));
  return days != null && days >= 0 && days <= daysAhead;
}

function getExpenseDisplayStatus(expense: CompanyExpense): { label: string; status: CompanyExpenseStatus; overdue: boolean } {
  const overdue = isExpenseOverdue(expense);
  if (overdue) return { label: 'Просрочен', status: 'active', overdue };
  return { label: STATUS_LABELS[expense.status], status: expense.status, overdue };
}

function sortExpenses(left: CompanyExpense, right: CompanyExpense): number {
  const statusWeight: Record<CompanyExpenseStatus, number> = { active: 0, paused: 1, archived: 2 };
  const statusDiff = statusWeight[left.status] - statusWeight[right.status];
  if (statusDiff !== 0) return statusDiff;

  const leftDate = parseDateOnly(left.nextPaymentDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const rightDate = parseDateOnly(right.nextPaymentDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (leftDate !== rightDate) return leftDate - rightDate;

  return left.name.localeCompare(right.name, 'ru');
}

function FieldLabel({ children, required = false }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
      {children}
      {required && <span className="ml-1 text-red-500">*</span>}
    </label>
  );
}

function FinanceKpiCard({
  title,
  value,
  hint,
  tone = 'default',
  icon: Icon,
}: {
  title: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'success' | 'danger' | 'warning';
  icon: React.ElementType;
}) {
  const toneClass = {
    default: 'app-status-default',
    success: 'app-status-success',
    danger: 'app-status-danger',
    warning: 'app-status-warning',
  }[tone];
  return (
    <Card className="app-kpi-card h-full min-w-0 p-0">
      <CardContent className="h-full p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-snug text-muted-foreground">{title}</p>
            <p className="mt-2 break-words text-xl font-semibold leading-tight text-foreground sm:text-2xl xl:text-xl 2xl:text-2xl">{value}</p>
            {hint && <p className="mt-2 text-xs leading-snug text-muted-foreground">{hint}</p>}
          </div>
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${toneClass}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FinanceMobileField({
  label,
  value,
  className = '',
  valueClassName = '',
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={`min-w-0 rounded-lg bg-gray-50 p-3 dark:bg-gray-900/40 ${className}`} data-finance-mobile-field>
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <div className={`mt-1 min-w-0 break-words text-sm font-medium text-gray-900 dark:text-white ${valueClassName}`}>
        {value}
      </div>
    </div>
  );
}

function FinanceMobileActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-2 pt-1" data-finance-mobile-actions>
      {children}
    </div>
  );
}

function getEconomicsStatusBadge(status: FinanceEconomicsEquipmentStatus) {
  const variant = status === 'profitable'
    ? 'success'
    : status === 'loss'
      ? 'danger'
      : status === 'not_configured'
        ? 'warning'
        : 'default';
  return <Badge variant={variant}>{ECONOMICS_STATUS_LABELS[status]}</Badge>;
}

function optionValues(options: AdminListOption[]) {
  return options.map(option => option.value);
}

function optionsWithCurrent(activeOptions: AdminListOption[], allOptions: AdminListOption[], currentValue: string) {
  if (!currentValue || activeOptions.some(option => option.value === currentValue)) return activeOptions;
  const inactiveCurrent = allOptions.find(option => option.value === currentValue);
  if (inactiveCurrent) return [...activeOptions, inactiveCurrent];
  return [...activeOptions, { value: currentValue, label: currentValue, active: true }];
}

export default function Finance() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { can } = usePermissions();
  const { appSettings } = useAdminSettings();
  const canViewFinance = can('view', 'finance');
  const [dateFrom, setDateFrom] = React.useState(() => monthStartKey());
  const [dateTo, setDateTo] = React.useState(() => monthEndKey());
  const [flowGrouping, setFlowGrouping] = React.useState<Grouping>('day');
  const [cashFlowGrouping, setCashFlowGrouping] = React.useState<Grouping>('month');
  const [cashFlowMode, setCashFlowMode] = React.useState<CashFlowMode>('all');
  const [cashFlowIncludeVat, setCashFlowIncludeVat] = React.useState(true);
  const [cashFlowIncludeDepreciation, setCashFlowIncludeDepreciation] = React.useState(false);
  const [economicsGrouping, setEconomicsGrouping] = React.useState<EconomicsGrouping>('month');
  const [includeDepreciation, setIncludeDepreciation] = React.useState(true);
  const [includeVat, setIncludeVat] = React.useState(false);
  const [economicsEquipmentGroup, setEconomicsEquipmentGroup] = React.useState<EconomicsEquipmentGroup>('all');
  const [taxForm, setTaxForm] = React.useState<Required<CompanyTaxSettings>>(() => createTaxSettingsForm());
  const [operationFilter, setOperationFilter] = React.useState<'all' | 'income' | 'expense' | 'transfer'>('all');
  const [operationCategoryFilter, setOperationCategoryFilter] = React.useState('all');
  const [operationAccountFilter, setOperationAccountFilter] = React.useState('all');
  const [operationStatusFilter, setOperationStatusFilter] = React.useState('all');
  const [operationCounterpartyFilter, setOperationCounterpartyFilter] = React.useState('');
  const [operationAmountFrom, setOperationAmountFrom] = React.useState('');
  const [operationAmountTo, setOperationAmountTo] = React.useState('');
  const [operationDialogOpen, setOperationDialogOpen] = React.useState(false);
  const [editingOperation, setEditingOperation] = React.useState<FinanceOperation | null>(null);
  const [operationForm, setOperationForm] = React.useState<OperationFormState>(() => createEmptyOperationForm());
  const [operationFormError, setOperationFormError] = React.useState('');
  const [accountDialogOpen, setAccountDialogOpen] = React.useState(false);
  const [editingAccount, setEditingAccount] = React.useState<FinanceAccount | null>(null);
  const [accountForm, setAccountForm] = React.useState<AccountFormState>(() => createEmptyAccountForm());
  const [accountFormError, setAccountFormError] = React.useState('');
  const [transferDialogOpen, setTransferDialogOpen] = React.useState(false);
  const [transferForm, setTransferForm] = React.useState<TransferFormState>(() => createEmptyTransferForm());
  const [transferFormError, setTransferFormError] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<'current' | CompanyExpenseStatus | 'all'>('current');
  const [categoryFilter, setCategoryFilter] = React.useState('all');
  const [frequencyFilter, setFrequencyFilter] = React.useState<'all' | CompanyExpenseFrequency>('all');
  const [showFilters, setShowFilters] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingExpense, setEditingExpense] = React.useState<CompanyExpense | null>(null);
  const [historyExpense, setHistoryExpense] = React.useState<CompanyExpense | null>(null);
  const [form, setForm] = React.useState<ExpenseFormState>(() => createEmptyForm());
  const [formError, setFormError] = React.useState('');

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: COMPANY_EXPENSE_KEYS.all,
    queryFn: companyExpensesService.getAll,
    staleTime: 1000 * 60 * 2,
    enabled: canViewFinance,
  });
  const { data: leasingSummary } = useQuery({
    queryKey: LEASING_KEYS.summary,
    queryFn: leasingService.getSummary,
    staleTime: 1000 * 60 * 2,
    enabled: canViewFinance,
  });
  const { data: payments = [] } = useQuery({
    queryKey: ['payments'],
    queryFn: paymentsService.getAll,
    staleTime: 1000 * 60 * 2,
    enabled: canViewFinance,
  });
  const { data: manualOperations = [] } = useQuery({
    queryKey: ['finance', 'operations', dateFrom, dateTo],
    queryFn: () => financeService.getOperations(dateFrom, dateTo),
    staleTime: 1000 * 60,
    enabled: canViewFinance,
  });
  const { data: financeAccounts = [] } = useQuery({
    queryKey: ['finance', 'accounts'],
    queryFn: financeService.getAccounts,
    staleTime: 1000 * 60,
    enabled: canViewFinance,
  });
  const { data: cashFlow } = useQuery({
    queryKey: ['finance', 'cash-flow', dateFrom, dateTo, cashFlowGrouping, cashFlowMode, cashFlowIncludeVat, cashFlowIncludeDepreciation],
    queryFn: () => financeService.getCashFlow({
      dateFrom,
      dateTo,
      groupBy: cashFlowGrouping,
      mode: cashFlowMode,
      includeVat: cashFlowIncludeVat,
      includeDepreciation: cashFlowIncludeDepreciation,
    }),
    staleTime: 1000 * 60,
    enabled: canViewFinance,
  });
  const { data: economics, isLoading: economicsLoading } = useQuery({
    queryKey: ['finance', 'economics', dateFrom, dateTo, economicsGrouping, includeDepreciation, includeVat, economicsEquipmentGroup],
    queryFn: () => financeService.getEconomics({
      dateFrom,
      dateTo,
      groupBy: economicsGrouping,
      includeDepreciation,
      includeVat,
      equipmentGroup: economicsEquipmentGroup,
    }),
    staleTime: 1000 * 60,
    enabled: canViewFinance,
  });
  const { data: taxSettings } = useQuery({
    queryKey: ['finance', 'tax-settings'],
    queryFn: financeService.getTaxSettings,
    staleTime: 1000 * 60,
    enabled: canViewFinance,
  });

  React.useEffect(() => {
    setTaxForm(createTaxSettingsForm(taxSettings));
  }, [taxSettings]);

  const createExpense = useMutation({
    mutationFn: (data: Omit<CompanyExpense, 'id'>) => companyExpensesService.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COMPANY_EXPENSE_KEYS.all }),
  });

  const updateExpense = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CompanyExpense> }) =>
      companyExpensesService.update(id, data),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: COMPANY_EXPENSE_KEYS.all });
      queryClient.invalidateQueries({ queryKey: COMPANY_EXPENSE_KEYS.detail(id) });
    },
  });

  const deleteExpense = useMutation({
    mutationFn: (id: string) => companyExpensesService.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COMPANY_EXPENSE_KEYS.all }),
  });

  const createOperation = useMutation({
    mutationFn: financeService.createOperation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['finance', 'operations'] }),
  });

  const updateOperation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FinanceOperation> }) =>
      financeService.updateOperation(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['finance', 'operations'] }),
  });

  const createAccount = useMutation({
    mutationFn: financeService.createAccount,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['finance', 'accounts'] }),
  });

  const updateAccount = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FinanceAccount> & { forceArchive?: boolean } }) =>
      financeService.updateAccount(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['finance', 'accounts'] }),
  });

  const transferAccount = useMutation({
    mutationFn: financeService.transferBetweenAccounts,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'accounts'] });
      queryClient.invalidateQueries({ queryKey: ['finance', 'operations'] });
    },
  });
  const updateTaxSettings = useMutation({
    mutationFn: financeService.updateTaxSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['finance', 'tax-settings'] }),
  });

  const expenseFormFields = React.useMemo(
    () => getAdminForm(appSettings, 'finance_expense')?.fields || [],
    [appSettings],
  );
  const fieldMap = React.useMemo(
    () => new Map(expenseFormFields.map(field => [field.key, field])),
    [expenseFormFields],
  );
  const customFields = React.useMemo(
    () => expenseFormFields.filter(field => field.custom && field.visible !== false),
    [expenseFormFields],
  );
  const categoryOptions = React.useMemo(
    () => getAdminListOptions(appSettings, 'finance_expense_categories'),
    [appSettings],
  );
  const allCategoryOptions = React.useMemo(
    () => getAdminListOptions(appSettings, 'finance_expense_categories', { includeInactive: true }),
    [appSettings],
  );
  const frequencyOptions = React.useMemo(
    () => getAdminListOptions(appSettings, 'finance_expense_frequency'),
    [appSettings],
  );
  const allFrequencyOptions = React.useMemo(
    () => getAdminListOptions(appSettings, 'finance_expense_frequency', { includeInactive: true }),
    [appSettings],
  );
  const statusOptions = React.useMemo(
    () => getAdminListOptions(appSettings, 'finance_expense_statuses'),
    [appSettings],
  );
  const allStatusOptions = React.useMemo(
    () => getAdminListOptions(appSettings, 'finance_expense_statuses', { includeInactive: true }),
    [appSettings],
  );
  const defaultCategory = categoryOptions[0]?.value || allCategoryOptions[0]?.value || 'Прочее';
  const defaultFrequency = (frequencyOptions[0]?.value || allFrequencyOptions[0]?.value || 'monthly') as CompanyExpenseFrequency;
  const defaultStatus = (statusOptions[0]?.value || allStatusOptions[0]?.value || 'active') as CompanyExpenseStatus;
  const selectedCategoryOptions = React.useMemo(
    () => optionsWithCurrent(categoryOptions, allCategoryOptions, form.category),
    [allCategoryOptions, categoryOptions, form.category],
  );
  const selectedFrequencyOptions = React.useMemo(
    () => optionsWithCurrent(frequencyOptions, allFrequencyOptions, form.frequency),
    [allFrequencyOptions, form.frequency, frequencyOptions],
  );
  const selectedStatusOptions = React.useMemo(
    () => optionsWithCurrent(statusOptions, allStatusOptions, form.status),
    [allStatusOptions, form.status, statusOptions],
  );

  const categories = React.useMemo(
    () => Array.from(new Set([...optionValues(categoryOptions), ...expenses.map(item => item.category).filter(Boolean)]))
      .sort((a, b) =>
        getAdminListLabel(appSettings, 'finance_expense_categories', a)
          .localeCompare(getAdminListLabel(appSettings, 'finance_expense_categories', b), 'ru')
      ),
    [appSettings, categoryOptions, expenses],
  );

  const filteredExpenses = React.useMemo(
    () => expenses
      .filter((expense) => {
        const query = search.trim().toLowerCase();
        const categoryLabel = getAdminListLabel(appSettings, 'finance_expense_categories', expense.category);
        const customSearch = Object.values(expense.customFields ?? {}).join(' ');
        const matchesSearch = query === ''
          || expense.name.toLowerCase().includes(query)
          || expense.category.toLowerCase().includes(query)
          || categoryLabel.toLowerCase().includes(query)
          || (expense.counterparty ?? '').toLowerCase().includes(query)
          || (expense.account ?? '').toLowerCase().includes(query)
          || (expense.comment ?? '').toLowerCase().includes(query)
          || customSearch.toLowerCase().includes(query);
        const matchesStatus = statusFilter === 'all'
          || (statusFilter === 'current' ? expense.status !== 'archived' : expense.status === statusFilter);
        const matchesCategory = categoryFilter === 'all' || expense.category === categoryFilter;
        const matchesFrequency = frequencyFilter === 'all' || expense.frequency === frequencyFilter;
        return matchesSearch && matchesStatus && matchesCategory && matchesFrequency;
      })
      .sort(sortExpenses),
    [appSettings, categoryFilter, expenses, frequencyFilter, search, statusFilter],
  );

  const activeExpenses = expenses.filter(item => item.status === 'active');
  const expenseMonthlyLoad = Math.round(activeExpenses.reduce((sum, item) => sum + monthlyEquivalent(item), 0));
  const leasingMonthlyLoad = Math.round(leasingSummary?.currentMonthAmount || 0);
  const monthlyLoad = expenseMonthlyLoad + leasingMonthlyLoad;
  const periodLeasingSchedule = React.useMemo(
    () => (leasingSummary?.contracts || []).flatMap(contract => contract.schedule || []),
    [leasingSummary],
  );
  const periodOperations = React.useMemo(() => [
    ...manualOperations.filter(operation => operation.status !== 'archived').map(buildManualOperationRow),
    ...buildPaymentOperations(payments, dateFrom, dateTo),
    ...buildExpenseOperations(expenses, dateFrom, dateTo),
    ...buildLeasingOperations(periodLeasingSchedule, dateFrom, dateTo),
  ].sort((left, right) => right.date.localeCompare(left.date)), [dateFrom, dateTo, expenses, manualOperations, payments, periodLeasingSchedule]);
  const incomeTotal = periodOperations
    .filter(operation => operation.type === 'income')
    .reduce((sum, operation) => sum + operation.amount, 0);
  const expenseTotal = periodOperations
    .filter(operation => operation.type === 'expense')
    .reduce((sum, operation) => sum + operation.amount, 0);
  const profitTotal = incomeTotal - expenseTotal;
  const cashflowTotal = incomeTotal - expenseTotal;
  const activeFinanceAccounts = React.useMemo(
    () => financeAccounts.filter(account => account.status !== 'archived'),
    [financeAccounts],
  );
  const accountsBalance: number | null = activeFinanceAccounts.length
    ? activeFinanceAccounts.reduce((sum, account) => sum + Number(account.balance || 0), 0)
    : null;
  const flowData = React.useMemo(
    () => buildFlowBuckets(periodOperations, dateFrom, dateTo, flowGrouping),
    [dateFrom, dateTo, flowGrouping, periodOperations],
  );
  const expenseStructure = React.useMemo(() => {
    const map = new Map(MANAGER_EXPENSE_CATEGORIES.map(category => [category, 0]));
    periodOperations
      .filter(operation => operation.type === 'expense')
      .forEach(operation => {
        const category = MANAGER_EXPENSE_CATEGORIES.includes(operation.category) ? operation.category : 'Прочее';
        map.set(category, (map.get(category) || 0) + operation.amount);
      });
    return Array.from(map.entries())
      .map(([category, amount]) => ({
        category,
        amount,
        percent: expenseTotal > 0 ? Math.round((amount / expenseTotal) * 100) : 0,
      }))
      .filter(item => item.amount > 0 || expenseTotal === 0);
  }, [expenseTotal, periodOperations]);
  const operationCategories = React.useMemo(
    () => Array.from(new Set(periodOperations.map(operation => operation.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru')),
    [periodOperations],
  );
  const operationAccounts = React.useMemo(
    () => Array.from(new Set(periodOperations.map(operation => operation.account).filter(value => value && value !== '—'))).sort((a, b) => a.localeCompare(b, 'ru')),
    [periodOperations],
  );
  const filteredOperations = React.useMemo(() => {
    const min = operationAmountFrom ? Number(operationAmountFrom) : null;
    const max = operationAmountTo ? Number(operationAmountTo) : null;
    const counterparty = operationCounterpartyFilter.trim().toLowerCase();
    return periodOperations.filter(operation => {
      if (operationFilter !== 'all' && operation.type !== operationFilter) return false;
      if (operationCategoryFilter !== 'all' && operation.category !== operationCategoryFilter) return false;
      if (operationAccountFilter !== 'all' && operation.account !== operationAccountFilter) return false;
      if (operationStatusFilter !== 'all' && operation.status !== operationStatusFilter) return false;
      if (counterparty && !operation.counterparty.toLowerCase().includes(counterparty)) return false;
      if (min != null && Number.isFinite(min) && operation.amount < min) return false;
      if (max != null && Number.isFinite(max) && operation.amount > max) return false;
      return true;
    });
  }, [
    operationAccountFilter,
    operationAmountFrom,
    operationAmountTo,
    operationCategoryFilter,
    operationCounterpartyFilter,
    operationFilter,
    operationStatusFilter,
    periodOperations,
  ]);
  const latestOperations = filteredOperations.slice(0, 12);
  const upcomingExpenses = activeExpenses.filter(expense => isUpcoming(expense, 7)).sort(sortExpenses);
  const overdueExpenses = activeExpenses.filter(isExpenseOverdue).sort(sortExpenses);
  const pausedCount = expenses.filter(item => item.status === 'paused').length;
  const archivedCount = expenses.filter(item => item.status === 'archived').length;
  const activeFilterCount = [
    search.trim() !== '',
    statusFilter !== 'current',
    categoryFilter !== 'all',
    frequencyFilter !== 'all',
  ].filter(Boolean).length;
  const canManageFinance = can('create', 'finance') || can('edit', 'finance');
  const isSaving = createExpense.isPending || updateExpense.isPending;
  const isAccountSaving = createAccount.isPending || updateAccount.isPending;
  const isTransferSaving = transferAccount.isPending;
  const isTaxSaving = updateTaxSettings.isPending;
  const canEditTaxSettings = user?.role === 'Администратор' || user?.userRole === 'Администратор';
  const economicsSummary = economics?.summary;
  const problemEquipment = React.useMemo(
    () => (economics?.equipment || []).filter(item => item.status === 'loss').slice(0, 5),
    [economics],
  );
  const noDepreciationEquipment = React.useMemo(
    () => (economics?.equipment || []).filter(item => item.status === 'not_configured').slice(0, 5),
    [economics],
  );
  const highRevenueEquipment = React.useMemo(
    () => (economics?.equipment || []).filter(item => item.revenue > 0).slice().sort((left, right) => right.revenue - left.revenue).slice(0, 5),
    [economics],
  );
  const highServiceExpenseEquipment = React.useMemo(
    () => (economics?.equipment || []).filter(item => item.serviceExpenses > 0).slice().sort((left, right) => right.serviceExpenses - left.serviceExpenses).slice(0, 5),
    [economics],
  );

  if (!canViewFinance) {
    return <Navigate to="/" replace />;
  }

  const set = <K extends keyof ExpenseFormState>(key: K, value: ExpenseFormState[K]) => {
    setForm(current => ({ ...current, [key]: value }));
    setFormError('');
  };

  const setCustomField = (key: string, value: string) => {
    setForm(current => ({
      ...current,
      customFields: {
        ...current.customFields,
        [key]: value,
      },
    }));
    setFormError('');
  };

  const saveTaxSettings = async () => {
    await updateTaxSettings.mutateAsync({
      ...taxForm,
      defaultVatRate: Number(taxForm.defaultVatRate || 0),
    });
  };

  const getField = (key: string): AdminFormFieldSetting | undefined => fieldMap.get(key);
  const isVisible = (key: string) => getField(key)?.visible !== false;
  const isRequired = (key: string) => Boolean(getField(key)?.required);
  const labelOf = (key: string, fallback: string) => getField(key)?.label || fallback;
  const placeholderOf = (key: string, fallback = '') => getField(key)?.placeholder || fallback;

  const openCreateDialog = () => {
    setEditingExpense(null);
    setForm(createEmptyForm({ category: defaultCategory, frequency: defaultFrequency, status: defaultStatus }));
    setFormError('');
    setDialogOpen(true);
  };

  const openEditDialog = (expense: CompanyExpense) => {
    setEditingExpense(expense);
    setForm(toForm(expense));
    setFormError('');
    setDialogOpen(true);
  };

  const buildPayload = (): Omit<CompanyExpense, 'id'> | null => {
    const amount = Number(form.amount);
    const paymentDay = form.paymentDay ? Math.min(31, Math.max(1, Number(form.paymentDay))) : undefined;
    const now = new Date().toISOString();
    const normalizedCustomFields = Object.fromEntries(
      Object.entries(form.customFields)
        .map(([key, value]) => [key, String(value ?? '').trim()])
        .filter(([, value]) => value),
    );

    if (!form.name.trim()) {
      setFormError('Укажите название расхода.');
      return null;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('Укажите сумму больше нуля.');
      return null;
    }

    return {
      name: form.name.trim(),
      category: form.category.trim() || defaultCategory,
      amount,
      frequency: form.frequency,
      paymentDay,
      nextPaymentDate: form.nextPaymentDate || undefined,
      counterparty: form.counterparty.trim() || undefined,
      account: form.account.trim() || undefined,
      status: form.status,
      comment: form.comment.trim() || undefined,
      customFields: normalizedCustomFields,
      createdAt: editingExpense?.createdAt ?? now,
      updatedAt: now,
      createdBy: editingExpense?.createdBy ?? user?.name,
      updatedBy: user?.name,
    };
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = buildPayload();
    if (!payload) return;

    try {
      if (editingExpense) {
        await updateExpense.mutateAsync({ id: editingExpense.id, data: payload });
      } else {
        await createExpense.mutateAsync(payload);
      }
      setDialogOpen(false);
      setEditingExpense(null);
      setForm(createEmptyForm({ category: defaultCategory, frequency: defaultFrequency, status: defaultStatus }));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Не удалось сохранить расход.');
    }
  };

  const updateStatus = async (expense: CompanyExpense, status: CompanyExpenseStatus) => {
    await updateExpense.mutateAsync({
      id: expense.id,
      data: {
        status,
        updatedAt: new Date().toISOString(),
        updatedBy: user?.name,
      },
    });
  };

  const handleDelete = async (expense: CompanyExpense) => {
    const confirmed = window.confirm(`Удалить расход «${expense.name}» без восстановления?`);
    if (!confirmed) return;
    await deleteExpense.mutateAsync(expense.id);
  };

  const setOperationField = <K extends keyof OperationFormState>(key: K, value: OperationFormState[K]) => {
    setOperationForm(current => ({ ...current, [key]: value }));
    setOperationFormError('');
  };

  const openCreateOperationDialog = () => {
    setEditingOperation(null);
    setOperationForm(createEmptyOperationForm(dateFrom || dateKey(new Date())));
    setOperationFormError('');
    setOperationDialogOpen(true);
  };

  const openEditOperationDialog = (operation: FinanceOperation) => {
    setEditingOperation(operation);
    setOperationForm({
      type: operation.type,
      date: operation.date,
      amount: String(operation.amount || ''),
      category: operation.category || '',
      description: operation.description || '',
      counterparty: operation.counterparty || '',
      account: operation.account || '',
      accountFrom: operation.accountFrom || '',
      accountTo: operation.accountTo || '',
      relatedEntityType: operation.relatedEntityType || '',
      relatedEntityId: operation.relatedEntityId || '',
      relatedEntityLabel: operation.relatedEntityLabel || '',
      comment: operation.comment || '',
    });
    setOperationFormError('');
    setOperationDialogOpen(true);
  };

  const buildOperationPayload = () => {
    const amount = Number(operationForm.amount);
    if (!operationForm.date || Number.isNaN(new Date(`${operationForm.date}T00:00:00`).getTime())) {
      setOperationFormError('Укажите корректную дату.');
      return null;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setOperationFormError('Сумма операции должна быть больше нуля.');
      return null;
    }
    if (!operationForm.category.trim()) {
      setOperationFormError('Укажите категорию операции.');
      return null;
    }
    if (operationForm.type === 'transfer') {
      if (!operationForm.accountFrom.trim() || !operationForm.accountTo.trim()) {
        setOperationFormError('Для перевода укажите счёт-источник и счёт-получатель.');
        return null;
      }
      if (operationForm.accountFrom.trim().toLowerCase() === operationForm.accountTo.trim().toLowerCase()) {
        setOperationFormError('Нельзя перевести деньги на тот же счёт.');
        return null;
      }
    }
    return {
      type: operationForm.type,
      date: operationForm.date,
      amount,
      category: operationForm.category.trim(),
      description: operationForm.description.trim() || undefined,
      counterparty: operationForm.counterparty.trim() || undefined,
      account: operationForm.type === 'transfer' ? undefined : operationForm.account.trim() || undefined,
      accountFrom: operationForm.type === 'transfer' ? operationForm.accountFrom.trim() : undefined,
      accountTo: operationForm.type === 'transfer' ? operationForm.accountTo.trim() : undefined,
      relatedEntityType: operationForm.relatedEntityType || undefined,
      relatedEntityId: operationForm.relatedEntityId.trim() || undefined,
      relatedEntityLabel: operationForm.relatedEntityLabel.trim() || undefined,
      status: editingOperation?.status || 'active',
      comment: operationForm.comment.trim() || undefined,
    };
  };

  const handleOperationSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = buildOperationPayload();
    if (!payload) return;
    try {
      if (editingOperation) {
        await updateOperation.mutateAsync({ id: editingOperation.id, data: payload });
      } else {
        await createOperation.mutateAsync(payload);
      }
      setOperationDialogOpen(false);
      setEditingOperation(null);
      setOperationForm(createEmptyOperationForm(dateFrom || dateKey(new Date())));
    } catch (error) {
      setOperationFormError(error instanceof Error ? error.message : 'Не удалось сохранить операцию.');
    }
  };

  const archiveOperation = async (operation: FinanceOperation) => {
    const confirmed = window.confirm(`Архивировать операцию «${operation.description || operation.category}»?`);
    if (!confirmed) return;
    await updateOperation.mutateAsync({ id: operation.id, data: { status: 'archived' } });
  };

  const setAccountField = <K extends keyof AccountFormState>(key: K, value: AccountFormState[K]) => {
    setAccountForm(current => ({ ...current, [key]: value }));
    setAccountFormError('');
  };

  const setTransferField = <K extends keyof TransferFormState>(key: K, value: TransferFormState[K]) => {
    setTransferForm(current => ({ ...current, [key]: value }));
    setTransferFormError('');
  };

  const openCreateAccountDialog = () => {
    setEditingAccount(null);
    setAccountForm(createEmptyAccountForm(dateKey(new Date())));
    setAccountFormError('');
    setAccountDialogOpen(true);
  };

  const openEditAccountDialog = (account: FinanceAccount) => {
    setEditingAccount(account);
    setAccountForm({
      name: account.name || '',
      type: account.type || 'bank_account',
      currency: account.currency || 'RUB',
      balance: String(account.balance ?? ''),
      actualAt: account.actualAt || dateKey(new Date()),
      comment: account.comment || '',
      status: account.status || 'active',
    });
    setAccountFormError('');
    setAccountDialogOpen(true);
  };

  const buildAccountPayload = () => {
    const balance = Number(accountForm.balance);
    if (!accountForm.name.trim()) {
      setAccountFormError('Укажите название счёта или кассы.');
      return null;
    }
    if (!Number.isFinite(balance)) {
      setAccountFormError('Остаток должен быть числом.');
      return null;
    }
    if (!accountForm.actualAt || Number.isNaN(new Date(`${accountForm.actualAt}T00:00:00`).getTime())) {
      setAccountFormError('Укажите корректную дату актуальности.');
      return null;
    }
    return {
      name: accountForm.name.trim(),
      type: accountForm.type,
      currency: (accountForm.currency.trim() || 'RUB').toUpperCase(),
      balance,
      actualAt: accountForm.actualAt,
      comment: accountForm.comment.trim() || undefined,
      status: accountForm.status,
    };
  };

  const handleAccountSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = buildAccountPayload();
    if (!payload) return;
    try {
      if (editingAccount) {
        await updateAccount.mutateAsync({ id: editingAccount.id, data: payload });
      } else {
        await createAccount.mutateAsync(payload);
      }
      setAccountDialogOpen(false);
      setEditingAccount(null);
      setAccountForm(createEmptyAccountForm(dateKey(new Date())));
    } catch (error) {
      setAccountFormError(error instanceof Error ? error.message : 'Не удалось сохранить счёт.');
    }
  };

  const openTransferDialog = (account?: FinanceAccount) => {
    setTransferForm({
      ...createEmptyTransferForm(dateKey(new Date())),
      accountFrom: account?.id || '',
    });
    setTransferFormError('');
    setTransferDialogOpen(true);
  };

  const handleTransferSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(transferForm.amount);
    if (!transferForm.accountFrom || !transferForm.accountTo) {
      setTransferFormError('Выберите счёт-источник и счёт-получатель.');
      return;
    }
    if (transferForm.accountFrom === transferForm.accountTo) {
      setTransferFormError('Нельзя переводить на тот же счёт.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setTransferFormError('Сумма перевода должна быть больше нуля.');
      return;
    }
    if (!transferForm.date || Number.isNaN(new Date(`${transferForm.date}T00:00:00`).getTime())) {
      setTransferFormError('Укажите корректную дату перевода.');
      return;
    }
    try {
      await transferAccount.mutateAsync({
        accountFrom: transferForm.accountFrom,
        accountTo: transferForm.accountTo,
        amount,
        date: transferForm.date,
        comment: transferForm.comment.trim() || undefined,
      });
      setTransferDialogOpen(false);
      setTransferForm(createEmptyTransferForm(dateKey(new Date())));
    } catch (error) {
      setTransferFormError(error instanceof Error ? error.message : 'Не удалось выполнить перевод.');
    }
  };

  const archiveAccount = async (account: FinanceAccount) => {
    const confirmed = window.confirm(`Архивировать счёт «${account.name}»? Проверьте активные связи перед архивированием.`);
    if (!confirmed) return;
    await updateAccount.mutateAsync({ id: account.id, data: { status: 'archived', forceArchive: true } });
  };

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Финансы</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Контроль финансовых потоков компании
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="h-10 w-[150px]"
            aria-label="Начало периода"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className="h-10 w-[150px]"
            aria-label="Конец периода"
          />
          <Button variant="secondary" onClick={() => exportOperationsCsv(periodOperations, dateFrom, dateTo)}>
            <Download className="h-4 w-4" />
            Экспорт
          </Button>
          <Button onClick={openCreateOperationDialog} disabled={!canManageFinance}>
            <Plus className="h-4 w-4" />
            Добавить операцию
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="min-w-0 gap-4">
        <div className="app-scroll-fade-x max-w-full min-w-0 overflow-x-auto pb-1">
          <TabsList className="w-max min-w-full justify-start sm:min-w-0">
            <TabsTrigger value="overview">Обзор</TabsTrigger>
            <TabsTrigger value="cash-flow">Cash Flow</TabsTrigger>
            <TabsTrigger value="economics">Экономика</TabsTrigger>
            <TabsTrigger value="operations">Операции</TabsTrigger>
            <TabsTrigger value="expenses">Постоянные расходы</TabsTrigger>
            <TabsTrigger value="receivables">Дебиторка</TabsTrigger>
            <TabsTrigger value="leasing">Лизинг</TabsTrigger>
            <TabsTrigger value="accounts">Счета и кассы</TabsTrigger>
            <TabsTrigger value="tax-settings">НДС</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="min-w-0 space-y-4 [&_[data-slot=card-content]]:min-w-0 [&_[data-slot=card]]:min-w-0">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
            <FinanceKpiCard
              title="Доходы"
              value={incomeTotal > 0 ? formatCurrency(incomeTotal) : '—'}
              hint="Фактические входящие оплаты"
              icon={ArrowDownRight}
              tone="success"
            />
            <FinanceKpiCard
              title="Расходы"
              value={expenseTotal > 0 ? formatCurrency(expenseTotal) : '—'}
              hint="Постоянные расходы и лизинг"
              icon={ArrowUpRight}
              tone="danger"
            />
            <FinanceKpiCard
              title="Прибыль"
              value={periodOperations.length > 0 ? formatCurrency(profitTotal) : '—'}
              icon={TrendingUp}
              tone={profitTotal >= 0 ? 'success' : 'danger'}
            />
            <FinanceKpiCard
              title="Денежный поток"
              value={periodOperations.length > 0 ? formatCurrency(cashflowTotal) : '—'}
              hint="Факт: входящие минус исходящие"
              icon={WalletCards}
              tone={cashflowTotal >= 0 ? 'success' : 'warning'}
            />
            <FinanceKpiCard
              title="Остаток на счетах"
              value={accountsBalance == null ? '—' : formatCurrency(accountsBalance)}
              hint="Нет данных по счетам"
              icon={Banknote}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Динамика денежных потоков</CardTitle>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Доходы, расходы и прибыль за выбранный период.</p>
                </div>
                <Select value={flowGrouping} onValueChange={(value) => setFlowGrouping(value as Grouping)}>
                  <SelectTrigger className="w-full sm:w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">По дням</SelectItem>
                    <SelectItem value="week">По неделям</SelectItem>
                    <SelectItem value="month">По месяцам</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={flowData} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="financeIncome" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.28} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="financeExpenses" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.22} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.28)" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                      <YAxis tickFormatter={(value) => formatCurrency(Number(value)).replace(',00', '')} tickLine={false} axisLine={false} fontSize={12} width={88} />
                      <Tooltip formatter={(value, name) => [formatCurrency(Number(value)), name === 'income' ? 'Доходы' : name === 'expenses' ? 'Расходы' : 'Прибыль']} />
                      <Area type="monotone" dataKey="income" stroke="#10b981" fill="url(#financeIncome)" strokeWidth={2} name="income" />
                      <Area type="monotone" dataKey="expenses" stroke="#ef4444" fill="url(#financeExpenses)" strokeWidth={2} name="expenses" />
                      <Area type="monotone" dataKey="profit" stroke="#2563eb" fill="transparent" strokeWidth={2} name="profit" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Структура расходов</CardTitle>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Категории управленческих расходов за период.</p>
              </CardHeader>
              <CardContent>
                {expenseTotal <= 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    Расходы за период не найдены.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {expenseStructure.map(item => (
                      <div key={item.category}>
                        <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                          <span className="font-medium text-gray-700 dark:text-gray-200">{item.category}</span>
                          <span className="text-gray-500 dark:text-gray-400">{formatCurrency(item.amount)} · {item.percent}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                          <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(3, item.percent)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.8fr)]">
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Последние операции</CardTitle>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Лента из оплат, постоянных расходов и лизинга.</p>
                </div>
                <Select value={operationFilter} onValueChange={(value) => setOperationFilter(value as typeof operationFilter)}>
                  <SelectTrigger className="w-full sm:w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все</SelectItem>
                    <SelectItem value="income">Доходы</SelectItem>
                    <SelectItem value="expense">Расходы</SelectItem>
                    <SelectItem value="transfer">Переводы</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                <div className="hidden overflow-x-auto md:block" data-finance-desktop-table="latest-operations">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Дата</TableHead>
                        <TableHead>Тип</TableHead>
                        <TableHead>Категория</TableHead>
                        <TableHead>Описание</TableHead>
                        <TableHead>Контрагент</TableHead>
                        <TableHead className="text-right">Сумма</TableHead>
                        <TableHead>Действия</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {latestOperations.map(operation => (
                        <TableRow key={operation.id}>
                          <TableCell>{formatDate(operation.date)}</TableCell>
                          <TableCell>
                            <Badge variant={operation.type === 'income' ? 'success' : operation.type === 'expense' ? 'danger' : 'default'}>
                              {operation.type === 'income' ? 'Доход' : operation.type === 'expense' ? 'Расход' : 'Перевод'}
                            </Badge>
                          </TableCell>
                          <TableCell>{operation.category}</TableCell>
                          <TableCell>{operation.description}</TableCell>
                          <TableCell>{operation.counterparty || '—'}</TableCell>
                          <TableCell className={`text-right font-semibold ${operation.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : operation.type === 'expense' ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                            {operation.type === 'income' ? '+' : operation.type === 'expense' ? '-' : ''}
                            {formatCurrency(operation.amount)}
                          </TableCell>
                          <TableCell className="text-sm text-gray-400 dark:text-gray-500">—</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="space-y-3 md:hidden" data-finance-mobile-list="latest-operations">
                  {latestOperations.map(operation => (
                    <div key={`mobile-latest-${operation.id}`} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900/40">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-semibold text-gray-900 dark:text-white">{operation.description}</p>
                          <p className="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">{operation.counterparty || '—'}</p>
                        </div>
                        <Badge variant={operation.type === 'income' ? 'success' : operation.type === 'expense' ? 'danger' : 'default'}>
                          {operation.type === 'income' ? 'Доход' : operation.type === 'expense' ? 'Расход' : 'Перевод'}
                        </Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <FinanceMobileField label="Дата" value={formatDate(operation.date)} />
                        <FinanceMobileField label="Категория" value={operation.category} />
                        <FinanceMobileField
                          label="Сумма"
                          value={`${operation.type === 'income' ? '+' : operation.type === 'expense' ? '-' : ''}${formatCurrency(operation.amount)}`}
                          valueClassName={operation.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : operation.type === 'expense' ? 'text-red-600 dark:text-red-400' : ''}
                        />
                        <FinanceMobileField label="Действия" value="—" />
                      </div>
                    </div>
                  ))}
                </div>
                {latestOperations.length === 0 && (
                  <div className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">Операции за период не найдены.</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Счета и кассы</CardTitle>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Остатки появятся после добавления модели счетов.</p>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center dark:border-gray-700">
                  <Banknote className="mx-auto h-8 w-8 text-gray-400 dark:text-gray-500" />
                  <p className="mt-3 text-sm font-medium text-gray-900 dark:text-white">Нет данных по счетам и кассам</p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Банковские номера и остатки не подставляются искусственно.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="cash-flow" className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            Cash Flow, НДС и амортизация здесь являются управленческим расчётом и не заменяют бухгалтерскую отчётность.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={cashFlowMode} onValueChange={(value) => setCashFlowMode(value as CashFlowMode)}>
              <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Факт и прогноз</SelectItem>
                <SelectItem value="factual">Только факт</SelectItem>
                <SelectItem value="expected">Только прогноз</SelectItem>
              </SelectContent>
            </Select>
            <Select value={cashFlowGrouping} onValueChange={(value) => setCashFlowGrouping(value as Grouping)}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="day">По дням</SelectItem>
                <SelectItem value="week">По неделям</SelectItem>
                <SelectItem value="month">По месяцам</SelectItem>
              </SelectContent>
            </Select>
            <Button variant={cashFlowIncludeVat ? 'default' : 'secondary'} onClick={() => setCashFlowIncludeVat(value => !value)}>
              {cashFlowIncludeVat ? 'С НДС' : 'Без НДС'}
            </Button>
            <Button variant={cashFlowIncludeDepreciation ? 'default' : 'secondary'} onClick={() => setCashFlowIncludeDepreciation(value => !value)}>
              Амортизация
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FinanceKpiCard title="Денег ожидается" value={formatCurrency(cashFlow?.summary.incomingTotal || 0)} icon={ArrowDownRight} tone="success" />
            <FinanceKpiCard title="Денег уйдёт" value={formatCurrency(cashFlow?.summary.outgoingTotal || 0)} icon={ArrowUpRight} tone="danger" />
            <FinanceKpiCard title="Чистый поток" value={formatCurrency(cashFlow?.summary.netCashFlow || 0)} icon={TrendingUp} tone={(cashFlow?.summary.netCashFlow || 0) >= 0 ? 'success' : 'warning'} />
            <FinanceKpiCard title="Прогноз остатка" value={formatCurrency(cashFlow?.summary.closingBalanceForecast || 0)} icon={WalletCards} />
            <FinanceKpiCard title="НДС ориентировочно" value={formatCurrency(cashFlow?.summary.vatPayableEstimate || 0)} icon={ReceiptText} />
            <FinanceKpiCard title="Просроченная дебиторка" value={formatCurrency(cashFlow?.summary.overdueReceivables || 0)} icon={History} tone={(cashFlow?.summary.overdueReceivables || 0) > 0 ? 'warning' : 'success'} />
            <FinanceKpiCard title="Ближайшие платежи" value={formatCurrency(cashFlow?.summary.upcomingPayments || 0)} icon={CalendarDays} />
            <FinanceKpiCard
              title="Амортизация"
              value={cashFlowIncludeDepreciation ? formatCurrency(cashFlow?.summary.depreciationTotal || 0) : 'Выключено'}
              hint="Non-cash, не денежный расход"
              icon={Settings2}
            />
          </div>

          {(cashFlow?.warnings || []).length > 0 && (
            <Card>
              <CardContent className="space-y-2 pt-6">
                {cashFlow?.warnings.map(warning => <p key={warning} className="text-sm text-amber-700 dark:text-amber-300">{warning}</p>)}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Прогноз движения денег</CardTitle>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Входящие, исходящие и net по выбранной группировке.</p>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={cashFlow?.periods || []} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.28)" />
                    <XAxis dataKey="period" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis tickFormatter={(value) => formatCurrency(Number(value)).replace(',00', '')} tickLine={false} axisLine={false} fontSize={12} width={88} />
                    <Tooltip formatter={(value, name) => [formatCurrency(Number(value)), name === 'incoming' ? 'Входящие' : name === 'outgoing' ? 'Исходящие' : 'Net']} />
                    <Area type="monotone" dataKey="incoming" stroke="#10b981" fill="#10b98122" strokeWidth={2} />
                    <Area type="monotone" dataKey="outgoing" stroke="#ef4444" fill="#ef444422" strokeWidth={2} />
                    <Area type="monotone" dataKey="net" stroke="#2563eb" fill="transparent" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Основа расчёта</CardTitle>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Каждая сумма показывает источник, статус и НДС.</p>
            </CardHeader>
            <CardContent>
              <div className="hidden overflow-x-auto md:block" data-finance-desktop-table="cash-flow-items">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Дата</TableHead>
                      <TableHead>Статья</TableHead>
                      <TableHead>Клиент / контрагент</TableHead>
                      <TableHead className="text-right">Сумма</TableHead>
                      <TableHead className="text-right">НДС</TableHead>
                      <TableHead>Статус</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(cashFlow?.items || []).map(item => (
                      <TableRow key={item.id}>
                        <TableCell>{formatDate(item.date)}</TableCell>
                        <TableCell>{item.description}</TableCell>
                        <TableCell>{item.clientName || '—'}</TableCell>
                        <TableCell className={`text-right font-semibold ${item.direction === 'incoming' ? 'text-emerald-600' : item.direction === 'outgoing' ? 'text-red-600' : 'text-slate-600 dark:text-slate-300'}`}>
                          {item.direction === 'incoming' ? '+' : item.direction === 'outgoing' ? '-' : ''}
                          {formatCurrency(item.amount)}
                        </TableCell>
                        <TableCell className="text-right">{item.vatAmount > 0 ? `${formatCurrency(item.vatAmount)} · ${item.vatRate}%` : '—'}</TableCell>
                        <TableCell>{item.direction === 'non_cash' ? 'Non-cash' : item.status || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-3 md:hidden" data-finance-mobile-list="cash-flow-items">
                {(cashFlow?.items || []).map(item => (
                  <div key={`mobile-cash-flow-${item.id}`} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900/40">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold text-gray-900 dark:text-white">{item.description}</p>
                        <p className="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">{item.clientName || '—'}</p>
                      </div>
                      <Badge variant={item.direction === 'incoming' ? 'success' : item.direction === 'outgoing' ? 'danger' : 'default'}>
                        {item.direction === 'non_cash' ? 'Non-cash' : item.status || '—'}
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <FinanceMobileField label="Дата" value={formatDate(item.date)} />
                      <FinanceMobileField
                        label="Сумма"
                        value={`${item.direction === 'incoming' ? '+' : item.direction === 'outgoing' ? '-' : ''}${formatCurrency(item.amount)}`}
                        valueClassName={item.direction === 'incoming' ? 'text-emerald-600 dark:text-emerald-400' : item.direction === 'outgoing' ? 'text-red-600 dark:text-red-400' : ''}
                      />
                      <FinanceMobileField label="НДС" value={item.vatAmount > 0 ? `${formatCurrency(item.vatAmount)} · ${item.vatRate}%` : '—'} />
                      <FinanceMobileField label="Статус" value={item.direction === 'non_cash' ? 'Non-cash' : item.status || '—'} />
                    </div>
                  </div>
                ))}
              </div>
              {(cashFlow?.items || []).length === 0 && (
                <div className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">Недостаточно данных для Cash Flow за выбранный период.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="economics" className="min-w-0 space-y-4 [&_[data-slot=card-content]]:min-w-0 [&_[data-slot=card]]:min-w-0">
          <Card className="min-w-0">
            <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle>Экономика компании</CardTitle>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Управленческая экономика парка за период. Не является бухгалтерской отчётностью.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={economicsGrouping} onValueChange={(value) => setEconomicsGrouping(value as EconomicsGrouping)}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ECONOMICS_GROUP_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={economicsEquipmentGroup} onValueChange={(value) => setEconomicsEquipmentGroup(value as EconomicsEquipmentGroup)}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ECONOMICS_EQUIPMENT_GROUP_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant={includeDepreciation ? 'default' : 'secondary'}
                  onClick={() => setIncludeDepreciation(value => !value)}
                >
                  <Calculator className="h-4 w-4" />
                  {includeDepreciation ? 'С амортизацией' : 'Без амортизации'}
                </Button>
                <Button
                  type="button"
                  variant={includeVat ? 'default' : 'secondary'}
                  onClick={() => setIncludeVat(value => !value)}
                >
                  <ReceiptText className="h-4 w-4" />
                  {includeVat ? 'С НДС' : 'Без НДС'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/35 dark:text-blue-100">
                Амортизация — non-cash показатель, не денежный расход. Cash Flow и экономика считаются отдельно.
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FinanceKpiCard title="Выручка" value={economicsSummary ? formatCurrency(economicsSummary.revenueTotal) : '—'} hint="Начислено по арендам" icon={ArrowDownRight} tone="success" />
            <FinanceKpiCard title="Денег поступило" value={economicsSummary ? formatCurrency(economicsSummary.cashInTotal) : '—'} hint="Фактические оплаты, не ДДС" icon={WalletCards} />
            <FinanceKpiCard title="Расходы" value={economicsSummary ? formatCurrency(economicsSummary.directExpensesTotal) : '—'} hint="Сервис, лизинг, доставка, компания" icon={ArrowUpRight} tone="danger" />
            <FinanceKpiCard title="Прибыль до амортизации" value={economicsSummary ? formatCurrency(economicsSummary.profitBeforeDepreciation) : '—'} icon={TrendingUp} tone={(economicsSummary?.profitBeforeDepreciation || 0) >= 0 ? 'success' : 'danger'} />
            <FinanceKpiCard title="Амортизация" value={economicsSummary ? formatCurrency(economicsSummary.depreciationTotal) : '—'} hint="Non-cash" icon={Calculator} tone="warning" />
            <FinanceKpiCard title="Прибыль после амортизации" value={economicsSummary ? formatCurrency(economicsSummary.profitAfterDepreciation) : '—'} icon={BarChart3} tone={(economicsSummary?.profitAfterDepreciation || 0) >= 0 ? 'success' : 'danger'} />
            <FinanceKpiCard title="Маржинальность" value={economicsSummary ? `${economicsSummary.marginAfterDepreciationPercent}%` : '—'} hint="После амортизации" icon={TrendingUp} />
            <FinanceKpiCard title="Окупаемость парка" value={economicsSummary?.paybackProgressPercent == null ? '—' : `${economicsSummary.paybackProgressPercent}%`} hint="По настроенной стоимости" icon={WalletCards} />
          </div>

          {economics?.warnings?.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {economics.warnings.map((warning, index) => (
                <div
                  key={`${warning.level}-${index}`}
                  className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                >
                  <AlertTriangle className={`mt-0.5 h-4 w-4 ${warning.level === 'risk' ? 'text-red-500' : warning.level === 'warning' ? 'text-amber-500' : 'text-blue-500'}`} />
                  <span>{warning.message || 'Недостаточно данных для точного расчёта'}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Выручка / расходы / прибыль</CardTitle>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Амортизация показана отдельной non-cash линией.
                </p>
              </CardHeader>
              <CardContent>
                <div className="h-[320px] min-w-0 overflow-hidden">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={economics?.periods || []} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.28)" />
                      <XAxis dataKey="period" tickLine={false} axisLine={false} fontSize={12} />
                      <YAxis tickFormatter={(value) => formatCurrency(Number(value)).replace(',00', '')} tickLine={false} axisLine={false} fontSize={12} width={88} />
                      <Tooltip formatter={(value, name) => [
                        formatCurrency(Number(value)),
                        name === 'revenue'
                          ? 'Выручка'
                          : name === 'expenses'
                            ? 'Расходы'
                            : name === 'depreciation'
                              ? 'Амортизация'
                              : 'Прибыль',
                      ]} />
                      <Area type="monotone" dataKey="revenue" stroke="#059669" fill="#10b98122" strokeWidth={2} name="revenue" />
                      <Area type="monotone" dataKey="expenses" stroke="#dc2626" fill="#ef444422" strokeWidth={2} name="expenses" />
                      <Area type="monotone" dataKey="profitAfterDepreciation" stroke="#2563eb" fill="transparent" strokeWidth={2} name="profit" />
                      <Area type="monotone" dataKey="depreciation" stroke="#f59e0b" fill="transparent" strokeDasharray="4 4" strokeWidth={2} name="depreciation" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                {!economicsLoading && (!economics?.periods || economics.periods.length === 0) && (
                  <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">Недостаточно данных для точного расчёта.</div>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Проблемные блоки</CardTitle>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Сигналы без паники, для управленческого разбора.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  ['Техника в минусе', problemEquipment],
                  ['Техника без настроенной амортизации', noDepreciationEquipment],
                  ['Техника с высокой выручкой', highRevenueEquipment],
                  ['Техника с высокими сервисными расходами', highServiceExpenseEquipment],
                ].map(([title, rows]) => (
                  <div key={String(title)} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{String(title)}</p>
                      <Badge variant="default">{(rows as typeof problemEquipment).length}</Badge>
                    </div>
                    {(rows as typeof problemEquipment).length > 0 ? (
                      <div className="space-y-1.5">
                        {(rows as typeof problemEquipment).map(item => (
                          <div key={`${title}-${item.equipmentId || item.label}`} className="flex items-center justify-between gap-3 text-sm">
                            <span className="min-w-0 truncate text-gray-600 dark:text-gray-300">{item.label}</span>
                            <span className="shrink-0 font-medium text-gray-900 dark:text-white">{formatCurrency(Math.abs(item.profitAfterDepreciation || item.revenue || item.serviceExpenses))}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 dark:text-gray-400">Нет данных для блока.</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Экономика по единицам техники</CardTitle>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Детализация агрегированной картины компании без raw id в таблице.
              </p>
            </CardHeader>
            <CardContent>
              <div className="hidden overflow-x-auto md:block" data-finance-desktop-table="equipment-economics">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Техника</TableHead>
                      <TableHead className="text-right">Выручка</TableHead>
                      <TableHead className="text-right">Расходы</TableHead>
                      <TableHead className="text-right">Амортизация</TableHead>
                      <TableHead className="text-right">Прибыль после амортизации</TableHead>
                      <TableHead className="text-right">Окупаемость</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Рекомендация</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(economics?.equipment || []).map(item => (
                      <TableRow key={item.equipmentId || item.label}>
                        <TableCell className="min-w-[220px] font-medium text-gray-900 dark:text-white">{item.label || 'Техника без названия'}</TableCell>
                        <TableCell className="text-right">{formatCurrency(item.revenue)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(item.expenses)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(item.depreciation)}</TableCell>
                        <TableCell className={`text-right font-semibold ${item.profitAfterDepreciation >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {formatCurrency(item.profitAfterDepreciation)}
                        </TableCell>
                        <TableCell className="text-right">{item.paybackPercent == null ? '—' : `${item.paybackPercent}%`}</TableCell>
                        <TableCell>{getEconomicsStatusBadge(item.status)}</TableCell>
                        <TableCell className="min-w-[220px] text-sm text-gray-600 dark:text-gray-300">{item.recommendation || 'Недостаточно данных для точного расчёта.'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-3 md:hidden" data-finance-mobile-list="equipment-economics">
                {(economics?.equipment || []).map(item => (
                  <div key={`mobile-economics-${item.equipmentId || item.label}`} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900/40">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <p className="min-w-0 break-words text-sm font-semibold text-gray-900 dark:text-white">{item.label || 'Техника без названия'}</p>
                      <div className="max-w-[42%] shrink-0 text-right">{getEconomicsStatusBadge(item.status)}</div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <FinanceMobileField label="Выручка" value={formatCurrency(item.revenue)} />
                      <FinanceMobileField label="Расходы" value={formatCurrency(item.expenses)} />
                      <FinanceMobileField label="Амортизация" value={formatCurrency(item.depreciation)} />
                      <FinanceMobileField
                        label="Прибыль"
                        value={formatCurrency(item.profitAfterDepreciation)}
                        valueClassName={item.profitAfterDepreciation >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}
                      />
                      <FinanceMobileField label="Окупаемость" value={item.paybackPercent == null ? '—' : `${item.paybackPercent}%`} />
                      <FinanceMobileField label="Рекомендация" value={item.recommendation || 'Недостаточно данных для точного расчёта.'} />
                    </div>
                  </div>
                ))}
              </div>
              {!economicsLoading && (!economics?.equipment || economics.equipment.length === 0) && (
                <div className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  Недостаточно данных для точного расчёта.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="operations" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Операции</CardTitle>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Ручные операции, оплаты клиентов, постоянные расходы и лизинговые платежи за выбранный период.
                  </p>
                </div>
                {canManageFinance && (
                  <Button onClick={openCreateOperationDialog}>
                    <Plus className="h-4 w-4" />
                    Добавить операцию
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <Select value={operationFilter} onValueChange={(value) => setOperationFilter(value as typeof operationFilter)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все типы</SelectItem>
                    <SelectItem value="income">Доходы</SelectItem>
                    <SelectItem value="expense">Расходы</SelectItem>
                    <SelectItem value="transfer">Переводы</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={operationCategoryFilter} onValueChange={setOperationCategoryFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Категория" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все категории</SelectItem>
                    {operationCategories.map(category => (
                      <SelectItem key={category} value={category}>{category}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={operationAccountFilter} onValueChange={setOperationAccountFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Счёт" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все счета</SelectItem>
                    {operationAccounts.map(account => (
                      <SelectItem key={account} value={account}>{account}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={operationStatusFilter} onValueChange={setOperationStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Статус" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все статусы</SelectItem>
                    {Array.from(new Set(periodOperations.map(operation => operation.status))).map(status => (
                      <SelectItem key={status} value={status}>{status}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={operationCounterpartyFilter}
                  onChange={(event) => setOperationCounterpartyFilter(event.target.value)}
                  placeholder="Контрагент"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={operationAmountFrom}
                    onChange={(event) => setOperationAmountFrom(event.target.value)}
                    type="number"
                    min="0"
                    placeholder="От"
                  />
                  <Input
                    value={operationAmountTo}
                    onChange={(event) => setOperationAmountTo(event.target.value)}
                    type="number"
                    min="0"
                    placeholder="До"
                  />
                </div>
              </div>
              <div className="hidden overflow-x-auto md:block" data-finance-desktop-table="operations-register">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Дата</TableHead>
                      <TableHead>Тип</TableHead>
                      <TableHead>Категория</TableHead>
                      <TableHead>Описание</TableHead>
                      <TableHead>Контрагент</TableHead>
                      <TableHead>Счёт/касса</TableHead>
                      <TableHead>Связь</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead className="text-right">Сумма</TableHead>
                      <TableHead>Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOperations.map(operation => (
                      <TableRow key={`operations-${operation.id}`}>
                        <TableCell>{formatDate(operation.date)}</TableCell>
                        <TableCell>
                          <Badge variant={operation.type === 'income' ? 'success' : operation.type === 'expense' ? 'danger' : 'default'}>
                            {OPERATION_TYPE_LABELS[operation.type]}
                          </Badge>
                        </TableCell>
                        <TableCell>{operation.category}</TableCell>
                        <TableCell>{operation.description}</TableCell>
                        <TableCell>{operation.counterparty || '—'}</TableCell>
                        <TableCell>{operation.account || '—'}</TableCell>
                        <TableCell>{operation.relatedEntity || '—'}</TableCell>
                        <TableCell>{operation.status || '—'}</TableCell>
                        <TableCell className={`text-right font-semibold ${operation.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : operation.type === 'expense' ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                          {operation.type === 'income' ? '+' : operation.type === 'expense' ? '-' : ''}
                          {formatCurrency(operation.amount)}
                        </TableCell>
                        <TableCell>
                          {operation.manual && canManageFinance ? (
                            <div className="flex gap-2">
                              <Button size="icon" variant="outline" title="Редактировать" onClick={() => openEditOperationDialog(operation.manual!)}>
                                <Edit3 className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="outline" title="Архивировать" onClick={() => void archiveOperation(operation.manual!)}>
                                <Archive className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-3 md:hidden" data-finance-mobile-list="operations">
                {filteredOperations.map(operation => (
                  <div key={`mobile-operations-${operation.id}`} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900/40">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold text-gray-900 dark:text-white">{operation.description}</p>
                        <p className="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">{operation.counterparty || '—'}</p>
                      </div>
                      <Badge variant={operation.type === 'income' ? 'success' : operation.type === 'expense' ? 'danger' : 'default'}>
                        {OPERATION_TYPE_LABELS[operation.type]}
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <FinanceMobileField label="Дата" value={formatDate(operation.date)} />
                      <FinanceMobileField label="Категория" value={operation.category} />
                      <FinanceMobileField label="Счёт/касса" value={operation.account || '—'} />
                      <FinanceMobileField label="Связь" value={operation.relatedEntity || '—'} />
                      <FinanceMobileField label="Статус" value={operation.status || '—'} />
                      <FinanceMobileField
                        label="Сумма"
                        value={`${operation.type === 'income' ? '+' : operation.type === 'expense' ? '-' : ''}${formatCurrency(operation.amount)}`}
                        valueClassName={operation.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : operation.type === 'expense' ? 'text-red-600 dark:text-red-400' : ''}
                      />
                    </div>
                    {operation.manual && canManageFinance ? (
                      <FinanceMobileActions>
                        <Button size="sm" variant="outline" className="w-full" title="Редактировать" onClick={() => openEditOperationDialog(operation.manual!)}>
                          <Edit3 className="h-4 w-4" />
                          Редактировать
                        </Button>
                        <Button size="sm" variant="outline" className="w-full" title="Архивировать" onClick={() => void archiveOperation(operation.manual!)}>
                          <Archive className="h-4 w-4" />
                          Архив
                        </Button>
                      </FinanceMobileActions>
                    ) : null}
                  </div>
                ))}
              </div>
              {filteredOperations.length === 0 && (
                <div className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">Операции за период не найдены.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expenses" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Постоянные расходы</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Аренда, налоги, обслуживание, лизинг и другие обязательства.</p>
            </div>
            {can('create', 'finance') && (
              <Button onClick={openCreateDialog} className="h-10 rounded-xl px-4">
                <Plus className="h-4 w-4" />
                Добавить расход
              </Button>
            )}
          </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">Активные расходы</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
                <CheckCircle2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{activeExpenses.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">Сумма в месяц</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                <WalletCards className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{formatCurrency(monthlyLoad)}</p>
            </div>
            {leasingMonthlyLoad > 0 && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Включая лизинг: {formatCurrency(leasingMonthlyLoad)}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">Ближайшие 7 дней</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <CalendarDays className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{upcomingExpenses.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">Просрочено</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                <ReceiptText className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{overdueExpenses.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">На паузе</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
                <PauseCircle className="h-5 w-5 text-gray-600 dark:text-gray-300" />
              </div>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{pausedCount}</p>
            </div>
            {archivedCount > 0 && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Архив: {archivedCount}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Поиск по расходу, категории, контрагенту..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-10"
              />
            </div>
            <FilterButton activeCount={activeFilterCount} onClick={() => setShowFilters(true)} />
          </div>

          <div className="hidden overflow-x-auto md:block" data-finance-desktop-table="recurring-expenses">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название расхода</TableHead>
                  <TableHead>Категория</TableHead>
                  <TableHead>Сумма</TableHead>
                  <TableHead>Периодичность</TableHead>
                  <TableHead>День оплаты</TableHead>
                  <TableHead>Ближайшая дата оплаты</TableHead>
                  <TableHead>Источник/счёт</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="w-[220px]">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExpenses.map((expense) => {
                  const displayStatus = getExpenseDisplayStatus(expense);
                  return (
                    <TableRow key={expense.id} className={expense.status === 'archived' ? 'opacity-60' : ''}>
                      <TableCell>
                        <p className="font-medium text-gray-900 dark:text-white">{expense.name}</p>
                        {expense.counterparty && (
                          <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{expense.counterparty}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-gray-700 dark:text-gray-300">
                        {getAdminListLabel(appSettings, 'finance_expense_categories', expense.category)}
                      </TableCell>
                      <TableCell>
                        <p className="font-semibold text-gray-900 dark:text-white">{formatCurrency(expense.amount)}</p>
                        {expense.frequency !== 'monthly' && (
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {formatCurrency(Math.round(monthlyEquivalent(expense)))} / мес.
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-gray-700 dark:text-gray-300">
                        {getAdminListLabel(appSettings, 'finance_expense_frequency', expense.frequency) || FREQUENCY_LABELS[expense.frequency]}
                      </TableCell>
                      <TableCell className="text-sm text-gray-700 dark:text-gray-300">
                        {getDayLabel(expense.paymentDay)}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-700 dark:text-gray-300">
                          <p>{getNextPaymentLabel(expense)}</p>
                          {displayStatus.overdue && <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">просрочено</p>}
                          {!displayStatus.overdue && isUpcoming(expense, 7) && <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">в ближайшие 7 дней</p>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="max-w-[160px] truncate text-sm text-gray-700 dark:text-gray-300">{expense.account || '—'}</p>
                      </TableCell>
                      <TableCell>
                        {displayStatus.overdue
                          ? <Badge variant="error">{displayStatus.label}</Badge>
                          : getStatusBadge(displayStatus.status, getAdminListLabel(appSettings, 'finance_expense_statuses', expense.status) || displayStatus.label)}
                      </TableCell>
                      <TableCell>
                        {canManageFinance ? (
                          <div className="flex flex-wrap gap-2">
                            <Button size="icon" variant="outline" title="Редактировать" aria-label="Редактировать расход" onClick={() => openEditDialog(expense)}>
                              <Edit3 className="h-4 w-4" />
                            </Button>
                            {expense.status === 'active' ? (
                              <Button size="icon" variant="outline" title="Поставить на паузу" aria-label="Поставить расход на паузу" onClick={() => void updateStatus(expense, 'paused')}>
                                <PauseCircle className="h-4 w-4" />
                              </Button>
                            ) : (
                              <Button size="icon" variant="outline" title="Возобновить" aria-label="Возобновить расход" onClick={() => void updateStatus(expense, 'active')}>
                                <CheckCircle2 className="h-4 w-4" />
                              </Button>
                            )}
                            {expense.status !== 'archived' && (
                              <Button size="icon" variant="outline" title="Архивировать" aria-label="Архивировать расход" onClick={() => void updateStatus(expense, 'archived')}>
                                <Archive className="h-4 w-4" />
                              </Button>
                            )}
                            <Button size="icon" variant="outline" title="Открыть историю" aria-label="Открыть историю расхода" onClick={() => setHistoryExpense(expense)}>
                              <History className="h-4 w-4" />
                            </Button>
                            {can('delete', 'finance') && (
                              <Button size="icon" variant="outline" title="Удалить" aria-label="Удалить расход" onClick={() => void handleDelete(expense)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-3 md:hidden" data-finance-mobile-list="recurring-expenses">
            {filteredExpenses.map((expense) => {
              const displayStatus = getExpenseDisplayStatus(expense);
              const categoryLabel = getAdminListLabel(appSettings, 'finance_expense_categories', expense.category);
              const frequencyLabel = getAdminListLabel(appSettings, 'finance_expense_frequency', expense.frequency) || FREQUENCY_LABELS[expense.frequency];
              return (
                <div key={`mobile-expense-${expense.id}`} className={`rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900/40 ${expense.status === 'archived' ? 'opacity-70' : ''}`}>
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-gray-900 dark:text-white">{expense.name}</p>
                      {expense.counterparty && (
                        <p className="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">{expense.counterparty}</p>
                      )}
                    </div>
                    <div className="max-w-[45%] shrink-0 text-right">
                      {displayStatus.overdue
                        ? <Badge variant="error">{displayStatus.label}</Badge>
                        : getStatusBadge(displayStatus.status, getAdminListLabel(appSettings, 'finance_expense_statuses', expense.status) || displayStatus.label)}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <FinanceMobileField label="Сумма" value={formatCurrency(expense.amount)} valueClassName="text-base font-semibold" />
                    <FinanceMobileField label="Категория" value={categoryLabel} />
                    <FinanceMobileField label="Периодичность" value={frequencyLabel} />
                    <FinanceMobileField label="День оплаты" value={getDayLabel(expense.paymentDay)} />
                    <FinanceMobileField
                      label="Ближайшая оплата"
                      value={(
                        <>
                          <span>{getNextPaymentLabel(expense)}</span>
                          {displayStatus.overdue && <span className="mt-1 block text-xs font-medium text-red-600 dark:text-red-400">просрочено</span>}
                          {!displayStatus.overdue && isUpcoming(expense, 7) && <span className="mt-1 block text-xs font-medium text-amber-600 dark:text-amber-400">в ближайшие 7 дней</span>}
                        </>
                      )}
                    />
                    <FinanceMobileField label="Источник/счёт" value={expense.account || '—'} />
                  </div>
                  {canManageFinance ? (
                    <FinanceMobileActions>
                      <Button size="sm" variant="outline" className="w-full" title="Редактировать" aria-label="Редактировать расход" onClick={() => openEditDialog(expense)}>
                        <Edit3 className="h-4 w-4" />
                        Изменить
                      </Button>
                      {expense.status === 'active' ? (
                        <Button size="sm" variant="outline" className="w-full" title="Поставить на паузу" aria-label="Поставить расход на паузу" onClick={() => void updateStatus(expense, 'paused')}>
                          <PauseCircle className="h-4 w-4" />
                          Пауза
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="w-full" title="Возобновить" aria-label="Возобновить расход" onClick={() => void updateStatus(expense, 'active')}>
                          <CheckCircle2 className="h-4 w-4" />
                          Вернуть
                        </Button>
                      )}
                      {expense.status !== 'archived' && (
                        <Button size="sm" variant="outline" className="w-full" title="Архивировать" aria-label="Архивировать расход" onClick={() => void updateStatus(expense, 'archived')}>
                          <Archive className="h-4 w-4" />
                          Архив
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="w-full" title="Открыть историю" aria-label="Открыть историю расхода" onClick={() => setHistoryExpense(expense)}>
                        <History className="h-4 w-4" />
                        История
                      </Button>
                      {can('delete', 'finance') && (
                        <Button size="sm" variant="outline" className="col-span-2 w-full" title="Удалить" aria-label="Удалить расход" onClick={() => void handleDelete(expense)}>
                          <Trash2 className="h-4 w-4" />
                          Удалить
                        </Button>
                      )}
                    </FinanceMobileActions>
                  ) : null}
                </div>
              );
            })}
          </div>

          {!isLoading && filteredExpenses.length === 0 && (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
                <ReceiptText className="h-8 w-8 text-gray-400 dark:text-gray-500" />
              </div>
              <h3 className="text-base font-medium text-gray-900 dark:text-white">
                {expenses.length === 0 ? 'Расходов ещё нет' : 'Расходы не найдены'}
              </h3>
              <p className="mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">
                {expenses.length === 0
                  ? 'Добавьте постоянные расходы компании, чтобы видеть ежемесячную финансовую нагрузку.'
                  : 'Попробуйте изменить поиск или фильтры.'}
              </p>
              {can('create', 'finance') && expenses.length === 0 && (
                <Button className="mt-4" onClick={openCreateDialog}>
                  <Plus className="h-4 w-4" />
                  Добавить расход
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Ближайшие платежи</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Активные расходы на 7 дней вперёд</p>
            </div>
            <Badge variant="warning">{upcomingExpenses.length}</Badge>
          </div>
          {overdueExpenses.length > 0 && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/20">
              <p className="text-sm font-medium text-red-700 dark:text-red-300">Просрочено: {overdueExpenses.length}</p>
              <p className="mt-1 text-xs text-red-600 dark:text-red-300">
                Проверьте даты оплаты по активным постоянным расходам.
              </p>
            </div>
          )}
          {upcomingExpenses.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
              Срочных оплат по постоянным расходам нет.
            </div>
          ) : (
            <div className="space-y-3" data-finance-mobile-list="upcoming-payments">
              {upcomingExpenses.map(expense => (
                <div key={expense.id} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-700/60 dark:bg-amber-900/20">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-medium text-gray-900 dark:text-white">{expense.name}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {getNextPaymentLabel(expense)} · {getAdminListLabel(appSettings, 'finance_expense_categories', expense.category)}
                      </p>
                    </div>
                    <p className="shrink-0 text-right font-semibold text-gray-900 dark:text-white">{formatCurrency(expense.amount)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
        </TabsContent>

        <TabsContent value="leasing">
          <LeasingPanel canManageFinance={canManageFinance} canDeleteFinance={can('delete', 'finance')} />
        </TabsContent>

        <TabsContent value="receivables">
          <ReceivablesPanel canManageFinance={canManageFinance} />
        </TabsContent>

        <TabsContent value="accounts">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Счета и кассы</CardTitle>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Реальные остатки по расчётным счетам, кассам, картам и депозитам. Банковские номера не подставляются искусственно.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => openTransferDialog()} disabled={!canManageFinance || activeFinanceAccounts.length < 2}>
                  <ArrowUpRight className="h-4 w-4" />
                  Перевод между счетами
                </Button>
                <Button onClick={openCreateAccountDialog} disabled={!canManageFinance}>
                  <Plus className="h-4 w-4" />
                  Добавить счёт
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {financeAccounts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 px-4 py-12 text-center dark:border-gray-700">
                  <Banknote className="mx-auto h-9 w-9 text-gray-400 dark:text-gray-500" />
                  <p className="mt-3 text-sm font-medium text-gray-900 dark:text-white">Счета и кассы пока не заведены</p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Добавьте расчётный счёт, кассу, карту или депозит. Остатки не будут придуманы автоматически.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <FinanceKpiCard
                      title="Активных счетов"
                      value={String(activeFinanceAccounts.length)}
                      hint={`Всего заведено: ${financeAccounts.length}`}
                      icon={WalletCards}
                    />
                    <FinanceKpiCard
                      title="Остаток"
                      value={formatCurrency(accountsBalance || 0)}
                      hint="Сумма по активным счетам"
                      icon={Banknote}
                      tone="success"
                    />
                    <FinanceKpiCard
                      title="Архив"
                      value={String(financeAccounts.filter(account => account.status === 'archived').length)}
                      hint="Счета не входят в остаток"
                      icon={Archive}
                    />
                  </div>
                  <div className="hidden overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 md:block" data-finance-desktop-table="accounts">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Название</TableHead>
                          <TableHead>Тип</TableHead>
                          <TableHead>Валюта</TableHead>
                          <TableHead>Остаток</TableHead>
                          <TableHead>Дата актуальности</TableHead>
                          <TableHead>Комментарий</TableHead>
                          <TableHead>Статус</TableHead>
                          <TableHead className="text-right">Действия</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {financeAccounts.map(account => (
                          <TableRow key={account.id}>
                            <TableCell className="font-medium text-gray-900 dark:text-white">{account.name}</TableCell>
                            <TableCell>{ACCOUNT_TYPE_LABELS[account.type] || 'Прочее'}</TableCell>
                            <TableCell>{account.currency || 'RUB'}</TableCell>
                            <TableCell className="font-semibold">{formatCurrency(account.balance || 0)}</TableCell>
                            <TableCell>{formatDate(account.actualAt)}</TableCell>
                            <TableCell className="max-w-[260px] truncate text-gray-500 dark:text-gray-400">
                              {account.comment || '—'}
                            </TableCell>
                            <TableCell>
                              <Badge variant={account.status === 'active' ? 'success' : 'default'}>
                                {ACCOUNT_STATUS_LABELS[account.status] || account.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-2">
                                <Button size="sm" variant="secondary" onClick={() => openEditAccountDialog(account)} disabled={!canManageFinance}>
                                  <Edit3 className="h-4 w-4" />
                                  Изменить остаток
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => openTransferDialog(account)} disabled={!canManageFinance || account.status !== 'active' || activeFinanceAccounts.length < 2}>
                                  <ArrowUpRight className="h-4 w-4" />
                                  Перевод
                                </Button>
                                {account.status !== 'archived' && (
                                  <Button size="sm" variant="secondary" onClick={() => archiveAccount(account)} disabled={!canManageFinance}>
                                    <Archive className="h-4 w-4" />
                                    Архивировать
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="space-y-3 md:hidden" data-finance-mobile-list="accounts">
                    {financeAccounts.map(account => (
                      <div key={`mobile-account-${account.id}`} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900/40">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="break-words text-sm font-semibold text-gray-900 dark:text-white">{account.name}</p>
                            <p className="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">{ACCOUNT_TYPE_LABELS[account.type] || 'Прочее'} · {account.currency || 'RUB'}</p>
                          </div>
                          <Badge variant={account.status === 'active' ? 'success' : 'default'}>
                            {ACCOUNT_STATUS_LABELS[account.status] || account.status}
                          </Badge>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <FinanceMobileField label="Остаток" value={formatCurrency(account.balance || 0)} valueClassName="text-base font-semibold" />
                          <FinanceMobileField label="Актуально на" value={formatDate(account.actualAt)} />
                          <FinanceMobileField className="col-span-2" label="Комментарий" value={account.comment || '—'} />
                        </div>
                        <FinanceMobileActions>
                          <Button size="sm" variant="secondary" className="w-full" onClick={() => openEditAccountDialog(account)} disabled={!canManageFinance}>
                            <Edit3 className="h-4 w-4" />
                            Остаток
                          </Button>
                          <Button size="sm" variant="secondary" className="w-full" onClick={() => openTransferDialog(account)} disabled={!canManageFinance || account.status !== 'active' || activeFinanceAccounts.length < 2}>
                            <ArrowUpRight className="h-4 w-4" />
                            Перевод
                          </Button>
                          {account.status !== 'archived' && (
                            <Button size="sm" variant="secondary" className="col-span-2 w-full" onClick={() => archiveAccount(account)} disabled={!canManageFinance}>
                              <Archive className="h-4 w-4" />
                              Архивировать
                            </Button>
                          )}
                        </FinanceMobileActions>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tax-settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Настройки финансового профиля</CardTitle>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Расчёт управленческий, не заменяет бухгалтерскую отчётность.</p>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              <label className="space-y-1 text-sm font-medium">
                <span>Компания</span>
                <Input value={taxForm.companyName} onChange={(event) => setTaxForm(current => ({ ...current, companyName: event.target.value }))} disabled={!canEditTaxSettings} />
              </label>
              <label className="space-y-1 text-sm font-medium">
                <span>Тип налогообложения</span>
                <Select value={taxForm.taxRegime || 'unknown'} onValueChange={(value) => setTaxForm(current => ({ ...current, taxRegime: value === 'unknown' ? '' : value as CompanyTaxSettings['taxRegime'] }))} disabled={!canEditTaxSettings}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unknown">Не выбран</SelectItem>
                    <SelectItem value="OSNO">ОСНО</SelectItem>
                    <SelectItem value="USN">УСН</SelectItem>
                    <SelectItem value="USN_VAT_EXEMPT">УСН без НДС</SelectItem>
                    <SelectItem value="USN_VAT">УСН с НДС</SelectItem>
                    <SelectItem value="PATENT">Патент</SelectItem>
                    <SelectItem value="OTHER">Другое</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1 text-sm font-medium">
                <span>НДС</span>
                <Select value={taxForm.vatMode} onValueChange={(value) => setTaxForm(current => ({ ...current, vatMode: value as CompanyTaxSettings['vatMode'] }))} disabled={!canEditTaxSettings}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без НДС</SelectItem>
                    <SelectItem value="standard">Стандартный</SelectItem>
                    <SelectItem value="simplified">Упрощённый</SelectItem>
                    <SelectItem value="custom">Настраиваемый</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1 text-sm font-medium">
                <span>Ставка НДС по умолчанию, %</span>
                <Input type="number" min="0" step="0.01" value={taxForm.defaultVatRate} onChange={(event) => setTaxForm(current => ({ ...current, defaultVatRate: Number(event.target.value) }))} disabled={!canEditTaxSettings} />
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={taxForm.outputVatEnabled} onChange={(event) => setTaxForm(current => ({ ...current, outputVatEnabled: event.target.checked }))} disabled={!canEditTaxSettings} />
                Исходящий НДС включён
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={taxForm.inputVatEnabled} onChange={(event) => setTaxForm(current => ({ ...current, inputVatEnabled: event.target.checked }))} disabled={!canEditTaxSettings} />
                Входящий НДС учитывать
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={taxForm.vatIncludedByDefault} onChange={(event) => setTaxForm(current => ({ ...current, vatIncludedByDefault: event.target.checked }))} disabled={!canEditTaxSettings} />
                Цены указывать с НДС
              </label>
              <label className="space-y-1 text-sm font-medium">
                <span>Действует с</span>
                <Input type="date" value={taxForm.effectiveFrom} onChange={(event) => setTaxForm(current => ({ ...current, effectiveFrom: event.target.value }))} disabled={!canEditTaxSettings} />
              </label>
              <label className="space-y-1 text-sm font-medium lg:col-span-2">
                <span>Комментарий</span>
                <Textarea value={taxForm.comment} onChange={(event) => setTaxForm(current => ({ ...current, comment: event.target.value }))} disabled={!canEditTaxSettings} />
              </label>
              <div className="lg:col-span-2">
                <Button onClick={saveTaxSettings} disabled={!canEditTaxSettings || isTaxSaving}>
                  <CheckCircle2 className="h-4 w-4" />
                  Сохранить настройки НДС
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <FilterDialog
        open={showFilters}
        onOpenChange={setShowFilters}
        title="Фильтры расходов"
        description="Отберите постоянные расходы по статусу, категории и периодичности."
        onReset={() => {
          setSearch('');
          setStatusFilter('current');
          setCategoryFilter('all');
          setFrequencyFilter('all');
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <FilterField label="Статус">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="app-filter-input">
              <option value="current">Текущие без архива</option>
              <option value="all">Все статусы</option>
              {allStatusOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Периодичность">
            <select value={frequencyFilter} onChange={(event) => setFrequencyFilter(event.target.value as typeof frequencyFilter)} className="app-filter-input">
              <option value="all">Любая</option>
              {allFrequencyOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Категория" className="md:col-span-2">
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="app-filter-input">
              <option value="all">Все категории</option>
              {categories.map(category => (
                <option key={category} value={category}>
                  {getAdminListLabel(appSettings, 'finance_expense_categories', category)}
                </option>
              ))}
            </select>
          </FilterField>
        </div>
      </FilterDialog>

      <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingAccount ? 'Изменить счёт или кассу' : 'Добавить счёт или кассу'}</DialogTitle>
            <DialogDescription>
              Укажите фактический остаток и дату актуальности. Реальные банковские реквизиты здесь не требуются.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleAccountSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Название</label>
                <Input value={accountForm.name} onChange={(event) => setAccountField('name', event.target.value)} placeholder="Расчётный счёт, касса офиса..." />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Тип</label>
                <Select value={accountForm.type} onValueChange={(value) => setAccountField('type', value as FinanceAccountType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Валюта</label>
                <Input value={accountForm.currency} onChange={(event) => setAccountField('currency', event.target.value)} placeholder="RUB" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Остаток</label>
                <Input type="number" value={accountForm.balance} onChange={(event) => setAccountField('balance', event.target.value)} placeholder="0" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Дата актуальности</label>
                <Input type="date" value={accountForm.actualAt} onChange={(event) => setAccountField('actualAt', event.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Статус</label>
                <Select value={accountForm.status} onValueChange={(value) => setAccountField('status', value as FinanceAccountStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ACCOUNT_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Комментарий</label>
                <Textarea value={accountForm.comment} onChange={(event) => setAccountField('comment', event.target.value)} rows={3} />
              </div>
            </div>
            {accountFormError && <p className="text-sm text-red-600 dark:text-red-400">{accountFormError}</p>}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setAccountDialogOpen(false)}>Отмена</Button>
              <Button type="submit" disabled={isAccountSaving}>{isAccountSaving ? 'Сохранение...' : 'Сохранить'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Перевод между счетами</DialogTitle>
            <DialogDescription>
              Перевод меняет остатки двух активных счетов и добавляет операцию типа «Перевод».
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleTransferSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Счёт-источник</label>
                <Select value={transferForm.accountFrom} onValueChange={(value) => setTransferField('accountFrom', value)}>
                  <SelectTrigger><SelectValue placeholder="Выберите счёт" /></SelectTrigger>
                  <SelectContent>
                    {activeFinanceAccounts.map(account => (
                      <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Счёт-получатель</label>
                <Select value={transferForm.accountTo} onValueChange={(value) => setTransferField('accountTo', value)}>
                  <SelectTrigger><SelectValue placeholder="Выберите счёт" /></SelectTrigger>
                  <SelectContent>
                    {activeFinanceAccounts.map(account => (
                      <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Сумма</label>
                <Input type="number" value={transferForm.amount} onChange={(event) => setTransferField('amount', event.target.value)} placeholder="0" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Дата</label>
                <Input type="date" value={transferForm.date} onChange={(event) => setTransferField('date', event.target.value)} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Комментарий</label>
                <Textarea value={transferForm.comment} onChange={(event) => setTransferField('comment', event.target.value)} rows={3} />
              </div>
            </div>
            {transferFormError && <p className="text-sm text-red-600 dark:text-red-400">{transferFormError}</p>}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setTransferDialogOpen(false)}>Отмена</Button>
              <Button type="submit" disabled={isTransferSaving}>{isTransferSaving ? 'Перевод...' : 'Выполнить перевод'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(historyExpense)} onOpenChange={(open) => !open && setHistoryExpense(null)}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>История расхода</DialogTitle>
            <DialogDescription>
              Служебная история записи постоянного расхода без создания отдельной коллекции.
            </DialogDescription>
          </DialogHeader>
          {historyExpense && (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                <p className="text-sm text-gray-500 dark:text-gray-400">Расход</p>
                <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{historyExpense.name}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Категория</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {getAdminListLabel(appSettings, 'finance_expense_categories', historyExpense.category)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Сумма</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(historyExpense.amount)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Статус</p>
                    <div className="mt-1">
                      {getStatusBadge(historyExpense.status, STATUS_LABELS[historyExpense.status])}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Следующая оплата</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{getNextPaymentLabel(historyExpense)}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">События</h3>
                <div className="space-y-2">
                  <div className="rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-700">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">Создан расход</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {historyExpense.createdAt ? formatDate(historyExpense.createdAt) : '—'}
                      {historyExpense.createdBy ? ` · ${historyExpense.createdBy}` : ''}
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-700">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">Последнее изменение</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {historyExpense.updatedAt ? formatDate(historyExpense.updatedAt) : '—'}
                      {historyExpense.updatedBy ? ` · ${historyExpense.updatedBy}` : ''}
                    </p>
                  </div>
                  {historyExpense.comment && (
                    <div className="rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-700">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Комментарий</p>
                      <p className="mt-1 whitespace-pre-line text-sm text-gray-600 dark:text-gray-300">{historyExpense.comment}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setHistoryExpense(null)}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={operationDialogOpen} onOpenChange={setOperationDialogOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingOperation ? 'Редактировать операцию' : 'Добавить операцию'}</DialogTitle>
            <DialogDescription>
              Ручная операция попадёт в финансовую ленту и управленческие KPI выбранного периода.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleOperationSubmit}>
            {operationFormError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {operationFormError}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <FieldLabel required>Тип</FieldLabel>
                <Select value={operationForm.type} onValueChange={(value) => setOperationField('type', value as FinanceOperationType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="income">Доход</SelectItem>
                    <SelectItem value="expense">Расход</SelectItem>
                    <SelectItem value="transfer">Перевод</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <FieldLabel required>Дата</FieldLabel>
                <Input
                  type="date"
                  value={operationForm.date}
                  onChange={(event) => setOperationField('date', event.target.value)}
                  required
                />
              </div>
              <div>
                <FieldLabel required>Сумма</FieldLabel>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={operationForm.amount}
                  onChange={(event) => setOperationField('amount', event.target.value)}
                  placeholder="0"
                  required
                />
              </div>
              <div>
                <FieldLabel required>Категория</FieldLabel>
                <Input
                  value={operationForm.category}
                  onChange={(event) => setOperationField('category', event.target.value)}
                  placeholder="Например: транспорт"
                  required
                />
              </div>
              <div className="md:col-span-2">
                <FieldLabel>Описание</FieldLabel>
                <Input
                  value={operationForm.description}
                  onChange={(event) => setOperationField('description', event.target.value)}
                  placeholder="Краткое описание операции"
                />
              </div>
              <div>
                <FieldLabel>Контрагент</FieldLabel>
                <Input
                  value={operationForm.counterparty}
                  onChange={(event) => setOperationField('counterparty', event.target.value)}
                  placeholder="Клиент, поставщик или получатель"
                />
              </div>
              {operationForm.type === 'transfer' ? (
                <>
                  <div>
                    <FieldLabel required>Счёт-источник</FieldLabel>
                    <Input
                      value={operationForm.accountFrom}
                      onChange={(event) => setOperationField('accountFrom', event.target.value)}
                      placeholder="Касса"
                      required
                    />
                  </div>
                  <div>
                    <FieldLabel required>Счёт-получатель</FieldLabel>
                    <Input
                      value={operationForm.accountTo}
                      onChange={(event) => setOperationField('accountTo', event.target.value)}
                      placeholder="Расчётный счёт"
                      required
                    />
                  </div>
                </>
              ) : (
                <div>
                  <FieldLabel>Счёт/касса</FieldLabel>
                  <Input
                    value={operationForm.account}
                    onChange={(event) => setOperationField('account', event.target.value)}
                    placeholder="Расчётный счёт, касса"
                  />
                </div>
              )}
              <div>
                <FieldLabel>Связанная сущность</FieldLabel>
                <Select value={operationForm.relatedEntityType || 'none'} onValueChange={(value) => setOperationField('relatedEntityType', value === 'none' ? '' : value as OperationFormState['relatedEntityType'])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Не указана</SelectItem>
                    <SelectItem value="rental">Аренда</SelectItem>
                    <SelectItem value="client">Клиент</SelectItem>
                    <SelectItem value="document">Документ</SelectItem>
                    <SelectItem value="equipment">Техника</SelectItem>
                    <SelectItem value="leasing">Лизинг</SelectItem>
                    <SelectItem value="other">Другое</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <FieldLabel>ID связи</FieldLabel>
                <Input
                  value={operationForm.relatedEntityId}
                  onChange={(event) => setOperationField('relatedEntityId', event.target.value)}
                  placeholder="ID аренды, клиента, документа..."
                />
              </div>
              <div className="md:col-span-2">
                <FieldLabel>Название связи</FieldLabel>
                <Input
                  value={operationForm.relatedEntityLabel}
                  onChange={(event) => setOperationField('relatedEntityLabel', event.target.value)}
                  placeholder="Например: ООО Альфа / AR-2026-0123"
                />
              </div>
              <div className="md:col-span-2">
                <FieldLabel>Комментарий</FieldLabel>
                <Textarea
                  value={operationForm.comment}
                  onChange={(event) => setOperationField('comment', event.target.value)}
                  placeholder="Внутренний комментарий"
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOperationDialogOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={createOperation.isPending || updateOperation.isPending}>
                {createOperation.isPending || updateOperation.isPending ? 'Сохраняем...' : 'Сохранить'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingExpense ? 'Редактировать расход' : 'Добавить расход'}</DialogTitle>
            <DialogDescription>
              Заполните обязательные поля и дату следующей оплаты, если её нужно отслеживать.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSubmit}>
            {formError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {formError}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {isVisible('name') && (
              <div className="md:col-span-2">
                <FieldLabel required={isRequired('name')}>{labelOf('name', 'Название')}</FieldLabel>
                <Input
                  value={form.name}
                  onChange={(event) => set('name', event.target.value)}
                  placeholder={placeholderOf('name', 'Например: аренда офиса')}
                  required={isRequired('name')}
                />
              </div>
              )}
              {isVisible('category') && (
              <div>
                <FieldLabel required={isRequired('category')}>{labelOf('category', 'Категория')}</FieldLabel>
                <Select
                  value={form.category}
                  onValueChange={(value) => set('category', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedCategoryOptions.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              )}
              {isVisible('amount') && (
              <div>
                <FieldLabel required={isRequired('amount')}>{labelOf('amount', 'Сумма')}</FieldLabel>
                <Input
                  value={form.amount}
                  onChange={(event) => set('amount', event.target.value)}
                  type="number"
                  min="0"
                  step="1"
                  placeholder={placeholderOf('amount', '0')}
                  required={isRequired('amount')}
                />
              </div>
              )}
              {isVisible('frequency') && (
              <div>
                <FieldLabel required={isRequired('frequency')}>{labelOf('frequency', 'Периодичность')}</FieldLabel>
                <Select value={form.frequency} onValueChange={(value) => set('frequency', value as CompanyExpenseFrequency)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedFrequencyOptions.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              )}
              {isVisible('status') && (
              <div>
                <FieldLabel required={isRequired('status')}>{labelOf('status', 'Статус')}</FieldLabel>
                <Select value={form.status} onValueChange={(value) => set('status', value as CompanyExpenseStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedStatusOptions.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              )}
              {isVisible('paymentDay') && (
              <div>
                <FieldLabel required={isRequired('paymentDay')}>{labelOf('paymentDay', 'День оплаты')}</FieldLabel>
                <Input
                  value={form.paymentDay}
                  onChange={(event) => set('paymentDay', event.target.value)}
                  type="number"
                  min="1"
                  max="31"
                  placeholder={placeholderOf('paymentDay', 'Например: 25')}
                  required={isRequired('paymentDay')}
                />
              </div>
              )}
              {isVisible('nextPaymentDate') && (
              <div>
                <FieldLabel required={isRequired('nextPaymentDate')}>{labelOf('nextPaymentDate', 'Следующая дата оплаты')}</FieldLabel>
                <Input
                  value={form.nextPaymentDate}
                  onChange={(event) => set('nextPaymentDate', event.target.value)}
                  type="date"
                  required={isRequired('nextPaymentDate')}
                />
              </div>
              )}
              {isVisible('counterparty') && (
              <div>
                <FieldLabel required={isRequired('counterparty')}>{labelOf('counterparty', 'Контрагент')}</FieldLabel>
                <Input
                  value={form.counterparty}
                  onChange={(event) => set('counterparty', event.target.value)}
                  placeholder={placeholderOf('counterparty', 'Кому платим')}
                  required={isRequired('counterparty')}
                />
              </div>
              )}
              {isVisible('account') && (
              <div>
                <FieldLabel required={isRequired('account')}>{labelOf('account', 'Счёт / источник оплаты')}</FieldLabel>
                <Input
                  value={form.account}
                  onChange={(event) => set('account', event.target.value)}
                  placeholder={placeholderOf('account', 'Расчётный счёт, карта, касса')}
                  required={isRequired('account')}
                />
              </div>
              )}
              {isVisible('comment') && (
              <div className="md:col-span-2">
                <FieldLabel required={isRequired('comment')}>{labelOf('comment', 'Комментарий')}</FieldLabel>
                <Textarea
                  value={form.comment}
                  onChange={(event) => set('comment', event.target.value)}
                  placeholder={placeholderOf('comment', 'Детали договора, номер счёта, условия оплаты')}
                  rows={3}
                  required={isRequired('comment')}
                />
              </div>
              )}
              {customFields.map(field => (
                <div key={field.key} className={field.type === 'textarea' ? 'md:col-span-2' : undefined}>
                  <FieldLabel required={field.required}>{field.label}</FieldLabel>
                  {field.type === 'textarea' ? (
                    <Textarea
                      value={form.customFields[field.key] || ''}
                      onChange={(event) => setCustomField(field.key, event.target.value)}
                      placeholder={field.placeholder}
                      rows={3}
                      required={field.required}
                    />
                  ) : (
                    <Input
                      value={form.customFields[field.key] || ''}
                      onChange={(event) => setCustomField(field.key, event.target.value)}
                      type={field.type === 'number' || field.type === 'date' ? field.type : 'text'}
                      placeholder={field.placeholder}
                      required={field.required}
                    />
                  )}
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Сохраняем...' : 'Сохранить'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
