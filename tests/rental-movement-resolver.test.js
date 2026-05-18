import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRentalMovementResolverContext,
  getMovementEquipmentLabel,
  resolveMovementClientObject,
  resolveMovementEquipment,
} from '../src/app/lib/rentalMovementResolver.js';

const equipment = {
  id: 'EQ-1',
  manufacturer: 'Mantall',
  model: 'XE',
  inventoryNumber: 'INV-001',
  serialNumber: 'SN-001',
};

function context(overrides = {}) {
  return buildRentalMovementResolverContext({
    equipmentList: [equipment],
    rentals: [],
    deliveries: [],
    clients: [{ id: 'C-1', company: 'ООО Клиент' }],
    clientObjects: [{ id: 'CO-1', clientId: 'C-1', name: 'Башня', address: 'Казань' }],
    ...overrides,
  });
}

function renderMovementText(source, ctx = context()) {
  const resolution = resolveMovementEquipment(source, ctx);
  const clientObject = resolveMovementClientObject(source, resolution, ctx);
  return [
    getMovementEquipmentLabel(resolution.equipment, resolution.diagnosticReason),
    resolution.equipment?.serialNumber || source.serialNumber || source.equipmentSerialNumber || source.vin || source.sn || 'не указан',
    resolution.equipment?.inventoryNumber || source.inventoryNumber || source.equipmentInventoryNumber || source.invNumber || source.equipmentInv || 'не указан',
    clientObject.clientLabel,
    clientObject.objectLabel,
  ].join(' · ');
}

test('movement row with direct equipmentId resolves equipment', () => {
  const resolution = resolveMovementEquipment({ id: 'SP-direct', type: 'shipping', equipmentId: 'EQ-1' }, context());

  assert.equal(resolution.equipment.id, 'EQ-1');
  assert.equal(resolution.reason, 'direct_equipment_id');
});

test('movement row without equipmentId but with rentalId resolves rental.equipmentId', () => {
  const resolution = resolveMovementEquipment(
    { id: 'SP-rental', type: 'shipping', rentalId: 'R-1' },
    context({ rentals: [{ id: 'R-1', equipmentId: 'EQ-1', clientId: 'C-1', objectId: 'CO-1' }] }),
  );

  assert.equal(resolution.equipment.id, 'EQ-1');
  assert.equal(resolution.rental.id, 'R-1');
  assert.equal(resolution.reason, 'rental_equipment_id');
});

test('movement row without equipmentId but with deliveryId resolves delivery.equipmentId', () => {
  const resolution = resolveMovementEquipment(
    { id: 'SP-delivery', type: 'shipping', deliveryId: 'DL-1' },
    context({ deliveries: [{ id: 'DL-1', equipmentId: 'EQ-1', clientId: 'C-1', objectId: 'CO-1' }] }),
  );

  assert.equal(resolution.equipment.id, 'EQ-1');
  assert.equal(resolution.delivery.id, 'DL-1');
  assert.equal(resolution.reason, 'delivery_equipment_id');
});

test('movement row with delivery.rentalId resolves rental.equipmentId', () => {
  const resolution = resolveMovementEquipment(
    { id: 'SP-delivery-rental', type: 'receiving', deliveryId: 'DL-2' },
    context({
      rentals: [{ id: 'R-2', equipmentId: 'EQ-1', clientId: 'C-1', objectId: 'CO-1' }],
      deliveries: [{ id: 'DL-2', rentalId: 'R-2' }],
    }),
  );

  assert.equal(resolution.equipment.id, 'EQ-1');
  assert.equal(resolution.rental.id, 'R-2');
  assert.equal(resolution.reason, 'delivery_rental_equipment_id');
});

test('legacy photo row with only serialNumber/inventoryNumber resolves equipment', () => {
  const bySerial = resolveMovementEquipment({ id: 'SP-sn', type: 'shipping', serialNumber: ' sn-001 ' }, context());
  const byInventory = resolveMovementEquipment({ id: 'SP-inv', type: 'shipping', inventoryNumber: ' inv-001 ' }, context());

  assert.equal(bySerial.equipment.id, 'EQ-1');
  assert.equal(bySerial.reason, 'legacy_serial_number');
  assert.equal(byInventory.equipment.id, 'EQ-1');
  assert.equal(byInventory.reason, 'legacy_inventory_number');
});

test('broken row does not crash and shows honest diagnostic fallback', () => {
  const resolution = resolveMovementEquipment({ id: 'SP-broken', type: 'shipping', equipmentId: 'EQ-missing' }, context());
  const label = getMovementEquipmentLabel(resolution.equipment, resolution.diagnosticReason);

  assert.equal(resolution.equipment, null);
  assert.equal(label, 'Техника не найдена: equipmentId указывает на отсутствующую карточку');
  assert.equal(resolution.diagnostic.foundEquipment, false);
});

test('broken row without identifiers reports missing equipment identifiers', () => {
  const resolution = resolveMovementEquipment({ id: 'SP-empty', type: 'receiving' }, context());

  assert.equal(resolution.equipment, null);
  assert.equal(resolution.diagnosticReason, 'Техника не найдена: нет equipmentId/SN/INV в источнике');
});

test('client and object resolve through movement, rental, and delivery ids', () => {
  const ctx = context({
    rentals: [{ id: 'R-1', equipmentId: 'EQ-1', clientId: 'C-1', objectId: 'CO-1' }],
    deliveries: [{ id: 'DL-1', rentalId: 'R-1' }],
  });
  const resolution = resolveMovementEquipment({ id: 'SP-1', deliveryId: 'DL-1' }, ctx);
  const clientObject = resolveMovementClientObject({ id: 'SP-1', deliveryId: 'DL-1' }, resolution, ctx);

  assert.equal(clientObject.clientLabel, 'ООО Клиент');
  assert.equal(clientObject.objectLabel, 'Башня');
});

test('rendered movement row text has no undefined, null, or object placeholders', () => {
  const rendered = renderMovementText({ id: 'SP-safe', type: 'shipping', client: { bad: true }, objectName: { bad: true } });

  assert.doesNotMatch(rendered, /undefined|null|\[object Object\]/);
  assert.match(rendered, /Техника не найдена: нет equipmentId\/SN\/INV в источнике/);
  assert.match(rendered, /Без клиента: нет clientId в источнике/);
  assert.match(rendered, /Объект не указан: нет objectId в источнике/);
});
