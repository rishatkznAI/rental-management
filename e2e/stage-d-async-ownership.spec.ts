import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';
import {
  createClient,
  createClientRentalRelations,
  createEquipment,
  withAdminApi,
} from './helpers/api';

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolve = () => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function selectEquipment(page: Page, serialNumber: string) {
  const equipmentSelect = page.getByTestId('rental-equipment-select');
  await equipmentSelect.locator('div').first().click();
  await equipmentSelect.locator('input').fill(serialNumber);
  await equipmentSelect.locator('li[data-eq-item]').first().click();
}

async function fillRental(
  page: Page,
  fixture: {
    client: { id: string };
    relations: { object: { id: string }; contract: { id: string } };
    equipment: { id: string; serialNumber: string };
  },
) {
  await navigateInApp(
    page,
    `/rentals/new?clientId=${encodeURIComponent(fixture.client.id)}&equipmentId=${encodeURIComponent(fixture.equipment.id)}`,
  );
  await expect(page.getByTestId('rental-client-select')).toHaveValue(fixture.client.id);
  await expect(page.getByTestId('rental-object-select')).toHaveValue(fixture.relations.object.id);
  await page.getByTestId('rental-contract-select').selectOption(fixture.relations.contract.id);
  await expect(page.getByTestId('rental-equipment-select')).toHaveAttribute('data-equipment-id', fixture.equipment.id);
  await page.getByTestId('rental-daily-rate').fill('1500');
}

async function createTwoCompleteFixtures(suffix: string) {
  return withAdminApi(async (api) => {
    const clientA = await createClient(api, `${suffix}-a`);
    const clientB = await createClient(api, `${suffix}-b`);
    const relationsA = await createClientRentalRelations(api, clientA.id, `${suffix}-a`);
    const relationsB = await createClientRentalRelations(api, clientB.id, `${suffix}-b`);
    const equipmentA = await createEquipment(api, `${suffix}-a`);
    const equipmentB = await createEquipment(api, `${suffix}-b`);
    return {
      a: { client: clientA, relations: relationsA, equipment: equipmentA },
      b: { client: clientB, relations: relationsB, equipment: equipmentB },
    };
  });
}

