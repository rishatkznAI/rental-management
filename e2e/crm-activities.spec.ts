import { expect, test, type Page } from '@playwright/test';
import { createClient, withAdminApi } from './helpers/api';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

function collectPageIssues(page: Page) {
  const issues: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') issues.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 500) issues.push(`response: ${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => {
    if (request.url().includes('fonts.gstatic.com')) return;
    issues.push(`requestfailed: ${request.url()} ${request.failure()?.errorText || ''}`);
  });
  return issues;
}

async function chooseClient(page: Page, company: string) {
  await page.getByTestId('crm-activity-client-trigger').click();
  await page.getByRole('option', { name: company }).click();
}

async function enterByTestId(page: Page, testId: string, value: string) {
  const field = page.getByTestId(testId);
  await field.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(value);
  await expect(field).toHaveValue(value);
}

test('admin creates CRM call and visit from UI and sees them on the client card', async ({ page }) => {
  const suffix = `crm-activity-${Date.now()}`;
  const seed = await withAdminApi(async (api) => {
    const client = await createClient(api, suffix);
    const beforeKpi = await api.get('/api/crm/manager-kpi');
    expect(beforeKpi.ok(), await beforeKpi.text()).toBeTruthy();
    return { client, beforeKpi: await beforeKpi.json() as { rows?: Array<{ callsTotal: number; visits: number }> } };
  });
  const beforeCalls = (seed.beforeKpi.rows || []).reduce((sum, row) => sum + row.callsTotal, 0);
  const beforeVisits = (seed.beforeKpi.rows || []).reduce((sum, row) => sum + row.visits, 0);
  const issues = collectPageIssues(page);

  await loginAsAdmin(page);
  await navigateInApp(page, '/crm');
  await expect(page.getByRole('heading', { name: 'CRM' })).toBeVisible();
  await expect(page.getByText('Скайтех').first()).toBeVisible();
  await expect(page.getByText('RentCore')).toHaveCount(0);

  await page.getByTestId('crm-add-call').click();
  await chooseClient(page, seed.client.company);
  await enterByTestId(page, 'crm-activity-comment', `E2E звонок ${suffix}`);
  await enterByTestId(page, 'crm-activity-next-action', `Следующий звонок ${suffix}`);
  const callSave = page.waitForResponse(response => response.url().includes('/api/crm/activities') && response.request().method() === 'POST');
  await page.getByTestId('crm-activity-save').click();
  const callResponse = await callSave;
  expect(callResponse.ok(), await callResponse.text()).toBeTruthy();
  await expect(page.getByRole('dialog', { name: 'Звонок' })).toBeHidden();
  await expect(page.locator('main').getByText(`E2E звонок ${suffix}`)).toBeVisible();

  await page.getByTestId('crm-add-visit').click();
  await chooseClient(page, seed.client.company);
  await enterByTestId(page, 'crm-activity-address', `E2E объект ${suffix}`);
  await enterByTestId(page, 'crm-activity-comment', `E2E выезд ${suffix}`);
  await enterByTestId(page, 'crm-activity-next-action', `КП после выезда ${suffix}`);
  const visitSave = page.waitForResponse(response => response.url().includes('/api/crm/activities') && response.request().method() === 'POST');
  await page.getByTestId('crm-activity-save').click();
  const visitResponse = await visitSave;
  expect(visitResponse.ok(), await visitResponse.text()).toBeTruthy();
  await expect(page.getByRole('dialog', { name: 'Выезд' })).toBeHidden();
  await expect(page.locator('main').getByText(`E2E выезд ${suffix}`)).toBeVisible();

  const afterKpi = await withAdminApi(async (api) => {
    const response = await api.get('/api/crm/manager-kpi');
    expect(response.ok(), await response.text()).toBeTruthy();
    return await response.json() as { rows?: Array<{ callsTotal: number; visits: number }> };
  });
  const afterCalls = (afterKpi.rows || []).reduce((sum, row) => sum + row.callsTotal, 0);
  const afterVisits = (afterKpi.rows || []).reduce((sum, row) => sum + row.visits, 0);
  expect(afterCalls).toBeGreaterThan(beforeCalls);
  expect(afterVisits).toBeGreaterThan(beforeVisits);

  await navigateInApp(page, `/clients/${seed.client.id}`);
  await expect(page.getByRole('heading', { name: seed.client.company })).toBeVisible();
  await expect(page.getByText('Выезд: completed')).toBeVisible();
  await expect(page.getByText(`следующий шаг: КП после выезда ${suffix}`)).toBeVisible();
  expect(issues).toEqual([]);
});
