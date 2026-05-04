import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createBotOperations } = require('../server/lib/bot-operations.js');
const { createServiceAuditLog } = require('../server/lib/service-audit-log.js');

function createOperations() {
  const state = {
    repair_work_items: [],
    repair_part_items: [],
    equipment: [],
    service_field_trips: [],
    service_audit_log: [],
    service: [],
  };
  const readData = name => state[name] || [];
  const writeData = (name, value) => { state[name] = value; };
  const operations = createBotOperations({
    readData,
    writeData,
    generateId: prefix => `${prefix}-${(state[prefix] || []).length + 1}`,
    idPrefixes: {
      repair_work_items: 'repair_work_items',
      repair_part_items: 'repair_part_items',
      service_field_trips: 'service_field_trips',
    },
    nowIso: () => '2026-04-30T10:00:00.000Z',
    readServiceTickets: () => state.service,
    writeServiceTickets: value => { state.service = value; },
    appendServiceLog: ticket => ticket,
    getMechanicReferenceByUser: () => null,
    syncEquipmentStatusForService: () => {},
    getOpenTicketByEquipment: () => null,
    formatEquipmentForBot: () => '',
    serviceStatusLabel: status => status,
    button: (text, payload) => ({ text, payload }),
    keyboard: buttons => ({ buttons }),
    backAndMainRow: () => [],
    MAINTENANCE_REASON_LABELS: {},
    HANDOFF_CHECKLIST_LABELS: {},
    CHECKLIST_STEP_TO_KEY: {},
    REPAIR_CLOSE_CHECKLIST_LABELS: {},
    REPAIR_CLOSE_CHECKLIST_ORDER: [],
    OPERATION_STEP_META: {},
    SHIPPING_OPERATION_STEPS: [],
    RECEIVING_OPERATION_STEPS: [],
    serviceAuditLog: createServiceAuditLog({
      readData,
      writeData,
      generateId: prefix => `${prefix}-${state.service_audit_log.length + 1}`,
      nowIso: () => '2026-04-30T10:00:00.000Z',
    }),
  });
  return { operations, state };
}

const ticket = { id: 'S-1', equipmentId: 'EQ-1' };
const work = { id: 'SW-1', name: 'Диагностика', normHours: 1, ratePerHour: 2500 };
const part = { id: 'SP-1', name: 'Фильтр', unit: 'шт' };
const admin = { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' };

test('helper rejects invalid repair work quantity', () => {
  const { operations, state } = createOperations();

  assert.throws(() => operations.addRepairWorkItemFromCatalog(ticket, work, 0, admin), /Количество работы/);
  assert.throws(() => operations.addRepairWorkItemFromCatalog(ticket, work, 'abc', admin), /Количество работы/);
  assert.equal(state.repair_work_items.length, 0);
});

test('helper rejects invalid repair part quantity', () => {
  const { operations, state } = createOperations();

  assert.throws(() => operations.addRepairPartItemFromCatalog(ticket, part, -1, 100, admin), /Количество запчастей/);
  assert.throws(() => operations.addRepairPartItemFromCatalog(ticket, part, 'abc', 100, admin), /Количество запчастей/);
  assert.equal(state.repair_part_items.length, 0);
});

test('helper rejects negative and NaN snapshots', () => {
  const { operations, state } = createOperations();

  assert.throws(
    () => operations.addRepairWorkItemFromCatalog(ticket, { ...work, normHours: 'abc' }, 1, admin),
    /Нормо-часы/,
  );
  assert.throws(
    () => operations.addRepairWorkItemFromCatalog(ticket, { ...work, ratePerHour: -1 }, 1, admin),
    /Стоимость нормо-часа/,
  );
  assert.throws(
    () => operations.addRepairPartItemFromCatalog(ticket, part, 1, Number.NaN, admin),
    /Цена запчасти/,
  );
  assert.throws(
    () => operations.addRepairPartItemFromCatalog(ticket, part, 1, -1, admin),
    /Цена запчасти/,
  );
  assert.equal(state.repair_work_items.length, 0);
  assert.equal(state.repair_part_items.length, 0);
});

test('admin MAX helper writes bot-sourced service audit entries', () => {
  const { operations, state } = createOperations();

  const workItem = operations.addRepairWorkItemFromCatalog(ticket, work, 1, admin);
  const partItem = operations.addRepairPartItemFromCatalog(ticket, part, 2, 500, admin);

  assert.equal(state.service_audit_log.length, 2);
  assert.deepEqual(
    state.service_audit_log.map(item => [item.action, item.entityId, item.source, item.actor.role]),
    [
      ['work_added', workItem.id, 'bot', 'Администратор'],
      ['part_added', partItem.id, 'bot', 'Администратор'],
    ],
  );
});

test('MAX helpers require admin context before writing repair items', () => {
  const { operations, state } = createOperations();
  const mechanic = { userId: 'U-mechanic', userName: 'Механик', userRole: 'Механик' };

  assert.throws(() => operations.addRepairWorkItemFromCatalog(ticket, work, 1), /только администратор/);
  assert.throws(() => operations.addRepairPartItemFromCatalog(ticket, part, 1, 100), /только администратор/);
  assert.throws(() => operations.addRepairWorkItemFromCatalog(ticket, work, 1, mechanic), /только администратор/);
  assert.throws(() => operations.addRepairPartItemFromCatalog(ticket, part, 1, 100, mechanic), /только администратор/);
  assert.equal(state.repair_work_items.length, 0);
  assert.equal(state.repair_part_items.length, 0);
  assert.equal(state.service_audit_log.length, 0);
});
