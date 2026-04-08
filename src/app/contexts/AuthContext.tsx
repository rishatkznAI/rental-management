import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api, setToken, clearToken, AUTH_TOKEN_KEY } from '../lib/api';

export interface AuthUser {
  id: string;
  name: string;
  role: string;
  email: string;
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
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Провайдер ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });

  // При монтировании проверяем, есть ли сохранённый токен, и если да — подтверждаем сессию
  useEffect(() => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) {
      setState({ user: null, isAuthenticated: false, isLoading: false });
      return;
    }

    api.get<{ ok: boolean; user: { userId: string; userName: string; userRole: string; email: string } }>('/api/auth/me')
      .then(({ user: session }) => {
        const user: AuthUser = {
          id:    session.userId,
          name:  session.userName,
          role:  session.userRole,
          email: session.email,
        };
        setState({ user, isAuthenticated: true, isLoading: false });
      })
      .catch(() => {
        // Token invalid / expired
        clearToken();
        setState({ user: null, isAuthenticated: false, isLoading: false });
      });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<{ ok: boolean; token: string; user: { id: string; name: string; role: string; email: string } }>(
      '/api/auth/login',
      { email, password }
    );

    setToken(result.token);

    const user: AuthUser = {
      id:    result.user.id,
      name:  result.user.name,
      role:  result.user.role,
      email: result.user.email,
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
