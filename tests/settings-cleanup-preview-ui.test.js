import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const settingsPath = path.join(process.cwd(), 'src/app/pages/Settings.tsx');
const settingsSource = fs.readFileSync(settingsPath, 'utf8');
const previewSectionStart = settingsSource.indexOf('function GanttRentalCleanupPreviewSection');
const previewSectionEnd = settingsSource.indexOf('function ProductionDiagnosticsSection');
const previewSection = settingsSource.slice(previewSectionStart, previewSectionEnd);

test('admin diagnostics UI includes read-only gantt rentals cleanup preview block', () => {
  assert.ok(previewSectionStart > 0);
  assert.match(previewSection, /Preview очистки gantt_rentals/);
  assert.match(settingsSource, /api\.get<GanttRentalCleanupPreview>\('\/api\/admin\/diagnostics\/gantt-rentals-cleanup-preview'\)/);
  assert.match(settingsSource, /<GanttRentalCleanupPreviewSection query=\{ganttCleanupPreviewQuery\} \/>/);
});

test('cleanup preview UI shows KPI counts and row preview fields', () => {
  assert.match(previewSection, /Кандидаты на архив/);
  assert.match(previewSection, /Дубли \/ неоднозначные/);
  assert.match(previewSection, /Заблокированы/);
  assert.match(previewSection, /Ручная проверка/);
  assert.match(previewSection, /previewAction/);
  assert.match(previewSection, /previewRisk/);
  assert.match(previewSection, /previewReason/);
  assert.match(previewSection, /blockedByPayments/);
  assert.match(previewSection, /blockedByDeliveries/);
});

test('cleanup preview UI does not expose archive repair or apply actions', () => {
  assert.doesNotMatch(previewSection, /onClick=\{\(\) => .*archive/i);
  assert.doesNotMatch(previewSection, /onClick=\{\(\) => .*repair/i);
  assert.doesNotMatch(previewSection, /apply:\s*true/);
  assert.doesNotMatch(previewSection, /Починить связь|Архивировать|Удалить/);
  assert.match(previewSection, /Apply, delete, archive и repair здесь не реализованы/);
});
