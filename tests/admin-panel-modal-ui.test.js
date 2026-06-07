import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settingsSource = readFileSync(new URL('../src/app/pages/Settings.tsx', import.meta.url), 'utf8');

test('admin dashboard opens overview sections in modals without anchor scrolling', () => {
  assert.match(settingsSource, /type AdminModalKey = 'details' \| 'roles' \| 'permissions' \| 'system-settings' \| 'activity'/);
  assert.match(settingsSource, /function AdminDashboardModal/);
  assert.match(settingsSource, /data-testid=\{`admin-kpi-\$\{card\.id\}`\}/);
  assert.match(settingsSource, /setActiveModal\('details'\)/);
  assert.match(settingsSource, /setActiveModal\('system-settings'\)/);
  assert.match(settingsSource, /setActiveModal\('activity'\)/);
  assert.doesNotMatch(settingsSource, /admin-detail-sections/);
  assert.doesNotMatch(settingsSource, /scrollIntoView/);
  assert.doesNotMatch(settingsSource, /href="#/);
});

test('system settings modal has non-empty internal tabs and no fake save', () => {
  for (const label of ['Общие настройки', 'Компания', 'Уведомления', 'Документы', 'Безопасность', 'Интеграции', 'Демо / публичные']) {
    assert.match(settingsSource, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(settingsSource, /data-testid="admin-system-settings-modal"/);
  assert.match(settingsSource, /Источник данных:/);
  assert.match(settingsSource, /Сохранение пока не подключено/);
});

test('admin activity uses real audit endpoint and honest empty state', () => {
  assert.match(settingsSource, /\/api\/admin\/audit-logs\?limit=5/);
  assert.match(settingsSource, /<AuditLogSection \/>/);
  assert.match(settingsSource, /История активности пока не подключена/);
  assert.match(settingsSource, /После подключения аудита здесь будут действия пользователей/);
  assert.doesNotMatch(settingsSource, /ADMIN_ACTIVITY_FALLBACK/);
});
