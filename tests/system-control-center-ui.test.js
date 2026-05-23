import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settingsSource = readFileSync(new URL('../src/app/pages/Settings.tsx', import.meta.url), 'utf8');

function systemControlSource() {
  const start = settingsSource.indexOf('function SystemControlCenterSection()');
  const end = settingsSource.indexOf('function ProductionDiagnosticsSection()');
  assert.ok(start > -1, 'SystemControlCenterSection must exist');
  assert.ok(end > start, 'SystemControlCenterSection must be before ProductionDiagnosticsSection');
  return settingsSource.slice(start, end);
}

test('Admin settings page contains Контроль системы tab', () => {
  assert.match(settingsSource, /value: 'system-control', label: 'Контроль системы'/);
  assert.match(settingsSource, /<SystemControlCenterSection \/>/);
});

test('System Control Center UI contains safe Russian labels', () => {
  const source = systemControlSource();
  for (const label of [
    'Контроль системы',
    'Версии',
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
});

test('System Control Center UI does not render secret-like labels', () => {
  const source = systemControlSource();
  assert.doesNotMatch(source, /password|token|secret|cookie|private key|raw env|authorization header|DATABASE_URL/i);
});

test('System Control Center UI is read-only and has no destructive buttons', () => {
  const source = systemControlSource();
  assert.match(source, /Обновить/);
  assert.doesNotMatch(source, /Удалить|Перезапустить|Restart|Redeploy|Deploy|Delete|Сбросить|Очистить/);
  assert.doesNotMatch(source, /api\.(post|patch|put|del)\(/);
});
