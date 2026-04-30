import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const permissionsSource = readFileSync(new URL('../src/app/lib/permissions.ts', import.meta.url), 'utf8');
const userStorageSource = readFileSync(new URL('../src/app/lib/userStorage.ts', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/app/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
const equipmentPageSource = readFileSync(new URL('../src/app/pages/Equipment.tsx', import.meta.url), 'utf8');
const servicePageSource = readFileSync(new URL('../src/app/pages/Service.tsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../src/app/lib/api.ts', import.meta.url), 'utf8');
const salesPageSource = readFileSync(new URL('../src/app/pages/Sales.tsx', import.meta.url), 'utf8');

function warrantyPermissionBlock() {
  const match = permissionsSource.match(/\[WARRANTY_MECHANIC_ROLE\]:\s*\{(?<body>[\s\S]*?)\n\s*\},/);
  assert.ok(match?.groups?.body, 'warranty mechanic permission block must exist');
  return match.groups.body;
}

test('frontend warranty mechanic menu grants only working sections', () => {
  const block = warrantyPermissionBlock();

  for (const section of ['equipment', 'sales', 'rentals', 'service']) {
    assert.match(block, new RegExp(`\\b${section}:\\s+`), `${section} must be visible for warranty mechanic`);
  }

  for (const section of ['payments', 'finance', 'reports', 'admin_panel', 'profile_settings']) {
    assert.doesNotMatch(block, new RegExp(`\\b${section}:\\s+`), `${section} must not be granted to warranty mechanic`);
  }

  assert.match(sidebarSource, /section:\s*'equipment'/);
  assert.match(sidebarSource, /section:\s*'service'/);
  assert.match(sidebarSource, /section:\s*'sales'/);
});

test('frontend normalizes warranty mechanic role aliases', () => {
  assert.match(userStorageSource, /WARRANTY_MECHANIC_ROLE_ALIASES/);
  assert.match(userStorageSource, /'warranty_mechanic'/);
  assert.match(userStorageSource, /'mechanic_warranty'/);
  assert.match(userStorageSource, /'warrantyMechanic'/);
  assert.match(userStorageSource, /'mechanicWarranty'/);
  assert.match(userStorageSource, /'механик по гарантии'/);
  assert.match(userStorageSource, /normalizeRoleKey/);
  assert.match(permissionsSource, /normalizeUserRole\(user\?\.role\)/);
});

test('frontend does not mask equipment and service API failures as empty warranty data', () => {
  assert.match(equipmentPageSource, /const equipmentQuery = useEquipmentList\(\)/);
  assert.match(equipmentPageSource, /equipmentQuery\.data \?\? \[\]/);
  assert.match(equipmentPageSource, /GET \/api\/access-diagnostics/);
  assert.match(equipmentPageSource, /\/api\/equipment/);

  assert.match(servicePageSource, /const ticketsQuery = useServiceTicketsList\(\)/);
  assert.match(servicePageSource, /ticketsQuery\.data \?\? \[\]/);
  assert.match(servicePageSource, /GET \/api\/service/);
  assert.match(servicePageSource, /GET \/api\/access-diagnostics/);

  assert.match(salesPageSource, /const equipmentQuery = useEquipmentList\(\)/);
  assert.match(salesPageSource, /equipmentQuery\.data \?\? \[\]/);
  assert.match(salesPageSource, /GET \/api\/equipment/);
});

test('frontend verifies session before clearing auth after data endpoint 401', () => {
  assert.match(apiSource, /function shouldClearTokenForUnauthorized\(path: string\)/);
  assert.match(apiSource, /normalizedPath\.startsWith\('\/api\/auth\/'\)/);
  assert.match(apiSource, /let unauthorizedSessionCheck: Promise<boolean> \| null = null/);
  assert.match(apiSource, /async function checkSessionAfterDataUnauthorized\(\): Promise<boolean>/);
  assert.match(apiSource, /fetch\(`\$\{API_BASE_URL\}\/api\/auth\/me`/);
  assert.match(apiSource, /if \(res\.status === 401\) \{[\s\S]*dispatchUnauthorized\(\);[\s\S]*return false;/);
  assert.match(apiSource, /if \(shouldClearTokenForUnauthorized\(path\)\) \{[\s\S]*dispatchUnauthorized\(\);[\s\S]*\} else \{[\s\S]*await checkSessionAfterDataUnauthorized\(\);/);
  assert.match(apiSource, /unauthorizedSessionCheck = null/);
});
