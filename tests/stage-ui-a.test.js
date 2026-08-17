import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const themeSource = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../src/app/pages/Dashboard.tsx', import.meta.url), 'utf8');
const executiveCockpitSource = readFileSync(new URL('../src/app/components/dashboard/ExecutiveCockpitV2.tsx', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/app/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('../src/app/components/layout/Layout.tsx', import.meta.url), 'utf8');
const loadingSource = readFileSync(new URL('../src/app/components/ui/AppLoadingState.tsx', import.meta.url), 'utf8');
const documentsSource = readFileSync(new URL('../src/app/pages/Documents.tsx', import.meta.url), 'utf8');
const profileSettingsSource = readFileSync(new URL('../src/app/pages/ProfileSettings.tsx', import.meta.url), 'utf8');
const ganttModalsSource = readFileSync(new URL('../src/app/components/gantt/GanttModals.tsx', import.meta.url), 'utf8');
const rentalDrawerSource = readFileSync(new URL('../src/app/components/gantt/RentalDrawer.tsx', import.meta.url), 'utf8');
const clientDetailSource = readFileSync(new URL('../src/app/pages/ClientDetail.tsx', import.meta.url), 'utf8');
const equipmentDetailSource = readFileSync(new URL('../src/app/pages/EquipmentDetail.tsx', import.meta.url), 'utf8');
const knowledgeBaseSource = readFileSync(new URL('../src/app/pages/KnowledgeBase.tsx', import.meta.url), 'utf8');
const serviceDetailSource = readFileSync(new URL('../src/app/pages/ServiceDetail.tsx', import.meta.url), 'utf8');
const serviceVehicleDetailSource = readFileSync(new URL('../src/app/pages/ServiceVehicleDetail.tsx', import.meta.url), 'utf8');
const brandInteractionSources = [
  ganttModalsSource,
  rentalDrawerSource,
  clientDetailSource,
  documentsSource,
  equipmentDetailSource,
  readFileSync(new URL('../src/app/pages/EquipmentNew.tsx', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/app/pages/Gsm.tsx', import.meta.url), 'utf8'),
  knowledgeBaseSource,
  serviceDetailSource,
  serviceVehicleDetailSource,
  readFileSync(new URL('../src/app/pages/ServiceVehicles.tsx', import.meta.url), 'utf8'),
].join('\n');

function requiredCapture(source, pattern, description) {
  const match = source.match(pattern);
  assert.ok(match, `missing ${description}`);
  return match[1];
}

function assertBrandSemanticClasses(classNames, description) {
  assert.match(classNames, /(?:border|bg|text)-primary/, `${description} must use primary brand semantics`);
  assert.doesNotMatch(classNames, /(?:blue|cyan|sky)-/, `${description} must not use the data/info palette`);
}

test('Stage UI-A centralizes the cold industrial visual system', () => {
  for (const token of [
    '--rc-surface:',
    '--rc-surface-elevated:',
    '--rc-brand:',
    '--rc-brand-dark:',
    '--brand-primary:',
    '--brand-primary-hover:',
    '--brand-primary-active:',
    '--brand-primary-muted:',
    '--brand-primary-subtle:',
    '--brand-focus:',
    '--brand-on-primary:',
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
  assert.match(themeSource, /--rc-brand:\s*#82c91e/);
  assert.match(themeSource, /--rc-brand-dark:\s*#b7f23a/);
  assert.match(themeSource, /--rc-brand-content:\s*#4b7511/);
  assert.match(themeSource, /--rc-brand-content-hover:\s*#3f6212/);
  assert.match(themeSource, /--brand-primary-active:\s*var\(--rc-brand-hover\)/);
  assert.match(themeSource, /\.dark\s*\{[\s\S]*--brand-primary-active:\s*var\(--rc-brand-dark-hover\)/);
  assert.match(themeSource, /\.app-button-primary:active:not\(:disabled\)[\s\S]*background:\s*var\(--primary-active\)/);
  assert.match(themeSource, /\.dark\s*\{[\s\S]*--brand-primary:\s*var\(--rc-brand-dark\)[\s\S]*--primary:\s*var\(--brand-primary\)/);
  assert.match(themeSource, /input\[type="checkbox"\],[\s\S]*accent-color:\s*var\(--primary\)/);
  assert.match(themeSource, /\.dark\s*\{[\s\S]*--info:\s*#38bdf8/);
  assert.match(themeSource, /--radius:\s*0\.5rem/);
  assert.match(themeSource, /border:\s*1px solid var\(--rc-border\)/);
});

test('Stage UI-A dashboard uses four real executive KPI semantics without the retired reveal system', () => {
  const primaryKpiBlock = dashboardSource.slice(
    dashboardSource.indexOf('const executiveKpis: ExecutiveKpi[] = ['),
    dashboardSource.indexOf('const attentionState:'),
  );

  for (const label of ['Выручка месяца', 'Загрузка парка', 'Просроченная дебиторка', 'Поступления месяца']) {
    assert.match(primaryKpiBlock, new RegExp(label));
  }
  assert.equal(primaryKpiBlock.match(/id: 'dashboard-kpi-/g)?.length, 4);
  assert.match(primaryKpiBlock, /executiveRevenueActual/);
  assert.match(primaryKpiBlock, /utilization/);
  assert.match(primaryKpiBlock, /executiveOverdueReceivablesAmount/);
  assert.match(primaryKpiBlock, /actualReceiptsAmount/);
  assert.match(executiveCockpitSource, /\{kpis\.map\(\(kpi\) => \(/);
  assert.doesNotMatch(dashboardSource, /rentcore-dashboard-reveal|prefersReducedMotion/);
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

test('Stage UI-A uses rentCore green primary actions and hidden-but-scrollable compact rails', () => {
  assert.match(documentsSource, /bg-primary text-primary-foreground hover:bg-\[color:var\(--primary-hover\)\]/);
  assert.match(profileSettingsSource, /bg-primary text-primary-foreground hover:bg-\[color:var\(--primary-hover\)\]/);
  assert.doesNotMatch(documentsSource, /bg-lime-300 text-slate-950/);
  assert.doesNotMatch(profileSettingsSource, /bg-lime-300 text-slate-950/);
  assert.doesNotMatch(profileSettingsSource, /bg-cyan-300 text-slate-950/);
  assert.match(documentsSource, /app-scroll-fade-x app-scrollbar-none[\s\S]*overflow-x-auto/);
  assert.match(themeSource, /\.app-scrollbar-none\s*\{[\s\S]*scrollbar-width: none/);
});

test('Stage UI-A keeps blue and cyan out of brand interaction states', () => {
  assert.doesNotMatch(brandInteractionSources, /(?:focus(?:-visible)?|data-\[state=active\]|hover)[^\n'\"]*(?:blue|cyan|sky)-/);
  assert.doesNotMatch(brandInteractionSources, /bg-(?:blue|cyan|sky)-(?:300|500|600)\s+text-(?:white|slate-950)/);
  assert.match(brandInteractionSources, /focus:ring-(?:ring|primary)/);
  assert.match(brandInteractionSources, /text-primary-content/);
});

test('Stage UI-A uses brand semantics for conditional editing and generic panel accents', () => {
  const extensionSurface = requiredCapture(
    rentalDrawerSource,
    /activeTab\s*===\s*'terms'\s*&&\s*canExtendRentalTerm\s*&&\s*showExtend\s*&&\s*\(\s*<section>\s*<div\s+className="([^"]+)"/,
    'RentalDrawer extension editing surface',
  );
  assertBrandSemanticClasses(extensionSurface, 'RentalDrawer extension editing surface');
  const extensionStart = rentalDrawerSource.indexOf("activeTab === 'terms' && canExtendRentalTerm && showExtend");
  const extensionNotice = rentalDrawerSource.indexOf('{rentalDetailNotice && (', extensionStart);
  assert.ok(extensionStart >= 0 && extensionNotice > extensionStart, 'missing RentalDrawer extension content region');
  const extensionContent = rentalDrawerSource.slice(extensionStart, extensionNotice);
  assert.match(extensionContent, /text-primary-content/);
  assert.doesNotMatch(extensionContent, /(?:blue|cyan|sky)-/);

  const financialSummaryLabel = clientDetailSource.indexOf('Финансовая сводка');
  assert.ok(financialSummaryLabel >= 0, 'missing ClientDetail financial summary');
  const financialSummaryPrefix = clientDetailSource.slice(Math.max(0, financialSummaryLabel - 800), financialSummaryLabel);
  const financialCardMatches = [...financialSummaryPrefix.matchAll(/<Card\s+className=\{\s*editing\s*\?\s*'([^']+)'\s*:\s*undefined\s*\}>/g)];
  assert.ok(financialCardMatches.length > 0, 'missing ClientDetail financial editing card classes');
  assertBrandSemanticClasses(financialCardMatches.at(-1)[1], 'ClientDetail financial editing card');
  const editingBadgeClasses = requiredCapture(
    clientDetailSource,
    /const editingBadgeClassName = '([^']+)'/,
    'ClientDetail editing badge classes',
  );
  assertBrandSemanticClasses(editingBadgeClasses, 'ClientDetail editing badge');
  const financialSummarySuffix = clientDetailSource.slice(financialSummaryLabel, financialSummaryLabel + 300);
  assert.match(financialSummarySuffix, /editing\s*&&\s*<Badge\s+className=\{editingBadgeClassName\}>\s*Редактируется\s*<\/Badge>/);
  assert.doesNotMatch(financialSummarySuffix, /variant="info"[^>]*>\s*Редактируется/);

  const returnModalAccent = requiredCapture(
    ganttModalsSource,
    /<span\s+className="([^"]+)">\s*<RotateCcw[^>]*\/>\s*<\/span>\s*<div>\s*<h3[^>]*>\s*Возврат техники\s*<\/h3>/,
    'Gantt return modal header accent',
  );
  assertBrandSemanticClasses(returnModalAccent, 'Gantt return modal header accent');
});

test('Stage UI-A keeps other selected and editing surfaces on brand semantics', () => {
  const selectedKnowledgeModule = requiredCapture(
    knowledgeBaseSource,
    /isActive\s*\?\s*'([^']+)'\s*:\s*'border-border\/70/,
    'Knowledge Base selected module classes',
  );
  assertBrandSemanticClasses(selectedKnowledgeModule, 'Knowledge Base selected module');

  const pendingPhotoSurface = requiredCapture(
    serviceDetailSource,
    /photoPending\.length\s*>\s*0\s*&&\s*\(\s*<div\s+className="([^"]+)"/,
    'Service pending-photo surface',
  );
  assertBrandSemanticClasses(pendingPhotoSurface, 'Service pending-photo surface');

  const equipmentFormAccent = requiredCapture(
    equipmentDetailSource,
    /function\s+FormSection[\s\S]*?<div\s+className="([^"]+)">\s*\{icon\}/,
    'equipment edit form section accent',
  );
  assertBrandSemanticClasses(equipmentFormAccent, 'Equipment edit form section accent');
  assert.doesNotMatch(serviceVehicleDetailSource, /text-(?:blue|cyan|sky)-/);
});

test('Stage UI-A uses layout-shaped skeletons instead of route spinners', () => {
  assert.match(loadingSource, /app-skeleton-layout/);
  assert.match(layoutSource, /app-skeleton/);
  assert.doesNotMatch(loadingSource, /animate-spin|Loader2/);
  assert.doesNotMatch(layoutSource, /animate-spin/);
  assert.match(themeSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.app-skeleton::after/);
});
