import { expect, request as playwrightRequest, type APIResponse, type Page, type TestInfo } from '@playwright/test';

type BuildInfo = {
  commit?: string;
  commitFull?: string;
  buildTime?: string;
  apiBaseUrl?: string;
};

type VersionInfo = {
  ok?: boolean;
  build?: BuildInfo;
  app?: {
    disabled?: boolean;
    message?: string;
  };
};

type UiIssue = {
  type: string;
  action: string;
  url: string;
  status?: number;
  text?: string;
};

type ReleaseType = 'frontend-only' | 'backend' | 'full-stack' | 'deploy-tooling';

export type ReleaseSmokeConfig = {
  environmentName: 'staging' | 'production';
  frontendUrl: string;
  apiUrl: string;
  adminEmail: string;
  adminPassword: string;
  expectedCommit?: string;
  releaseType?: ReleaseType | string;
  readOnlySections?: Array<{ label: string; route: string; nav: RegExp }>;
};

declare global {
  interface Window {
    __SKYTECH_BUILD_INFO__?: {
      commit?: string;
      buildTime?: string;
      apiBaseUrl?: string;
    };
  }
}

export const DEFAULT_READ_ONLY_SECTIONS: Array<{ label: string; route: string; nav: RegExp }> = [
  { label: 'Техника', route: '/equipment', nav: /^Техника/ },
  { label: 'Аренды', route: '/rentals', nav: /^Аренды/ },
  { label: 'Доставка', route: '/deliveries', nav: /^Доставка/ },
  { label: 'Сервис', route: '/service', nav: /^Сервис/ },
  { label: 'Документы', route: '/documents', nav: /^Документы/ },
  { label: 'Платежи', route: '/payments', nav: /^Платежи/ },
  { label: 'Финансы', route: '/finance', nav: /^Финансы/ },
  { label: 'GSM', route: '/gsm', nav: /^GSM/ },
];

export function requiredEnv(name: string, environmentName = 'release smoke') {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required for ${environmentName}`);
  return value;
}

export function optionalEnv(name: string) {
  return String(process.env[name] || '').trim();
}

function shortCommit(value = '') {
  return value.trim().slice(0, 12);
}

function commitsMatch(left = '', right = '') {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft);
}

function normalizeReleaseType(value = ''): ReleaseType {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'frontend-only' || normalized === 'backend' || normalized === 'full-stack' || normalized === 'deploy-tooling') return normalized;
  return 'full-stack';
}

function backendCommitFromBuild(backendBuild?: BuildInfo | null) {
  return backendBuild?.commitFull || backendBuild?.commit || '';
}

function allowsBackendCommitDrift(config: Pick<ReleaseSmokeConfig, 'environmentName' | 'releaseType'>) {
  const releaseType = normalizeReleaseType(String(config.releaseType || ''));
  return config.environmentName === 'production' && (releaseType === 'frontend-only' || releaseType === 'deploy-tooling');
}

function expectedDriftReleaseType(releaseType?: ReleaseType | string) {
  return normalizeReleaseType(String(releaseType || '')) === 'deploy-tooling' ? 'deploy-tooling' : 'frontend-only';
}

function frontendOnlyBackendDriftMessage(details: { expectedCommit?: string; frontendCommit?: string; backendCommit: string; releaseType?: ReleaseType | string }) {
  const expected = details.expectedCommit ? ` expected=${shortCommit(details.expectedCommit)}` : '';
  const frontend = details.frontendCommit ? ` frontend=${details.frontendCommit}` : '';
  return `Backend commit differs from frontend commit: expected for ${expectedDriftReleaseType(details.releaseType)} release.${expected}${frontend} backend=${details.backendCommit}`;
}

function sanitize(text: string, limit = 1200) {
  return text
    .replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [token]')
    .slice(0, limit);
}

function appUrl(frontendUrl: string, route = '/') {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return `${frontendUrl.replace(/\/$/, '')}/?debugVersion=1&_smoke=${Date.now()}#${normalizedRoute}`;
}

