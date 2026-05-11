export const SALES_SETTINGS_KEY = 'sales_section_settings';

export type QuoteTemplateSection =
  | 'intro'
  | 'equipment'
  | 'price'
  | 'payment'
  | 'delivery'
  | 'warranty'
  | 'package'
  | 'packageComment'
  | 'footer';

export type SalesSettingId =
  | 'quoteTemplate'
  | 'defaultPaymentTerms'
  | 'defaultDeliveryTerms'
  | 'warrantyTerms'
  | 'pricingRules'
  | 'priceChangeReasons'
  | 'packageCommentTemplate';

export type SalesPriceChangeReason = {
  id: string;
  name: string;
  isActive: boolean;
};

export type SalesSectionSettings = {
  quoteTemplate: {
    templateName: string;
    validityDays: number;
    title: string;
    introText: string;
    showEquipmentPhoto: boolean;
    showEquipmentSpecs: boolean;
    showEquipmentPackage: boolean;
    showPaymentTerms: boolean;
    showDeliveryTerms: boolean;
    showWarrantyTerms: boolean;
    showVat: boolean;
    showPackageComment: boolean;
    footerText: string;
    sectionsOrder: QuoteTemplateSection[];
  };
  defaultPaymentTerms: {
    prepaymentPercent: number;
    invoiceDueDays: number;
    vatIncluded: boolean;
    paymentText: string;
  };
  defaultDeliveryTerms: {
    mode: 'pickup' | 'company_delivery' | 'negotiable';
    paidBy: 'buyer' | 'seller' | 'negotiable';
    readinessDays: number;
    deliveryText: string;
  };
  warrantyTerms: {
    warrantyMonthsNew: number;
    warrantyMonthsUsed: number;
    warrantyText: string;
    exclusionsText: string;
  };
  pricingRules: {
    defaultMarkupPercent: number;
    minimumMarginPercent: number;
    allowBelowMinimumPrice: boolean;
    useConditionAdjustment: boolean;
    useYearAdjustment: boolean;
    useHoursAdjustment: boolean;
    usePdiAdjustment: boolean;
    usePackageAdjustment: boolean;
    useDocumentsAdjustment: boolean;
    rulesText: string;
  };
  priceChangeReasons: SalesPriceChangeReason[];
  packageCommentTemplate: {
    text: string;
  };
};

const DEFAULT_SECTIONS_ORDER: QuoteTemplateSection[] = [
  'intro',
  'equipment',
  'price',
  'payment',
  'delivery',
  'warranty',
  'package',
  'packageComment',
  'footer',
];

export const SALES_SETTINGS_META: Array<{ id: SalesSettingId; title: string; description: string }> = [
  {
    id: 'quoteTemplate',
    title: 'Шаблоны КП',
    description: 'Структура, порядок секций и видимость блоков коммерческого предложения.',
  },
  {
    id: 'defaultPaymentTerms',
    title: 'Условия оплаты по умолчанию',
    description: 'Базовые условия оплаты, которые подставляются в КП.',
  },
  {
    id: 'defaultDeliveryTerms',
    title: 'Условия доставки по умолчанию',
    description: 'Стандартные условия доставки и готовности к отгрузке.',
  },
  {
    id: 'warrantyTerms',
    title: 'Гарантийные условия',
    description: 'Сроки, общий текст и исключения по гарантии.',
  },
  {
    id: 'pricingRules',
    title: 'Правила расчёта цены',
    description: 'Маржа и факторы корректировки стоимости.',
  },
  {
    id: 'priceChangeReasons',
    title: 'Причины изменения цены',
    description: 'Справочник причин для истории изменения продажной цены.',
  },
  {
    id: 'packageCommentTemplate',
    title: 'Шаблон комментария по комплектации',
    description: 'Текст комментария по комплектации для КП и продажной карточки.',
  },
];

