import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
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

const require = createRequire(import.meta.url);
const {
  normalizeEquipmentSalePatch,
  normalizeEquipmentStorageRecord,
} = require('../server/lib/equipment-classification.js');

const allowAll = () => true;
const equipmentConstantsSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/equipment/equipment.constants.ts'), 'utf8');
const equipmentHelpersSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/equipment/equipment.helpers.ts'), 'utf8');
const equipmentPaginationSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/equipment/equipment.pagination.ts'), 'utf8');
const equipmentTypesSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/equipment/equipment.types.ts'), 'utf8');
const equipmentKpiCardsSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/equipment/EquipmentKpiCards.tsx'), 'utf8');
const equipmentStatusTabsSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/equipment/EquipmentStatusTabs.tsx'), 'utf8');
const equipmentFiltersSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/equipment/EquipmentFilters.tsx'), 'utf8');
const equipmentRegistryTableSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/equipment/EquipmentRegistryTable.tsx'), 'utf8');
const equipmentMobileCardsSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/equipment/EquipmentMobileCards.tsx'), 'utf8');
const equipmentQuickActionsSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/equipment/EquipmentQuickActions.tsx'), 'utf8');
const equipmentQuickViewPanelSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/equipment/EquipmentQuickViewPanel.tsx'), 'utf8');

