import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeDollarSign, CheckCircle2, ChevronRight, ClipboardCheck, FileSignature, Plus, Search, ShieldAlert, Tag, Wrench } from 'lucide-react';
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
import {
  DEFAULT_SALES_SETTINGS,
  SALES_SETTINGS_KEY,
  SALES_SETTINGS_META,
  type QuoteTemplateSection,
  type SalesPriceChangeReason,
  type SalesSectionSettings,
  type SalesSettingId,
  normalizeSalesSettings,
} from '../lib/salesSettings';
import { appSettingsService } from '../services/app-settings.service';
import { equipmentService } from '../services/equipment.service';
import type { AppSetting, Equipment, EquipmentSalePdiStatus, EquipmentSaleReceiptStatus } from '../types';

function getSalePdiBadge(status: EquipmentSalePdiStatus = 'not_started') {
  const variants: Record<EquipmentSalePdiStatus, 'default' | 'warning' | 'success' | 'error'> = {
    not_started: 'default',
    in_progress: 'warning',
    issues: 'error',
    ready: 'success',
    ready_for_rent: 'success',
  };
  return <Badge variant={variants[status]}>{EQUIPMENT_SALE_PDI_LABELS[status]}</Badge>;
}

function getSaleReadinessBadge(status: EquipmentSalePdiStatus = 'not_started') {
  const ready = status === 'ready' || status === 'ready_for_rent';
  return (
    <Badge variant={ready ? 'success' : 'warning'}>
      {status === 'ready_for_rent' ? 'Готова к аренде' : status === 'ready' ? 'PDI готов' : status === 'issues' ? 'PDI с замечаниями' : 'PDI не готов'}
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

function formatOptionalSaleMoney(value: number) {
  return value > 0 ? formatCurrency(value) : 'Нет данных';
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
  const [settingsDraft, setSettingsDraft] = React.useState<SalesSectionSettings | null>(null);
  const [quotePreviewOpen, setQuotePreviewOpen] = React.useState(false);
  const [settingsMessage, setSettingsMessage] = React.useState<string | null>(null);
  const [settingsError, setSettingsError] = React.useState<string | null>(null);
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
    onMutate: () => {
      setSettingsError(null);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app-settings'] });
      const message = 'Настройки продаж сохранены.';
      setSettingsMessage(message);
      setSettingsError(null);
      setEditingSettingId(null);
      toast.success(message);
    },
    onError: (error) => {
      const message = apiErrorMessage(error, 'Не удалось сохранить настройки продаж.');
      setSettingsError(message);
      toast.error(message);
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
  const activePriceChangeReasons = React.useMemo(
    () => salesSettings.priceChangeReasons.filter(reason => reason.isActive && reason.name.trim()),
    [salesSettings.priceChangeReasons],
  );
  const editingSetting = SALES_SETTINGS_META.find(item => item.id === editingSettingId) ?? null;

  React.useEffect(() => {
    if (!isAdmin && activeSalesTab === 'settings') {
      setActiveSalesTab('showcase');
    }
  }, [activeSalesTab, isAdmin]);

  React.useEffect(() => {
    if (!editingSettingId) return;
    setSettingsDraft(salesSettings);
    setQuotePreviewOpen(false);
    setSettingsMessage(null);
    setSettingsError(null);
  }, [editingSettingId, salesSettings]);

  function updateSettingsDraft(updater: (current: SalesSectionSettings) => SalesSectionSettings) {
    setSettingsDraft(current => updater(current ?? salesSettings));
  }

  function updatePriceReason(index: number, patch: Partial<SalesPriceChangeReason>) {
    updateSettingsDraft(current => ({
      ...current,
      priceChangeReasons: current.priceChangeReasons.map((reason, reasonIndex) => (
        reasonIndex === index ? { ...reason, ...patch } : reason
      )),
    }));
  }

  function addPriceReason() {
    updateSettingsDraft(current => ({
      ...current,
      priceChangeReasons: [
        ...current.priceChangeReasons,
        {
          id: `reason-${Date.now()}`,
          name: '',
          isActive: true,
        },
      ],
    }));
  }

  function archivePriceReason(index: number) {
    updatePriceReason(index, { isActive: false });
  }

  function settingsSummary(id: SalesSettingId) {
    const settings = salesSettings;
    if (id === 'quoteTemplate') {
      return `${settings.quoteTemplate.templateName}; срок ${settings.quoteTemplate.validityDays} дн.; НДС ${settings.quoteTemplate.showVat ? 'показывается' : 'не выводится'}`;
    }
    if (id === 'defaultPaymentTerms') {
      return `Предоплата ${settings.defaultPaymentTerms.prepaymentPercent}%, оплата в течение ${settings.defaultPaymentTerms.invoiceDueDays} дней, НДС ${settings.defaultPaymentTerms.vatIncluded ? 'включён' : 'не включён'}`;
    }
    if (id === 'defaultDeliveryTerms') {
      const method = settings.defaultDeliveryTerms.mode === 'pickup' ? 'Самовывоз' : settings.defaultDeliveryTerms.mode === 'company_delivery' ? 'Доставка силами компании' : 'По договорённости';
      const paidBy = settings.defaultDeliveryTerms.paidBy === 'buyer' ? 'оплачивает покупатель' : settings.defaultDeliveryTerms.paidBy === 'seller' ? 'оплачивает продавец' : 'оплата по договорённости';
      return `${method}, ${paidBy}, готовность ${settings.defaultDeliveryTerms.readinessDays} дн.`;
    }
    if (id === 'warrantyTerms') {
      return `Новая техника: ${settings.warrantyTerms.warrantyMonthsNew} мес., б/у: ${settings.warrantyTerms.warrantyMonthsUsed} мес.`;
    }
    if (id === 'pricingRules') {
      return `Наценка ${settings.pricingRules.defaultMarkupPercent}%, минимальная маржа ${settings.pricingRules.minimumMarginPercent}%.`;
    }
    if (id === 'priceChangeReasons') {
      return `Активных причин: ${settings.priceChangeReasons.filter(reason => reason.isActive).length} из ${settings.priceChangeReasons.length}`;
    }
    return settings.packageCommentTemplate.text;
  }

  function isSettingConfigured(id: SalesSettingId) {
    const settings = salesSettings;
    if (id === 'quoteTemplate') {
      return Boolean(settings.quoteTemplate.templateName.trim() && settings.quoteTemplate.title.trim() && settings.quoteTemplate.sectionsOrder.length > 0);
    }
    if (id === 'defaultPaymentTerms') {
      return Boolean(settings.defaultPaymentTerms.paymentText.trim());
    }
    if (id === 'defaultDeliveryTerms') {
      return Boolean(settings.defaultDeliveryTerms.deliveryText.trim());
    }
    if (id === 'warrantyTerms') {
      return Boolean(settings.warrantyTerms.warrantyText.trim());
    }
    if (id === 'pricingRules') {
      return Boolean(settings.pricingRules.rulesText.trim());
    }
    if (id === 'priceChangeReasons') {
      return settings.priceChangeReasons.some(reason => reason.isActive && reason.name.trim());
    }
    return Boolean(settings.packageCommentTemplate.text.trim());
  }

  const quoteSectionLabels: Record<QuoteTemplateSection, string> = {
    intro: 'Вступительный текст',
    equipment: 'Техника',
    price: 'Цена',
    payment: 'Условия оплаты',
    delivery: 'Условия доставки',
    warranty: 'Гарантия',
    package: 'Комплектация',
    packageComment: 'Комментарий по комплектации',
    footer: 'Нижний комментарий',
  };

  const quoteVariableExamples = {
    equipmentModel: saleEquipment[0] ? `${saleEquipment[0].manufacturer} ${saleEquipment[0].model}`.trim() : 'JLG 1932R',
    inventoryNumber: saleEquipment[0]?.inventoryNumber || 'ST-1932R-00156',
    serialNumber: saleEquipment[0]?.serialNumber || '2100123456',
    salePrice: saleEquipment[0]?.salePrice1 ? formatCurrency(saleEquipment[0].salePrice1) : '1 850 000 ₽',
    validUntil: '24.06.2026',
    paymentTerms: salesSettings.defaultPaymentTerms.paymentText,
    deliveryTerms: salesSettings.defaultDeliveryTerms.deliveryText,
    warrantyTerms: salesSettings.warrantyTerms.warrantyText,
    packageComment: salesSettings.packageCommentTemplate.text,
  };

  function moveQuoteSection(index: number, direction: -1 | 1) {
    updateSettingsDraft(current => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.quoteTemplate.sectionsOrder.length) return current;
      const sectionsOrder = [...current.quoteTemplate.sectionsOrder];
      const [section] = sectionsOrder.splice(index, 1);
      sectionsOrder.splice(nextIndex, 0, section);
      return {
        ...current,
        quoteTemplate: {
          ...current.quoteTemplate,
          sectionsOrder,
        },
      };
    });
  }

  function renderTemplateText(text: string) {
    return Object.entries(quoteVariableExamples).reduce(
      (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
      text,
    );
  }

  function quoteSectionEnabled(section: QuoteTemplateSection, settings: SalesSectionSettings) {
    const quote = settings.quoteTemplate;
    if (section === 'payment') return quote.showPaymentTerms;
    if (section === 'delivery') return quote.showDeliveryTerms;
    if (section === 'warranty') return quote.showWarrantyTerms;
    if (section === 'package') return quote.showEquipmentPackage;
    if (section === 'packageComment') return quote.showPackageComment;
    return true;
  }

  function quoteSectionPreview(section: QuoteTemplateSection, settings: SalesSectionSettings) {
    const quote = settings.quoteTemplate;
    if (section === 'intro') return renderTemplateText(quote.introText);
    if (section === 'equipment') {
      const details = [`Модель: ${quoteVariableExamples.equipmentModel}`];
      if (quote.showEquipmentSpecs) details.push(`Инв. № ${quoteVariableExamples.inventoryNumber}`, `SN ${quoteVariableExamples.serialNumber}`);
      if (quote.showEquipmentPhoto) details.push('Фото техники будет включено');
      return details.join('\n');
    }
    if (section === 'price') return `${quoteVariableExamples.salePrice}${quote.showVat ? '\nНДС показывается в КП' : ''}`;
    if (section === 'payment') return renderTemplateText(settings.defaultPaymentTerms.paymentText);
    if (section === 'delivery') return `${renderTemplateText(settings.defaultDeliveryTerms.deliveryText)}\nГотовность к отгрузке: ${settings.defaultDeliveryTerms.readinessDays} дн.`;
    if (section === 'warranty') return renderTemplateText(settings.warrantyTerms.warrantyText);
    if (section === 'package') return 'АКБ, зарядное устройство, поручни, документы, ключи';
    if (section === 'packageComment') return renderTemplateText(settings.packageCommentTemplate.text);
    return renderTemplateText(quote.footerText);
  }

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
  const activeSaleEquipment = saleEquipment.filter((equipment) => !['sold', 'removed'].includes(saleStatusKind(equipment)));
  const commercialReadyCount = activeSaleEquipment.filter((equipment) => equipment.salePdiStatus === 'ready').length;
  const commercialInProgressCount = activeSaleEquipment.filter((equipment) => equipment.salePdiStatus === 'in_progress').length;
  const commercialIssuesCount = activeSaleEquipment.filter((equipment) => equipment.salePdiStatus === 'issues').length;
  const commercialNoPriceCount = activeSaleEquipment.filter((equipment) => !equipment.salePrice1 && !equipment.salePrice2 && !equipment.salePrice3).length;
  const commercialAvailableCount = activeSaleEquipment.filter((equipment) => equipment.status === 'available' && isPhysicallyAvailableForSale(equipment)).length;
  const commercialRejectedReceiptCount = activeSaleEquipment.filter((equipment) => equipment.saleReceiptStatus === 'acceptance_rejected').length;
  const requiresPdiCount = activeSaleEquipment.filter((equipment) => (equipment.salePdiStatus ?? 'not_started') !== 'ready').length;
  const blockerCount = activeSaleEquipment.filter((equipment) => {
    const hasNoPrices = !equipment.salePrice1 && !equipment.salePrice2 && !equipment.salePrice3;
    const pdiBlocked = equipment.salePdiStatus === 'issues' || (equipment.salePdiStatus ?? 'not_started') === 'not_started';
    const receiptBlocked = !isPhysicallyAvailableForSale(equipment) || equipment.saleReceiptStatus === 'acceptance_rejected';
    return hasNoPrices || pdiBlocked || receiptBlocked;
  }).length;
  const potentialSaleValue = activeSaleEquipment.reduce((sum, equipment) => sum + (Number(equipment.salePrice1) || 0), 0);
  const marginRecords = activeSaleEquipment.filter((equipment) => (Number(equipment.salePrice1) || 0) > 0 && (Number(equipment.salePrice3) || 0) > 0);
  const potentialMarginValue = marginRecords.reduce((sum, equipment) => (
    sum + ((Number(equipment.salePrice1) || 0) - (Number(equipment.salePrice3) || 0))
  ), 0);
  const commercialSummary = [
    {
      label: 'Техника на продаже',
      value: String(saleEquipment.length),
      detail: 'Единицы в коммерческой витрине',
      icon: BadgeDollarSign,
      tone: 'border-blue-200 bg-blue-50/70 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-200',
    },
    {
      label: 'Готово к продаже',
      value: String(commercialReadyCount),
      detail: `${commercialAvailableCount} физически доступны`,
      icon: CheckCircle2,
      tone: 'border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200',
    },
    {
      label: 'Требует PDI',
      value: String(requiresPdiCount),
      detail: `${commercialInProgressCount} в работе, ${commercialIssuesCount} с замечаниями`,
      icon: Wrench,
      tone: 'border-amber-200 bg-amber-50/75 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100',
    },
    {
      label: 'Есть блокеры',
      value: String(blockerCount),
      detail: `${commercialNoPriceCount} без цены, ${commercialRejectedReceiptCount} с отказом приёмки`,
      icon: ShieldAlert,
      tone: 'border-rose-200 bg-rose-50/70 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-200',
    },
  ];
  const workflowSummary = [
    {
      label: 'КП',
      value: formatOptionalSaleMoney(potentialSaleValue),
      detail: potentialSaleValue > 0 ? 'Потенциальная сумма по цене 1' : 'Заполните цену 1, чтобы видеть сумму',
      icon: FileSignature,
    },
    {
      label: 'Маржа',
      value: marginRecords.length > 0 ? formatCurrency(potentialMarginValue) : 'Нет данных',
      detail: marginRecords.length > 0 ? `${marginRecords.length} записей с ценой и себестоимостью` : 'Появится после заполнения цены и себестоимости',
      icon: BadgeDollarSign,
    },
    {
      label: 'PDI',
      value: activeSaleEquipment.length > 0 ? `${commercialReadyCount}/${activeSaleEquipment.length}` : 'Нет данных',
      detail: activeSaleEquipment.length > 0 ? 'Готовность к показу клиенту' : 'Нет активной техники в продаже',
      icon: ClipboardCheck,
    },
  ];
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

  const settingsDraftValue = settingsDraft ?? salesSettings;

  function renderBooleanToggle(label: string, checked: boolean, onChange: (checked: boolean) => void) {
    return (
      <label className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-200">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
        />
        {label}
      </label>
    );
  }

  function renderSettingsEditor() {
    if (!editingSettingId) return null;
    if (editingSettingId === 'quoteTemplate') {
      const quote = settingsDraftValue.quoteTemplate;
      return (
        <div className="grid gap-4">
          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Название шаблона</span>
            <Input value={quote.templateName} onChange={(event) => updateSettingsDraft(current => ({ ...current, quoteTemplate: { ...current.quoteTemplate, templateName: event.target.value } }))} />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Заголовок КП</span>
              <Input value={quote.title} onChange={(event) => updateSettingsDraft(current => ({ ...current, quoteTemplate: { ...current.quoteTemplate, title: event.target.value } }))} />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Срок действия, дней</span>
              <Input type="number" min="1" value={quote.validityDays} onChange={(event) => updateSettingsDraft(current => ({ ...current, quoteTemplate: { ...current.quoteTemplate, validityDays: Number(event.target.value) || 1 } }))} />
            </label>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {renderBooleanToggle('Показывать фото техники', quote.showEquipmentPhoto, (checked) => updateSettingsDraft(current => ({ ...current, quoteTemplate: { ...current.quoteTemplate, showEquipmentPhoto: checked } })))}
            {renderBooleanToggle('Показывать характеристики', quote.showEquipmentSpecs, (checked) => updateSettingsDraft(current => ({ ...current, quoteTemplate: { ...current.quoteTemplate, showEquipmentSpecs: checked } })))}
            {renderBooleanToggle('Показывать комплектацию', quote.showEquipmentPackage, (checked) => updateSettingsDraft(current => ({ ...current, quoteTemplate: { ...current.quoteTemplate, showEquipmentPackage: checked } })))}
            {renderBooleanToggle('Показывать оплату', quote.showPaymentTerms, (checked) => updateSettingsDraft(current => ({ ...current, quoteTemplate: { ...current.quoteTemplate, showPaymentTerms: checked } })))}
            {renderBooleanToggle('Показывать доставку', quote.showDeliveryTerms, (checked) => updateSettingsDraft(current => ({ ...current, quoteTemplate: { ...current.quoteTemplate, showDeliveryTerms: checked } })))}
            {renderBooleanToggle('Показывать гарантию', quote.showWarrantyTerms, (checked) => updateSettingsDraft(current => ({ ...current, quoteTemplate: { ...current.quoteTemplate, showWarrantyTerms: checked } })))}
            {renderBooleanToggle('Показывать НДС', quote.showVat, (checked) => updateSettingsDraft(current => ({ ...current, quoteTemplate: { ...current.quoteTemplate, showVat: checked } })))}
            {renderBooleanToggle('Показывать комментарий по комплектации', quote.showPackageComment, (checked) => updateSettingsDraft(current => ({ ...current, quoteTemplate: { ...current.quoteTemplate, showPackageComment: checked } })))}
          </div>
          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Вступительный текст</span>
            <Textarea rows={4} value={quote.introText} onChange={(event) => updateSettingsDraft(current => ({ ...current, quoteTemplate: { ...current.quoteTemplate, introText: event.target.value } }))} />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Порядок секций</span>
            <div className="grid gap-2">
              {quote.sectionsOrder.map((section, index) => (
                <div key={`${section}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
                  <span className="font-medium text-gray-800 dark:text-gray-100">{quoteSectionLabels[section]}</span>
                  <span className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-8 rounded-lg px-3"
                      disabled={index === 0}
                      onClick={() => moveQuoteSection(index, -1)}
                    >
                      Вверх
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-8 rounded-lg px-3"
                      disabled={index === quote.sectionsOrder.length - 1}
                      onClick={() => moveQuoteSection(index, 1)}
                    >
                      Вниз
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          </label>
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-100">
            <p className="font-semibold">Переменные шаблона</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {[
                '{equipmentModel}',
                '{inventoryNumber}',
                '{serialNumber}',
                '{salePrice}',
                '{validUntil}',
                '{paymentTerms}',
                '{deliveryTerms}',
                '{warrantyTerms}',
                '{packageComment}',
              ].map(variable => (
                <code key={variable} className="rounded-lg bg-white/70 px-2 py-1 text-xs text-blue-950 dark:bg-blue-950/60 dark:text-blue-100">
                  {variable}
                </code>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <Button type="button" variant="secondary" className="rounded-xl" onClick={() => setQuotePreviewOpen(open => !open)}>
              Предпросмотр КП
            </Button>
            {quotePreviewOpen ? (
              <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-950">
                <div className="border-b border-gray-100 pb-3 dark:border-gray-800">
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">{renderTemplateText(quote.title)}</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Демо-предпросмотр. Срок действия до {quoteVariableExamples.validUntil}</p>
                </div>
                <div className="mt-4 space-y-3">
                  {quote.sectionsOrder.map(section => {
                    const enabled = quoteSectionEnabled(section, settingsDraftValue);
                    return (
                      <div key={`preview-${section}`} className={`rounded-xl border p-3 ${enabled ? 'border-gray-200 dark:border-gray-700' : 'border-gray-100 bg-gray-50 opacity-60 dark:border-gray-800 dark:bg-gray-900/50'}`}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-gray-900 dark:text-white">{quoteSectionLabels[section]}</p>
                          <Badge variant={enabled ? 'success' : 'default'}>{enabled ? 'Будет включён' : 'Скрыт'}</Badge>
                        </div>
                        {enabled ? (
                          <p className="mt-2 whitespace-pre-line text-gray-600 dark:text-gray-300">{quoteSectionPreview(section, settingsDraftValue)}</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Финальный текст</span>
            <Textarea rows={3} value={quote.footerText} onChange={(event) => updateSettingsDraft(current => ({ ...current, quoteTemplate: { ...current.quoteTemplate, footerText: event.target.value } }))} />
          </label>
          <Button
            type="button"
            variant="secondary"
            className="w-fit rounded-xl"
            onClick={() => updateSettingsDraft(current => ({
              ...current,
              quoteTemplate: {
                ...DEFAULT_SALES_SETTINGS.quoteTemplate,
                sectionsOrder: [...DEFAULT_SALES_SETTINGS.quoteTemplate.sectionsOrder],
              },
            }))}
          >
            Сбросить к стандартным
          </Button>
        </div>
      );
    }

    if (editingSettingId === 'defaultPaymentTerms') {
      const payment = settingsDraftValue.defaultPaymentTerms;
      return (
        <div className="grid gap-4">
          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Текст условий оплаты для КП</span>
            <Textarea rows={5} value={payment.paymentText} onChange={(event) => updateSettingsDraft(current => ({ ...current, defaultPaymentTerms: { ...current.defaultPaymentTerms, paymentText: event.target.value } }))} />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Предоплата, %</span>
              <Input type="number" min="0" max="100" value={payment.prepaymentPercent} onChange={(event) => updateSettingsDraft(current => ({ ...current, defaultPaymentTerms: { ...current.defaultPaymentTerms, prepaymentPercent: Number(event.target.value) || 0 } }))} />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Срок оплаты счёта, дней</span>
              <Input type="number" min="0" value={payment.invoiceDueDays} onChange={(event) => updateSettingsDraft(current => ({ ...current, defaultPaymentTerms: { ...current.defaultPaymentTerms, invoiceDueDays: Number(event.target.value) || 0 } }))} />
            </label>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {renderBooleanToggle('НДС включён', payment.vatIncluded, (checked) => updateSettingsDraft(current => ({ ...current, defaultPaymentTerms: { ...current.defaultPaymentTerms, vatIncluded: checked } })))}
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-fit rounded-xl"
            onClick={() => updateSettingsDraft(current => ({
              ...current,
              defaultPaymentTerms: { ...DEFAULT_SALES_SETTINGS.defaultPaymentTerms },
            }))}
          >
            Сбросить к стандартным
          </Button>
        </div>
      );
    }

    if (editingSettingId === 'defaultDeliveryTerms') {
      const delivery = settingsDraftValue.defaultDeliveryTerms;
      return (
        <div className="grid gap-4">
          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Текст условий доставки для КП</span>
            <Textarea rows={5} value={delivery.deliveryText} onChange={(event) => updateSettingsDraft(current => ({ ...current, defaultDeliveryTerms: { ...current.defaultDeliveryTerms, deliveryText: event.target.value } }))} />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Способ доставки</span>
              <select
                value={delivery.mode}
                onChange={(event) => updateSettingsDraft(current => ({ ...current, defaultDeliveryTerms: { ...current.defaultDeliveryTerms, mode: event.target.value as SalesSectionSettings['defaultDeliveryTerms']['mode'] } }))}
                className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-950"
              >
                <option value="negotiable">По договорённости</option>
                <option value="pickup">Самовывоз</option>
                <option value="company_delivery">Доставка силами компании</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Кто оплачивает доставку</span>
              <select
                value={delivery.paidBy}
                onChange={(event) => updateSettingsDraft(current => ({ ...current, defaultDeliveryTerms: { ...current.defaultDeliveryTerms, paidBy: event.target.value as SalesSectionSettings['defaultDeliveryTerms']['paidBy'] } }))}
                className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-950"
              >
                <option value="negotiable">По договорённости</option>
                <option value="buyer">Покупатель</option>
                <option value="seller">Продавец</option>
              </select>
            </label>
          </div>
          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Готовность к отгрузке, дней</span>
            <Input type="number" min="0" value={delivery.readinessDays} onChange={(event) => updateSettingsDraft(current => ({ ...current, defaultDeliveryTerms: { ...current.defaultDeliveryTerms, readinessDays: Number(event.target.value) || 0 } }))} />
          </label>
          <Button
            type="button"
            variant="secondary"
            className="w-fit rounded-xl"
            onClick={() => updateSettingsDraft(current => ({
              ...current,
              defaultDeliveryTerms: { ...DEFAULT_SALES_SETTINGS.defaultDeliveryTerms },
            }))}
          >
            Сбросить к стандартным
          </Button>
        </div>
      );
    }

    if (editingSettingId === 'warrantyTerms') {
      const warranty = settingsDraftValue.warrantyTerms;
      return (
        <div className="grid gap-4">
          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Основной текст гарантии</span>
            <Textarea rows={4} value={warranty.warrantyText} onChange={(event) => updateSettingsDraft(current => ({ ...current, warrantyTerms: { ...current.warrantyTerms, warrantyText: event.target.value } }))} />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Гарантия для новой техники, месяцев</span>
              <Input type="number" min="0" value={warranty.warrantyMonthsNew} onChange={(event) => updateSettingsDraft(current => ({ ...current, warrantyTerms: { ...current.warrantyTerms, warrantyMonthsNew: Number(event.target.value) || 0 } }))} />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Гарантия для б/у техники, месяцев</span>
              <Input type="number" min="0" value={warranty.warrantyMonthsUsed} onChange={(event) => updateSettingsDraft(current => ({ ...current, warrantyTerms: { ...current.warrantyTerms, warrantyMonthsUsed: Number(event.target.value) || 0 } }))} />
            </label>
          </div>
          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Исключения из гарантии</span>
            <Textarea rows={3} value={warranty.exclusionsText} onChange={(event) => updateSettingsDraft(current => ({ ...current, warrantyTerms: { ...current.warrantyTerms, exclusionsText: event.target.value } }))} />
          </label>
          <Button
            type="button"
            variant="secondary"
            className="w-fit rounded-xl"
            onClick={() => updateSettingsDraft(current => ({
              ...current,
              warrantyTerms: { ...DEFAULT_SALES_SETTINGS.warrantyTerms },
            }))}
          >
            Сбросить к стандартным
          </Button>
        </div>
      );
    }

    if (editingSettingId === 'pricingRules') {
      const pricing = settingsDraftValue.pricingRules;
      return (
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Базовая наценка, %</span>
              <Input type="number" min="0" value={pricing.defaultMarkupPercent} onChange={(event) => updateSettingsDraft(current => ({ ...current, pricingRules: { ...current.pricingRules, defaultMarkupPercent: Number(event.target.value) || 0 } }))} />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Минимальная маржа, %</span>
              <Input type="number" min="0" value={pricing.minimumMarginPercent} onChange={(event) => updateSettingsDraft(current => ({ ...current, pricingRules: { ...current.pricingRules, minimumMarginPercent: Number(event.target.value) || 0 } }))} />
            </label>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {renderBooleanToggle('Разрешить цену ниже минимальной', pricing.allowBelowMinimumPrice, (checked) => updateSettingsDraft(current => ({ ...current, pricingRules: { ...current.pricingRules, allowBelowMinimumPrice: checked } })))}
            {renderBooleanToggle('Учитывать состояние новой/б/у', pricing.useConditionAdjustment, (checked) => updateSettingsDraft(current => ({ ...current, pricingRules: { ...current.pricingRules, useConditionAdjustment: checked } })))}
            {renderBooleanToggle('Учитывать год выпуска', pricing.useYearAdjustment, (checked) => updateSettingsDraft(current => ({ ...current, pricingRules: { ...current.pricingRules, useYearAdjustment: checked } })))}
            {renderBooleanToggle('Учитывать наработку', pricing.useHoursAdjustment, (checked) => updateSettingsDraft(current => ({ ...current, pricingRules: { ...current.pricingRules, useHoursAdjustment: checked } })))}
            {renderBooleanToggle('Учитывать PDI', pricing.usePdiAdjustment, (checked) => updateSettingsDraft(current => ({ ...current, pricingRules: { ...current.pricingRules, usePdiAdjustment: checked } })))}
            {renderBooleanToggle('Учитывать комплектацию', pricing.usePackageAdjustment, (checked) => updateSettingsDraft(current => ({ ...current, pricingRules: { ...current.pricingRules, usePackageAdjustment: checked } })))}
            {renderBooleanToggle('Учитывать документы', pricing.useDocumentsAdjustment, (checked) => updateSettingsDraft(current => ({ ...current, pricingRules: { ...current.pricingRules, useDocumentsAdjustment: checked } })))}
          </div>
          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Текстовое описание правил</span>
            <Textarea
              rows={6}
              value={pricing.rulesText}
              onChange={(event) => updateSettingsDraft(current => ({ ...current, pricingRules: { ...current.pricingRules, rulesText: event.target.value } }))}
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            className="w-fit rounded-xl"
            onClick={() => updateSettingsDraft(current => ({
              ...current,
              pricingRules: { ...DEFAULT_SALES_SETTINGS.pricingRules },
            }))}
          >
            Сбросить к стандартным
          </Button>
        </div>
      );
    }

    if (editingSettingId === 'priceChangeReasons') {
      const activeReasons = settingsDraftValue.priceChangeReasons.filter(reason => reason.isActive && reason.name.trim());
      return (
        <div className="grid gap-3">
          <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-900/50 dark:bg-blue-950/20">
            <p className="text-sm font-medium text-blue-950 dark:text-blue-100">Активные причины</p>
            {activeReasons.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {activeReasons.map(reason => (
                  <Badge key={reason.id} variant="default">{reason.name}</Badge>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-blue-700 dark:text-blue-200">Активных причин пока нет.</p>
            )}
          </div>
          {settingsDraftValue.priceChangeReasons.map((reason, index) => (
            <div key={reason.id} className="grid gap-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <Input value={reason.name} onChange={(event) => updatePriceReason(index, { name: event.target.value })} placeholder="Причина изменения цены" />
              <div className="flex flex-wrap gap-2">
                {renderBooleanToggle('Активна', reason.isActive, (checked) => updatePriceReason(index, { isActive: checked }))}
                <Button type="button" variant="secondary" className="rounded-xl" onClick={() => archivePriceReason(index)}>
                  Отключить / архивировать
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="secondary" className="w-fit rounded-xl" onClick={addPriceReason}>
            Добавить причину
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-fit rounded-xl"
            onClick={() => updateSettingsDraft(current => ({
              ...current,
              priceChangeReasons: DEFAULT_SALES_SETTINGS.priceChangeReasons.map(reason => ({ ...reason })),
            }))}
          >
            Сбросить к стандартным
          </Button>
        </div>
      );
    }

    const kit = settingsDraftValue.packageCommentTemplate;
    return (
      <div className="grid gap-4">
        <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4 text-sm text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-100">
          Этот текст используется при формировании КП, если в шаблоне включён блок комментария по комплектации.
        </div>
        <label className="space-y-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Шаблон комментария</span>
          <Textarea rows={6} value={kit.text} onChange={(event) => updateSettingsDraft(current => ({ ...current, packageCommentTemplate: { ...current.packageCommentTemplate, text: event.target.value } }))} />
        </label>
        <Button
          type="button"
          variant="secondary"
          className="w-fit rounded-xl"
          onClick={() => updateSettingsDraft(current => ({
            ...current,
            packageCommentTemplate: { ...DEFAULT_SALES_SETTINGS.packageCommentTemplate },
          }))}
        >
          Сбросить к стандартному
        </Button>
      </div>
    );
  }

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
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[--color-primary]">Коммерческая сводка</p>
            <h2 className="mt-1 text-xl font-bold text-gray-900 dark:text-white">Готовность техники к продаже</h2>
            <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
              КП, PDI, блокеры и готовность к показу клиенту собраны перед рабочим реестром.
            </p>
          </div>
          {saleEquipment.length === 0 ? (
            <span className="rounded-full border border-dashed border-gray-300 px-3 py-1 text-xs font-medium text-gray-500 dark:border-gray-600 dark:text-gray-400">
              Продажная витрина пока пустая
            </span>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {commercialSummary.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className={`min-w-0 rounded-xl border p-4 ${item.tone}`}>
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] opacity-80">{item.label}</p>
                    <p className="mt-2 break-words text-3xl font-bold leading-none">{item.value}</p>
                  </div>
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/70 text-current dark:bg-gray-950/30">
                    <Icon className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-3 break-words text-sm opacity-85">{item.detail}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
          <div className="grid gap-3 sm:grid-cols-3">
            {workflowSummary.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="min-w-0 rounded-xl border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-gray-900/40">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </div>
                  <p className="mt-2 break-words text-xl font-bold text-gray-900 dark:text-white">{item.value}</p>
                  <p className="mt-1 break-words text-sm text-gray-500 dark:text-gray-400">{item.detail}</p>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-gray-900/40">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">Поступление и приёмка</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              {[
                ['Планируется', plannedArrivalCount],
                ['Ожидает приёмки', waitingAcceptanceCount],
                ['Принято', acceptedReceiptCount],
                ['С замечаниями', rejectedReceiptCount],
              ].map(([label, value]) => (
                <div key={String(label)} className="min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
                  <p className="break-words text-xs text-gray-500 dark:text-gray-400">{label}</p>
                  <p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

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
                <option value="ready_for_rent">{EQUIPMENT_SALE_PDI_LABELS.ready_for_rent}</option>
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
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              {saleEquipment.length === 0
                ? 'Продажная витрина пока пустая. Добавьте технику в режиме продажи, чтобы видеть КП, PDI и готовность к показу.'
                : 'Под выбранные фильтры техника на продажу не найдена.'}
            </p>
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
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              {saleEquipment.length === 0
                ? 'Продажная витрина пока пустая. Добавьте технику в режиме продажи, чтобы видеть КП, PDI и готовность к показу.'
                : 'Под выбранные фильтры техника на продажу не найдена.'}
            </p>
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
                  24.04.2026 — 1 900 000 ₽ → 1 850 000 ₽ · Причина: {activePriceChangeReasons[0]?.name ?? 'корректировка по рынку'}.
                </div>
                <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                  <p className="font-medium text-gray-900 dark:text-white">Доступные причины изменения цены</p>
                  {activePriceChangeReasons.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {activePriceChangeReasons.map(reason => (
                        <Badge key={reason.id} variant="default">{reason.name}</Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Причины не настроены.</p>
                  )}
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
                  <Link to={`/documents?equipmentId=${equipment.id}&type=commercial_offer&action=create`}>
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

        {isAdmin ? (
          <TabsContent value="settings" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Настройки продаж</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {SALES_SETTINGS_META.map(item => {
                  const configured = isSettingConfigured(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setEditingSettingId(item.id)}
                      className="group flex min-h-[172px] cursor-pointer flex-col justify-between rounded-xl border border-gray-200 p-4 text-left text-sm transition hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-gray-700 dark:hover:border-primary/60"
                    >
                      <span className="space-y-3">
                        <span className="flex items-start justify-between gap-3">
                          <span className="font-semibold text-gray-900 dark:text-white">{item.title}</span>
                          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-primary" />
                        </span>
                        <Badge variant={configured ? 'success' : 'warning'}>
                          {configured ? 'Настроено' : 'Не настроено'}
                        </Badge>
                        <span className="block line-clamp-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
                          {settingsSummary(item.id)}
                        </span>
                      </span>
                      <span className="mt-4 inline-flex h-9 w-fit items-center rounded-xl border border-gray-200 px-3 text-sm font-medium text-primary transition group-hover:border-primary/40 group-hover:bg-white dark:border-gray-700 dark:group-hover:bg-gray-900">
                        Настроить
                      </span>
                    </button>
                  );
                })}
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
        ) : null}
      </Tabs>

      {isAdmin ? (
      <Dialog
        open={Boolean(editingSetting)}
        onOpenChange={(open) => {
          if (!open && !saveSettingsMutation.isPending) setEditingSettingId(null);
        }}
      >
        <DialogContent className="rounded-2xl sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>{editingSetting?.title}</DialogTitle>
            <DialogDescription>{editingSetting?.description}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] min-h-0 overflow-y-auto py-4 pr-1">
            <fieldset disabled={saveSettingsMutation.isPending} className="contents">
              {renderSettingsEditor()}
            </fieldset>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Сохраняется в app settings и используется как административная настройка продажного раздела и КП.
            </p>
            {settingsError ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
                {settingsError}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={saveSettingsMutation.isPending}
              onClick={() => setEditingSettingId(null)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              className="app-button-primary"
              disabled={!editingSettingId || saveSettingsMutation.isPending}
              onClick={() => {
                if (!editingSettingId || !settingsDraft) return;
                saveSettingsMutation.mutate({
                  ...settingsDraft,
                  priceChangeReasons: settingsDraft.priceChangeReasons.filter(reason => reason.name.trim()),
                });
              }}
            >
              {saveSettingsMutation.isPending ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      ) : null}
    </div>
  );
}
