import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEquipment360Summary } from '../src/app/lib/equipment360.js';

test('equipment 360 links rentals service documents and finance by stable equipment keys', () => {
  const equipment = {
    id: 'E-1',
    inventoryNumber: 'INV-1',
    serialNumber: 'SN-1',
    status: 'rented',
    nextMaintenance: '2026-04-20',
    maintenanceCHTO: '2026-04-01',
  };
  const summary = buildEquipment360Summary({
    equipment,
    today: '2026-05-02',
    inventoryIsUnique: true,
    rentals: [
      { id: 'R-1', equipmentId: 'E-1', equipmentInv: 'INV-1', clientId: 'C-1', client: 'ООО Клиент', startDate: '2026-04-01', endDate: '2026-04-25', status: 'active', manager: 'Ринат', amount: 50000 },
      { id: 'R-2', equipmentInv: 'INV-1', client: 'ООО Клиент', startDate: '2026-03-01', endDate: '2026-03-10', status: 'closed', manager: 'Ринат', amount: 30000 },
      { id: 'R-3', equipmentInv: 'OTHER', client: 'Чужой', startDate: '2026-03-01', endDate: '2026-03-10', status: 'closed', amount: 999999 },
    ],
    serviceTickets: [
      { id: 'S-1', equipmentId: 'E-1', status: 'waiting_parts', priority: 'high', reason: 'Гидравлика', createdAt: '2026-04-26' },
      { id: 'S-2', equipmentId: 'E-other', status: 'open', priority: 'critical', reason: 'Чужая', createdAt: '2026-04-26' },
    ],
    documents: [
      { id: 'D-1', equipmentId: 'E-1', type: 'contract', status: 'sent', date: '2026-04-01' },
      { id: 'D-2', equipmentInv: 'OTHER', type: 'act', status: 'signed', date: '2026-04-02' },
    ],
    payments: [
      { id: 'P-1', rentalId: 'R-1', amount: 50000, paidAmount: 10000 },
      { id: 'P-2', rentalId: 'R-3', amount: 999999, paidAmount: 0 },
    ],
    clients: [
      { id: 'C-1', company: 'ООО Клиент', debt: 12000 },
    ],
    utilizationPercent: 80,
  });

  assert.equal(summary.occupancy.currentRental.id, 'R-1');
  assert.equal(summary.occupancy.overdueReturn.id, 'R-1');
  assert.equal(summary.rentals.count, 2);
  assert.equal(summary.service.open.length, 1);
  assert.equal(summary.service.waitingParts, 1);
  assert.equal(summary.documents.count, 1);
  assert.equal(summary.documents.unsigned, 1);
  assert.equal(summary.finance.revenue, 80000);
  assert.equal(summary.finance.outstanding, 40000);
  assert.ok(summary.flags.some(flag => flag.id === 'high-service'));
  assert.ok(summary.flags.some(flag => flag.id === 'active-client-debt'));
  assert.ok(summary.flags.some(flag => flag.id === 'maintenance-overdue'));
  assert.doesNotMatch(JSON.stringify(summary), /NaN|undefined|\[object Object\]/);
});

test('equipment 360 avoids unsafe inventory matching when inventory is not unique', () => {
  const summary = buildEquipment360Summary({
    equipment: { id: 'E-1', inventoryNumber: 'DUP', serialNumber: 'SN-1', status: 'available' },
    today: '2026-05-02',
    inventoryIsUnique: false,
    rentals: [
      { id: 'R-unsafe', equipmentInv: 'DUP', client: 'Нельзя связывать', startDate: '2026-04-01', endDate: '2026-04-20', status: 'closed', amount: 1 },
      { id: 'R-safe', equipmentId: 'E-1', client: 'Можно связывать', startDate: '2026-04-01', endDate: '2026-04-20', status: 'closed', amount: 2 },
    ],
    documents: [
      { id: 'D-unsafe', equipmentInv: 'DUP', status: 'sent', date: '2026-04-01' },
    ],
  });

  assert.equal(summary.rentals.count, 1);
  assert.equal(summary.rentals.latest[0].id, 'R-safe');
  assert.equal(summary.documents.count, 0);
  assert.equal(summary.finance.revenue, 2);
});

test('equipment 360 counts only factual non-cancelled payments in outstanding finance', () => {
  const summary = buildEquipment360Summary({
    equipment: { id: 'E-1', inventoryNumber: 'INV-1', status: 'rented' },
    inventoryIsUnique: true,
    rentals: [
      { id: 'R-paid', equipmentId: 'E-1', equipmentInv: 'INV-1', client: 'Клиент', startDate: '2026-04-01', endDate: '2026-04-10', status: 'closed', amount: 100000 },
      { id: 'R-cancelled-payment', equipmentId: 'E-1', equipmentInv: 'INV-1', client: 'Клиент', startDate: '2026-04-11', endDate: '2026-04-20', status: 'closed', amount: 50000 },
      { id: 'R-cancelled-rental', equipmentId: 'E-1', equipmentInv: 'INV-1', client: 'Клиент', startDate: '2026-04-21', endDate: '2026-04-25', status: 'cancelled', amount: 30000 },
    ],
    payments: [
      { id: 'P-paid', rentalId: 'R-paid', amount: 100000, status: 'paid' },
      { id: 'P-cancelled', rentalId: 'R-cancelled-payment', amount: 50000, paidAmount: 50000, status: 'cancelled' },
    ],
  });

  assert.equal(summary.finance.revenue, 150000);
  assert.equal(summary.finance.outstanding, 0);
});

test('equipment 360 does not treat inventory number as unique by default', () => {
  const summary = buildEquipment360Summary({
    equipment: { id: 'E-1', inventoryNumber: 'INV-legacy', status: 'available' },
    today: '2026-05-02',
    rentals: [
      { id: 'R-unsafe', equipmentInv: 'INV-legacy', client: 'Нельзя связывать', startDate: '2026-04-01', endDate: '2026-04-20', status: 'closed', amount: 1 },
    ],
  });

  assert.equal(summary.rentals.count, 0);
  assert.equal(summary.finance.revenue, 0);
});

test('equipment 360 returns safe empty state for legacy missing data', () => {
  const summary = buildEquipment360Summary({
    equipment: { id: 'E-empty', inventoryNumber: '', status: 'available' },
    today: '2026-05-02',
  });

  assert.equal(summary.rentals.count, 0);
  assert.equal(summary.service.open.length, 0);
  assert.equal(summary.documents.count, 0);
  assert.equal(summary.finance.revenue, 0);
  assert.equal(summary.downtime.label, 'Свободна сейчас');
  assert.doesNotMatch(JSON.stringify(summary), /NaN|undefined|\[object Object\]/);
});
