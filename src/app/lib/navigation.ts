import type { Section } from './permissions';

export const SIDEBAR_NAV_GROUPS: Array<{ title: string; items: Section[] }> = [
  { title: 'Главное', items: ['dashboard', 'equipment', 'gsm', 'knowledge_base', 'sales', 'crm', 'deliveries', 'rentals'] },
  { title: 'Операции', items: ['planner', 'service', 'service_vehicles'] },
  { title: 'Данные', items: ['clients', 'documents', 'payments', 'finance'] },
  { title: 'Прочее', items: ['bots', 'reports', 'admin_panel'] },
  { title: 'Профиль', items: ['profile_settings'] },
];

export const DEFAULT_SIDEBAR_ORDER: Section[] = SIDEBAR_NAV_GROUPS.flatMap(group => group.items);

export const SIDEBAR_SECTION_LABELS: Record<Section, string> = {
  dashboard: 'Дашборд',
  equipment: 'Техника',
  gsm: 'GSM',
  knowledge_base: 'База знаний',
  sales: 'Продажи',
  crm: 'CRM',
  deliveries: 'Доставка',
  rentals: 'Аренды',
  planner: 'Планировщик',
  service: 'Сервис',
  service_vehicles: 'Сл. машины',
  clients: 'Клиенты',
  documents: 'Документы',
  payments: 'Платежи',
  finance: 'Финансы',
  bots: 'Бот',
  reports: 'Отчёты',
  profile_settings: 'Личные настройки',
  admin_panel: 'Панель администратора',
};
