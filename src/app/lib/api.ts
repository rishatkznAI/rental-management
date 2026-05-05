/**
 * API client — fetch wrapper for all server communication.
 *
 * Base URL resolution:
 *  - Production: VITE_API_URL env var must be set to the deployed backend URL
 *  - Development (vite dev server): empty string, vite proxy forwards /api → localhost:3000
 *
 * Auth:
 *  Bearer token is persisted under AUTH_TOKEN_KEY and mirrored in memory.
 *  AuthProvider verifies restored sessions through /api/auth/me.
 */

import { tokenMarker, traceAuth } from './authDebug';

export const AUTH_TOKEN_KEY = 'app_auth_token';

export const API_BASE_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');

function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    // Keep the in-memory token even if persistent storage is unavailable.
  }
}

function removeStoredToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // ignore storage errors
  }
}

let authToken: string | null = readStoredToken();
let unauthorizedSessionCheck: Promise<boolean> | null = null;

export function getToken(): string | null {
  return authToken;
}

export function setToken(token: string): void {
  authToken = token;
  writeStoredToken(token);
  traceAuth('token saved', {
    memoryToken: tokenMarker(authToken),
    storageToken: tokenMarker(readStoredToken()),
  });
}

export function clearToken(): void {
  traceAuth('clearToken called', {
    memoryToken: tokenMarker(authToken),
    storageToken: tokenMarker(readStoredToken()),
  }, { stack: true });
  authToken = null;
  removeStoredToken();
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  body?: unknown;
  constructor(message: string, status: number, details?: unknown, body?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
    this.body = body;
    this.name = 'ApiError';
  }
}

export function shouldClearTokenForUnauthorized(path: string): boolean {
  const normalizedPath = path.split('?')[0];
  return normalizedPath.startsWith('/api/auth/');
}

async function parseErrorResponse(res: Response) {
  let message = `HTTP ${res.status}`;
  let details: unknown;
  let body: unknown;
  try {
    const json = await res.json();
    body = json;
    message = json.error || message;
    details = json.details;
  } catch {
    // ignore parse error
  }
  return { message, details, body };
}

function dispatchUnauthorizedForToken(tokenUsed: string | null): void {
  traceAuth('dispatchUnauthorizedForToken called', {
    tokenUsed: tokenMarker(tokenUsed),
    currentToken: tokenMarker(getToken()),
  }, { stack: true });
  if (getToken() !== tokenUsed) {
    traceAuth('dispatchUnauthorizedForToken ignored because token changed', {
      tokenUsed: tokenMarker(tokenUsed),
      currentToken: tokenMarker(getToken()),
    });
    return;
  }
  clearToken();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
  }
}

async function checkSessionAfterDataUnauthorized(): Promise<boolean> {
  if (!unauthorizedSessionCheck) {
    unauthorizedSessionCheck = (async () => {
      const token = getToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      try {
        traceAuth('/api/auth/me request start', {
          reason: 'data endpoint 401 session check',
          apiBaseUrl: API_BASE_URL || '(same-origin)',
          hasAuthorization: Boolean(token),
          token: tokenMarker(token),
        });
        const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
          method: 'GET',
          headers,
          credentials: 'include',
        });
        traceAuth('/api/auth/me response status', {
          reason: 'data endpoint 401 session check',
          status: res.status,
          token: tokenMarker(token),
        });
        if (res.status === 401) {
          dispatchUnauthorizedForToken(token);
          return false;
        }
        return true;
      } catch (error) {
        traceAuth('/api/auth/me request failure', {
          reason: 'data endpoint 401 session check',
          error: error instanceof Error ? error.message : String(error),
          token: tokenMarker(token),
        });
        return true;
      } finally {
        unauthorizedSessionCheck = null;
      }
    })();
  }
  return unauthorizedSessionCheck;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  traceAuth('api request start', {
    method,
    path,
    apiBaseUrl: API_BASE_URL || '(same-origin)',
    hasAuthorization: Boolean(token),
    token: tokenMarker(token),
  });

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    traceAuth('api request failure', {
      method,
      path,
      token: tokenMarker(token),
      error: error instanceof Error ? error.message : String(error),
    }, { stack: true });
    throw error;
  }

  traceAuth('api response status', {
    method,
    path,
    status: res.status,
    token: tokenMarker(token),
  });

  if (res.status === 401) {
    traceAuth('any API 401', {
      method,
      path,
      token: tokenMarker(token),
      authEndpoint: shouldClearTokenForUnauthorized(path),
    }, { stack: true });
    const { message, details, body } = await parseErrorResponse(res);
    if (shouldClearTokenForUnauthorized(path)) {
      dispatchUnauthorizedForToken(token);
    } else {
      await checkSessionAfterDataUnauthorized();
    }
    throw new ApiError(message, 401, details, body);
  }

  if (!res.ok) {
    const { message, details, body } = await parseErrorResponse(res);
    throw new ApiError(message, res.status, details, body);
  }

  // 204 No Content or empty body
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    traceAuth('api response JSON parse error', {
      method,
      path,
      status: res.status,
      token: tokenMarker(token),
      error: error instanceof Error ? error.message : String(error),
      bodyLength: text.length,
    }, { stack: true });
    throw error;
  }
}

export const api = {
  get:    <T>(path: string)              => request<T>('GET',    path),
  post:   <T>(path: string, body: unknown) => request<T>('POST',   path, body),
  patch:  <T>(path: string, body: unknown) => request<T>('PATCH',  path, body),
  put:    <T>(path: string, body: unknown) => request<T>('PUT',    path, body),
  del:    <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};
