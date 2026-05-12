import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  buildRentalDowntimePatch,
  calculateRentalBilling,
  calculateRentalDowntimeSummary,
  findDowntimeRentalFlowTarget,
  normalizeRentalDowntimePeriods,
} from '../src/app/lib/rentalDowntimeFlow.js';

const require = createRequire(import.meta.url);
const { validateEquipmentDowntimePayload } = require('../server/lib/equipment-downtime.js');
const {
  createRentalDowntime,
  updateRentalDowntime,
  validateRentalDowntimePeriod,
} = require('../server/lib/rental-downtime-periods.js');

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
    downtimeStartDate: '2026-05-11',
    downtimeEndDate: '2026-05-12',
    downtimeComment: 'Акт от клиента',
    downtimeStatus: 'active',
  });
});

test('cancelled active rental downtime keeps rental-flow fields explicit', () => {
  const patch = buildRentalDowntimePatch({
    equipmentId: 'EQ-1',
    startDate: '2026-05-11',
    endDate: '2026-05-12',
    reason: 'Ожидание клиента',
    status: 'cancelled',
  });

  assert.equal(patch.downtimeDays, 0);
  assert.equal(patch.downtimeStartDate, '2026-05-11');
  assert.equal(patch.downtimeEndDate, '2026-05-12');
  assert.equal(patch.downtimeStatus, 'cancelled');
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

test('duplicate gantt rows for same rental do not block downtime rental-flow', () => {
  const target = findDowntimeRentalFlowTarget({
    downtime: {
      equipmentId: 'EQ-1',
      equipmentInv: '083',
      startDate: '2026-05-11',
      endDate: '2026-05-12',
      reason: 'Простой',
    },
    rentals: [
      { ...activeRental, id: 'GR-created', status: 'created' },
      { ...activeRental, id: 'GR-active', status: 'active' },
    ],
  });

  assert.equal(target.flow, 'rental');
  assert.equal(target.rental.id, 'GR-active');
  assert.notEqual(target.flow, 'standalone');
  assert.equal(target.matches.length, 2);
});

test('duplicate gantt rows choose active before created for downtime rental-flow', () => {
  const target = findDowntimeRentalFlowTarget({
    downtime: {
      equipmentId: 'EQ-1',
      equipmentInv: '083',
      startDate: '2026-05-11',
      endDate: '2026-05-12',
      reason: 'Простой',
    },
    rentals: [
      { ...activeRental, id: 'GR-created', rentalId: 'R-1', status: 'created' },
      { ...activeRental, id: 'GR-active', rentalId: 'R-1', status: 'active' },
    ],
  });

  assert.equal(target.flow, 'rental');
  assert.equal(target.rental.id, 'GR-active');
});

test('frontend rental billing sums multiple billing downtimes', () => {
  const billing = calculateRentalBilling({
    id: 'GR-metal',
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    amount: 310000,
    downtimePeriods: [
      {
        id: 'DT-1',
        rentalId: 'GR-metal',
        startDate: '2026-05-01',
        endDate: '2026-05-07',
        reason: 'ожидание клиента',
        affectsBilling: true,
        status: 'active',
      },
      {
        id: 'DT-2',
        rentalId: 'GR-metal',
        startDate: '2026-05-13',
        endDate: '2026-05-17',
        reason: 'эвакуатор не мог забрать технику',
        affectsBilling: true,
        status: 'active',
      },
    ],
  });

  assert.equal(billing.totalCalendarDays, 31);
  assert.equal(billing.billingDowntimeDays, 12);
  assert.equal(billing.billableDays, 19);
  assert.equal(billing.finalRentalAmount, 190000);
});

test('duplicate gantt rows dedupe by source and original rental ids', () => {
  const target = findDowntimeRentalFlowTarget({
    downtime: {
      equipmentId: 'EQ-1',
      equipmentInv: '083',
      startDate: '2026-05-11',
      endDate: '2026-05-12',
      reason: 'Простой',
    },
    rentals: [
      { ...activeRental, id: 'GR-created', rentalId: '', sourceRentalId: 'R-source', status: 'created' },
      { ...activeRental, id: 'GR-active', rentalId: '', originalRentalId: 'R-source', status: 'active' },
    ],
  });

  assert.equal(target.flow, 'rental');
  assert.equal(target.rental.id, 'GR-active');
});

test('exact equipment id prevents false downtime conflict from duplicate placeholder inventory', () => {
  const target = findDowntimeRentalFlowTarget({
    downtime: {
      equipmentId: 'EQ-target',
      equipmentInv: '0',
      startDate: '2026-04-10',
      endDate: '2026-04-11',
      reason: 'Ожидание клиента',
    },
    rentals: [
      {
        id: 'GR-target',
        equipmentId: 'EQ-target',
        equipmentInv: '0',
        startDate: '2026-04-01',
        endDate: '2026-04-20',
        status: 'active',
      },
      {
        id: 'GR-other',
        equipmentId: 'EQ-other',
        equipmentInv: '0',
        startDate: '2026-04-01',
        endDate: '2026-04-20',
        status: 'active',
      },
    ],
  });

  assert.equal(target.flow, 'rental');
  assert.equal(target.rental.id, 'GR-target');
  assert.equal(target.matches.length, 1);
});

test('serial number is preferred before inventory fallback for downtime matching', () => {
  const target = findDowntimeRentalFlowTarget({
    downtime: {
      equipmentInv: '0',
      serialNumber: 'SN-target',
      startDate: '2026-04-10',
      endDate: '2026-04-11',
      reason: 'Ожидание клиента',
    },
    rentals: [
      {
        id: 'GR-target',
        equipmentInv: '0',
        serialNumber: 'SN-target',
        startDate: '2026-04-01',
        endDate: '2026-04-20',
        status: 'active',
      },
      {
        id: 'GR-other',
        equipmentInv: '0',
        serialNumber: 'SN-other',
        startDate: '2026-04-01',
        endDate: '2026-04-20',
        status: 'active',
      },
    ],
  });

  assert.equal(target.flow, 'rental');
  assert.equal(target.rental.id, 'GR-target');
  assert.equal(target.matches.length, 1);
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

test('different rental ids in one period stay an explicit downtime conflict', () => {
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
  assert.match(target.message, /несколько разных аренд/);
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

test('rental downtime periods keep multiple events on the same rental', () => {
  const rental = {
    id: 'R-1',
    equipmentId: 'EQ-1',
    equipmentInv: '083',
    clientId: 'C-1',
    startDate: '2026-05-01',
    plannedReturnDate: '2026-05-31',
    status: 'active',
  };
  const first = createRentalDowntime(rental, {
    startDate: '2026-05-01',
    endDate: '2026-05-07',
    reason: 'Ожидание клиента',
    affectsBilling: true,
  }, { id: 'RDT-1', author: 'Admin', now: '2026-05-01T10:00:00.000Z' });
  assert.equal(first.ok, true);
  const second = createRentalDowntime(first.rental, {
    startDate: '2026-05-13',
    endDate: '2026-05-17',
    reason: 'Эвакуатор не мог забрать технику',
    comment: 'Ожидаем перевозчика',
    affectsBilling: false,
  }, { id: 'RDT-2', author: 'Admin', now: '2026-05-13T10:00:00.000Z' });

  assert.equal(second.ok, true);
  assert.equal(second.rental.downtimePeriods.length, 2);
  assert.equal(second.rental.downtimeDays, 12);
  assert.equal(second.rental.downtimeBillableDays, 7);
  assert.equal(second.rental.billableDays, 24);
  assert.equal(second.rental.downtimeReason, 'Эвакуатор не мог забрать технику');
});

test('rental downtime validation rejects overlap with existing rental downtime', () => {
  const rental = {
    id: 'R-1',
    equipmentId: 'EQ-1',
    startDate: '2026-05-01',
    plannedReturnDate: '2026-05-31',
    status: 'active',
    downtimePeriods: [{
      id: 'RDT-1',
      startDate: '2026-05-01',
      endDate: '2026-05-07',
      reason: 'Ожидание клиента',
      status: 'active',
    }],
  };
  const result = validateRentalDowntimePeriod({
    startDate: '2026-05-06',
    endDate: '2026-05-10',
    reason: 'Другое',
  }, {
    rental,
    existingPeriods: rental.downtimePeriods,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.error, /пересекается/);
});

test('updating one rental downtime period does not overwrite another', () => {
  const rental = {
    id: 'R-1',
    equipmentId: 'EQ-1',
    startDate: '2026-05-01',
    plannedReturnDate: '2026-05-31',
    status: 'active',
    downtimePeriods: [
      { id: 'RDT-1', startDate: '2026-05-01', endDate: '2026-05-07', reason: 'Ожидание клиента', status: 'active' },
      { id: 'RDT-2', startDate: '2026-05-13', endDate: '2026-05-17', reason: 'Эвакуатор', status: 'active' },
    ],
  };
  const result = updateRentalDowntime(rental, 'RDT-2', {
    startDate: '2026-05-14',
    endDate: '2026-05-18',
    reason: 'Эвакуатор не мог забрать технику',
  }, { author: 'Admin', now: '2026-05-14T10:00:00.000Z' });

  assert.equal(result.ok, true);
  assert.equal(result.rental.downtimePeriods.length, 2);
  assert.equal(result.rental.downtimePeriods[0].id, 'RDT-1');
  assert.equal(result.rental.downtimePeriods[1].startDate, '2026-05-14');
});

test('frontend downtime summary reads multiple downtime periods for planner and drawer', () => {
  const rental = {
    id: 'GR-1',
    rentalId: 'R-1',
    equipmentId: 'EQ-1',
    equipmentInv: '083',
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    status: 'active',
    downtimePeriods: [
      { id: 'RDT-1', startDate: '2026-05-01', endDate: '2026-05-07', reason: 'Ожидание клиента', affectsBilling: true, status: 'active' },
      { id: 'RDT-2', startDate: '2026-05-13', endDate: '2026-05-17', reason: 'Эвакуатор', affectsBilling: false, status: 'active' },
    ],
  };

  assert.equal(normalizeRentalDowntimePeriods(rental).length, 2);
  assert.deepEqual(calculateRentalDowntimeSummary(rental), {
    periods: normalizeRentalDowntimePeriods(rental),
    totalCalendarDays: 31,
    downtimeDays: 12,
    billableDowntimeDays: 7,
    billableDays: 24,
    activeRentalDays: 19,
  });
});
