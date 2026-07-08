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

test('dashboard company health renders premium trend overview with stable compatibility selectors', () => {
  const block = sourceBlock(dashboardSource, 'function CompanyHealthCommandCenter', 'function RiskSignalStrip');
  const trendBlock = sourceBlock(dashboardSource, 'function CompanyHealthTrendOverview', 'function CompanyHealthCommandCenter');

  assert.match(block, /role="region"/);
  assert.match(block, /aria-label=\{hasScore \? `Здоровье компании \$\{progress\} из 100: \$\{label\}` : `Здоровье компании: \$\{label\}`\}/);
  assert.match(block, /data-testid="dashboard-company-health"/);
  assert.match(block, /data-company-health-layout="executive"/);
  assert.match(block, /company-health-premium/);
  assert.match(block, /<CompanyHealthTrendOverview/);
  assert.match(block, /data-testid="dashboard-company-health-score"/);
  assert.match(trendBlock, /data-testid="dashboard-radial-overview"/);
  assert.match(trendBlock, /data-testid="dashboard-radial-core"/);
  assert.match(trendBlock, /data-testid="dashboard-radial-node"/);
  assert.match(trendBlock, /data-testid="dashboard-radial-empty"/);
  assert.match(trendBlock, /Тренд здоровья компании/);
  assert.match(trendBlock, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.match(block, /data-testid="dashboard-company-health-visual"/);
  assert.match(block, /data-testid="dashboard-company-health-directions"/);
  assert.match(block, /data-testid="dashboard-company-health-completeness"/);
  assert.match(block, /data-testid="dashboard-company-health-compact"/);
  assert.match(block, /data-testid="dashboard-company-health-segments"/);
  assert.match(block, /Индекс здоровья/);
  assert.match(block, /Контуры/);
  assert.match(block, /riskBadgeLabel/);
  assert.match(block, /const completenessText = \[/);
  assert.doesNotMatch(block, /<CompanyHealthBars items=\{bars\} \/>/);
  assert.doesNotMatch(block, /rentcore-company-health-main/);
  assert.doesNotMatch(block, /new ResizeObserver/);
  assert.doesNotMatch(block, /window\.innerWidth/);
  assert.doesNotMatch(dashboardSource, /Дашборд ещё собирает управленческую картину/);
});

test('dashboard company health trend uses line and area paths instead of radial math', () => {
  const trendBlock = sourceBlock(dashboardSource, 'function CompanyHealthTrendOverview', 'function CompanyHealthCommandCenter');

  assert.match(dashboardSource, /function smoothSvgPath/);
  assert.match(trendBlock, /const periods = \['Янв', 'Фев', 'Мар', 'Апр', 'Май'\]/);
  assert.match(trendBlock, /const series = \[/);
  assert.match(trendBlock, /companyHealthAreaHealth/);
  assert.match(trendBlock, /companyHealthTrendGlow/);
  assert.match(trendBlock, /nodePoints\.map/);
  assert.doesNotMatch(dashboardSource, /function polarToCartesian/);
  assert.doesNotMatch(dashboardSource, /describeArc/);
  assert.doesNotMatch(trendBlock, /<circle[^>]+r="52"/);
});

test('dashboard company health is one integrated executive analytics card', () => {
  const block = sourceBlock(dashboardSource, 'function CompanyHealthCommandCenter', 'function RiskSignalStrip');

  assert.match(block, /const directionOrder = \['money', 'fleet', 'service', 'documents', 'delivery', 'returns'\]/);
  assert.match(block, /\.sort\(\(a, b\) => directionOrder\.indexOf\(a\.id\) - directionOrder\.indexOf\(b\.id\)\)/);
  assert.match(block, /data-company-health-layout="executive"/);
  assert.match(block, /data-testid="dashboard-company-health-score"/);
  assert.match(block, /data-testid="dashboard-company-health-segments"/);
  assert.match(block, /data-testid="dashboard-company-health-visual"/);
  assert.match(block, /data-testid="dashboard-company-health-directions"/);
  assert.match(block, /data-testid="dashboard-company-health-compact"/);
  assert.match(block, /data-testid="dashboard-company-health-completeness"/);
  assert.match(block, /data-testid="dashboard-company-health-title"/);
  assert.match(block, /company-health-header/);
  assert.match(block, /company-health-status-row/);
  assert.match(block, /company-health-segmented-bar/);
  assert.match(block, /company-health-visual-panel/);
  assert.match(block, /company-health-direction-summary/);
  assert.match(block, /company-health-completeness-strip/);
  assert.doesNotMatch(block, /company-health-score-panel/);
  assert.doesNotMatch(block, /lg:grid-cols-\[220px_minmax/);
  assert.match(themeSource, /\.rentcore-command-map\[data-company-health-layout="executive"\]\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(themeSource, /@media \(min-width: 1280px\)\s*\{[\s\S]*\.rentcore-command-map\[data-company-health-layout="executive"\]\s*\{[\s\S]*max-width: 900px;/);
});

test('dashboard company health renders status row, segmented bar, chart, signals and local data strip', () => {
  const block = sourceBlock(dashboardSource, 'function CompanyHealthCommandCenter', 'function RiskSignalStrip');
  const trendBlock = sourceBlock(dashboardSource, 'function CompanyHealthTrendOverview', 'function CompanyHealthCommandCenter');

  assert.match(block, /data-testid="dashboard-company-health-title">Здоровье компании<\/CardTitle>/);
  assert.match(block, /\{executiveStatus\}/);
  assert.match(block, /data-testid="dashboard-company-health-score"/);
  assert.match(block, /data-testid="dashboard-company-health-segments"/);
  assert.match(block, /data-testid="dashboard-company-health-visual"/);
  assert.match(block, /data-testid="dashboard-company-health-directions"/);
  assert.match(block, /data-testid="dashboard-company-health-completeness"/);
  assert.match(block, /businessSignals\.map\(item => <CompanyHealthSignalCard key=\{item\.id\} item=\{item\} \/>\)/);
  assert.match(block, /title=\{warning \? warning\.replace/);
  assert.match(trendBlock, /<path[\s\S]*strokeWidth=\{line\.key === 'health' \? 4 : 2\.5\}/);
  assert.doesNotMatch(trendBlock, />Нет</);
});

test('dashboard company health exposes weighted score explanation', () => {
  const block = sourceBlock(dashboardSource, 'function CompanyHealthCommandCenter', 'function RiskSignalStrip');

  assert.match(block, /data-testid="dashboard-company-health-explanation-toggle"/);
  assert.match(block, /aria-expanded=\{isExplanationOpen\}/);
  assert.match(block, /Расшифровка/);
  assert.match(block, /data-testid="dashboard-company-health-explanation"/);
  assert.match(block, /data-testid="dashboard-company-health-explanation-close"/);
  assert.match(block, /data-testid="dashboard-company-health-explanation-total"/);
  assert.match(block, /data-testid="dashboard-company-health-explanation-breakdown"/);
  assert.match(block, /data-testid=\{`dashboard-company-health-explanation-\$\{direction\.key\}`\}/);
  assert.match(block, /\{Math\.round\(direction\.score\)\}\/100 × \{formatHealthWeight\(direction\.weight\)\} = \{formatHealthContribution\(direction\.weightedContribution\)\}/);
  assert.match(block, /Недостаточно данных · /);
  assert.match(block, /data-testid="dashboard-company-health-explanation-focus"/);
  assert.match(block, /Сначала исправить:/);
  assert.match(block, /focusDirections/);

  for (const formulaPart of ['Финансы 30%', 'Аренда 25%', 'Риски 20%', 'Сервис 15%', 'Клиенты 7%', 'Парк 3%']) {
    assert.match(block, new RegExp(formulaPart));
  }

  assert.match(themeSource, /\.company-health-explanation-popover\s*\{[\s\S]*position: absolute;[\s\S]*bottom: 9px;[\s\S]*overflow: auto;/);
  assert.match(themeSource, /@container \(max-width: 520px\)\s*\{[\s\S]*\.company-health-explanation-popover\s*\{[\s\S]*top: 148px;[\s\S]*bottom: 9px;/);
});

test('dashboard trend overview has empty and zero-value states without letting empty copy dominate', () => {
  const trendBlock = sourceBlock(dashboardSource, 'function CompanyHealthTrendOverview', 'function CompanyHealthCommandCenter');

  assert.match(trendBlock, /const hasScore = typeof score === 'number'/);
  assert.match(trendBlock, /const progress = hasScore \? clampPercent\(score\) : 0/);
  assert.match(trendBlock, /const shouldShowEmpty = !hasScore \|\| bars\.every\(item => item\.value <= 0\)/);
  assert.match(trendBlock, /data-radial-state=\{shouldShowEmpty \? 'empty' : progress === 0 \? 'zero' : 'ready'\}/);
  assert.match(trendBlock, /\{hasScore \? `\$\{progress\}\/100` : label\}/);
  assert.match(trendBlock, /недостаточно данных/);
  assert.doesNotMatch(trendBlock, /'Нет'/);
  assert.doesNotMatch(trendBlock, /'N\/A'/);
});

test('dashboard company health bottom row contains six compact business signal cards', () => {
  const commandCenterBlock = sourceBlock(dashboardSource, 'function CompanyHealthCommandCenter', 'function RiskSignalStrip');
  const cardBlock = sourceBlock(dashboardSource, 'function CompanyHealthSignalCard', 'function CompanyHealthTrendOverview');
  const directionsBlock = sourceBlock(dashboardSource, 'const commandCenterDirections = [', '].filter(Boolean)');

  assert.match(commandCenterBlock, /data-testid="dashboard-company-health-compact"/);
  assert.match(commandCenterBlock, /const businessSignals: CompanyHealthSignal\[] = \[/);
  assert.match(commandCenterBlock, /businessSignals\.map\(item => <CompanyHealthSignalCard key=\{item\.id\} item=\{item\} \/>\)/);
  assert.match(cardBlock, /<Link[\s\S]*className="rentcore-command-card company-health-signal/);
  assert.match(cardBlock, /title=\{title\}/);
  assert.match(cardBlock, /rentcore-command-card-title[\s\S]*\{item\.title\}/);
  assert.match(cardBlock, /rentcore-command-card-compact-value[\s\S]*\{item\.metric\}/);
  assert.match(cardBlock, /\{item\.detail\}/);
  assert.doesNotMatch(cardBlock, /Статус:/);
  assert.doesNotMatch(cardBlock, /line-clamp-1/);

  for (const label of ['Аренда', 'Финансы', 'Сервис', 'Клиенты', 'Парк', 'Риски']) {
    assert.match(commandCenterBlock, new RegExp(`'${label}'`));
  }
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
  assert.match(commandCenterBlock, /className="company-health-pill min-w-0 max-w-full rounded-full px-3 py-1 text-sm font-extrabold text-white"/);
  assert.match(commandCenterBlock, /riskBadgeLabel/);
  assert.doesNotMatch(commandCenterBlock, /className="flex shrink-0 flex-wrap items-center gap-2"/);
});

test('dashboard company health layout avoids horizontal overflow on narrow containers', () => {
  assert.match(themeSource, /\.rentcore-command-map\[data-company-health-layout="executive"\]\s*\{[\s\S]*width: 100%;/);
  assert.match(themeSource, /\.rentcore-command-column\s*\{[\s\S]*min-width: 0;/);
  assert.match(themeSource, /\.rentcore-command-compact-list\s*\{[\s\S]*width: 100%;/);
  assert.match(themeSource, /\.rentcore-command-health-card\s*\{[\s\S]*container-type: inline-size;[\s\S]*min-height: 260px;/);
  assert.match(themeSource, /\.rentcore-radial-overview\s*\{[\s\S]*width: 100%;[\s\S]*min-height: 156px;[\s\S]*height: 156px;[\s\S]*overflow: hidden;/);
  assert.match(themeSource, /\.company-health-signals-grid\s*\{[\s\S]*grid-template-columns: repeat\(6, minmax\(0, 1fr\)\);/);
  assert.match(themeSource, /@container \(max-width: 860px\)\s*\{[\s\S]*\.company-health-signals-grid\s*\{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(themeSource, /@container \(max-width: 520px\)\s*\{[\s\S]*\.company-health-signals-grid\s*\{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
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
