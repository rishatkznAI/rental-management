import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardAttentionSummary } from '../src/app/lib/dashboardAttention.js';

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
  assert.equal(summary.documents.unsigned, 1);
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
