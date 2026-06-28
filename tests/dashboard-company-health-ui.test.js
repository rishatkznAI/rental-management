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

test('dashboard company health renders a compact status card without dominant SVG', () => {
  const block = sourceBlock(dashboardSource, 'function CompanyHealthCommandCenter', 'function RiskSignalStrip');

  assert.match(block, /role="region"/);
  assert.match(block, /aria-label=\{hasScore \? `Здоровье компании \$\{progress\} из 100: \$\{label\}` : `Здоровье компании: \$\{label\}`\}/);
  assert.match(block, /data-testid="dashboard-company-health"/);
  assert.match(block, /data-company-health-layout="compact-card"/);
  assert.match(block, /data-testid="dashboard-company-health-compact"/);
  assert.match(block, /Недостаточно данных: показатели появятся после поступлений, аренд, сервисных заявок и доставок\./);
  assert.match(block, /<CompanyHealthBars items=\{bars\} \/>/);
  assert.doesNotMatch(block, /data-testid="dashboard-company-health-svg"/);
  assert.doesNotMatch(block, /new ResizeObserver/);
  assert.doesNotMatch(block, /window\.innerWidth/);
});

test('dashboard company health compact card does not position contour points manually', () => {
  const block = sourceBlock(dashboardSource, 'function CompanyHealthCommandCenter', 'function RiskSignalStrip');

  assert.match(dashboardSource, /function polarToCartesian/);
  assert.doesNotMatch(block, /polarToCartesian\(center, center, radius, angle\)/);
  assert.doesNotMatch(block, /data-testid="dashboard-company-health-point"/);
  assert.doesNotMatch(block, /\btop\b|\bleft\b/);
});

test('dashboard company health always uses compact list layout', () => {
  const block = sourceBlock(dashboardSource, 'function CompanyHealthCommandCenter', 'function RiskSignalStrip');

  assert.match(block, /const directions = allDirections\.length > 0 \? allDirections : \[\.\.\.leftDirections, \.\.\.rightDirections\]/);
  assert.match(block, /data-company-health-layout="compact-card"/);
  assert.match(block, /data-testid="dashboard-company-health-compact"/);
  assert.match(block, /data-testid="dashboard-company-health-title"/);
  assert.match(themeSource, /\.rentcore-command-map\[data-company-health-layout="compact-card"\]\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
});

test('dashboard company health compact wrapper contains six anchor direction cards', () => {
  const commandCenterBlock = sourceBlock(dashboardSource, 'function CompanyHealthCommandCenter', 'function RiskSignalStrip');
  const cardBlock = sourceBlock(dashboardSource, 'function CompanyHealthDirectionCard', 'function CompanyHealthCommandCenter');
  const compactWrapperBlock = sourceBlock(commandCenterBlock, 'data-testid="dashboard-company-health-compact"', '<div>');
  const directionsBlock = sourceBlock(dashboardSource, 'const commandCenterDirections = [', '].filter(Boolean)');

  assert.match(compactWrapperBlock, /directions\.map\(item => <CompanyHealthDirectionCard key=\{item\.id\} item=\{item\} \/>\)/);
  assert.doesNotMatch(compactWrapperBlock, /sr-only/);
  assert.match(cardBlock, /<Link[\s\S]*className="rentcore-command-card/);
  assert.match(cardBlock, /title=\{title\}/);
  assert.match(cardBlock, /rentcore-command-card-title[\s\S]*\{item\.title\}/);
  assert.match(cardBlock, /rentcore-command-card-compact-value[\s\S]*\{item\.metrics\[0\]\?\.value \?\? ''\}/);

  for (const label of ['Деньги', 'Парк техники', 'Сервис', 'Доставка', 'Документы', 'Возвраты']) {
    assert.match(directionsBlock, new RegExp(`title: '${label}'`));
  }
  assert.equal(directionsBlock.match(/id: '/g)?.length, 6);
});

test('dashboard company health layout avoids horizontal overflow on narrow containers', () => {
  assert.match(themeSource, /\.rentcore-command-map\[data-company-health-layout="compact-card"\]\s*\{[\s\S]*width: 100%;/);
  assert.match(themeSource, /\.rentcore-command-column\s*\{[\s\S]*min-width: 0;/);
  assert.match(themeSource, /\.rentcore-command-compact-list\s*\{[\s\S]*width: 100%;/);
  assert.match(themeSource, /\.rentcore-command-health-card\s*\{[\s\S]*min-height: 0;/);
  assert.doesNotMatch(dashboardSource, /estimatedCardWidth > 0 && estimatedCardWidth < 180/);
  assert.doesNotMatch(dashboardSource, /data-card-density=\{cardDensity\}/);
  assert.match(themeSource, /\.rentcore-command-map\[data-card-density="icon-value"\] \.rentcore-command-card-compact-value\s*\{[\s\S]*display: inline-flex !important;/);
  assert.match(themeSource, /@container \(max-width: 179px\)/);
});
