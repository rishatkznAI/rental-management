import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  CheckCircle2,
  Clock3,
  GraduationCap,
  PencilLine,
  PlayCircle,
  Plus,
  Trophy,
  UserRound,
  Video,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { useAuth } from '../contexts/AuthContext';
import {
  useCreateKnowledgeBaseModule,
  useCreateKnowledgeBaseProgress,
  useDeleteKnowledgeBaseModule,
  useKnowledgeBaseModulesList,
  useKnowledgeBaseProgressList,
  useUpdateKnowledgeBaseModule,
  useUpdateKnowledgeBaseProgress,
} from '../hooks/useKnowledgeBase';
import { cn } from '../lib/utils';
import { usersService } from '../services/users.service';
import type {
  KnowledgeBaseAudience,
  KnowledgeBaseModule,
  KnowledgeBaseProgress,
  KnowledgeBaseProgressStatus,
  KnowledgeBaseQuestion,
  KnowledgeBaseQuestionOption,
} from '../types';

type AudienceFilter = 'all' | 'rental' | 'sales';

type TrainingUser = {
  id: string;
  name: string;
  role?: string;
  status?: string;
};

type ModuleEditorState = {
  title: string;
  category: string;
  audience: KnowledgeBaseAudience;
  description: string;
  videoUrl: string;
  videoDurationMin: string;
  passingScorePercent: string;
  sortOrder: string;
  isActive: boolean;
  quiz: KnowledgeBaseQuestion[];
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

function createLocalId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEditorOption(text = ''): KnowledgeBaseQuestionOption {
  return {
    id: createLocalId('opt'),
    text,
  };
}

function createEditorQuestion(): KnowledgeBaseQuestion {
  const optionA = createEditorOption();
  const optionB = createEditorOption();
  return {
    id: createLocalId('q'),
    question: '',
    options: [optionA, optionB],
    correctOptionId: optionA.id,
    explanation: '',
  };
}

function createEmptyModuleState(audience: KnowledgeBaseAudience = 'all', sortOrder = 0): ModuleEditorState {
  return {
    title: '',
    category: '',
    audience,
    description: '',
    videoUrl: '',
    videoDurationMin: '',
    passingScorePercent: '70',
    sortOrder: String(sortOrder),
    isActive: true,
    quiz: [createEditorQuestion()],
  };
}

function moduleToEditorState(module: KnowledgeBaseModule): ModuleEditorState {
  return {
    title: module.title,
    category: module.category,
    audience: module.audience,
    description: module.description,
    videoUrl: module.videoUrl || '',
    videoDurationMin: module.videoDurationMin ? String(module.videoDurationMin) : '',
    passingScorePercent: String(module.passingScorePercent),
    sortOrder: String(module.sortOrder),
    isActive: module.isActive !== false,
    quiz: module.quiz.map((question) => ({
      ...question,
      explanation: question.explanation || '',
      options: question.options.map((option) => ({ ...option })),
    })),
  };
}

function validateModuleEditor(editor: ModuleEditorState) {
  if (!editor.title.trim()) return 'Укажите название модуля.';
  if (!editor.category.trim()) return 'Укажите направление или категорию.';
  if (!editor.description.trim()) return 'Добавьте краткое описание модуля.';

  const passingScorePercent = Number(editor.passingScorePercent);
  if (!Number.isFinite(passingScorePercent) || passingScorePercent < 1 || passingScorePercent > 100) {
    return 'Порог прохождения должен быть в диапазоне от 1 до 100.';
  }

  const sortOrder = Number(editor.sortOrder);
  if (!Number.isFinite(sortOrder) || sortOrder < 0) {
    return 'Порядок сортировки должен быть числом 0 или больше.';
  }

  if (!editor.quiz.length) return 'Добавьте хотя бы один вопрос в тест.';

  for (const [index, question] of editor.quiz.entries()) {
    if (!question.question.trim()) return `Заполните текст вопроса ${index + 1}.`;

    const filledOptions = question.options.filter(option => option.text.trim());
    if (filledOptions.length < 2) {
      return `В вопросе ${index + 1} должно быть минимум два заполненных варианта ответа.`;
    }
    if (!filledOptions.some(option => option.id === question.correctOptionId)) {
      return `В вопросе ${index + 1} выберите правильный вариант ответа.`;
    }
  }

  return null;
}

function buildModulePayload(editor: ModuleEditorState) {
  const videoDurationMin = Number(editor.videoDurationMin);
  const sortOrder = Number(editor.sortOrder);
  const passingScorePercent = Number(editor.passingScorePercent);

  return {
    title: editor.title.trim(),
    category: editor.category.trim(),
    audience: editor.audience,
    description: editor.description.trim(),
    videoUrl: editor.videoUrl.trim() || undefined,
    videoDurationMin: Number.isFinite(videoDurationMin) && videoDurationMin > 0 ? videoDurationMin : undefined,
    passingScorePercent,
    sortOrder,
    isActive: editor.isActive,
    quiz: editor.quiz.map((question) => ({
      ...question,
      question: question.question.trim(),
      explanation: question.explanation?.trim() || undefined,
      options: question.options
        .filter(option => option.text.trim())
        .map(option => ({ ...option, text: option.text.trim() })),
    })),
  };
}

function FieldLabel({ children }: React.PropsWithChildren) {
  return (
    <div className="mb-2 text-sm font-medium text-foreground">
      {children}
    </div>
  );
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
  const createModule = useCreateKnowledgeBaseModule();
  const updateModule = useUpdateKnowledgeBaseModule();
  const deleteModule = useDeleteKnowledgeBaseModule();

  const canTakeTraining = isManagerRole(user?.role);
  const canReviewManagers = isReviewerRole(user?.role);
  const canManageModules = canReviewManagers;
  const canDeleteModules = user?.role === 'Администратор';

  const [tab, setTab] = React.useState<'courses' | 'cards'>('courses');
  const [audienceFilter, setAudienceFilter] = React.useState<AudienceFilter>(
    user?.role === 'Менеджер по аренде' ? 'rental' : user?.role === 'Менеджер по продажам' ? 'sales' : 'all',
  );
  const [selectedModuleId, setSelectedModuleId] = React.useState<string>('');
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingModuleId, setEditingModuleId] = React.useState<string | null>(null);
  const [editorState, setEditorState] = React.useState<ModuleEditorState>(() => createEmptyModuleState('all', 1));

  const moduleCatalog = React.useMemo(() => (
    [...modules].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'ru'))
  ), [modules]);

  const activeModules = React.useMemo(() => (
    moduleCatalog.filter(item => item.isActive !== false)
  ), [moduleCatalog]);

  const visibleModules = React.useMemo(() => (
    moduleCatalog
      .filter(item => audienceFilter === 'all' || item.audience === audienceFilter || item.audience === 'all')
      .filter(item => moduleMatchesRole(item, user?.role))
      .filter(item => canManageModules || item.isActive !== false)
  ), [audienceFilter, canManageModules, moduleCatalog, user?.role]);

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
    })
  ), [activeModules, managerUsers, progress]);

  const summary = React.useMemo(() => ({
    visibleModules: visibleModules.length,
    totalManagers: managerUsers.length,
    passedByMe: ownPassedCount,
    ownAverage: ownAverageScore,
  }), [managerUsers.length, ownAverageScore, ownPassedCount, visibleModules.length]);

  const editingModule = editingModuleId
    ? moduleCatalog.find(item => item.id === editingModuleId) || null
    : null;
  const isSavingModule = createModule.isPending || updateModule.isPending || deleteModule.isPending;

  function openCreateModuleEditor() {
    const defaultAudience = audienceFilter === 'all' ? 'all' : audienceFilter;
    setEditingModuleId(null);
    setEditorState(createEmptyModuleState(defaultAudience, moduleCatalog.length + 1));
    setEditorOpen(true);
  }

  function openEditModuleEditor(module: KnowledgeBaseModule) {
    setEditingModuleId(module.id);
    setEditorState(moduleToEditorState(module));
    setEditorOpen(true);
  }

  function updateEditorQuestion(questionId: string, updater: (question: KnowledgeBaseQuestion) => KnowledgeBaseQuestion) {
    setEditorState(current => ({
      ...current,
      quiz: current.quiz.map(question => question.id === questionId ? updater(question) : question),
    }));
  }

  function addEditorQuestion() {
    setEditorState(current => ({
      ...current,
      quiz: [...current.quiz, createEditorQuestion()],
    }));
  }

  function removeEditorQuestion(questionId: string) {
    setEditorState(current => {
      if (current.quiz.length <= 1) {
        toast.error('В модуле должен остаться хотя бы один вопрос.');
        return current;
      }
      return {
        ...current,
        quiz: current.quiz.filter(question => question.id !== questionId),
      };
    });
  }

  function addEditorOption(questionId: string) {
    updateEditorQuestion(questionId, question => ({
      ...question,
      options: [...question.options, createEditorOption()],
    }));
  }

  function removeEditorOption(questionId: string, optionId: string) {
    updateEditorQuestion(questionId, (question) => {
      if (question.options.length <= 2) {
        toast.error('У вопроса должно остаться минимум два варианта ответа.');
        return question;
      }

      const nextOptions = question.options.filter(option => option.id !== optionId);
      return {
        ...question,
        options: nextOptions,
        correctOptionId: question.correctOptionId === optionId ? nextOptions[0]?.id || '' : question.correctOptionId,
      };
    });
  }

  async function handleSaveModule() {
    const validationError = validateModuleEditor(editorState);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const payload = buildModulePayload(editorState);

    if (editingModule) {
      const updated = await updateModule.mutateAsync({
        id: editingModule.id,
        data: {
          ...payload,
          updatedAt: nowIso(),
        },
      });
      setSelectedModuleId(updated.id);
      toast.success('Модуль обновлён.');
    } else {
      const created = await createModule.mutateAsync({
        ...payload,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      setAudienceFilter(created.audience === 'all' ? 'all' : created.audience);
      setSelectedModuleId(created.id);
      toast.success('Модуль создан.');
    }

    setEditorOpen(false);
  }

  async function handleDeleteModule() {
    if (!editingModule || !canDeleteModules) return;
    const confirmed = window.confirm(`Удалить модуль «${editingModule.title}»? Это действие нельзя отменить.`);
    if (!confirmed) return;

    await deleteModule.mutateAsync(editingModule.id);
    setEditorOpen(false);
    if (selectedModuleId === editingModule.id) {
      const nextModule = visibleModules.find(item => item.id !== editingModule.id);
      setSelectedModuleId(nextModule?.id || '');
    }
    toast.success('Модуль удалён.');
  }

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
            <CardHeader className="gap-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <CardTitle>Каталог обучения</CardTitle>
                  <CardDescription>Фильтруйте курсы по направлению и выбирайте нужный модуль.</CardDescription>
                </div>
                {canManageModules ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full border-border/70"
                      onClick={() => openEditModuleEditor(selectedModule)}
                      disabled={!selectedModule}
                    >
                      <PencilLine className="h-4 w-4" />
                      Редактировать модуль
                    </Button>
                    <Button
                      type="button"
                      className="rounded-full bg-lime-300 text-slate-950 hover:bg-lime-200"
                      onClick={openCreateModuleEditor}
                    >
                      <Plus className="h-4 w-4" />
                      Новый модуль
                    </Button>
                  </div>
                ) : null}
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
              {canManageModules ? (
                <div className="rounded-2xl border border-dashed border-border/70 bg-background/40 px-4 py-3 text-sm text-muted-foreground">
                  Администратор и офис-менеджер могут создавать и редактировать модули прямо здесь: описание, видео, порог прохождения и вопросы теста.
                </div>
              ) : null}
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
                          <Badge variant={module.isActive !== false ? meta.variant : 'warning'}>
                            {module.isActive !== false ? meta.label : 'Черновик'}
                          </Badge>
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
                      {selectedModule.isActive === false ? <Badge variant="warning">Неактивен</Badge> : null}
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
                            {question.explanation ? (
                              <div className="mt-3 rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                                Подсказка для руководителя: {question.explanation}
                              </div>
                            ) : null}
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

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto p-0 sm:max-w-5xl">
          <div className="flex min-h-0 flex-col">
            <DialogHeader className="border-b border-border/70 px-6 py-5">
              <DialogTitle>{editingModule ? 'Редактирование модуля' : 'Новый модуль обучения'}</DialogTitle>
              <DialogDescription>
                Заполните карточку курса, добавьте видео и соберите тест. Этот модуль сразу появится в базе знаний.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 px-6 py-5">
              <div className="grid gap-6 lg:grid-cols-2">
                <Card className="border-border/70 bg-background/60">
                  <CardHeader>
                    <CardTitle className="text-base">Карточка модуля</CardTitle>
                    <CardDescription>Название, аудитория и базовые настройки курса.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <FieldLabel>Название модуля</FieldLabel>
                      <Input
                        value={editorState.title}
                        onChange={event => setEditorState(current => ({ ...current, title: event.target.value }))}
                        placeholder="Например, Контроль дебиторки по аренде"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <FieldLabel>Категория / направление</FieldLabel>
                      <Input
                        value={editorState.category}
                        onChange={event => setEditorState(current => ({ ...current, category: event.target.value }))}
                        placeholder="Аренда, Продажи, CRM, Общие"
                        autoComplete="off"
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <FieldLabel>Для кого модуль</FieldLabel>
                        <Select
                          value={editorState.audience}
                          onValueChange={(value) => setEditorState(current => ({ ...current, audience: value as KnowledgeBaseAudience }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Выберите аудиторию" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Все менеджеры</SelectItem>
                            <SelectItem value="rental">Менеджеры аренды</SelectItem>
                            <SelectItem value="sales">Менеджеры продаж</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <FieldLabel>Активность</FieldLabel>
                        <div className="flex rounded-xl border border-border/70 bg-card p-1">
                          <button
                            type="button"
                            className={cn(
                              'flex-1 rounded-lg px-3 py-2 text-sm transition-colors',
                              editorState.isActive ? 'bg-lime-300 font-medium text-slate-950' : 'text-muted-foreground',
                            )}
                            onClick={() => setEditorState(current => ({ ...current, isActive: true }))}
                          >
                            Активен
                          </button>
                          <button
                            type="button"
                            className={cn(
                              'flex-1 rounded-lg px-3 py-2 text-sm transition-colors',
                              !editorState.isActive ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground',
                            )}
                            onClick={() => setEditorState(current => ({ ...current, isActive: false }))}
                          >
                            Черновик
                          </button>
                        </div>
                      </div>
                    </div>
                    <div>
                      <FieldLabel>Описание</FieldLabel>
                      <Textarea
                        rows={4}
                        value={editorState.description}
                        onChange={event => setEditorState(current => ({ ...current, description: event.target.value }))}
                        placeholder="Коротко объясните, чему учит модуль и какой навык он должен закрыть."
                        autoComplete="off"
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/70 bg-background/60">
                  <CardHeader>
                    <CardTitle className="text-base">Видео и прохождение</CardTitle>
                    <CardDescription>Ссылка на ролик, длительность и порог сдачи теста.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <FieldLabel>Ссылка на видео</FieldLabel>
                      <Input
                        value={editorState.videoUrl}
                        onChange={event => setEditorState(current => ({ ...current, videoUrl: event.target.value }))}
                        placeholder="https://..."
                        autoComplete="off"
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div>
                        <FieldLabel>Длительность, мин</FieldLabel>
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={editorState.videoDurationMin}
                          onChange={event => setEditorState(current => ({
                            ...current,
                            videoDurationMin: event.target.value.replace(/[^\d]/g, ''),
                          }))}
                          placeholder="8"
                          autoComplete="off"
                        />
                      </div>
                      <div>
                        <FieldLabel>Порог, %</FieldLabel>
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={editorState.passingScorePercent}
                          onChange={event => setEditorState(current => ({
                            ...current,
                            passingScorePercent: event.target.value.replace(/[^\d]/g, ''),
                          }))}
                          placeholder="70"
                          autoComplete="off"
                        />
                      </div>
                      <div>
                        <FieldLabel>Порядок</FieldLabel>
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={editorState.sortOrder}
                          onChange={event => setEditorState(current => ({
                            ...current,
                            sortOrder: event.target.value.replace(/[^\d]/g, ''),
                          }))}
                          placeholder="1"
                          autoComplete="off"
                        />
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-card px-4 py-3 text-sm text-muted-foreground">
                      Менеджер смотрит видео, отмечает просмотр и проходит тест. Порог задаёт минимальный процент правильных ответов для статуса «Пройдено».
                    </div>
                    <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                      Если видео ещё не готово, модуль можно сохранить черновиком и активировать позже.
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card className="border-border/70 bg-background/60">
                <CardHeader className="gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardTitle className="text-base">Тест по модулю</CardTitle>
                    <CardDescription>Соберите вопросы, варианты ответов и отметьте правильные.</CardDescription>
                  </div>
                  <Button type="button" variant="outline" className="rounded-full" onClick={addEditorQuestion}>
                    <Plus className="h-4 w-4" />
                    Добавить вопрос
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {editorState.quiz.map((question, questionIndex) => (
                    <div key={question.id} className="rounded-2xl border border-border/70 bg-card/80 p-4">
                      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-foreground">Вопрос {questionIndex + 1}</div>
                          <div className="text-xs text-muted-foreground">Менеджер увидит вопрос именно в таком виде в тесте.</div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          className="rounded-full text-muted-foreground hover:text-foreground"
                          onClick={() => removeEditorQuestion(question.id)}
                        >
                          Удалить вопрос
                        </Button>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <FieldLabel>Текст вопроса</FieldLabel>
                          <Textarea
                            rows={2}
                            value={question.question}
                            onChange={(event) => updateEditorQuestion(question.id, current => ({
                              ...current,
                              question: event.target.value,
                            }))}
                            placeholder="Например, когда менеджер должен фиксировать следующий шаг в CRM?"
                            autoComplete="off"
                          />
                        </div>

                        <div>
                          <FieldLabel>Комментарий / пояснение</FieldLabel>
                          <Textarea
                            rows={2}
                            value={question.explanation || ''}
                            onChange={(event) => updateEditorQuestion(question.id, current => ({
                              ...current,
                              explanation: event.target.value,
                            }))}
                            placeholder="Необязательно. Можно указать подсказку для руководителя или объяснение правильного ответа."
                            autoComplete="off"
                          />
                        </div>

                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <FieldLabel>Варианты ответа</FieldLabel>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="rounded-full"
                              onClick={() => addEditorOption(question.id)}
                            >
                              <Plus className="h-4 w-4" />
                              Добавить вариант
                            </Button>
                          </div>
                          <div className="space-y-3">
                            {question.options.map((option, optionIndex) => (
                              <div key={option.id} className="rounded-xl border border-border/70 bg-background/70 p-3">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                    Вариант {optionIndex + 1}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={question.correctOptionId === option.id ? 'default' : 'outline'}
                                      className={cn(
                                        'rounded-full',
                                        question.correctOptionId === option.id && 'bg-cyan-300 text-slate-950 hover:bg-cyan-200',
                                      )}
                                      onClick={() => updateEditorQuestion(question.id, current => ({
                                        ...current,
                                        correctOptionId: option.id,
                                      }))}
                                    >
                                      {question.correctOptionId === option.id ? 'Правильный' : 'Сделать правильным'}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      className="rounded-full text-muted-foreground hover:text-foreground"
                                      onClick={() => removeEditorOption(question.id, option.id)}
                                    >
                                      Удалить
                                    </Button>
                                  </div>
                                </div>
                                <Input
                                  value={option.text}
                                  onChange={(event) => updateEditorQuestion(question.id, current => ({
                                    ...current,
                                    options: current.options.map(currentOption => currentOption.id === option.id
                                      ? { ...currentOption, text: event.target.value }
                                      : currentOption),
                                  }))}
                                  placeholder="Введите вариант ответа"
                                  autoComplete="off"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <DialogFooter className="border-t border-border/70 px-6 py-5">
              <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  {editingModule && canDeleteModules ? (
                    <Button type="button" variant="destructive" onClick={() => void handleDeleteModule()} disabled={isSavingModule}>
                      Удалить модуль
                    </Button>
                  ) : null}
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button type="button" variant="secondary" onClick={() => setEditorOpen(false)}>
                    Отмена
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleSaveModule()}
                    disabled={isSavingModule}
                    className="bg-lime-300 text-slate-950 hover:bg-lime-200"
                  >
                    {editingModule ? 'Сохранить модуль' : 'Создать модуль'}
                  </Button>
                </div>
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
