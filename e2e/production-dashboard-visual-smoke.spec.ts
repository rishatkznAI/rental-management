import { expect, request as playwrightRequest, test, type Page, type TestInfo } from '@playwright/test';
import { requiredEnv } from './helpers/releaseSmoke';
import { backendCommitGateResult } from '../scripts/release-preflight.mjs';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

type UiIssue = { type: string; url: string; status?: number; text?: string };
type Theme = 'light' | 'dark';
type BuildInfo = { commit?: string; commitFull?: string; releaseType?: string };

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, theme: 'light' as Theme },
  { name: 'laptop', width: 1280, height: 800, theme: 'light' as Theme },
  { name: 'tablet', width: 1024, height: 768, theme: 'light' as Theme },
  { name: 'mobile', width: 390, height: 844, theme: 'light' as Theme },
  { name: 'desktop-dark', width: 1440, height: 900, theme: 'dark' as Theme },
  { name: 'mobile-dark', width: 390, height: 844, theme: 'dark' as Theme },
] as const;

function productionAppUrl(frontendUrl: string) {
  return `${frontendUrl.replace(/\/$/, '')}/?debugVersion=1&_smoke=${Date.now()}#/`;
}

function commitsMatch(actual = '', expected = '') {
  const left = String(actual || '').trim();
  const right = String(expected || '').trim();
  return Boolean(left && right && (left.startsWith(right) || right.startsWith(left)));
}

function shortCommit(value = '') {
  return String(value || '').trim().slice(0, 12);
}

function normalizeDashboardSmokeReleaseType(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'auto') return '';
  return normalized;
}

function resolveDashboardSmokeReleaseType(input: {
  envReleaseType?: string;
  frontendReleaseType?: string;
  backendReleaseType?: string;
}) {
  return normalizeDashboardSmokeReleaseType(input.envReleaseType)
    || normalizeDashboardSmokeReleaseType(input.frontendReleaseType)
    || normalizeDashboardSmokeReleaseType(input.backendReleaseType)
    || 'full-stack';
}

function logStage(stage: string, details: Record<string, unknown>) {
  console.info(JSON.stringify({ stage, ...details }));
}

function assertBackendCommitMatchesPolicy(input: {
  backendBuild: BuildInfo | null;
  expectedCommit: string;
  releaseType: string;
  label: string;
}) {
  const gate = backendCommitGateResult({
    env: 'production',
    releaseType: input.releaseType,
    backendBuild: input.backendBuild || {},
    expectedCommit: input.expectedCommit,
  });
  if (gate.status === 'warn') {
    logStage('backendCommitDrift', {
      label: input.label,
      releaseType: input.releaseType,
      expectedCommit: shortCommit(input.expectedCommit),
      backendCommit: gate.backendCommit,
      status: 'warn',
    });
    return gate;
  }
  expect(gate.status, `${input.label}: ${gate.message}`).toBe('pass');
  return gate;
}

function sanitize(text = '') {
  return text
    .replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [token]')
    .slice(0, 800);
}

