import { expect, test } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

test('admin diagnostics tab shows backend fallback when diagnostics endpoint fails', async ({ page }) => {
  await loginAsAdmin(page);

  await page.route('**/api/admin/production-diagnostics', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: 'diagnostics unavailable' }),
  }));

  await navigateInApp(page, '/admin');
  await page.getByRole('tab', { name: 'Диагностика' }).click();

  await expect(page.getByRole('heading', { name: 'Production diagnostics' })).toBeVisible();
  await expect(page.getByTestId('diagnostics-backend-error')).toContainText('Диагностика backend недоступна');
  await expect(page.getByText('VITE_API_URL')).toBeVisible();
});
