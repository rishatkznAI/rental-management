import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient, withAdminApi } from './helpers/api';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

type AuditIssue = {
  type: string;
  action: string;
  url: string;
  status?: number;
  text?: string;
};

type AuditReport = {
  startedAt: string;
  completedAt?: string;
  routes: Array<{ label: string; route: string; screenshot: string }>;
  zeroCollections: Record<string, number>;
  openingReceivable?: {
    clientId: string;
    counterpartyId: string;
    amount: number;
    revision: number;
    paymentsCount: number;
    financeOperationsCount: number;
  };
  issues: AuditIssue[];
};

const BUSINESS_ENDPOINTS: Record<string, string> = {
  clients: '/api/clients',
  equipment: '/api/equipment',
  rentals: '/api/rentals',
  payments: '/api/payments',
  service: '/api/service',
  deliveries: '/api/deliveries',
  documents: '/api/documents',
  financeOperations: '/api/finance/operations',
};

const REQUIRED_ROUTES = [
  { label: 'dashboard', route: '/' },
  { label: 'clients', route: '/clients' },
  { label: 'equipment', route: '/equipment' },
  { label: 'rentals', route: '/rentals' },
  { label: 'finance', route: '/finance' },
  { label: 'payments', route: '/payments' },
  { label: 'service', route: '/service' },
  { label: 'deliveries', route: '/deliveries' },
  { label: 'documents', route: '/documents' },
  { label: 'reports', route: '/reports' },
  { label: 'settings', route: '/settings' },
  { label: 'users', route: '/admin' },
] as const;

function evidenceDir(testInfo: import('@playwright/test').TestInfo) {
  return process.env.CLEAN_RESET_EVIDENCE_DIR || testInfo.outputPath('clean-production-zero-state');
}

function sanitize(text: string) {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/[A-Fa-f0-9]{64}/g, '[digest]')
    .slice(0, 1000);
}

function installIssueCapture(page: Page, report: AuditReport, getAction: () => string) {
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/ResizeObserver loop|Download the React DevTools|favicon/i.test(text)) return;
    report.issues.push({ type: 'console.error', action: getAction(), url: page.url(), text: sanitize(text) });
  });
  page.on('pageerror', error => {
    report.issues.push({ type: 'pageerror', action: getAction(), url: page.url(), text: sanitize(error.stack || error.message) });
  });
  page.on('response', response => {
    if (response.status() < 400 || !/\/api\//.test(response.url())) return;
    const expectedAnonymous = response.status() === 401 && /\/api\/auth\/me$/.test(response.url()) && getAction() === 'login';
    if (expectedAnonymous) return;
    report.issues.push({ type: 'api-response', action: getAction(), url: response.url(), status: response.status() });
  });
}

async function screenshot(page: Page, directory: string, name: string) {
  const target = path.join(directory, `${name}.png`);
  await page.screenshot({ path: target, fullPage: true });
  return target;
}

async function expectHealthyPage(page: Page, action: string) {
  const main = page.locator('main').first();
  await expect(main, `${action}: authenticated main should be visible`).toBeVisible();
  expect((await main.innerText()).trim().length, `${action}: main should not be blank`).toBeGreaterThan(10);
  await expect(page.getByText(/Unexpected Application Error|Application error|Cannot read properties|Maximum update depth exceeded/i)).toHaveCount(0);
}

async function getArray(api: APIRequestContext, endpoint: string) {
  const response = await api.get(endpoint);
  expect(response.ok(), `${endpoint}: ${response.status()} ${await response.text()}`).toBeTruthy();
  const body = await response.json();
  expect(Array.isArray(body), `${endpoint} should return an array`).toBeTruthy();
  return body as unknown[];
}