test('late inline object and contract responses never select relations for a newer client context', async ({ page }) => {
  const suffix = `stage-d-inline-${Date.now()}`;
  const setup = await withAdminApi(async (api) => {
    const clientA = await createClient(api, `${suffix}-a`);
    const clientB = await createClient(api, `${suffix}-b`);
    const relationsB = await createClientRentalRelations(api, clientB.id, `${suffix}-b`);
    return { clientA, clientB, relationsB };
  });
  await loginAsAdmin(page);
  await navigateInApp(page, `/rentals/new?clientId=${encodeURIComponent(setup.clientA.id)}`);
  await expect(page.getByTestId('rental-client-select')).toHaveValue(setup.clientA.id);

  const objectGate = deferred();
  const objectStarted = deferred();
  const objectServerDone = deferred();
  let delayObject = true;
  let objectPosts = 0;
  await page.route('**/api/client_objects', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    objectPosts += 1;
    if (!delayObject) return route.continue();
    delayObject = false;
    objectStarted.resolve();
    await objectGate.promise;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    objectServerDone.resolve();
    return route.abort('failed');
  });

  const objectName = `Объект ${suffix}`;
  await page.getByRole('button', { name: 'Добавить объект' }).click();
  await page.getByPlaceholder('Название объекта').fill(objectName);
  await page.getByPlaceholder('Адрес объекта').fill('Казань');
  await page.getByRole('button', { name: 'Сохранить объект' }).click();
  await objectStarted.promise;
  await page.getByTestId('rental-client-select').selectOption(setup.clientB.id);
  await expect(page.getByTestId('rental-object-select')).toHaveValue(setup.relationsB.object.id);

  objectGate.resolve();
  await objectServerDone.promise;
  await expect(page.getByTestId('rental-client-select')).toHaveValue(setup.clientB.id);
  await expect(page.getByTestId('rental-object-select')).toHaveValue(setup.relationsB.object.id);
  await expect(page.getByTestId('relation-error')).toHaveCount(0);
  await expect(page.getByTestId('relation-refresh-warning')).toHaveCount(0);

  const createdObject = await withAdminApi(async (api) => {
    const response = await api.get('/api/client_objects');
    expect(response.ok()).toBeTruthy();
    const objects = await response.json() as Array<{ id: string; clientId: string; name: string }>;
    return objects.find(item => item.clientId === setup.clientA.id && item.name === objectName);
  });
  expect(createdObject).toBeTruthy();

  await page.getByTestId('rental-client-select').selectOption(setup.clientA.id);
  await page.getByRole('button', { name: 'Добавить объект' }).click();
  await page.getByPlaceholder('Название объекта').fill(objectName);
  await page.getByPlaceholder('Адрес объекта').fill('Казань');
  const retryObject = page.getByRole('button', { name: 'Сохранить объект' });
  await expect(retryObject).toBeEnabled();
  await retryObject.click();
  await expect(page.getByTestId('rental-object-select')).toHaveValue(createdObject!.id);
  expect(objectPosts).toBe(2);

  const contractGate = deferred();
  const contractStarted = deferred();
  const contractServerDone = deferred();
  let delayContract = true;
  let contractPosts = 0;
  await page.route('**/api/client_contracts', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    contractPosts += 1;
    if (!delayContract) return route.continue();
    delayContract = false;
    contractStarted.resolve();
    await contractGate.promise;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    contractServerDone.resolve();
    return route.abort('failed');
  });

  const contractTitle = `Stage-D contract ${Date.now()}`;
  await page.getByRole('button', { name: 'Добавить договор' }).click();
  await page.getByPlaceholder('Название (необязательно)').fill(contractTitle);
  await page.getByRole('button', { name: 'Сохранить договор' }).click();
  await contractStarted.promise;
  await page.getByTestId('rental-client-select').selectOption(setup.clientB.id);
  await expect(page.getByTestId('rental-contract-select')).toHaveValue('');

  contractGate.resolve();
  await contractServerDone.promise;
  await expect(page.getByTestId('rental-client-select')).toHaveValue(setup.clientB.id);
  await expect(page.getByTestId('rental-object-select')).toHaveValue(setup.relationsB.object.id);
  await expect(page.getByTestId('rental-contract-select')).toHaveValue('');
  await expect(page.getByTestId('relation-error')).toHaveCount(0);

  const createdContract = await withAdminApi(async (api) => {
    const response = await api.get('/api/client_contracts');
    expect(response.ok()).toBeTruthy();
    const contracts = await response.json() as Array<{ id: string; clientId: string; number: string; title?: string }>;
    return contracts.find(item => item.clientId === setup.clientA.id && item.title === contractTitle);
  });
  expect(createdContract).toBeTruthy();

  await page.getByTestId('rental-client-select').selectOption(setup.clientA.id);
  await expect(page.getByTestId('rental-object-select')).toHaveValue(createdObject!.id);
  await page.getByRole('button', { name: 'Добавить договор' }).click();
  await page.getByPlaceholder('Название (необязательно)').fill(contractTitle);
  const retryContract = page.getByRole('button', { name: 'Сохранить договор' });
  await expect(retryContract).toBeEnabled();
  await retryContract.click();
  await expect(page.getByTestId('rental-contract-select')).toHaveValue(createdContract!.id);
  expect(contractPosts).toBe(2);
  await withAdminApi(async (api) => {
    const [objectsResponse, contractsResponse] = await Promise.all([
      api.get('/api/client_objects'),
      api.get('/api/client_contracts'),
    ]);
    const objects = await objectsResponse.json() as Array<{ clientId: string; name: string }>;
    const contracts = await contractsResponse.json() as Array<{ clientId: string; number: string; title?: string }>;
    expect(objects.filter(item => item.clientId === setup.clientA.id && item.name === objectName)).toHaveLength(1);
    expect(contracts.filter(item => item.clientId === setup.clientA.id && item.title === contractTitle)).toHaveLength(1);
  });
  await expect.poll(() => new URL(page.url()).hash).toBe(
    `#/rentals/new?clientId=${encodeURIComponent(setup.clientA.id)}`,
  );
});

