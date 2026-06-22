import { expect, test, type Page } from '@playwright/test';
import { optionalEnv, requiredEnv } from './helpers/releaseSmoke';

test.use({ trace: 'off', screenshot: 'only-on-failure', video: 'retain-on-failure' });

type RoleSmokeConfig = {
  key: 'rental-manager' | 'mechanic' | 'investor' | 'carrier';
  label: string;
  emailEnv: string;
  passwordEnv: string;
  primaryRoute: string;
  primaryHeading?: RegExp;
  extraRoutes?: string[];
  expectedNav?: RegExp[];
  forbiddenAssigneeRequest?: boolean;
};

type UiIssue = {
  type: string;
  role: string;
  action: string;
  url: string;
  status?: number;
  text?: string;
};

const ROLE_SMOKES: RoleSmokeConfig[] = [
  {
    key: 'rental-manager',
    label: 'rental manager',
    emailEnv: 'PRODUCTION_RENTAL_MANAGER_EMAIL',
    passwordEnv: 'PRODUCTION_RENTAL_MANAGER_PASSWORD',
    primaryRoute: '/rentals',
    primaryHeading: /Аренды|Планирование аренды|Реестр аренд/i,
    extraRoutes: ['/'],
    expectedNav: [/^Дашборд/, /^Аренды/],
  },
  {
    key: 'mechanic',
    label: 'mechanic',
    emailEnv: 'PRODUCTION_MECHANIC_EMAIL',
    passwordEnv: 'PRODUCTION_MECHANIC_PASSWORD',
    primaryRoute: '/service',
    primaryHeading: /Сервис|Заявки|Ремонт/i,
    extraRoutes: ['/service-vehicles'],
    expectedNav: [/^Сервис/, /^Сл\. машины|^Служебные машины/],
  },
  {
    key: 'investor',
    label: 'investor',
    emailEnv: 'PRODUCTION_INVESTOR_EMAIL',
    passwordEnv: 'PRODUCTION_INVESTOR_PASSWORD',
    primaryRoute: '/equipment',
    primaryHeading: /Техника|Парк/i,
    expectedNav: [/^Техника/],
    forbiddenAssigneeRequest: true,
  },
  {
    key: 'carrier',
    label: 'carrier',
    emailEnv: 'PRODUCTION_CARRIER_EMAIL',
    passwordEnv: 'PRODUCTION_CARRIER_PASSWORD',
    primaryRoute: '/deliveries',
    primaryHeading: /Доставка|Перевоз|Маршрут/i,
    expectedNav: [/^Доставка/],
  },
];

function shortCommit(value = '') {
  return value.trim().slice(0, 12);
}

function commitsMatch(left = '', right = '') {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  return Boolean(normalizedLeft && normalizedRight)
    && (normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft));
}

function sanitize(text = '', limit = 800) {
  return text
    .replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [token]')
    .slice(0, limit);
}

function productionAppUrl(frontendUrl: string, route = '/') {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return `${frontendUrl.replace(/\/$/, '')}/?debugVersion=1&_roleSmoke=${Date.now()}#${normalizedRoute}`;
}

async function installReadOnlyNetworkGuard(page: Page) {
  const blockedWrites: string[] = [];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const path = new URL(request.url()).pathname;
    const allowedLogin = method === 'POST' && path === '/api/auth/login';
    const allowedRead = ['GET', 'HEAD', 'OPTIONS'].includes(method);

    if (allowedLogin || allowedRead) {
      await route.continue();
      return;
    }

    blockedWrites.push(`${method} ${path}`);
    await route.abort('blockedbyclient');
  });

  return blockedWrites;
}

function installIssueMonitor(page: Page, apiUrl: string, role: string, getAction: () => string) {
  const issues: UiIssue[] = [];
  const assigneeRequests: Array<{ status?: number; url: string }> = [];

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/ResizeObserver loop|Download the React DevTools|favicon/i.test(text)) return;
    issues.push({ type: 'console.error', role, action: getAction(), url: page.url(), text: sanitize(text) });
  });

  page.on('pageerror', (error) => {
    issues.push({ type: 'pageerror', role, action: getAction(), url: page.url(), text: sanitize(error.stack || error.message) });
  });

  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || '';
    if (failure === 'net::ERR_ABORTED' || /favicon|\.map($|\?)/.test(request.url())) return;
    issues.push({ type: 'requestfailed', role, action: getAction(), url: request.url(), text: sanitize(failure) });
  });

  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/management/action-queue/assignees') {
      assigneeRequests.push({ url: request.url() });
    }
  });

  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    const path = new URL(url).pathname;
    const isApi = url.startsWith(apiUrl) || /\/api\//.test(url);

    if (path === '/api/management/action-queue/assignees') {
      const last = assigneeRequests[assigneeRequests.length - 1];
      if (last) last.status = status;
      else assigneeRequests.push({ url, status });
    }
    if (status >= 500) {
      issues.push({ type: 'http-5xx', role, action: getAction(), url, status });
      return;
    }
    if (isApi && path === '/api/management/action-queue/assignees' && status === 403) {
      issues.push({ type: 'forbidden-assignees', role, action: getAction(), url, status });
    }
  });

  return { issues, assigneeRequests };
}

