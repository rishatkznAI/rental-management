import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';
import { createClient, createEquipment, createRentalPair, withAdminApi } from './helpers/api';

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axN5N8AAAAASUVORK5CYII=';

type UiIssue = {
  type: string;
  url: string;
  status?: number;
  text?: string;
};

function installMovementGuards(page: Page, issues: UiIssue[]) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/ResizeObserver loop|favicon/i.test(text)) return;
    issues.push({ type: 'console.error', url: page.url(), text });
  });

  page.on('pageerror', (error) => {
    issues.push({ type: 'pageerror', url: page.url(), text: error.message });
  });

  page.on('response', (response) => {
    const status = response.status();
    if (status >= 500 || (/\/api\//.test(response.url()) && [401, 403].includes(status))) {
      issues.push({ type: 'bad-response', url: response.url(), status });
    }
  });
}

test('rentals movement tab resolves equipment links and shows diagnostic fallback', async ({ page }) => {
  const issues: UiIssue[] = [];
  installMovementGuards(page, issues);

  const suffix = `movement-${Date.now()}`;
  const seed = await withAdminApi(async (api) => {
    const client = await createClient(api, suffix);
    const equipment = await createEquipment(api, suffix);
    const { rental } = await createRentalPair(api, {
      client: client.company,
      clientId: client.id,
      equipment,
      startDate: '2026-05-18',
      endDate: '2026-05-20',
      status: 'active',
      ganttStatus: 'active',
    });

    const deliveryRes = await api.post('/api/deliveries', {
      data: {
        type: 'shipping',
        status: 'completed',
        transportDate: '2026-05-18',
        pickupTime: '10:00',
        neededBy: '2026-05-18',
        origin: 'Склад',
        destination: 'Объект',
        cargo: `${equipment.manufacturer} ${equipment.model}`,
        contactName: 'E2E Contact',
        contactPhone: '+79990000000',
        cost: 0,
        client: client.company,
        clientId: client.id,
        manager: 'E2E',
        rentalId: rental.id,
        equipmentId: equipment.id,
        equipmentInv: equipment.inventoryNumber,
        photos: [TINY_PNG],
      },
    });
    expect(deliveryRes.ok(), await deliveryRes.text()).toBeTruthy();
    const delivery = await deliveryRes.json() as { id: string };

    for (const event of [
      {
        id: `SP-${suffix}-direct`,
        equipmentId: equipment.id,
        type: 'shipping',
        date: '2026-05-18T08:00:00.000Z',
        uploadedBy: 'E2E',
        photos: [TINY_PNG],
        source: 'manual',
      },
      {
        id: `SP-${suffix}-rental`,
        rentalId: rental.id,
        type: 'receiving',
        date: '2026-05-18T09:00:00.000Z',
        uploadedBy: 'E2E',
        photos: [TINY_PNG],
        source: 'manual',
      },
      {
        id: `SP-${suffix}-delivery`,
        deliveryId: delivery.id,
        type: 'shipping',
        date: '2026-05-18T10:00:00.000Z',
        uploadedBy: 'E2E',
        photos: [TINY_PNG],
        source: 'manual',
      },
      {
        id: `SP-${suffix}-legacy`,
        serialNumber: equipment.serialNumber,
        inventoryNumber: equipment.inventoryNumber,
        type: 'shipping',
        date: '2026-05-18T11:00:00.000Z',
        uploadedBy: 'E2E',
        photos: [TINY_PNG],
        source: 'manual',
      },
      {
        id: `SP-${suffix}-broken`,
        type: 'receiving',
        date: '2026-05-18T12:00:00.000Z',
        uploadedBy: 'E2E',
        photos: [TINY_PNG],
        source: 'manual',
      },
    ]) {
      const res = await api.post('/api/shipping_photos', { data: event });
      expect(res.ok(), `${event.id}: ${res.status()} ${await res.text()}`).toBeTruthy();
    }

    return { client, equipment };
  });

  await loginAsAdmin(page);
  await navigateInApp(page, '/rentals');
  await expect(page.locator('main').getByRole('heading', { name: 'Аренды', exact: true }).first()).toBeVisible();
  await page.locator('main').getByRole('button', { name: /Движение техники/ }).click();

  await expect(page.getByRole('heading', { name: 'Движение техники' }).first()).toBeVisible();
  await expect(page.locator('main').getByText(seed.equipment.model).first()).toBeVisible();
  await expect(page.locator('main').getByText(`SN ${seed.equipment.serialNumber}`).first()).toBeVisible();
  await expect(page.locator('main').getByText(`INV ${seed.equipment.inventoryNumber}`).first()).toBeVisible();
  await expect(page.locator('main').getByRole('link', { name: new RegExp(seed.equipment.model) }).first()).toHaveAttribute('href', new RegExp(`/equipment/${seed.equipment.id}`));
  await expect(page.locator('main').getByText(seed.client.company).first()).toBeVisible();
  await expect(page.locator('main').getByText('Техника не найдена: нет equipmentId/SN/INV в источнике').first()).toBeVisible();
  await expect(page.locator('main').getByText(/undefined|null|\[object Object\]/)).toHaveCount(0);

  expect(issues).toEqual([]);
});

