import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/app/pages/Deliveries.tsx', import.meta.url), 'utf8');

function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('delivery page preserves desktop table while exposing mobile cards', () => {
  assert.match(source, /data-delivery-responsive-ui="true"/);
  assert.match(source, /data-delivery-mobile-cards="true"/);
  assert.match(source, /className="space-y-3 p-3 md:hidden"/);
  assert.match(source, /data-delivery-desktop-table="true"/);
  assert.match(source, /className="hidden overflow-x-auto md:block"/);
  assert.match(source, /<table className="w-full min-w-\[1360px\] text-sm">/);
});

test('delivery mobile cards contain safe route, badge, and action structure', () => {
  const mobileCardsBlock = extract('data-delivery-mobile-cards="true"', 'data-delivery-desktop-table="true"');

  assert.match(mobileCardsBlock, /data-delivery-mobile-card="true"/);
  assert.match(mobileCardsBlock, /data-delivery-mobile-badges="true"/);
  assert.match(mobileCardsBlock, /data-delivery-mobile-route="true"/);
  assert.match(mobileCardsBlock, /<DropdownMenu\.Root>/);
  assert.match(mobileCardsBlock, /aria-label=\{`Действия доставки \$\{delivery\.id\}`\}/);
  assert.match(mobileCardsBlock, /\[overflow-wrap:anywhere\]/);
  assert.match(mobileCardsBlock, /break-words/);
  assert.match(mobileCardsBlock, /setDetailTab\('route'\)/);
});

test('delivery list avoids table-only mobile layout', () => {
  const listBlock = extract('data-delivery-list-region="true"', '<PaginationControls');

  assert.match(listBlock, /viewMode === 'compact'/);
  assert.match(listBlock, /data-delivery-compact-cards="true"/);
  assert.match(listBlock, /data-delivery-mobile-cards="true"[\s\S]*data-delivery-desktop-table="true"/);
  assert.doesNotMatch(listBlock, /<div className="overflow-x-auto">\s*<table/);
});

test('delivery sheets and filters are constrained for mobile overflow', () => {
  assert.match(source, /data-delivery-form-sheet="true"/);
  assert.match(source, /data-delivery-detail-sheet="true"/);
  assert.match(source, /data-delivery-detail-responsive="true"/);
  assert.match(source, /data-delivery-detail-actions="true"/);
  assert.match(source, /data-delivery-filter-panel="true"/);
  assert.match(source, /overflow-y-auto overflow-x-hidden/);
  assert.match(source, /className="w-full sm:w-auto"/);
  assert.match(source, /className="w-full min-w-0"/);
});
