import { expect, test } from '@playwright/test';
import { ADMIN_CREDENTIALS, login, loginAsAdmin } from './helpers/auth';

test('login page uses login field without email format validation', async ({ page }) => {
  await page.goto('./', { waitUntil: 'domcontentloaded' });

  await expect(page.getByLabel('Логин')).toBeVisible();
  await expect(page.getByText('Email', { exact: true })).toHaveCount(0);

  await page.getByLabel('Логин').fill('not-an-email');
  await page.getByRole('textbox', { name: 'Пароль' }).fill('wrong-password');
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page.getByText('Некорректный email')).toHaveCount(0);
  await expect(page.getByText('Введите email')).toHaveCount(0);
  await expect(page.getByText('Неверный логин или пароль')).toBeVisible();
});

test('admin can sign in with login before @', async ({ page }) => {
  await login(page, { ...ADMIN_CREDENTIALS, login: 'smoke-admin' });

  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { name: 'Операционный центр' })).toBeVisible();
});

test('admin can sign in and see dashboard shell', async ({ page }) => {
  await loginAsAdmin(page);

  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { name: 'Операционный центр' })).toBeVisible();
  await expect(page.getByText('Пульт управления арендным бизнесом')).toBeVisible();
  await page.locator('aside').getByRole('button', { name: /^Центр задач/ }).click();
  await expect(page).toHaveURL(/#\/tasks$/);
  await expect(page.getByRole('heading', { name: 'Центр задач' })).toBeVisible();
  await expect(page.getByText(/Всего задач/)).toBeVisible();
  await page.evaluate(() => { window.location.hash = '/'; });
  await expect(page.getByRole('heading', { name: 'Операционный центр' })).toBeVisible();
  await expect(page.getByText('Пульт управления арендным бизнесом')).toBeVisible();
  await expect(page.locator('aside').getByRole('button', { name: /^Аренды/ })).toBeVisible();
});
