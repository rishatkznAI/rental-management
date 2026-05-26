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
  let historyRequests = 0;
  const history = [
    {
      id: 'AUD-test',
      createdAt: '2026-05-03T11:00:00.000Z',
      userName: 'Админ',
      role: 'Администратор',
      filename: 'skytech-backup-test.zip',
      size: 6724567,
      collectionsCount: 35,
      filesCount: 0,
    },
  ];
  await page.route('**/api/admin/backup/history**', route => {
    historyRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, history }),
    });
  });
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
  await expect(page.getByTestId('backup-history')).toContainText('История резервных копий');
  await expect(page.getByTestId('backup-history')).toContainText('skytech-backup-test.zip');
  await page.getByTestId('full-backup-download').click();
  await expect.poll(() => backupRequested).toBe(true);
  await expect.poll(() => historyRequests).toBeGreaterThan(1);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await navigateInApp(page, '/admin');
  await page.getByRole('tab', { name: 'Данные системы' }).click();
  await expect(page.getByTestId('backup-history')).toContainText('skytech-backup-test.zip');
});

test('admin data tab shows read-only data integrity diagnostics', async ({ page }) => {
  await loginAsAdmin(page);

  const requestedMethods: string[] = [];
  await page.route('**/api/admin/data-integrity-diagnostics', route => {
    requestedMethods.push(route.request().method());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        generatedAt: '2026-05-26T10:00:00.000Z',
        counts: {
          equipment: 10,
          rentals: 4,
          gantt_rentals: 5,
          service: 2,
          deliveries: 3,
          payments: 6,
          documents: 7,
          users: 8,
        },
        summary: { blocker: 1, high: 2, medium: 3, low: 4 },
        domains: {
          equipment: {
            issues: [{
              severity: 'BLOCKER',
              code: 'equipment_available_with_active_rental',
              title: 'Equipment is available with active rental',
              count: 1,
              examples: [{ id: 'EQ-1', entity: 'equipment', label: 'Lift', status: 'available', relatedId: 'R-1', passwordHash: 'must-not-render' }],
            }],
          },
          rentalsGantt: { issues: [] },
          service: { issues: [] },
          delivery: { issues: [] },
          finance: { issues: [] },
          documents: { issues: [] },
          usersBot: { issues: [] },
          references: { issues: [] },
        },
      }),
    });
  });

  await navigateInApp(page, '/admin');
  await page.getByRole('tab', { name: 'Данные системы' }).click();

  const diagnostics = page.getByTestId('data-integrity-diagnostics');
  await expect(diagnostics.getByRole('heading', { name: 'Диагностика данных' })).toBeVisible();
  await expect(diagnostics).toContainText('Read-only проверка связности и качества данных');
  await expect(diagnostics).toContainText('Техника');
  await expect(diagnostics).toContainText('10');
  await expect(diagnostics).toContainText('BLOCKER');
  await expect(diagnostics).toContainText('Свободная техника с активной арендой');
  await expect(diagnostics).toContainText('Проблем не найдено');
  await expect(diagnostics).not.toContainText('EQ-1');
  await expect(diagnostics).not.toContainText('must-not-render');

  await diagnostics.getByText('Показать примеры (1)').click();
  await expect(diagnostics).toContainText('EQ-1');
  await expect(diagnostics).not.toContainText('passwordHash');
  await expect(diagnostics).not.toContainText('must-not-render');
  expect(requestedMethods.every(method => method === 'GET')).toBe(true);
});
