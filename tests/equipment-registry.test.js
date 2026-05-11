import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildActiveRentalIndex,
  buildEquipmentTabCounts,
  documentMatchesEquipmentOrRentals,
  enrichEquipment,
  equipmentFilterReasons,
  equipmentMatchesInvestorBinding,
  getEquipmentGsmDisplay,
  getRegistryStatusKind,
  hasEquipmentGsmData,
  isForSaleEquipment,
  isEquipmentInventoryUnique,
  isSaleRegistryEquipment,
  isSoldEquipment,
  matchesStatusFilter,
  matchesTabType,
  matchesEquipmentSearch,
  recordMatchesEquipmentBySafeKey,
  rentalMatchesEquipment,
  serviceTicketMatchesEquipment,
} from '../src/app/pages/equipment/equipment.helpers.ts';

const equipmentClassificationSource = fs.readFileSync(path.join(process.cwd(), 'src/app/lib/equipmentClassification.ts'), 'utf8');

const canRentOwnOrPartner = (equipment = {}) => (
  equipment.activeInFleet !== false
  && (equipment.category === undefined || equipment.category === 'own' || equipment.category === 'partner')
  && equipment.saleStatus !== 'Продана'
);

test('equipment registry active rental index uses ids and only unique legacy inventory numbers', () => {
  const equipment = [
    { id: 'EQ-1', inventoryNumber: 'DUP' },
    { id: 'EQ-2', inventoryNumber: 'DUP' },
    { id: 'EQ-3', inventoryNumber: 'UNIQUE' },
  ];
  const index = buildActiveRentalIndex(equipment, [
    { id: 'R-id', equipmentId: 'EQ-2', equipmentInv: 'DUP', status: 'active' },
    { id: 'R-duplicate-inv', equipmentInv: 'DUP', status: 'active' },
    { id: 'R-unique-inv', equipmentInv: 'UNIQUE', status: 'created' },
    { id: 'R-closed', equipmentId: 'EQ-1', equipmentInv: 'DUP', status: 'closed' },
  ]);

  assert.equal(index.equipmentIds.has('EQ-2'), true);
  assert.equal(index.equipmentIds.has('EQ-1'), false);
  assert.equal(index.uniqueInventoryNumbers.has('UNIQUE'), true);
  assert.equal(index.uniqueInventoryNumbers.has('DUP'), false);
});

test('equipment registry enrichment prefers active rentals and does not overwrite existing display fields', () => {
  const equipment = [
    { id: 'EQ-1', inventoryNumber: 'INV-1', status: 'available' },
    { id: 'EQ-2', inventoryNumber: 'INV-2', status: 'available', currentClient: 'Manual client', returnDate: '2026-06-01' },
  ];
  const enriched = enrichEquipment(equipment, [
    { id: 'R-created', equipmentId: 'EQ-1', equipmentInv: 'INV-1', client: 'Created client', endDate: '2026-05-20', status: 'created' },
    { id: 'R-active', equipmentId: 'EQ-1', equipmentInv: 'INV-1', client: 'Active client', endDate: '2026-05-30', status: 'active' },
    { id: 'R-manual', equipmentId: 'EQ-2', equipmentInv: 'INV-2', client: 'Rental client', endDate: '2026-07-01', status: 'active' },
  ]);

  assert.equal(enriched.find(item => item.id === 'EQ-1')?.currentClient, 'Active client');
  assert.equal(enriched.find(item => item.id === 'EQ-1')?.returnDate, '2026-05-30');
  assert.equal(enriched.find(item => item.id === 'EQ-2')?.currentClient, 'Manual client');
  assert.equal(enriched.find(item => item.id === 'EQ-2')?.returnDate, '2026-06-01');
});

test('equipment registry sale predicates separate on-sale removed and sold records', () => {
  const onSale = { id: 'EQ-sale', status: 'available', saleMode: true, saleStatus: 'На продаже' };
  const sold = { id: 'EQ-sold', status: 'inactive', category: 'sold', saleStatus: 'Продана' };
  const removed = { id: 'EQ-removed', status: 'inactive', saleStatus: 'Снята с продажи' };

  assert.equal(isSaleRegistryEquipment(onSale), true);
  assert.equal(isForSaleEquipment(onSale), true);
  assert.equal(isSoldEquipment(onSale), false);

  assert.equal(isSaleRegistryEquipment(sold), true);
  assert.equal(isSoldEquipment(sold), true);
  assert.equal(isForSaleEquipment(sold), false);

  assert.equal(isSaleRegistryEquipment(removed), true);
  assert.equal(isSoldEquipment(removed), false);
  assert.equal(isForSaleEquipment(removed), false);
});

