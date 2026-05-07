import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isUniqueInventoryNumber,
  resolveRentalEquipment,
  findEquipmentForRentalPayload,
  equipmentMatchesServiceTicket,
} = require('../server/lib/equipment-matching.js');

test('isUniqueInventoryNumber returns false for duplicate inventory numbers', () => {
  const equipment = [
    { id: 'eq-1', inventoryNumber: '0' },
    { id: 'eq-2', inventoryNumber: '0' },
    { id: 'eq-3', inventoryNumber: '083' },
  ];

  assert.equal(isUniqueInventoryNumber('0', equipment), false);
  assert.equal(isUniqueInventoryNumber('083', equipment), true);
});

test('findEquipmentForRentalPayload resolves exact equipmentId even when inventory number is duplicated', () => {
  const equipment = [
    { id: 'eq-1', inventoryNumber: '0' },
    { id: 'eq-2', inventoryNumber: '0' },
  ];

  const resolved = findEquipmentForRentalPayload({ equipmentId: 'eq-2', equipmentInv: '0' }, equipment);
  assert.equal(resolved?.id, 'eq-2');
});

test('resolveRentalEquipment keeps rental.equipmentId canonical over conflicting legacy fields', () => {
  const equipment = [
    { id: 'eq-1', inventoryNumber: 'INV-1', serialNumber: 'SN-1', manufacturer: 'JCB', model: '3CX' },
    { id: 'eq-2', inventoryNumber: 'INV-2', serialNumber: 'SN-2', manufacturer: 'CAT', model: '428' },
  ];

  const resolved = resolveRentalEquipment({
    equipmentId: 'eq-2',
    equipmentInv: 'INV-1',
    inventoryNumber: 'INV-1',
    serialNumber: 'SN-1',
    equipment: ['INV-1'],
  }, equipment);

  assert.equal(resolved.equipmentId, 'eq-2');
  assert.equal(resolved.inventoryNumber, 'INV-2');
  assert.equal(resolved.serialNumber, 'SN-2');
  assert.equal(resolved.source, 'equipmentId');
  assert.equal(resolved.warnings.some(item => item.includes('legacy_ref_mismatch:INV-1')), true);
});

test('resolveRentalEquipment uses legacy rental.equipment only after scalar refs fail', () => {
  const equipment = [
    { id: 'eq-1', inventoryNumber: 'INV-1', serialNumber: 'SN-1' },
    { id: 'eq-2', inventoryNumber: 'INV-2', serialNumber: 'SN-2' },
  ];

  const byScalar = resolveRentalEquipment({ equipmentInv: 'INV-2', equipment: ['INV-1'] }, equipment);
  const byLegacy = resolveRentalEquipment({ equipment: ['INV-1'] }, equipment);

  assert.equal(byScalar.equipmentId, 'eq-2');
  assert.equal(byScalar.source, 'equipment.inventoryNumber');
  assert.equal(byLegacy.equipmentId, 'eq-1');
  assert.equal(byLegacy.source, 'legacy.rental.equipment:inventoryNumber');
});

test('findEquipmentForRentalPayload rejects ambiguous inventory without equipmentId', () => {
  const equipment = [
    { id: 'eq-1', inventoryNumber: '0' },
    { id: 'eq-2', inventoryNumber: '0' },
  ];

  const resolved = findEquipmentForRentalPayload({ equipmentInv: '0' }, equipment);
  assert.equal(resolved, null);
});

test('equipmentMatchesServiceTicket prefers serial number and does not fall back to duplicate inventory', () => {
  const equipment = [
    { id: 'eq-1', inventoryNumber: '0', serialNumber: 'SN-1' },
    { id: 'eq-2', inventoryNumber: '0', serialNumber: 'SN-2' },
  ];

  const bySerial = equipmentMatchesServiceTicket(
    { inventoryNumber: '0', serialNumber: 'SN-2' },
    equipment[1],
    equipment,
  );
  const byDuplicateInventory = equipmentMatchesServiceTicket(
    { inventoryNumber: '0' },
    equipment[1],
    equipment,
  );

  assert.equal(bySerial, true);
  assert.equal(byDuplicateInventory, false);
});
