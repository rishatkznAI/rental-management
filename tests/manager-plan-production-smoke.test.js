import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertManagerPlanResponseShape,
  assertNoUnsafeManagerPlanPayload,
  findUnsafeManagerPlanPayloadViolations,
  hasUnsafeVisibleManagerPlanText,
  managerPlanSmokeSummary,
} from '../scripts/manager-plan-smoke-checks.mjs';

function safePayload(overrides = {}) {
  return {
    summary: {
      managerName: 'Smoke User',
      fleetUtilizationPercent: 82,
      planStatus: 'done',
      activeRentals: 12,
      rentalsEndingSoon: 1,
      overdueReturns: 0,
      debtAmount: 0,
      documentsMissing: 0,
      clientsWithoutActivity: 0,
      todayCallsDone: 0,
      todayCallsTarget: 0,
      weekSiteVisitsDone: 0,
      weekSiteVisitsTarget: 0,
      activityProgressStatus: 'optional',
      nextRecommendedAction: 'Проверить задачи дня.',
      completionPercent: 100,
      ...overrides.summary,
    },
    activityTarget: {
      required: false,
      reason: 'Парк загружен',
      dailyCallsTarget: 0,
      weeklySiteVisitsTarget: 0,
      message: 'Парк загружен, фокус на удержании.',
      todayCallsDone: 0,
      todayCallsTarget: 0,
      weekSiteVisitsDone: 0,
      weekSiteVisitsTarget: 0,
      activityProgressStatus: 'optional',
      nextRecommendedAction: 'Проверить задачи дня.',
      completionPercent: 100,
      ...overrides.activityTarget,
    },
    recentActivity: overrides.recentActivity || [],
    tasks: overrides.tasks || [],
    rentals: overrides.rentals || { endingToday: [], endingTomorrow: [], overdue: [], active: [] },
    money: overrides.money || { debtors: [], totalDebt: 0 },
    documents: overrides.documents || { missingContract: [], missingUpd: [], unsigned: [] },
    clients: overrides.clients || { withoutRecentActivity: [] },
  };
}

test('safe manager plan smoke payload passes shape and unsafe scans', () => {
  const payload = safePayload();
  assert.doesNotThrow(() => assertManagerPlanResponseShape(payload));
  assert.doesNotThrow(() => assertNoUnsafeManagerPlanPayload(payload));
  assert.deepEqual(managerPlanSmokeSummary(payload), {
    planStatus: 'done',
    utilizationKnown: true,
    tasks: 0,
  });
});

test('low utilization payload requires 40 calls and 2 site visits', () => {
  const payload = safePayload({
    summary: {
      fleetUtilizationPercent: 64,
      planStatus: 'needs_activity',
      todayCallsTarget: 40,
      weekSiteVisitsTarget: 2,
      activityProgressStatus: 'not_started',
      completionPercent: 0,
    },
    activityTarget: {
      required: true,
      dailyCallsTarget: 40,
      weeklySiteVisitsTarget: 2,
      todayCallsTarget: 40,
      weekSiteVisitsTarget: 2,
      activityProgressStatus: 'not_started',
      completionPercent: 0,
    },
  });
  assert.doesNotThrow(() => assertManagerPlanResponseShape(payload));
});

test('unknown utilization may use safe null without failing shape', () => {
  const payload = safePayload({
    summary: { fleetUtilizationPercent: null, planStatus: 'unknown' },
    activityTarget: { required: false, message: 'Недостаточно данных для расчета загрузки.' },
  });
  assert.doesNotThrow(() => assertManagerPlanResponseShape(payload));
});

test('secret-like keys fail unsafe scan', () => {
  const payload = safePayload({ clients: { withoutRecentActivity: [], token: 'redacted-looking-but-still-unsafe' } });
  assert.throws(() => assertNoUnsafeManagerPlanPayload(payload), /unsafe key/);
});

test('raw undefined/null/object placeholder text fails unsafe scan', () => {
  const payload = safePayload({ tasks: [{ title: 'undefined', description: 'ok' }] });
  assert.match(findUnsafeManagerPlanPayloadViolations(payload).join('\n'), /unsafe string/);
  assert.equal(hasUnsafeVisibleManagerPlanText('Задача: [object Object]'), true);
});
