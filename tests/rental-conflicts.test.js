import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findConflictingRental,
  hasDateOverlap,
  isEquipmentBusy,
} from '../src/app/lib/rental-conflicts.js';

test('hasDateOverlap detects intersecting rental periods', () => {
  assert.equal(hasDateOverlap('2026-04-10', '2026-04-20', '2026-04-20', '2026-04-25'), true);
  assert.equal(hasDateOverlap('2026-04-10', '2026-04-19', '2026-04-20', '2026-04-25'), false);
});

test('isEquipmentBusy uses equipmentId and does not block another machine with the same INV', () => {
  const equipmentA = { id: 'eq-1', inventoryNumber: '0' };
  const equipmentB = { id: 'eq-2', inventoryNumber: '0' };
  const rentals = [
    {
      id: 'rental-1',
      equipmentId: 'eq-1',
      equipmentInv: '0',
      startDate: '2026-04-10',
      endDate: '2026-04-20',
      status: 'active',
    },
  ];

  assert.equal(isEquipmentBusy(equipmentA, '2026-04-12', '2026-04-15', rentals), true);
  assert.equal(isEquipmentBusy(equipmentB, '2026-04-12', '2026-04-15', rentals), false);
});

test('isEquipmentBusy ignores returned and closed rentals', () => {
  const equipment = { id: 'eq-1', inventoryNumber: '083' };
  const rentals = [
    {
      id: 'rental-1',
      equipmentId: 'eq-1',
      equipmentInv: '083',
      startDate: '2026-04-10',
      endDate: '2026-04-20',
      status: 'returned',
    },
    {
      id: 'rental-2',
      equipmentId: 'eq-1',
      equipmentInv: '083',
      startDate: '2026-04-10',
      endDate: '2026-04-20',
      status: 'closed',
    },
  ];

  assert.equal(isEquipmentBusy(equipment, '2026-04-12', '2026-04-15', rentals), false);
});

test('findConflictingRental skips the current rental when editing', () => {
  const equipment = { id: 'eq-1', inventoryNumber: '083' };
  const rentals = [
    {
      id: 'rental-1',
      equipmentId: 'eq-1',
      equipmentInv: '083',
      startDate: '2026-04-10',
      endDate: '2026-04-20',
      status: 'active',
    },
    {
      id: 'rental-2',
      equipmentId: 'eq-1',
      equipmentInv: '083',
      startDate: '2026-04-22',
      endDate: '2026-04-25',
      status: 'created',
    },
  ];

  const conflict = findConflictingRental(equipment, '2026-04-12', '2026-04-24', rentals, 'rental-1');
  assert.equal(conflict?.id, 'rental-2');
});
