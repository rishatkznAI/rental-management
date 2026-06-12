import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/app/pages/Planner.tsx', import.meta.url), 'utf8');

function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('planner preserves desktop table while exposing mobile cards', () => {
  assert.match(source, /data-planner-responsive-root="true"[\s\S]*overflow-x-clip/);
  assert.match(source, /data-planner-mobile-list="true" className="space-y-3 md:hidden"/);
  assert.match(source, /data-planner-mobile-card="true"/);
  assert.match(source, /data-planner-desktop-table="true" className="hidden overflow-x-auto[\s\S]*md:block"/);
  assert.match(source, /<table className="min-w-\[1120px\] w-full text-sm border-collapse">/);
});

test('planner mobile cards expose equipment period status client and actions', () => {
  const mobileBlock = extract('data-planner-mobile-list="true"', 'data-planner-desktop-table="true"');

  assert.match(mobileBlock, /data-planner-mobile-equipment="true"/);
  assert.match(mobileBlock, /data-planner-mobile-period="true"/);
  assert.match(mobileBlock, /data-planner-mobile-equipment-status="true"/);
  assert.match(mobileBlock, /data-planner-mobile-client="true"/);
  assert.match(mobileBlock, /data-planner-mobile-status="true"/);
  assert.match(mobileBlock, /data-planner-mobile-actions="true"/);
  assert.match(mobileBlock, /PrepStatusBadge/);
  assert.match(mobileBlock, /CommentCell/);
  assert.match(mobileBlock, /handleRiskToggle\(row\)/);
});

test('planner mobile structure is safe for narrow screens and long labels', () => {
  const mobileBlock = extract('data-planner-mobile-list="true"', 'data-planner-desktop-table="true"');

  assert.match(mobileBlock, /min-w-0/);
  assert.match(mobileBlock, /break-words/);
  assert.match(mobileBlock, /\[overflow-wrap:anywhere\]/);
  assert.match(mobileBlock, /grid min-w-0 grid-cols-1 gap-2 text-xs min-\[360px\]:grid-cols-2/);
  assert.match(mobileBlock, /inline-flex w-full items-center justify-center/);
  assert.doesNotMatch(mobileBlock, /<table/);
  assert.doesNotMatch(mobileBlock, /whitespace-nowrap[\s\S]{0,180}data-planner-mobile/);
});

test('planner empty state has readable reset path on filtered mobile views', () => {
  assert.match(source, /data-planner-empty-state="true"/);
  assert.match(source, /Нет записей/);
  assert.match(source, /Попробуйте изменить фильтры/);
  assert.match(source, /onClick=\{resetFilters\}/);
  assert.match(source, /Сбросить фильтры/);
});

test('planner responsive changes stay presentation-only', () => {
  assert.match(source, /usePlannerRows\(plannerQuery\)/);
  assert.match(source, /useUpdatePlannerItem\(includeShipped\)/);
  assert.match(source, /plannerDateWindow\(filters\)/);
  assert.match(source, /matchesDateRange\(row, filters\)/);
  assert.doesNotMatch(source, /\/api\//);
});
