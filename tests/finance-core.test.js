import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  getRentalDebtOverdueDays,
  buildRentalDebtRows,
  buildClientReceivables,
  buildManagerReceivables,
  buildOverdueBuckets,
  buildFinanceReport,
} = require('../server/lib/finance-core.js');

test('buildRentalDebtRows calculates outstanding from related payments', () => {
  const rows = buildRentalDebtRows(
    [
      {
        id: 'gr-1',
        client: 'ЭМ-СТРОЙ',
        equipmentId: 'eq-1',
        equipmentInv: '083',
        manager: 'Руслан',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        expectedPaymentDate: '2026-04-05',
        amount: 100000,
        paymentStatus: 'partial',
        status: 'active',
      },
    ],
    [
      { id: 'p-1', rentalId: 'gr-1', amount: 100000, paidAmount: 40000, status: 'partial' },
    ],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].paidAmount, 40000);
  assert.equal(rows[0].outstanding, 60000);
});

test('getRentalDebtOverdueDays returns zero for fully paid rentals', () => {
  assert.equal(
    getRentalDebtOverdueDays(
      { expectedPaymentDate: '2026-04-05', endDate: '2026-04-10', outstanding: 0 },
      '2026-04-18',
    ),
    0,
  );
});

test('buildClientReceivables groups debt and overdue rentals by client', () => {
  const rows = buildClientReceivables(
    [{ id: 'c-1', company: 'ЭМ-СТРОЙ', creditLimit: 50000 }],
    [
      {
        rentalId: 'gr-1',
        client: 'ЭМ-СТРОЙ',
        equipmentInv: '083',
        manager: 'Руслан',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        expectedPaymentDate: '2026-04-05',
        amount: 100000,
        paidAmount: 40000,
        outstanding: 60000,
        paymentStatus: 'partial',
        rentalStatus: 'active',
      },
    ],
    '2026-04-18',
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].currentDebt, 60000);
  assert.equal(rows[0].overdueRentals, 1);
  assert.equal(rows[0].exceededLimit, true);
});

test('buildManagerReceivables accumulates overdue debt by manager', () => {
  const rows = buildManagerReceivables(
    [
      {
        rentalId: 'gr-1',
        client: 'ЭМ-СТРОЙ',
        equipmentInv: '083',
        manager: 'Руслан',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        expectedPaymentDate: '2026-04-05',
        amount: 100000,
        paidAmount: 40000,
        outstanding: 60000,
        paymentStatus: 'partial',
        rentalStatus: 'active',
      },
    ],
    '2026-04-18',
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].manager, 'Руслан');
  assert.equal(rows[0].currentDebt, 60000);
  assert.equal(rows[0].overdueDebt, 60000);
});

test('buildOverdueBuckets places debt into the correct aging bucket', () => {
  const buckets = buildOverdueBuckets(
    [
      {
        rentalId: 'gr-1',
        client: 'ЭМ-СТРОЙ',
        equipmentInv: '083',
        manager: 'Руслан',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        expectedPaymentDate: '2026-04-05',
        amount: 100000,
        paidAmount: 40000,
        outstanding: 60000,
        paymentStatus: 'partial',
        rentalStatus: 'active',
      },
    ],
    '2026-04-18',
  );

  const oneToThirty = buckets.find(item => item.key === '8_14');
  assert.equal(oneToThirty?.rentals, 1);
  assert.equal(oneToThirty?.debt, 60000);
});

test('buildFinanceReport returns aggregated totals and slices', () => {
  const report = buildFinanceReport(
    {
      clients: [{ id: 'c-1', company: 'ЭМ-СТРОЙ', creditLimit: 50000 }],
      rentals: [
        {
          id: 'gr-1',
          client: 'ЭМ-СТРОЙ',
          equipmentId: 'eq-1',
          equipmentInv: '083',
          manager: 'Руслан',
          startDate: '2026-04-01',
          endDate: '2026-04-10',
          expectedPaymentDate: '2026-04-05',
          amount: 100000,
          paymentStatus: 'partial',
          status: 'active',
        },
      ],
      payments: [
        { id: 'p-1', rentalId: 'gr-1', amount: 100000, paidAmount: 40000, status: 'partial' },
      ],
    },
    '2026-04-18',
  );

  assert.equal(report.debtRows.length, 1);
  assert.equal(report.clientReceivables.length, 1);
  assert.equal(report.managerReceivables.length, 1);
  assert.equal(report.totals.debt, 60000);
  assert.equal(report.totals.overdueDebt, 60000);
});
