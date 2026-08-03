import { expect, test, type APIRequestContext } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';
import { withAdminApi } from './helpers/api';

test.use({ timezoneId: 'America/Los_Angeles' });

type ServiceVehicle = { id: string; plateNumber: string };

async function createDateOnlyFixtures(api: APIRequestContext, suffix: string) {
  const vehicleResponse = await api.post('/api/service-vehicles', {
    data: {
      make: 'QA Date',
      model: 'Calendar Van',
      plateNumber: `DT${suffix.slice(-3)}77`,
      year: 2026,
      vehicleType: 'van',
      currentMileage: 100,
      mileageUpdatedAt: '2026-08-02',
      responsiblePerson: 'QA Date Only',
      status: 'active',
    },
  });
  expect(vehicleResponse.ok(), await vehicleResponse.text()).toBeTruthy();
  const vehicle = (await vehicleResponse.json()) as ServiceVehicle;

  const route = `QA-DATE-ONLY-${suffix}`;
  const tripResponse = await api.post('/api/vehicle-trips', {
    data: {
      vehicleId: vehicle.id,
      sheetNumber: `WAY-${suffix}`,
      date: '2026-08-02',
      driver: 'QA Date Only',
      route,
      purpose: 'Проверка календарной даты',
      startMileage: 100,
      endMileage: 105,
      status: 'completed',
    },
  });
  expect(tripResponse.ok(), await tripResponse.text()).toBeTruthy();

  const operationDescription = `QA finance date ${suffix}`;
  const operationResponse = await api.post('/api/finance/operations', {
    data: {
      type: 'expense',
      date: '2026-08-02',
      amount: 100,
      category: 'QA date-only',
      description: operationDescription,
      status: 'active',
    },
  });
  expect(operationResponse.ok(), await operationResponse.text()).toBeTruthy();

  return { vehicle, route, operationDescription };
}

test('2026-08-02 remains 02.08.2026 in waybills and finance west of UTC', async ({ page }) => {
  const suffix = String(Date.now());
  const fixtures = await withAdminApi(api => createDateOnlyFixtures(api, suffix));

  await loginAsAdmin(page);
  await navigateInApp(page, `/service-vehicles/${fixtures.vehicle.id}`);
  await page.getByRole('button', { name: /Путевые листы/ }).click();

  const tripRow = page.locator('tr').filter({ hasText: fixtures.route });
  await expect(tripRow).toBeVisible();
  await expect(tripRow).toContainText('02.08.2026');
  await expect(tripRow).not.toContainText('01.08.2026');

  await navigateInApp(page, '/finance');
  await page.getByRole('tab', { name: 'Операции', exact: true }).click();
  const operationRow = page.locator('tr').filter({ hasText: fixtures.operationDescription });
  await expect(operationRow).toBeVisible();
  await expect(operationRow).toContainText('02.08.2026');
  await expect(operationRow).not.toContainText('01.08.2026');
});
