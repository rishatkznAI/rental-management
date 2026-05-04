import { expect, test } from '@playwright/test';
import { ADMIN_CREDENTIALS, login, loginAsAdmin } from './helpers/auth';

const SERVICE_ERROR_TEXT = 'Не удалось загрузить сервисные заявки. Попробуйте обновить страницу или обратитесь к администратору.';

async function expectStillAuthenticatedOnService(page: import('@playwright/test').Page) {
  await expect(page).toHaveURL(/#\/service$/);
  await expect(page.getByRole('heading', { name: 'Сервис' })).toBeVisible();
  await expect(page.locator('aside').getByRole('button', { name: /^Аренды/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
  await expect(page).not.toHaveURL(/#\/login/);
}

test('service tab shows controlled error and keeps session on /api/service 500', async ({ page }) => {
  await page.route('**/api/service', route => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: 'Service failed' }),
  }));

  await loginAsAdmin(page);
  await page.locator('aside').getByRole('button', { name: /^Сервис/ }).click();

  await expectStillAuthenticatedOnService(page);
  await expect(page.getByText(SERVICE_ERROR_TEXT)).toBeVisible();
});

test('service tab shows controlled error and keeps session on /api/service 403', async ({ page }) => {
  await page.route('**/api/service', route => route.fulfill({
    status: 403,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: 'Forbidden' }),
  }));

  await loginAsAdmin(page);
  await page.locator('aside').getByRole('button', { name: /^Сервис/ }).click();

  await expectStillAuthenticatedOnService(page);
  await expect(page.getByText(SERVICE_ERROR_TEXT)).toBeVisible();
});

test('service tab shows controlled error and keeps session on /api/service 401 when /api/auth/me is valid', async ({ page }) => {
  let authMeChecks = 0;

  await page.route('**/api/service', route => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: 'Unauthorized from service' }),
  }));
  await page.route('**/api/auth/me', route => {
    authMeChecks += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        user: {
          userId: 'U-default-admin',
          userName: 'Администратор',
          userRole: 'Администратор',
          rawRole: 'Администратор',
          normalizedRole: 'Администратор',
          permissions: { readableCollections: ['service'], writableCollections: ['service'] },
          email: ADMIN_CREDENTIALS.email,
        },
      }),
    });
  });

  await loginAsAdmin(page);
  await page.locator('aside').getByRole('button', { name: /^Сервис/ }).click();

  await expectStillAuthenticatedOnService(page);
  await expect(page.getByText(SERVICE_ERROR_TEXT)).toBeVisible();
  expect(authMeChecks).toBeGreaterThan(0);
});

test('service data 401 logs out only after /api/auth/me also returns 401', async ({ page }) => {
  await page.route('**/api/service', route => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: 'Unauthorized from service' }),
  }));
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: 'Session expired or invalid' }),
  }));

  await login(page, ADMIN_CREDENTIALS);

  await expect(page).toHaveURL(/#\/login$/);
});

test('auth login 401 follows unauthorized flow without entering the app', async ({ page }) => {
  await page.route('**/api/auth/login', route => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: 'Неверный логин или пароль' }),
  }));

  await login(page, ADMIN_CREDENTIALS);

  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByText('Неверный логин или пароль')).toBeVisible();
});

test('service tab renders legacy incomplete tickets without crashing', async ({ page }) => {
  await page.route('**/api/service', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      null,
      {
        id: 'S-legacy',
        equipmentInv: 'INV-legacy',
        status: null,
        priority: null,
        reason: null,
        description: null,
        createdAt: 'not-a-date',
      },
    ]),
  }));

  await loginAsAdmin(page);
  await page.locator('aside').getByRole('button', { name: /^Сервис/ }).click();

  await expectStillAuthenticatedOnService(page);
  await expect(page.getByText('S-legacy')).toBeVisible();
  await expect(page.getByText('INV: INV-legacy').first()).toBeVisible();
  await expect(page.getByText('Без причины')).toBeVisible();
});
