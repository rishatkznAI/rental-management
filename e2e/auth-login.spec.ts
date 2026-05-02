import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

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
