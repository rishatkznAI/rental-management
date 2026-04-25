import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { appSettingsService } from '../services/app-settings.service';
import type { AppSetting } from '../types';

export const ADMIN_LISTS_SETTING_KEY = 'admin_reference_lists';
export const ADMIN_FORMS_SETTING_KEY = 'admin_form_fields';

export type AdminFieldType = 'text' | 'number' | 'date' | 'textarea' | 'select';

export interface AdminListOption {
  value: string;
  label: string;
  active: boolean;
  locked?: boolean;
}

export interface AdminListConfig {
  id: string;
  title: string;
  section: string;
  description: string;
  allowCustomItems: boolean;
  items: AdminListOption[];
}

export interface AdminFormFieldSetting {
  key: string;
  label: string;
  type: AdminFieldType;
  visible: boolean;
  required: boolean;
  placeholder?: string;
  listId?: string;
  locked?: boolean;
  custom?: boolean;
}

export interface AdminFormConfig {
  id: string;
  title: string;
  section: string;
  description: string;
  fields: AdminFormFieldSetting[];
}

function option(value: string, label: string, locked = true): AdminListOption {
  return { value, label, active: true, locked };
}

function textOption(label: string): AdminListOption {
  return { value: label, label, active: true, locked: false };
}

export const DEFAULT_ADMIN_LISTS: AdminListConfig[] = [
  {
    id: 'finance_expense_categories',
    title: 'Категории постоянных расходов',
    section: 'Финансы',
    description: 'Используются в форме добавления расхода и фильтрах раздела «Финансы».',
    allowCustomItems: true,
    items: [
      'Аренда офиса',
      'Склад',
      'Зарплата',
      'Налоги',
      'Лизинг',
      'Связь и интернет',
      'Бухгалтерия',
      'Страхование',
      'Маркетинг',
      'Прочее',
    ].map(textOption),
  },
  {
    id: 'finance_expense_frequency',
    title: 'Периодичность расходов',
    section: 'Финансы',
    description: 'Системные значения фиксированы, администратор управляет подписями и доступностью.',
    allowCustomItems: false,
    items: [
      option('monthly', 'Ежемесячно'),
      option('quarterly', 'Ежеквартально'),
      option('yearly', 'Ежегодно'),
    ],
  },
  {
    id: 'finance_expense_statuses',
    title: 'Статусы постоянных расходов',
    section: 'Финансы',
    description: 'Статусы используются в карточках, фильтрах и быстрых действиях расходов.',
    allowCustomItems: false,
    items: [
      option('active', 'Активен'),
      option('paused', 'Пауза'),
      option('archived', 'Архив'),
    ],
  },
  {
    id: 'equipment_statuses',
    title: 'Статусы техники',
    section: 'Техника',
    description: 'Базовые статусы парка техники.',
    allowCustomItems: false,
    items: [
      option('available', 'Свободен'),
      option('rented', 'В аренде'),
      option('reserved', 'Бронь'),
      option('in_service', 'В сервисе'),
      option('inactive', 'Списан'),
    ],
  },
  {
    id: 'equipment_categories',
    title: 'Категории техники',
    section: 'Техника',
    description: 'Категории участия техники в парке, продажах и клиентском учёте.',
    allowCustomItems: false,
    items: [
      option('own', 'Собственная'),
      option('sold', 'Проданная'),
      option('client', 'Клиентская'),
      option('partner', 'Партнёрская'),
    ],
  },
  {
    id: 'equipment_drives',
    title: 'Типы привода техники',
    section: 'Техника',
    description: 'Значения поля «Привод» в карточках техники.',
    allowCustomItems: false,
    items: [
      option('diesel', 'Дизель'),
      option('electric', 'Электро'),
    ],
  },
  {
    id: 'equipment_priorities',
    title: 'Приоритеты техники',
    section: 'Техника',
    description: 'Приоритеты обслуживания и внимания к единицам техники.',
    allowCustomItems: false,
    items: [
      option('critical', 'Критический'),
      option('high', 'Высокий'),
      option('medium', 'Средний'),
      option('low', 'Низкий'),
    ],
  },
  {
    id: 'equipment_locations',
    title: 'Локации техники',
    section: 'Техника',
    description: 'Складские и рабочие локации для техники.',
    allowCustomItems: true,
    items: ['Москва, склад А', 'Москва, склад Б', 'Санкт-Петербург'].map(textOption),
  },
  {
    id: 'downtime_reasons',
    title: 'Причины простоя',
    section: 'Планирование',
    description: 'Причины, которые выбираются при фиксации простоя техники.',
    allowCustomItems: true,
    items: ['Плановое ТО', 'Ремонт', 'Ожидание запчастей', 'Калибровка'].map(textOption),
  },
  {
    id: 'service_priorities',
    title: 'Приоритеты сервиса',
    section: 'Сервис',
    description: 'Приоритеты сервисных заявок и гарантийных обращений.',
    allowCustomItems: false,
    items: [
      option('low', 'Низкий'),
      option('medium', 'Средний'),
      option('high', 'Высокий'),
      option('critical', 'Критический'),
    ],
  },
  {
    id: 'service_statuses',
    title: 'Статусы сервиса',
    section: 'Сервис',
    description: 'Этапы обработки сервисной заявки.',
    allowCustomItems: false,
    items: [
      option('new', 'Новый'),
      option('in_progress', 'В работе'),
      option('waiting_parts', 'Ожидание запчастей'),
      option('ready', 'Готово'),
      option('closed', 'Закрыто'),
    ],
  },
  {
    id: 'service_scenarios',
    title: 'Сценарии сервиса',
    section: 'Сервис',
    description: 'Типы сервисных заявок.',
    allowCustomItems: false,
    items: [
      option('repair', 'Ремонт'),
      option('to', 'ТО'),
      option('chto', 'ЧТО'),
      option('pto', 'ПТО'),
    ],
  },
  {
    id: 'client_statuses',
    title: 'Статусы клиентов',
    section: 'Клиенты',
    description: 'Состояния карточек клиентов.',
    allowCustomItems: false,
    items: [
      option('active', 'Активен'),
      option('inactive', 'Неактивен'),
      option('blocked', 'Заблокирован'),
    ],
  },
  {
    id: 'payment_statuses',
    title: 'Статусы платежей',
    section: 'Платежи',
    description: 'Статусы оплаты счетов и аренд.',
    allowCustomItems: false,
    items: [
      option('pending', 'Не оплачено'),
      option('paid', 'Оплачено'),
      option('partial', 'Частично оплачено'),
      option('overdue', 'Просрочено'),
    ],
  },
  {
    id: 'document_types',
    title: 'Типы документов',
    section: 'Документы',
    description: 'Типы документов в документообороте.',
    allowCustomItems: false,
    items: [
      option('contract', 'Договор'),
      option('act', 'Акт'),
      option('invoice', 'Счёт'),
      option('work_order', 'Заказ-наряд'),
    ],
  },
  {
    id: 'document_statuses',
    title: 'Статусы документов',
    section: 'Документы',
    description: 'Этапы согласования и подписания документов.',
    allowCustomItems: false,
    items: [
      option('draft', 'Черновик'),
      option('sent', 'Отправлен'),
      option('signed', 'Подписан'),
    ],
  },
  {
    id: 'delivery_types',
    title: 'Типы доставки',
    section: 'Доставка',
    description: 'Операции логистики техники.',
    allowCustomItems: false,
    items: [
      option('shipping', 'Отгрузка'),
      option('receiving', 'Приёмка'),
    ],
  },
  {
    id: 'rental_statuses',
    title: 'Статусы аренды',
    section: 'Аренды',
    description: 'Основные этапы жизненного цикла аренды.',
    allowCustomItems: false,
    items: [
      option('new', 'Новая'),
      option('confirmed', 'Подтверждена'),
      option('delivery', 'Доставка'),
      option('active', 'В аренде'),
      option('return_planned', 'Возврат'),
      option('closed', 'Закрыта'),
    ],
  },
];

