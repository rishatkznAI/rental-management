import { expect, test } from '@playwright/test';
import {
  createClient,
  createDocument,
  createEquipment,
  createRentalPair,
  withAdminApi,
} from './helpers/api';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

function futureDate(offsetDays: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

test('Client Details tabs use canonical data, URL history, deep links and persistent selection', async ({ page }) => {
  const suffix = `client-tabs-${Date.now()}`;
  const seed = await withAdminApi(async (api) => {
    const client = await createClient(api, suffix);
    const otherClient = await createClient(api, `${suffix}-other`);
    const equipment = await createEquipment(api, suffix);
    const otherEquipment = await createEquipment(api, `${suffix}-other`);
    const pair = await createRentalPair(api, {
      client: client.company,
      clientId: client.id,
      equipment,
      startDate: futureDate(0),
      endDate: futureDate(7),
      amount: 45000,
      status: 'active',
      ganttStatus: 'active',
    });
    const otherPair = await createRentalPair(api, {
      client: otherClient.company,
      clientId: otherClient.id,
      equipment: otherEquipment,
      startDate: futureDate(0),
      endDate: futureDate(8),
      amount: 99000,
      status: 'active',
      ganttStatus: 'active',
    });
    const document = await createDocument(api, {
      type: 'contract',
      number: `TAB-DOC-${suffix}`,
      client: client.company,
      clientId: client.id,
      rentalId: pair.rental.id,
      rental: pair.rental.id,
      equipmentId: equipment.id,
      equipmentInv: equipment.inventoryNumber,
      date: futureDate(0),
      status: 'signed',
      manager: 'E2E',
    });
    await createDocument(api, {
      type: 'contract',
      number: `TAB-DOC-${suffix}-OTHER`,
      client: otherClient.company,
      clientId: otherClient.id,
      rentalId: otherPair.rental.id,
      rental: otherPair.rental.id,
      equipmentId: otherEquipment.id,
      equipmentInv: otherEquipment.inventoryNumber,
      date: futureDate(0),
      status: 'signed',
      manager: 'E2E',
    });
    const paymentResponse = await api.post('/api/payments', {
      data: {
        invoiceNumber: `TAB-PAY-${suffix}`,
        rentalId: pair.rental.id,
        clientId: client.id,
        client: client.company,
        amount: 30000,
        paidAmount: 30000,
        dueDate: futureDate(1),
        paidDate: futureDate(1),
        status: 'paid',
      },
    });
    expect(paymentResponse.ok(), await paymentResponse.text()).toBeTruthy();
    const payment = await paymentResponse.json() as { id: string };
    const allocationResponse = await api.post('/api/payment_allocations', {
      data: {
        paymentId: payment.id,
        clientId: client.id,
        rentalId: pair.rental.id,
        amount: 25000,
        status: 'active',
        source: 'manual',
      },
    });
    expect(allocationResponse.ok(), await allocationResponse.text()).toBeTruthy();
    const otherPaymentResponse = await api.post('/api/payments', {
      data: {
        invoiceNumber: `TAB-PAY-${suffix}-OTHER`,
        rentalId: otherPair.rental.id,
        clientId: otherClient.id,
        client: otherClient.company,
        amount: 70000,
        paidAmount: 70000,
        dueDate: futureDate(1),
        paidDate: futureDate(1),
        status: 'paid',
      },
    });
    expect(otherPaymentResponse.ok(), await otherPaymentResponse.text()).toBeTruthy();

    return { client, otherClient, equipment, otherEquipment, rental: pair.rental, otherRental: otherPair.rental, document, payment };
  });

  await loginAsAdmin(page);
  await navigateInApp(page, `/clients/${seed.client.id}`);

  await expect(page.getByRole('heading', { name: seed.client.company })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'Обзор' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Аренды\s+1/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Платежи\s+1/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Документы\s+2/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Техника\s+1/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /История активности\s+[1-9]/ })).toBeVisible();

  await page.getByRole('tab', { name: /Аренды/ }).click();
  await expect(page).toHaveURL(/tab=rentals/);
  const rentalsPanel = page.getByRole('tabpanel', { name: /Аренды/ });
  await expect(rentalsPanel).toContainText(seed.rental.number);
  await expect(rentalsPanel).not.toContainText(seed.otherRental.number);

  const newRentalLink = rentalsPanel.getByRole('link', { name: 'Новая аренда' });
  await expect(newRentalLink).toHaveAttribute('href', new RegExp(`clientId=${encodeURIComponent(seed.client.id)}`));

  await page.getByRole('tab', { name: /Платежи/ }).click();
  await expect(page).toHaveURL(/tab=payments/);
  const paymentPanel = page.getByRole('tabpanel', { name: /Платежи/ });
  await expect(paymentPanel).toContainText(`TAB-PAY-${suffix}`);
  await expect(paymentPanel).not.toContainText(`TAB-PAY-${suffix}-OTHER`);
  await expect(paymentPanel).toContainText('25 000');

  await page.goBack();
  await expect(page).toHaveURL(/tab=rentals/);
  await expect(page.getByRole('tabpanel', { name: /Аренды/ })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/tab=payments/);
  await page.reload();
  await expect(page.getByRole('tabpanel', { name: /Платежи/ })).toContainText(`TAB-PAY-${suffix}`);

  await navigateInApp(page, `/clients/${seed.client.id}?tab=documents`);
  const documentsPanel = page.getByRole('tabpanel', { name: /Документы/ });
  await expect(documentsPanel).toContainText(`TAB-DOC-${suffix}`);
  await expect(documentsPanel).not.toContainText(`TAB-DOC-${suffix}-OTHER`);
  await documentsPanel.getByRole('link', { name: 'Открыть документ' }).click();
  await expect(page).toHaveURL(new RegExp(`documentId=${seed.document.id}`));
  await expect(page.getByRole('dialog')).toContainText(`TAB-DOC-${suffix}`);

  await navigateInApp(page, `/clients/${seed.client.id}?tab=equipment`);
  const equipmentPanel = page.getByRole('tabpanel', { name: /Техника/ });
  await expect(equipmentPanel).toContainText(seed.equipment.inventoryNumber);
  await expect(equipmentPanel).toContainText('Сейчас у клиента');
  await expect(equipmentPanel).not.toContainText(seed.otherEquipment.inventoryNumber);

  await page.getByRole('tab', { name: /История активности/ }).click();
  await expect(page).toHaveURL(/tab=activity/);
  await expect(page.getByRole('tabpanel', { name: /История активности/ })).toContainText(`TAB-PAY-${suffix}`);

  await navigateInApp(page, `/clients/${seed.client.id}?tab=not-a-real-tab`);
  await expect(page).toHaveURL(/tab=overview/);
  await expect(page.getByRole('tabpanel', { name: 'Обзор' })).toBeVisible();
});

test('Client Details tabs show action-oriented empty states', async ({ page }) => {
  const client = await withAdminApi(api => createClient(api, `client-tabs-empty-${Date.now()}`));
  await loginAsAdmin(page);

  const emptyStates = [
    ['rentals', 'У клиента пока нет аренд'],
    ['payments', 'У клиента пока нет платежей'],
    ['documents', 'У клиента пока нет документов'],
    ['equipment', 'В арендной истории клиента пока нет техники'],
  ] as const;

  for (const [tab, message] of emptyStates) {
    await navigateInApp(page, `/clients/${client.id}?tab=${tab}`);
    await expect(page.getByText(message, { exact: true })).toBeVisible();
  }

  await navigateInApp(page, `/clients/${client.id}?tab=activity`);
  await expect(page.getByRole('tabpanel', { name: /История активности/ })).toContainText('Клиент создан');
});
