import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarDays, Clock, ExternalLink, Plus, RefreshCw, UserRound, Wrench } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge, getServicePriorityBadge, getServiceStatusBadge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useAuth, type AuthUser } from '../../contexts/AuthContext';
import { isMechanicRole } from '../../lib/userStorage';
import { buildServiceDayPlan, localDateKey } from '../../lib/serviceDayPlan.js';
import type { Mechanic, ServiceTicket } from '../../types';

type DayPlanFilter =
  | 'all'
  | 'mine'
  | 'unassigned'
  | 'overdue'
  | 'high'
  | 'waiting_parts'
  | 'ready';

type DayPlanTask = ReturnType<typeof buildServiceDayPlan>['tasks'][number];

const FILTERS: Array<{ value: DayPlanFilter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'mine', label: 'Только мои' },
  { value: 'unassigned', label: 'Без механика' },
  { value: 'overdue', label: 'Просроченные' },
  { value: 'high', label: 'Высокий приоритет' },
  { value: 'waiting_parts', label: 'Ожидание запчастей' },
  { value: 'ready', label: 'Готово к закрытию' },
];

const STATUS_LABELS: Record<string, string> = {
  free: 'Свободен',
  normal: 'Нормальная загрузка',
  overloaded: 'Перегружен',
  overdue: 'Есть просрочка',
};

const STATUS_TONE: Record<string, string> = {
  free: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  normal: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  overloaded: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  overdue: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
};

function isMineDefault(role: string | undefined) {
  return isMechanicRole(role);
}

