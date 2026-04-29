import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const permissionsSource = readFileSync(new URL('../src/app/lib/permissions.ts', import.meta.url), 'utf8');
const userStorageSource = readFileSync(new URL('../src/app/lib/userStorage.ts', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/app/components/layout/Sidebar.tsx', import.meta.url), 'utf8');

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
  assert.match(permissionsSource, /normalizeUserRole\(user\?\.role\)/);
});
