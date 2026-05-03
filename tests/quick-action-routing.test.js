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

test('Payments page applies quick action client filter without touching Finance page', () => {
  const source = read('src/app/pages/Payments.tsx');

  assert.match(source, /useSearchParams/);
  assert.match(source, /buildQuickActionContext/);
  assert.match(source, /matchesClientContext/);
  assert.match(source, /Платежи по клиенту не найдены/);
});

test('Tasks center applies quick action client filter and client empty state', () => {
  const source = read('src/app/pages/TasksCenter.tsx');

  assert.match(source, /useSearchParams/);
  assert.match(source, /buildQuickActionContext/);
  assert.match(source, /matchesClientContext/);
  assert.match(source, /Задач по клиенту не найдено/);
});
