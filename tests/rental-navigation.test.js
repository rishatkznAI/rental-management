import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRentalNavigationId } from '../src/app/lib/rentalNavigation.js';

const rentals = [
  { id: 'R-1', clientId: 'C-1' },
  { id: 'R-2', clientId: 'C-1' },
  { id: 'R-3', clientId: 'C-2' },
];

const ganttRentals = [
  { id: 'GR-1', rentalId: 'R-1', clientId: 'C-1' },
  { id: 'GR-2', sourceRentalId: 'R-2', clientId: 'C-1' },
  { id: 'GR-broken', rentalId: 'R-missing', clientId: 'C-1' },
];

test('rental navigation resolver keeps canonical rental id', () => {
  assert.equal(resolveRentalNavigationId({ id: 'R-3' }, rentals, ganttRentals), 'R-3');
});

test('rental navigation resolver uses rentalId from a gantt-shaped row', () => {
  assert.equal(resolveRentalNavigationId({ id: 'GR-1', rentalId: 'R-1' }, rentals, ganttRentals), 'R-1');
});

test('rental navigation resolver resolves GR id through gantt rental link', () => {
  assert.equal(resolveRentalNavigationId({ id: 'GR-2' }, rentals, ganttRentals), 'R-2');
});

test('rental navigation resolver resolves explicit ganttRentalId through gantt rental link', () => {
  assert.equal(resolveRentalNavigationId({ ganttRentalId: 'GR-1' }, rentals, ganttRentals), 'R-1');
});

test('rental navigation resolver returns null for broken rental link', () => {
  assert.equal(resolveRentalNavigationId({ id: 'GR-broken' }, rentals, ganttRentals), null);
  assert.equal(resolveRentalNavigationId({ id: 'GR-missing' }, rentals, ganttRentals), null);
});
