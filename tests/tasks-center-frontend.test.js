import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskSummary,
  groupTasksByDueDate,
  normalizeTask,
  taskPriorityLabel,
  taskPrioritySummaryLabel,
} from '../src/app/lib/tasksCenter.js';

test('tasks center helper groups due dates and formats legacy values safely', () => {
  const tasks = [
    { id: '1', title: 'Просрочено', priority: 'critical', dueDate: '2026-05-01', section: 'rentals' },
    { id: '2', title: 'Сегодня', priority: 'high', dueDate: '2026-05-02', section: 'documents' },
    { id: '3', title: 'Завтра', priority: 'medium', dueDate: '2026-05-03', section: 'service' },
    { id: '4', title: null, priority: 'bad', dueDate: 'not-a-date', section: null },
  ];

  const groups = groupTasksByDueDate(tasks, '2026-05-02');
  assert.equal(groups.find(group => group.id === 'overdue').tasks.length, 1);
  assert.equal(groups.find(group => group.id === 'today').tasks.length, 1);
  assert.equal(groups.find(group => group.id === 'tomorrow').tasks.length, 1);
  assert.equal(groups.find(group => group.id === 'no_due').tasks.length, 1);

  const normalized = normalizeTask(tasks[3]);
  assert.equal(normalized.title, 'Задача');
  assert.equal(normalized.priority, 'medium');
  assert.equal(normalized.section, 'system');
  assert.doesNotMatch(JSON.stringify(groups), /NaN|undefined|null|\[object Object\]/);
});

test('tasks center summary counts priority and due buckets', () => {
  const summary = buildTaskSummary([
    { id: '1', title: 'A', priority: 'critical', dueDate: '2026-05-01' },
    { id: '2', title: 'B', priority: 'high', dueDate: '2026-05-02' },
    { id: '3', title: 'C', priority: 'high', dueDate: '2026-05-04' },
  ], '2026-05-02');

  assert.deepEqual(summary, {
    total: 3,
    critical: 1,
    high: 2,
    overdue: 1,
    today: 1,
  });
});

test('tasks center priority labels are localized for visible UI', () => {
  assert.equal(taskPriorityLabel('critical'), 'Критично');
  assert.equal(taskPriorityLabel('high'), 'Высокий');
  assert.equal(taskPriorityLabel('medium'), 'Средний');
  assert.equal(taskPriorityLabel('low'), 'Низкий');
  assert.equal(taskPrioritySummaryLabel('critical'), 'Критичные');
  assert.equal(taskPrioritySummaryLabel('high'), 'Высокий приоритет');
});
