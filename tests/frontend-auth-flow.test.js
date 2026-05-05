import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const apiSource = readFileSync(new URL('../src/app/lib/api.ts', import.meta.url), 'utf8');
const authContextSource = readFileSync(new URL('../src/app/contexts/AuthContext.tsx', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('../src/app/components/layout/Layout.tsx', import.meta.url), 'utf8');

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
  assert.match(authContextSource, /refreshUser\(\)\.catch\(\(error\) => \{[\s\S]*if \(getToken\(\) !== restoreToken\) return;[\s\S]*error instanceof ApiError && error\.status === 401/);
  assert.doesNotMatch(apiSource, /function dispatchUnauthorized\(\): void/);
});

test('authenticated users with no accessible section are not redirected to login', () => {
  assert.match(layoutSource, /const hasAccessibleSection = firstAllowedPath !== '\/login'/);
  assert.match(layoutSource, /shouldRedirectBySection && hasAccessibleSection/);
  assert.match(layoutSource, /title="Нет доступных разделов"/);
  assert.doesNotMatch(layoutSource, /if \(shouldRedirectBySection\) \{[\s\S]*navigate\('\/login'/);
});
