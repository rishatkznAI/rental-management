import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const servicePageSource = readFileSync(new URL('../src/app/pages/Service.tsx', import.meta.url), 'utf8');
const serviceTicketsServiceSource = readFileSync(new URL('../src/app/services/service-tickets.service.ts', import.meta.url), 'utf8');

test('service repeat breakdowns tab renders with KPI cards filters table and states', () => {
  assert.match(servicePageSource, /function RepeatBreakdownsTab/);
  assert.match(servicePageSource, /label="Повторные поломки"/);
  for (const label of [
    'Повторов за 7 дней',
    'Повторов за 30 дней',
    'Критичные',
    'Проблемная техника',
    'Проблемные модели',
    'Повторы по механику',
    'Только high/critical',
    'Повторных поломок за выбранный период не найдено',
    'Не удалось загрузить аналитику повторных поломок',
  ]) {
    assert.match(servicePageSource, new RegExp(label));
  }
});

test('service repeat breakdowns table exposes expected Russian columns and links', () => {
  for (const label of [
    'Техника',
    'Предыдущая заявка',
    'Повторная заявка',
    'Дней',
    'Механик',
    'Сценарий',
    'Причина',
    'Рекомендация',
    'Ссылки',
  ]) {
    assert.match(servicePageSource, new RegExp(label));
  }
  assert.match(servicePageSource, /to=\{item\.links\.equipment\}/);
  assert.match(servicePageSource, /to=\{item\.links\.previousServiceTicket\}/);
  assert.match(servicePageSource, /to=\{item\.links\.repeatServiceTicket\}/);
});

test('service repeat breakdowns use one stable API query and local filters', () => {
  assert.match(serviceTicketsServiceSource, /getRepeatBreakdowns/);
  assert.match(serviceTicketsServiceSource, /\/api\/service\/repeat-breakdowns/);
  assert.match(servicePageSource, /queryKey: \['service', 'repeat-breakdowns'\]/);
  assert.match(servicePageSource, /queryFn: serviceTicketsService\.getRepeatBreakdowns/);
  assert.match(servicePageSource, /staleTime: 1000 \* 60 \* 2/);
  assert.doesNotMatch(servicePageSource, /queryKey: \['service', 'repeat-breakdowns', periodFilter/);
});

test('service repeat breakdowns sanitize visible fallback text', () => {
  assert.match(servicePageSource, /function safeRepeatText/);
  assert.match(servicePageSource, /text === 'undefined'/);
  assert.match(servicePageSource, /text === 'null'/);
  assert.equal(servicePageSource.includes("text === '[object Object]'"), true);
});
