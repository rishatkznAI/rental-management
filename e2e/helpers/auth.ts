import { expect, type Page } from '@playwright/test';

type Credentials = {
  email: string;
  password: string;
};

export const ADMIN_CREDENTIALS: Credentials = {
  email: 'admin@rental.local',
  password: 'admin123',
};

export const RENTAL_MANAGER_CREDENTIALS: Credentials = {
  email: 'mp2@mantall.ru',
  password: '1234',
};

export async function login(page: Page, credentials: Credentials) {
  await page.goto('./');
  await page.getByPlaceholder('example@company.ru').fill(credentials.email);
  await page.getByPlaceholder('••••••••').fill(credentials.password);
  await page.getByRole('button', { name: 'Войти' }).click();
}

export async function loginAsAdmin(page: Page) {
  await login(page, ADMIN_CREDENTIALS);
  await expect(page.getByRole('heading', { name: 'Дашборд' })).toBeVisible();
}

export async function loginAsRentalManager(page: Page) {
  await login(page, RENTAL_MANAGER_CREDENTIALS);
  await expect(async () => {
    const dashboardVisible = await page.getByRole('heading', { name: 'Дашборд' }).isVisible().catch(() => false);
    const equipmentVisible = await page.getByRole('heading', { name: 'Техника' }).isVisible().catch(() => false);
    expect(dashboardVisible || equipmentVisible).toBeTruthy();
  }).toPass();
}