test('clean production copy has honest zero-state UI and exact-empty business APIs', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const directory = evidenceDir(testInfo);
  await mkdir(directory, { recursive: true });
  const report: AuditReport = {
    startedAt: new Date().toISOString(),
    routes: [],
    zeroCollections: {},
    issues: [],
  };
  let action = 'login';
  installIssueCapture(page, report, () => action);

  try {
    await page.goto('./', { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Логин')).toBeVisible();
    report.routes.push({ label: 'login', route: '/login', screenshot: await screenshot(page, directory, '00-login') });

    await loginAsAdmin(page);
    const token = await page.evaluate(() => window.localStorage.getItem('app_auth_token'));
    expect(token).toBeTruthy();

    await withAdminApi(async api => {
      for (const [collection, endpoint] of Object.entries(BUSINESS_ENDPOINTS)) {
        const rows = await getArray(api, endpoint);
        report.zeroCollections[collection] = rows.length;
        expect(rows, `${collection} must be exactly empty`).toEqual([]);
      }
    });

    for (const required of REQUIRED_ROUTES) {
      action = `route:${required.label}`;
      await navigateInApp(page, required.route);
      await expectHealthyPage(page, action);
      if (required.label === 'dashboard') {
        const healthScore = page.getByTestId('dashboard-company-health-score');
        await expect(healthScore).toContainText('—');
        await expect(healthScore.getByTestId('dashboard-company-health-status'))
          .toHaveText('Недостаточно данных для оценки');
        await expect(page.getByText(/Health\s+\d+\/100/)).toHaveCount(0);
      }
      if (required.label === 'finance') {
        await page.getByRole('tab', { name: 'Дебиторка' }).click();
        await expect(page.getByText(/Дебиторская задолженность|Дебиторка/).first()).toBeVisible();
      }
      if (required.label === 'users') {
        await expect(page.getByRole('heading', { name: 'Панель администратора' })).toBeVisible();
        await expect(page.getByText('Управление пользователями')).toBeVisible();
      }
      const file = `${String(report.routes.length).padStart(2, '0')}-${required.label}`;
      report.routes.push({ label: required.label, route: required.route, screenshot: await screenshot(page, directory, file) });
    }

    expect(report.issues, JSON.stringify(report.issues, null, 2)).toEqual([]);
  } finally {
    report.completedAt = new Date().toISOString();
    await writeFile(path.join(directory, 'zero-state-ui-audit.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
});

test('opening receivable UI creates and corrects debt without payment or revenue', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const directory = evidenceDir(testInfo);
  await mkdir(directory, { recursive: true });
  const report: AuditReport = {
    startedAt: new Date().toISOString(),
    routes: [],
    zeroCollections: {},
    issues: [],
  };
  let action = 'login';
  installIssueCapture(page, report, () => action);

  try {
    await loginAsAdmin(page);
    const client = await withAdminApi(api => createClient(api, `opening-ar-${Date.now()}`));
    expect(client.counterpartyId).toBeTruthy();

    action = 'opening-ar:create';
    await navigateInApp(page, `/clients/${client.id}`);
    await expect(page.getByRole('heading', { name: client.company })).toBeVisible();
    await page.getByRole('button', { name: 'Входящий остаток' }).click();
    let dialog = page.getByRole('dialog', { name: 'Входящий остаток дебиторской задолженности' });
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="number"]').fill('125000.25');
    await dialog.locator('input[type="date"]').fill('2026-08-18');
    await dialog.getByRole('textbox', { name: 'Основание / причина' }).fill('Акт сверки на дату запуска');
    await dialog.getByRole('checkbox').check();
    report.routes.push({
      label: 'opening-ar-create-dialog',
      route: `/clients/${client.id}`,
      screenshot: await screenshot(page, directory, '20-opening-ar-create-dialog'),
    });
    await dialog.getByRole('button', { name: 'Сохранить остаток' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Входящий остаток сохранён.').last()).toBeVisible();

    action = 'opening-ar:correct';
    await page.getByRole('button', { name: 'Входящий остаток' }).click();
    dialog = page.getByRole('dialog', { name: 'Входящий остаток дебиторской задолженности' });
    await expect(dialog.getByText('Ревизия: 1')).toBeVisible();
    await dialog.locator('input[type="number"]').fill('130000');
    await dialog.getByRole('textbox', { name: 'Основание / причина' }).fill('Корректировка по повторной сверке');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Сохранить остаток' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Входящий остаток сохранён.').last()).toBeVisible();
    report.routes.push({
      label: 'opening-ar-after-correction',
      route: `/clients/${client.id}`,
      screenshot: await screenshot(page, directory, '21-opening-ar-after-correction'),
    });

    await withAdminApi(async api => {
      const openingResponse = await api.get(`/api/finance/opening-receivables/${encodeURIComponent(client.id)}`);
      expect(openingResponse.ok(), await openingResponse.text()).toBeTruthy();
      const opening = await openingResponse.json() as { amount: number; revision: number; counterpartyId: string };
      const payments = await getArray(api, '/api/payments');
      const financeOperations = await getArray(api, '/api/finance/operations');
      expect(opening).toMatchObject({ amount: 130000, revision: 2, counterpartyId: client.counterpartyId });
      expect(payments).toEqual([]);
      expect(financeOperations).toEqual([]);
      report.openingReceivable = {
        clientId: client.id,
        counterpartyId: client.counterpartyId,
        amount: opening.amount,
        revision: opening.revision,
        paymentsCount: payments.length,
        financeOperationsCount: financeOperations.length,
      };
    });

    action = 'opening-ar:dashboard';
    await navigateInApp(page, '/');
    const moneyPanel = page.getByTestId('dashboard-receivables-aging');
    await expect(moneyPanel).toBeVisible();
    await expect(moneyPanel).toContainText(/130[\s\u00a0]000\s*₽/);
    await expect(moneyPanel).toContainText('Недостаточно данных по срокам задолженности');
    await expect(moneyPanel).toContainText('срок не определён');
    report.routes.push({
      label: 'opening-ar-dashboard',
      route: '/',
      screenshot: await screenshot(page, directory, '22-opening-ar-dashboard'),
    });

    expect(report.issues, JSON.stringify(report.issues, null, 2)).toEqual([]);
  } finally {
    report.completedAt = new Date().toISOString();
    await writeFile(path.join(directory, 'opening-ar-ui-audit.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
});
