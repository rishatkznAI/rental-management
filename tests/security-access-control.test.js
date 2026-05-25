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

test('rental manager can view service vehicles but cannot mutate them', () => {
  const state = {
    service_vehicles: [{ id: 'SV-1', plateNumber: 'A001AA' }],
    vehicle_trips: [{ id: 'VT-1', vehicleId: 'SV-1', route: 'Склад — объект' }],
  };
  const access = createAccess(state);
  const user = { userId: 'U-manager', userName: 'Руслан', userRole: 'Менеджер по аренде' };

  assert.deepEqual(access.filterCollectionByScope('service_vehicles', state.service_vehicles, user).map(item => item.id), ['SV-1']);
  assert.deepEqual(access.filterCollectionByScope('vehicle_trips', state.vehicle_trips, user).map(item => item.id), ['VT-1']);
  assert.equal(access.canMutateEntity('service_vehicles', state.service_vehicles[0], user), false);
});

test('manager mass assignment cannot override manager/status/payment fields', () => {
  const access = createAccess({});
  const user = { userId: 'U-manager', userName: 'Руслан', userRole: 'Менеджер по аренде' };

  const safe = access.sanitizeUpdateInput('clients', {
    company: 'ООО Клиент',
    managerId: 'U-other',
    status: 'approved',
  }, user, { id: 'C-1', manager: 'Руслан', managerId: 'U-manager' });

  assert.equal(safe.company, 'ООО Клиент');
  assert.equal(safe.managerId, undefined);
  assert.equal(safe.status, undefined);
  assert.throws(() => access.sanitizeUpdateInput('clients', {
    company: 'ООО Клиент',
    paymentStatus: 'paid',
  }, user, { id: 'C-1', manager: 'Руслан', managerId: 'U-manager' }), /paymentStatus/);
  assert.throws(() => access.sanitizeUpdateInput('clients', {
    company: 'ООО Клиент',
    role: 'Администратор',
  }, user, { id: 'C-1', manager: 'Руслан', managerId: 'U-manager' }), /role/);
  assert.throws(() => access.sanitizeUpdateInput('clients', {
    company: 'ООО Клиент',
    isAdmin: true,
  }, user, { id: 'C-1', manager: 'Руслан', managerId: 'U-manager' }), /isAdmin/);
  assert.throws(() => access.sanitizeUpdateInput('clients', {
    company: 'ООО Клиент',
    ownerId: 'OW-other',
  }, user, { id: 'C-1', manager: 'Руслан', managerId: 'U-manager' }), /ownerId/);
});

