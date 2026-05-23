import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findUnsafePayloadViolations, hasUnsafeText } from '../scripts/release-targeted-smoke.mjs';

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

test('targeted smoke allows safe system control center diagnostic key names', () => {
  const payload = {
    dataRisks: {
      undefinedLikeCount: 0,
      nullLikeCount: 0,
      objectObjectLikeCount: 0,
    },
  };

  assert.equal(hasUnsafeText(payload), false);
  assert.deepEqual(findUnsafePayloadViolations(payload), []);
});

test('targeted smoke rejects unsafe placeholder string values', () => {
  assert.equal(hasUnsafeText({ status: 'undefined' }), true);
  assert.equal(findUnsafePayloadViolations({ status: 'undefined' })[0]?.type, 'placeholder-value');
  assert.equal(hasUnsafeText({ status: 'null' }), true);
  assert.equal(findUnsafePayloadViolations({ status: 'null' })[0]?.type, 'placeholder-value');
  assert.equal(hasUnsafeText({ status: '[object Object]' }), true);
  assert.equal(findUnsafePayloadViolations({ status: '[object Object]' })[0]?.type, 'placeholder-value');
});

test('targeted smoke rejects sensitive response keys and raw database URLs', () => {
  const tokenViolations = findUnsafePayloadViolations({ runtime: { token: 'abc' } });
  assert.equal(tokenViolations.some(item => item.path === '$.runtime.token' && item.type === 'sensitive-key'), true);

  const databaseUrlViolations = findUnsafePayloadViolations({ storage: { databaseUrl: 'postgres://example.invalid/db' } });
  assert.equal(databaseUrlViolations.some(item => item.path === '$.storage.databaseUrl' && item.type === 'sensitive-key'), true);
  assert.equal(databaseUrlViolations.some(item => item.path === '$.storage.databaseUrl' && item.type === 'sensitive-value'), true);
});

test('targeted smoke accepts normal system control center response shape with diagnostic counters', () => {
  const payload = {
    status: 'warning',
    version: {
      backendCommit: 'f94d83eef373',
      backendBuildTime: '2026-05-23T03:39:40.896Z',
      nodeEnv: 'production',
      frontendCommitFromRequestOrConfig: 'unknown',
      versionMatch: 'unknown',
    },
    runtime: {
      appDisabled: false,
      botDisabled: true,
      gsmDisabled: true,
      environment: 'production',
    },
    storage: {
      dbSafeLabel: 'sqlite',
      dbPathSafeLabel: 'data/app.sqlite',
      volumeSafeSignal: 'available',
      walPresent: true,
      dbSizeBytes: 123456,
    },
    health: {
      api: 'ok',
      ready: 'unknown',
      lastCheckedAt: '2026-05-23T03:39:40.896Z',
    },
    dataRisks: {
      undefinedLikeCount: 0,
      nullLikeCount: 0,
      objectObjectLikeCount: 0,
      brokenEquipmentLinks: 0,
      brokenRentalLinks: 0,
      brokenServiceLinks: 0,
    },
    serviceQuality: {
      totalRepeats: 0,
      critical: 0,
      high: 0,
      affectedEquipment: 0,
      affectedMechanics: 0,
      topScenario: 'Нет повторов',
    },
    recommendations: [
      {
        level: 'info',
        title: 'Страница read-only',
        description: 'Раздел не пишет данные и не меняет runtime flags.',
        action: 'Для изменений использовать утверждённые процедуры.',
      },
    ],
  };

  assert.equal(hasUnsafeText(payload), false);
  assert.deepEqual(findUnsafePayloadViolations(payload), []);
});
