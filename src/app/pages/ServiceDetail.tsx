import React, { useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import {
  ArrowLeft, Wrench, User, Clock, MapPin, Tag, FileText,
  CheckCircle, XCircle, AlertTriangle, Play, Package, History,
} from 'lucide-react';
import { formatDate } from '../lib/utils';
import { loadServiceTickets, saveServiceTickets } from '../mock-data';
import type { ServiceTicket, ServiceStatus } from '../types';

// ─── helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ServiceStatus, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  waiting_parts: 'Ожидание запчастей',
  ready: 'Готово',
  closed: 'Закрыто',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  critical: 'Критический',
};

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Вручную',
  bot: 'Бот',
  manager: 'Менеджер',
  system: 'Система',
};

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'default';

function statusVariant(s: ServiceStatus): BadgeVariant {
  return ({ new: 'default', in_progress: 'info', waiting_parts: 'warning', ready: 'success', closed: 'default' } as Record<ServiceStatus, BadgeVariant>)[s] ?? 'default';
}
function priorityVariant(p: string): BadgeVariant {
  return ({ low: 'default', medium: 'info', high: 'warning', critical: 'error' } as Record<string, BadgeVariant>)[p] ?? 'default';
}

function StatusBadge({ status }: { status: ServiceStatus }) {
  return <Badge variant={statusVariant(status)}>{STATUS_LABELS[status]}</Badge>;
}
function PriorityBadge({ priority }: { priority: string }) {
  return <Badge variant={priorityVariant(priority)}>{PRIORITY_LABELS[priority] ?? priority}</Badge>;
}

