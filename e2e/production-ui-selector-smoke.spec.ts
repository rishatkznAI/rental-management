import { expect, request as playwrightRequest, test, type Locator, type Page } from '@playwright/test';
import { requiredEnv, runReleaseSmoke } from './helpers/releaseSmoke';
import { findUnsafePayloadViolations } from '../scripts/release-targeted-smoke.mjs';

const EXPECTED_EXECUTION_LABELS = new Set(['Открыто', 'В работе', 'Отложено', 'Решено', 'Игнорировано']);
const SAFE_ASSIGNEE_FIELDS = ['userId', 'name', 'role', 'active'] as const;
const UNSAFE_ASSIGNEE_FIELDS = ['email', 'password', 'passwordHash', 'token', 'secret'] as const;
const UNSAFE_VISIBLE_TEXT_PATTERN = /\bundefined\b|\bnull\b|\[object Object\]/i;
const CRM_ACTIVITY_CONTROL_SELECTOR = [
  '[data-testid="crm-add-call"]',
  '[data-testid="crm-add-visit"]',
  '[data-testid^="crm-activity"]',
].join(', ');

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function sanitizeUrl(url: string) {
  return url.replace(/[?&](token|password|secret|auth|access_token)=[^&]+/gi, '$1=[secret]');
}

function productionAppUrl(frontendUrl: string, route = '/') {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return `${frontendUrl.replace(/\/$/, '')}/?debugVersion=1&_smoke=${Date.now()}#${normalizedRoute}`;
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

function expectSafeApiPayload(payload: unknown, label: string) {
  expect(
    findUnsafePayloadViolations(payload),
    `${label} should not expose unsafe keys or raw placeholder string values`,
  ).toEqual([]);
}

function installSafeAggregateMonitor(page: Page, apiUrl: string) {
  const counts = {
    consoleErrors: 0,
    pageErrors: 0,
    apiErrors: 0,
  };

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/ResizeObserver loop|Download the React DevTools|favicon/i.test(text)) return;
    counts.consoleErrors += 1;
  });

  page.on('pageerror', () => {
    counts.pageErrors += 1;
  });

  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    const path = new URL(url).pathname;
    const isApi = url.startsWith(apiUrl) || /\/api\//.test(url);
    const expectedAnonymousMe = status === 401 && path === '/api/auth/me';
    if (isApi && status >= 400 && !expectedAnonymousMe) counts.apiErrors += 1;
  });

  return counts;
}

async function expectColumnHeader(section: Locator, label: string | RegExp) {
  await expect(section.getByRole('columnheader', { name: label, exact: typeof label === 'string' })).toBeVisible();
}

async function expectHealthyMain(page: Page, label: string) {
  const main = page.locator('main');
  await expect(main, `${label}: main should be visible`).toBeVisible();
  expect((await main.innerText()).trim().length, `${label}: main should not be blank`).toBeGreaterThan(10);
}

async function expectCrmHiddenFromNavigation(page: Page) {
  const nav = page.getByRole('navigation').first();
  await expect(nav, 'main navigation should be visible before CRM hidden checks').toBeVisible();
  await expect(nav.getByRole('button', { name: /^CRM$/ }), 'CRM nav item should be hidden while VITE_CRM_ENABLED is disabled').toHaveCount(0);
  await expect(nav.getByRole('link', { name: /^CRM$/ }), 'CRM nav link should be hidden while VITE_CRM_ENABLED is disabled').toHaveCount(0);
}

async function expectNoCrmActivityControls(scope: Locator, label: string) {
  await expect(scope.locator(CRM_ACTIVITY_CONTROL_SELECTOR), `${label}: CRM activity controls should not be mounted`).toHaveCount(0);
  await expect(scope.getByRole('button', { name: /^Звонок$/ }), `${label}: CRM call button should be hidden`).toHaveCount(0);
  await expect(scope.getByRole('button', { name: /^Выезд$/ }), `${label}: CRM visit button should be hidden`).toHaveCount(0);
  await expect(scope.getByRole('button', { name: /Добавить звонок/i }), `${label}: add CRM call action should be hidden`).toHaveCount(0);
  await expect(scope.getByRole('button', { name: /Добавить выезд/i }), `${label}: add CRM visit action should be hidden`).toHaveCount(0);
  await expect(scope.getByRole('link', { name: /Добавить звонок/i }), `${label}: add CRM call link should be hidden`).toHaveCount(0);
  await expect(scope.getByRole('link', { name: /Добавить выезд/i }), `${label}: add CRM visit link should be hidden`).toHaveCount(0);
}

