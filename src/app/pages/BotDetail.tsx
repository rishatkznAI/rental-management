import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, Clock3, History, LogOut, Search, ShieldCheck, UserRound, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { useBotById, useDisconnectBotConnection, useUpdateBotConnection } from '../hooks/useBots';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { BOT_CONNECTION_ROLES, getSelectableBotConnectionRole } from '../lib/botRoles';
import { formatDateTime } from '../lib/utils';
import type { BotActivityEntry, BotActivityType, BotConnection, BotConnectionRole, BotStatus } from '../types';

function formatDateTimeSafe(value: string | null): string {
  return value ? formatDateTime(value) : '—';
}

function getBotStatusBadge(status: BotStatus) {
  return status === 'online'
    ? <Badge variant="success">Онлайн</Badge>
    : <Badge variant="warning">Не настроен</Badge>;
}

function getActivityTypeBadge(type: BotActivityType) {
  const map: Record<BotActivityType, { label: string; variant: 'default' | 'info' | 'warning' | 'success' }> = {
    session_started: { label: 'Старт', variant: 'default' },
    authorization: { label: 'Авторизация', variant: 'success' },
    command: { label: 'Команда', variant: 'info' },
    message: { label: 'Сообщение', variant: 'default' },
    callback: { label: 'Кнопка', variant: 'warning' },
  };
  const item = map[type];
  return <Badge variant={item.variant}>{item.label}</Badge>;
}

function matchesSearch(values: Array<string | number | null | undefined>, query: string): boolean {
  if (!query) return true;
  return values.some(value => String(value ?? '').toLowerCase().includes(query));
}

function renderConnectionState(connection: BotConnection) {
  if (connection.pendingActionLabel) {
    return <Badge variant="warning">{connection.pendingActionLabel}</Badge>;
  }
  return <Badge>Без активного сценария</Badge>;
}

