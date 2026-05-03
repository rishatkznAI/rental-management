import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('dashboard and tasks center visible priority summaries use Russian labels', () => {
  const dashboard = fs.readFileSync(new URL('../src/app/pages/Dashboard.tsx', import.meta.url), 'utf8');
  const tasksCenter = fs.readFileSync(new URL('../src/app/pages/TasksCenter.tsx', import.meta.url), 'utf8');

  assert.match(dashboard, /taskPrioritySummaryLabel\('critical'\)/);
  assert.match(dashboard, /taskPrioritySummaryLabel\('high'\)/);
  assert.doesNotMatch(dashboard, /Critical:\s*\{/);
  assert.doesNotMatch(dashboard, /High:\s*\{/);
  assert.doesNotMatch(dashboard, /High\/Critical/);

  assert.match(tasksCenter, /taskPrioritySummaryLabel\('critical'\)/);
  assert.match(tasksCenter, /taskPrioritySummaryLabel\('high'\)/);
  assert.doesNotMatch(tasksCenter, />Critical</);
  assert.doesNotMatch(tasksCenter, />High</);
});

test('admin backup controls avoid English visible action labels', () => {
  const settings = fs.readFileSync(new URL('../src/app/pages/Settings.tsx', import.meta.url), 'utf8');

  assert.match(settings, /Скачать полную резервную копию/);
  assert.match(settings, /Экспорт JSON/);
  assert.match(settings, /Проверить без скачивания/);
  assert.doesNotMatch(settings, /Export JSON/);
  assert.doesNotMatch(settings, /Dry-run scan/);
  assert.doesNotMatch(settings, /Dry-run import/);
  assert.doesNotMatch(settings, /Failed to fetch/);
});