test('investor sees only own equipment and linked rentals', () => {
  const state = {
    equipment: [
      { id: 'EQ-1', inventoryNumber: '100', ownerId: 'OW-1', ownerName: 'SMOKE-INVESTOR-Owner' },
      { id: 'EQ-2', inventoryNumber: '200', ownerId: 'OW-2', ownerName: 'Other Owner' },
    ],
    gantt_rentals: [
      { id: 'GR-1', equipmentId: 'EQ-1' },
      { id: 'GR-2', equipmentId: 'EQ-2' },
    ],
    rentals: [
      { id: 'R-1', equipmentId: 'EQ-1', clientId: 'C-1' },
      { id: 'R-legacy', equipment: ['100'], clientId: 'C-1' },
      { id: 'R-2', equipmentId: 'EQ-2', clientId: 'C-2' },
    ],
    clients: [{ id: 'C-1', company: 'ООО Свой' }],
    documents: [{ id: 'D-1', rentalId: 'R-1', clientId: 'C-1' }],
    owners: [{ id: 'OW-1', name: 'SMOKE-INVESTOR-Owner' }, { id: 'OW-2', name: 'Other Owner' }],
    payments: [{ id: 'P-1', rentalId: 'R-1', clientId: 'C-1' }],
    service: [{ id: 'S-1', equipmentId: 'EQ-1' }],
  };
  const access = createAccess(state);
  const investor = { userId: 'U-investor', userName: 'Инвестор', userRole: 'Инвестор', ownerId: 'OW-1', ownerName: 'SMOKE-INVESTOR-Owner' };

  assert.deepEqual(access.filterCollectionByScope('equipment', state.equipment, investor).map(item => item.id), ['EQ-1']);
  assert.deepEqual(access.filterCollectionByScope('rentals', state.rentals, investor).map(item => item.id), ['R-1', 'R-legacy']);
  assert.deepEqual(access.filterCollectionByScope('gantt_rentals', state.gantt_rentals, investor).map(item => item.id), ['GR-1']);
  assert.deepEqual(access.filterCollectionByScope('owners', state.owners, investor).map(item => item.id), ['OW-1']);
  assert.deepEqual(access.filterCollectionByScope('clients', state.clients, investor), []);
  assert.deepEqual(access.filterCollectionByScope('documents', state.documents, investor), []);
  assert.deepEqual(access.filterCollectionByScope('payments', state.payments, investor), []);
  assert.deepEqual(access.filterCollectionByScope('service', state.service, investor), []);
  assert.equal(access.canAccessEntity('equipment', state.equipment[1], investor), false);
  assert.equal(access.canAccessEntity('rentals', state.rentals[2], investor), false);
  assert.equal(access.canMutateEntity('equipment', state.equipment[0], investor), false);
  assert.equal(access.canMutateEntity('rentals', state.rentals[0], investor), false);
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

test('service foreman can dispatch service work without finance or admin access', () => {
  const state = {
    service: [
      { id: 'S-1', assignedMechanicId: 'M-1' },
      { id: 'S-2', assignedMechanicId: 'M-2' },
    ],
    mechanics: [
      { id: 'M-1', name: 'Петров', status: 'active' },
      { id: 'M-2', name: 'Иванов', status: 'active' },
    ],
    payments: [{ id: 'P-1', clientId: 'C-1' }],
    documents: [{ id: 'D-1', clientId: 'C-1' }],
    users: [{ id: 'U-admin', role: 'Администратор' }],
  };
  const access = createAccess(state);
  const foreman = { userId: 'U-foreman', userName: 'Бригадир', userRole: 'Бригадир' };

  assert.deepEqual(access.filterCollectionByScope('service', state.service, foreman).map(item => item.id), ['S-1', 'S-2']);
  assert.deepEqual(access.filterCollectionByScope('mechanics', state.mechanics, foreman).map(item => item.id), ['M-1', 'M-2']);
  assert.equal(access.canMutateEntity('service', state.service[0], foreman), true);
  assert.deepEqual(access.filterCollectionByScope('payments', state.payments, foreman), []);
  assert.deepEqual(access.filterCollectionByScope('documents', state.documents, foreman), []);
  assert.deepEqual(access.filterCollectionByScope('users', state.users, foreman), []);
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
  const safeWarrantyCreate = access.sanitizeCreateInput('warranty_claims', {
    serviceTicketId: 'S-2',
    equipmentId: 'EQ-1',
    equipmentLabel: 'Lift EQ-1',
    factoryName: 'Factory',
    failureDescription: 'Hydraulic leak',
    requestedResolution: 'Warranty parts',
    factoryResponse: 'Accepted',
    decision: 'Approve',
    priority: 'high',
    role: 'Администратор',
    amount: 100000,
    paymentStatus: 'paid',
  }, warrantyMechanic);
  assert.equal(safeWarrantyCreate.serviceTicketId, 'S-2');
  assert.equal(safeWarrantyCreate.equipmentLabel, 'Lift EQ-1');
  assert.equal(safeWarrantyCreate.factoryName, 'Factory');
  assert.equal(safeWarrantyCreate.failureDescription, 'Hydraulic leak');
  assert.equal(safeWarrantyCreate.requestedResolution, 'Warranty parts');
  assert.equal(safeWarrantyCreate.factoryResponse, 'Accepted');
  assert.equal(safeWarrantyCreate.decision, 'Approve');
  assert.equal(safeWarrantyCreate.priority, 'high');
  assert.equal(safeWarrantyCreate.role, undefined);
  assert.equal(safeWarrantyCreate.amount, undefined);
  assert.equal(safeWarrantyCreate.paymentStatus, undefined);
  assert.equal(access.canAccessEntity('payments', { id: 'P-1', rentalId: 'R-1' }, warrantyMechanic), false);
  assert.deepEqual(access.filterCollectionByScope('payments', [{ id: 'P-1', rentalId: 'R-1' }], warrantyMechanic), []);
  assert.throws(() => access.assertCanReadCollection('reports', warrantyMechanic), /Forbidden/);
  assert.throws(() => access.assertCanReadCollection('app_settings', warrantyMechanic), /Forbidden/);
  assert.deepEqual(access.filterCollectionByScope('service_vehicles', state.service_vehicles, warrantyMechanic), []);
});

test('carrier delivery scope is tied to carrierId', () => {
  const access = createAccess({});
  const carrier = { userId: 'carrier-1', userName: 'Быстрая доставка', userRole: 'Перевозчик', carrierId: 'carrier-1', phone: '100' };

  assert.equal(access.isCarrierDelivery({ id: 'DL-1', status: 'sent', carrierId: 'carrier-1' }, carrier), true);
  assert.equal(access.isCarrierDelivery({ id: 'DL-legacy', carrierKey: 'carrier-1' }, carrier), true);
  assert.equal(access.isCarrierDelivery({ id: 'DL-2', carrierKey: 'carrier-2', carrierUserId: '200' }, carrier), false);
  assert.equal(access.isCarrierDelivery({ id: 'DL-max-only', carrierUserId: '100' }, carrier), false);
  assert.equal(access.isCarrierDelivery({ id: 'DL-completed', status: 'completed', carrierId: 'carrier-1' }, carrier), false);
  assert.deepEqual(access.filterCollectionByScope('deliveries', [
    { id: 'DL-1', status: 'sent', carrierId: 'carrier-1' },
    { id: 'DL-completed', status: 'completed', carrierId: 'carrier-1' },
    { id: 'DL-other', status: 'sent', carrierId: 'carrier-2' },
  ], carrier).map(item => item.id), ['DL-1']);
  assert.equal(access.canMutateEntity('deliveries', { id: 'DL-1', status: 'sent', carrierId: 'carrier-1' }, carrier), false);
});

test('head can read delivery movement data but cannot mutate deliveries', () => {
  const access = createAccess({});
  const head = { userId: 'U-head', userName: 'Руководитель', userRole: 'Руководитель' };
  const delivery = {
    id: 'DL-1',
    status: 'sent',
    origin: 'Склад',
    destination: 'Объект',
    cost: 18000,
    carrierInvoiceReceived: true,
    clientPaymentVerified: true,
  };

  assert.equal(access.canAccessEntity('deliveries', delivery, head), true);
  assert.deepEqual(access.filterCollectionByScope('deliveries', [delivery], head).map(item => item.id), ['DL-1']);
  assert.equal(access.canMutateEntity('deliveries', delivery, head), false);

  const safe = access.sanitizeEntityForRead('deliveries', delivery, head);
  assert.equal(Object.hasOwn(safe, 'cost'), false);
  assert.equal(Object.hasOwn(safe, 'carrierInvoiceReceived'), false);
  assert.equal(Object.hasOwn(safe, 'clientPaymentVerified'), false);
});

test('non-admin cannot read app_settings or use generic payments mutation', () => {
  const access = createAccess({});
  const manager = { userId: 'U-manager', userName: 'Руслан', userRole: 'Менеджер по аренде' };

  assert.throws(() => access.assertCanReadCollection('app_settings', manager), /Forbidden/);
  assert.throws(() => access.assertCanCreateCollection('payments', manager), /Платежи/);
  assert.throws(() => access.assertCanBulkReplace('payments', manager), /Массовое обновление/);
});

test('rental manager can read delivery carriers without mutating directory', () => {
  const access = createAccess({});
  const manager = { userId: 'U-manager', userName: 'Руслан', userRole: 'Менеджер по аренде' };
  const admin = { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' };
  const carrier = { id: 'carrier-1', name: 'Быстрая доставка', status: 'active' };

  assert.doesNotThrow(() => access.assertCanReadCollection('delivery_carriers', manager));
  assert.deepEqual(access.filterCollectionByScope('delivery_carriers', [carrier], manager), [carrier]);
  assert.equal(access.canMutateEntity('delivery_carriers', carrier, manager), false);
  assert.throws(() => access.assertCanCreateCollection('delivery_carriers', manager, carrier), /Forbidden/);
  assert.throws(() => access.assertCanUpdateEntity('delivery_carriers', carrier, manager), /Forbidden/);
  assert.throws(() => access.assertCanDeleteEntity('delivery_carriers', carrier, manager), /Forbidden/);
  assert.throws(() => access.assertCanBulkReplace('delivery_carriers', manager), /Массовое обновление/);

  assert.doesNotThrow(() => access.assertCanReadCollection('delivery_carriers', admin));
  assert.doesNotThrow(() => access.assertCanCreateCollection('delivery_carriers', admin, carrier));
  assert.doesNotThrow(() => access.assertCanUpdateEntity('delivery_carriers', carrier, admin));
  assert.doesNotThrow(() => access.assertCanDeleteEntity('delivery_carriers', carrier, admin));
  assert.doesNotThrow(() => access.assertCanBulkReplace('delivery_carriers', admin));
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

test('new mass assignment protected fields are stripped or rejected for non-admin roles', () => {
  const access = createAccess({});
  const manager = { userId: 'U-manager', userName: 'Руслан', userRole: 'Менеджер по аренде' };
  const mechanic = { userId: 'U-mechanic', userName: 'Петров', userRole: 'Механик' };
  const carrier = { userId: 'U-carrier', userName: 'Перевозчик', userRole: 'Перевозчик', carrierId: 'carrier-1' };
  const investor = { userId: 'U-investor', userName: 'Инвестор', userRole: 'Инвестор', ownerId: 'OW-1' };

  const managerSafe = access.sanitizeUpdateInput('clients', { managerId: 'U-other' }, manager, {
    managerId: 'U-manager',
  });
  assert.equal(managerSafe.managerId, undefined);
  assert.throws(() => access.sanitizeUpdateInput('clients', { approvedBy: 'U-admin' }, manager, {
    managerId: 'U-manager',
  }), /approvedBy/);
  assert.throws(() => access.sanitizeUpdateInput('clients', { closedBy: 'U-admin' }, manager, {
    managerId: 'U-manager',
  }), /closedBy/);

  const mechanicSafe = access.sanitizeUpdateInput('service', {
    status: 'in_progress',
  }, mechanic);
  assert.equal(mechanicSafe.status, 'in_progress');
  for (const field of ['mechanicId', 'assignedMechanicId', 'assignedUserId', 'closedAt']) {
    assert.throws(() => access.sanitizeUpdateInput('service', {
      status: 'in_progress',
      [field]: field === 'closedAt' ? '2026-04-28T12:00:00.000Z' : 'M-other',
    }, mechanic), /Недостаточно прав/);
  }

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

test('non-admin service create allows only explicit PDI markers and strips unsafe assignment fields', () => {
  const access = createAccess({});
  const manager = { userId: 'U-manager', userName: 'Руслан', userRole: 'Менеджер по аренде' };

  const safe = access.sanitizeCreateInput('service', {
    serviceKind: 'repair',
    type: 'pdi',
    scenario: 'pdi',
    source: 'sales',
    saleMode: true,
    pdiData: { status: 'in_progress' },
    equipmentId: 'EQ-1',
    clientId: 'C-1',
    client: 'ООО Клиент',
    clientName: 'ООО Клиент',
    rentalId: 'R-1',
    objectId: 'CO-1',
    contractId: 'CC-1',
    reason: 'PDI / предпродажная подготовка',
    assignedTo: 'Другой механик',
    assignedMechanicId: 'M-2',
    resultData: { summary: 'done' },
    location: 'Склад',
    closedAt: '2026-05-01T10:00:00.000Z',
  }, manager);

  assert.equal(safe.type, 'pdi');
  assert.equal(safe.scenario, 'pdi');
  assert.equal(safe.source, 'sales');
  assert.equal(safe.saleMode, true);
  assert.deepEqual(safe.pdiData, { status: 'in_progress' });
  assert.equal(safe.clientId, 'C-1');
  assert.equal(safe.client, 'ООО Клиент');
  assert.equal(safe.clientName, 'ООО Клиент');
  assert.equal(safe.rentalId, 'R-1');
  assert.equal(safe.objectId, 'CO-1');
  assert.equal(safe.contractId, 'CC-1');
  assert.equal(safe.assignedTo, undefined);
  assert.equal(safe.assignedMechanicId, undefined);
  assert.equal(safe.resultData, undefined);
  assert.equal(safe.location, 'Склад');
  assert.equal(safe.closedAt, undefined);
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
