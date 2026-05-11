import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeEquipmentDowntimeRecord,
  validateEquipmentDowntimePayload,
} = require('../server/lib/equipment-downtime.js');

const equipment = [
  { id: 'EQ-1', inventoryNumber: 'INV-1' },
  { id: 'EQ-2', inventoryNumber: 'INV-2' },
];

test('equipment downtime normalization keeps downtime separate from rentals', () => {
  const normalized = normalizeEquipmentDowntimeRecord({
    equipmentId: 'EQ-1',
    equipmentInv: 'INV-1',
    startDate: '2026-05-10T09:00:00.000Z',
    reason: ' Нет спроса ',
    comment: ' Окно простоя ',
  }, null, {
    user: { userName: 'Руслан' },
    nowIso: () => '2026-05-01T10:00:00.000Z',
  });

  assert.equal(normalized.status, 'active');
  assert.equal(normalized.startDate, '2026-05-10');
  assert.equal(normalized.reason, 'Нет спроса');
  assert.equal(normalized.comment, 'Окно простоя');
  assert.equal(normalized.createdBy, 'Руслан');
});

test('equipment downtime validation blocks missing equipment and invalid dates', () => {
  const missingEquipment = validateEquipmentDowntimePayload({ startDate: '2026-05-01' }, { equipment });
  assert.equal(missingEquipment.ok, false);
  assert.equal(missingEquipment.status, 400);
  assert.match(missingEquipment.error, /Выберите технику/);

  const missingStart = validateEquipmentDowntimePayload({ equipmentId: 'EQ-1' }, { equipment });
  assert.equal(missingStart.ok, false);
  assert.match(missingStart.error, /дату начала/);

  const reversedDates = validateEquipmentDowntimePayload({
    equipmentId: 'EQ-1',
    equipmentInv: 'INV-1',
    startDate: '2026-05-10',
    endDate: '2026-05-09',
  }, { equipment });
  assert.equal(reversedDates.ok, false);
  assert.match(reversedDates.error, /не может быть раньше/);
});

test('equipment downtime validation blocks active rental overlaps', () => {
  const result = validateEquipmentDowntimePayload({
    equipmentId: 'EQ-1',
    equipmentInv: 'INV-1',
    startDate: '2026-05-11',
    endDate: '2026-05-12',
    reason: 'Ожидание клиента',
  }, {
    equipment,
    ganttRentals: [{
      id: 'GR-1',
      equipmentId: 'EQ-1',
      equipmentInv: 'INV-1',
      startDate: '2026-05-10',
      endDate: '2026-05-15',
      status: 'active',
    }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.error, /активной арендой GR-1/);
});

test('equipment downtime validation blocks overlaps with another downtime', () => {
  const result = validateEquipmentDowntimePayload({
    id: 'EDT-2',
    equipmentId: 'EQ-1',
    equipmentInv: 'INV-1',
    startDate: '2026-05-12',
    endDate: '2026-05-13',
    reason: 'Ожидание ремонта',
  }, {
    equipment,
    downtimes: [{
      id: 'EDT-1',
      equipmentId: 'EQ-1',
      equipmentInv: 'INV-1',
      startDate: '2026-05-10',
      endDate: '2026-05-14',
      status: 'active',
    }],
    excludeId: 'EDT-2',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.error, /уже есть простой EDT-1/);
});

test('equipment downtime validation allows editing the same downtime and cancellation', () => {
  const editSelf = validateEquipmentDowntimePayload({
    id: 'EDT-1',
    equipmentId: 'EQ-1',
    equipmentInv: 'INV-1',
    startDate: '2026-05-10',
    endDate: '2026-05-14',
    reason: 'Ожидание ремонта',
  }, {
    equipment,
    downtimes: [{
      id: 'EDT-1',
      equipmentId: 'EQ-1',
      equipmentInv: 'INV-1',
      startDate: '2026-05-10',
      endDate: '2026-05-14',
      status: 'active',
    }],
    excludeId: 'EDT-1',
  });
  assert.equal(editSelf.ok, true);

  const cancelled = validateEquipmentDowntimePayload({
    id: 'EDT-2',
    equipmentId: 'EQ-1',
    equipmentInv: 'INV-1',
    startDate: '2026-05-11',
    status: 'cancelled',
  }, {
    equipment,
    ganttRentals: [{
      id: 'GR-1',
      equipmentId: 'EQ-1',
      equipmentInv: 'INV-1',
      startDate: '2026-05-10',
      endDate: '2026-05-15',
      status: 'active',
    }],
  });
  assert.equal(cancelled.ok, true);
});
