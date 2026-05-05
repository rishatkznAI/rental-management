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

test('ServiceDetail keeps repair deletion admin-only and allows returned mechanic additions', () => {
  assert.match(serviceDetailSource, /const canAddRepairItems = \(isAdmin \|\| \(ticket\.status === 'needs_revision' && isAssignedMechanic\)\) && canEditTicketFields/);
  assert.match(serviceDetailSource, /const canDeleteRepairItems = isAdmin && canEditTicketFields/);
  assert.match(serviceDetailSource, /if \(!ticket \|\| !canAddRepairItems \|\| !selectedWorkId\) return/);
  assert.match(serviceDetailSource, /if \(!ticket \|\| !canAddRepairItems \|\| !selectedPartId\) return/);
  assert.match(serviceDetailSource, /if \(!ticket \|\| !canDeleteRepairItems\) return/);
  assert.match(serviceDetailSource, /hasWorkScenario: canAddRepairItems && workCatalog\.length > 0/);
  assert.match(serviceDetailSource, /hasPartScenario: canAddRepairItems && sparePartsCatalog\.length > 0/);
  assert.match(serviceDetailSource, /\{canAddRepairItems \? \(/);
  assert.doesNotMatch(serviceDetailSource, /canManageRepairItems && scenarioIsRepair/);
  assert.doesNotMatch(serviceDetailSource, /scenarioIsRepair && repairResult\.worksPerformed\.length > 0/);
  assert.doesNotMatch(serviceDetailSource, /scenarioIsRepair && repairResult\.partsUsed\.length > 0/);
});

test('ServiceDetail implements return-to-mechanic revision flow', () => {
  assert.match(serviceDetailSource, /needs_revision: 'На доработке'/);
  assert.match(serviceDetailSource, /const REVISION_CHECKLIST_OPTIONS = \[/);
  assert.match(serviceDetailSource, /const canReturnForRevision = canEdit && \['ready', 'closed'\]\.includes\(ticket\.status\)/);
  assert.match(serviceDetailSource, /serviceTicketsService\.returnForRevision/);
  assert.match(serviceDetailSource, /serviceTicketsService\.resolveRevision/);
  assert.match(serviceDetailSource, /Вернуть механику/);
  assert.match(serviceDetailSource, /Отправить повторно/);
});
