import { expect, request as playwrightRequest, test, type Page, type TestInfo } from '@playwright/test';
import { requiredEnv } from './helpers/releaseSmoke';
import { backendCommitGateResult } from '../scripts/release-preflight.mjs';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

type ViewportCase = {
  name: 'desktop' | 'tablet' | 'mobile';
  viewport: { width: number; height: number };
};

type UiIssue = {
  type: string;
  stage: string;
  url?: string;
  status?: number;
  text?: string;
};

type DashboardLayoutSnapshot = {
  dashboardOpened: boolean;
  blockVisible: Record<string, boolean>;
  overlaps: Array<{ a: string; b: string; x: number; y: number }>;
  screenBelowAppHeader: boolean;
  cockpitBelowCommandHeader: boolean;
  healthVisible: boolean;
  healthWidth: number;
  healthWidthShare: number;
  healthSvgCount: number;
  compactVisible: boolean;
  compactCards: number;
  overflowX: number;
  overflowOffenders: Array<{
    tag: string;
    testId: string;
    className: string;
    left: number;
    right: number;
    width: number;
  }>;
};

type BuildInfo = {
  commit?: string;
  commitFull?: string;
  releaseType?: string;
};

const VIEWPORT_CASES: ViewportCase[] = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'tablet', viewport: { width: 768, height: 1024 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } },
];

function productionAppUrl(frontendUrl: string, route = '/') {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return `${frontendUrl.replace(/\/$/, '')}/?debugVersion=1&_smoke=${Date.now()}#${normalizedRoute}`;
}

function shortCommit(value = '') {
  return String(value || '').trim().slice(0, 12);
}

function commitsMatch(actual = '', expected = '') {
  const left = String(actual || '').trim();
  const right = String(expected || '').trim();
  return Boolean(left && right && (left.startsWith(right) || right.startsWith(left)));
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

function sanitize(text = '', limit = 800) {
  return text
    .replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [token]')
    .slice(0, limit);
}

function logStage(stage: string, fields: Record<string, unknown> = {}) {
  console.log('[production-dashboard-visual-smoke] stage', JSON.stringify({ stage, ...fields }));
}

async function withStage<T>(
  state: { currentStage: string },
  stage: string,
  action: () => Promise<T>,
): Promise<T> {
  state.currentStage = stage;
  logStage(stage, { status: 'start' });
  try {
    const result = await action();
    logStage(stage, { status: 'done' });
    return result;
  } catch (error) {
    logStage(stage, {
      status: 'failed',
      message: error instanceof Error ? sanitize(error.message) : sanitize(String(error)),
    });
    throw error;
  }
}

async function installReadOnlyGuard(page: Page, apiUrl: string, issues: UiIssue[], getStage: () => string) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      await route.continue();
      return;
    }
    issues.push({ type: 'blocked-write', stage: getStage(), url: request.url(), text: method });
    await route.abort('blockedbyclient');
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/ResizeObserver loop|Download the React DevTools|favicon/i.test(text)) return;
    issues.push({ type: 'console.error', stage: getStage(), url: page.url(), text: sanitize(text) });
  });

  page.on('pageerror', (error) => {
    issues.push({ type: 'pageerror', stage: getStage(), url: page.url(), text: sanitize(error.stack || error.message) });
  });

  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    const path = new URL(url).pathname;
    const isApi = url.startsWith(apiUrl) || /\/api\//.test(url);
    if (status >= 500) {
      issues.push({ type: 'http-5xx', stage: getStage(), url, status });
      return;
    }
    if (isApi && [401, 403].includes(status) && path !== '/api/auth/me') {
      issues.push({ type: 'authz-response', stage: getStage(), url, status });
    }
  });

  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || '';
    if (failure === 'net::ERR_ABORTED' || /favicon|\.map($|\?)/.test(request.url())) return;
    issues.push({ type: 'requestfailed', stage: getStage(), url: request.url(), text: sanitize(failure) });
  });
}

