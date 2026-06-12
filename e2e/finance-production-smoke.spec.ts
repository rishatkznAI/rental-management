import { expect, request as playwrightRequest, test, type APIResponse, type Page } from '@playwright/test';
import { requiredEnv } from './helpers/releaseSmoke';
import {
  assertDepreciationIsNonCash,
  assertEquipmentEconomicsUiStateSafe,
  assertEconomicsResponseSafe,
  assertNoUnsafeFinanceSmokePayload,
  EQUIPMENT_ECONOMICS_UI_STATE_PATTERN,
  assertTaxSettingsSafe,
  financeSmokeSummary,
  hasUnsafeFinanceSmokeText,
} from '../scripts/finance-smoke-checks.mjs';

type BuildInfo = {
  commit?: string;
  commitFull?: string;
  apiBaseUrl?: string;
  releaseType?: string;
};

type EquipmentRecord = {
  id?: string;
  inventoryNumber?: string;
  serialNumber?: string;
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

async function responseJson(response: APIResponse) {
  return response.json().catch(() => null);
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
    const url = response.url();
    const path = new URL(url).pathname;
    const isApi = url.startsWith(apiUrl) || /\/api\//.test(url);
    const expectedAnonymousMe = status === 401 && path === '/api/auth/me';
    const allowedEconomicsRestriction = status === 403 && /^\/api\/equipment\/[^/]+\/economics$/.test(path);
    if (isApi && status >= 400 && !expectedAnonymousMe && !allowedEconomicsRestriction) counts.apiErrors += 1;
  });

  return counts;
}

function safeSmokeLog(label: string, fields: Record<string, unknown>) {
  console.log(`[finance-production-smoke] ${label} ${JSON.stringify(fields)}`);
}

async function expectSafeVisibleText(page: Page, label: string) {
  const text = await page.locator('body').innerText();
  expect(hasUnsafeFinanceSmokeText(text), `${label} should not render undefined/null/object placeholders`).toBe(false);
}

async function getFirstEquipment(apiUrl: string, token: string): Promise<EquipmentRecord | null> {
  const api = await playwrightRequest.newContext({
    baseURL: apiUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  try {
    const response = await api.get('/api/equipment');
    if (!response.ok()) return null;
    const payload = await responseJson(response);
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { items?: unknown[] } | null)?.items)
        ? (payload as { items: unknown[] }).items
        : [];
    return (list.find(item => item && typeof item === 'object' && String((item as EquipmentRecord).id || '').trim()) as EquipmentRecord | undefined) || null;
  } finally {
    await api.dispose();
  }
}

