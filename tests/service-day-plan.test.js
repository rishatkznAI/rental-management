import test from 'node:test';
import assert from 'node:assert/strict';

import { buildServiceDayPlan, displayDateKey, localDateKey } from '../src/app/lib/serviceDayPlan.js';

test('service day plan includes planned due overdue unassigned and ready tickets', () => {
  const plan = buildServiceDayPlan({
    date: '2026-05-10',
    mechanics: [
      { id: 'M-1', name: 'Петров', status: 'active' },
      { id: 'M-2', name: 'Иванов', status: 'active' },
    ],
    tickets: [
      { id: 'S-planned', status: 'new', priority: 'medium', plannedDate: '2026-05-10', assignedMechanicId: 'M-1', reason: 'План' },
      { id: 'S-due', status: 'new', priority: 'high', dueDate: '2026-05-10', assignedMechanicId: 'M-2', reason: 'Срок' },
      { id: 'S-overdue', status: 'in_progress', priority: 'critical', deadline: '2026-05-09', assignedMechanicId: 'M-1', reason: 'Просрочка' },
      { id: 'S-unassigned', status: 'new', priority: 'low', reason: 'Назначить' },
      { id: 'S-waiting', status: 'waiting_parts', priority: 'medium', assignedMechanicId: 'M-2', reason: 'Запчасти' },
      { id: 'S-ready', status: 'ready', priority: 'medium', assignedMechanicId: 'M-1', reason: 'Закрыть' },
      { id: 'S-created-only', status: 'new', priority: 'medium', createdAt: '2026-05-10', assignedMechanicId: 'M-2', reason: 'Только создана' },
      { id: 'S-closed', status: 'closed', priority: 'critical', plannedDate: '2026-05-10', assignedMechanicId: 'M-1', reason: 'Закрыта' },
    ],
  });

  assert.deepEqual(plan.tasks.map(task => task.id).sort(), [
    'S-due',
    'S-overdue',
    'S-planned',
    'S-ready',
    'S-unassigned',
    'S-waiting',
  ]);
  assert.equal(plan.metrics.total, 6);
  assert.equal(plan.metrics.scheduledToday, 2);
  assert.equal(plan.metrics.overdue, 1);
  assert.equal(plan.metrics.unassigned, 1);
  assert.equal(plan.metrics.waitingParts, 1);
  assert.equal(plan.metrics.readyToClose, 1);
  assert.equal(plan.problems.waitingParts[0].id, 'S-waiting');
  assert.equal(plan.problems.readyToClose[0].id, 'S-ready');
});

test('service day planner uses planned date first and selected date changes visible scheduled tickets', () => {
  const mechanics = [{ id: 'M-1', name: 'Петров', status: 'active' }];
  const tickets = [
    { id: 'S-today', status: 'new', priority: 'medium', plannedDate: '2026-05-10', assignedMechanicId: 'M-1', reason: 'Сегодня' },
    { id: 'S-other-day', status: 'new', priority: 'medium', plannedDate: '2026-05-11', assignedMechanicId: 'M-1', reason: 'Завтра' },
    { id: 'S-scheduled', status: 'new', priority: 'medium', scheduledDate: '2026-05-11', assignedMechanicId: 'M-1', reason: 'Запланирована' },
    { id: 'S-closed-today', status: 'closed', priority: 'critical', plannedDate: '2026-05-11', assignedMechanicId: 'M-1', reason: 'Архив' },
  ];

  const firstDay = buildServiceDayPlan({ date: '2026-05-10', mechanics, tickets });
  const secondDay = buildServiceDayPlan({ date: '2026-05-11', mechanics, tickets });

  assert.deepEqual(firstDay.tasks.map(task => task.id), ['S-today']);
  assert.deepEqual(secondDay.tasks.map(task => task.id).sort(), ['S-other-day', 'S-scheduled', 'S-today']);
  assert.equal(secondDay.metrics.scheduledToday, 2);
  assert.equal(secondDay.metrics.overdue, 1);
  assert.equal(secondDay.tasks.some(task => task.id === 'S-closed-today'), false);
});

test('service day plan groups tasks by mechanics and marks free and overloaded mechanics', () => {
  const tickets = Array.from({ length: 5 }, (_, index) => ({
    id: `S-${index + 1}`,
    status: 'new',
    priority: index === 0 ? 'critical' : 'medium',
    plannedDate: '2026-05-10',
    assignedMechanicId: 'M-1',
    reason: 'План',
  }));
  const plan = buildServiceDayPlan({
    date: '2026-05-10',
    mechanics: [
      { id: 'M-1', name: 'Петров', status: 'active' },
      { id: 'M-free', name: 'Свободный', status: 'active' },
    ],
    tickets,
  });

  const busy = plan.mechanics.find(mechanic => mechanic.id === 'M-1');
  const free = plan.mechanics.find(mechanic => mechanic.id === 'M-free');
  assert.equal(busy?.tasksCount, 5);
  assert.equal(busy?.workloadStatus, 'overloaded');
  assert.equal(free?.tasksCount, 0);
  assert.equal(free?.workloadStatus, 'free');
  assert.equal(plan.metrics.freeMechanics, 1);
  assert.equal(plan.metrics.overloadedMechanics, 1);
});

test('service day plan onlyMine limits mechanics and problem blocks to current mechanic', () => {
  const plan = buildServiceDayPlan({
    date: '2026-05-10',
    currentUser: { userId: 'U-mechanic', userName: 'Петров' },
    onlyMine: true,
    mechanics: [
      { id: 'M-1', userId: 'U-mechanic', name: 'Петров', status: 'active' },
      { id: 'M-2', name: 'Иванов', status: 'active' },
    ],
    tickets: [
      { id: 'S-own', status: 'new', priority: 'medium', plannedDate: '2026-05-10', assignedMechanicId: 'M-1', reason: 'Своя' },
      { id: 'S-other', status: 'new', priority: 'medium', plannedDate: '2026-05-10', assignedMechanicId: 'M-2', reason: 'Чужая' },
      { id: 'S-unassigned', status: 'new', priority: 'medium', reason: 'Без механика' },
    ],
  });

  assert.deepEqual(plan.tasks.map(task => task.id), ['S-own']);
  assert.deepEqual(plan.mechanics.map(mechanic => mechanic.id), ['M-1']);
  assert.equal(plan.problems.unassigned.length, 0);
});

test('service day plan formats browser-local date keys without UTC rollover', () => {
  const local = new Date(2026, 4, 10, 1, 15, 0);
  assert.equal(localDateKey(local), '2026-05-10');
  assert.equal(displayDateKey('2026-05-10'), '10.05.2026');
});