export const DEFAULT_ADMIN_FORMS: AdminFormConfig[] = [
  {
    id: 'finance_expense',
    title: 'Форма постоянного расхода',
    section: 'Финансы',
    description: 'Поля модального окна добавления и редактирования постоянного расхода.',
    fields: [
      { key: 'name', label: 'Название', type: 'text', visible: true, required: true, placeholder: 'Например: аренда офиса', locked: true },
      { key: 'category', label: 'Категория', type: 'select', visible: true, required: true, listId: 'finance_expense_categories' },
      { key: 'amount', label: 'Сумма', type: 'number', visible: true, required: true, placeholder: '0', locked: true },
      { key: 'frequency', label: 'Периодичность', type: 'select', visible: true, required: false, listId: 'finance_expense_frequency' },
      { key: 'status', label: 'Статус', type: 'select', visible: true, required: false, listId: 'finance_expense_statuses' },
      { key: 'paymentDay', label: 'День оплаты', type: 'number', visible: true, required: false, placeholder: 'Например: 25' },
      { key: 'nextPaymentDate', label: 'Следующая дата оплаты', type: 'date', visible: true, required: false },
      { key: 'counterparty', label: 'Контрагент', type: 'text', visible: true, required: false, placeholder: 'Кому платим' },
      { key: 'account', label: 'Счёт / источник оплаты', type: 'text', visible: true, required: false, placeholder: 'Расчётный счёт, карта, касса' },
      { key: 'comment', label: 'Комментарий', type: 'textarea', visible: true, required: false, placeholder: 'Детали договора, номер счёта, условия оплаты' },
    ],
  },
  {
    id: 'equipment_card',
    title: 'Карточка техники',
    section: 'Техника',
    description: 'Основные поля карточки техники и формы добавления.',
    fields: [
      { key: 'inventoryNumber', label: 'Инвентарный номер', type: 'text', visible: true, required: true, locked: true },
      { key: 'manufacturer', label: 'Производитель', type: 'text', visible: true, required: true, locked: true },
      { key: 'model', label: 'Модель', type: 'text', visible: true, required: true, locked: true },
      { key: 'type', label: 'Тип техники', type: 'select', visible: true, required: true, listId: 'equipment_types', locked: true },
      { key: 'drive', label: 'Привод', type: 'select', visible: true, required: true, listId: 'equipment_drives' },
      { key: 'status', label: 'Статус', type: 'select', visible: true, required: true, listId: 'equipment_statuses' },
      { key: 'location', label: 'Локация', type: 'select', visible: true, required: true, listId: 'equipment_locations' },
      { key: 'priority', label: 'Приоритет', type: 'select', visible: true, required: false, listId: 'equipment_priorities' },
    ],
  },
  {
    id: 'client_card',
    title: 'Карточка клиента',
    section: 'Клиенты',
    description: 'Основные поля клиента.',
    fields: [
      { key: 'company', label: 'Компания', type: 'text', visible: true, required: true, locked: true },
      { key: 'inn', label: 'ИНН', type: 'text', visible: true, required: true },
      { key: 'contact', label: 'Контактное лицо', type: 'text', visible: true, required: true },
      { key: 'phone', label: 'Телефон', type: 'text', visible: true, required: true },
      { key: 'email', label: 'Email', type: 'text', visible: true, required: true },
      { key: 'paymentTerms', label: 'Условия оплаты', type: 'text', visible: true, required: true },
      { key: 'status', label: 'Статус', type: 'select', visible: true, required: false, listId: 'client_statuses' },
      { key: 'notes', label: 'Примечание', type: 'textarea', visible: true, required: false },
    ],
  },
  {
    id: 'service_ticket',
    title: 'Сервисная заявка',
    section: 'Сервис',
    description: 'Поля создания сервисной заявки.',
    fields: [
      { key: 'equipmentId', label: 'Техника', type: 'select', visible: true, required: true, locked: true },
      { key: 'serviceKind', label: 'Сценарий', type: 'select', visible: true, required: false, listId: 'service_scenarios' },
      { key: 'reason', label: 'Причина', type: 'text', visible: true, required: true },
      { key: 'description', label: 'Описание', type: 'textarea', visible: true, required: true },
      { key: 'priority', label: 'Приоритет', type: 'select', visible: true, required: true, listId: 'service_priorities' },
      { key: 'plannedDate', label: 'Плановая дата', type: 'date', visible: true, required: false },
    ],
  },
  {
    id: 'rental_card',
    title: 'Аренда',
    section: 'Аренды',
    description: 'Ключевые поля аренды.',
    fields: [
      { key: 'client', label: 'Клиент', type: 'select', visible: true, required: true, locked: true },
      { key: 'equipment', label: 'Техника', type: 'select', visible: true, required: true, locked: true },
      { key: 'startDate', label: 'Дата начала', type: 'date', visible: true, required: true },
      { key: 'plannedReturnDate', label: 'Плановая дата возврата', type: 'date', visible: true, required: true },
      { key: 'rate', label: 'Ставка', type: 'text', visible: true, required: true },
      { key: 'price', label: 'Сумма', type: 'number', visible: true, required: true },
      { key: 'status', label: 'Статус', type: 'select', visible: true, required: false, listId: 'rental_statuses' },
      { key: 'comments', label: 'Комментарий', type: 'textarea', visible: true, required: false },
    ],
  },
];

