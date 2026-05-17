import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import net from 'node:net';
import { loginAsAdmin, navigateInApp } from './helpers/auth';
import { createEquipment, withAdminApi } from './helpers/api';

function sendTcpPacket(payload: string, port = 5023) {
  return new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.end(payload);
    });
    socket.once('error', reject);
    socket.once('close', () => resolve());
  });
}

async function expectRenderedGsmMap(page: Page) {
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await expect.poll(async () => page.locator('.leaflet-pane').count()).toBeGreaterThan(0);
  await expect.poll(async () => page.locator('.leaflet-marker-pane').count()).toBeGreaterThan(0);
  await expect.poll(async () => page.evaluate(() => {
    const selectors = [
      '.leaflet-marker-icon',
      '.leaflet-interactive',
      '.leaflet-pane canvas',
      '.leaflet-pane svg',
    ];
    return selectors.some(selector => document.querySelectorAll(selector).length > 0);
  })).toBeTruthy();
}

test('GSM page shows gateway status, latest packets and packet details', async ({ page }) => {
  const apiErrors: string[] = [];
  const consoleErrors: string[] = [];
  const requests: Array<{ method: string; path: string }> = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) requests.push({ method: request.method(), path: `${url.pathname}${url.search}` });
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/') && [401, 403, 500].includes(response.status())) {
      apiErrors.push(`${response.status()} ${url.pathname}${url.search}`);
    }
  });

  const suffix = `gsm-open-${Date.now()}`;
  const equipment = await withAdminApi(async (api) => {
    const equipment = await createEquipment(api, suffix);
    const patch = await api.patch(`/api/equipment/${equipment.id}`, {
      data: {
        gsmImei: '866123456789012',
        gsmDeviceId: '866123456789012',
        gsmProtocol: 'fallback-text',
      },
    });
    expect(patch.ok()).toBeTruthy();
    return equipment;
  });

  await loginAsAdmin(page);
  await sendTcpPacket('IMEI:866123456789012 LAT:55.796 LNG:49.108 SPEED:0');
  requests.length = 0;
  apiErrors.length = 0;
  consoleErrors.length = 0;

  await navigateInApp(page, '/gsm');
  await expect(page.getByRole('heading', { name: /Геозоны, уведомления и маршруты техники/ })).toBeVisible();
  await expect(page.getByText('GPRS-шлюз')).toBeVisible();
  await expect(page.getByText('Последние входящие пакеты')).toBeVisible();

  await page.getByRole('tab', { name: 'Последние пакеты' }).click();
  await expect(page.getByText('866123456789012').first()).toBeVisible();
  await expect(page.getByText('55.79600, 49.10800').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Карта и геозоны' }).click();
  await expect(page.getByRole('heading', { name: 'Карта расположения техники' })).toBeVisible();
  await expect(page.getByText(equipment.inventoryNumber).first()).toBeVisible();
  await expect(page.getByText('Источник точки')).toBeVisible();
  await expectRenderedGsmMap(page);

  await page.getByRole('tab', { name: 'Маршрут', exact: true }).click();
  await expect.poll(() => requests.some(item => (
    item.method === 'GET'
    && item.path.startsWith('/api/gsm/route?')
    && item.path.includes('dateFrom=')
    && item.path.includes('dateTo=')
  ))).toBeTruthy();

  await page.getByRole('tab', { name: 'Последние пакеты' }).click();
  await page.getByRole('button', { name: 'Детали' }).first().click();
  await expect(page.getByRole('heading', { name: 'Детали пакета' })).toBeVisible();
  await expect(page.getByText('rawHex').last()).toBeVisible();

  await expect.poll(() => requests.some(item => item.method === 'GET' && item.path.startsWith('/api/gsm/dashboard'))).toBeTruthy();
  await expect.poll(() => requests.some(item => item.method === 'GET' && item.path.startsWith('/api/gsm/packets?') && item.path.includes('paginated=true'))).toBeTruthy();
  await expect.poll(() => requests.some(item => item.method === 'GET' && item.path.startsWith('/api/gsm/gateway/commands?') && item.path.includes('paginated=true'))).toBeTruthy();

  const fullReferenceLoads = requests.filter(item => (
    item.method === 'GET'
    && ['/api/equipment', '/api/rentals', '/api/gantt_rentals', '/api/clients'].includes(item.path)
  ));
  expect(fullReferenceLoads, `Unexpected full GSM refs: ${fullReferenceLoads.map(item => item.path).join(', ')}`).toEqual([]);
  expect(apiErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('equipment card shows GSM block with editable IMEI data', async ({ page }) => {
  const suffix = `gsm-${Date.now()}`;
  const equipment = await withAdminApi(async (api) => {
    const created = await createEquipment(api, suffix);
    const patch = await api.patch(`/api/equipment/${created.id}`, {
      data: {
        gsmImei: '866123456789012',
        gsmDeviceId: 'TRACKER-E2E',
        gsmProtocol: 'fallback-text',
        gsmSimNumber: '+79990000000',
      },
    });
    expect(patch.ok()).toBeTruthy();
    return created;
  });

  await loginAsAdmin(page);
  await navigateInApp(page, `/equipment/${equipment.id}`);
  await expect(page.getByRole('heading', { name: 'GSM / Трекер' })).toBeVisible();
  await expect(page.getByText('IMEI')).toBeVisible();
  await expect(page.getByText('866123456789012')).toBeVisible();
  await expect(page.getByText('TRACKER-E2E')).toBeVisible();
});
