import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settingsSource = readFileSync(new URL('../src/app/pages/Settings.tsx', import.meta.url), 'utf8');

function diagnosticsSource() {
  const start = settingsSource.indexOf('function DataIntegrityDiagnosticsSection(');
  const end = settingsSource.indexOf('function SystemDataBackupSection(');
  assert.ok(start > -1, 'DataIntegrityDiagnosticsSection must exist');
  assert.ok(end > start, 'DataIntegrityDiagnosticsSection must be before SystemDataBackupSection');
  return settingsSource.slice(start, end);
}

test('admin data tab contains read-only data diagnostics block', () => {
  const source = diagnosticsSource();
  assert.match(settingsSource, /type AdminModalKey = 'details' \| 'roles' \| 'permissions' \| 'system-settings' \| 'activity'/);
  assert.match(settingsSource, /type AdminDetailTab = 'users' \| 'menu' \| 'configuration' \| 'reference' \| 'notifications' \| 'data' \| 'diagnostics' \| 'system-control'/);
  assert.match(settingsSource, /const openDetailSection = \(tab: AdminDetailTab\) => \{\s+setActiveTab\(tab\);\s+setActiveModal\('details'\);\s+\}/);
  assert.match(settingsSource, /id: 'data',\s+title: 'Коллекции данных',[\s\S]+onClick: \(\) => openDetailSection\('data'\)/);
  assert.match(settingsSource, /data: \{\s+title: 'Данные системы',\s+description: 'Read-only диагностика, резервные копии и осторожные операции с системными коллекциями\.'/);
  assert.match(settingsSource, /<AdminDashboardModal/);
  assert.match(settingsSource, /<TabsContent value="data">/);
  assert.match(settingsSource, /<DataIntegrityDiagnosticsSection isActive=\{activeTab === 'data'\} \/>/);
  assert.match(source, /data-testid="data-integrity-diagnostics"/);
  assert.match(source, /\/api\/admin\/data-integrity-diagnostics/);
  assert.match(source, /enabled: isActive/);
  assert.match(source, /Обновить/);
  assert.match(source, /Загрузка\.\.\./);
  assert.doesNotMatch(settingsSource, /admin-detail-sections/);
  assert.doesNotMatch(settingsSource, /scrollIntoView/);
  assert.doesNotMatch(settingsSource, /href="#/);
});

test('admin activity modal uses real audit endpoint and honest empty and error states', () => {
  assert.match(settingsSource, /const openActivity = \(\) => \{\s+setActiveModal\('activity'\);\s+\}/);
  assert.match(settingsSource, /activeModal === 'activity' \? \(\s+<AuditLogSection \/>/);
  assert.match(settingsSource, /\/api\/admin\/audit-logs\?\$\{params\.toString\(\)\}/);
  assert.match(settingsSource, /Журнал действий недоступен:/);
  assert.match(settingsSource, /История активности пока не подключена или записей по выбранным фильтрам нет\. После подключения аудита здесь будут действия пользователей\./);
});

test('data diagnostics UI renders summary, domains, warnings, and access errors', () => {
  const source = settingsSource;
  for (const label of [
    'Диагностика данных',
    'Диагностика показывает возможные проблемы качества данных. Она ничего не исправляет и не изменяет данные.',
    'Перед возвратом сотрудников в систему рекомендуется разобрать BLOCKER и HIGH.',
    'BLOCKER',
    'HIGH',
    'MEDIUM',
    'LOW',
    'Техника',
    'Аренды / Планировщик',
    'Сервис',
    'Доставка',
    'Финансы',
    'Документы',
    'Пользователи и бот',
    'Справочники',
    'Сессия истекла или вход не выполнен',
    'Недостаточно прав',
  ]) {
    assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('data diagnostics examples are collapsed and sanitized', () => {
  const source = diagnosticsSource();
  assert.match(source, /Показать примеры/);
  assert.match(source, /openExamples\.has\(issueKey\)/);
  assert.match(source, /safeDataIntegrityExample/);
  assert.match(source, /\.slice\(0, 20\)/);
  assert.match(settingsSource, /id: example\.id/);
  assert.match(settingsSource, /entity: example\.entity/);
  assert.match(settingsSource, /label: example\.label/);
  assert.match(settingsSource, /status: example\.status/);
  assert.match(settingsSource, /relatedId: example\.relatedId/);
  assert.doesNotMatch(source, /raw record|passwordHash|DATABASE_URL|webhookSecret|raw env/i);
});

test('data diagnostics block does not add write or repair actions', () => {
  const source = diagnosticsSource();
  assert.doesNotMatch(source, /api\.(post|patch|put|del)\(/);
  assert.doesNotMatch(source, /Исправить|Очистить|Применить|repair|apply|fix/i);
});
