import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  deriveRentalPaymentStatus,
  syncGanttRentalPaymentStatuses,
} = require('../server/lib/payment-status-sync.js');

test('deriveRentalPaymentStatus returns paid when payments cover rental amount', () => {
  const status = deriveRentalPaymentStatus(
    { id: 'gr-1', amount: 28800, paymentStatus: 'unpaid' },
    [
      { id: 'p-1', rentalId: 'gr-1', amount: 28800, paidAmount: 34800, status: 'paid' },
    ],
  );

  assert.equal(status, 'paid');
});

test('deriveRentalPaymentStatus returns partial for partial payment', () => {
  const status = deriveRentalPaymentStatus(
    { id: 'gr-1', amount: 50000, paymentStatus: 'unpaid' },
    [
      { id: 'p-1', rentalId: 'gr-1', amount: 50000, paidAmount: 12000, status: 'partial' },
    ],
  );

  assert.equal(status, 'partial');
});

test('deriveRentalPaymentStatus keeps zero paid amount unpaid', () => {
  const status = deriveRentalPaymentStatus(
    { id: 'gr-1', amount: 50000, paymentStatus: 'unpaid' },
    [
      { id: 'p-1', rentalId: 'gr-1', amount: 50000, paidAmount: 0, status: 'partial' },
    ],
  );

  assert.equal(status, 'unpaid');
});

test('deriveRentalPaymentStatus ignores negative legacy paid amounts defensively', () => {
  const status = deriveRentalPaymentStatus(
    { id: 'gr-1', amount: 50000, paymentStatus: 'unpaid' },
    [
      { id: 'p-1', rentalId: 'gr-1', amount: 50000, paidAmount: -10000, status: 'partial' },
    ],
  );

  assert.equal(status, 'unpaid');
});

test('deriveRentalPaymentStatus ignores cancelled error and reversed payments', () => {
  const status = deriveRentalPaymentStatus(
    { id: 'gr-1', amount: 50000, paymentStatus: 'unpaid' },
    [
      { id: 'p-cancelled', rentalId: 'gr-1', amount: 50000, paidAmount: 50000, status: 'cancelled' },
      { id: 'p-error', rentalId: 'gr-1', amount: 50000, paidAmount: 50000, status: 'error' },
      { id: 'p-reversed', rentalId: 'gr-1', amount: 50000, paidAmount: 50000, status: 'reversed' },
    ],
  );

  assert.equal(status, 'unpaid');
});

test('deriveRentalPaymentStatus treats overpayment as paid', () => {
  const status = deriveRentalPaymentStatus(
    { id: 'gr-1', amount: 50000, paymentStatus: 'unpaid' },
    [
      { id: 'p-1', rentalId: 'gr-1', amount: 50000, paidAmount: 60000, status: 'paid' },
    ],
  );

  assert.equal(status, 'paid');
});

test('syncGanttRentalPaymentStatuses updates only linked rentals', () => {
  const updated = syncGanttRentalPaymentStatuses(
    [
      { id: 'gr-1', amount: 50000, paymentStatus: 'unpaid' },
      { id: 'gr-2', amount: 70000, paymentStatus: 'unpaid' },
    ],
    [
      { id: 'p-1', rentalId: 'gr-1', amount: 50000, paidAmount: 50000, status: 'paid' },
    ],
  );

  assert.equal(updated[0].paymentStatus, 'paid');
  assert.equal(updated[1].paymentStatus, 'unpaid');
});
