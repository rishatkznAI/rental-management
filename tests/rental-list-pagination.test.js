import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RENTAL_LIST_PAGE_SIZE,
  RENTAL_LIST_PAGE_SIZE_OPTIONS,
  getRentalListPageState,
  normalizeRentalListPageSize,
} from '../src/app/lib/rentalListPagination.js';

function buildRentals(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `R-${index + 1}` }));
}

test('rental list pagination limits first page to 25 and reports the full total', () => {
  const state = getRentalListPageState(buildRentals(143), 1);

  assert.equal(DEFAULT_RENTAL_LIST_PAGE_SIZE, 25);
  assert.deepEqual(RENTAL_LIST_PAGE_SIZE_OPTIONS, [25, 50, 100]);
  assert.equal(state.pageItems.length, 25);
  assert.equal(state.total, 143);
  assert.equal(state.rangeLabel, 'Показано 1–25 из 143');
  assert.equal(state.hasPreviousPage, false);
  assert.equal(state.hasNextPage, true);
});

test('rental list pagination moves forward and backward by page', () => {
  const rows = buildRentals(30);
  const secondPage = getRentalListPageState(rows, 2, 25);
  const firstPage = getRentalListPageState(rows, secondPage.currentPage - 1, 25);

  assert.equal(secondPage.rangeLabel, 'Показано 26–30 из 30');
  assert.deepEqual(secondPage.pageItems.map(item => item.id), ['R-26', 'R-27', 'R-28', 'R-29', 'R-30']);
  assert.equal(secondPage.hasNextPage, false);
  assert.equal(firstPage.rangeLabel, 'Показано 1–25 из 30');
  assert.equal(firstPage.pageItems[0].id, 'R-1');
});

test('rental list pagination resets and clamps page boundaries safely', () => {
  const rows = buildRentals(51);
  const clamped = getRentalListPageState(rows, 99, 25);
  const resetAfterFilter = getRentalListPageState(rows.slice(0, 12), 1, 25);

  assert.equal(clamped.currentPage, 3);
  assert.equal(clamped.rangeLabel, 'Показано 51–51 из 51');
  assert.equal(resetAfterFilter.currentPage, 1);
  assert.equal(resetAfterFilter.rangeLabel, 'Показано 1–12 из 12');
});

test('rental list pagination supports 50 and 100 rows per page', () => {
  assert.equal(normalizeRentalListPageSize(50), 50);
  assert.equal(normalizeRentalListPageSize('100'), 100);
  assert.equal(normalizeRentalListPageSize(10), 25);

  const fifty = getRentalListPageState(buildRentals(70), 1, 50);
  const hundred = getRentalListPageState(buildRentals(120), 1, 100);

  assert.equal(fifty.pageItems.length, 50);
  assert.equal(fifty.rangeLabel, 'Показано 1–50 из 70');
  assert.equal(hundred.pageItems.length, 100);
  assert.equal(hundred.rangeLabel, 'Показано 1–100 из 120');
});

test('rental list pagination exposes a clean empty state', () => {
  const state = getRentalListPageState([], 4, 25);

  assert.equal(state.currentPage, 1);
  assert.equal(state.pageItems.length, 0);
  assert.equal(state.total, 0);
  assert.equal(state.rangeLabel, 'Ничего не найдено');
  assert.equal(state.hasPreviousPage, false);
  assert.equal(state.hasNextPage, false);
});
