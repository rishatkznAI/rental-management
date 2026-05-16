import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';
import { createClient, createEquipment, createRentalPair, withAdminApi } from './helpers/api';

type UiIssue = {
  type: string;
  text?: string;
  status?: number;
  url: string;
};

function installDocumentWizardGuards(page: Page, issues: UiIssue[]) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/ResizeObserver loop|Download the React DevTools|favicon/i.test(text)) return;
    issues.push({ type: 'console.error', text, url: page.url() });
  });
  page.on('pageerror', (error) => {
    issues.push({ type: 'pageerror', text: error.message, url: page.url() });
  });
  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    if (!/\/api\//.test(url)) return;
    if (status >= 500 || [401, 403].includes(status)) {
      issues.push({ type: 'bad-response', status, url });
    }
  });
}

test('admin creates rental contract draft with selected client in document wizard', async ({ page }) => {
  const suffix = `contract-wizard-${Date.now()}`;
  const seed = await withAdminApi(async (api) => {
    const client = await createClient(api, suffix);
    const equipment = await createEquipment(api, suffix);
    const { rental } = await createRentalPair(api, {
      client: client.company,
      clientId: client.id,
      equipment,
      startDate: '2026-05-10',
      endDate: '2026-05-12',
      amount: 30000,
      status: 'active',
      ganttStatus: 'active',
    });
    return { client, equipment, rental };
  });

  const issues: UiIssue[] = [];
  installDocumentWizardGuards(page, issues);

  await loginAsAdmin(page);
  await navigateInApp(page, '/documents');
  await page.getByRole('button', { name: /^Создать документ$/ }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Договор аренды/ }).click();

  await dialog.getByText('Выберите клиента из базы').click();
  await page.getByPlaceholder('Выберите клиента из базы').fill(seed.client.company);
  await page.getByText(seed.client.company).click();
  await expect(dialog.getByText(seed.client.company)).toBeVisible();
  await expect(dialog.getByText(/^Аренда$/)).toHaveCount(0);
  await expect(dialog.getByText(/^Техника$/)).toHaveCount(0);
  await expect(dialog.getByText(/^Сервисная заявка$/)).toHaveCount(0);
  await expect(dialog.getByText(/^Доставка$/)).toHaveCount(0);
  await expect(dialog.getByText(/^Механик$/)).toHaveCount(0);
  await expect(dialog.getByText(/^Служебная машина$/)).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Далее' }).click();
  await dialog.getByRole('textbox').nth(0).fill('Иванов Иван Иванович');
  await dialog.getByRole('textbox').nth(1).fill('Генеральный директор');
  await dialog.locator('[role="combobox"]').first().click();
  await page.getByRole('option', { name: 'Устав' }).click();
  await dialog.getByRole('button', { name: 'Далее' }).click();
  await expect(dialog.getByText('Банк')).toBeVisible();
  await dialog.getByRole('button', { name: 'Далее' }).click();
  await expect(dialog.getByText('Будет сгенерирован автоматически')).toBeVisible();

  const generateResponse = page.waitForResponse(response =>
    response.url().includes('/api/documents/generate') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Создать черновик' }).click();
  const response = await generateResponse;
  expect(response.status()).toBe(201);
  const document = await response.json();
  expect(document.clientId).toBe(seed.client.id);
  expect(document.rentalId).toBeFalsy();
  expect(document.type).toBe('rental_contract');
  expect(document.payload.signer.name).toBe('Иванов Иван Иванович');
  expect(document.payload.signer.basis).toBe('Устав');

  await expect(page.getByRole('heading', { name: new RegExp(document.number) })).toBeVisible();

  const chain = await withAdminApi(async (api) => {
    const specRes = await api.post('/api/documents/generate', {
      data: {
        type: 'rental_specification',
        parentDocumentId: document.id,
        clientId: seed.client.id,
        rentalId: seed.rental.id,
        equipmentId: seed.equipment.id,
        dailyRate: '1000 ₽/день',
        amount: 30000,
        date: '2026-05-10',
      },
    });
    expect(specRes.ok(), await specRes.text()).toBeTruthy();
    const spec = await specRes.json();

    const transferRes = await api.post('/api/documents/generate', {
      data: {
        type: 'transfer_act_to_client',
        parentDocumentId: document.id,
        specificationId: spec.id,
        clientId: seed.client.id,
        rentalId: seed.rental.id,
        equipmentId: seed.equipment.id,
        transferDate: '2026-05-10',
        equipmentCondition: 'Исправна',
      },
    });
    expect(transferRes.ok(), await transferRes.text()).toBeTruthy();
    const transfer = await transferRes.json();

    const returnRes = await api.post('/api/documents/generate', {
      data: {
        type: 'return_act_from_client',
        parentDocumentId: document.id,
        specificationId: spec.id,
        clientId: seed.client.id,
        rentalId: seed.rental.id,
        equipmentId: seed.equipment.id,
        returnDate: '2026-05-12',
        returnCondition: 'Рабочее',
        damages: 'Нет',
        missingItems: 'Нет',
        serviceRequired: 'Нет',
      },
    });
    expect(returnRes.ok(), await returnRes.text()).toBeTruthy();
    const returnAct = await returnRes.json();

    for (const item of [document, spec, transfer, returnAct]) {
      const print = await api.get(`/api/documents/${item.id}/print`);
      expect(print.ok(), `${item.type} print`).toBeTruthy();
      const html = await print.text();
      expect(html).toMatch(/<!doctype html>/i);
      if (item.id === returnAct.id) {
        expect(html).not.toMatch(/<th>Сервисная заявка<\/th>\s*<td>—<\/td>/);
        expect(html).not.toMatch(/Сервисная заявка<\/th>/);
      }
    }

    return { spec, transfer, returnAct };
  });

  await navigateInApp(page, '/documents');
  await expect(page.getByText(document.number).first()).toBeVisible();
  await expect(page.getByText(chain.spec.number).first()).toBeVisible();
  await expect(page.getByText(chain.transfer.number).first()).toBeVisible();
  await expect(page.getByText(chain.returnAct.number).first()).toBeVisible();

  await page.getByRole('button', { name: /Контроль/ }).click();
  await expect(page.getByRole('heading', { name: 'Контроль документов' })).toBeVisible();
  await expect(page.locator('tr').filter({ hasText: seed.rental.id }).filter({ hasText: 'Нет договора' })).toHaveCount(0);
  await expect(page.locator('tr').filter({ hasText: seed.rental.id }).filter({ hasText: 'Нет спецификации' })).toHaveCount(0);
  await expect(page.locator('tr').filter({ hasText: seed.rental.id }).filter({ hasText: 'Нет акта передачи' })).toHaveCount(0);

  expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
});
