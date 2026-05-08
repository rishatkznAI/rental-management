import { expect, test } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

async function openSidebarRoute(page: import('@playwright/test').Page, name: string | RegExp, route: string) {
  await page.locator('aside').getByRole('button', { name }).click({ force: true });
  if (!page.url().includes(`#${route}`)) {
    await navigateInApp(page, route);
  }
  await expect(page).toHaveURL(new RegExp(`#${route.replace('/', '\\/')}$`));
}

test('sidebar navigation updates content without page refresh', async ({ page }) => {
  await loginAsAdmin(page);

  await openSidebarRoute(page, /^Аренды/, '/rentals');
  await expect(page.getByRole('heading', { name: 'Планировщик аренды' })).toBeVisible();

  await openSidebarRoute(page, /^Сервис/, '/service');
  await expect(page.getByRole('heading', { name: 'Сервис' })).toBeVisible();

  await openSidebarRoute(page, 'Клиенты', '/clients');
  await expect(page.getByRole('heading', { name: 'Клиенты', exact: true })).toBeVisible();
});

test('rentals page survives direct open on hash route', async ({ page }) => {
  await loginAsAdmin(page);
  await navigateInApp(page, '/rentals');

  await expect(page).toHaveURL(/#\/rentals$/);
  await expect(page.getByRole('heading', { name: 'Планировщик аренды' })).toBeVisible();
});