async function firstHrefMatching(page: Page, patternSource: string) {
  return page.locator('main a').evaluateAll((links, source) => {
    const pattern = new RegExp(source);
    const match = links.find(link => pattern.test((link as HTMLAnchorElement).href));
    return match ? (match as HTMLAnchorElement).href : '';
  }, patternSource);
}

async function waitForHrefMatching(page: Page, patternSource: string, label: string) {
  await expect.poll(
    () => firstHrefMatching(page, patternSource),
    {
      message: label,
      timeout: 15_000,
      intervals: [250, 500, 1000],
    },
  ).not.toBe('');
  return firstHrefMatching(page, patternSource);
}

async function expectCrmDisabledUiHidden(page: Page, frontendUrl: string) {
  await expectCrmHiddenFromNavigation(page);
  await expectNoCrmActivityControls(page.locator('main'), 'dashboard/equipment shell');

  await page.goto(productionAppUrl(frontendUrl, '/clients'), { waitUntil: 'domcontentloaded' });
  await expectHealthyMain(page, 'clients');
  await expectNoCrmActivityControls(page.locator('main'), 'clients list');

  const firstClientHref = await waitForHrefMatching(
    page,
    String.raw`/clients/(?!new(?:$|[?#]))[^/?#]+`,
    'production CRM hidden smoke needs at least one loaded client card link',
  );
  await page.goto(firstClientHref, { waitUntil: 'domcontentloaded' });
  await expectHealthyMain(page, 'client card');
  await expectNoCrmActivityControls(page.locator('main'), 'client card');

  await page.goto(productionAppUrl(frontendUrl, '/sales'), { waitUntil: 'domcontentloaded' });
  const salesMain = page.locator('main');
  await expectHealthyMain(page, 'sales');
  await expectNoCrmActivityControls(salesMain, 'sales');
  expect(await salesMain.innerText(), 'sales page should not expose CRM blocks while CRM is disabled').not.toMatch(/\bCRM\b|Открыть CRM|лид|сделк|воронк/i);

  await page.goto(productionAppUrl(frontendUrl, '/service'), { waitUntil: 'domcontentloaded' });
  const serviceMain = page.locator('main');
  await expectHealthyMain(page, 'service');
  await expect(serviceMain.getByRole('button', { name: 'Выезд механика' }), 'service field mechanic action should stay visible').toBeVisible();
  await serviceMain.getByRole('button', { name: 'Выезд механика' }).click();
  await expectHealthyMain(page, 'service field mechanic action');

  await page.goto(productionAppUrl(frontendUrl, '/deliveries'), { waitUntil: 'domcontentloaded' });
  await expectHealthyMain(page, 'delivery');
}

