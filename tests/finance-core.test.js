import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  getRentalDebtOverdueDays,
  buildRentalDebtRows,
  buildClientReceivables,
  buildClientFinancialSnapshots,
  buildManagerReceivables,
  buildOverdueBuckets,
  buildClientDebtAgingRows,
  buildFinanceReport,
  buildAllocationPreview,
  backfillPaymentAllocations,
  calculateRentalBilling,
} = require('../server/lib/finance-core.js');

test('calculateRentalBilling keeps rentals without downtimes unchanged', () => {
  const billing = calculateRentalBilling({
    id: 'gr-no-downtime',
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    amount: 310000,
  });

  assert.equal(billing.totalCalendarDays, 31);
  assert.equal(billing.downtimeDays, 0);
  assert.equal(billing.billableDays, 31);
  assert.equal(billing.finalRentalAmount, 310000);
});

test('calculateRentalBilling subtracts only billing downtime periods', () => {
  const billing = calculateRentalBilling({
    id: 'gr-metal',
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    amount: 310000,
    downtimePeriods: [
      {
        id: 'dt-1',
        rentalId: 'gr-metal',
        startDate: '2026-05-01',
        endDate: '2026-05-07',
        reason: 'ожидание клиента',
        affectsBilling: true,
        status: 'active',
      },
      {
        id: 'dt-2',
        rentalId: 'gr-metal',
        startDate: '2026-05-13',
        endDate: '2026-05-17',
        reason: 'эвакуатор не мог забрать технику',
        affectsBilling: false,
        status: 'active',
      },
    ],
  });

  assert.equal(billing.downtimeDays, 12);
  assert.equal(billing.billingDowntimeDays, 7);
  assert.equal(billing.nonBillingDowntimeDays, 5);
  assert.equal(billing.billableDays, 24);
  assert.equal(billing.activeRentalDays, 19);
  assert.equal(billing.grossRentalAmount, 310000);
  assert.equal(billing.downtimeAdjustmentAmount, 70000);
  assert.equal(billing.finalRentalAmount, 240000);
});

test('calculateRentalBilling distributes downtime across month boundary', () => {
  const rental = {
    id: 'gr-cross-month',
    startDate: '2026-05-25',
    endDate: '2026-06-10',
    amount: 170000,
    downtimePeriods: [
      {
        id: 'dt-cross',
        rentalId: 'gr-cross-month',
        startDate: '2026-05-30',
        endDate: '2026-06-03',
        reason: 'ожидание возврата',
        affectsBilling: true,
        status: 'active',
      },
    ],
  };

  const may = calculateRentalBilling(rental, { periodStart: '2026-05-01', periodEnd: '2026-05-31' });
  const june = calculateRentalBilling(rental, { periodStart: '2026-06-01', periodEnd: '2026-06-30' });

  assert.equal(may.totalCalendarDays, 7);
  assert.equal(may.billingDowntimeDays, 2);
  assert.equal(may.finalRentalAmount, 50000);
  assert.equal(june.totalCalendarDays, 10);
  assert.equal(june.billingDowntimeDays, 3);
  assert.equal(june.finalRentalAmount, 70000);
});