test('sale mode turns on from sales route context and explicit sale fields', () => {
  assert.equal(isSaleModeEquipment({ id: 'EQ-1', status: 'available' }, { salesContext: true }), true);
  assert.equal(isSaleModeEquipment({ id: 'EQ-sale-mode', status: 'available', saleMode: true }), true);
  assert.equal(isSaleModeEquipment({ id: 'EQ-sale-string', status: 'available', saleMode: 'on_sale' }), true);
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

test('active sale flags override stale removed sale status in lists and cards', () => {
  const equipment = {
    id: 'EQ-mantall',
    manufacturer: 'Mantall',
    model: 'XE140RT',
    serialNumber: '03331938',
    status: 'available',
    saleCondition: 'new',
    isForSale: true,
    saleMode: true,
    saleStatus: 'Снята с продажи',
  };

  assert.equal(saleConditionLabel(equipment), 'Новая');
  assert.equal(saleStatusKind(equipment), 'on_sale');
  assert.equal(saleStatusLabel(equipment), 'На продаже');
});

test('backend normalizes enabling sale from removed state to active sale fields', () => {
  const existing = {
    id: 'EQ-removed',
    status: 'inactive',
    saleStatus: 'Снята с продажи',
    isForSale: false,
    forSale: false,
    saleMode: true,
  };
  const patch = normalizeEquipmentSalePatch(existing, { isForSale: true, status: 'available' });

  assert.equal(patch.isForSale, true);
  assert.equal(patch.forSale, true);
  assert.equal(patch.saleMode, true);
  assert.equal(patch.saleStatus, 'На продаже');
  assert.equal(patch.status, 'available');
});

test('backend partial ordinary status patch does not remove active sale status', () => {
  const stored = normalizeEquipmentStorageRecord({
    id: 'EQ-active',
    status: 'available',
    saleStatus: 'На продаже',
    isForSale: true,
    saleMode: true,
  });
  const next = normalizeEquipmentStorageRecord({ ...stored, status: 'available' });

  assert.equal(next.saleStatus, 'На продаже');
  assert.equal(next.isForSale, true);
  assert.equal(next.saleMode, true);
});

test('backend keeps explicit sale removal as removed and not for sale', () => {
  const patch = normalizeEquipmentSalePatch(
    { id: 'EQ-active', status: 'available', saleStatus: 'На продаже', isForSale: true, saleMode: true },
    { isForSale: false },
  );

  assert.equal(patch.isForSale, false);
  assert.equal(patch.forSale, false);
  assert.equal(patch.saleMode, true);
  assert.equal(patch.saleStatus, 'Снята с продажи');
});

test('rental eligibility excludes sold sale records but not active on-sale fleet units', () => {
  const classificationSource = fs.readFileSync(path.join(process.cwd(), 'src/app/lib/equipmentClassification.ts'), 'utf8');
  const equipmentSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Equipment.tsx'), 'utf8');
  const rentalNewSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/RentalNew.tsx'), 'utf8');

  assert.match(classificationSource, /import \{ normalizeEquipmentSaleCondition, saleStatusKind \} from '\.\/equipmentSaleMode\.js';/);
  assert.match(classificationSource, /export function canEquipmentParticipateInRentals/);
  assert.match(classificationSource, /saleStatusKind\(normalized\) !== 'sold'/);
  assert.match(classificationSource, /normalized\.activeInFleet/);
  assert.match(classificationSource, /normalized\.category === 'own' \|\| normalized\.category === 'partner'/);
  assert.doesNotMatch(classificationSource, /normalized\.isForSale.*false/);

  assert.match(rentalNewSource, /rawEq\.filter\(e => canEquipmentParticipateInRentals\(e\) && e\.status !== 'inactive' && e\.status !== 'in_service'\)/);
  assert.match(equipmentHelpersSource, /activeTab === 'available'[\s\S]*registryOptions\.canEquipmentParticipateInRentals\(equipment\)[\s\S]*!hasCurrentRental\(equipment, activeRentalIndex\)/);
  assert.match(equipmentHelpersSource, /activeTab === 'reserved'[\s\S]*registryOptions\.canEquipmentParticipateInRentals\(equipment\)/);
  assert.match(equipmentSource, /const EQUIPMENT_REGISTRY_MATCH_OPTIONS = \{ canEquipmentParticipateInRentals \}/);
  assert.match(equipmentSource, /matchesTabType\(equipment, activeTab, activeRentalIndex, EQUIPMENT_REGISTRY_MATCH_OPTIONS\)/);
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

test('equipment detail editor saves the card through PATCH and keeps modal state stable', () => {
  const detailSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/EquipmentDetail.tsx'), 'utf8');
  const modalStart = detailSource.indexOf('function EditEquipmentModal');
  const modalEnd = detailSource.indexOf('export {', modalStart);
  const modalSource = detailSource.slice(modalStart, modalEnd > modalStart ? modalEnd : undefined);
  const fieldSelectStart = detailSource.indexOf('function FieldSelect');
  const fieldSelectEnd = detailSource.indexOf('function getSalePdiBadge', fieldSelectStart);
  const fieldSelectSource = detailSource.slice(fieldSelectStart, fieldSelectEnd);

  assert.match(detailSource, /buildEquipmentEditPatch\(equipment, normalizedUpdated\)/);
  assert.match(detailSource, /equipmentService\.update\(equipment\.id, patchWithHistory\)/);
  assert.match(detailSource, /queryClient\.setQueryData<Equipment\[\] \| undefined>\(EQUIPMENT_KEYS\.all/);
  assert.doesNotMatch(detailSource, /const list = allEquipment\.map\(e => e\.id === normalizedUpdated\.id \? withHistory : e\)/);
  assert.doesNotMatch(detailSource, /void persistEquipment\(list\)/);
  assert.match(modalSource, /previousOpenRef/);
  assert.doesNotMatch(modalSource, /if \(open\) setForm\(equipment\);\s*\n\s*}, \[open, equipment\]\);/);
  assert.match(fieldSelectSource, /<select[\s\S]*onChange=\{event => onValueChange\(event\.target\.value\)\}/);
  assert.doesNotMatch(fieldSelectSource, /<SelectContent/);
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

test('sale mode header uses storefront actions instead of CRM actions', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/EquipmentDetail.tsx'), 'utf8');
  const saleStart = source.indexOf("saleMode ? (");
  const saleEnd = source.indexOf(") : (", saleStart);
  const saleBranch = source.slice(saleStart, saleEnd);

  assert.match(source, /Назад к списку продаж/);
  assert.match(source, /Создать КП/);
  assert.match(source, /Витрина продажной техники/);
  assert.match(source, /saleStatusKindValue === 'in_deal' \? 'Зарезервирована'/);
  assert.doesNotMatch(saleBranch, /CRM|лид|сделк|ворон|Ответственный|Открыть CRM|Создать задачу/);
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

test('sale quote actions create commercial offer documents instead of contracts', () => {
  const detailSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/EquipmentDetail.tsx'), 'utf8');
  const salesSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Sales.tsx'), 'utf8');
  const documentsSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Documents.tsx'), 'utf8');
  const typesSource = fs.readFileSync(path.join(process.cwd(), 'src/app/types.ts'), 'utf8');
  const documentsCoreSource = fs.readFileSync(path.join(process.cwd(), 'server/lib/documents-core.js'), 'utf8');
  const systemRoutesSource = fs.readFileSync(path.join(process.cwd(), 'server/routes/system.js'), 'utf8');

  assert.match(detailSource, /action=create&type=commercial_offer/);
  assert.doesNotMatch(detailSource, /action=create&type=quote/);
  assert.match(salesSource, /type=commercial_offer&action=create/);
  assert.doesNotMatch(salesSource, /type=kp/);
  assert.match(typesSource, /\| 'commercial_offer'/);
  assert.match(documentsCoreSource, /commercial_offer: \{ label: 'Коммерческое предложение', prefix: 'KP' \}/);
  assert.match(documentsCoreSource, /key === 'quote' \|\| key === 'kp'[\s\S]*return 'commercial_offer'/);
  assert.match(documentsSource, /type: 'commercial_offer'/);
  assert.match(documentsSource, /documentType: 'commercial_offer'/);
  assert.match(documentsSource, /Коммерческое предложение/);
  assert.match(documentsSource, /handleCreateCommercialOffer/);
  assert.match(documentsSource, /openCommercialOfferCreate/);
  assert.match(documentsSource, /salesSettings\.quoteTemplate\.title/);
  assert.match(documentsSource, /salesSettings\.quoteTemplate\.introText/);
  assert.match(documentsSource, /salesSettings\.quoteTemplate\.footerText/);
  assert.match(documentsSource, /salesSettings\.quoteTemplate\.sectionsOrder/);
  assert.match(documentsSource, /salesSettings\.quoteTemplate\.showEquipmentPhoto/);
  assert.match(documentsSource, /salesSettings\.quoteTemplate\.showEquipmentSpecs/);
  assert.match(documentsSource, /salesSettings\.quoteTemplate\.showEquipmentPackage/);
  assert.match(documentsSource, /salesSettings\.quoteTemplate\.showVat/);
  assert.match(documentsSource, /salesSettings\.defaultPaymentTerms\.paymentText/);
  assert.match(documentsSource, /salesSettings\.defaultDeliveryTerms\.deliveryText/);
  assert.match(documentsSource, /salesSettings\.packageCommentTemplate\.text/);
  assert.match(documentsSource, /sectionsOrder: QuoteTemplateSection\[\]/);
  assert.match(documentsSource, /sectionHtml: Record<QuoteTemplateSection, string>/);
  assert.match(systemRoutesSource, /sales_section_settings/);
  assert.doesNotMatch(documentsSource, /type: 'contract'[\s\S]{0,300}handleCreateCommercialOffer/);
  assert.doesNotMatch(documentsSource, /documentType: 'contract'[\s\S]{0,300}handleCreateCommercialOffer/);
  assert.doesNotMatch(documentsSource, /salePrice2/);
  assert.doesNotMatch(documentsSource, /salePrice3/);
  assert.match(documentsSource, /function openContractCreate\(kind: DocumentContractKind/);
  assert.match(documentsSource, /function handleCreateContract/);
  assert.match(documentsSource, /openContractCreate\('rental'\)/);
  assert.match(documentsSource, /openContractCreate\('supply'\)/);
  assert.match(documentsSource, /type: 'contract'/);
  assert.match(documentsSource, /contractKind: createContractKind/);
  assert.match(documentsSource, /Создать договор/);
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
  assert.match(source, /<CardTitle>\{saleMode \? 'Витрина продажной техники' : 'Карточка техники'\}<\/CardTitle>/);
  assert.match(source, /<SalePanel title="Цена и маржа">/);
  assert.match(source, /saleMainPrice/);
  assert.match(source, /saleMinPrice/);
  assert.match(source, /saleCostPrice/);
  assert.match(source, /saleMarginPercent/);

  assert.doesNotMatch(basicSection, /<p className="text-sm font-semibold text-orange-300">Продажа<\/p>/);
  assert.doesNotMatch(basicSection, /<InfoField label="Цена 1"/);
  assert.doesNotMatch(basicSection, /<InfoField label="Цена 2"/);
  assert.doesNotMatch(basicSection, /<InfoField label="Цена 3"/);
});

test('sale mode uses sale storefront sections without operation-history CRM blocks', () => {
  const detailSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/EquipmentDetail.tsx'), 'utf8');
  const salesSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Sales.tsx'), 'utf8');

  assert.match(detailSource, /<SalePanel title="Паспорт техники">/);
  assert.match(detailSource, /<SalePanel title="Готовность к продаже">/);
  assert.match(detailSource, /<SalePanel title="Блокеры продажи"/);
  assert.match(detailSource, /<SalePanel title="Состояние и приёмка">/);
  assert.match(detailSource, /<SalePanel title="Комплектация">/);
  assert.match(detailSource, /<SalePanel title="Техническое состояние">/);
  assert.match(detailSource, /<SalePanel title="Логистика продажи">/);
  assert.match(detailSource, /<SalePanel title="Документы">/);
  assert.match(detailSource, /saleBlockers/);
  assert.match(detailSource, /saleReadinessPercent/);
  assert.doesNotMatch(detailSource, /showSaleOperationHistory/);
  assert.doesNotMatch(detailSource, /История эксплуатации перед продажей/);
  assert.doesNotMatch(detailSource, /Эксплуатационные данные заполнены вручную/);
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

test('normal equipment detail is asset-centric instead of rental-centric', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/EquipmentDetail.tsx'), 'utf8');

  assert.match(source, /'Карточка техники'/);
  assert.match(source, /Паспорт, состояние, локация, документы, GSM, ТО и история актива/);
  assert.match(source, /const showLegacyEquipmentSections = false/);
  assert.match(source, /<SalePanel title="Паспорт техники">/);
  assert.match(source, /<SalePanel title="Текущий статус">/);
  assert.match(source, /<SalePanel title="Категория и классификация">/);
  assert.match(source, /<SalePanel title="Местоположение">/);
  assert.match(source, /<SalePanel title="PDI и приёмка">/);
  assert.match(source, /<SalePanel title="Комплектация">/);
  assert.match(source, /<SalePanel title="GSM \/ Трекер">/);
  assert.match(source, /<SalePanel title="Техническое обслуживание">/);
  assert.match(source, /<SalePanel title="История событий">/);
  assert.match(source, /assetCurrentRental/);
  assert.match(source, /Открыть аренду →/);
});

test('equipment registry uses asset-centric tabs for one equipment entity', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Equipment.tsx'), 'utf8');
  const tabSource = `${source}\n${equipmentConstantsSource}`;

  for (const label of [
    'Вся техника',
    'Свободная',
    'В аренде',
    'В сервисе',
    'Бронь',
    'Списанная',
    'На продажу',
    'Проданная',
  ]) {
    assert.match(tabSource, new RegExp(label.replace('/', '\\/')));
  }

  assert.match(equipmentTypesSource, /export type EquipmentTab = 'all' \| 'available' \| 'rented' \| 'service' \| 'reserved' \| 'written_off' \| 'for_sale' \| 'sold'/);
  assert.match(source, /EquipmentTab,[\s\S]*from '\.\/equipment\/equipment\.types';/);
  assert.match(source, /EQUIPMENT_TABS[\s\S]*from '\.\/equipment\/equipment\.constants';/);
  assert.match(source, /import \{ EquipmentStatusTabs \} from '\.\/equipment\/EquipmentStatusTabs';/);
  assert.match(source, /<EquipmentStatusTabs[\s\S]*activeTab=\{activeTab\}[\s\S]*tabs=\{EQUIPMENT_TABS\}[\s\S]*counts=\{tabCounts\}[\s\S]*onTabChange=\{setActiveTab\}/);
  assert.match(equipmentStatusTabsSource, /export function EquipmentStatusTabs/);
  assert.match(equipmentStatusTabsSource, /activeTab === tab\.key[\s\S]*'border-primary\/30 bg-accent text-foreground'/);
  assert.match(equipmentHelpersSource, /export function isSaleRegistryEquipment/);
  assert.match(equipmentHelpersSource, /export function hasExplicitSaleMode/);
  assert.match(equipmentHelpersSource, /saleMode === true/);
  assert.match(equipmentHelpersSource, /export function isForSaleEquipment/);
  assert.match(equipmentHelpersSource, /export function isSoldEquipment/);
  assert.match(equipmentHelpersSource, /export function getEquipmentRegistryBucket/);
  assert.match(equipmentHelpersSource, /getExplicitSaleStatusKind\(equipment\) === 'sold'/);
  assert.match(source, /activeTab === 'for_sale' \|\| activeTab === 'sold'/);
  assert.match(source, /function getEquipmentDetailPath/);
  assert.match(source, /\/sales\/equipment\/\$\{equipment\.id\}/);
  assert.doesNotMatch(source, /Активный парк'/);
  assert.doesNotMatch(source, /Сервисная \/ клиентская техника/);
});

test('equipment registry KPI cards use real counts and percentages without fake trends', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Equipment.tsx'), 'utf8');
  const kpiUiSource = `${source}\n${equipmentKpiCardsSource}`;

  for (const label of ['Всего техники', 'Свободна', 'В аренде', 'В сервисе', 'На продажу', 'Проданная']) {
    assert.match(source, new RegExp(label));
  }

  assert.match(source, /import \{ EquipmentKpiCards, type EquipmentKpiCardConfig \} from '\.\/equipment\/EquipmentKpiCards';/);
  assert.match(source, /<EquipmentKpiCards cards=\{kpiCards\} \/>/);
  assert.match(equipmentKpiCardsSource, /function EquipmentKpiCard/);
  assert.match(equipmentHelpersSource, /export function getRegistryPercent/);
  assert.match(equipmentHelpersSource, /export function buildEquipmentTabCounts/);
  assert.match(source, /buildEquipmentTabCounts\(enrichedEquipmentList, EQUIPMENT_TABS, activeRentalIndex, EQUIPMENT_REGISTRY_MATCH_OPTIONS\)/);
  assert.match(source, /value: tabCounts\.available/);
  assert.match(source, /value: tabCounts\.rented/);
  assert.match(source, /value: tabCounts\.service/);
  assert.match(source, /value: tabCounts\.for_sale/);
  assert.match(source, /value: tabCounts\.sold/);
  assert.match(source, /Доля от общего парка/);
  assert.match(source, /CheckCircle2/);
  assert.match(source, /Truck/);
  assert.match(source, /Wrench/);
  assert.match(source, /BadgeDollarSign/);
  assert.match(equipmentKpiCardsSource, /border-violet-200\/80 bg-violet-50\/45/);
  assert.match(equipmentKpiCardsSource, /border-slate-200\/85 bg-slate-50\/60/);
  assert.doesNotMatch(kpiUiSource, /sparkline|Sparkline|trend|Тренд|динамик/i);
  assert.doesNotMatch(kpiUiSource, /Math\.random|mockTrend|fakeTrend|fakeKpi/i);
});

test('equipment registry filters are tab-aware and cover status sale type drive owner and location', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Equipment.tsx'), 'utf8');
  const filterUiSource = `${source}\n${equipmentConstantsSource}\n${equipmentFiltersSource}`;

  for (const label of [
    'Модель, инв. №, SN, собственник, локация',
    'Свободна',
    'В аренде',
    'Бронь',
    'В сервисе',
    'Списана',
    'На продажу',
    'Продана',
    'Ножничный подъёмник',
    'Коленчатый подъёмник',
    'Телескопический подъёмник',
    'Погрузчик',
    'Дизель 4x4',
    'Другое',
    'Собственник',
    'Локация',
  ]) {
    assert.match(filterUiSource, new RegExp(label.replace('№', '№')));
  }

  assert.match(source, /import \{ EquipmentFilters \} from '\.\/equipment\/EquipmentFilters';/);
  assert.match(source, /<EquipmentFilters[\s\S]*search=\{search\}[\s\S]*onSearchChange=\{setSearch\}/);
  assert.match(source, /categoryOptions=\{categoryOptions\}/);
  assert.match(source, /statusOptions=\{EQUIPMENT_STATUS_FILTER_OPTIONS\}/);
  assert.match(equipmentConstantsSource, /export const EQUIPMENT_STATUS_FILTER_OPTIONS/);
  assert.match(equipmentConstantsSource, /export const STANDARD_EQUIPMENT_TYPE_FILTER_OPTIONS/);
  assert.match(equipmentConstantsSource, /export const EQUIPMENT_DRIVE_FILTER_OPTIONS/);
  assert.match(source, /typeOptions=\{typeFilterOptions\}/);
  assert.match(source, /ownerOptions=\{ownerOptions\}/);
  assert.match(source, /locationOptions=\{locationOptions\}/);
  assert.match(equipmentFiltersSource, /export function EquipmentFilters/);
  assert.match(equipmentFiltersSource, /<FilterButton activeCount=\{activeFilterCount\}/);
  assert.match(equipmentFiltersSource, /<FilterDialog[\s\S]*title="Фильтры техники"[\s\S]*onReset=\{onReset\}/);
  assert.match(equipmentHelpersSource, /export function matchesEquipmentSearch/);
  assert.match(equipmentHelpersSource, /export function getEquipmentCategoryLabel/);
  assert.match(source, /\['own', 'client', 'partner', 'sold'\]/);
  assert.match(equipmentHelpersSource, /export function matchesStatusFilter/);
  assert.match(equipmentHelpersSource, /export function matchesEquipmentTypeFilter/);
  assert.match(equipmentHelpersSource, /export function matchesDriveFilter/);
  assert.match(equipmentHelpersSource, /export function matchesOwnerFilter/);
  assert.match(source, /matchesTabType\(equipment, activeTab, activeRentalIndex, EQUIPMENT_REGISTRY_MATCH_OPTIONS\)/);
  assert.match(source, /matchesStatusFilter\(equipment, statusFilter, activeRentalIndex, EQUIPMENT_REGISTRY_MATCH_OPTIONS\)/);
  assert.match(source, /matchesEquipmentTypeFilter\(equipment, typeFilter, equipmentTypeOptions\)/);
});

test('equipment registry tab search and filter logic covers sale sold and availability behavior', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Equipment.tsx'), 'utf8');

  assert.match(equipmentHelpersSource, /export function matchesEquipmentSearch/);
  assert.match(equipmentHelpersSource, /const fields = \[[\s\S]*equipment\.model,[\s\S]*equipment\.manufacturer,[\s\S]*equipment\.inventoryNumber,[\s\S]*equipment\.serialNumber,/);
  assert.match(equipmentHelpersSource, /fields\.some\(\(value\) => String\(value \?\? ''\)\.toLowerCase\(\)\.includes\(normalized\)\)/);

  assert.match(equipmentHelpersSource, /const bucket = getEquipmentRegistryBucket\(equipment, activeRentalIndex\)/);
  assert.match(equipmentHelpersSource, /if \(activeTab === 'available'\) \{[\s\S]*bucket === 'available'[\s\S]*registryOptions\.canEquipmentParticipateInRentals\(equipment\)[\s\S]*!hasCurrentRental\(equipment, activeRentalIndex\)/);
  assert.match(equipmentHelpersSource, /activeTab === 'rented' \|\| activeTab === 'service' \|\| activeTab === 'written_off' \|\| activeTab === 'for_sale' \|\| activeTab === 'sold'/);
  assert.match(equipmentHelpersSource, /return bucket === activeTab/);
  assert.match(equipmentHelpersSource, /if \(isSoldEquipment\(equipment\)\) return 'sold';[\s\S]*if \(isForSaleEquipment\(equipment\)\) return 'for_sale';[\s\S]*if \(isWrittenOffEquipment\(equipment\)\) return 'written_off';/);

  assert.match(equipmentHelpersSource, /if \(statusFilter === 'for_sale'\) return matchesTabType\(equipment, 'for_sale', activeRentalIndex, options\);/);
  assert.match(equipmentHelpersSource, /if \(statusFilter === 'sold'\) return matchesTabType\(equipment, 'sold', activeRentalIndex, options\);/);
  assert.match(source, /const filteredEquipment = React\.useMemo\(\(\) => \([\s\S]*matchesSearch[\s\S]*matchesStatus[\s\S]*matchesType[\s\S]*matchesDrive[\s\S]*matchesCategory[\s\S]*matchesOwner[\s\S]*matchesLocation[\s\S]*matchesTabType\(equipment, activeTab, activeRentalIndex, EQUIPMENT_REGISTRY_MATCH_OPTIONS\)/);
});

test('equipment registry table is compact paginated and includes photo gsm owner category and actions', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Equipment.tsx'), 'utf8');
  const registryListSource = `${source}\n${equipmentRegistryTableSource}\n${equipmentMobileCardsSource}`;

  for (const label of [
    'Фото',
    'Инв. номер',
    'Модель',
    'Тип / Привод',
    'Статус',
    'Категория',
    'Собственник',
    'Локация',
    'Приоритет',
    'GSM',
    'Действия',
    'Строк на странице',
  ]) {
    assert.match(registryListSource, new RegExp(label.replace('/', '\\/')));
  }

  assert.match(source, /import \{ EquipmentRegistryTable \} from '\.\/equipment\/EquipmentRegistryTable';/);
  assert.match(source, /import \{ EquipmentMobileCards \} from '\.\/equipment\/EquipmentMobileCards';/);
  assert.match(source, /<EquipmentMobileCards[\s\S]*equipmentItems=\{paginatedEquipment\}[\s\S]*isSaleTab=\{isSaleTab\}[\s\S]*activeRentalIndex=\{activeRentalIndex\}/);
  assert.match(source, /<EquipmentRegistryTable[\s\S]*equipmentItems=\{paginatedEquipment\}[\s\S]*selectedEquipmentId=\{selectedEquipmentId\}[\s\S]*onSelectEquipment=\{\(equipment\) => setSelectedEquipmentId\(equipment\.id\)\}/);
  assert.match(equipmentRegistryTableSource, /export function EquipmentRegistryTable/);
  assert.match(equipmentRegistryTableSource, /<table className=/);
  assert.match(equipmentRegistryTableSource, /photoSource\(equipment\.photo\)/);
  assert.match(equipmentRegistryTableSource, /title="Нет фото"/);
  assert.match(equipmentRegistryTableSource, /onClick=\{\(\) => onSelectEquipment\(equipment\)\}/);
  assert.match(equipmentRegistryTableSource, /SN \{equipment\.serialNumber \|\| 'не указан'\}/);
  assert.match(equipmentMobileCardsSource, /export function EquipmentMobileCards/);
  assert.match(equipmentMobileCardsSource, /Инв\. № \{equipment\.inventoryNumber \|\| '—'\} · SN \{equipment\.serialNumber \|\| 'не указан'\}/);
  assert.match(equipmentHelpersSource, /export function getEquipmentGsmDisplay/);
  assert.match(equipmentHelpersSource, /label: 'Онлайн'/);
  assert.match(equipmentHelpersSource, /label: 'Офлайн'/);
  assert.match(equipmentHelpersSource, /label: 'Нет связи'/);
  assert.match(equipmentHelpersSource, /label: 'Нет данных'/);
  assert.match(equipmentConstantsSource, /export const DEFAULT_EQUIPMENT_PAGE_SIZE = 20/);
  assert.match(equipmentConstantsSource, /export const EQUIPMENT_PAGE_SIZE_OPTIONS = \[DEFAULT_EQUIPMENT_PAGE_SIZE, 50, 100\]/);
  assert.match(source, /React\.useState\(DEFAULT_EQUIPMENT_PAGE_SIZE\)/);
  assert.match(source, /getEquipmentPageRange\(totalVisible, currentPage, pageSize\)/);
  assert.match(source, /const paginatedEquipment = React\.useMemo/);
  assert.match(source, /getEquipmentPageItems\(filteredEquipment, visibleCurrentPage, pageSize\)/);
  assert.match(equipmentPaginationSource, /items\.slice\(\(currentPage - 1\) \* pageSize, currentPage \* pageSize\)/);
  assert.match(equipmentPaginationSource, /Math\.max\(1, Math\.ceil\(totalVisible \/ pageSize\)\)/);
  assert.doesNotMatch(registryListSource, /saleRowColumns|defaultRowColumns/);
});

test('equipment registry empty states are contextual and keep safe fallbacks', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Equipment.tsx'), 'utf8');
  const emptyStateSource = `${source}\n${equipmentConstantsSource}`;

  for (const label of [
    'Техника ещё не добавлена',
    'Добавить технику',
    'По выбранным фильтрам ничего не найдено',
    'Сбросить фильтры',
    'Техника на продажу пока не выставлена',
    'Перейти к продажам',
    'Проданных единиц пока нет',
  ]) {
    assert.match(emptyStateSource, new RegExp(label));
  }

  assert.match(source, /function EmptyState\(\{/);
  assert.match(equipmentConstantsSource, /emptyRegistry: \{[\s\S]*title: 'Техника ещё не добавлена'/);
  assert.match(source, /EQUIPMENT_EMPTY_STATE_COPY\.emptyRegistry/);
  assert.match(source, /activeTab === 'for_sale' && activeTabTotal === 0/);
  assert.match(source, /activeTab === 'sold' && activeTabTotal === 0/);
  assert.match(equipmentConstantsSource, /noResults: \{[\s\S]*title: 'По выбранным фильтрам ничего не найдено'/);
  assert.match(source, /EQUIPMENT_EMPTY_STATE_COPY\.noResults/);
  assert.match(source, /activeFilterCount > 0/);
  assert.match(source, /onClick=\{resetFilters\}/);
  assert.match(equipmentHelpersSource, /label: 'Нет данных'/);
  assert.match(equipmentHelpersSource, /if \(!hasEquipmentGsmData\(equipment\)\)[\s\S]*label: 'Нет данных'/);
  assert.match(equipmentRegistryTableSource, /title="Нет фото"/);
});

test('equipment registry status badges use normalized visual categories without losing sale logic', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Equipment.tsx'), 'utf8');
  const statusBadgeSource = `${source}\n${equipmentConstantsSource}`;

  assert.match(equipmentTypesSource, /export type EquipmentRegistryStatusKind = 'available' \| 'rented' \| 'reserved' \| 'service' \| 'written_off' \| 'for_sale' \| 'sold'/);
  assert.match(source, /EquipmentRegistryStatusKind,[\s\S]*from '\.\/equipment\/equipment\.types';/);
  assert.match(equipmentConstantsSource, /export const EQUIPMENT_STATUS_BADGE_STYLES/);

  for (const label of ['Свободна', 'В аренде', 'Бронь', 'В сервисе', 'Списана', 'На продажу', 'Проданная']) {
    assert.match(statusBadgeSource, new RegExp(label));
  }

  for (const tone of ['bg-emerald', 'bg-blue', 'bg-yellow', 'bg-orange', 'bg-violet', 'bg-slate']) {
    assert.match(statusBadgeSource, new RegExp(tone));
  }

  assert.match(equipmentHelpersSource, /export function getRegistryStatusKind/);
  assert.match(equipmentHelpersSource, /if \(isSoldEquipment\(equipment\)\) return 'sold'/);
  assert.match(equipmentHelpersSource, /if \(isForSaleEquipment\(equipment\)\) return 'for_sale'/);
  assert.match(equipmentHelpersSource, /hasCurrentRental\(equipment, activeRentalIndex\)/);
  assert.match(equipmentHelpersSource, /getStatusKindFromBaseStatus\(equipment\.status\)/);
  assert.match(source, /getRegistryStatusAppearance\(selectedEquipment, activeRentalIndex\)/);
  assert.doesNotMatch(source, /saleStatusLabel/);
  assert.doesNotMatch(source, /Свободен|Списан'/);
});

test('equipment registry row opens right quick view panel with tabs and linked context', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Equipment.tsx'), 'utf8');
  const quickViewSource = `${source}\n${equipmentConstantsSource}\n${equipmentQuickActionsSource}\n${equipmentQuickViewPanelSource}`;

  assert.match(source, /import \{[\s\S]*EquipmentQuickViewPanel[\s\S]*from '\.\/equipment\/EquipmentQuickViewPanel';/);
  assert.match(equipmentQuickViewPanelSource, /export function EquipmentQuickViewPanel/);
  assert.match(equipmentConstantsSource, /export const EQUIPMENT_PREVIEW_TABS/);
  assert.match(equipmentQuickViewPanelSource, /EQUIPMENT_PREVIEW_TABS\.map/);
  for (const label of ['Обзор', 'Характеристики', 'Документы', 'Фото', 'История']) {
    assert.match(equipmentConstantsSource, new RegExp(label));
  }

  assert.match(source, /<EquipmentRegistryTable[\s\S]*selectedEquipmentId=\{selectedEquipmentId\}[\s\S]*onSelectEquipment=\{\(equipment\) => setSelectedEquipmentId\(equipment\.id\)\}/);
  assert.match(equipmentRegistryTableSource, /onClick=\{\(\) => onSelectEquipment\(equipment\)\}/);
  assert.match(equipmentRegistryTableSource, /selectedEquipmentId === equipment\.id/);
  assert.match(source, /setSelectedEquipmentId\(equipment\.id\)/);
  assert.match(source, /<EquipmentQuickViewPanel[\s\S]*selectedEquipment=\{selectedEquipment\}[\s\S]*activeTab=\{activeQuickViewTab\}[\s\S]*onTabChange=\{setActiveQuickViewTab\}/);
  assert.match(equipmentQuickViewPanelSource, /aria-label="Закрыть панель техники"/);
  assert.match(equipmentQuickViewPanelSource, /<h2 className="app-shell-title truncate text-xl font-extrabold text-foreground">\{title\}<\/h2>/);
  assert.match(source, /getRegistryStatusLabel\(selectedEquipment, activeRentalIndex\)/);
  assert.match(equipmentQuickViewPanelSource, /INV \{inventoryNumber \|\| '—'\}/);
  assert.match(equipmentQuickViewPanelSource, /SN \{serialNumber \|\| 'не указан'\}/);
  assert.match(equipmentRegistryTableSource, /const ownerLabel = getRegistryOwnerLabel\(equipment\)/);
  assert.match(equipmentRegistryTableSource, /const gsmDisplay = getEquipmentGsmDisplay\(equipment\)/);
  assert.match(equipmentQuickViewPanelSource, /import \{ EquipmentQuickActions \} from '\.\/EquipmentQuickActions';/);
  assert.match(equipmentQuickViewPanelSource, /<EquipmentQuickActions actions=\{quickActions\} \/>/);

  for (const label of [
    'Рабочая высота',
    'Высота платформы',
    'Грузоподъёмность',
    'Масса',
    'Габариты',
    'Год выпуска',
    'Наработка',
    'Питание',
    'Паспорт',
    'Сертификат',
    'Акт ввода',
    'Договор / документы продажи',
    'Показать все документы',
    'Фото техники',
    'Фото дефектов',
    'Фото приёмки',
    'Фото возврата',
    'Собственник',
    'GSM',
    'Быстрые действия',
  ]) {
    assert.match(quickViewSource, new RegExp(label.replace('/', '\\/')));
  }

  assert.match(source, /useDocumentsList/);
  assert.match(source, /useServiceTicketsList/);
  assert.match(source, /useRentalsList/);
  assert.match(source, /equipmentService\.getShippingPhotos/);
  assert.match(source, /function buildEquipmentTimeline/);
  assert.match(source, /documentMatchesEquipmentOrRentals/);
  assert.match(source, /serviceTicketMatchesEquipment/);
  assert.match(source, /ganttRentalMatchesEquipment/);
});

test('equipment quick view actions are status-aware and backed by routes or disabled reasons', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Equipment.tsx'), 'utf8');
  const quickActionUiSource = `${source}\n${equipmentQuickActionsSource}\n${equipmentQuickViewPanelSource}`;
  const serviceNewSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/ServiceNew.tsx'), 'utf8');
  const rentalNewSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/RentalNew.tsx'), 'utf8');
  const detailSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/EquipmentDetail.tsx'), 'utf8');

  assert.match(source, /function buildEquipmentPreviewQuickActions/);
  assert.match(equipmentQuickActionsSource, /export function EquipmentQuickActions/);
  assert.match(source, /EquipmentPreviewQuickAction,[\s\S]*from '\.\/equipment\/equipment\.types';/);
  assert.match(source, /buildEquipmentQuickActions/);
  assert.match(source, /canPerform\(can, 'create', 'rentals'\)/);
  assert.match(source, /canPerform\(can, 'create', 'service'\)/);
  assert.match(source, /canPerform\(can, 'view', 'sales'\)/);
  assert.match(source, /canPerform\(can, 'create', 'sales'\)/);
  assert.match(source, /canPerform\(can, 'edit', 'sales'\)/);
  assert.match(source, /canPerform\(can, 'edit', 'equipment'\)/);
  assert.match(source, /canPerform\(can, 'create', 'documents'\)/);
  assert.match(source, /const canManageSaleEquipment = canEditSales \|\| canEditEquipment/);

  for (const label of [
    'Быстрые действия',
    'Редактировать',
    'Создать аренду',
    'Создать сервисную заявку',
    'Выставить на продажу',
    'Открыть аренду',
    'Запланировать возврат',
    'Открыть заявку',
    'Назначить механика',
    'История ремонта',
    'Открыть карточку продажи',
    'Создать КП',
    'Редактировать цену',
    'Снять с продажи',
    'Создать PDI',
    'Открыть сделку/продажу',
    'Документы продажи',
    'Вернуть в продажу',
  ]) {
    assert.match(quickActionUiSource, new RegExp(label.replace('/', '\\/')));
  }

  assert.match(source, /disabled: true,[\s\S]*Возврат планируется в карточке аренды/);
  assert.match(source, /disabled: true,[\s\S]*Назначение выполняется в карточке заявки/);
  assert.match(source, /disabled: true,[\s\S]*Статус продажи меняется в полной карточке продажи/);
  assert.match(source, /disabled: true,[\s\S]*Оформляется в полной карточке продажи/);
  assert.match(source, /const editPath = `\$\{detailPath\}\?action=edit`/);
  assert.match(source, /const saleEditPath = `\$\{salePath\}\?action=edit`/);
  assert.match(source, /if \(canViewSales && canCreateSales && canCreateDocuments\)/);
  assert.match(source, /if \(canManageSaleEquipment\)/);
  assert.match(source, /if \(canViewSales && canPerform\(can, 'create', 'service'\)\)/);
  assert.match(source, /mode: 'sales_pdi'/);
  assert.match(source, /onShowHistory: \(\) => setActiveQuickViewTab\('history'\)/);
  assert.match(equipmentQuickActionsSource, /const disabled = Boolean\(action\.disabled \|\| \(!action\.to && !action\.onClick\)\)/);
  assert.match(equipmentQuickActionsSource, /onClick=\{disabled \? undefined : action\.onClick\}/);
  assert.match(equipmentQuickActionsSource, /disabled=\{disabled\}/);
  assert.match(equipmentQuickActionsSource, /title=\{action\.reason \|\| undefined\}/);

  assert.match(serviceNewSource, /useSearchParams/);
  assert.match(serviceNewSource, /const initialEquipmentId = searchParams\.get\('equipmentId'\)/);
  assert.match(serviceNewSource, /const isSalesPdi = mode === 'sales_pdi'/);
  assert.match(serviceNewSource, /initialEquipmentId=\{initialEquipmentId\}/);
  assert.match(serviceNewSource, /submitLabel=\{isSalesPdi \? 'Создать PDI' : undefined\}/);

  assert.match(rentalNewSource, /searchParams\.get\('equipmentId'\)/);
  assert.match(rentalNewSource, /searchParams\.get\('equipmentInv'\)/);
  assert.match(rentalNewSource, /setEquipmentId\(selected\.id\)/);

  assert.match(detailSource, /const routeSearchParams = new URLSearchParams\(location\.search\)/);
  assert.match(detailSource, /const openEditFromRoute = routeSearchParams\.get\('action'\) === 'edit'/);
  assert.match(detailSource, /const canEditSales = can\('edit', 'sales'\)/);
  assert.match(detailSource, /const canEditCurrentEquipment = saleMode \? \(canEditEquipment \|\| canEditSales\) : canEditEquipment/);
  assert.match(detailSource, /if \(openEditFromRoute && canEditCurrentEquipment\)/);
  assert.match(detailSource, /show: can\('create', 'rentals'\)/);
  assert.match(detailSource, /show: canCreateSales && canCreateDocuments/);
  assert.match(detailSource, /show: can\('create', 'deliveries'\)/);
});

test('sales section is a commercial tool without publications crm or analytics tabs', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Sales.tsx'), 'utf8');

  for (const label of ['Витрина', 'Прайсы', 'КП', 'Документы продаж', 'Настройки продаж', 'Создать КП']) {
    assert.match(source, new RegExp(label));
  }

  for (const forbidden of ['Публикации', 'CRM', 'Лиды', 'Сделки', 'Аналитика', 'Открыть CRM']) {
    assert.doesNotMatch(source, new RegExp(forbidden));
  }

  assert.match(source, /Коммерческий инструмент по продажной технике/);
  assert.match(source, /Прайс по моделям/);
  assert.match(source, /Прайс по конкретной единице/);
  assert.match(source, /История изменения цены/);
});

test('sales settings tab is admin-only and persists editable app settings', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Sales.tsx'), 'utf8');
  const settingsSource = fs.readFileSync(path.join(process.cwd(), 'src/app/lib/salesSettings.ts'), 'utf8');
  const documentsSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Documents.tsx'), 'utf8');

  assert.match(settingsSource, /export const SALES_SETTINGS_KEY = 'sales_section_settings'/);
  assert.match(settingsSource, /quoteTemplate: \{/);
  for (const field of [
    'templateName',
    'validityDays',
    'showEquipmentPhoto',
    'showEquipmentSpecs',
    'showEquipmentPackage',
    'showPaymentTerms',
    'showDeliveryTerms',
    'showWarrantyTerms',
    'showVat',
    'showPackageComment',
    'sectionsOrder',
  ]) {
    assert.match(settingsSource, new RegExp(`${field}:`));
  }
  assert.match(settingsSource, /defaultPaymentTerms: \{/);
  assert.match(settingsSource, /invoiceDueDays:/);
  assert.match(settingsSource, /paymentText:/);
  assert.match(settingsSource, /Оплата 100% по счёту\. Цена указана с НДС 20%\./);
  assert.match(source, /Предоплата \$\{settings\.defaultPaymentTerms\.prepaymentPercent\}%, оплата в течение \$\{settings\.defaultPaymentTerms\.invoiceDueDays\} дней, НДС/);
  assert.match(source, /НДС включён/);
  assert.match(settingsSource, /defaultDeliveryTerms: \{/);
  assert.match(settingsSource, /mode: 'pickup' \| 'company_delivery' \| 'negotiable'/);
  assert.match(settingsSource, /readinessDays:/);
  assert.match(settingsSource, /deliveryText:/);
  assert.match(settingsSource, /Самовывоз со склада или доставка по отдельному согласованию\./);
  assert.match(source, /Способ доставки/);
  assert.match(source, /Доставка силами компании/);
  assert.match(source, /По договорённости/);
  assert.match(source, /оплачивает покупатель/);
  assert.match(settingsSource, /warrantyTerms: \{/);
  assert.match(settingsSource, /warrantyMonthsNew:/);
  assert.match(settingsSource, /warrantyMonthsUsed:/);
  assert.match(settingsSource, /exclusionsText:/);
  assert.match(settingsSource, /Гарантия предоставляется при соблюдении условий эксплуатации\./);
  assert.match(settingsSource, /Гарантия не распространяется на расходные материалы, естественный износ и повреждения вследствие неправильной эксплуатации\./);
  assert.match(source, /Гарантия для новой техники, месяцев/);
  assert.match(source, /Гарантия для б\/у техники, месяцев/);
  assert.match(source, /Исключения из гарантии/);
  assert.match(settingsSource, /pricingRules: \{/);
  assert.match(settingsSource, /defaultMarkupPercent:/);
  assert.match(settingsSource, /minimumMarginPercent:/);
  assert.match(settingsSource, /allowBelowMinimumPrice:/);
  assert.match(settingsSource, /rulesText:/);
  assert.match(source, /Базовая наценка, %/);
  assert.match(source, /Разрешить цену ниже минимальной/);
  assert.match(source, /Учитывать состояние новой\/б\/у/);
  assert.match(source, /Текстовое описание правил/);
  assert.match(source, /Сбросить к стандартным/);
  assert.match(source, /DEFAULT_SALES_SETTINGS\.pricingRules/);
  assert.match(settingsSource, /priceChangeReasons: \[/);
  for (const reason of [
    'Корректировка по рынку',
    'Срочная продажа',
    'Скидка клиенту',
    'Изменение состояния техники',
    'Состояние АКБ',
    'Комплектация',
    'PDI или документы',
    'Ошибка в цене',
    'Решение руководителя',
    'Другое',
  ]) {
    assert.match(settingsSource, new RegExp(reason));
  }
  assert.match(source, /activePriceChangeReasons/);
  assert.match(source, /Доступные причины изменения цены/);
  assert.match(source, /Активные причины/);
  assert.match(source, /archivePriceReason/);
  assert.match(source, /Отключить \/ архивировать/);
  assert.doesNotMatch(source, /filter\(\(_, reasonIndex\) => reasonIndex !== index\)/);
  assert.match(settingsSource, /packageCommentTemplate: \{/);
  assert.match(settingsSource, /text: string/);
  assert.match(settingsSource, /Комплектация указана по состоянию на дату формирования КП\. Перед отгрузкой проводится контрольная проверка\./);
  assert.match(source, /Этот текст используется при формировании КП, если в шаблоне включён блок комментария по комплектации\./);
  assert.match(source, /Сбросить к стандартному/);
  assert.match(source, /DEFAULT_SALES_SETTINGS\.packageCommentTemplate/);
  assert.match(settingsSource, /export function normalizeSalesSettings/);
  assert.match(source, /const isAdmin = normalizeUserRole\(user\?\.role\) === 'Администратор'/);
  assert.match(source, /\.\.\.\(isAdmin \? \[\{ value: 'settings', label: 'Настройки продаж' \}\] : \[\]\)/);
  assert.match(source, /if \(!isAdmin && activeSalesTab === 'settings'\)/);
  assert.match(source, /setActiveSalesTab\('showcase'\)/);
  assert.match(source, /appSettingsService\.getAll/);
  assert.match(source, /enabled: isAdmin/);
  assert.match(source, /appSettingsService\.update\(existing\.id, payload\)/);
  assert.match(source, /appSettingsService\.create\(payload\)/);
  assert.match(source, /value: nextSettings/);
  assert.match(source, /toast\.success\(message\)/);
  assert.match(source, /toast\.error\(message\)/);
  assert.match(source, /settingsError/);
  assert.match(source, /<fieldset disabled=\{saveSettingsMutation\.isPending\}/);
  assert.match(source, /disabled=\{saveSettingsMutation\.isPending\}/);
  assert.match(source, /onClick=\{\(\) => setEditingSettingId\(item\.id\)\}/);
  assert.match(source, /cursor-pointer/);
  assert.match(source, /hover:border-primary/);
  assert.match(source, /settingsSummary\(item\.id\)/);
  assert.match(source, /Настроить/);
  assert.match(source, /\{isAdmin \? \(\s*<TabsContent value="settings"/);
  assert.match(source, /<Dialog[\s\S]*open=\{Boolean\(editingSetting\)\}/);
  assert.match(source, /renderSettingsEditor/);
  for (const editorId of [
    'quoteTemplate',
    'defaultPaymentTerms',
    'defaultDeliveryTerms',
    'warrantyTerms',
    'pricingRules',
    'priceChangeReasons',
  ]) {
    assert.match(source, new RegExp(`editingSettingId === '${editorId}'`));
  }
  assert.match(source, /settingsDraftValue\.packageCommentTemplate/);
  assert.match(source, /Название шаблона/);
  assert.match(source, /Срок действия, дней/);
  assert.match(source, /Заголовок КП/);
  assert.match(source, /Вступительный текст/);
  assert.match(source, /Показывать фото техники/);
  assert.match(source, /Показывать характеристики/);
  assert.match(source, /Показывать комплектацию/);
  assert.match(source, /Показывать оплату/);
  assert.match(source, /Показывать доставку/);
  assert.match(source, /Показывать гарантию/);
  assert.match(source, /Показывать НДС/);
  assert.match(source, /Показывать комментарий по комплектации/);
  assert.match(source, /Финальный текст/);
  assert.match(source, /moveQuoteSection/);
  assert.match(source, /Предпросмотр КП/);
  assert.match(source, /\{equipmentModel\}/);
  assert.match(source, /\{packageComment\}/);
  assert.match(source, /Текст условий оплаты для КП/);
  assert.match(source, /Текст условий доставки для КП/);
  assert.match(source, /Основной текст гарантии/);
  assert.match(source, /Базовая наценка, %/);
  assert.match(source, /Текстовое описание правил/);
  assert.match(source, /Причина изменения цены/);
  assert.match(source, /Шаблон комментария/);
  assert.match(source, /packageCommentTemplate: \{ \.\.\.current\.packageCommentTemplate, text: event\.target\.value \}/);
  assert.match(source, /quoteTemplate: \{ \.\.\.current\.quoteTemplate/);
  assert.match(source, /defaultPaymentTerms: \{ \.\.\.current\.defaultPaymentTerms/);
  assert.match(source, /defaultDeliveryTerms: \{ \.\.\.current\.defaultDeliveryTerms/);
  assert.match(source, /warrantyTerms: \{ \.\.\.current\.warrantyTerms/);
  assert.match(source, /pricingRules: \{ \.\.\.current\.pricingRules/);
  assert.match(source, /priceChangeReasons: current\.priceChangeReasons\.map/);
  assert.match(source, /addPriceReason/);
  assert.match(source, /Сохранить/);
  assert.match(source, /Сохранение…/);
  assert.match(source, /Сбросить к стандартным/);
  assert.match(source, /DEFAULT_SALES_SETTINGS\.quoteTemplate/);
  assert.match(source, /DEFAULT_SALES_SETTINGS\.defaultPaymentTerms/);
  assert.match(source, /DEFAULT_SALES_SETTINGS\.defaultDeliveryTerms/);
  assert.match(source, /DEFAULT_SALES_SETTINGS\.warrantyTerms/);
  assert.match(source, /DEFAULT_SALES_SETTINGS\.priceChangeReasons/);
  assert.doesNotMatch(source, /Название карточки/);
  assert.doesNotMatch(source, /Описание карточки/);
  assert.doesNotMatch(source, /setSettingDraft/);
  assert.match(documentsSource, /SALES_SETTINGS_KEY/);
  assert.match(documentsSource, /normalizeSalesSettings/);
  assert.doesNotMatch(documentsSource, /enabled: isAdmin/);
  assert.match(documentsSource, /salesSettings\.quoteTemplate\.validityDays/);
  assert.match(documentsSource, /salesSettings\.quoteTemplate\.title/);
  assert.match(documentsSource, /salesSettings\.quoteTemplate\.introText/);
  assert.match(documentsSource, /salesSettings\.quoteTemplate\.showVat/);
  assert.match(documentsSource, /salesSettings\.quoteTemplate\.footerText/);
  assert.match(documentsSource, /salesSettings\.defaultPaymentTerms\.paymentText/);
  assert.match(documentsSource, /salesSettings\.defaultDeliveryTerms\.deliveryText/);
  assert.match(documentsSource, /salesSettings\.warrantyTerms/);
  assert.match(documentsSource, /saleConditionKind\(equipmentItem\) === 'new'/);
  assert.match(documentsSource, /warrantyMonthsNew/);
  assert.match(documentsSource, /warrantyMonthsUsed/);
  assert.match(documentsSource, /salesSettings\.packageCommentTemplate\.text/);
  assert.doesNotMatch(documentsSource, /equipmentItem\?\.notes \|\| salesSettings\.packageCommentTemplate\.text/);
});

test('reports contain sales stock analytics outside the sales section', () => {
  const reportsSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Reports.tsx'), 'utf8');

  assert.match(reportsSource, /Продажный склад/);
  assert.match(reportsSource, /Техники на продаже/);
  assert.match(reportsSource, /Сумма по цене продажи/);
  assert.match(reportsSource, /Себестоимость/);
  assert.match(reportsSource, /Ожидаемая маржа/);
  assert.match(reportsSource, /PDI завершён/);
  assert.match(reportsSource, /С блокерами/);
  assert.match(reportsSource, /Без цены/);
  assert.match(reportsSource, /Без документов/);
  assert.match(reportsSource, /На продаже больше 30\/60\/90 дней/);
  assert.match(reportsSource, /Цена не обновлялась 30\/45\/60 дней/);
  assert.match(reportsSource, /filteredSalesStockRows/);
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
