import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createBotOperations } = require('../server/lib/bot-operations.js');
const { createServiceAuditLog } = require('../server/lib/service-audit-log.js');
const { createServiceCore } = require('../server/lib/service-core.js');
const { equipmentMatchesServiceTicket } = require('../server/lib/equipment-matching.js');

function createOperations(options = {}) {
  const state = {
    repair_work_items: [],
    repair_part_items: [],
    equipment: [],
    rentals: [],
    gantt_rentals: [],
    shipping_photos: [],
    equipment_operation_sessions: [],
    service_field_trips: [],
    service_audit_log: [],
    service: [],
  };
  const readData = name => state[name] || [];
  const writeData = (name, value) => { state[name] = value; };
  const writeDataBatch = entries => {
    if (options.failBatch) throw new Error('Injected MAX lifecycle batch failure');
    for (const entry of entries || []) state[entry.name] = entry.value;
  };
  const nowIso = () => '2026-04-30T10:00:00.000Z';
  const serviceCore = createServiceCore({
    readData,
    writeData,
    writeDataBatch,
    nowIso,
    equipmentMatchesServiceTicket,
  });
  const operations = createBotOperations({
    readData,
    writeData,
    writeDataBatch,
    generateId: prefix => `${prefix}-${(state[prefix] || []).length + 1}`,
    idPrefixes: {
      repair_work_items: 'repair_work_items',
      repair_part_items: 'repair_part_items',
      service_field_trips: 'service_field_trips',
      service: 'service',
      shipping_photos: 'shipping_photos',
    },
    nowIso,
    readServiceTickets: () => state.service,
    writeServiceTickets: value => { state.service = value; },
    appendServiceLog: ticket => ticket,
    getMechanicReferenceByUser: user => user?.userRole === 'Механик'
      ? { id: user.userId, name: user.userName, userId: user.userId }
      : null,
    syncEquipmentStatusForService: serviceCore.syncEquipmentStatusForService,
    applyServiceTicketCreationEffects: serviceCore.applyServiceTicketCreationEffects,
    getOpenTicketByEquipment: serviceCore.getOpenTicketByEquipment,
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

test('MAX service ticket created by mechanic is assigned to that bot user', () => {
  const { operations, state } = createOperations();
  const equipment = {
    id: 'EQ-1',
    manufacturer: 'Mantall',
    model: 'HZ160',
    inventoryNumber: '083',
    serialNumber: 'SN-083',
    type: 'boom',
    location: 'Склад',
  };
  const mechanic = { userId: 'U-mechanic', userName: 'Петров', userRole: 'Механик' };

  const ticket = operations.createServiceTicketFromBot(equipment, mechanic, 'Течь гидравлики');

  assert.equal(ticket.assignedMechanicId, 'U-mechanic');
  assert.equal(ticket.mechanicId, 'U-mechanic');
  assert.equal(ticket.assignedMechanicName, 'Петров');
  assert.equal(ticket.assignedTo, 'Петров');
  assert.equal(ticket.createdAt, '2026-04-30T10:00:00.000Z');
  assert.equal(ticket.updatedAt, '2026-04-30T10:00:00.000Z');
  assert.equal(state.service[0].id, ticket.id);
  assert.equal(state.service[0].assignedMechanicId, 'U-mechanic');
  assert.equal(state.service[0].createdAt, '2026-04-30T10:00:00.000Z');
});

test('MAX service ticket keeps selected service context', () => {
  const { operations, state } = createOperations();
  const equipment = {
    id: 'EQ-1',
    manufacturer: 'Mantall',
    model: 'HZ160',
    inventoryNumber: '083',
    serialNumber: 'SN-083',
    type: 'boom',
    location: 'Склад',
  };
  const mechanic = { userId: 'U-mechanic', userName: 'Петров', userRole: 'Механик' };

  const ticket = operations.createServiceTicketFromBot(
    equipment,
    mechanic,
    'Течь гидравлики',
    '',
    {
      key: 'commercial_repair',
      label: 'Коммерческий ремонт',
      selectedAt: '2026-04-30T09:00:00.000Z',
      selectedByUserId: 'U-mechanic',
      selectedByUserName: 'Петров',
      source: 'bot',
    },
  );

  assert.equal(ticket.serviceContext, 'commercial_repair');
  assert.equal(ticket.repairContext, 'commercial_repair');
  assert.equal(ticket.ticketContext.label, 'Коммерческий ремонт');
  assert.equal(state.service[0].ticketContext.key, 'commercial_repair');
});

test('Stage H MAX repair creation atomically closes active classic and planner rental', () => {
  const { operations, state } = createOperations();
  const equipment = {
    id: 'EQ-1',
    manufacturer: 'Mantall',
    model: 'HZ160',
    inventoryNumber: '083',
    serialNumber: 'SN-083',
    status: 'rented',
    currentClient: 'ООО Клиент',
    returnDate: '2026-05-20',
  };
  state.equipment = [equipment];
  state.rentals = [{
    id: 'R-1', client: 'ООО Клиент', equipmentId: 'EQ-1',
    startDate: '2026-04-01', plannedReturnDate: '2026-05-20', status: 'active',
  }];
  state.gantt_rentals = [{
    id: 'GR-1', rentalId: 'R-1', client: 'ООО Клиент', equipmentId: 'EQ-1',
    startDate: '2026-04-01', endDate: '2026-05-20', status: 'active', comments: [],
  }];

  operations.createServiceTicketFromBot(equipment, admin, 'Поломка');

  assert.equal(state.rentals[0].status, 'closed');
  assert.equal(state.gantt_rentals[0].status, 'returned');
  assert.equal(state.equipment[0].status, 'in_service');
  assert.equal(state.service.length, 1);
});

test('Stage H MAX repair creation batch failure leaves every lifecycle collection unchanged', () => {
  const options = { failBatch: false };
  const { operations, state } = createOperations(options);
  const equipment = { id: 'EQ-1', inventoryNumber: '083', serialNumber: 'SN-083', status: 'rented' };
  state.equipment = [equipment];
  state.rentals = [{ id: 'R-1', equipmentId: 'EQ-1', startDate: '2026-04-01', plannedReturnDate: '2026-05-20', status: 'active' }];
  state.gantt_rentals = [{ id: 'GR-1', rentalId: 'R-1', equipmentId: 'EQ-1', startDate: '2026-04-01', endDate: '2026-05-20', status: 'active', comments: [] }];
  const before = structuredClone(state);
  options.failBatch = true;

  assert.throws(
    () => operations.createServiceTicketFromBot(equipment, admin, 'Поломка'),
    /Injected MAX lifecycle batch failure/,
  );
  assert.deepEqual(state, before);
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

test('MAX helpers allow mechanic bot append to open repair items without assignment', () => {
  const { operations, state } = createOperations();
  const mechanic = { userId: 'U-mechanic', userName: 'Механик', userRole: 'Механик' };

  const workItem = operations.addRepairWorkItemFromCatalog(ticket, work, 1, mechanic, { source: 'bot' });
  const partItem = operations.addRepairPartItemFromCatalog(ticket, part, 2, 500, mechanic, { source: 'bot' });

  assert.equal(state.repair_work_items.length, 1);
  assert.equal(state.repair_part_items.length, 1);
  assert.equal(workItem.repairId, ticket.id);
  assert.equal(partItem.repairId, ticket.id);
});

test('MAX helpers keep ready and closed repair items unavailable for mechanic bot append', () => {
  const { operations, state } = createOperations();
  const mechanic = { userId: 'U-mechanic', userName: 'Механик', userRole: 'Механик' };

  assert.throws(
    () => operations.addRepairWorkItemFromCatalog({ ...ticket, status: 'ready' }, work, 1, mechanic, { source: 'bot' }),
    /только администратор/,
  );
  assert.throws(
    () => operations.addRepairPartItemFromCatalog({ ...ticket, status: 'closed' }, part, 1, 100, mechanic, { source: 'bot' }),
    /только администратор/,
  );
  assert.equal(state.repair_work_items.length, 0);
  assert.equal(state.repair_part_items.length, 0);
});

test('Stage H MAX receiving atomically closes classic and planner rental with stable links', () => {
  const { operations, state } = createOperations();
  state.equipment = [{
    id: 'EQ-1',
    manufacturer: 'Mantall',
    model: 'HZ160',
    inventoryNumber: '083',
    serialNumber: 'SN-083',
    status: 'rented',
    currentClient: 'ООО Клиент',
    returnDate: '2026-05-20',
  }];
  state.rentals = [{
    id: 'R-1',
    clientId: 'C-1',
    client: 'ООО Клиент',
    equipmentId: 'EQ-1',
    startDate: '2026-04-01',
    plannedReturnDate: '2026-05-20',
    status: 'active',
  }];
  state.gantt_rentals = [{
    id: 'GR-1',
    rentalId: 'R-1',
    clientId: 'C-1',
    client: 'ООО Клиент',
    equipmentId: 'EQ-1',
    equipmentInv: '083',
    startDate: '2026-04-01',
    endDate: '2026-05-20',
    status: 'active',
    comments: [],
  }];

  const result = operations.completeBotEquipmentOperation({
    id: 'OP-1',
    type: 'receiving',
    equipmentId: 'EQ-1',
    status: 'in_progress',
    photos: { front: ['photo-ref'] },
    checklist: { exterior: true },
    hoursValue: 125,
    damageDescription: 'Требуется осмотр',
  }, admin);

  assert.equal(result.event.rentalId, 'R-1');
  assert.equal(result.event.ganttRentalId, 'GR-1');
  assert.equal(result.createdServiceTicket.rentalId, 'R-1');
  assert.equal(result.createdServiceTicket.ganttRentalId, 'GR-1');
  assert.equal(state.rentals[0].status, 'closed');
  assert.equal(state.rentals[0].actualReturnDate, '2026-04-30');
  assert.equal(state.gantt_rentals[0].status, 'returned');
  assert.equal(state.gantt_rentals[0].endDate, '2026-04-30');
  assert.equal(state.equipment[0].status, 'in_service');
  assert.equal(state.service.length, 1);
  assert.equal(state.shipping_photos.length, 1);
  assert.equal(state.equipment_operation_sessions[0].status, 'completed');
});

test('Stage H MAX receiving batch failure leaves every lifecycle collection unchanged', () => {
  const options = { failBatch: false };
  const { operations, state } = createOperations(options);
  state.equipment = [{ id: 'EQ-1', inventoryNumber: '083', serialNumber: 'SN-083', status: 'rented' }];
  state.rentals = [{ id: 'R-1', client: 'ООО Клиент', equipmentId: 'EQ-1', status: 'active' }];
  state.gantt_rentals = [{ id: 'GR-1', rentalId: 'R-1', client: 'ООО Клиент', equipmentId: 'EQ-1', startDate: '2026-04-01', endDate: '2026-05-20', status: 'active', comments: [] }];
  const before = structuredClone(state);
  options.failBatch = true;

  assert.throws(() => operations.completeBotEquipmentOperation({
    id: 'OP-rollback',
    type: 'receiving',
    equipmentId: 'EQ-1',
    status: 'in_progress',
    photos: { front: ['photo-ref'] },
    checklist: {},
    hoursValue: 130,
    damageDescription: 'Rollback',
  }, admin), /Injected MAX lifecycle batch failure/);
  assert.deepEqual(state, before);
});

test('Stage H MAX receiving supports a legacy active classic rental without Gantt', () => {
  const { operations, state } = createOperations();
  state.equipment = [{
    id: 'EQ-1', inventoryNumber: '083', serialNumber: 'SN-083', status: 'rented',
    currentClient: 'ООО Клиент', returnDate: '2026-05-20',
  }];
  state.rentals = [{
    id: 'R-legacy', clientId: 'C-1', client: 'ООО Клиент', equipmentId: 'EQ-1',
    startDate: '2026-04-01', plannedReturnDate: '2026-05-20', status: 'active',
  }];

  const result = operations.completeBotEquipmentOperation({
    id: 'OP-legacy', type: 'receiving', equipmentId: 'EQ-1', status: 'in_progress',
    photos: { front: ['photo-ref'] }, checklist: {}, hoursValue: 130, damageDescription: 'Осмотр',
  }, admin);

  assert.equal(result.event.rentalId, 'R-legacy');
  assert.equal(result.event.ganttRentalId, undefined);
  assert.equal(result.createdServiceTicket.rentalId, 'R-legacy');
  assert.equal(result.createdServiceTicket.ganttRentalId, undefined);
  assert.equal(state.rentals[0].status, 'closed');
  assert.equal(state.equipment[0].status, 'in_service');
});

test('MAX shipping ignores a stale active Gantt projection and never resurrects its terminal Classic rental', () => {
  const { operations, state } = createOperations();
  const equipment = { id: 'EQ-1', inventoryNumber: '083', serialNumber: 'SN-083', status: 'available' };
  state.equipment = [equipment];
  state.rentals = [{
    id: 'R-closed',
    client: 'ООО Клиент',
    equipmentId: 'EQ-1',
    startDate: '2026-04-01',
    plannedReturnDate: '2026-04-20',
    actualReturnDate: '2026-04-20',
    status: 'closed',
  }];
  state.gantt_rentals = [{
    id: 'GR-stale',
    rentalId: 'R-closed',
    client: 'ООО Клиент',
    equipmentId: 'EQ-1',
    startDate: '2026-04-01',
    endDate: '2026-04-20',
    status: 'active',
    comments: [],
  }];

  const result = operations.saveBotShippingPhotoEvent(equipment, admin, 'shipping', ['photo'], 'stale projection');

  assert.equal(result.activeRental, null);
  assert.equal(state.rentals[0].status, 'closed');
  assert.equal(state.rentals[0].actualReturnDate, '2026-04-20');
  assert.equal(state.gantt_rentals[0].status, 'active');
  assert.equal(state.equipment[0].status, 'available');
  assert.equal(state.shipping_photos[0].rentalId, undefined);
});
