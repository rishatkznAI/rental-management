import type { EquipmentPreviewTab, EquipmentRegistryStatusKind, EquipmentTab } from './equipment.types';

export const EQUIPMENT_TABS: Array<{ key: EquipmentTab; label: string }> = [
  { key: 'all', label: 'Вся техника' },
  { key: 'available', label: 'Свободная' },
  { key: 'rented', label: 'В аренде' },
  { key: 'service', label: 'В сервисе' },
  { key: 'reserved', label: 'Бронь' },
  { key: 'written_off', label: 'Списанная' },
  { key: 'for_sale', label: 'На продажу' },
  { key: 'sold', label: 'Проданная' },
];

export const EQUIPMENT_STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'Все' },
  { value: 'available', label: 'Свободна' },
  { value: 'rented', label: 'В аренде' },
  { value: 'reserved', label: 'Бронь' },
  { value: 'in_service', label: 'В сервисе' },
  { value: 'inactive', label: 'Списана' },
  { value: 'for_sale', label: 'На продажу' },
  { value: 'sold', label: 'Продана' },
];

export const STANDARD_EQUIPMENT_TYPE_FILTER_OPTIONS = [
  { value: 'all', label: 'Все типы' },
  { value: 'group:scissor', label: 'Ножничный подъёмник' },
  { value: 'group:articulated', label: 'Коленчатый подъёмник' },
  { value: 'group:telescopic', label: 'Телескопический подъёмник' },
  { value: 'group:forklift', label: 'Погрузчик' },
  { value: 'group:other', label: 'Другое' },
];

export const EQUIPMENT_DRIVE_FILTER_OPTIONS = [
  { value: 'all', label: 'Все приводы' },
  { value: 'electric', label: 'Электро' },
  { value: 'diesel', label: 'Дизель' },
  { value: 'diesel_4x4', label: 'Дизель 4x4' },
  { value: 'other', label: 'Другое' },
];

export const DEFAULT_EQUIPMENT_PAGE_SIZE = 20;
export const EQUIPMENT_PAGE_SIZE_OPTIONS = [DEFAULT_EQUIPMENT_PAGE_SIZE, 50, 100];

export const EQUIPMENT_PREVIEW_TABS: Array<{ key: EquipmentPreviewTab; label: string }> = [
  { key: 'overview', label: 'Обзор' },
  { key: 'specs', label: 'Характеристики' },
  { key: 'documents', label: 'Документы' },
  { key: 'photos', label: 'Фото' },
  { key: 'history', label: 'История' },
];

export const EQUIPMENT_STATUS_BADGE_STYLES: Record<EquipmentRegistryStatusKind, { label: string; className: string }> = {
  available: {
    label: 'Свободна',
    className: 'bg-emerald-500/12 text-emerald-300 ring-1 ring-emerald-500/20',
  },
  rented: {
    label: 'В аренде',
    className: 'bg-blue-500/12 text-blue-300 ring-1 ring-blue-500/20',
  },
  reserved: {
    label: 'Бронь',
    className: 'bg-yellow-500/12 text-yellow-300 ring-1 ring-yellow-500/20',
  },
  service: {
    label: 'В сервисе',
    className: 'bg-orange-500/12 text-orange-300 ring-1 ring-orange-500/20',
  },
  written_off: {
    label: 'Списана',
    className: 'bg-slate-500/12 text-slate-300 ring-1 ring-slate-500/20',
  },
  for_sale: {
    label: 'На продажу',
    className: 'bg-violet-500/12 text-violet-300 ring-1 ring-violet-500/20',
  },
  sold: {
    label: 'Проданная',
    className: 'bg-slate-700/35 text-slate-200 ring-1 ring-slate-500/30',
  },
};

export const EQUIPMENT_EMPTY_STATE_COPY = {
  loading: {
    title: 'Загружаем технику',
    description: 'Получаем реестр парка и связанные статусы.',
  },
  emptyRegistry: {
    title: 'Техника ещё не добавлена',
    description: 'После добавления техника появится в общем реестре парка.',
  },
  forSaleEmpty: {
    title: 'Техника на продажу пока не выставлена',
    description: 'Продажная техника останется в общем реестре и будет доступна менеджерам продаж.',
  },
  soldEmpty: {
    title: 'Проданных единиц пока нет',
    description: 'Когда продажа будет закрыта, техника останется здесь для истории и документов.',
  },
  noResults: {
    title: 'По выбранным фильтрам ничего не найдено',
    description: 'Попробуйте изменить поиск, статус, тип, собственника или локацию.',
  },
};

export const EQUIPMENT_QUICK_VIEW_EMPTY_COPY = {
  noDocumentsAccess: 'У вашей роли нет доступа к документам техники.',
  noDocuments: 'Связанные документы не найдены.',
  noPhotosAccess: 'Фото приёмки, возврата и дефектов недоступны для вашей роли.',
  noPhotos: 'Фото по выбранной технике не найдены.',
  noHistory: 'История по выбранной технике пока пустая.',
};