export const DEFAULT_SALES_SETTINGS: SalesSectionSettings = {
  quoteTemplate: {
    templateName: 'Базовый шаблон КП',
    validityDays: 14,
    title: 'Коммерческое предложение',
    introText: 'Предлагаем к поставке продажную технику с указанными характеристиками и комплектацией.',
    showEquipmentPhoto: true,
    showEquipmentSpecs: true,
    showEquipmentPackage: true,
    showPaymentTerms: true,
    showDeliveryTerms: true,
    showWarrantyTerms: true,
    showVat: true,
    showPackageComment: true,
    footerText: 'Предложение не является публичной офертой. Итоговые условия фиксируются в договоре поставки.',
    sectionsOrder: DEFAULT_SECTIONS_ORDER,
  },
  defaultPaymentTerms: {
    prepaymentPercent: 100,
    invoiceDueDays: 3,
    vatIncluded: true,
    paymentText: 'Оплата 100% по счёту. Цена указана с НДС 20%.',
  },
  defaultDeliveryTerms: {
    mode: 'negotiable',
    paidBy: 'negotiable',
    readinessDays: 3,
    deliveryText: 'Самовывоз со склада или доставка по отдельному согласованию.',
  },
  warrantyTerms: {
    warrantyMonthsNew: 12,
    warrantyMonthsUsed: 0,
    warrantyText: 'Гарантия предоставляется при соблюдении условий эксплуатации.',
    exclusionsText: 'Гарантия не распространяется на расходные материалы, естественный износ и повреждения вследствие неправильной эксплуатации.',
  },
  pricingRules: {
    defaultMarkupPercent: 30,
    minimumMarginPercent: 15,
    allowBelowMinimumPrice: false,
    useConditionAdjustment: true,
    useYearAdjustment: true,
    useHoursAdjustment: true,
    usePdiAdjustment: true,
    usePackageAdjustment: true,
    useDocumentsAdjustment: true,
    rulesText: 'Цена зависит от года выпуска, наработки, состояния, PDI, комплектации, документов и срочности продажи.',
  },
  priceChangeReasons: [
    { id: 'market-adjustment', name: 'Корректировка по рынку', isActive: true },
    { id: 'urgent-sale', name: 'Срочная продажа', isActive: true },
    { id: 'client-discount', name: 'Скидка клиенту', isActive: true },
    { id: 'equipment-condition-change', name: 'Изменение состояния техники', isActive: true },
    { id: 'battery-condition', name: 'Состояние АКБ', isActive: true },
    { id: 'package', name: 'Комплектация', isActive: true },
    { id: 'pdi-documents', name: 'PDI или документы', isActive: true },
    { id: 'price-error', name: 'Ошибка в цене', isActive: true },
    { id: 'management-decision', name: 'Решение руководителя', isActive: true },
    { id: 'other', name: 'Другое', isActive: true },
  ],
  packageCommentTemplate: {
    text: 'Комплектация указана по состоянию на дату формирования КП. Перед отгрузкой проводится контрольная проверка.',
  },
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  const next = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function textLines(value: unknown) {
  return stringValue(value, '')
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeSectionsOrder(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_SALES_SETTINGS.quoteTemplate.sectionsOrder;
  const allowed = new Set(DEFAULT_SECTIONS_ORDER);
  const next = value.filter((item): item is QuoteTemplateSection => allowed.has(item as QuoteTemplateSection));
  return next.length > 0 ? next : DEFAULT_SALES_SETTINGS.quoteTemplate.sectionsOrder;
}

function normalizeReasons(value: unknown): SalesPriceChangeReason[] {
  let reasons: SalesPriceChangeReason[];
  if (Array.isArray(value)) {
    reasons = value
      .map((item, index) => {
        const source = objectValue(item);
        const name = stringValue(source.name, stringValue(source.title, '')).trim();
        if (!name) return null;
        return {
          id: stringValue(source.id, `reason-${index + 1}`),
          name,
          isActive: booleanValue(source.isActive, booleanValue(source.active, true)),
        };
      })
      .filter(Boolean) as SalesPriceChangeReason[];
  } else if (typeof value === 'string') {
    reasons = textLines(value).map((name, index) => ({
      id: `legacy-reason-${index + 1}`,
      name,
      isActive: true,
    }));
  } else {
    reasons = DEFAULT_SALES_SETTINGS.priceChangeReasons;
  }

  const normalized = reasons.length > 0 ? reasons : DEFAULT_SALES_SETTINGS.priceChangeReasons;
  const existingNames = new Set(normalized.map(reason => reason.name.trim().toLowerCase()));
  const missingDefaults = DEFAULT_SALES_SETTINGS.priceChangeReasons.filter(reason => !existingNames.has(reason.name.toLowerCase()));
  return [...normalized, ...missingDefaults];
}

function normalizePackageTemplate(source: Record<string, unknown>) {
  const next = objectValue(source.packageCommentTemplate);
  const legacy = objectValue(source.kitCommentTemplate);
  return {
    text: stringValue(
      next.text,
      stringValue(legacy.template, stringValue(source.kitCommentTemplate, DEFAULT_SALES_SETTINGS.packageCommentTemplate.text)),
    ),
  };
}

export function normalizeSalesSettings(value: unknown): SalesSectionSettings {
  const source = objectValue(value);
  const quoteTemplate = objectValue(source.quoteTemplate);
  const defaultPaymentTerms = objectValue(source.defaultPaymentTerms);
  const legacyPaymentTerms = objectValue(source.paymentTerms);
  const defaultDeliveryTerms = objectValue(source.defaultDeliveryTerms);
  const legacyDeliveryTerms = objectValue(source.deliveryTerms);
  const warrantyTerms = objectValue(source.warrantyTerms);
  const pricingRules = objectValue(source.pricingRules);
  const defaultSettings = DEFAULT_SALES_SETTINGS;

  const legacyPricingFactors = textLines(source.pricingRules);
  const legacyRulesText = legacyPricingFactors.length > 0 ? legacyPricingFactors.join('\n') : defaultSettings.pricingRules.rulesText;
  const legacyQuoteText = stringValue(source.quoteTemplates, '');
  const legacyDefaultMethod = stringValue(legacyDeliveryTerms.defaultMethod, '');
  const legacyDeliveryPaidBy = stringValue(legacyDeliveryTerms.deliveryPaidBy, '');

  return {
    quoteTemplate: {
      templateName: stringValue(quoteTemplate.templateName, defaultSettings.quoteTemplate.templateName),
      validityDays: numberValue(quoteTemplate.validityDays, defaultSettings.quoteTemplate.validityDays),
      title: stringValue(quoteTemplate.title, defaultSettings.quoteTemplate.title),
      introText: stringValue(quoteTemplate.introText, legacyQuoteText || defaultSettings.quoteTemplate.introText),
      showEquipmentPhoto: booleanValue(quoteTemplate.showEquipmentPhoto, booleanValue(quoteTemplate.showPhoto, defaultSettings.quoteTemplate.showEquipmentPhoto)),
      showEquipmentSpecs: booleanValue(quoteTemplate.showEquipmentSpecs, booleanValue(quoteTemplate.showCharacteristics, defaultSettings.quoteTemplate.showEquipmentSpecs)),
      showEquipmentPackage: booleanValue(quoteTemplate.showEquipmentPackage, defaultSettings.quoteTemplate.showEquipmentPackage),
      showPaymentTerms: booleanValue(quoteTemplate.showPaymentTerms, defaultSettings.quoteTemplate.showPaymentTerms),
      showDeliveryTerms: booleanValue(quoteTemplate.showDeliveryTerms, defaultSettings.quoteTemplate.showDeliveryTerms),
      showWarrantyTerms: booleanValue(quoteTemplate.showWarrantyTerms, defaultSettings.quoteTemplate.showWarrantyTerms),
      showVat: booleanValue(quoteTemplate.showVat, booleanValue(quoteTemplate.includeVat, defaultSettings.quoteTemplate.showVat)),
      showPackageComment: booleanValue(quoteTemplate.showPackageComment, defaultSettings.quoteTemplate.showPackageComment),
      footerText: stringValue(quoteTemplate.footerText, defaultSettings.quoteTemplate.footerText),
      sectionsOrder: normalizeSectionsOrder(quoteTemplate.sectionsOrder),
    },
    defaultPaymentTerms: {
      prepaymentPercent: numberValue(defaultPaymentTerms.prepaymentPercent, numberValue(legacyPaymentTerms.prepaymentPercent, defaultSettings.defaultPaymentTerms.prepaymentPercent)),
      invoiceDueDays: numberValue(defaultPaymentTerms.invoiceDueDays, numberValue(legacyPaymentTerms.paymentDeadlineDays, defaultSettings.defaultPaymentTerms.invoiceDueDays)),
      vatIncluded: booleanValue(defaultPaymentTerms.vatIncluded, booleanValue(legacyPaymentTerms.vatIncluded, defaultSettings.defaultPaymentTerms.vatIncluded)),
      paymentText: stringValue(defaultPaymentTerms.paymentText, stringValue(legacyPaymentTerms.defaultText, stringValue(source.paymentTerms, defaultSettings.defaultPaymentTerms.paymentText))),
    },
    defaultDeliveryTerms: {
      mode: enumValue(
        defaultDeliveryTerms.mode,
        ['pickup', 'company_delivery', 'negotiable'] as const,
        legacyDefaultMethod === 'pickup' ? 'pickup' : legacyDefaultMethod === 'delivery' ? 'company_delivery' : defaultSettings.defaultDeliveryTerms.mode,
      ),
      paidBy: enumValue(
        defaultDeliveryTerms.paidBy,
        ['buyer', 'seller', 'negotiable'] as const,
        legacyDeliveryPaidBy === 'buyer' ? 'buyer' : legacyDeliveryPaidBy === 'seller' ? 'seller' : defaultSettings.defaultDeliveryTerms.paidBy,
      ),
      readinessDays: numberValue(defaultDeliveryTerms.readinessDays, defaultSettings.defaultDeliveryTerms.readinessDays),
      deliveryText: stringValue(defaultDeliveryTerms.deliveryText, stringValue(legacyDeliveryTerms.defaultText, stringValue(source.deliveryTerms, defaultSettings.defaultDeliveryTerms.deliveryText))),
    },
    warrantyTerms: {
      warrantyMonthsNew: numberValue(warrantyTerms.warrantyMonthsNew, defaultSettings.warrantyTerms.warrantyMonthsNew),
      warrantyMonthsUsed: numberValue(warrantyTerms.warrantyMonthsUsed, defaultSettings.warrantyTerms.warrantyMonthsUsed),
      warrantyText: stringValue(warrantyTerms.warrantyText, stringValue(warrantyTerms.defaultText, stringValue(source.warrantyTerms, defaultSettings.warrantyTerms.warrantyText))),
      exclusionsText: stringValue(warrantyTerms.exclusionsText, [
        stringValue(warrantyTerms.newEquipment, ''),
        stringValue(warrantyTerms.usedEquipment, ''),
      ].filter(Boolean).join('\n') || defaultSettings.warrantyTerms.exclusionsText),
    },
    pricingRules: {
      defaultMarkupPercent: numberValue(pricingRules.defaultMarkupPercent, numberValue(pricingRules.targetMarginPercent, defaultSettings.pricingRules.defaultMarkupPercent)),
      minimumMarginPercent: numberValue(pricingRules.minimumMarginPercent, numberValue(pricingRules.minMarginPercent, defaultSettings.pricingRules.minimumMarginPercent)),
      allowBelowMinimumPrice: booleanValue(pricingRules.allowBelowMinimumPrice, booleanValue(pricingRules.allowBelowMinPrice, defaultSettings.pricingRules.allowBelowMinimumPrice)),
      useConditionAdjustment: booleanValue(pricingRules.useConditionAdjustment, defaultSettings.pricingRules.useConditionAdjustment),
      useYearAdjustment: booleanValue(pricingRules.useYearAdjustment, defaultSettings.pricingRules.useYearAdjustment),
      useHoursAdjustment: booleanValue(pricingRules.useHoursAdjustment, defaultSettings.pricingRules.useHoursAdjustment),
      usePdiAdjustment: booleanValue(pricingRules.usePdiAdjustment, defaultSettings.pricingRules.usePdiAdjustment),
      usePackageAdjustment: booleanValue(pricingRules.usePackageAdjustment, defaultSettings.pricingRules.usePackageAdjustment),
      useDocumentsAdjustment: booleanValue(pricingRules.useDocumentsAdjustment, defaultSettings.pricingRules.useDocumentsAdjustment),
      rulesText: stringValue(pricingRules.rulesText, legacyRulesText),
    },
    priceChangeReasons: normalizeReasons(source.priceChangeReasons),
    packageCommentTemplate: normalizePackageTemplate(source),
  };
}