async function installReadOnlyDiagnostics(page: Page, apiUrl: string, issues: UiIssue[]) {
  await page.route('**/api/**', async route => {
    const method = route.request().method().toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return route.continue();
    issues.push({ type: 'blocked-write', url: route.request().url(), text: method });
    return route.abort('blockedbyclient');
  });
  page.on('console', message => {
    if (message.type() !== 'error' || /ResizeObserver loop|favicon/i.test(message.text())) return;
    issues.push({ type: 'console.error', url: page.url(), text: sanitize(message.text()) });
  });
  page.on('pageerror', error => issues.push({ type: 'pageerror', url: page.url(), text: sanitize(error.stack || error.message) }));
  page.on('response', response => {
    const status = response.status();
    const url = response.url();
    if (status >= 500 || (/\/api\//.test(url) && [401, 403].includes(status) && !url.endsWith('/api/auth/me'))) {
      issues.push({ type: 'http', url, status });
    }
  });
  page.on('requestfailed', request => {
    const failure = request.failure()?.errorText || '';
    if (failure === 'net::ERR_ABORTED' || /favicon|\.map($|\?)/.test(request.url())) return;
    issues.push({ type: 'requestfailed', url: request.url(), text: sanitize(failure) });
  });
}

async function setTheme(page: Page, theme: Theme) {
  await page.evaluate(nextTheme => {
    window.localStorage.setItem('theme', nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  }, theme);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
}

async function dashboardSnapshot(page: Page) {
  return page.evaluate(() => {
    const rect = (testId: string) => {
      const element = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = Array.from(document.body.querySelectorAll<HTMLElement>('*')).filter(element => {
      const style = getComputedStyle(element);
      if (element.closest('.sr-only') || style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed') return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.right > viewportWidth + 1;
    }).slice(0, 10).map(element => ({ tag: element.tagName, testId: element.dataset.testid || '', right: element.getBoundingClientRect().right }));
    const touchTargets = Array.from(document.querySelectorAll<HTMLElement>('.dashboard-card-action, .dashboard-attention-action')).map(element => {
      const box = element.getBoundingClientRect();
      return { text: (element.textContent || '').trim(), width: box.width, height: box.height };
    });
    const headers = Array.from(document.querySelectorAll('[data-testid="dashboard-month-dynamics-data"] th[scope="col"]')).map(node => (node.textContent || '').trim());
    const cells = Array.from(document.querySelectorAll('[data-testid="dashboard-month-dynamics-data"] tbody td')).map(node => (node.textContent || '').trim());
    return {
      overflowX: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - viewportWidth,
      offenders,
      legacySelectors: document.querySelectorAll('[data-testid^="dashboard-legacy-"]').length,
      chartPresent: document.querySelectorAll('[data-testid="dashboard-month-dynamics"] .recharts-responsive-container').length > 0,
      tableRows: document.querySelectorAll('[data-testid="dashboard-month-dynamics-data"] tbody tr').length,
      headers,
      cells,
      touchTargets,
      attention: rect('dashboard-key-signals'),
      kpis: rect('dashboard-top-cockpit'),
      month: rect('dashboard-month-dynamics'),
      money: rect('dashboard-receivables-aging'),
      fleet: rect('dashboard-fleet-utilization'),
      service: rect('dashboard-service-executive'),
      health: rect('dashboard-company-health'),
    };
  });
}

async function verifyDashboard(page: Page, testInfo: TestInfo, viewport: typeof VIEWPORTS[number]) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 20_000 });
  await setTheme(page, viewport.theme);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 20_000 });

  for (const testId of [
    'dashboard-executive-v2',
    'dashboard-top-cockpit',
    'dashboard-key-signals',
    'dashboard-month-dynamics',
    'dashboard-month-dynamics-data',
    'dashboard-company-health',
    'dashboard-fleet-utilization',
    'dashboard-receivables-aging',
    'dashboard-service-executive',
  ]) {
    await expect(page.getByTestId(testId), `${viewport.name}: ${testId}`).toBeAttached();
  }

  const snapshot = await dashboardSnapshot(page);
  expect(snapshot.overflowX, JSON.stringify(snapshot)).toBeLessThanOrEqual(1);
  expect(snapshot.offenders, JSON.stringify(snapshot)).toEqual([]);
  expect(snapshot.legacySelectors).toBe(0);
  expect(snapshot.tableRows).toBeGreaterThan(0);
  expect(snapshot.headers).toEqual(['Дата', 'Начисления (факт)', 'Поступления (факт)', 'Прогноз начислений']);
  expect(snapshot.cells.some(value => /рублей|Нет данных/.test(value)), JSON.stringify(snapshot.cells.slice(0, 8))).toBeTruthy();
  if (viewport.name.startsWith('mobile')) {
    expect(snapshot.attention?.top || 0).toBeLessThan(snapshot.kpis?.top || 0);
    expect(snapshot.kpis?.top || 0).toBeLessThan(snapshot.month?.top || 0);
    expect(snapshot.money?.top || 0).toBeLessThan(snapshot.fleet?.top || 0);
    expect(snapshot.fleet?.top || 0).toBeLessThan(snapshot.service?.top || 0);
    expect(snapshot.service?.top || 0).toBeLessThan(snapshot.health?.top || 0);
    expect(snapshot.touchTargets.length).toBeGreaterThan(0);
    expect(snapshot.touchTargets.filter(target => target.height < 44), JSON.stringify(snapshot.touchTargets)).toEqual([]);
  } else if (viewport.width >= 1280) {
    expect(snapshot.kpis?.top || 0).toBeLessThan(snapshot.attention?.top || 0);
  }

  await page.screenshot({
    path: testInfo.outputPath(`production-dashboard-${viewport.name}.png`),
    fullPage: true,
    timeout: 20_000,
  });
}

