import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settingsSource = readFileSync(new URL('../src/app/pages/Settings.tsx', import.meta.url), 'utf8');
const permissionsSource = readFileSync(new URL('../src/app/lib/permissions.ts', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/app/components/layout/Sidebar.tsx', import.meta.url), 'utf8');

function rolePermissionBlock(role) {
  const match = permissionsSource.match(new RegExp(`'${role}':\\s*\\{(?<body>[\\s\\S]*?)\\n\\s*\\},`));
  assert.ok(match?.groups?.body, `${role} permission block must exist`);
  return match.groups.body;
}

test('admin can see System Control Center in the admin panel', () => {
  assert.match(rolePermissionBlock('Администратор'), /admin_panel:\s+ALL/);
  assert.match(sidebarSource, /Панель администратора/);
  assert.match(settingsSource, /Контроль системы/);
  assert.match(settingsSource, /value:\s*'system-control'/);
  assert.match(settingsSource, /<SystemControlCenterSection \/>/);
});

test('non-admin roles do not get the admin panel menu route', () => {
  for (const role of ['Офис-менеджер', 'Менеджер по аренде', 'Менеджер по продажам', 'Перевозчик', 'Инвестор']) {
    assert.doesNotMatch(rolePermissionBlock(role), /\badmin_panel:\s+/, `${role} must not see admin panel`);
  }
});

test('System Control Center renders app, bot, GSM cards and unknown storage warning', () => {
  assert.match(settingsSource, /APP_DISABLED/);
  assert.match(settingsSource, /MAX bot/);
  assert.match(settingsSource, /GSM/);
  assert.match(settingsSource, /Проверьте Railway volume и DB_PATH вручную/);
  assert.match(settingsSource, /Режим работы/);
  assert.match(settingsSource, /Хранилище/);
  assert.match(settingsSource, /Рекомендации/);
});

test('System Control Center has explicit forbidden and backend error states', () => {
  assert.match(settingsSource, /data-testid="system-control-forbidden"/);
  assert.match(settingsSource, /Недостаточно прав/);
  assert.match(settingsSource, /data-testid="system-control-error"/);
  assert.match(settingsSource, /Не удалось получить статус системы/);
});
