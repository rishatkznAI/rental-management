import { expect, test } from '@playwright/test';
import { createClient, createDocument, createEquipment, createRentalPair, findServiceTicketByReason, withAdminApi } from './helpers/api';
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
    const otherClient = await createClient(api, `${suffix}-other`);
    const equipment = await createEquipment(api, suffix);
    const pair = await createRentalPair(api, {
      client: client.company,
      equipment,
      startDate: '2026-05-10',
      endDate: '2026-05-15',
    });
    await createDocument(api, {
      type: 'contract',
      number: `E2E-DOC-${suffix}`,
      client: client.company,
      clientId: client.id,
      rentalId: pair.rental.id,
      rental: pair.rental.id,
      equipmentId: equipment.id,
      equipmentInv: equipment.inventoryNumber,
      status: 'draft',
      manager: 'E2E',
    });
    await createDocument(api, {
      type: 'contract',
      number: `E2E-DOC-${suffix}-OTHER`,
      client: otherClient.company,
      clientId: otherClient.id,
      status: 'draft',
      manager: 'E2E',
    });
    const paymentRes = await api.post('/api/payments', {
      data: {
        invoiceNumber: `E2E-PAY-${suffix}`,
        rentalId: pair.rental.id,
        clientId: client.id,
        client: client.company,
        amount: 1000,
        paidAmount: 1000,
        dueDate: '2026-05-12',
        paidDate: '2026-05-12',
        status: 'paid',
        comment: 'E2E quick action payment',
      },
    });
    expect(paymentRes.ok()).toBeTruthy();
    const otherPaymentRes = await api.post('/api/payments', {
      data: {
        invoiceNumber: `E2E-PAY-${suffix}-OTHER`,
        clientId: otherClient.id,
        client: otherClient.company,
        amount: 1000,
        paidAmount: 0,
        dueDate: '2026-05-12',
        status: 'pending',
        comment: 'E2E quick action other payment',
      },
    });
    expect(otherPaymentRes.ok()).toBeTruthy();
    return { client, otherClient, equipment, rental: pair.rental };
  });

  await loginAsAdmin(page);

  await navigateInApp(page, `/clients/${seed.client.id}`);
  await expect(page.getByRole('heading', { name: seed.client.company })).toBeVisible();
  await expect(page.getByText('Быстрые действия').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать аренду' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Документы клиента' })).toBeVisible();

  await page.getByRole('button', { name: 'Документы клиента' }).click();
  await expect(page).toHaveURL(new RegExp(`#/documents.*clientId=${seed.client.id}`));
  await expect(page.getByText(`E2E-DOC-${suffix}`).first()).toBeVisible();
  await expect(page.getByText(`E2E-DOC-${suffix}-OTHER`)).toHaveCount(0);

  await navigateInApp(page, `/clients/${seed.client.id}`);
  await page.getByRole('button', { name: 'Создать документ' }).click();
  await expect(page).toHaveURL(new RegExp(`#/documents.*clientId=${seed.client.id}`));
  await expect(page).toHaveURL(/action=create/);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText(seed.client.company);
  await page.getByRole('button', { name: 'Отмена' }).click();

  await navigateInApp(page, `/clients/${seed.client.id}`);
  await page.getByRole('button', { name: 'Платежи клиента' }).click();
  await expect(page).toHaveURL(new RegExp(`#/payments.*clientId=${seed.client.id}`));
  await expect(page.getByText(`E2E-PAY-${suffix}`).first()).toBeVisible();
  await expect(page.getByText(`E2E-PAY-${suffix}-OTHER`)).toHaveCount(0);

  await page.route('**/api/tasks-center', async (route) => {
    await route.fulfill({
      json: {
        permissions: { canViewFinance: true },
        summary: { total: 2, critical: 0, high: 0, overdue: 0, today: 0 },
        tasks: [
          {
            id: `task-${suffix}`,
            title: `Task for ${seed.client.company}`,
            description: 'E2E client quick action task',
            clientId: seed.client.id,
            clientName: seed.client.company,
            priority: 'medium',
            section: 'rentals',
            dueDate: '2026-05-12',
            actionUrl: `/clients/${seed.client.id}`,
          },
          {
            id: `task-${suffix}-other`,
            title: `Task for ${seed.otherClient.company}`,
            description: 'E2E other client quick action task',
            clientId: seed.otherClient.id,
            clientName: seed.otherClient.company,
            priority: 'medium',
            section: 'rentals',
            dueDate: '2026-05-12',
            actionUrl: `/clients/${seed.otherClient.id}`,
          },
        ],
      },
    });
  });
  await navigateInApp(page, `/clients/${seed.client.id}`);
  await page.getByRole('button', { name: 'Задачи по клиенту' }).click();
  await expect(page).toHaveURL(new RegExp(`#/tasks.*clientId=${seed.client.id}`));
  await expect(page.getByText(`Task for ${seed.client.company}`)).toBeVisible();
  await expect(page.getByText(`Task for ${seed.otherClient.company}`)).toHaveCount(0);

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
