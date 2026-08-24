import { expect, test } from '@playwright/test';

import { createClient, withAdminApi } from './helpers/api';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

test('unused Client Contract can be archived, disappears from new Rental, and is deleted safely', async ({ page }) => {
  const suffix = `contract-lifecycle-${Date.now()}`;
  const { client, contract } = await withAdminApi(async api => {
    const client = await createClient(api, suffix);
    const response = await api.post('/api/client_contracts', {
      data: {
        clientId: client.id,
        counterpartyId: client.counterpartyId,
        title: `E2E lifecycle ${suffix}`,
        status: 'active',
      },
    });
    expect(response.ok()).toBeTruthy();
    return {
      client,
      contract: await response.json() as { id: string; number: string; status: string },
    };
  });

  await loginAsAdmin(page);
  await navigateInApp(page, `/rentals/new?clientId=${encodeURIComponent(client.id)}`);
  await expect(page.getByTestId('rental-contract-select')).toHaveValue('');
  await expect(page.getByTestId('rental-contract-select').locator(`option[value="${contract.id}"]`)).toHaveCount(1);

  await navigateInApp(page, `/clients/${client.id}`);
  const contractCard = page.locator(`[data-testid="client-contract-card"][data-contract-id="${contract.id}"]`);
  await expect(contractCard.getByText('Активен', { exact: true })).toBeVisible();
  await contractCard.getByRole('button', { name: 'Архивировать' }).click();
  await expect(contractCard.getByText('Архивный', { exact: true })).toBeVisible();

  await page.reload();
  const archivedCard = page.locator(`[data-testid="client-contract-card"][data-contract-id="${contract.id}"]`);
  await expect(archivedCard.getByText('Архивный', { exact: true })).toBeVisible();

  await navigateInApp(page, `/rentals/new?clientId=${encodeURIComponent(client.id)}`);
  await expect(page.getByText(/нет активных договоров/i)).toBeVisible();
  await expect(page.getByTestId('rental-contract-select')).toHaveCount(0);

  await navigateInApp(page, `/clients/${client.id}`);
  page.once('dialog', dialog => dialog.accept());
  await page.locator(`[data-testid="client-contract-card"][data-contract-id="${contract.id}"]`)
    .getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByText(contract.number, { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(contract.number, { exact: true })).toHaveCount(0);

  await withAdminApi(async api => {
    const contractsResponse = await api.get('/api/client_contracts');
    expect(contractsResponse.ok()).toBeTruthy();
    const contracts = await contractsResponse.json() as Array<{ id: string }>;
    expect(contracts.some(item => item.id === contract.id)).toBe(false);
    const deleteClientResponse = await api.delete(`/api/clients/${client.id}`);
    expect(deleteClientResponse.ok()).toBeTruthy();
  });
});
