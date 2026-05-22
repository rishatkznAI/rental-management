import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const smokeSource = readFileSync(new URL('../scripts/release-targeted-smoke.mjs', import.meta.url), 'utf8');

test('targeted smoke validates current action queue execution DTO', () => {
  assert.match(smokeSource, /function executionFieldsPresent\(items\)/);
  assert.match(smokeSource, /hasOwnProperty\.call\(item, 'executionStatus'\)/);
  assert.match(smokeSource, /hasOwnProperty\.call\(item, 'executionLabel'\)/);
  assert.match(smokeSource, /hasOwnProperty\.call\(item, 'executionOverdue'\)/);
  assert.match(smokeSource, /\/api\/management\/action-queue items must expose execution fields/);
});

test('targeted smoke covers service repeat breakdowns read-only analytics', () => {
  assert.match(smokeSource, /function repeatBreakdownsShapeValid\(payload\)/);
  assert.match(smokeSource, /\/api\/service\/repeat-breakdowns/);
  assert.match(smokeSource, /returned an unexpected response shape/);
  assert.match(smokeSource, /totalRepeats/);
  assert.match(smokeSource, /byEquipment/);
  assert.doesNotMatch(smokeSource, /JSON\.stringify\(repeatBreakdowns\.json\)/);
});

test('targeted smoke allows conserved production only after public probes and blocked login', () => {
  assert.match(smokeSource, /timedJson\(apiUrl, '\/health'\)/);
  assert.match(smokeSource, /timedJson\(apiUrl, '\/health\/ready'\)/);
  assert.match(smokeSource, /timedJson\(apiUrl, '\/api\/version'\)/);
  assert.match(smokeSource, /version\.json\?\.app\?\.disabled === true/);
  assert.match(smokeSource, /args\.env === 'production' && version\.json\?\.app\?\.disabled === true/);
  assert.match(smokeSource, /login\.response\.status === 503/);
  assert.match(smokeSource, /Production is conserved: login HTTP 503 is expected\./);
  assert.match(smokeSource, /login\.response\.status === 200/);
});
