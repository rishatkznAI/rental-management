import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const equipmentPageSource = readFileSync(new URL('../src/app/pages/Equipment.tsx', import.meta.url), 'utf8');
const equipmentServiceSource = readFileSync(new URL('../src/app/services/equipment.service.ts', import.meta.url), 'utf8');
const equipmentHookSource = readFileSync(new URL('../src/app/hooks/useEquipment.ts', import.meta.url), 'utf8');

test('readiness section renders on the equipment page', () => {
  assert.match(equipmentPageSource, /function FleetReadinessSection/);
  assert.match(equipmentPageSource, /data-testid="fleet-readiness-section"/);
  assert.match(equipmentPageSource, /Готовность парка/);
  assert.match(equipmentPageSource, /useEquipmentReadiness\(\)/);
});

test('readiness KPI cards render practical counters', () => {
  assert.match(equipmentPageSource, /Готова к аренде/);
  assert.match(equipmentPageSource, /Требует проверки/);
  assert.match(equipmentPageSource, /В сервисе/);
  assert.match(equipmentPageSource, /Блокеры доставки/);
  assert.match(equipmentPageSource, /Внимание GSM/);
});

test('readiness loss KPI cards render financial counters', () => {
  assert.match(equipmentPageSource, /Потеря в день/);
  assert.match(equipmentPageSource, /Оценка потерь/);
  assert.match(equipmentPageSource, /Без ставки/);
  assert.match(equipmentPageSource, /Главный блокер/);
  assert.match(equipmentPageSource, /formatCurrency\(value\)/);
});

test('readiness blockers and recommended actions display in the table', () => {
  assert.match(equipmentPageSource, /item\.blockers\.length > 0 \? item\.blockers\.join/);
  assert.match(equipmentPageSource, /item\.recommendedAction/);
  assert.match(equipmentPageSource, /item\.financialRecommendation/);
  assert.match(equipmentPageSource, /Нет открытых блокеров/);
});

test('readiness filter supports requested statuses', () => {
  assert.match(equipmentPageSource, /READINESS_FILTERS/);
  assert.match(equipmentPageSource, /value: 'all'/);
  assert.match(equipmentPageSource, /value: 'ready'/);
  assert.match(equipmentPageSource, /value: 'needs_check'/);
  assert.match(equipmentPageSource, /value: 'in_service'/);
  assert.match(equipmentPageSource, /value: 'delivery_blocked'/);
  assert.match(equipmentPageSource, /value: 'gsm_attention'/);
  assert.match(equipmentPageSource, /value: 'with_loss'/);
  assert.match(equipmentPageSource, /value: 'without_rate'/);
  assert.match(equipmentPageSource, /value: 'high_loss'/);
  assert.match(equipmentPageSource, /filteredItems = React\.useMemo/);
});

test('readiness table renders loss fields without raw null states', () => {
  assert.match(equipmentPageSource, /Потеря\/день/);
  assert.match(equipmentPageSource, /Уже потеряно/);
  assert.match(equipmentPageSource, /Ответственный/);
  assert.match(equipmentPageSource, /Финансовое действие/);
  assert.match(equipmentPageSource, /нет ставки/);
  assert.match(equipmentPageSource, /оценочно/);
  assert.match(equipmentPageSource, /responsibleAreaLabel\(item\.responsibleArea\)/);
  assert.match(equipmentPageSource, /right\.estimatedLoss/);
  assert.doesNotMatch(equipmentPageSource, /\[object Object\]/);
});

test('readiness error state is safe and endpoint is centralized in service hook', () => {
  assert.match(equipmentPageSource, /Не удалось загрузить готовность парка/);
  assert.match(equipmentPageSource, /apiErrorMessage\(error, 'Проверьте доступ к \/api\/equipment\/readiness\.'\)/);
  assert.match(equipmentServiceSource, /getReadiness: \(\): Promise<FleetReadinessResponse> =>\s*api\.get<FleetReadinessResponse>\('\/api\/equipment\/readiness'\)/);
  assert.match(equipmentHookSource, /useEquipmentReadiness/);
  assert.match(equipmentHookSource, /EQUIPMENT_KEYS\.readiness/);
});
