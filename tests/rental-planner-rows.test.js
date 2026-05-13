import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRentalPlannerRows,
  chooseBestGanttRentalEntry,
  getGanttRentalCanonicalId,
  getGanttRentalSourceId,
} from '../src/app/lib/rentalPlannerRows.js';

const rentals = [
  { id: 'R-1', clientId: 'C-1', status: 'active' },
  { id: 'R-2', clientId: 'C-2', status: 'active' },
];

test('canonical rental id prefers rentalId, sourceRentalId, originalRentalId', () => {
  assert.equal(getGanttRentalSourceId({ rentalId: 'R-rental', sourceRentalId: 'R-source', originalRentalId: 'R-original' }), 'R-rental');
  assert.equal(getGanttRentalSourceId({ sourceRentalId: 'R-source', originalRentalId: 'R-original' }), 'R-source');
  assert.equal(getGanttRentalSourceId({ originalRentalId: 'R-original' }), 'R-original');
});

test('canonical fallback id is used only for standalone legacy rentals that exist', () => {
  const rentalsById = new Map(rentals.map(item => [item.id, item]));

  assert.equal(getGanttRentalCanonicalId({ id: 'R-1' }, rentalsById), 'R-1');
  assert.equal(getGanttRentalCanonicalId({ id: 'GR-orphan' }, rentalsById), '');
});

test('deduplicates gantt_rentals by canonical rental id', () => {
  const result = buildRentalPlannerRows({
    rentals,
    todayKey: '2026-05-13',
    ganttRentals: [
      { id: 'GR-1', rentalId: 'R-1', status: 'created', startDate: '2026-05-10', endDate: '2026-05-20' },
      { id: 'GR-2', sourceRentalId: 'R-1', status: 'active', startDate: '2026-05-10', endDate: '2026-05-20' },
      { id: 'GR-3', rentalId: 'R-2', status: 'active', startDate: '2026-05-12', endDate: '2026-05-14' },
    ],
  });

  assert.equal(result.rentalRows.length, 2);
  assert.equal(result.rentalRows.find(item => item.__canonicalRentalId === 'R-1').id, 'GR-2');
  assert.deepEqual(result.duplicateGroups, [{ rentalId: 'R-1', count: 2, ids: ['GR-1', 'GR-2'] }]);
  assert.equal(result.duplicateCountByRentalId.get('R-1'), 2);
});

test('best gantt entry uses status priority before recency', () => {
  const best = chooseBestGanttRentalEntry([
    { id: 'GR-closed', status: 'closed', startDate: '2026-06-01', endDate: '2026-06-30' },
    { id: 'GR-created', status: 'created', startDate: '2026-05-10', endDate: '2026-05-20' },
    { id: 'GR-active', status: 'active', startDate: '2026-04-01', endDate: '2026-04-10' },
  ], { todayKey: '2026-05-13' });

  assert.equal(best.id, 'GR-active');
});

test('orphan gantt_rental stays out of working rental rows', () => {
  const result = buildRentalPlannerRows({
    rentals,
    ganttRentals: [
      { id: 'GR-valid', rentalId: 'R-1', status: 'active' },
      { id: 'GR-broken', rentalId: 'R-missing', status: 'active' },
      { id: 'GR-orphan', status: 'active' },
    ],
  });

  assert.deepEqual(result.rentalRows.map(item => item.id), ['GR-valid']);
  assert.deepEqual(result.orphanPlannerRows.map(item => item.id), ['GR-broken', 'GR-orphan']);
  assert.equal(result.rentalRows.some(item => !item.__canonicalRentalId), false);
});

test('same canonical helper output can feed list returns planner and debt views', () => {
  const result = buildRentalPlannerRows({
    rentals,
    ganttRentals: [
      { id: 'GR-a', rentalId: 'R-1', status: 'active', paymentStatus: 'unpaid', endDate: '2026-05-10' },
      { id: 'GR-b', rentalId: 'R-1', status: 'created', paymentStatus: 'paid', endDate: '2026-05-11' },
    ],
  });

  const listRows = result.rentalRows;
  const returnsRows = result.rentalRows.filter(item => item.endDate < '2026-05-13');
  const plannerRows = result.rentalRows.filter(item => item.status !== 'closed');
  const debtRows = result.rentalRows.filter(item => item.paymentStatus !== 'paid');

  assert.equal(listRows.length, 1);
  assert.equal(returnsRows.length, 1);
  assert.equal(plannerRows.length, 1);
  assert.equal(debtRows.length, 1);
});
