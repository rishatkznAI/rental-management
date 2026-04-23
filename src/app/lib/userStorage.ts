/**
 * userStorage — единственный модуль для хранения пользователей системы.
 *
 * Раньше этот код жил в pages/Settings.tsx — плохая связанность:
 * AuthContext, GanttModals, Rentals, ClientNew все импортировали из UI-страницы.
 * Теперь Settings.tsx сам является потребителем этого модуля.
 *
 * ──────────────────────────────────────────────────────────────────
 *  ⚠️  DEMO / MVP AUTH  ⚠️
 *  Это клиентская аутентификация на localStorage — не production.
 *  Пароли хешируются (SHA-256 + соль) в localStorage, но хеш доступен
 *  любому, кто откроет DevTools. Без полноценного backend-auth и
 *  HTTP-only cookies это MVP-решение. Не деплоить в production без
 *  замены на реальный auth-сервер.
 * ──────────────────────────────────────────────────────────────────
 */

import { api } from './api';

// ── Типы ─────────────────────────────────────────────────────────────────────

export type UserRole =
  | 'Администратор'
  | 'Инвестор'
  | 'Менеджер по аренде'
  | 'Менеджер по продажам'
  | 'Механик'
  | 'Младший стационарный механик'
  | 'Выездной механик'
  | 'Старший стационарный механик'
  | 'Офис-менеджер';
export type UserStatus = 'Активен' | 'Неактивен';

export interface SystemUser {
  id:       string;
  name:     string;
  email:    string;
  role:     UserRole;
  status:   UserStatus;
  ownerId?: string;
  ownerName?: string;
  /**
   * Пароль хранится как 'h1:<sha256-hex>' после первой миграции.
   * Устаревший plain-text автоматически мигрируется при входе.
   */
  password: string;
}

export const MECHANIC_ROLES: UserRole[] = [
  'Механик',
  'Младший стационарный механик',
  'Выездной механик',
  'Старший стационарный механик',
];

export const ROLES: UserRole[] = [
  'Администратор',
  'Инвестор',
  'Менеджер по аренде',
  'Менеджер по продажам',
  ...MECHANIC_ROLES,
  'Офис-менеджер',
];

export const RENTAL_MANAGER_ROLES: UserRole[] = [
  'Менеджер по аренде',
  'Офис-менеджер',
];

type UserWithManagerRole = {
  role?: UserRole | string;
  status?: UserStatus | string;
};

type UserWithInvestorRole = UserWithManagerRole & {
  ownerId?: string;
  ownerName?: string;
  name?: string;
};

export function isRentalManagerUser(user: UserWithManagerRole | null | undefined): boolean {
  if (!user) return false;
  return user.status === 'Активен'
    && (user.role === 'Менеджер по аренде' || user.role === 'Офис-менеджер');
}

export function filterRentalManagerUsers<T extends UserWithManagerRole>(users: T[]): T[] {
  return users.filter(isRentalManagerUser);
}

export function isMechanicRole(role: UserRole | string | null | undefined): boolean {
  return MECHANIC_ROLES.some(item => item === role);
}

export function isInvestorUser(user: UserWithInvestorRole | null | undefined): boolean {
  return Boolean(user && user.status === 'Активен' && user.role === 'Инвестор');
}

export function getInvestorBinding(user: UserWithInvestorRole | null | undefined) {
  if (!isInvestorUser(user)) return null;
  return {
    ownerId: user?.ownerId?.trim() || '',
    ownerName: user?.ownerName?.trim() || user?.name?.trim() || '',
  };
}

// ── Ключ хранилища ────────────────────────────────────────────────────────────

export const USERS_STORAGE_KEY = 'app_system_users';

// ── Хеширование паролей (Web Crypto API, браузерный SHA-256 + соль) ───────────
//
// Цель: не хранить пароли в plain-text в localStorage и источниках.
// Ограничение: хеш доступен через DevTools — это MVP без backend.

const HASH_PREFIX = 'h1:';
const HASH_SALT   = 'rental-mgmt-v1';

/** Возвращает 'h1:<sha256-hex>' */
export async function hashPassword(plain: string): Promise<string> {
  const data   = new TextEncoder().encode(plain + ':' + HASH_SALT);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  const hex    = Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return HASH_PREFIX + hex;
}

/** Проверяет, что пароль уже захеширован */
export function isHashed(pwd: string): boolean {
  return pwd.startsWith(HASH_PREFIX);
}

/**
 * Сравнивает plain-text пароль с хранимым значением.
 * Поддерживает legacy plain-text (для автоматической миграции).
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (isHashed(stored)) {
    return (await hashPassword(plain)) === stored;
  }
  // Legacy plain-text — будет смигрировано после успешного входа
  return plain === stored;
}

// ── Демо-пользователи по умолчанию ───────────────────────────────────────────
//
// Используются ТОЛЬКО если в localStorage нет сохранённых пользователей.
// Пароли здесь в plain-text чтобы быть захешированными при первой загрузке
// через migratePasswordsToHash(). После миграции в localStorage будут только хеши.

function getDefaultUsers(): SystemUser[] {
  return [
    {
      id: '0', name: 'Администратор',
      email: 'hrrkzn@yandex.ru',
      role: 'Администратор', status: 'Активен',
      password: 'kazan2013',
    },
    {
      id: '5', name: 'mp2',
      email: 'mp2@mantall.ru',
      role: 'Менеджер по аренде', status: 'Активен',
      password: '1234',
    },
    {
      id: '1', name: 'Смирнова Анна Петровна',
      email: 'smirnova@company.ru',
      role: 'Менеджер по аренде', status: 'Активен',
      password: '1234',
    },
    {
      id: '2', name: 'Козлов Дмитрий Владимирович',
      email: 'kozlov@company.ru',
      role: 'Менеджер по аренде', status: 'Активен',
      password: '1234',
    },
    {
      id: '3', name: 'Петров Иван Сергеевич',
      email: 'petrov@company.ru',
      role: 'Механик', status: 'Активен',
      password: '1234',
    },
  ];
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function loadUsers(): SystemUser[] {
  try {
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as SystemUser[];
  } catch { /* ignore */ }
  return getDefaultUsers();
}

export function saveUsers(users: SystemUser[]): void {
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
  // Fire-and-forget sync to server (users collection)
  api.put('/api/users', users).catch(() => {});
}

/**
 * Хеширует все plain-text пароли в хранилище.
 * Идемпотентна — уже захешированные пароли пропускаются.
 * Вызывается при старте приложения один раз.
 */
export async function migratePasswordsToHash(): Promise<void> {
  const users = loadUsers();
  let changed = false;
  const migrated = await Promise.all(
    users.map(async u => {
      if (isHashed(u.password)) return u;
      changed = true;
      return { ...u, password: await hashPassword(u.password) };
    }),
  );
  if (changed) saveUsers(migrated);
}
