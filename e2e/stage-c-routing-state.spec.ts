import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';
import {
  createClient,
  createClientRentalRelations,
  createEquipment,
  createRentalPair,
  withAdminApi,
} from './helpers/api';

type RoutingSeed = Awaited<ReturnType<typeof createRoutingSeed>>;

function isoDay(offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function createRoutingSeed(options: { busyEquipmentA?: boolean } = {}) {
  const suffix = `stage-c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return withAdminApi(async (api) => {
    const clientA = await createClient(api, `${suffix}-a`);
    const clientB = await createClient(api, `${suffix}-b`);
    const relationsA = await createClientRentalRelations(api, clientA.id, `${suffix}-a`);
    const relationsB = await createClientRentalRelations(api, clientB.id, `${suffix}-b`);
    const equipmentA = await createEquipment(api, `${suffix}-a`);
    const equipmentB = await createEquipment(api, `${suffix}-b`);

    if (options.busyEquipmentA) {
      await createRentalPair(api, {
        client: clientA.company,
        clientId: clientA.id,
        equipment: equipmentA,
        objectId: relationsA.object.id,
        contractId: relationsA.contract.id,
        startDate: isoDay(0),
        endDate: isoDay(7),
        status: 'active',
        ganttStatus: 'active',
      });
    }

    return { clientA, clientB, relationsA, relationsB, equipmentA, equipmentB };
  });
}

function rentalHash(params: { clientId?: string; equipmentId?: string; clientName?: string; equipmentInv?: string } = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  return `#/rentals/new${search.size ? `?${search.toString()}` : ''}`;
}

async function openRawRentalUrl(page: Page, outerSearch: URLSearchParams, hash: string) {
  const appRoot = await page.evaluate(() => `${window.location.origin}${window.location.pathname}`);
  const query = outerSearch.toString();
  await page.goto(`${appRoot}${query ? `?${query}` : ''}${hash}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Новая аренда' })).toBeVisible();
}

async function expectPrimaryState(
  page: Page,
  expected: { clientId?: string; equipmentId?: string },
) {
  await expect(page.getByTestId('rental-client-select')).toHaveValue(expected.clientId ?? '');
  await expect(page.getByTestId('rental-equipment-select')).toHaveAttribute(
    'data-equipment-id',
    expected.equipmentId ?? '',
  );
  await expect.poll(() => new URL(page.url()).hash).toBe(rentalHash(expected));
}

async function selectEquipment(page: Page, serialNumber: string) {
  const equipmentSelect = page.getByTestId('rental-equipment-select');
  await equipmentSelect.locator('div').first().click();
  await equipmentSelect.locator('input').fill(serialNumber);
  await equipmentSelect.locator('li[data-eq-item]').first().click();
}

test('stable route IDs normalize while a legacy client display label stays non-authoritative', async ({ page }) => {
  const seed = await createRoutingSeed();
  await loginAsAdmin(page);

  await openRawRentalUrl(page, new URLSearchParams({
    clientId: seed.clientA.id,
    equipmentId: seed.equipmentA.id,
    keep: 'yes',
  }), rentalHash());
  await expectPrimaryState(page, { clientId: seed.clientA.id, equipmentId: seed.equipmentA.id });
  await expect.poll(() => new URL(page.url()).searchParams.get('clientId')).toBeNull();
  await expect.poll(() => new URL(page.url()).searchParams.get('equipmentId')).toBeNull();
  expect(new URL(page.url()).searchParams.get('keep')).toBe('yes');

  await openRawRentalUrl(page, new URLSearchParams(), rentalHash({
    clientId: seed.clientB.id,
    equipmentId: seed.equipmentB.id,
  }));
  await expectPrimaryState(page, { clientId: seed.clientB.id, equipmentId: seed.equipmentB.id });

  await openRawRentalUrl(page, new URLSearchParams({
    clientId: seed.clientA.id,
    equipmentId: seed.equipmentA.id,
  }), rentalHash({
    clientId: seed.clientB.id,
    equipmentId: seed.equipmentB.id,
  }));
  await expectPrimaryState(page, { clientId: seed.clientB.id, equipmentId: seed.equipmentB.id });
  await expect.poll(() => new URL(page.url()).searchParams.get('clientId')).toBeNull();

  const legacyHashParams = new URLSearchParams({
    clientName: seed.clientA.company,
    equipmentInv: seed.equipmentA.inventoryNumber,
    objectId: seed.relationsA.object.id,
    contractId: seed.relationsA.contract.id,
  });
  await openRawRentalUrl(page, new URLSearchParams(), `#/rentals/new?${legacyHashParams.toString()}`);
  await expect(page.getByTestId('rental-client-select')).toHaveValue('');
  await expect(page.getByText(`Клиент из URL не найден: ${seed.clientA.company}`)).toBeVisible();
  await expect(page.getByTestId('rental-equipment-select')).toHaveAttribute('data-equipment-id', seed.equipmentA.id);
  await expect(page.getByTestId('rental-object-select')).toHaveCount(0);
  await expect(page.getByTestId('rental-contract-select')).toHaveCount(0);
  await expect.poll(() => new URLSearchParams(new URL(page.url()).hash.split('?')[1] || '').get('clientName')).toBe(seed.clientA.company);
});

test('manual client and equipment changes replace URL, reset dependencies and preserve unrelated fields', async ({ page }) => {
  const seed = await createRoutingSeed({ busyEquipmentA: true });
  await loginAsAdmin(page);
  await navigateInApp(page, `/rentals/new?clientId=${encodeURIComponent(seed.clientA.id)}&equipmentId=${encodeURIComponent(seed.equipmentA.id)}`);
  await expectPrimaryState(page, { clientId: seed.clientA.id, equipmentId: seed.equipmentA.id });
  await expect(page.getByTestId('equipment-availability-conflict')).toBeVisible();

  await expect(page.getByTestId('rental-object-select')).toHaveValue(seed.relationsA.object.id);
  await page.getByTestId('rental-contract-select').selectOption(seed.relationsA.contract.id);
  await page.getByTestId('rental-daily-rate').fill('4321');
  await page.getByTestId('rental-notes').fill('Stage C keeps unrelated state');
  const historyLength = await page.evaluate(() => window.history.length);

  await page.getByTestId('rental-client-select').selectOption(seed.clientB.id);
  await expectPrimaryState(page, { clientId: seed.clientB.id, equipmentId: seed.equipmentA.id });
  await expect(page.getByTestId('rental-object-select')).toHaveValue(seed.relationsB.object.id);
  await expect(page.getByTestId('rental-contract-select')).toHaveValue('');
  await expect(page.getByTestId('rental-contract-select').locator(`option[value="${seed.relationsA.contract.id}"]`)).toHaveCount(0);
  await expect(page.getByTestId('rental-daily-rate')).toHaveValue('4321');
  await expect(page.getByTestId('rental-notes')).toHaveValue('Stage C keeps unrelated state');

  await selectEquipment(page, seed.equipmentB.serialNumber);
  await expectPrimaryState(page, { clientId: seed.clientB.id, equipmentId: seed.equipmentB.id });
  await expect(page.getByTestId('equipment-availability-conflict')).toHaveCount(0);
  await expect(page.getByTestId('rental-daily-rate')).toHaveValue('4321');
  await expect(page.getByTestId('rental-notes')).toHaveValue('Stage C keeps unrelated state');
  await expect.poll(() => page.evaluate(() => window.history.length)).toBe(historyLength);
});

test('Back and Forward restore URL, entities, client relations and availability state', async ({ page }) => {
  const seed = await createRoutingSeed({ busyEquipmentA: true });
  await loginAsAdmin(page);
  await navigateInApp(page, `/rentals/new?clientId=${encodeURIComponent(seed.clientA.id)}&equipmentId=${encodeURIComponent(seed.equipmentA.id)}`);
  await expectPrimaryState(page, { clientId: seed.clientA.id, equipmentId: seed.equipmentA.id });
  await expect(page.getByTestId('rental-object-select')).toHaveValue(seed.relationsA.object.id);
  await expect(page.getByTestId('equipment-availability-conflict')).toBeVisible();
  await page.getByTestId('rental-notes').fill('History state survives');

  await page.evaluate((hash) => { window.location.hash = hash; }, rentalHash({
    clientId: seed.clientB.id,
    equipmentId: seed.equipmentB.id,
  }));
  await expectPrimaryState(page, { clientId: seed.clientB.id, equipmentId: seed.equipmentB.id });
  await expect(page.getByTestId('rental-object-select')).toHaveValue(seed.relationsB.object.id);
  await expect(page.getByTestId('rental-contract-select')).toHaveValue('');
  await expect(page.getByTestId('equipment-availability-conflict')).toHaveCount(0);

  await page.goBack();
  await expectPrimaryState(page, { clientId: seed.clientA.id, equipmentId: seed.equipmentA.id });
  await expect(page.getByTestId('rental-object-select')).toHaveValue(seed.relationsA.object.id);
  await expect(page.getByTestId('rental-contract-select')).toHaveValue('');
  await expect(page.getByTestId('equipment-availability-conflict')).toBeVisible();
  await expect(page.getByTestId('rental-notes')).toHaveValue('History state survives');

  await page.goForward();
  await expectPrimaryState(page, { clientId: seed.clientB.id, equipmentId: seed.equipmentB.id });
  await expect(page.getByTestId('rental-object-select')).toHaveValue(seed.relationsB.object.id);
  await expect(page.getByTestId('rental-contract-select')).toHaveValue('');
  await expect(page.getByTestId('equipment-availability-conflict')).toHaveCount(0);
});

test('deep links cover missing params, hard refresh, new tab and invalid IDs', async ({ page, context }) => {
  const seed = await createRoutingSeed();
  await loginAsAdmin(page);

  await navigateInApp(page, '/rentals/new');
  await expectPrimaryState(page, {});

  await navigateInApp(page, `/rentals/new?clientId=${encodeURIComponent(seed.clientA.id)}`);
  await expectPrimaryState(page, { clientId: seed.clientA.id });

  await navigateInApp(page, `/rentals/new?equipmentId=${encodeURIComponent(seed.equipmentA.id)}`);
  await expectPrimaryState(page, { equipmentId: seed.equipmentA.id });

  await navigateInApp(page, `/rentals/new?clientId=${encodeURIComponent(seed.clientB.id)}&equipmentId=${encodeURIComponent(seed.equipmentB.id)}`);
  await expectPrimaryState(page, { clientId: seed.clientB.id, equipmentId: seed.equipmentB.id });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectPrimaryState(page, { clientId: seed.clientB.id, equipmentId: seed.equipmentB.id });

  const newTab = await context.newPage();
  await newTab.goto(page.url(), { waitUntil: 'domcontentloaded' });
  await expect(newTab.getByRole('heading', { name: 'Новая аренда' })).toBeVisible();
  await expectPrimaryState(newTab, { clientId: seed.clientB.id, equipmentId: seed.equipmentB.id });
  await newTab.close();

  await navigateInApp(page, '/rentals/new?clientId=missing-client&equipmentId=missing-equipment');
  await expect.poll(() => new URL(page.url()).hash).toBe(rentalHash({
    clientId: 'missing-client',
    equipmentId: 'missing-equipment',
  }));
  await expect(page.getByTestId('rental-client-select')).toHaveValue('');
  await expect(page.getByTestId('rental-equipment-select')).toHaveAttribute('data-equipment-id', '');
  await expect(page.getByTestId('rental-client-route-error')).toContainText('missing-client');
  await expect(page.getByTestId('rental-equipment-route-error')).toContainText('missing-equipment');
});

test('client and equipment detail entry points use the same canonical route', async ({ page }) => {
  const seed = await createRoutingSeed();
  await loginAsAdmin(page);

  await navigateInApp(page, `/clients/${encodeURIComponent(seed.clientA.id)}`);
  await page.getByRole('link', { name: 'Новая аренда' }).click();
  await expectPrimaryState(page, { clientId: seed.clientA.id });

  await navigateInApp(page, `/equipment/${encodeURIComponent(seed.equipmentB.id)}`);
  await page.getByRole('link', { name: 'Создать аренду' }).first().click();
  await expectPrimaryState(page, { equipmentId: seed.equipmentB.id });
});
