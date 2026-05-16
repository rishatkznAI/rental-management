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
    const rentalPair = await createRentalPair(api, {
      client: client.company,
      clientId: client.id,
      equipment,
      startDate: '2026-05-10',
      endDate: '2026-05-20',
      status: 'active',
      ganttStatus: 'active',
    });
    return { client, rental: rentalPair.rental };
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

  await dialog.locator('[role="combobox"]').first().click();
  await page.getByRole('option', { name: new RegExp(seed.rental.id) }).click();

  await dialog.getByRole('button', { name: 'Далее' }).click();
  await expect(dialog.getByText(seed.client.company)).toBeVisible();
  await dialog.getByRole('button', { name: 'Далее' }).click();
  await expect(dialog.getByText('Все обязательные данные заполнены.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Далее' }).click();

  const generateResponse = page.waitForResponse(response =>
    response.url().includes('/api/documents/generate') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Создать черновик' }).click();
  const response = await generateResponse;
  expect(response.status()).toBe(201);
  const document = await response.json();
  expect(document.clientId).toBe(seed.client.id);
  expect(document.rentalId).toBe(seed.rental.id);
  expect(document.type).toBe('rental_contract');

  await expect(page.getByRole('heading', { name: new RegExp(document.number) })).toBeVisible();
  expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
});
