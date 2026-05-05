import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const apiSource = readFileSync(new URL('../src/app/lib/api.ts', import.meta.url), 'utf8');
const authContextSource = readFileSync(new URL('../src/app/contexts/AuthContext.tsx', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('../src/app/components/layout/Layout.tsx', import.meta.url), 'utf8');
const authDebugSource = readFileSync(new URL('../src/app/lib/authDebug.ts', import.meta.url), 'utf8');
const errorBoundarySource = readFileSync(new URL('../src/app/components/ui/ErrorBoundary.tsx', import.meta.url), 'utf8');
const buildInfoSource = readFileSync(new URL('../src/app/lib/build-info.ts', import.meta.url), 'utf8');
const buildDebugBadgeSource = readFileSync(new URL('../src/app/components/ui/BuildDebugBadge.tsx', import.meta.url), 'utf8');

test('frontend login persists bearer token under the auth token key', () => {
  assert.match(apiSource, /export const AUTH_TOKEN_KEY = 'app_auth_token'/);
  assert.match(apiSource, /let authToken: string \| null = readStoredToken\(\)/);
  assert.match(apiSource, /window\.localStorage\.setItem\(AUTH_TOKEN_KEY, token\)/);
  assert.match(apiSource, /window\.localStorage\.removeItem\(AUTH_TOKEN_KEY\)/);
});

test('frontend stores and restores the authenticated user snapshot', () => {
  assert.match(authContextSource, /const AUTH_USER_KEY = 'app_auth_user'/);
  assert.match(authContextSource, /function readStoredUser\(\): AuthUser \| null/);
  assert.match(authContextSource, /function writeStoredUser\(user: AuthUser\): void/);
  assert.match(authContextSource, /writeStoredUser\(user\);[\s\S]*setState\(\{ user, isAuthenticated: true, isLoading: false \}\);/);
  assert.match(authContextSource, /const storedToken = getToken\(\);[\s\S]*const storedUser = storedToken \? readStoredUser\(\) : null;/);
});

test('frontend verifies persisted sessions with auth me without clearing on transient failures', () => {
  assert.match(authContextSource, /refreshUser\(\)\.catch\(\(error\) => \{/);
  assert.match(authContextSource, /error instanceof ApiError && error\.status === 401/);
  assert.match(authContextSource, /clearStoredUser\(\);[\s\S]*setState\(\{ user: null, isAuthenticated: false, isLoading: false \}\);/);
  assert.match(authContextSource, /const fallbackUser = readStoredUser\(\);[\s\S]*isAuthenticated: Boolean\(fallbackUser\)/);
  assert.doesNotMatch(authContextSource, /catch\(\(error\) => \{[\s\S]*clearToken\(\);[\s\S]*fallbackUser/);
});

test('frontend data endpoint 401 still verifies auth me before clearing the session', () => {
  assert.match(apiSource, /function dispatchUnauthorizedForToken\(tokenUsed: string \| null\): void/);
  assert.match(apiSource, /if \(getToken\(\) !== tokenUsed\) \{[\s\S]*return;[\s\S]*\}/);
  assert.match(apiSource, /if \(shouldClearTokenForUnauthorized\(path\)\) \{[\s\S]*dispatchUnauthorizedForToken\(token\);[\s\S]*\} else \{[\s\S]*await checkSessionAfterDataUnauthorized\(\);/);
  assert.match(apiSource, /if \(res\.status === 401\) \{[\s\S]*dispatchUnauthorizedForToken\(token\);[\s\S]*return false;/);
  assert.match(apiSource, /\} catch \{[\s\S]*return true;[\s\S]*\} finally \{/);
});

test('stale auth me 401 cannot clear a newer login token', () => {
  assert.match(apiSource, /const token = getToken\(\);[\s\S]*api\/auth\/me/);
  assert.match(apiSource, /dispatchUnauthorizedForToken\(token\);[\s\S]*return false;/);
  assert.match(apiSource, /const token = getToken\(\);[\s\S]*if \(res\.status === 401\)/);
  assert.match(apiSource, /if \(shouldClearTokenForUnauthorized\(path\)\) \{[\s\S]*dispatchUnauthorizedForToken\(token\);/);
  assert.match(authContextSource, /const restoreToken = getToken\(\);[\s\S]*if \(!restoreToken\)/);
  assert.match(authContextSource, /refreshUser\(\)\.catch\(\(error\) => \{[\s\S]*if \(getToken\(\) !== restoreToken\) \{[\s\S]*return;[\s\S]*\}[\s\S]*error instanceof ApiError && error\.status === 401/);
  assert.doesNotMatch(apiSource, /function dispatchUnauthorized\(\): void/);
});

test('auth flight recorder traces logout causes without full bearer tokens', () => {
  assert.match(authDebugSource, /__SKYTECH_AUTH_TRACE__/);
  assert.match(authDebugSource, /console\.warn\('\[AUTH TRACE\]'/);
  assert.match(authDebugSource, /if \(!isAuthDebugEnabled\(\)\) return;/);
  assert.match(authDebugSource, /params\.get\('debugVersion'\) === '1'/);
  assert.match(authDebugSource, /AUTH_DEBUG_STORAGE_KEY = 'skytech_auth_debug'/);
  assert.match(authDebugSource, /tokenMarker/);
  assert.match(authDebugSource, /value\.slice\(-6\)/);
  assert.match(apiSource, /traceAuth\('clearToken called'/);
  assert.match(apiSource, /bodyLength: text\.length/);
  assert.doesNotMatch(apiSource, /bodyPreview/);
  assert.match(authContextSource, /traceAuth\('logout called'/);
  assert.match(layoutSource, /traceAuth\('Layout redirect to \/login'/);
  assert.match(errorBoundarySource, /traceAuth\('ErrorBoundary caught error'/);
  assert.match(authDebugSource, /\[A-Za-z0-9_-\]\+\\\.\[A-Za-z0-9_-\]\+\\\.\[A-Za-z0-9_-\]\+/);
  assert.doesNotMatch(authDebugSource, /Bearer \$\{token\}|Authorization': `Bearer/);
});

test('frontend build info exposes the active auth patch marker only through debug UI', () => {
  assert.match(buildInfoSource, /authPatch: string/);
  assert.match(buildInfoSource, /token-scoped-unauthorized-v2-flight-recorder/);
  assert.match(buildInfoSource, /if \(!isAuthDebugEnabled\(\)\) return;[\s\S]*window\.__SKYTECH_BUILD_INFO__ = frontendBuildInfo;[\s\S]*console\.info\('\[Skytech build\]'/);
  assert.match(buildInfoSource, /params\.get\('debugVersion'\) === '1'/);
  assert.match(buildInfoSource, /AUTH_DEBUG_STORAGE_KEY/);
  assert.match(buildDebugBadgeSource, /setVisible\(shouldShowBuildDebug\(\)\)/);
  assert.match(buildDebugBadgeSource, /frontendBuildInfo\.authPatch/);
});

test('authenticated users with no accessible section are not redirected to login', () => {
  assert.match(layoutSource, /const hasAccessibleSection = firstAllowedPath !== '\/login'/);
  assert.match(layoutSource, /shouldRedirectBySection && hasAccessibleSection/);
  assert.match(layoutSource, /title="Нет доступных разделов"/);
  assert.doesNotMatch(layoutSource, /if \(shouldRedirectBySection\) \{[\s\S]*navigate\('\/login'/);
});
