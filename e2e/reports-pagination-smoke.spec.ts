import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

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
  const servicePageSize = page.locator('select').filter({ hasText: '50 строк' }).first();
  if (await servicePageSize.count()) {
    await servicePageSize.selectOption('50');
  }

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
  expect(issues).toEqual([]);
});
