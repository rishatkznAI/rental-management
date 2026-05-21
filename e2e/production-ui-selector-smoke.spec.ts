import { expect, request as playwrightRequest, test, type Locator, type Page } from '@playwright/test';
import { requiredEnv, runReleaseSmoke } from './helpers/releaseSmoke';

const EXPECTED_EXECUTION_LABELS = new Set(['Открыто', 'В работе', 'Отложено', 'Решено', 'Игнорировано']);
const SAFE_ASSIGNEE_FIELDS = ['userId', 'name', 'role', 'active'] as const;
const UNSAFE_ASSIGNEE_FIELDS = ['email', 'password', 'passwordHash', 'token', 'secret'] as const;
const UNSAFE_TEXT_PATTERN = /password|token|secret|Bearer\s+|undefined|\[object Object\]/i;

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

function countItems(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function numberSummaryValue(summary: Record<string, unknown> | undefined, key: string) {
  const value = summary?.[key];
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function hasOwnField(value: unknown, field: string) {
  return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, field));
}

function objectGraphHasKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some(item => objectGraphHasKey(item, key));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([entryKey, entryValue]) => entryKey === key || objectGraphHasKey(entryValue, key));
}

function safeSmokeLog(label: string, fields: Record<string, unknown>) {
  console.log(`[production-ui-selector-smoke] ${label} ${JSON.stringify(fields)}`);
}

async function expectColumnHeader(section: Locator, label: string | RegExp) {
  await expect(section.getByRole('columnheader', { name: label, exact: typeof label === 'string' })).toBeVisible();
}