export default function BotDetail() {
  const { botId = '' } = useParams();
  const { data, isLoading, error } = useBotById(botId);
  const updateConnection = useUpdateBotConnection(botId);
  const disconnectConnection = useDisconnectBotConnection(botId);
  const [search, setSearch] = React.useState('');
  const [tab, setTab] = React.useState('history');
  const normalizedSearch = search.trim().toLowerCase();

  const handleRoleChange = React.useCallback(async (connection: BotConnection, userRole: BotConnectionRole) => {
    if (connection.userRole === userRole) return;
    try {
      await updateConnection.mutateAsync({ phone: connection.phone, userRole });
      toast.success('Роль пользователя в боте обновлена.');
    } catch (mutationError) {
      toast.error(mutationError instanceof Error ? mutationError.message : 'Не удалось обновить роль пользователя.');
    }
  }, [updateConnection]);

  const handleDisconnect = React.useCallback(async (connection: BotConnection) => {
    const label = connection.userName || connection.email || connection.phone;
    if (!window.confirm(`Отключить ${label} от бота? Пользователь сможет войти заново через авторизацию.`)) return;

    try {
      await disconnectConnection.mutateAsync({ phone: connection.phone });
      toast.success('Пользователь отключён от бота.');
    } catch (mutationError) {
      toast.error(mutationError instanceof Error ? mutationError.message : 'Не удалось отключить пользователя.');
    }
  }, [disconnectConnection]);

  const filteredConnections = React.useMemo(() => (
    (data?.connections || []).filter(connection => matchesSearch([
      connection.userName,
      connection.userRole,
      connection.email,
      connection.phone,
      connection.maxUserId,
      connection.pendingActionLabel,
      connection.activeRepairId,
    ], normalizedSearch))
  ), [data?.connections, normalizedSearch]);

  const filteredActivity = React.useMemo(() => (
    (data?.activity || []).filter(entry => matchesSearch([
      entry.userName,
      entry.userRole,
      entry.email,
      entry.phone,
      entry.action,
      entry.details,
      entry.eventType,
    ], normalizedSearch))
  ), [data?.activity, normalizedSearch]);

  const renderConnectionActions = (connection: BotConnection) => {
    const busy = updateConnection.isPending || disconnectConnection.isPending;
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          value={getSelectableBotConnectionRole(connection.userRole) || undefined}
          onValueChange={(value) => handleRoleChange(connection, value as BotConnectionRole)}
          disabled={busy}
        >
          <SelectTrigger className="w-full sm:w-[230px]" size="sm">
            <SelectValue placeholder="Выберите роль" />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {BOT_CONNECTION_ROLES.map((role) => (
              <SelectItem key={role} value={role}>
                {role}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => handleDisconnect(connection)}
          disabled={busy}
          className="w-full sm:w-auto"
        >
          <LogOut className="h-4 w-4" />
          Отключить
        </Button>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Бот</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Загрузка карточки бота…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
        <Button asChild variant="outline" size="sm">
          <Link to="/bots">
            <ArrowLeft className="h-4 w-4" />
            Назад к списку
          </Link>
        </Button>
        <Card className="border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20">
          <CardContent className="pt-6 text-sm text-red-700 dark:text-red-300">
            Карточка бота не найдена или недоступна.
          </CardContent>
        </Card>
      </div>
    );
  }

  const { bot } = data;

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline" size="sm">
            <Link to="/bots">
              <ArrowLeft className="h-4 w-4" />
              К списку ботов
            </Link>
          </Button>
          {getBotStatusBadge(bot.status)}
          {bot.webhookConfigured ? <Badge variant="success">Webhook подключён</Badge> : <Badge variant="warning">Webhook не настроен</Badge>}
        </div>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <h1 className="flex min-w-0 items-center gap-3 text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">
              <Bot className="h-7 w-7 shrink-0 text-[--color-primary]" />
              {bot.name}
            </h1>
            <p className="mt-2 max-w-3xl break-words text-sm text-gray-500 dark:text-gray-400">{bot.description}</p>
          </div>
          <div className="w-full max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
                placeholder="Поиск по пользователю, MAX ID, действию или сценарию"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-blue-200/70 bg-blue-50/80 dark:border-blue-900/40 dark:bg-blue-950/20">
          <CardHeader>
            <CardDescription>Подключений</CardDescription>
            <CardTitle className="text-3xl font-bold text-blue-900 dark:text-blue-100">{bot.totalConnections}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-amber-200/70 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/20">
          <CardHeader>
            <CardDescription>Активных сценариев</CardDescription>
            <CardTitle className="text-3xl font-bold text-amber-900 dark:text-amber-100">{bot.pendingConnections}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-emerald-200/70 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <CardHeader>
            <CardDescription>Действий за 24 часа</CardDescription>
            <CardTitle className="text-3xl font-bold text-emerald-900 dark:text-emerald-100">{bot.activity24h}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-slate-200/70 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/60">
          <CardHeader>
            <CardDescription>Последняя активность</CardDescription>
            <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">{formatDateTimeSafe(bot.lastActivityAt)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="history" className="flex-1 sm:flex-none">
            <History className="h-4 w-4" />
            История
          </TabsTrigger>
          <TabsTrigger value="connections" className="flex-1 sm:flex-none">
            <Workflow className="h-4 w-4" />
            Подключения
          </TabsTrigger>
        </TabsList>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>История работы с ботом</CardTitle>
              <CardDescription>Показывает, какой пользователь и что именно делал в чате с ботом.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {filteredActivity.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  По текущему фильтру событий нет.
                </div>
              ) : (
                <>
                  <div className="grid gap-3 xl:hidden">
                    {filteredActivity.map((entry: BotActivityEntry) => (
                      <div key={entry.id} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                        <div className="flex flex-wrap items-center gap-2">
                          {getActivityTypeBadge(entry.eventType)}
                          <span className="break-words font-medium text-gray-900 dark:text-white">{entry.userName || 'Не авторизован'}</span>
                        </div>
                        <p className="mt-2 break-words text-sm text-gray-800 dark:text-gray-200">{entry.action}</p>
                        {entry.details && <p className="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">{entry.details}</p>}
                        <div className="mt-3 grid gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <p>Время: {formatDateTimeSafe(entry.createdAt)}</p>
                          <p>Роль: {entry.userRole || '—'}</p>
                          <p>MAX ID: {entry.maxUserId ?? entry.phone ?? '—'}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="hidden xl:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Время</TableHead>
                          <TableHead>Пользователь</TableHead>
                          <TableHead>Тип</TableHead>
                          <TableHead>Действие</TableHead>
                          <TableHead>MAX ID</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredActivity.map((entry: BotActivityEntry) => (
                          <TableRow key={entry.id}>
                            <TableCell className="whitespace-nowrap text-sm">{formatDateTimeSafe(entry.createdAt)}</TableCell>
                            <TableCell>
                              <div className="min-w-0 space-y-1">
                                <div className="break-words font-medium text-gray-900 dark:text-white">{entry.userName || 'Не авторизован'}</div>
                                <div className="break-all text-xs text-gray-500 dark:text-gray-400">{entry.userRole || entry.email || '—'}</div>
                              </div>
                            </TableCell>
                            <TableCell>{getActivityTypeBadge(entry.eventType)}</TableCell>
                            <TableCell>
                              <div className="min-w-0 space-y-1">
                                <div className="break-words text-sm text-gray-900 dark:text-white">{entry.action}</div>
                                {entry.details && <div className="break-words text-xs text-gray-500 dark:text-gray-400">{entry.details}</div>}
                              </div>
                            </TableCell>
                            <TableCell className="break-all text-sm">{entry.maxUserId ?? entry.phone ?? '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="connections">
          <Card>
            <CardHeader>
              <CardTitle>Кто подключён к боту</CardTitle>
              <CardDescription>Текущие привязки пользователей, активные сценарии и последняя активность.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {filteredConnections.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  По текущему фильтру подключений нет.
                </div>
              ) : (
                <>
                  <div className="grid gap-3 xl:hidden">
                    {filteredConnections.map((connection: BotConnection) => (
                      <div key={connection.id} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="break-words font-semibold text-gray-900 dark:text-white">{connection.userName || 'Не авторизован'}</p>
                            <p className="break-all text-sm text-gray-500 dark:text-gray-400">{connection.userRole || connection.email || '—'}</p>
                          </div>
                          {renderConnectionState(connection)}
                        </div>
                        <div className="mt-3 grid gap-1 text-sm text-gray-600 dark:text-gray-300">
                          <p>MAX ID: {connection.maxUserId ?? connection.phone}</p>
                          <p>Подключён: {formatDateTimeSafe(connection.connectedAt)}</p>
                          <p>Последнее действие: {formatDateTimeSafe(connection.lastSeenAt)}</p>
                          <p>Текущая заявка: {connection.activeRepairId || '—'}</p>
                        </div>
                        <div className="mt-4">
                          {renderConnectionActions(connection)}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="hidden xl:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Пользователь</TableHead>
                          <TableHead>Роль</TableHead>
                          <TableHead>MAX ID</TableHead>
                          <TableHead>Сценарий</TableHead>
                          <TableHead>Текущая заявка</TableHead>
                          <TableHead>Подключён</TableHead>
                          <TableHead>Последняя активность</TableHead>
                          <TableHead>Управление</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredConnections.map((connection: BotConnection) => (
                          <TableRow key={connection.id}>
                            <TableCell>
                              <div className="min-w-0 space-y-1">
                                <div className="break-words font-medium text-gray-900 dark:text-white">{connection.userName || 'Не авторизован'}</div>
                                <div className="break-all text-xs text-gray-500 dark:text-gray-400">{connection.email || connection.phone}</div>
                              </div>
                            </TableCell>
                            <TableCell className="break-words text-sm">{connection.userRole || '—'}</TableCell>
                            <TableCell className="break-all text-sm">{connection.maxUserId ?? connection.phone}</TableCell>
                            <TableCell>{renderConnectionState(connection)}</TableCell>
                            <TableCell className="break-all text-sm">{connection.activeRepairId || '—'}</TableCell>
                            <TableCell className="whitespace-nowrap text-sm">{formatDateTimeSafe(connection.connectedAt)}</TableCell>
                            <TableCell className="whitespace-nowrap text-sm">{formatDateTimeSafe(connection.lastSeenAt)}</TableCell>
                            <TableCell>{renderConnectionActions(connection)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-2"><UserRound className="h-4 w-4" /> Пользователей: {data.connections.length}</span>
        <span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4" /> Событий: {data.activity.length}</span>
        <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Доступ только у администратора</span>
      </div>
    </div>
  );
}
