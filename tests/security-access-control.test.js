import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAccessControl } = require('../server/lib/access-control.js');

function createAccess(state) {
  return createAccessControl({
    readData: (name) => state[name] || [],
  });
}

test('rental manager can read and mutate only own rentals', () => {
  const state = {
    rentals: [
      { id: 'R-own', manager: 'Руслан', client: 'А' },
      { id: 'R-other', manager: 'Анна', client: 'Б' },
    ],
    gantt_rentals: [],
    equipment: [],
  };
  const access = createAccess(state);
  const user = { userId: 'U-manager', userName: 'Руслан', userRole: 'Менеджер по аренде' };

  assert.deepEqual(access.filterCollectionByScope('rentals', state.rentals, user).map(item => item.id), ['R-own']);
  assert.equal(access.canMutateEntity('rentals', state.rentals[0], user), true);
  assert.equal(access.canMutateEntity('rentals', state.rentals[1], user), false);
});

test('manager mass assignment cannot override manager/status/payment fields', () => {
  const access = createAccess({});
  const user = { userId: 'U-manager', userName: 'Руслан', userRole: 'Менеджер по аренде' };

  const safe = access.sanitizeUpdateInput('clients', {
    company: 'ООО Клиент',
    role: 'Администратор',
    isAdmin: true,
    ownerId: 'OW-other',
    managerId: 'U-other',
    status: 'approved',
    paymentStatus: 'paid',
  }, user, { id: 'C-1', manager: 'Руслан', managerId: 'U-manager' });

  assert.equal(safe.company, 'ООО Клиент');
  assert.equal(safe.role, undefined);
  assert.equal(safe.isAdmin, undefined);
  assert.equal(safe.ownerId, undefined);
  assert.equal(safe.managerId, 'U-manager');
  assert.equal(safe.status, undefined);
  assert.equal(safe.paymentStatus, undefined);
});

test('investor sees only own equipment and linked rentals', () => {
  const state = {
    equipment: [
      { id: 'EQ-1', inventoryNumber: '100', ownerId: 'OW-1' },
      { id: 'EQ-2', inventoryNumber: '200', ownerId: 'OW-2' },
    ],
    gantt_rentals: [
      { id: 'GR-1', equipmentId: 'EQ-1' },
      { id: 'GR-2', equipmentId: 'EQ-2' },
    ],
    rentals: [],
  };
  const access = createAccess(state);
  const investor = { userId: 'U-investor', userName: 'Инвестор', userRole: 'Инвестор', ownerId: 'OW-1' };

  assert.deepEqual(access.filterCollectionByScope('equipment', state.equipment, investor).map(item => item.id), ['EQ-1']);
  assert.deepEqual(access.filterCollectionByScope('gantt_rentals', state.gantt_rentals, investor).map(item => item.id), ['GR-1']);
});

test('mechanic sees and mutates only assigned service tickets', () => {
  const state = {
    mechanics: [{ id: 'M-1', name: 'Петров Иван Сергеевич', status: 'active' }],
    service: [
      { id: 'S-own', assignedMechanicId: 'M-1', assignedMechanicName: 'Петров Иван Сергеевич' },
      { id: 'S-other', assignedMechanicId: 'M-2', assignedMechanicName: 'Другой механик' },
    ],
  };
  const access = createAccess(state);
  const mechanic = { userId: 'U-mechanic', userName: 'Петров Иван Сергеевич', userRole: 'Механик' };

  assert.deepEqual(access.filterCollectionByScope('service', state.service, mechanic).map(item => item.id), ['S-own']);
  assert.equal(access.canMutateEntity('service', state.service[0], mechanic), true);
  assert.equal(access.canMutateEntity('service', state.service[1], mechanic), false);
});