test('rentals movement tab shows empty state when movement history is empty', async ({ page }) => {
  const issues: UiIssue[] = [];
  installMovementGuards(page, issues);
  await page.route('**/api/shipping_photos**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]',
  }));

  await loginAsAdmin(page);
  await navigateInApp(page, '/rentals');
  await expect(page.locator('main').getByRole('heading', { name: 'Аренды', exact: true }).first()).toBeVisible();
  await page.locator('main').getByRole('button', { name: /Движение техники/ }).click();

  await expect(page.locator('main').getByRole('heading', { name: 'Движение техники' }).first()).toBeVisible();
  await expect(page.locator('main').getByText('Движение техники пока не зафиксировано')).toBeVisible();

  expect(issues).toEqual([]);
});

test('rentals movement sheet handles legacy movement entries without photos', async ({ page }) => {
  const issues: UiIssue[] = [];
  installMovementGuards(page, issues);

  const suffix = `movement-empty-photos-${Date.now()}`;
  const seed = await withAdminApi(async (api) => {
    const client = await createClient(api, suffix);
    const equipment = await createEquipment(api, suffix);
    const { rental } = await createRentalPair(api, {
      client: client.company,
      clientId: client.id,
      equipment,
      startDate: '2026-05-21',
      endDate: '2026-05-22',
      status: 'active',
      ganttStatus: 'active',
    });
    const comment = `Legacy no photos ${suffix}`;

    const res = await api.post('/api/shipping_photos', {
      data: {
        id: `SP-${suffix}`,
        rentalId: rental.id,
        equipmentId: equipment.id,
        type: 'shipping',
        date: '2026-05-21T08:00:00.000Z',
        uploadedBy: 'E2E',
        comment,
        source: 'manual',
      },
    });
    expect(res.ok(), `${res.status()} ${await res.text()}`).toBeTruthy();

    return { comment };
  });

  await loginAsAdmin(page);
  await navigateInApp(page, '/rentals');
  await expect(page.locator('main').getByRole('heading', { name: 'Аренды', exact: true }).first()).toBeVisible();
  await page.locator('main').getByRole('button', { name: /Ещё действия/ }).click();

  const sheet = page.locator('[data-rental-responsive-sheet="movement"]');
  await expect(sheet.getByRole('heading', { name: 'Движение техники' })).toBeVisible();
  const legacyCard = sheet.locator('div').filter({ hasText: seed.comment }).first();
  await expect(legacyCard).toContainText(seed.comment);
  await expect(legacyCard).toContainText('Фото: 0');

  expect(issues).toEqual([]);
});
