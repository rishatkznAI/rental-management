import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  findConflictingRental,
  formatConflictError,
  validateRentalPayload,
} = require('../server/lib/rental-validation.js');

const rentableEquipment = [
  { id: 'eq-1', inventoryNumber: '083', serialNumber: 'SN-083', category: 'own', activeInFleet: true },
];

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

test('findConflictingRental does not let stale legacy inventory override canonical equipmentId', () => {
  const equipment = [
    { id: 'eq-1', inventoryNumber: 'INV-1', serialNumber: 'SN-1' },
    { id: 'eq-2', inventoryNumber: 'INV-2', serialNumber: 'SN-2' },
  ];
  const rentals = [
    {
      id: 'gr-1',
      equipmentId: 'eq-1',
      equipmentInv: 'INV-1',
      startDate: '2026-04-10',
      endDate: '2026-04-20',
      status: 'active',
    },
  ];

  const conflict = findConflictingRental(
    'gantt_rentals',
    {
      id: 'gr-2',
      equipmentId: 'eq-2',
      equipmentInv: 'INV-1',
      inventoryNumber: 'INV-1',
      equipment: ['INV-1'],
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

test('availability validation returns a structured recovery payload', () => {
  const validation = validateRentalPayload('rentals', {
    equipmentId: 'eq-1',
    equipmentInv: '083',
    startDate: '2026-04-15',
    plannedReturnDate: '2026-04-25',
    price: 1000,
  }, [{
    id: 'R-existing',
    clientId: 'C-existing',
    client: 'ЭМ-СТРОЙ',
    equipmentId: 'eq-1',
    equipmentInv: '083',
    startDate: '2026-04-10',
    plannedReturnDate: '2026-04-20',
    status: 'active',
  }], rentableEquipment);

  assert.equal(validation.ok, false);
  assert.equal(validation.status, 409);
  assert.equal(validation.code, 'EQUIPMENT_AVAILABILITY_CONFLICT');
  assert.deepEqual(validation.conflict, {
    rentalId: 'R-existing',
    clientId: 'C-existing',
    client: 'ЭМ-СТРОЙ',
    equipmentId: 'eq-1',
    equipmentInv: '083',
    startDate: '2026-04-10',
    endDate: '2026-04-20',
    status: 'active',
  });
});

test('validateRentalPayload rejects negative rental amount', () => {
  const validation = validateRentalPayload('gantt_rentals', {
    equipmentId: 'eq-1',
    startDate: '2026-04-10',
    endDate: '2026-04-10',
    amount: -1,
  }, [], rentableEquipment);

  assert.equal(validation.ok, false);
  assert.equal(validation.status, 400);
});

test('validateRentalPayload rejects non-numeric rental amount', () => {
  const validation = validateRentalPayload('gantt_rentals', {
    equipmentId: 'eq-1',
    startDate: '2026-04-10',
    endDate: '2026-04-10',
    amount: 'abc',
  }, [], rentableEquipment);

  assert.equal(validation.ok, false);
  assert.equal(validation.status, 400);
});

test('validateRentalPayload rejects Infinity rental amount', () => {
  const validation = validateRentalPayload('gantt_rentals', {
    equipmentId: 'eq-1',
    startDate: '2026-04-10',
    endDate: '2026-04-10',
    amount: 'Infinity',
  }, [], rentableEquipment);

  assert.equal(validation.ok, false);
  assert.equal(validation.status, 400);
});

test('validateRentalPayload rejects a negative deposit', () => {
  const validation = validateRentalPayload('rentals', {
    equipmentId: 'eq-1',
    startDate: '2026-04-10',
    plannedReturnDate: '2026-04-10',
    price: 10000,
    deposit: -1,
  }, [], rentableEquipment);

  assert.equal(validation.ok, false);
  assert.equal(validation.status, 400);
  assert.match(validation.error, /Залог/);
});

test('validateRentalPayload rejects non-numeric rental rate', () => {
  const validation = validateRentalPayload('gantt_rentals', {
    equipmentId: 'eq-1',
    startDate: '2026-04-10',
    endDate: '2026-04-10',
    rate: 'abc',
  }, [], rentableEquipment);

  assert.equal(validation.ok, false);
  assert.equal(validation.status, 400);
});

test('validateRentalPayload rejects a numeric rate hidden inside malformed text', () => {
  const validation = validateRentalPayload('rentals', {
    equipmentId: 'eq-1',
    startDate: '2026-04-10',
    plannedReturnDate: '2026-04-10',
    price: 10000,
    rate: 'garbage 1000/day',
  }, [], rentableEquipment);

  assert.equal(validation.ok, false);
  assert.equal(validation.status, 400);
});

test('validateRentalPayload accepts same-day rental period', () => {
  const validation = validateRentalPayload('gantt_rentals', {
    equipmentId: 'eq-1',
    startDate: '2026-04-10',
    endDate: '2026-04-10',
    amount: 10000,
  }, [], rentableEquipment);

  assert.equal(validation.ok, true);
});

test('validateRentalPayload rejects endDate before startDate', () => {
  const validation = validateRentalPayload('gantt_rentals', {
    equipmentId: 'eq-1',
    startDate: '2026-04-11',
    endDate: '2026-04-10',
    amount: 10000,
  }, [], rentableEquipment);

  assert.equal(validation.ok, false);
  assert.equal(validation.status, 400);
});

test('validateRentalPayload rejects invalid rental dates', () => {
  const validation = validateRentalPayload('gantt_rentals', {
    equipmentId: 'eq-1',
    startDate: 'not-a-date',
    endDate: '2026-04-10',
    amount: 10000,
  }, [], rentableEquipment);

  assert.equal(validation.ok, false);
  assert.equal(validation.status, 400);
  assert.match(validation.error, /дат/);
});