function compactText(value: string, max = 96) {
  const normalized = value.trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max).trimEnd()}...`;
}

function normalizeIdentity(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replaceAll('ё', 'е');
}

function dayPlanTaskMatchesCurrentUser(task: DayPlanTask, user: AuthUser | null) {
  if (!user) return false;
  const userKeys = [user.id, user.name, user.email]
    .map(normalizeIdentity)
    .filter(Boolean);
  const taskKeys = [task.mechanicId, task.mechanicName]
    .map(normalizeIdentity)
    .filter(Boolean);
  return taskKeys.some(taskKey => userKeys.includes(taskKey));
}

function taskMatchesFilter(task: DayPlanTask, filter: DayPlanFilter) {
  if (filter === 'all' || filter === 'mine') return true;
  if (filter === 'unassigned') return task.unassigned;
  if (filter === 'overdue') return task.isOverdue;
  if (filter === 'high') return task.isHighPriority;
  if (filter === 'waiting_parts') return task.waitingParts;
  if (filter === 'ready') return task.readyToClose;
  return true;
}

function MetricCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="text-xs font-bold uppercase text-gray-500 dark:text-gray-500">{label}</div>
      <div className={`mt-2 text-3xl font-black leading-none ${tone}`}>{safeValue}</div>
    </div>
  );
}

function TaskRow({
  task,
  canEditService,
  canManageDayPlan,
  currentUser,
}: {
  task: DayPlanTask;
  canEditService: boolean;
  canManageDayPlan: boolean;
  currentUser: AuthUser | null;
}) {
  const dateLabel = task.dueDate || task.planDate || '';
  const canUseAssignedWorkflow = canEditService && (canManageDayPlan || dayPlanTaskMatchesCurrentUser(task, currentUser));
  const canReschedule = canEditService && canManageDayPlan;
  return (
    <div className="border-b border-gray-100 px-3 py-3 last:border-b-0 dark:border-white/8">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-bold text-gray-500 dark:text-gray-400">{task.id}</span>
            {getServicePriorityBadge(task.priority as ServiceTicket['priority'])}
            {getServiceStatusBadge(task.status as ServiceTicket['status'])}
            {task.isOverdue && <Badge variant="error">Просрочено</Badge>}
          </div>
          <div className="mt-2 truncate text-sm font-bold text-gray-900 dark:text-white">{task.equipment}</div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {[task.inventoryNumber ? `INV ${task.inventoryNumber}` : '', task.client, task.rentalId ? `Аренда ${task.rentalId}` : ''].filter(Boolean).join(' · ') || 'Без клиента/аренды'}
          </div>
        </div>
        <Link to={`/service/${task.id}`} title="Открыть заявку" className="shrink-0">
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Открыть заявку ${task.id}`}>
            <ExternalLink className="h-4 w-4" />
          </Button>
        </Link>
      </div>
      <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">{task.reason}</div>
      {task.description && (
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{compactText(task.description)}</div>
      )}
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>{dateLabel ? `Срок: ${dateLabel}` : 'Без даты'}</span>
        {task.location && <span>Объект: {compactText(task.location, 44)}</span>}
        <span>{task.waitingParts ? 'Запчасти ожидаются' : task.hasParts ? 'Запчасти указаны' : 'Запчасти не указаны'}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link to={`/service/${task.id}`}>
          <Button size="sm" variant="secondary">Открыть</Button>
        </Link>
        {(canUseAssignedWorkflow || canReschedule) && (
          <>
            {canUseAssignedWorkflow && (
              <Link to={`/service/${task.id}`}>
                <Button size="sm" variant="outline">Добавить работу</Button>
              </Link>
            )}
            {canUseAssignedWorkflow && (task.status === 'in_progress' || task.status === 'needs_revision') ? (
              <Link to={`/service/${task.id}`}>
                <Button size="sm" variant="outline">Завершить</Button>
              </Link>
            ) : null}
            {canReschedule && (
              <Link to={`/service/${task.id}`}>
                <Button size="sm" variant="outline">Перенести</Button>
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ProblemList({
  title,
  items,
  empty,
  icon,
  canEditService,
  canManageDayPlan,
  currentUser,
}: {
  title: string;
  items: DayPlanTask[];
  empty: string;
  icon: React.ReactNode;
  canEditService: boolean;
  canManageDayPlan: boolean;
  currentUser: AuthUser | null;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-white/8">
        {icon}
        <h3 className="text-sm font-black uppercase text-gray-800 dark:text-white">{title}</h3>
        <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500 dark:bg-white/8 dark:text-gray-300">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">{empty}</div>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          {items.slice(0, 12).map(task => (
            <TaskRow
              key={`${title}-${task.id}`}
              task={task}
              canEditService={canEditService}
              canManageDayPlan={canManageDayPlan}
              currentUser={currentUser}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function ServiceDayPlanBoard({
  tickets,
  mechanics,
  isLoading = false,
  onRefresh,
  canCreateService = false,
  canEditService = false,
  canManageDayPlan = false,
}: {
  tickets: ServiceTicket[];
  mechanics: Mechanic[];
  isLoading?: boolean;
  onRefresh: () => void;
  canCreateService?: boolean;
  canEditService?: boolean;
  canManageDayPlan?: boolean;
}) {
  const { user } = useAuth();
  const today = React.useMemo(() => localDateKey(new Date()), []);
  const [dateMode, setDateMode] = React.useState<'today' | 'tomorrow'>('today');
  const [filter, setFilter] = React.useState<DayPlanFilter>(() => isMineDefault(user?.role) ? 'mine' : 'all');
  const [statusFilter, setStatusFilter] = React.useState<DayPlanFilter>('all');
  const [mechanicFilter, setMechanicFilter] = React.useState('all');
  const targetDate = React.useMemo(() => {
    if (dateMode === 'today') return today;
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return localDateKey(date);
  }, [dateMode, today]);
  const onlyMine = filter === 'mine' || isMineDefault(user?.role);
  const plan = React.useMemo(() => buildServiceDayPlan({
    date: targetDate,
    tickets,
    mechanics,
    currentUser: user,
    onlyMine,
  }), [mechanics, onlyMine, targetDate, tickets, user]);

  const filteredMechanics = React.useMemo(() => plan.mechanics
    .map(mechanic => ({
      ...mechanic,
      tasks: mechanic.tasks.filter(task => taskMatchesFilter(task, filter) && taskMatchesFilter(task, statusFilter)),
    }))
    .filter(mechanic => mechanicFilter === 'all' || mechanic.key === mechanicFilter)
    .filter(mechanic => {
      const hasRestrictiveFilter = !['all', 'mine'].includes(filter) || statusFilter !== 'all';
      return !hasRestrictiveFilter || mechanic.tasks.length > 0 || mechanic.workloadStatus === 'free';
    }), [filter, mechanicFilter, plan.mechanics, statusFilter]);

  const problemTasks = React.useMemo(() => ({
    unassigned: plan.problems.unassigned.filter(task => taskMatchesFilter(task, filter) && taskMatchesFilter(task, statusFilter)),
    overdue: plan.problems.overdue.filter(task => taskMatchesFilter(task, filter) && taskMatchesFilter(task, statusFilter)),
    waitingParts: plan.problems.waitingParts.filter(task => taskMatchesFilter(task, filter) && taskMatchesFilter(task, statusFilter)),
    readyToClose: plan.problems.readyToClose.filter(task => taskMatchesFilter(task, filter) && taskMatchesFilter(task, statusFilter)),
  }), [filter, plan.problems, statusFilter]);

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-gray-500 dark:text-gray-400">
              <CalendarDays className="h-4 w-4" />
              <span>План дня: {plan.displayDate}</span>
            </div>
            <h2 className="mt-1 text-2xl font-black text-gray-900 dark:text-white">Диспетчерская доска</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Задачи механиков на сегодня</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-white/10 dark:bg-white/[0.03]">
              <button type="button" onClick={() => setDateMode('today')} className="app-filter-chip" data-active={String(dateMode === 'today')}>Сегодня</button>
              <button type="button" onClick={() => setDateMode('tomorrow')} className="app-filter-chip" data-active={String(dateMode === 'tomorrow')}>Завтра</button>
            </div>
            <Select value={mechanicFilter} onValueChange={setMechanicFilter}>
              <SelectTrigger className="h-10 w-full rounded-lg sm:w-[220px]">
                <SelectValue placeholder="По механику" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все механики</SelectItem>
                {plan.mechanics.map(mechanic => (
                  <SelectItem key={mechanic.key} value={mechanic.key}>{mechanic.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as DayPlanFilter)}>
              <SelectTrigger className="h-10 w-full rounded-lg sm:w-[220px]">
                <SelectValue placeholder="По статусу" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                <SelectItem value="unassigned">Без механика</SelectItem>
                <SelectItem value="overdue">Просроченные</SelectItem>
                <SelectItem value="waiting_parts">Ожидание запчастей</SelectItem>
                <SelectItem value="ready">Готово к закрытию</SelectItem>
                <SelectItem value="high">Высокий приоритет</SelectItem>
              </SelectContent>
            </Select>
            {canCreateService && (
              <Link to="/service/new">
                <Button type="button" className="h-10 w-full sm:w-auto">
                  <Plus className="h-4 w-4" />
                  Создать заявку
                </Button>
              </Link>
            )}
            <Button type="button" variant="secondary" onClick={onRefresh} disabled={isLoading} className="h-10">
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              Обновить
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {FILTERS.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className="app-filter-chip"
              data-active={String(filter === option.value || (option.value === 'mine' && onlyMine))}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Задач на сегодня" value={plan.metrics.total} tone="text-gray-900 dark:text-white" />
        <MetricCard label="В работе" value={plan.metrics.inProgress} tone="text-blue-500" />
        <MetricCard label="Просроченные" value={plan.metrics.overdue} tone="text-red-500" />
        <MetricCard label="Без механика" value={plan.metrics.unassigned} tone="text-amber-500" />
        <MetricCard label="Готово к закрытию" value={plan.metrics.readyToClose} tone="text-emerald-500" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="grid min-w-0 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {filteredMechanics.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-400">
              По выбранным фильтрам задач нет.
            </div>
          ) : filteredMechanics.map(mechanic => (
            <article key={mechanic.key} className="flex min-h-[360px] min-w-0 flex-col rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-white/[0.03]">
              <div className="border-b border-gray-100 p-4 dark:border-white/8">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <UserRound className="h-4 w-4 shrink-0 text-gray-400" />
                      <h3 className="truncate text-base font-black text-gray-900 dark:text-white">{mechanic.name}</h3>
                    </div>
                    <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{mechanic.role || 'Механик'}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold ${STATUS_TONE[mechanic.workloadStatus]}`}>
                    {STATUS_LABELS[mechanic.workloadStatus]}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-gray-50 p-2 dark:bg-white/[0.04]"><b className="block text-base text-gray-900 dark:text-white">{mechanic.tasksCount}</b>задач</div>
                  <div className="rounded-lg bg-blue-50 p-2 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"><b className="block text-base">{mechanic.tasks.filter(task => ['in_progress', 'needs_revision'].includes(task.status)).length}</b>в работе</div>
                  <div className="rounded-lg bg-orange-50 p-2 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300"><b className="block text-base">{mechanic.tasks.filter(task => task.waitingParts).length}</b>запчасти</div>
                  <div className="rounded-lg bg-red-50 p-2 text-red-700 dark:bg-red-500/10 dark:text-red-300"><b className="block text-base">{mechanic.overdueCount}</b>проср.</div>
                  <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><b className="block text-base">{mechanic.tasks.filter(task => task.readyToClose).length}</b>готово</div>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {mechanic.tasks.length === 0 ? (
                  <div className="flex h-full min-h-[180px] flex-col items-center justify-center px-4 text-center text-sm text-gray-500 dark:text-gray-400">
                    <Wrench className="mb-2 h-8 w-8 text-emerald-500" />
                    Свободен на выбранный день
                  </div>
                ) : mechanic.tasks.map(task => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    canEditService={canEditService}
                    canManageDayPlan={canManageDayPlan}
                    currentUser={user}
                  />
                ))}
              </div>
            </article>
          ))}
        </section>

        <aside className="space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <h2 className="text-lg font-black text-gray-900 dark:text-white">Проблемы дня</h2>
          </div>
          <ProblemList title="Без механика" items={problemTasks.unassigned} empty="Все задачи назначены." icon={<UserRound className="h-4 w-4 text-amber-500" />} canEditService={canEditService} canManageDayPlan={canManageDayPlan} currentUser={user} />
          <ProblemList title="Просроченные" items={problemTasks.overdue} empty="Просрочек нет." icon={<Clock className="h-4 w-4 text-red-500" />} canEditService={canEditService} canManageDayPlan={canManageDayPlan} currentUser={user} />
          <ProblemList title="Ожидают запчасти" items={problemTasks.waitingParts} empty="Нет задач в ожидании запчастей." icon={<Wrench className="h-4 w-4 text-orange-500" />} canEditService={canEditService} canManageDayPlan={canManageDayPlan} currentUser={user} />
          <ProblemList title="Готово к закрытию" items={problemTasks.readyToClose} empty="Нет заявок, готовых к закрытию." icon={<ExternalLink className="h-4 w-4 text-emerald-500" />} canEditService={canEditService} canManageDayPlan={canManageDayPlan} currentUser={user} />
        </aside>
      </div>
    </div>
  );
}