function conservedAppUrl(frontendUrl: string, expectedCommit?: string) {
  const url = new URL(frontendUrl.replace(/\/$/, ''));
  url.searchParams.set('debugVersion', '1');
  url.searchParams.set('v', shortCommit(expectedCommit) || String(Date.now()));
  return url.toString();
}

function hasMaintenanceUiText(bodyText: string, appDisabledMessage?: string) {
  const expectedMessage = String(appDisabledMessage || '').trim();
  if (expectedMessage && bodyText.includes(expectedMessage)) return true;
  return /Система временно отключена|Работа приложения приостановлена|техническ(?:ое|ого|ом|ий|ая)\s+обслуживан|временно\s+(?:закрыто|отключена|недоступн)|обслуживан|conserved|maintenance/i.test(bodyText);
}

function installReadOnlyGuards(page: Page, config: ReleaseSmokeConfig, issues: UiIssue[], getAction: () => string) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/ResizeObserver loop|Download the React DevTools|favicon/i.test(text)) return;
    issues.push({ type: 'console.error', action: getAction(), url: page.url(), text: sanitize(text) });
  });

  page.on('pageerror', (error) => {
    issues.push({ type: 'pageerror', action: getAction(), url: page.url(), text: sanitize(error.stack || error.message) });
  });

  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    const action = getAction();
    const isApi = url.startsWith(config.apiUrl) || /\/api\//.test(url);
    const isExpectedAnonymousMe = action === 'frontend boot' && status === 401 && /\/api\/auth\/me($|\?)/.test(url);

    if (isExpectedAnonymousMe) return;
    if (status >= 500) {
      issues.push({ type: 'http-5xx', action, url, status });
      return;
    }
    if (isApi && action !== 'frontend boot' && [401, 403].includes(status)) {
      issues.push({ type: 'authz-response', action, url, status });
    }
  });

  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || '';
    if (failure === 'net::ERR_ABORTED' || /favicon|\.map($|\?)/.test(request.url())) return;
    issues.push({ type: 'requestfailed', action: getAction(), url: request.url(), text: sanitize(failure) });
  });
}

async function expectHealthyMain(page: Page, label: string) {
  const main = page.locator('main');
  await expect(main, `${label}: main should be visible`).toBeVisible();
  const text = (await main.innerText()).trim();
  expect(text.length, `${label}: main should not be blank`).toBeGreaterThan(10);
  await expect(page.getByText(/Cannot read properties|Maximum update depth exceeded|Unexpected Application Error|Application error|Something went wrong|ошибка приложения/i)).toHaveCount(0);
}

async function expectMaintenanceUiVisible(page: Page, config: ReleaseSmokeConfig, appDisabledMessage?: string, frontendBuild?: BuildInfo | null, backendBuild?: BuildInfo | null, loginStatus?: number | null) {
  await expect.poll(
    async () => hasMaintenanceUiText(await visibleBodyText(page), appDisabledMessage),
    {
      message: `${config.environmentName} conserved frontend should render maintenance/conservation UI`,
      timeout: 15_000,
      intervals: [250, 500, 1000],
    },
  ).toBe(true);

  const bodyText = await visibleBodyText(page);
  if (!hasMaintenanceUiText(bodyText, appDisabledMessage)) {
    await failWithPageDiagnostics(
      page,
      config,
      `${config.environmentName} is conserved but the frontend did not render maintenance/conservation state.`,
      frontendBuild,
      backendBuild,
      loginStatus,
    );
  }
  await expect(page.locator('main'), 'conserved production maintenance shell should be visible').toBeVisible();
}

async function visibleBodyText(page: Page) {
  const text = await page.locator('body').innerText().catch(() => '');
  return sanitize(text.trim(), 1200);
}

async function responseText(response: APIResponse) {
  return sanitize(await response.text().catch(() => ''), 1200);
}

