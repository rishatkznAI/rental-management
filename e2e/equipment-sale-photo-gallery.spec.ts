import { expect, test } from '@playwright/test';
import { createEquipment, withAdminApi } from './helpers/api';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axN5N8AAAAASUVORK5CYII=';
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

type PhotoReference = { id?: string; dataUrl?: string } | string;
type EquipmentWithPhotos = {
  id: string;
  photo?: PhotoReference;
  photos?: PhotoReference[];
};

test('sale card appends a photo, persists the gallery on reload, keeps main and rolls back upload errors', async ({ page }) => {
  const suffix = `sale-gallery-${Date.now()}`;
  const seeded = await withAdminApi(async api => {
    const equipment = await createEquipment(api, suffix);
    const salePatch = await api.patch(`/api/equipment/${equipment.id}`, {
      data: {
        isForSale: true,
        saleMode: true,
        saleStatus: 'На продаже',
      },
    });
    expect(salePatch.ok(), await salePatch.text()).toBeTruthy();

    const firstUpload = await api.post(`/api/equipment/${equipment.id}/photos`, {
      data: {
        photo: TINY_PNG_DATA_URL,
        filename: 'first.png',
        mimeType: 'image/png',
      },
    });
    expect(firstUpload.ok(), await firstUpload.text()).toBeTruthy();
    return {
      equipment,
      firstSaved: (await firstUpload.json()) as EquipmentWithPhotos,
    };
  });

  try {
    await loginAsAdmin(page);
    await navigateInApp(page, `/sales/equipment/${seeded.equipment.id}`);
    await expect(page.getByTestId('sale-photo-count')).toHaveText('1 фото в галерее');

    await page.getByTestId('sale-photo-input').setInputFiles({
      name: 'second.png',
      mimeType: 'image/png',
      buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
    });

    await expect(page.getByTestId('sale-photo-count')).toHaveText('2 фото в галерее');
    const afterSecond = await withAdminApi(async api => {
      const response = await api.get(`/api/equipment/${seeded.equipment.id}`);
      expect(response.ok(), await response.text()).toBeTruthy();
      return (await response.json()) as EquipmentWithPhotos;
    });
    expect(afterSecond.photos).toHaveLength(2);
    expect(afterSecond.photo).toEqual(seeded.firstSaved.photo);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('sale-photo-count')).toHaveText('2 фото в галерее');
    await page.getByRole('tab', { name: 'Фото' }).click();
    await expect(page.locator('[data-testid^="sale-gallery-photo-"]')).toHaveCount(2);
    await expect(page.getByText('Основное', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Сделать основным' })).toHaveCount(1);

    await page.route(`**/api/equipment/${seeded.equipment.id}/photos`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({ status: 500, json: { ok: false, error: 'Ошибка тестовой загрузки' } });
    });
    await page.getByTestId('sale-photo-input').setInputFiles({
      name: 'failed-third.png',
      mimeType: 'image/png',
      buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
    });
    await expect(page.getByText('Ошибка тестовой загрузки')).toBeVisible();
    await expect(page.getByTestId('sale-photo-count')).toHaveText('2 фото в галерее');
    await expect(page.locator('[data-testid^="sale-gallery-photo-"]')).toHaveCount(2);

    const afterFailure = await withAdminApi(async api => {
      const response = await api.get(`/api/equipment/${seeded.equipment.id}`);
      expect(response.ok(), await response.text()).toBeTruthy();
      return (await response.json()) as EquipmentWithPhotos;
    });
    expect(afterFailure.photos).toHaveLength(2);
    expect(afterFailure.photo).toEqual(seeded.firstSaved.photo);
  } finally {
    await page.unroute(`**/api/equipment/${seeded.equipment.id}/photos`).catch(() => undefined);
    await withAdminApi(async api => {
      const response = await api.delete(`/api/equipment/${seeded.equipment.id}`);
      expect(response.ok() || response.status() === 404, await response.text()).toBeTruthy();
    });
  }
});