test('warranty mechanic can view fleet and rentals and work with service and warranty claims', () => {
  const state = {
    service: [
      { id: 'S-1', assignedMechanicId: 'M-1', assignedMechanicName: 'Петров' },
      { id: 'S-2', assignedMechanicId: 'M-2', assignedMechanicName: 'Другой' },
    ],
    warranty_claims: [
      { id: 'WC-1', serviceTicketId: 'S-1', status: 'draft' },
      { id: 'WC-2', serviceTicketId: 'S-2', status: 'sent_to_factory' },
    ],
    equipment: [{ id: 'EQ-1', inventoryNumber: '100' }],
    gantt_rentals: [{ id: 'GR-1', rentalId: 'R-1', equipmentId: 'EQ-1', manager: 'Руслан' }],
    service_vehicles: [{ id: 'SV-1', plateNumber: 'A001AA' }],
    rentals: [{ id: 'R-1', manager: 'Руслан' }],
  };
  const access = createAccess(state);
  const warrantyMechanic = { userId: 'U-warranty', userName: 'Гарантийный механик', userRole: 'Механик по гарантии' };
  const warrantyMechanicAlias = { userId: 'U-warranty-alias', userName: 'Гарантийный механик Alias', userRole: 'warranty_mechanic' };
  const warrantyMechanicCamel = { userId: 'U-warranty-camel', userName: 'Гарантийный механик Camel', userRole: 'mechanicWarranty' };
  const warrantyMechanicLowercase = { userId: 'U-warranty-lower', userName: 'Гарантийный механик Lower', userRole: 'механик по гарантии' };

  assert.deepEqual(access.filterCollectionByScope('service', state.service, warrantyMechanic).map(item => item.id), ['S-1', 'S-2']);
  assert.deepEqual(access.filterCollectionByScope('warranty_claims', state.warranty_claims, warrantyMechanic).map(item => item.id), ['WC-1', 'WC-2']);
  assert.deepEqual(access.filterCollectionByScope('equipment', state.equipment, warrantyMechanic).map(item => item.id), ['EQ-1']);
  assert.deepEqual(access.filterCollectionByScope('rentals', state.rentals, warrantyMechanic).map(item => item.id), ['R-1']);
  assert.deepEqual(access.filterCollectionByScope('gantt_rentals', state.gantt_rentals, warrantyMechanic).map(item => item.id), ['GR-1']);
  assert.deepEqual(access.filterCollectionByScope('service', state.service, warrantyMechanicAlias).map(item => item.id), ['S-1', 'S-2']);
  assert.deepEqual(access.filterCollectionByScope('equipment', state.equipment, warrantyMechanicAlias).map(item => item.id), ['EQ-1']);
  assert.deepEqual(access.filterCollectionByScope('service', state.service, warrantyMechanicCamel).map(item => item.id), ['S-1', 'S-2']);
  assert.deepEqual(access.filterCollectionByScope('equipment', state.equipment, warrantyMechanicCamel).map(item => item.id), ['EQ-1']);
  assert.deepEqual(access.filterCollectionByScope('service', state.service, warrantyMechanicLowercase).map(item => item.id), ['S-1', 'S-2']);
  assert.deepEqual(access.filterCollectionByScope('equipment', state.equipment, warrantyMechanicLowercase).map(item => item.id), ['EQ-1']);
  assert.equal(access.canMutateEntity('service', state.service[1], warrantyMechanic), true);
  assert.equal(access.canMutateEntity('warranty_claims', state.warranty_claims[1], warrantyMechanic), true);
  assert.doesNotThrow(() => access.assertCanCreateCollection('warranty_claims', warrantyMechanic, { serviceTicketId: 'S-2' }));
  assert.equal(access.canAccessEntity('payments', { id: 'P-1', rentalId: 'R-1' }, warrantyMechanic), false);
  assert.deepEqual(access.filterCollectionByScope('payments', [{ id: 'P-1', rentalId: 'R-1' }], warrantyMechanic), []);
  assert.throws(() => access.assertCanReadCollection('reports', warrantyMechanic), /Forbidden/);
  assert.throws(() => access.assertCanReadCollection('app_settings', warrantyMechanic), /Forbidden/);
  assert.deepEqual(access.filterCollectionByScope('service_vehicles', state.service_vehicles, warrantyMechanic), []);
});

test('carrier delivery scope is tied to carrierId', () => {
  const access = createAccess({});
  const carrier = { userId: 'carrier-1', userName: 'Быстрая доставка', userRole: 'Перевозчик', carrierId: 'carrier-1', phone: '100' };

  assert.equal(access.isCarrierDelivery({ id: 'DL-1', carrierId: 'carrier-1' }, carrier), true);
  assert.equal(access.isCarrierDelivery({ id: 'DL-legacy', carrierKey: 'carrier-1' }, carrier), true);
  assert.equal(access.isCarrierDelivery({ id: 'DL-2', carrierKey: 'carrier-2', carrierUserId: '200' }, carrier), false);
  assert.equal(access.isCarrierDelivery({ id: 'DL-max-only', carrierUserId: '100' }, carrier), false);
});

test('non-admin cannot read app_settings or use generic payments mutation', () => {
  const access = createAccess({});
  const manager = { userId: 'U-manager', userName: 'Руслан', userRole: 'Менеджер по аренде' };

  assert.throws(() => access.assertCanReadCollection('app_settings', manager), /Forbidden/);
  assert.throws(() => access.assertCanCreateCollection('payments', manager), /Платежи/);
  assert.throws(() => access.assertCanBulkReplace('payments', manager), /Массовое обновление/);
});

