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

test('admin user modal select fields keep readable light and dark theme styles', () => {
  const settings = fs.readFileSync(new URL('../src/app/pages/Settings.tsx', import.meta.url), 'utf8');

  assert.match(settings, /const adminUserSelectClass =/);
  assert.match(settings, /bg-white/);
  assert.match(settings, /text-gray-900/);
  assert.match(settings, /border-gray-300/);
  assert.match(settings, /placeholder:text-gray-500/);
  assert.match(settings, /focus-visible:border-\[--color-primary\]/);
  assert.match(settings, /dark:bg-gray-800/);
  assert.match(settings, /dark:text-white/);
  assert.match(settings, /dark:border-gray-600/);
  assert.match(settings, /<SelectTrigger className=\{adminUserSelectClass\}><SelectValue placeholder="Выберите роль">\{form\.role\}<\/SelectValue><\/SelectTrigger>/);
  assert.match(settings, /<SelectTrigger className=\{adminUserSelectClass\}><SelectValue placeholder="Выберите статус">\{form\.status\}<\/SelectValue><\/SelectTrigger>/);
  assert.match(settings, /<SelectContent className="border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white">/);
});
