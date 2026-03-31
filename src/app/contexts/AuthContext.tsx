import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { loadUsers, USERS_STORAGE_KEY } from '../pages/Settings';

export interface AuthUser {
  id: string;
  name: string;
  role: string;
  email: string;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_KEY = 'app_auth_user';

// ── Валидация против списка пользователей в localStorage ──────────────────────

async function authenticateUser(email: string, password: string): Promise<AuthUser> {
  // Небольшая задержка для UX (имитация сетевого запроса)
  await new Promise(resolve => setTimeout(resolve, 300));

  const users = loadUsers();

  const found = users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());

  if (!found) {
    throw new Error('Пользователь с таким email не найден');
  }

  if (found.status === 'Неактивен') {
    throw new Error('Ваш аккаунт деактивирован. Обратитесь к администратору.');
  }

  if (found.password !== password) {
    throw new Error('Неверный пароль');
  }

  return {
    id:    found.id,
    name:  found.name,
    role:  found.role,
    email: found.email,
  };
}

// ── Провайдер ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        // Проверяем что сохранённый пользователь всё ещё существует и активен
        const user: AuthUser = JSON.parse(raw);
        const users = loadUsers();
        const stillValid = users.find(u => u.id === user.id && u.status === 'Активен');
        if (stillValid) return { user, isAuthenticated: true };
      }
    } catch { /* ignore */ }
    return { user: null, isAuthenticated: false };
  });

  // Синхронизация сессии с localStorage
  useEffect(() => {
    if (state.user) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(state.user));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  }, [state.user]);

  // Если администратор деактивировал пользователя — выкидываем из сессии
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== USERS_STORAGE_KEY || !state.user) return;
      const users = loadUsers();
      const stillValid = users.find(u => u.id === state.user!.id && u.status === 'Активен');
      if (!stillValid) setState({ user: null, isAuthenticated: false });
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [state.user]);

  const login = useCallback(async (email: string, password: string) => {
    const user = await authenticateUser(email, password);
    setState({ user, isAuthenticated: true });
  }, []);

  const logout = useCallback(() => {
    setState({ user: null, isAuthenticated: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
