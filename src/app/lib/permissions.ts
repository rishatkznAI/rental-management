/**
 * Ролевая модель доступа (RBAC)
 *
 * Роли:
 *  Администратор    — полный доступ ко всему
 *  Менеджер по аренде — личный дашборд (только свои данные), просмотр основных
 *                      разделов, создание сервисных заявок; без Отчётов и Настроек
 *  Офис-менеджер   — полный операционный доступ (без Дашборда, Отчётов, Настроек)
 *  Механик          — только Техника (просмотр) + Сервис (полный CRUD)
 */

import { useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';

// ── Типы ─────────────────────────────────────────────────────────────────────

export type Section =
  | 'dashboard'
  | 'equipment'
  | 'sales'
  | 'rentals'
  | 'planner'
  | 'service'
  | 'service_vehicles'
  | 'clients'
  | 'documents'
  | 'payments'
  | 'reports'
  | 'settings';

export type Action = 'view' | 'create' | 'edit' | 'delete';

type RolePermissions = Partial<Record<Section, Action[]>>;

// ── Матрица прав ──────────────────────────────────────────────────────────────

const ALL: Action[] = ['view', 'create', 'edit', 'delete'];
const VIEW: Action[] = ['view'];
const VIEW_CREATE: Action[] = ['view', 'create'];

const PERMISSIONS: Record<string, RolePermissions> = {
  'Администратор': {
    dashboard:        ALL,
    equipment:        ALL,
    sales:            ALL,
    rentals:          ALL,
    planner:          ALL,
    service:          ALL,
    service_vehicles: ALL,
    clients:          ALL,
    documents:        ALL,
    payments:         ALL,
    reports:          ALL,
    settings:         ALL,
  },
  'Менеджер по аренде': {
    dashboard:        VIEW,        // только своё
    equipment:        VIEW,
    sales:            VIEW,
    rentals:          VIEW,
    planner:          VIEW,
    service:          VIEW_CREATE,
    service_vehicles: VIEW,        // видит машины, но не редактирует
    clients:          VIEW,
    documents:        VIEW,
    payments:         VIEW,
    // reports:  нет
    // settings: нет
  },
  'Офис-менеджер': {
    // dashboard: нет
    equipment:        ALL,
    sales:            VIEW,
    rentals:          VIEW_CREATE,
    planner:          ALL,
    service:          ALL,
    service_vehicles: ALL,
    clients:          ALL,
    documents:        ALL,
    payments:         ALL,
    // reports:  нет
    // settings: нет
  },
  'Механик': {
    // dashboard: нет
    equipment:        VIEW,
    planner:          ALL,
    service:          ALL,
    service_vehicles: ALL,         // механик ведёт журнал поездок
    // остальное: нет
  },
};

// ── Маппинг URL → Section ─────────────────────────────────────────────────────

/**
 * Возвращает требуемое действие для «create»-маршрутов.
 * Используется в охране маршрутов для блокировки по действию (не только по разделу).
 */
export function pathToRequiredAction(pathname: string): { section: Section; action: Action } | null {
  if (pathname === '/equipment/new') return { section: 'equipment', action: 'create' };
  if (pathname === '/rentals/new')   return { section: 'rentals',   action: 'create' };
  if (pathname === '/clients/new')   return { section: 'clients',   action: 'create' };
  if (pathname === '/service/new')   return { section: 'service',   action: 'create' };
  return null;
}

export function pathToSection(pathname: string): Section | null {
  if (pathname === '/')                       return 'dashboard';
  if (pathname.startsWith('/equipment'))      return 'equipment';
  if (pathname.startsWith('/sales'))          return 'sales';
  if (pathname.startsWith('/rentals'))        return 'rentals';
  if (pathname.startsWith('/planner'))        return 'planner';
  if (pathname.startsWith('/service-vehicles')) return 'service_vehicles';
  if (pathname.startsWith('/service'))        return 'service';
  if (pathname.startsWith('/clients'))        return 'clients';
  if (pathname.startsWith('/documents'))      return 'documents';
  if (pathname.startsWith('/payments'))       return 'payments';
  if (pathname.startsWith('/reports'))        return 'reports';
  if (pathname.startsWith('/settings'))       return 'settings';
  return null;
}

// ── Первый доступный раздел для редиректа ─────────────────────────────────────

const SECTION_PATHS: Array<[Section, string]> = [
  ['dashboard',  '/'],
  ['equipment',  '/equipment'],
  ['sales',      '/sales'],
  ['rentals',    '/rentals'],
  ['planner',          '/planner'],
  ['service',          '/service'],
  ['service_vehicles', '/service-vehicles'],
  ['clients',    '/clients'],
  ['documents',  '/documents'],
  ['payments',   '/payments'],
  ['reports',    '/reports'],
  ['settings',   '/settings'],
];

// ── Хук ──────────────────────────────────────────────────────────────────────

export function usePermissions() {
  const { user } = useAuth();
  const role = user?.role ?? '';
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