test('unknown collections and roles are denied by default', () => {
  const access = createAccess({});
  const admin = { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' };
  const unknownRole = { userId: 'U-unknown', userName: 'Чужой', userRole: 'Подрядчик' };
  const manager = { userId: 'U-manager', userName: 'Руслан', userRole: 'Менеджер по аренде' };

  assert.equal(access.canAccessEntity('unknown_collection', { id: 'X-1' }, admin), false);
  assert.equal(access.canAccessEntity('rentals', { id: 'R-1', manager: 'Руслан' }, unknownRole), false);
  assert.deepEqual(access.filterCollectionByScope('unknown_collection', [{ id: 'X-1' }], admin), []);
  assert.throws(() => access.assertCanReadCollection('unknown_collection', manager), /Forbidden/);
});

test('new mass assignment protected fields are stripped for non-admin roles', () => {
  const access = createAccess({});
  const manager = { userId: 'U-manager', userName: 'Руслан', userRole: 'Менеджер по аренде' };
  const mechanic = { userId: 'U-mechanic', userName: 'Петров', userRole: 'Механик' };
  const carrier = { userId: 'U-carrier', userName: 'Перевозчик', userRole: 'Перевозчик', carrierId: 'carrier-1' };
  const investor = { userId: 'U-investor', userName: 'Инвестор', userRole: 'Инвестор', ownerId: 'OW-1' };

  const managerSafe = access.sanitizeUpdateInput('clients', { managerId: 'U-other', approvedBy: 'U-admin', closedBy: 'U-admin' }, manager, {
    managerId: 'U-manager',
  });
  assert.equal(managerSafe.managerId, 'U-manager');
  assert.equal(managerSafe.approvedBy, undefined);
  assert.equal(managerSafe.closedBy, undefined);

  const mechanicSafe = access.sanitizeUpdateInput('service', {
    status: 'in_progress',
    mechanicId: 'M-other',
    assignedMechanicId: 'M-other',
    assignedUserId: 'U-other',
    closedAt: '2026-04-28T12:00:00.000Z',
  }, mechanic);
  assert.equal(mechanicSafe.status, 'in_progress');
  assert.equal(mechanicSafe.mechanicId, undefined);
  assert.equal(mechanicSafe.assignedMechanicId, undefined);
  assert.equal(mechanicSafe.assignedUserId, undefined);
  assert.equal(mechanicSafe.closedAt, undefined);

  const carrierSafe = access.sanitizeUpdateInput('deliveries', {
    comment: 'ok',
    assignedUserId: 'U-other',
    carrierId: 'carrier-other',
    assignedCarrierId: 'carrier-other',
  }, carrier);
  assert.deepEqual(carrierSafe, {});

  const investorSafe = access.sanitizeUpdateInput('equipment', { ownerId: 'OW-other', notes: 'visible note' }, investor);
  assert.equal(investorSafe.ownerId, undefined);
  assert.equal(investorSafe.notes, 'visible note');
});

test('bulk replace is admin-only by default', () => {
  const access = createAccess({});
  const admin = { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' };
  const office = { userId: 'U-office', userName: 'Офис', userRole: 'Офис-менеджер' };
  const mechanic = { userId: 'U-mechanic', userName: 'Петров', userRole: 'Механик' };

  assert.doesNotThrow(() => access.assertCanBulkReplace('payments', admin));
  assert.throws(() => access.assertCanBulkReplace('app_settings', office), /Массовое обновление/);
  assert.throws(() => access.assertCanBulkReplace('users', office), /Массовое обновление/);
  assert.throws(() => access.assertCanBulkReplace('service', mechanic), /Массовое обновление/);
  assert.throws(() => access.assertCanBulkReplace('deliveries', { userRole: 'Перевозчик' }), /Массовое обновление/);
});

test('service child records require access to the parent ticket', () => {
  const state = {
    mechanics: [{ id: 'M-1', name: 'Петров' }],
    service: [
      { id: 'S-own', assignedMechanicId: 'M-1', assignedMechanicName: 'Петров' },
      { id: 'S-revision', assignedMechanicId: 'M-1', assignedMechanicName: 'Петров', status: 'needs_revision' },
      { id: 'S-other', assignedMechanicId: 'M-2', assignedMechanicName: 'Другой' },
    ],
  };
  const access = createAccess(state);
  const mechanic = { userId: 'U-mechanic', userName: 'Петров', userRole: 'Механик' };

  assert.equal(access.canAccessEntity('repair_work_items', { id: 'RW-1', repairId: 'S-own' }, mechanic), true);
  assert.equal(access.canAccessEntity('repair_work_items', { id: 'RW-2', repairId: 'S-other' }, mechanic), false);
  assert.equal(access.canAccessEntity('warranty_claims', { id: 'WC-1', serviceTicketId: 'S-other' }, mechanic), false);
  assert.doesNotThrow(() => access.assertCanCreateCollection('repair_work_items', mechanic, { repairId: 'S-own', workId: 'W-1' }));
  assert.doesNotThrow(() => access.assertCanCreateCollection('repair_work_items', mechanic, { repairId: 'S-revision', workId: 'W-1' }));
  assert.throws(() => access.assertCanCreateCollection('repair_work_items', mechanic, { repairId: 'S-other', workId: 'W-1' }), /только администратор/);
  assert.throws(() => access.assertCanCreateCollection('spare_parts', mechanic, { name: 'Фильтр', unit: 'шт' }), /Forbidden/);
});