test('equipment registry tab matching keeps rental availability scoped and hidden records excluded', () => {
  const activeRentalIndex = buildActiveRentalIndex(
    [{ id: 'EQ-rented', inventoryNumber: 'INV-rented' }],
    [{ id: 'R-1', equipmentId: 'EQ-rented', equipmentInv: 'INV-rented', status: 'active' }],
  );
  const options = { canEquipmentParticipateInRentals: canRentOwnOrPartner };

  assert.equal(matchesTabType({ id: 'EQ-free', inventoryNumber: 'INV-free', status: 'available', category: 'own' }, 'available', activeRentalIndex, options), true);
  assert.equal(matchesTabType({ id: 'EQ-client', inventoryNumber: 'INV-client', status: 'available', category: 'client' }, 'available', activeRentalIndex, options), false);
  assert.equal(matchesTabType({ id: 'EQ-rented', inventoryNumber: 'INV-rented', status: 'available', category: 'own' }, 'available', activeRentalIndex, options), false);
  assert.equal(matchesTabType({ id: 'EQ-rented', inventoryNumber: 'INV-rented', status: 'available', category: 'own' }, 'rented', activeRentalIndex, options), true);
  assert.equal(matchesTabType({ id: 'EQ-hidden', inventoryNumber: 'INV-hidden', status: 'available', hidden: true }, 'all', activeRentalIndex, options), false);
});

test('equipment registry status filters reuse tab behavior for sales and active rentals', () => {
  const activeRentalIndex = buildActiveRentalIndex(
    [{ id: 'EQ-rented', inventoryNumber: 'INV-rented' }],
    [{ id: 'R-1', equipmentId: 'EQ-rented', equipmentInv: 'INV-rented', status: 'active' }],
  );
  const options = { canEquipmentParticipateInRentals: canRentOwnOrPartner };

  assert.equal(getRegistryStatusKind({ id: 'EQ-rented', inventoryNumber: 'INV-rented', status: 'available' }, activeRentalIndex), 'rented');
  assert.equal(getRegistryStatusKind({ id: 'EQ-sale', status: 'available', saleMode: true }, activeRentalIndex), 'for_sale');
  assert.equal(getRegistryStatusKind({ id: 'EQ-sold', status: 'inactive', category: 'sold' }, activeRentalIndex), 'sold');

  assert.equal(matchesStatusFilter({ id: 'EQ-sale', status: 'available', saleMode: true }, 'for_sale', activeRentalIndex, options), true);
  assert.equal(matchesStatusFilter({ id: 'EQ-sold', status: 'inactive', category: 'sold' }, 'sold', activeRentalIndex, options), true);
  assert.equal(matchesStatusFilter({ id: 'EQ-rented', inventoryNumber: 'INV-rented', status: 'available' }, 'rented', activeRentalIndex, options), true);
});

test('equipment registry availability rules keep blocked states out of free tab', () => {
  const activeRentalIndex = buildActiveRentalIndex(
    [{ id: 'EQ-active', inventoryNumber: 'INV-active' }],
    [{ id: 'R-active', equipmentId: 'EQ-active', equipmentInv: 'INV-active', status: 'active' }],
  );
  const options = { canEquipmentParticipateInRentals: canRentOwnOrPartner };

  assert.equal(matchesTabType({ id: 'EQ-free', inventoryNumber: 'INV-free', status: 'available', category: 'own' }, 'available', activeRentalIndex, options), true);
  assert.equal(matchesTabType({ id: 'EQ-active', inventoryNumber: 'INV-active', status: 'available', category: 'own' }, 'available', activeRentalIndex, options), false);
  assert.equal(matchesTabType({ id: 'EQ-rented', inventoryNumber: 'INV-rented', status: 'rented', category: 'own' }, 'available', activeRentalIndex, options), false);
  assert.equal(matchesTabType({ id: 'EQ-service', inventoryNumber: 'INV-service', status: 'in_service', category: 'own' }, 'available', activeRentalIndex, options), false);
  assert.equal(matchesTabType({ id: 'EQ-reserved', inventoryNumber: 'INV-reserved', status: 'reserved', category: 'own' }, 'available', activeRentalIndex, options), false);
  assert.equal(matchesTabType({ id: 'EQ-inactive', inventoryNumber: 'INV-inactive', status: 'inactive', category: 'own' }, 'available', activeRentalIndex, options), false);
  assert.equal(matchesTabType({ id: 'EQ-sold', inventoryNumber: 'INV-sold', status: 'inactive', category: 'sold', saleStatus: 'Продана' }, 'available', activeRentalIndex, options), false);
});

