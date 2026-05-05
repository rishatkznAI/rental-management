import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

async function importNotificationsModule() {
  const outdir = mkdtempSync(join(tmpdir(), 'skytech-notifications-test-'));
  const outfile = join(outdir, 'notifications.mjs');
  await build({
    entryPoints: ['src/app/lib/notifications.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
  });
  const module = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
  return {
    module,
    cleanup: () => rmSync(outdir, { recursive: true, force: true }),
  };
}

test('buildAppNotifications builds rental debt notification without runtime ReferenceError', async () => {
  const { module, cleanup } = await importNotificationsModule();
  try {
    const notifications = module.buildAppNotifications({
      rentals: [
        {
          id: 'old-rental',
          clientId: 'client-1',
          client: 'Тестовый клиент',
          equipmentId: 'eq-1',
          equipmentInv: 'EQ-1',
          manager: 'Менеджер',
          startDate: '2026-01-01',
          endDate: '2026-01-10',
          expectedPaymentDate: '2026-01-10',
          amount: 100000,
          paymentStatus: 'unpaid',
          status: 'closed',
        },
        {
          id: 'new-rental',
          clientId: 'client-1',
          client: 'Тестовый клиент',
          equipmentId: 'eq-2',
          equipmentInv: 'EQ-2',
          manager: 'Менеджер',
          startDate: '2026-05-05',
          endDate: '2026-05-10',
          expectedPaymentDate: '2026-05-10',
          amount: 50000,
          paymentStatus: 'unpaid',
          status: 'created',
        },
      ],
      payments: [],
      serviceTickets: [],
      equipment: [],
      shippingPhotos: [],
      changeRequests: [],
      currentUser: { id: 'admin-1', role: 'Администратор', name: 'Админ' },
    });

    const debtNotification = notifications.find((item) => item.id === 'new-rental-debt-new-rental');
    assert.ok(debtNotification);
    assert.equal(debtNotification.section, 'payments');
    assert.equal(debtNotification.priority, 'critical');
    assert.match(debtNotification.detail, /просроченных аренд: 1/);
  } finally {
    cleanup();
  }
});
