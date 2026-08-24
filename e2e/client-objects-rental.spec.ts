import { expect, test, type Page } from '@playwright/test';

import { createClient, getAnyRentableEquipment, withAdminApi } from './helpers/api';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

async function selectEquipment(page: Page, query: string) {
  await page.getByText('Введите модель, INV или серийный номер…').click();
  const combobox = page.getByPlaceholder('Введите модель, INV или серийный номер…');
  await combobox.fill(query);
  await page.locator('li[data-eq-item]').first().click();
}

test('Client → Object → Rental → Delivery persists and Rental object can be cleared', async ({ page }) => {
  const suffix = `client-object-${Date.now()}`;
  const objectName = `ЖК Южный парк ${suffix}`;
  const { client, equipment } = await withAdminApi(async api => ({
    client: await createClient(api, suffix),
    equipment: await getAnyRentableEquipment(api),
  }));

  await loginAsAdmin(page);
  await navigateInApp(page, `/clients/${client.id}`);

  await expect(page.getByText('Объекты пока не добавлены', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Добавить объект' }).last().click();

  const objectDialog = page.getByRole('dialog');
  await objectDialog.getByLabel('Название объекта *').fill(objectName);
  await objectDialog.getByLabel('Адрес').fill('Казань, ул. Тестовая, 10');
  await objectDialog.getByLabel('Контакт на объекте').fill('Иван Петров');
  await objectDialog.getByLabel('Телефон').fill('+7 999 111-22-33');
  await objectDialog.getByPlaceholder('КПП №2, въезд со стороны...').fill('Въезд через КПП №2');
  await objectDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();

  await expect(objectDialog).toBeHidden();
  await expect(page.locator('p').filter({ hasText: objectName }).first()).toBeVisible();
  await page.reload();
  await expect(page.locator('p').filter({ hasText: objectName }).first()).toBeVisible();

  const objectId = await withAdminApi(async api => {
    const response = await api.get('/api/client_objects');
    expect(response.ok()).toBeTruthy();
    const objects = await response.json() as Array<{ id: string; clientId?: string; name: string }>;
    const object = objects.find(item => item.clientId === client.id && item.name === objectName);
    expect(object).toBeTruthy();
    return object!.id;
  });

  await navigateInApp(page, `/rentals/new?clientId=${encodeURIComponent(client.id)}`);
  await expect(page.getByTestId('rental-client-select')).toHaveValue(client.id);
  await page.getByTestId('rental-object-select').selectOption(objectId);
  await page.getByRole('button', { name: 'Добавить договор' }).click();
  await page.getByPlaceholder('Название (необязательно)').fill('E2E договор для объекта');
  await page.getByRole('button', { name: 'Сохранить договор' }).click();
  await expect(page.getByTestId('rental-contract-select')).toBeVisible();
  await expect(page.getByTestId('rental-contract-select')).not.toHaveValue('');

  await selectEquipment(page, equipment.serialNumber || equipment.inventoryNumber);
  await page.getByTestId('rental-daily-rate').fill('1000');
  await page.getByTestId('rental-submit').click();
  await expect(page).toHaveURL(/#\/rentals$/);

  const rentalId = await withAdminApi(async api => {
    const response = await api.get('/api/rentals');
    expect(response.ok()).toBeTruthy();
    const rentals = await response.json() as Array<{ id: string; clientId?: string; objectId?: string; contractId?: string }>;
    const rental = [...rentals].reverse().find(item => item.clientId === client.id);
    expect(rental?.objectId).toBe(objectId);
    expect(rental?.contractId).toBeTruthy();
    return rental!.id;
  });

  await navigateInApp(page, `/rentals/${rentalId}`);
  await page.reload();
  await expect(page.getByText(`${objectName} · Казань, ул. Тестовая, 10`, { exact: true })).toBeVisible();

  await navigateInApp(page, `/deliveries/new?rentalId=${encodeURIComponent(rentalId)}&type=shipping`);
  const deliverySheet = page.locator('[data-delivery-form-sheet="true"]');
  await expect(deliverySheet).toBeVisible();
  const deliveryInput = (label: string) => deliverySheet.getByText(label, { exact: true }).locator('..').locator('input');
  await expect(deliveryInput('Куда')).toHaveValue('Казань, ул. Тестовая, 10');
  await expect(deliveryInput('Контактное лицо')).toHaveValue('Иван Петров');
  await expect(deliveryInput('Контактный номер')).toHaveValue('+7 999 111-22-33');
  await deliverySheet.getByRole('button', { name: 'Сохранить доставку' }).click();
  await expect(deliverySheet).toBeHidden();

  const delivery = await withAdminApi(async api => {
    const response = await api.get('/api/deliveries');
    expect(response.ok()).toBeTruthy();
    const payload = await response.json() as Array<{
      id: string;
      number?: string;
      rentalId?: string;
      classicRentalId?: string;
      destination?: string;
      contactName?: string;
      contactPhone?: string;
    }>;
    const createdDelivery = [...payload].reverse().find(item =>
      item.rentalId === rentalId || item.classicRentalId === rentalId
    );
    expect(createdDelivery).toBeTruthy();
    expect(createdDelivery?.destination).toBe('Казань, ул. Тестовая, 10');
    expect(createdDelivery?.contactName).toBe('Иван Петров');
    expect(createdDelivery?.contactPhone).toBe('+7 999 111-22-33');
    return createdDelivery!;
  });

  await navigateInApp(page, '/deliveries');
  await page.reload();
  const deliveryNumber = delivery.number || delivery.id;
  const deliveryButton = page.getByRole('button', { name: deliveryNumber, exact: true });
  await expect(deliveryButton).toBeVisible();
  await expect(page.getByText('Иван Петров', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('+7 999 111-22-33', { exact: true }).last()).toBeVisible();
  await deliveryButton.click();
  const deliveryDetail = page.locator('[data-delivery-detail-sheet="true"]');
  await expect(deliveryDetail).toBeVisible();
  await expect(deliveryDetail.getByText('Адрес доставки', { exact: true }).locator('..')).toContainText('Казань, ул. Тестовая, 10');

  await navigateInApp(page, `/clients/${client.id}`);
  await page.reload();
  await expect(page.locator('p').filter({ hasText: objectName }).first()).toBeVisible();
  await expect(page.getByText('1 активная аренда · 1 ед. техники', { exact: true })).toBeVisible();

  await navigateInApp(page, `/rentals/${rentalId}`);
  await page.getByRole('button', { name: 'Редактировать' }).click();
  const objectField = page.getByText('Объект', { exact: true }).locator('..');
  await objectField.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Без объекта', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Редактировать' })).toBeVisible();
  await withAdminApi(async api => {
    const response = await api.get(`/api/rentals/${rentalId}`);
    expect(response.ok()).toBeTruthy();
    const clearedRental = await response.json() as {
      objectId?: string;
      objectName?: string | null;
      objectAddress?: string | null;
      objectContactName?: string | null;
      objectContactPhone?: string | null;
    };
    expect(clearedRental.objectId).toBeUndefined();
    expect(clearedRental.objectName).toBeNull();
    expect(clearedRental.objectAddress).toBeNull();
    expect(clearedRental.objectContactName).toBeNull();
    expect(clearedRental.objectContactPhone).toBeNull();
  });
  await page.reload();
  await expect(page.getByText('Без объекта', { exact: true })).toBeVisible();
  await expect(page.getByText(`${objectName} · Казань, ул. Тестовая, 10`, { exact: true })).toHaveCount(0);
});