test('equipment registry search covers model inventory serial owner and location', () => {
  const equipment = {
    id: 'EQ-search',
    status: 'available',
    model: 'Genie GS-1932',
    manufacturer: 'Genie',
    inventoryNumber: 'INV-1932',
    serialNumber: 'SN-1932',
    owner: 'investor',
    ownerName: 'Инвестор Альфа',
    location: 'Казань',
  };

  assert.equal(matchesEquipmentSearch(equipment, 'gs-1932'), true);
  assert.equal(matchesEquipmentSearch(equipment, 'inv-1932'), true);
  assert.equal(matchesEquipmentSearch(equipment, 'sn-1932'), true);
  assert.equal(matchesEquipmentSearch(equipment, 'инвестор альфа'), true);
  assert.equal(matchesEquipmentSearch(equipment, 'казань'), true);
  assert.equal(matchesEquipmentSearch(equipment, 'не существует'), false);
});

test('equipment registry filters combine active tab with field filters', () => {
  const activeRentalIndex = buildActiveRentalIndex([], []);
  const equipment = {
    id: 'EQ-filter',
    status: 'available',
    model: 'Genie GS-1932',
    type: 'scissor_lift',
    drive: 'electric',
    category: 'own',
    activeInFleet: true,
    owner: 'own',
    ownerName: 'Скайтех',
    location: 'Казань',
  };
  const filters = {
    activeTab: 'available',
    search: 'genie',
    statusFilter: 'available',
    typeFilter: 'exact:scissor_lift',
    driveFilter: 'electric',
    categoryFilter: 'own',
    fleetFilter: 'true',
    ownerFilter: 'ownerName:Скайтех',
    locationFilter: 'Казань',
    activeRentalIndex,
    equipmentTypeOptions: [{ value: 'scissor_lift', label: 'Ножничный подъемник' }],
  };

  assert.deepEqual(equipmentFilterReasons(equipment, filters), []);
  assert.deepEqual(equipmentFilterReasons({ ...equipment, status: 'rented' }, filters), ['status', 'tab:available']);
  assert.deepEqual(equipmentFilterReasons(equipment, { ...filters, activeTab: 'rented', statusFilter: 'all' }), ['tab:rented']);
});

