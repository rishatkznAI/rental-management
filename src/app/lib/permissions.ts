/**
 * Ролевая модель доступа (RBAC)
 *
 * Роли:
 *  Администратор    — полный доступ ко всему
 *  Менеджер по аренде — личный дашборд (только свои данные), просмотр основных
 *                      разделов, создание сервисных заявок; без Отчётов и Настроек
 *  Офис-менеджер   — полный операционный доступ + свой дашборд (без Отчётов и Настроек)
 *  Механик          — только Техника (просмотр) + Сервис (полный CRUD)
 *  Механик по гарантии — Сервис/Рекламации + просмотр Техники и Продаж
 *  Инвестор         — только своя техника и связанные аренды
 *  Перевозчик       — только свои активные доставки, если backend явно разрешил frontend-вход
 */

import { useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { MECHANIC_ROLES, WARRANTY_MECHANIC_ROLE, normalizeUserRole } from './userStorage';

// ── Типы ─────────────────────────────────────────────────────────────────────

export type Section =
  | 'dashboard'
  | 'tasks_center'
  | 'equipment'
  | 'gsm'
  | 'knowledge_base'
  | 'sales'
  | 'crm'
  | 'deliveries'
  | 'rentals'
  | 'planner'
  | 'service'
  | 'service_vehicles'
  | 'clients'
  | 'documents'
  | 'payments'
  | 'finance'
  | 'approvals'
  | 'bots'
  | 'reports'
  | 'profile_settings'
  | 'admin_panel';

export type Action = 'view' | 'create' | 'edit' | 'delete';
export type AppPermission = 'service_day_plan_view' | 'service_day_plan_manage';

type RolePermissions = Partial<Record<Section, Action[]>>;

// ── Матрица прав ──────────────────────────────────────────────────────────────

const ALL: Action[] = ['view', 'create', 'edit', 'delete'];
const VIEW: Action[] = ['view'];
const VIEW_CREATE: Action[] = ['view', 'create'];
const VIEW_CREATE_EDIT: Action[] = ['view', 'create', 'edit'];
export const SERVICE_FOREMAN_ROLE = 'Бригадир';

const PERMISSIONS: Record<string, RolePermissions> = {
  'Администратор': {
    dashboard:        ALL,
    tasks_center:     VIEW,
    equipment:        ALL,
    gsm:              ALL,
    knowledge_base:   ALL,
    sales:            ALL,
    crm:              ALL,
    deliveries:       ALL,
    rentals:          ALL,
    planner:          ALL,
    service:          ALL,
    service_vehicles: ALL,
    clients:          ALL,
    documents:        ALL,
    payments:         ALL,
    finance:          ALL,
    approvals:        ALL,
    bots:             VIEW,
    reports:          ALL,
    profile_settings: ['view', 'edit'],
    admin_panel:      ALL,
  },
  'Инвестор': {
    equipment: VIEW,
    rentals: VIEW,
    profile_settings: ['view', 'edit'],
  },
  'Менеджер по аренде': {
    dashboard:        VIEW,        // только своё
    tasks_center:     VIEW,
    equipment:        VIEW,
    gsm:              VIEW,
    knowledge_base:   ['view', 'create', 'edit'],
    sales:            VIEW,
    crm:              ['view', 'create', 'edit'],
    deliveries:       ['view', 'create', 'edit'],
    rentals:          ['view', 'edit'],
    planner:          VIEW,
    service:          VIEW_CREATE,
    service_vehicles: VIEW,        // видит машины, но не редактирует
    clients:          VIEW_CREATE,
    documents:        VIEW_CREATE,
    payments:         VIEW,
    approvals:        VIEW,
    profile_settings: ['view', 'edit'],
  },
  'Офис-менеджер': {
    dashboard:        VIEW,
    tasks_center:     VIEW,
    equipment:        ALL,
    gsm:              ALL,
    knowledge_base:   ['view', 'create', 'edit'],
    sales:            VIEW,
    crm:              ALL,
    deliveries:       ALL,
    rentals:          ['view', 'create', 'edit'],
    planner:          ALL,
    service:          ALL,
    service_vehicles: ALL,
    clients:          ALL,
    documents:        ALL,
    payments:         ALL,
    finance:          VIEW_CREATE_EDIT,
    approvals:        VIEW,
    profile_settings: ['view', 'edit'],
  },
  'Менеджер по продажам': {
    dashboard:        VIEW,
    tasks_center:     VIEW,
    equipment:        VIEW,
    gsm:              VIEW,
    knowledge_base:   ['view', 'create', 'edit'],
    sales:            ALL,
    crm:              ['view', 'create', 'edit'],
    clients:          VIEW_CREATE,
    documents:        VIEW,
    payments:         VIEW,
    profile_settings: ['view', 'edit'],
  },
  'Перевозчик': {
    deliveries:       VIEW,
    profile_settings: ['view', 'edit'],
  },
  [WARRANTY_MECHANIC_ROLE]: {
    tasks_center:     VIEW,
    equipment:        VIEW,
    sales:            VIEW,
    rentals:          VIEW,
    service:          VIEW_CREATE_EDIT,
  },
  [SERVICE_FOREMAN_ROLE]: {
    tasks_center:     VIEW,
    equipment:        VIEW,
    gsm:              VIEW,
    planner:          VIEW,
    service:          VIEW_CREATE_EDIT,
    service_vehicles: VIEW,
    profile_settings: ['view', 'edit'],
  },
  ...Object.fromEntries(
    MECHANIC_ROLES.map(role => [role, {
      // dashboard: нет
      tasks_center:     VIEW,
      equipment:        VIEW,
      gsm:              VIEW,
      planner:          ALL,
      service:          ALL,
      service_vehicles: ALL,         // механик ведёт журнал поездок
      profile_settings: ['view', 'edit'],
    }]),
  ),
};

const APP_PERMISSIONS: Record<AppPermission, string[]> = {
  service_day_plan_view: [
    'Администратор',
    'Офис-менеджер',
    SERVICE_FOREMAN_ROLE,
    WARRANTY_MECHANIC_ROLE,
    ...MECHANIC_ROLES,
  ],
  service_day_plan_manage: [
    'Администратор',
    'Офис-менеджер',
    SERVICE_FOREMAN_ROLE,
    'Старший стационарный механик',
  ],
};

export function hasAppPermission(role: string | null | undefined, permission: AppPermission): boolean {
  const normalizedRole = normalizeUserRole(role);
  return APP_PERMISSIONS[permission]?.includes(normalizedRole) ?? false;
}

export function canViewServiceDayPlan(role: string | null | undefined): boolean {
  return hasAppPermission(role, 'service_day_plan_view');
}

export function canManageServiceDayPlan(role: string | null | undefined): boolean {
  return hasAppPermission(role, 'service_day_plan_manage');
}

// ── Маппинг URL → Section ─────────────────────────────────────────────────────

/**
 * Возвращает требуемое действие для «create»-маршрутов.
 * Используется в охране маршрутов для блокировки по действию (не только по разделу).
 */
export function pathToRequiredAction(pathname: string): { section: Section; action: Action } | null {
  if (pathname === '/equipment/new') return { section: 'equipment', action: 'create' };
  if (pathname === '/deliveries/new') return { section: 'deliveries', action: 'create' };
  if (pathname === '/rentals/new')   return { section: 'rentals',   action: 'create' };
  if (pathname === '/clients/new')   return { section: 'clients',   action: 'create' };
  if (pathname === '/service/new')   return { section: 'service',   action: 'create' };
  return null;
}

export function pathToSection(pathname: string): Section | null {
  if (pathname === '/')                       return 'dashboard';
  if (pathname.startsWith('/tasks'))          return 'tasks_center';
  if (pathname.startsWith('/equipment'))      return 'equipment';
  if (pathname.startsWith('/gsm'))            return 'gsm';
  if (pathname.startsWith('/knowledge-base')) return 'knowledge_base';
  if (pathname.startsWith('/sales'))          return 'sales';
  if (pathname.startsWith('/deliveries'))     return 'deliveries';
  if (pathname.startsWith('/rentals'))        return 'rentals';
  if (pathname.startsWith('/planner'))        return 'planner';
  if (pathname.startsWith('/service-vehicles')) return 'service_vehicles';
  if (pathname.startsWith('/service'))        return 'service';
  if (pathname.startsWith('/clients'))        return 'clients';
  if (pathname.startsWith('/documents'))      return 'documents';
  if (pathname.startsWith('/payments'))       return 'payments';
  if (pathname.startsWith('/finance'))        return 'finance';
  if (pathname.startsWith('/approvals'))      return 'approvals';
  if (pathname.startsWith('/bots'))           return 'bots';
  if (pathname.startsWith('/reports'))        return 'reports';
  if (pathname.startsWith('/settings'))       return 'profile_settings';
  if (pathname.startsWith('/admin'))          return 'admin_panel';
  return null;
}

// ── Первый доступный раздел для редиректа ─────────────────────────────────────

const SECTION_PATHS: Array<[Section, string]> = [
  ['dashboard',  '/'],
  ['tasks_center', '/tasks'],
  ['equipment',  '/equipment'],
  ['gsm',        '/gsm'],
  ['knowledge_base', '/knowledge-base'],
  ['sales',      '/sales'],
  ['deliveries', '/deliveries'],
  ['rentals',    '/rentals'],
  ['planner',          '/planner'],
  ['service',          '/service'],
  ['service_vehicles', '/service-vehicles'],
  ['clients',    '/clients'],
  ['documents',  '/documents'],
  ['payments',   '/payments'],
  ['finance',    '/finance'],
  ['approvals',  '/approvals'],
  ['bots',       '/bots'],
  ['reports',    '/reports'],
  ['profile_settings', '/settings'],
  ['admin_panel', '/admin'],
];

// ── Хук ──────────────────────────────────────────────────────────────────────

export function usePermissions() {
  const { user } = useAuth();
  const role = normalizeUserRole(user?.role);
  const perms: RolePermissions = useMemo(() => PERMISSIONS[role] ?? {}, [role]);

  /** Проверяет, разрешено ли конкретное действие в разделе */
  const can = useCallback((action: Action, section: Section): boolean => {
    return perms[section]?.includes(action) ?? false;
  }, [perms]);

  /** Shorthand — может ли пользователь видеть раздел */
  const canView = useCallback((section: Section): boolean => {
    return can('view', section);
  }, [can]);

  /** Первый разрешённый URL для редиректа (если текущий запрещён) */
  const defaultPath = useCallback((): string => {
    for (const [section, path] of SECTION_PATHS) {
      if (canView(section)) return path;
    }
    return '/login';
  }, [canView]);

  return useMemo(() => ({ can, canView, defaultPath }), [can, canView, defaultPath]);
}
