import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import {
  createClient,
  createRentalPair,
  findGanttRentalById,
  findServiceTicketByEquipmentId,
  getAnyRentableEquipment,
  getEquipmentById,
  withAdminApi,
} from './helpers/api';

test('admin can return equipment into service from the rentals planner', async ({ page }) => {
  const suffix = `return-${Date.now()}`;
  const { equipment, rental, ganttId } = await withAdminApi(async (api) => {
    const client = await createClient(api, suffix);
    const equipment = await getAnyRentableEquipment(api);
    const pair = await createRentalPair(api, {
      client: client.company,
      equipment,
      startDate: '2026-04-18',
      endDate: '2026-04-20',
      amount: 12000,
      manager: 'E2E',
    });
    return { equipment, rental: pair.rental, ganttId: pair.ganttId };
  });

  await loginAsAdmin(page);
  await page.goto('./#/rentals');

  await expect(page.getByRole('heading', { name: 'Планировщик аренды' })).toBeVisible();
  await page.getByRole('button', { name: 'Возврат техники' }).click();

  const returnModal = page
    .getByRole('heading', { name: 'Возврат техники' })
    .locator('xpath=ancestor::div[contains(@class,"rounded-xl")]');

  await expect(returnModal).toBeVisible();
  await returnModal.locator('select').first().selectOption(ganttId);
  await returnModal.getByLabel('Отправить в сервис').check();
  await returnModal.getByRole('button', { name: 'Подтвердить возврат' }).click();

  await expect(page.getByText(`Возврат оформлен: ${equipment.inventoryNumber}`)).toBeVisible();

  await withAdminApi(async (api) => {
    const updatedGantt = await findGanttRentalById(api, ganttId);
    expect(updatedGantt.status).toBe('returned');

    const updatedEquipment = await getEquipmentById(api, equipment.id);
    expect(updatedEquipment.status).toBe('in_service');

    const autoInspection = await findServiceTicketByEquipmentId(api, equipment.id);
    expect(autoInspection, `Expected auto-created service ticket for ${equipment.id}`).toBeTruthy();
    expect(autoInspection?.reason).toContain('Приёмка с аренды');
  });
});