test('equipment normalization uses activeInFleet as canonical rental fleet field', () => {
  assert.match(equipmentClassificationSource, /export function normalizeEquipmentActiveInFleet/);
  assert.match(equipmentClassificationSource, /'rentalFleet'/);
  assert.match(equipmentClassificationSource, /'isRentalFleet'/);
  assert.match(equipmentClassificationSource, /'availableForRent'/);
  assert.match(equipmentClassificationSource, /activeInFleet: normalizeEquipmentActiveInFleet/);
  assert.match(equipmentClassificationSource, /hasActiveInFleet \? \{ activeInFleet: normalizeEquipmentActiveInFleet/);
  assert.match(equipmentClassificationSource, /isRentalFleet: _isRentalFleet/);
});

test('equipment registry tab counts preserve sale and fleet classification', () => {
  const equipment = [
    { id: 'EQ-free', inventoryNumber: 'INV-free', status: 'available', category: 'own' },
    { id: 'EQ-active', inventoryNumber: 'INV-active', status: 'available', category: 'own' },
    { id: 'EQ-rented', inventoryNumber: 'INV-rented', status: 'rented', category: 'own' },
    { id: 'EQ-service', inventoryNumber: 'INV-service', status: 'in_service', category: 'own' },
    { id: 'EQ-reserved', inventoryNumber: 'INV-reserved', status: 'reserved', category: 'own' },
    { id: 'EQ-written-off', inventoryNumber: 'INV-written-off', status: 'inactive', category: 'own' },
    { id: 'EQ-sale', inventoryNumber: 'INV-sale', status: 'available', category: 'own', saleMode: true, saleStatus: 'На продаже' },
    { id: 'EQ-sold', inventoryNumber: 'INV-sold', status: 'inactive', category: 'sold', saleStatus: 'Продана' },
  ];
  const activeRentalIndex = buildActiveRentalIndex(
    equipment,
    [{ id: 'R-active', equipmentId: 'EQ-active', equipmentInv: 'INV-active', status: 'active' }],
  );
  const tabs = [
    { key: 'all' },
    { key: 'available' },
    { key: 'rented' },
    { key: 'service' },
    { key: 'reserved' },
    { key: 'written_off' },
    { key: 'for_sale' },
    { key: 'sold' },
  ];
  const counts = buildEquipmentTabCounts(equipment, tabs, activeRentalIndex, { canEquipmentParticipateInRentals: canRentOwnOrPartner });

  assert.equal(counts.all, 8);
  assert.equal(counts.available, 2);
  assert.equal(counts.rented, 2);
  assert.equal(counts.service, 1);
  assert.equal(counts.reserved, 1);
  assert.equal(counts.written_off, 1);
  assert.equal(counts.for_sale, 2);
  assert.equal(counts.sold, 1);
  assert.equal(matchesTabType(equipment.find(item => item.id === 'EQ-sold'), 'available', activeRentalIndex, { canEquipmentParticipateInRentals: canRentOwnOrPartner }), false);
});

test('equipment registry investor scope accepts only safe owner bindings', () => {
  const binding = { ownerId: 'owner-1', ownerName: 'Инвестор Альфа' };

  assert.equal(equipmentMatchesInvestorBinding({ id: 'EQ-id', ownerId: 'OWNER-1', ownerName: 'Другая карточка' }, binding), true);
  assert.equal(equipmentMatchesInvestorBinding({ id: 'EQ-name', ownerName: ' инвестор альфа ' }, binding), true);
  assert.equal(equipmentMatchesInvestorBinding({ id: 'EQ-other', ownerId: 'owner-2', ownerName: 'Инвестор Бета' }, binding), false);
  assert.equal(equipmentMatchesInvestorBinding({ id: 'EQ-empty', owner: 'investor' }, binding), false);
});

test('equipment registry safe matching does not use ambiguous inventory numbers', () => {
  const equipment = { id: 'EQ-1', inventoryNumber: 'DUP', serialNumber: 'SN-1' };
  const allEquipment = [
    equipment,
    { id: 'EQ-2', inventoryNumber: 'DUP', serialNumber: 'SN-2' },
    { id: 'EQ-3', inventoryNumber: 'UNIQUE', serialNumber: 'SN-3' },
  ];
  const duplicateInventoryIsUnique = isEquipmentInventoryUnique(equipment, allEquipment);
  const uniqueEquipment = allEquipment[2];
  const uniqueInventoryIsUnique = isEquipmentInventoryUnique(uniqueEquipment, allEquipment);

  assert.equal(duplicateInventoryIsUnique, false);
  assert.equal(uniqueInventoryIsUnique, true);
  assert.equal(recordMatchesEquipmentBySafeKey({ equipmentInv: 'DUP' }, equipment, duplicateInventoryIsUnique), false);
  assert.equal(recordMatchesEquipmentBySafeKey({ equipmentId: 'EQ-1' }, equipment, duplicateInventoryIsUnique), true);
  assert.equal(recordMatchesEquipmentBySafeKey({ serialNumber: 'SN-1' }, equipment, duplicateInventoryIsUnique), true);
  assert.equal(recordMatchesEquipmentBySafeKey({ equipmentInv: 'UNIQUE' }, uniqueEquipment, uniqueInventoryIsUnique), true);
  assert.equal(rentalMatchesEquipment({ id: 'R-dup', equipment: ['DUP'] }, equipment, duplicateInventoryIsUnique), false);
  assert.equal(rentalMatchesEquipment({ id: 'R-unique', equipment: ['UNIQUE'] }, uniqueEquipment, uniqueInventoryIsUnique), true);
  assert.equal(documentMatchesEquipmentOrRentals({ id: 'D-dup', equipmentInv: 'DUP' }, equipment, duplicateInventoryIsUnique, new Set()), false);
  assert.equal(documentMatchesEquipmentOrRentals({ id: 'D-rental', rentalId: 'R-1' }, equipment, duplicateInventoryIsUnique, new Set(['R-1'])), true);
  assert.equal(serviceTicketMatchesEquipment({ id: 'S-dup', equipmentInv: 'DUP' }, equipment, duplicateInventoryIsUnique), false);
});

test('equipment registry GSM fallback distinguishes missing data and known signal states', () => {
  assert.equal(hasEquipmentGsmData({ id: 'EQ-empty' }), false);
  assert.deepEqual(getEquipmentGsmDisplay({ id: 'EQ-empty' }), {
    label: 'Нет данных',
    className: 'bg-muted text-muted-foreground',
    dotClassName: 'bg-slate-400',
  });
  assert.equal(hasEquipmentGsmData({ id: 'EQ-online', gsmStatus: 'online' }), true);
  assert.equal(getEquipmentGsmDisplay({ id: 'EQ-online', gsmStatus: 'online' }).label, 'Онлайн');
  assert.equal(getEquipmentGsmDisplay({ id: 'EQ-location', gsmSignalStatus: 'location_only' }).label, 'Нет связи');
});
