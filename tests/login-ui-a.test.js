import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const loginSource = readFileSync(new URL('../src/app/pages/Login.tsx', import.meta.url), 'utf8');
const loginStyles = readFileSync(new URL('../src/app/pages/Login.css', import.meta.url), 'utf8');

test('Login keeps its auth contract inside the 50/50 responsive shell', () => {
  assert.match(loginSource, /lg:grid-cols-2/);
  assert.match(loginSource, /await login\(loginValue, password\)/);
  assert.match(loginSource, /checked=\{rememberMe\}/);
  assert.match(loginSource, /type=\{showPassword \? 'text' : 'password'\}/);
  assert.match(loginSource, /getLoginErrorMessage/);
  assert.match(loginSource, /VITE_DEMO_URL/);
});

test('Login uses the localized dark industrial UI-A treatment', () => {
  assert.match(loginSource, /import '\.\/Login\.css'/);
  assert.match(loginStyles, /background:\s*var\(--rc-graphite-950\)/);
  assert.match(loginStyles, /--primary:\s*#38bdf8/);
  assert.match(loginSource, /rentcore-login-auth-panel[^"]*rounded-lg/);
  assert.match(loginStyles, /\.rentcore-login-submit[\s\S]*background:\s*var\(--primary\)/);
  assert.match(loginStyles, /\.rentcore-login-submit[\s\S]*box-shadow:\s*none/);
  assert.match(loginStyles, /\.rentcore-login-error[\s\S]*rgba\(127, 29, 29, 0\.18\)/);
  assert.doesNotMatch(loginStyles, /183,\s*242,\s*58|#b7f23a|#a5dc2f/i);
});

test('Login intro is session-scoped, restrained, and reduced-motion safe', () => {
  assert.match(loginSource, /window\.sessionStorage\.getItem\(LOGIN_INTRO_STORAGE_KEY\)/);
  assert.match(loginSource, /window\.sessionStorage\.setItem\(LOGIN_INTRO_STORAGE_KEY, 'true'\)/);
  assert.match(loginStyles, /rentcore-login-panel-in var\(--motion-duration-emphasis\)/);
  assert.match(loginStyles, /rentcore-login-cta-in 300ms[\s\S]*570ms/);
  assert.match(loginStyles, /translateY\(10px\)/);
  assert.match(loginStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none !important/);
});
