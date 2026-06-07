import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const layoutSource = readFileSync(new URL('../src/app/components/layout/Layout.tsx', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/app/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../src/app/pages/Settings.tsx', import.meta.url), 'utf8');
const themeContextSource = readFileSync(new URL('../src/app/contexts/ThemeContext.tsx', import.meta.url), 'utf8');

test('app layout exposes the persisted theme toggle in the topbar', () => {
  assert.match(layoutSource, /useTheme\(\)/);
  assert.match(layoutSource, /const \{ theme, toggleTheme \} = useTheme\(\)/);
  assert.match(layoutSource, /aria-pressed=\{theme === 'dark'\}/);
  assert.match(layoutSource, /aria-label=\{themeToggleLabel\}/);
  assert.match(layoutSource, /data-testid="theme-toggle"/);
  assert.match(layoutSource, /Включить светлую тему/);
  assert.match(layoutSource, /Включить тёмную тему/);
  assert.match(layoutSource, /renderThemeToggleButton\(\)[\s\S]*<NotificationCenter \/>/);
  assert.equal(layoutSource.match(/\{renderThemeToggleButton\(\)\}/g)?.length, 2);
  assert.match(layoutSource, /sm:hidden[\s\S]*\{renderThemeToggleButton\(\)\}/);
  assert.match(layoutSource, /sm:flex[\s\S]*\{renderThemeToggleButton\(\)\}/);
});

test('theme state keeps the original localStorage key and html dark class', () => {
  assert.match(themeContextSource, /localStorage\.getItem\('theme'\)/);
  assert.match(themeContextSource, /localStorage\.setItem\('theme', theme\)/);
  assert.match(themeContextSource, /root\.classList\.add\('dark'\)/);
  assert.match(themeContextSource, /root\.classList\.remove\('dark'\)/);
});

test('sidebar exposes theme control outside configurable navigation', () => {
  assert.match(sidebarSource, /useTheme\(\)/);
  assert.match(sidebarSource, /const \{ theme, toggleTheme \} = useTheme\(\)/);
  assert.match(sidebarSource, /data-testid="sidebar-theme-toggle"/);
  assert.match(sidebarSource, /aria-pressed=\{isDarkTheme\}/);
  assert.match(sidebarSource, /aria-label=\{themeToggleLabel\}/);
  assert.match(sidebarSource, /Тема/);
  assert.match(sidebarSource, /Тёмная/);
  assert.match(sidebarSource, /Светлая/);
  assert.match(sidebarSource, /<\/nav>[\s\S]*data-testid="sidebar-theme-toggle"/);
  assert.doesNotMatch(sidebarSource, /section:\s*'theme'/);
});

test('admin route keeps the common app shell around dashboard content', () => {
  assert.equal(layoutSource.match(/<Sidebar\b/g)?.length, 1);
  assert.doesNotMatch(layoutSource, /isAdminReferenceMode/);
  assert.doesNotMatch(layoutSource, /topbarSearch/);
  assert.match(layoutSource, /renderThemeToggleButton\(\)[\s\S]*<NotificationCenter \/>/);

  assert.doesNotMatch(sidebarSource, /isAdminReferenceMode/);
  assert.doesNotMatch(sidebarSource, /ADMIN_REFERENCE_SECTIONS/);
  assert.match(sidebarSource, /name:\s+'Панель администратора'[\s\S]*href:\s+'\/admin'[\s\S]*section:\s+'admin_panel'/);
  assert.match(sidebarSource, /sidebarGroups\[item\.section\] === group\.id/);

  assert.match(settingsSource, /data-testid="admin-reference-dashboard"/);
  assert.match(settingsSource, /AdminDashboardModal/);
  assert.doesNotMatch(settingsSource, /admin-detail-sections/);
  assert.doesNotMatch(settingsSource, /scrollIntoView/);
  assert.doesNotMatch(settingsSource, /<aside\b/);
});

test('admin dashboard overview uses theme-aware surfaces and controls', () => {
  assert.match(settingsSource, /const adminCardClass = 'rounded-\[16px\] border border-border\/80 bg-card text-card-foreground/);
  assert.match(settingsSource, /const adminMutedTextClass = 'text-muted-foreground'/);
  assert.match(settingsSource, /const adminLinkClass = 'text-\[12px\] font-semibold text-primary/);

  assert.match(settingsSource, /data-testid="admin-reference-dashboard" className="min-h-\[calc\(100vh-4rem\)\] bg-background text-foreground transition-colors"/);
  assert.match(settingsSource, /border border-input bg-input-background/);
  assert.match(settingsSource, /border-border\/80 bg-card p-0 text-card-foreground/);
  assert.match(settingsSource, /data-\[state=active\]:bg-primary/);
  assert.match(settingsSource, /data-testid="admin-system-settings-modal"/);

  assert.doesNotMatch(settingsSource, /dark:bg-\[#f7f9fc\]/);
  assert.doesNotMatch(settingsSource, /dark:text-\[#172033\]/);
  assert.doesNotMatch(settingsSource, /border border-\[#e6ebf2\] bg-white/);
});
