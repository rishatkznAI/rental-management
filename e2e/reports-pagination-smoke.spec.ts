import { expect, test, type Page } from '@playwright/test';
import { login, loginAsAdmin, navigateInApp } from './helpers/auth';
import { ensureUser, withAdminApi } from './helpers/api';

type UiIssue = {
  type: string;
  url: string;
  status?: number;
  text?: string;
};

function installGuards(page: Page, issues: UiIssue[], apiUrls: string[]) {
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/ResizeObserver loop|Download the React DevTools|favicon/i.test(text)) return;
    issues.push({ type: 'console.error', url: page.url(), text });
  });
  page.on('pageerror', error => {
    issues.push({ type: 'pageerror', url: page.url(), text: error.message });
  });
  page.on('response', response => {
    const url = response.url();
    if (url.includes('/api/')) apiUrls.push(url);
    const status = response.status();
    if (url.includes('/api/') && (status === 401 || status === 403 || status >= 500)) {
      issues.push({ type: 'bad-api-response', url, status });
    }
  });
}

async function selectTab(page: Page, name: string) {
  await page.getByRole('tab', { name }).click();
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
}

async function ensureRoleUser(role: string, suffix: string) {
  const roleSlug: Record<string, string> = {
    'Офис-менеджер': 'office',
    'Менеджер по аренде': 'rental-manager',
    'Инвестор': 'investor',
    'Механик': 'mechanic',
  };
  return withAdminApi(api => ensureUser(api, {
    name: `Reports ${role} ${suffix}`,
    email: `reports-${suffix}-${roleSlug[role] ?? 'role'}@example.local`,
    role,
    password: '1234',
  }));
}

async function expectAuthenticated(page: Page) {
  await expect(async () => {
    const loginVisible = await page.getByRole('heading', { name: 'Добро пожаловать' }).isVisible().catch(() => false);
    const shellVisible = await page.locator('aside').isVisible().catch(() => false);
    expect(loginVisible).toBeFalsy();
    expect(shellVisible).toBeTruthy();
  }).toPass();
}

