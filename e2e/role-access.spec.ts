import { expect, test } from '@playwright/test';
import { login, loginAsRentalManager, navigateInApp } from './helpers/auth';
import { ensureOfficeManager, withAdminApi } from './helpers/api';

test('office manager can open rental creation page but cannot edit an existing rental', async ({ page }) => {
  const suffix = `office-${Date.now()}`;
  const { officeManager } = await withAdminApi(async (api) => {
    const officeManager = await ensureOfficeManager(api, suffix);
    return { officeManager };
  });

  await login(page, officeManager);
  await expect(page.locator('aside').getByRole('button', { name: /^Аренды/ })).toBeVisible();

  await navigateInApp(page, '/rentals/new');
  await expect(page.getByRole('heading', { name: 'Новая аренда' })).toBeVisible();
});

test('rental manager is redirected away from rental creation page', async ({ page }) => {
  await loginAsRentalManager(page);
  await navigateInApp(page, '/rentals/new');

  await expect(page).toHaveURL(/#\/rentals$/);
  await expect(page.getByRole('heading', { name: 'Планировщик аренды' })).toBeVisible();
});
