import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Edit3,
  Eye,
  PauseCircle,
  PlayCircle,
  Plus,
  Search,
  WalletCards,
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Textarea } from '../ui/textarea';
import { FilterButton, FilterDialog, FilterField } from '../ui/filter-dialog';
import { formatCurrency, formatDate } from '../../lib/utils';
import { emptyLeasingSummary, getLeasingPaymentUrgency, LEASING_STATUS_LABELS } from '../../lib/leasing';
import { equipmentService } from '../../services/equipment.service';
import { LEASING_KEYS, leasingService } from '../../services/leasing.service';
import type { Equipment, LeasingContract, LeasingContractStatus } from '../../types';

type LeasingFormState = {
  contractNumber: string;
  leasingCompany: string;
  equipmentId: string;
  startDate: string;
  endDate: string;
  termMonths: string;
  monthlyPayment: string;
  paymentDay: string;
  initialPayment: string;
  buyoutPayment: string;
  totalAmount: string;
  interestRate: string;
  paymentSource: string;
  status: LeasingContractStatus;
  comment: string;
};

const STATUS_OPTIONS: LeasingContractStatus[] = ['active', 'paused', 'overdue', 'closed', 'archived'];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function addMonths(dateKey: string, months: number) {
  const date = new Date(`${dateKey || todayKey()}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function safeText(value: unknown): string {
  return String(value || '');
}

function createEmptyLeasingForm(): LeasingFormState {
  const startDate = todayKey();
  return {
    contractNumber: '',
    leasingCompany: '',
    equipmentId: '',
    startDate,
    endDate: addMonths(startDate, 36),
    termMonths: '36',
    monthlyPayment: '',
    paymentDay: '10',
    initialPayment: '',
    buyoutPayment: '',
    totalAmount: '',
    interestRate: '',
    paymentSource: '',
    status: 'active',
    comment: '',
  };
}

function formFromContract(contract: LeasingContract): LeasingFormState {
  return {
    contractNumber: contract.contractNumber || '',
    leasingCompany: contract.leasingCompany || '',
    equipmentId: contract.equipmentId || '',
    startDate: contract.startDate || todayKey(),
    endDate: contract.endDate || addMonths(todayKey(), contract.termMonths || 36),
    termMonths: String(contract.termMonths || 36),
    monthlyPayment: String(contract.monthlyPayment || ''),
    paymentDay: String(contract.paymentDay || 10),
    initialPayment: contract.initialPayment ? String(contract.initialPayment) : '',
    buyoutPayment: contract.buyoutPayment ? String(contract.buyoutPayment) : '',
    totalAmount: contract.totalAmount ? String(contract.totalAmount) : '',
    interestRate: contract.interestRate ? String(contract.interestRate) : '',
    paymentSource: contract.paymentSource || '',
    status: contract.status || 'active',
    comment: contract.comment || '',
  };
}

function equipmentLabel(equipment?: Equipment) {
  if (!equipment) return '';
  return [equipment.inventoryNumber, equipment.manufacturer, equipment.model].filter(Boolean).join(' ');
}

function statusVariant(status: LeasingContractStatus) {
  if (status === 'active') return 'success';
  if (status === 'overdue') return 'danger';
  if (status === 'paused') return 'warning';
  return 'default';
}

function isFinanciallyActiveStatus(status: LeasingContractStatus) {
  return status === 'active' || status === 'overdue';
}

function upcomingLeasingAmount(contracts: LeasingContract[], daysAhead: number, today = todayKey()) {
  const todayTime = new Date(`${today}T00:00:00`).getTime();
  return contracts
    .filter(contract => isFinanciallyActiveStatus(contract.status))
    .flatMap(contract => contract.schedule || [])
    .filter(row => row.status !== 'paid' && row.status !== 'skipped' && (row.outstanding || row.amount || 0) > 0)
    .filter(row => {
      const dueTime = new Date(`${row.dueDate}T00:00:00`).getTime();
      const diffDays = Math.floor((dueTime - todayTime) / (24 * 60 * 60 * 1000));
      return diffDays >= 0 && diffDays <= daysAhead;
    })
    .reduce((sum, row) => sum + (row.outstanding ?? row.amount ?? 0), 0);
}

function parseAmount(value: string) {
  if (!value.trim()) return 0;
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : NaN;
}

function FieldLabel({ children, required = false }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
      {children}
      {required && <span className="ml-1 text-red-500">*</span>}
    </label>
  );
}

export function LeasingPanel({ canManageFinance, canDeleteFinance }: { canManageFinance: boolean; canDeleteFinance: boolean }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<'all' | LeasingContractStatus>('all');
  const [companyFilter, setCompanyFilter] = React.useState('all');
  const [equipmentFilter, setEquipmentFilter] = React.useState('all');
  const [overdueOnly, setOverdueOnly] = React.useState(false);
  const [showFilters, setShowFilters] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingContract, setEditingContract] = React.useState<LeasingContract | null>(null);
  const [selectedContract, setSelectedContract] = React.useState<LeasingContract | null>(null);
  const [form, setForm] = React.useState<LeasingFormState>(() => createEmptyLeasingForm());
  const [formError, setFormError] = React.useState('');

  const contractsQuery = useQuery({
    queryKey: LEASING_KEYS.all,
    queryFn: leasingService.getAll,
    staleTime: 1000 * 60,
  });
  const summaryQuery = useQuery({
    queryKey: LEASING_KEYS.summary,
    queryFn: leasingService.getSummary,
    staleTime: 1000 * 60,
  });
  const { data: equipmentList = [] } = useQuery({
    queryKey: ['equipment'],
    queryFn: equipmentService.getAll,
    staleTime: 1000 * 60 * 2,
  });

  const contracts = contractsQuery.data ?? [];
  const summary = summaryQuery.data ?? emptyLeasingSummary(contracts);
  const equipmentById = React.useMemo(() => new Map(equipmentList.map(item => [item.id, item])), [equipmentList]);

  const createContract = useMutation({
    mutationFn: leasingService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LEASING_KEYS.all });
      queryClient.invalidateQueries({ queryKey: LEASING_KEYS.summary });
    },
  });
  const updateContract = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<LeasingContract> }) => leasingService.update(id, data),
    onSuccess: (_contract, { id }) => {
      queryClient.invalidateQueries({ queryKey: LEASING_KEYS.all });
      queryClient.invalidateQueries({ queryKey: LEASING_KEYS.summary });
      queryClient.invalidateQueries({ queryKey: LEASING_KEYS.detail(id) });
    },
  });
  const deleteContract = useMutation({
    mutationFn: leasingService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LEASING_KEYS.all });
      queryClient.invalidateQueries({ queryKey: LEASING_KEYS.summary });
    },
  });

  const companies = React.useMemo(
    () => Array.from(new Set(contracts.map(item => safeText(item.leasingCompany)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru')),
    [contracts],
  );

  const filteredContracts = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return contracts
      .filter(contract => {
        const equipmentName = contract.equipmentName || equipmentLabel(equipmentById.get(contract.equipmentId || ''));
        const matchesSearch = !query
          || safeText(contract.contractNumber).toLowerCase().includes(query)
          || safeText(contract.leasingCompany).toLowerCase().includes(query)
          || equipmentName.toLowerCase().includes(query)
          || (contract.comment || '').toLowerCase().includes(query);
        const matchesStatus = statusFilter === 'all' || contract.status === statusFilter;
        const matchesCompany = companyFilter === 'all' || contract.leasingCompany === companyFilter;
        const matchesEquipment = equipmentFilter === 'all' || contract.equipmentId === equipmentFilter;
        const matchesOverdue = !overdueOnly || (contract.overdueAmount || 0) > 0 || contract.status === 'overdue';
        return matchesSearch && matchesStatus && matchesCompany && matchesEquipment && matchesOverdue;
      })
      .sort((left, right) =>
        (left.nextPaymentDate || '9999-12-31').localeCompare(right.nextPaymentDate || '9999-12-31')
        || safeText(left.contractNumber).localeCompare(safeText(right.contractNumber), 'ru')
      );
  }, [companyFilter, contracts, equipmentById, equipmentFilter, overdueOnly, search, statusFilter]);

  const activeFilterCount = [
    search.trim() !== '',
    statusFilter !== 'all',
    companyFilter !== 'all',
    equipmentFilter !== 'all',
    overdueOnly,
  ].filter(Boolean).length;
  const isSaving = createContract.isPending || updateContract.isPending;

  const setField = <K extends keyof LeasingFormState>(key: K, value: LeasingFormState[K]) => {
    setForm(current => ({ ...current, [key]: value }));
    setFormError('');
  };

  const openCreateDialog = () => {
    setEditingContract(null);
    setForm(createEmptyLeasingForm());
    setFormError('');
    setDialogOpen(true);
  };

  const openEditDialog = (contract: LeasingContract) => {
    setEditingContract(contract);
    setForm(formFromContract(contract));
    setFormError('');
    setDialogOpen(true);
  };

  const buildPayload = () => {
    const equipment = equipmentById.get(form.equipmentId);
    const termMonths = Number(form.termMonths);
    const paymentDay = Number(form.paymentDay);
    const monthlyPayment = parseAmount(form.monthlyPayment);
    const initialPayment = parseAmount(form.initialPayment);
    const buyoutPayment = parseAmount(form.buyoutPayment);
    const totalAmount = parseAmount(form.totalAmount);
    const interestRate = parseAmount(form.interestRate);

    if (!form.contractNumber.trim()) return setFormError('Укажите номер договора.'), null;
    if (!form.leasingCompany.trim()) return setFormError('Укажите лизинговую компанию.'), null;
    if (!form.startDate || !form.endDate) return setFormError('Укажите даты договора.'), null;
    if (form.endDate < form.startDate) return setFormError('Дата окончания не может быть раньше даты начала.'), null;
    if (!Number.isFinite(termMonths) || termMonths <= 0) return setFormError('Срок должен быть больше нуля.'), null;
    if (!Number.isFinite(paymentDay) || paymentDay < 1 || paymentDay > 31) return setFormError('День платежа должен быть от 1 до 31.'), null;
    if (!Number.isFinite(monthlyPayment)) return setFormError('Ежемесячный платёж должен быть числом.'), null;
    if ([initialPayment, buyoutPayment, totalAmount, interestRate].some(value => !Number.isFinite(value))) {
      return setFormError('Суммы должны быть корректными числами.'), null;
    }

    return {
      contractNumber: form.contractNumber.trim(),
      leasingCompany: form.leasingCompany.trim(),
      equipmentId: form.equipmentId || undefined,
      equipmentName: equipment ? equipmentLabel(equipment) : undefined,
      startDate: form.startDate,
      endDate: form.endDate,
      termMonths,
      monthlyPayment,
      paymentDay,
      initialPayment,
      buyoutPayment,
      totalAmount: totalAmount || undefined,
      interestRate,
      paymentSource: form.paymentSource.trim() || undefined,
      status: form.status,
      comment: form.comment.trim() || undefined,
    };
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = buildPayload();
    if (!payload) return;
    try {
      if (editingContract) {
        await updateContract.mutateAsync({ id: editingContract.id, data: payload });
      } else {
        await createContract.mutateAsync(payload);
      }
      setDialogOpen(false);
      setEditingContract(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Не удалось сохранить договор лизинга.');
    }
  };

  const handleDelete = async (contract: LeasingContract) => {
    if (!window.confirm(`Удалить договор лизинга «${contract.contractNumber}»?`)) return;
    await deleteContract.mutateAsync(contract.id);
  };

  const updateStatus = async (contract: LeasingContract, status: LeasingContractStatus) => {
    await updateContract.mutateAsync({ id: contract.id, data: { status } });
  };

  const upcoming7Amount = upcomingLeasingAmount(summary.contracts || [], 7);
  const upcoming30Amount = upcomingLeasingAmount(summary.contracts || [], 30);

  const kpis = [
    { id: 'active', label: 'Активные договоры', value: String(summary.activeContracts), icon: WalletCards, tone: 'blue' },
    { id: 'current-month', label: 'Платежи в этом месяце', value: formatCurrency(summary.currentMonthAmount), icon: CalendarDays, tone: 'emerald' },
    { id: 'overdue', label: 'Просрочено', value: formatCurrency(summary.overdueAmount), icon: AlertTriangle, tone: 'red' },
    { id: 'remaining', label: 'Остаток обязательств', value: formatCurrency(summary.remainingAmount), icon: WalletCards, tone: 'gray' },
    { id: 'upcoming-7', label: 'Ближайшие 7 дней', value: formatCurrency(upcoming7Amount), icon: CalendarDays, tone: 'amber' },
    { id: 'upcoming-30', label: 'Ближайшие 30 дней', value: formatCurrency(upcoming30Amount), icon: CalendarDays, tone: 'amber' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Лизинг</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Обязательства компании по лизинговым договорам, ближайшие платежи и просрочки.
          </p>
        </div>
        {canManageFinance && (
          <Button onClick={openCreateDialog} className="h-10 rounded-xl px-4">
            <Plus className="h-4 w-4" />
            Создать договор
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {kpis.map(item => (
          <Card key={item.label} data-testid={`leasing-kpi-${item.id}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">{item.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
                  <item.icon className="h-5 w-5 text-gray-600 dark:text-gray-300" />
                </div>
                <p className="text-xl font-semibold text-gray-900 dark:text-white">{item.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Поиск по договору, компании, технике..."
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
                <TableHead>Договор лизинга</TableHead>
                <TableHead>Техника/предмет</TableHead>
                <TableHead>Лизингодатель</TableHead>
                <TableHead>Дата начала</TableHead>
                <TableHead>Срок</TableHead>
                <TableHead>Ежемесячный платёж</TableHead>
                <TableHead>Следующий платёж</TableHead>
                <TableHead>Остаток</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="min-w-[240px]">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredContracts.map(contract => {
                const urgency = getLeasingPaymentUrgency(contract);
                const equipment = equipmentById.get(contract.equipmentId || '');
                return (
                  <TableRow key={contract.id} className={(contract.overdueAmount || 0) > 0 ? 'bg-red-50/70 dark:bg-red-950/20' : undefined}>
                    <TableCell>
                      <button
                        type="button"
                        className="text-left font-medium text-gray-900 hover:text-[--color-primary] dark:text-white"
                        onClick={() => setSelectedContract(contract)}
                      >
                        {contract.contractNumber}
                      </button>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {formatDate(contract.startDate)} — {formatDate(contract.endDate)}
                      </p>
                    </TableCell>
                    <TableCell>{contract.equipmentName || equipmentLabel(equipment) || '—'}</TableCell>
                    <TableCell>{contract.leasingCompany}</TableCell>
                    <TableCell>{formatDate(contract.startDate)}</TableCell>
                    <TableCell>{contract.termMonths} мес.</TableCell>
                    <TableCell className="font-semibold">{formatCurrency(contract.monthlyPayment)}</TableCell>
                    <TableCell>
                      <div>
                        <p>{contract.nextPaymentDate ? formatDate(contract.nextPaymentDate) : '—'}</p>
                        <p className={`mt-1 text-xs ${urgency.tone === 'danger' ? 'font-medium text-red-600 dark:text-red-300' : urgency.tone === 'warning' ? 'font-medium text-amber-600 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'}`}>
                          {urgency.label}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="font-semibold">{formatCurrency(contract.remainingAmount || 0)}</TableCell>
                    <TableCell><Badge variant={statusVariant(contract.status)}>{LEASING_STATUS_LABELS[contract.status]}</Badge></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button size="icon" variant="outline" title="Открыть график платежей" aria-label="Открыть график платежей" onClick={() => setSelectedContract(contract)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        {canManageFinance && (
                          <>
                            <Button size="icon" variant="outline" title="Редактировать" aria-label="Редактировать договор" onClick={() => openEditDialog(contract)}>
                              <Edit3 className="h-4 w-4" />
                            </Button>
                            {contract.status === 'paused' ? (
                              <Button size="icon" variant="outline" title="Возобновить" aria-label="Возобновить договор" onClick={() => void updateStatus(contract, 'active')}>
                                <PlayCircle className="h-4 w-4" />
                              </Button>
                            ) : contract.status !== 'closed' && contract.status !== 'archived' ? (
                              <Button size="icon" variant="outline" title="Поставить на паузу" aria-label="Поставить договор на паузу" onClick={() => void updateStatus(contract, 'paused')}>
                                <PauseCircle className="h-4 w-4" />
                              </Button>
                            ) : null}
                            {contract.status !== 'closed' && contract.status !== 'archived' && (
                              <Button size="icon" variant="outline" title="Закрыть" aria-label="Закрыть договор" onClick={() => void updateStatus(contract, 'closed')}>
                                <CheckCircle2 className="h-4 w-4" />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {!contractsQuery.isLoading && filteredContracts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
              <WalletCards className="h-8 w-8 text-gray-400 dark:text-gray-500" />
            </div>
            <h3 className="text-base font-medium text-gray-900 dark:text-white">
              {contracts.length === 0 ? 'Договоров лизинга ещё нет' : 'Договоры не найдены'}
            </h3>
            <p className="mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">
              Добавьте договор, чтобы видеть ближайшие обязательства и просрочки по лизингу.
            </p>
          </div>
        )}
      </div>

      <FilterDialog
        open={showFilters}
        onOpenChange={setShowFilters}
        title="Фильтры лизинга"
        description="Отберите договоры по статусу, компании, технике и просрочкам."
        onReset={() => {
          setSearch('');
          setStatusFilter('all');
          setCompanyFilter('all');
          setEquipmentFilter('all');
          setOverdueOnly(false);
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <FilterField label="Статус">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="app-filter-input">
              <option value="all">Все статусы</option>
              {STATUS_OPTIONS.map(status => <option key={status} value={status}>{LEASING_STATUS_LABELS[status]}</option>)}
            </select>
          </FilterField>
          <FilterField label="Лизинговая компания">
            <select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)} className="app-filter-input">
              <option value="all">Все компании</option>
              {companies.map(company => <option key={company} value={company}>{company}</option>)}
            </select>
          </FilterField>
          <FilterField label="Техника">
            <select value={equipmentFilter} onChange={(event) => setEquipmentFilter(event.target.value)} className="app-filter-input">
              <option value="all">Вся техника</option>
              {equipmentList.map(item => <option key={item.id} value={item.id}>{equipmentLabel(item)}</option>)}
            </select>
          </FilterField>
          <FilterField label="Просрочка">
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
              <input type="checkbox" checked={overdueOnly} onChange={(event) => setOverdueOnly(event.target.checked)} />
              Только с просрочкой
            </label>
          </FilterField>
        </div>
      </FilterDialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editingContract ? 'Редактировать договор лизинга' : 'Новый договор лизинга'}</DialogTitle>
            <DialogDescription>
              Договор отражает обязательства компании и не влияет на входящие платежи клиентов.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSubmit}>
            {formError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {formError}
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <FieldLabel required>Номер договора</FieldLabel>
                <Input value={form.contractNumber} onChange={(event) => setField('contractNumber', event.target.value)} />
              </div>
              <div>
                <FieldLabel required>Лизинговая компания</FieldLabel>
                <Input value={form.leasingCompany} onChange={(event) => setField('leasingCompany', event.target.value)} />
              </div>
              <div className="md:col-span-2">
                <FieldLabel>Техника</FieldLabel>
                <select value={form.equipmentId} onChange={(event) => setField('equipmentId', event.target.value)} className="app-filter-input">
                  <option value="">Не привязана</option>
                  {equipmentList.map(item => <option key={item.id} value={item.id}>{equipmentLabel(item)}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel required>Дата начала</FieldLabel>
                <Input type="date" value={form.startDate} onChange={(event) => setField('startDate', event.target.value)} />
              </div>
              <div>
                <FieldLabel required>Дата окончания</FieldLabel>
                <Input type="date" value={form.endDate} onChange={(event) => setField('endDate', event.target.value)} />
              </div>
              <div>
                <FieldLabel required>Срок, месяцев</FieldLabel>
                <Input type="number" min={1} value={form.termMonths} onChange={(event) => setField('termMonths', event.target.value)} />
              </div>
              <div>
                <FieldLabel required>День платежа</FieldLabel>
                <Input type="number" min={1} max={31} value={form.paymentDay} onChange={(event) => setField('paymentDay', event.target.value)} />
              </div>
              <div>
                <FieldLabel required>Ежемесячный платёж</FieldLabel>
                <Input inputMode="decimal" value={form.monthlyPayment} onChange={(event) => setField('monthlyPayment', event.target.value)} />
              </div>
              <div>
                <FieldLabel>Авансовый платёж</FieldLabel>
                <Input inputMode="decimal" value={form.initialPayment} onChange={(event) => setField('initialPayment', event.target.value)} />
              </div>
              <div>
                <FieldLabel>Выкупной платёж</FieldLabel>
                <Input inputMode="decimal" value={form.buyoutPayment} onChange={(event) => setField('buyoutPayment', event.target.value)} />
              </div>
              <div>
                <FieldLabel>Общая сумма договора</FieldLabel>
                <Input inputMode="decimal" value={form.totalAmount} onChange={(event) => setField('totalAmount', event.target.value)} />
              </div>
              <div>
                <FieldLabel>Ставка, %</FieldLabel>
                <Input inputMode="decimal" value={form.interestRate} onChange={(event) => setField('interestRate', event.target.value)} />
              </div>
              <div>
                <FieldLabel>Источник оплаты</FieldLabel>
                <Input value={form.paymentSource} onChange={(event) => setField('paymentSource', event.target.value)} />
              </div>
              <div>
                <FieldLabel>Статус</FieldLabel>
                <select value={form.status} onChange={(event) => setField('status', event.target.value as LeasingContractStatus)} className="app-filter-input">
                  {STATUS_OPTIONS.map(status => <option key={status} value={status}>{LEASING_STATUS_LABELS[status]}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <FieldLabel>Комментарий</FieldLabel>
                <Textarea rows={3} value={form.comment} onChange={(event) => setField('comment', event.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Отмена</Button>
              <Button type="submit" disabled={isSaving}>{isSaving ? 'Сохранение...' : 'Сохранить'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet open={Boolean(selectedContract)} onOpenChange={(open) => !open && setSelectedContract(null)}>
        <SheetContent className="w-[min(100vw,46rem)] overflow-y-auto sm:max-w-2xl">
          {selectedContract && (
            <>
              <SheetHeader>
                <SheetTitle>Договор {selectedContract.contractNumber}</SheetTitle>
                <SheetDescription>{selectedContract.leasingCompany}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Card><CardContent className="p-4"><p className="text-sm text-gray-500">Ближайший платёж</p><p className="mt-1 font-semibold">{selectedContract.nextPaymentDate ? formatDate(selectedContract.nextPaymentDate) : '—'}</p></CardContent></Card>
                  <Card><CardContent className="p-4"><p className="text-sm text-gray-500">Остаток</p><p className="mt-1 font-semibold">{formatCurrency(selectedContract.remainingAmount || 0)}</p></CardContent></Card>
                  <Card><CardContent className="p-4"><p className="text-sm text-gray-500">Ежемесячно</p><p className="mt-1 font-semibold">{formatCurrency(selectedContract.monthlyPayment)}</p></CardContent></Card>
                  <Card><CardContent className="p-4"><p className="text-sm text-gray-500">Статус</p><Badge className="mt-1" variant={statusVariant(selectedContract.status)}>{LEASING_STATUS_LABELS[selectedContract.status]}</Badge></CardContent></Card>
                </div>
                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <h3 className="font-semibold text-gray-900 dark:text-white">Основные данные</h3>
                  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-gray-500">Техника</dt><dd className="font-medium">{selectedContract.equipmentName || 'Не привязана'}</dd></div>
                    <div><dt className="text-gray-500">Срок</dt><dd className="font-medium">{formatDate(selectedContract.startDate)} — {formatDate(selectedContract.endDate)}</dd></div>
                    <div><dt className="text-gray-500">Всего</dt><dd className="font-medium">{formatCurrency(selectedContract.totalAmount || 0)}</dd></div>
                    <div><dt className="text-gray-500">Оплачено</dt><dd className="font-medium">{formatCurrency(selectedContract.paidAmount || 0)}</dd></div>
                  </dl>
                  {selectedContract.comment && <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">{selectedContract.comment}</p>}
                </div>
                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <h3 className="font-semibold text-gray-900 dark:text-white">График платежей</h3>
                  <div className="mt-3 max-h-80 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Дата</TableHead>
                          <TableHead>Сумма</TableHead>
                          <TableHead>Статус</TableHead>
                          <TableHead>Оплачено</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(selectedContract.schedule || []).slice(0, 48).map(row => (
                          <TableRow key={row.id} className={row.status === 'overdue' ? 'bg-red-50/70 dark:bg-red-950/20' : undefined}>
                            <TableCell>{formatDate(row.dueDate)}</TableCell>
                            <TableCell>{formatCurrency(row.amount)}</TableCell>
                            <TableCell><Badge variant={row.status === 'overdue' ? 'danger' : row.status === 'paid' ? 'success' : 'default'}>{row.status === 'planned' ? 'План' : row.status === 'paid' ? 'Оплачен' : row.status === 'skipped' ? 'Пропущен' : 'Просрочен'}</Badge></TableCell>
                            <TableCell>{formatCurrency(row.paidAmount || 0)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
