/**
 * API client — fetch wrapper for all server communication.
 *
 * Base URL resolution:
 *  - Production (GitHub Pages):  VITE_API_URL env var must be set to the cloudflared tunnel URL
 *  - Development (vite dev server): empty string, vite proxy forwards /api → localhost:3000
 *
 * Auth:
 *  Token is stored in localStorage under AUTH_TOKEN_KEY.
 *  Every request adds Authorization: Bearer <token> header if a token exists.
 */

export const AUTH_TOKEN_KEY = 'app_auth_token';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

function getToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
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

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    // Session expired — clear local token so AuthContext can redirect to login
    clearToken();
    throw new ApiError('Unauthorized', 401);
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      message = json.error || message;
    } catch {
      // ignore parse error
    }
    throw new ApiError(message, res.status);
  }

  // 204 No Content or empty body
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

export const api = {
  get:    <T>(path: string)              => request<T>('GET',    path),
  post:   <T>(path: string, body: unknown) => request<T>('POST',   path, body),
  patch:  <T>(path: string, body: unknown) => request<T>('PATCH',  path, body),
  put:    <T>(path: string, body: unknown) => request<T>('PUT',    path, body),
  del:    <T>(path: string)              => request<T>('DELETE', path),
};
