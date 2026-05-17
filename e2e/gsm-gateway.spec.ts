import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import net from 'node:net';
import { loginAsAdmin, navigateInApp } from './helpers/auth';
import { createEquipment, withAdminApi } from './helpers/api';

function sendTcpPacket(payload: string, port = 5023) {
  const deadline = Date.now() + 8_000;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const attempt = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
        socket.end(payload);
      });
      socket.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ECONNREFUSED' && Date.now() < deadline) {
          socket.removeAllListeners('close');
          socket.destroy();
          setTimeout(attempt, 250);
          return;
        }
        socket.destroy();
        settled = true;
        reject(error);
      });
      socket.once('close', () => {
        if (settled) return;
        settled = true;
        resolve();
      });
    };

    attempt();
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

test('GSM page keeps light theme readable across packets, warning and map', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const trackerId = '990999260517062';
  await withAdminApi(async (api) => {
    const equipmentRes = await api.get('/api/equipment');
    expect(equipmentRes.ok()).toBeTruthy();
    const equipment = (await equipmentRes.json()) as Array<{ id: string; inventoryNumber?: string; serialNumber?: string }>;
    const existing = equipment.find(item => item.inventoryNumber === '001' && item.serialNumber === '03311273');
    const target = existing || await createEquipment(api, `gsm-light-${Date.now()}`);
    const patch = await api.patch(`/api/equipment/${target.id}`, {
      data: {
        manufacturer: 'Mantall',
        model: 'XE160WCT',
        inventoryNumber: '001',
        serialNumber: '03311273',
        gsmImei: trackerId,
        gsmDeviceId: trackerId,
        gsmProtocol: 'fallback-text',
      },
    });
    expect(patch.ok()).toBeTruthy();
    return target;
  });

  await page.addInitScript(() => window.localStorage.setItem('theme', 'light'));
  await loginAsAdmin(page);
  await sendTcpPacket(`IMEI:${trackerId} LAT:0.223456 LNG:0.754321 SPEED:0`);

  await navigateInApp(page, '/gsm');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await expect(page.getByRole('heading', { name: /Геозоны, уведомления и маршруты техники/ })).toBeVisible();

  const shell = page.locator('main, body').first();
  await expect.poll(async () => shell.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe('rgb(5, 8, 22)');

  const badLightThemeContainers = await page.locator([
    '[class*="bg-black"]',
    '[class*="bg-zinc-950"]',
    '[class*="bg-slate-950"]:not([class*="dark:bg-slate-950"])',
    '[class*="border-white/10"]:not([class*="dark:border-white/10"])',
  ].join(',')).count();
  expect(badLightThemeContainers).toBe(0);

  await page.getByRole('tab', { name: 'Последние пакеты' }).click();
  await expect(page.getByText(trackerId).first()).toBeVisible();
  await expect(page.getByText('Mantall XE160WCT · INV 001 · SN 03311273').first()).toBeVisible();
  await expect(page.getByText('Координаты выглядят тестовыми или некорректными').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Карта и геозоны' }).click();
  await expect(page.getByRole('heading', { name: 'Карта расположения техники' })).toBeVisible();
  await expect(page.getByText('Mantall XE160WCT').first()).toBeVisible();
  await expect(page.getByText('Координаты выглядят тестовыми или некорректными').first()).toBeVisible();
  await expectRenderedGsmMap(page);

  await page.evaluate(() => {
    window.localStorage.setItem('theme', 'dark');
    document.documentElement.classList.add('dark');
  });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByRole('heading', { name: 'Карта расположения техники' })).toBeVisible();
  await expect(page.getByText('Координаты выглядят тестовыми или некорректными').first()).toBeVisible();
  await expectRenderedGsmMap(page);

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
