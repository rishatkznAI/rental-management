import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);

function read(path) {
  return readFileSync(new URL(path, root), 'utf8');
}

test('Documents page supports quick action create and client filtering context', () => {
  const source = read('src/app/pages/Documents.tsx');

  assert.match(source, /useSearchParams/);
  assert.match(source, /buildQuickActionContext/);
  assert.match(source, /quickActionContext\.action !== 'create'/);
  assert.match(source, /openContractCreate\('rental'/);
  assert.match(source, /matchesClientContext/);
  assert.match(source, /Документы по клиенту не найдены/);
});

test('Payments page applies quick action filters and opens explicit create flow', () => {
  const source = read('src/app/pages/Payments.tsx');

  assert.match(source, /useSearchParams/);
  assert.match(source, /buildQuickActionContext/);
  assert.match(source, /setPaginationFilters\(\{ clientId:/);
  assert.match(source, /searchParams\.get\('action'\) === 'create'/);
  assert.match(source, /setShowAddModal\(true\)/);
  assert.match(source, /nextSearchParams\.delete\('action'\)/);
  assert.match(source, /setSearchParams\(nextSearchParams, \{ replace: true \}\)/);
  assert.match(source, /onClose=\{closeAddPaymentModal\}/);
  assert.match(source, /onSuccess: closeAddPaymentModal/);
  assert.match(source, /Платежи по клиенту не найдены/);

  const rentals = read('src/app/pages/Rentals.tsx');
  assert.match(rentals, /to="\/payments\?action=create"/);
});

test('Tasks center applies quick action client filter and client empty state', () => {
  const source = read('src/app/pages/TasksCenter.tsx');

  assert.match(source, /useSearchParams/);
  assert.match(source, /buildQuickActionContext/);
  assert.match(source, /matchesClientContext/);
  assert.match(source, /Задач по клиенту не найдено/);
});
