import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { ApiError, api, setToken, clearToken, getToken } from '../lib/api';
import { tokenMarker, traceAuth } from '../lib/authDebug';

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
const AUTH_USER_KEY = 'app_auth_user';

function readStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTH_USER_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw) as Partial<AuthUser>;
    if (!user || typeof user.id !== 'string' || typeof user.name !== 'string' || typeof user.role !== 'string') {
      return null;
    }
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      rawRole: user.rawRole,
      normalizedRole: user.normalizedRole,
      permissions: user.permissions,
      email: typeof user.email === 'string' ? user.email : '',
      profilePhoto: user.profilePhoto,
      ownerId: user.ownerId,
      ownerName: user.ownerName,
    };
  } catch {
    return null;
  }
}

function writeStoredUser(user: AuthUser): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    traceAuth('user saved', {
      hasUser: true,
      role: user.role,
      rawRole: user.rawRole,
      normalizedRole: user.normalizedRole,
      hasPermissions: Boolean(user.permissions),
    });
  } catch {
    // Session can continue in memory even if persistent storage is unavailable.
  }
}

function clearStoredUser(): void {
  if (typeof window === 'undefined') return;
  traceAuth('stored user cleared', {}, { stack: true });
  try {
    window.localStorage.removeItem(AUTH_USER_KEY);
  } catch {
    // ignore storage errors
  }
}

function sessionUserToAuthUser(session: {
  userId: string;
  userName: string;
  userRole: string;
  rawRole?: string;
  normalizedRole?: string;
  permissions?: unknown;
  email: string;
  profilePhoto?: string;
  ownerId?: string;
  ownerName?: string;
}): AuthUser {
  return {
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
}

// ── Провайдер ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    const storedToken = getToken();
    const storedUser = storedToken ? readStoredUser() : null;
    traceAuth('app boot', {
      token: tokenMarker(storedToken),
      hasStoredUser: Boolean(storedUser),
    });
    traceAuth('AuthProvider initial state', {
      isAuthenticated: Boolean(storedToken && storedUser),
      isLoading: Boolean(storedToken),
      hasUser: Boolean(storedUser),
      role: storedUser?.role,
      rawRole: storedUser?.rawRole,
      normalizedRole: storedUser?.normalizedRole,
    });
    return {
      user: storedUser,
      isAuthenticated: Boolean(storedToken && storedUser),
      isLoading: Boolean(storedToken),
    };
  });

  const refreshUser = useCallback(async () => {
    traceAuth('/api/auth/me request start', {
      reason: 'refreshUser',
      token: tokenMarker(getToken()),
      hasAuthorization: Boolean(getToken()),
    });
    const result = await api.get<{ ok: boolean; user: { userId: string; userName: string; userRole: string; rawRole?: string; normalizedRole?: string; permissions?: unknown; email: string; profilePhoto?: string; ownerId?: string; ownerName?: string } }>('/api/auth/me');
    const user = sessionUserToAuthUser(result.user);
    traceAuth('restore success', {
      role: user.role,
      rawRole: user.rawRole,
      normalizedRole: user.normalizedRole,
      hasPermissions: Boolean(user.permissions),
      token: tokenMarker(getToken()),
    });
    writeStoredUser(user);
    setState({ user, isAuthenticated: true, isLoading: false });
  }, []);

  useEffect(() => {
    traceAuth('AuthProvider mount', {
      token: tokenMarker(getToken()),
      isAuthenticated: state.isAuthenticated,
      isLoading: state.isLoading,
      hasUser: Boolean(state.user),
    });
    return () => {
      traceAuth('AuthProvider unmount', {
        token: tokenMarker(getToken()),
      }, { stack: true });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore a persisted bearer session and verify it with the backend. Only a
  // confirmed 401 clears the session; transient /me failures keep the last
  // known user so the app doesn't throw a valid session back to Login.
  useEffect(() => {
    const restoreToken = getToken();
    traceAuth('restore start', {
      token: tokenMarker(restoreToken),
      hasStoredUser: Boolean(readStoredUser()),
    });
    if (!restoreToken) {
      clearStoredUser();
      traceAuth('setIsAuthenticated false', {
        reason: 'restore no token',
      }, { stack: true });
      setState({ user: null, isAuthenticated: false, isLoading: false });
      return;
    }

    let disposed = false;
    refreshUser().catch((error) => {
      if (disposed) return;
      traceAuth('restore failure', {
        status: error instanceof ApiError ? error.status : 'network-or-runtime',
        message: error instanceof Error ? error.message : String(error),
        restoreToken: tokenMarker(restoreToken),
        currentToken: tokenMarker(getToken()),
      }, { stack: true });
      if (getToken() !== restoreToken) {
        traceAuth('restore failure ignored because token changed', {
          restoreToken: tokenMarker(restoreToken),
          currentToken: tokenMarker(getToken()),
        });
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        clearStoredUser();
        traceAuth('setIsAuthenticated false', {
          reason: 'restore 401',
          token: tokenMarker(restoreToken),
        }, { stack: true });
        setState({ user: null, isAuthenticated: false, isLoading: false });
        return;
      }
      const fallbackUser = readStoredUser();
      traceAuth('restore fallback after non-401 failure', {
        hasFallbackUser: Boolean(fallbackUser),
        status: error instanceof ApiError ? error.status : 'network-or-runtime',
      });
      setState({
        user: fallbackUser,
        isAuthenticated: Boolean(fallbackUser),
        isLoading: false,
      });
    });

    return () => {
      disposed = true;
    };
  }, [refreshUser]);

  // Слушаем событие из api.ts: auth endpoint или silent session check подтвердил,
  // что сессия истекла. Ошибки обычных разделов остаются локальными.
  useEffect(() => {
    function handleUnauthorized() {
      traceAuth('auth:unauthorized event handled', {
        token: tokenMarker(getToken()),
      }, { stack: true });
      clearStoredUser();
      traceAuth('setIsAuthenticated false', {
        reason: 'auth:unauthorized event',
      }, { stack: true });
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
    traceAuth('login submit', {
      loginProvided: Boolean(loginValue),
      tokenBefore: tokenMarker(getToken()),
    });
    const result = await api.post<{ ok: boolean; token: string; user: { id: string; name: string; role: string; rawRole?: string; normalizedRole?: string; permissions?: unknown; email: string; profilePhoto?: string; ownerId?: string; ownerName?: string } }>(
      '/api/auth/login',
      { login: loginValue, password }
    );

    setToken(result.token);
    traceAuth('login success', {
      responseHasToken: Boolean(result.token),
      token: tokenMarker(result.token),
      responseHasUser: Boolean(result.user),
      role: result.user?.role,
      rawRole: result.user?.rawRole,
      normalizedRole: result.user?.normalizedRole,
    });

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
    writeStoredUser(user);
    setState({ user, isAuthenticated: true, isLoading: false });
  }, []);

  const logout = useCallback(() => {
    const token = getToken();
    traceAuth('logout called', {
      token: tokenMarker(token),
    }, { stack: true });
    // Fire-and-forget — don't block UI
    if (token) {
      api.post('/api/auth/logout', {}).catch(() => {});
    }
    clearToken();
    clearStoredUser();
    traceAuth('setIsAuthenticated false', {
      reason: 'logout called',
    }, { stack: true });
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
