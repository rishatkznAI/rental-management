import { expect, test } from '@playwright/test';
import { loginAsAdmin, loginAsRentalManager, navigateInApp } from './helpers/auth';
import { createEquipment, withAdminApi } from './helpers/api';

test.describe('leasing finance', () => {
  test('admin can create and inspect leasing contract from Finance', async ({ page }) => {
    const suffix = `leasing-${Date.now()}`;
    const equipment = await withAdminApi(api => createEquipment(api, suffix));
    const contractNumber = `LEASE-${Date.now()}`;
    const pausedContractNumber = `LEASE-PAUSED-${Date.now()}`;
    const leasingCompany = `Лизинг E2E ${Date.now()}`;
    await withAdminApi(async (api) => {
      const res = await api.post('/api/leasing-contracts', {
        data: {
          contractNumber: pausedContractNumber,
          leasingCompany: `Пауза E2E ${Date.now()}`,
          startDate: '2026-04-01',
          endDate: '2026-10-31',
          termMonths: 7,
          monthlyPayment: 900000,
          paymentDay: 5,
          status: 'paused',
          schedule: [{
            dueDate: '2026-04-05',
            amount: 900000,
            status: 'planned',
            paidAmount: 0,
          }],
        },
      });
      expect(res.ok()).toBeTruthy();
    });

    await loginAsAdmin(page);
    await navigateInApp(page, '/finance');
    await page.getByRole('tab', { name: 'Лизинг' }).click();
    await expect(page.getByRole('heading', { name: 'Лизинг' })).toBeVisible();

    await page.getByRole('button', { name: 'Добавить договор' }).click();
    const dialog = page.getByRole('dialog', { name: 'Новый договор лизинга' });
    await expect(dialog).toBeVisible();

    const inputs = dialog.locator('input');
    await inputs.nth(0).fill(contractNumber);
    await inputs.nth(1).fill(leasingCompany);
    await dialog.locator('select').first().selectOption(equipment.id);
    await inputs.nth(2).fill('2026-05-01');
    await inputs.nth(3).fill('2026-10-31');
    await inputs.nth(4).fill('6');
    await inputs.nth(5).fill('10');
    await inputs.nth(6).fill('125000');
    await inputs.nth(7).fill('250000');
    await inputs.nth(8).fill('50000');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();

    await expect(page.getByText(contractNumber)).toBeVisible();
    await expect(page.getByText(leasingCompany)).toBeVisible();
    await expect(page.getByText(pausedContractNumber)).toBeVisible();
    await expect(page.getByTestId('leasing-kpi-active')).toContainText('1');
    await expect(page.getByTestId('leasing-kpi-paused')).toContainText('1');
    await expect(page.getByTestId('leasing-kpi-current-month')).toContainText(/125\s*000/);
    await expect(page.getByTestId('leasing-kpi-current-month')).not.toContainText(/900\s*000/);
    await expect(page.getByTestId('leasing-kpi-overdue')).toContainText(/0/);
    const contractRow = page.locator('tbody tr').filter({ hasText: contractNumber });
    await expect(contractRow.getByText(/125\s*000/)).toBeVisible();

    await contractRow.getByText(contractNumber).click();
    const sheet = page.getByRole('dialog', { name: new RegExp(`Договор ${contractNumber}`) });
    await expect(sheet).toBeVisible();
    await expect(page.getByText(equipment.inventoryNumber).first()).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
  });

  test('rental manager cannot open leasing finance section', async ({ page }) => {
    await loginAsRentalManager(page);
    await navigateInApp(page, '/finance');
    await expect(page).not.toHaveURL(/#\/finance$/);
    await expect(page.getByRole('tab', { name: 'Лизинг' })).toBeHidden();
  });
});
