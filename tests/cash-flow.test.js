import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildCashFlow } = require('../server/lib/cash-flow.js');

const taxSettings = {
  taxRegime: 'OSNO',
  vatMode: 'standard',
  defaultVatRate: 20,
  inputVatEnabled: true,
  outputVatEnabled: true,
  vatIncludedByDefault: true,
};

test('cash flow includes expected payments, expenses, VAT and optional depreciation', () => {
  const result = buildCashFlow({
    rentals: [
      { id: 'GR-1', clientId: 'C-1', client: 'ООО Альфа', equipmentId: 'EQ-1', amount: 120000, startDate: '2026-05-01', endDate: '2026-05-31', expectedPaymentDate: '2026-05-20', status: 'active' },
    ],
    payments: [],
    companyExpenses: [
      { id: 'CE-1', name: 'Склад', amount: 60000, status: 'active', paymentDay: 15, counterparty: 'Арендодатель' },
    ],
    equipmentFinance: [
      { equipmentId: 'EQ-1', purchasePrice: 1200000, salvageValue: 120000, usefulLifeMonths: 36, depreciationStartDate: '2026-01-01' },
    ],
    companyTaxSettings: taxSettings,
  }, {
    dateFrom: '2026-05-01',
    dateTo: '2026-05-31',
    groupBy: 'month',
    mode: 'expected',
    includeVat: true,
    includeDepreciation: true,
  });

  assert.equal(result.summary.incomingTotal, 120000);
  assert.equal(result.summary.outgoingTotal, 90000);
  assert.equal(result.summary.depreciationTotal, 30000);
  assert.equal(result.summary.vatPayableEstimate, 10000);
  assert.equal(result.periods[0].period, '2026-05');
});

test('cash flow includes factual payments and overdue receivables', () => {
  const result = buildCashFlow({
    rentals: [
      { id: 'GR-old', client: 'ООО Долг', amount: 50000, startDate: '2026-04-01', endDate: '2026-04-30', expectedPaymentDate: '2026-04-30', status: 'active' },
    ],
    payments: [
      { id: 'P-1', client: 'ООО Факт', amount: 120000, paidAmount: 120000, paidDate: '2026-05-10', status: 'paid' },
    ],
    companyTaxSettings: taxSettings,
  }, {
    dateFrom: '2026-05-01',
    dateTo: '2026-05-31',
    groupBy: 'week',
    mode: 'all',
    includeVat: true,
  });

  assert.equal(result.summary.incomingTotal, 120000);
  assert.equal(result.summary.overdueReceivables, 50000);
  assert.ok(result.periods[0].period.includes('-W'));
});

test('cash flow does not duplicate linked rental ids', () => {
  const result = buildCashFlow({
    rentals: [
      { id: 'GR-1', amount: 100000, expectedPaymentDate: '2026-05-10', status: 'active' },
      { id: 'GR-1', amount: 100000, expectedPaymentDate: '2026-05-10', status: 'active' },
    ],
    payments: [{ id: 'P-1', rentalId: 'GR-1', amount: 100000, paidAmount: 100000, paidDate: '2026-05-09', status: 'paid' }],
    companyTaxSettings: taxSettings,
  }, {
    dateFrom: '2026-05-01',
    dateTo: '2026-05-31',
    mode: 'all',
  });

  assert.equal(result.items.filter(item => item.id === 'payment:P-1').length, 1);
  assert.equal(result.items.some(item => item.id === 'rental:GR-1'), false);
});
