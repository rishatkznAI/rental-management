import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSaleStatusPatch, isSaleModeEquipment, saleStatusKind, saleStatusLabel } from '../src/app/lib/equipmentSaleMode.js';
import { buildEquipmentQuickActions } from '../src/app/lib/quickActions.js';

const allowAll = () => true;

test('sale mode turns on from sales route context and explicit sale fields', () => {
  assert.equal(isSaleModeEquipment({ id: 'EQ-1', status: 'available' }, { salesContext: true }), true);
  assert.equal(isSaleModeEquipment({ id: 'EQ-2', isForSale: true }), true);
  assert.equal(isSaleModeEquipment({ id: 'EQ-3', saleStatus: 'reserved' }), true);
  assert.equal(isSaleModeEquipment({ id: 'EQ-4', saleStatus: 'На продаже' }), true);
  assert.equal(isSaleModeEquipment({ id: 'EQ-5', salesStatus: 'on_sale' }), true);
  assert.equal(isSaleModeEquipment({ id: 'EQ-6', status: 'На продаже' }), true);
  assert.equal(isSaleModeEquipment({ id: 'EQ-7', tags: ['склад', 'продажа'] }), true);
  assert.equal(isSaleModeEquipment({ id: 'EQ-8', category: 'sold', status: 'inactive' }), true);
  assert.equal(isSaleModeEquipment({ id: 'EQ-9', saleStatus: 'Снята с продажи', status: 'inactive' }), true);
  assert.equal(isSaleModeEquipment({ id: 'EQ-8', status: 'available', category: 'own' }), false);
});

test('sale quick actions hide rental and fleet service actions', () => {
  const actions = buildEquipmentQuickActions({
    equipment: { id: 'EQ-sale', inventoryNumber: 'INV-sale', status: 'available', saleMode: true },
    can: allowAll,
  });
  const ids = actions.map(action => action.id);
  const labels = actions.map(action => action.label);

  assert.ok(ids.includes('equipment-sale-pdi'));
  assert.ok(ids.includes('equipment-sale-photo'));
  assert.ok(ids.includes('equipment-sale-reserve'));
  assert.ok(ids.includes('equipment-sale-remove'));
  assert.ok(ids.includes('equipment-sale-sold'));

  assert.ok(!ids.includes('equipment-sale-documents'));
  assert.ok(!ids.includes('equipment-sale-deal'));
  assert.ok(!labels.includes('Создать аренду'));
  assert.ok(!labels.includes('История аренд'));
  assert.ok(!labels.includes('Очередь сервиса'));
  assert.ok(!labels.includes('Создать сервисную заявку'));
  assert.ok(!labels.includes('Документы техники'));
});

test('sold sale equipment keeps sales actions without rental actions', () => {
  const actions = buildEquipmentQuickActions({
    equipment: { id: 'EQ-sold', inventoryNumber: 'INV-sold', category: 'sold', status: 'inactive', saleStatus: 'Продана', saleMode: true },
    can: allowAll,
  });
  const ids = actions.map(action => action.id);
  const labels = actions.map(action => action.label);

  assert.ok(ids.includes('equipment-sale-return'));
  assert.ok(ids.includes('equipment-sale-reserve'));
  assert.ok(ids.includes('equipment-sale-remove'));
  assert.ok(!ids.includes('equipment-sale-sold'));
  assert.ok(labels.includes('Вернуть в продажу'));
  assert.ok(!labels.includes('Создать аренду'));
  assert.ok(!labels.includes('Создать сервисную заявку'));
  assert.ok(!labels.includes('Очередь сервиса'));
});

test('sale status patches keep returned sold equipment out of rental fleet', () => {
  const sold = { id: 'EQ-sold', category: 'sold', status: 'inactive', activeInFleet: false, isForSale: false, saleStatus: 'Продана' };
  const returned = { ...sold, ...buildSaleStatusPatch(sold, 'on_sale') };
  const reserved = { ...sold, ...buildSaleStatusPatch(sold, 'reserved') };
  const removed = { ...sold, ...buildSaleStatusPatch(sold, 'removed') };

  assert.equal(saleStatusKind(returned), 'on_sale');
  assert.equal(saleStatusLabel(returned), 'На продаже');
  assert.equal(returned.isForSale, true);
  assert.equal(returned.activeInFleet, false);
  assert.equal(returned.category, 'own');
  assert.equal(returned.status, 'available');

  assert.equal(saleStatusKind(reserved), 'reserved');
  assert.equal(reserved.activeInFleet, false);
  assert.equal(reserved.status, 'reserved');

  assert.equal(saleStatusKind(removed), 'removed');
  assert.equal(removed.isForSale, false);
  assert.equal(removed.activeInFleet, false);
  assert.equal(removed.status, 'inactive');
});

