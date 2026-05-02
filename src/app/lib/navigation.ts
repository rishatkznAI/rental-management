import type { Section } from './permissions';

export type SidebarNavGroupId = 'main' | 'operations' | 'data' | 'other' | 'profile';

export interface SidebarNavGroup {
  id: SidebarNavGroupId;
  title: string;
  items: Section[];
}

export const SIDEBAR_NAV_GROUP_SETTING_KEY = 'sidebar_navigation_groups';

export const SIDEBAR_NAV_GROUPS: SidebarNavGroup[] = [
  { id: 'main', title: 'Главное', items: ['dashboard', 'tasks_center', 'equipment', 'gsm', 'knowledge_base', 'sales', 'deliveries', 'rentals'] },
  { id: 'operations', title: 'Операции', items: ['planner', 'service', 'service_vehicles'] },
  { id: 'data', title: 'Данные', items: ['clients', 'documents', 'payments', 'finance', 'approvals'] },
  { id: 'other', title: 'Прочее', items: ['bots', 'reports', 'admin_panel'] },
  { id: 'profile', title: 'Профиль', items: ['profile_settings'] },
];

export const DEFAULT_SIDEBAR_ORDER: Section[] = SIDEBAR_NAV_GROUPS.flatMap(group => group.items);

export const DEFAULT_SIDEBAR_GROUPS = SIDEBAR_NAV_GROUPS.reduce((acc, group) => {
  group.items.forEach(section => {
    acc[section] = group.id;
  });
  return acc;
}, {} as Record<Section, SidebarNavGroupId>);

const SIDEBAR_SECTION_SET = new Set(DEFAULT_SIDEBAR_ORDER);
const SIDEBAR_GROUP_SET = new Set(SIDEBAR_NAV_GROUPS.map(group => group.id));

export function normalizeSidebarOrder(value: unknown): Section[] {
  const storedOrder = Array.isArray(value)
    ? value.filter((item): item is Section => typeof item === 'string' && SIDEBAR_SECTION_SET.has(item as Section))
    : [];
  return [
    ...storedOrder,
    ...DEFAULT_SIDEBAR_ORDER.filter(section => !storedOrder.includes(section)),
  ];
}

export function normalizeSidebarGroups(value: unknown): Record<Section, SidebarNavGroupId> {
  const next = { ...DEFAULT_SIDEBAR_GROUPS };
  const entries = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value as Record<string, unknown>)
    : [];

  entries.forEach(([section, groupId]) => {
    if (!SIDEBAR_SECTION_SET.has(section as Section)) return;
    if (!SIDEBAR_GROUP_SET.has(groupId as SidebarNavGroupId)) return;
    next[section as Section] = groupId as SidebarNavGroupId;
  });

  return next;
}

export const SIDEBAR_SECTION_LABELS: Record<Section, string> = {
  dashboard: 'Дашборд',
  tasks_center: 'Центр задач',
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
  approvals: 'Согласования',
  bots: 'Бот',
  reports: 'Отчёты',
  profile_settings: 'Личные настройки',
  admin_panel: 'Панель администратора',
};
