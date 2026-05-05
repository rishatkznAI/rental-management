import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serviceDetailSource = readFileSync(new URL('../src/app/pages/ServiceDetail.tsx', import.meta.url), 'utf8');

test('ServiceDetail normalizes admin role aliases before applying closed-ticket edit override', () => {
  assert.match(serviceDetailSource, /import \{ normalizeUserRole \} from '\.\.\/lib\/userStorage'/);
  assert.match(serviceDetailSource, /user\?\.normalizedRole[\s\S]*user\?\.role[\s\S]*user\?\.rawRole/);
  assert.match(serviceDetailSource, /some\(role => normalizeUserRole\(role\) === 'Администратор'\)/);
  assert.doesNotMatch(serviceDetailSource, /\(user\?\.normalizedRole \|\| user\?\.role\) === 'Администратор'/);
  assert.match(serviceDetailSource, /const canEditTicketFields = canEdit && \(ticket\.status !== 'closed' \|\| isAdmin\)/);
});

test('ServiceDetail keeps repair work and part mutation controls admin-only', () => {
  assert.match(serviceDetailSource, /const canManageRepairItems = isAdmin && canEditTicketFields/);
  assert.match(serviceDetailSource, /if \(!ticket \|\| !canManageRepairItems \|\| !selectedWorkId\) return/);
  assert.match(serviceDetailSource, /if \(!ticket \|\| !canManageRepairItems \|\| !selectedPartId\) return/);
  assert.match(serviceDetailSource, /hasWorkScenario: canManageRepairItems && workCatalog\.length > 0/);
  assert.match(serviceDetailSource, /hasPartScenario: canManageRepairItems && sparePartsCatalog\.length > 0/);
  assert.match(serviceDetailSource, /\{canManageRepairItems \? \(/);
  assert.doesNotMatch(serviceDetailSource, /canManageRepairItems && scenarioIsRepair/);
  assert.doesNotMatch(serviceDetailSource, /scenarioIsRepair && repairResult\.worksPerformed\.length > 0/);
  assert.doesNotMatch(serviceDetailSource, /scenarioIsRepair && repairResult\.partsUsed\.length > 0/);
});
