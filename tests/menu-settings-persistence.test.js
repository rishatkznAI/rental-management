import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const navigationSource = readFileSync(new URL('../src/app/lib/navigation.ts', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../src/app/pages/Settings.tsx', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/app/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('../src/app/components/layout/Layout.tsx', import.meta.url), 'utf8');
const systemRoutesSource = readFileSync(new URL('../server/routes/system.js', import.meta.url), 'utf8');

test('sidebar visibility settings have a normalized app_settings contract', () => {
  assert.match(navigationSource, /SIDEBAR_NAV_VISIBILITY_SETTING_KEY = 'sidebar_navigation_visibility'/);
  assert.match(navigationSource, /DEFAULT_SIDEBAR_VISIBILITY/);
  assert.match(navigationSource, /function normalizeSidebarVisibility/);
  assert.match(navigationSource, /typeof enabled !== 'boolean'/);
  assert.match(navigationSource, /REQUIRED_VISIBLE_SECTIONS/);
});

test('admin left menu controls persist visibility through app settings', () => {
  assert.match(settingsSource, /sidebarVisibilitySetting/);
  assert.match(settingsSource, /setSidebarVisibility\(normalizeSidebarVisibility\(sidebarVisibilitySetting\?\.value\)\)/);
  assert.match(settingsSource, /toggleSidebarSectionVisibility/);
  assert.match(settingsSource, /saveSidebarVisibility\(next\)/);
  assert.doesNotMatch(settingsSource, /localMenuVisibility/);
  assert.match(settingsSource, /const toggleMenuSection = \(section: SidebarSection\) => \{[\s\S]*toggleSidebarSectionVisibility\(section\);[\s\S]*\};/);
  assert.match(settingsSource, /const enabled = sidebarVisibility\[section\] !== false;/);
  assert.match(settingsSource, /const visibilityPayload = \{\s*key: SIDEBAR_NAV_VISIBILITY_SETTING_KEY,\s*value: normalizeSidebarVisibility\(nextVisibility\),\s*\};/);
  assert.match(settingsSource, /appSettingsService\.update\(sidebarVisibilitySetting\.id, visibilityPayload\)/);
  assert.match(settingsSource, /appSettingsService\.create\(\{\s*\.\.\.visibilityPayload,\s*createdAt: now,\s*updatedAt: now,\s*\}\)/);
  assert.doesNotMatch(settingsSource, /createdAt: sidebarVisibilitySetting\?\.createdAt/);
  assert.match(settingsSource, /queryClient\.invalidateQueries\(\{ queryKey: \['app-settings'\] \}\)/);
  assert.match(settingsSource, /aria-pressed=\{enabled\}/);
  assert.match(settingsSource, /Сохранить настройки меню/);
  assert.match(settingsSource, /<Eye className="h-4 w-4" \/>/);
  assert.match(settingsSource, /<EyeOff className="h-4 w-4" \/>/);
});

test('real app shell applies menu visibility after role access checks', () => {
  assert.match(sidebarSource, /SIDEBAR_NAV_VISIBILITY_SETTING_KEY/);
  assert.match(sidebarSource, /normalizeSidebarVisibility\(visibilitySetting\?\.value\)/);
  assert.match(sidebarSource, /canView\(item\.section\)[\s\S]*isSidebarSectionEnabled\(sidebarVisibility, item\.section\)/);
  assert.match(layoutSource, /SECTION_PATHS/);
  assert.match(layoutSource, /isSidebarSectionEnabled\(sidebarVisibility, candidateSection\)/);
  assert.match(layoutSource, /canView\(bottomSection\) && isSidebarSectionEnabled\(sidebarVisibility, bottomSection\)/);
  assert.match(layoutSource, /!section \|\| isSidebarSectionEnabled\(sidebarVisibility, section\)/);
});

test('public settings expose only non-sensitive sidebar menu configuration', () => {
  assert.match(systemRoutesSource, /sidebar_navigation_visibility/);
  assert.match(systemRoutesSource, /sidebar_navigation_order/);
  assert.match(systemRoutesSource, /sidebar_navigation_groups/);
  assert.match(systemRoutesSource, /allowedKeys\.has\(String\(item\?\.key \|\| ''\)\.trim\(\)\)/);
});
