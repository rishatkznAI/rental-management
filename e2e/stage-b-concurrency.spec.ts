import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';
import {
  createClient,
  createClientRentalRelations,
  createEquipment,
  withAdminApi,
} from './helpers/api';

type RentalFormFixture = {
  client: { id: string; company: string };
  object: { id: string };
  contract: { id: string };
  equipment: { id: string; inventoryNumber: string; serialNumber: string };
};

async function createRentalFormFixture(api: APIRequestContext, suffix: string): Promise<RentalFormFixture> {
  const client = await createClient(api, suffix);
  const relations = await createClientRentalRelations(api, client.id, suffix);
  const equipment = await createEquipment(api, `${suffix}-eq`);
  return { client, ...relations, equipment };
}

async function selectEquipment(page: Page, equipment: { serialNumber: string; inventoryNumber: string }) {
  const root = page.getByTestId('rental-equipment-select');
  await root.click();
  const search = root.locator('input');
  await search.fill(equipment.serialNumber || equipment.inventoryNumber);
  await root.locator('li[data-eq-item]').first().click();
}

async function fillRentalForm(
  page: Page,
  fixture: RentalFormFixture,
  options: { notes: string; rate?: string; deposit?: string } = { notes: 'Stage B' },
) {
  await navigateInApp(page, '/rentals/new');
  await expect(page.getByRole('heading', { name: 'Новая аренда' })).toBeVisible();
  await page.getByTestId('rental-client-select').selectOption(fixture.client.id);
  await expect(page.getByTestId('rental-object-select')).toBeVisible();
  await page.getByTestId('rental-object-select').selectOption(fixture.object.id);
  await expect(page.getByTestId('rental-contract-select')).toBeVisible();
  await page.getByTestId('rental-contract-select').selectOption(fixture.contract.id);
  await page.getByTestId('rental-start-date').fill('2027-02-10');
  await page.getByTestId('rental-end-date').fill('2027-02-12');
  await selectEquipment(page, fixture.equipment);
  await page.getByTestId('rental-daily-rate').fill(options.rate || '1250');
  await page.getByTestId('rental-deposit').fill(options.deposit || '5000');
  await page.getByTestId('rental-notes').fill(options.notes);
  await expect(page.getByTestId('rental-submit')).toBeEnabled();
}

async function rentalsForClient(api: APIRequestContext, clientId: string) {
  const response = await api.get('/api/rentals');
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as Array<{ id: string; clientId?: string }>).filter(item => item.clientId === clientId);
}

test('clean financial state recovers from authoritative 409 and acknowledged retry succeeds', async ({ page }) => {
  const fixture = await withAdminApi(api => createRentalFormFixture(api, `stage-b-risk-${Date.now()}`));
  await loginAsAdmin(page);
  await fillRentalForm(page, fixture, { notes: 'Финансовый conflict не должен стереть форму' });
  await expect(page.getByTestId('financial-current-debt')).toContainText('0');

  await withAdminApi(async api => {
    const changed = await api.patch(`/api/clients/${fixture.client.id}`, {
      data: { debt: 10_000, creditLimit: 5_000 },
    });
    expect(changed.ok(), await changed.text()).toBeTruthy();
  });

  let rentalPosts = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/rentals') rentalPosts += 1;
  });
  await page.getByTestId('rental-submit').click();

  await expect(page.getByTestId('rental-form-error')).toContainText('Подтвердите создание аренды');
  await expect(page.getByTestId('financial-current-debt')).toContainText(/10.?000/);
  await expect(page.getByTestId('financial-credit-limit')).toContainText(/5.?000/);
  await expect(page.getByTestId('financial-rental-counts')).toContainText('просроченных: 0');
  await expect(page.getByTestId('financial-risk-reason')).toContainText('Превышен кредитный лимит');
  await expect(page.getByTestId('rental-notes')).toHaveValue('Финансовый conflict не должен стереть форму');
  await expect(page.getByTestId('rental-submit')).toBeDisabled();

  await page.getByTestId('credit-risk-acknowledgement').check();
  await expect(page.getByTestId('rental-submit')).toBeEnabled();
  await page.getByTestId('rental-submit').click();
  await expect(page).toHaveURL(/#\/rentals$/);
  expect(rentalPosts).toBe(2);
  await withAdminApi(async api => expect((await rentalsForClient(api, fixture.client.id)).length).toBe(1));
});