function diagnosticHeader(config: ReleaseSmokeConfig, frontendBuild?: BuildInfo | null, backendBuild?: BuildInfo | null, loginStatus?: number | null) {
  return [
    `Environment: ${config.environmentName}`,
    `Frontend URL: ${config.frontendUrl}`,
    `API URL: ${config.apiUrl}`,
    `Frontend commit/build marker: ${frontendBuild?.commit || 'missing'}`,
    `Backend commit: ${backendBuild?.commit || backendBuild?.commitFull || 'missing'}`,
    `Expected commit: ${config.expectedCommit ? shortCommit(config.expectedCommit) : 'not set'}`,
    `HTTP status /api/auth/login: ${loginStatus ?? 'not captured'}`,
  ].join('\n');
}

async function failWithPageDiagnostics(
  page: Page,
  config: ReleaseSmokeConfig,
  message: string,
  frontendBuild?: BuildInfo | null,
  backendBuild?: BuildInfo | null,
  loginStatus?: number | null,
): Promise<never> {
  throw new Error(`${message}
This looks like a credentials/auth/backend DB problem, not a selector problem.
${diagnosticHeader(config, frontendBuild, backendBuild, loginStatus)}
Current URL: ${page.url()}
Visible body text (first 1200 chars):
${await visibleBodyText(page)}`);
}

async function expectAdminLoginSucceeded(
  page: Page,
  config: ReleaseSmokeConfig,
  frontendBuild?: BuildInfo | null,
  backendBuild?: BuildInfo | null,
  getLoginStatus?: () => number | null,
) {
  const authError = page.locator('[role="alert"], #auth-error').filter({
    hasText: /Неверный логин или пароль|invalid login|invalid password|unauthorized|forbidden/i,
  }).first();
  const dashboardHeading = page.getByRole('heading', { name: 'Дашборд', exact: true });
  const nav = page.getByRole('navigation').first();

  const deadline = Date.now() + 20_000;
  let loginState = 'pending';
  while (Date.now() < deadline) {
    if (await authError.isVisible().catch(() => false)) {
      loginState = 'auth-error';
      break;
    }
    if (await dashboardHeading.isVisible().catch(() => false)) {
      loginState = 'dashboard';
      break;
    }
    if (await nav.isVisible().catch(() => false)) {
      loginState = 'nav';
      break;
    }
    await page.waitForTimeout(250);
  }

  if (loginState === 'auth-error') {
    await failWithPageDiagnostics(page, config, `${config.environmentName} login failed`, frontendBuild, backendBuild, getLoginStatus?.());
  }

  if (loginState === 'pending') {
    await failWithPageDiagnostics(page, config, `${config.environmentName} login did not reach an authenticated app shell.`, frontendBuild, backendBuild, getLoginStatus?.());
  }

  if (page.url().includes('#/login')) {
    await failWithPageDiagnostics(page, config, `${config.environmentName} login did not leave the login route.`, frontendBuild, backendBuild, getLoginStatus?.());
  }

  await expect(dashboardHeading, 'dashboard heading should be visible after login').toBeVisible();
  await expect(nav, 'main navigation should be visible after login').toBeVisible();
}

