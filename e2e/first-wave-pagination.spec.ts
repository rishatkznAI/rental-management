import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

type WavePage = {
  label: string;
  route: string;
  apiPath: RegExp;
  searchPlaceholder: RegExp;
  detailButton?: RegExp;
  createButton?: RegExp;
};

const WAVE_PAGES: WavePage[] = [
  {
    label: 'service',
    route: '/service',
    apiPath: /\/api\/service\?/,
    searchPlaceholder: /поиск/i,
    detailButton: /подробнее|открыть|редактировать/i,
    createButton: /новая заявка|создать/i,
  },
  {
    label: 'deliveries',
    route: '/deliveries',
    apiPath: /\/api\/deliveries\?/,
    searchPlaceholder: /поиск/i,
    detailButton: /открыть|редактировать|подробнее/i,
    createButton: /создать доставку|новая доставка/i,
  },
  {
    label: 'clients',
    route: '/clients',
    apiPath: /\/api\/clients\?/,
    searchPlaceholder: /поиск/i,
    createButton: /новый клиент|добавить/i,
  },
  {
    label: 'documents',
    route: '/documents',
    apiPath: /\/api\/documents\?/,
    searchPlaceholder: /поиск/i,
    detailButton: /просмотр|открыть|печать/i,
    createButton: /создать документ/i,
  },
  {
    label: 'payments',
    route: '/payments',
    apiPath: /\/api\/payments\?/,
    searchPlaceholder: /поиск/i,
    detailButton: /распределить|автозачёт|создать/i,
    createButton: /новый плат[её]ж|добавить плат[её]ж|создать/i,
  },
];

function installApiGuard(page: Page, failures: string[]) {
  page.on('console', message => {
    if (message.type() === 'error' && !/ResizeObserver|favicon|React DevTools/i.test(message.text())) {
      failures.push(`console: ${message.text()}`);
    }
  });
  page.on('response', response => {
    const status = response.status();
    if (/\/api\//.test(response.url()) && [401, 403, 500].includes(status)) {
      failures.push(`${status}: ${response.url()}`);
    }
  });
}

async function openFiltersIfNeeded(page: Page) {
  const filterButton = page.locator('main').getByRole('button', { name: /Фильтр|Фильтры/ }).first();
  if (await filterButton.isVisible().catch(() => false)) {
    await filterButton.click();
  }
}

async function paginationSmoke(page: Page, config: WavePage) {
  const responses: string[] = [];
  page.on('response', response => {
    if (config.apiPath.test(response.url())) responses.push(response.url());
  });

  await navigateInApp(page, config.route);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('main').getByText('На странице')).toBeVisible();

  const pageSize = page.locator('main').locator('select').filter({ hasText: /10|25|50|100/ }).last();
  await pageSize.selectOption('10');
  await expect.poll(
    () => responses.some(url => url.includes('paginated=true') && url.includes('pageSize=10')),
    { message: `${config.label}: pageSize change should hit paginated backend` },
  ).toBeTruthy();

  const next = page.locator('main').getByRole('button', { name: /Впер[её]д/ }).last();
  if (await next.isEnabled().catch(() => false)) {
    await next.click();
    await expect.poll(() => responses.some(url => /[?&]page=2(&|$)/.test(url))).toBeTruthy();
  }

  await openFiltersIfNeeded(page);
  const search = page.locator('main').getByPlaceholder(config.searchPlaceholder).first();
  if (await search.isVisible().catch(() => false)) {
    await search.fill(`smoke-${Date.now()}`);
    await expect.poll(() => responses.some(url => /[?&]page=1(&|$)/.test(url) && url.includes('search='))).toBeTruthy();
    await search.fill('');
  }

  await page.keyboard.press('Escape').catch(() => undefined);
  if (config.detailButton) {
    const detail = page.locator('main').getByRole('button', { name: config.detailButton }).first();
    if (await detail.isVisible().catch(() => false) && await detail.isEnabled().catch(() => false)) {
      await detail.click();
      await expect(page.locator('[role="dialog"]').first()).toBeVisible();
      await page.keyboard.press('Escape').catch(() => undefined);
    }
  }

  if (config.createButton) {
    const create = page.locator('main').getByRole('button', { name: config.createButton }).first();
    if (await create.isVisible().catch(() => false) && await create.isEnabled().catch(() => false)) {
      await create.click();
      await expect(page.locator('[role="dialog"]').first()).toBeVisible();
      await page.keyboard.press('Escape').catch(() => undefined);
    }
  }
}

test('first wave pages keep server-side pagination controls usable', async ({ page }) => {
  test.setTimeout(90_000);
  const failures: string[] = [];
  installApiGuard(page, failures);
  await loginAsAdmin(page);
  for (const config of WAVE_PAGES) {
    await paginationSmoke(page, config);
  }
  expect(failures, failures.join('\n')).toEqual([]);
});
