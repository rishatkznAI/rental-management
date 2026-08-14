import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const themeSource = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../src/app/pages/Dashboard.tsx', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/app/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('../src/app/components/layout/Layout.tsx', import.meta.url), 'utf8');
const loadingSource = readFileSync(new URL('../src/app/components/ui/AppLoadingState.tsx', import.meta.url), 'utf8');
const documentsSource = readFileSync(new URL('../src/app/pages/Documents.tsx', import.meta.url), 'utf8');
const profileSettingsSource = readFileSync(new URL('../src/app/pages/ProfileSettings.tsx', import.meta.url), 'utf8');

test('Stage UI-A centralizes the cold industrial visual system', () => {
  for (const token of [
    '--rc-surface:',
    '--rc-surface-elevated:',
    '--rc-border:',
    '--rc-hover:',
    '--rc-active:',
    '--rc-text-primary:',
    '--rc-text-secondary:',
    '--rc-text-muted:',
    '--rc-accent:',
    '--success:',
    '--warning:',
    '--danger:',
    '--info:',
  ]) {
    assert.match(themeSource, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(themeSource, /\.dark\s*\{[\s\S]*--background:\s*#080c12/);
  assert.match(themeSource, /\.dark\s*\{[\s\S]*--primary:\s*#38bdf8/);
  assert.match(themeSource, /--radius:\s*0\.5rem/);
  assert.match(themeSource, /border:\s*1px solid var\(--rc-border\)/);
});

test('Stage UI-A dashboard uses four real primary KPI semantics and sequenced motion', () => {
  const primaryKpiBlock = dashboardSource.slice(
    dashboardSource.indexOf('const primaryDashboardKpis = ['),
    dashboardSource.indexOf('const executiveControlRows ='),
  );

  for (const label of ['Поступления месяца', 'Загрузка парка', 'Просроченная дебиторка', 'Активные аренды']) {
    assert.match(primaryKpiBlock, new RegExp(label));
  }
  assert.equal(primaryKpiBlock.match(/id: 'executive-/g)?.length, 4);
  assert.match(primaryKpiBlock, /monthlyPaidAmount/);
  assert.match(primaryKpiBlock, /utilization/);
  assert.match(primaryKpiBlock, /overdueReceivablesAmount/);
  assert.match(primaryKpiBlock, /activeRentalsList\.length/);
  assert.match(dashboardSource, /primaryDashboardKpis\.map\(\(card, index\)/);
  assert.match(dashboardSource, /rentcore-dashboard-reveal-kpi/);
  assert.match(dashboardSource, /isAnimationActive=\{!prefersReducedMotion\}/);
  assert.doesNotMatch(primaryKpiBlock, /Math\.random|fake|mock/i);
});

test('Stage UI-A keeps the sidebar shared, collapsible, quiet, and route-driven', () => {
  assert.match(sidebarSource, /w-\[248px\]/);
  assert.match(sidebarSource, /desktopCollapsed \? 'sm:w-20' : 'sm:w-\[248px\]'/);
  assert.match(sidebarSource, /before:bg-sidebar-primary/);
  assert.match(sidebarSource, /before:opacity-0[\s\S]*before:opacity-100/);
  assert.match(sidebarSource, /navigate\(item\.href\)/);
  assert.match(layoutSource, /sm:ml-\[248px\]/);
  assert.match(layoutSource, /\(min-width: 640px\) and \(max-width: 1199px\)/);
  assert.match(layoutSource, /effectiveSidebarCollapsed = isTabletViewport \? tabletSidebarCollapsed : desktopSidebarCollapsed/);
  assert.match(layoutSource, /<Sidebar/);
});

test('Stage UI-A uses cyan primary actions and hidden-but-scrollable compact rails', () => {
  assert.match(documentsSource, /bg-primary text-primary-foreground hover:bg-\[color:var\(--primary-hover\)\]/);
  assert.match(profileSettingsSource, /bg-primary text-primary-foreground hover:bg-\[color:var\(--primary-hover\)\]/);
  assert.doesNotMatch(documentsSource, /bg-lime-300 text-slate-950/);
  assert.doesNotMatch(profileSettingsSource, /bg-lime-300 text-slate-950/);
  assert.doesNotMatch(profileSettingsSource, /bg-cyan-300 text-slate-950/);
  assert.match(documentsSource, /app-scroll-fade-x app-scrollbar-none[\s\S]*overflow-x-auto/);
  assert.match(themeSource, /\.app-scrollbar-none\s*\{[\s\S]*scrollbar-width: none/);
});

test('Stage UI-A uses layout-shaped skeletons instead of route spinners', () => {
  assert.match(loadingSource, /app-skeleton-layout/);
  assert.match(layoutSource, /app-skeleton/);
  assert.doesNotMatch(loadingSource, /animate-spin|Loader2/);
  assert.doesNotMatch(layoutSource, /animate-spin/);
  assert.match(themeSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.app-skeleton::after/);
});
