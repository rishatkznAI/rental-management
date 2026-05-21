import { expect, request as playwrightRequest, test, type Locator, type Page } from '@playwright/test';
import { requiredEnv, runReleaseSmoke } from './helpers/releaseSmoke';

const EXPECTED_EXECUTION_LABELS = new Set(['Открыто', 'В работе', 'Отложено', 'Решено', 'Игнорировано']);

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function sanitizeUrl(url: string) {
  return url.replace(/[?&](token|password|secret|auth|access_token)=[^&]+/gi, '$1=[secret]');
}

async function installProductionReadOnlyGuard(page: Page) {
  const blocked: string[] = [];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = request.url();
    const path = new URL(url).pathname;
    const allowedAuthLogin = method === 'POST' && path === '/api/auth/login';
    const allowedRead = ['GET', 'HEAD', 'OPTIONS'].includes(method);

    if (allowedRead || allowedAuthLogin) {
      await route.continue();
      return;
    }

    blocked.push(`${method} ${sanitizeUrl(path)}`);
    await route.abort('blockedbyclient');
  });

  return blocked;
}

function cellText(row: Locator, index: number) {
  return row.locator('td').nth(index).innerText().then(text => text.trim()).catch(() => '');
}

test('production focused UI selector smoke stays read-only', async ({ page }) => {
  test.setTimeout(180_000);

  const blockedWrites = await installProductionReadOnlyGuard(page);
  const apiUrl = requiredEnv('PRODUCTION_API_URL', 'production UI selector smoke').replace(/\/$/, '');
  const frontendUrl = requiredEnv('PRODUCTION_FRONTEND_URL', 'production UI selector smoke').replace(/\/$/, '');
  const expectedCommit = String(process.env.EXPECTED_RELEASE_COMMIT || '').trim();

  const preflightApi = await playwrightRequest.newContext({ baseURL: apiUrl });
  try {
    const readinessResponse = await preflightApi.get('/health/ready');
    expect(readinessResponse.ok(), 'production /health/ready should return 200').toBeTruthy();
    const readiness = await readinessResponse.json() as { ok?: boolean };
    expect(readiness.ok, 'production /health/ready should report ok=true').toBe(true);

    const versionResponse = await preflightApi.get('/api/version');
    expect(versionResponse.ok(), 'production /api/version should return 200').toBeTruthy();
    const version = await versionResponse.json() as { app?: { disabled?: boolean } };
    expect(version.app?.disabled, 'production app.disabled should remain false for UI selector smoke').toBe(false);
  } finally {
    await preflightApi.dispose();
  }

  await runReleaseSmoke(page, {
    environmentName: 'production',
    frontendUrl,
    apiUrl,
    adminEmail: requiredEnv('PRODUCTION_ADMIN_EMAIL', 'production UI selector smoke'),
    adminPassword: requiredEnv('PRODUCTION_ADMIN_PASSWORD', 'production UI selector smoke'),
    expectedCommit,
    readOnlySections: [
      { label: 'Техника', route: '/equipment', nav: /^Техника/ },
    ],
  });

  const token = await page.evaluate(() => window.localStorage.getItem('app_auth_token') || '');
  expect(token, 'production UI selector smoke should have an auth token').toBeTruthy();

  const api = await playwrightRequest.newContext({
    baseURL: apiUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  try {
    const queueResponse = await api.get('/api/management/action-queue');
    expect(queueResponse.ok(), 'management action queue GET should succeed').toBeTruthy();
    const queue = await queueResponse.json() as {
      items?: Array<{ executionLabel?: string; executionStatus?: string; executionOverdue?: boolean }>;
    };
    const items = Array.isArray(queue.items) ? queue.items : [];
    expect(items.length, 'management action queue should expose production items for selector smoke').toBeGreaterThan(0);
    expect(items.some(item => EXPECTED_EXECUTION_LABELS.has(String(item.executionLabel || ''))), 'queue API should expose known execution labels').toBeTruthy();
    expect(items.every(item => Object.prototype.hasOwnProperty.call(item, 'executionOverdue')), 'queue API should expose execution overdue flags').toBeTruthy();
  } finally {
    await api.dispose();
  }

  const actionQueue = page.getByTestId('management-action-queue-section');
  await expect(actionQueue).toBeVisible();
  for (const header of ['Исполнение', 'Ответственный блок', 'Уже потеряно', 'Потеря/день']) {
    await expect(actionQueue.getByRole('columnheader', { name: header })).toBeVisible();
  }

  const firstActionRow = actionQueue.locator('tbody tr').first();
  await expect(firstActionRow, 'action queue should render at least one row').toBeVisible();
  const executionText = await cellText(firstActionRow, 2);
  expect([...EXPECTED_EXECUTION_LABELS].some(label => executionText.includes(label)), 'action queue row should render an execution label').toBeTruthy();
  expect((await cellText(firstActionRow, 4)).length, 'action queue row should render responsible area').toBeGreaterThan(0);
  expect((await cellText(firstActionRow, 5)).length, 'action queue row should render estimated loss').toBeGreaterThan(0);
  expect((await cellText(firstActionRow, 6)).length, 'action queue row should render estimated daily loss').toBeGreaterThan(0);

  const readiness = page.getByTestId('fleet-readiness-section');
  await expect(readiness).toBeVisible();
  for (const header of ['Потеря/день', 'Уже потеряно', 'Ответственный']) {
    await expect(readiness.getByRole('columnheader', { name: header })).toBeVisible();
  }

  const firstReadinessRow = readiness.locator('tbody tr').first();
  await expect(firstReadinessRow, 'fleet readiness should render at least one row').toBeVisible();
  expect((await cellText(firstReadinessRow, 4)).length, 'readiness row should render estimated daily loss').toBeGreaterThan(0);
  expect((await cellText(firstReadinessRow, 5)).length, 'readiness row should render estimated loss').toBeGreaterThan(0);
  expect((await cellText(firstReadinessRow, 6)).length, 'readiness row should render responsible field').toBeGreaterThan(0);

  expect(blockedWrites, 'production UI selector smoke must not attempt protected write endpoints').toEqual([]);
});
