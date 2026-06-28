import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settingsSource = readFileSync(new URL('../src/app/pages/Settings.tsx', import.meta.url), 'utf8');

function systemControlSource() {
  const start = settingsSource.indexOf('function SystemControlCenterSection()');
  const end = settingsSource.indexOf('function ProductionDiagnosticsSection');
  assert.ok(start > -1, 'SystemControlCenterSection must exist');
  assert.ok(end > start, 'SystemControlCenterSection must be before ProductionDiagnosticsSection');
  return settingsSource.slice(start, end);
}

test('Admin settings page opens Контроль системы inside the detail modal', () => {
  assert.match(settingsSource, /type AdminModalKey = 'details' \| 'roles' \| 'permissions' \| 'system-settings' \| 'activity'/);
  assert.match(settingsSource, /type AdminDetailTab = 'users' \| 'menu' \| 'configuration' \| 'reference' \| 'notifications' \| 'data' \| 'diagnostics' \| 'system-control'/);
  assert.match(settingsSource, /const openDetailSection = \(tab: AdminDetailTab\) => \{\s+setActiveTab\(tab\);\s+setActiveModal\('details'\);\s+\}/);
  assert.match(settingsSource, /<AdminDashboardModal/);
  assert.match(settingsSource, /<button type="button" onClick=\{\(\) => openDetailSection\('diagnostics'\)\} className="hover:text-primary">Поддержка<\/button>/);
  assert.match(settingsSource, /<button type="button" onClick=\{\(\) => openDetailSection\('system-control'\)\} className="hover:text-primary">О системе<\/button>/);
  assert.match(settingsSource, /diagnostics: \{\s+title: 'Диагностика'/);
  assert.match(settingsSource, /'system-control': \{\s+title: 'Контроль системы'/);
  assert.match(settingsSource, /<TabsContent value="diagnostics">\s+<ProductionDiagnosticsSection appSettings=\{appSettings\} \/>/);
  assert.match(settingsSource, /<TabsContent value="system-control">\s+<SystemControlCenterSection \/>/);
  assert.doesNotMatch(settingsSource, /admin-detail-sections/);
  assert.doesNotMatch(settingsSource, /scrollIntoView/);
  assert.doesNotMatch(settingsSource, /href="#/);
});

test('System Control Center UI contains safe Russian labels', () => {
  const source = systemControlSource();
  for (const label of [
    'Контроль системы',
    'Версии',
    'Release type',
    'Статус версий',
    'Режим работы',
    'Хранилище',
    'Риски данных',
    'Качество ремонта',
    'Рекомендации',
    'Production открыт',
    'Раздел ничего не исправляет автоматически',
  ]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(settingsSource, /Frontend обновлён отдельно от backend/);
  assert.match(settingsSource, /Backend и frontend собраны из разных несовместимых release/);
});

test('System Control Center UI does not render secret-like labels', () => {
  const source = systemControlSource();
  assert.doesNotMatch(source, /password|token|secret|cookie|private key|raw env|authorization header|DATABASE_URL/i);
});

test('System Control Center UI classifies frontend-only drift without hard RISK', () => {
  assert.match(settingsSource, /FRONTEND_DRIFT_RELEASE_TYPES/);
  assert.match(settingsSource, /frontend-only', 'deploy-tooling', 'frontend-deploy-tooling/);
  assert.match(settingsSource, /<Badge variant="warning">WARN<\/Badge>/);
  assert.match(settingsSource, /<Badge variant="danger">RISK<\/Badge>/);
  assert.match(settingsSource, /x-frontend-commit/);
  assert.match(settingsSource, /x-frontend-build-time/);
  assert.match(settingsSource, /x-frontend-release-type/);
  assert.match(settingsSource, /releaseBuildOrder !== 'backend-newer'/);
});

test('System Control Center UI is read-only and has no destructive buttons', () => {
  const source = systemControlSource();
  assert.match(source, /Обновить/);
  assert.doesNotMatch(source, /Удалить|Перезапустить|Restart|Redeploy|Deploy|Delete|Сбросить|Очистить/);
  assert.doesNotMatch(source, /api\.(post|patch|put|del)\(/);
});
