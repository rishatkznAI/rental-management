import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Dashboard.tsx'), 'utf8');
const themeSource = fs.readFileSync(path.join(process.cwd(), 'src/styles/theme.css'), 'utf8');

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `start marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `end marker not found: ${endMarker}`);
  return source.slice(start, end);
}

test('dashboard company health renders radial overview with stable selectors', () => {
  const block = sourceBlock(dashboardSource, 'function CompanyHealthCommandCenter', 'function RiskSignalStrip');
  const radialBlock = sourceBlock(dashboardSource, 'function CompanyHealthRadialOverview', 'function CompanyHealthCommandCenter');

  assert.match(block, /role="region"/);
  assert.match(block, /aria-label=\{hasScore \? `Здоровье компании \$\{progress\} из 100: \$\{label\}` : `Здоровье компании: \$\{label\}`\}/);
  assert.match(block, /data-testid="dashboard-company-health"/);
  assert.match(block, /data-company-health-layout="executive"/);
  assert.match(block, /<CompanyHealthRadialOverview/);
  assert.match(radialBlock, /data-testid="dashboard-radial-overview"/);
  assert.match(radialBlock, /data-testid="dashboard-radial-core"/);
  assert.match(radialBlock, /data-testid="dashboard-radial-node"/);
  assert.match(radialBlock, /data-testid="dashboard-radial-empty"/);
  assert.match(radialBlock, /viewBox="0 0 240 240"/);
  assert.match(block, /data-testid="dashboard-company-health-visual"/);
  assert.match(block, /data-testid="dashboard-company-health-directions"/);
  assert.match(block, /data-testid="dashboard-company-health-completeness"/);
  assert.match(block, /data-testid="dashboard-company-health-compact"/);
  assert.match(block, /Нет базы для полного расчёта: нужны записи из платежей, аренд, сервиса, документов и доставок\./);
  assert.match(block, /const completenessText = \[/);
  assert.doesNotMatch(block, /<CompanyHealthBars items=\{bars\} \/>/);
  assert.doesNotMatch(block, /new ResizeObserver/);
  assert.doesNotMatch(block, /window\.innerWidth/);
  assert.doesNotMatch(dashboardSource, /Дашборд ещё собирает управленческую картину/);
});

test('dashboard radial overview positions nodes mathematically inside the SVG container', () => {
  const radialBlock = sourceBlock(dashboardSource, 'function CompanyHealthRadialOverview', 'function CompanyHealthCommandCenter');

  assert.match(dashboardSource, /function polarToCartesian/);
  assert.match(radialBlock, /polarToCartesian\(center, center, nodeRadius, angle\)/);
  assert.match(radialBlock, /Math\.max\(28, Math\.min\(212, node\.point\.x\)\)/);
  assert.match(radialBlock, /Math\.max\(18, Math\.min\(222, node\.point\.y/);
  assert.match(radialBlock, /radialShortLabel\(node\.item\.title\)/);
  assert.doesNotMatch(radialBlock, /\btop\b|\bleft\b/);
});

test('dashboard company health keeps executive direction summary alongside radial overview', () => {
  const block = sourceBlock(dashboardSource, 'function CompanyHealthCommandCenter', 'function RiskSignalStrip');

  assert.match(block, /const directions = allDirections\.length > 0 \? allDirections : \[\.\.\.leftDirections, \.\.\.rightDirections\]/);
  assert.match(block, /data-company-health-layout="executive"/);
  assert.match(block, /lg:grid-cols-\[minmax\(280px,0\.4fr\)_minmax\(0,0\.6fr\)\]/);
  assert.match(block, /data-testid="dashboard-company-health-visual"/);
  assert.match(block, /data-testid="dashboard-company-health-directions"/);
  assert.match(block, /data-testid="dashboard-company-health-compact"/);
  assert.match(block, /data-testid="dashboard-company-health-completeness"/);
  assert.match(block, /data-testid="dashboard-company-health-title"/);
  assert.match(block, /rentcore-company-health-main/);
  assert.match(themeSource, /\.rentcore-command-map\[data-company-health-layout="executive"\]\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
});

test('dashboard radial overview has empty and zero-value states without removing the shell', () => {
  const radialBlock = sourceBlock(dashboardSource, 'function CompanyHealthRadialOverview', 'function CompanyHealthCommandCenter');

  assert.match(radialBlock, /const hasScore = typeof score === 'number'/);
  assert.match(radialBlock, /const progress = hasScore \? clampPercent\(score\) : 0/);
  assert.match(radialBlock, /const shouldShowEmpty = !hasScore \|\| directions\.length === 0/);
  assert.match(radialBlock, /data-radial-state=\{shouldShowEmpty \? 'empty' : progress === 0 \? 'zero' : 'ready'\}/);
  assert.match(radialBlock, /\{hasScore \? `\$\{progress\}\/100` : '—'\}/);
  assert.match(radialBlock, /\{hasScore \? label : 'Недостаточно данных'\}/);
  assert.match(radialBlock, /Array\.from\(\{ length: 6 \}/);
  assert.doesNotMatch(radialBlock, /'Нет'/);
  assert.doesNotMatch(radialBlock, /'N\/A'/);
});

test('dashboard company health direction wrapper contains six anchor direction cards', () => {
  const commandCenterBlock = sourceBlock(dashboardSource, 'function CompanyHealthCommandCenter', 'function RiskSignalStrip');
  const cardBlock = sourceBlock(dashboardSource, 'function CompanyHealthDirectionCard', 'function CompanyHealthCommandCenter');
  const directionsBlock = sourceBlock(dashboardSource, 'const commandCenterDirections = [', '].filter(Boolean)');

  assert.match(commandCenterBlock, /data-testid="dashboard-company-health-compact"/);
  assert.match(commandCenterBlock, /directions\.map\(item => <CompanyHealthDirectionCard key=\{item\.id\} item=\{item\} \/>\)/);
  assert.doesNotMatch(commandCenterBlock, /sr-only/);
  assert.match(cardBlock, /<Link[\s\S]*className="rentcore-command-card/);
  assert.match(cardBlock, /title=\{title\}/);
  assert.match(cardBlock, /Статус: \$\{item\.stateLabel \|\| 'Нет данных'\}/);
  assert.match(cardBlock, /Источник: \$\{item\.source\}/);
  assert.match(cardBlock, /Действие: \$\{item\.action\}/);
  assert.match(cardBlock, /rentcore-command-card-title[\s\S]*\{item\.title\}/);
  assert.match(cardBlock, /const primaryMetric = item\.metrics\[0\]/);
  assert.match(cardBlock, /const secondaryMetrics = item\.metrics\.slice\(1, 3\)/);
  assert.match(cardBlock, /rentcore-command-card-compact-value[\s\S]*\{primaryMetric\.value\}/);
  assert.match(cardBlock, /secondaryMetrics\.map\(metric =>/);

  for (const label of ['Деньги', 'Парк техники', 'Сервис', 'Доставка', 'Документы', 'Возвраты']) {
    assert.match(directionsBlock, new RegExp(`title: '${label}'`));
  }
  assert.equal(directionsBlock.match(/id: '/g)?.length, 6);
  assert.equal(directionsBlock.match(/source: '/g)?.length, 6);
  assert.equal(directionsBlock.match(/action: /g)?.length, 6);
});

test('dashboard company health header pills can shrink and wrap on mobile', () => {
  const commandCenterBlock = sourceBlock(dashboardSource, 'function CompanyHealthCommandCenter', 'function RiskSignalStrip');

  assert.match(commandCenterBlock, /className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:shrink-0"/);
  assert.match(commandCenterBlock, /className="min-w-0 max-w-full rounded-full border border-border bg-background px-3 py-1\.5 text-sm font-extrabold text-foreground"/);
  assert.match(commandCenterBlock, /`min-w-0 max-w-full rounded-full border border-border bg-background px-3 py-1\.5 text-sm font-extrabold \$\{toneStyles\[tone\]\.accent\}`/);
  assert.doesNotMatch(commandCenterBlock, /className="flex shrink-0 flex-wrap items-center gap-2"/);
});

test('dashboard company health layout avoids horizontal overflow on narrow containers', () => {
  assert.match(themeSource, /\.rentcore-command-map\[data-company-health-layout="executive"\]\s*\{[\s\S]*width: 100%;/);
  assert.match(themeSource, /\.rentcore-command-column\s*\{[\s\S]*min-width: 0;/);
  assert.match(themeSource, /\.rentcore-command-compact-list\s*\{[\s\S]*width: 100%;/);
  assert.match(themeSource, /\.rentcore-command-health-card\s*\{[\s\S]*container-type: inline-size;[\s\S]*min-height: 420px;/);
  assert.match(themeSource, /\.rentcore-radial-overview\s*\{[\s\S]*width: min\(100%, 260px\);[\s\S]*min-height: clamp\(210px, 18vw, 260px\);[\s\S]*aspect-ratio: 1 \/ 1;[\s\S]*overflow: hidden;/);
  assert.match(themeSource, /\.rentcore-radial-node-label\s*\{[\s\S]*letter-spacing: 0;/);
  assert.match(themeSource, /\.rentcore-radial-empty\s*\{[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: normal;/);
  assert.doesNotMatch(dashboardSource, /estimatedCardWidth > 0 && estimatedCardWidth < 180/);
  assert.doesNotMatch(dashboardSource, /data-card-density=\{cardDensity\}/);
});

test('dashboard reference mode cannot override global app shell sidebar or logo', () => {
  assert.doesNotMatch(themeSource, /rentcore-dashboard-reference-mode[\s\S]{0,220}rentcore-industrial-shell/);
  assert.doesNotMatch(themeSource, /rentcore-dashboard-reference-mode[\s\S]{0,220}>\s*aside/);
  assert.doesNotMatch(themeSource, /rentcore-dashboard-reference-mode[\s\S]{0,220}>\s*header/);
  assert.doesNotMatch(themeSource, /rentcore-dashboard-reference-mode[\s\S]{0,220}>\s*main/);
  assert.doesNotMatch(themeSource, /rentcore-dashboard-reference-mode[\s\S]{0,220}app-shell-title/);
});

test('dashboard KPI cards prefer readable wrapping over compression', () => {
  assert.match(dashboardSource, /repeat\(auto-fit,minmax\(220px,1fr\)\)/);
  assert.match(dashboardSource, /min-w-\[220px\]/);
  assert.match(dashboardSource, /dashboard-kpi-value/);
  assert.match(themeSource, /\.dashboard-kpi-value\s*\{[\s\S]*word-break: normal;[\s\S]*overflow-wrap: normal;[\s\S]*hyphens: none;/);
  assert.doesNotMatch(dashboardSource, /xl:grid-cols-7/);
  assert.doesNotMatch(sourceBlock(dashboardSource, 'data-testid="dashboard-executive-cockpit"', '<section className="rentcore-command-board'), /break-words/);
});
