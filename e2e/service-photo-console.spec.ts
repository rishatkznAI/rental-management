import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loginAsAdmin, navigateInApp } from './helpers/auth';
import { createClient, createEquipment, createRentalPair, withAdminApi } from './helpers/api';

const WEBP_1X1 = Buffer.from(
  'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
  'base64',
);

const uploadDirsToCleanup: string[] = [];
const serviceTicketsToCleanup: string[] = [];

function e2eUploadRoot() {
  const databasePath = path.resolve(process.env.DB_PATH || path.join('server', 'data', 'app.sqlite'));
  return path.join(path.dirname(databasePath), 'uploads');
}

test.afterAll(async () => {
  await withAdminApi(async (api) => {
    for (const ticketId of serviceTicketsToCleanup) {
      const response = await api.delete(`/api/service/${ticketId}`);
      expect(response.ok() || response.status() === 404, await response.text()).toBeTruthy();
    }
  });
  for (const dir of uploadDirsToCleanup) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function sanitizeIssue(value: string) {
  return value.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]');
}

test('service photos from protected uploads render without cross-origin console errors', async ({ page }) => {
  const suffix = `photo-${Date.now()}`;
  let uploadPublicPath = '';

  const issues: string[] = [];
  const uploadRequests: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /ERR_BLOCKED_BY_RESPONSE|NotSameOrigin/i.test(message.text())) {
      issues.push(`console: ${sanitizeIssue(message.text())}`);
    }
  });
  page.on('pageerror', (error) => {
    issues.push(`pageerror: ${sanitizeIssue(error.message)}`);
  });
  page.on('request', (request) => {
    if (uploadPublicPath && request.url().includes(uploadPublicPath)) uploadRequests.push(request.url());
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if ((uploadPublicPath && url.includes(uploadPublicPath)) || /ERR_BLOCKED_BY_RESPONSE|NotSameOrigin/i.test(request.failure()?.errorText || '')) {
      issues.push(`requestfailed: ${sanitizeIssue(`${url} ${request.failure()?.errorText || ''}`)}`);
    }
  });
  page.on('response', (response) => {
    if (uploadPublicPath && response.url().includes(uploadPublicPath) && !response.ok()) {
      issues.push(`response: ${response.status()} ${sanitizeIssue(response.url())}`);
    }
  });

  const seed = await withAdminApi(async (api) => {
      const equipment = await createEquipment(api, suffix);
      const client = await createClient(api, `Service Photo ${suffix}`);
      const { rental } = await createRentalPair(api, {
        client: client.company,
        equipment,
        startDate: '2026-05-10',
        endDate: '2026-05-18',
        status: 'active',
        ganttStatus: 'active',
      });
      const reason = `E2E service upload photo ${suffix}`;
      const now = new Date().toISOString();
      const response = await api.post('/api/service', {
        data: {
          equipmentId: equipment.id,
          serviceKind: 'repair',
          equipment: `${equipment.manufacturer} ${equipment.model} (INV: ${equipment.inventoryNumber})`,
          inventoryNumber: equipment.inventoryNumber,
          serialNumber: equipment.serialNumber,
          reason,
          description: 'E2E protected upload photo smoke',
          priority: 'high',
          assignedTo: 'E2E Mechanic',
          assignedMechanicName: 'E2E Mechanic',
          createdBy: 'E2E Admin',
          createdByUserName: 'E2E Admin',
          clientId: client.id,
          client: client.company,
          rentalId: rental.id,
          source: 'bot',
          status: 'new',
          resultData: {
            summary: 'E2E visible repair result with photo',
            worksPerformed: [{ catalogId: `work-${suffix}`, name: 'E2E photo diagnostics', normHours: 1, qty: 1, totalNormHours: 1 }],
            partsUsed: [{ catalogId: `part-${suffix}`, name: 'E2E photo filter', qty: 1, cost: 100 }],
          },
          workLog: [{ date: now, text: 'E2E MAX-style photo event', author: 'E2E Admin', type: 'comment' }],
          createdAt: now,
        },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      const ticket = (await response.json()) as { id: string };
      const uploadRelativePath = `external-photos/service/${ticket.id}/before.webp`;
      uploadPublicPath = `/uploads/${uploadRelativePath}`;
      const uploadDiskPath = path.join(e2eUploadRoot(), uploadRelativePath);
      fs.mkdirSync(path.dirname(uploadDiskPath), { recursive: true });
      fs.writeFileSync(uploadDiskPath, WEBP_1X1);
      uploadDirsToCleanup.push(path.dirname(uploadDiskPath));
      const photo = { localPath: uploadPublicPath, originalUrl: 'https://cdn.example.test/original-before.webp', archiveStatus: 'archived' };
      const patch = await api.patch(`/api/service/${ticket.id}`, {
        data: {
          photos: [photo],
          repairPhotos: {
            before: [photo],
            after: [],
            beforeUploadedAt: now,
            beforeUploadedBy: 'MAX',
          },
        },
      });
      expect(patch.ok(), await patch.text()).toBeTruthy();
      serviceTicketsToCleanup.push(ticket.id);
      return { ticket, reason };
  });

  await loginAsAdmin(page);
  await navigateInApp(page, '/service');
  await page.getByPlaceholder('№ заявки, техника, клиент, проблема...').fill(seed.reason);
  await expect(page.getByText(seed.reason).first()).toBeVisible();

  await page.getByRole('button', { name: new RegExp(`Открыть заявку ${seed.ticket.id}`) }).click();
  const dialog = page.getByRole('dialog', { name: new RegExp(seed.ticket.id) });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('E2E photo diagnostics').first()).toBeVisible();
  await expect(dialog.getByText('E2E photo filter').first()).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'Фото ДО 1' })).toBeVisible();

  await dialog.getByRole('tab', { name: 'Фото' }).click();
  await expect(dialog.getByRole('img', { name: 'Фото 1' })).toBeVisible();
  await expect.poll(() => uploadRequests.length).toBeGreaterThan(0);
  expect(issues).toEqual([]);
});

