import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { createClient, withAdminApi } from './helpers/api';

test('global search opens an existing client result', async ({ page }) => {
  const suffix = `global-search-${Date.now()}`;
  const client = await withAdminApi((api) => createClient(api, suffix));

  await loginAsAdmin(page);

  const search = page.locator('aside').getByPlaceholder('Поиск: техника, клиенты, аренды, сервис');
  await search.fill(client.inn);

  const result = page.locator('aside').getByRole('button', { name: new RegExp(client.company) });
  await expect(result).toBeVisible();
  await expect(result.getByText('Открыть')).toBeVisible();

  await result.click();

  await expect(page).toHaveURL(new RegExp(`#\\/clients\\/${client.id}$`));
  await expect(page.getByRole('heading', { name: client.company })).toBeVisible();
});
