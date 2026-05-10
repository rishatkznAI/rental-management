import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Tag } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { FilterButton, FilterDialog, FilterField } from '../components/ui/filter-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useAuth } from '../contexts/AuthContext';
import { useEquipmentList } from '../hooks/useEquipment';
import { usePermissions } from '../lib/permissions';
import { EQUIPMENT_SALE_PDI_LABELS, EQUIPMENT_SALE_RECEIPT_LABELS, normalizeEquipmentList } from '../lib/equipmentClassification';
import { getSaleOperationHistory, isSaleModeEquipment, saleConditionKind, saleConditionLabel, saleStatusKind, saleStatusLabel } from '../lib/equipmentSaleMode.js';
import { formatCurrency } from '../lib/utils';
import { deriveSignalState } from '../lib/gsm';
import { normalizeUserRole } from '../lib/userStorage';
import { appSettingsService } from '../services/app-settings.service';
import { equipmentService } from '../services/equipment.service';
import type { AppSetting, Equipment, EquipmentSalePdiStatus, EquipmentSaleReceiptStatus } from '../types';

const SALES_SETTINGS_KEY = 'sales_section_settings';

type SalesSettingId =
  | 'quoteTemplates'
  | 'paymentTerms'
  | 'deliveryTerms'
  | 'warrantyTerms'
  | 'pricingRules'
  | 'priceChangeReasons'
  | 'kitCommentTemplate';

type SalesSectionSettings = Record<SalesSettingId, string>;

const SALES_SETTINGS_META: Array<{ id: SalesSettingId; title: string; description: string; placeholder: string }> = [
  {
    id: 'quoteTemplates',
    title: 'Шаблоны КП',
    description: 'Текстовые блоки и структура коммерческого предложения для продажной техники.',
    placeholder: 'Например: срок действия КП, состав предложения, блок характеристик и комплектации.',
  },
  {
    id: 'paymentTerms',
    title: 'Условия оплаты по умолчанию',
    description: 'Базовые условия оплаты, которые используются при подготовке КП.',
    placeholder: 'Например: 100% предоплата или 50/50 по согласованию.',
  },
  {
    id: 'deliveryTerms',
    title: 'Условия доставки по умолчанию',
    description: 'Стандартные условия доставки и отгрузки продажной техники.',
    placeholder: 'Например: самовывоз со склада или доставка отдельным счётом.',
  },
  {
    id: 'warrantyTerms',
    title: 'Гарантийные условия',
    description: 'Типовые гарантийные условия для новой и б/у техники.',
    placeholder: 'Например: гарантия 12 месяцев на новую технику, индивидуально для б/у.',
  },
  {
    id: 'pricingRules',
    title: 'Правила расчёта цены',
    description: 'Правила маржи, минимальной цены и факторов корректировки стоимости.',
    placeholder: 'Например: учитывать год выпуска, наработку, АКБ, PDI и комплект документов.',
  },
  {
    id: 'priceChangeReasons',
    title: 'Причины изменения цены',
    description: 'Справочник причин, который используется при фиксации истории изменения цены.',
    placeholder: 'Например: корректировка по рынку; срочная продажа; состояние АКБ; комплектность.',
  },
  {
    id: 'kitCommentTemplate',
    title: 'Шаблон комментария по комплектации',
    description: 'Шаблон для описания комплектации и замечаний в продажной карточке.',
    placeholder: 'Например: АКБ, зарядное устройство, поручни, документы, ключи.',
  },
];

const DEFAULT_SALES_SETTINGS: SalesSectionSettings = {
  quoteTemplates: 'КП включает модель, фото, характеристики, цену, НДС, срок действия предложения, условия оплаты, доставки, гарантию, комплектацию и доступные документы.',
  paymentTerms: 'Условия оплаты согласуются в КП. По умолчанию: предоплата до отгрузки.',
  deliveryTerms: 'Самовывоз со склада или доставка по отдельному согласованию.',
  warrantyTerms: 'Гарантийные условия указываются в КП с учётом состояния техники.',
  pricingRules: 'Цена зависит от года выпуска, наработки, состояния, АКБ, комплектации, PDI, документов и срочности продажи.',
  priceChangeReasons: 'Корректировка по рынку\nСрочная продажа\nСостояние АКБ\nКомплектация\nPDI или документы',
  kitCommentTemplate: 'Комплектация проверена. Укажите АКБ, зарядное устройство, поручни, документы, ключи и замечания.',
};

function normalizeSalesSettings(value: unknown): SalesSectionSettings {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<Record<SalesSettingId, unknown>>
    : {};
  return SALES_SETTINGS_META.reduce((acc, item) => {
    const raw = source[item.id];
    acc[item.id] = typeof raw === 'string' ? raw : DEFAULT_SALES_SETTINGS[item.id];
    return acc;
  }, { ...DEFAULT_SALES_SETTINGS });
}

