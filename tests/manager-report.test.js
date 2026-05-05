import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManagerReportRows,
  buildManagerReportSummary,
  buildManagerReportXLS,
  filterManagerReportRows,
} from '../src/app/lib/managerReport.js';

const equipment = [
  {
    id: 'EQ-1',
    inventoryNumber: 'INV-1',
    type: 'scissor',
    manufacturer: 'Skyjack',
    model: 'SJ3219',
  },
];

function rental(overrides = {}) {
  return {
    id: 'R-1',
    client: 'ООО Клиент',
    equipmentId: 'EQ-1',
    equipmentInv: 'INV-1',
    startDate: '2026-04-01',
    endDate: '2026-04-10',
    manager: 'Руслан',
    status: 'active',
    paymentStatus: 'unpaid',
    updSigned: false,
    amount: 100000,
    ...overrides,
  };
}

function payment(overrides = {}) {
  return {
    id: 'P-1',
    rentalId: 'R-1',
    client: 'ООО Клиент',
    amount: 100000,
    paidAmount: 0,
    dueDate: '2026-04-10',
    status: 'partial',
    ...overrides,
  };
}

function byMonth(rows) {
  return Object.fromEntries(rows.map(row => [row.monthKey, row]));
}

test('manager report keeps one-month rental in one month', () => {
  const rows = buildManagerReportRows([rental()], equipment, []);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].monthKey, '2026-04');
  assert.equal(rows[0].amount, 100000);
  assert.equal(rows[0].paidAmount, 0);
  assert.equal(rows[0].debt, 100000);
});

test('manager report splits rental crossing two months by inclusive rental days', () => {
  const rows = buildManagerReportRows([
    rental({ startDate: '2026-04-25', endDate: '2026-05-08', amount: 32200 }),
  ], equipment, []);
  const months = byMonth(rows);

  assert.equal(rows.length, 2);
  assert.equal(months['2026-04'].allocationDays, 6);
  assert.equal(months['2026-05'].allocationDays, 8);
  assert.equal(months['2026-04'].amount, 13800);
  assert.equal(months['2026-05'].amount, 18400);
  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 32200);
});

test('manager report splits rental crossing three months with paid and debt parts', () => {
  const rows = buildManagerReportRows([
    rental({ startDate: '2026-04-30', endDate: '2026-06-02', amount: 34000 }),
  ], equipment, [payment({ amount: 34000, paidAmount: 17000 })]);
  const months = byMonth(rows);

  assert.equal(rows.length, 3);
  assert.equal(months['2026-04'].amount, 1000);
  assert.equal(months['2026-05'].amount, 31000);
  assert.equal(months['2026-06'].amount, 2000);
  assert.equal(months['2026-04'].paidAmount, 500);
  assert.equal(months['2026-05'].paidAmount, 15500);
  assert.equal(months['2026-06'].paidAmount, 1000);
  assert.equal(months['2026-04'].debt, 500);
  assert.equal(months['2026-05'].debt, 15500);
  assert.equal(months['2026-06'].debt, 1000);
  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 34000);
});

test('manager report marks unpaid, partial and paid monthly rows correctly', () => {
  const unpaidRows = buildManagerReportRows([rental({ amount: 10000 })], equipment, []);
  const partialRows = buildManagerReportRows([rental({ amount: 10000 })], equipment, [
    payment({ amount: 10000, paidAmount: 4000 }),
  ]);
  const paidRows = buildManagerReportRows([rental({ amount: 10000 })], equipment, [
    payment({ amount: 10000, paidAmount: 10000, status: 'paid' }),
  ]);

  assert.equal(unpaidRows[0].paymentStatus, 'unpaid');
  assert.equal(partialRows[0].paymentStatus, 'partial');
  assert.equal(paidRows[0].paymentStatus, 'paid');
  assert.equal(unpaidRows[0].debt, 10000);
  assert.equal(partialRows[0].debt, 6000);
  assert.equal(paidRows[0].debt, 0);
});

test('manager report period filter takes only the selected month share', () => {
  const rows = buildManagerReportRows([
    rental({ startDate: '2026-04-25', endDate: '2026-05-08', amount: 32200 }),
  ], equipment, [], { dateFrom: '2026-05-01', dateTo: '2026-05-31' });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].monthKey, '2026-05');
  assert.equal(rows[0].allocationDays, 8);
  assert.equal(rows[0].amount, 18400);
  assert.equal(rows[0].debt, 18400);
});

test('manager report filters by manager client payment UPD status type and inventory', () => {
  const rows = buildManagerReportRows([
    rental({ id: 'R-1', client: 'ООО Альфа', manager: 'Руслан', updSigned: true, amount: 10000 }),
    rental({ id: 'R-2', client: 'ООО Бета', manager: 'Анна', equipmentInv: 'INV-X', amount: 20000 }),
  ], equipment, [
    payment({ id: 'P-1', rentalId: 'R-1', amount: 10000, paidAmount: 10000, status: 'paid' }),
  ]);

  const filtered = filterManagerReportRows(rows, {
    manager: 'Руслан',
    client: 'ООО Альфа',
    paymentStatus: 'paid',
    updStatus: 'signed',
    rentalStatus: 'active',
    equipmentType: 'scissor',
    equipmentInv: 'EQ-1',
  });

  assert.deepEqual(filtered.map(row => row.rentalId), ['R-1']);
});

test('manager report summary and Excel export use the same monthly rows', () => {
  const rows = buildManagerReportRows([
    rental({ startDate: '2026-04-25', endDate: '2026-05-08', amount: 32200 }),
  ], equipment, [payment({ amount: 32200, paidAmount: 14000 })]);
  const summary = buildManagerReportSummary(rows);
  const xls = buildManagerReportXLS(summary, rows, '25.04.2026 — 08.05.2026');

  assert.equal(summary[0].totalAmount, 32200);
  assert.equal(summary[0].paidAmount, 14000);
  assert.equal(summary[0].debt, 18200);
  assert.match(xls, /Апрель 2026/);
  assert.match(xls, /Май 2026/);
  assert.match(xls, />13800</);
  assert.match(xls, />18400</);
  assert.match(xls, />6000</);
  assert.match(xls, />8000</);
  assert.match(xls, />18200</);
});

test('manager report ignores invalid totals and dates without NaN or Infinity rows', () => {
  const rows = buildManagerReportRows([
    rental({ id: 'R-invalid-date', startDate: '', endDate: '', amount: 1000 }),
    rental({ id: 'R-invalid-money', amount: Number.NaN }),
  ], equipment, [payment({ amount: Number.POSITIVE_INFINITY, paidAmount: Number.NaN })]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 0);
  assert.equal(rows[0].paidAmount, 0);
  assert.equal(rows[0].debt, 0);
  assert.equal(Number.isFinite(rows[0].amount), true);
  assert.equal(Number.isFinite(rows[0].paidAmount), true);
  assert.equal(Number.isFinite(rows[0].debt), true);
});
