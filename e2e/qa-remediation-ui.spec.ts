import { expect, test } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';
import { createClient, createClientRentalRelations, createEquipment, createRentalPair, withAdminApi } from './helpers/api';

async function setHashRoute(page: import('@playwright/test').Page, route: string) {
  await page.evaluate(nextRoute => {
    window.location.hash = nextRoute;
  }, route);
}

test('fleet utilization KPI opens the filtered rented equipment registry', async ({ page }) => {
  const issues: string[] = [];
  page.on('pageerror', error => issues.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') issues.push(`console: ${message.text()}`);
  });
  await loginAsAdmin(page);

  const utilizationKpi = page.getByTestId('dashboard-kpi-fleet-utilization');
  await expect(utilizationKpi).toBeVisible();
  await utilizationKpi.click();

  await page.waitForTimeout(300);
  expect(issues).toEqual([]);
  await expect(page).toHaveURL(/#\/equipment\?status=rented/);
  await expect(page.getByRole('button', { name: /^В аренде/ }).first()).toBeVisible();
  await expect(page.getByLabel('Статус техники')).toHaveValue('rented');
});

test('equipment status query stays synchronized on one mounted route and browser history', async ({ page }) => {
  const suffix = `equipment-query-${Date.now()}`;
  const seed = await withAdminApi(async (api) => {
    const client = await createClient(api, `${suffix}-client`);
    const rented = await createEquipment(api, `${suffix}-rented`);
    const available = await createEquipment(api, `${suffix}-available`);
    await createRentalPair(api, {
      client: client.company,
      clientId: client.id,
      equipment: rented,
      startDate: '2020-01-01',
      endDate: '2099-12-31',
      status: 'active',
      ganttStatus: 'active',
    });
    return { rented, available };
  });

  await loginAsAdmin(page);
  await navigateInApp(page, '/equipment?status=rented');

  const statusFilter = page.getByLabel('Статус техники');
  const search = page.getByPlaceholder('Модель, инв. №, SN, собственник, локация…');
  const registry = page.getByTestId('equipment-registry-table-panel');
  await expect(statusFilter).toHaveValue('rented');
  await expect(page.getByRole('button', { name: /^В аренде/ }).first()).toHaveClass(/bg-primary/);
  await search.fill(seed.rented.inventoryNumber);
  await expect(registry.getByText(seed.rented.inventoryNumber, { exact: true })).toBeVisible();
  await search.fill(seed.available.inventoryNumber);
  await expect(registry.getByText(seed.available.inventoryNumber, { exact: true })).toHaveCount(0);
  await search.fill('');

  await setHashRoute(page, '/equipment');
  await expect(statusFilter).toHaveValue('all');
  await expect(page.getByRole('button', { name: /^Вся техника/ }).first()).toHaveClass(/bg-primary/);
  await search.fill(seed.available.inventoryNumber);
  await expect(registry.getByText(seed.available.inventoryNumber, { exact: true })).toBeVisible();
  await search.fill('');

  await setHashRoute(page, '/equipment?status=all');
  await expect(statusFilter).toHaveValue('all');
  await setHashRoute(page, '/equipment?status=unknown');
  await expect(statusFilter).toHaveValue('all');

  await page.goBack();
  await expect(page).toHaveURL(/#\/equipment\?status=all$/);
  await expect(statusFilter).toHaveValue('all');
  await page.goBack();
  await expect(page).toHaveURL(/#\/equipment$/);
  await expect(statusFilter).toHaveValue('all');
  await page.goBack();
  await expect(page).toHaveURL(/#\/equipment\?status=rented$/);
  await expect(statusFilter).toHaveValue('rented');
  await page.goForward();
  await expect(page).toHaveURL(/#\/equipment$/);
  await expect(statusFilter).toHaveValue('all');
});

test('rentals payment action opens an accessible payment flow without a selected rental', async ({ page }) => {
  await loginAsAdmin(page);
  await navigateInApp(page, '/rentals');

  await page.getByRole('link', { name: 'Добавить оплату', exact: true }).first().click();
  await expect(page).toHaveURL(/#\/payments\?action=create/);

  const dialog = page.getByRole('dialog', { name: 'Новый платёж' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await expect(dialog.locator(':focus')).toBeVisible();

  await page.getByRole('button', { name: 'Закрыть форму нового платежа' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/action=create/);

  const trigger = page.getByRole('button', { name: 'Новый платеж', exact: true });
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('payment create intent is consumed for every completion path and preserves other query params', async ({ page }) => {
  const client = await withAdminApi(api => createClient(api, `payment-intent-${Date.now()}`));
  await loginAsAdmin(page);
  await navigateInApp(page, '/payments?tab=unallocated');

  const dialog = page.getByRole('dialog', { name: 'Новый платёж' });
  const openIntent = async () => {
    await setHashRoute(page, '/payments?action=create&tab=unallocated');
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/#\/payments\?action=create&tab=unallocated$/);
  };
  const expectConsumed = async () => {
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/#\/payments\?tab=unallocated$/);
  };

  await openIntent();
  await page.keyboard.press('Escape');
  await expectConsumed();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/#\/payments\?tab=unallocated$/);

  await openIntent();
  await dialog.getByRole('button', { name: 'Закрыть форму нового платежа' }).click();
  await expectConsumed();

  await openIntent();
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expectConsumed();

  await openIntent();
  await dialog.getByLabel(/Номер счёта/).fill('INV-26-000001');
  await dialog.getByLabel('Сумма к оплате').fill('1000');
  await dialog.getByRole('combobox', { name: /Контрагент/ }).selectOption(client.counterpartyId);
  await dialog.getByRole('button', { name: 'Сохранить платёж' }).click();
  await expectConsumed();

  await page.goBack();
  await expect(page).not.toHaveURL(/action=create/);
  await expect(dialog).toBeHidden();
  await page.goForward();
  await expect(page).not.toHaveURL(/action=create/);
  await expect(dialog).toBeHidden();
});

test('payment dialog uses a safe focus fallback and exposes validation errors', async ({ page }) => {
  await loginAsAdmin(page);
  await navigateInApp(page, '/payments');

  const trigger = page.getByRole('button', { name: 'Новый платеж', exact: true });
  const heading = page.getByRole('heading', { name: 'Платежи' });
  const dialog = page.getByRole('dialog', { name: 'Новый платёж' });
  await trigger.click();
  await expect(dialog).toBeVisible();
  await trigger.evaluate(element => element.remove());
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(heading).toBeFocused();

  await page.reload({ waitUntil: 'domcontentloaded' });
  const restoredTrigger = page.getByRole('button', { name: 'Новый платеж', exact: true });
  await restoredTrigger.click();
  const restoredDialog = page.getByRole('dialog', { name: 'Новый платёж' });
  await restoredDialog.getByLabel(/Номер счёта/).fill('INV-26-000001');
  await restoredDialog.getByLabel('Сумма к оплате').fill('1000');
  await restoredDialog.getByRole('button', { name: 'Сохранить платёж' }).click();
  const clientError = restoredDialog.getByRole('alert');
  await expect(clientError).toHaveText('Выберите контрагента из базы');
  const clientField = restoredDialog.getByRole('combobox', { name: /Контрагент/ });
  await expect(clientField).toHaveAttribute('aria-invalid', 'true');
  await expect(clientField).toHaveAttribute('aria-describedby', 'new-payment-client-error');
});

test('document field settings opens the configured admin target', async ({ page }) => {
  await loginAsAdmin(page);
  await navigateInApp(page, '/documents');

  await page.getByRole('link', { name: 'Настройки полей' }).click();

  await expect(page).toHaveURL(/#\/admin\?modal=details&tab=configuration/);
  const dialog = page.getByRole('dialog', { name: 'Списки и поля' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Поля форм' })).toBeVisible();
});

test('contract details action opens the specification wizard', async ({ page }) => {
  const suffix = `spec-chain-${Date.now()}`;
  const contract = await withAdminApi(async (api) => {
    const client = await createClient(api, suffix);
    const relations = await createClientRentalRelations(api, client.id, suffix);
    const response = await api.post('/api/documents/generate', {
      data: {
        type: 'rental_contract',
        contractId: relations.contract.id,
        clientId: client.id,
        date: '2026-08-02',
        signerName: 'Иванов Иван Иванович',
        signerPosition: 'Генеральный директор',
        signerBasis: 'Устав',
        notes: `QA remediation ${suffix}`,
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json() as Promise<{ id: string; number: string }>;
  });

  await loginAsAdmin(page);
  await navigateInApp(page, '/documents');
  await page.getByPlaceholder('Поиск по номеру, клиенту, технике, примечанию').fill(contract.number);
  const contractRow = page.locator('tr').filter({ hasText: contract.number });
  await expect(contractRow).toBeVisible();
  await contractRow.click();

  const details = page.getByRole('dialog', { name: contract.number });
  await expect(details).toBeVisible();
  await details.getByRole('button', { name: 'Создать спецификацию' }).click();

  const wizard = page.getByRole('dialog', { name: 'Создать документ' });
  await expect(wizard).toBeVisible();
  await expect(wizard.getByRole('button', { name: /Спецификация к договору/ })).toBeVisible();
  await expect(details).toBeHidden();
});
