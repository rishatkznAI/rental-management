import { expect, type Page } from '@playwright/test';

type Credentials = {
  email: string;
  login?: string;
  password: string;
};

export const ADMIN_CREDENTIALS: Credentials = {
  email: 'smoke-admin@yandex.ru',
  password: '123123',
};

export const RENTAL_MANAGER_CREDENTIALS: Credentials = {
  email: 'mp2@mantall.ru',
  password: '1234',
};

export async function login(page: Page, credentials: Credentials) {
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Логин').fill(credentials.login ?? credentials.email);
  await page.getByLabel('Пароль').fill(credentials.password);
  await page.getByRole('button', { name: 'Войти' }).click();
}

export async function loginAsAdmin(page: Page) {
  await login(page, ADMIN_CREDENTIALS);
  await expect(page.getByRole('heading', { name: 'Дашборд' })).toBeVisible();
}

export async function navigateInApp(page: Page, route: string) {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  await page.evaluate((nextRoute) => {
    window.location.hash = nextRoute;
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  }, normalizedRoute);
}

async function expectAuthenticatedShell(page: Page) {
  await expect(async () => {
    const currentUrl = page.url();
    const isStillOnLogin = currentUrl.includes('#/login');
    const rentalsNavVisible = await page.locator('aside').getByRole('button', { name: /^Аренды/ }).isVisible().catch(() => false);
    const logoutVisible = await page.getByRole('button', { name: 'Выйти' }).isVisible().catch(() => false);

    expect(isStillOnLogin).toBeFalsy();
    expect(rentalsNavVisible || logoutVisible).toBeTruthy();
  }).toPass();
}

export async function loginAsRentalManager(page: Page) {
  const { ensureUser, withAdminApi } = await import('./api');
  await withAdminApi((api) => ensureUser(api, {
    name: 'mp2',
    email: RENTAL_MANAGER_CREDENTIALS.email,
    role: 'Менеджер по аренде',
    password: RENTAL_MANAGER_CREDENTIALS.password,
  }));
  await login(page, RENTAL_MANAGER_CREDENTIALS);
  await expectAuthenticatedShell(page);
}
