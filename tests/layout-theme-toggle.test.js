import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const layoutSource = readFileSync(new URL('../src/app/components/layout/Layout.tsx', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/app/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
const themeContextSource = readFileSync(new URL('../src/app/contexts/ThemeContext.tsx', import.meta.url), 'utf8');

test('app layout exposes the persisted theme toggle in the topbar', () => {
  assert.match(layoutSource, /useTheme\(\)/);
  assert.match(layoutSource, /const \{ theme, toggleTheme \} = useTheme\(\)/);
  assert.match(layoutSource, /aria-pressed=\{theme === 'dark'\}/);
  assert.match(layoutSource, /aria-label=\{themeToggleLabel\}/);
  assert.match(layoutSource, /Включить светлую тему/);
  assert.match(layoutSource, /Включить тёмную тему/);
  assert.match(layoutSource, /renderThemeToggleButton\(\)[\s\S]*<NotificationCenter \/>/);
});

test('theme state keeps the original localStorage key and html dark class', () => {
  assert.match(themeContextSource, /localStorage\.getItem\('theme'\)/);
  assert.match(themeContextSource, /localStorage\.setItem\('theme', theme\)/);
  assert.match(themeContextSource, /root\.classList\.add\('dark'\)/);
  assert.match(themeContextSource, /root\.classList\.remove\('dark'\)/);
});

test('sidebar no longer owns the only visible theme control', () => {
  assert.doesNotMatch(sidebarSource, /useTheme\(\)/);
  assert.doesNotMatch(sidebarSource, /aria-label="Переключить тему"/);
});
