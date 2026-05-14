import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const servicePageSource = readFileSync(new URL('../src/app/pages/Service.tsx', import.meta.url), 'utf8');
const plannerSource = readFileSync(new URL('../src/app/components/service/ServiceDayPlanBoard.tsx', import.meta.url), 'utf8');

test('service tab exposes planner naming instead of day plan wording', () => {
  const dayPlanTabStart = servicePageSource.indexOf('<TabsTrigger\n              value="day-plan"');
  assert.ok(dayPlanTabStart > 0, 'day-plan tab exists');
  const dayPlanTabSource = servicePageSource.slice(dayPlanTabStart, servicePageSource.indexOf('</TabsTrigger>', dayPlanTabStart));

  assert.match(dayPlanTabSource, /Планировщик/);
  assert.doesNotMatch(dayPlanTabSource, /План дня/);
  assert.match(plannerSource, /Планировщик сервиса/);
  assert.match(plannerSource, /Дата планировщика/);
});

test('service planner keeps only mine hidden for non-mechanics and forced for mechanic roles', () => {
  assert.match(plannerSource, /const isPersonalMechanicView = isMineDefault\(user\?\.role\) && !canManageDayPlan/);
  assert.match(plannerSource, /isPersonalMechanicView\s*\?\s*\[\{ value: 'mine' as DayPlanFilter, label: 'Только мои' \}, \.\.\.FILTERS\]\s*:\s*FILTERS/);
  assert.match(plannerSource, /const onlyMine = filter === 'mine' \|\| isPersonalMechanicView/);
});

test('service planner exposes required KPIs and assignment via existing service ticket fields', () => {
  for (const label of ['Заявок на день', 'Без механика', 'Просроченные', 'Ожидание запчастей', 'Готово к закрытию']) {
    assert.match(plannerSource, new RegExp(label));
  }

  assert.match(plannerSource, /useUpdateServiceTicket/);
  assert.match(plannerSource, /assignedMechanicId/);
  assert.match(plannerSource, /assignedMechanicName/);
  assert.match(plannerSource, /assignedTo/);
  assert.match(plannerSource, /mechanicId/);
  assert.match(plannerSource, /assignedUserId/);
  assert.match(plannerSource, /aria-label=\{`Назначить механика для заявки \$\{task\.id\}`\}/);
});