test('production focused UI selector smoke stays read-only', async ({ page }) => {
  test.setTimeout(180_000);

  const blockedWrites = await installProductionReadOnlyGuard(page);
  const requestCounts = { readiness: 0, actionQueue: 0, attention: 0 };
  page.on('request', (request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/equipment/readiness') requestCounts.readiness += 1;
    if (path === '/api/management/action-queue' && url.searchParams.get('view') === 'attention') requestCounts.attention += 1;
    if (path === '/api/management/action-queue' && url.searchParams.get('view') !== 'attention') requestCounts.actionQueue += 1;
  });
  const apiUrl = requiredEnv('PRODUCTION_API_URL', 'production UI selector smoke').replace(/\/$/, '');
  const frontendUrl = requiredEnv('PRODUCTION_FRONTEND_URL', 'production UI selector smoke').replace(/\/$/, '');
  const expectedCommit = String(process.env.EXPECTED_RELEASE_COMMIT || '').trim();
  const safeAggregateCounts = installSafeAggregateMonitor(page, apiUrl);

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
    expectSafeApiPayload(scc, 'system control center');
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
    expectSafeApiPayload(queue, 'management action queue');
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

    const attentionStartedAt = Date.now();
    const attentionResponse = await api.get('/api/management/action-queue?view=attention');
    const attentionDurationMs = Date.now() - attentionStartedAt;
    expect(attentionResponse.ok(), 'management action queue attention GET should succeed').toBeTruthy();
    const attention = await attentionResponse.json() as {
      groups?: Record<string, unknown>;
      summary?: Record<string, unknown>;
    };
    expectSafeApiPayload(attention, 'attention action queue');
    safeSmokeLog('attention', {
      status: attentionResponse.status(),
      durationMs: attentionDurationMs,
      summaryCritical: numberSummaryValue(attention.summary, 'critical'),
      summaryOverdue: numberSummaryValue(attention.summary, 'overdue'),
      summaryDueToday: numberSummaryValue(attention.summary, 'dueToday'),
      summaryUnassigned: numberSummaryValue(attention.summary, 'unassigned'),
      summaryStale: numberSummaryValue(attention.summary, 'stale'),
      groupCritical: countItems(attention.groups?.critical),
      groupToday: countItems(attention.groups?.today),
      groupUnassigned: countItems(attention.groups?.unassigned),
      groupTopLoss: countItems(attention.groups?.topLoss),
      groupResponsibleArea: countItems(attention.groups?.byResponsibleArea),
    });

    const assigneesResponse = await api.get('/api/management/action-queue/assignees');
    expect(assigneesResponse.ok(), 'management action queue assignees GET should succeed').toBeTruthy();
    const assignees = await assigneesResponse.json() as { items?: Array<Record<string, unknown>> };
    expectSafeApiPayload(assignees, 'management action queue assignees');
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

  await expectCrmDisabledUiHidden(page, frontendUrl);

  await page.goto(productionAppUrl(frontendUrl, '/'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Дашборд', exact: true })).toBeVisible();

  await expect(page.getByTestId('dashboard-top-cockpit')).toBeVisible();
  await expect(page.getByTestId('dashboard-key-signals')).toBeVisible();
  await expect(page.getByTestId('dashboard-month-dynamics')).toBeVisible();
  await expect(page.getByTestId('dashboard-company-health')).toBeVisible();
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  const visualRects = await page.evaluate(() => {
    const rectFor = (testId: string) => {
      const element = document.querySelector(`[data-testid="${testId}"]`);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        height: Math.round(rect.height),
      };
    };
    const legacy = document.querySelector('[data-testid="dashboard-legacy-attention-list"]');
    return {
      keySignals: rectFor('dashboard-key-signals'),
      legacyAttentionList: rectFor('dashboard-legacy-attention-list'),
      monthDynamics: rectFor('dashboard-month-dynamics'),
      companyHealth: rectFor('dashboard-company-health'),
      legacyCollapsed: legacy?.tagName.toLowerCase() === 'details' && !(legacy as HTMLDetailsElement).open,
    };
  });
  expect(visualRects.keySignals?.top ?? Number.POSITIVE_INFINITY, 'key signals should be above fold').toBeLessThan(viewport.height);
  expect(
    (visualRects.monthDynamics?.top ?? Number.POSITIVE_INFINITY) < viewport.height
      || (visualRects.companyHealth?.top ?? Number.POSITIVE_INFINITY) < viewport.height,
    'month dynamics or company health should start inside desktop viewport',
  ).toBeTruthy();
  expect(
    visualRects.legacyCollapsed || (visualRects.legacyAttentionList?.top ?? 0) >= viewport.height,
    'legacy attention list should be collapsed or below fold',
  ).toBeTruthy();

  const attentionBlock = page.getByTestId('dashboard-attention-block');
  await expect(attentionBlock).toBeVisible();
  await expect(attentionBlock.getByRole('heading', { name: 'Главные сигналы сегодня' })).toBeVisible();
  for (const label of ['критично', 'высоко', 'средне', 'Без ответственного', 'Потери сейчас', 'Потеря в день']) {
    await expect(attentionBlock.getByText(label, { exact: true }).first(), `dashboard attention KPI ${label} should be visible`).toBeVisible();
  }
  await expect(attentionBlock.getByText('Загружаем очередь внимания...', { exact: true })).toBeHidden();
  const topActionRowCount = await attentionBlock.locator('a').evaluateAll(links =>
    links.filter(link => {
      const text = link.textContent?.replace(/\s+/g, ' ').trim() || '';
      return text
        && !['Открыть очередь', 'Показать без ответственного', 'Показать просроченные'].includes(text);
    }).length,
  );
  const hasEmptyState = await attentionBlock.getByText('Критичных действий на сегодня нет.', { exact: true }).count();
  expect(topActionRowCount + hasEmptyState, 'dashboard attention should render top actions or an empty state').toBeGreaterThan(0);
  await expect(attentionBlock.getByRole('link', { name: 'Открыть очередь' })).toBeVisible();
  await expect(attentionBlock.getByRole('link', { name: 'Показать без ответственного' })).toHaveAttribute('href', /actionQueueFilter=unassigned/);
  await expect(attentionBlock.getByRole('link', { name: 'Показать просроченные' })).toHaveAttribute('href', /actionQueueFilter=overdue/);
  safeSmokeLog('dashboardAttention', {
    blockVisible: true,
    kpiCardsVisible: true,
    topActionRows: topActionRowCount,
    emptyStateVisible: hasEmptyState > 0,
    openQueueLink: true,
    unassignedFilterLink: true,
    overdueFilterLink: true,
    viewport,
    visualRects,
  });

  await attentionBlock.getByRole('link', { name: 'Открыть очередь' }).click();
  let actionQueue = page.getByTestId('management-action-queue-section');
  await expect(actionQueue).toBeVisible();
  await expect(page.getByText('Активный фильтр: Все', { exact: true })).toBeVisible();
  await expect(actionQueue.getByRole('button', { name: 'Все', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.goto(productionAppUrl(frontendUrl, '/'), { waitUntil: 'domcontentloaded' });
  await page.getByTestId('dashboard-attention-block').getByRole('link', { name: 'Показать без ответственного' }).click();
  actionQueue = page.getByTestId('management-action-queue-section');
  await expect(actionQueue).toBeVisible();
  await expect(page.getByText('Активный фильтр: Без ответственного', { exact: true })).toBeVisible();
  await expect(actionQueue.getByRole('button', { name: 'Без ответственного', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.goto(productionAppUrl(frontendUrl, '/'), { waitUntil: 'domcontentloaded' });
  await page.getByTestId('dashboard-attention-block').getByRole('link', { name: 'Показать просроченные' }).click();
  actionQueue = page.getByTestId('management-action-queue-section');
  await expect(actionQueue).toBeVisible();
  await expect(page.getByText('Активный фильтр: Просрочено', { exact: true })).toBeVisible();
  await expect(actionQueue.getByRole('button', { name: 'Просрочено', exact: true })).toHaveAttribute('aria-pressed', 'true');
  safeSmokeLog('dashboardAttentionLinks', {
    openQueueFilterVisible: true,
    unassignedFilterVisible: true,
    overdueFilterVisible: true,
  });

  await page.goto(productionAppUrl(frontendUrl, '/equipment'), { waitUntil: 'domcontentloaded' });

  actionQueue = page.getByTestId('management-action-queue-section');
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
  expect(visibleText, 'production UI should not render raw undefined/null/object placeholders').not.toMatch(UNSAFE_VISIBLE_TEXT_PATTERN);
  safeSmokeLog('safeAggregates', {
    requestReadiness: requestCounts.readiness,
    requestActionQueue: requestCounts.actionQueue,
    requestAttention: requestCounts.attention,
    consoleErrors: safeAggregateCounts.consoleErrors,
    pageErrors: safeAggregateCounts.pageErrors,
    apiErrors: safeAggregateCounts.apiErrors,
  });
  expect(requestCounts.readiness, 'production UI selector smoke should not refetch readiness excessively').toBeLessThanOrEqual(6);
  expect(requestCounts.actionQueue, 'production UI selector smoke should not refetch action queue excessively').toBeLessThanOrEqual(6);
  expect(requestCounts.attention, 'production UI selector smoke should not refetch attention action queue excessively').toBeLessThanOrEqual(5);
  expect(safeAggregateCounts.consoleErrors, 'production UI selector smoke should not emit console errors').toBe(0);
  expect(safeAggregateCounts.pageErrors, 'production UI selector smoke should not emit page errors').toBe(0);
  expect(safeAggregateCounts.apiErrors, 'production UI selector smoke should not receive API errors').toBe(0);
  expect(blockedWrites, 'production UI selector smoke must not attempt protected write endpoints').toEqual([]);
});