async function expectHealthyMain(page: Page, label: string) {
  const main = page.locator('main');
  await expect(main, `${label}: main should be visible`).toBeVisible();
  const text = (await main.innerText()).trim();
  expect(text.length, `${label}: main should not be blank`).toBeGreaterThan(10);
  expect(text, `${label}: visible text should not expose placeholder values`).not.toMatch(/\bundefined\b|\bnull\b|\bNaN\b|\[object Object\]/i);
  await expect(page.getByText(/Cannot read properties|Maximum update depth exceeded|Unexpected Application Error|Application error|Something went wrong|ошибка приложения/i)).toHaveCount(0);
}

async function expectLoggedInShell(page: Page, roleLabel: string) {
  await expect
    .poll(
      async () => {
        const onLogin = page.url().includes('#/login');
        const navVisible = await page.getByRole('navigation').first().isVisible().catch(() => false);
        const logoutVisible = await page.getByRole('button', { name: 'Выйти' }).isVisible().catch(() => false);
        return !onLogin && (navVisible || logoutVisible);
      },
      { message: `${roleLabel} should reach authenticated shell`, timeout: 20_000 },
    )
    .toBe(true);
  await expectHealthyMain(page, `${roleLabel} authenticated shell`);
}

async function login(page: Page, frontendUrl: string, email: string, password: string, roleLabel: string) {
  await page.goto(productionAppUrl(frontendUrl, '/login'), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__SKYTECH_BUILD_INFO__?.commit));
  await page.getByLabel('Логин').fill(email);
  await page.getByRole('textbox', { name: 'Пароль' }).fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expectLoggedInShell(page, roleLabel);
}

async function expectFrontendMarker(page: Page, frontendUrl: string, apiUrl: string, expectedCommit: string) {
  await page.goto(productionAppUrl(frontendUrl, '/login'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__SKYTECH_BUILD_INFO__?.commit));
  const build = await page.evaluate(() => window.__SKYTECH_BUILD_INFO__ || null);
  expect(build?.apiBaseUrl, 'frontend build marker should point at production API').toBe(apiUrl);
  if (expectedCommit) {
    expect(
      commitsMatch(build?.commit || '', shortCommit(expectedCommit)),
      `frontend commit should match expected release commit: expected=${shortCommit(expectedCommit)}, frontend=${build?.commit || 'missing'}`,
    ).toBeTruthy();
  }
}

test.describe('production role-specific smoke', () => {
  for (const role of ROLE_SMOKES) {
    test(`${role.label} opens permitted production UI without crash`, async ({ page }) => {
      test.setTimeout(120_000);

      const frontendUrl = requiredEnv('PRODUCTION_FRONTEND_URL', 'production role smoke').replace(/\/$/, '');
      const apiUrl = requiredEnv('PRODUCTION_API_URL', 'production role smoke').replace(/\/$/, '');
      const expectedCommit = optionalEnv('EXPECTED_RELEASE_COMMIT');
      const email = requiredEnv(role.emailEnv, `${role.label} production role smoke`);
      const password = requiredEnv(role.passwordEnv, `${role.label} production role smoke`);
      let action = 'frontend marker';
      const blockedWrites = await installReadOnlyNetworkGuard(page);
      const monitor = installIssueMonitor(page, apiUrl, role.label, () => action);

      await expectFrontendMarker(page, frontendUrl, apiUrl, expectedCommit);

      action = `${role.label} login`;
      await login(page, frontendUrl, email, password, role.label);

      const nav = page.getByRole('navigation').first();
      await expect(nav, `${role.label}: navigation should be visible`).toBeVisible();
      for (const navLabel of role.expectedNav || []) {
        await expect(nav.getByRole('button', { name: navLabel }), `${role.label}: ${navLabel} nav should be visible`).toBeVisible();
      }

      action = `${role.label} route ${role.primaryRoute}`;
      await page.goto(productionAppUrl(frontendUrl, role.primaryRoute), { waitUntil: 'domcontentloaded' });
      await expectHealthyMain(page, `${role.label} ${role.primaryRoute}`);

      if (role.primaryHeading) {
        await expect(
          page.locator('main').getByRole('heading', { name: role.primaryHeading }).first(),
          `${role.label}: expected working section heading should be visible`,
        ).toBeVisible();
      }

      for (const route of role.extraRoutes || []) {
        action = `${role.label} route ${route}`;
        await page.goto(productionAppUrl(frontendUrl, route), { waitUntil: 'domcontentloaded' });
        await expectHealthyMain(page, `${role.label} ${route}`);
      }

      if (role.forbiddenAssigneeRequest) {
        expect(
          monitor.assigneeRequests,
          'investor UI must not call /api/management/action-queue/assignees',
        ).toEqual([]);
      }

      expect(blockedWrites, `${role.label}: smoke must stay read-only after login`).toEqual([]);
      expect(monitor.issues, JSON.stringify(monitor.issues, null, 2)).toEqual([]);
    });
  }
});
