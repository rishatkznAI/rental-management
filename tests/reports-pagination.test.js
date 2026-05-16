import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const { registerReportRoutes } = require('../server/routes/reports.js');

function createState() {
  return {
    clients: [
      { id: 'C-1', company: 'Alpha', manager: 'Иванов', managerId: 'U-manager' },
      { id: 'C-2', company: 'Beta', manager: 'Петров', managerId: 'U-other' },
    ],
    gantt_rentals: Array.from({ length: 12 }, (_, index) => ({
      id: `R-${index + 1}`,
      clientId: index % 2 === 0 ? 'C-1' : 'C-2',
      client: index % 2 === 0 ? 'Alpha' : 'Beta',
      manager: index % 2 === 0 ? 'Иванов' : 'Петров',
      managerId: index % 2 === 0 ? 'U-manager' : 'U-other',
      equipmentInv: `INV-${index + 1}`,
      startDate: '2026-05-01',
      endDate: '2026-05-10',
      expectedPaymentDate: '2026-05-11',
      amount: 1000 + index,
      status: 'active',
    })),
    payments: [],
    payment_allocations: [],
    equipment: [],
    service: [],
    documents: [],
    repair_work_items: [],
    repair_part_items: [],
    service_field_trips: [],
    mechanics: [],
    service_works: [],
  };
}

function createApp(user = { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' }, state = createState()) {
  const app = express();
  const readData = collection => state[collection] || [];
  const accessControl = createAccessControl({ readData });
  const router = express.Router();
  router.use((req, _res, next) => {
    req.user = user;
    next();
  });
  router.use(registerReportRoutes({
    readData,
    requireAuth: (_req, _res, next) => next(),
    requireRead: () => (_req, _res, next) => next(),
    accessControl,
  }));
  app.use('/api', router);
  return app;
}

async function withServer(app, fn) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const body = await response.json();
  return { response, body };
}

test('reports finance detail paginates after search sort and scoped totals', async () => {
  const app = createApp({ userId: 'U-manager', userName: 'Иванов', userRole: 'Менеджер по аренде' });
  await withServer(app, async baseUrl => {
    const { response, body } = await getJson(
      baseUrl,
      '/api/reports/finance/details/unpaid-rentals?paginated=true&page=1&pageSize=2&search=Alpha&sortBy=debt&sortDir=desc&dateFrom=2026-05-01&dateTo=2026-05-31',
    );
    assert.equal(response.status, 200);
    assert.equal(body.items.length, 2);
    assert.equal(body.pagination.page, 1);
    assert.equal(body.pagination.pageSize, 2);
    assert.equal(body.pagination.total, 6);
    assert.equal(body.pagination.hasNextPage, true);
    assert.ok(body.items.every(item => item.clientId === 'C-1'));
    assert.equal(body.summary.unpaidRentals, 6);
  });
});

test('reports reject too large date ranges', async () => {
  const app = createApp();
  await withServer(app, async baseUrl => {
    const { response, body } = await getJson(
      baseUrl,
      '/api/reports/finance/summary?dateFrom=2025-01-01&dateTo=2026-12-31',
    );
    assert.equal(response.status, 400);
    assert.match(body.error, /Период отчёта/);
  });
});

test('reports export returns full filtered set instead of current page', async () => {
  const app = createApp();
  await withServer(app, async baseUrl => {
    const page = await getJson(
      baseUrl,
      '/api/reports/finance/details/unpaid-rentals?paginated=true&page=1&pageSize=2&dateFrom=2026-05-01&dateTo=2026-05-31',
    );
    const exported = await getJson(
      baseUrl,
      '/api/reports/finance/export?dateFrom=2026-05-01&dateTo=2026-05-31',
    );
    assert.equal(page.body.items.length, 2);
    assert.equal(exported.body.items.length, 12);
  });
});

test('Reports page source uses report endpoints for details and avoids full collection services', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Reports.tsx'), 'utf8');
  assert.match(source, /reportsService\.getFinanceDetails/);
  assert.match(source, /reportsService\.getServiceDetails/);
  assert.match(source, /reportsService\.getSalesStockDetails/);
  assert.match(source, /setFinanceClientPage\(1\)/);
  assert.match(source, /setServiceWorkPage\(1\)/);
  assert.doesNotMatch(source, /queryFn:\s*equipmentService\.getAll/);
  assert.doesNotMatch(source, /queryFn:\s*rentalsService\.getGanttData/);
  assert.doesNotMatch(source, /queryFn:\s*paymentsService\.getAll/);
  assert.doesNotMatch(source, /queryFn:\s*clientsService\.getAll/);
  assert.doesNotMatch(source, /queryFn:\s*serviceTicketsService\.getAll/);
  assert.doesNotMatch(source, /queryFn:\s*documentsService\.getAll/);
});