test('production authenticated Dashboard V2 visual, accessibility, and mobile smoke', async ({ page }, testInfo) => {
  test.setTimeout(240_000);

  const apiUrl = requiredEnv('PRODUCTION_API_URL', 'production dashboard visual smoke').replace(/\/$/, '');
  const frontendUrl = requiredEnv('PRODUCTION_FRONTEND_URL', 'production dashboard visual smoke').replace(/\/$/, '');
  const expectedCommit = String(process.env.EXPECTED_RELEASE_COMMIT || '').trim();
  const issues: UiIssue[] = [];
  await installReadOnlyDiagnostics(page, apiUrl, issues);

  const api = await playwrightRequest.newContext({ baseURL: apiUrl });
  let token = '';
  let backendBuild: BuildInfo | null = null;
  try {
    const versionResponse = await api.get('/api/version', { timeout: 15_000 });
    expect(versionResponse.ok()).toBeTruthy();
    const version = await versionResponse.json() as { ok?: boolean; build?: BuildInfo; app?: { disabled?: boolean } };
    expect(version.ok).toBe(true);
    expect(version.app?.disabled).toBe(false);
    backendBuild = version.build || null;
    const loginResponse = await api.post('/api/auth/login', {
      data: {
        email: requiredEnv('PRODUCTION_ADMIN_EMAIL', 'production dashboard visual smoke'),
        password: requiredEnv('PRODUCTION_ADMIN_PASSWORD', 'production dashboard visual smoke'),
      },
      timeout: 20_000,
    });
    expect(loginResponse.ok()).toBeTruthy();
    token = ((await loginResponse.json()) as { token?: string }).token || '';
    expect(token).toBeTruthy();
  } finally {
    await api.dispose();
  }

  await page.addInitScript(authToken => window.localStorage.setItem('app_auth_token', authToken), token);
  for (const viewport of VIEWPORTS) {
    await page.goto(productionAppUrl(frontendUrl), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.__SKYTECH_BUILD_INFO__?.commit), null, { timeout: 15_000 });
    const marker = await page.evaluate(() => window.__SKYTECH_BUILD_INFO__ || null);
    expect(marker?.apiBaseUrl).toBe(apiUrl);
    const releaseType = resolveDashboardSmokeReleaseType({
      envReleaseType: String(process.env.RELEASE_TYPE || ''),
      frontendReleaseType: marker?.releaseType,
      backendReleaseType: backendBuild?.releaseType,
    });
    if (expectedCommit) {
      expect(commitsMatch(marker?.commit || '', expectedCommit)).toBeTruthy();
      assertBackendCommitMatchesPolicy({
        backendBuild,
        expectedCommit,
        releaseType,
        label: 'backend expected release commit',
      });
    }
    if (marker?.commit && backendBuild?.commit) {
      assertBackendCommitMatchesPolicy({
        backendBuild,
        expectedCommit: marker.commit,
        releaseType,
        label: 'frontend/backend commit match',
      });
    }
    await verifyDashboard(page, testInfo, viewport);
  }

  expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
});
