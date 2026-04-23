import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  CheckCircle2,
  Clock3,
  GraduationCap,
  PlayCircle,
  Trophy,
  UserRound,
  Video,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useAuth } from '../contexts/AuthContext';
import {
  useCreateKnowledgeBaseProgress,
  useKnowledgeBaseModulesList,
  useKnowledgeBaseProgressList,
  useUpdateKnowledgeBaseProgress,
} from '../hooks/useKnowledgeBase';
import { cn } from '../lib/utils';
import { usersService } from '../services/users.service';
import type { KnowledgeBaseModule, KnowledgeBaseProgress, KnowledgeBaseProgressStatus } from '../types';

type AudienceFilter = 'all' | 'rental' | 'sales';

type TrainingUser = {
  id: string;
  name: string;
  role?: string;
  status?: string;
};

const MANAGER_ROLES = ['Менеджер по аренде', 'Менеджер по продажам'] as const;

function isManagerRole(role?: string | null) {
  return MANAGER_ROLES.some(item => item === role);
}

function isReviewerRole(role?: string | null) {
  return role === 'Администратор' || role === 'Офис-менеджер';
}

function nowIso() {
  return new Date().toISOString();
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('ru-RU');
  } catch {
    return value;
  }
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function getAudienceLabel(audience: KnowledgeBaseModule['audience']) {
  if (audience === 'rental') return 'Аренда';
  if (audience === 'sales') return 'Продажи';
  return 'Все менеджеры';
}

function moduleMatchesRole(module: KnowledgeBaseModule, role?: string | null) {
  if (!role) return false;
  if (isReviewerRole(role)) return true;
  if (role === 'Менеджер по аренде') return module.audience === 'rental' || module.audience === 'all';
  if (role === 'Менеджер по продажам') return module.audience === 'sales' || module.audience === 'all';
  return false;
}

function getStatusMeta(status: KnowledgeBaseProgressStatus) {
  if (status === 'passed') return { label: 'Пройдено', variant: 'success' as const };
  if (status === 'failed') return { label: 'Не сдано', variant: 'danger' as const };
  if (status === 'in_progress') return { label: 'В процессе', variant: 'warning' as const };
  return { label: 'Не начато', variant: 'default' as const };
}

function getModuleProgress(
  progress: KnowledgeBaseProgress[],
  moduleId: string,
  userId?: string | null,
) {
  if (!userId) return null;
  return progress.find(item => item.moduleId === moduleId && item.userId === userId) || null;
}

function getVideoSource(url?: string) {
  if (!url) return null;
  return url.trim() || null;
}

