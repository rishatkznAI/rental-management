import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  ExternalLink,
  FileText,
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
  ReceivableCollectionStage,
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
  generate_notification: 'Сформировать уведомление',
  send_notification: 'Уведомление отправлено',
  generate_pretrial_claim: 'Сформировать претензию',
  send_pretrial_claim: 'Претензия отправлена',
  court_preparing: 'Подготовка в суд',
  schedule_court: 'Суд назначен',
  court_stage_update: 'Этап суда',
  court_decision: 'Решение суда',
  receive_writ: 'Исполнительный лист',
  send_to_enforcement: 'Передано на исполнение',
  enforcement_update: 'Исполнительное производство',
  debt_recovered: 'Взыскано',
  write_off: 'Списано',
  comment: 'Комментарий',
};

const STAGE_LABELS: Record<ReceivableCollectionStage, string> = {
  new_debt: 'Долг выявлен',
  notification_draft: 'Уведомление сформировано',
  notification_sent: 'Уведомление отправлено',
  notification_waiting: 'Ожидание оплаты',
  pretrial_claim_draft: 'Претензия сформирована',
  pretrial_claim_sent: 'Претензия отправлена',
  pretrial_waiting: 'Ожидание по претензии',
  court_preparing: 'Подготовка в суд',
  court_scheduled: 'Суд назначен',
  court_stage_1: 'Суд — этап 1',
  court_stage_2: 'Суд — этап 2',
  court_stage_3: 'Суд — этап 3',
  court_decision_received: 'Решение получено',
  writ_received: 'Исполнительный лист',
  enforcement_sent: 'Передано на исполнение',
  enforcement_in_progress: 'Исполнительное производство',
  recovered: 'Взыскано',
  closed: 'Закрыто',
  written_off: 'Списано',
  disputed: 'Спор',
};

const STAGE_FLOW: ReceivableCollectionStage[] = [
  'new_debt',
  'notification_draft',
  'notification_waiting',
  'pretrial_claim_draft',
  'pretrial_waiting',
  'court_preparing',
  'court_scheduled',
  'court_stage_1',
  'court_stage_2',
  'court_stage_3',
  'court_decision_received',
  'writ_received',
  'enforcement_sent',
  'enforcement_in_progress',
  'recovered',
];

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