test('two stale browser sessions recover availability conflict and preserve the second form', async ({ browser }) => {
  test.setTimeout(60_000);
  const setup = await withAdminApi(async api => {
    const fixture = await createRentalFormFixture(api, `stage-b-tabs-${Date.now()}`);
    const alternative = await createEquipment(api, `stage-b-tabs-alt-${Date.now()}`);
    return { fixture, alternative };
  });
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  let frozenGantt: unknown = null;
  await secondPage.route('**/api/gantt_rentals', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    if (frozenGantt === null) {
      const response = await route.fetch();
      frozenGantt = await response.json();
    }
    await route.fulfill({ status: 200, contentType: 'application/json', json: frozenGantt });
  });

  try {
    await loginAsAdmin(firstPage);
    await loginAsAdmin(secondPage);
    await fillRentalForm(firstPage, setup.fixture, { notes: 'Первый оператор' });
    await fillRentalForm(secondPage, setup.fixture, {
      notes: 'Второй оператор сохраняет форму',
      rate: '1777',
      deposit: '8888',
    });

    await firstPage.getByTestId('rental-submit').click();
    await expect(firstPage).toHaveURL(/#\/rentals$/);

    await secondPage.getByTestId('rental-submit').click();
    await expect(secondPage.getByTestId('equipment-availability-conflict')).toContainText('Техника уже занята');
    await expect(secondPage.getByTestId('equipment-availability-conflict')).toContainText(setup.fixture.client.company);
    await expect(secondPage.getByTestId('rental-submit')).toBeDisabled();
    await expect(secondPage.getByTestId('rental-notes')).toHaveValue('Второй оператор сохраняет форму');
    await expect(secondPage.getByTestId('rental-daily-rate')).toHaveValue('1777');
    await expect(secondPage.getByTestId('rental-deposit')).toHaveValue('8888');

    await selectEquipment(secondPage, setup.alternative);
    await expect(secondPage.getByTestId('equipment-availability-conflict')).toBeHidden();
    await expect(secondPage.getByTestId('rental-submit')).toBeEnabled();
    await secondPage.getByTestId('rental-submit').click();
    await expect(secondPage).toHaveURL(/#\/rentals$/);
    await withAdminApi(async api => expect((await rentalsForClient(api, setup.fixture.client.id)).length).toBe(2));
  } finally {
    await firstContext.close().catch(() => undefined);
    await secondContext.close().catch(() => undefined);
  }
});

test('inline relation create separates server success from refresh and safely retries an unknown result', async ({ page }) => {
  const client = await withAdminApi(api => createClient(api, `stage-b-inline-${Date.now()}`));
  await loginAsAdmin(page);
  await navigateInApp(page, '/rentals/new');
  await page.getByTestId('rental-client-select').selectOption(client.id);

  let loseFirstObjectResponse = true;
  let objectPosts = 0;
  await page.route('**/api/client_objects', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    objectPosts += 1;
    if (loseFirstObjectResponse) {
      loseFirstObjectResponse = false;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      return route.abort('failed');
    }
    return route.continue();
  });

  await page.getByRole('button', { name: 'Добавить объект' }).click();
  await page.getByPlaceholder('Название объекта').fill('Склад unknown outcome');
  await page.getByPlaceholder('Адрес объекта').fill('Казань');
  await page.getByRole('button', { name: 'Сохранить объект' }).click();
  await expect(page.getByTestId('relation-error')).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить объект' }).click();
  await expect(page.getByTestId('rental-object-select')).toBeVisible();
  await expect(page.getByTestId('rental-object-select')).not.toHaveValue('');
  expect(objectPosts).toBe(2);

  let failContractRefresh = true;
  let contractPosts = 0;
  await page.route('**/api/client_contracts', async route => {
    if (route.request().method() === 'POST') {
      contractPosts += 1;
      return route.continue();
    }
    if (route.request().method() === 'GET' && failContractRefresh) return route.abort('failed');
    return route.continue();
  });
  await page.getByRole('button', { name: 'Добавить договор' }).click();
  await page.getByPlaceholder('Номер договора').fill('Д-STAGE-B');
  await page.getByRole('button', { name: 'Сохранить договор' }).dblclick();
  await expect(page.getByTestId('rental-contract-select')).toBeVisible();
  await expect(page.getByTestId('rental-contract-select')).not.toHaveValue('');
  await expect(page.getByTestId('relation-refresh-warning')).toContainText('Договор создан и выбран');
  failContractRefresh = false;
  expect(contractPosts).toBe(1);

  await withAdminApi(async api => {
    const [objectsResponse, contractsResponse] = await Promise.all([
      api.get('/api/client_objects'),
      api.get('/api/client_contracts'),
    ]);
    const objects = (await objectsResponse.json()) as Array<{ clientId: string }>;
    const contracts = (await contractsResponse.json()) as Array<{ clientId: string }>;
    expect(objects.filter(item => item.clientId === client.id)).toHaveLength(1);
    expect(contracts.filter(item => item.clientId === client.id)).toHaveLength(1);
  });
});

