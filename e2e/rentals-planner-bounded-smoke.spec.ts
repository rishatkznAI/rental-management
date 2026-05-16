import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { login, loginAsAdmin, navigateInApp } from './helpers/auth';
import {
  createClient,
  createClientRentalRelations,
  createEquipment,
  createRentalPair,
  ensureOfficeManager,
  ensureUser,
  withAdminApi,
} from './helpers/api';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

type UiIssue = {
  type: string;
  url: string;
  status?: number;
  text?: string;
};

function sanitize(text: string) {
  return text.replace(/[a-f0-9]{64}/gi, '[token]').slice(0, 800);
}

function installGuards(page: Page, issues: UiIssue[]) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/ResizeObserver loop|Download the React DevTools|favicon/i.test(text)) return;
    issues.push({ type: 'console.error', url: page.url(), text: sanitize(text) });
  });
  page.on('pageerror', (error) => {
    issues.push({ type: 'pageerror', url: page.url(), text: sanitize(error.stack || error.message) });
  });
  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    const isApi = /\/api\//.test(url);
    const anonymousMe = status === 401 && /\/api\/auth\/me$/.test(url);
    if (anonymousMe) return;
    if (status >= 500 || (isApi && [401, 403, 500].includes(status))) {
      issues.push({ type: 'bad-response', url, status });
    }
  });
}

function apiPath(url: string) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

async function seedRentalRows(api: APIRequestContext) {
  const suffix = String(Date.now()).slice(-8);
  const client = await createClient(api, `bounded-${suffix}`);
  const relations = await createClientRentalRelations(api, client.id, `bounded-${suffix}`);
  const rentals: Array<{ id: string; client: string }> = [];

  for (let index = 0; index < 28; index += 1) {
    const equipment = await createEquipment(api, `bounded-${suffix}-${index}`);
    const pair = await createRentalPair(api, {
      client: client.company,
      clientId: client.id,
      equipment,
      objectId: relations.object.id,
      contractId: relations.contract.id,
      startDate: `2026-06-${String((index % 20) + 1).padStart(2, '0')}`,
      endDate: `2026-07-${String((index % 20) + 1).padStart(2, '0')}`,
      status: 'active',
      ganttStatus: 'active',
      manager: 'Smoke Admin',
    });
    rentals.push(pair.rental);
  }

  return { client, rentals };
}

async function assertRentalsNetworkIsBounded(requests: string[]) {
  const paths = requests.map(apiPath);
  expect(paths.some(path => path.startsWith('/api/rentals?') && path.includes('paginated=true'))).toBeTruthy();
  expect(paths.some(path => path === '/api/rentals')).toBeFalsy();
  expect(paths.some(path => path === '/api/gantt_rentals')).toBeFalsy();
  expect(paths.some(path => path === '/api/equipment')).toBeFalsy();
}

test('admin rentals and planner use bounded server loading', async ({ page }) => {
  test.setTimeout(180_000);
  const issues: UiIssue[] = [];
  const requests: string[] = [];
  installGuards(page, issues);
  page.on('request', (request) => {
    if (request.url().includes('/api/')) requests.push(request.url());
  });

  const seed = await withAdminApi(seedRentalRows);
  requests.length = 0;

  await loginAsAdmin(page);
  requests.length = 0;
  await navigateInApp(page, '/rentals');
  await expect(page.getByRole('heading', { name: 'Аренды', level: 1 })).toBeVisible();
  await assertRentalsNetworkIsBounded(requests);

  const pageSize = page.locator('select[aria-label="Записей на странице"]').first();
  await expect(pageSize).toBeVisible();
  await pageSize.selectOption('25');
  await expect.poll(() => requests.map(apiPath).some(path => path.includes('/api/rentals?') && path.includes('pageSize=25'))).toBeTruthy();

  const next = page.getByRole('button', { name: 'Вперёд' }).first();
  await expect(next).toBeEnabled();
  await next.click();
  await expect.poll(() => requests.map(apiPath).some(path => path.includes('/api/rentals?') && path.includes('page=2'))).toBeTruthy();

  const search = page.getByPlaceholder('Клиент, техника, договор, ИНН').first();
  await search.fill(seed.client.company);
  await expect.poll(() => requests.map(apiPath).some(path => path.includes('/api/rentals?') && path.includes('page=1') && path.includes('search='))).toBeTruthy();
  await expect(page.locator('main')).toContainText(seed.client.company);

  const drawerButton = page.locator('button[title="Открыть боковую панель"]').first();
  await expect(drawerButton).toBeVisible();
  await drawerButton.click();
  await expect(page.getByRole('button', { name: 'Сроки и возврат' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Платежи' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Документы' }).first()).toBeVisible();
  await expect.poll(() => requests.map(apiPath).some(path => /\/api\/rentals\/[^/]+\/context$/.test(path))).toBeTruthy();
  await page.keyboard.press('Escape');

  requests.length = 0;
  await navigateInApp(page, '/planner');
  await expect(page.getByRole('heading', { name: 'Планировщик' })).toBeVisible();
  await expect.poll(() => requests.map(apiPath).some(path =>
    path.startsWith('/api/planner?') && path.includes('dateFrom=') && path.includes('dateTo='),
  )).toBeTruthy();
  expect(requests.map(apiPath).some(path => path === '/api/planner')).toBeFalsy();
  expect(requests.map(apiPath).some(path => path === '/api/gantt_rentals')).toBeFalsy();

  expect(issues).toEqual([]);
});

test('office manager rental manager and investor rentals smoke without forbidden API errors', async ({ page }) => {
  test.setTimeout(120_000);
  const issues: UiIssue[] = [];
  installGuards(page, issues);
  const suffix = String(Date.now()).slice(-8);
  const users = await withAdminApi(async (api) => ({
    office: await ensureOfficeManager(api, `bounded-${suffix}`),
    rentalManager: await ensureUser(api, {
      name: `Bounded Rental ${suffix}`,
      email: `bounded-rental-${suffix}@example.local`,
      role: 'Менеджер по аренде',
      password: '1234',
    }),
    investor: await ensureUser(api, {
      name: `Bounded Investor ${suffix}`,
      email: `bounded-investor-${suffix}@example.local`,
      role: 'Инвестор',
      password: '1234',
    }),
  }));

  for (const credentials of [users.office, users.rentalManager, users.investor]) {
    await login(page, credentials);
    await navigateInApp(page, '/rentals');
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/Cannot read properties|Unexpected Application Error/);
    await page.evaluate(() => window.localStorage.clear());
    await page.goto('./#/login', { waitUntil: 'domcontentloaded' });
  }

  expect(issues).toEqual([]);
});
