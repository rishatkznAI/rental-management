import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';

type BuildInfo = {
  commit?: string;
  commitFull?: string;
  buildTime?: string;
};

type UiIssue = {
  type: string;
  action: string;
  url: string;
  status?: number;
  text?: string;
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

const frontendUrl = requiredEnv('STAGING_FRONTEND_URL').replace(/\/$/, '');
const apiUrl = requiredEnv('STAGING_API_URL').replace(/\/$/, '');
const adminEmail = requiredEnv('STAGING_ADMIN_EMAIL');
const adminPassword = requiredEnv('STAGING_ADMIN_PASSWORD');

const READ_ONLY_SECTIONS: Array<{ label: string; route: string; nav: RegExp }> = [
  { label: 'Техника', route: '/equipment', nav: /^Техника/ },
  { label: 'Аренды', route: '/rentals', nav: /^Аренды/ },
  { label: 'Доставка', route: '/deliveries', nav: /^Доставка/ },
  { label: 'Сервис', route: '/service', nav: /^Сервис/ },
  { label: 'Документы', route: '/documents', nav: /^Документы/ },
  { label: 'Платежи', route: '/payments', nav: /^Платежи/ },
  { label: 'Финансы', route: '/finance', nav: /^Финансы/ },
  { label: 'GSM', route: '/gsm', nav: /^GSM/ },
];

function requiredEnv(name: string) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required for staging smoke`);
  return value;
}

function appUrl(route = '/') {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return `${frontendUrl}/?debugVersion=1&_smoke=${Date.now()}#${normalizedRoute}`;
}

function sanitize(text: string, limit = 1000) {
  return text.replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]').slice(0, limit);
}

function installReadOnlyGuards(page: Page, issues: UiIssue[], getAction: () => string) {
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
    const isApi = url.startsWith(apiUrl) || /\/api\//.test(url);
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

async function visibleBodyText(page: Page) {
  const text = await page.locator('body').innerText().catch(() => '');
  return sanitize(text.trim(), 1000);
}

async function failWithPageDiagnostics(page: Page, message: string): Promise<never> {
  throw new Error(`${message}
URL: ${page.url()}
Visible body text (first 1000 chars):
${await visibleBodyText(page)}`);
}

async function expectAdminLoginSucceeded(page: Page) {
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
    await failWithPageDiagnostics(page, 'Staging login failed');
  }

  if (loginState === 'pending') {
    await failWithPageDiagnostics(page, 'Staging login did not reach an authenticated app shell.');
  }

  if (page.url().includes('#/login')) {
    await failWithPageDiagnostics(page, 'Staging login did not leave the login route.');
  }

  await expect(dashboardHeading, 'dashboard heading should be visible after staging login').toBeVisible();
  await expect(nav, 'main navigation should be visible after staging login').toBeVisible();
}

test('staging read-only smoke', async ({ page }) => {
  test.setTimeout(180_000);
  const issues: UiIssue[] = [];
  let action = 'backend preflight';
  installReadOnlyGuards(page, issues, () => action);

  const api = await playwrightRequest.newContext({ baseURL: apiUrl });
  const health = await api.get('/health');
  expect(health.ok(), await health.text()).toBeTruthy();
  const healthJson = await health.json();
  expect(healthJson.ok).toBe(true);

  const version = await api.get('/api/version');
  expect(version.ok(), await version.text()).toBeTruthy();
  const versionJson = await version.json();
  expect(versionJson.ok).toBe(true);
  const backendBuild = (versionJson.build || {}) as BuildInfo;
  expect(backendBuild.commit || backendBuild.commitFull, 'backend commit should be exposed by /api/version').toBeTruthy();
  await api.dispose();

  action = 'frontend boot';
  await page.goto(appUrl('/login'), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__SKYTECH_BUILD_INFO__?.commit));
  const frontendBuild = await page.evaluate(() => window.__SKYTECH_BUILD_INFO__ || null);
  expect(frontendBuild?.commit, 'frontend commit should be available with debugVersion=1').toBeTruthy();

  action = 'admin login';
  await page.getByLabel('Логин').fill(adminEmail);
  await page.getByRole('textbox', { name: 'Пароль' }).fill(adminPassword);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expectAdminLoginSucceeded(page);
  await expectHealthyMain(page, 'dashboard');

  const token = await page.evaluate(() => window.localStorage.getItem('app_auth_token'));
  expect(token, 'admin login should store auth token').toBeTruthy();

  const authedApi = await playwrightRequest.newContext({
    baseURL: apiUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  const me = await authedApi.get('/api/auth/me');
  expect(me.ok(), await me.text()).toBeTruthy();
  await authedApi.dispose();

  for (const section of READ_ONLY_SECTIONS) {
    action = `section ${section.label}`;
    const navButton = page.getByRole('navigation').getByRole('button', { name: section.nav });
    await expect(navButton, `${section.label} nav should be visible for staging admin`).toBeVisible();
    await page.goto(appUrl(section.route), { waitUntil: 'domcontentloaded' });
    await expectHealthyMain(page, section.label);
  }

  action = 'commit match';
  const frontendCommit = frontendBuild?.commit || '';
  const backendCommit = backendBuild.commit || backendBuild.commitFull || '';
  if (frontendCommit && backendCommit) {
    expect(
      backendCommit.startsWith(frontendCommit) || frontendCommit.startsWith(backendCommit.slice(0, frontendCommit.length)),
      `frontend/backend commits should match unless Stage 3 defines allowed metadata-only drift: frontend=${frontendCommit}, backend=${backendCommit}`,
    ).toBeTruthy();
  }

  expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
});
