import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Dashboard.tsx'), 'utf8');
const serviceSource = fs.readFileSync(path.join(process.cwd(), 'src/app/services/manager-my-plan.service.ts'), 'utf8');

test('Dashboard preserves the manager activity read request without mounting retired blocks', () => {
  assert.match(dashboardSource, /queryKey: \['manager-my-plan', user\?\.id\]/);
  assert.match(dashboardSource, /queryFn: managerMyPlanService\.get/);
  assert.match(dashboardSource, /enabled: canViewManagerMyPlan/);
  assert.doesNotMatch(dashboardSource, /function ManagerMyPlanBlock|manager-plan-quick-add-activity/);
  assert.match(dashboardSource, /return <ExecutiveCockpitV2 \{\.\.\.executiveCockpitProps\} \/>/);
});

test('Dashboard manager activity integration remains read-only', () => {
  assert.doesNotMatch(dashboardSource, /managerMyPlanService\.(?:createActivity|patch|put|del)/);
  assert.doesNotMatch(dashboardSource, /api\.(patch|put|del)\(/);
  assert.doesNotMatch(dashboardSource, /password|token|cookie|secret|privateKey|authorization|hash/i);
});

test('manager activity service only exposes create activity endpoint for MVP writes', () => {
  assert.match(serviceSource, /createActivity/);
  assert.match(serviceSource, /\/api\/manager\/my-plan\/activity/);
  assert.doesNotMatch(serviceSource, /api\.(patch|put|del)\(/);
  assert.doesNotMatch(serviceSource, /password|token|cookie|secret|privateKey|authorization|hash/i);
});
