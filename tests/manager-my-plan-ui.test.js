import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Dashboard.tsx'), 'utf8');
const serviceSource = fs.readFileSync(path.join(process.cwd(), 'src/app/services/manager-my-plan.service.ts'), 'utf8');

function managerPlanBlockSource() {
  const blockStart = dashboardSource.indexOf('function ManagerMyPlanBlock');
  const blockEnd = dashboardSource.indexOf('const DASHBOARD_CHART_COLORS');
  assert.ok(blockStart >= 0 && blockEnd > blockStart);
  return dashboardSource.slice(blockStart, blockEnd);
}

test('Dashboard contains read-only manager my plan block', () => {
  assert.match(dashboardSource, /Мой план/);
  assert.match(dashboardSource, /managerMyPlanService\.get/);
  assert.match(dashboardSource, /data-testid="manager-my-plan"/);
  assert.match(dashboardSource, /Загрузка парка/);
  assert.match(dashboardSource, /Активные аренды/);
  assert.match(dashboardSource, /Возвраты сегодня\/завтра/);
  assert.match(dashboardSource, /Просроченные возвраты/);
  assert.match(dashboardSource, /Документы/);
});

test('Dashboard shows low-utilization activity targets and safe empty state', () => {
  const block = managerPlanBlockSource();
  assert.match(block, /40 звонков\/день/);
  assert.match(block, /2 выезда\/неделю/);
  assert.match(block, /Нет данных для рабочего плана/);
  assert.match(block, /На сегодня нет критичных задач/);
  assert.doesNotMatch(block, /\{[^}]*undefined[^}]*\}/);
  assert.doesNotMatch(block, /\[object Object\]/);
});

test('Manager my plan UI does not add destructive controls or secret-like labels', () => {
  const block = managerPlanBlockSource();
  assert.doesNotMatch(block, />\\s*(Создать|Изменить|Удалить|Сохранить|Архивировать|Списать)\\s*</);
  assert.doesNotMatch(block, /api\.(post|patch|put|del)\(/);
  assert.doesNotMatch(block, /password|token|cookie|secret|privateKey|authorization|hash/i);
  assert.doesNotMatch(serviceSource, /api\.(post|patch|put|del)\(/);
});