function getSalePdiBadge(status: EquipmentSalePdiStatus = 'not_started') {
  const variants: Record<EquipmentSalePdiStatus, 'default' | 'warning' | 'success' | 'error'> = {
    not_started: 'default',
    in_progress: 'warning',
    issues: 'error',
    ready: 'success',
  };
  return <Badge variant={variants[status]}>{EQUIPMENT_SALE_PDI_LABELS[status]}</Badge>;
}

function getSaleReadinessBadge(status: EquipmentSalePdiStatus = 'not_started') {
  return (
    <Badge variant={status === 'ready' ? 'success' : 'warning'}>
      {status === 'ready' ? 'PDI готов' : status === 'issues' ? 'PDI с замечаниями' : 'PDI не готов'}
    </Badge>
  );
}

function getSaleReceiptBadge(status?: EquipmentSaleReceiptStatus) {
  if (!status) return <Badge variant="default">Поступление не указано</Badge>;
  const variants: Record<EquipmentSaleReceiptStatus, 'default' | 'warning' | 'success' | 'error'> = {
    planned_arrival: 'warning',
    arrived_waiting_acceptance: 'warning',
    acceptance_in_progress: 'warning',
    accepted: 'success',
    acceptance_rejected: 'error',
    cancelled: 'default',
  };
  return <Badge variant={variants[status]}>{EQUIPMENT_SALE_RECEIPT_LABELS[status]}</Badge>;
}

function isPhysicallyAvailableForSale(equipment: Equipment) {
  const receiptStatus = equipment.saleReceiptStatus;
  return !receiptStatus || receiptStatus === 'accepted';
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (!error) return fallback;
  const status = typeof error === 'object' && error && 'status' in error ? `HTTP ${(error as { status?: number }).status}` : '';
  const message = error instanceof Error ? error.message : fallback;
  return [status, message].filter(Boolean).join(': ');
}

function formatSaleDate(value?: string | null) {
  const parsed = new Date(String(value || ''));
  if (!value || Number.isNaN(parsed.getTime())) return 'Не указано';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed);
}

function isPastDate(value?: string | null) {
  const parsed = new Date(String(value || ''));
  return Boolean(value && !Number.isNaN(parsed.getTime()) && parsed < new Date());
}

function getGsmSaleValue(equipment: Partial<Equipment>) {
  const hasGsmData = Boolean(
    equipment.gsmImei
    || equipment.gsmDeviceId
    || equipment.gsmTrackerId
    || equipment.gsmStatus
    || equipment.gsmSignalStatus
    || equipment.gsmLastSeenAt
    || equipment.gsmLastSignalAt
  );
  if (!hasGsmData) return 'Не указано';

  const signalState = deriveSignalState(equipment as Equipment, equipment.gsmLastSeenAt || equipment.gsmLastSignalAt || null);
  const statusLabel = signalState === 'online'
    ? 'Онлайн'
    : signalState === 'location_only'
    ? 'Только координаты'
    : signalState === 'offline'
    ? 'Офлайн'
    : 'Неизвестно';
  const identifier = equipment.gsmImei || equipment.gsmDeviceId || equipment.gsmTrackerId;

  return [identifier ? `IMEI/ID ${identifier}` : '', statusLabel].filter(Boolean).join(' · ');
}

