import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const releaseSmokeSource = readFileSync(new URL('../e2e/helpers/releaseSmoke.ts', import.meta.url), 'utf8');

test('production release smoke checks app.disabled before authenticated smoke', () => {
  assert.match(releaseSmokeSource, /type VersionInfo = \{/);
  assert.match(releaseSmokeSource, /normalizedConfig\.environmentName === 'production' && versionJson\?\.app\?\.disabled === true/);
  assert.match(releaseSmokeSource, /directConservedLoginSmoke/);
  assert.match(releaseSmokeSource, /directLoginSmoke\(normalizedConfig\)/);
});

test('conserved release smoke requires login 503 and maintenance UI', () => {
  assert.match(releaseSmokeSource, /conserved login should be blocked with HTTP 503/);
  assert.match(releaseSmokeSource, /toBe\(503\)/);
  assert.match(releaseSmokeSource, /expectMaintenanceUiVisible/);
  assert.match(releaseSmokeSource, /Система временно отключена\|Работа приложения приостановлена\|conserved\|maintenance\|временно отключена/);
  assert.match(releaseSmokeSource, /Production is conserved: login HTTP 503 is expected\./);
});
