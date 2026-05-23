import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeEquipmentFinance,
  calculateEquipmentDepreciation,
} = require('../server/lib/equipment-depreciation.js');

test('monthly straight-line depreciation is calculated', () => {
  const result = calculateEquipmentDepreciation({
    purchasePrice: 1200000,
    salvageValue: 120000,
    usefulLifeMonths: 36,
    depreciationMethod: 'straight_line',
    depreciationStartDate: '2026-01-01',
  }, '2026-01-31');

  assert.equal(result.status, 'configured');
  assert.equal(result.monthlyDepreciation, 30000);
});

test('residual value is capped at salvage value', () => {
  const result = calculateEquipmentDepreciation({
    purchasePrice: 1200000,
    salvageValue: 120000,
    usefulLifeMonths: 36,
    depreciationStartDate: '2020-01-01',
  }, '2026-05-23');

  assert.equal(result.accumulatedDepreciation, 1080000);
  assert.equal(result.residualValue, 120000);
});

test('usefulLifeMonths and salvage value validation rejects unsafe data', () => {
  assert.throws(() => normalizeEquipmentFinance({
    equipmentId: 'EQ-1',
    purchasePrice: 100000,
    usefulLifeMonths: 0,
  }), /Срок полезного использования/);

  assert.throws(() => normalizeEquipmentFinance({
    equipmentId: 'EQ-1',
    purchasePrice: 100000,
    usefulLifeMonths: 12,
    salvageValue: 120000,
  }), /Ликвидационная стоимость/);
});

test('missing data returns not_configured', () => {
  const result = calculateEquipmentDepreciation({}, '2026-05-23');

  assert.equal(result.status, 'not_configured');
  assert.equal(result.monthlyDepreciation, 0);
});