test('sale deal quick action renders only with a safe configured route', () => {
  const withoutRoute = buildEquipmentQuickActions({
    equipment: { id: 'EQ-sale', inventoryNumber: 'INV-sale', status: 'available', saleMode: true },
    can: allowAll,
  });
  assert.equal(withoutRoute.some(action => action.id === 'equipment-sale-deal'), false);

  const withRoute = buildEquipmentQuickActions({
    equipment: { id: 'EQ-sale', inventoryNumber: 'INV-sale', status: 'available', saleMode: true },
    can: allowAll,
    crmDealsRoute: '/crm',
  });
  const dealAction = withRoute.find(action => action.id === 'equipment-sale-deal');
  assert.equal(dealAction?.label, 'Создать сделку');
  assert.match(dealAction?.to || '', /^\/crm\?/);
  assert.doesNotMatch(dealAction?.to || '', /undefined|null/);
});

test('sale deal quick action is hidden without CRM permission', () => {
  const actions = buildEquipmentQuickActions({
    equipment: { id: 'EQ-sale', inventoryNumber: 'INV-sale', status: 'available', saleMode: true },
    can: (action, section) => section !== 'crm',
    crmDealsRoute: '/crm',
  });

  assert.equal(actions.some(action => action.id === 'equipment-sale-deal'), false);
});

test('normal equipment keeps rental quick actions', () => {
  const actions = buildEquipmentQuickActions({
    equipment: { id: 'EQ-rent', inventoryNumber: 'INV-rent', status: 'available' },
    can: allowAll,
  });
  const labels = actions.map(action => action.label);

  assert.ok(labels.includes('Создать аренду'));
  assert.ok(labels.includes('История аренд'));
  assert.ok(labels.includes('Очередь сервиса'));
  assert.ok(labels.includes('Создать сервисную заявку'));
});

