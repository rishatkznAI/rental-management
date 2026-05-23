import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, '../src/app/pages/Finance.tsx'), 'utf8');
const serviceSource = readFileSync(join(__dirname, '../src/app/services/finance.service.ts'), 'utf8');

test('Finance contains economics tab and API client', () => {
  assert.match(source, /<TabsTrigger value="economics">Экономика<\/TabsTrigger>/);
  assert.match(source, /<TabsContent value="economics"/);
  assert.match(serviceSource, /getEconomics/);
  assert.match(serviceSource, /\/api\/finance\/economics/);
});

test('Finance economics KPI labels and disclaimers are visible', () => {
  for (const label of [
    'Экономика компании',
    'Управленческая экономика',
    'Не является бухгалтерской отчётностью',
    'Амортизация — non-cash показатель',
    'Выручка',
    'Расходы',
    'Прибыль до амортизации',
    'Амортизация',
    'Прибыль после амортизации',
    'Маржинальность',
    'Окупаемость парка',
  ]) {
    assert.ok(source.includes(label), `missing label: ${label}`);
  }
});

test('Finance economics table labels and empty state are safe', () => {
  for (const label of [
    'Экономика по единицам техники',
    'Техника',
    'Выручка',
    'Расходы',
    'Амортизация',
    'Прибыль после амортизации',
    'Окупаемость',
    'Статус',
    'Рекомендация',
    'Недостаточно данных для точного расчёта',
  ]) {
    assert.ok(source.includes(label), `missing economics table text: ${label}`);
  }
  assert.doesNotMatch(source, /\{item\.equipmentId\}<\/TableCell>/);
});

test('Finance economics problem blocks are present', () => {
  for (const label of [
    'Техника в минусе',
    'Техника без настроенной амортизации',
    'Техника с высокой выручкой',
    'Техника с высокими сервисными расходами',
  ]) {
    assert.ok(source.includes(label), `missing problem block: ${label}`);
  }
});

test('Finance economics tab has no destructive buttons or secret-like labels', () => {
  const start = source.indexOf('<TabsContent value="economics"');
  const end = source.indexOf('<TabsContent value="operations"', start);
  const block = source.slice(start, end);
  assert.doesNotMatch(block, /Удалить|Архивировать|Списать|Очистить|seed|deploy|APP_DISABLED|token|secret|password|credential/i);
});
