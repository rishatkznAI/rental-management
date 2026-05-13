import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyRentalLinkStatus } from '../src/app/lib/rentalLinkStatus.js';

const gantt = {
  id: 'GR-1',
  rentalId: 'R-1',
  equipmentId: 'EQ-1',
  equipmentInv: 'INV-1',
  clientId: 'C-1',
};
const rental = { id: 'R-1', clientId: 'C-1', equipmentId: 'EQ-1' };
const equipment = { id: 'EQ-1', inventoryNumber: 'INV-1', serialNumber: 'SN-1' };

test('rental without contract is missing_contract but not broken link', () => {
  const status = classifyRentalLinkStatus({
    ganttRental: gantt,
    classicRental: rental,
    equipment,
    relatedDocuments: [],
  });

  assert.equal(status.status, 'missing_contract');
  assert.equal(status.label, 'Договор не привязан');
  assert.equal(status.isBroken, false);
  assert.equal(status.isContractMissing, true);
});

test('orphan gantt row is broken planner row without rental', () => {
  const status = classifyRentalLinkStatus({
    ganttRental: { ...gantt, rentalId: '', sourceRentalId: '', originalRentalId: '' },
    classicRental: null,
    equipment,
  });

  assert.equal(status.status, 'orphan_gantt');
  assert.equal(status.label, 'Запись планировщика без аренды');
  assert.equal(status.isBroken, true);
});

test('missing equipment is broken even when rental exists', () => {
  const status = classifyRentalLinkStatus({
    ganttRental: gantt,
    classicRental: rental,
    equipment: null,
    relatedDocuments: [{ id: 'D-1', type: 'contract', rentalId: 'R-1' }],
  });

  assert.equal(status.status, 'missing_equipment');
  assert.equal(status.label, 'Техника не найдена');
  assert.equal(status.isBroken, true);
});

test('duplicate gantt rows are classified separately from generic broken links', () => {
  const status = classifyRentalLinkStatus({
    ganttRental: gantt,
    classicRental: rental,
    equipment,
    duplicateGanttCount: 2,
    relatedDocuments: [{ id: 'D-1', type: 'contract', rentalId: 'R-1' }],
  });

  assert.equal(status.status, 'duplicate_gantt');
  assert.equal(status.label, 'Дубль планировщика');
  assert.equal(status.isBroken, false);
});

test('normal rental with contract and equipment is ok', () => {
  const status = classifyRentalLinkStatus({
    ganttRental: gantt,
    classicRental: rental,
    equipment,
    relatedDocuments: [{ id: 'D-1', type: 'contract', rentalId: 'R-1' }],
  });

  assert.equal(status.status, 'ok');
  assert.equal(status.isBroken, false);
  assert.equal(status.isContractMissing, false);
});