export default function KnowledgeBase() {
  const { user } = useAuth();
  const { data: modules = [] } = useKnowledgeBaseModulesList();
  const { data: progress = [] } = useKnowledgeBaseProgressList();
  const { data: users = [] } = useQuery<TrainingUser[]>({
    queryKey: ['knowledge-base-users'],
    queryFn: () => usersService.getAll() as unknown as Promise<TrainingUser[]>,
    staleTime: 1000 * 60 * 5,
  });
  const createProgress = useCreateKnowledgeBaseProgress();
  const updateProgress = useUpdateKnowledgeBaseProgress();

  const canTakeTraining = isManagerRole(user?.role);
  const canReviewManagers = isReviewerRole(user?.role);

  const [tab, setTab] = React.useState<'courses' | 'cards'>(canReviewManagers ? 'courses' : 'courses');
  const [audienceFilter, setAudienceFilter] = React.useState<AudienceFilter>(
    user?.role === 'Менеджер по аренде' ? 'rental' : user?.role === 'Менеджер по продажам' ? 'sales' : 'all',
  );
  const [selectedModuleId, setSelectedModuleId] = React.useState<string>('');
  const [answers, setAnswers] = React.useState<Record<string, string>>({});

  const activeModules = React.useMemo(() => (
    modules
      .filter(item => item.isActive !== false)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'ru'))
  ), [modules]);

  const visibleModules = React.useMemo(() => (
    activeModules
      .filter(item => audienceFilter === 'all' || item.audience === audienceFilter || item.audience === 'all')
      .filter(item => moduleMatchesRole(item, user?.role))
  ), [activeModules, audienceFilter, user?.role]);

  React.useEffect(() => {
    if (!visibleModules.length) {
      setSelectedModuleId('');
      return;
    }
    if (!selectedModuleId || !visibleModules.some(item => item.id === selectedModuleId)) {
      setSelectedModuleId(visibleModules[0].id);
    }
  }, [selectedModuleId, visibleModules]);

  React.useEffect(() => {
    setAnswers({});
  }, [selectedModuleId]);

  const selectedModule = visibleModules.find(item => item.id === selectedModuleId) || null;
  const currentProgress = selectedModule ? getModuleProgress(progress, selectedModule.id, user?.id) : null;
  const currentStatusMeta = getStatusMeta(currentProgress?.status || 'not_started');

  const managerUsers = React.useMemo(() => (
    users
      .filter(item => item.status === 'Активен')
      .filter(item => isManagerRole(item.role))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  ), [users]);

  const ownModules = React.useMemo(() => activeModules.filter(item => moduleMatchesRole(item, user?.role)), [activeModules, user?.role]);
  const ownProgressEntries = React.useMemo(() => progress.filter(item => item.userId === user?.id), [progress, user?.id]);
  const ownPassedCount = ownModules.filter(item => getModuleProgress(ownProgressEntries, item.id, user?.id)?.status === 'passed').length;
  const ownAverageScore = ownProgressEntries.length > 0
    ? ownProgressEntries.reduce((sum, item) => sum + (item.maxScore ? (item.score / item.maxScore) * 100 : 0), 0) / ownProgressEntries.length
    : 0;

  const managerCards = React.useMemo(() => (
    managerUsers.map((manager) => {
      const assignedModules = activeModules.filter(item => moduleMatchesRole(item, manager.role));
      const managerProgress = progress.filter(item => item.userId === manager.id);
      const passed = managerProgress.filter(item => item.status === 'passed').length;
      const inProgress = managerProgress.filter(item => item.status === 'in_progress' || item.status === 'failed').length;
      const lastActivityAt = managerProgress
        .map(item => item.updatedAt || item.lastAttemptAt || item.watchedAt || item.createdAt)
        .filter(Boolean)
        .sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())[0] || null;
      const averageScore = managerProgress.length > 0
        ? managerProgress.reduce((sum, item) => sum + (item.maxScore ? (item.score / item.maxScore) * 100 : 0), 0) / managerProgress.length
        : 0;
      const completionPercent = assignedModules.length > 0 ? (passed / assignedModules.length) * 100 : 0;
      const pendingTitles = assignedModules
        .filter(item => getModuleProgress(managerProgress, item.id, manager.id)?.status !== 'passed')
        .slice(0, 2)
        .map(item => item.title);

      return {
        id: manager.id,
        name: manager.name,
        role: manager.role || 'Менеджер',
        assignedCount: assignedModules.length,
        passedCount: passed,
        inProgressCount: inProgress,
        averageScore,
        completionPercent,
        lastActivityAt,
        pendingTitles,
      };
    }),
  ), [activeModules, managerUsers, progress]);

  const summary = React.useMemo(() => ({
    visibleModules: visibleModules.length,
    totalManagers: managerUsers.length,
    passedByMe: ownPassedCount,
    ownAverage: ownAverageScore,
  }), [managerUsers.length, ownAverageScore, ownPassedCount, visibleModules.length]);

  async function upsertProgress(data: Omit<KnowledgeBaseProgress, 'id' | 'createdAt' | 'updatedAt'>) {
    const existing = progress.find(item => item.moduleId === data.moduleId && item.userId === data.userId);
    if (existing) {
      await updateProgress.mutateAsync({
        id: existing.id,
        data: {
          ...data,
          updatedAt: nowIso(),
        },
      });
      return;
    }

    await createProgress.mutateAsync({
      ...data,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  async function handleMarkWatched() {
    if (!selectedModule || !user?.id || !canTakeTraining) return;
    await upsertProgress({
      moduleId: selectedModule.id,
      userId: user.id,
      userName: user.name,
      userRole: user.role || '',
      status: currentProgress?.status === 'passed' ? 'passed' : 'in_progress',
      watchedVideo: true,
      watchedAt: currentProgress?.watchedAt || nowIso(),
      score: currentProgress?.score || 0,
      maxScore: selectedModule.quiz.length,
      attemptsCount: currentProgress?.attemptsCount || 0,
      lastAttemptAt: currentProgress?.lastAttemptAt || null,
      completedAt: currentProgress?.completedAt || null,
    });
    toast.success('Просмотр видео отмечен.');
  }

  async function handleSubmitTest() {
    if (!selectedModule || !user?.id || !canTakeTraining) return;
    if (!currentProgress?.watchedVideo) {
      toast.error('Сначала отметьте, что видео просмотрено.');
      return;
    }
    const unanswered = selectedModule.quiz.filter(question => !answers[question.id]);
    if (unanswered.length > 0) {
      toast.error('Ответьте на все вопросы теста.');
      return;
    }

    const score = selectedModule.quiz.reduce((sum, question) => (
      answers[question.id] === question.correctOptionId ? sum + 1 : sum
    ), 0);
    const percent = selectedModule.quiz.length > 0 ? (score / selectedModule.quiz.length) * 100 : 0;
    const passed = percent >= selectedModule.passingScorePercent;

    await upsertProgress({
      moduleId: selectedModule.id,
      userId: user.id,
      userName: user.name,
      userRole: user.role || '',
      status: passed ? 'passed' : 'failed',
      watchedVideo: true,
      watchedAt: currentProgress?.watchedAt || nowIso(),
      score,
      maxScore: selectedModule.quiz.length,
      attemptsCount: (currentProgress?.attemptsCount || 0) + 1,
      lastAttemptAt: nowIso(),
      completedAt: passed ? nowIso() : currentProgress?.completedAt || null,
    });

    if (passed) {
      toast.success(`Тест пройден: ${formatPercent(percent)}.`);
    } else {
      toast.error(`Порог не пройден: ${formatPercent(percent)} из ${selectedModule.passingScorePercent}%.`);
    }
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 md:p-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
            <GraduationCap className="h-3.5 w-3.5" />
            База знаний
          </div>
          <h1 className="text-3xl font-black tracking-tight text-foreground sm:text-4xl">Обучение менеджеров</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">
            Менеджеры смотрят видео, проходят тест и фиксируют результат. Руководитель видит карточку прогресса по каждому менеджеру.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="border-border/70 bg-card/70">
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Доступно модулей</div>
              <div className="mt-2 text-3xl font-black">{summary.visibleModules}</div>
            </CardContent>
          </Card>
          <Card className="border-border/70 bg-card/70">
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Мной пройдено</div>
              <div className="mt-2 text-3xl font-black">{summary.passedByMe}</div>
            </CardContent>
          </Card>
          <Card className="border-border/70 bg-card/70">
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Мой средний результат</div>
              <div className="mt-2 text-3xl font-black">{formatPercent(summary.ownAverage || 0)}</div>
            </CardContent>
          </Card>
          <Card className="border-border/70 bg-card/70">
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Менеджеров в системе</div>
              <div className="mt-2 text-3xl font-black">{summary.totalManagers}</div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as 'courses' | 'cards')} className="space-y-6">
        <TabsList className={cn('h-auto w-full justify-start rounded-2xl border border-border/70 bg-card/60 p-1', !canReviewManagers && 'hidden')}>
          <TabsTrigger value="courses" className="rounded-xl px-4 py-2">
            Курсы и тесты
          </TabsTrigger>
          <TabsTrigger value="cards" className="rounded-xl px-4 py-2">
            Карточки менеджеров
          </TabsTrigger>
        </TabsList>

        <TabsContent value="courses" className="space-y-6">
          <Card className="border-border/70 bg-card/70">
            <CardHeader className="gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle>Каталог обучения</CardTitle>
                <CardDescription>Фильтруйте курсы по направлению и выбирайте нужный модуль.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  { value: 'all', label: 'Все модули' },
                  { value: 'rental', label: 'Аренда' },
                  { value: 'sales', label: 'Продажи' },
                ] as Array<{ value: AudienceFilter; label: string }>).map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={audienceFilter === option.value ? 'default' : 'secondary'}
                    className={cn(
                      'rounded-full',
                      audienceFilter === option.value
                        ? 'bg-lime-300 text-slate-950 hover:bg-lime-200'
                        : 'border border-border/70 bg-card text-foreground',
                    )}
                    onClick={() => setAudienceFilter(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </CardHeader>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
            <Card className="border-border/70 bg-card/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5" />
                  Модули обучения
                </CardTitle>
                <CardDescription>
                  {visibleModules.length} модулей по текущей роли и фильтру.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {visibleModules.map((module) => {
                    const moduleProgress = getModuleProgress(progress, module.id, user?.id);
                    const meta = getStatusMeta(moduleProgress?.status || 'not_started');
                    const isActive = module.id === selectedModuleId;

                    return (
                      <button
                        key={module.id}
                        type="button"
                        onClick={() => setSelectedModuleId(module.id)}
                        className={cn(
                          'w-full rounded-2xl border px-4 py-4 text-left transition-colors',
                          isActive
                            ? 'border-cyan-300/60 bg-cyan-500/10'
                            : 'border-border/70 bg-background/70 hover:bg-accent/50',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-foreground">{module.title}</div>
                            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{module.description}</div>
                          </div>
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge variant="default">{module.category}</Badge>
                          <Badge variant="info">{getAudienceLabel(module.audience)}</Badge>
                          <Badge variant="default">{module.quiz.length} вопроса</Badge>
                          {module.videoDurationMin ? (
                            <Badge variant="default">{module.videoDurationMin} мин</Badge>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card/70">
              {!selectedModule ? (
                <CardContent className="flex min-h-[420px] items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  Для текущей роли пока нет доступных модулей.
                </CardContent>
              ) : (
                <>
                  <CardHeader className="gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <CardTitle className="text-2xl">{selectedModule.title}</CardTitle>
                      <CardDescription className="mt-2 max-w-3xl text-sm leading-6">
                        {selectedModule.description}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="info">{getAudienceLabel(selectedModule.audience)}</Badge>
                      <Badge variant={currentStatusMeta.variant}>{currentStatusMeta.label}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_340px]">
                      <div className="space-y-4">
                        <div className="overflow-hidden rounded-3xl border border-border/70 bg-black">
                          {getVideoSource(selectedModule.videoUrl) ? (
                            <video
                              controls
                              preload="metadata"
                              className="aspect-video h-full w-full bg-black object-cover"
                              src={getVideoSource(selectedModule.videoUrl) || undefined}
                            />
                          ) : (
                            <div className="flex aspect-video items-center justify-center px-6 text-center text-sm text-slate-300">
                              Видео для этого модуля пока не добавлено.
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {canTakeTraining ? (
                            <Button
                              onClick={() => void handleMarkWatched()}
                              disabled={createProgress.isPending || updateProgress.isPending}
                              className="rounded-full bg-lime-300 text-slate-950 hover:bg-lime-200"
                            >
                              <PlayCircle className="h-4 w-4" />
                              Видео просмотрено
                            </Button>
                          ) : (
                            <Badge variant="default">Режим просмотра для руководителя</Badge>
                          )}
                          {currentProgress?.watchedAt ? (
                            <Badge variant="success">Просмотр отмечен: {formatDateTime(currentProgress.watchedAt)}</Badge>
                          ) : null}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <Card className="border-border/70 bg-background/70">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base">Мой прогресс по модулю</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3 text-sm">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">Статус</span>
                              <Badge variant={currentStatusMeta.variant}>{currentStatusMeta.label}</Badge>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">Попыток</span>
                              <span className="font-medium">{currentProgress?.attemptsCount || 0}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">Последний результат</span>
                              <span className="font-medium">
                                {currentProgress?.maxScore ? `${currentProgress.score}/${currentProgress.maxScore}` : '—'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">Порог прохождения</span>
                              <span className="font-medium">{selectedModule.passingScorePercent}%</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">Последняя активность</span>
                              <span className="font-medium text-right">{formatDateTime(currentProgress?.lastAttemptAt || currentProgress?.watchedAt)}</span>
                            </div>
                          </CardContent>
                        </Card>

                        <Card className="border-border/70 bg-background/70">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base">Что нужно сделать</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2 text-sm text-muted-foreground">
                            <div>1. Посмотреть видеоурок по теме.</div>
                            <div>2. Отметить просмотр кнопкой выше.</div>
                            <div>3. Ответить на все вопросы теста.</div>
                            <div>4. Набрать не меньше {selectedModule.passingScorePercent}%.</div>
                          </CardContent>
                        </Card>
                      </div>
                    </div>

                    <Card className="border-border/70 bg-background/70">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <Trophy className="h-5 w-5" />
                          Тест по модулю
                        </CardTitle>
                        <CardDescription>
                          Ответьте на все вопросы. Результат сохранится в карточке прохождения обучения.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        {selectedModule.quiz.map((question, index) => (
                          <div key={question.id} className="rounded-2xl border border-border/70 bg-card p-4">
                            <div className="mb-3 text-sm font-semibold text-foreground">
                              {index + 1}. {question.question}
                            </div>
                            <div className="space-y-2">
                              {question.options.map((option) => {
                                const selected = answers[question.id] === option.id;
                                return (
                                  <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => setAnswers((current) => ({ ...current, [question.id]: option.id }))}
                                    className={cn(
                                      'w-full rounded-xl border px-3 py-3 text-left text-sm transition-colors',
                                      selected
                                        ? 'border-lime-300/70 bg-lime-300/10 text-foreground'
                                        : 'border-border/70 bg-background hover:bg-accent/50',
                                    )}
                                  >
                                    {option.text}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}

                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3">
                          <div className="text-sm text-muted-foreground">
                            {canTakeTraining
                              ? 'После сдачи теста карточка прохождения обновится автоматически.'
                              : 'Тест проходит только менеджер под своей учётной записью.'}
                          </div>
                          {canTakeTraining ? (
                            <Button
                              onClick={() => void handleSubmitTest()}
                              disabled={createProgress.isPending || updateProgress.isPending}
                              className="rounded-full bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              Завершить тест
                            </Button>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  </CardContent>
                </>
              )}
            </Card>
          </div>

          {!canReviewManagers && canTakeTraining ? (
            <Card className="border-border/70 bg-card/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserRound className="h-5 w-5" />
                  Моя карточка обучения
                </CardTitle>
                <CardDescription>Итог по всем назначенным модулям обучения.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-3xl border border-border/70 bg-background/70 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-semibold">{user?.name}</div>
                      <div className="text-sm text-muted-foreground">{user?.role}</div>
                    </div>
                    <Badge variant={ownPassedCount === ownModules.length && ownModules.length > 0 ? 'success' : 'warning'}>
                      {ownPassedCount}/{ownModules.length} модулей
                    </Badge>
                  </div>
                  <div className="mt-4 h-2 rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-lime-300"
                      style={{ width: `${ownModules.length > 0 ? (ownPassedCount / ownModules.length) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-border/70 bg-card p-3">
                      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Назначено</div>
                      <div className="mt-1 text-2xl font-black">{ownModules.length}</div>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-card p-3">
                      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Пройдено</div>
                      <div className="mt-1 text-2xl font-black">{ownPassedCount}</div>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-card p-3">
                      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Средний балл</div>
                      <div className="mt-1 text-2xl font-black">{formatPercent(ownAverageScore)}</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {canReviewManagers ? (
          <TabsContent value="cards" className="space-y-6">
            <Card className="border-border/70 bg-card/70">
              <CardHeader>
                <CardTitle>Карточки прохождения обучения</CardTitle>
                <CardDescription>
                  Видно, кто из менеджеров уже прошёл обучение, сколько модулей осталось и какой средний результат по тестам.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                  {managerCards.map((card) => (
                    <div key={card.id} className="rounded-3xl border border-border/70 bg-background/70 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold text-foreground">{card.name}</div>
                          <div className="text-sm text-muted-foreground">{card.role}</div>
                        </div>
                        <Badge variant={card.passedCount === card.assignedCount && card.assignedCount > 0 ? 'success' : 'warning'}>
                          {card.passedCount}/{card.assignedCount}
                        </Badge>
                      </div>

                      <div className="mt-4 h-2 rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-cyan-300"
                          style={{ width: `${card.completionPercent}%` }}
                        />
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl border border-border/70 bg-card p-3">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Пройдено</div>
                          <div className="mt-1 text-xl font-black">{card.passedCount}</div>
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-card p-3">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">В работе</div>
                          <div className="mt-1 text-xl font-black">{card.inProgressCount}</div>
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-card p-3">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Средний балл</div>
                          <div className="mt-1 text-xl font-black">{formatPercent(card.averageScore)}</div>
                        </div>
                      </div>

                      <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Clock3 className="h-4 w-4" />
                          Последняя активность: {formatDateTime(card.lastActivityAt)}
                        </div>
                        <div className="flex items-start gap-2">
                          <Video className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>
                            Осталось: {card.pendingTitles.length > 0 ? card.pendingTitles.join(', ') : 'все модули закрыты'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
