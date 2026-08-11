import { expect, test, type APIRequestContext } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';
import {
  createClient,
  createClientRentalRelations,
  createEquipment,
  withAdminApi,
} from './helpers/api';

async function createFixture(api: APIRequestContext, suffix: string) {
  const client = await createClient(api, suffix);
  const relations = await createClientRentalRelations(api, client.id, suffix);
  const equipment = await createEquipment(api, `${suffix}-eq`);
  return { client, relations, equipment };
}

test('invalid deposit is recoverable and corrected daily pricing reaches canonical storage', async ({ page }) => {
  test.setTimeout(60_000);
  const fixture = await withAdminApi(api => createFixture(api, `stage-f-${Date.now()}`));
  await loginAsAdmin(page);
  await navigateInApp(
    page,
    `/rentals/new?clientId=${encodeURIComponent(fixture.client.id)}&equipmentId=${encodeURIComponent(fixture.equipment.id)}`,
  );

  await expect(page.getByTestId('rental-client-select')).toHaveValue(fixture.client.id);
  await expect(page.getByTestId('rental-object-select')).toBeVisible();
  await page.getByTestId('rental-object-select').selectOption(fixture.relations.object.id);
  await expect(page.getByTestId('rental-contract-select')).toBeVisible();
  await page.getByTestId('rental-contract-select').selectOption(fixture.relations.contract.id);
  await page.getByTestId('rental-start-date').fill('2027-06-10');
  await page.getByTestId('rental-end-date').fill('2027-06-12');
  await page.getByTestId('rental-daily-rate').fill('2468');
  await page.getByTestId('rental-deposit').fill('-1');
  await page.getByTestId('rental-notes').fill('Stage F payload and storage proof');

  const posts: Array<{ key: string; payload: Record<string, unknown>; status: number }> = [];
  await page.route('**/api/rentals', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    posts.push({
      key: route.request().headers()['idempotency-key'] || '',
      payload: route.request().postDataJSON() as Record<string, unknown>,
      status: response.status(),
    });
    return route.fulfill({ response });
  });

  await expect(page.getByTestId('rental-submit')).toBeEnabled();
  await page.getByTestId('rental-submit').click();
  await expect(page.getByTestId('rental-deposit-error')).toContainText('Залог не может быть меньше 0');
  await expect(page.getByTestId('rental-form-error')).toContainText('Залог не может быть меньше 0');
  await expect(page.getByTestId('rental-notes')).toHaveValue('Stage F payload and storage proof');
  await expect(page.getByTestId('rental-daily-rate')).toHaveValue('2468');
  await expect(page.getByTestId('rental-submit')).toBeEnabled();

  await page.getByTestId('rental-deposit').fill('9876');
  await expect(page.getByTestId('rental-deposit-error')).toHaveCount(0);
  await expect(page.getByTestId('rental-form-error')).toHaveCount(0);
  await page.getByTestId('rental-submit').click();
  await expect(page).toHaveURL(/#\/rentals$/);

  expect(posts).toHaveLength(2);
  expect(posts.map(entry => entry.status)).toEqual([400, 201]);
  expect(posts[0].key).toMatch(/^rental-create:/);
  expect(posts[1].key).toMatch(/^rental-create:/);
  expect(posts[1].key).not.toBe(posts[0].key);
  expect(posts[0].payload).toMatchObject({
    startDate: '2027-06-10',
    plannedReturnDate: '2027-06-12',
    pricingMode: 'daily_rate',
    dailyRate: 2468,
    rate: '2468 ₽/день',
    price: 7404,
    discount: 0,
    deposit: -1,
  });
  expect(posts[1].payload).toMatchObject({
    startDate: '2027-06-10',
    plannedReturnDate: '2027-06-12',
    pricingMode: 'daily_rate',
    dailyRate: 2468,
    rate: '2468 ₽/день',
    price: 7404,
    discount: 0,
    deposit: 9876,
  });

  await withAdminApi(async api => {
    const rentalsResponse = await api.get('/api/rentals');
    expect(rentalsResponse.ok(), await rentalsResponse.text()).toBeTruthy();
    const rentals = (await rentalsResponse.json()) as Array<Record<string, unknown>>;
    const stored = rentals.filter(item => item.clientId === fixture.client.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      clientId: fixture.client.id,
      objectId: fixture.relations.object.id,
      contractId: fixture.relations.contract.id,
      equipmentId: fixture.equipment.id,
      startDate: '2027-06-10',
      plannedReturnDate: '2027-06-12',
      pricingMode: 'daily_rate',
      dailyRate: 2468,
      rate: '2468 ₽/день',
      price: 7404,
      discount: 0,
      deposit: 9876,
    });

    const ganttResponse = await api.get('/api/gantt_rentals');
    expect(ganttResponse.ok(), await ganttResponse.text()).toBeTruthy();
    const gantt = (await ganttResponse.json()) as Array<Record<string, unknown>>;
    const linked = gantt.filter(item => item.rentalId === stored[0].id);
    expect(linked).toHaveLength(1);
    expect(linked[0].amount).toBe(7404);
  });
});
