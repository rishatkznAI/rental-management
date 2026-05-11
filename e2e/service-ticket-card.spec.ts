import { expect, test } from '@playwright/test';
import { loginAsAdmin, loginAsRentalManager, navigateInApp } from './helpers/auth';
import { createClient, createEquipment, createRentalPair, withAdminApi } from './helpers/api';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function seedServiceTicket(suffix: string) {
  return withAdminApi(async (api) => {
    const equipment = await createEquipment(api, `card-${suffix}`);
    const client = await createClient(api, `Service Card ${suffix}`);
    const { rental } = await createRentalPair(api, {
      client: client.company,
      equipment,
      startDate: '2026-05-10',
      endDate: '2026-05-18',
      status: 'active',
      ganttStatus: 'active',
    });
    const now = new Date().toISOString();
    const reason = `E2E full service card reason ${suffix}`;
    const description = `E2E full service card description ${suffix}`;
    const result = `E2E repair result ${suffix}`;
    const mechanic = `E2E Mechanic ${suffix}`;
    const workName = `E2E hydraulic diagnostics ${suffix}`;
    const partName = `E2E filter kit ${suffix}`;
    const comment = `E2E visible service comment ${suffix}`;

    const res = await api.post('/api/service', {
      data: {
        equipmentId: equipment.id,
        serviceKind: 'repair',
        equipment: `${equipment.manufacturer} ${equipment.model} (INV: ${equipment.inventoryNumber})`,
        inventoryNumber: equipment.inventoryNumber,
        serialNumber: equipment.serialNumber,
        location: 'E2E сервисная зона',
        reason,
        description,
        priority: 'high',
        sla: '8 ч',
        assignedTo: mechanic,
        assignedMechanicName: mechanic,
        createdBy: 'E2E Admin',
        createdByUserName: 'E2E Admin',
        clientId: client.id,
        client: client.company,
        rentalId: rental.id,
        reporterContact: client.contact,
        source: 'manual',
        status: 'new',
        plannedDate: '2026-05-12',
        result,
        resultData: {
          summary: result,
          worksPerformed: [{
            catalogId: `work-${suffix}`,
            name: workName,
            normHours: 1,
            qty: 2,
            totalNormHours: 2,
            ratePerHour: 1500,
            totalCost: 3000,
          }],
          partsUsed: [{
            catalogId: `part-${suffix}`,
            name: partName,
            sku: `SKU-${suffix}`,
            qty: 1,
            cost: 750,
          }],
        },
        workLog: [{ date: now, text: comment, author: 'E2E Admin', type: 'comment' }],
        parts: [],
        photos: [],
        createdAt: now,
      },
    });
    expect(res.ok()).toBeTruthy();
    const ticket = (await res.json()) as { id: string };

    return { client, equipment, rental, ticket, reason, description, result, mechanic, workName, partName, comment };
  });
}

test('service list opens the full ticket card as a modal and keeps filters after closing', async ({ page }) => {
  const suffix = `${Date.now()}`;
  const seed = await seedServiceTicket(suffix);

  await loginAsAdmin(page);
  await navigateInApp(page, '/service');

  const searchInput = page.getByPlaceholder('№ заявки, техника, клиент, проблема...');
  await searchInput.fill(seed.reason);
  await expect(page.getByText(seed.reason).first()).toBeVisible();

  await page.getByRole('button', { name: new RegExp(`Открыть заявку ${escapeRegExp(seed.ticket.id)}`) }).click();

  const dialog = page.getByRole('dialog', { name: new RegExp(escapeRegExp(seed.ticket.id)) });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: seed.ticket.id })).toBeVisible();
  await expect(dialog.getByText(seed.reason).first()).toBeVisible();
  await expect(dialog.getByText(seed.description).first()).toBeVisible();
  await expect(dialog.getByText(seed.equipment.inventoryNumber).first()).toBeVisible();
  await expect(dialog.getByText(seed.equipment.serialNumber).first()).toBeVisible();
  await expect(dialog.getByText(seed.client.company).first()).toBeVisible();
  await expect(dialog.getByText(seed.rental.id).first()).toBeVisible();
  await expect(dialog.getByText(seed.mechanic).first()).toBeVisible();
  await expect(dialog.getByText(seed.workName).first()).toBeVisible();
  await expect(dialog.getByText(seed.partName).first()).toBeVisible();
  await expect(dialog.getByText(seed.result).first()).toBeVisible();
  await expect(dialog.getByText(seed.comment).first()).toBeVisible();
  await expect(dialog.getByText('Фото не добавлены')).toBeVisible();
  await expect(dialog.getByText(/mock/i)).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Закрыть карточку заявки' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/#\/service$/);
  await expect(page.getByRole('tab', { name: 'Заявки' })).toHaveAttribute('data-state', 'active');
  await expect(searchInput).toHaveValue(seed.reason);
});

test('service ticket card hides edit actions for a role without service edit permission', async ({ page }) => {
  const suffix = `readonly-${Date.now()}`;
  const seed = await seedServiceTicket(suffix);

  await loginAsRentalManager(page);
  await navigateInApp(page, '/service');

  await page.getByPlaceholder('№ заявки, техника, клиент, проблема...').fill(seed.reason);
  await page.getByRole('button', { name: new RegExp(`Открыть заявку ${escapeRegExp(seed.ticket.id)}`) }).click();

  const dialog = page.getByRole('dialog', { name: new RegExp(escapeRegExp(seed.ticket.id)) });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(seed.reason).first()).toBeVisible();
  await expect(dialog.getByText(seed.equipment.inventoryNumber).first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Взять в работу' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Отменить' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Добавить работу' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Загрузить фото' })).toHaveCount(0);
});