test('buildRentalDebtRows calculates outstanding from related payments', () => {
  const rows = buildRentalDebtRows(
    [
      {
        id: 'gr-1',
        clientId: 'c-1',
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

test('buildRentalDebtRows uses downtime-adjusted rental amount', () => {
  const rows = buildRentalDebtRows(
    [
      {
        id: 'gr-downtime-debt',
        clientId: 'c-1',
        client: 'Металл',
        equipmentInv: '013',
        manager: 'Руслан',
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        amount: 310000,
        paymentStatus: 'partial',
        status: 'active',
        downtimePeriods: [
          {
            id: 'dt-1',
            rentalId: 'gr-downtime-debt',
            startDate: '2026-05-01',
            endDate: '2026-05-07',
            reason: 'ожидание клиента',
            affectsBilling: true,
            status: 'active',
          },
          {
            id: 'dt-2',
            rentalId: 'gr-downtime-debt',
            startDate: '2026-05-13',
            endDate: '2026-05-17',
            reason: 'эвакуатор не мог забрать технику',
            affectsBilling: true,
            status: 'active',
          },
        ],
      },
    ],
    [
      { id: 'p-1', rentalId: 'gr-downtime-debt', amount: 310000, paidAmount: 100000, status: 'partial' },
    ],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].grossAmount, 310000);
  assert.equal(rows[0].downtimeAdjustmentAmount, 120000);
  assert.equal(rows[0].amount, 190000);
  assert.equal(rows[0].outstanding, 90000);
});

test('buildRentalDebtRows keeps overpayment from creating negative debt', () => {
  const rows = buildRentalDebtRows(
    [
      {
        id: 'gr-overpaid',
        clientId: 'c-1',
        client: 'ЭМ-СТРОЙ',
        equipmentInv: '083',
        manager: 'Руслан',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        amount: 100000,
        paymentStatus: 'paid',
        status: 'closed',
      },
    ],
    [
      { id: 'p-overpaid', rentalId: 'gr-overpaid', amount: 100000, paidAmount: 120000, status: 'paid' },
    ],
  );

  assert.equal(rows.length, 0);
});

test('buildRentalDebtRows ignores closed error payments and duplicate ids', () => {
  const rows = buildRentalDebtRows(
    [
      {
        id: 'gr-safe-payments',
        clientId: 'c-1',
        client: 'ЭМ-СТРОЙ',
        equipmentInv: '083',
        manager: 'Руслан',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        amount: 100000,
        paymentStatus: 'partial',
        status: 'active',
      },
    ],
    [
      { id: 'p-valid', rentalId: 'gr-safe-payments', amount: 100000, paidAmount: 25000, status: 'partial' },
      { id: 'p-valid', rentalId: 'gr-safe-payments', amount: 100000, paidAmount: 25000, status: 'partial' },
      { id: 'p-error', rentalId: 'gr-safe-payments', amount: 100000, paidAmount: 50000, status: 'error' },
      { id: 'p-closed', rentalId: 'gr-safe-payments', amount: 100000, paidAmount: 50000, status: 'closed' },
    ],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].paidAmount, 25000);
  assert.equal(rows[0].outstanding, 75000);
});

test('buildRentalDebtRows keeps stale paid status from hiding debt without factual payments', () => {
  const rows = buildRentalDebtRows(
    [
      {
        id: 'gr-stale-paid',
        clientId: 'c-1',
        client: 'ЭМ-СТРОЙ',
        equipmentInv: '083',
        manager: 'Руслан',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        amount: 100000,
        paymentStatus: 'paid',
        status: 'closed',
      },
    ],
    [],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].paidAmount, 0);
  assert.equal(rows[0].outstanding, 100000);
  assert.equal(rows[0].paymentStatus, 'unpaid');
});

test('buildRentalDebtRows excludes cancelled deleted archived rentals and keeps closed unpaid rentals', () => {
  const rows = buildRentalDebtRows(
    [
      {
        id: 'gr-cancelled',
        clientId: 'c-1',
        client: 'ЭМ-СТРОЙ',
        equipmentInv: '083',
        manager: 'Руслан',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        amount: 100000,
        paymentStatus: 'unpaid',
        status: 'cancelled',
      },
      {
        id: 'gr-deleted',
        clientId: 'c-1',
        client: 'ЭМ-СТРОЙ',
        equipmentInv: '084',
        manager: 'Руслан',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        amount: 100000,
        paymentStatus: 'unpaid',
        status: 'deleted',
      },
      {
        id: 'gr-archived',
        clientId: 'c-1',
        client: 'ЭМ-СТРОЙ',
        equipmentInv: '085',
        manager: 'Руслан',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        amount: 100000,
        paymentStatus: 'unpaid',
        status: 'archived',
      },
      {
        id: 'gr-closed',
        clientId: 'c-1',
        client: 'ЭМ-СТРОЙ',
        equipmentInv: '086',
        manager: 'Руслан',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        amount: 100000,
        paymentStatus: 'unpaid',
        status: 'closed',
      },
    ],
    [],
  );

  assert.deepEqual(rows.map(row => row.rentalId), ['gr-closed']);
  assert.equal(rows[0].outstanding, 100000);
});

test('expected and client-only payments do not reduce factual rental debt', () => {
  const rows = buildRentalDebtRows(
    [
      {
        id: 'gr-expected',
        clientId: 'c-1',
        client: 'ЭМ-СТРОЙ',
        equipmentInv: '083',
        manager: 'Руслан',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        amount: 100000,
        paymentStatus: 'unpaid',
        status: 'active',
      },
    ],
    [
      { id: 'p-expected', rentalId: 'gr-expected', clientId: 'c-1', amount: 100000, status: 'pending' },
      { id: 'p-client-only', clientId: 'c-1', amount: 100000, paidAmount: 100000, status: 'paid' },
    ],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].paidAmount, 0);
  assert.equal(rows[0].outstanding, 100000);
});

test('payment allocations close only selected rentals and keep contract payment remainder unallocated', () => {
  const rentals = [
    {
      id: 'gr-1',
      clientId: 'c-1',
      objectId: 'o-1',
      contractId: 'ct-1',
      client: 'ЭМ-СТРОЙ',
      equipmentInv: '083',
      manager: 'Руслан',
      managerId: 'u-1',
      documentId: 'd-1',
      startDate: '2026-04-01',
      endDate: '2026-04-10',
      amount: 100000,
      status: 'active',
    },
    {
      id: 'gr-2',
      clientId: 'c-1',
      objectId: 'o-2',
      contractId: 'ct-1',
      client: 'ЭМ-СТРОЙ',
      equipmentInv: '084',
      manager: 'Руслан',
      managerId: 'u-1',
      documentId: 'd-2',
      startDate: '2026-04-01',
      endDate: '2026-04-10',
      amount: 100000,
      status: 'active',
    },
  ];
  const payments = [{ id: 'p-1', clientId: 'c-1', contractId: 'ct-1', amount: 150000, paidAmount: 150000, status: 'paid' }];
  const allocations = [{ id: 'pa-1', paymentId: 'p-1', clientId: 'c-1', objectId: 'o-1', contractId: 'ct-1', rentalId: 'gr-1', documentId: 'd-1', amount: 100000 }];

  const rows = buildRentalDebtRows(rentals, payments, { paymentAllocations: allocations });

  assert.deepEqual(rows.map(row => [row.rentalId, row.paidAmount, row.outstanding]), [
    ['gr-2', 0, 100000],
  ]);

  const report = buildFinanceReport({ clients: [{ id: 'c-1', company: 'ЭМ-СТРОЙ' }], rentals, payments, paymentAllocations: allocations }, '2026-04-18');
  assert.equal(report.unallocatedPayments[0].unallocatedAmount, 50000);
  assert.equal(report.debtByObject.find(row => row.objectId === 'o-2').debt, 100000);
  assert.equal(report.debtByContract.find(row => row.contractId === 'ct-1').debt, 100000);
  assert.equal(report.debtByRental.find(row => row.rentalId === 'gr-2').debt, 100000);
  assert.equal(report.debtByManager.find(row => row.managerId === 'u-1').debt, 100000);
  assert.equal(report.debtByDocument.find(row => row.documentId === 'd-2').debt, 100000);
});

test('allocation preview suggests but does not apply unallocated contract payment', () => {
  const rentals = [
    { id: 'gr-1', clientId: 'c-1', objectId: 'o-1', contractId: 'ct-1', client: 'Клиент', equipmentInv: '083', manager: 'Анна', startDate: '2026-04-01', endDate: '2026-04-10', amount: 60000, status: 'active' },
    { id: 'gr-2', clientId: 'c-1', objectId: 'o-2', contractId: 'ct-1', client: 'Клиент', equipmentInv: '084', manager: 'Анна', startDate: '2026-04-01', endDate: '2026-04-10', amount: 60000, status: 'active' },
  ];
  const payments = [{ id: 'p-1', clientId: 'c-1', contractId: 'ct-1', amount: 90000, paidAmount: 90000, status: 'paid' }];

  const preview = buildAllocationPreview({ payments, paymentAllocations: [], rentals }, 'p-1');
  const rowsAfterPreview = buildRentalDebtRows(rentals, payments, { paymentAllocations: [] });

  assert.equal(preview.unallocatedAmount, 90000);
  assert.deepEqual(preview.suggestedAllocations.map(item => [item.rentalId, item.amount]), [
    ['gr-1', 60000],
    ['gr-2', 30000],
  ]);
  assert.deepEqual(rowsAfterPreview.map(row => [row.rentalId, row.outstanding]), [
    ['gr-1', 60000],
    ['gr-2', 60000],
  ]);
});

test('legacy payment allocation backfill preserves payments and links rental or document payments only', () => {
  const payments = [
    { id: 'p-rental', rentalId: 'gr-1', clientId: 'c-1', amount: 100000, paidAmount: 80000, status: 'partial' },
    { id: 'p-client', clientId: 'c-1', amount: 50000, paidAmount: 50000, status: 'paid' },
    { id: 'p-document', documentId: 'd-1', clientId: 'c-1', amount: 70000, paidAmount: 90000, status: 'paid' },
  ];
  const result = backfillPaymentAllocations({
    payments,
    paymentAllocations: [],
    rentals: [
      { id: 'gr-1', clientId: 'c-1', objectId: 'o-1', contractId: 'ct-1' },
      { id: 'gr-2', clientId: 'c-1', objectId: 'o-2', contractId: 'ct-1' },
    ],
    documents: [{ id: 'd-1', rentalId: 'gr-2', clientId: 'c-1' }],
    nowIso: () => '2026-05-13T00:00:00.000Z',
  });

  assert.equal(payments.length, 3);
  assert.equal(result.created, 2);
  assert.deepEqual(result.allocations.map(item => [item.paymentId, item.rentalId, item.amount]), [
    ['p-rental', 'gr-1', 80000],
    ['p-document', 'gr-2', 70000],
  ]);
  assert.equal(result.allocations.some(item => item.paymentId === 'p-client'), false);
});

test('debt supports one contract on many objects and one object in many contracts through allocations', () => {
  const rentals = [
    { id: 'r-1', clientId: 'c-1', objectId: 'o-1', contractId: 'ct-1', client: 'Клиент', equipmentInv: '1', manager: 'М1', startDate: '2026-05-01', endDate: '2026-05-10', amount: 100000, status: 'active' },
    { id: 'r-2', clientId: 'c-1', objectId: 'o-2', contractId: 'ct-1', client: 'Клиент', equipmentInv: '2', manager: 'М1', startDate: '2026-05-01', endDate: '2026-05-10', amount: 100000, status: 'active' },
    { id: 'r-3', clientId: 'c-1', objectId: 'o-1', contractId: 'ct-2', client: 'Клиент', equipmentInv: '3', manager: 'М2', startDate: '2026-05-01', endDate: '2026-05-10', amount: 100000, status: 'active' },
  ];
  const payments = [{ id: 'p-1', clientId: 'c-1', amount: 90000, paidAmount: 90000, status: 'paid' }];
  const paymentAllocations = [
    { id: 'pa-1', paymentId: 'p-1', rentalId: 'r-1', objectId: 'o-1', contractId: 'ct-1', amount: 30000 },
    { id: 'pa-2', paymentId: 'p-1', rentalId: 'r-2', objectId: 'o-2', contractId: 'ct-1', amount: 30000 },
    { id: 'pa-3', paymentId: 'p-1', rentalId: 'r-3', objectId: 'o-1', contractId: 'ct-2', amount: 30000 },
  ];

  const report = buildFinanceReport({ clients: [{ id: 'c-1', company: 'Клиент' }], rentals, payments, paymentAllocations }, '2026-05-13');

  assert.equal(report.debtByClient.find(row => row.clientId === 'c-1').debt, 210000);
  assert.equal(report.debtByObject.find(row => row.objectId === 'o-1').debt, 140000);
  assert.equal(report.debtByObject.find(row => row.objectId === 'o-2').debt, 70000);
  assert.equal(report.debtByContract.find(row => row.contractId === 'ct-1').debt, 140000);
  assert.equal(report.debtByContract.find(row => row.contractId === 'ct-2').debt, 70000);
});

test('non-finite legacy paidAmount cannot poison debt rows with NaN', () => {
  const rows = buildRentalDebtRows(
    [
      {
        id: 'gr-nan-payment',
        clientId: 'c-1',
        client: 'ЭМ-СТРОЙ',
        equipmentInv: '083',
        manager: 'Руслан',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        amount: 100000,
        paymentStatus: 'partial',
        status: 'active',
      },
    ],
    [
      { id: 'p-nan', rentalId: 'gr-nan-payment', amount: 100000, paidAmount: NaN, status: 'partial' },
    ],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].paidAmount, 0);
  assert.equal(rows[0].outstanding, 100000);
  assert.doesNotMatch(JSON.stringify(rows), /NaN/);
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
        clientId: 'c-1',
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
        clientId: 'c-1',
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
        clientId: 'c-1',
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

test('buildOverdueBuckets includes current debt in the 0-7 aging bucket', () => {
  const buckets = buildOverdueBuckets(
    [
      {
        rentalId: 'gr-current',
        clientId: 'c-1',
        client: 'ЭМ-СТРОЙ',
        equipmentInv: '083',
        manager: 'Руслан',
        startDate: '2026-04-18',
        endDate: '2026-04-28',
        expectedPaymentDate: '2026-04-28',
        amount: 50000,
        paidAmount: 0,
        outstanding: 50000,
        paymentStatus: 'unpaid',
        rentalStatus: 'active',
      },
    ],
    '2026-04-18',
  );

  assert.equal(buckets.find(item => item.key === '0_7')?.rentals, 1);
  assert.equal(buckets.find(item => item.key === '0_7')?.debt, 50000);
});

test('buildClientDebtAgingRows groups by client manager age and active rental flag', () => {
  const rows = buildClientDebtAgingRows(
    [{ id: 'c-1', company: 'ООО Клиент', manager: 'Анна' }],
    [
      {
        rentalId: 'gr-active',
        clientId: 'c-1',
        client: 'Старое имя',
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
      {
        rentalId: 'gr-closed',
        clientId: 'c-1',
        client: 'Старое имя',
        equipmentInv: '084',
        manager: 'Руслан',
        startDate: '2026-04-12',
        endDate: '2026-04-18',
        expectedPaymentDate: '2026-04-18',
        amount: 30000,
        paidAmount: 0,
        outstanding: 30000,
        paymentStatus: 'unpaid',
        rentalStatus: 'closed',
      },
      {
        rentalId: 'gr-legacy',
        client: '',
        equipmentInv: '',
        manager: '',
        startDate: '',
        endDate: '',
        amount: 10000,
        paidAmount: 0,
        outstanding: 10000,
        paymentStatus: 'unpaid',
        rentalStatus: '',
      },
    ],
    '2026-04-18',
  );

  assert.equal(rows.length, 3);
  assert.equal(rows[0].client, 'ООО Клиент');
  assert.equal(rows[0].manager, 'Руслан');
  assert.equal(rows[0].ageBucket, '8_14');
  assert.equal(rows[0].debt, 60000);
  assert.equal(rows[0].hasActiveRental, true);

  const closed = rows.find(item => item.debt === 30000);
  assert.equal(closed?.ageBucket, '0_7');
  assert.equal(closed?.hasActiveRental, false);

  const legacy = rows.find(item => item.client === 'Клиент не привязан');
  assert.equal(legacy?.manager, 'Не назначен');
  assert.equal(legacy?.ageBucket, '0_7');
});

test('buildFinanceReport returns aggregated totals and slices', () => {
  const report = buildFinanceReport(
    {
      clients: [{ id: 'c-1', company: 'ЭМ-СТРОЙ', creditLimit: 50000 }],
      rentals: [
        {
          id: 'gr-1',
          clientId: 'c-1',
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
        { id: 'p-1', rentalId: 'gr-1', clientId: 'c-1', amount: 100000, paidAmount: 40000, status: 'partial' },
      ],
    },
    '2026-04-18',
  );

  assert.equal(report.debtRows.length, 1);
  assert.equal(report.clientReceivables.length, 1);
  assert.equal(report.managerReceivables.length, 1);
  assert.equal(report.clientDebtAgingRows.length, 1);
  assert.equal(report.totals.debt, 60000);
  assert.equal(report.totals.overdueDebt, 60000);
});

test('finance report receivable invariants hold for partial full and multiple rental payments', () => {
  const report = buildFinanceReport(
    {
      clients: [
        { id: 'c-1', company: 'ООО Один', creditLimit: 0, manager: 'Анна' },
        { id: 'c-2', company: 'ООО Два', creditLimit: 0, manager: 'Борис' },
      ],
      rentals: [
        {
          id: 'gr-a',
          clientId: 'c-1',
          client: 'ООО Один',
          equipmentInv: '101',
          manager: 'Анна',
          startDate: '2026-04-01',
          endDate: '2026-04-10',
          expectedPaymentDate: '2026-04-05',
          amount: 100000,
          paymentStatus: 'partial',
          status: 'active',
        },
        {
          id: 'gr-b',
          clientId: 'c-1',
          client: 'ООО Один',
          equipmentInv: '102',
          manager: 'Анна',
          startDate: '2026-04-03',
          endDate: '2026-04-12',
          expectedPaymentDate: '2026-04-06',
          amount: 50000,
          paymentStatus: 'partial',
          status: 'active',
        },
        {
          id: 'gr-paid',
          clientId: 'c-2',
          client: 'ООО Два',
          equipmentInv: '201',
          manager: 'Борис',
          startDate: '2026-04-01',
          endDate: '2026-04-10',
          expectedPaymentDate: '2026-04-05',
          amount: 100000,
          paymentStatus: 'paid',
          status: 'closed',
        },
      ],
      payments: [
        { id: 'p-a-1', rentalId: 'gr-a', clientId: 'c-1', amount: 40000, paidAmount: 40000, status: 'paid' },
        { id: 'p-b-1', rentalId: 'gr-b', clientId: 'c-1', amount: 30000, paidAmount: 30000, status: 'partial' },
        { id: 'p-b-2', rentalId: 'gr-b', clientId: 'c-1', amount: 50000, paidAmount: 40000, status: 'paid' },
        { id: 'p-paid', rentalId: 'gr-paid', clientId: 'c-2', amount: 100000, paidAmount: 100000, status: 'paid' },
      ],
    },
    '2026-04-18',
  );

  assert.equal(report.totals.debt, 60000);
  assert.equal(report.clientReceivables.reduce((sum, item) => sum + item.currentDebt, 0), report.totals.debt);
  assert.equal(report.managerReceivables.reduce((sum, item) => sum + item.currentDebt, 0), report.totals.debt);
  assert.equal(report.debtRows.length, 1);
  assert.equal(report.debtRows[0].rentalId, 'gr-a');
});

test('manual client debt contributes to receivables and manager totals', () => {
  const report = buildFinanceReport(
    {
      clients: [{
        id: 'c-manual-1',
        company: 'ООО Ручной долг',
        creditLimit: 20000,
        debt: 35000,
        manager: 'Анна',
      }],
      rentals: [],
      payments: [],
    },
    '2026-04-18',
  );

  assert.equal(report.clientReceivables.length, 1);
  assert.equal(report.clientReceivables[0].currentDebt, 35000);
  assert.equal(report.clientReceivables[0].manualDebt, 35000);
  assert.equal(report.clientReceivables[0].unpaidRentals, 0);
  assert.equal(report.clientReceivables[0].exceededLimit, true);
  assert.equal(report.clientSnapshots[0].currentDebt, 35000);
  assert.equal(report.clientSnapshots[0].manualDebt, 35000);
  assert.equal(report.managerReceivables.length, 1);
  assert.equal(report.managerReceivables[0].manager, 'Анна');
  assert.equal(report.managerReceivables[0].currentDebt, 35000);
  assert.equal(report.managerReceivables[0].overdueDebt, 0);
  assert.equal(report.totals.debt, 35000);
});

test('client rename keeps receivables linked by clientId', () => {
  const clients = [{ id: 'c-1', company: 'ООО Ромашка Казань', creditLimit: 0 }];
  const rentals = [
    {
      id: 'gr-rename-1',
      clientId: 'c-1',
      client: 'ООО Ромашка',
      equipmentInv: '101',
      manager: 'Руслан',
      startDate: '2026-04-01',
      endDate: '2026-04-10',
      expectedPaymentDate: '2026-04-05',
      amount: 100000,
      paymentStatus: 'unpaid',
      status: 'active',
    },
  ];

  const snapshots = buildClientFinancialSnapshots(clients, rentals, [], '2026-04-18');

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].clientId, 'c-1');
  assert.equal(snapshots[0].client, 'ООО Ромашка Казань');
  assert.equal(snapshots[0].currentDebt, 100000);
  assert.equal(snapshots[0].totalRentals, 1);
});

test('client rename keeps partial payment remainder by clientId', () => {
  const report = buildFinanceReport(
    {
      clients: [{ id: 'c-1', company: 'ООО Ромашка Казань', creditLimit: 0 }],
      rentals: [
        {
          id: 'gr-rename-2',
          clientId: 'c-1',
          client: 'ООО Ромашка',
          equipmentInv: '102',
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
        { id: 'p-rename-2', rentalId: 'gr-rename-2', clientId: 'c-1', amount: 100000, paidAmount: 40000, status: 'partial' },
      ],
    },
    '2026-04-18',
  );

  assert.equal(report.totals.debt, 60000);
  assert.equal(report.clientSnapshots[0].currentDebt, 60000);
  assert.equal(report.clientReceivables[0].currentDebt, 60000);
});

test('changing rental clientId moves receivable to the new client id', () => {
  const report = buildFinanceReport(
    {
      clients: [
        { id: 'c-old', company: 'Старый клиент', creditLimit: 0 },
        { id: 'c-new', company: 'Новый клиент', creditLimit: 0 },
      ],
      rentals: [
        {
          id: 'gr-client-moved',
          clientId: 'c-new',
          client: 'Старый клиент',
          equipmentInv: '105',
          manager: 'Руслан',
          startDate: '2026-04-01',
          endDate: '2026-04-10',
          expectedPaymentDate: '2026-04-05',
          amount: 100000,
          paymentStatus: 'unpaid',
          status: 'active',
        },
      ],
      payments: [],
    },
    '2026-04-18',
  );

  assert.equal(report.clientReceivables.length, 1);
  assert.equal(report.clientReceivables[0].clientId, 'c-new');
  assert.equal(report.clientReceivables[0].client, 'Новый клиент');
  assert.equal(report.clientReceivables[0].currentDebt, 100000);
});

test('renamed client keeps report slices unchanged', () => {
  const report = buildFinanceReport(
    {
      clients: [{ id: 'c-1', company: 'ООО Ромашка Казань', creditLimit: 50000 }],
      rentals: [
        {
          id: 'gr-report-1',
          clientId: 'c-1',
          client: 'ООО Ромашка',
          equipmentInv: '103',
          manager: 'Руслан',
          startDate: '2026-04-01',
          endDate: '2026-04-10',
          expectedPaymentDate: '2026-04-05',
          amount: 100000,
          paymentStatus: 'unpaid',
          status: 'active',
        },
      ],
      payments: [],
    },
    '2026-04-18',
  );

  assert.equal(report.clientReceivables[0].clientId, 'c-1');
  assert.equal(report.clientReceivables[0].currentDebt, 100000);
  assert.equal(report.managerReceivables[0].currentDebt, 100000);
  assert.equal(report.overdueBuckets.find(item => item.key === '8_14')?.debt, 100000);
  assert.equal(report.totals.unpaidRentals, 1);
  assert.equal(report.totals.overdueDebt, 100000);
});

test('rows without clientId are marked as unlinked instead of attached by renamed name', () => {
  const rows = buildClientReceivables(
    [{ id: 'c-1', company: 'ООО Ромашка Казань', creditLimit: 0 }],
    [
      {
        rentalId: 'gr-legacy-1',
        client: 'ООО Ромашка',
        equipmentInv: '104',
        manager: 'Руслан',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        expectedPaymentDate: '2026-04-05',
        amount: 100000,
        paidAmount: 0,
        outstanding: 100000,
        paymentStatus: 'unpaid',
        rentalStatus: 'active',
      },
    ],
    '2026-04-18',
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].clientId, undefined);
  assert.equal(rows[0].dataIssue, 'missing_client_id');
  assert.equal(rows[0].currentDebt, 100000);
});
