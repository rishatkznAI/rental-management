import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isUniqueInventoryNumber,
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
