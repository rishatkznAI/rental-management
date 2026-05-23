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

test('Dashboard contains upgraded manager activity blocks', () => {
  const block = managerPlanBlockSource();
  assert.match(block, /План активности/);
  assert.match(block, /Прогресс активности/);
  assert.match(block, /Последние действия/);
  assert.match(block, /Быстро добавить активность/);
  assert.match(block, /data-testid="manager-plan-quick-add-activity"/);
  assert.match(block, /Звонок/);
  assert.match(block, /Выезд/);
  assert.match(block, /Заметка/);
});

test('Dashboard activity UI has safe empty states and no destructive controls', () => {
  const block = managerPlanBlockSource();
  assert.match(block, /Пока нет зафиксированных действий/);
  assert.match(block, /На сегодня нет критичных задач/);
  assert.doesNotMatch(block, />\\s*(Удалить|Архивировать|Списать)\\s*</);
  assert.doesNotMatch(block, /api\.(patch|put|del)\(/);
  assert.doesNotMatch(block, /password|token|cookie|secret|privateKey|authorization|hash/i);
});

test('manager activity service only exposes create activity endpoint for MVP writes', () => {
  assert.match(serviceSource, /createActivity/);
  assert.match(serviceSource, /\/api\/manager\/my-plan\/activity/);
  assert.doesNotMatch(serviceSource, /api\.(patch|put|del)\(/);
  assert.doesNotMatch(serviceSource, /password|token|cookie|secret|privateKey|authorization|hash/i);
});
