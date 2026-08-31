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

test('spare parts import updates an existing record only by exact logical ID', () => {
  const existing = [part({ name: 'Старый фильтр', article: 'FLT-1', defaultPrice: 100 })];
  const csv = 'ID;Наименование;Артикул;Цена\nPT-1;Фильтр обновленный;FLT-1;250';
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
  const csv = 'ID;Наименование;Артикул;Цена\nPT-1;Фильтр;FLT-1;';
  const plan = buildSparePartsImportPlan(existing, csv, { now: NOW });

  assert.equal(plan.stats.updated, 1);
  assert.equal(plan.parts[0].defaultPrice, 777);
});

test('spare parts import never links a row by normalized name or article', () => {
  const existing = [part({ name: '  Гидронасос  ', article: 'PMP-1', sku: 'PMP-1' })];
  const csv = 'Наименование;Артикул;Цена\nгидронасос;PMP-1;999';
  const plan = buildSparePartsImportPlan(existing, csv, { now: NOW });

  assert.equal(plan.stats.added, 1);
  assert.equal(plan.stats.updated, 0);
  assert.equal(plan.parts.length, 2);
  assert.equal(plan.parts[0].id, 'PT-1');
  assert.equal(plan.parts[0].defaultPrice, 100);
  assert.notEqual(plan.parts[1].id, 'PT-1');
  assert.equal(plan.parts[1].defaultPrice, 999);
  assert.equal(Object.hasOwn(plan.parts[1], 'platformDefaultId'), false);
  assert.equal(Object.hasOwn(plan.parts[1], 'companyId'), false);
  assert.equal(Object.hasOwn(plan.parts[1], 'tenantId'), false);
});

test('spare parts import treats repeated natural keys with blank IDs as standalone entries', () => {
  const csv = 'Наименование;Артикул;Цена\nНасос;PMP-1;100\nНасос новый;PMP-1;200';
  const plan = buildSparePartsImportPlan([], csv, { now: NOW });

  assert.equal(plan.stats.added, 2);
  assert.equal(plan.stats.updated, 0);
  assert.equal(plan.parts.length, 2);
  assert.notEqual(plan.parts[0].id, plan.parts[1].id);
  assert.equal(plan.parts[0].defaultPrice, 100);
  assert.equal(plan.parts[1].defaultPrice, 200);
});

test('spare parts import keeps the logical platform ID and trusted origin for an override update', () => {
  const catalogOrigin = Object.freeze({
    kind: 'platform_default',
    logicalId: 'PLATFORM-PART-1',
    tenantMutable: false,
  });
  const existing = [part({
    id: 'PLATFORM-PART-1',
    name: 'Платформенный фильтр',
    catalogOrigin,
  })];
  const csv = 'ID;Наименование;Цена\nPLATFORM-PART-1;Фильтр компании;350';
  const plan = buildSparePartsImportPlan(existing, csv, { now: NOW });

  assert.equal(plan.stats.updated, 1);
  assert.equal(plan.parts.length, 1);
  assert.equal(plan.parts[0].id, 'PLATFORM-PART-1');
  assert.deepEqual(plan.parts[0].catalogOrigin, catalogOrigin);
  assert.equal(Object.hasOwn(plan.parts[0], 'platformDefaultId'), false);
  assert.equal(Object.hasOwn(plan.parts[0], 'physicalId'), false);
  assert.equal(plan.parts[0].name, 'Фильтр компании');
});

test('spare parts import preserves unmentioned effective records and platform defaults', () => {
  const platform = part({
    id: 'PLATFORM-PART-1',
    name: 'Платформенная запчасть',
    catalogOrigin: { kind: 'platform_default', logicalId: 'PLATFORM-PART-1', tenantMutable: false },
  });
  const tenant = part({
    id: 'TENANT-PART-1',
    name: 'Запчасть компании',
    catalogOrigin: { kind: 'tenant_entry', logicalId: 'TENANT-PART-1', tenantMutable: true },
  });
  const csv = 'Наименование;Артикул\nНовая запчасть;NEW-1';
  const plan = buildSparePartsImportPlan([platform, tenant], csv, { now: NOW });

  assert.equal(plan.stats.added, 1);
  assert.deepEqual(plan.parts.slice(0, 2), [platform, tenant]);
  assert.equal(plan.parts.length, 3);
});

test('spare parts import rejects an unknown or hidden physical ID atomically', () => {
  const existing = [part({ id: 'LOGICAL-PART-1' })];
  const csv = 'ID;Наименование;Цена\nOVR-PHYSICAL-1;Атака;1';
  const plan = buildSparePartsImportPlan(existing, csv, { now: NOW });

  assert.equal(plan.stats.errors, 1);
  assert.deepEqual(plan.parts, existing);
  assert.match(plan.errors[0], /неизвестный или недоступный ID/);
});

test('spare parts import rejects duplicate explicit logical IDs atomically', () => {
  const existing = [part({ id: 'PT-1', name: 'Исходная' })];
  const csv = 'ID;Наименование\nPT-1;Первая\nPT-1;Вторая';
  const plan = buildSparePartsImportPlan(existing, csv, { now: NOW });

  assert.equal(plan.stats.errors, 1);
  assert.deepEqual(plan.parts, existing);
  assert.match(plan.errors[0], /повторяется/);
});

test('spare parts import rejects ownership, linkage, and physical identity columns', () => {
  for (const forbiddenHeader of ['companyId', 'tenantId', 'platformDefaultId', 'physicalId', 'catalogOrigin']) {
    const csv = `Наименование;${forbiddenHeader}\nФильтр;attack`;
    const plan = buildSparePartsImportPlan([], csv, { now: NOW });
    assert.equal(plan.stats.errors, 1, forbiddenHeader);
    assert.equal(plan.parts.length, 0, forbiddenHeader);
    assert.match(plan.errors[0], /Запрещены служебные колонки/, forbiddenHeader);
  }
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

test('spare parts export includes stable logical ID but excludes scope and linkage metadata', () => {
  const csv = sparePartsToCsv([
    part({
      id: 'PT-1',
      name: 'Фильтр',
      article: 'FLT-1',
      companyId: 'COMPANY-A',
      tenantId: 'COMPANY-A',
      platformDefaultId: 'DEFAULT-1',
      physicalId: 'OVR-1',
    }),
    part({ id: 'PT-2', name: 'Насос', article: 'PMP-1', manufacturer: 'Bosch' }),
  ]);
  const rows = parseCsv(csv);

  assert.deepEqual(rows[0], ['ID', 'Наименование', 'Артикул', 'Категория', 'Единица измерения', 'Цена', 'Поставщик', 'Комментарий']);
  assert.equal(rows.length, 3);
  assert.equal(rows[1][0], 'PT-1');
  assert.equal(rows[1][1], 'Фильтр');
  assert.equal(rows[2][2], 'PMP-1');
  assert.equal(rows[2][6], 'Bosch');
  assert.equal(csv.includes('COMPANY-A'), false);
  assert.equal(csv.includes('DEFAULT-1'), false);
  assert.equal(csv.includes('OVR-1'), false);
  assert.equal(csv.includes('repair_part_items'), false);
});

test('spare parts import/export helper does not read repair part item collection', () => {
  const source = readFileSync(new URL('../src/app/lib/sparePartsImportExport.js', import.meta.url), 'utf8');

  assert.equal(source.includes('repair_part_items'), false);
});
