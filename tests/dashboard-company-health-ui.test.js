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

test('dashboard company health renders a responsive SVG built from ResizeObserver', () => {
  const block = sourceBlock(dashboardSource, 'function CompanyHealthCommandCenter', 'function RiskSignalStrip');

  assert.match(block, /new ResizeObserver/);
  assert.match(block, /containerRef/);
  assert.match(block, /data-size-source="ResizeObserver"/);
  assert.match(block, /<svg[\s\S]*data-testid="dashboard-company-health-svg"/);
  assert.doesNotMatch(block, /window\.innerWidth/);
});

test('dashboard company health points are SVG circles from polarToCartesian without inline top or left', () => {
  const block = sourceBlock(dashboardSource, 'function CompanyHealthCommandCenter', 'function RiskSignalStrip');
  const pointBlock = sourceBlock(block, 'data-testid="dashboard-company-health-point"', '/>');

  assert.match(dashboardSource, /function polarToCartesian/);
  assert.match(block, /polarToCartesian\(center, center, radius, angle\)/);
  assert.match(pointBlock, /cx=\{point\.x\}/);
  assert.match(pointBlock, /cy=\{point\.y\}/);
  assert.doesNotMatch(pointBlock, /\bstyle=\{/);
  assert.doesNotMatch(pointBlock, /\btop\b|\bleft\b/);
});

test('dashboard company health uses compact list fallback below 900px container width', () => {
  const block = sourceBlock(dashboardSource, 'function CompanyHealthCommandCenter', 'function RiskSignalStrip');

  assert.match(block, /containerWidth < 900/);
  assert.match(block, /data-company-health-layout=\{isCompact \? 'compact' : 'svg'\}/);
  assert.match(block, /data-testid="dashboard-company-health-compact-list"/);
  assert.match(themeSource, /\.rentcore-command-map\[data-company-health-layout="compact"\]\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
});

test('dashboard company health layout avoids horizontal overflow on narrow containers', () => {
  assert.match(themeSource, /\.rentcore-command-map\s*\{[\s\S]*width: min\(100%, var\(--rc-map-w\)\);/);
  assert.match(themeSource, /\.rentcore-command-column\s*\{[\s\S]*min-width: 0;/);
  assert.match(themeSource, /\.rentcore-command-compact-list\s*\{[\s\S]*width: 100%;/);
  assert.match(dashboardSource, /estimatedCardWidth > 0 && estimatedCardWidth < 180/);
  assert.match(dashboardSource, /data-card-density=\{cardDensity\}/);
  assert.match(themeSource, /\.rentcore-command-map\[data-card-density="icon-value"\] \.rentcore-command-card-compact-value\s*\{[\s\S]*display: inline-flex !important;/);
  assert.match(themeSource, /@container \(max-width: 179px\)/);
});
