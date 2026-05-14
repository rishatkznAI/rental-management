import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/app/pages/Deliveries.tsx', import.meta.url), 'utf8');

function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('delivery create quick action preselects canonical rental and operation type', () => {
  const openCreateBlock = extract('function openCreateDialog(params?: URLSearchParams)', 'function openEditDialog');

  assert.match(source, /import \{ chooseBestGanttRentalEntry, getGanttRentalSourceId \} from '\.\.\/lib\/rentalPlannerRows\.js'/);
  assert.match(openCreateBlock, /params\?\.get\('rentalId'\) \|\| params\?\.get\('classicRentalId'\)/);
  assert.match(openCreateBlock, /params\?\.get\('ganttRentalId'\)/);
  assert.match(openCreateBlock, /requestedType === 'receiving' \? 'receiving' : 'shipping'/);
  assert.match(openCreateBlock, /rentalOptions\.find\(option => option\.classicRentalId === requestedRentalId\)/);
  assert.match(openCreateBlock, /ganttRentalId: matchedRental\?\.ganttRentalId \|\| requestedGanttRentalId/);
  assert.match(openCreateBlock, /classicRentalId: matchedRental\?\.classicRentalId \|\| requestedRentalId/);
});

test('delivery rental options prefer source rental id over legacy name matching', () => {
  const optionsBlock = extract('const rentalOptions = useMemo<RentalOption[]>', 'const carrierOptions = useMemo');

  assert.match(optionsBlock, /const sourceId = getGanttRentalSourceId\(gantt\)/);
  assert.match(optionsBlock, /sourceId && classicById\.get\(sourceId\)/);
  assert.match(optionsBlock, /const groupedRentals = new Map<string, GanttRentalData\[\]>\(\)/);
  assert.match(optionsBlock, /const key = getGanttRentalSourceId\(item\) \|\| item\.id/);
  assert.match(optionsBlock, /chooseBestGanttRentalEntry\(entries, \{ todayKey: todayIso\(\) \}\)/);
  assert.match(optionsBlock, /classicRentalId: getGanttRentalSourceId\(item\) \|\| classic\?\.id \|\| ''/);
  assert.match(optionsBlock, /clientId: item\.clientId \|\| classic\?\.clientId \|\| client\?\.id \|\| ''/);
});

test('delivery create buttons open the form without forwarding click events as params', () => {
  const renderBlock = extract('return (', '<DeliveryDialog');

  assert.doesNotMatch(renderBlock, /onClick=\{openCreateDialog\}/, 'create buttons must not pass React click events into URLSearchParams prefill logic');
  assert.match(renderBlock, /onClick=\{\(\) => openCreateDialog\(\)\}/);
  assert.match(renderBlock, /canCreate && \(/);
  assert.match(renderBlock, /Новая доставка/);
  assert.match(renderBlock, /Создать доставку/);
});

test('delivery create dialog stays mounted and exposes required logistics fields', () => {
  const dialogPropsBlock = extract('<DeliveryDialog', '<Sheet open={Boolean(selectedDelivery)');
  const dialogBlock = extract('function DeliveryDialog({', 'export default function Deliveries()');

  assert.match(dialogPropsBlock, /open=\{dialogOpen\}/);
  assert.match(dialogPropsBlock, /onClose=\{\(\) => setDialogOpen\(false\)\}/);
  assert.match(dialogPropsBlock, /onSubmit=\{handleSubmit\}/);
  assert.match(dialogBlock, /<Sheet open=\{open\}/);
  assert.match(dialogBlock, /Тип операции/);
  assert.match(dialogBlock, /Перевозчик/);
  assert.match(dialogBlock, /Откуда/);
  assert.match(dialogBlock, /Куда/);
  assert.match(dialogBlock, /Клиент/);
  assert.match(dialogBlock, /Что перевозим/);
  assert.match(dialogBlock, /Контактное лицо/);
});
