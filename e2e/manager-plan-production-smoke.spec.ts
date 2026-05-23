import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';
import { requiredEnv } from './helpers/releaseSmoke';
import {
  assertManagerPlanResponseShape,
  assertNoUnsafeManagerPlanPayload,
  hasUnsafeVisibleManagerPlanText,
  managerPlanSmokeSummary,
} from '../scripts/manager-plan-smoke-checks.mjs';

type ManagerPlanResponse = {
  summary?: {
    planStatus?: string;
    fleetUtilizationPercent?: number | null;
    activeRentals?: number;
    debtAmount?: number;
  };
  activityTarget?: {
    required?: boolean;
    dailyCallsTarget?: number;
    weeklySiteVisitsTarget?: number;
    message?: string;
  };
  tasks?: unknown[];
};

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function shortCommit(value = '') {
  return value.trim().slice(0, 12);
}

function commitsMatch(left = '', right = '') {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft);
}

function productionAppUrl(frontendUrl: string, route = '/') {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return `${frontendUrl.replace(/\/$/, '')}/?debugVersion=1&_smoke=${Date.now()}#${normalizedRoute}`;
}

function sanitizeUrl(url: string) {
  return url.replace(/[?&](token|password|secret|auth|access_token)=[^&]+/gi, '$1=[secret]');
}

async function installProductionReadOnlyGuard(page: Page) {
  const blocked: string[] = [];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const path = new URL(request.url()).pathname;
    const allowedRead = ['GET', 'HEAD', 'OPTIONS'].includes(method);
    const allowedLogin = method === 'POST' && path === '/api/auth/login';

    if (allowedRead || allowedLogin) {
      await route.continue();
      return;
    }

    blocked.push(`${method} ${sanitizeUrl(path)}`);
    await route.abort('blockedbyclient');
  });

  return blocked;
}

function installSafeAggregateMonitor(page: Page, apiUrl: string) {
  const counts = {
    consoleErrors: 0,
    pageErrors: 0,
    apiErrors: 0,
  };

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/ResizeObserver loop|Download the React DevTools|favicon/i.test(text)) return;
    counts.consoleErrors += 1;
  });

  page.on('pageerror', () => {
    counts.pageErrors += 1;
  });

  page.on('response', (response) => {
    const status = response.status();
    const path = new URL(response.url()).pathname;
    const isApi = response.url().startsWith(apiUrl) || /\/api\//.test(response.url());
    const expectedAnonymousMe = status === 401 && path === '/api/auth/me';
    if (isApi && status >= 400 && !expectedAnonymousMe) counts.apiErrors += 1;
  });

  return counts;
}

function safeSmokeLog(label: string, fields: Record<string, unknown>) {
  console.log(`[manager-plan-production-smoke] ${label} ${JSON.stringify(fields)}`);
}

async function getJson(response: { json: () => Promise<unknown> }) {
  return response.json().catch(() => null);
}

function assertManagerScopeNotExpanded(base: ManagerPlanResponse, scoped: ManagerPlanResponse) {
  expect(scoped.summary?.activeRentals || 0, 'managerId query must not increase active rental count for manager role').toBeLessThanOrEqual(base.summary?.activeRentals || 0);
  expect(scoped.summary?.debtAmount || 0, 'managerId query must not increase debt amount for manager role').toBeLessThanOrEqual(base.summary?.debtAmount || 0);
  expect(scoped.tasks?.length || 0, 'managerId query must not increase tasks for manager role').toBeLessThanOrEqual(base.tasks?.length || 0);
}

