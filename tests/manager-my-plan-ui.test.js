import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Dashboard.tsx'), 'utf8');
const serviceSource = fs.readFileSync(path.join(process.cwd(), 'src/app/services/manager-my-plan.service.ts'), 'utf8');

test('Dashboard keeps the manager my plan query read-only while V2 owns the rendered UI', () => {
  assert.match(dashboardSource, /managerMyPlanService\.get/);
  assert.match(dashboardSource, /enabled: canViewManagerMyPlan/);
  assert.doesNotMatch(dashboardSource, /data-testid="manager-my-plan"|function ManagerMyPlanBlock/);
  assert.match(dashboardSource, /return <ExecutiveCockpitV2 \{\.\.\.executiveCockpitProps\} \/>/);
});

test('Dashboard does not render stale manager-plan placeholders', () => {
  assert.doesNotMatch(dashboardSource, /Нет данных для рабочего плана|На сегодня нет критичных задач/);
  assert.doesNotMatch(dashboardSource, /\[object Object\]/);
});

test('Manager my plan integration does not add destructive controls or secret-like labels', () => {
  assert.doesNotMatch(dashboardSource, /managerMyPlanService\.(?:createActivity|patch|put|del)/);
  assert.doesNotMatch(dashboardSource, /api\.(patch|put|del)\(/);
  assert.doesNotMatch(dashboardSource, /password|token|cookie|secret|privateKey|authorization|hash/i);
  assert.doesNotMatch(serviceSource, /api\.(patch|put|del)\(/);
});
