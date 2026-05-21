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
