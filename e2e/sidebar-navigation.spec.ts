import { expect, test } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

test('sidebar navigation updates content without page refresh', async ({ page }) => {
  await loginAsAdmin(page);

  await page.locator('aside').getByRole('button', { name: /^Аренды/ }).click();
  await expect(page).toHaveURL(/#\/rentals$/);
  await expect(page.getByRole('heading', { name: 'Планировщик аренды' })).toBeVisible();

  await page.locator('aside').getByRole('button', { name: /^Сервис/ }).click();
  await expect(page).toHaveURL(/#\/service$/);
  await expect(page.getByRole('heading', { name: 'Сервис' })).toBeVisible();

  await page.locator('aside').getByRole('button', { name: 'Клиенты' }).click();
  await expect(page).toHaveURL(/#\/clients$/);
  await expect(page.getByRole('heading', { name: 'Клиенты', exact: true })).toBeVisible();
});

test('rentals page survives direct open on hash route', async ({ page }) => {
  await loginAsAdmin(page);
  await navigateInApp(page, '/rentals');

  await expect(page).toHaveURL(/#\/rentals$/);
  await expect(page.getByRole('heading', { name: 'Планировщик аренды' })).toBeVisible();
});
