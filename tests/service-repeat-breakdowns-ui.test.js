import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const servicePageSource = readFileSync(new URL('../src/app/pages/Service.tsx', import.meta.url), 'utf8');
const serviceTicketsServiceSource = readFileSync(new URL('../src/app/services/service-tickets.service.ts', import.meta.url), 'utf8');

test('service repeat breakdowns tab renders with KPI cards filters table and states', () => {
  assert.match(servicePageSource, /function RepeatBreakdownsTab/);
  assert.match(servicePageSource, /label="Повторные поломки"/);
  for (const label of [
    'Контроль качества ремонта',
    'Критичные повторы',
    'Техника с повторами',
    'Механики в разборе',
    'Главный сценарий',
    'Повторов за 7 дней',
    'Повторов за 30 дней',
    'Критичные',
    'Проблемная техника',
    'Проблемные модели',
    'Повторы по механику',
    'Только высокие/критичные',
    'Повторных поломок за выбранный период не найдено',
    'Повторов для контроля качества нет',
    'Не удалось загрузить аналитику повторных поломок',
    'Не удалось загрузить контроль качества ремонта',
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

test('service repeat breakdowns populated rows render summaries filters links and empty state', () => {
  for (const snippet of [
    /data\?\.summary\.repeatWithin7 \?\? 0/,
    /data\?\.summary\.repeatWithin30 \?\? 0/,
    /data\?\.summary\.critical \?\? 0/,
    /filteredItems\.map\(item =>/,
    /repeatSeverityLabel\(item\.repeatSeverity\)/,
    /\['critical', 'high'\]\.includes\(item\.repeatSeverity\)/,
    /SelectItem value="critical">Критичные/,
    /SelectItem value="high">Высокие/,
    /SelectItem value="medium">Средние/,
    /item\.links\.equipment && <Link/,
    /item\.links\.previousServiceTicket && <Link/,
    /item\.links\.repeatServiceTicket && <Link/,
    /Повторных поломок за выбранный период не найдено/,
  ]) {
    assert.match(servicePageSource, snippet);
  }
});

test('service repeat breakdowns use one stable API query and local filters', () => {
  assert.match(serviceTicketsServiceSource, /getRepeatBreakdowns/);
  assert.match(serviceTicketsServiceSource, /getRepairQuality/);
  assert.match(serviceTicketsServiceSource, /\/api\/service\/repeat-breakdowns/);
  assert.match(serviceTicketsServiceSource, /\/api\/service\/repeat-breakdowns\?view=quality/);
  assert.match(servicePageSource, /queryKey: \['service', 'repeat-breakdowns'\]/);
  assert.match(servicePageSource, /queryKey: \['service', 'repeat-breakdowns', 'quality'\]/);
  assert.match(servicePageSource, /queryFn: serviceTicketsService\.getRepeatBreakdowns/);
  assert.match(servicePageSource, /queryFn: serviceTicketsService\.getRepairQuality/);
  assert.match(servicePageSource, /staleTime: 1000 \* 60 \* 2/);
  assert.doesNotMatch(servicePageSource, /queryKey: \['service', 'repeat-breakdowns', periodFilter/);
});

test('service repeat breakdowns sanitize visible fallback text', () => {
  assert.match(servicePageSource, /function safeRepeatText/);
  assert.match(servicePageSource, /text === 'undefined'/);
  assert.match(servicePageSource, /text === 'null'/);
  assert.equal(servicePageSource.includes("text === '[object Object]'"), true);
});

test('service repair quality blocks render filters recommendations and safe links', () => {
  for (const snippet of [
    /SelectItem value="repeat_7_days">Повторы 7 дней/,
    /SelectItem value="repeat_30_days">Повторы 30 дней/,
    /SelectItem value="by_equipment">По технике/,
    /SelectItem value="by_mechanic">По механикам/,
    /SelectItem value="by_scenario">По сценариям/,
    /Проблемная техника/,
    /Сценарии повторов/,
    /Зоны разбора по механикам/,
    /Что сделать/,
    /qualityData\?\.recommendations/,
    /repairQualityRiskLabel/,
    /item\.links\.equipment && <Link/,
    /item\.links\.repeatServiceTicket && <Link/,
    /доля повторов/,
    /Не рейтинг вины/,
  ]) {
    assert.match(servicePageSource, snippet);
  }
});