function Field({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-sm font-medium text-gray-900 dark:text-white ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

function Divider() {
  return <hr className="border-gray-100 dark:border-gray-800" />;
}

const EQUIPMENT_TYPE_LABELS: Record<string, string> = {
  scissor: 'Ножничный',
  articulated: 'Шарнирно-сочленённый',
  telescopic: 'Телескопический',
};

// ─── main component ────────────────────────────────────────────────────────────

export default function ServiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Load from localStorage (NOT from static mock array)
  const [ticket, setTicket] = useState<ServiceTicket | null>(() => {
    const all = loadServiceTickets();
    return all.find(t => t.id === id) ?? null;
  });

  const [newComment, setNewComment] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [newResult, setNewResult] = useState('');
  const [newPlannedDate, setNewPlannedDate] = useState('');
  const [showResultInput, setShowResultInput] = useState(false);

  // Persist changes
  const persist = useCallback((updated: ServiceTicket) => {
    setTicket(updated);
    const all = loadServiceTickets();
    saveServiceTickets(all.map(t => (t.id === updated.id ? updated : t)));
  }, []);

  // ── actions ────────────────────────────────────────────────────────────────

  const changeStatus = (newStatus: ServiceStatus, logText: string, author = 'Оператор') => {
    if (!ticket) return;
    const now = new Date().toISOString();
    const updated: ServiceTicket = {
      ...ticket,
      status: newStatus,
      closedAt: (newStatus === 'closed' || newStatus === 'ready') ? now : ticket.closedAt,
      workLog: [
        ...ticket.workLog,
        { date: now, text: logText, author, type: 'status_change' },
      ],
    };
    persist(updated);
  };

  const addComment = () => {
    if (!ticket || !newComment.trim()) return;
    const now = new Date().toISOString();
    persist({
      ...ticket,
      workLog: [...ticket.workLog, { date: now, text: newComment.trim(), author: 'Оператор', type: 'comment' }],
    });
    setNewComment('');
  };

  const saveAssignee = () => {
    if (!ticket || !newAssignee.trim()) return;
    const now = new Date().toISOString();
    persist({
      ...ticket,
      assignedTo: newAssignee.trim(),
      workLog: [...ticket.workLog, {
        date: now,
        text: `Назначен ответственный: ${newAssignee.trim()}`,
        author: 'Оператор',
        type: 'assign',
      }],
    });
    setNewAssignee('');
  };

  const saveResult = () => {
    if (!ticket || !newResult.trim()) return;
    persist({ ...ticket, result: newResult.trim() });
    setNewResult('');
    setShowResultInput(false);
  };

  const savePlannedDate = () => {
    if (!ticket || !newPlannedDate) return;
    persist({ ...ticket, plannedDate: newPlannedDate });
    setNewPlannedDate('');
  };

  // ── "not found" screen ─────────────────────────────────────────────────────

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 gap-4 text-center">
        <XCircle className="h-12 w-12 text-gray-300" />
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Заявка не найдена</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Возможно, она была удалена или ID указан некорректно.
        </p>
        <Button onClick={() => navigate('/service')}>Вернуться к списку</Button>
      </div>
    );
  }

  // ── action buttons based on status ────────────────────────────────────────

  const actions: React.ReactNode[] = [];

  if (ticket.status === 'new') {
    actions.push(
      <Button key="start" onClick={() => changeStatus('in_progress', 'Заявка взята в работу')}>
        <Play className="h-4 w-4" />
        Взять в работу
      </Button>
    );
  }
  if (ticket.status === 'in_progress') {
    actions.push(
      <Button key="parts" variant="secondary" onClick={() => changeStatus('waiting_parts', 'Заявка переведена в статус «Ожидание запчастей»')}>
        <Package className="h-4 w-4" />
        Ожидание запчастей
      </Button>
    );
    actions.push(
      <Button key="ready" onClick={() => changeStatus('ready', 'Работы завершены, заявка готова к закрытию')}>
        <CheckCircle className="h-4 w-4" />
        Работы завершены
      </Button>
    );
  }
  if (ticket.status === 'waiting_parts') {
    actions.push(
      <Button key="resume" variant="secondary" onClick={() => changeStatus('in_progress', 'Запчасти получены, возобновлена работа')}>
        <Play className="h-4 w-4" />
        Запчасти получены
      </Button>
    );
  }
  if (ticket.status === 'ready') {
    actions.push(
      <Button key="close" onClick={() => changeStatus('closed', 'Заявка закрыта')}>
        <CheckCircle className="h-4 w-4" />
        Закрыть заявку
      </Button>
    );
  }
  if (ticket.status !== 'closed') {
    actions.push(
      <Button key="cancel" variant="secondary" className="border-red-200 text-red-600 hover:bg-red-50"
        onClick={() => changeStatus('closed', 'Заявка отменена / закрыта без выполнения')}>
        <XCircle className="h-4 w-4" />
        Отменить
      </Button>
    );
  }

  // ── log icon ──────────────────────────────────────────────────────────────

  const logIcon = (type?: string) => {
    if (type === 'status_change') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />;
    if (type === 'assign') return <User className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />;
    return <FileText className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />;
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Button variant="secondary" onClick={() => navigate('/service')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{ticket.id}</h1>
              <StatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{ticket.equipment}</p>
          </div>
        </div>
        {/* Action buttons */}
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Left column (2/3) ───────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Main info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Основная информация
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Field label="ID заявки" value={ticket.id} mono />
                <Field label="Статус" value={STATUS_LABELS[ticket.status]} />
                <Field label="Приоритет" value={PRIORITY_LABELS[ticket.priority] ?? ticket.priority} />
                <Field label="SLA" value={ticket.sla} />
                <Field label="Дата создания" value={formatDate(ticket.createdAt)} />
                {ticket.plannedDate && <Field label="Плановая дата" value={formatDate(ticket.plannedDate)} />}
                {ticket.closedAt && <Field label="Фактическое закрытие" value={formatDate(ticket.closedAt)} />}
                <Field label="Источник" value={ticket.source ? SOURCE_LABELS[ticket.source] : undefined} />
                <Field label="Кто создал" value={ticket.createdBy} />
              </div>
            </CardContent>
          </Card>

          {/* Equipment block */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wrench className="h-4 w-4" />
                Техника
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Field label="Наименование" value={ticket.equipment} />
                {ticket.inventoryNumber && <Field label="Инв. номер" value={ticket.inventoryNumber} mono />}
                {ticket.serialNumber && <Field label="Серийный номер" value={ticket.serialNumber} mono />}
                {ticket.equipmentType && (
                  <Field label="Тип техники" value={EQUIPMENT_TYPE_LABELS[ticket.equipmentType] ?? ticket.equipmentType} />
                )}
                {ticket.location && (
                  <div className="flex items-start gap-1.5 col-span-2">
                    <MapPin className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Локация</p>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{ticket.location}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Problem block */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4" />
                Проблема
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Причина обращения</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white">{ticket.reason}</p>
              </div>
              {ticket.description && ticket.description !== ticket.reason && (
                <>
                  <Divider />
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Описание неисправности</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{ticket.description}</p>
                  </div>
                </>
              )}
              {ticket.result && (
                <>
                  <Divider />
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Результат работ</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{ticket.result}</p>
                  </div>
                </>
              )}
              {ticket.status !== 'closed' && (
                <>
                  <Divider />
                  {showResultInput ? (
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Результат работ</label>
                        <textarea
                          className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                          rows={2}
                          value={newResult}
                          onChange={e => setNewResult(e.target.value)}
                          placeholder="Опишите результат..."
                        />
                      </div>
                      <div className="flex gap-1.5">
                        <Button size="sm" onClick={saveResult} disabled={!newResult.trim()}>Сохранить</Button>
                        <Button size="sm" variant="secondary" onClick={() => setShowResultInput(false)}>Отмена</Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setShowResultInput(true)}>
                      {ticket.result ? 'Изменить результат' : '+ Добавить результат работ'}
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Work log / history */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4" />
                История
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {ticket.workLog.length === 0 && (
                <p className="text-sm text-gray-400 italic">История пуста</p>
              )}
              {[...ticket.workLog].reverse().map((entry, i) => (
                <div key={i} className="flex gap-3 text-sm">
                  {logIcon(entry.type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-900 dark:text-white">{entry.text}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {entry.author} · {new Date(entry.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}

              {ticket.status !== 'closed' && (
                <>
                  <Divider />
                  <div className="flex gap-2 items-end pt-1">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Комментарий механика</label>
                      <textarea
                        className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                        rows={2}
                        value={newComment}
                        onChange={e => setNewComment(e.target.value)}
                        placeholder="Добавить комментарий..."
                      />
                    </div>
                    <Button size="sm" onClick={addComment} disabled={!newComment.trim()}>
                      Добавить
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right column (1/3) ──────────────────────────────────────────── */}
        <div className="space-y-6">

          {/* Assignee card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4" />
                Ответственный
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Назначен</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {ticket.assignedTo || <span className="text-gray-400 font-normal italic">Не назначен</span>}
                </p>
              </div>
              {ticket.status !== 'closed' && (
                <>
                  <Divider />
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Input
                        label="Назначить"
                        placeholder="Имя механика"
                        value={newAssignee}
                        onChange={e => setNewAssignee(e.target.value)}
                      />
                    </div>
                    <Button size="sm" onClick={saveAssignee} disabled={!newAssignee.trim()}>OK</Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Timing card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" />
                Сроки
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="SLA" value={ticket.sla} />
              <Field label="Дата создания" value={formatDate(ticket.createdAt)} />
              {ticket.plannedDate
                ? <Field label="Плановая дата" value={formatDate(ticket.plannedDate)} />
                : ticket.status !== 'closed' && (
                  <>
                    <Divider />
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <Input
                          label="Плановая дата"
                          type="date"
                          value={newPlannedDate}
                          onChange={e => setNewPlannedDate(e.target.value)}
                        />
                      </div>
                      <Button size="sm" onClick={savePlannedDate} disabled={!newPlannedDate}>OK</Button>
                    </div>
                  </>
                )
              }
              {ticket.closedAt && <Field label="Фактически закрыта" value={formatDate(ticket.closedAt)} />}
            </CardContent>
          </Card>

          {/* Priority alert */}
          {(ticket.priority === 'critical' || ticket.priority === 'high') && ticket.status !== 'closed' && (
            <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                    {ticket.priority === 'critical' ? 'Критический приоритет' : 'Высокий приоритет'}
                  </p>
                </div>
                <p className="text-xs text-red-600 dark:text-red-300">
                  Требуется срочное выполнение в рамках SLA: {ticket.sla}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Parts */}
          {ticket.parts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Tag className="h-4 w-4" />
                  Запчасти
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {ticket.parts.map((p, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-gray-700 dark:text-gray-300">{p.name} × {p.qty}</span>
                      <span className="text-gray-500">{p.cost.toLocaleString('ru-RU')} ₽</span>
                    </div>
                  ))}
                  <Divider />
                  <div className="flex justify-between text-sm font-semibold">
                    <span>Итого</span>
                    <span>{ticket.parts.reduce((s, p) => s + p.cost * p.qty, 0).toLocaleString('ru-RU')} ₽</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
