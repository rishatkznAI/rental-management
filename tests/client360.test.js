import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClient360Summary } from '../src/app/lib/client360.js';

test('client 360 summary links rentals payments documents and service defensively', () => {
  const client = { id: 'C-1', company: 'ООО 360', debt: 1000 };
  const summary = buildClient360Summary({
    client,
    today: '2026-05-02',
    rentals: [
      { id: 'R-1', clientId: 'C-1', client: 'ООО 360', equipmentId: 'E-1', equipmentInv: 'INV-1', startDate: '2026-04-01', endDate: '2026-05-01', status: 'active', manager: 'Ринат', amount: 50000 },
      { id: 'R-2', client: 'ООО 360', equipmentInv: 'INV-2', startDate: '2026-03-01', endDate: '2026-03-15', status: 'closed', manager: 'Ринат', amount: 30000 },
    ],
    rentalDebtRows: [
      { rentalId: 'R-1', clientId: 'C-1', client: 'ООО 360', endDate: '2026-02-20', expectedPaymentDate: '2026-02-20', outstanding: 70000 },
      { rentalId: 'R-bad', clientId: 'C-1', client: 'ООО 360', endDate: 'bad-date', outstanding: 'bad-number' },
    ],
    payments: [
      { id: 'P-1', clientId: 'C-1', rentalId: 'R-1', invoiceNumber: 'INV-PAY-1', amount: 10000, paidAmount: 5000, dueDate: '2026-04-10', status: 'partial' },
    ],
    documents: [
      { id: 'D-1', type: 'contract', clientId: 'C-1', rentalId: 'R-1', status: 'sent', date: '2026-04-01' },
      { id: 'D-2', type: 'act', client: 'ООО 360', rental: 'R-2', status: 'signed', date: '2026-03-15' },
    ],
    serviceTickets: [
      { id: 'S-1', equipmentId: 'E-1', status: 'waiting_parts', priority: 'high', equipment: 'INV-1', createdAt: '2026-04-20' },
      { id: 'S-2', equipmentId: 'E-other', status: 'open', priority: 'low', equipment: 'Другая техника', createdAt: '2026-04-20' },
    ],
  });

  assert.equal(summary.rentals.active.length, 1);
  assert.equal(summary.rentals.completed.length, 1);
  assert.equal(summary.rentals.overdueReturns.length, 1);
  assert.equal(summary.debt.total, 71000);
  assert.equal(summary.debt.overdue, 70000);
  assert.equal(summary.debt.maxAgeDays, 71);
  assert.equal(summary.debt.riskLevel, 'high');
  assert.equal(summary.documents.total, 2);
  assert.equal(summary.documents.unsigned, 1);
  assert.equal(summary.payments.total, 1);
  assert.equal(summary.service.total, 1);
  assert.equal(summary.service.open, 1);
  assert.ok(summary.flags.some(flag => flag.id === 'debt-60'));
  assert.equal(JSON.stringify(summary).includes('NaN'), false);
  assert.equal(JSON.stringify(summary).includes('undefined'), false);
});

test('client 360 summary returns empty safe state for missing legacy data', () => {
  const summary = buildClient360Summary({ client: { id: 'C-empty', company: 'Пустой клиент' }, today: '2026-05-02' });

  assert.equal(summary.debt.total, 0);
  assert.equal(summary.rentals.latest.length, 0);
  assert.equal(summary.documents.latest.length, 0);
  assert.equal(summary.payments.latest.length, 0);
  assert.equal(summary.service.latest.length, 0);
  assert.equal(summary.flags.length, 0);
  assert.equal(JSON.stringify(summary).includes('NaN'), false);
});