type WorkflowFormState = {
  actionType: ReceivableActionType;
  toStage: ReceivableCollectionStage;
  actionDate: string;
  dueDate: string;
  sendMethod: 'email' | 'messenger' | 'paper' | 'courier' | 'other';
  sentTo: string;
  courtName: string;
  caseNumber: string;
  claimAmount: string;
  courtDate: string;
  nextCourtDate: string;
  decisionDate: string;
  decisionAmount: string;
  decisionStatus: 'won' | 'partially_won' | 'lost' | 'postponed' | 'settlement' | 'unknown';
  writNumber: string;
  writDate: string;
  writAmount: string;
  bailiffDepartment: string;
  enforcementNumber: string;
  enforcementStatus: string;
  recoveredAmount: string;
  remainingAmount: string;
  nextControlDate: string;
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

function defaultWorkflowForm(actionType: ReceivableActionType, toStage: ReceivableCollectionStage): WorkflowFormState {
  return {
    actionType,
    toStage,
    actionDate: todayKey(),
    dueDate: '',
    sendMethod: 'email',
    sentTo: '',
    courtName: '',
    caseNumber: '',
    claimAmount: '',
    courtDate: '',
    nextCourtDate: '',
    decisionDate: '',
    decisionAmount: '',
    decisionStatus: 'unknown',
    writNumber: '',
    writDate: '',
    writAmount: '',
    bailiffDepartment: '',
    enforcementNumber: '',
    enforcementStatus: '',
    recoveredAmount: '',
    remainingAmount: '',
    nextControlDate: '',
    comment: '',
  };
}

function nextWorkflowActions(stage: ReceivableCollectionStage = 'new_debt') {
  if (stage === 'new_debt') return [{ type: 'generate_notification' as const, stage: 'notification_draft' as const }];
  if (stage === 'notification_draft') return [{ type: 'send_notification' as const, stage: 'notification_waiting' as const }];
  if (stage === 'notification_sent' || stage === 'notification_waiting') return [{ type: 'generate_pretrial_claim' as const, stage: 'pretrial_claim_draft' as const }];
  if (stage === 'pretrial_claim_draft') return [{ type: 'send_pretrial_claim' as const, stage: 'pretrial_waiting' as const }];
  if (stage === 'pretrial_claim_sent' || stage === 'pretrial_waiting') return [{ type: 'court_preparing' as const, stage: 'court_preparing' as const }];
  if (stage === 'court_preparing') return [{ type: 'schedule_court' as const, stage: 'court_scheduled' as const }];
  if (stage === 'court_scheduled') return [{ type: 'court_stage_update' as const, stage: 'court_stage_1' as const }, { type: 'court_decision' as const, stage: 'court_decision_received' as const }];
  if (stage === 'court_stage_1') return [{ type: 'court_stage_update' as const, stage: 'court_stage_2' as const }, { type: 'court_decision' as const, stage: 'court_decision_received' as const }];
  if (stage === 'court_stage_2') return [{ type: 'court_stage_update' as const, stage: 'court_stage_3' as const }, { type: 'court_decision' as const, stage: 'court_decision_received' as const }];
  if (stage === 'court_stage_3') return [{ type: 'court_decision' as const, stage: 'court_decision_received' as const }];
  if (stage === 'court_decision_received') return [{ type: 'receive_writ' as const, stage: 'writ_received' as const }];
  if (stage === 'writ_received') return [{ type: 'send_to_enforcement' as const, stage: 'enforcement_sent' as const }];
  if (stage === 'enforcement_sent') return [{ type: 'enforcement_update' as const, stage: 'enforcement_in_progress' as const }];
  if (stage === 'enforcement_in_progress') return [{ type: 'debt_recovered' as const, stage: 'recovered' as const }, { type: 'write_off' as const, stage: 'written_off' as const }];
  return [];
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

function lastPaymentDate(row: ReceivableRow): string {
  return (row.payments || [])
    .map(payment => payment.paidDate)
    .filter(Boolean)
    .sort()
    .at(-1) || '';
}

function primaryRental(row: ReceivableRow) {
  return (row.rentals || [])
    .slice()
    .sort((left, right) => (right.outstanding || 0) - (left.outstanding || 0) || (right.overdueDays || 0) - (left.overdueDays || 0))[0];
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
  const [workflowRow, setWorkflowRow] = React.useState<ReceivableRow | null>(null);
  const [actionForm, setActionForm] = React.useState<ActionFormState>(() => emptyActionForm('call'));
  const [workflowForm, setWorkflowForm] = React.useState<WorkflowFormState>(() => defaultWorkflowForm('generate_notification', 'notification_draft'));
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
  const [stage, setStage] = React.useState<'all' | ReceivableCollectionStage>('all');
  const [onlyOverdue, setOnlyOverdue] = React.useState(false);
  const [onlyNoNext, setOnlyNoNext] = React.useState(false);
  const [onlyPromised, setOnlyPromised] = React.useState(false);
  const [onlyBrokenPromise, setOnlyBrokenPromise] = React.useState(false);
  const [onlyPlan, setOnlyPlan] = React.useState(false);
  const [onlyNoNotification, setOnlyNoNotification] = React.useState(false);
  const [onlyNotificationOverdue, setOnlyNotificationOverdue] = React.useState(false);
  const [onlyPretrialOverdue, setOnlyPretrialOverdue] = React.useState(false);
  const [onlyCourtScheduled, setOnlyCourtScheduled] = React.useState(false);
  const [onlyWrit, setOnlyWrit] = React.useState(false);
  const [onlyEnforcement, setOnlyEnforcement] = React.useState(false);
  const [onlyRecovered, setOnlyRecovered] = React.useState(false);
  const [onlyWrittenOff, setOnlyWrittenOff] = React.useState(false);
  const [onlyOverdueNextAction, setOnlyOverdueNextAction] = React.useState(false);
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

  const createWorkflowAction = useMutation({
    mutationFn: (payload: Partial<ReceivableCollectionAction> & Pick<ReceivableCollectionAction, 'clientId' | 'actionType'>) =>
      financeService.createReceivableWorkflowAction(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setWorkflowRow(null);
      setSelectedRow(null);
    },
  });

  const filteredRows = React.useMemo(() => {
    const textQuery = query.trim().toLowerCase();
    return rows
      .filter(row => !textQuery || `${row.client} ${row.inn || ''} ${row.manager}`.toLowerCase().includes(textQuery))
      .filter(row => manager === 'all' || row.manager === manager)
      .filter(row => status === 'all' || row.collectionStatus === status)
      .filter(row => stage === 'all' || row.collectionStage === stage)
      .filter(row => ageMatches(row, age))
      .filter(row => !onlyOverdue || row.overdueDebt > 0)
      .filter(row => !onlyNoNext || row.noNextAction)
      .filter(row => !onlyPromised || row.collectionStatus === 'promised' || Boolean(row.promisedPaymentDate))
      .filter(row => !onlyBrokenPromise || row.collectionStatus === 'overdue_promise')
      .filter(row => !onlyPlan || row.hasPaymentPlan)
      .filter(row => !onlyNoNotification || row.collectionStage === 'new_debt')
      .filter(row => !onlyNotificationOverdue || row.notificationOverdue)
      .filter(row => !onlyPretrialOverdue || row.pretrialOverdue)
      .filter(row => !onlyCourtScheduled || ['court_scheduled', 'court_stage_1', 'court_stage_2', 'court_stage_3'].includes(row.collectionStage || ''))
      .filter(row => !onlyWrit || row.collectionStage === 'writ_received')
      .filter(row => !onlyEnforcement || ['enforcement_sent', 'enforcement_in_progress'].includes(row.collectionStage || ''))
      .filter(row => !onlyRecovered || row.collectionStage === 'recovered')
      .filter(row => !onlyWrittenOff || row.collectionStage === 'written_off')
      .filter(row => !onlyOverdueNextAction || Boolean(row.nextActionDate && row.nextActionDate < todayKey()))
      .sort((left, right) => {
        if (sort === 'overdue') return right.oldestOverdueDays - left.oldestOverdueDays;
        if (sort === 'nextAction') return compareDate(left.nextActionDate, right.nextActionDate);
        if (sort === 'lastContact') return compareDate(right.lastContactDate, left.lastContactDate);
        return right.totalDebt - left.totalDebt;
      });
  }, [age, manager, onlyBrokenPromise, onlyCourtScheduled, onlyEnforcement, onlyNoNext, onlyNoNotification, onlyNotificationOverdue, onlyOverdue, onlyOverdueNextAction, onlyPlan, onlyPromised, onlyPretrialOverdue, onlyRecovered, onlyWrit, onlyWrittenOff, query, rows, sort, stage, status]);

  const openAction = (row: ReceivableRow, type: ReceivableActionType) => {
    setActionRow(row);
    setActionForm(emptyActionForm(type));
  };

  const openWorkflow = (row: ReceivableRow, type: ReceivableActionType, nextStage: ReceivableCollectionStage) => {
    setWorkflowRow(row);
    setWorkflowForm(defaultWorkflowForm(type, nextStage));
  };

  const openPath = (path: string) => {
    window.location.assign(path);
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

  const submitWorkflow = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!workflowRow?.clientId) return;
    const numeric = (value: string) => {
      const amount = Number(value);
      return Number.isFinite(amount) && amount > 0 ? amount : undefined;
    };
    await createWorkflowAction.mutateAsync({
      clientId: workflowRow.clientId,
      actionType: workflowForm.actionType,
      fromStage: workflowRow.collectionStage || 'new_debt',
      toStage: workflowForm.toStage,
      status: 'done',
      actionDate: workflowForm.actionDate,
      dueDate: workflowForm.dueDate || undefined,
      nextActionDate: workflowForm.nextControlDate || workflowForm.nextCourtDate || undefined,
      sendMethod: workflowForm.sendMethod,
      sentTo: workflowForm.sentTo || undefined,
      courtName: workflowForm.courtName || undefined,
      caseNumber: workflowForm.caseNumber || undefined,
      claimAmount: numeric(workflowForm.claimAmount),
      courtDate: workflowForm.courtDate || undefined,
      nextCourtDate: workflowForm.nextCourtDate || undefined,
      decisionDate: workflowForm.decisionDate || undefined,
      decisionAmount: numeric(workflowForm.decisionAmount),
      decisionStatus: workflowForm.decisionStatus,
      writNumber: workflowForm.writNumber || undefined,
      writDate: workflowForm.writDate || undefined,
      writAmount: numeric(workflowForm.writAmount),
      bailiffDepartment: workflowForm.bailiffDepartment || undefined,
      enforcementNumber: workflowForm.enforcementNumber || undefined,
      enforcementStatus: workflowForm.enforcementStatus || undefined,
      recoveredAmount: numeric(workflowForm.recoveredAmount),
      remainingAmount: numeric(workflowForm.remainingAmount),
      nextControlDate: workflowForm.nextControlDate || undefined,
      comment: workflowForm.comment || undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard title="Общий долг" value={formatCurrency(summary?.totalDebt || 0)} />
        <KpiCard title="Просрочено" value={formatCurrency(summary?.overdueDebt || 0)} />
        <KpiCard title="Долг 0–7 дней" value={formatCurrency(summary?.age0_7 || 0)} />
        <KpiCard title="Долг 8–30 дней" value={formatCurrency(summary?.age8_30 || 0)} />
        <KpiCard title="Долг 31–60 дней" value={formatCurrency(summary?.age31_60 || 0)} />
        <KpiCard title="Долг 60+ дней" value={formatCurrency(summary?.age60Plus || 0)} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <CardTitle>Дебиторка</CardTitle>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Расчёт использует проверенную формулу: начислено по аренде минус фактически полученные оплаты.
              </p>
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
            <Select value={stage} onValueChange={(value) => setStage(value as typeof stage)}>
              <SelectTrigger className="h-8 w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все этапы взыскания</SelectItem>
                {Object.entries(STAGE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2"><input type="checkbox" checked={onlyNoNotification} onChange={e => setOnlyNoNotification(e.target.checked)} /> Без уведомления</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={onlyNotificationOverdue} onChange={e => setOnlyNotificationOverdue(e.target.checked)} /> Уведомление без оплаты</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={onlyPretrialOverdue} onChange={e => setOnlyPretrialOverdue(e.target.checked)} /> Претензия без оплаты</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={onlyCourtScheduled} onChange={e => setOnlyCourtScheduled(e.target.checked)} /> Суд назначен</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={onlyWrit} onChange={e => setOnlyWrit(e.target.checked)} /> Исполнительный лист</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={onlyEnforcement} onChange={e => setOnlyEnforcement(e.target.checked)} /> Приставы</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={onlyRecovered} onChange={e => setOnlyRecovered(e.target.checked)} /> Взыскано</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={onlyWrittenOff} onChange={e => setOnlyWrittenOff(e.target.checked)} /> Списано</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={onlyOverdueNextAction} onChange={e => setOnlyOverdueNextAction(e.target.checked)} /> Просрочено действие</label>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Менеджер</TableHead>
                  <TableHead className="text-right">Сумма долга</TableHead>
                  <TableHead className="text-right">Просрочено дней</TableHead>
                  <TableHead>Последняя оплата</TableHead>
                  <TableHead>Связанная аренда</TableHead>
                  <TableHead>Статус взыскания</TableHead>
                  <TableHead className="min-w-[260px]">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map(row => {
                  const rental = primaryRental(row);
                  const noticeAction = nextWorkflowActions(row.collectionStage || 'new_debt').find(item => item.type === 'generate_notification');
                  const claimAction = nextWorkflowActions(row.collectionStage || 'new_debt').find(item => item.type === 'generate_pretrial_claim');
                  const writeOffAction = nextWorkflowActions(row.collectionStage || 'new_debt').find(item => item.type === 'write_off');
                  return (
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
                        <div className="font-medium">{row.oldestOverdueDays} дн.</div>
                        <div className="text-xs text-gray-500">{formatCurrency(row.overdueDebt)}</div>
                      </TableCell>
                      <TableCell>{lastPaymentDate(row) ? formatDate(lastPaymentDate(row)) : '—'}</TableCell>
                      <TableCell>
                        {rental ? (
                          <div className="min-w-40">
                            <p className="font-medium text-gray-900 dark:text-white">{rental.rentalId}</p>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              {rental.equipmentInv || 'техника не указана'} · {formatCurrency(rental.outstanding)}
                            </p>
                          </div>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="min-w-44">
                          <Badge variant={statusVariant(row.collectionStatus)}>{STATUS_LABELS[row.collectionStatus]}</Badge>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {STAGE_LABELS[row.collectionStage || 'new_debt']}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        {canManageFinance ? (
                          <div className="flex flex-wrap gap-1.5">
                            {row.clientId && (
                              <Button size="icon" variant="outline" title="Открыть клиента" aria-label="Открыть клиента" onClick={() => openPath(`/clients/${row.clientId}`)}>
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            )}
                            {rental?.rentalId && (
                              <Button size="icon" variant="outline" title="Открыть аренду" aria-label="Открыть аренду" onClick={() => openPath(`/rentals/${rental.rentalId}`)}>
                                <CalendarClock className="h-4 w-4" />
                              </Button>
                            )}
                            {noticeAction && (
                              <Button size="sm" variant="secondary" title="Создать уведомление" onClick={() => openWorkflow(row, noticeAction.type, noticeAction.stage)}>
                                Уведомление
                              </Button>
                            )}
                            {claimAction && (
                              <Button size="sm" variant="secondary" title="Создать претензию" onClick={() => openWorkflow(row, claimAction.type, claimAction.stage)}>
                                Претензия
                              </Button>
                            )}
                            <Button size="sm" variant="outline" title="Отметить спор" onClick={() => openAction(row, 'legal_notice')}>
                              Спор
                            </Button>
                            {writeOffAction && (
                              <Button size="sm" variant="outline" title="Закрыть/списать" onClick={() => openWorkflow(row, writeOffAction.type, writeOffAction.stage)}>
                                Списать
                              </Button>
                            )}
                            <Button size="icon" variant="outline" title="Добавить комментарий" onClick={() => openAction(row, 'comment')}>
                              <FileText className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
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
              <DetailSection title="Процесс взыскания">
                <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Текущий этап</p>
                      <p className="text-base font-semibold text-gray-900 dark:text-white">{STAGE_LABELS[selectedRow.collectionStage || 'new_debt']}</p>
                    </div>
                    {canManageFinance ? (
                      <div className="flex flex-wrap gap-2">
                        {nextWorkflowActions(selectedRow.collectionStage || 'new_debt').map(item => (
                          <Button key={`${item.type}:${item.stage}`} size="sm" onClick={() => openWorkflow(selectedRow, item.type, item.stage)}>
                            {ACTION_LABELS[item.type]}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="rounded-md bg-gray-50 p-2 text-sm dark:bg-gray-900/40">Уведомление: {selectedRow.notificationSentDate ? formatDate(selectedRow.notificationSentDate) : 'не отправлено'}</div>
                    <div className="rounded-md bg-gray-50 p-2 text-sm dark:bg-gray-900/40">Претензия: {selectedRow.pretrialClaimSentDate ? formatDate(selectedRow.pretrialClaimSentDate) : 'не отправлена'}</div>
                    <div className="rounded-md bg-gray-50 p-2 text-sm dark:bg-gray-900/40">Суд: {selectedRow.caseNumber || selectedRow.courtDate ? [selectedRow.caseNumber, selectedRow.courtDate && formatDate(selectedRow.courtDate)].filter(Boolean).join(' · ') : 'нет'}</div>
                    <div className="rounded-md bg-gray-50 p-2 text-sm dark:bg-gray-900/40">Исполнительный лист: {selectedRow.writNumber || 'нет'}</div>
                    <div className="rounded-md bg-gray-50 p-2 text-sm dark:bg-gray-900/40">Исполнение: {selectedRow.enforcementNumber || selectedRow.enforcementStatus || 'нет'}</div>
                    <div className="rounded-md bg-gray-50 p-2 text-sm dark:bg-gray-900/40">Взыскано: {formatCurrency(selectedRow.recoveredAmount || 0)}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {STAGE_FLOW.map(stageKey => (
                      <span
                        key={stageKey}
                        className={`rounded-full px-2 py-1 text-xs ${
                          stageKey === (selectedRow.collectionStage || 'new_debt')
                            ? 'bg-lime-200 text-slate-950'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                        }`}
                      >
                        {STAGE_LABELS[stageKey]}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                    Шаблоны уведомления и претензии создаются как рабочие документы и требуют проверки ответственным/юристом перед отправкой.
                  </p>
                </div>
              </DetailSection>
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

      <Dialog open={Boolean(workflowRow)} onOpenChange={(open) => !open && setWorkflowRow(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{workflowRow ? `${ACTION_LABELS[workflowForm.actionType]}: ${workflowRow.client}` : 'Этап взыскания'}</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={submitWorkflow}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                <div className="text-xs text-gray-500">С этапа</div>
                <div className="font-medium">{workflowRow ? STAGE_LABELS[workflowRow.collectionStage || 'new_debt'] : '—'}</div>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                <div className="text-xs text-gray-500">На этап</div>
                <div className="font-medium">{STAGE_LABELS[workflowForm.toStage]}</div>
              </div>
              <Input type="date" value={workflowForm.actionDate} onChange={e => setWorkflowForm(current => ({ ...current, actionDate: e.target.value }))} />
              <Input type="date" value={workflowForm.dueDate} onChange={e => setWorkflowForm(current => ({ ...current, dueDate: e.target.value }))} placeholder="Срок оплаты/ответа" />
            </div>

            {['send_notification', 'send_pretrial_claim'].includes(workflowForm.actionType) ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Select value={workflowForm.sendMethod} onValueChange={(value) => setWorkflowForm(current => ({ ...current, sendMethod: value as WorkflowFormState['sendMethod'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="messenger">Мессенджер</SelectItem>
                    <SelectItem value="paper">Бумага</SelectItem>
                    <SelectItem value="courier">Курьер</SelectItem>
                    <SelectItem value="other">Другое</SelectItem>
                  </SelectContent>
                </Select>
                <Input placeholder="Кому отправлено" value={workflowForm.sentTo} onChange={e => setWorkflowForm(current => ({ ...current, sentTo: e.target.value }))} />
              </div>
            ) : null}

            {['court_preparing', 'schedule_court', 'court_stage_update', 'court_decision'].includes(workflowForm.actionType) ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input placeholder="Суд" value={workflowForm.courtName} onChange={e => setWorkflowForm(current => ({ ...current, courtName: e.target.value }))} />
                <Input placeholder="Номер дела" value={workflowForm.caseNumber} onChange={e => setWorkflowForm(current => ({ ...current, caseNumber: e.target.value }))} />
                <Input type="number" min="0" placeholder="Сумма иска" value={workflowForm.claimAmount} onChange={e => setWorkflowForm(current => ({ ...current, claimAmount: e.target.value }))} />
                <Input type="date" value={workflowForm.courtDate} onChange={e => setWorkflowForm(current => ({ ...current, courtDate: e.target.value }))} />
                <Input type="date" value={workflowForm.nextCourtDate} onChange={e => setWorkflowForm(current => ({ ...current, nextCourtDate: e.target.value }))} />
              </div>
            ) : null}

            {workflowForm.actionType === 'court_decision' ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Input type="date" value={workflowForm.decisionDate} onChange={e => setWorkflowForm(current => ({ ...current, decisionDate: e.target.value }))} />
                <Input type="number" min="0" placeholder="Сумма решения" value={workflowForm.decisionAmount} onChange={e => setWorkflowForm(current => ({ ...current, decisionAmount: e.target.value }))} />
                <Select value={workflowForm.decisionStatus} onValueChange={(value) => setWorkflowForm(current => ({ ...current, decisionStatus: value as WorkflowFormState['decisionStatus'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="won">Выиграно</SelectItem>
                    <SelectItem value="partially_won">Частично</SelectItem>
                    <SelectItem value="lost">Проиграно</SelectItem>
                    <SelectItem value="postponed">Отложено</SelectItem>
                    <SelectItem value="settlement">Мировое</SelectItem>
                    <SelectItem value="unknown">Не указано</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {workflowForm.actionType === 'receive_writ' ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Input placeholder="Номер листа" value={workflowForm.writNumber} onChange={e => setWorkflowForm(current => ({ ...current, writNumber: e.target.value }))} />
                <Input type="date" value={workflowForm.writDate} onChange={e => setWorkflowForm(current => ({ ...current, writDate: e.target.value }))} />
                <Input type="number" min="0" placeholder="Сумма листа" value={workflowForm.writAmount} onChange={e => setWorkflowForm(current => ({ ...current, writAmount: e.target.value }))} />
              </div>
            ) : null}

            {['send_to_enforcement', 'enforcement_update', 'debt_recovered', 'write_off'].includes(workflowForm.actionType) ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input placeholder="Отдел приставов / исполнитель" value={workflowForm.bailiffDepartment} onChange={e => setWorkflowForm(current => ({ ...current, bailiffDepartment: e.target.value }))} />
                <Input placeholder="Номер производства" value={workflowForm.enforcementNumber} onChange={e => setWorkflowForm(current => ({ ...current, enforcementNumber: e.target.value }))} />
                <Input placeholder="Статус исполнения" value={workflowForm.enforcementStatus} onChange={e => setWorkflowForm(current => ({ ...current, enforcementStatus: e.target.value }))} />
                <Input type="date" value={workflowForm.nextControlDate} onChange={e => setWorkflowForm(current => ({ ...current, nextControlDate: e.target.value }))} />
                <Input type="number" min="0" placeholder="Взыскано" value={workflowForm.recoveredAmount} onChange={e => setWorkflowForm(current => ({ ...current, recoveredAmount: e.target.value }))} />
                <Input type="number" min="0" placeholder="Остаток" value={workflowForm.remainingAmount} onChange={e => setWorkflowForm(current => ({ ...current, remainingAmount: e.target.value }))} />
              </div>
            ) : null}

            <Textarea rows={3} placeholder="Комментарий" value={workflowForm.comment} onChange={e => setWorkflowForm(current => ({ ...current, comment: e.target.value }))} />
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setWorkflowRow(null)}>Отмена</Button>
              <Button type="submit" disabled={createWorkflowAction.isPending}>{createWorkflowAction.isPending ? 'Сохраняем...' : 'Сохранить этап'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
