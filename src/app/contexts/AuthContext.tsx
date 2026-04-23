import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api, setToken, clearToken, AUTH_TOKEN_KEY } from '../lib/api';

export interface AuthUser {
  id: string;
  name: string;
  role: string;
  email: string;
  profilePhoto?: string;
  ownerId?: string;
  ownerName?: string;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** true while the initial /api/auth/me check is running */
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Провайдер ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });

  const refreshUser = useCallback(async () => {
    const result = await api.get<{ ok: boolean; user: { userId: string; userName: string; userRole: string; email: string; profilePhoto?: string; ownerId?: string; ownerName?: string } }>('/api/auth/me');
    const session = result.user;
    const user: AuthUser = {
      id: session.userId,
      name: session.userName,
      role: session.userRole,
      email: session.email,
      profilePhoto: session.profilePhoto,
      ownerId: session.ownerId,
      ownerName: session.ownerName,
    };
    setState({ user, isAuthenticated: true, isLoading: false });
  }, []);

  // При монтировании проверяем, есть ли сохранённый токен, и если да — подтверждаем сессию
  useEffect(() => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) {
      setState({ user: null, isAuthenticated: false, isLoading: false });
      return;
    }

    refreshUser()
      .catch((err: unknown) => {
        // Удаляем токен ТОЛЬКО если сервер явно ответил 401 (сессия истекла / невалидна).
        // Сетевые ошибки, 502/503 и другие временные сбои (например, Railway redeploy)
        // НЕ должны уничтожать токен — при следующем открытии страницы сессия
        // восстановится автоматически, как только бэкенд снова поднимется.
        const status = (err as { status?: number })?.status;
        if (status === 401) {
          clearToken(); // api.ts уже вызвал clearToken(), но на всякий случай повторяем
        }
        setState({ user: null, isAuthenticated: false, isLoading: false });
      });
  }, [refreshUser]);

  // Слушаем событие из api.ts: любой запрос получил 401 в рантайме (не только bootstrap).
  // Это обеспечивает немедленный редирект на /login при истечении сессии в любом месте.
  useEffect(() => {
    function handleUnauthorized() {
      setState({ user: null, isAuthenticated: false, isLoading: false });
    }
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<{ ok: boolean; token: string; user: { id: string; name: string; role: string; email: string; profilePhoto?: string; ownerId?: string; ownerName?: string } }>(
      '/api/auth/login',
      { email, password }
    );

    setToken(result.token);

    const user: AuthUser = {
      id:    result.user.id,
      name:  result.user.name,
      role:  result.user.role,
      email: result.user.email,
      profilePhoto: result.user.profilePhoto,
      ownerId: result.user.ownerId,
      ownerName: result.user.ownerName,
    };
    setState({ user, isAuthenticated: true, isLoading: false });
  }, []);

  const logout = useCallback(() => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    // Fire-and-forget — don't block UI
    if (token) {
      api.post('/api/auth/logout', {}).catch(() => {});
    }
    clearToken();
    setState({ user: null, isAuthenticated: false, isLoading: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
