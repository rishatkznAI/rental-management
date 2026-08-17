import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDashboardAttentionSummary } from '../src/app/lib/dashboardAttention.js';

const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Dashboard.tsx'), 'utf8');
const cockpitSource = fs.readFileSync(path.join(process.cwd(), 'src/app/components/dashboard/ExecutiveCockpitV2.tsx'), 'utf8');
const themeSource = fs.readFileSync(path.join(process.cwd(), 'src/styles/theme.css'), 'utf8');
const documentsSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Documents.tsx'), 'utf8');
const documentsRouteSource = fs.readFileSync(path.join(process.cwd(), 'server/routes/documents.js'), 'utf8');
const equipmentServiceSource = fs.readFileSync(path.join(process.cwd(), 'src/app/services/equipment.service.ts'), 'utf8');
const equipmentHooksSource = fs.readFileSync(path.join(process.cwd(), 'src/app/hooks/useEquipment.ts'), 'utf8');
const equipmentPageSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Equipment.tsx'), 'utf8');
const stagingSmokeSource = fs.readFileSync(path.join(process.cwd(), 'e2e/staging-smoke.spec.ts'), 'utf8');
const productionUiSelectorSmokeSource = fs.readFileSync(path.join(process.cwd(), 'e2e/production-ui-selector-smoke.spec.ts'), 'utf8');

test('dashboard attention summary calculates daily risks without NaN values', () => {
  const summary = buildDashboardAttentionSummary({
    today: '2026-05-02',
    rentalDebtRows: [
      {
        rentalId: 'R-1',
        clientId: 'C-1',
        client: 'ООО Долг',
        manager: 'Руслан',
        endDate: '2026-02-20',
        expectedPaymentDate: '2026-02-20',
        outstanding: 120000,
        rentalStatus: 'active',
      },
      {
        rentalId: 'R-2',
        clientId: 'C-2',
        client: 'ООО Завтра',
        manager: 'Ринат',
        endDate: '2026-05-01',
        outstanding: 'bad-number',
        rentalStatus: 'active',
      },
    ],
    clientDebtAgingRows: [
      {
        clientId: 'C-1',
        client: 'ООО Долг',
        manager: 'Руслан',
        ageBucket: '60_plus',
        debt: 120000,
        rentals: 1,
        overdueRentals: 1,
        hasActiveRental: true,
        maxOverdueDays: 71,
      },
    ],
    rentals: [
      { id: 'R-1', client: 'ООО Долг', equipmentInv: 'INV-1', endDate: '2026-05-02', manager: 'Руслан', status: 'active' },
      { id: 'R-3', client: 'ООО Завтра', equipmentInv: 'INV-2', endDate: '2026-05-03', manager: 'Ринат', status: 'active' },
    ],
    documents: [
      { id: 'D-1', type: 'contract', client: 'ООО Долг', rentalId: 'R-1', status: 'sent', manager: 'Руслан', date: '2026-05-01' },
      { id: 'D-2', type: 'act', client: 'ООО Долг', rentalId: 'R-1', status: 'signed', manager: 'Руслан', date: '2026-05-01' },
      { id: 'D-3', type: 'invoice', client: 'ООО Долг', rentalId: 'R-1', status: 'sent', manager: 'Руслан', date: '2026-05-01' },
      { id: 'D-4', documentType: 'rental_specification', client: 'ООО Долг', rentalId: 'R-1', status: 'pending_signature', manager: 'Руслан', date: '2026-05-01' },
      { id: 'D-5', type: 'contract', client: 'ООО Долг', rentalId: 'R-1', status: 'cancelled', manager: 'Руслан', date: '2026-05-01' },
    ],
    tickets: [
      { id: 'S-1', status: 'waiting_parts', priority: 'high', equipment: 'INV-1' },
      { id: 'S-2', status: 'open', priority: 'low', equipment: 'INV-2' },
    ],
    equipment: [
      { id: 'E-1', status: 'available' },
      { id: 'E-2', status: 'in_service' },
    ],
  });

  assert.equal(summary.receivables.overdueDebt, 120000);
  assert.equal(summary.receivables.overdueClients, 1);
  assert.equal(summary.receivables.rentals60Plus, 1);
  assert.equal(summary.returns.today, 1);
  assert.equal(summary.returns.tomorrow, 1);
  assert.equal(summary.documents.unsigned, 2);
  assert.equal(summary.service.unassigned, 2);
  assert.equal(summary.service.waitingParts, 1);
  assert.equal(summary.service.urgent, 1);
  assert.equal(summary.service.equipmentInService, 1);
  assert.equal(summary.idleEquipment.available, 1);
  assert.equal(summary.idleEquipment.idleDaysAvailable, false);
  assert.equal(summary.highRiskClients.count, 1);
  assert.equal(JSON.stringify(summary).includes('NaN'), false);
  assert.equal(JSON.stringify(summary).includes('undefined'), false);
});

