import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  findConflictingRental,
  formatConflictError,
} = require('../server/lib/rental-validation.js');

test('findConflictingRental finds overlap by exact equipmentId', () => {
  const equipment = [
    { id: 'eq-1', inventoryNumber: '083', serialNumber: 'SN-083' },
    { id: 'eq-2', inventoryNumber: '084', serialNumber: 'SN-084' },
  ];
  const rentals = [
    {
      id: 'gr-1',
      equipmentId: 'eq-1',
      equipmentInv: '083',
      client: 'ЭМ-СТРОЙ',
      startDate: '2026-04-10',
      endDate: '2026-04-20',
      status: 'active',
    },
  ];

  const conflict = findConflictingRental(
    'gantt_rentals',
    {
      id: 'gr-2',
      equipmentId: 'eq-1',
      equipmentInv: '083',
      startDate: '2026-04-15',
      endDate: '2026-04-25',
      status: 'active',
    },
    rentals,
    equipment,
  );

  assert.equal(conflict?.id, 'gr-1');
});

test('findConflictingRental ignores duplicate inventory without equipmentId', () => {
  const equipment = [
    { id: 'eq-1', inventoryNumber: '0', serialNumber: 'SN-1' },
    { id: 'eq-2', inventoryNumber: '0', serialNumber: 'SN-2' },
  ];
  const rentals = [
    {
      id: 'gr-1',
      equipmentId: 'eq-1',
      equipmentInv: '0',
      client: 'ЭМ-СТРОЙ',
      startDate: '2026-04-10',
      endDate: '2026-04-20',
      status: 'active',
    },
  ];

  const conflict = findConflictingRental(
    'gantt_rentals',
    {
      id: 'gr-2',
      equipmentInv: '0',
      startDate: '2026-04-15',
      endDate: '2026-04-25',
      status: 'active',
    },
    rentals,
    equipment,
  );

  assert.equal(conflict, null);
});

test('formatConflictError returns readable period and client', () => {
  const message = formatConflictError(
    {
      client: 'ЭМ-СТРОЙ',
      startDate: '2026-04-10',
      endDate: '2026-04-20',
    },
    'gantt_rentals',
  );

  assert.equal(message, 'Техника уже занята в период 2026-04-10 — 2026-04-20 (ЭМ-СТРОЙ)');
});
