import React from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, Bot, Clock3, Search, ShieldCheck, Users, WifiOff } from 'lucide-react';
import { useBotsList } from '../hooks/useBots';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { formatDateTime } from '../lib/utils';
import type { BotActivityType, BotConnection, BotStatus } from '../types';

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

function byConnectionDate(left: BotConnection, right: BotConnection) {
  const leftTime = Date.parse(left.lastSeenAt || left.connectedAt || '') || 0;
  const rightTime = Date.parse(right.lastSeenAt || right.connectedAt || '') || 0;
  return rightTime - leftTime;
}

export default function Bots() {
  const { data: bots = [], isLoading, error } = useBotsList();
  const [search, setSearch] = React.useState('');
  const normalizedSearch = search.trim().toLowerCase();

  const filteredBots = React.useMemo(() => (
    bots.filter(bot => {
      if (!normalizedSearch) return true;
      return [
        bot.name,
        bot.provider,
        bot.description,
        ...bot.connectionsPreview.flatMap(connection => [
          connection.userName,
          connection.userRole,
          connection.email,
          connection.phone,
        ]),
      ]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(normalizedSearch));
    })
  ), [bots, normalizedSearch]);

  const totals = React.useMemo(() => ({
    bots: bots.length,
    connections: bots.reduce((sum, bot) => sum + bot.totalConnections, 0),
    activity24h: bots.reduce((sum, bot) => sum + bot.activity24h, 0),
  }), [bots]);

  const previewConnections = React.useMemo(() => (
    filteredBots
      .flatMap(bot => bot.connectionsPreview.map(connection => ({ bot, connection })))
      .sort((left, right) => byConnectionDate(left.connection, right.connection))
      .slice(0, 8)
  ), [filteredBots]);

  if (isLoading) {
    return (
      <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Бот</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Загрузка данных по подключениям и истории…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Бот</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Не удалось загрузить данные раздела.</p>
        </div>
        <Card className="border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20">
          <CardContent className="pt-6 text-sm text-red-700 dark:text-red-300">
            Проверьте доступ администратора и доступность API `/api/bots`.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Бот</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
            Контроль подключений сотрудников к рабочим ботам и быстрый обзор последних действий.
          </p>
        </div>
        <div className="w-full max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
              placeholder="Поиск по боту, пользователю, email или MAX ID"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-blue-200/70 bg-blue-50/80 dark:border-blue-900/40 dark:bg-blue-950/20">
          <CardHeader>
            <CardDescription>Ботов в системе</CardDescription>
            <CardTitle className="text-3xl font-bold text-blue-900 dark:text-blue-100">{totals.bots}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-emerald-200/70 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <CardHeader>
            <CardDescription>Активных подключений</CardDescription>
            <CardTitle className="text-3xl font-bold text-emerald-900 dark:text-emerald-100">{totals.connections}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-amber-200/70 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/20">
          <CardHeader>
            <CardDescription>Действий за 24 часа</CardDescription>
            <CardTitle className="text-3xl font-bold text-amber-900 dark:text-amber-100">{totals.activity24h}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {filteredBots.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <WifiOff className="mb-4 h-10 w-10 text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Боты не найдены</h2>
            <p className="mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">
              Попробуйте изменить поисковый запрос или подключить бот на сервере.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 xl:hidden">
            {filteredBots.map(bot => (
              <Card key={bot.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
                        <Bot className="h-5 w-5 text-[--color-primary]" />
                        {bot.name}
                      </CardTitle>
                      <CardDescription className="mt-1">{bot.description}</CardDescription>
                    </div>
                    {getBotStatusBadge(bot.status)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/60">
                      <p className="text-gray-500 dark:text-gray-400">Подключений</p>
                      <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{bot.totalConnections}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/60">
                      <p className="text-gray-500 dark:text-gray-400">Действий за 24ч</p>
                      <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{bot.activity24h}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {bot.webhookConfigured ? <Badge variant="success">Webhook подключён</Badge> : <Badge variant="warning">Webhook не настроен</Badge>}
                    {bot.pendingConnections > 0 && <Badge variant="warning">Активных сценариев: {bot.pendingConnections}</Badge>}
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                    <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Последняя активность</p>
                    <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{formatDateTimeSafe(bot.lastActivityAt)}</p>
                  </div>
                  <Button asChild variant="outline" className="w-full">
                    <Link to={`/bots/${bot.id}`}>
                      Открыть бота
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="hidden xl:flex">
            <CardHeader>
              <CardTitle>Подключённые боты</CardTitle>
              <CardDescription>Список интеграций и их текущее состояние.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Бот</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Подключения</TableHead>
                    <TableHead>Активность 24ч</TableHead>
                    <TableHead>Webhook</TableHead>
                    <TableHead>Последнее действие</TableHead>
                    <TableHead className="w-[140px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBots.map(bot => (
                    <TableRow key={bot.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 font-medium text-gray-900 dark:text-white">
                            <Bot className="h-4 w-4 text-[--color-primary]" />
                            {bot.name}
                          </div>
                          <p className="max-w-md text-xs text-gray-500 dark:text-gray-400">{bot.description}</p>
                        </div>
                      </TableCell>
                      <TableCell>{getBotStatusBadge(bot.status)}</TableCell>
                      <TableCell className="text-sm">
                        <div className="font-medium text-gray-900 dark:text-white">{bot.totalConnections}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Активных сценариев: {bot.pendingConnections}</div>
                      </TableCell>
                      <TableCell className="text-sm">{bot.activity24h}</TableCell>
                      <TableCell>
                        {bot.webhookConfigured ? <Badge variant="success">Готов</Badge> : <Badge variant="warning">Нет</Badge>}
                      </TableCell>
                      <TableCell className="text-sm">{formatDateTimeSafe(bot.lastActivityAt)}</TableCell>
                      <TableCell>
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/bots/${bot.id}`}>Открыть</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Кто подключён сейчас</CardTitle>
              <CardDescription>Быстрый срез по сотрудникам, привязанным к ботам.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {previewConnections.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  Нет активных подключений по текущему фильтру.
                </div>
              ) : (
                <>
                  <div className="grid gap-3 lg:hidden">
                    {previewConnections.map(({ bot, connection }) => (
                      <div key={connection.id} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-gray-900 dark:text-white">{connection.userName || 'Не авторизован'}</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{bot.name}</p>
                          </div>
                          {connection.pendingActionLabel ? <Badge variant="warning">{connection.pendingActionLabel}</Badge> : <Badge>Без сценария</Badge>}
                        </div>
                        <div className="mt-3 grid gap-1 text-sm text-gray-600 dark:text-gray-300">
                          <p>Роль: {connection.userRole || '—'}</p>
                          <p>MAX ID: {connection.maxUserId ?? connection.phone}</p>
                          <p>Последнее действие: {formatDateTimeSafe(connection.lastSeenAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="hidden lg:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Пользователь</TableHead>
                          <TableHead>Бот</TableHead>
                          <TableHead>Роль</TableHead>
                          <TableHead>MAX ID</TableHead>
                          <TableHead>Сценарий</TableHead>
                          <TableHead>Последнее действие</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewConnections.map(({ bot, connection }) => (
                          <TableRow key={connection.id}>
                            <TableCell>
                              <div className="space-y-1">
                                <div className="font-medium text-gray-900 dark:text-white">{connection.userName || 'Не авторизован'}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">{connection.email || connection.phone}</div>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm">{bot.name}</TableCell>
                            <TableCell className="text-sm">{connection.userRole || '—'}</TableCell>
                            <TableCell className="text-sm">{connection.maxUserId ?? connection.phone}</TableCell>
                            <TableCell>
                              {connection.pendingActionLabel ? <Badge variant="warning">{connection.pendingActionLabel}</Badge> : <Badge>Без сценария</Badge>}
                            </TableCell>
                            <TableCell className="text-sm">{formatDateTimeSafe(connection.lastSeenAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {filteredBots.map(bot => (
              <Card key={`${bot.id}-history`}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-[--color-primary]" />
                    Последние действия: {bot.name}
                  </CardTitle>
                  <CardDescription>Короткая лента событий перед переходом в деталку.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {bot.recentActivity.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                      История пока пуста.
                    </div>
                  ) : (
                    bot.recentActivity.map(event => (
                      <div key={event.id} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                        <div className="flex flex-wrap items-center gap-2">
                          {getActivityTypeBadge(event.eventType)}
                          <span className="text-sm font-medium text-gray-900 dark:text-white">{event.userName || 'Не авторизован'}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">{formatDateTimeSafe(event.createdAt)}</span>
                        </div>
                        <p className="mt-2 text-sm text-gray-800 dark:text-gray-200">{event.action}</p>
                        {event.details && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{event.details}</p>}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {filteredBots.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-2"><Users className="h-4 w-4" /> Подключений: {totals.connections}</span>
          <span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4" /> Действий за сутки: {totals.activity24h}</span>
          <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Управление доступно администратору</span>
        </div>
      )}
    </div>
  );
}