test('late financial conflict cannot overwrite a newer route context and retry succeeds', async ({ page }) => {
  const setup = await createTwoCompleteFixtures(`stage-d-financial-${Date.now()}`);
  await loginAsAdmin(page);
  await fillRental(page, setup.a);

  const gate = deferred();
  const started = deferred();
  let firstPost = true;
  await page.route('**/api/rentals', async (route) => {
    if (route.request().method() !== 'POST' || !firstPost) return route.continue();
    firstPost = false;
    started.resolve();
    await gate.promise;
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      json: {
        ok: false,
        code: 'CLIENT_CREDIT_RISK_ACKNOWLEDGEMENT_REQUIRED',
        error: 'Старый финансовый конфликт',
        risk: {
          clientId: setup.a.client.id,
          currentDebt: 99000,
          creditLimit: 1000,
          unpaidRentals: 2,
          overdueRentals: 1,
          exceededLimit: true,
          requiresAcknowledgement: true,
        },
      },
    });
  });

  await page.getByTestId('rental-submit').click();
  await started.promise;
  await expect(page.getByTestId('rental-form-fields')).toHaveAttribute('disabled', '');
  await expect(page.getByTestId('rental-client-select')).toBeDisabled();
  await expect(page.getByTestId('rental-start-date')).toBeDisabled();

  const nextHash = `#/rentals/new?clientId=${encodeURIComponent(setup.b.client.id)}&equipmentId=${encodeURIComponent(setup.b.equipment.id)}`;
  await page.evaluate((hash) => { window.location.hash = hash; }, nextHash);
  await expect(page.getByTestId('rental-client-select')).toHaveValue(setup.b.client.id);
  gate.resolve();
  await expect(page.getByTestId('rental-form-fields')).not.toHaveAttribute('disabled', '');
  await expect(page.getByTestId('rental-form-error')).toHaveCount(0);
  await expect(page.getByTestId('credit-risk-acknowledgement')).toHaveCount(0);
  await expect(page.getByTestId('rental-equipment-select')).toHaveAttribute('data-equipment-id', setup.b.equipment.id);

  await page.goBack();
  await expect(page.getByTestId('rental-client-select')).toHaveValue(setup.a.client.id);
  await expect(page.getByTestId('rental-form-error')).toHaveCount(0);
  await page.goForward();
  await expect(page.getByTestId('rental-client-select')).toHaveValue(setup.b.client.id);
  await expect.poll(() => new URL(page.url()).hash).toBe(nextHash);

  await page.getByTestId('rental-contract-select').selectOption(setup.b.relations.contract.id);
  await page.getByTestId('rental-submit').click();
  await expect(page).toHaveURL(/#\/rentals$/);
  await withAdminApi(async (api) => {
    const response = await api.get('/api/rentals');
    expect(response.ok()).toBeTruthy();
    const rentals = await response.json() as Array<{ clientId?: string }>;
    expect(rentals.filter(item => item.clientId === setup.b.client.id)).toHaveLength(1);
  });
});

test('late availability conflict stays bound to the submitted equipment and recovery uses the new equipment', async ({ page }) => {
  const setup = await createTwoCompleteFixtures(`stage-d-availability-${Date.now()}`);
  await loginAsAdmin(page);
  await fillRental(page, setup.a);

  const gate = deferred();
  const started = deferred();
  let firstPost = true;
  const submittedStartDate = await page.getByTestId('rental-start-date').inputValue();
  const submittedEndDate = await page.getByTestId('rental-end-date').inputValue();
  await page.route('**/api/rentals', async (route) => {
    if (route.request().method() !== 'POST' || !firstPost) return route.continue();
    firstPost = false;
    started.resolve();
    await gate.promise;
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      json: {
        ok: false,
        code: 'EQUIPMENT_AVAILABILITY_CONFLICT',
        error: 'Старый конфликт доступности',
        conflict: {
          rentalId: `old-${Date.now()}`,
          clientId: setup.a.client.id,
          client: setup.a.client.company,
          equipmentId: setup.a.equipment.id,
          equipmentInv: setup.a.equipment.inventoryNumber,
          startDate: submittedStartDate,
          endDate: submittedEndDate,
          status: 'active',
        },
      },
    });
  });

  await page.getByTestId('rental-submit').click();
  await started.promise;
  const nextHash = `#/rentals/new?clientId=${encodeURIComponent(setup.a.client.id)}&equipmentId=${encodeURIComponent(setup.b.equipment.id)}`;
  await page.evaluate((hash) => { window.location.hash = hash; }, nextHash);
  await expect(page.getByTestId('rental-equipment-select')).toHaveAttribute('data-equipment-id', setup.b.equipment.id);
  gate.resolve();

  await expect(page.getByTestId('rental-form-fields')).not.toHaveAttribute('disabled', '');
  await expect(page.getByTestId('equipment-availability-conflict')).toHaveCount(0);
  await expect(page.getByTestId('rental-form-error')).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).hash).toBe(nextHash);
  await page.getByTestId('rental-submit').click();
  await expect(page).toHaveURL(/#\/rentals$/);
  await withAdminApi(async (api) => {
    const response = await api.get('/api/rentals');
    expect(response.ok()).toBeTruthy();
    const rentals = await response.json() as Array<{ clientId?: string; equipmentId?: string }>;
    expect(rentals.some(item => item.clientId === setup.a.client.id && item.equipmentId === setup.b.equipment.id)).toBe(true);
  });
});

test('successful submit cannot navigate after RentalNew has unmounted', async ({ page }) => {
  const setup = await createTwoCompleteFixtures(`stage-d-unmount-${Date.now()}`);
  await loginAsAdmin(page);
  await fillRental(page, setup.a);

  const gate = deferred();
  const started = deferred();
  const completed = deferred();
  await page.route('**/api/rentals', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    started.resolve();
    await gate.promise;
    const response = await route.fetch();
    await route.fulfill({ response });
    completed.resolve();
  });

  await page.getByTestId('rental-submit').click();
  await started.promise;
  await page.evaluate(() => { window.location.hash = '#/'; });
  await expect(page.getByRole('heading', { name: 'Операционный центр' })).toBeVisible();
  gate.resolve();
  await completed.promise;
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { name: 'Операционный центр' })).toBeVisible();
});
