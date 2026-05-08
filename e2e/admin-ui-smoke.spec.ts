import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

type UiIssue = {
  type: string;
  action: string;
  url: string;
  text?: string;
  status?: number;
};

const ADMIN_SECTIONS: Array<{ name: RegExp; label: string; route: string }> = [
  { name: /^Дашборд/, label: 'Дашборд', route: '/' },
  { name: /^Техника/, label: 'Техника', route: '/equipment' },
  { name: /^GSM/, label: 'GSM', route: '/gsm' },
  { name: /^База знаний/, label: 'База знаний', route: '/knowledge-base' },
  { name: /^Продажи/, label: 'Продажи', route: '/sales' },
  { name: /^Доставка/, label: 'Доставка', route: '/deliveries' },
  { name: /^Аренды/, label: 'Аренды', route: '/rentals' },
  { name: /^Планировщик/, label: 'Планировщик', route: '/planner' },
  { name: /^Сервис/, label: 'Сервис', route: '/service' },
  { name: /^Сл\. машины/, label: 'Служебные машины', route: '/service-vehicles' },
  { name: /^Клиенты/, label: 'Клиенты', route: '/clients' },
  { name: /^Документы/, label: 'Документы', route: '/documents' },
  { name: /^Платежи/, label: 'Платежи', route: '/payments' },
  { name: /^Финансы/, label: 'Финансы', route: '/finance' },
  { name: /^Бот/, label: 'Бот', route: '/bots' },
  { name: /^Отчёты/, label: 'Отчёты', route: '/reports' },
  { name: /^Панель администратора/, label: 'Панель администратора', route: '/admin' },
  { name: /^Личные настройки/, label: 'Личные настройки', route: '/settings' },
];

function sanitize(text: string) {
  return text.replace(/[a-f0-9]{64}/gi, '[token]').slice(0, 800);
}

function isIgnoredRequestFailure(url: string, failure: string) {
  if (failure === 'net::ERR_ABORTED') return true;
  return /favicon|\.map($|\?)|fonts\.googleapis\.com|interactive-examples\.mdn\.mozilla\.net|tile\.openstreetmap\.org|\/node_modules\/\.vite\/deps\/|\/src\/app\/pages\//.test(url);
}

function installUiGuards(page: Page, issues: UiIssue[], getAction: () => string) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/ResizeObserver loop|Download the React DevTools|favicon/i.test(text)) return;
    issues.push({ type: 'console.error', action: getAction(), url: page.url(), text: sanitize(text) });
  });

  page.on('pageerror', (error) => {
    issues.push({ type: 'pageerror', action: getAction(), url: page.url(), text: sanitize(error.stack || error.message) });
  });

  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || '';
    if (isIgnoredRequestFailure(request.url(), failure)) return;
    issues.push({ type: 'requestfailed', action: getAction(), url: request.url(), text: sanitize(failure) });
  });

  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    const isApi = /\/api\//.test(url);
    const isExpectedAnonymousCheck = status === 401 && /\/api\/auth\/me$/.test(url) && getAction() === 'preflight';
    if (isExpectedAnonymousCheck) return;
    if (status >= 500 || (isApi && [400, 401, 403, 404, 409, 422].includes(status))) {
      issues.push({ type: 'bad-response', action: getAction(), url, status });
    }
  });
}

async function expectHealthyScreen(page: Page, action: string) {
  const main = page.locator('main');
  await expect(main, `${action}: main should be visible`).toBeVisible();
  const text = (await main.innerText()).trim();
  expect(text.length, `${action}: main should not be blank`).toBeGreaterThan(10);
  await expect(page.getByText(/Cannot read properties|Maximum update depth exceeded|Unexpected Application Error|Application error|Something went wrong|ошибка приложения/i)).toHaveCount(0);
}

async function openSectionFromSidebar(page: Page, section: { name: RegExp; label: string; route: string }) {
  const button = page.locator('aside').getByRole('button', { name: section.name });
  await expect(button, `${section.label} nav button should be visible`).toBeVisible();
  await button.click();
  await goToRoute(page, section.route);
  await expectHealthyScreen(page, `open ${section.label}`);
}

async function goToRoute(page: Page, route: string) {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  const appRoot = await page.evaluate(() => `${window.location.origin}${window.location.pathname}`);
  await page.goto(`${appRoot}?_smoke=${Date.now()}#${normalizedRoute}`, { waitUntil: 'domcontentloaded' });
}

async function exerciseVisibleTabs(page: Page, label: string) {
  const tabs = page.locator('main').getByRole('tab');
  const count = await tabs.count();
  for (let index = 0; index < Math.min(count, 8); index += 1) {
    const tab = tabs.nth(index);
    if (await tab.isVisible() && await tab.isEnabled()) {
      await tab.click();
      await expectHealthyScreen(page, `${label} tab ${index + 1}`);
    }
  }
}

async function exerciseFilters(page: Page, label: string) {
  const filters = page.locator('main').getByRole('button', { name: /Фильтры|Фильтр/ });
  if ((await filters.count()) === 0) return;
  const first = filters.first();
  if (!(await first.isVisible()) || !(await first.isEnabled())) return;
  await first.click();
  await expectHealthyScreen(page, `${label} filters`);
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) {
    const done = dialog.getByRole('button', { name: /Готово|Применить|Закрыть|Отмена/ });
    if ((await done.count()) > 0 && await done.first().isVisible()) {
      await done.first().click();
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(dialog).toBeHidden();
  }
}

test('smoke-admin can click admin UI sections without runtime errors', async ({ page, request }) => {
  test.setTimeout(120_000);
  const issues: UiIssue[] = [];
  let action = 'preflight';
  installUiGuards(page, issues, () => action);

  const health = await request.get('http://127.0.0.1:3000/health');
  expect(health.ok()).toBeTruthy();
  const version = await request.get('http://127.0.0.1:3000/api/version');
  expect(version.ok()).toBeTruthy();
  const anonymousMe = await request.get('http://127.0.0.1:3000/api/auth/me');
  expect(anonymousMe.status()).toBe(401);

  action = 'login smoke-admin';
  await loginAsAdmin(page);
  const token = await page.evaluate(() => window.localStorage.getItem('app_auth_token'));
  expect(token).toBeTruthy();
  const me = await request.get('http://127.0.0.1:3000/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(me.ok()).toBeTruthy();
  const meJson = await me.json();
  expect(meJson.user.userRole).toBe('Администратор');

  for (const section of ADMIN_SECTIONS) {
    action = `section ${section.label}`;
    await openSectionFromSidebar(page, section);
    await exerciseVisibleTabs(page, section.label);
    await exerciseFilters(page, section.label);
  }

  action = 'admin references regression';
  await page.locator('aside').getByRole('button', { name: /^Панель администратора/ }).click();
  await page.getByRole('tab', { name: 'Справочники' }).click();
  await expect(page.getByText('Механики')).toBeVisible();
  await expect(page.getByText('Перевозчики')).toBeVisible();
  await expectHealthyScreen(page, action);

  expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
});
