import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api, setToken, clearToken, getToken } from '../lib/api';

export interface AuthUser {
  id: string;
  name: string;
  role: string;
  rawRole?: string;
  normalizedRole?: string;
  permissions?: unknown;
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
  login: (login: string, password: string) => Promise<void>;
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
    const result = await api.get<{ ok: boolean; user: { userId: string; userName: string; userRole: string; rawRole?: string; normalizedRole?: string; permissions?: unknown; email: string; profilePhoto?: string; ownerId?: string; ownerName?: string } }>('/api/auth/me');
    const session = result.user;
    const user: AuthUser = {
      id: session.userId,
      name: session.userName,
      role: session.userRole,
      rawRole: session.rawRole,
      normalizedRole: session.normalizedRole,
      permissions: session.permissions,
      email: session.email,
      profilePhoto: session.profilePhoto,
      ownerId: session.ownerId,
      ownerName: session.ownerName,
    };
    setState({ user, isAuthenticated: true, isLoading: false });
  }, []);

  // Bearer token is memory-only. On reload we intentionally drop the session
  // until backend refresh cookies are introduced.
  useEffect(() => {
    clearToken();
    setState({ user: null, isAuthenticated: false, isLoading: false });
  }, [refreshUser]);

  // Слушаем событие из api.ts: auth endpoint или silent session check подтвердил,
  // что сессия истекла. Ошибки обычных разделов остаются локальными.
  useEffect(() => {
    function handleUnauthorized() {
      setState({ user: null, isAuthenticated: false, isLoading: false });
    }
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  useEffect(() => {
    if (!state.isAuthenticated) return undefined;

    let disposed = false;

    const verifySession = () => {
      if (disposed || document.visibilityState === 'hidden') return;
      refreshUser().catch(() => {});
    };

    const intervalId = window.setInterval(verifySession, 15000);
    window.addEventListener('focus', verifySession);
    document.addEventListener('visibilitychange', verifySession);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', verifySession);
      document.removeEventListener('visibilitychange', verifySession);
    };
  }, [refreshUser, state.isAuthenticated]);

  const login = useCallback(async (loginValue: string, password: string) => {
    const result = await api.post<{ ok: boolean; token: string; user: { id: string; name: string; role: string; rawRole?: string; normalizedRole?: string; permissions?: unknown; email: string; profilePhoto?: string; ownerId?: string; ownerName?: string } }>(
      '/api/auth/login',
      { login: loginValue, password }
    );

    setToken(result.token);

    const user: AuthUser = {
      id:    result.user.id,
      name:  result.user.name,
      role:  result.user.role,
      rawRole: result.user.rawRole,
      normalizedRole: result.user.normalizedRole,
      permissions: result.user.permissions,
      email: result.user.email,
      profilePhoto: result.user.profilePhoto,
      ownerId: result.user.ownerId,
      ownerName: result.user.ownerName,
    };
    setState({ user, isAuthenticated: true, isLoading: false });
  }, []);

  const logout = useCallback(() => {
    const token = getToken();
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
