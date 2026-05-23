import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCashFlowResponseShape,
  assertDepreciationIsNonCash,
  assertEconomicsResponseSafe,
  assertNoUnsafeFinanceSmokePayload,
  assertTaxSettingsSafe,
  findUnsafeFinanceSmokePayloadViolations,
  hasUnsafeFinanceSmokeText,
} from '../scripts/finance-smoke-checks.mjs';

function cashFlowPayload(overrides = {}) {
  return {
    summary: {
      openingBalance: 10000,
      incomingTotal: 120000,
      outgoingTotal: 60000,
      netCashFlow: 60000,
      closingBalanceForecast: 70000,
      depreciationTotal: 30000,
      nonCashAdjustments: 30000,
      economicsOverlay: { depreciationTotal: 30000 },
      ...overrides.summary,
    },
    periods: overrides.periods || [
      { period: '2026-05', incoming: 120000, outgoing: 60000, net: 60000, depreciation: 30000, closingBalanceForecast: 70000 },
    ],
    items: overrides.items || [
      { id: 'payment:P-1', type: 'payment', direction: 'incoming', amount: 120000, description: 'Оплата клиента' },
      { id: 'expense:E-1', type: 'company_expense', direction: 'outgoing', amount: 60000, description: 'Постоянный расход' },
      { id: 'depreciation:EQ-1', type: 'depreciation', direction: 'non_cash', amount: 30000, description: 'Управленческая амортизация' },
    ],
    warnings: overrides.warnings || ['Амортизация показана как управленческий non-cash показатель и не уменьшает денежный поток.'],
  };
}

test('safe cash-flow payload passes smoke checks', () => {
  const payload = cashFlowPayload();
  assert.doesNotThrow(() => assertCashFlowResponseShape(payload));
  assert.doesNotThrow(() => assertNoUnsafeFinanceSmokePayload(payload));
});

test('depreciation non_cash payload passes smoke checks', () => {
  assert.doesNotThrow(() => assertDepreciationIsNonCash(cashFlowPayload()));
});

test('depreciation as outgoing fails smoke checks', () => {
  const payload = cashFlowPayload({
    summary: { outgoingTotal: 90000, netCashFlow: 30000, closingBalanceForecast: 40000 },
    items: [
      { id: 'payment:P-1', type: 'payment', direction: 'incoming', amount: 120000, description: 'Оплата клиента' },
      { id: 'expense:E-1', type: 'company_expense', direction: 'outgoing', amount: 60000, description: 'Постоянный расход' },
      { id: 'depreciation:EQ-1', type: 'depreciation', direction: 'outgoing', amount: 30000, description: 'Амортизация' },
    ],
  });

  assert.throws(() => assertDepreciationIsNonCash(payload), /depreciation items must be non_cash|depreciation must not be outgoing cash/);
});

test('payload with token or password fails unsafe scan', () => {
  const payload = cashFlowPayload({
    summary: { token: 'redacted-looking-but-unsafe' },
  });

  assert.throws(() => assertNoUnsafeFinanceSmokePayload(payload), /unsafe key/);
  assert.match(findUnsafeFinanceSmokePayloadViolations({ password: 'hidden' }).join('\n'), /unsafe key/);
});

test('payload with string undefined fails unsafe scan', () => {
  const payload = cashFlowPayload({
    items: [{ id: 'x', type: 'payment', direction: 'incoming', amount: 1, description: 'undefined' }],
  });

  assert.match(findUnsafeFinanceSmokePayloadViolations(payload).join('\n'), /unsafe string/);
  assert.equal(hasUnsafeFinanceSmokeText('Сумма: [object Object]'), true);
});

test('restricted economics response passes if safe', () => {
  const payload = {
    equipmentId: 'EQ-1',
    status: 'restricted',
    economicsAvailable: false,
    finance: {},
    depreciation: {
      status: 'not_configured',
      monthlyDepreciation: 0,
      accumulatedDepreciation: 0,
      residualValue: 0,
      reason: 'restricted',
    },
  };

  assert.doesNotThrow(() => assertEconomicsResponseSafe(payload, { restricted: true }));
});

test('safe tax settings response passes', () => {
  assert.doesNotThrow(() => assertTaxSettingsSafe({
    taxRegime: 'unknown',
    vatMode: 'none',
    defaultVatRate: 0,
    inputVatEnabled: false,
    outputVatEnabled: false,
  }));
});
