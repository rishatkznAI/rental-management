import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const listSource = readFileSync(new URL('../src/app/pages/ServiceVehicles.tsx', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('../src/app/pages/ServiceVehicleDetail.tsx', import.meta.url), 'utf8');

test('service vehicles list uses mobile cards instead of a horizontal-only table', () => {
  assert.match(listSource, /<VehicleCard[\s\S]*vehicle=\{v\}/);
  assert.match(listSource, /className="space-y-3 md:hidden"/);
  assert.match(listSource, /className="hidden overflow-x-auto[\s\S]*md:block"/);
});

test('service vehicles list formats missing legacy mileage safely', () => {
  assert.match(listSource, /function formatMileage\(value: unknown\): string/);
  assert.match(listSource, /const safeMileage = Number\.isFinite\(mileage\) && mileage >= 0 \? mileage : 0/);
  assert.match(listSource, /safeMileage\.toLocaleString\('ru-RU'\)/);
  assert.doesNotMatch(listSource, /currentMileage\.toLocaleString/);
});

test('service vehicle trips use mobile cards and keep the desktop table at md and above', () => {
  assert.match(detailSource, /<TripCard[\s\S]*trip=\{trip\}/);
  assert.match(detailSource, /className="space-y-3 md:hidden"/);
  assert.match(detailSource, /className="hidden rounded-lg[\s\S]*md:block"/);
});
