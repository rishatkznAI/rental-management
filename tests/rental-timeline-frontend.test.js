import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRentalDayTiles,
  classifyRentalPaymentTone,
} from '../src/app/lib/rentalTimeline.js';

const baseRental = {
  id: 'GR-1',
  client: 'ООО Тест',
  equipmentInv: 'INV-1',
  startDate: '2026-05-10',
  endDate: '2026-05-10',
  amount: 100000,
  paymentStatus: 'unpaid',
  status: 'active',
};

test('buildRentalDayTiles renders one tile for one rental day', () => {
  const tiles = buildRentalDayTiles(baseRental, '2026-05-01', 31);

  assert.equal(tiles.length, 1);
  assert.deepEqual(tiles[0], { date: '2026-05-10', index: 9 });
});

test('buildRentalDayTiles renders one tile per occupied calendar day', () => {
  const tiles = buildRentalDayTiles(
    { ...baseRental, startDate: '2026-05-10', endDate: '2026-05-14' },
    '2026-05-01',
    31,
  );

  assert.equal(tiles.length, 5);
  assert.deepEqual(tiles.map(tile => tile.date), [
    '2026-05-10',
    '2026-05-11',
    '2026-05-12',
    '2026-05-13',
    '2026-05-14',
  ]);
});

test('classifyRentalPaymentTone detects paid rentals from debt facts', () => {
  assert.equal(
    classifyRentalPaymentTone(
      { ...baseRental, paymentStatus: 'paid' },
      { rentalId: 'GR-1', amount: 100000, paidAmount: 100000, outstanding: 0, paymentStatus: 'paid', endDate: '2026-05-10' },
      '2026-05-11',
    ),
    'paid',
  );
});

test('classifyRentalPaymentTone detects unpaid rentals before due date', () => {
  assert.equal(
    classifyRentalPaymentTone(
      { ...baseRental, expectedPaymentDate: '2026-05-20' },
      { rentalId: 'GR-1', amount: 100000, paidAmount: 0, outstanding: 100000, paymentStatus: 'unpaid', expectedPaymentDate: '2026-05-20', endDate: '2026-05-10' },
      '2026-05-11',
    ),
    'unpaid',
  );
});

test('classifyRentalPaymentTone detects partial rentals', () => {
  assert.equal(
    classifyRentalPaymentTone(
      { ...baseRental, paymentStatus: 'partial' },
      { rentalId: 'GR-1', amount: 100000, paidAmount: 40000, outstanding: 60000, paymentStatus: 'partial', expectedPaymentDate: '2026-05-20', endDate: '2026-05-10' },
      '2026-05-11',
    ),
    'partial',
  );
});

test('classifyRentalPaymentTone detects overdue payment debt', () => {
  assert.equal(
    classifyRentalPaymentTone(
      { ...baseRental, expectedPaymentDate: '2026-05-05' },
      { rentalId: 'GR-1', amount: 100000, paidAmount: 0, outstanding: 100000, paymentStatus: 'unpaid', expectedPaymentDate: '2026-05-05', endDate: '2026-05-10' },
      '2026-05-11',
    ),
    'overdue',
  );
});

test('classifyRentalPaymentTone falls back to unknown when payment data cannot be determined', () => {
  assert.equal(
    classifyRentalPaymentTone(
      { ...baseRental, amount: 0, paymentStatus: undefined },
      undefined,
      '2026-05-11',
    ),
    'unknown',
  );
});
