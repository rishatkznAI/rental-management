import { expect, request, test } from '@playwright/test';
import { optionalEnv, requiredEnv, runReleaseSmoke } from './helpers/releaseSmoke';

function stagingAppUrl(frontendUrl: string, route = '/') {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return `${frontendUrl.replace(/\/$/, '')}/?debugVersion=1&_smoke=${Date.now()}#${normalizedRoute}`;
}

function hasUnsafeVisibleText(text: string) {
  return /undefined|null|\[object Object\]/.test(text);
}

function repeatBreakdownsShapeValid(payload: any) {
  if (!payload || payload.ok !== true || !payload.summary || !Array.isArray(payload.items) || !payload.groups) return false;
  for (const key of ['totalRepeats', 'repeatWithin7', 'repeatWithin14', 'repeatWithin30', 'critical', 'high', 'medium', 'low']) {
    if (!Number.isFinite(Number(payload.summary[key]))) return false;
  }
  for (const key of ['byEquipment', 'byMechanic', 'byModel', 'byScenario']) {
    if (!Array.isArray(payload.groups[key])) return false;
  }
  return payload.items.every((item: any) => (
    item
    && ['critical', 'high', 'medium', 'low'].includes(item.repeatSeverity)
    && [7, 14, 30].includes(Number(item.repeatWindow))
    && Number.isFinite(Number(item.daysBetween))
    && item.links
  ));
}