async function dashboardLayoutSnapshot(page: Page): Promise<DashboardLayoutSnapshot> {
  return await page.evaluate(() => {
    const isVisible = (element: Element | null) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };

    const rectOf = (element: Element | null) => {
      if (!element) return { width: 0, height: 0 };
      const rect = element.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const fullRectOf = (element: Element | null) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
      };
    };

    const viewportWidth = document.documentElement.clientWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const offenders = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.right > viewportWidth + 1;
      })
      .slice(0, 8)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          testId: element.getAttribute('data-testid') || '',
          className: String(element.className || '').slice(0, 120),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      });

    const health = document.querySelector('[data-testid="dashboard-company-health"]');
    const board = document.querySelector('[data-testid="dashboard-command-board"]');
    const compact = health?.querySelector('[data-testid="dashboard-company-health-compact"]') ?? null;
    const healthRect = rectOf(health ?? null);
    const boardRect = rectOf(board);
    const compactCards = compact?.querySelectorAll('a.rentcore-command-card').length || 0;
    const blockSelectors = {
      keySignals: '[data-testid="dashboard-key-signals"]',
      tasks: '[data-testid="dashboard-tasks"]',
      monthDynamics: '[data-testid="dashboard-month-dynamics"]',
      fleet: '[data-testid="dashboard-fleet-utilization"]',
      receivables: '[data-testid="dashboard-receivables-aging"]',
      health: '[data-testid="dashboard-company-health"]',
    };
    const blockRects = Object.fromEntries(
      Object.entries(blockSelectors).map(([key, selector]) => [key, fullRectOf(document.querySelector(selector))]),
    ) as Record<string, ReturnType<typeof fullRectOf>>;
    const blockNames = Object.keys(blockSelectors);
    const overlaps: DashboardLayoutSnapshot['overlaps'] = [];
    for (let index = 0; index < blockNames.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < blockNames.length; nextIndex += 1) {
        const aName = blockNames[index];
        const bName = blockNames[nextIndex];
        const a = blockRects[aName];
        const b = blockRects[bName];
        if (!a || !b) continue;
        const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        if (x > 1 && y > 1) overlaps.push({ a: aName, b: bName, x, y });
      }
    }
    const appHeader = fullRectOf(document.querySelector('body > div header'));
    const commandHeader = fullRectOf(document.querySelector('.rentcore-command-header'));
    const screen = fullRectOf(document.querySelector('.rentcore-command-screen'));
    const cockpit = fullRectOf(document.querySelector('[data-testid="dashboard-top-cockpit"]'));

    return {
      dashboardOpened: Boolean(document.querySelector('[data-testid="dashboard-executive-cockpit"]')),
      blockVisible: Object.fromEntries(Object.entries(blockRects).map(([key, rect]) => [key, Boolean(rect?.visible)])),
      overlaps,
      screenBelowAppHeader: Boolean(screen && appHeader && screen.top >= appHeader.bottom - 1),
      cockpitBelowCommandHeader: Boolean(cockpit && commandHeader && cockpit.top >= commandHeader.bottom - 1),
      healthVisible: isVisible(health ?? null),
      healthWidth: healthRect.width,
      healthWidthShare: healthRect.width / Math.max(boardRect.width, 1),
      healthSvgCount: health?.querySelectorAll('[data-testid="dashboard-company-health-svg"]').length || 0,
      compactVisible: isVisible(compact),
      compactCards,
      overflowX: scrollWidth - viewportWidth,
      overflowOffenders: offenders,
    };
  });
}

