import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const financeSource = fs.readFileSync(new URL('../src/app/pages/Finance.tsx', import.meta.url), 'utf8');
const equipmentDetailSource = fs.readFileSync(new URL('../src/app/pages/EquipmentDetail.tsx', import.meta.url), 'utf8');
const financeServiceSource = fs.readFileSync(new URL('../src/app/services/finance.service.ts', import.meta.url), 'utf8');

test('Finance contains Cash Flow and VAT settings UI without unsafe labels', () => {
  assert.match(financeSource, /TabsTrigger value="cash-flow">Cash Flow/);
  assert.match(financeSource, /Тип налогообложения/);
  assert.match(financeSource, /Ставка НДС по умолчанию/);
  assert.match(financeSource, /Расчёт управленческий, не заменяет бухгалтерскую отчётность/);
  assert.match(financeServiceSource, /\/api\/finance\/cash-flow/);
  assert.doesNotMatch(financeSource, /\[object Object\]|secret|token|password/i);
});

test('Equipment detail contains depreciation economics block', () => {
  assert.match(equipmentDetailSource, /Амортизация/);
  assert.match(equipmentDetailSource, /Управленческая амортизация/);
  assert.match(equipmentDetailSource, /Остаточная стоимость/);
  assert.match(equipmentDetailSource, /getEconomics/);
  assert.doesNotMatch(equipmentDetailSource, /\[object Object\]/);
});