function hasUnsafePayloadText(payload: unknown) {
  return /password|token|secret|hash|email|Bearer\s+|undefined|\[object Object\]/i.test(JSON.stringify(payload));
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

      const repeatStarted = Date.now();
      const repeatBreakdowns = await authedApi.get('/api/service/repeat-breakdowns');
      const repeatDurationMs = Date.now() - repeatStarted;
      expect(repeatBreakdowns.status(), 'repeat breakdowns endpoint should return 200').toBe(200);
      const repeatJson = await repeatBreakdowns.json();
      expect(repeatBreakdownsShapeValid(repeatJson), 'repeat breakdowns response shape should match contract').toBe(true);
      expect(repeatJson.items.length, 'repeat breakdowns staging fixtures should produce populated rows').toBeGreaterThan(0);
      expect(Number(repeatJson.summary.totalRepeats || 0), 'repeat breakdowns totalRepeats should be non-zero').toBeGreaterThan(0);
      expect(Number(repeatJson.summary.critical || 0) + Number(repeatJson.summary.high || 0), 'repeat breakdowns should include high/critical fixtures').toBeGreaterThan(0);
      expect(Number(repeatJson.summary.medium || 0), 'repeat breakdowns should include medium fixtures').toBeGreaterThan(0);
      expect(Object.values(repeatJson.groups || {}).some((value: any) => Array.isArray(value) && value.length > 0), 'repeat breakdown groups should be non-zero').toBe(true);
      expect(repeatJson.items.some((item: any) => item.links?.equipment && item.links?.previousServiceTicket && item.links?.repeatServiceTicket), 'repeat breakdown links should be present').toBe(true);
      expect(hasUnsafePayloadText(repeatJson), 'repeat breakdowns API should not expose unsafe fields or placeholders').toBe(false);
      console.log(`[staging-smoke] repeatBreakdownsAPI ${JSON.stringify({
        status: repeatBreakdowns.status(),
        durationMs: repeatDurationMs,
        items: repeatJson.items.length,
        summaryKeys: Object.keys(repeatJson.summary || {}).sort(),
        groups: Object.fromEntries(Object.entries(repeatJson.groups || {}).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])),
        totalRepeats: Number(repeatJson.summary.totalRepeats || 0),
        repeatWithin7: Number(repeatJson.summary.repeatWithin7 || 0),
        repeatWithin14: Number(repeatJson.summary.repeatWithin14 || 0),
        repeatWithin30: Number(repeatJson.summary.repeatWithin30 || 0),
        critical: Number(repeatJson.summary.critical || 0),
        high: Number(repeatJson.summary.high || 0),
        medium: Number(repeatJson.summary.medium || 0),
        low: Number(repeatJson.summary.low || 0),
        linksPresent: repeatJson.items.some((item: any) => item.links?.equipment && item.links?.previousServiceTicket && item.links?.repeatServiceTicket),
      })}`);
    } finally {
      await authedApi.dispose();
    }
  } finally {
    await api.dispose();
  }

  await page.goto(stagingAppUrl(config.frontendUrl, '/'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Что требует внимания сегодня' })).toBeVisible();
  const dashboardAttentionBlock = page.getByTestId('dashboard-attention-block');
  for (const label of ['Критично', 'Просрочено', 'Сегодня', 'Без ответственного', 'Потери сейчас', 'Потеря в день']) {
    await expect(dashboardAttentionBlock.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(dashboardAttentionBlock.getByRole('link', { name: 'Открыть очередь' })).toBeVisible();
  await expect(dashboardAttentionBlock.getByRole('link', { name: 'Показать без ответственного' })).toHaveAttribute('href', /actionQueueFilter=unassigned/);
  await expect(dashboardAttentionBlock.getByRole('link', { name: 'Показать просроченные' })).toHaveAttribute('href', /actionQueueFilter=overdue/);

  await dashboardAttentionBlock.getByRole('link', { name: 'Показать без ответственного' }).click();
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

  const uiIssues: Array<{ type: string; url: string; status?: number; text?: string }> = [];
  let repeatBreakdownApiCalls = 0;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/ResizeObserver loop|Download the React DevTools|favicon/i.test(text)) return;
    uiIssues.push({ type: 'console.error', url: page.url(), text: text.slice(0, 500) });
  });
  page.on('response', (response) => {
    const url = response.url();
    if (/\/api\/service\/repeat-breakdowns($|\?)/.test(url)) repeatBreakdownApiCalls += 1;
    if (/\/api\//.test(url) && response.status() >= 400) {
      uiIssues.push({ type: 'api-error', url, status: response.status() });
    }
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || '';
    if (failure === 'net::ERR_ABORTED' || /favicon|\.map($|\?)/.test(request.url())) return;
    uiIssues.push({ type: 'requestfailed', url: request.url(), text: failure.slice(0, 500) });
  });

  await page.goto(stagingAppUrl(config.frontendUrl, '/service'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Сервис', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Повторные поломки/ }).click();
  await expect(page.getByRole('tab', { name: /Повторные поломки/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Повторов за 7 дней', { exact: true })).toBeVisible();
  await expect(page.getByText('Повторов за 30 дней', { exact: true })).toBeVisible();
  await expect(page.getByText('Критичные', { exact: true })).toBeVisible();
  await expect(page.getByText('Проблемная техника', { exact: true })).toBeVisible();
  await expect(page.getByText('Проблемные модели', { exact: true })).toBeVisible();
  await expect(page.getByText('Повторы по механику', { exact: true })).toBeVisible();
  await expect(page.getByText('Только high/critical', { exact: true })).toBeVisible();

  const main = page.locator('main');
  const repeatBreakdownsText = await main.innerText();
  expect(repeatBreakdownsText, 'repeat breakdown fixtures should show populated rows').toMatch(/STG-REPEAT-|Пред\.|Повтор/);
  expect(repeatBreakdownsText, 'repeat breakdowns should show non-zero summary or visible list content').toMatch(/Повторов:|STG-REPEAT-/);

  const highOnly = page.getByRole('button', { name: 'Только high/critical' });
  await highOnly.click();
  await expect(highOnly).toBeVisible();
  await expect(main.getByText(/Критично|Высокий/).first()).toBeVisible();
  await highOnly.click();

  const serviceLinks = main.getByRole('link', { name: /^(Техника|Пред\.|Повтор)$/ });
  const serviceLinkCount = await serviceLinks.count();
  expect(serviceLinkCount, 'repeat breakdown populated rows should include read-only links').toBeGreaterThan(0);
  const href = await serviceLinks.first().getAttribute('href');
  expect(href, 'repeat breakdowns read-only links should point to app detail routes').toMatch(/\/(equipment|service)\//);

  await page.waitForTimeout(2500);
  expect(repeatBreakdownApiCalls, 'repeat breakdowns query should run and not refetch-loop').toBeGreaterThan(0);
  expect(repeatBreakdownApiCalls, 'repeat breakdowns query should not refetch-loop').toBeLessThanOrEqual(2);
  expect(hasUnsafeVisibleText(await main.innerText())).toBe(false);
  expect(uiIssues, JSON.stringify(uiIssues, null, 2)).toEqual([]);
});
