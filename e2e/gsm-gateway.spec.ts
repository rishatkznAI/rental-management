import { expect, test } from '@playwright/test';
import net from 'node:net';
import { loginAsAdmin } from './helpers/auth';
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

test('GSM page shows gateway status, latest packets and packet details', async ({ page }) => {
  await loginAsAdmin(page);
  await sendTcpPacket('IMEI:866123456789012 LAT:55.796 LNG:49.108 SPEED:0');

  await page.goto('./#/gsm');
  await expect(page.getByRole('heading', { name: /Геозоны, уведомления и маршруты техники/ })).toBeVisible();
  await expect(page.getByText('GPRS-шлюз')).toBeVisible();
  await expect(page.getByText('Последние входящие пакеты')).toBeVisible();

  await page.getByRole('tab', { name: 'Последние пакеты' }).click();
  await expect(page.getByText('866123456789012').first()).toBeVisible();
  await page.getByRole('button', { name: 'Детали' }).first().click();
  await expect(page.getByRole('heading', { name: 'Детали пакета' })).toBeVisible();
  await expect(page.getByText('rawHex')).toBeVisible();
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
  await page.goto(`./#/equipment/${equipment.id}`);
  await expect(page.getByText('GSM IMEI')).toBeVisible();
  await expect(page.getByText('866123456789012')).toBeVisible();
  await expect(page.getByText('TRACKER-E2E')).toBeVisible();
});
