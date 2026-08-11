import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';
import {
  createClient,
  createClientRentalRelations,
  createEquipment,
  withAdminApi,
} from './helpers/api';

type RentalFixture = {
  client: { id: string; company: string };
  relations: { object: { id: string }; contract: { id: string } };
  equipment: { id: string; inventoryNumber: string; serialNumber: string };
};

async function createFixture(api: APIRequestContext, suffix: string): Promise<RentalFixture> {
  const client = await createClient(api, suffix);
  const relations = await createClientRentalRelations(api, client.id, suffix);
  const equipment = await createEquipment(api, suffix);
  return { client, relations, equipment };
}

const rentalHash = (fixture: RentalFixture) =>
  `#/rentals/new?clientId=${encodeURIComponent(fixture.client.id)}&equipmentId=${encodeURIComponent(fixture.equipment.id)}`;

async function selectEquipment(page: Page, equipment: RentalFixture['equipment']) {
  const root = page.getByTestId('rental-equipment-select');
  await root.click();
  await root.locator('input').fill(equipment.serialNumber);
  await root.locator('li[data-eq-item]').first().click();
}

async function fillFixture(
  page: Page,
  fixture: RentalFixture,
  values: { startDate: string; endDate: string; rate: string; deposit: string; notes: string },
) {
  await expect(page.getByTestId('rental-client-select')).toHaveValue(fixture.client.id);
  await expect(page.getByTestId('rental-object-select')).toHaveValue(fixture.relations.object.id);
  await page.getByTestId('rental-contract-select').selectOption(fixture.relations.contract.id);
  await page.getByTestId('rental-start-date').fill(values.startDate);
  await page.getByTestId('rental-end-date').fill(values.endDate);
  if (await page.getByTestId('rental-equipment-select').getAttribute('data-equipment-id') !== fixture.equipment.id) {
    await selectEquipment(page, fixture.equipment);
  }
  await page.getByTestId('rental-daily-rate').fill(values.rate);
  await page.getByTestId('rental-deposit').fill(values.deposit);
  await page.getByTestId('rental-notes').fill(values.notes);
  await expect(page.getByTestId('rental-submit')).toBeEnabled();
}

async function rentalsForClient(api: APIRequestContext, clientId: string) {
  const response = await api.get('/api/rentals');
  expect(response.ok(), await response.text()).toBeTruthy();
  const rentals = await response.json() as Array<Record<string, unknown>>;
  return rentals.filter(item => item.clientId === clientId);
}

test('lost response after commit replays the same rental key and preserves the actual payload exactly once', async ({ page }) => {
  test.setTimeout(60_000);
  const fixture = await withAdminApi(api => createFixture(api, `stage-e-unknown-${Date.now()}`));
  await loginAsAdmin(page);
  await navigateInApp(page, rentalHash(fixture).slice(1));
  await expect.poll(() => new URL(page.url()).hash).toBe(rentalHash(fixture));

  const visibleSnapshot = {
    startDate: '2027-03-10',
    endDate: '2027-03-12',
    rate: '2468',
    deposit: '9876',
    notes: 'Stage E unknown outcome payload',
  };
  await fillFixture(page, fixture, visibleSnapshot);

  const requests: Array<{ key: string; payload: Record<string, unknown> }> = [];
  const responseStatuses: number[] = [];
  const replayHeaders: Array<string | undefined> = [];
  await page.route('**/api/rentals', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    requests.push({
      key: route.request().headers()['idempotency-key'] || '',
      payload: route.request().postDataJSON() as Record<string, unknown>,
    });
    const response = await route.fetch();
    responseStatuses.push(response.status());
    replayHeaders.push(response.headers()['idempotency-replayed']);
    if (requests.length === 1) return route.abort('failed');
    return route.fulfill({ response });
  });

  await page.getByTestId('rental-submit').click();
  await expect(page.getByTestId('rental-submit-notice')).toContainText('аренда могла быть создана');
  await expect(page.getByTestId('rental-form-error')).toHaveCount(0);
  await expect(page.getByTestId('rental-submit')).toBeEnabled();
  await expect(page.getByTestId('rental-notes')).toHaveValue(visibleSnapshot.notes);

  await page.getByTestId('rental-submit').click();
  await expect(page).toHaveURL(/#\/rentals$/);

  expect(requests).toHaveLength(2);
  expect(requests[0].key).toMatch(/^rental-create:/);
  expect(requests[1].key).toBe(requests[0].key);
  expect(requests[1].payload).toEqual(requests[0].payload);
  expect(responseStatuses).toEqual([201, 200]);
  expect(replayHeaders[1]).toBe('true');
  expect(requests[0].payload).toEqual({
    client: fixture.client.company,
    clientId: fixture.client.id,
    objectId: fixture.relations.object.id,
    contractId: fixture.relations.contract.id,
    contact: '',
    startDate: visibleSnapshot.startDate,
    plannedReturnDate: visibleSnapshot.endDate,
    equipment: [fixture.equipment.inventoryNumber],
    equipmentId: fixture.equipment.id,
    equipmentInv: fixture.equipment.inventoryNumber,
    pricingMode: 'daily_rate',
    dailyRate: 2468,
    rate: `${visibleSnapshot.rate} ₽/день`,
    price: 7404,
    discount: 0,
    deliveryAddress: '',
    manager: '',
    status: 'created',
    paymentStatus: 'unpaid',
    deposit: 9876,
    creditRiskAcknowledged: false,
    comments: visibleSnapshot.notes,
  });
  await withAdminApi(async api => {
    const rentals = await rentalsForClient(api, fixture.client.id);
    expect(rentals).toHaveLength(1);
    expect(rentals[0].equipmentId).toBe(fixture.equipment.id);
    expect(rentals[0].objectId).toBe(fixture.relations.object.id);
    expect(rentals[0].contractId).toBe(fixture.relations.contract.id);
    expect(rentals[0].pricingMode).toBe('daily_rate');
    expect(rentals[0].dailyRate).toBe(2468);
    expect(rentals[0].rate).toBe('2468 ₽/день');
    expect(rentals[0].price).toBe(7404);
    expect(rentals[0].deposit).toBe(9876);
    expect(rentals[0].comments).toBe(visibleSnapshot.notes);
  });
});

