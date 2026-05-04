import { expect, test } from '@playwright/test';
import { ADMIN_CREDENTIALS, login, loginAsAdmin } from './helpers/auth';

test('login page uses login field without email format validation', async ({ page }) => {
  await page.goto('./', { waitUntil: 'domcontentloaded' });

  await expect(page.getByLabel('Логин')).toBeVisible();
  await expect(page.getByPlaceholder('Например: ivanov')).toBeVisible();
  await expect(page.getByText('Email', { exact: true })).toHaveCount(0);

  await page.getByLabel('Логин').fill('not-an-email');
  await page.getByLabel('Пароль').fill('wrong-password');
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page.getByText('Некорректный email')).toHaveCount(0);
  await expect(page.getByText('Введите email')).toHaveCount(0);
  await expect(page.getByText('Неверный логин или пароль')).toBeVisible();
});

test('admin can sign in with login before @', async ({ page }) => {
  await login(page, { ...ADMIN_CREDENTIALS, login: 'admin' });

  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { name: 'Дашборд' })).toBeVisible();
});

test('admin can sign in and see dashboard shell', async ({ page }) => {
  await loginAsAdmin(page);

  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { name: 'Дашборд' })).toBeVisible();
  await expect(page.getByText('Задачи на сегодня')).toBeVisible();
  await page.getByRole('link', { name: 'Открыть центр задач' }).click();
  await expect(page).toHaveURL(/#\/tasks$/);
  await expect(page.getByRole('heading', { name: 'Центр задач' })).toBeVisible();
  await expect(page.getByText(/Всего задач/)).toBeVisible();
  await page.evaluate(() => { window.location.hash = '/'; });
  await expect(page.getByRole('heading', { name: 'Дашборд' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Что требует внимания сегодня' })).toBeVisible();
  await expect(page.getByText('План взыскания дебиторки')).toBeVisible();
  await expect(page.locator('aside').getByRole('button', { name: /^Аренды/ })).toBeVisible();
});
