import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRentalPaymentBar,
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

test('buildRentalPaymentBar renders a single continuous bar segment for one rental day', () => {
  const bar = buildRentalPaymentBar(baseRental, undefined, '2026-05-01');

  assert.equal(bar.segments.length, 1);
  assert.equal(bar.segments[0].startDate, '2026-05-10');
  assert.equal(bar.segments[0].endDate, '2026-05-10');
});

test('buildRentalPaymentBar does not split a five day rental into daily tiles', () => {
  const bar = buildRentalPaymentBar(
    { ...baseRental, startDate: '2026-05-10', endDate: '2026-05-14' },
    { rentalId: 'GR-1', amount: 100000, paidAmount: 0, outstanding: 100000, paymentStatus: 'unpaid', expectedPaymentDate: '2026-05-20' },
    '2026-05-11',
  );

  assert.equal(bar.segments.length, 1);
  assert.equal(bar.segments[0].tone, 'unpaid');
  assert.equal(bar.segments[0].startDate, '2026-05-10');
  assert.equal(bar.segments[0].endDate, '2026-05-14');
});

test('buildRentalPaymentBar marks fully paid rentals through end date', () => {
  const bar = buildRentalPaymentBar(
    { ...baseRental, startDate: '2026-05-10', endDate: '2026-05-14', paymentStatus: 'paid' },
    { rentalId: 'GR-1', amount: 100000, paidAmount: 100000, outstanding: 0, paymentStatus: 'paid' },
    '2026-05-11',
  );

  assert.equal(bar.paidThroughDate, '2026-05-14');
  assert.equal(bar.overdueSince, null);
  assert.deepEqual(bar.segments.map(segment => segment.tone), ['paid']);
});

test('buildRentalPaymentBar derives paid-through date for partial payments', () => {
  const bar = buildRentalPaymentBar(
    { ...baseRental, startDate: '2026-05-10', endDate: '2026-05-14', amount: 100000, paymentStatus: 'partial' },
    { rentalId: 'GR-1', amount: 100000, paidAmount: 40000, outstanding: 60000, paymentStatus: 'partial', expectedPaymentDate: '2026-05-20' },
    '2026-05-11',
  );

  assert.equal(bar.paidThroughDate, '2026-05-11');
  assert.equal(bar.overdueSince, null);
  assert.deepEqual(bar.segments.map(segment => segment.tone), ['paid', 'unpaid']);
});

test('buildRentalPaymentBar marks overdue since the day after due date', () => {
  const bar = buildRentalPaymentBar(
    { ...baseRental, startDate: '2026-05-10', endDate: '2026-05-14', amount: 100000, paymentStatus: 'unpaid', expectedPaymentDate: '2026-05-11' },
    { rentalId: 'GR-1', amount: 100000, paidAmount: 0, outstanding: 100000, paymentStatus: 'unpaid', expectedPaymentDate: '2026-05-11' },
    '2026-05-13',
  );

  assert.equal(bar.paidThroughDate, null);
  assert.equal(bar.overdueSince, '2026-05-12');
  assert.deepEqual(bar.segments.map(segment => segment.tone), ['unpaid', 'overdue']);
});

test('buildRentalPaymentBar does not mark future unpaid due date as overdue', () => {
  const bar = buildRentalPaymentBar(
    { ...baseRental, startDate: '2026-05-10', endDate: '2026-05-14', amount: 100000, paymentStatus: 'unpaid', expectedPaymentDate: '2026-05-20' },
    { rentalId: 'GR-1', amount: 100000, paidAmount: 0, outstanding: 100000, paymentStatus: 'unpaid', expectedPaymentDate: '2026-05-20' },
    '2026-05-13',
  );

  assert.equal(bar.paidThroughDate, null);
  assert.equal(bar.overdueSince, null);
  assert.deepEqual(bar.segments.map(segment => segment.tone), ['unpaid']);
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