test('sale mode PDI action opens dedicated PDI form instead of service ticket form', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/EquipmentDetail.tsx'), 'utf8');

  assert.match(source, /import \{ PdiForm \} from '\.\.\/components\/sales\/PdiForm';/);
  assert.match(source, /saleMode \? \(\s*<PdiForm/s);
  assert.match(source, /: \(\s*<ServiceTicketForm/s);
  assert.doesNotMatch(source, /hideScenarioSelect=\{saleMode\}/);
  assert.doesNotMatch(source, /submitLabel=\{saleMode \? 'Создать PDI'/);
});

test('marking equipment sold requires confirmation and return action uses sale status patch', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/EquipmentDetail.tsx'), 'utf8');

  assert.match(source, /equipment-sale-return/);
  assert.match(source, /buildSaleStatusPatch\(item, 'on_sale'\)/);
  assert.match(source, /window\.confirm\('Вы уверены, что хотите отметить технику как проданную\?/);
  assert.match(source, /buildSaleStatusPatch\(item, 'sold'\)/);
});

test('sales page keeps sold equipment discoverable through sales status filter', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Sales.tsx'), 'utf8');

  assert.match(source, /filter\(\(equipment\) => isSaleModeEquipment\(equipment\)\)/);
  assert.match(source, /saleStatusKind\(equipment\) === statusFilter/);
  assert.match(source, /<option value="sold">Продана<\/option>/);
  assert.match(source, /saleStatusLabel\(equipment\)/);
});

test('sale mode keeps sale prices in sale 360 and not in basic characteristics', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/EquipmentDetail.tsx'), 'utf8');
  const basicStart = source.indexOf('<CardTitle>Основные характеристики</CardTitle>');
  const basicEnd = source.indexOf('{/* ── Tabs ── */}', basicStart);
  const basicSection = source.slice(basicStart, basicEnd);

  assert.ok(basicStart > -1);
  assert.ok(basicEnd > basicStart);
  assert.match(source, /<CardTitle>\{saleMode \? 'Продажа 360°' : 'Техника 360°'\}<\/CardTitle>/);
  assert.match(source, /<CompactMetric label="Цена 1"/);
  assert.match(source, /<CompactMetric label="Цена 2"/);
  assert.match(source, /<CompactMetric label="Цена 3"/);

  assert.doesNotMatch(basicSection, /<p className="text-sm font-semibold text-orange-300">Продажа<\/p>/);
  assert.doesNotMatch(basicSection, /<InfoField label="Цена 1"/);
  assert.doesNotMatch(basicSection, /<InfoField label="Цена 2"/);
  assert.doesNotMatch(basicSection, /<InfoField label="Цена 3"/);
});

test('sale mode shows identification service gsm and revenue context', () => {
  const detailSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/EquipmentDetail.tsx'), 'utf8');
  const salesSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Sales.tsx'), 'utf8');

  assert.match(detailSource, /Идентификация и обслуживание/);
  assert.match(detailSource, /<CompactMetric label="Инв\. №"/);
  assert.match(detailSource, /<CompactMetric label="GSM" value=\{getGsmDisplayValue\(equipment\)\}/);
  assert.match(detailSource, /<CompactMetric label="ТО"/);
  assert.match(detailSource, /<CompactMetric label="ЧТО"/);
  assert.match(detailSource, /<CompactMetric label="ПТО"/);
  assert.match(detailSource, /<CompactMetric\s+label="Доход"/);
  assert.match(detailSource, /formatCurrency\(equipment360\.finance\.revenue\)/);
  assert.match(detailSource, /rentals: canViewRentals \? allGanttRentals : \[\]/);
  assert.match(detailSource, /payments: canViewFinance \? allPayments : \[\]/);

  assert.match(salesSource, /Инв\. №: \{equipment\.inventoryNumber \|\| 'Не указано'\}/);
  assert.match(salesSource, /GSM: \{getGsmSaleValue\(equipment\)\}/);
  assert.match(salesSource, /ТО:/);
  assert.match(salesSource, /ЧТО:/);
  assert.match(salesSource, /ПТО:/);
});

test('PDI form contains presale fields and no service scenario selector', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/components/sales/PdiForm.tsx'), 'utf8');

  assert.match(source, /PDI \/ предпродажная подготовка/);
  assert.match(source, /Статус PDI/);
  assert.match(source, /Ответственный/);
  assert.match(source, /Дата проверки/);
  assert.match(source, /Дедлайн готовности/);
  assert.match(source, /Внешний осмотр/);
  assert.match(source, /Гидравлика/);
  assert.match(source, /Электрика/);
  assert.match(source, /АКБ \/ зарядка/);
  assert.match(source, /Паспорт/);
  assert.match(source, /Сертификаты/);
  assert.match(source, /Фото с 4 сторон/);
  assert.match(source, /Шильдик \/ серийный номер/);
  assert.match(source, /Готова к продаже/);

  assert.doesNotMatch(source, /Сценарий сервисной заявки/);
  assert.doesNotMatch(source, /option value="repair"/);
  assert.doesNotMatch(source, /option value="to"/);
  assert.doesNotMatch(source, /option value="chto"/);
  assert.doesNotMatch(source, /option value="pto"/);
  assert.doesNotMatch(source, />Клиент</);
  assert.doesNotMatch(source, />Объект</);
  assert.doesNotMatch(source, /clientId/);
  assert.doesNotMatch(source, /rentalId/);
});

test('PDI payload is explicitly marked as sales PDI', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/components/sales/PdiForm.tsx'), 'utf8');

  assert.match(source, /equipmentId: equipment\.id/);
  assert.match(source, /type: 'pdi'/);
  assert.match(source, /scenario: 'pdi'/);
  assert.match(source, /source: 'sales'/);
  assert.match(source, /saleMode: true/);
  assert.match(source, /pdiData/);
});

test('ordinary service ticket form still keeps service scenarios', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/components/service/ServiceTicketForm.tsx'), 'utf8');

  assert.match(source, /Сценарий сервисной заявки/);
  assert.match(source, /option value="repair">Ремонт/);
  assert.match(source, /option value="to">ТО/);
  assert.match(source, /option value="chto">ЧТО/);
  assert.match(source, /option value="pto">ПТО/);
  assert.match(source, /Клиент и объект/);
});

test('sale status label uses existing sale and sold fields', () => {
  assert.equal(saleStatusLabel({ isForSale: true }), 'На продаже');
  assert.equal(saleStatusLabel({ saleStatus: 'В сделке' }), 'В сделке');
  assert.equal(saleStatusLabel({ category: 'sold', saleStatus: 'ignored' }), 'Продана');
});
