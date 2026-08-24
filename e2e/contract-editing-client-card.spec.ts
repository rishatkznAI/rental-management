import { expect, test } from '@playwright/test';
import { createClient, createClientRentalRelations, withAdminApi } from './helpers/api';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

type ContractRecord = {
  id: string;
  number: string;
  clientId: string;
  objectId?: string;
  date?: string;
  title?: string;
  notes?: string;
  status: 'active' | 'archived';
};

test('Client Detail edits active and archived contracts in place and keeps values after reload', async ({ page }) => {
  const suffix = `contract-edit-${Date.now()}`;
  const seed = await withAdminApi(async api => {
    const client = await createClient(api, suffix);
    const relations = await createClientRentalRelations(api, client.id, suffix);
    const active = relations.contract as ContractRecord;

    const archivedResponse = await api.post('/api/client_contracts', {
      data: {
        clientId: client.id,
        objectId: relations.object.id,
        objectIds: [relations.object.id],
        date: '2026-06-01',
        title: 'E2E архивный договор',
        notes: 'Историческая запись',
        status: 'active',
      },
    });
    expect(archivedResponse.ok(), await archivedResponse.text()).toBeTruthy();
    const createdArchived = (await archivedResponse.json()) as ContractRecord;
    const archiveResponse = await api.patch(`/api/client_contracts/${createdArchived.id}`, {
      data: { status: 'archived' },
    });
    expect(archiveResponse.ok(), await archiveResponse.text()).toBeTruthy();
    const archived = (await archiveResponse.json()) as ContractRecord;
    return { client, object: relations.object, active, archived };
  });

  await loginAsAdmin(page);
  await navigateInApp(page, `/clients/${seed.client.id}`);
  await expect(page.getByRole('heading', { name: seed.client.company })).toBeVisible();

  const contractRow = (number: string) => page
    .locator('div.rounded-md.border')
    .filter({ has: page.getByText(number, { exact: true }) });

  const activeRow = contractRow(seed.active.number);
  await expect(activeRow.getByRole('button', { name: 'Открыть' })).toBeVisible();
  await expect(activeRow.getByRole('button', { name: 'Изменить' })).toBeVisible();
  await expect(activeRow.getByRole('button', { name: 'Архивировать' })).toBeVisible();
  await expect(activeRow.getByRole('button', { name: 'Удалить' })).toHaveCount(0);

  const archivedRow = contractRow(seed.archived.number);
  await expect(archivedRow.getByRole('button', { name: 'Открыть' })).toBeVisible();
  await expect(archivedRow.getByRole('button', { name: 'Изменить' })).toBeVisible();
  await expect(archivedRow.getByRole('button', { name: 'Удалить' })).toBeVisible();
  await expect(archivedRow.getByRole('button', { name: 'Архивировать' })).toHaveCount(0);

  await activeRow.getByRole('button', { name: 'Изменить' }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Изменить договор' })).toBeVisible();
  await expect(dialog.getByText(seed.active.number, { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Дата договора')).toHaveValue('2026-05-14');
  await expect(dialog.getByLabel('Название')).toHaveValue('E2E договор аренды');
  await expect(dialog.getByLabel('Объект')).toHaveValue(seed.object.id);
  await expect(dialog.getByLabel('Примечание')).toHaveValue('Created by Playwright');

  await dialog.getByLabel('Дата договора').fill('2026-08-24');
  await dialog.getByLabel('Название').fill('E2E договор после изменения');
  await dialog.getByLabel('Примечание').fill('Сохранено через edit mode карточки клиента');
  await dialog.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(activeRow).toContainText('E2E договор после изменения');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: seed.client.company })).toBeVisible();
  const reloadedRow = contractRow(seed.active.number);
  await expect(reloadedRow).toContainText('E2E договор после изменения');
  await reloadedRow.getByRole('button', { name: 'Изменить' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Дата договора')).toHaveValue('2026-08-24');
  await expect(dialog.getByLabel('Название')).toHaveValue('E2E договор после изменения');
  await expect(dialog.getByLabel('Примечание')).toHaveValue('Сохранено через edit mode карточки клиента');
  await dialog.getByRole('button', { name: 'Отмена' }).click();

  await withAdminApi(async api => {
    const response = await api.get(`/api/client_contracts/${seed.active.id}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    const stored = (await response.json()) as ContractRecord;
    expect(stored.id).toBe(seed.active.id);
    expect(stored.number).toBe(seed.active.number);
    expect(stored.status).toBe('active');
    expect(stored.date).toBe('2026-08-24');
    expect(stored.title).toBe('E2E договор после изменения');
    expect(stored.objectId).toBe(seed.object.id);
    expect(stored.notes).toBe('Сохранено через edit mode карточки клиента');
  });
});