test('Reports summary detail pagination smoke has no full-load endpoints', async ({ page }) => {
  test.setTimeout(90_000);
  const issues: UiIssue[] = [];
  const apiUrls: string[] = [];
  installGuards(page, issues, apiUrls);

  await loginAsAdmin(page);
  await navigateInApp(page, '/reports');

  await expect(page.getByRole('heading', { name: 'Отчёты' })).toBeVisible();
  await page.waitForLoadState('networkidle').catch(() => undefined);
  apiUrls.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Отчёты' })).toBeVisible();
  await expect(page.getByText('Текущая утилизация')).toBeVisible();
  await expect(page.getByText('Выручка по клиентам')).toBeVisible();

  await selectTab(page, 'Финансы');
  await expect(page.getByText('Фильтры финансов')).toBeVisible();
  await expect(page.getByText('Дебиторка по клиентам')).toBeVisible();
  await page.getByPlaceholder('Поиск по клиенту, менеджеру, технике или аренде').fill('test');
  await expect(page.locator('main').getByText(/Страница|Нет данных|Все аренды закрыты/).first()).toBeVisible();
  const financeDate = page.locator('input[type="date"]').first();
  await financeDate.fill('2026-05-01');

  await selectTab(page, 'Продажный склад');
  await expect(page.getByRole('heading', { name: 'Продажный склад' })).toBeVisible();
  const salesPageSize = page.locator('select').filter({ hasText: '50' }).first();
  if (await salesPageSize.count()) {
    await salesPageSize.selectOption('50').catch(() => undefined);
  }

  await selectTab(page, 'По сервису');
  await expect(page.getByText('Фильтры сервиса')).toBeVisible();
  await page.getByPlaceholder('Поиск по механику, заявке, технике или работе').fill('test');
  await expect(page.getByText('Детализация работ')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Повторные поломки' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Сводка по технике' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Проблемные модели' })).toBeVisible();
  const servicePageSize = page.locator('select').filter({ hasText: '50 строк' }).first();
  if (await servicePageSize.count()) {
    await servicePageSize.selectOption('50');
  }

  const managerSummaryResponse = page.waitForResponse(response => response.url().includes('/api/reports/managers/summary') && response.status() < 500);
  await selectTab(page, 'По менеджерам');
  await managerSummaryResponse;
  await expect(page.getByRole('heading', { name: 'Отчёт по менеджерам' })).toBeVisible();
  await expect(page.getByText('Сводно по менеджерам')).toBeVisible();
  const managerDetailsResponse = page.waitForResponse(response => response.url().includes('/api/reports/managers/details/') && response.status() < 500);
  await page.getByRole('button', { name: 'Детализация по арендам' }).click();
  await managerDetailsResponse;
  await expect(page.getByText(/Детализация|Нет данных|Аренды не найдены/).first()).toBeVisible();
  const managerDates = page.locator('input[type="date"]');
  await managerDates.first().fill('2026-05-01');

  const fullLoadPatterns = [
    /\/api\/equipment(?:\?|$)/,
    /\/api\/gantt_rentals(?:\?|$)/,
    /\/api\/rentals(?:\?|$)(?!.*paginated=true)/,
    /\/api\/clients(?:\?|$)/,
    /\/api\/payments(?:\?|$)/,
    /\/api\/documents(?:\?|$)/,
    /\/api\/service(?:\?|$)/,
  ];
  const fullLoads = apiUrls.filter(url => fullLoadPatterns.some(pattern => pattern.test(url)));
  expect(fullLoads).toEqual([]);
  expect(apiUrls.some(url => url.includes('/api/reports/managers/summary'))).toBeTruthy();
  expect(apiUrls.some(url => url.includes('/api/reports/managers/details/'))).toBeTruthy();
  expect(apiUrls.some(url => url.includes('/api/reports/service/details/repeated-failures'))).toBeTruthy();
  expect(apiUrls.some(url => url.includes('/api/reports/service/details/equipment-summary'))).toBeTruthy();
  expect(apiUrls.some(url => url.includes('/api/reports/service/details/problematic-models'))).toBeTruthy();
  expect(issues).toEqual([]);
});

test('Reports route policy follows scoped backend roles', async ({ page }) => {
  test.setTimeout(90_000);
  const suffix = String(Date.now()).slice(-8);
  const officeCredentials = await ensureRoleUser('Офис-менеджер', suffix);
  const rentalManagerCredentials = await ensureRoleUser('Менеджер по аренде', suffix);
  const investorCredentials = await ensureRoleUser('Инвестор', `${suffix}-investor`);
  const mechanicCredentials = await ensureRoleUser('Механик', `${suffix}-mechanic`);

  for (const { role, credentials } of [
    { role: 'Офис-менеджер' as const, credentials: officeCredentials },
    { role: 'Менеджер по аренде' as const, credentials: rentalManagerCredentials },
  ]) {
    const issues: UiIssue[] = [];
    const apiUrls: string[] = [];
    installGuards(page, issues, apiUrls);

    await page.goto('./#/login', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await login(page, credentials);
    await expectAuthenticated(page);
    apiUrls.length = 0;
    await navigateInApp(page, '/reports');
    await expect(page.getByRole('heading', { name: 'Отчёты' })).toBeVisible();
    apiUrls.length = 0;
    await expect(page.getByRole('button', { name: /^Отчёты/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Финансы' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'По менеджерам' })).toBeVisible();

    if (role === 'Менеджер по аренде') {
      await expect(page.getByRole('tab', { name: 'Продажный склад' })).toHaveCount(0);
      await expect(page.getByRole('tab', { name: 'По сервису' })).toHaveCount(0);
    } else {
      await expect(page.getByRole('tab', { name: 'Продажный склад' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'По сервису' })).toBeVisible();
    }

    await selectTab(page, 'Финансы');
    await expect(page.getByText('Фильтры финансов')).toBeVisible();
    await selectTab(page, 'По менеджерам');
    await expect(page.getByRole('heading', { name: 'Отчёт по менеджерам' })).toBeVisible();

    const fullLoads = apiUrls.filter(url => [
      /\/api\/equipment(?:\?|$)/,
      /\/api\/gantt_rentals(?:\?|$)/,
      /\/api\/payments(?:\?|$)/,
      /\/api\/payment_allocations(?:\?|$)/,
    ].some(pattern => pattern.test(url)));
    expect(fullLoads).toEqual([]);
    expect(issues).toEqual([]);
  }

  for (const { role, credentials } of [
    { role: 'Инвестор' as const, credentials: investorCredentials },
    { role: 'Механик' as const, credentials: mechanicCredentials },
  ]) {
    const issues: UiIssue[] = [];
    const apiUrls: string[] = [];
    installGuards(page, issues, apiUrls);

    await page.goto('./#/login', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await login(page, credentials);
    await expectAuthenticated(page);
    apiUrls.length = 0;
    await navigateInApp(page, '/reports');
    await expect(page).not.toHaveURL(/#\/reports$/);
    await expect(page.getByRole('button', { name: /^Отчёты/ })).toHaveCount(0);
    expect(apiUrls.some(url => url.includes('/api/reports/'))).toBeFalsy();
    expect(issues).toEqual([]);
  }
});
