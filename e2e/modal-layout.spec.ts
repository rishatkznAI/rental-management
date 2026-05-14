import { expect, test, type Page } from '@playwright/test';
import { createEquipment, withAdminApi } from './helpers/api';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

async function expectActionInsideViewport(page: Page, buttonName: string | RegExp) {
  const button = page.getByRole('button', { name: buttonName }).last();
  await expect(button).toBeVisible();
  await button.click({ trial: true });

  const box = await button.boundingBox();
  expect(box, `Expected ${String(buttonName)} button to have a bounding box`).toBeTruthy();
  const viewport = page.viewportSize();
  expect(viewport, 'Expected Playwright viewport to be configured').toBeTruthy();

  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
}

async function openEquipmentEditDialog(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  const suffix = `modal-layout-${viewport.width}x${viewport.height}-${Date.now()}`;
  const equipment = await withAdminApi((api) => createEquipment(api, suffix));

  await loginAsAdmin(page);
  await navigateInApp(page, `/equipment/${equipment.id}?action=edit`);

  const dialog = page.getByRole('dialog', { name: /Редактировать технику/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(equipment.inventoryNumber)).toBeVisible();

  const scrollArea = dialog.locator('.overflow-y-auto').first();
  await scrollArea.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });

  await expectActionInsideViewport(page, 'Отмена');
  await expectActionInsideViewport(page, /Сохранить изменения|Сохранение/);

  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).toBeTruthy();
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport.height);

  return dialog;
}

test.describe('modal action layout', () => {
  test('equipment edit footer stays visible at 1366x768', async ({ page }) => {
    const dialog = await openEquipmentEditDialog(page, { width: 1366, height: 768 });
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('equipment edit footer stays visible at 1280x720', async ({ page }) => {
    const dialog = await openEquipmentEditDialog(page, { width: 1280, height: 720 });
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('equipment edit footer stacks and stays visible on mobile width', async ({ page }) => {
    const dialog = await openEquipmentEditDialog(page, { width: 390, height: 844 });
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await expect(dialog).toHaveCount(0);
  });
});
