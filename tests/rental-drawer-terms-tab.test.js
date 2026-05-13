import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/app/components/gantt/RentalDrawer.tsx', import.meta.url), 'utf8');
const rentalsPageSource = fs.readFileSync(new URL('../src/app/pages/Rentals.tsx', import.meta.url), 'utf8');
const rentalDetailSource = fs.readFileSync(new URL('../src/app/pages/RentalDetail.tsx', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('rental drawer exposes a dedicated terms and return tab', () => {
  assert.match(source, /type RentalDrawerTab = 'overview' \| 'terms' \| 'payments' \| 'documents' \| 'delivery' \| 'history'/);
  assert.match(source, /\['terms', 'Сроки и возврат'\]/);
});

test('terms tab owns rental lifecycle actions and overdue warning', () => {
  const termsBlock = extractBlock("{activeTab === 'terms' && (", "{/* Payment Block */}");

  assert.match(termsBlock, /Текущий период аренды/);
  assert.match(termsBlock, /Дата начала аренды/);
  assert.match(termsBlock, /Плановая дата окончания/);
  assert.match(termsBlock, /Статус срока/);
  assert.match(termsBlock, /Срок аренды истёк\. Нужно продлить аренду или оформить возврат техники\./);
  assert.match(termsBlock, /Продлить аренду/);
  assert.match(termsBlock, /Досрочный возврат/);
  assert.match(termsBlock, /Оформить возврат техники/);
  assert.match(termsBlock, /Создать сервисную заявку при повреждении/);
});

test('delivery tab keeps logistics actions out of rental lifecycle controls', () => {
  const deliveryBlock = extractBlock("{activeTab === 'delivery' && (", "{/* Documents / UPD */}");

  assert.match(deliveryBlock, /Логистика аренды/);
  assert.match(deliveryBlock, /Создать доставку/);
  assert.match(deliveryBlock, /Создать возвратную доставку/);
  assert.match(deliveryBlock, /relatedDeliveries\.length > 0/);
  assert.match(deliveryBlock, /Перевозчик:/);
  assert.match(deliveryBlock, /По этой аренде доставка ещё не создана/);
  assert.match(deliveryBlock, /Создайте доставку или возвратную доставку\./);
  assert.match(deliveryBlock, /Чтобы изменить срок аренды, перейдите во вкладку «Сроки и возврат»/);
  assert.doesNotMatch(deliveryBlock, /Продлить аренду/);
  assert.doesNotMatch(deliveryBlock, /Досрочный возврат/);
  assert.doesNotMatch(deliveryBlock, /Оформить возврат техники/);
  assert.doesNotMatch(deliveryBlock, /Дата перевозки/);
  assert.doesNotMatch(deliveryBlock, /Статус доставки/);
});

test('footer shortcuts keep rental term actions behind existing permissions', () => {
  assert.match(source, /const canShowExtendShortcut = canEditRentalDates && rental\.status === 'active'/);
  assert.match(source, /const canManageRentalReturn = canEditRentals && rental\.status === 'active'/);
  assert.match(source, /setActiveTab\('terms'\)/);
  assert.match(source, /Оформить возврат/);
});

test('extension dialog does not ask for reason and tracks invoice sent flag', () => {
  const dialogBlock = extractBlock('<Dialog open={extensionDialogOpen}', '</Dialog>');

  assert.doesNotMatch(dialogBlock, /Причина/);
  assert.doesNotMatch(dialogBlock, /EXTENSION_REASONS/);
  assert.match(dialogBlock, /Счёт отправлен клиенту/);
  assert.match(dialogBlock, /Счёт по продлению/);
  assert.match(dialogBlock, /extensionInvoiceSentToClient/);
  assert.match(source, /invoiceSentToClient: false/);
  assert.match(source, /invoiceSentToClient: extensionForm\.invoiceSentToClient/);
  assert.match(rentalDetailSource, /invoiceSentToClient: extensionForm\.invoiceSentToClient/);
});

test('successful extension response refreshes the open rental drawer date', () => {
  assert.match(source, /onExtended\?: \(response: RentalExtensionResponse\) => void/);
  assert.match(source, /onExtended\?\.\(result\)/);
  assert.match(rentalsPageSource, /const handleRentalExtended = useCallback\(\(response: RentalExtensionResponse\)/);
  assert.match(rentalsPageSource, /canonicalizeGanttRentalFromClassic\(updatedGantt, updatedClassic, equipmentList\)/);
  assert.match(rentalsPageSource, /setSelectedRental\(current =>/);
  assert.match(rentalsPageSource, /onExtended=\{handleRentalExtended\}/);
});

test('broken rental links use inline errors and cannot extend through GR id', () => {
  assert.doesNotMatch(source, /window\.alert/);
  assert.match(source, /setRentalDetailNotice\(rentalDetailError\)/);
  assert.match(source, /Boolean\(rentalDetailId\).*rental\.status === 'active'/);
  assert.match(source, /setExtensionError\('Нельзя продлить аренду без связанной записи rentals\.'\)/);
  assert.match(source, /rentalsService\.extend\(rentalDetailId,/);
  assert.doesNotMatch(source, /rentalsService\.extend\(rentalDetailId \|\| rental\.id/);
});