export default function Sales() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const equipmentQuery = useEquipmentList();
  const rawEquipment = equipmentQuery.data ?? [];
  const isAdmin = normalizeUserRole(user?.role) === 'Администратор';
  const [search, setSearch] = React.useState('');
  const [pdiFilter, setPdiFilter] = React.useState<string>('all');
  const [receiptFilter, setReceiptFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [quickFilter, setQuickFilter] = React.useState<'all' | 'pdi_ready' | 'pdi_in_progress' | 'no_price' | 'available_only'>('all');
  const [activeSalesTab, setActiveSalesTab] = React.useState('showcase');
  const [editingSettingId, setEditingSettingId] = React.useState<SalesSettingId | null>(null);
  const [settingDraft, setSettingDraft] = React.useState('');
  const [settingsMessage, setSettingsMessage] = React.useState<string | null>(null);
  const [showFilters, setShowFilters] = React.useState(false);
  const appSettingsQuery = useQuery<AppSetting[]>({
    queryKey: ['app-settings'],
    queryFn: appSettingsService.getAll,
    enabled: isAdmin,
  });
  const markArrivalMutation = useMutation({
    mutationFn: (equipment: Equipment) => equipmentService.update(equipment.id, {
      saleReceiptStatus: 'arrived_waiting_acceptance',
      actualArrivalDate: new Date().toISOString().slice(0, 10),
      acceptanceComment: 'Поступление отмечено из раздела продаж',
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['equipment'] });
    },
  });
  const saveSettingsMutation = useMutation({
    mutationFn: async (nextSettings: SalesSectionSettings) => {
      const now = new Date().toISOString();
      const existing = (appSettingsQuery.data ?? []).find(item => item.key === SALES_SETTINGS_KEY);
      const payload = {
        key: SALES_SETTINGS_KEY,
        value: nextSettings,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      return existing
        ? appSettingsService.update(existing.id, payload)
        : appSettingsService.create(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app-settings'] });
      setSettingsMessage('Настройки продаж сохранены.');
      setEditingSettingId(null);
    },
    onError: (error) => {
      setSettingsMessage(apiErrorMessage(error, 'Не удалось сохранить настройки продаж.'));
    },
  });

  const saleEquipment = React.useMemo(
    () => normalizeEquipmentList(rawEquipment).filter((equipment) => isSaleModeEquipment(equipment)),
    [rawEquipment],
  );
  const salesTabs = React.useMemo(() => [
    { value: 'showcase', label: 'Витрина' },
    { value: 'prices', label: 'Прайсы' },
    { value: 'quotes', label: 'КП' },
    { value: 'documents', label: 'Документы продаж' },
    ...(isAdmin ? [{ value: 'settings', label: 'Настройки продаж' }] : []),
  ], [isAdmin]);
  const salesSettingsRecord = React.useMemo(
    () => (appSettingsQuery.data ?? []).find(item => item.key === SALES_SETTINGS_KEY),
    [appSettingsQuery.data],
  );
  const salesSettings = React.useMemo(
    () => normalizeSalesSettings(salesSettingsRecord?.value),
    [salesSettingsRecord?.value],
  );
  const editingSetting = SALES_SETTINGS_META.find(item => item.id === editingSettingId) ?? null;

  React.useEffect(() => {
    if (!isAdmin && activeSalesTab === 'settings') {
      setActiveSalesTab('showcase');
    }
  }, [activeSalesTab, isAdmin]);

  React.useEffect(() => {
    if (!editingSettingId) return;
    setSettingDraft(salesSettings[editingSettingId]);
    setSettingsMessage(null);
  }, [editingSettingId, salesSettings]);

  const filteredEquipment = React.useMemo(
    () => saleEquipment.filter((equipment) => {
      const query = search.toLowerCase();
      const matchesSearch = search === ''
        || equipment.manufacturer.toLowerCase().includes(query)
        || equipment.model.toLowerCase().includes(query)
        || equipment.serialNumber.toLowerCase().includes(query)
        || equipment.location.toLowerCase().includes(query);
      const matchesPdi = pdiFilter === 'all' || equipment.salePdiStatus === pdiFilter;
      const matchesReceipt = receiptFilter === 'all' || equipment.saleReceiptStatus === receiptFilter;
      const matchesStatus = statusFilter === 'all' || saleStatusKind(equipment) === statusFilter;
      const hasNoPrices = !equipment.salePrice1 && !equipment.salePrice2 && !equipment.salePrice3;
      const saleKind = saleStatusKind(equipment);
      const matchesQuickFilter =
        quickFilter === 'all'
        || (quickFilter === 'pdi_ready' && equipment.salePdiStatus === 'ready')
        || (quickFilter === 'pdi_in_progress' && equipment.salePdiStatus === 'in_progress')
        || (quickFilter === 'no_price' && hasNoPrices)
        || (quickFilter === 'available_only' && equipment.status === 'available' && isPhysicallyAvailableForSale(equipment) && saleKind !== 'sold' && saleKind !== 'removed');
      return matchesSearch && matchesPdi && matchesReceipt && matchesStatus && matchesQuickFilter;
    }),
    [pdiFilter, quickFilter, receiptFilter, saleEquipment, search, statusFilter],
  );

  const readyCount = saleEquipment.filter((equipment) => equipment.salePdiStatus === 'ready').length;
  const inProgressCount = saleEquipment.filter((equipment) => equipment.salePdiStatus === 'in_progress').length;
  const noPriceCount = saleEquipment.filter((equipment) => !equipment.salePrice1 && !equipment.salePrice2 && !equipment.salePrice3).length;
  const availableCount = saleEquipment.filter((equipment) => equipment.status === 'available' && isPhysicallyAvailableForSale(equipment) && !['sold', 'removed'].includes(saleStatusKind(equipment))).length;
  const plannedArrivalCount = saleEquipment.filter((equipment) => equipment.saleReceiptStatus === 'planned_arrival').length;
  const waitingAcceptanceCount = saleEquipment.filter((equipment) => equipment.saleReceiptStatus === 'arrived_waiting_acceptance').length;
  const acceptedReceiptCount = saleEquipment.filter((equipment) => equipment.saleReceiptStatus === 'accepted').length;
  const rejectedReceiptCount = saleEquipment.filter((equipment) => equipment.saleReceiptStatus === 'acceptance_rejected').length;
  const activeFilterCount = [
    search.trim() !== '',
    pdiFilter !== 'all',
    receiptFilter !== 'all',
    statusFilter !== 'all',
    quickFilter !== 'all',
  ].filter(Boolean).length;
  const priceByModel = React.useMemo(() => {
    const rows = new Map<string, {
      key: string;
      model: string;
      type: string;
      newPrice: number;
      usedPrice: number;
      minPrice: number;
      costPrice: number;
      marginPercent: number;
      updatedAt: string;
      comment: string;
    }>();

    for (const equipment of saleEquipment) {
      const model = `${equipment.manufacturer} ${equipment.model}`.trim();
      const key = `${model}-${equipment.type}`;
      const current = rows.get(key) ?? {
        key,
        model,
        type: equipment.type,
        newPrice: 0,
        usedPrice: 0,
        minPrice: 0,
        costPrice: 0,
        marginPercent: 0,
        updatedAt: equipment.actualArrivalDate || equipment.plannedArrivalDate || equipment.acceptedAt || '',
        comment: '',
      };
      const mainPrice = equipment.salePrice1 ?? 0;
      const minPrice = equipment.salePrice2 ?? 0;
      const costPrice = equipment.salePrice3 ?? 0;
      if (saleConditionKind(equipment) === 'new') {
        current.newPrice = Math.max(current.newPrice, mainPrice);
      } else {
        current.usedPrice = Math.max(current.usedPrice, mainPrice);
      }
      current.minPrice = Math.max(current.minPrice, minPrice);
      current.costPrice = Math.max(current.costPrice, costPrice);
      current.marginPercent = current.minPrice > 0 && current.costPrice > 0
        ? Math.round(((current.minPrice - current.costPrice) / current.minPrice) * 100)
        : current.marginPercent;
      current.updatedAt = current.updatedAt || equipment.actualArrivalDate || equipment.plannedArrivalDate || equipment.acceptedAt || '';
      current.comment = current.comment || equipment.notes || '';
      rows.set(key, current);
    }

    return Array.from(rows.values()).sort((a, b) => a.model.localeCompare(b.model, 'ru'));
  }, [saleEquipment]);

  if (!can('view', 'sales')) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Продажи</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Коммерческий инструмент по продажной технике: витрина, цены, КП и документы.
          </p>
        </div>
        {can('create', 'equipment') && (
          <Link to="/equipment/new?sale=1">
            <Button className="app-button-primary h-10 rounded-xl px-4">
              <Plus className="h-4 w-4" />
              Добавить технику
            </Button>
          </Link>
        )}
      </div>

      {equipmentQuery.error && (
        <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-100">
          <div className="font-semibold">Не удалось загрузить технику для продаж</div>
          <div className="mt-1 text-red-700/80 dark:text-red-100/80">
            {apiErrorMessage(equipmentQuery.error, 'Проверьте доступ к GET /api/equipment.')}
          </div>
          <div className="mt-2 text-red-700/80 dark:text-red-100/80">
            Для роли механика по гарантии дополнительно проверьте `GET /api/access-diagnostics`.
          </div>
        </section>
      )}

      <Tabs value={activeSalesTab} onValueChange={setActiveSalesTab} className="space-y-5">
        <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-gray-200 bg-transparent p-0 dark:border-gray-700">
          {salesTabs.map(tab => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="whitespace-nowrap border-b-2 border-transparent px-4 py-3 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 data-[state=active]:border-[--color-primary] data-[state=active]:text-[--color-primary] dark:hover:text-gray-300"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="showcase" className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">На продаже</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-gray-900 dark:text-white">{saleEquipment.length}</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Актуальные единицы в продаже</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">PDI готов</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-green-600 dark:text-green-400">{readyCount}</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Можно передавать в коммерческую работу</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">PDI в работе</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-amber-600 dark:text-amber-400">{inProgressCount}</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Единицы, которые нужно довести до готовности</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">Планируется поступление</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-amber-600 dark:text-amber-300">{plannedArrivalCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">Ожидает приёмки</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-amber-600 dark:text-amber-300">{waitingAcceptanceCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">Принято</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-green-600 dark:text-green-300">{acceptedReceiptCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">С замечаниями</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-red-600 dark:text-red-300">{rejectedReceiptCount}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <FilterButton activeCount={activeFilterCount} onClick={() => setShowFilters(true)} />
      </div>

      <FilterDialog
        open={showFilters}
        onOpenChange={setShowFilters}
        title="Фильтры продаж"
        description="Настрой выборку техники на продаже по поиску, PDI, статусу и быстрым режимам."
        onReset={() => {
          setSearch('');
          setPdiFilter('all');
          setReceiptFilter('all');
          setStatusFilter('all');
          setQuickFilter('all');
        }}
      >
        <div className="space-y-5">
          <FilterField label="Быстрый режим">
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'all', label: 'Все' },
                { value: 'pdi_ready', label: `PDI готово · ${readyCount}` },
                { value: 'pdi_in_progress', label: `PDI в работе · ${inProgressCount}` },
                { value: 'no_price', label: `Без цены · ${noPriceCount}` },
                { value: 'available_only', label: `Только свободная · ${availableCount}` },
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setQuickFilter(option.value as typeof quickFilter)}
                  className="app-filter-chip"
                  data-active={String(quickFilter === option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </FilterField>

          <div className="grid gap-4 md:grid-cols-2">
            <FilterField label="Поиск" className="md:col-span-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Поиск по модели, SN, локации..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="app-filter-input pl-10"
                />
              </div>
            </FilterField>
            <FilterField label="PDI">
              <select value={pdiFilter} onChange={(e) => setPdiFilter(e.target.value)} className="app-filter-input">
                <option value="all">Все PDI</option>
                <option value="not_started">{EQUIPMENT_SALE_PDI_LABELS.not_started}</option>
                <option value="in_progress">{EQUIPMENT_SALE_PDI_LABELS.in_progress}</option>
                <option value="issues">{EQUIPMENT_SALE_PDI_LABELS.issues}</option>
                <option value="ready">{EQUIPMENT_SALE_PDI_LABELS.ready}</option>
              </select>
            </FilterField>
            <FilterField label="Поступление">
              <select value={receiptFilter} onChange={(e) => setReceiptFilter(e.target.value)} className="app-filter-input">
                <option value="all">Все статусы поступления</option>
                <option value="planned_arrival">{EQUIPMENT_SALE_RECEIPT_LABELS.planned_arrival}</option>
                <option value="arrived_waiting_acceptance">{EQUIPMENT_SALE_RECEIPT_LABELS.arrived_waiting_acceptance}</option>
                <option value="acceptance_in_progress">{EQUIPMENT_SALE_RECEIPT_LABELS.acceptance_in_progress}</option>
                <option value="accepted">{EQUIPMENT_SALE_RECEIPT_LABELS.accepted}</option>
                <option value="acceptance_rejected">{EQUIPMENT_SALE_RECEIPT_LABELS.acceptance_rejected}</option>
              </select>
            </FilterField>
            <FilterField label="Статус продажи">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="app-filter-input">
                <option value="all">Все статусы продажи</option>
                <option value="on_sale">На продаже</option>
                <option value="reserved">Резерв</option>
                <option value="in_deal">Зарезервирована</option>
                <option value="sold">Продана</option>
                <option value="removed">Снята с продажи</option>
              </select>
            </FilterField>
          </div>
        </div>
      </FilterDialog>

      <div className="space-y-3 sm:hidden">
        {filteredEquipment.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-10 text-center dark:border-gray-700 dark:bg-gray-800">
            <Tag className="mx-auto h-8 w-8 text-gray-400 dark:text-gray-500" />
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Под выбранные фильтры техника на продажу не найдена.</p>
          </div>
        ) : filteredEquipment.map((equipment) => {
          const conditionKind = saleConditionKind(equipment);
          const operationHistory = getSaleOperationHistory(equipment);
          const showOperationHistory = conditionKind === 'used' || operationHistory.hasAny;
          return (
          <Link
            key={equipment.id}
            to={`/sales/equipment/${equipment.id}`}
            className="block rounded-xl border border-amber-200/70 bg-white p-4 dark:border-amber-900/50 dark:bg-gray-800"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">{equipment.manufacturer} {equipment.model}</span>
              <Badge variant={conditionKind === 'used' ? 'warning' : 'default'}>{saleConditionLabel(equipment)}</Badge>
              <Badge variant={saleStatusKind(equipment) === 'sold' ? 'success' : saleStatusKind(equipment) === 'removed' ? 'default' : 'warning'}>{saleStatusLabel(equipment)}</Badge>
              {getSaleReceiptBadge(equipment.saleReceiptStatus)}
              {getSalePdiBadge(equipment.salePdiStatus)}
              {getSaleReadinessBadge(equipment.salePdiStatus)}
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              SN: {equipment.serialNumber || 'не указан'}
            </p>
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Локация: {equipment.location}</p>
            <div className="mt-3 rounded-lg border border-amber-200/70 p-3 text-xs dark:border-amber-700/60">
              <p className="font-semibold text-gray-700 dark:text-gray-200">Поступление</p>
              <div className="mt-2 grid gap-2">
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500 dark:text-gray-400">План</span>
                  <span className="text-right font-medium text-gray-900 dark:text-white">{formatSaleDate(equipment.plannedArrivalDate)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500 dark:text-gray-400">Факт</span>
                  <span className="text-right font-medium text-gray-900 dark:text-white">{formatSaleDate(equipment.actualArrivalDate)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500 dark:text-gray-400">Принял</span>
                  <span className="text-right font-medium text-gray-900 dark:text-white">{equipment.acceptedByName || '—'}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500 dark:text-gray-400">Фотоотчёт</span>
                  <span className="text-right font-medium text-gray-900 dark:text-white">{equipment.acceptancePhotos ? 'Есть' : 'Нет'}</span>
                </div>
              </div>
              {equipment.saleReceiptStatus === 'planned_arrival' && can('edit', 'equipment') && (
                <Button
                  type="button"
                  size="sm"
                  className="mt-3"
                  disabled={markArrivalMutation.isPending}
                  onClick={(event) => {
                    event.preventDefault();
                    markArrivalMutation.mutate(equipment);
                  }}
                >
                  Отметить поступление
                </Button>
              )}
            </div>
            <div className="mt-3 rounded-lg border border-gray-200/70 p-3 text-xs dark:border-gray-700">
              <p className="font-semibold text-gray-700 dark:text-gray-200">Идентификация</p>
              <div className="mt-2 grid gap-2">
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500 dark:text-gray-400">Инв. №</span>
                  <span className="text-right font-medium text-gray-900 dark:text-white">{equipment.inventoryNumber || 'Не указано'}</span>
                </div>
              </div>
            </div>
            {showOperationHistory && (
              <div className="mt-3 rounded-lg border border-gray-200/70 p-3 text-xs dark:border-gray-700">
                <p className="font-semibold text-gray-700 dark:text-gray-200">
                  {conditionKind === 'used' ? 'История эксплуатации перед продажей' : 'Эксплуатационные данные заполнены вручную'}
                </p>
                <div className="mt-2 grid gap-2">
                  {operationHistory.hasGsm && (
                    <div className="flex justify-between gap-3">
                      <span className="text-gray-500 dark:text-gray-400">GSM</span>
                      <span className="text-right font-medium text-gray-900 dark:text-white">{getGsmSaleValue(equipment)}</span>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'ТО', value: equipment.nextMaintenance },
                      { label: 'ЧТО', value: equipment.maintenanceCHTO },
                      { label: 'ПТО', value: equipment.maintenancePTO },
                    ].map(item => (
                      <div key={item.label}>
                        <p className="text-gray-500 dark:text-gray-400">{item.label}</p>
                        <p className={`mt-1 font-medium ${isPastDate(item.value) ? 'text-amber-600 dark:text-amber-300' : 'text-gray-900 dark:text-white'}`}>
                          {formatSaleDate(item.value)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-amber-50/80 p-3 text-xs dark:bg-amber-950/20">
              <div>
                <p className="text-gray-500 dark:text-gray-400">Цена 1</p>
                <p className="mt-1 font-semibold text-gray-900 dark:text-white">{formatCurrency(equipment.salePrice1 ?? 0)}</p>
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400">Цена 2</p>
                <p className="mt-1 font-semibold text-gray-900 dark:text-white">{formatCurrency(equipment.salePrice2 ?? 0)}</p>
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400">Цена 3</p>
                <p className="mt-1 font-semibold text-gray-900 dark:text-white">{formatCurrency(equipment.salePrice3 ?? 0)}</p>
              </div>
            </div>
          </Link>
        );
        })}
      </div>

      <div className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Техника</TableHead>
              <TableHead>Статус продажи</TableHead>
              <TableHead>Поступление</TableHead>
              <TableHead>PDI</TableHead>
              <TableHead>Готовность</TableHead>
              <TableHead>Локация</TableHead>
              <TableHead>Цена 1</TableHead>
              <TableHead>Цена 2</TableHead>
              <TableHead>Цена 3</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEquipment.map((equipment) => {
              const conditionKind = saleConditionKind(equipment);
              const operationHistory = getSaleOperationHistory(equipment);
              const showOperationHistory = conditionKind === 'used' || operationHistory.hasAny;
              return (
              <TableRow key={equipment.id}>
                <TableCell>
                  <Link to={`/sales/equipment/${equipment.id}`} className="font-medium text-amber-700 hover:underline dark:text-amber-300">
                    {equipment.manufacturer} {equipment.model}
                  </Link>
                  <p className="mt-1"><Badge variant={conditionKind === 'used' ? 'warning' : 'default'}>{saleConditionLabel(equipment)}</Badge></p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">SN: {equipment.serialNumber || 'не указан'}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Инв. №: {equipment.inventoryNumber || 'Не указано'}</p>
                  {showOperationHistory && (
                    <>
                      {operationHistory.hasGsm && <p className="max-w-[260px] truncate text-xs text-gray-500 dark:text-gray-400">GSM: {getGsmSaleValue(equipment)}</p>}
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        ТО: <span className={isPastDate(equipment.nextMaintenance) ? 'text-amber-600 dark:text-amber-300' : ''}>{formatSaleDate(equipment.nextMaintenance)}</span>
                        {' · '}
                        ЧТО: <span className={isPastDate(equipment.maintenanceCHTO) ? 'text-amber-600 dark:text-amber-300' : ''}>{formatSaleDate(equipment.maintenanceCHTO)}</span>
                        {' · '}
                        ПТО: <span className={isPastDate(equipment.maintenancePTO) ? 'text-amber-600 dark:text-amber-300' : ''}>{formatSaleDate(equipment.maintenancePTO)}</span>
                      </p>
                    </>
                  )}
                </TableCell>
                <TableCell><Badge variant={saleStatusKind(equipment) === 'sold' ? 'success' : saleStatusKind(equipment) === 'removed' ? 'default' : 'warning'}>{saleStatusLabel(equipment)}</Badge></TableCell>
                <TableCell>
                  <div className="space-y-1">
                    {getSaleReceiptBadge(equipment.saleReceiptStatus)}
                    <p className="text-xs text-gray-500 dark:text-gray-400">План: {formatSaleDate(equipment.plannedArrivalDate)}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Факт: {formatSaleDate(equipment.actualArrivalDate)}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Принял: {equipment.acceptedByName || '—'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Фото: {equipment.acceptancePhotos ? 'есть' : 'нет'}</p>
                    {equipment.saleReceiptStatus === 'planned_arrival' && can('edit', 'equipment') && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={markArrivalMutation.isPending}
                        onClick={() => markArrivalMutation.mutate(equipment)}
                      >
                        Отметить поступление
                      </Button>
                    )}
                  </div>
                </TableCell>
                <TableCell>{getSalePdiBadge(equipment.salePdiStatus)}</TableCell>
                <TableCell>{getSaleReadinessBadge(equipment.salePdiStatus)}</TableCell>
                <TableCell className="text-gray-700 dark:text-gray-300">{equipment.location}</TableCell>
                <TableCell className="font-medium text-gray-700 dark:text-gray-200">{formatCurrency(equipment.salePrice1 ?? 0)}</TableCell>
                <TableCell className="font-medium text-gray-700 dark:text-gray-200">{formatCurrency(equipment.salePrice2 ?? 0)}</TableCell>
                <TableCell className="font-medium text-gray-700 dark:text-gray-200">{formatCurrency(equipment.salePrice3 ?? 0)}</TableCell>
              </TableRow>
            );
            })}
          </TableBody>
        </Table>

        {filteredEquipment.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Tag className="mx-auto h-8 w-8 text-gray-400 dark:text-gray-500" />
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Под выбранные фильтры техника на продажу не найдена.</p>
          </div>
        ) : null}
      </div>
        </TabsContent>

        <TabsContent value="prices" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Прайс по моделям</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {priceByModel.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Продажная техника не найдена.</p>
                ) : priceByModel.map(row => (
                  <div key={row.key} className="rounded-xl border border-gray-200 p-4 text-sm dark:border-gray-700">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">{row.model}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{row.type}</p>
                      </div>
                      <Badge variant="default">Маржа {row.marginPercent || 0}%</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div>Новая: <span className="font-medium">{formatCurrency(row.newPrice)}</span></div>
                      <div>Б/у: <span className="font-medium">{formatCurrency(row.usedPrice)}</span></div>
                      <div>Мин. цена: <span className="font-medium">{formatCurrency(row.minPrice)}</span></div>
                      <div>Себестоимость: <span className="font-medium">{formatCurrency(row.costPrice)}</span></div>
                    </div>
                    <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                      Обновлено: {formatSaleDate(row.updatedAt)}{row.comment ? ` · ${row.comment}` : ''}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>История изменения цены</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
                <p>
                  История цены заложена как отдельная рабочая зона: старая цена, новая цена, автор,
                  дата и причина изменения должны фиксироваться в истории карточки техники.
                </p>
                <div className="rounded-xl border border-dashed border-gray-300 p-4 dark:border-gray-700">
                  24.04.2026 — 1 900 000 ₽ → 1 850 000 ₽ · Причина: корректировка по рынку.
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Прайс по конкретной единице</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Техника</TableHead>
                    <TableHead>Инв. №</TableHead>
                    <TableHead>SN</TableHead>
                    <TableHead>Цена продажи</TableHead>
                    <TableHead>Мин. цена</TableHead>
                    <TableHead>Себестоимость</TableHead>
                    <TableHead>Состояние</TableHead>
                    <TableHead>Наработка</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {saleEquipment.map(equipment => (
                    <TableRow key={equipment.id}>
                      <TableCell>
                        <Link to={`/sales/equipment/${equipment.id}`} className="font-medium text-amber-700 hover:underline dark:text-amber-300">
                          {equipment.manufacturer} {equipment.model}
                        </Link>
                      </TableCell>
                      <TableCell>{equipment.inventoryNumber || '—'}</TableCell>
                      <TableCell>{equipment.serialNumber || '—'}</TableCell>
                      <TableCell>{formatCurrency(equipment.salePrice1 ?? 0)}</TableCell>
                      <TableCell>{formatCurrency(equipment.salePrice2 ?? 0)}</TableCell>
                      <TableCell>{formatCurrency(equipment.salePrice3 ?? 0)}</TableCell>
                      <TableCell>{saleConditionLabel(equipment)}</TableCell>
                      <TableCell>{equipment.hours ?? 0} м/ч</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quotes" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Коммерческие предложения</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {saleEquipment.map(equipment => (
                <div key={equipment.id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                  <p className="font-semibold text-gray-900 dark:text-white">{equipment.manufacturer} {equipment.model}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Инв. № {equipment.inventoryNumber || '—'} · SN {equipment.serialNumber || '—'}</p>
                  <div className="mt-3 text-sm">Цена: <span className="font-semibold">{formatCurrency(equipment.salePrice1 ?? 0)}</span></div>
                  <div className="mt-1 text-sm">НДС, срок действия, доставка, гарантия и комплектация подтягиваются из карточки техники и шаблонов.</div>
                  <Link to={`/documents?equipmentId=${equipment.id}&type=kp`}>
                    <Button className="mt-4 app-button-primary h-9 rounded-xl">Создать КП</Button>
                  </Link>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Документы продаж</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {['КП', 'Счёт', 'Договор поставки', 'Спецификация', 'Акт приёма-передачи', 'УПД', 'Гарантийные документы', 'Сертификаты', 'Инструкции'].map(type => (
                <div key={type} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                  <p className="font-semibold text-gray-900 dark:text-white">{type}</p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Документ связан с продажной техникой и открывается через общий реестр документов.</p>
                  <Link to="/documents" className="mt-3 inline-flex text-sm font-medium text-primary hover:underline">
                    Открыть документ
                  </Link>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Настройки продаж</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {SALES_SETTINGS_META.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setEditingSettingId(item.id)}
                  className="rounded-xl border border-gray-200 p-4 text-left text-sm transition hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-gray-700 dark:hover:border-primary/60"
                >
                  <p className="font-semibold text-gray-900 dark:text-white">{item.title}</p>
                  <p className="mt-1 text-gray-500 dark:text-gray-400">{item.description}</p>
                  <p className="mt-3 line-clamp-3 text-xs text-gray-500 dark:text-gray-400">
                    {salesSettings[item.id] || 'Не заполнено'}
                  </p>
                </button>
              ))}
              {appSettingsQuery.error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
                  {apiErrorMessage(appSettingsQuery.error, 'Не удалось загрузить настройки продаж.')}
                </div>
              ) : null}
              {settingsMessage ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200">
                  {settingsMessage}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(editingSetting)} onOpenChange={(open) => !open && setEditingSettingId(null)}>
        <DialogContent className="rounded-2xl sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>{editingSetting?.title}</DialogTitle>
            <DialogDescription>{editingSetting?.description}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto py-4">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="sales-setting-value">
              Значение настройки
            </label>
            <Textarea
              id="sales-setting-value"
              value={settingDraft}
              onChange={(event) => setSettingDraft(event.target.value)}
              placeholder={editingSetting?.placeholder}
              className="mt-2 min-h-[220px] resize-y rounded-xl"
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Сохраняется в административных app settings и будет использоваться как базовая настройка продажного раздела.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setEditingSettingId(null)}>
              Отмена
            </Button>
            <Button
              type="button"
              className="app-button-primary"
              disabled={!editingSettingId || saveSettingsMutation.isPending}
              onClick={() => {
                if (!editingSettingId) return;
                saveSettingsMutation.mutate({
                  ...salesSettings,
                  [editingSettingId]: settingDraft.trim(),
                });
              }}
            >
              {saveSettingsMutation.isPending ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
