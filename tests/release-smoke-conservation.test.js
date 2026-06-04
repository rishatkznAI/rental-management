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
  assert.match(releaseSmokeSource, /hasMaintenanceUiText\(bodyText: string, appDisabledMessage\?: string\)/);
  assert.match(releaseSmokeSource, /bodyText\.includes\(expectedMessage\)/);
  assert.match(releaseSmokeSource, /Система временно отключена\|Работа приложения приостановлена/);
  assert.match(releaseSmokeSource, /техническ\(\?:ое\|ого\|ом\|ий\|ая\)\\s\+обслуживан/);
  assert.match(releaseSmokeSource, /временно\\s\+\(\?:закрыто\|отключена\|недоступн\)/);
  assert.match(releaseSmokeSource, /conserved\|maintenance/);
  assert.match(releaseSmokeSource, /Production is conserved: login HTTP 503 is expected, authenticated smoke skipped\./);
});

test('conserved release smoke opens root with commit cache bust and waits for UI render', () => {
  assert.match(releaseSmokeSource, /function conservedAppUrl\(frontendUrl: string, expectedCommit\?: string\)/);
  assert.match(releaseSmokeSource, /url\.searchParams\.set\('v', shortCommit\(expectedCommit\) \|\| String\(Date\.now\(\)\)\)/);
  assert.match(releaseSmokeSource, /page\.goto\(conservedAppUrl\(normalizedConfig\.frontendUrl, normalizedConfig\.expectedCommit\)/);
  assert.doesNotMatch(releaseSmokeSource, /page\.goto\(appUrl\(normalizedConfig\.frontendUrl, '\/login'\)[\s\S]*frontend conservation/);
  assert.match(releaseSmokeSource, /expect\.poll\(/);
  assert.match(releaseSmokeSource, /hasMaintenanceUiText\(await visibleBodyText\(page\), appDisabledMessage\)/);
});

test('conserved release smoke fails when maintenance UI is missing', () => {
  assert.match(releaseSmokeSource, /conserved frontend should render maintenance\/conservation UI/);
  assert.match(releaseSmokeSource, /frontend did not render maintenance\/conservation state/);
  assert.match(releaseSmokeSource, /failWithPageDiagnostics\(/);
});

test('non-conserved release smoke keeps strict login behavior', () => {
  assert.match(releaseSmokeSource, /const directLogin = await directLoginSmoke\(normalizedConfig\)/);
  assert.match(releaseSmokeSource, /if \(!login\.ok\(\)\) \{/);
  assert.match(releaseSmokeSource, /direct login smoke failed/);
  assert.match(releaseSmokeSource, /expectAdminLoginSucceeded/);
});

test('non-conserved production smoke proves dashboard executive cockpit and screenshots', () => {
  for (const marker of [
    'expectExecutiveCockpitVisible',
    'dashboard-executive-summary',
    'dashboard-executive-cockpit',
    'dashboard-kpi-overdue-debt',
    'dashboard-kpi-fleet-utilization',
    'dashboard-kpi-service-load',
    'dashboard-kpi-operational-load',
    'Главные сигналы сегодня',
    'Открыть планировщик',
    'Открыть сервис',
    'Динамика месяца',
    'Здоровье компании',
    'production-dashboard-cockpit-desktop.png',
    'production-dashboard-cockpit-mobile.png',
  ]) {
    assert.match(releaseSmokeSource, new RegExp(marker));
  }
  assert.match(releaseSmokeSource, /toHaveAttribute\('href', \/#\\\/planner\$\//);
  assert.match(releaseSmokeSource, /toHaveAttribute\('href', \/#\\\/service\$\//);
  assert.match(releaseSmokeSource, /captureExecutiveCockpitScreenshots\(page, normalizedConfig\.frontendUrl, testInfo\)/);
});

test('production release smoke allows backend drift only for frontend-only and deploy-tooling releases', () => {
  assert.match(releaseSmokeSource, /type ReleaseType = 'frontend-only' \| 'backend' \| 'full-stack' \| 'deploy-tooling'/);
  assert.match(releaseSmokeSource, /releaseType\?: ReleaseType \| string/);
  assert.match(releaseSmokeSource, /releaseType === 'frontend-only' \|\| releaseType === 'deploy-tooling'/);
  assert.match(releaseSmokeSource, /expectedDriftReleaseType\(details\.releaseType\)/);
  assert.match(releaseSmokeSource, /releaseType: normalizeReleaseType\(String\(config\.releaseType \|\| ''\)\)/);
  assert.match(releaseSmokeSource, /releaseType: normalizedConfig\.releaseType/);
});

test('release smoke diagnostics do not print smoke credentials or auth tokens', () => {
  const diagnosticHeader = releaseSmokeSource.match(/function diagnosticHeader[\s\S]*?\n}\n/)?.[0] || '';
  const thrownErrors = [...releaseSmokeSource.matchAll(/throw new Error\(`[\s\S]*?`\);/g)].map(match => match[0]).join('\n');
  const consoleLogs = [...releaseSmokeSource.matchAll(/console\.log\([^;]+;/g)].map(match => match[0]).join('\n');

  assert.doesNotMatch(`${diagnosticHeader}\n${thrownErrors}\n${consoleLogs}`, /adminEmail|adminPassword|config\.adminEmail|config\.adminPassword/);
  assert.doesNotMatch(releaseSmokeSource, /console\.log\([^)]*token/i);
  assert.doesNotMatch(releaseSmokeSource, /Authorization: `Bearer \$\{token\}`[\s\S]{0,160}(console|throw new Error)/);
});