test('production focused UI selector smoke stays read-only', async ({ page }) => {
  test.setTimeout(180_000);

  const blockedWrites = await installProductionReadOnlyGuard(page);
  const requestCounts = { readiness: 0, actionQueue: 0 };
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/equipment/readiness') requestCounts.readiness += 1;
    if (path === '/api/management/action-queue') requestCounts.actionQueue += 1;
  });
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
    const sccResponse = await api.get('/api/admin/system-control-center');
    expect(sccResponse.ok(), 'system control center GET should succeed').toBeTruthy();
    const scc = await sccResponse.json() as {
      conservation?: { appDisabled?: boolean; botDisabled?: boolean; gsmDisabled?: boolean };
      database?: { dbPathKind?: string };
      storage?: { classification?: string; signalPresent?: boolean };
    };
    expect(JSON.stringify(scc), 'system control center should not expose unsafe text').not.toMatch(UNSAFE_TEXT_PATTERN);
    const storageClassification = scc.storage?.classification || scc.database?.dbPathKind || 'unknown';
    safeSmokeLog('scc', {
      status: sccResponse.status(),
      appDisabled: Boolean(scc.conservation?.appDisabled),
      botDisabled: Boolean(scc.conservation?.botDisabled),
      gsmDisabled: Boolean(scc.conservation?.gsmDisabled),
      storageClassification,
      storageSignalPresent: Boolean(scc.storage?.signalPresent),
    });

    const queueStartedAt = Date.now();
    const queueResponse = await api.get('/api/management/action-queue');
    const queueDurationMs = Date.now() - queueStartedAt;
    expect(queueResponse.ok(), 'management action queue GET should succeed').toBeTruthy();
    const queue = await queueResponse.json() as {
      items?: Array<{ executionLabel?: string; executionStatus?: string; executionOverdue?: boolean }>;
      summary?: Record<string, unknown>;
    };
    const items = Array.isArray(queue.items) ? queue.items : [];
    const executionStatusPresent = items.every(item => hasOwnField(item, 'executionStatus'));
    const executionLabelPresent = items.every(item => hasOwnField(item, 'executionLabel'));
    const executionOverduePresent = items.every(item => hasOwnField(item, 'executionOverdue'));
    safeSmokeLog('actionQueue', {
      status: queueResponse.status(),
      durationMs: queueDurationMs,
      items: items.length,
      summaryUnassigned: numberSummaryValue(queue.summary, 'unassigned'),
      summaryOverdue: numberSummaryValue(queue.summary, 'overdue'),
      summaryDueToday: numberSummaryValue(queue.summary, 'dueToday'),
      summaryStale: numberSummaryValue(queue.summary, 'stale'),
      summaryInProgress: numberSummaryValue(queue.summary, 'inProgress'),
      summaryResolved: numberSummaryValue(queue.summary, 'resolved'),
      executionStatusPresent,
      executionLabelPresent,
      executionOverduePresent,
    });
    expect(items.length, 'management action queue should expose production items for selector smoke').toBeGreaterThan(0);
    expect(items.some(item => EXPECTED_EXECUTION_LABELS.has(String(item.executionLabel || ''))), 'queue API should expose known execution labels').toBeTruthy();
    expect(executionStatusPresent, 'queue API should expose execution status fields').toBeTruthy();
    expect(executionLabelPresent, 'queue API should expose execution label fields').toBeTruthy();
    expect(executionOverduePresent, 'queue API should expose execution overdue flags').toBeTruthy();

    const assigneesResponse = await api.get('/api/management/action-queue/assignees');
    expect(assigneesResponse.ok(), 'management action queue assignees GET should succeed').toBeTruthy();
    const assignees = await assigneesResponse.json() as { items?: Array<Record<string, unknown>> };
    const assigneeItems = Array.isArray(assignees.items) ? assignees.items : [];
    const safeFieldsPresent = SAFE_ASSIGNEE_FIELDS.every(field => assigneeItems.every(item => hasOwnField(item, field)));
    const unsafeFieldsAbsent = UNSAFE_ASSIGNEE_FIELDS.every(field => !objectGraphHasKey(assignees, field));
    safeSmokeLog('assignees', {
      status: assigneesResponse.status(),
      items: countItems(assignees.items),
      safeFieldsPresent,
      unsafeFieldsAbsent,
    });
    expect(safeFieldsPresent, 'assignees API should expose only expected safe identity fields').toBeTruthy();
    expect(unsafeFieldsAbsent, 'assignees API should not expose unsafe identity fields').toBeTruthy();
  } finally {
    await api.dispose();
  }

  const actionQueue = page.getByTestId('management-action-queue-section');
  await expect(actionQueue).toBeVisible();
  await expectColumnHeader(actionQueue, /^(Статус исполнения|Исполнение)$/);
  await expectColumnHeader(actionQueue, 'Ответственный');
  await expectColumnHeader(actionQueue, 'Ответственный блок');
  await expectColumnHeader(actionQueue, /^(Потеря|Уже потеряно)$/);
  await expectColumnHeader(actionQueue, 'Потеря/день');
  for (const label of ['Без ответственного', 'Просрочено', 'Сегодня', 'Зависли']) {
    await expect(actionQueue.getByText(label, { exact: true }).first(), `action queue KPI/filter ${label} should be visible`).toBeVisible();
  }
  for (const label of ['Без ответственного', 'Просрочено', 'Сегодня', 'Зависли']) {
    await expect(actionQueue.getByRole('button', { name: label, exact: true }), `action queue filter ${label} should be visible`).toBeVisible();
  }

  const firstActionRow = actionQueue.locator('tbody tr').first();
  await expect(firstActionRow, 'action queue should render at least one row').toBeVisible();
  const executionText = await cellText(firstActionRow, 4);
  expect([...EXPECTED_EXECUTION_LABELS].some(label => executionText.includes(label)), 'action queue row should render an execution label').toBeTruthy();
  expect((await cellText(firstActionRow, 2)).length, 'action queue row should render responsible field').toBeGreaterThan(0);
  expect((await cellText(firstActionRow, 6)).length, 'action queue row should render responsible area').toBeGreaterThan(0);
  expect((await cellText(firstActionRow, 7)).length, 'action queue row should render estimated loss').toBeGreaterThan(0);
  expect((await cellText(firstActionRow, 8)).length, 'action queue row should render estimated daily loss').toBeGreaterThan(0);
  await firstActionRow.getByRole('button', { name: 'Изменить' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Исполнение действия' });
  await expect(editDialog, 'action queue edit dialog should open without saving').toBeVisible();
  await editDialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(editDialog, 'action queue edit dialog should close without saving').toBeHidden();

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

  const visibleText = await page.locator('body').innerText();
  expect(visibleText, 'production UI should not render raw undefined/null/object placeholders').not.toMatch(/\bundefined\b|\bnull\b|\[object Object\]/i);
  expect(requestCounts.readiness, 'production UI selector smoke should not refetch readiness excessively').toBeLessThanOrEqual(3);
  expect(requestCounts.actionQueue, 'production UI selector smoke should not refetch action queue excessively').toBeLessThanOrEqual(3);
  expect(blockedWrites, 'production UI selector smoke must not attempt protected write endpoints').toEqual([]);
});
