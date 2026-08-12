import { expect, test } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';
import { createClient, findServiceTicketByReason, getAnyRentableEquipment, withAdminApi } from './helpers/api';

async function selectEquipment(page: import('@playwright/test').Page, query: string) {
  await page.getByText('Введите модель, INV или серийный номер…').click();
  const combobox = page.getByPlaceholder('Введите модель, INV или серийный номер…');
  await combobox.fill(query);
  await page.locator('li[data-eq-item]').first().click();
}

test('admin can create a service ticket from the service form', async ({ page }) => {
  const suffix = `svc-${Date.now()}`;
  const { equipment } = await withAdminApi(async (api) => ({
    equipment: await getAnyRentableEquipment(api),
  }));
  const reason = `E2E service reason ${suffix}`;
  const description = `E2E description ${suffix}`;

  await loginAsAdmin(page);
  await navigateInApp(page, '/service/new');

  await expect(page.getByRole('heading', { name: 'Новая заявка в сервис' })).toBeVisible();
  await selectEquipment(page, equipment.serialNumber || equipment.inventoryNumber);
  await page.getByPlaceholder('Например: объект клиента, склад, адрес площадки').fill('E2E объект');
  await page.getByPlaceholder('Например: Не реагирует на команды, не поднимается, ошибка на дисплее').fill(reason);
  await page.getByPlaceholder('Опишите неисправность или проблему, с которой обратились в сервис.').fill(description);
  await page.getByRole('button', { name: 'Создать заявку' }).click();

  await expect(page).toHaveURL(/#\/service\/.+/);
  await expect(page.getByText(reason).first()).toBeVisible();

  const createdTicket = await withAdminApi((api) => findServiceTicketByReason(api, reason));
  expect(createdTicket.id).toBeTruthy();
});

test('admin can create a Counterparty-only customer service ticket', async ({ page }) => {
  const suffix = `svc-cp-${Date.now()}`;
  const { equipment, client } = await withAdminApi(async (api) => ({
    equipment: await getAnyRentableEquipment(api),
    client: await createClient(api, suffix),
  }));
  const reason = `E2E Counterparty service ${suffix}`;

  await loginAsAdmin(page);
  await navigateInApp(page, '/service/new');
  await selectEquipment(page, equipment.serialNumber || equipment.inventoryNumber);

  await page.getByText('Выберите customer Counterparty', { exact: true }).click();
  await page.getByPlaceholder('Выберите customer Counterparty').fill(client.company);
  await page.locator('li[data-client-item]').filter({ hasText: `ID ${client.counterpartyId}` }).click();

  await page.getByPlaceholder('Например: объект клиента, склад, адрес площадки').fill('E2E customer site');
  await page.getByPlaceholder('Например: Не реагирует на команды, не поднимается, ошибка на дисплее').fill(reason);
  await page.getByPlaceholder('Опишите неисправность или проблему, с которой обратились в сервис.').fill('Counterparty-only E2E');
  await page.getByRole('button', { name: 'Создать заявку' }).click();

  await expect(page).toHaveURL(/#\/service\/.+/);
  const createdTicket = await withAdminApi((api) => findServiceTicketByReason(api, reason)) as {
    counterpartyId?: string;
    clientId?: string;
  };
  expect(createdTicket.counterpartyId).toBe(client.counterpartyId);
  expect(createdTicket.clientId || undefined).toBeUndefined();
});
