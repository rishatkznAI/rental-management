import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  buildRentalDowntimePatch,
  findDowntimeRentalFlowTarget,
} from '../src/app/lib/rentalDowntimeFlow.js';

const require = createRequire(import.meta.url);
const { validateEquipmentDowntimePayload } = require('../server/lib/equipment-downtime.js');

const activeRental = {
  id: 'GR-1',
  rentalId: 'R-1',
  equipmentId: 'EQ-1',
  equipmentInv: '083',
  startDate: '2026-05-10',
  endDate: '2026-05-20',
  status: 'active',
};

test('active rental downtime is routed to rental-flow patch', () => {
  const downtime = {
    equipmentId: 'EQ-1',
    equipmentInv: '083',
    startDate: '2026-05-11',
    endDate: '2026-05-12',
    reason: 'Ожидание клиента',
    comment: 'Акт от клиента',
  };

  const target = findDowntimeRentalFlowTarget({ downtime, rentals: [activeRental] });
  assert.equal(target.flow, 'rental');
  assert.equal(target.rental.id, 'GR-1');
  assert.deepEqual(buildRentalDowntimePatch(downtime), {
    downtimeDays: 2,
    downtimeReason: 'Ожидание клиента (период 2026-05-11 → 2026-05-12; Акт от клиента)',
  });
});

test('active rental downtime is not classified as standalone downtime', () => {
  const target = findDowntimeRentalFlowTarget({
    downtime: {
      equipmentId: 'EQ-1',
      equipmentInv: '083',
      startDate: '2026-05-11',
      endDate: '2026-05-11',
      reason: 'Простой',
    },
    rentals: [activeRental],
  });

  assert.notEqual(target.flow, 'standalone');
});

test('free equipment downtime stays on standalone equipment downtime flow', () => {
  const target = findDowntimeRentalFlowTarget({
    downtime: {
      equipmentId: 'EQ-free',
      equipmentInv: 'FREE-1',
      startDate: '2026-05-11',
      endDate: '2026-05-12',
      reason: 'Нет спроса',
    },
    rentals: [activeRental],
  });

  assert.equal(target.flow, 'standalone');
});

test('ambiguous active rental downtime is explicit conflict', () => {
  const target = findDowntimeRentalFlowTarget({
    downtime: {
      equipmentId: 'EQ-1',
      equipmentInv: '083',
      startDate: '2026-05-11',
      endDate: '2026-05-12',
      reason: 'Простой',
    },
    rentals: [
      activeRental,
      { ...activeRental, id: 'GR-2', rentalId: 'R-2' },
    ],
  });

  assert.equal(target.flow, 'conflict');
  assert.match(target.message, /несколько аренд/);
});

test('standalone equipment downtime still rejects active rental overlap', () => {
  const result = validateEquipmentDowntimePayload({
    equipmentId: 'EQ-1',
    equipmentInv: '083',
    startDate: '2026-05-11',
    endDate: '2026-05-12',
    reason: 'Нет спроса',
  }, {
    equipment: [{ id: 'EQ-1', inventoryNumber: '083' }],
    ganttRentals: [activeRental],
    downtimes: [],
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});