function normalizeText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeOption(item: unknown, fallback?: AdminListOption): AdminListOption | null {
  if (typeof item === 'string') {
    const label = normalizeText(item);
    return label ? { value: label, label, active: true, locked: false } : null;
  }
  if (!item || typeof item !== 'object') return fallback ?? null;
  const candidate = item as Partial<AdminListOption>;
  const value = normalizeText(candidate.value || fallback?.value);
  const label = normalizeText(candidate.label || fallback?.label || value);
  if (!value || !label) return fallback ?? null;
  return {
    value,
    label,
    active: candidate.active !== false,
    locked: Boolean(candidate.locked ?? fallback?.locked),
  };
}

function normalizeListConfig(defaultList: AdminListConfig, saved?: Partial<AdminListConfig> | null): AdminListConfig {
  const savedItems = Array.isArray(saved?.items)
    ? saved.items.map(item => normalizeOption(item)).filter((item): item is AdminListOption => Boolean(item))
    : [];
  const savedByValue = new Map(savedItems.map(item => [item.value, item]));
  const seen = new Set<string>();

  const mergedDefaults = defaultList.items.map(defaultItem => {
    seen.add(defaultItem.value);
    const savedItem = savedByValue.get(defaultItem.value);
    return normalizeOption(savedItem, defaultItem) ?? defaultItem;
  });

  const customItems = savedItems
    .filter(item => !seen.has(item.value))
    .map(item => ({ ...item, locked: false }));

  return {
    ...defaultList,
    title: normalizeText(saved?.title) || defaultList.title,
    description: normalizeText(saved?.description) || defaultList.description,
    allowCustomItems: Boolean(saved?.allowCustomItems ?? defaultList.allowCustomItems),
    items: [...mergedDefaults, ...customItems],
  };
}

