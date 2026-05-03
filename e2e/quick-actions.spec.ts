import { expect, test } from '@playwright/test';
import { createClient, createEquipment, createRentalPair, findServiceTicketByReason, withAdminApi } from './helpers/api';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

async function selectEquipment(page: import('@playwright/test').Page, query: string) {
  await page.getByText('Введите модель, INV или серийный номер…').click();
  const combobox = page.getByPlaceholder('Введите модель, INV или серийный номер…');
  await combobox.fill(query);
  await page.locator('li[data-eq-item]').first().click();
}

test('admin sees quick actions on client, equipment, rental and service cards', async ({ page }) => {
  const suffix = `quick-actions-${Date.now()}`;
  const seed = await withAdminApi(async (api) => {
    const client = await createClient(api, suffix);
    const equipment = await createEquipment(api, suffix);
    const pair = await createRentalPair(api, {
      client: client.company,
      equipment,
      startDate: '2026-05-10',
      endDate: '2026-05-15',
    });
    return { client, equipment, rental: pair.rental };
  });

  await loginAsAdmin(page);

  await navigateInApp(page, `/clients/${seed.client.id}`);
  await expect(page.getByRole('heading', { name: seed.client.company })).toBeVisible();
  await expect(page.getByText('Быстрые действия').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать аренду' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Документы клиента' })).toBeVisible();

  await page.getByRole('button', { name: 'Документы клиента' }).click();
  await expect(page).toHaveURL(/#\/documents/);

  await navigateInApp(page, `/equipment/${seed.equipment.id}`);
  await expect(page.getByRole('heading', { name: new RegExp(seed.equipment.model) })).toBeVisible();
  await expect(page.getByText('Быстрые действия').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать сервисную заявку' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'История аренд' })).toBeVisible();

  await page.getByRole('button', { name: 'Очередь сервиса' }).click();
  await expect(page).toHaveURL(/#\/service$/);

  await navigateInApp(page, `/rentals/${seed.rental.id}`);
  await expect(page.getByRole('heading', { name: seed.rental.id })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Быстрые действия' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Продлить аренду' })).toBeVisible();
  const openDocumentsButton = page.getByRole('button', { name: 'Открыть документы' }).first();
  await expect(openDocumentsButton).toBeVisible();

  await openDocumentsButton.click();
  await expect(page).toHaveURL(/#\/documents/);

  const serviceReason = `E2E quick action service ${suffix}`;
  await navigateInApp(page, '/service/new');
  await selectEquipment(page, seed.equipment.serialNumber || seed.equipment.inventoryNumber);
  await page.getByPlaceholder('Например: объект клиента, склад, адрес площадки').fill('E2E quick action object');
  await page.locator('select').nth(1).selectOption('medium');
  await page.getByPlaceholder('Например: Не реагирует на команды, не поднимается, ошибка на дисплее').fill(serviceReason);
  await page.getByPlaceholder('Опишите неисправность или проблему, с которой обратились в сервис.').fill('E2E quick action description');
  await page.getByRole('button', { name: 'Создать заявку' }).click();
  await expect(page).toHaveURL(/#\/service\/.+/);

  const ticket = await withAdminApi((api) => findServiceTicketByReason(api, serviceReason));
  await expect(page.getByRole('heading', { name: ticket.id })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Быстрые действия' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть технику' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Очередь сервиса' })).toBeVisible();
});
