import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRentalByAnyId, resolveRentalNavigationId } from '../src/app/lib/rentalNavigation.js';

const rentals = [
  { id: 'R-1', rentalId: 'LEGACY-R-1', contractNumber: 'DOG-1', number: '1', clientId: 'C-1' },
  { id: 'R-2', clientId: 'C-1' },
  { id: 'R-3', clientId: 'C-2' },
  { id: 'R-4', externalId: 'EXT-4', clientId: 'C-3' },
];

const ganttRentals = [
  { id: 'GR-1', rentalId: 'R-1', clientId: 'C-1' },
  { id: 'GR-2', sourceRentalId: 'R-2', clientId: 'C-1' },
  { id: 'GR-broken', rentalId: 'R-missing', clientId: 'C-1' },
];

test('rental navigation resolver keeps canonical rental id', () => {
  assert.equal(resolveRentalNavigationId({ id: 'R-3' }, rentals, ganttRentals), 'R-3');
});

test('rental detail resolver opens by rental.id', () => {
  const result = resolveRentalByAnyId('R-1', rentals, ganttRentals);
  assert.equal(result.status, 'found');
  assert.equal(result.canonicalId, 'R-1');
  assert.equal(result.rental.id, 'R-1');
});

test('rental detail resolver opens by legacy rentalId', () => {
  const result = resolveRentalByAnyId('LEGACY-R-1', rentals, ganttRentals);
  assert.equal(result.status, 'found');
  assert.equal(result.canonicalId, 'R-1');
});

test('rental detail resolver opens by legacy contractNumber', () => {
  const result = resolveRentalByAnyId('DOG-1', rentals, ganttRentals);
  assert.equal(result.status, 'found');
  assert.equal(result.canonicalId, 'R-1');
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

test('rental detail resolver resolves GR id through linked gantt rental', () => {
  const result = resolveRentalByAnyId('GR-1', rentals, ganttRentals);
  assert.equal(result.status, 'found');
  assert.equal(result.canonicalId, 'R-1');
  assert.equal(result.diagnostics.foundGanttRecord.id, 'GR-1');
});

test('rental navigation resolver returns null for broken rental link', () => {
  assert.equal(resolveRentalNavigationId({ id: 'GR-broken' }, rentals, ganttRentals), null);
  assert.equal(resolveRentalNavigationId({ id: 'GR-missing' }, rentals, ganttRentals), null);
});

test('rental detail resolver reports found gantt without linked rentals row', () => {
  const result = resolveRentalByAnyId('GR-broken', rentals, ganttRentals);
  assert.equal(result.status, 'not_found');
  assert.equal(result.canonicalId, '');
  assert.equal(result.diagnostics.foundGanttRecord.id, 'GR-broken');
  assert.deepEqual(result.diagnostics.linkedRentalIds, ['R-missing']);
});

test('rental detail resolver refuses ambiguous linked records', () => {
  const result = resolveRentalByAnyId('DUP-1', [
    { id: 'R-A', contractNumber: 'DUP-1' },
    { id: 'R-B', number: 'DUP-1' },
  ], []);
  assert.equal(result.status, 'conflict');
  assert.equal(result.message, 'Найдено несколько связанных записей аренды. Нужна проверка связей.');
  assert.deepEqual(result.diagnostics.candidateIds.sort(), ['R-A', 'R-B']);
});