test('rental submit recovers validation and network errors and guards delayed Enter plus click', async ({ page }) => {
  const fixture = await withAdminApi(api => createRentalFormFixture(api, `stage-b-submit-${Date.now()}`));
  await loginAsAdmin(page);
  await fillRentalForm(page, fixture, { notes: 'Форма переживает ошибки', rate: '-1', deposit: '3210' });

  await page.getByTestId('rental-submit').click();
  await expect(page.getByTestId('rental-form-error')).toContainText(/ставк/i);
  await expect(page.getByTestId('rental-submit')).toBeEnabled();
  await expect(page.getByTestId('rental-notes')).toHaveValue('Форма переживает ошибки');
  await page.getByTestId('rental-daily-rate').fill('1400');

  let mode: 'abort' | 'server' | 'delay' = 'abort';
  let interceptedPosts = 0;
  let forwardedPosts = 0;
  let serverFailures = 0;
  await page.route('**/api/rentals', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    interceptedPosts += 1;
    if (mode === 'abort') return route.abort('failed');
    if (mode === 'server') {
      serverFailures += 1;
      await new Promise(resolve => setTimeout(resolve, 300));
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        json: { ok: false, error: 'Тестовая ошибка сервера' },
      });
    }
    await new Promise(resolve => setTimeout(resolve, 700));
    forwardedPosts += 1;
    return route.continue();
  });

  await page.getByTestId('rental-submit').click();
  await expect(page.getByTestId('rental-submit-notice')).toContainText('аренда могла быть создана');
  await expect(page.getByTestId('rental-form-error')).toHaveCount(0);
  await expect(page.getByTestId('rental-submit')).toBeEnabled();
  await expect(page.getByTestId('rental-deposit')).toHaveValue('3210');

  mode = 'server';
  await page.getByTestId('rental-submit').evaluate(button => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByTestId('rental-form-error')).toContainText('Тестовая ошибка сервера');
  await expect(page.getByTestId('rental-submit')).toBeEnabled();
  await expect(page.getByTestId('rental-notes')).toHaveValue('Форма переживает ошибки');
  expect(serverFailures).toBe(1);

  mode = 'delay';
  const submit = page.getByTestId('rental-submit').click();
  await expect(page.getByTestId('rental-submit')).toHaveText('Создание…');
  await page.getByTestId('rental-daily-rate').press('Enter');
  await page.getByTestId('rental-submit').evaluate(button => (button as HTMLButtonElement).click());
  await submit;
  await expect(page).toHaveURL(/#\/rentals$/);
  expect(interceptedPosts).toBe(3);
  expect(forwardedPosts).toBe(1);
  await withAdminApi(async api => expect((await rentalsForClient(api, fixture.client.id)).length).toBe(1));
});
