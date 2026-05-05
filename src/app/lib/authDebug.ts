export type AuthTraceEntry = {
  at: string;
  event: string;
  data?: Record<string, unknown>;
  stack?: string;
};

declare global {
  interface Window {
    __SKYTECH_AUTH_TRACE__?: AuthTraceEntry[];
  }
}

const MAX_TRACE_ENTRIES = 250;
export const AUTH_DEBUG_STORAGE_KEY = 'skytech_auth_debug';

export function isAuthDebugEnabled(search = typeof window !== 'undefined' ? window.location.search : ''): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(search);
  if (params.get('debugVersion') === '1') return true;
  try {
    return window.localStorage.getItem(AUTH_DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function tokenMarker(token: string | null | undefined): string {
  if (!token) return 'none';
  const value = String(token);
  if (/^len:\d+:tail:/.test(value)) return value;
  const bearerMatch = value.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) return tokenMarker(bearerMatch[1]);
  return `len:${value.length}:tail:${value.slice(-6)}`;
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (/^Bearer\s+/i.test(value) || /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
      return tokenMarker(value);
    }
    if (value.length > 80) return `[text:${value.length}]`;
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 10).map(sanitizeValue);
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|token|authorization|cookie|session/i.test(key)) {
        result[key] = key.toLowerCase().includes('token') ? tokenMarker(String(item || '')) : '[redacted]';
      } else {
        result[key] = sanitizeValue(item);
      }
    }
    return result;
  }
  return String(value);
}

export function traceAuth(event: string, data: Record<string, unknown> = {}, options: { stack?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  if (!isAuthDebugEnabled()) return;
  const entry: AuthTraceEntry = {
    at: new Date().toISOString(),
    event,
    data: sanitizeValue(data) as Record<string, unknown>,
  };
  if (options.stack) {
    entry.stack = new Error('auth trace').stack;
  }

  const trace = window.__SKYTECH_AUTH_TRACE__ || [];
  trace.push(entry);
  if (trace.length > MAX_TRACE_ENTRIES) {
    trace.splice(0, trace.length - MAX_TRACE_ENTRIES);
  }
  window.__SKYTECH_AUTH_TRACE__ = trace;
  console.warn('[AUTH TRACE]', entry);
}
