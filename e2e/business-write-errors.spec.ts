import { expect, test, type Page } from '@playwright/test';
import { createClient, createEquipment, withAdminApi } from './helpers/api';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

const scopeError = {
  code: 'USER_TENANT_PROFILE_SCOPE_REQUIRED',
  error: 'USER_TENANT_PROFILE_SCOPE_REQUIRED',
  stack: 'Error at assertFullIntegrity (/app/server/db.js:123)',
};

async function rejectSave(page: Page, path: string, method: string, status = 409) {
  await page.route(`**${path}`, async route => {
    if (route.request().method() !== method) return route.continue();
    await route.fulfill({ status, json: status === 409 ? scopeError : { error: 'SQLITE_CONSTRAINT at /app/server/db.js:123' } });
  });
}

async function expectSafeError(page: Page, entity: 'клиента' | 'технику') {
  const alert = page.getByRole('alert').filter({ hasText: `Не удалось сохранить ${entity}` });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Введённые данные остались в форме');
  await expect(page.locator('body')).not.toContainText('USER_TENANT_PROFILE_SCOPE_REQUIRED');
  await expect(page.locator('body')).not.toContainText('SQLITE_CONSTRAINT');
  await expect(page.locator('body')).not.toContainText('/app/server/db.js');
}

test('Client create explains server rejection, preserves draft and succeeds on retry', async ({ page }) => {
  const suffix = Date.now().toString();
  const company = `E2E ошибка создания ${suffix}`;
  const inn = suffix.slice(-10);
  await loginAsAdmin(page);
  await navigateInApp(page, '/clients/new');
  await page.getByPlaceholder('ООО «Компания»').fill(company);
  await page.getByPlaceholder('1234567890', { exact: true }).fill(inn);
  await page.getByPlaceholder('Иванов Иван Иванович').fill('Тестовый контакт');
  await page.getByPlaceholder('+7 (999) 123-45-67').fill('+7 999 123-45-67');
  await rejectSave(page, '/api/clients', 'POST');
  await page.getByRole('button', { name: 'Создать клиента' }).click();
  await expectSafeError(page, 'клиента');
  await expect(page.getByRole('alert')).toContainText('Обратитесь к администратору');
  await expect(page).toHaveURL(/#\/clients\/new$/);
  await expect(page.getByPlaceholder('ООО «Компания»')).toHaveValue(company);
  await expect(page.getByPlaceholder('1234567890', { exact: true })).toHaveValue(inn);
  await expect(page.getByPlaceholder('Иванов Иван Иванович')).toHaveValue('Тестовый контакт');
  await page.unroute('**/api/clients');
  await page.getByRole('button', { name: 'Создать клиента' }).click();
  await expect(page.getByRole('heading', { name: company, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: company, exact: true })).toBeVisible();
});

test('Client update keeps the editor and draft after an internal server error', async ({ page }) => {
  const client = await withAdminApi(api => createClient(api, `save-error-${Date.now()}`));
  const company = `${client.company} изменён`;
  await loginAsAdmin(page);
  await navigateInApp(page, `/clients/${client.id}`);
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByLabel('Наименование компании', { exact: true }).fill(company);
  await rejectSave(page, `/api/clients/${client.id}`, 'PATCH', 500);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).first().click();
  await expectSafeError(page, 'клиента');
  await expect(page.getByLabel('Наименование компании', { exact: true })).toHaveValue(company);
  const unchanged = await withAdminApi(async api => (await api.get(`/api/clients/${client.id}`)).json());
  expect(unchanged.company).toBe(client.company);
  await page.unroute(`**/api/clients/${client.id}`);
  const saved = page.waitForResponse(response => response.url().endsWith(`/api/clients/${client.id}`) && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).first().click();
  const response = await saved;
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(response.request().postDataJSON()).not.toHaveProperty('companyId');
  expect(response.request().postDataJSON()).not.toHaveProperty('tenantId');
  expect(response.request().postDataJSON()).not.toHaveProperty('id');
  expect(response.request().postDataJSON()).not.toHaveProperty('createdAt');
  expect(response.request().postDataJSON()).not.toHaveProperty('createdBy');
  await expect(page.getByRole('heading', { name: company, exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось сохранить клиента' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: company, exact: true })).toBeVisible();
});

test('Equipment create translates scope errors, keeps input and saves on retry', async ({ page }) => {
  const suffix = Date.now().toString();
  const inventory = `ERR-${suffix}`;
  await loginAsAdmin(page);
  await page.route('**/api/owners', route => route.fulfill({ status: 200, json: [] }));
  await navigateInApp(page, '/equipment/new');
  await page.getByPlaceholder('Например, GS-3246, S-40').fill(`Lift-${suffix}`);
  await page.getByPlaceholder('Например, INV-006').fill(inventory);
  await page.getByPlaceholder('Например, Genie, JLG, Haulotte').fill('E2E');
  await page.getByPlaceholder('Например, GS-SN-20240012').fill(`SN-${suffix}`);
  await page.getByPlaceholder('Например, 2022').fill('2026');
  await page.getByPlaceholder('Например, 12.0').fill('12');
  await rejectSave(page, '/api/equipment', 'POST');
  await page.getByRole('button', { name: 'Сохранить технику', exact: true }).click();
  await expectSafeError(page, 'технику');
  await expect(page).toHaveURL(/#\/equipment\/new$/);
  await expect(page.getByPlaceholder('Например, INV-006')).toHaveValue(inventory);
  await expect(page.getByPlaceholder('Например, GS-3246, S-40')).toHaveValue(`Lift-${suffix}`);
  await expect(page.getByPlaceholder('Например, GS-SN-20240012')).toHaveValue(`SN-${suffix}`);
  await page.unroute('**/api/equipment');
  const saved = page.waitForResponse(response => response.url().endsWith('/api/equipment') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Сохранить технику', exact: true }).click();
  const response = await saved;
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(response.request().postDataJSON().ownerId).toBeUndefined();
  const equipment = await response.json();
  await navigateInApp(page, `/equipment/${equipment.id}`);
  await expect(page.getByRole('heading').filter({ hasText: `Lift-${suffix}` })).toBeVisible();
});

test('Equipment edit keeps the modal and draft after rejection and saves on retry', async ({ page }) => {
  const equipment = await withAdminApi(api => createEquipment(api, `edit-error-${Date.now()}`));
  const model = `${equipment.model} исправлен`;
  await loginAsAdmin(page);
  await navigateInApp(page, `/equipment/${equipment.id}?action=edit`);
  const dialog = page.getByRole('dialog', { name: 'Редактировать технику' });
  await expect(dialog).toBeVisible();
  const modelInput = dialog.getByPlaceholder('Например: 1932R');
  await modelInput.fill(model);
  await rejectSave(page, `/api/equipment/${equipment.id}`, 'PATCH', 403);
  await dialog.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expectSafeError(page, 'технику');
  await expect(dialog).toBeVisible();
  await expect(modelInput).toHaveValue(model);
  await page.unroute(`**/api/equipment/${equipment.id}`);
  await dialog.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(dialog).toBeHidden();
  await navigateInApp(page, `/equipment/${equipment.id}`);
  await expect(page.getByRole('heading').filter({ hasText: model })).toBeVisible();
});