test('confirmed failure plus client/equipment/date correction uses a new key through Back and Forward contexts', async ({ page }) => {
  test.setTimeout(60_000);
  const setup = await withAdminApi(async api => ({
    first: await createFixture(api, `stage-e-context-a-${Date.now()}`),
    second: await createFixture(api, `stage-e-context-b-${Date.now()}`),
  }));
  await loginAsAdmin(page);
  await navigateInApp(page, rentalHash(setup.first).slice(1));
  await fillFixture(page, setup.first, {
    startDate: '2027-04-10',
    endDate: '2027-04-11',
    rate: '1000',
    deposit: '100',
    notes: 'confirmed failure in old context',
  });

  const posts: Array<{ key: string; payload: Record<string, unknown> }> = [];
  await page.route('**/api/rentals', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    posts.push({
      key: route.request().headers()['idempotency-key'] || '',
      payload: route.request().postDataJSON() as Record<string, unknown>,
    });
    if (posts.length === 1) {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        json: { ok: false, error: 'Подтверждённый отказ Stage E' },
      });
    }
    const response = await route.fetch();
    return route.fulfill({ response });
  });

  await page.getByTestId('rental-submit').click();
  await expect(page.getByTestId('rental-form-error')).toContainText('Подтверждённый отказ Stage E');
  await expect(page.getByTestId('rental-submit-notice')).toHaveCount(0);

  const secondHash = rentalHash(setup.second);
  await page.evaluate(hash => { window.location.hash = hash; }, secondHash);
  await expect(page.getByTestId('rental-client-select')).toHaveValue(setup.second.client.id);
  await page.goBack();
  await expect.poll(() => new URL(page.url()).hash).toBe(rentalHash(setup.first));
  await expect(page.getByTestId('rental-client-select')).toHaveValue(setup.first.client.id);
  await page.goForward();
  await expect.poll(() => new URL(page.url()).hash).toBe(secondHash);
  await expect(page.getByTestId('rental-client-select')).toHaveValue(setup.second.client.id);
  await expect(page.getByTestId('rental-form-error')).toHaveCount(0);

  await fillFixture(page, setup.second, {
    startDate: '2027-05-20',
    endDate: '2027-05-22',
    rate: '1500',
    deposit: '250',
    notes: 'corrected client equipment and dates',
  });
  await page.getByTestId('rental-submit').click();
  await expect(page).toHaveURL(/#\/rentals$/);

  expect(posts).toHaveLength(2);
  expect(posts[0].key).toMatch(/^rental-create:/);
  expect(posts[1].key).toMatch(/^rental-create:/);
  expect(posts[1].key).not.toBe(posts[0].key);
  expect(posts[0].payload.clientId).toBe(setup.first.client.id);
  expect(posts[0].payload.equipmentId).toBe(setup.first.equipment.id);
  expect(posts[1].payload.clientId).toBe(setup.second.client.id);
  expect(posts[1].payload.objectId).toBe(setup.second.relations.object.id);
  expect(posts[1].payload.contractId).toBe(setup.second.relations.contract.id);
  expect(posts[1].payload.equipmentId).toBe(setup.second.equipment.id);
  expect(posts[1].payload.startDate).toBe('2027-05-20');
  expect(posts[1].payload.plannedReturnDate).toBe('2027-05-22');
  await withAdminApi(async api => {
    expect(await rentalsForClient(api, setup.first.client.id)).toHaveLength(0);
    expect(await rentalsForClient(api, setup.second.client.id)).toHaveLength(1);
  });
});