test('dashboard attention summary is defensive for missing legacy arrays', () => {
  const summary = buildDashboardAttentionSummary({ today: '2026-05-02' });

  assert.equal(summary.receivables.overdueDebt, 0);
  assert.equal(summary.returns.upcoming.length, 0);
  assert.equal(summary.documents.items.length, 0);
  assert.equal(summary.highRiskClients.top.length, 0);
  assert.equal(JSON.stringify(summary).includes('NaN'), false);
});

test('dashboard normalizes legacy rental equipment before mapping refs', () => {
  assert.match(dashboardSource, /function normalizeRentalEquipmentRefs/);
  assert.match(dashboardSource, /normalizeRentalEquipmentRefs\(r\.equipment\)\s*\.map/);
  assert.doesNotMatch(dashboardSource, /\(r\.equipment \|\| \[\]\)\s*\.map/);
});

test('dashboard renders executive signal strip from compact action queue API', () => {
  assert.match(cockpitSource, /data-testid="dashboard-key-signals"/);
  assert.match(cockpitSource, /data-testid="dashboard-attention-list"/);
  assert.match(cockpitSource, /Требует внимания/);
  assert.match(equipmentServiceSource, /getManagementActionAttention: \(\): Promise<ManagementActionAttentionResponse> =>\s*api\.get<ManagementActionAttentionResponse>\('\/api\/management\/action-queue\?view=attention'\)/);
  assert.match(equipmentHooksSource, /useManagementActionAttention/);
  assert.match(dashboardSource, /useManagementActionAttention\(\{\s*enabled: canViewAttentionBlock && canViewEquipment/);
});

test('staging smoke follows the active Dashboard V2 attention contract', () => {
  assert.match(cockpitSource, /data-testid="dashboard-key-signals"[\s\S]*Требует внимания/);
  assert.match(cockpitSource, /data-testid="dashboard-attention-list"/);
  assert.match(stagingSmokeSource, /getByTestId\('dashboard-key-signals'\)/);
  assert.match(stagingSmokeSource, /dashboardAttentionBlock\.getByRole\('heading', \{ name: 'Требует внимания'/);
  assert.match(stagingSmokeSource, /getByTestId\('dashboard-attention-list'\)/);
  assert.match(productionUiSelectorSmokeSource, /dashboard-key-signals/);
  assert.match(productionUiSelectorSmokeSource, /dashboard-attention-list/);
  assert.doesNotMatch(stagingSmokeSource, /dashboard-legacy-attention-list/);
  assert.doesNotMatch(productionUiSelectorSmokeSource, /dashboard-legacy-attention-list/);
});

test('dashboard executive cockpit renders the active V2 hierarchy', () => {
  for (const label of ['Требует внимания', 'Динамика месяца', 'Здоровье компании', 'Парк', 'Деньги', 'Сервис']) {
    assert.match(cockpitSource, new RegExp(label));
  }
  for (const testId of ['dashboard-executive-cockpit', 'dashboard-top-cockpit', 'dashboard-key-signals', 'dashboard-attention-list', 'dashboard-month-dynamics', 'dashboard-company-health']) {
    assert.match(cockpitSource, new RegExp(`data-testid="${testId}"`));
  }
  assert.equal(cockpitSource.match(/data-testid="dashboard-month-dynamics"/g)?.length, 1);
  assert.equal(cockpitSource.match(/data-testid="dashboard-company-health"/g)?.length, 1);
  assert.match(dashboardSource, /dashboard-kpi-month-payments/);
  assert.match(dashboardSource, /utilizationTone/);
  assert.match(dashboardSource, /hasDebtSourceData/);
  assert.match(dashboardSource, /executiveHealthDirectionVisibility/);
});

test('dashboard does not render the removed global setup banner', () => {
  assert.doesNotMatch(dashboardSource, /Дашборд ещё собирает управленческую картину/);
});

test('dashboard command board uses the V2 responsive grid without legacy layout CSS', () => {
  assert.match(cockpitSource, /data-testid="dashboard-command-board"/);
  assert.match(cockpitSource, /executive-v2-kpis order-2[\s\S]*xl:order-1/);
  assert.match(cockpitSource, /executive-v2-attention order-1[\s\S]*xl:order-2/);
  assert.match(cockpitSource, /executive-v2-month order-3/);
  assert.match(cockpitSource, /executive-v2-health order-7[\s\S]*xl:order-4/);
  assert.doesNotMatch(themeSource, /\.rentcore-dashboard-grid\s*\{/);
  assert.doesNotMatch(themeSource, /\.rentcore-dashboard-(?:signals|tasks|month|fleet|aging|health)\s*\{/);
  assert.match(themeSource, /\.rentcore-command-screen\s*\{[\s\S]*min-height: 0;/);
  assert.match(themeSource, /\.rentcore-command-shell\s*\{[\s\S]*min-height: 0;/);
});

test('dashboard V2 empty states remain honest and compact', () => {
  for (const label of [
    'Критичных отклонений по доступным данным нет',
    'За выбранный период начислений и поступлений нет',
    'Недостаточно данных для полного расчёта',
    'Не удалось загрузить данные блока',
  ]) {
    assert.match(cockpitSource, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(cockpitSource, /Недостаточно данных для графика\./);
});

test('dashboard V2 attention list renders severity, rows, and operational states', () => {
  for (const label of ['Критично', 'Важно', 'Контроль', 'Критичных отклонений по доступным данным нет']) {
    assert.match(cockpitSource, new RegExp(label));
  }
  assert.match(cockpitSource, /signals\.slice\(0, 5\)\.map/);
  assert.match(cockpitSource, /role="alert"/);
  assert.match(cockpitSource, /dashboard-attention-action[\s\S]*min-h-\[46px\]/);
  assert.doesNotMatch(dashboardSource, /\/equipment\?actionQueue=unassigned/);
  assert.doesNotMatch(dashboardSource, /\/equipment\?actionQueue=overdue/);
});

test('dashboard V2 cockpit renders executive KPI, fleet, money, and service analytics', () => {
  for (const label of [
    'dashboard-kpi-overdue-debt',
    'dashboard-kpi-fleet-utilization',
    'dashboard-kpi-month-revenue',
    'dashboard-kpi-month-payments',
  ]) {
    assert.match(dashboardSource, new RegExp(label));
  }
  for (const testId of ['dashboard-fleet-utilization', 'dashboard-receivables-aging', 'dashboard-service-executive']) {
    assert.match(cockpitSource, new RegExp(`data-testid="${testId}"`));
  }
  assert.match(dashboardSource, /id: 'dashboard-kpi-fleet-utilization'[\s\S]*href: '\/equipment\?status=rented'/);
  assert.match(equipmentPageSource, /const nextStatusFilter = requestedStatusFilter !== 'all'[\s\S]*\? requestedStatusFilter[\s\S]*: 'all'/);
  assert.match(equipmentPageSource, /setStatusFilter\(nextStatusFilter\)/);
  assert.match(equipmentPageSource, /setActiveTab\(tabByStatus\[nextStatusFilter\] \|\| 'all'\)/);
  assert.doesNotMatch(equipmentPageSource, /if \(!requestedStatusFilter \|\| requestedStatusFilter === 'all'\) return/);
  assert.match(dashboardSource, /const serviceBlockersCount = serviceBlockerTicketIds\.size/);
  assert.match(dashboardSource, /fleet: canViewEquipment \?/);
  assert.match(dashboardSource, /money: canViewMoney \?/);
  assert.match(dashboardSource, /service: canViewService \?/);
});

test('unsigned document filtering remains available outside the cleaned Dashboard renderer', () => {
  assert.match(documentsSource, /searchParams\.get\('signature'\)/);
  assert.match(documentsSource, /setSignatureFilter\('unsigned'\)/);
  assert.match(documentsRouteSource, /query\.signature/);
  assert.match(documentsRouteSource, /isUnsignedDocumentForList/);
  assert.match(documentsRouteSource, /return res\.json\(filterDocumentsForList\(documents, req\.query\)\)/);
});

test('Dashboard V2 Company Health uses the document control KPI source', () => {
  assert.match(dashboardSource, /const unsignedDocumentsCount = documentControl\.kpi\.unsignedDocuments/);
  assert.match(dashboardSource, /unsignedDocumentsCount,/);
  assert.match(dashboardSource, /overdueDocumentsCount: documentControl\.kpi\.overdueSignature \+ documentControl\.kpi\.closedRentalsWithoutClosingDocs/);
  assert.doesNotMatch(dashboardSource, /const officeUnsignedDocuments = documents\.filter\(isUnsignedDocument\)/);
});