function normalizeFormField(item: unknown, fallback?: AdminFormFieldSetting): AdminFormFieldSetting | null {
  if (!item || typeof item !== 'object') return fallback ?? null;
  const candidate = item as Partial<AdminFormFieldSetting>;
  const key = normalizeText(candidate.key || fallback?.key);
  const label = normalizeText(candidate.label || fallback?.label || key);
  const type = candidate.type || fallback?.type || 'text';
  if (!key || !label) return fallback ?? null;
  return {
    key,
    label,
    type,
    visible: candidate.visible ?? fallback?.visible ?? true,
    required: candidate.required ?? fallback?.required ?? false,
    placeholder: normalizeText(candidate.placeholder ?? fallback?.placeholder),
    listId: normalizeText(candidate.listId ?? fallback?.listId) || undefined,
    locked: Boolean(candidate.locked ?? fallback?.locked),
    custom: Boolean(candidate.custom ?? fallback?.custom),
  };
}

function normalizeFormConfig(defaultForm: AdminFormConfig, saved?: Partial<AdminFormConfig> | null): AdminFormConfig {
  const savedFields = Array.isArray(saved?.fields)
    ? saved.fields.map(item => normalizeFormField(item)).filter((item): item is AdminFormFieldSetting => Boolean(item))
    : [];
  const savedByKey = new Map(savedFields.map(item => [item.key, item]));
  const seen = new Set<string>();

  const mergedDefaults = defaultForm.fields.map(defaultField => {
    seen.add(defaultField.key);
    const savedField = savedByKey.get(defaultField.key);
    return normalizeFormField(savedField, defaultField) ?? defaultField;
  });

  const customFields = savedFields
    .filter(item => !seen.has(item.key))
    .map(item => ({ ...item, custom: true, locked: false }));

  return {
    ...defaultForm,
    title: normalizeText(saved?.title) || defaultForm.title,
    description: normalizeText(saved?.description) || defaultForm.description,
    fields: [...mergedDefaults, ...customFields],
  };
}