test('production manager plan smoke stays read-only', async ({ page }) => {
  test.setTimeout(180_000);

  const apiUrl = requiredEnv('PRODUCTION_API_URL', 'manager plan production smoke').replace(/\/$/, '');
  const frontendUrl = requiredEnv('PRODUCTION_FRONTEND_URL', 'manager plan production smoke').replace(/\/$/, '');
  const adminEmail = requiredEnv('PRODUCTION_ADMIN_EMAIL', 'manager plan production smoke');
  const adminPassword = requiredEnv('PRODUCTION_ADMIN_PASSWORD', 'manager plan production smoke');
  const expectedCommit = String(process.env.EXPECTED_RELEASE_COMMIT || '').trim();

  const blockedWrites = await installProductionReadOnlyGuard(page);
  const aggregateCounts = installSafeAggregateMonitor(page, apiUrl);

  let authToken = '';
  let userRole = '';
  let managerPlanPayload: ManagerPlanResponse | null = null;
  let versionJson: { build?: { commit?: string; commitFull?: string }; app?: { disabled?: boolean } } | null = null;

  const publicApi = await playwrightRequest.newContext({ baseURL: apiUrl });
  try {
    const health = await publicApi.get('/health');
    expect(health.ok(), 'production /health should return 200').toBeTruthy();

    const version = await publicApi.get('/api/version');
    expect(version.ok(), 'production /api/version should return 200').toBeTruthy();
    versionJson = await version.json();
    expect(versionJson?.app?.disabled, 'production APP_DISABLED must remain false').toBe(false);

    if (expectedCommit) {
      const backendCommit = versionJson?.build?.commitFull || versionJson?.build?.commit || '';
      expect(
        commitsMatch(backendCommit, expectedCommit) || commitsMatch(versionJson?.build?.commit || '', shortCommit(expectedCommit)),
        `backend commit should match expected release commit: expected=${shortCommit(expectedCommit)}, backend=${backendCommit}`,
      ).toBeTruthy();
    }

    const anonymousPlan = await publicApi.get('/api/manager/my-plan');
    expect(anonymousPlan.status(), 'anonymous manager plan request should be 401').toBe(401);

    const login = await publicApi.post('/api/auth/login', {
      data: { email: adminEmail, password: adminPassword },
    });
    expect(login.ok(), 'production smoke login should return 200').toBeTruthy();
    const loginJson = await getJson(login) as { token?: string; user?: { role?: string; status?: string } } | null;
    authToken = String(loginJson?.token || '');
    userRole = String(loginJson?.user?.role || '');
    expect(authToken, 'production smoke login should return an auth token').toBeTruthy();
    if (loginJson?.user?.status) {
      expect(loginJson.user.status, 'production smoke user should be active').toBe('Активен');
    }
  } finally {
    await publicApi.dispose();
  }

  const authedApi = await playwrightRequest.newContext({
    baseURL: apiUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${authToken}` },
  });
  try {
    const managerPlan = await authedApi.get('/api/manager/my-plan');
    expect(managerPlan.ok(), 'authenticated manager plan request should return 200').toBeTruthy();
    managerPlanPayload = await managerPlan.json() as ManagerPlanResponse;
    assertManagerPlanResponseShape(managerPlanPayload);
    assertNoUnsafeManagerPlanPayload(managerPlanPayload);

    if (managerPlanPayload.summary?.planStatus === 'needs_activity') {
      expect(managerPlanPayload.activityTarget?.required, 'low utilization must require activity').toBe(true);
      expect(managerPlanPayload.activityTarget?.dailyCallsTarget, 'low utilization must require 40 calls/day').toBe(40);
      expect(managerPlanPayload.activityTarget?.weeklySiteVisitsTarget, 'low utilization must require 2 site visits/week').toBe(2);
    }

    const canProbeManagerScope = /Менеджер по аренде|rental manager/i.test(userRole);
    if (canProbeManagerScope) {
      const scopedProbe = await authedApi.get('/api/manager/my-plan?managerId=__smoke_scope_probe__');
      expect(scopedProbe.ok(), 'manager scoped probe should not fail').toBeTruthy();
      const scopedPayload = await scopedProbe.json() as ManagerPlanResponse;
      assertManagerPlanResponseShape(scopedPayload);
      assertNoUnsafeManagerPlanPayload(scopedPayload);
      assertManagerScopeNotExpanded(managerPlanPayload, scopedPayload);
    }

    safeSmokeLog('api', {
      status: 200,
      ...managerPlanSmokeSummary(managerPlanPayload),
      managerScopeProbe: canProbeManagerScope ? 'checked' : 'skipped_non_manager_credentials',
    });
  } finally {
    await authedApi.dispose();
  }

  await page.goto(productionAppUrl(frontendUrl, '/login'), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__SKYTECH_BUILD_INFO__?.commit));
  const frontendBuild = await page.evaluate(() => window.__SKYTECH_BUILD_INFO__ || null);
  expect(frontendBuild?.apiBaseUrl, 'frontend build marker should point at production API').toBe(apiUrl);

  if (expectedCommit) {
    expect(
      commitsMatch(frontendBuild?.commit || '', shortCommit(expectedCommit)),
      `frontend commit should match expected release commit: expected=${shortCommit(expectedCommit)}, frontend=${frontendBuild?.commit || 'missing'}`,
    ).toBeTruthy();
  }

  await page.getByLabel('Логин').fill(adminEmail);
  await page.getByRole('textbox', { name: 'Пароль' }).fill(adminPassword);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Дашборд', exact: true })).toBeVisible();

  const planBlock = page.getByTestId('manager-my-plan');
  await expect(planBlock, 'dashboard manager plan block should be visible').toBeVisible();
  await expect(planBlock.getByRole('heading', { name: 'Мой план', exact: true })).toBeVisible();
  for (const label of ['Загрузка парка', 'Активные аренды', 'Звонки сегодня', 'Возвраты сегодня/завтра', 'Просроченные возвраты', 'Долг', 'Документы']) {
    await expect(planBlock.getByText(label, { exact: true }).first(), `manager plan KPI ${label} should be visible`).toBeVisible();
  }
  const activityPlanSection = planBlock.locator('div').filter({ hasText: 'План активности' }).filter({ hasText: 'Прогресс активности' }).first();
  await expect(activityPlanSection, 'manager plan activity section should be visible').toBeVisible();
  await expect(activityPlanSection.getByText('План активности', { exact: true })).toBeVisible();
  await expect(activityPlanSection.getByText('Прогресс активности', { exact: true })).toBeVisible();
  await expect(planBlock.getByText('Быстро добавить активность', { exact: true })).toBeVisible();
  await expect(planBlock.getByText('Задачи', { exact: true })).toBeVisible();
  await expect(planBlock.getByText('Последние действия', { exact: true })).toBeVisible();

  if (managerPlanPayload?.summary?.planStatus === 'needs_activity') {
    await expect(activityPlanSection.getByText('Звонки', { exact: true })).toBeVisible();
    await expect(activityPlanSection.getByText(/\d+\s*\/\s*40/).first(), 'daily calls progress should show current count out of 40').toBeVisible();
    await expect(activityPlanSection.getByText('Выезды', { exact: true })).toBeVisible();
    await expect(activityPlanSection.getByText(/\d+\s*\/\s*2/).first(), 'weekly site visits progress should show current count out of 2').toBeVisible();
  } else {
    await expect(planBlock.getByText(/Фокус на удержании|Недостаточно данных|Парк загружен|нужен активный поиск/i).first()).toBeVisible();
  }

  const taskLinks = await planBlock.locator('a').count();
  const safeEmptyStateVisible = await planBlock.getByText('На сегодня нет критичных задач. Данные загружены безопасно.', { exact: true }).count();
  expect(taskLinks + safeEmptyStateVisible, 'manager plan should render task links or a safe empty state').toBeGreaterThan(0);

  const destructiveControls = planBlock.getByRole('button').filter({
    hasText: /Создать|Изменить|Удалить|Сохранить|Архивировать|Списать|Сброс|Create|Edit|Delete|Save|Reset/i,
  });
  await expect(destructiveControls, 'manager plan must not expose destructive buttons').toHaveCount(0);

  const visibleText = await planBlock.innerText();
  expect(hasUnsafeVisibleManagerPlanText(visibleText), 'manager plan should not render undefined/null/object placeholders').toBe(false);
  expect(blockedWrites, 'manager plan production smoke must not attempt protected write endpoints').toEqual([]);
  expect(aggregateCounts.consoleErrors, 'manager plan smoke should not emit console errors').toBe(0);
  expect(aggregateCounts.pageErrors, 'manager plan smoke should not emit page errors').toBe(0);
  expect(aggregateCounts.apiErrors, 'manager plan smoke should not receive API errors').toBe(0);

  safeSmokeLog('ui', {
    blockVisible: true,
    kpisVisible: true,
    taskLinks,
    safeEmptyStateVisible: safeEmptyStateVisible > 0,
    consoleErrors: aggregateCounts.consoleErrors,
    pageErrors: aggregateCounts.pageErrors,
    apiErrors: aggregateCounts.apiErrors,
    appDisabled: versionJson?.app?.disabled === true,
  });
});
