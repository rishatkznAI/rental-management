import { expect, request, test } from '@playwright/test';
import { optionalEnv, requiredEnv, runReleaseSmoke } from './helpers/releaseSmoke';

function stagingAppUrl(frontendUrl: string, route = '/') {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return `${frontendUrl.replace(/\/$/, '')}/?debugVersion=1&_smoke=${Date.now()}#${normalizedRoute}`;
}

function hasUnsafeVisibleText(text: string) {
  return /undefined|null|\[object Object\]/.test(text);
}

test('staging read-only smoke', async ({ page }) => {
  test.setTimeout(180_000);
  const config = {
    environmentName: 'staging',
    frontendUrl: requiredEnv('STAGING_FRONTEND_URL', 'staging smoke'),
    apiUrl: requiredEnv('STAGING_API_URL', 'staging smoke'),
    adminEmail: requiredEnv('STAGING_ADMIN_EMAIL', 'staging smoke'),
    adminPassword: requiredEnv('STAGING_ADMIN_PASSWORD', 'staging smoke'),
    expectedCommit: optionalEnv('EXPECTED_RELEASE_COMMIT') || optionalEnv('GITHUB_SHA'),
  } as const;

  await runReleaseSmoke(page, config);

  const api = await request.newContext({ baseURL: config.apiUrl });
  try {
    const login = await api.post('/api/auth/login', {
      data: { email: config.adminEmail, password: config.adminPassword },
    });
    expect(login.ok(), 'staging admin login should work for attention API smoke').toBeTruthy();
    const token = ((await login.json().catch(() => null)) as { token?: string } | null)?.token;
    expect(token, 'staging admin login should return token for attention API smoke').toBeTruthy();

    const authedApi = await request.newContext({
      baseURL: config.apiUrl,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    try {
      const attention = await authedApi.get('/api/management/action-queue?view=attention');
      expect(attention.status(), 'attention action queue endpoint should return 200').toBe(200);
      const attentionJson = await attention.json();
      expect(attentionJson?.summary, 'attention action queue summary should exist').toBeTruthy();
      for (const key of ['critical', 'overdue', 'dueToday', 'unassigned', 'stale']) {
        expect(Number.isFinite(Number(attentionJson.summary[key])), `attention summary ${key} should be numeric`).toBeTruthy();
      }
      for (const key of ['critical', 'today', 'unassigned', 'topLoss', 'byResponsibleArea']) {
        expect(attentionJson?.groups?.[key], `attention group ${key} should exist`).toBeTruthy();
      }
      expect(JSON.stringify(attentionJson), 'attention API should not expose raw placeholders').not.toMatch(/undefined|\[object Object\]|password|token|secret/i);
    } finally {
      await authedApi.dispose();
    }
  } finally {
    await api.dispose();
  }

  await page.goto(stagingAppUrl(config.frontendUrl, '/'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Что требует внимания сегодня' })).toBeVisible();
  for (const label of ['Критично', 'Просрочено', 'Сегодня', 'Без ответственного', 'Потери сейчас', 'Потеря в день']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('link', { name: 'Открыть очередь' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Показать без ответственного' })).toHaveAttribute('href', /actionQueueFilter=unassigned/);
  await expect(page.getByRole('link', { name: 'Показать просроченные' })).toHaveAttribute('href', /actionQueueFilter=overdue/);

  await page.getByRole('link', { name: 'Показать без ответственного' }).click();
  await expect(page.getByText('Активный фильтр: Без ответственного')).toBeVisible();
  let actionQueueSection = page.getByTestId('management-action-queue-section');
  await expect(actionQueueSection.getByRole('button', { name: 'Без ответственного' })).toHaveAttribute('aria-pressed', 'true');
  expect(hasUnsafeVisibleText(await page.locator('main').innerText())).toBe(false);

  await page.goto(stagingAppUrl(config.frontendUrl, '/equipment?actionQueueFilter=overdue'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Активный фильтр: Просрочено')).toBeVisible();
  actionQueueSection = page.getByTestId('management-action-queue-section');
  await expect(actionQueueSection.getByRole('button', { name: 'Просрочено' })).toHaveAttribute('aria-pressed', 'true');
  expect(hasUnsafeVisibleText(await page.locator('main').innerText())).toBe(false);

  await page.goto(stagingAppUrl(config.frontendUrl, '/equipment?actionQueueFilter=unknown'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Активный фильтр: Все')).toBeVisible();
  actionQueueSection = page.getByTestId('management-action-queue-section');
  await expect(actionQueueSection.getByRole('button', { name: 'Все' })).toHaveAttribute('aria-pressed', 'true');
  expect(hasUnsafeVisibleText(await page.locator('main').innerText())).toBe(false);
});
