import { expect, test } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';
import { createClient, withAdminApi } from './helpers/api';

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

  const trigger = page.getByRole('button', { name: 'Новый платеж', exact: true });
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
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
    const response = await api.post('/api/documents/generate', {
      data: {
        type: 'rental_contract',
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
