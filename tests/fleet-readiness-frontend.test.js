import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const equipmentPageSource = readFileSync(new URL('../src/app/pages/Equipment.tsx', import.meta.url), 'utf8');
const equipmentServiceSource = readFileSync(new URL('../src/app/services/equipment.service.ts', import.meta.url), 'utf8');
const equipmentHookSource = readFileSync(new URL('../src/app/hooks/useEquipment.ts', import.meta.url), 'utf8');
const equipmentFiltersSource = readFileSync(new URL('../src/app/pages/equipment/EquipmentFilters.tsx', import.meta.url), 'utf8');
const equipmentQuickViewSource = readFileSync(new URL('../src/app/pages/equipment/EquipmentQuickViewPanel.tsx', import.meta.url), 'utf8');
const equipmentTableSource = readFileSync(new URL('../src/app/pages/equipment/EquipmentRegistryTable.tsx', import.meta.url), 'utf8');
const equipmentMobileSource = readFileSync(new URL('../src/app/pages/equipment/EquipmentMobileCards.tsx', import.meta.url), 'utf8');

test('equipment page renders enterprise layout with compact readiness attention chips', () => {
  assert.match(equipmentPageSource, /data-testid="equipment-enterprise-page"/);
  assert.match(equipmentPageSource, /bg-\[#F6F8FB\]/);
  assert.match(equipmentPageSource, /function EquipmentAttentionChips/);
  assert.match(equipmentPageSource, /data-testid="equipment-attention-chips"/);
  assert.match(equipmentPageSource, /Требует внимания/);
  assert.match(equipmentPageSource, /Без ответственного/);
  assert.match(equipmentPageSource, /Просрочено ТО/);
  assert.match(equipmentPageSource, /GSM офлайн/);
  assert.match(equipmentPageSource, /Нет локации/);
  assert.match(equipmentPageSource, /Высокий приоритет/);
  assert.match(equipmentPageSource, /Без ставки/);
});

test('readiness and action queue data remain sourced from existing frontend hooks', () => {
  assert.match(equipmentPageSource, /useEquipmentReadiness\(\)/);
  assert.match(equipmentPageSource, /useManagementActionQueue\(\)/);
  assert.match(equipmentPageSource, /readinessSummary=\{readinessQuery\.data\?\.summary\}/);
  assert.match(equipmentPageSource, /actionSummary=\{actionQueueQuery\.data\?\.summary\}/);
  assert.match(equipmentServiceSource, /getReadiness: \(\): Promise<FleetReadinessResponse> =>\s*api\.get<FleetReadinessResponse>\('\/api\/equipment\/readiness'\)/);
  assert.match(equipmentServiceSource, /getManagementActionQueue: \(\): Promise<ManagementActionQueueResponse> =>\s*api\.get<ManagementActionQueueResponse>\('\/api\/management\/action-queue'\)/);
  assert.match(equipmentHookSource, /useEquipmentReadiness/);
  assert.match(equipmentHookSource, /useManagementActionQueue/);
  assert.match(equipmentHookSource, /refetchOnWindowFocus: false/);
});

test('equipment header renders requested actions and compact filters', () => {
  assert.match(equipmentPageSource, /Управление парком, статусами, локациями и готовностью к аренде/);
  assert.match(equipmentPageSource, /Глобальный поиск по технике/);
  assert.match(equipmentPageSource, /Добавить технику/);
  assert.doesNotMatch(equipmentPageSource, /Импорт/);
  assert.doesNotMatch(equipmentPageSource, /Экспорт/);
  assert.match(equipmentFiltersSource, /data-testid="equipment-filter-panel"/);
  assert.match(equipmentFiltersSource, /Модель, S\/N, инв\. №/);
  assert.match(equipmentFiltersSource, /Статус техники/);
  assert.match(equipmentFiltersSource, /Тип техники/);
  assert.match(equipmentFiltersSource, /Собственник/);
  assert.match(equipmentFiltersSource, /Локация/);
  assert.match(equipmentFiltersSource, /GSM: все/);
  assert.match(equipmentFiltersSource, /Приоритет/);
  assert.match(equipmentFiltersSource, /Ещё/);
  assert.match(equipmentFiltersSource, /Сбросить/);
});

test('equipment page filters by GSM and priority without backend changes', () => {
  assert.match(equipmentPageSource, /const \[gsmFilter, setGsmFilter\]/);
  assert.match(equipmentPageSource, /const \[priorityFilter, setPriorityFilter\]/);
  assert.match(equipmentPageSource, /matchesGsm/);
  assert.match(equipmentPageSource, /matchesPriority/);
  assert.match(equipmentPageSource, /onGsmFilterChange=\{setGsmFilter\}/);
  assert.match(equipmentPageSource, /onPriorityFilterChange=\{setPriorityFilter\}/);
  assert.doesNotMatch(equipmentServiceSource, /gsmFilter|priorityFilter/);
});

test('equipment registry uses table plus inline detail panel and mobile cards', () => {
  assert.match(equipmentPageSource, /lg:grid-cols-\[minmax\(0,1fr\)_360px\]/);
  assert.match(equipmentTableSource, /data-testid="equipment-registry-table"/);
  assert.match(equipmentTableSource, /min-w-\[1040px\]/);
  assert.match(equipmentTableSource, /Инв\. №/);
  assert.match(equipmentTableSource, /S\/N/);
  assert.match(equipmentQuickViewSource, /data-testid="equipment-detail-panel"/);
  assert.match(equipmentQuickViewSource, /data-testid="equipment-detail-empty"/);
  assert.match(equipmentQuickViewSource, /Выберите технику из списка/);
  assert.match(equipmentPageSource, /mode="inline"/);
  assert.match(equipmentMobileSource, /onSelectEquipment\(equipment\)/);
  assert.match(equipmentPageSource, /selectedEquipmentId=\{selectedEquipmentId\}/);
});

test('equipment page no longer renders heavy readiness and management sections in main flow', () => {
  const pageStart = equipmentPageSource.indexOf('export default function Equipment');
  const renderStart = equipmentPageSource.indexOf('return (', pageStart);
  const renderSource = equipmentPageSource.slice(renderStart);

  assert.doesNotMatch(renderSource, /<FleetReadinessSection/);
  assert.doesNotMatch(renderSource, /<ManagementActionQueueSection/);
  assert.doesNotMatch(renderSource, /data-testid="fleet-readiness-section"/);
  assert.doesNotMatch(renderSource, /data-testid="management-action-queue-section"/);
  assert.doesNotMatch(renderSource, /Очередь управленческих действий/);
});