function readSettingArray<T>(appSettings: AppSetting[], key: string): T[] {
  const value = appSettings.find(item => item.key === key)?.value;
  return Array.isArray(value) ? value as T[] : [];
}

export function resolveAdminLists(appSettings: AppSetting[]): AdminListConfig[] {
  const savedLists = readSettingArray<Partial<AdminListConfig>>(appSettings, ADMIN_LISTS_SETTING_KEY);
  const savedById = new Map(savedLists.map(item => [item.id, item]));
  const defaults = DEFAULT_ADMIN_LISTS.map(list => normalizeListConfig(list, savedById.get(list.id)));
  const knownIds = new Set(defaults.map(item => item.id));
  const customLists = savedLists
    .filter(item => item.id && !knownIds.has(item.id))
    .map(item => normalizeListConfig({
      id: String(item.id),
      title: normalizeText(item.title) || String(item.id),
      section: normalizeText(item.section) || 'Пользовательские',
      description: normalizeText(item.description),
      allowCustomItems: true,
      items: [],
    }, item));

  return [...defaults, ...customLists];
}

export function resolveAdminForms(appSettings: AppSetting[]): AdminFormConfig[] {
  const savedForms = readSettingArray<Partial<AdminFormConfig>>(appSettings, ADMIN_FORMS_SETTING_KEY);
  const savedById = new Map(savedForms.map(item => [item.id, item]));
  const defaults = DEFAULT_ADMIN_FORMS.map(form => normalizeFormConfig(form, savedById.get(form.id)));
  const knownIds = new Set(defaults.map(item => item.id));
  const customForms = savedForms
    .filter(item => item.id && !knownIds.has(item.id))
    .map(item => normalizeFormConfig({
      id: String(item.id),
      title: normalizeText(item.title) || String(item.id),
      section: normalizeText(item.section) || 'Пользовательские',
      description: normalizeText(item.description),
      fields: [],
    }, item));

  return [...defaults, ...customForms];
}

export function getAdminListOptions(
  appSettings: AppSetting[],
  listId: string,
  options: { includeInactive?: boolean } = {},
): AdminListOption[] {
  const list = resolveAdminLists(appSettings).find(item => item.id === listId);
  if (!list) return [];
  return list.items.filter(item => options.includeInactive || item.active !== false);
}

export function getAdminListLabel(appSettings: AppSetting[], listId: string, value: string): string {
  const optionItem = getAdminListOptions(appSettings, listId, { includeInactive: true }).find(item => item.value === value);
  return optionItem?.label || value;
}

export function getAdminForm(appSettings: AppSetting[], formId: string): AdminFormConfig | null {
  return resolveAdminForms(appSettings).find(item => item.id === formId) || null;
}

export function useAdminSettings() {
  const { data: appSettings = [], ...query } = useQuery<AppSetting[]>({
    queryKey: ['app-settings'],
    queryFn: appSettingsService.getAll,
    staleTime: 1000 * 60 * 5,
  });

  return {
    appSettings,
    lists: useMemo(() => resolveAdminLists(appSettings), [appSettings]),
    forms: useMemo(() => resolveAdminForms(appSettings), [appSettings]),
    ...query,
  };
}

export function useAdminListOptions(listId: string, options: { includeInactive?: boolean } = {}) {
  const { appSettings } = useAdminSettings();
  return useMemo(
    () => getAdminListOptions(appSettings, listId, options),
    [appSettings, listId, options.includeInactive],
  );
}

export function useAdminFormFields(formId: string) {
  const { appSettings } = useAdminSettings();
  return useMemo(
    () => getAdminForm(appSettings, formId)?.fields || [],
    [appSettings, formId],
  );
}