async function expectDashboardContract(
  page: Page,
  viewportCase: ViewportCase,
  state: { currentStage: string },
  testInfo: TestInfo,
): Promise<DashboardLayoutSnapshot> {
  await withStage(state, `${viewportCase.name}: dashboard opened`, async () => {
    await expect(
      page.getByRole('heading', { name: 'Операционный центр', exact: true }),
      `${viewportCase.name}: authenticated Dashboard heading should be visible`,
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByTestId('dashboard-executive-cockpit'),
      `${viewportCase.name}: Dashboard cockpit should be visible`,
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByTestId('dashboard-company-health'),
      `${viewportCase.name}: company health block should be visible`,
    ).toBeVisible({ timeout: 20_000 });
  });

  const snapshot = await withStage(state, `${viewportCase.name}: layout snapshot`, async () => {
    const value = await dashboardLayoutSnapshot(page);
    logStage(`${viewportCase.name}: layout`, value as unknown as Record<string, unknown>);
    return value;
  });

  await withStage(state, `${viewportCase.name}: dashboard layout assertions`, async () => {
    expect(snapshot.dashboardOpened, `${viewportCase.name}: authenticated Dashboard should be open`).toBe(true);
    expect(snapshot.blockVisible, `${viewportCase.name}: production-critical Dashboard blocks should be visible`).toEqual({
      keySignals: true,
      tasks: true,
      monthDynamics: true,
      fleet: true,
      receivables: true,
      health: true,
    });
    expect(snapshot.overlaps, `${viewportCase.name}: production-critical Dashboard blocks should not overlap`).toEqual([]);
    expect(snapshot.screenBelowAppHeader, `${viewportCase.name}: Dashboard screen should start below app header`).toBe(true);
    expect(snapshot.cockpitBelowCommandHeader, `${viewportCase.name}: KPI row should start below command header`).toBe(true);
    expect(snapshot.healthVisible, `${viewportCase.name}: company health compact card should be visible (${JSON.stringify(snapshot)})`).toBe(true);
    expect(snapshot.healthSvgCount, `${viewportCase.name}: company health should not render dominant SVG circle (${JSON.stringify(snapshot)})`).toBe(0);
    expect(snapshot.compactVisible, `${viewportCase.name}: compact wrapper should be visible (${JSON.stringify(snapshot)})`).toBe(true);
    expect(snapshot.compactCards, `${viewportCase.name}: compact wrapper should contain six direction cards`).toBeGreaterThanOrEqual(6);
    if (viewportCase.name === 'desktop') {
      expect(snapshot.healthWidthShare, `${viewportCase.name}: company health should not dominate dashboard width`).toBeLessThanOrEqual(0.38);
    }
  });

  await withStage(state, `${viewportCase.name}: overflow checked`, async () => {
    expect(snapshot.overflowX, `${viewportCase.name}: document should not scroll horizontally (${JSON.stringify(snapshot)})`).toBeLessThanOrEqual(1);
    expect(snapshot.overflowOffenders, `${viewportCase.name}: visible elements should stay inside viewport`).toEqual([]);
  });

  await withStage(state, `${viewportCase.name}: screenshot captured`, async () => {
    await page.screenshot({
      path: testInfo.outputPath(`production-dashboard-${viewportCase.name}.png`),
      fullPage: false,
      timeout: 15_000,
    });
  });

  return snapshot;
}

