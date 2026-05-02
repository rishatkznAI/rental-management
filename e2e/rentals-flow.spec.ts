import { expect, test } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';
import { createClient, createRentalPair, findRentalByClient, getAnyRentableEquipment, withAdminApi } from './helpers/api';

async function selectEquipment(page: import('@playwright/test').Page, query: string) {
  await page.getByText('Введите модель, INV или серийный номер…').click();
  const combobox = page.getByPlaceholder('Введите модель, INV или серийный номер…');
  await combobox.fill(query);
  await page.locator('li[data-eq-item]').first().click();
}

test('admin can create rental from the rental form', async ({ page }) => {
  const suffix = `rent-${Date.now()}`;
  const { client, equipment } = await withAdminApi(async (api) => ({
    client: await createClient(api, suffix),
    equipment: await getAnyRentableEquipment(api),
  }));

  await loginAsAdmin(page);
  await navigateInApp(page, '/rentals/new');

  await expect(page.getByRole('heading', { name: 'Новая аренда' })).toBeVisible();

  await page.locator('[role="combobox"]').first().click();
  await page.getByRole('option', { name: client.company }).click();
  await selectEquipment(page, equipment.serialNumber || equipment.inventoryNumber);
  await page.locator('input[type="number"]').first().fill('1000');
  await page.getByRole('button', { name: 'Создать договор' }).click();

  await expect(page).toHaveURL(/#\/rentals$/);
  await expect(page.getByRole('heading', { name: 'Планировщик аренды' })).toBeVisible();

  const createdRental = await withAdminApi((api) => findRentalByClient(api, client.company));
  expect(createdRental.id).toBeTruthy();
});

test('admin can open rental detail page for an existing rental', async ({ page }) => {
  const suffix = `detail-${Date.now()}`;
  const { rental } = await withAdminApi(async (api) => {
    const client = await createClient(api, suffix);
    const equipment = await getAnyRentableEquipment(api);
    return createRentalPair(api, {
      client: client.company,
      equipment,
      startDate: '2026-04-18',
      endDate: '2026-04-20',
    });
  });

  await loginAsAdmin(page);
  await navigateInApp(page, `/rentals/${rental.id}`);

  await expect(page.getByRole('heading', { name: rental.id })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Клиент' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Редактировать' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Даты аренды' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'История изменений' })).toBeVisible();
});

test('admin can open rental extension modal without changing data', async ({ page }) => {
  const suffix = `extend-${Date.now()}`;
  const { rental } = await withAdminApi(async (api) => {
    const client = await createClient(api, suffix);
    const equipment = await getAnyRentableEquipment(api);
    return createRentalPair(api, {
      client: client.company,
      equipment,
      startDate: '2026-06-01',
      endDate: '2026-06-10',
    });
  });

  await loginAsAdmin(page);
  await navigateInApp(page, `/rentals/${rental.id}`);

  await page.getByRole('button', { name: 'Продлить аренду' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Продлить аренду' })).toBeVisible();
  await expect(page.getByText('Текущая дата окончания')).toBeVisible();
  await expect(page.getByText('Новая дата окончания')).toBeVisible();
  await expect(page.getByText('Причина продления')).toBeVisible();
  await expect(page.getByText('Комментарий')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Продлить' })).toBeDisabled();
  await expect(page.getByText('Новая дата должна быть позже текущей даты окончания.')).toBeVisible();
});
