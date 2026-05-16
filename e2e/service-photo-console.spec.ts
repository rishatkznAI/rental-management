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

test.afterAll(() => {
  for (const dir of uploadDirsToCleanup) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function sanitizeIssue(value: string) {
  return value.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]');
}

test('service photos from protected uploads render without cross-origin console errors', async ({ page }) => {
  const suffix = `photo-${Date.now()}`;
  const uploadRelativePath = `external-photos/service/${suffix}/before.webp`;
  const uploadPublicPath = `/uploads/${uploadRelativePath}`;
  const uploadDiskPath = path.join(process.cwd(), 'server', 'data', 'uploads', uploadRelativePath);
  const uploadTicketDir = path.dirname(uploadDiskPath);
  fs.mkdirSync(path.dirname(uploadDiskPath), { recursive: true });
  fs.writeFileSync(uploadDiskPath, WEBP_1X1);
  uploadDirsToCleanup.push(uploadTicketDir);

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
    if (request.url().includes(uploadPublicPath)) uploadRequests.push(request.url());
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (url.includes(uploadPublicPath) || /ERR_BLOCKED_BY_RESPONSE|NotSameOrigin/i.test(request.failure()?.errorText || '')) {
      issues.push(`requestfailed: ${sanitizeIssue(`${url} ${request.failure()?.errorText || ''}`)}`);
    }
  });
  page.on('response', (response) => {
    if (response.url().includes(uploadPublicPath) && !response.ok()) {
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
          photos: [{ localPath: uploadPublicPath, originalUrl: 'https://cdn.example.test/original-before.webp', archiveStatus: 'archived' }],
          repairPhotos: {
            before: [{ localPath: uploadPublicPath, originalUrl: 'https://cdn.example.test/original-before.webp', archiveStatus: 'archived' }],
            after: [],
            beforeUploadedAt: now,
            beforeUploadedBy: 'MAX',
          },
          createdAt: now,
        },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      const ticket = (await response.json()) as { id: string };
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

test('service list shows placeholder for missing archived upload without console 404', async ({ page }) => {
  const suffix = `missing-photo-${Date.now()}`;
  const missingRelativePath = `external-photos/service/${suffix}/before.webp`;
  const missingPublicPath = `/uploads/${missingRelativePath}`;
  const issues: string[] = [];
  const missingRequests: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      issues.push(`console: ${sanitizeIssue(message.text())}`);
    }
  });
  page.on('pageerror', (error) => {
    issues.push(`pageerror: ${sanitizeIssue(error.message)}`);
  });
  page.on('request', (request) => {
    if (request.url().includes(missingPublicPath)) missingRequests.push(request.url());
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (url.includes(missingPublicPath) || /ERR_BLOCKED_BY_RESPONSE|NotSameOrigin/i.test(request.failure()?.errorText || '')) {
      issues.push(`requestfailed: ${sanitizeIssue(`${url} ${request.failure()?.errorText || ''}`)}`);
    }
  });
  page.on('response', (response) => {
    if (response.url().includes(missingPublicPath)) {
      issues.push(`response: ${response.status()} ${sanitizeIssue(response.url())}`);
    }
    if (response.status() === 404) {
      issues.push(`response404: ${sanitizeIssue(response.url())}`);
    }
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
        photos: [{ localPath: missingPublicPath, originalUrl: 'https://cdn.example.test/missing-before.webp' }],
        repairPhotos: {
          before: [{ localPath: missingPublicPath, originalUrl: 'https://cdn.example.test/missing-before.webp' }],
          after: [],
          beforeUploadedAt: now,
          beforeUploadedBy: 'MAX',
        },
        createdAt: now,
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const ticket = (await response.json()) as { id: string };
    return { ticket, reason };
  });

  await loginAsAdmin(page);
  await navigateInApp(page, '/service');
  await page.getByPlaceholder('№ заявки, техника, клиент, проблема...').fill(seed.reason);
  await expect(page.getByText(seed.reason).first()).toBeVisible();
  const row = page.getByRole('button', { name: new RegExp(`Открыть заявку ${seed.ticket.id}`) });
  await expect(row.getByText('Фото недоступно')).toBeVisible();
  await expect(row.getByText('Файл не найден')).toBeVisible();
  await row.click();
  const dialog = page.getByRole('dialog', { name: new RegExp(seed.ticket.id) });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Фото недоступно').first()).toBeVisible();
  await expect(dialog.getByText('Файл не найден').first()).toBeVisible();

  expect(missingRequests).toEqual([]);
  expect(issues).toEqual([]);
});