test('service list shows placeholder for missing archived upload without retries or application errors', async ({ page }) => {
  const suffix = `missing-photo-${Date.now()}`;
  let missingPublicPath = '';
  const issues: string[] = [];
  const missingRequests: string[] = [];
  const missingStatuses: number[] = [];
  const availabilityRequests: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      if (/Failed to load resource: the server responded with a status of 404/i.test(message.text())) return;
      issues.push(`console: ${sanitizeIssue(message.text())}`);
    }
  });
  page.on('pageerror', (error) => {
    issues.push(`pageerror: ${sanitizeIssue(error.message)}`);
  });
  page.on('request', (request) => {
    if (missingPublicPath && request.url().includes(missingPublicPath)) missingRequests.push(request.url());
    if (missingPublicPath && request.url().includes('/api/media/availability') && request.url().includes(encodeURIComponent(missingPublicPath))) {
      availabilityRequests.push(request.url());
    }
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if ((missingPublicPath && url.includes(missingPublicPath)) || /ERR_BLOCKED_BY_RESPONSE|NotSameOrigin/i.test(request.failure()?.errorText || '')) {
      issues.push(`requestfailed: ${sanitizeIssue(`${url} ${request.failure()?.errorText || ''}`)}`);
    }
  });
  page.on('response', (response) => {
    if (missingPublicPath && response.url().includes(missingPublicPath)) missingStatuses.push(response.status());
  });
  const seed = await withAdminApi(async (api) => {
    const equipment = await createEquipment(api, suffix);
    const client = await createClient(api, `Missing Service Photo ${suffix}`);
    const reason = `E2E missing service upload photo ${suffix}`;
    const now = new Date().toISOString();
    const response = await api.post('/api/service', {
      data: {
        equipmentId: equipment.id,
        serviceKind: 'repair',
        equipment: `${equipment.manufacturer} ${equipment.model} (INV: ${equipment.inventoryNumber})`,
        inventoryNumber: equipment.inventoryNumber,
        serialNumber: equipment.serialNumber,
        reason,
        description: 'E2E missing archived upload photo smoke',
        priority: 'high',
        assignedTo: 'E2E Mechanic',
        assignedMechanicName: 'E2E Mechanic',
        clientId: client.id,
        client: client.company,
        source: 'bot',
        status: 'new',
        createdAt: now,
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const ticket = (await response.json()) as { id: string };
    missingPublicPath = `/uploads/external-photos/service/${ticket.id}/before.webp`;
    const photo = { localPath: missingPublicPath, originalUrl: 'https://cdn.example.test/missing-before.webp', archiveStatus: 'archived' };
    const patch = await api.patch(`/api/service/${ticket.id}`, {
      data: {
        photos: [photo],
        repairPhotos: {
          before: [photo],
          after: [],
          beforeUploadedAt: now,
          beforeUploadedBy: 'MAX',
        },
      },
    });
    expect(patch.ok(), await patch.text()).toBeTruthy();
    serviceTicketsToCleanup.push(ticket.id);
    return { ticket, reason };
  });

  await loginAsAdmin(page);
  await navigateInApp(page, '/service');
  await page.getByPlaceholder('№ заявки, техника, клиент, проблема...').fill(seed.reason);
  await expect(page.getByText(seed.reason).first()).toBeVisible();
  const row = page.getByRole('button', { name: new RegExp(`Открыть заявку ${seed.ticket.id}`) });
  await expect(row.getByText('Фото недоступно')).toBeVisible();
  await expect(row.getByText('Файл не найден')).toBeVisible();
  await expect.poll(() => missingRequests.length).toBeGreaterThan(0);
  await expect.poll(() => missingStatuses.length).toBeGreaterThan(0);
  expect(missingStatuses.every(status => status === 404)).toBe(true);
  const listRequestCount = missingRequests.length;
  expect(availabilityRequests).toEqual([]);
  await page.waitForTimeout(500);
  expect(missingRequests).toHaveLength(listRequestCount);
  await row.click();
  const dialog = page.getByRole('dialog', { name: new RegExp(seed.ticket.id) });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Фото недоступно').first()).toBeVisible();
  await expect(dialog.getByText('Файл не найден').first()).toBeVisible();

  await expect.poll(() => missingRequests.length).toBeGreaterThan(listRequestCount);
  const dialogRequestCount = missingRequests.length;
  expect(availabilityRequests).toEqual([]);
  await page.waitForTimeout(500);
  expect(missingRequests).toHaveLength(dialogRequestCount);
  expect(issues).toEqual([]);
});
