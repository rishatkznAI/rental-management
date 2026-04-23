import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Building2,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  Target,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../lib/permissions';
import { usersService } from '../services/users.service';
import { useClientsList } from '../hooks/useClients';
import {
  useCreateCrmDeal,
  useCrmDealsList,
  useDeleteCrmDeal,
  useUpdateCrmDeal,
} from '../hooks/useCrmDeals';
import type { AuditEntry, Client, CrmDeal, CrmDealPriority, CrmDealStage, CrmPipelineType } from '../types';

type ManagerOption = {
  id: string;
  name: string;
  role?: string;
  status?: string;
};

type DealFormState = {
  pipeline: CrmPipelineType;
  title: string;
  stage: CrmDealStage;
  priority: CrmDealPriority;
  company: string;
  clientId: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  source: string;
  budget: string;
  probability: string;
  equipmentNeed: string;
  location: string;
  expectedCloseDate: string;
  nextAction: string;
  nextActionDate: string;
  responsibleUserId: string;
  notes: string;
};

type CrmViewFilter = 'all' | 'open' | 'won' | 'lost';

type StageDefinition = {
  id: CrmDealStage;
  label: string;
  hint: string;
  accent: string;
};

const NONE_VALUE = '__none__';
const ALL_VALUE = '__all__';

const PIPELINE_CONFIG: Record<CrmPipelineType, {
  label: string;
  description: string;
  createLabel: string;
  stages: StageDefinition[];
}> = {
  rental: {
    label: 'Аренда',
    description: 'Лиды и сделки по аренде техники: от первого контакта до резерва и выдачи.',
    createLabel: 'Новая сделка аренды',
    stages: [
      { id: 'lead', label: 'Новый лид', hint: 'Первичный входящий запрос', accent: 'border-sky-200 bg-sky-50/70 dark:border-sky-900/40 dark:bg-sky-950/20' },
      { id: 'qualified', label: 'Квалификация', hint: 'Поняли потребность и сроки', accent: 'border-indigo-200 bg-indigo-50/70 dark:border-indigo-900/40 dark:bg-indigo-950/20' },
      { id: 'proposal', label: 'КП и условия', hint: 'Отправили предложение', accent: 'border-amber-200 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/20' },
      { id: 'negotiation', label: 'Переговоры', hint: 'Обсуждаем цену и условия', accent: 'border-orange-200 bg-orange-50/70 dark:border-orange-900/40 dark:bg-orange-950/20' },
      { id: 'reserved', label: 'Резерв техники', hint: 'Техника и даты подтверждены', accent: 'border-violet-200 bg-violet-50/70 dark:border-violet-900/40 dark:bg-violet-950/20' },
      { id: 'won', label: 'Успешно', hint: 'Сделка выиграна', accent: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/40 dark:bg-emerald-950/20' },
      { id: 'lost', label: 'Потеряно', hint: 'Сделка не состоялась', accent: 'border-rose-200 bg-rose-50/70 dark:border-rose-900/40 dark:bg-rose-950/20' },
    ],
  },
  sales: {
    label: 'Продажа',
    description: 'Работа отдела продаж: от интереса клиента до счёта, согласования и закрытия.',
    createLabel: 'Новая сделка продажи',
    stages: [
      { id: 'lead', label: 'Новый лид', hint: 'Первичное обращение', accent: 'border-sky-200 bg-sky-50/70 dark:border-sky-900/40 dark:bg-sky-950/20' },
      { id: 'qualified', label: 'Квалификация', hint: 'Уточняем задачу и бюджет', accent: 'border-indigo-200 bg-indigo-50/70 dark:border-indigo-900/40 dark:bg-indigo-950/20' },
      { id: 'demo', label: 'Показ / тест', hint: 'Демо, осмотр или подбор техники', accent: 'border-fuchsia-200 bg-fuchsia-50/70 dark:border-fuchsia-900/40 dark:bg-fuchsia-950/20' },
      { id: 'proposal', label: 'КП', hint: 'Коммерческое предложение отправлено', accent: 'border-amber-200 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/20' },
      { id: 'negotiation', label: 'Переговоры', hint: 'Согласование цены и условий', accent: 'border-orange-200 bg-orange-50/70 dark:border-orange-900/40 dark:bg-orange-950/20' },
      { id: 'invoice', label: 'Счёт / договор', hint: 'Документы на подписи и оплате', accent: 'border-cyan-200 bg-cyan-50/70 dark:border-cyan-900/40 dark:bg-cyan-950/20' },
      { id: 'won', label: 'Успешно', hint: 'Продажа состоялась', accent: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/40 dark:bg-emerald-950/20' },
      { id: 'lost', label: 'Потеряно', hint: 'Сделка не состоялась', accent: 'border-rose-200 bg-rose-50/70 dark:border-rose-900/40 dark:bg-rose-950/20' },
    ],
  },
};

const PRIORITY_META: Record<CrmDealPriority, { label: string; variant: 'default' | 'info' | 'warning' }> = {
  low: { label: 'Низкий', variant: 'default' },
  medium: { label: 'Средний', variant: 'info' },
  high: { label: 'Высокий', variant: 'warning' },
};

const STATUS_META = {
  open: { label: 'В работе', variant: 'info' as const },
  won: { label: 'Успешно', variant: 'success' as const },
  lost: { label: 'Потеряно', variant: 'danger' as const },
};

function nowIso() {
  return new Date().toISOString();
}

function formatCurrency(value?: number | null) {
  const amount = Number(value) || 0;
  return `${amount.toLocaleString('ru-RU')} ₽`;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('ru-RU');
  } catch {
    return value;
  }
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('ru-RU');
  } catch {
    return value;
  }
}

