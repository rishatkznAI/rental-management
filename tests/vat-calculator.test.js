import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  calculateVatBreakdown,
  getVatPolicy,
  splitAmountVatIncluded,
  addVatToNet,
} = require('../server/lib/vat-calculator.js');

test('OSNO applies VAT with configured output VAT', () => {
  const result = calculateVatBreakdown(120000, {
    companySettings: {
      taxRegime: 'OSNO',
      vatMode: 'standard',
      defaultVatRate: 20,
      outputVatEnabled: true,
      vatIncludedByDefault: true,
    },
  });

  assert.equal(result.vatApplied, true);
  assert.equal(result.taxRegime, 'OSNO');
  assert.equal(result.netAmount, 100000);
  assert.equal(result.vatAmount, 20000);
});

test('USN exempt gives vatApplied=false', () => {
  const policy = getVatPolicy({
    taxRegime: 'USN_VAT_EXEMPT',
    vatMode: 'standard',
    defaultVatRate: 20,
    outputVatEnabled: true,
  });

  assert.equal(policy.vatApplied, false);
  assert.equal(policy.reason, 'tax_regime_vat_exempt');
});

test('custom VAT rate works for VAT excluded amounts', () => {
  const result = calculateVatBreakdown(100000, {
    companySettings: {
      taxRegime: 'OTHER',
      vatMode: 'custom',
      defaultVatRate: 7,
      outputVatEnabled: true,
      vatIncludedByDefault: false,
    },
  });

  assert.equal(result.grossAmount, 107000);
  assert.equal(result.netAmount, 100000);
  assert.equal(result.vatAmount, 7000);
  assert.equal(result.vatRate, 7);
});

test('vat included split and vat excluded add are stable', () => {
  assert.deepEqual(splitAmountVatIncluded(120, 20), {
    grossAmount: 120,
    netAmount: 100,
    vatAmount: 20,
  });
  assert.deepEqual(addVatToNet(100, 20), {
    grossAmount: 120,
    netAmount: 100,
    vatAmount: 20,
  });
});

test('unknown tax settings returns unknown instead of false precision', () => {
  const result = calculateVatBreakdown(1000, { companySettings: {} });

  assert.equal(result.status, 'unknown');
  assert.equal(result.taxRegime, 'unknown');
  assert.equal(result.vatApplied, false);
  assert.doesNotMatch(JSON.stringify(result), /undefined|null|\[object Object\]|secret|token|password/i);
});
