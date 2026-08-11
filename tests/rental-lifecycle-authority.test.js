import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  equipmentProjectionForState,
  validateTerminalRentalTransition,
} = require('../server/lib/rental-lifecycle.js');

const today = '2026-05-15';
const equipment = {
  id: 'EQ-1',
  inventoryNumber: 'INV-1',
  status: 'available',
  activeInFleet: true,
};

function classicRental(overrides = {}) {
  return {
    id: 'R-1',
    clientId: 'C-classic',
    client: 'Classic client',
    equipmentId: 'EQ-1',
    equipmentInv: 'INV-1',
    startDate: '2026-05-10',
    plannedReturnDate: '2026-05-20',
    status: 'active',
    ...overrides,
  };
}

function ganttProjection(overrides = {}) {
  return {
    id: 'GR-1',
    rentalId: 'R-1',
    clientId: 'C-gantt',
    client: 'Conflicting Gantt client',
    equipmentId: 'EQ-1',
    equipmentInv: 'INV-1',
    startDate: '2026-05-10',
    endDate: '2026-05-20',
    status: 'active',
    ...overrides,
  };
}

function project({ rentals = [], ganttRentals = [] } = {}) {
  return equipmentProjectionForState({
    equipment,
    equipmentList: [equipment],
    rentals,
    ganttRentals,
    serviceTickets: [],
    today,
  });
}

test('active Classic rental remains authoritative when its Gantt projection is missing', () => {
  const projection = project({ rentals: [classicRental()] });

  assert.equal(projection.source, 'rental');
  assert.equal(projection.status, 'rented');
  assert.equal(projection.rental.id, 'R-1');
});

test('orphan active Gantt row cannot make equipment rented', () => {
  const projection = project({ ganttRentals: [ganttProjection({ rentalId: undefined })] });

  assert.equal(projection.source, 'available');
  assert.equal(projection.status, 'available');
  assert.equal(projection.rental, null);
});

test('Classic rental status wins over a conflicting linked Gantt status', () => {
  const activeClassic = project({
    rentals: [classicRental()],
    ganttRentals: [ganttProjection({ status: 'closed' })],
  });
  const closedClassic = project({
    rentals: [classicRental({ status: 'closed' })],
    ganttRentals: [ganttProjection({ status: 'active' })],
  });

  assert.equal(activeClassic.status, 'rented');
  assert.equal(closedClassic.status, 'available');
});

test('conflicting Gantt client identity and label do not affect Classic rental identity', () => {
  const projection = project({
    rentals: [classicRental()],
    ganttRentals: [ganttProjection()],
  });

  assert.equal(projection.rental.id, 'R-1');
  assert.equal(projection.rental.clientId, 'C-classic');
  assert.equal(projection.currentClient, 'Classic client');
});

test('closed Classic rental plus active orphan Gantt leaves equipment available', () => {
  const projection = project({
    rentals: [classicRental({ status: 'returned', actualReturnDate: '2026-05-14' })],
    ganttRentals: [ganttProjection({ rentalId: undefined, status: 'active' })],
  });

  assert.equal(projection.source, 'available');
  assert.equal(projection.status, 'available');
  assert.equal(projection.rental, null);
});

test('terminal Classic rental transition guard permits terminal edits but rejects resurrection and return-date removal', () => {
  const previous = classicRental({ status: 'closed', actualReturnDate: '2026-05-14' });

  assert.deepEqual(validateTerminalRentalTransition(previous, {
    ...previous,
    comments: 'Архивный комментарий',
  }), { ok: true });
  assert.equal(validateTerminalRentalTransition(previous, {
    ...previous,
    status: 'active',
  }).code, 'RENTAL_TERMINAL_RESURRECTION_FORBIDDEN');
  assert.equal(validateTerminalRentalTransition(previous, {
    ...previous,
    actualReturnDate: '',
  }).code, 'RENTAL_TERMINAL_RESURRECTION_FORBIDDEN');
});
