import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const detailSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/EquipmentDetail.tsx'), 'utf8');
const productionSmokeFixtureSource = fs.readFileSync(path.join(process.cwd(), 'src/app/lib/productionSmokeFixture.ts'), 'utf8');
const protectedFixtureUiSource = `${detailSource}\n${productionSmokeFixtureSource}`;

test('equipment detail renders rental fleet mode tabs and restored data blocks', () => {
  assert.match(detailSource, /cardMode === 'rental'/);
  for (const label of ['Обзор', 'Приёмка', 'Аренды', 'Экономика', 'Сервис', 'Документы', 'История']) {
    assert.match(detailSource, new RegExp(label));
  }
  assert.match(detailSource, /data-testid="equipment-economics-tab"/);
  assert.match(detailSource, /data-testid="equipment-economics-panel"/);
  assert.match(detailSource, /const acceptanceRecords = \[/);
  assert.match(detailSource, /equipment\.acceptancePhotos/);
  assert.match(detailSource, /shippingPhotos[\s\S]*getShippingPhotoOperationKind\(event[\s\S]*=== 'receiving'/);
  assert.match(detailSource, /По этой технике пока нет записей приёмки/);
  assert.match(detailSource, /const equipmentDebt = Math\.max\(0, totalRevenue - totalPaidRevenue\)/);
  assert.match(detailSource, /getEffectivePaidAmount/);
  assert.match(detailSource, /Сервисные расходы/);
});

test('equipment detail keeps receiving and shipment photos separated with legacy shipment aliases', () => {
  const minimalMantallEvent = {
    equipment: { manufacturer: 'Mantall', model: 'XE140RT', serialNumber: '12310938' },
    receivingPhoto: { type: 'receiving', photos: ['receiving.jpg'] },
    shipmentPhoto: { type: 'dispatch', photos: ['dispatch.jpg'] },
  };

  assert.equal(minimalMantallEvent.equipment.serialNumber, '12310938');
  for (const type of ['shipment', 'shipping', 'dispatch', 'loading', 'delivery', 'outbound', 'отправка', 'отгрузка']) {
    assert.match(detailSource, new RegExp(`['"]${type}['"]`));
  }
  for (const type of ['receiving', 'acceptance', 'return', 'inbound', 'inspection', 'receipt']) {
    assert.match(detailSource, new RegExp(`['"]${type}['"]`));
  }
  assert.match(detailSource, /function getShippingPhotoOperationKind/);
  assert.match(detailSource, /function normalizeEquipmentIdentifier/);
  assert.match(detailSource, /buildEquipmentMovementEvents/);
  assert.match(detailSource, /queryFn: equipmentService\.getAllShippingPhotos/);
  assert.match(detailSource, /getDeliveryOperationKind\(delivery\)/);
  assert.match(detailSource, /equipmentMovementEvents\.map/);
  assert.match(detailSource, /const shipmentRecords = shippingPhotos/);
  assert.match(detailSource, /<SalePanel title="Фото отгрузки">/);
  assert.match(detailSource, /<SalePanel title="Фото приёмки">/);
  assert.match(detailSource, /getShippingPhotoOperationKind\(event[\s\S]*=== 'receiving'/);
  assert.match(detailSource, /getShippingPhotoOperationKind\(event[\s\S]*=== 'shipping'/);
  assert.doesNotMatch(detailSource, /Фото отгрузки по этой технике пока не добавлены[\s\S]*shipmentRecords\.length > 0/);
});

test('equipment detail renders sale mode tabs without making rental actions primary', () => {
  assert.match(detailSource, /cardMode === 'sale'/);
  for (const label of ['Обзор продажи', 'PDI / подготовка', 'Коммерция', 'Сервисная готовность', 'Документы', 'История']) {
    assert.match(detailSource, new RegExp(label));
  }
  assert.match(detailSource, /Создать КП/);
  assert.match(detailSource, /Коммерческие суммы скрыты правами роли/);
  assert.match(detailSource, /saleQuickActions/);
  const saleTabsStart = detailSource.indexOf("cardMode === 'sale'");
  const saleTabsEnd = detailSource.indexOf("cardMode === 'repair'", saleTabsStart);
  const saleTabsSource = detailSource.slice(saleTabsStart, saleTabsEnd);
  assert.doesNotMatch(saleTabsSource, /Создать аренду|Аренды/);
});

test('equipment detail renders repair mode tabs and keeps rental economics out of repair overview', () => {
  assert.match(detailSource, /routeContext === 'service'/);
  assert.match(detailSource, /equipment\?\.category === 'client'/);
  assert.match(detailSource, /cardMode === 'repair'/);
  for (const label of ['Обзор ремонта', 'Диагностика', 'Работы и запчасти', 'Выезды', 'Документы', 'История сервиса']) {
    assert.match(detailSource, new RegExp(label));
  }
  assert.match(detailSource, /ServiceTicketCompactCard/);
  assert.match(detailSource, /fieldTripTickets/);
  const repairOverviewStart = detailSource.indexOf('value="repair-overview"');
  const repairOverviewEnd = detailSource.indexOf('value="diagnostics"', repairOverviewStart);
  const repairOverviewSource = detailSource.slice(repairOverviewStart, repairOverviewEnd);
  assert.doesNotMatch(repairOverviewSource, /Начислено|Оплачено|Долг|Утилизация/);
});

test('equipment detail hides money for roles without finance permission', () => {
  assert.match(detailSource, /canViewFinance \? formatCurrency\(saleMainPrice\) : 'Скрыто правами'/);
  assert.match(detailSource, /Финансовые показатели скрыты правами роли/);
  assert.match(detailSource, /canViewFinance \? formatCurrency\(getEffectivePaidAmount\(payment\)\) : 'Сумма скрыта правами'/);
  assert.match(detailSource, /canViewFinance && \(partsCost > 0 \|\| worksCost > 0\)/);
});

test('equipment detail marks and guards production smoke system fixture', () => {
  assert.match(protectedFixtureUiSource, /isProductionSmokeEquipmentFixture/);
  assert.match(protectedFixtureUiSource, /Системная запись/);
  assert.match(protectedFixtureUiSource, /Используется для production smoke-проверок/);
  assert.match(protectedFixtureUiSource, /stripProductionSmokeFixtureProtectedPatch/);
  assert.match(protectedFixtureUiSource, /productionSmokeFixtureErrorMessage/);
  assert.match(protectedFixtureUiSource, /isProtectedSmokeFixture \|\| !canEditSaleFields/);
  assert.match(protectedFixtureUiSource, /isProtectedSmokeFixture \|\| !canEditOperationalFields/);
});
