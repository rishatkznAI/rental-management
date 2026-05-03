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

test('admin sees full backup block and download calls backup endpoint', async ({ page }) => {
  await loginAsAdmin(page);

  let backupRequested = false;
  await page.route('**/api/admin/backup/full', route => {
    backupRequested = true;
    return route.fulfill({
      status: 200,
      contentType: 'application/zip',
      headers: {
        'content-disposition': 'attachment; filename="skytech-backup-test.zip"',
      },
      body: 'PK\x05\x06'.padEnd(22, '\0'),
    });
  });

  await navigateInApp(page, '/admin');
  await page.getByRole('tab', { name: 'Данные системы' }).click();
  await expect(page.getByTestId('full-backup-card')).toContainText('Резервная копия');
  await page.getByTestId('full-backup-download').click();
  await expect.poll(() => backupRequested).toBe(true);
});
