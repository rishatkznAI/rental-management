import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildSaleStatusPatch,
  getSaleOperationHistory,
  isSaleModeEquipment,
  normalizeEquipmentSaleCondition,
  saleConditionKind,
  saleConditionLabel,
  saleStatusKind,
  saleStatusLabel,
} from '../src/app/lib/equipmentSaleMode.js';
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

test('planned arrival sale equipment blocks PDI quick action until receipt is accepted', () => {
  const plannedActions = buildEquipmentQuickActions({
    equipment: { id: 'EQ-planned', status: 'available', saleMode: true, saleReceiptStatus: 'planned_arrival' },
    can: allowAll,
  });
  const acceptedActions = buildEquipmentQuickActions({
    equipment: { id: 'EQ-accepted', status: 'available', saleMode: true, saleReceiptStatus: 'accepted' },
    can: allowAll,
  });

  assert.equal(plannedActions.find(action => action.id === 'equipment-sale-pdi')?.disabled, true);
  assert.equal(acceptedActions.find(action => action.id === 'equipment-sale-pdi')?.disabled, false);
});

test('sales available quick filter excludes planned arrivals from physically available stock', () => {
  const salesSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Sales.tsx'), 'utf8');

  assert.match(salesSource, /function isPhysicallyAvailableForSale/);
  assert.match(salesSource, /quickFilter === 'available_only'[\s\S]*isPhysicallyAvailableForSale\(equipment\)/);
  assert.match(salesSource, /const availableCount = saleEquipment\.filter[\s\S]*isPhysicallyAvailableForSale\(equipment\)/);
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

test('sale condition auto-detects new equipment when no operation history exists', () => {
  const equipment = {
    id: 'EQ-new',
    isForSale: true,
    manufacturer: 'JLG',
    model: '1932R',
    serialNumber: 'SN-new',
    hours: 0,
  };

  assert.equal(saleConditionKind(equipment, { rentals: [], serviceTickets: [], rentalRevenue: 0 }), 'new');
  assert.equal(saleConditionLabel(equipment, { rentals: [], serviceTickets: [], rentalRevenue: 0 }), 'Новая');
  assert.equal(getSaleOperationHistory(equipment, { rentals: [], serviceTickets: [], rentalRevenue: 0 }).hasAny, false);
});

test('sale condition auto-detects used equipment from rental service and revenue history', () => {
  const equipment = {
    id: 'EQ-used',
    isForSale: true,
    maintenanceCHTO: '2026-01-10',
    maintenancePTO: '2026-02-10',
    gsmImei: '866123456789012',
    hours: 340,
  };
  const context = {
    rentals: [{ id: 'R-1', equipmentId: 'EQ-used', amount: 120000 }],
    serviceTickets: [{ id: 'S-1', equipmentId: 'EQ-used', reason: 'ТО' }],
    rentalRevenue: 120000,
  };
  const history = getSaleOperationHistory(equipment, context);

  assert.equal(saleConditionKind(equipment, context), 'used');
  assert.equal(saleConditionLabel(equipment, context), 'Б/у из арендного парка');
  assert.equal(history.hasRentalHistory, true);
  assert.equal(history.hasServiceHistory, true);
  assert.equal(history.hasMaintenance, true);
  assert.equal(history.hasGsm, true);
  assert.equal(history.hasRevenue, true);
});

test('explicit sale condition has priority over auto-detection', () => {
  const context = {
    rentals: [{ id: 'R-1', equipmentId: 'EQ-manual' }],
    serviceTickets: [{ id: 'S-1', equipmentId: 'EQ-manual', reason: 'ТО' }],
    rentalRevenue: 150000,
  };

  assert.equal(saleConditionKind({ id: 'EQ-manual', saleCondition: 'new', hours: 700 }, context), 'new');
  assert.equal(saleConditionKind({ id: 'EQ-manual', saleType: 'used' }, { rentals: [], serviceTickets: [], rentalRevenue: 0 }), 'used');
});

test('sale condition normalizer preserves explicit new and used values from update payloads', () => {
  assert.equal(normalizeEquipmentSaleCondition({ saleCondition: 'new' }), 'new');
  assert.equal(normalizeEquipmentSaleCondition({ saleCondition: 'used' }), 'used');
  assert.equal(normalizeEquipmentSaleCondition({ condition: 'новая' }), 'new');
  assert.equal(normalizeEquipmentSaleCondition({ saleType: 'б/у' }), 'used');
  assert.equal(normalizeEquipmentSaleCondition({ isNew: true }), 'new');
  assert.equal(normalizeEquipmentSaleCondition({ isNew: false }), 'used');
  assert.equal(normalizeEquipmentSaleCondition({ saleMode: true }), undefined);
  assert.equal(normalizeEquipmentSaleCondition({ saleMode: 'used' }), 'used');
});

test('equipment update uses patch normalizer so sale condition changes do not reset sale fields', () => {
  const classificationSource = fs.readFileSync(path.join(process.cwd(), 'src/app/lib/equipmentClassification.ts'), 'utf8');
  const serviceSource = fs.readFileSync(path.join(process.cwd(), 'src/app/services/equipment.service.ts'), 'utf8');

  assert.match(classificationSource, /export function normalizeEquipmentPatch/);
  assert.match(classificationSource, /normalizeEquipmentSaleCondition\(equipment\)/);
  assert.match(classificationSource, /\.\.\.\(saleCondition \? \{ saleCondition \} : \{\}\)/);
  const patchStart = classificationSource.indexOf('export function normalizeEquipmentPatch');
  const patchEnd = classificationSource.indexOf('export function canEquipmentParticipateInRentals');
  assert.ok(patchStart > -1);
  assert.ok(patchEnd > patchStart);
  assert.doesNotMatch(
    classificationSource.slice(patchStart, patchEnd),
    /isForSale:\s+equipment\.isForSale \?\? false|salePdiStatus:\s+equipment\.salePdiStatus \?\? 'not_started'/,
  );
  assert.match(serviceSource, /normalizeEquipmentPatch/);
  assert.match(serviceSource, /api\.patch<Equipment>\(`\/api\/equipment\/\$\{id\}`, normalizeEquipmentPatch\(data\)\)/);
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

test('sales equipment opens through sales route instead of common equipment route', () => {
  const salesSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Sales.tsx'), 'utf8');
  const routesSource = fs.readFileSync(path.join(process.cwd(), 'src/app/routes.ts'), 'utf8');
  const detailSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/EquipmentDetail.tsx'), 'utf8');

  assert.match(routesSource, /path: 'sales\/equipment\/:id'/);
  assert.match(salesSource, /to=\{`\/sales\/equipment\/\$\{equipment\.id\}`\}/);
  assert.doesNotMatch(salesSource, /to=\{`\/equipment\/\$\{equipment\.id\}\?context=sales`\}/);
  assert.match(detailSource, /location\.pathname\.startsWith\('\/sales\/'\)[\s\S]*\? 'sales'/);
  assert.match(detailSource, /routeContext === 'sales' \? '\/sales' : '\/equipment'/);
});

test('active section separates sales equipment detail from common equipment detail', () => {
  const permissionsSource = fs.readFileSync(path.join(process.cwd(), 'src/app/lib/permissions.ts'), 'utf8');
  const sidebarSource = fs.readFileSync(path.join(process.cwd(), 'src/app/components/layout/Sidebar.tsx'), 'utf8');

  assert.equal(pathToSectionForTest('/sales/equipment/EQ-1', permissionsSource), 'sales');
  assert.equal(pathToSectionForTest('/equipment/EQ-1', permissionsSource), 'equipment');
  assert.match(sidebarSource, /location\.pathname\.startsWith\(item\.href \+ '\/'\)/);
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

test('sale mode separates new sale cards from used operation history', () => {
  const detailSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/EquipmentDetail.tsx'), 'utf8');
  const salesSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Sales.tsx'), 'utf8');

  assert.match(detailSource, /Идентификация продажи/);
  assert.match(detailSource, /История эксплуатации перед продажей/);
  assert.match(detailSource, /Эксплуатационные данные заполнены вручную/);
  assert.match(detailSource, /showSaleOperationHistory/);
  assert.match(detailSource, /saleCondition === 'used'/);
  assert.match(detailSource, /<CompactMetric label="Инв\. №"/);
  assert.match(detailSource, /<CompactMetric label="Тип" value=\{saleConditionLabel\(equipment, saleConditionContext\)\}/);
  assert.match(detailSource, /<CompactMetric label="ТО"/);
  assert.match(detailSource, /<CompactMetric label="ЧТО"/);
  assert.match(detailSource, /<CompactMetric label="ПТО"/);
  assert.match(detailSource, /<CompactMetric label="GSM \/ IMEI \/ статус трекера" value=\{getGsmDisplayValue\(equipment\)\}/);
  assert.match(detailSource, /label="Доход от аренды"/);
  assert.match(detailSource, /formatCurrency\(equipment360\.finance\.revenue\)/);
  assert.match(detailSource, /\{canViewFinance && canViewRentals && \(/);
  assert.match(detailSource, /rentals: canViewRentals \? allGanttRentals : \[\]/);
  assert.match(detailSource, /payments: canViewFinance \? allPayments : \[\]/);

  assert.match(salesSource, /saleConditionKind\(equipment\)/);
  assert.match(salesSource, /saleConditionLabel\(equipment\)/);
  assert.match(salesSource, /showOperationHistory/);
  assert.match(salesSource, /История эксплуатации перед продажей/);
  assert.match(salesSource, /Инв\. №: \{equipment\.inventoryNumber \|\| 'Не указано'\}/);
  assert.match(salesSource, /GSM: \{getGsmSaleValue\(equipment\)\}/);
  assert.match(salesSource, /ТО:/);
  assert.match(salesSource, /ЧТО:/);
  assert.match(salesSource, /ПТО:/);
});

test('equipment forms expose sale condition only inside sale settings', () => {
  const newSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/EquipmentNew.tsx'), 'utf8');
  const detailSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/EquipmentDetail.tsx'), 'utf8');

  assert.match(newSource, /saleCondition: 'new'/);
  assert.match(newSource, /saleCondition:\s+form\.isForSale === 'yes' \? form\.saleCondition as 'new' \| 'used' : undefined/);
  assert.match(newSource, /label="Тип продажной техники"/);
  assert.match(newSource, /Б\/у из арендного парка/);
  assert.match(detailSource, /label="Тип продажной техники"/);
  assert.match(detailSource, /value=\{form\.saleCondition \|\| 'new'\}/);
  assert.match(detailSource, /onValueChange=\{setStr\('saleCondition'\)\}/);
  assert.match(detailSource, /saleCondition: 'тип продажной техники'/);
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

function pathToSectionForTest(pathname, source) {
  const orderedChecks = [
    ['/tasks', 'tasks_center'],
    ['/equipment', 'equipment'],
    ['/gsm', 'gsm'],
    ['/knowledge-base', 'knowledge_base'],
    ['/sales', 'sales'],
  ];
  assert.match(source, /if \(pathname\.startsWith\('\/sales'\)\)\s+return 'sales';/);
  assert.match(source, /if \(pathname\.startsWith\('\/equipment'\)\)\s+return 'equipment';/);
  if (pathname === '/') return 'dashboard';
  return orderedChecks.find(([prefix]) => pathname.startsWith(prefix))?.[1] || null;
}