test('production authenticated dashboard visual smoke', async ({ page }, testInfo) => {
  test.setTimeout(180_000);

  const state = { currentStage: 'start' };
  const issues: UiIssue[] = [];
  const apiUrl = requiredEnv('PRODUCTION_API_URL', 'production dashboard visual smoke').replace(/\/$/, '');
  const frontendUrl = requiredEnv('PRODUCTION_FRONTEND_URL', 'production dashboard visual smoke').replace(/\/$/, '');
  const expectedCommit = String(process.env.EXPECTED_RELEASE_COMMIT || '').trim();

  logStage('start', {
    expectedCommit: shortCommit(expectedCommit),
    frontendUrl,
    apiUrl,
  });

  await installReadOnlyGuard(page, apiUrl, issues, () => state.currentStage);

  const api = await playwrightRequest.newContext({ baseURL: apiUrl });
  let token = '';
  let backendBuild: BuildInfo | null = null;
  let backendCommit = '';
  let releaseType = resolveDashboardSmokeReleaseType({
    envReleaseType: String(process.env.RELEASE_TYPE || ''),
  });
  try {
    await withStage(state, 'production preflight', async () => {
      const versionResponse = await api.get('/api/version', { timeout: 15_000 });
      expect(versionResponse.ok(), `production /api/version should return 200: ${versionResponse.status()}`).toBeTruthy();
      const version = await versionResponse.json() as {
        ok?: boolean;
        build?: BuildInfo;
        app?: { disabled?: boolean };
      };
      expect(version.ok, 'production /api/version should report ok=true').toBe(true);
      expect(version.app?.disabled, 'production app.disabled should be false for authenticated visual smoke').toBe(false);
      backendBuild = version.build || null;
      backendCommit = version.build?.commitFull || version.build?.commit || '';
      releaseType = resolveDashboardSmokeReleaseType({
        envReleaseType: String(process.env.RELEASE_TYPE || ''),
        backendReleaseType: backendBuild?.releaseType,
      });
      logStage('releaseType', { releaseType });
    });

    await withStage(state, 'login done', async () => {
      const loginResponse = await api.post('/api/auth/login', {
        data: {
          email: requiredEnv('PRODUCTION_ADMIN_EMAIL', 'production dashboard visual smoke'),
          password: requiredEnv('PRODUCTION_ADMIN_PASSWORD', 'production dashboard visual smoke'),
        },
        timeout: 20_000,
      });
      expect(loginResponse.ok(), `production login should return 200: ${loginResponse.status()}`).toBeTruthy();
      const login = await loginResponse.json() as { token?: string };
      expect(login.token, 'production login should return token').toBeTruthy();
      token = login.token || '';
    });
  } finally {
    await api.dispose();
  }

  await page.addInitScript((authToken) => {
    window.localStorage.setItem('app_auth_token', authToken);
    window.localStorage.setItem('theme', 'dark');
    document.documentElement?.classList.add('dark');
  }, token);

  const snapshots: Record<string, DashboardLayoutSnapshot> = {};
  let frontendCommit = '';
  let frontendApiBaseUrl = '';
  try {
    for (const viewportCase of VIEWPORT_CASES) {
      await withStage(state, `${viewportCase.name}: viewport set`, async () => {
        await page.setViewportSize(viewportCase.viewport);
      });

      await withStage(state, `${viewportCase.name}: dashboard navigation`, async () => {
        await page.goto(productionAppUrl(frontendUrl, '/'), {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
      });

      await withStage(state, `${viewportCase.name}: marker checked`, async () => {
        await page.waitForFunction(() => Boolean(window.__SKYTECH_BUILD_INFO__?.commit), null, { timeout: 15_000 });
        const marker = await page.evaluate(() => window.__SKYTECH_BUILD_INFO__ || null);
        frontendCommit = marker?.commit || frontendCommit;
        frontendApiBaseUrl = marker?.apiBaseUrl || frontendApiBaseUrl;
        releaseType = resolveDashboardSmokeReleaseType({
          envReleaseType: String(process.env.RELEASE_TYPE || ''),
          frontendReleaseType: marker?.releaseType,
          backendReleaseType: backendBuild?.releaseType,
        });
        expect(marker?.apiBaseUrl, 'frontend marker should point at production API').toBe(apiUrl);
        if (expectedCommit) {
          expect(
            commitsMatch(marker?.commit || '', shortCommit(expectedCommit)),
            `frontend marker should match expected production commit: expected=${shortCommit(expectedCommit)} frontend=${marker?.commit || 'missing'}`,
          ).toBeTruthy();
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
      });

      snapshots[viewportCase.name] = await expectDashboardContract(page, viewportCase, state, testInfo);
    }

    await withStage(state, 'console/api checked', async () => {
      expect(issues, `Dashboard smoke should not emit console/page/API errors. Last stage: ${state.currentStage}`).toEqual([]);
    });

    logStage('final result', {
      expectedCommit: shortCommit(expectedCommit),
      frontendCommit,
      backendCommit,
      releaseType,
      apiBaseUrl: frontendApiBaseUrl,
      compactCards: {
        tablet: snapshots.tablet?.compactCards ?? 0,
        mobile: snapshots.mobile?.compactCards ?? 0,
      },
      horizontalOverflow: {
        desktop: snapshots.desktop?.overflowX ?? 0,
        tablet: snapshots.tablet?.overflowX ?? 0,
        mobile: snapshots.mobile?.overflowX ?? 0,
      },
      errors: issues.length,
    });
  } catch (error) {
    const lastSnapshot = snapshots.mobile || snapshots.tablet || snapshots.desktop || null;
    console.error('[production-dashboard-visual-smoke] failure', JSON.stringify({
      lastStage: state.currentStage,
      compactCards: {
        tablet: snapshots.tablet?.compactCards ?? 0,
        mobile: snapshots.mobile?.compactCards ?? 0,
      },
      issues,
      lastSnapshot,
      message: error instanceof Error ? sanitize(error.message) : sanitize(String(error)),
    }));
    throw error;
  }
});
