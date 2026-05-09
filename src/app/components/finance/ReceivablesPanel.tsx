import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  CheckCircle2,
  FileText,
  MessageSquare,
  Phone,
  Scale,
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Textarea } from '../ui/textarea';
import { financeService } from '../../services/finance.service';
import { formatCurrency, formatDate } from '../../lib/utils';
import type {
  ReceivableActionType,
  ReceivableCollectionAction,
  ReceivableCollectionStatus,
  ReceivablePaymentPlanItem,
  ReceivableRow,
} from '../../types';

const QUERY_KEY = ['finance', 'receivables'] as const;

const STATUS_LABELS: Record<ReceivableCollectionStatus, string> = {
  new: 'Новый',
  in_work: 'В работе',
  promised: 'Обещал оплату',
  payment_plan: 'План погашения',
  overdue_promise: 'Обещание нарушено',
  escalated: 'Эскалация',
  closed: 'Закрыт',
  disputed: 'Спор',
};

const ACTION_LABELS: Record<ReceivableActionType, string> = {
  call: 'Звонок',
  message: 'Сообщение',
  email: 'Письмо',
  meeting: 'Встреча',
  legal_notice: 'Претензия',
  payment_promise: 'Обещание оплаты',
  payment_plan: 'План погашения',
  escalation: 'Эскалация',
  comment: 'Комментарий',
};

type SortKey = 'debt' | 'overdue' | 'nextAction' | 'lastContact';
type AgeFilter = 'all' | '0_7' | '8_30' | '31_60' | '60_plus';

type ActionFormState = {
  actionType: ReceivableActionType;
  status: 'planned' | 'done' | 'missed' | 'cancelled';
  actionDate: string;
  nextActionDate: string;
  promisedPaymentDate: string;
  promisedAmount: string;
  comment: string;
};

