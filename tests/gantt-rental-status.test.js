import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeGanttRentalList,
  normalizeGanttRentalStatus,
} = require('../server/lib/gantt-rental-status.js');

test('normalizeGanttRentalStatus promotes started created rentals to active', () => {
  const rental = normalizeGanttRentalStatus(
    {
      id: 'GR-1',
      startDate: '2026-04-18',
      endDate: '2026-04-20',
      status: 'created',
    },
    '2026-04-21',
  );

  assert.equal(rental.status, 'active');
});

test('normalizeGanttRentalStatus keeps future created rentals reserved', () => {
  const rental = normalizeGanttRentalStatus(
    {
      id: 'GR-2',
      startDate: '2026-04-25',
      endDate: '2026-04-30',
      status: 'created',
    },
    '2026-04-21',
  );

  assert.equal(rental.status, 'created');
});

test('normalizeGanttRentalList keeps final statuses unchanged', () => {
  const rentals = normalizeGanttRentalList(
    [
      { id: 'GR-3', startDate: '2026-04-18', endDate: '2026-04-20', status: 'returned' },
      { id: 'GR-4', startDate: '2026-04-18', endDate: '2026-04-20', status: 'closed' },
    ],
    '2026-04-21',
  );

  assert.deepEqual(
    rentals.map((item) => item.status),
    ['returned', 'closed'],
  );
});