async function expectExecutiveCockpitVisible(page: Page) {
  const summary = page.getByTestId('dashboard-executive-summary');
  const cockpit = page.getByTestId('dashboard-executive-cockpit');
  await expect(summary, 'executive cockpit summary should be visible after login').toBeVisible();
  await expect(cockpit, 'executive cockpit KPI grid should be visible after login').toBeVisible();

  const kpiChecks = [
    { testId: 'dashboard-kpi-overdue-debt', label: 'Просроченная дебиторка' },
    { testId: 'dashboard-kpi-fleet-utilization', label: 'Утилизация парка' },
    { testId: 'dashboard-kpi-service-load', label: 'Загрузка сервиса' },
    { testId: 'dashboard-kpi-operational-load', label: 'Операционная нагрузка' },
  ];

  for (const item of kpiChecks) {
    const card = page.getByTestId(item.testId);
    await expect(card, `executive cockpit KPI ${item.testId} should be visible`).toBeVisible();
    await expect(card.getByText(item.label, { exact: true }), `executive cockpit KPI label ${item.label} should be visible`).toBeVisible();
  }

  await expect(page.getByRole('heading', { name: 'Главные сигналы сегодня' }), 'dashboard signal strip should be visible').toBeVisible();
  await expect(page.getByRole('heading', { name: 'Денежный поток' }), 'dashboard cash flow card should be visible').toBeVisible();
  await expect(page.getByRole('heading', { name: 'Здоровье компании' }), 'dashboard company health card should be visible').toBeVisible();

  const fleetUtilizationCard = page.getByTestId('dashboard-kpi-fleet-utilization');
  const serviceLoadCard = page.getByTestId('dashboard-kpi-service-load');
  await expect(fleetUtilizationCard.getByText('Открыть планировщик', { exact: true }), 'planner CTA should be visible').toBeVisible();
  await expect(serviceLoadCard.getByText('Открыть сервис', { exact: true }), 'service CTA should be visible').toBeVisible();
  await expect(fleetUtilizationCard, 'planner CTA should target #/planner')
    .toHaveAttribute('href', /#\/planner$/);
  await expect(serviceLoadCard, 'service CTA should target #/service')
    .toHaveAttribute('href', /#\/service$/);
}

async function captureExecutiveCockpitScreenshots(page: Page, frontendUrl: string, testInfo?: TestInfo) {
  if (!testInfo) return;

  await page.screenshot({
    path: testInfo.outputPath('production-dashboard-cockpit-desktop.png'),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(appUrl(frontendUrl, '/'), { waitUntil: 'domcontentloaded' });
  await expectExecutiveCockpitVisible(page);
  await page.screenshot({
    path: testInfo.outputPath('production-dashboard-cockpit-mobile.png'),
    fullPage: true,
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(appUrl(frontendUrl, '/'), { waitUntil: 'domcontentloaded' });
}

async function directLoginSmoke(config: ReleaseSmokeConfig) {
  const api = await playwrightRequest.newContext({ baseURL: config.apiUrl });
  try {
    const login = await api.post('/api/auth/login', {
      data: { email: config.adminEmail, password: config.adminPassword },
    });
    const status = login.status();
    if (!login.ok()) {
      throw new Error(`${config.environmentName} direct login smoke failed.
This looks like a credentials/auth/backend DB problem, not a selector problem.
Frontend URL: ${config.frontendUrl}
API URL: ${config.apiUrl}
HTTP status /api/auth/login: ${status}
Response body (sanitized, first 1200 chars):
${await responseText(login)}`);
    }
    const loginJson = await login.json().catch(() => null) as { token?: string; user?: { status?: string; role?: string; email?: string } } | null;
    expect(loginJson?.token, `${config.environmentName} smoke user login should return a token`).toBeTruthy();
    expect(loginJson?.user, `${config.environmentName} smoke user should be present`).toBeTruthy();
    if (loginJson?.user?.status) {
      expect(loginJson.user.status, `${config.environmentName} smoke user should be active`).toBe('Активен');
    }
    return { status, token: loginJson?.token || '' };
  } finally {
    await api.dispose();
  }
}

async function directConservedLoginSmoke(config: ReleaseSmokeConfig) {
  const api = await playwrightRequest.newContext({ baseURL: config.apiUrl });
  try {
    const login = await api.post('/api/auth/login', {
      data: { email: config.adminEmail, password: config.adminPassword },
    });
    const status = login.status();
    expect(status, `${config.environmentName} conserved login should be blocked with HTTP 503`).toBe(503);
    return { status };
  } finally {
    await api.dispose();
  }
}

export async function runReleaseSmoke(page: Page, config: ReleaseSmokeConfig, testInfo?: TestInfo) {
  const normalizedConfig = {
    ...config,
    frontendUrl: config.frontendUrl.replace(/\/$/, ''),
    apiUrl: config.apiUrl.replace(/\/$/, ''),
    releaseType: normalizeReleaseType(String(config.releaseType || '')),
    readOnlySections: config.readOnlySections || DEFAULT_READ_ONLY_SECTIONS,
  };

  const issues: UiIssue[] = [];
  let action = 'backend preflight';
  let backendBuild: BuildInfo | null = null;
  let frontendBuild: BuildInfo | null = null;
  let versionJson: VersionInfo | null = null;
  let loginStatus: number | null = null;

  installReadOnlyGuards(page, normalizedConfig, issues, () => action);

  const api = await playwrightRequest.newContext({ baseURL: normalizedConfig.apiUrl });
  try {
    const health = await api.get('/health');
    expect(health.ok(), await health.text()).toBeTruthy();
    const healthJson = await health.json();
    expect(healthJson.ok).toBe(true);

    const ready = await api.get('/health/ready');
    expect(ready.ok(), await ready.text()).toBeTruthy();
    const readyJson = await ready.json();
    expect(readyJson.ok).toBe(true);

    const version = await api.get('/api/version');
    expect(version.ok(), await version.text()).toBeTruthy();
    versionJson = await version.json() as VersionInfo;
    expect(versionJson.ok).toBe(true);
    backendBuild = (versionJson.build || {}) as BuildInfo;
    expect(backendBuild.commit || backendBuild.commitFull, 'backend commit should be exposed by /api/version').toBeTruthy();
  } finally {
    await api.dispose();
  }

  if (normalizedConfig.expectedCommit) {
    const backendCommit = backendCommitFromBuild(backendBuild);
    const backendCommitMatchesExpected = commitsMatch(backendCommit, normalizedConfig.expectedCommit)
      || commitsMatch(backendBuild.commit || '', shortCommit(normalizedConfig.expectedCommit));
    if (!backendCommitMatchesExpected && allowsBackendCommitDrift(normalizedConfig)) {
      console.log(frontendOnlyBackendDriftMessage({
        expectedCommit: normalizedConfig.expectedCommit,
        backendCommit,
        releaseType: normalizedConfig.releaseType,
      }));
    } else {
      expect(
        backendCommitMatchesExpected,
        `backend commit should match expected release commit: expected=${shortCommit(normalizedConfig.expectedCommit)}, backend=${backendCommit}`,
      ).toBeTruthy();
    }
  }

  if (normalizedConfig.environmentName === 'production' && versionJson?.app?.disabled === true) {
    const directLogin = await directConservedLoginSmoke(normalizedConfig);
    loginStatus = directLogin.status;

    action = 'frontend conservation';
    await page.goto(conservedAppUrl(normalizedConfig.frontendUrl, normalizedConfig.expectedCommit), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();
    await page.waitForFunction(() => Boolean(window.__SKYTECH_BUILD_INFO__?.commit));
    frontendBuild = await page.evaluate(() => window.__SKYTECH_BUILD_INFO__ || null);
    expect(frontendBuild?.commit, 'frontend commit should be available with debugVersion=1').toBeTruthy();
    expect(frontendBuild?.apiBaseUrl, 'frontend build marker should expose API base URL').toBe(normalizedConfig.apiUrl);

    if (normalizedConfig.expectedCommit) {
      expect(
        commitsMatch(frontendBuild?.commit || '', shortCommit(normalizedConfig.expectedCommit)),
        `frontend commit should match expected release commit: expected=${shortCommit(normalizedConfig.expectedCommit)}, frontend=${frontendBuild?.commit || 'missing'}`,
      ).toBeTruthy();
    }

    const backendCommit = backendCommitFromBuild(backendBuild);
    if (frontendBuild?.commit && backendCommit) {
      const frontendBackendMatch = commitsMatch(frontendBuild.commit, backendCommit);
      if (!frontendBackendMatch && allowsBackendCommitDrift(normalizedConfig)) {
        console.log(frontendOnlyBackendDriftMessage({
          frontendCommit: frontendBuild.commit,
          backendCommit,
          releaseType: normalizedConfig.releaseType,
        }));
      } else {
        expect(
          frontendBackendMatch,
          `frontend/backend commits should match unless release owner approved drift: frontend=${frontendBuild.commit}, backend=${backendCommit}`,
        ).toBeTruthy();
      }
    }

    await expectMaintenanceUiVisible(page, normalizedConfig, versionJson.app.message, frontendBuild, backendBuild, loginStatus);
    console.log('Production is conserved: login HTTP 503 is expected, authenticated smoke skipped.');
    expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
    return;
  }

  const directLogin = await directLoginSmoke(normalizedConfig);
  loginStatus = directLogin.status;

  action = 'frontend boot';
  await page.goto(appUrl(normalizedConfig.frontendUrl, '/login'), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__SKYTECH_BUILD_INFO__?.commit));
  frontendBuild = await page.evaluate(() => window.__SKYTECH_BUILD_INFO__ || null);
  expect(frontendBuild?.commit, 'frontend commit should be available with debugVersion=1').toBeTruthy();
  expect(frontendBuild?.apiBaseUrl, 'frontend build marker should expose API base URL').toBe(normalizedConfig.apiUrl);

  if (normalizedConfig.expectedCommit) {
    expect(
      commitsMatch(frontendBuild?.commit || '', shortCommit(normalizedConfig.expectedCommit)),
      `frontend commit should match expected release commit: expected=${shortCommit(normalizedConfig.expectedCommit)}, frontend=${frontendBuild?.commit || 'missing'}`,
    ).toBeTruthy();
  }

  action = 'admin login';
  page.on('response', (response) => {
    if (/\/api\/auth\/login($|\?)/.test(response.url())) {
      loginStatus = response.status();
    }
  });
  await page.getByLabel('Логин').fill(normalizedConfig.adminEmail);
  await page.getByRole('textbox', { name: 'Пароль' }).fill(normalizedConfig.adminPassword);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expectAdminLoginSucceeded(page, normalizedConfig, frontendBuild, backendBuild, () => loginStatus);
  await expectHealthyMain(page, 'dashboard');
  action = 'dashboard executive cockpit';
  await expectExecutiveCockpitVisible(page);
  await captureExecutiveCockpitScreenshots(page, normalizedConfig.frontendUrl, testInfo);

  const token = await page.evaluate(() => window.localStorage.getItem('app_auth_token'));
  expect(token, 'admin login should store auth token').toBeTruthy();

  const authedApi = await playwrightRequest.newContext({
    baseURL: normalizedConfig.apiUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  try {
    const me = await authedApi.get('/api/auth/me');
    expect(me.ok(), await me.text()).toBeTruthy();
  } finally {
    await authedApi.dispose();
  }

  for (const section of normalizedConfig.readOnlySections) {
    action = `section ${section.label}`;
    const navButton = page.getByRole('navigation').getByRole('button', { name: section.nav });
    await expect(navButton, `${section.label} nav should be visible for ${normalizedConfig.environmentName} admin`).toBeVisible();
    await page.goto(appUrl(normalizedConfig.frontendUrl, section.route), { waitUntil: 'domcontentloaded' });
    await expectHealthyMain(page, section.label);
  }

  action = 'commit match';
  const frontendCommit = frontendBuild?.commit || '';
  const backendCommit = backendCommitFromBuild(backendBuild);
  if (frontendCommit && backendCommit) {
    const frontendBackendMatch = commitsMatch(frontendCommit, backendCommit);
    if (!frontendBackendMatch && allowsBackendCommitDrift(normalizedConfig)) {
      console.log(frontendOnlyBackendDriftMessage({ frontendCommit, backendCommit, releaseType: normalizedConfig.releaseType }));
    } else {
      expect(
        frontendBackendMatch,
        `frontend/backend commits should match unless release owner approved drift: frontend=${frontendCommit}, backend=${backendCommit}`,
      ).toBeTruthy();
    }
  }

  expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
}
