import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  Filter,
  ListChecks,
  Search,
} from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { formatCurrency, formatDate } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import {
  groupTasksByDueDate,
  normalizeTask,
  taskPriorityLabel,
  taskSectionLabel,
} from '../lib/tasksCenter.js';
import { tasksCenterService, type TaskCenterTask } from '../services/tasks-center.service';

const PRIORITY_OPTIONS = [
  { value: 'all', label: 'Все приоритеты' },
  { value: 'critical', label: 'Критично' },
  { value: 'high', label: 'Высокий' },
  { value: 'medium', label: 'Средний' },
  { value: 'low', label: 'Низкий' },
];

const DUE_OPTIONS = [
  { value: 'all', label: 'Все сроки' },
  { value: 'overdue', label: 'Просрочено' },
  { value: 'today', label: 'Сегодня' },
  { value: 'tomorrow', label: 'Завтра' },
  { value: 'no_due', label: 'Без срока' },
];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysKey(today: string, days: number) {
  const date = new Date(`${today}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function priorityVariant(priority: string) {
  if (priority === 'critical') return 'error';
  if (priority === 'high') return 'warning';
  if (priority === 'low') return 'default';
  return 'info';
}

function dueBucket(task: TaskCenterTask, today: string) {
  const due = task.dueDate || '';
  if (!due) return 'no_due';
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  if (due === addDaysKey(today, 1)) return 'tomorrow';
  return 'other';
}

function taskMatchesSearch(task: TaskCenterTask, query: string) {
  if (!query) return true;
  const haystack = [
    task.title,
    task.description,
    task.clientName,
    task.responsible,
    task.assignedTo,
    taskSectionLabel(task.section),
  ].join(' ').toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export default function TasksCenter() {
  const { user } = useAuth();
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [dueFilter, setDueFilter] = useState('all');
  const [onlyMine, setOnlyMine] = useState(false);
  const [search, setSearch] = useState('');
  const today = todayKey();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['tasks-center'],
    queryFn: tasksCenterService.getAll,
    staleTime: 60_000,
  });

  const tasks = useMemo(
    () => (data?.tasks ?? []).map(normalizeTask) as TaskCenterTask[],
    [data?.tasks],
  );
  const sectionOptions = useMemo(
    () => Array.from(new Set(tasks.map(task => task.section).filter(Boolean)))
      .sort((left, right) => taskSectionLabel(left).localeCompare(taskSectionLabel(right), 'ru')),
    [tasks],
  );
  const visibleTasks = useMemo(
    () => tasks.filter(task => {
      if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
      if (sectionFilter !== 'all' && task.section !== sectionFilter) return false;
      if (dueFilter !== 'all' && dueBucket(task, today) !== dueFilter) return false;
      if (onlyMine) {
        const currentUserKeys = [user?.name, user?.email].map(value => String(value ?? '').trim().toLowerCase()).filter(Boolean);
        const taskKeys = [task.responsible, task.assignedTo].map(value => String(value ?? '').trim().toLowerCase()).filter(Boolean);
        if (currentUserKeys.length === 0 || !taskKeys.some(key => currentUserKeys.includes(key))) return false;
      }
      return taskMatchesSearch(task, search.trim());
    }),
    [dueFilter, onlyMine, priorityFilter, search, sectionFilter, tasks, today, user?.email, user?.name],
  );
  const groupedTasks = useMemo(() => groupTasksByDueDate(visibleTasks, today), [today, visibleTasks]);
  const summary = data?.summary ?? { total: 0, critical: 0, high: 0, overdue: 0, today: 0 };
  const canViewFinance = Boolean(data?.permissions?.canViewFinance);

  if (isLoading) {
    return (
      <div className="page-container py-6">
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Загружаем центр задач...</CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container py-6">
        <Card className="border-red-300 bg-red-50/60 dark:border-red-900/70 dark:bg-red-950/20">
          <CardContent className="space-y-3 p-6">
            <p className="font-semibold text-red-700 dark:text-red-300">Не удалось открыть Центр задач.</p>
            <p className="text-sm text-red-600 dark:text-red-200">Проверьте доступ и состояние backend.</p>
            <Button onClick={() => refetch()} disabled={isFetching}>Повторить</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-container space-y-6 py-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Рабочий контроль</p>
          <h1 className="app-shell-title text-2xl font-extrabold text-foreground">Центр задач</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Единый список вычисленных напоминаний из аренд, документов, сервиса, доставки и планов взыскания. Чтение центра задач не меняет данные.
          </p>
        </div>
        <Button onClick={() => refetch()} disabled={isFetching} variant="secondary">
          {isFetching ? 'Обновляем...' : 'Обновить'}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Всего задач</p>
            <p className="mt-1 text-2xl font-bold">{summary.total}</p>
          </CardContent>
        </Card>
        <Card className={summary.critical > 0 ? 'border-red-300 bg-red-50/50 dark:border-red-900/70 dark:bg-red-950/20' : ''}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Critical</p>
            <p className="mt-1 text-2xl font-bold">{summary.critical}</p>
          </CardContent>
        </Card>
        <Card className={summary.high > 0 ? 'border-amber-300 bg-amber-50/50 dark:border-amber-900/70 dark:bg-amber-950/20' : ''}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">High</p>
            <p className="mt-1 text-2xl font-bold">{summary.high}</p>
          </CardContent>
        </Card>
        <Card className={summary.overdue > 0 ? 'border-red-300 bg-red-50/50 dark:border-red-900/70 dark:bg-red-950/20' : ''}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Просрочено</p>
            <p className="mt-1 text-2xl font-bold">{summary.overdue}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">На сегодня</p>
            <p className="mt-1 text-2xl font-bold">{summary.today}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Filter className="h-4 w-4" />
            Фильтры
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по задачам"
                className="pl-9"
              />
            </div>
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="h-9 rounded-md border border-input bg-input-background px-3 text-sm">
              {PRIORITY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)} className="h-9 rounded-md border border-input bg-input-background px-3 text-sm">
              <option value="all">Все разделы</option>
              {sectionOptions.map(section => <option key={section} value={section}>{taskSectionLabel(section)}</option>)}
            </select>
            <select value={dueFilter} onChange={(event) => setDueFilter(event.target.value)} className="h-9 rounded-md border border-input bg-input-background px-3 text-sm">
              {DUE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <label className="flex h-9 items-center gap-2 rounded-md border border-input bg-input-background px-3 text-sm">
              <input type="checkbox" checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)} />
              Только с ответственным
            </label>
          </div>
        </CardContent>
      </Card>

      {visibleTasks.length === 0 ? (
        <Card className="border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/70 dark:bg-emerald-950/20">
          <CardContent className="flex items-center gap-3 p-6">
            <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-300" />
            <div>
              <p className="font-semibold text-emerald-700 dark:text-emerald-300">Критичных задач нет.</p>
              <p className="text-sm text-emerald-700/80 dark:text-emerald-200/80">По выбранным фильтрам ничего не требует действия.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groupedTasks.filter(group => group.tasks.length > 0).map(group => (
            <Card key={group.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  {group.id === 'overdue' ? <AlertTriangle className="h-4 w-4 text-red-500" /> : <CalendarClock className="h-4 w-4 text-primary" />}
                  {group.title}
                  <Badge variant="default">{group.tasks.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {group.tasks.map((task: TaskCenterTask) => (
                  <div key={task.id} className="grid gap-3 rounded-xl border border-border bg-card/95 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={priorityVariant(task.priority)}>{taskPriorityLabel(task.priority)}</Badge>
                        <Badge variant="info">{taskSectionLabel(task.section)}</Badge>
                        {task.dueDate && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" />
                            {formatDate(task.dueDate)}
                          </span>
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">{task.title}</p>
                        <p className="mt-1 break-words text-sm text-muted-foreground">{task.description || 'Описание не задано'}</p>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {task.clientName && <span>Клиент: {task.clientName}</span>}
                        {(task.responsible || task.assignedTo) && <span>Ответственный: {task.responsible || task.assignedTo}</span>}
                        {canViewFinance && typeof task.amount === 'number' && <span>Сумма: {formatCurrency(task.amount)}</span>}
                        {!canViewFinance && typeof task.amount === 'number' && <span>Финансовые данные скрыты правами доступа</span>}
                      </div>
                    </div>
                    <Button asChild size="sm" variant="secondary">
                      <Link to={task.actionUrl || '/'}>
                        Перейти
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="flex items-start gap-3 p-4 text-sm text-muted-foreground">
          <ListChecks className="mt-0.5 h-5 w-5 text-primary" />
          <p>
            В MVP задачи вычисляются из существующих данных и не создают записей в базе. Закрытие, скрытие и MAX-уведомления намеренно не включены.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
