import React from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  CalendarDays,
  CheckCircle2,
  Edit3,
  PauseCircle,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  WalletCards,
} from 'lucide-react';
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
import { Textarea } from '../components/ui/textarea';
import { FilterButton, FilterDialog, FilterField } from '../components/ui/filter-dialog';
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
import type { CompanyExpense, CompanyExpenseFrequency, CompanyExpenseStatus } from '../types';

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

function isUpcoming(expense: CompanyExpense): boolean {
  const date = parseDateOnly(expense.nextPaymentDate);
  if (!date) return false;
  const today = parseDateOnly(new Date().toISOString().slice(0, 10));
  if (!today) return false;
  const diff = date.getTime() - today.getTime();
  return diff >= 0 && diff <= 14 * 24 * 60 * 60 * 1000;
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
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<'current' | CompanyExpenseStatus | 'all'>('current');
  const [categoryFilter, setCategoryFilter] = React.useState('all');
  const [frequencyFilter, setFrequencyFilter] = React.useState<'all' | CompanyExpenseFrequency>('all');
  const [showFilters, setShowFilters] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingExpense, setEditingExpense] = React.useState<CompanyExpense | null>(null);
  const [form, setForm] = React.useState<ExpenseFormState>(() => createEmptyForm());
  const [formError, setFormError] = React.useState('');

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: COMPANY_EXPENSE_KEYS.all,
    queryFn: companyExpensesService.getAll,
    staleTime: 1000 * 60 * 2,
  });

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
  const monthlyLoad = Math.round(activeExpenses.reduce((sum, item) => sum + monthlyEquivalent(item), 0));
  const upcomingExpenses = activeExpenses.filter(isUpcoming).sort(sortExpenses);
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

  if (!can('view', 'finance')) {
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

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Финансы</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Постоянные расходы компании: аренда, зарплата, налоги, лизинг и другие обязательства.
          </p>
        </div>
        {can('create', 'finance') && (
          <Button onClick={openCreateDialog} className="h-10 rounded-xl px-4">
            <Plus className="h-4 w-4" />
            Добавить расход
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">Месячная нагрузка</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                <WalletCards className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{formatCurrency(monthlyLoad)}</p>
            </div>
          </CardContent>
        </Card>
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
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">Ближайшие оплаты</CardTitle>
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
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">Пауза / архив</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
                <PauseCircle className="h-5 w-5 text-gray-600 dark:text-gray-300" />
              </div>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{pausedCount} / {archivedCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
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

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Расход</TableHead>
                  <TableHead>Сумма</TableHead>
                  <TableHead>Период</TableHead>
                  <TableHead>Оплата</TableHead>
                  <TableHead>Контрагент</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="w-[180px]">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExpenses.map((expense) => (
                  <TableRow key={expense.id} className={expense.status === 'archived' ? 'opacity-60' : ''}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{expense.name}</p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {getAdminListLabel(appSettings, 'finance_expense_categories', expense.category)}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">{formatCurrency(expense.amount)}</p>
                        {expense.frequency !== 'monthly' && (
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {formatCurrency(Math.round(monthlyEquivalent(expense)))} / мес.
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-gray-700 dark:text-gray-300">
                      {getAdminListLabel(appSettings, 'finance_expense_frequency', expense.frequency) || FREQUENCY_LABELS[expense.frequency]}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-gray-700 dark:text-gray-300">
                        <p>{getNextPaymentLabel(expense)}</p>
                        {isUpcoming(expense) && <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">скоро</p>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[180px]">
                        <p className="truncate text-sm text-gray-700 dark:text-gray-300">{expense.counterparty || '—'}</p>
                        {expense.account && <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{expense.account}</p>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(expense.status, getAdminListLabel(appSettings, 'finance_expense_statuses', expense.status) || STATUS_LABELS[expense.status])}
                    </TableCell>
                    <TableCell>
                      {canManageFinance ? (
                        <div className="flex flex-wrap gap-2">
                          <Button size="icon" variant="outline" title="Редактировать" onClick={() => openEditDialog(expense)}>
                            <Edit3 className="h-4 w-4" />
                          </Button>
                          {expense.status === 'active' ? (
                            <Button size="icon" variant="outline" title="Поставить на паузу" onClick={() => void updateStatus(expense, 'paused')}>
                              <PauseCircle className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button size="icon" variant="outline" title="Сделать активным" onClick={() => void updateStatus(expense, 'active')}>
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                          )}
                          {expense.status !== 'archived' && (
                            <Button size="icon" variant="outline" title="В архив" onClick={() => void updateStatus(expense, 'archived')}>
                              <Archive className="h-4 w-4" />
                            </Button>
                          )}
                          {can('delete', 'finance') && (
                            <Button size="icon" variant="outline" title="Удалить" onClick={() => void handleDelete(expense)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
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
              <p className="text-sm text-gray-500 dark:text-gray-400">Активные расходы на 14 дней вперёд</p>
            </div>
            <Badge variant="warning">{upcomingExpenses.length}</Badge>
          </div>
          {upcomingExpenses.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
              Срочных оплат по постоянным расходам нет.
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingExpenses.map(expense => (
                <div key={expense.id} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-700/60 dark:bg-amber-900/20">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">{expense.name}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {getNextPaymentLabel(expense)} · {getAdminListLabel(appSettings, 'finance_expense_categories', expense.category)}
                      </p>
                    </div>
                    <p className="shrink-0 font-semibold text-gray-900 dark:text-white">{formatCurrency(expense.amount)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
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
