import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyRentalFieldChange,
  splitRentalPatch,
} = require('../server/lib/rental-change-requests.js');

const rental = {
  id: 'R-1',
  client: 'ЭМ-СТРОЙ',
  contact: 'Иван',
  startDate: '2026-04-10',
  plannedReturnDate: '2026-04-20',
  equipment: ['083'],
  rate: '5000 ₽/день',
  price: 100000,
  discount: 0,
  deliveryAddress: 'Казань',
  manager: 'Руслан',
  status: 'active',
  comments: '',
};

test('classifyRentalFieldChange applies conflict-free extension immediately', () => {
  const result = classifyRentalFieldChange({
    previousRental: rental,
    field: 'plannedReturnDate',
    newValue: '2026-04-25',
    today: '2026-04-12',
  });

  assert.equal(result.mode, 'immediate');
  assert.equal(result.type, 'Продление аренды');
});

test('classifyRentalFieldChange sends shortening to approval', () => {
  const result = classifyRentalFieldChange({
    previousRental: rental,
    field: 'plannedReturnDate',
    newValue: '2026-04-18',
    today: '2026-04-12',
  });

  assert.equal(result.mode, 'approval');
  assert.equal(result.type, 'Сокращение аренды');
});

test('splitRentalPatch separates immediate comments from protected price change', () => {
  const result = splitRentalPatch({
    previousRental: rental,
    patch: {
      comments: 'Клиент просит продлить',
      price: 120000,
    },
    payments: [],
    today: '2026-04-12',
  });

  assert.deepEqual(result.immediatePatch, { comments: 'Клиент просит продлить' });
  assert.equal(result.approvalChanges.length, 1);
  assert.equal(result.approvalChanges[0].field, 'price');
});

test('splitRentalPatch sends closing with debt to approval', () => {
  const result = splitRentalPatch({
    previousRental: rental,
    patch: { status: 'closed' },
    payments: [{ id: 'P-1', rentalId: 'R-1', amount: 100000, paidAmount: 20000, status: 'partial' }],
    today: '2026-04-12',
  });

  assert.deepEqual(result.immediatePatch, {});
  assert.equal(result.approvalChanges.length, 1);
  assert.equal(result.approvalChanges[0].type, 'Закрытие аренды с долгом');
});
