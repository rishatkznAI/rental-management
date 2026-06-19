import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settingsSource = readFileSync(new URL('../src/app/pages/Settings.tsx', import.meta.url), 'utf8');

function sourceBetween(start, end) {
  const startIndex = settingsSource.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  const endIndex = settingsSource.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return settingsSource.slice(startIndex, endIndex);
}

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
  const generalSettingsTabSource = sourceBetween('<TabsContent value="general"', '<TabsContent value="company"');
  const diagnosticsTabSource = sourceBetween('<TabsContent value="diagnostics">', '<TabsContent value="system-control">');
  const interfaceStatusSource = sourceBetween('function InterfaceStatusDiagnosticsCard', 'function readSettingValue');

  assert.match(settingsSource, /data-testid="admin-system-settings-modal"/);
  assert.doesNotMatch(generalSettingsTabSource, /<SettingsStatus/);
  assert.doesNotMatch(generalSettingsTabSource, /Включить уведомления/);
  assert.doesNotMatch(generalSettingsTabSource, /Показывать демо-данные/);
  assert.doesNotMatch(generalSettingsTabSource, /Компактный режим интерфейса/);
  assert.match(diagnosticsTabSource, /<ProductionDiagnosticsSection appSettings=\{appSettings\} \/>/);
  assert.match(settingsSource, /<InterfaceStatusDiagnosticsCard appSettings=\{appSettings\} \/>/);
  assert.match(settingsSource, /Статусы интерфейса/);
  assert.match(interfaceStatusSource, /<SettingsStatus source=\{source\} statuses=\{statuses\} \/>/);
  assert.match(settingsSource, /Включить уведомления/);
  assert.match(settingsSource, /Показывать демо-данные/);
  assert.match(settingsSource, /Компактный режим интерфейса/);
  assert.match(settingsSource, /Источник данных:/);
  assert.match(settingsSource, /Сохранение не подключено/);
  assert.match(settingsSource, /Режим только просмотра/);
  assert.match(settingsSource, /Изменение параметров будет доступно после подключения безопасного API сохранения\./);
  assert.match(settingsSource, /Без сохранения/);
  assert.doesNotMatch(settingsSource, /Управляет поведением интерфейса, демо-режимом и системными уведомлениями\./);
  assert.doesNotMatch(settingsSource, /function ReadonlyToggle/);
  assert.doesNotMatch(settingsSource, /<input\s+readOnly/);
});

test('admin activity uses real audit endpoint and honest empty state', () => {
  assert.match(settingsSource, /\/api\/admin\/audit-logs\?limit=5/);
  assert.match(settingsSource, /<AuditLogSection \/>/);
  assert.match(settingsSource, /История активности пока не подключена/);
  assert.match(settingsSource, /После подключения аудита здесь будут действия пользователей/);
  assert.doesNotMatch(settingsSource, /ADMIN_ACTIVITY_FALLBACK/);
});