type PaymentPlanFormState = {
  paymentDate: string;
  amount: string;
  status: 'planned' | 'paid' | 'missed' | 'cancelled';
  comment: string;
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function emptyActionForm(type: ReceivableActionType): ActionFormState {
  return {
    actionType: type,
    status: type === 'comment' || type === 'payment_promise' || type === 'escalation' ? 'done' : 'planned',
    actionDate: todayKey(),
    nextActionDate: '',
    promisedPaymentDate: '',
    promisedAmount: '',
    comment: '',
  };
}

function statusVariant(status: ReceivableCollectionStatus) {
  if (status === 'closed') return 'success';
  if (status === 'overdue_promise' || status === 'escalated') return 'danger';
  if (status === 'promised' || status === 'payment_plan') return 'info';
  if (status === 'disputed') return 'warning';
  return 'default';
}

function ageMatches(row: ReceivableRow, filter: AgeFilter) {
  if (filter === 'all') return true;
  const days = row.oldestOverdueDays || 0;
  if (filter === '0_7') return days <= 7;
  if (filter === '8_30') return days >= 8 && days <= 30;
  if (filter === '31_60') return days >= 31 && days <= 60;
  return days > 60;
}

function compareDate(left?: string, right?: string) {
  return String(left || '9999-12-31').localeCompare(String(right || '9999-12-31'));
}

function KpiCard({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-gray-500 dark:text-gray-400">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-xl font-semibold text-gray-900 dark:text-white">{value}</div>
      </CardContent>
    </Card>
  );
}

export function ReceivablesPanel({ canManageFinance }: { canManageFinance: boolean }) {
  const queryClient = useQueryClient();
  const [selectedRow, setSelectedRow] = React.useState<ReceivableRow | null>(null);
  const [actionRow, setActionRow] = React.useState<ReceivableRow | null>(null);
  const [planRow, setPlanRow] = React.useState<ReceivableRow | null>(null);
  const [actionForm, setActionForm] = React.useState<ActionFormState>(() => emptyActionForm('call'));
  const [planForm, setPlanForm] = React.useState<PaymentPlanFormState>({
    paymentDate: todayKey(),
    amount: '',
    status: 'planned',
    comment: '',
  });
  const [query, setQuery] = React.useState('');
  const [manager, setManager] = React.useState('all');
  const [age, setAge] = React.useState<AgeFilter>('all');
  const [status, setStatus] = React.useState<'all' | ReceivableCollectionStatus>('all');
  const [onlyOverdue, setOnlyOverdue] = React.useState(true);
  const [onlyNoNext, setOnlyNoNext] = React.useState(false);
  const [onlyPromised, setOnlyPromised] = React.useState(false);
  const [onlyBrokenPromise, setOnlyBrokenPromise] = React.useState(false);
  const [onlyPlan, setOnlyPlan] = React.useState(false);
  const [sort, setSort] = React.useState<SortKey>('debt');

  const receivables = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => financeService.getReceivables(),
    staleTime: 1000 * 60,
  });
  const rows = receivables.data?.rows ?? [];
  const summary = receivables.data?.summary;
  const managers = React.useMemo(
    () => Array.from(new Set(rows.map(row => row.manager).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru')),
    [rows],
  );

  const createAction = useMutation({
    mutationFn: (payload: Omit<ReceivableCollectionAction, 'id' | 'createdAt' | 'updatedAt'>) =>
      financeService.createReceivableAction(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setActionRow(null);
    },
  });

  const createPlan = useMutation({
    mutationFn: (payload: Omit<ReceivablePaymentPlanItem, 'id' | 'createdAt' | 'updatedAt'>) =>
      financeService.createReceivablePaymentPlan(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setPlanRow(null);
    },
  });

  const filteredRows = React.useMemo(() => {
    const textQuery = query.trim().toLowerCase();
    return rows
      .filter(row => !textQuery || `${row.client} ${row.inn || ''} ${row.manager}`.toLowerCase().includes(textQuery))
      .filter(row => manager === 'all' || row.manager === manager)
      .filter(row => status === 'all' || row.collectionStatus === status)
      .filter(row => ageMatches(row, age))
      .filter(row => !onlyOverdue || row.overdueDebt > 0)
      .filter(row => !onlyNoNext || row.noNextAction)
      .filter(row => !onlyPromised || row.collectionStatus === 'promised' || Boolean(row.promisedPaymentDate))
      .filter(row => !onlyBrokenPromise || row.collectionStatus === 'overdue_promise')
      .filter(row => !onlyPlan || row.hasPaymentPlan)
      .sort((left, right) => {
        if (sort === 'overdue') return right.oldestOverdueDays - left.oldestOverdueDays;
        if (sort === 'nextAction') return compareDate(left.nextActionDate, right.nextActionDate);
        if (sort === 'lastContact') return compareDate(right.lastContactDate, left.lastContactDate);
        return right.totalDebt - left.totalDebt;
      });
  }, [age, manager, onlyBrokenPromise, onlyNoNext, onlyOverdue, onlyPlan, onlyPromised, query, rows, sort, status]);

  const openAction = (row: ReceivableRow, type: ReceivableActionType) => {
    setActionRow(row);
    setActionForm(emptyActionForm(type));
  };

  const submitAction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!actionRow) return;
    const promisedAmount = Number(actionForm.promisedAmount);
    await createAction.mutateAsync({
      clientId: actionRow.clientId,
      actionType: actionForm.actionType,
      status: actionForm.status,
      actionDate: actionForm.actionDate,
      nextActionDate: actionForm.nextActionDate || undefined,
      promisedPaymentDate: actionForm.promisedPaymentDate || undefined,
      promisedAmount: Number.isFinite(promisedAmount) && promisedAmount > 0 ? promisedAmount : undefined,
      comment: actionForm.comment.trim() || undefined,
    });
  };

  const submitPlan = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!planRow) return;
    const amount = Number(planForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    await createPlan.mutateAsync({
      clientId: planRow.clientId,
      paymentDate: planForm.paymentDate,
      amount,
      status: planForm.status,
      comment: planForm.comment.trim() || undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard title="Общая дебиторка" value={formatCurrency(summary?.totalDebt || 0)} />
        <KpiCard title="Просрочено" value={formatCurrency(summary?.overdueDebt || 0)} />
        <KpiCard title="0-7 дней" value={formatCurrency(summary?.age0_7 || 0)} />
        <KpiCard title="8-30 дней" value={formatCurrency(summary?.age8_30 || 0)} />
        <KpiCard title="31-60 дней" value={formatCurrency(summary?.age31_60 || 0)} />
        <KpiCard title="60+ дней" value={formatCurrency(summary?.age60Plus || 0)} />
        <KpiCard title="Клиентов с долгом" value={summary?.clientsWithDebt || 0} />
        <KpiCard title="Без следующего действия" value={summary?.withoutNextAction || 0} />
        <KpiCard title="Обещано оплатить" value={formatCurrency(summary?.promisedAmount || 0)} />
        <KpiCard title="На плане погашения" value={formatCurrency(summary?.paymentPlanAmount || 0)} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <CardTitle>Дебиторка</CardTitle>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Клиенты, просрочки, действия взыскания и обещания оплаты.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <Input placeholder="Клиент, ИНН, менеджер" value={query} onChange={(event) => setQuery(event.target.value)} />
              <Select value={manager} onValueChange={setManager}>
                <SelectTrigger><SelectValue placeholder="Менеджер" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все менеджеры</SelectItem>
                  {managers.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={age} onValueChange={(value) => setAge(value as AgeFilter)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Любой возраст</SelectItem>
                  <SelectItem value="0_7">0-7 дней</SelectItem>
                  <SelectItem value="8_30">8-30 дней</SelectItem>
                  <SelectItem value="31_60">31-60 дней</SelectItem>
                  <SelectItem value="60_plus">60+ дней</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="debt">Сумма долга</SelectItem>
                  <SelectItem value="overdue">Дни просрочки</SelectItem>
                  <SelectItem value="nextAction">Следующее действие</SelectItem>
                  <SelectItem value="lastContact">Последний контакт</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 pt-2 text-sm text-gray-600 dark:text-gray-300">
            <label className="flex items-center gap-2"><input type="checkbox" checked={onlyOverdue} onChange={e => setOnlyOverdue(e.target.checked)} /> Только просроченные</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={onlyNoNext} onChange={e => setOnlyNoNext(e.target.checked)} /> Без следующего действия</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={onlyPromised} onChange={e => setOnlyPromised(e.target.checked)} /> С обещанием</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={onlyBrokenPromise} onChange={e => setOnlyBrokenPromise(e.target.checked)} /> Обещание нарушено</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={onlyPlan} onChange={e => setOnlyPlan(e.target.checked)} /> С планом</label>
            <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
              <SelectTrigger className="h-8 w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Менеджер</TableHead>
                  <TableHead className="text-right">Долг</TableHead>
                  <TableHead className="text-right">Просрочено</TableHead>
                  <TableHead>Аренды / УПД</TableHead>
                  <TableHead>Контакт</TableHead>
                  <TableHead>Следующее действие</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Обещание</TableHead>
                  <TableHead className="min-w-[220px]">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map(row => (
                  <TableRow
                    key={row.clientId || row.client}
                    className={row.collectionStatus === 'overdue_promise' || row.noNextAction ? 'bg-red-50/60 dark:bg-red-950/20' : undefined}
                    onClick={() => setSelectedRow(row)}
                  >
                    <TableCell>
                      <div className="min-w-44">
                        <p className="font-medium text-gray-900 dark:text-white">{row.client}</p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{row.inn ? `ИНН ${row.inn}` : 'ИНН не указан'}</p>
                      </div>
                    </TableCell>
                    <TableCell>{row.manager}</TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(row.totalDebt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="font-medium">{formatCurrency(row.overdueDebt)}</div>
                      <div className="text-xs text-gray-500">{row.oldestOverdueDays} дн.</div>
                    </TableCell>
                    <TableCell>{row.rentals.length} / {row.documents.length}</TableCell>
                    <TableCell>{row.lastContactDate ? formatDate(row.lastContactDate) : '—'}</TableCell>
                    <TableCell>
                      <div>{row.nextActionType ? ACTION_LABELS[row.nextActionType] : '—'}</div>
                      <div className={row.noNextAction ? 'text-xs font-medium text-red-600' : 'text-xs text-gray-500'}>{row.nextActionDate ? formatDate(row.nextActionDate) : 'нет даты'}</div>
                    </TableCell>
                    <TableCell><Badge variant={statusVariant(row.collectionStatus)}>{STATUS_LABELS[row.collectionStatus]}</Badge></TableCell>
                    <TableCell>
                      {row.promisedPaymentDate ? (
                        <div>
                          <div>{formatDate(row.promisedPaymentDate)}</div>
                          <div className="text-xs text-gray-500">{formatCurrency(row.promisedAmount || 0)}</div>
                        </div>
                      ) : '—'}
                    </TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      {canManageFinance ? (
                        <div className="flex flex-wrap gap-1.5">
                          <Button size="icon" variant="outline" title="Запланировать звонок" onClick={() => openAction(row, 'call')}><Phone className="h-4 w-4" /></Button>
                          <Button size="icon" variant="outline" title="Зафиксировать контакт" onClick={() => openAction(row, 'message')}><MessageSquare className="h-4 w-4" /></Button>
                          <Button size="icon" variant="outline" title="Клиент обещал оплату" onClick={() => openAction(row, 'payment_promise')}><CheckCircle2 className="h-4 w-4" /></Button>
                          <Button size="icon" variant="outline" title="Создать план погашения" onClick={() => setPlanRow(row)}><CalendarClock className="h-4 w-4" /></Button>
                          <Button size="icon" variant="outline" title="Передать на эскалацию" onClick={() => openAction(row, 'escalation')}><Scale className="h-4 w-4" /></Button>
                          <Button size="icon" variant="outline" title="Добавить комментарий" onClick={() => openAction(row, 'comment')}><FileText className="h-4 w-4" /></Button>
                        </div>
                      ) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {!receivables.isLoading && filteredRows.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              Дебиторка по выбранным фильтрам не найдена.
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={Boolean(selectedRow)} onOpenChange={(open) => !open && setSelectedRow(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-4xl">
          {selectedRow && (
            <div className="space-y-4">
              <SheetHeader>
                <SheetTitle>{selectedRow.client}</SheetTitle>
                <SheetDescription>
                  {selectedRow.contacts?.contact || 'Контакт не указан'} · {selectedRow.contacts?.phone || 'телефон не указан'}
                </SheetDescription>
              </SheetHeader>
              <div className="grid gap-3 sm:grid-cols-3">
                <KpiCard title="Общий долг" value={formatCurrency(selectedRow.totalDebt)} />
                <KpiCard title="Просрочено" value={formatCurrency(selectedRow.overdueDebt)} />
                <KpiCard title="Старшая просрочка" value={`${selectedRow.oldestOverdueDays} дн.`} />
              </div>
              <DetailSection title="Аренды">
                {selectedRow.rentals.map(item => (
                  <div key={item.rentalId} className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                    <div className="flex justify-between gap-3"><b>{item.equipmentInv || item.rentalId}</b><b>{formatCurrency(item.outstanding)}</b></div>
                    <div className="mt-1 text-gray-500">{formatDate(item.startDate)} - {formatDate(item.endDate)} · просрочка {item.overdueDays} дн.</div>
                  </div>
                ))}
              </DetailSection>
              <DetailSection title="Платежи">
                {selectedRow.payments.length === 0 ? <EmptyLine /> : selectedRow.payments.map(item => (
                  <div key={item.id} className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                    <div className="flex justify-between gap-3"><span>{item.invoiceNumber || item.id}</span><b>{formatCurrency(item.paidAmount)} / {formatCurrency(item.amount)}</b></div>
                    <div className="mt-1 text-gray-500">{item.status || 'без статуса'} · {item.dueDate ? formatDate(item.dueDate) : 'без срока'}</div>
                  </div>
                ))}
              </DetailSection>
              <DetailSection title="Документы / УПД">
                {selectedRow.documents.length === 0 ? <EmptyLine /> : selectedRow.documents.map((item, index) => (
                  <div key={item.id || index} className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                    {item.type || 'Документ'} {item.number || ''} · {item.date ? formatDate(item.date) : 'без даты'} · {item.amount ? formatCurrency(item.amount) : 'без суммы'}
                  </div>
                ))}
              </DetailSection>
              <DetailSection title="История взыскания">
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {selectedRow.actions.length === 0 ? <EmptyLine /> : selectedRow.actions.map(item => (
                    <div key={item.id} className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                      <div className="flex justify-between gap-3"><b>{ACTION_LABELS[item.actionType]}</b><span>{formatDate(item.actionDate)}</span></div>
                      <div className="mt-1 text-gray-600 dark:text-gray-300">{item.comment || 'Без комментария'}</div>
                    </div>
                  ))}
                </div>
              </DetailSection>
              <DetailSection title="План погашения">
                {selectedRow.paymentPlans.length === 0 ? <EmptyLine /> : selectedRow.paymentPlans.map(item => (
                  <div key={item.id} className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                    <div className="flex justify-between gap-3"><span>{formatDate(item.paymentDate)}</span><b>{formatCurrency(item.amount)}</b></div>
                    <div className="mt-1 text-gray-500">{item.status} · {item.comment || 'без комментария'}</div>
                  </div>
                ))}
              </DetailSection>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={Boolean(actionRow)} onOpenChange={(open) => !open && setActionRow(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>{actionRow ? `${ACTION_LABELS[actionForm.actionType]}: ${actionRow.client}` : 'Действие'}</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={submitAction}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select value={actionForm.actionType} onValueChange={(value) => setActionForm(current => ({ ...current, actionType: value as ReceivableActionType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(ACTION_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={actionForm.status} onValueChange={(value) => setActionForm(current => ({ ...current, status: value as ActionFormState['status'] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="planned">Запланировано</SelectItem>
                  <SelectItem value="done">Выполнено</SelectItem>
                  <SelectItem value="missed">Пропущено</SelectItem>
                  <SelectItem value="cancelled">Отменено</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" value={actionForm.actionDate} onChange={e => setActionForm(current => ({ ...current, actionDate: e.target.value }))} />
              <Input type="date" value={actionForm.nextActionDate} onChange={e => setActionForm(current => ({ ...current, nextActionDate: e.target.value }))} />
              <Input type="date" value={actionForm.promisedPaymentDate} onChange={e => setActionForm(current => ({ ...current, promisedPaymentDate: e.target.value }))} />
              <Input type="number" min="0" step="1" placeholder="Обещанная сумма" value={actionForm.promisedAmount} onChange={e => setActionForm(current => ({ ...current, promisedAmount: e.target.value }))} />
            </div>
            <Textarea rows={3} placeholder="Комментарий" value={actionForm.comment} onChange={e => setActionForm(current => ({ ...current, comment: e.target.value }))} />
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setActionRow(null)}>Отмена</Button>
              <Button type="submit" disabled={createAction.isPending}>{createAction.isPending ? 'Сохраняем...' : 'Сохранить'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(planRow)} onOpenChange={(open) => !open && setPlanRow(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{planRow ? `План погашения: ${planRow.client}` : 'План погашения'}</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={submitPlan}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input type="date" value={planForm.paymentDate} onChange={e => setPlanForm(current => ({ ...current, paymentDate: e.target.value }))} />
              <Input type="number" min="1" step="1" placeholder="Сумма платежа" value={planForm.amount} onChange={e => setPlanForm(current => ({ ...current, amount: e.target.value }))} />
              <Select value={planForm.status} onValueChange={(value) => setPlanForm(current => ({ ...current, status: value as PaymentPlanFormState['status'] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="planned">Запланирован</SelectItem>
                  <SelectItem value="paid">Оплачен</SelectItem>
                  <SelectItem value="missed">Просрочен</SelectItem>
                  <SelectItem value="cancelled">Отменён</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Textarea rows={3} placeholder="Комментарий" value={planForm.comment} onChange={e => setPlanForm(current => ({ ...current, comment: e.target.value }))} />
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setPlanRow(null)}>Отмена</Button>
              <Button type="submit" disabled={createPlan.isPending || !planForm.amount}>{createPlan.isPending ? 'Сохраняем...' : 'Добавить платёж'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      {children}
    </section>
  );
}

function EmptyLine() {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
      Нет данных.
    </div>
  );
}
