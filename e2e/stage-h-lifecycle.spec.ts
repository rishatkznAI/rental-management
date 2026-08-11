import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';
import { createClient, createEquipment, createRentalPair, withAdminApi } from './helpers/api';

async function openRentalDrawer(page: Page, rentalId: string) {
  await navigateInApp(page, '/rentals');
  const rentalLink = page.getByText(rentalId, { exact: true }).last();
  await expect(rentalLink).toBeVisible();
  await rentalLink.click();
  await expect(page.getByRole('button', { name: 'Редактировать аренду' })).toBeVisible();
  await page.getByRole('button', { name: 'Редактировать аренду' }).click();
  await expect(page.getByTestId('rental-drawer-end-date')).toBeVisible();
}

async function readLifecycleProjection(api: APIRequestContext, rentalId: string, equipmentId: string) {
  const [rentalsResponse, ganttResponse, equipmentResponse] = await Promise.all([
    api.get('/api/rentals'),
    api.get('/api/gantt_rentals'),
    api.get(`/api/equipment/${equipmentId}`),
  ]);
  expect(rentalsResponse.ok(), await rentalsResponse.text()).toBeTruthy();
  expect(ganttResponse.ok(), await ganttResponse.text()).toBeTruthy();
  expect(equipmentResponse.ok(), await equipmentResponse.text()).toBeTruthy();
  const rentals = await rentalsResponse.json() as Array<{ id: string; plannedReturnDate?: string }>;
  const ganttRentals = await ganttResponse.json() as Array<{ rentalId?: string; endDate?: string }>;
  return {
    rental: rentals.find(item => item.id === rentalId),
    ganttRental: ganttRentals.find(item => item.rentalId === rentalId),
    equipment: await equipmentResponse.json() as { returnDate?: string; status?: string },
  };
}

test('drawer date edit persists the classic rental and lifecycle projections atomically', async ({ page }) => {
  const suffix = `stage-h-happy-${Date.now()}`;
  const seed = await withAdminApi(async api => {
    const client = await createClient(api, suffix);
    const equipment = await createEquipment(api, suffix);
    const pair = await createRentalPair(api, {
      client: client.company,
      clientId: client.id,
      equipment,
      startDate: '2026-08-10',
      endDate: '2026-08-17',
      status: 'active',
      ganttStatus: 'active',
    });
    return { ...pair, equipment };
  });

  await loginAsAdmin(page);
  await openRentalDrawer(page, seed.rental.id);
  await page.getByTestId('rental-drawer-end-date').fill('2026-08-15');
  await page.getByTestId('rental-drawer-save').click();
  await expect(page.getByTestId('rental-drawer-end-date')).toBeHidden();

  await withAdminApi(async api => {
    const projection = await readLifecycleProjection(api, seed.rental.id, seed.equipment.id);
    expect(projection.rental?.plannedReturnDate).toBe('2026-08-15');
    expect(projection.ganttRental?.endDate).toBe('2026-08-15');
    expect(projection.equipment.returnDate).toBe('2026-08-15');
    expect(projection.equipment.status).toBe('rented');
  });
});

test('drawer keeps the form open and identifies a real equipment date conflict', async ({ page }) => {
  const suffix = `stage-h-conflict-${Date.now()}`;
  const seed = await withAdminApi(async api => {
    const firstClient = await createClient(api, `${suffix}-a`);
    const secondClient = await createClient(api, `${suffix}-b`);
    const equipment = await createEquipment(api, suffix);
    await createRentalPair(api, {
      client: firstClient.company,
      clientId: firstClient.id,
      equipment,
      startDate: '2026-08-10',
      endDate: '2026-08-12',
      status: 'active',
      ganttStatus: 'active',
    });
    const second = await createRentalPair(api, {
      client: secondClient.company,
      clientId: secondClient.id,
      equipment,
      startDate: '2026-08-15',
      endDate: '2026-08-17',
      status: 'created',
      ganttStatus: 'created',
    });
    return second;
  });

  await loginAsAdmin(page);
  await openRentalDrawer(page, seed.rental.id);
  await page.getByTestId('rental-drawer-start-date').fill('2026-08-11');
  await page.getByTestId('rental-drawer-save').click();

  await expect(page.getByText(/Техника уже занята в период/)).toBeVisible();
  await expect(page.getByTestId('rental-drawer-start-date')).toHaveValue('2026-08-11');
});
