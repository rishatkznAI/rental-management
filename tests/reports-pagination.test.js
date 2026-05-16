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
    equipment: [
      { id: 'EQ-1', inventoryNumber: 'INV-1', serialNumber: 'SN-1', manufacturer: 'Skyjack', model: 'SJ3219', type: 'scissor' },
      { id: 'EQ-2', inventoryNumber: 'INV-2', serialNumber: 'SN-2', manufacturer: 'Genie', model: 'Z45', type: 'articulated' },
    ],
    service: [
      { id: 'S-1', equipmentId: 'EQ-1', equipment: 'Skyjack SJ3219', inventoryNumber: 'INV-1', serialNumber: 'SN-1', serviceKind: 'repair', status: 'closed', assignedMechanicId: 'M-1', assignedMechanicName: 'Механик 1', createdAt: '2026-05-02' },
      { id: 'S-2', equipmentId: 'EQ-1', equipment: 'Skyjack SJ3219', inventoryNumber: 'INV-1', serialNumber: 'SN-1', serviceKind: 'repair', status: 'closed', assignedMechanicId: 'M-1', assignedMechanicName: 'Механик 1', createdAt: '2026-05-05' },
      { id: 'S-3', equipmentId: 'EQ-2', equipment: 'Genie Z45', inventoryNumber: 'INV-2', serialNumber: 'SN-2', serviceKind: 'repair', status: 'closed', assignedMechanicId: 'M-2', assignedMechanicName: 'Механик 2', createdAt: '2026-05-07' },
    ],
    documents: [],
    repair_work_items: [
      { id: 'W-1', serviceTicketId: 'S-1', repairId: 'S-1', equipmentId: 'EQ-1', nameSnapshot: 'Диагностика', categorySnapshot: 'Электрика', quantity: 1, normHoursSnapshot: 2, status: 'completed', mechanicId: 'M-1', createdAt: '2026-05-02' },
      { id: 'W-2', serviceTicketId: 'S-2', repairId: 'S-2', equipmentId: 'EQ-1', nameSnapshot: 'Диагностика', categorySnapshot: 'Электрика', quantity: 1, normHoursSnapshot: 3, status: 'completed', mechanicId: 'M-1', createdAt: '2026-05-05' },
      { id: 'W-3', serviceTicketId: 'S-3', repairId: 'S-3', equipmentId: 'EQ-2', nameSnapshot: 'Гидравлика', categorySnapshot: 'Гидравлика', quantity: 1, normHoursSnapshot: 4, status: 'completed', mechanicId: 'M-2', createdAt: '2026-05-07' },
    ],
    repair_part_items: [],
    service_field_trips: [],
    mechanics: [{ id: 'M-1', name: 'Механик 1' }, { id: 'M-2', name: 'Механик 2' }],
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

test('reports managers summary and details are scoped before totals and pagination', async () => {
  const app = createApp({ userId: 'U-manager', userName: 'Иванов', userRole: 'Менеджер по аренде' });
  await withServer(app, async baseUrl => {
    const summary = await getJson(baseUrl, '/api/reports/managers/summary?dateFrom=2026-05-01&dateTo=2026-05-31');
    const detail = await getJson(baseUrl, '/api/reports/managers/details/accruals?page=1&pageSize=2&dateFrom=2026-05-01&dateTo=2026-05-31');
    assert.equal(summary.response.status, 200);
    assert.equal(detail.response.status, 200);
    assert.equal(summary.body.totals.rentalsCount, 6);
    assert.equal(summary.body.totals.accrualsCount, 6);
    assert.equal(detail.body.items.length, 2);
    assert.equal(detail.body.pagination.total, 6);
    assert.equal(detail.body.summary.accrualsCount, 6);
    assert.ok(detail.body.items.every(item => item.manager === 'Иванов'));
  });
});

test('reports managers reject too large ranges and export full filtered set', async () => {
  const app = createApp();
  await withServer(app, async baseUrl => {
    const rejected = await getJson(baseUrl, '/api/reports/managers/summary?dateFrom=2025-01-01&dateTo=2026-12-31');
    const page = await getJson(baseUrl, '/api/reports/managers/details/accruals?page=1&pageSize=2&dateFrom=2026-05-01&dateTo=2026-05-31');
    const exported = await getJson(baseUrl, '/api/reports/managers/export?dateFrom=2026-05-01&dateTo=2026-05-31');
    assert.equal(rejected.response.status, 400);
    assert.equal(page.body.items.length, 2);
    assert.equal(exported.body.rows.length, 12);
  });
});

test('reports role checks cover office manager rental manager investor and deny mechanic finance', async () => {
  const cases = [
    { userId: 'U-office', userName: 'Офис', userRole: 'Офис-менеджер', expected: 200 },
    { userId: 'U-manager', userName: 'Иванов', userRole: 'Менеджер по аренде', expected: 200 },
    { userId: 'U-investor', userName: 'Инвестор', userRole: 'Инвестор', expected: 200 },
    { userId: 'U-mechanic', userName: 'Механик', userRole: 'Механик', expected: 403 },
  ];
  for (const item of cases) {
    const app = createApp(item);
    await withServer(app, async baseUrl => {
      const response = await getJson(baseUrl, '/api/reports/managers/summary?dateFrom=2026-05-01&dateTo=2026-05-31');
      assert.equal(response.response.status, item.expected, item.userRole);
    });
  }
});

test('reports service secondary details are paginated and bounded', async () => {
  const app = createApp();
  await withServer(app, async baseUrl => {
    const repeated = await getJson(baseUrl, '/api/reports/service/details/repeated-failures?page=1&pageSize=1&dateFrom=2026-05-01&dateTo=2026-05-31');
    const equipment = await getJson(baseUrl, '/api/reports/service/details/equipment-summary?page=1&pageSize=1&dateFrom=2026-05-01&dateTo=2026-05-31');
    const models = await getJson(baseUrl, '/api/reports/service/details/problematic-models?page=1&pageSize=1&dateFrom=2026-05-01&dateTo=2026-05-31');
    assert.equal(repeated.response.status, 200);
    assert.equal(equipment.response.status, 200);
    assert.equal(models.response.status, 200);
    assert.equal(repeated.body.items.length, 1);
    assert.equal(repeated.body.pagination.total, 1);
    assert.equal(equipment.body.items.length, 1);
    assert.equal(equipment.body.pagination.total, 2);
    assert.equal(models.body.items.length, 1);
    assert.equal(models.body.pagination.total, 2);
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

test('ManagerReport source uses managers reports endpoints and no full collection services', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/ManagerReport.tsx'), 'utf8');
  assert.match(source, /reportsService\.getManagerSummary/);
  assert.match(source, /reportsService\.getManagerDetails/);
  assert.match(source, /reportsService\.getManagerExport/);
  assert.match(source, /setPage\(1\)/);
  assert.match(source, /<PaginationControls/);
  assert.doesNotMatch(source, /rentalsService\.getGanttData/);
  assert.doesNotMatch(source, /equipmentService\.getAll/);
  assert.doesNotMatch(source, /paymentsService\.getAll/);
  assert.doesNotMatch(source, /paymentsService\.getAllocations/);
});
