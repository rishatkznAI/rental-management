import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildSparePartsImportPlan,
  parseCsv,
  sparePartsToCsv,
} from '../src/app/lib/sparePartsImportExport.js';

const NOW = '2026-05-04T10:00:00.000Z';

function part(overrides) {
  return {
    id: 'PT-1',
    name: 'Фильтр',
    article: 'FLT-1',
    sku: 'FLT-1',
    unit: 'шт',
    defaultPrice: 100,
    category: 'Фильтры',
    manufacturer: 'Parker',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('spare parts import creates new parts from CSV', () => {
  const csv = 'Наименование;Артикул;Категория;Единица измерения;Цена;Поставщик\nНасос;PMP-1;Гидравлика;шт;1500;Bosch';
  const plan = buildSparePartsImportPlan([], csv, { now: NOW });

  assert.equal(plan.stats.added, 1);
  assert.equal(plan.stats.updated, 0);
  assert.equal(plan.parts.length, 1);
  assert.equal(plan.parts[0].name, 'Насос');
  assert.equal(plan.parts[0].article, 'PMP-1');
  assert.equal(plan.parts[0].manufacturer, 'Bosch');
  assert.equal(plan.parts[0].defaultPrice, 1500);
});

test('spare parts import updates existing part by article', () => {
  const existing = [part({ name: 'Старый фильтр', article: 'FLT-1', defaultPrice: 100 })];
  const csv = 'Наименование;Артикул;Цена\nФильтр обновленный;FLT-1;250';
  const plan = buildSparePartsImportPlan(existing, csv, { now: NOW });

  assert.equal(plan.stats.added, 0);
  assert.equal(plan.stats.updated, 1);
  assert.equal(plan.parts.length, 1);
  assert.equal(plan.parts[0].id, 'PT-1');
  assert.equal(plan.parts[0].name, 'Фильтр обновленный');
  assert.equal(plan.parts[0].defaultPrice, 250);
});

test('spare parts import preserves existing price when CSV price is empty', () => {
  const existing = [part({ article: 'FLT-1', defaultPrice: 777 })];
  const csv = 'Наименование;Артикул;Цена\nФильтр;FLT-1;';
  const plan = buildSparePartsImportPlan(existing, csv, { now: NOW });

  assert.equal(plan.stats.updated, 1);
  assert.equal(plan.parts[0].defaultPrice, 777);
});

test('spare parts import updates by normalized name when article is empty', () => {
  const existing = [part({ name: '  Гидронасос  ', article: undefined, sku: undefined })];
  const csv = 'Наименование;Артикул;Цена\nгидронасос;;999';
  const plan = buildSparePartsImportPlan(existing, csv, { now: NOW });

  assert.equal(plan.stats.added, 0);
  assert.equal(plan.stats.updated, 1);
  assert.equal(plan.parts.length, 1);
  assert.equal(plan.parts[0].id, 'PT-1');
  assert.equal(plan.parts[0].defaultPrice, 999);
});

test('spare parts import does not create duplicates for repeated article rows', () => {
  const csv = 'Наименование;Артикул;Цена\nНасос;PMP-1;100\nНасос новый;PMP-1;200';
  const plan = buildSparePartsImportPlan([], csv, { now: NOW });

  assert.equal(plan.stats.added, 1);
  assert.equal(plan.stats.updated, 1);
  assert.equal(plan.parts.length, 1);
  assert.equal(plan.parts[0].name, 'Насос новый');
  assert.equal(plan.parts[0].defaultPrice, 200);
});

test('spare parts import skips rows without name', () => {
  const csv = 'Наименование;Артикул;Цена\n ;EMPTY;100\nФильтр;FLT-2;200';
  const plan = buildSparePartsImportPlan([], csv, { now: NOW });

  assert.equal(plan.stats.skipped, 1);
  assert.equal(plan.stats.added, 1);
  assert.equal(plan.parts.length, 1);
  assert.equal(plan.parts[0].article, 'FLT-2');
});

test('spare parts import reports invalid price errors', () => {
  const csv = 'Наименование;Артикул;Цена\nФильтр;FLT-2;abc';
  const plan = buildSparePartsImportPlan([], csv, { now: NOW });

  assert.equal(plan.stats.errors, 1);
  assert.equal(plan.parts.length, 0);
  assert.match(plan.errors[0], /цена/);
});

test('spare parts import keeps existing parts when CSV is empty', () => {
  const existing = [part({ id: 'PT-1', name: 'Фильтр' })];
  const plan = buildSparePartsImportPlan(existing, '', { now: NOW });

  assert.equal(plan.stats.errors, 1);
  assert.equal(plan.parts.length, 1);
  assert.equal(plan.parts[0].id, 'PT-1');
  assert.equal(plan.parts[0].name, 'Фильтр');
});

test('spare parts import keeps existing parts when CSV headers are invalid', () => {
  const existing = [part({ id: 'PT-1', name: 'Фильтр' })];
  const plan = buildSparePartsImportPlan(existing, 'repair_part_items;quantity\nRPI-1;3', { now: NOW });

  assert.equal(plan.stats.errors, 1);
  assert.equal(plan.parts.length, 1);
  assert.equal(plan.parts[0].id, 'PT-1');
  assert.equal(plan.parts[0].name, 'Фильтр');
});

test('spare parts export returns only spare part columns and values', () => {
  const csv = sparePartsToCsv([
    part({ id: 'PT-1', name: 'Фильтр', article: 'FLT-1' }),
    part({ id: 'PT-2', name: 'Насос', article: 'PMP-1', manufacturer: 'Bosch' }),
  ]);
  const rows = parseCsv(csv);

  assert.deepEqual(rows[0], ['Наименование', 'Артикул', 'Категория', 'Единица измерения', 'Цена', 'Поставщик', 'Комментарий']);
  assert.equal(rows.length, 3);
  assert.equal(rows[1][0], 'Фильтр');
  assert.equal(rows[2][1], 'PMP-1');
  assert.equal(rows[2][5], 'Bosch');
  assert.equal(csv.includes('repair_part_items'), false);
});

test('spare parts import/export helper does not read repair part item collection', () => {
  const source = readFileSync(new URL('../src/app/lib/sparePartsImportExport.js', import.meta.url), 'utf8');

  assert.equal(source.includes('repair_part_items'), false);
});
