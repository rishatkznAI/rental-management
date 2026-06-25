import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { alertHasValidSource, buildCompanyHealthModel, buildOperationalLoadModel } from '../src/app/lib/dashboardCompanyHealth.js';

const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Dashboard.tsx'), 'utf8');

test('empty dashboard data does not calculate a numeric company health score', () => {
  const model = buildCompanyHealthModel({});

  assert.equal(model.score, null);
  assert.equal(model.label, 'Нет данных');
  assert.equal(model.subtitle, 'Недостаточно данных для расчёта здоровья компании');
  assert.equal(model.contourStates.every(item => item.status === 'no_data'), true);
});

test('equipment-only dashboard data is still insufficient for company health', () => {
  const model = buildCompanyHealthModel({
    equipmentCount: 4,
    utilization: 0,
  });

  assert.equal(model.score, null);
  assert.equal(model.label, 'Недостаточно данных');
  assert.deepEqual(model.availableContours, ['Техника']);
  assert.ok(model.missingContours.includes('Аренды'));
  assert.ok(model.missingContours.includes('Платежи'));
});

test('empty contours are not counted as healthy', () => {
  const model = buildCompanyHealthModel({
    equipmentCount: 3,
    rentalsCount: 2,
    utilization: 67,
  });

  assert.equal(typeof model.score, 'number');
  assert.equal(model.contourStates.find(item => item.id === 'payments')?.status, 'no_data');
  assert.equal(model.contourStates.find(item => item.id === 'service')?.stateLabel, 'Нет данных');
  assert.notEqual(model.contourStates.find(item => item.id === 'payments')?.tone, 'success');
});

test('real operational and financial data calculates a numeric company health score', () => {
  const model = buildCompanyHealthModel({
    equipmentCount: 8,
    rentalsCount: 5,
    paymentsCount: 4,
    serviceCount: 2,
    documentsCount: 3,
    deliveriesCount: 2,
    utilization: 75,
  });

  assert.equal(typeof model.score, 'number');
  assert.ok(model.score >= 80);
  assert.equal(model.label, 'Хорошо');
});

test('critical signals without source are excluded and can produce a warning', () => {
  assert.equal(alertHasValidSource({ category: 'Сервис', detail: 'Высокий приоритет', link: '/service/S-1', entity: 'S-1' }), true);
  assert.equal(alertHasValidSource({ category: 'Сервис', detail: 'Высокий приоритет', link: '/service/undefined', entity: '' }), false);

  const model = buildCompanyHealthModel({
    equipmentCount: 2,
    rentalsCount: 1,
    utilization: 50,
    invalidCriticalSignals: 1,
  });

  assert.equal(model.warning, 'Есть сигналы без полного расчёта');
});

test('dashboard source has no decorative fallback company health score', () => {
  assert.doesNotMatch(dashboardSource, /companyHealthDisplayScore\s*=\s*dashboardLooksDemoSafe[\s\S]*\?\s*68/);
  assert.doesNotMatch(dashboardSource, /companyHealthDisplayScore[\s\S]{0,120}\?\s*72/);
  assert.doesNotMatch(dashboardSource, /roleDashboardUtilizationPercent = activeEquipment > 0 \? utilization : 62/);
});

test('insufficient operational load data does not show a low management conclusion', () => {
  const model = buildOperationalLoadModel({});

  assert.equal(model.score, null);
  assert.equal(model.label, 'Недостаточно данных');
  assert.equal(model.hint, 'Индекс N/A · недостаточно данных');
  assert.notEqual(model.label, 'Низкая');
});

test('valid empty operational load can show low only when calculation base exists', () => {
  const model = buildOperationalLoadModel({
    activeEquipment: 6,
    totalRentals: 0,
    totalServiceTickets: 0,
    totalDeliveries: 0,
    totalDocuments: 0,
    totalTasks: 0,
    totalAttentionActions: 0,
    activeRentals: 0,
    openServiceTickets: 0,
    returnPressure: 0,
    deliveryPressure: 0,
    documentPressure: 0,
    taskPressure: 0,
    criticalIssues: 0,
  });

  assert.equal(model.score, 0);
  assert.equal(model.label, 'Низкая');
  assert.equal(model.hint, 'Индекс 0/100 · критично 0');
});

test('dashboard source renders N/A for uncalculated operational load index', () => {
  assert.match(dashboardSource, /operationalLoadScore === null \? 'Индекс N\/A'/);
  assert.doesNotMatch(dashboardSource, /hint: `Индекс \$\{operationalLoadScore\}\/100/);
});