function getAllowedPipelines(role?: string): CrmPipelineType[] {
  if (role === 'Менеджер по аренде') return ['rental'];
  if (role === 'Менеджер по продажам') return ['sales'];
  return ['rental', 'sales'];
}

function stageToStatus(stage: CrmDealStage) {
  if (stage === 'won') return 'won';
  if (stage === 'lost') return 'lost';
  return 'open';
}

function getStageLabel(pipeline: CrmPipelineType, stage: CrmDealStage) {
  return PIPELINE_CONFIG[pipeline].stages.find((item) => item.id === stage)?.label || stage;
}

function getHistoryEntry(text: string, author: string): AuditEntry {
  return {
    date: nowIso(),
    text,
    author,
    type: 'system',
  };
}

function normalizeSearch(text: string) {
  return text.trim().toLowerCase();
}

function matchesSearch(deal: CrmDeal, needle: string) {
  if (!needle) return true;
  return [
    deal.title,
    deal.company,
    deal.contactName,
    deal.contactPhone,
    deal.contactEmail,
    deal.source,
    deal.equipmentNeed,
    deal.location,
    deal.responsibleUserName,
    deal.notes,
    getStageLabel(deal.pipeline, deal.stage),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

function isPipelineManager(role: string | undefined, pipeline: CrmPipelineType) {
  if (role === 'Администратор' || role === 'Офис-менеджер') return true;
  if (pipeline === 'rental') return role === 'Менеджер по аренде';
  return role === 'Менеджер по продажам';
}

function makeEmptyForm(pipeline: CrmPipelineType, userId?: string) {
  return {
    pipeline,
    title: '',
    stage: 'lead' as CrmDealStage,
    priority: 'medium' as CrmDealPriority,
    company: '',
    clientId: NONE_VALUE,
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    source: '',
    budget: '',
    probability: '',
    equipmentNeed: '',
    location: '',
    expectedCloseDate: '',
    nextAction: '',
    nextActionDate: '',
    responsibleUserId: userId || NONE_VALUE,
    notes: '',
  };
}

function buildFormFromDeal(deal: CrmDeal): DealFormState {
  return {
    pipeline: deal.pipeline,
    title: deal.title,
    stage: deal.stage,
    priority: deal.priority,
    company: deal.company,
    clientId: deal.clientId || NONE_VALUE,
    contactName: deal.contactName || '',
    contactPhone: deal.contactPhone || '',
    contactEmail: deal.contactEmail || '',
    source: deal.source || '',
    budget: deal.budget ? String(deal.budget) : '',
    probability: Number.isFinite(Number(deal.probability)) ? String(deal.probability) : '',
    equipmentNeed: deal.equipmentNeed || '',
    location: deal.location || '',
    expectedCloseDate: deal.expectedCloseDate || '',
    nextAction: deal.nextAction || '',
    nextActionDate: deal.nextActionDate || '',
    responsibleUserId: deal.responsibleUserId || NONE_VALUE,
    notes: deal.notes || '',
  };
}

function getAdjacentStage(pipeline: CrmPipelineType, stage: CrmDealStage, direction: -1 | 1) {
  const stages = PIPELINE_CONFIG[pipeline].stages;
  const currentIndex = stages.findIndex((item) => item.id === stage);
  if (currentIndex === -1) return null;
  return stages[currentIndex + direction] || null;
}

function isOverdueNextAction(deal: CrmDeal) {
  if (!deal.nextActionDate || deal.status !== 'open') return false;
  return deal.nextActionDate < new Date().toISOString().slice(0, 10);
}

export default function CRM() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const { data: deals = [], isLoading } = useCrmDealsList();
  const { data: clients = [] } = useClientsList();
  const { data: managers = [] } = useQuery<ManagerOption[]>({
    queryKey: ['crm-managers'],
    queryFn: usersService.getAll,
    staleTime: 1000 * 60 * 5,
  });
  const createDeal = useCreateCrmDeal();
  const updateDeal = useUpdateCrmDeal();
  const deleteDeal = useDeleteCrmDeal();

  const canCreateDeal = can('create', 'crm');
  const canEditDeal = can('edit', 'crm');
  const canDeleteDeal = can('delete', 'crm');
  const allowedPipelines = getAllowedPipelines(user?.role);

  const [pipeline, setPipeline] = React.useState<CrmPipelineType>(allowedPipelines[0] || 'rental');
  const [search, setSearch] = React.useState('');
  const [managerFilter, setManagerFilter] = React.useState(ALL_VALUE);
  const [viewFilter, setViewFilter] = React.useState<CrmViewFilter>('all');
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [editingDeal, setEditingDeal] = React.useState<CrmDeal | null>(null);
  const [form, setForm] = React.useState<DealFormState>(makeEmptyForm(pipeline, user?.id));
  const [formError, setFormError] = React.useState('');

  React.useEffect(() => {
    const nextAllowed = getAllowedPipelines(user?.role);
    if (!nextAllowed.includes(pipeline)) {
      setPipeline(nextAllowed[0] || 'rental');
    }
  }, [pipeline, user?.role]);

  const managerOptions = managers
    .filter((item) => item.status !== 'Неактивен')
    .filter((item) => isPipelineManager(item.role, pipeline));

  const scopedDeals = deals
    .filter((deal) => allowedPipelines.includes(deal.pipeline))
    .filter((deal) => {
      if (user?.role === 'Менеджер по аренде' || user?.role === 'Менеджер по продажам') {
        return deal.responsibleUserId === user.id
          || deal.responsibleUserName === user.name
          || deal.createdBy === user.name;
      }
      return true;
    });

  function resetForm(nextPipeline = pipeline) {
    setForm(makeEmptyForm(nextPipeline, user?.id));
    setEditingDeal(null);
    setFormError('');
  }

  function openCreateDeal(nextPipeline = pipeline) {
    resetForm(nextPipeline);
    setSheetOpen(true);
  }

  function openEditDeal(deal: CrmDeal) {
    setEditingDeal(deal);
    setForm(buildFormFromDeal(deal));
    setFormError('');
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    resetForm(pipeline);
  }

  function handleClientChange(value: string) {
    const selectedClient = clients.find((item) => item.id === value);
    setForm((current) => ({
      ...current,
      clientId: value,
      company: selectedClient?.company || current.company,
      contactName: selectedClient?.contact || current.contactName,
      contactPhone: selectedClient?.phone || current.contactPhone,
      contactEmail: selectedClient?.email || current.contactEmail,
    }));
  }

  function handlePipelineChange(nextPipeline: CrmPipelineType) {
    const nextManagers = managers.filter((item) => item.status !== 'Неактивен' && isPipelineManager(item.role, nextPipeline));
    setForm((current) => ({
      ...current,
      pipeline: nextPipeline,
      stage: 'lead',
      responsibleUserId: nextManagers.some((item) => item.id === current.responsibleUserId)
        ? current.responsibleUserId
        : (user?.id || NONE_VALUE),
    }));
  }

  async function handleSaveDeal() {
    if (!form.title.trim()) {
      setFormError('Укажите название сделки.');
      return;
    }
    if (!form.company.trim()) {
      setFormError('Укажите компанию или клиента.');
      return;
    }

    const selectedManager = managers.find((item) => item.id === form.responsibleUserId);
    const budget = form.budget.trim() ? Math.max(0, Number(form.budget) || 0) : 0;
    const probability = form.probability.trim() ? Math.min(100, Math.max(0, Number(form.probability) || 0)) : undefined;
    const status = stageToStatus(form.stage);

    if (editingDeal) {
      const changes: string[] = [];
      if (editingDeal.stage !== form.stage) {
        changes.push(`Этап: ${getStageLabel(editingDeal.pipeline, editingDeal.stage)} → ${getStageLabel(form.pipeline, form.stage)}`);
      }
      if (editingDeal.responsibleUserId !== (form.responsibleUserId === NONE_VALUE ? null : form.responsibleUserId)) {
        changes.push(`Ответственный: ${editingDeal.responsibleUserName || 'Не назначен'} → ${selectedManager?.name || 'Не назначен'}`);
      }

      const history = [...(editingDeal.history || [])];
      history.push(
        getHistoryEntry(
          changes.length > 0 ? `Карточка обновлена. ${changes.join('. ')}` : 'Карточка обновлена.',
          user?.name || 'Система',
        ),
      );

      await updateDeal.mutateAsync({
        id: editingDeal.id,
        data: {
          pipeline: form.pipeline,
          title: form.title.trim(),
          stage: form.stage,
          status,
          priority: form.priority,
          company: form.company.trim(),
          clientId: form.clientId === NONE_VALUE ? null : form.clientId,
          contactName: form.contactName.trim() || null,
          contactPhone: form.contactPhone.trim() || null,
          contactEmail: form.contactEmail.trim() || null,
          source: form.source.trim() || null,
          budget,
          probability,
          equipmentNeed: form.equipmentNeed.trim() || null,
          location: form.location.trim() || null,
          expectedCloseDate: form.expectedCloseDate || null,
          nextAction: form.nextAction.trim() || null,
          nextActionDate: form.nextActionDate || null,
          responsibleUserId: form.responsibleUserId === NONE_VALUE ? null : form.responsibleUserId,
          responsibleUserName: selectedManager?.name || null,
          notes: form.notes.trim() || null,
          updatedAt: nowIso(),
          history,
        },
      });
      toast.success('Сделка обновлена');
    } else {
      await createDeal.mutateAsync({
        pipeline: form.pipeline,
        title: form.title.trim(),
        stage: form.stage,
        status,
        priority: form.priority,
        company: form.company.trim(),
        clientId: form.clientId === NONE_VALUE ? null : form.clientId,
        contactName: form.contactName.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
        contactEmail: form.contactEmail.trim() || null,
        source: form.source.trim() || null,
        budget,
        probability,
        equipmentNeed: form.equipmentNeed.trim() || null,
        location: form.location.trim() || null,
        expectedCloseDate: form.expectedCloseDate || null,
        nextAction: form.nextAction.trim() || null,
        nextActionDate: form.nextActionDate || null,
        responsibleUserId: form.responsibleUserId === NONE_VALUE ? null : form.responsibleUserId,
        responsibleUserName: selectedManager?.name || user?.name || null,
        notes: form.notes.trim() || null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        createdBy: user?.name || 'Система',
        history: [getHistoryEntry(`Сделка создана в воронке «${PIPELINE_CONFIG[form.pipeline].label}».`, user?.name || 'Система')],
      });
      toast.success('Сделка создана');
    }

    closeSheet();
  }

  async function handleDeleteDeal(deal: CrmDeal) {
    if (!window.confirm(`Удалить сделку «${deal.title}»?`)) return;
    await deleteDeal.mutateAsync(deal.id);
    toast.success('Сделка удалена');
  }

  async function moveDeal(deal: CrmDeal, direction: -1 | 1) {
    const nextStage = getAdjacentStage(deal.pipeline, deal.stage, direction);
    if (!nextStage) return;
    await updateDeal.mutateAsync({
      id: deal.id,
      data: {
        stage: nextStage.id,
        status: stageToStatus(nextStage.id),
        updatedAt: nowIso(),
        history: [
          ...(deal.history || []),
          getHistoryEntry(
            `Этап изменён: ${getStageLabel(deal.pipeline, deal.stage)} → ${nextStage.label}`,
            user?.name || 'Система',
          ),
        ],
      },
    });
    toast.success(`Сделка переведена на этап «${nextStage.label}»`);
  }

  if (isLoading) {
    return (
      <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">CRM</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Загрузка CRM-воронок…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Briefcase className="h-3.5 w-3.5" />
            CRM
          </div>
          <h1 className="mt-3 text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">CRM</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
            Две отдельные воронки для аренды и продаж. Менеджеры работают по своим сделкам, офис и администратор видят всю картину.
          </p>
        </div>

        {canCreateDeal && (
          <Button onClick={() => openCreateDeal(pipeline)}>
            <Plus className="h-4 w-4" />
            {PIPELINE_CONFIG[pipeline].createLabel}
          </Button>
        )}
      </div>

      <Tabs value={pipeline} onValueChange={(value) => setPipeline(value as CrmPipelineType)} className="space-y-4">
        <TabsList className={`w-full ${allowedPipelines.length === 1 ? 'max-w-sm' : 'max-w-md'}`}>
          {allowedPipelines.map((item) => (
            <TabsTrigger key={item} value={item}>
              {PIPELINE_CONFIG[item].label}
            </TabsTrigger>
          ))}
        </TabsList>

        {allowedPipelines.map((item) => (
          <TabsContent key={item} value={item} className="space-y-4">
            {(() => {
              const itemStages = PIPELINE_CONFIG[item].stages;
              const itemSummaryDeals = scopedDeals.filter((deal) => deal.pipeline === item);
              const itemOpenDeals = itemSummaryDeals.filter((deal) => deal.status === 'open');
              const itemWonDeals = itemSummaryDeals.filter((deal) => deal.status === 'won');
              const itemOverdueDeals = itemSummaryDeals.filter(isOverdueNextAction);
              const itemOpenBudget = itemOpenDeals.reduce((sum, deal) => sum + (Number(deal.budget) || 0), 0);
              const itemPipelineDeals = scopedDeals
                .filter((deal) => deal.pipeline === item)
                .filter((deal) => managerFilter === ALL_VALUE || deal.responsibleUserId === managerFilter)
                .filter((deal) => {
                  if (viewFilter === 'all') return true;
                  return deal.status === viewFilter;
                })
                .filter((deal) => matchesSearch(deal, normalizeSearch(search)))
                .sort((left, right) => {
                  const leftTime = Date.parse(left.updatedAt || left.createdAt || '') || 0;
                  const rightTime = Date.parse(right.updatedAt || right.createdAt || '') || 0;
                  return rightTime - leftTime;
                });

              return (
                <>
            <Card className="border-primary/10">
              <CardHeader className="border-b">
                <CardTitle>{PIPELINE_CONFIG[item].label}</CardTitle>
                <CardDescription>{PIPELINE_CONFIG[item].description}</CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="grid gap-4 lg:grid-cols-4">
                  <Card className="border-blue-200/70 bg-blue-50/70 dark:border-blue-900/40 dark:bg-blue-950/20">
                    <CardHeader className="gap-2">
                      <CardDescription>Открытых сделок</CardDescription>
                      <CardTitle className="text-3xl font-bold text-blue-900 dark:text-blue-100">{itemOpenDeals.length}</CardTitle>
                    </CardHeader>
                  </Card>
                  <Card className="border-emerald-200/70 bg-emerald-50/70 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                    <CardHeader className="gap-2">
                      <CardDescription>Открытый объём</CardDescription>
                      <CardTitle className="text-3xl font-bold text-emerald-900 dark:text-emerald-100">{formatCurrency(itemOpenBudget)}</CardTitle>
                    </CardHeader>
                  </Card>
                  <Card className="border-violet-200/70 bg-violet-50/70 dark:border-violet-900/40 dark:bg-violet-950/20">
                    <CardHeader className="gap-2">
                      <CardDescription>Успешно закрыто</CardDescription>
                      <CardTitle className="text-3xl font-bold text-violet-900 dark:text-violet-100">{itemWonDeals.length}</CardTitle>
                    </CardHeader>
                  </Card>
                  <Card className="border-amber-200/70 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/20">
                    <CardHeader className="gap-2">
                      <CardDescription>Просроченные касания</CardDescription>
                      <CardTitle className="text-3xl font-bold text-amber-900 dark:text-amber-100">{itemOverdueDeals.length}</CardTitle>
                    </CardHeader>
                  </Card>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_220px_220px]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Поиск по названию, компании, контакту, технике"
                      className="pl-9"
                    />
                  </div>

                  {(user?.role === 'Администратор' || user?.role === 'Офис-менеджер') ? (
                    <Select value={managerFilter} onValueChange={setManagerFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="Все менеджеры" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_VALUE}>Все менеджеры</SelectItem>
                        {managerOptions.map((manager) => (
                          <SelectItem key={manager.id} value={manager.id}>
                            {manager.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                      Только мои сделки
                    </div>
                  )}

                  <Select value={viewFilter} onValueChange={(value) => setViewFilter(value as CrmViewFilter)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все статусы</SelectItem>
                      <SelectItem value="open">В работе</SelectItem>
                      <SelectItem value="won">Успешно</SelectItem>
                      <SelectItem value="lost">Потеряно</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-4 overflow-x-auto pb-2">
              {itemStages.map((stage) => {
                const stageDeals = itemPipelineDeals.filter((deal) => deal.stage === stage.id);

                return (
                  <div key={stage.id} className="min-w-[320px] max-w-[320px] flex-1">
                    <Card className={`h-full ${stage.accent}`}>
                      <CardHeader className="border-b pb-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <CardTitle className="text-base font-semibold">{stage.label}</CardTitle>
                            <CardDescription className="mt-1 text-xs">{stage.hint}</CardDescription>
                          </div>
                          <Badge variant="default">{stageDeals.length}</Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 pt-4">
                        {stageDeals.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-border/70 bg-background/60 px-4 py-8 text-center text-sm text-muted-foreground">
                            Сделок на этом этапе пока нет.
                          </div>
                        ) : (
                          stageDeals.map((deal) => {
                            const previousStage = getAdjacentStage(deal.pipeline, deal.stage, -1);
                            const nextStage = getAdjacentStage(deal.pipeline, deal.stage, 1);

                            return (
                              <div key={deal.id} className="rounded-2xl border bg-background/95 p-4 shadow-sm">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-foreground">{deal.title}</div>
                                    <div className="mt-1 flex flex-wrap gap-2">
                                      <Badge variant={PRIORITY_META[deal.priority].variant}>{PRIORITY_META[deal.priority].label}</Badge>
                                      <Badge variant={STATUS_META[deal.status].variant}>{STATUS_META[deal.status].label}</Badge>
                                    </div>
                                  </div>
                                  <Button variant="ghost" size="icon" onClick={() => openEditDeal(deal)}>
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </div>

                                <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                                  <div className="flex items-start gap-2">
                                    <Building2 className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span className="min-w-0 break-words">{deal.company}</span>
                                  </div>
                                  {deal.contactName && (
                                    <div className="flex items-start gap-2">
                                      <Phone className="mt-0.5 h-4 w-4 shrink-0" />
                                      <span className="min-w-0 break-words">
                                        {deal.contactName}{deal.contactPhone ? ` · ${deal.contactPhone}` : ''}
                                      </span>
                                    </div>
                                  )}
                                  {deal.contactEmail && (
                                    <div className="flex items-start gap-2">
                                      <Mail className="mt-0.5 h-4 w-4 shrink-0" />
                                      <span className="min-w-0 break-words">{deal.contactEmail}</span>
                                    </div>
                                  )}
                                  {deal.equipmentNeed && (
                                    <div className="flex items-start gap-2">
                                      <Target className="mt-0.5 h-4 w-4 shrink-0" />
                                      <span className="min-w-0 break-words">{deal.equipmentNeed}</span>
                                    </div>
                                  )}
                                  <div className="flex items-start gap-2">
                                    <CircleDollarSign className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>{formatCurrency(deal.budget)}</span>
                                  </div>
                                  <div className="flex items-start gap-2">
                                    <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>План закрытия: {formatDate(deal.expectedCloseDate)}</span>
                                  </div>
                                  <div className={`flex items-start gap-2 ${isOverdueNextAction(deal) ? 'text-amber-700 dark:text-amber-300' : ''}`}>
                                    <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>
                                      {deal.nextAction || 'Следующий шаг не задан'}
                                      {deal.nextActionDate ? ` · ${formatDate(deal.nextActionDate)}` : ''}
                                    </span>
                                  </div>
                                </div>

                                <div className="mt-4 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                                  Ответственный: <span className="font-medium text-foreground">{deal.responsibleUserName || 'Не назначен'}</span>
                                </div>

                                <div className="mt-4 flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={!previousStage || !canEditDeal || updateDeal.isPending}
                                      onClick={() => moveDeal(deal, -1)}
                                    >
                                      <ArrowLeft className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={!nextStage || !canEditDeal || updateDeal.isPending}
                                      onClick={() => moveDeal(deal, 1)}
                                    >
                                      <ArrowRight className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>

                                  {canDeleteDeal && (
                                    <Button variant="ghost" size="sm" onClick={() => handleDeleteDeal(deal)}>
                                      <Trash2 className="h-3.5 w-3.5" />
                                      Удалить
                                    </Button>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </CardContent>
                    </Card>
                  </div>
                );
              })}
            </div>
                </>
              );
            })()}
          </TabsContent>
        ))}
      </Tabs>

      <Sheet open={sheetOpen} onOpenChange={(open) => (open ? setSheetOpen(true) : closeSheet())}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>{editingDeal ? 'Редактирование сделки' : PIPELINE_CONFIG[form.pipeline].createLabel}</SheetTitle>
            <SheetDescription>
              Карточка сделки для воронки «{PIPELINE_CONFIG[form.pipeline].label}». Заполняйте только рабочие поля, без лишней бюрократии.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-6 px-4 pb-4">
            {formError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
                {formError}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Воронка</label>
                <Select
                  value={form.pipeline}
                  onValueChange={(value) => handlePipelineChange(value as CrmPipelineType)}
                  disabled={Boolean(editingDeal && (user?.role === 'Менеджер по аренде' || user?.role === 'Менеджер по продажам'))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedPipelines.map((item) => (
                      <SelectItem key={item} value={item}>
                        {PIPELINE_CONFIG[item].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Этап</label>
                <Select
                  value={form.stage}
                  onValueChange={(value) => setForm((current) => ({ ...current, stage: value as CrmDealStage }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PIPELINE_CONFIG[form.pipeline].stages.map((stage) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        {stage.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">Название сделки</label>
                <Input
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder={form.pipeline === 'rental' ? 'Например, аренда XE100CED на 2 недели' : 'Например, продажа ножничного подъемника XE120W'}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Клиент из базы</label>
                <Select value={form.clientId} onValueChange={handleClientChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Не выбран" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>Без привязки</SelectItem>
                    {clients.map((client: Client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.company}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Компания / клиент</label>
                <Input
                  value={form.company}
                  onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))}
                  placeholder="Название компании"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Контактное лицо</label>
                <Input
                  value={form.contactName}
                  onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))}
                  placeholder="ФИО или должность"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Телефон</label>
                <Input
                  value={form.contactPhone}
                  onChange={(event) => setForm((current) => ({ ...current, contactPhone: event.target.value }))}
                  placeholder="+7 ..."
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Email</label>
                <Input
                  value={form.contactEmail}
                  onChange={(event) => setForm((current) => ({ ...current, contactEmail: event.target.value }))}
                  placeholder="mail@company.ru"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Источник</label>
                <Input
                  value={form.source}
                  onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))}
                  placeholder="Звонок, сайт, рекомендация, повторный клиент"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Сумма сделки</label>
                <Input
                  type="number"
                  min="0"
                  value={form.budget}
                  onChange={(event) => setForm((current) => ({ ...current, budget: event.target.value }))}
                  placeholder="0"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Вероятность, %</label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={form.probability}
                  onChange={(event) => setForm((current) => ({ ...current, probability: event.target.value }))}
                  placeholder="0-100"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {form.pipeline === 'rental' ? 'Потребность по технике' : 'Интересующая техника'}
                </label>
                <Input
                  value={form.equipmentNeed}
                  onChange={(event) => setForm((current) => ({ ...current, equipmentNeed: event.target.value }))}
                  placeholder={form.pipeline === 'rental' ? 'Модель, тип, срок аренды' : 'Модель, серия, параметры'}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Локация / объект</label>
                <Input
                  value={form.location}
                  onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
                  placeholder="Город, объект, склад, площадка"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">План закрытия</label>
                <Input
                  type="date"
                  value={form.expectedCloseDate}
                  onChange={(event) => setForm((current) => ({ ...current, expectedCloseDate: event.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Следующий шаг</label>
                <Input
                  value={form.nextAction}
                  onChange={(event) => setForm((current) => ({ ...current, nextAction: event.target.value }))}
                  placeholder="Позвонить, отправить КП, согласовать резерв"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Дата следующего шага</label>
                <Input
                  type="date"
                  value={form.nextActionDate}
                  onChange={(event) => setForm((current) => ({ ...current, nextActionDate: event.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Приоритет</label>
                <Select
                  value={form.priority}
                  onValueChange={(value) => setForm((current) => ({ ...current, priority: value as CrmDealPriority }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY_META).map(([value, meta]) => (
                      <SelectItem key={value} value={value}>
                        {meta.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Ответственный</label>
                <Select
                  value={form.responsibleUserId}
                  onValueChange={(value) => setForm((current) => ({ ...current, responsibleUserId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Не назначен" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>Не назначен</SelectItem>
                    {managers
                      .filter((item) => item.status !== 'Неактивен')
                      .filter((item) => isPipelineManager(item.role, form.pipeline))
                      .map((manager) => (
                        <SelectItem key={manager.id} value={manager.id}>
                          {manager.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">Комментарий</label>
                <Textarea
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Что уже обсудили, какие условия важны, какие есть риски"
                  className="min-h-28"
                />
              </div>
            </div>

            {editingDeal && (
              <div className="rounded-2xl border bg-muted/20">
                <div className="border-b px-4 py-3">
                  <div className="text-sm font-semibold">История сделки</div>
                  <div className="mt-1 text-xs text-muted-foreground">Все изменения по карточке в одном месте.</div>
                </div>
                <div className="space-y-3 px-4 py-4">
                  {(editingDeal.history || []).length === 0 ? (
                    <div className="text-sm text-muted-foreground">История ещё не накопилась.</div>
                  ) : (
                    [...(editingDeal.history || [])]
                      .slice()
                      .reverse()
                      .map((entry, index) => (
                        <div key={`${entry.date}-${index}`} className="rounded-xl border bg-background px-3 py-3">
                          <div className="text-sm font-medium text-foreground">{entry.text}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {entry.author} · {formatDateTime(entry.date)}
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </div>
            )}
          </div>

          <SheetFooter className="border-t">
            <Button variant="outline" onClick={closeSheet}>
              Отмена
            </Button>
            <Button onClick={handleSaveDeal} disabled={createDeal.isPending || updateDeal.isPending}>
              {editingDeal ? 'Сохранить сделку' : 'Создать сделку'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