test('production finance smoke stays read-only', async ({ page }) => {
  test.setTimeout(180_000);

  const apiUrl = requiredEnv('PRODUCTION_API_URL', 'finance production smoke').replace(/\/$/, '');
  const frontendUrl = requiredEnv('PRODUCTION_FRONTEND_URL', 'finance production smoke').replace(/\/$/, '');
  const adminEmail = requiredEnv('PRODUCTION_ADMIN_EMAIL', 'finance production smoke');
  const adminPassword = requiredEnv('PRODUCTION_ADMIN_PASSWORD', 'finance production smoke');
  const expectedCommit = String(process.env.EXPECTED_RELEASE_COMMIT || '').trim();
  const blockedWrites = await installProductionReadOnlyGuard(page);
  const aggregateCounts = installSafeAggregateMonitor(page, apiUrl);

  let token = '';
  let backendBuild: BuildInfo | null = null;

  const publicApi = await playwrightRequest.newContext({ baseURL: apiUrl });
  try {
    const health = await publicApi.get('/health');
    expect(health.ok(), 'production /health should return 200').toBeTruthy();

    const version = await publicApi.get('/api/version');
    expect(version.ok(), 'production /api/version should return 200').toBeTruthy();
    const versionJson = await version.json() as { build?: BuildInfo; app?: { disabled?: boolean } };
    backendBuild = versionJson.build || null;
    expect(versionJson.app?.disabled, 'production APP_DISABLED must remain false').toBe(false);

    if (expectedCommit) {
      const backendCommit = backendBuild?.commitFull || backendBuild?.commit || '';
      expect(
        commitsMatch(backendCommit, expectedCommit) || commitsMatch(backendBuild?.commit || '', shortCommit(expectedCommit)),
        `backend commit should match expected release commit: expected=${shortCommit(expectedCommit)}, backend=${backendCommit}`,
      ).toBeTruthy();
    }

    const anonymousCashFlow = await publicApi.get('/api/finance/cash-flow?includeDepreciation=true');
    expect(anonymousCashFlow.status(), 'anonymous cash-flow request should be 401').toBe(401);

    const login = await publicApi.post('/api/auth/login', {
      data: { email: adminEmail, password: adminPassword },
    });
    expect(login.ok(), 'production smoke login should return 200').toBeTruthy();
    const loginJson = await responseJson(login) as { token?: string; user?: { status?: string } } | null;
    token = String(loginJson?.token || '');
    expect(token, 'production smoke login should return an auth token').toBeTruthy();
    if (loginJson?.user?.status) {
      expect(loginJson.user.status, 'production smoke user should be active').toBe('Активен');
    }
  } finally {
    await publicApi.dispose();
  }

  const authedApi = await playwrightRequest.newContext({
    baseURL: apiUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  let equipment = await getFirstEquipment(apiUrl, token);
  try {
    const cashFlow = await authedApi.get('/api/finance/cash-flow?includeDepreciation=true');
    expect(cashFlow.ok(), 'authenticated cash-flow request should return 200').toBeTruthy();
    const cashFlowPayload = await cashFlow.json();
    assertNoUnsafeFinanceSmokePayload(cashFlowPayload);
    assertDepreciationIsNonCash(cashFlowPayload);
    safeSmokeLog('cashFlow', {
      status: cashFlow.status(),
      ...financeSmokeSummary(cashFlowPayload),
    });

    const taxSettings = await authedApi.get('/api/finance/tax-settings');
    expect(taxSettings.ok(), 'authenticated tax settings request should return 200').toBeTruthy();
    const taxPayload = await taxSettings.json();
    assertTaxSettingsSafe(taxPayload);
    safeSmokeLog('taxSettings', {
      status: taxSettings.status(),
      taxRegimeKnown: Boolean((taxPayload as { taxRegime?: string }).taxRegime),
    });

    if (equipment?.id) {
      const economics = await authedApi.get(`/api/equipment/${encodeURIComponent(equipment.id)}/economics`);
      const economicsPayload = await responseJson(economics);
      if (economics.status() === 403) {
        assertEconomicsResponseSafe(economicsPayload, { restricted: true });
        safeSmokeLog('economics', { status: 403, restricted: true });
      } else {
        expect(economics.ok(), 'equipment economics should return 200 or safe 403').toBeTruthy();
        assertEconomicsResponseSafe(economicsPayload);
        safeSmokeLog('economics', { status: economics.status(), restricted: false });
      }
    } else {
      safeSmokeLog('economics', { skipped: 'no_accessible_equipment' });
    }
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
  if (frontendBuild?.commit && backendBuild?.commit) {
    expect(
      commitsMatch(frontendBuild.commit, backendBuild.commit) || commitsMatch(frontendBuild.commit, backendBuild.commitFull || ''),
      `frontend/backend commits should match: frontend=${frontendBuild.commit}, backend=${backendBuild.commitFull || backendBuild.commit}`,
    ).toBeTruthy();
  }

  await page.getByLabel('Логин').fill(adminEmail);
  await page.getByRole('textbox', { name: 'Пароль' }).fill(adminPassword);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Операционный центр', exact: true })).toBeVisible();

  await page.goto(productionAppUrl(frontendUrl, '/finance'), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main'), 'Finance page main should be visible').toBeVisible();
  await expect(page.getByRole('tab', { name: 'Cash Flow' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'НДС' })).toBeVisible();

  await page.getByRole('tab', { name: 'Cash Flow' }).click();
  await expect(page.getByText(/Cash Flow, НДС и амортизация.*управленческим расчётом|не заменяют бухгалтерскую отчётность/i)).toBeVisible();
  await expect(page.getByText('Денег уйдёт', { exact: true })).toBeVisible();
  await expect(page.getByText('Чистый поток', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Амортизация' }).click();
  await expect(page.getByText(/Non-cash, не денежный расход/i)).toBeVisible();
  await expect(page.getByText(/non-cash|не уменьшает денежный поток/i).first()).toBeVisible();
  await expectSafeVisibleText(page, 'Finance Cash Flow');

  await page.getByRole('tab', { name: 'НДС' }).click();
  await expect(page.getByText(/Расчёт управленческий, не заменяет бухгалтерскую отчётность/i)).toBeVisible();
  await expect(page.getByText('Тип налогообложения', { exact: true })).toBeVisible();
  await expect(page.getByText('Ставка НДС по умолчанию, %', { exact: true })).toBeVisible();
  await expectSafeVisibleText(page, 'Finance VAT');

  if (!equipment?.id) {
    equipment = await getFirstEquipment(apiUrl, token);
  }
  if (equipment?.id) {
    await page.goto(productionAppUrl(frontendUrl, `/equipment/${encodeURIComponent(equipment.id)}`), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main'), 'Equipment detail main should be visible').toBeVisible();
    await page.getByRole('tab', { name: 'Экономика' }).click();
    const economicsPanel = page.getByRole('tabpanel', { name: 'Экономика' });
    await expect(economicsPanel, 'Equipment economics tab panel should be visible').toBeVisible();
    await expect(economicsPanel.getByText(/Экономика техники|Амортизация/i).first()).toBeVisible();
    await expect(
      economicsPanel.getByText(EQUIPMENT_ECONOMICS_UI_STATE_PATTERN).first(),
      'equipment economics should render full, restricted, not_configured, or empty safe state',
    ).toBeVisible();
    assertEquipmentEconomicsUiStateSafe(await economicsPanel.innerText());
    await expectSafeVisibleText(page, 'Equipment Economics');
  }

  expect(blockedWrites, 'finance production smoke must not attempt protected write endpoints').toEqual([]);
  expect(aggregateCounts.consoleErrors, 'finance smoke should not emit console errors').toBe(0);
  expect(aggregateCounts.pageErrors, 'finance smoke should not emit page errors').toBe(0);
  expect(aggregateCounts.apiErrors, 'finance smoke should not receive unexpected API errors').toBe(0);

  safeSmokeLog('ui', {
    financeVisible: true,
    cashFlowVisible: true,
    vatVisible: true,
    equipmentEconomicsChecked: Boolean(equipment?.id),
  });
});
