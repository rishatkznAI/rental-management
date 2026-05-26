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
  assert.match(settingsSource, /value: 'data',\s+label: 'Данные системы'/);
  assert.match(settingsSource, /<DataIntegrityDiagnosticsSection isActive=\{activeTab === 'data'\} \/>/);
  assert.match(source, /data-testid="data-integrity-diagnostics"/);
  assert.match(source, /\/api\/admin\/data-integrity-diagnostics/);
  assert.match(source, /enabled: isActive/);
  assert.match(source, /Обновить/);
  assert.match(source, /Загрузка\.\.\./);
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
