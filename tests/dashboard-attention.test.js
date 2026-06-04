import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDashboardAttentionSummary } from '../src/app/lib/dashboardAttention.js';

const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Dashboard.tsx'), 'utf8');
const documentsSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Documents.tsx'), 'utf8');
const documentsRouteSource = fs.readFileSync(path.join(process.cwd(), 'server/routes/documents.js'), 'utf8');
const equipmentServiceSource = fs.readFileSync(path.join(process.cwd(), 'src/app/services/equipment.service.ts'), 'utf8');
const equipmentHooksSource = fs.readFileSync(path.join(process.cwd(), 'src/app/hooks/useEquipment.ts'), 'utf8');

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
  assert.match(dashboardSource, /Главные сигналы сегодня/);
  assert.match(dashboardSource, /data-testid="dashboard-risk-signal-strip"/);
  assert.match(equipmentServiceSource, /getManagementActionAttention: \(\): Promise<ManagementActionAttentionResponse> =>\s*api\.get<ManagementActionAttentionResponse>\('\/api\/management\/action-queue\?view=attention'\)/);
  assert.match(equipmentHooksSource, /useManagementActionAttention/);
  assert.match(dashboardSource, /useManagementActionAttention\(\{\s*enabled: canViewAttentionBlock && canViewEquipment/);
});

test('dashboard executive cockpit renders adaptive KPI cards and compact risk signals', () => {
  for (const label of ['Операционная нагрузка', 'Индекс нагрузки компании', 'Открыть обзор', 'Утилизация парка', 'Загрузка сервиса', 'Здоровье компании']) {
    assert.match(dashboardSource, new RegExp(label));
  }
  for (const helper of ['OperationalLoadGauge', 'UtilizationGauge', 'StatusBars', 'CompanyHealthBars', 'RiskSignalStrip']) {
    assert.match(dashboardSource, new RegExp(helper));
  }
  assert.match(dashboardSource, /data-testid="dashboard-executive-cockpit"/);
  assert.match(dashboardSource, /data-testid="dashboard-top-cockpit"/);
  assert.match(dashboardSource, /data-testid="dashboard-key-signals"/);
  assert.match(dashboardSource, /data-testid="dashboard-legacy-attention-list"/);
  assert.match(dashboardSource, /data-testid="dashboard-month-dynamics"/);
  assert.match(dashboardSource, /operationalLoadScore/);
  assert.match(dashboardSource, /operationalLoadTone/);
  assert.match(dashboardSource, /receivablesTone/);
  assert.match(dashboardSource, /utilizationTone/);
  assert.match(dashboardSource, /serviceTone/);
  assert.match(dashboardSource, /Прочие/);
});

test('dashboard signal strip renders counters, rows, empty and error states', () => {
  for (const label of ['критично', 'высоко', 'средне', 'Просрочено', 'Сегодня', 'Без ответственного', 'Потери сейчас', 'Потеря в день']) {
    assert.match(dashboardSource, new RegExp(label));
  }
  assert.match(dashboardSource, /topAttentionActions\.map/);
  assert.match(dashboardSource, /Критичных действий на сегодня нет\./);
  assert.match(dashboardSource, /Не удалось загрузить блок внимания/);
  assert.match(dashboardSource, /Открыть очередь/);
  assert.match(dashboardSource, /Показать без ответственного/);
  assert.match(dashboardSource, /Показать просроченные/);
  assert.match(dashboardSource, /\/equipment\?actionQueueFilter=unassigned/);
  assert.match(dashboardSource, /\/equipment\?actionQueueFilter=overdue/);
  assert.doesNotMatch(dashboardSource, /\/equipment\?actionQueue=unassigned/);
  assert.doesNotMatch(dashboardSource, /\/equipment\?actionQueue=overdue/);
  assert.doesNotMatch(dashboardSource, /title: 'Документы \/ задачи'/);
  assert.doesNotMatch(dashboardSource, />undefined</);
  assert.doesNotMatch(dashboardSource, />null</);
  assert.doesNotMatch(dashboardSource, />\\[object Object\\]</);
});

test('dashboard cockpit renders executive KPI grid with fleet and service analytics', () => {
  for (const label of [
    'data-testid="dashboard-executive-summary"',
    'dashboard-kpi-overdue-debt',
    'dashboard-kpi-fleet-utilization',
    'dashboard-kpi-service-load',
    'dashboard-kpi-operational-load',
    'MiniAreaChart',
    'UtilizationGauge',
    'StatusBars',
    'Утилизация парка',
    'Средняя загрузка за период',
    'Открыть планировщик',
    'Загрузка сервиса',
    'Ожидают запчасти',
    'Готовы к закрытию',
    'Открыть сервис',
    'Операционная нагрузка',
    'Индекс нагрузки компании',
    'Открыть обзор',
    'Проверить долги',
  ]) {
    assert.match(dashboardSource, new RegExp(label));
  }
  assert.match(dashboardSource, /Donut gauge утилизации парка/);
  assert.match(dashboardSource, /to="\/planner"/);
  assert.match(dashboardSource, /to="\/service"/);
  assert.match(dashboardSource, /const serviceLoadGroups = openServiceTickets\.reduce/);
  assert.match(dashboardSource, /без механика/);
  assert.match(dashboardSource, /запчасти/);
  assert.match(dashboardSource, /просрочено/);
  assert.match(dashboardSource, /operationalLoadScore/);
  assert.match(dashboardSource, /criticalOperationalIssues/);
  assert.match(dashboardSource, /label: 'Прочие'/);
  assert.match(dashboardSource, /const serviceLoadTotal = openServiceTickets\.length/);
  assert.doesNotMatch(dashboardSource, /Документы \/ задачи/);
  assert.doesNotMatch(dashboardSource, /serviceLoadUsesLiveData/);
  assert.doesNotMatch(dashboardSource, /roleDashboardUtilizationPercent = activeEquipment > 0 \? utilization : 62/);
  assert.doesNotMatch(dashboardSource, /serviceLoadTotal = serviceLoadUsesLiveData \? openServiceTickets\.length : 63/);
  assert.doesNotMatch(dashboardSource, /Что сделать сейчас/);
  assert.doesNotMatch(dashboardSource, /roleDashboardSignalCard/);
});

test('dashboard document links open the unsigned documents list', () => {
  assert.match(dashboardSource, /\/documents\?signature=unsigned/);
  assert.match(documentsSource, /searchParams\.get\('signature'\)/);
  assert.match(documentsSource, /setSignatureFilter\('unsigned'\)/);
  assert.match(documentsRouteSource, /query\.signature/);
  assert.match(documentsRouteSource, /isUnsignedDocumentForList/);
  assert.match(documentsRouteSource, /return res\.json\(filterDocumentsForList\(documents, req\.query\)\)/);
});

test('dashboard unsigned document counters use the document control KPI source', () => {
  assert.match(dashboardSource, /const unsignedDocumentsCount = documentControl\.kpi\.unsignedDocuments/);
  assert.match(dashboardSource, /value: String\(unsignedDocumentsCount\)/);
  assert.match(dashboardSource, /tone: unsignedDocumentsCount > 0 \? 'warning' : 'success'/);
  assert.doesNotMatch(dashboardSource, /const officeUnsignedDocuments = documents\.filter\(isUnsignedDocument\)/);
});
