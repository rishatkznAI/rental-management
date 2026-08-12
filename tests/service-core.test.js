import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createServiceCore } = require('../server/lib/service-core.js');
const { equipmentMatchesServiceTicket } = require('../server/lib/equipment-matching.js');

function createMemoryServiceCore(options = {}) {
  const state = {
    service: [{
      id: 'S-1',
      equipmentId: 'EQ-1',
      equipment: 'Mantall HZ160JRT (INV: 083)',
      inventoryNumber: '083',
      serialNumber: 'SN-083',
      status: 'in_progress',
      reason: 'Течь гидравлики',
      workLog: [],
    }],
    equipment: [{
      id: 'EQ-1',
      inventoryNumber: '083',
      serialNumber: 'SN-083',
      status: 'in_service',
    }],
    rentals: [],
    gantt_rentals: [],
    counterparties: [{ id: 'CP-1', legalName: 'Customer', status: 'active', roles: ['customer'] }],
    counterparty_role_assignments: [{ id: 'A-1', counterpartyId: 'CP-1', roleCode: 'customer', status: 'active' }],
    clients: [{ id: 'CL-1', counterpartyId: 'CP-1', company: 'Customer' }],
    client_objects: [],
    client_contracts: [],
  };
  const core = createServiceCore({
    readData: (name) => state[name] ?? [],
    writeData: (name, value) => {
      state[name] = value;
    },
    writeDataBatch: (entries) => {
      if (options.failBatch) throw new Error('Injected service batch failure');
      for (const entry of entries || []) state[entry.name] = entry.value;
    },
    nowIso: () => '2026-04-24T08:00:00.000Z',
    equipmentMatchesServiceTicket,
  });

  return { state, core };
}

test('ready service ticket no longer blocks equipment for new work', () => {
  const { state, core } = createMemoryServiceCore();

  const updated = core.updateServiceTicketStatus(
    state.service[0],
    'ready',
    'Дмитрий',
    'Работы завершены через MAX',
  );

  assert.equal(updated.status, 'ready');
  assert.equal(state.equipment[0].status, 'available');
  assert.equal(core.getOpenTicketByEquipment(state.equipment[0]), null);
});

test('closing maintenance service atomically updates lifecycle and maintenance date', () => {
  const { state, core } = createMemoryServiceCore();
  state.service[0].serviceKind = 'chto';

  const updated = core.updateServiceTicketStatus(
    state.service[0],
    'closed',
    'Дмитрий',
    'ЧТО завершено',
  );

  assert.equal(updated.status, 'closed');
  assert.equal(state.equipment[0].status, 'available');
  assert.equal(state.equipment[0].maintenanceCHTO, '2026-04-24');
});

test('sales PDI creation does not move equipment into ordinary service', () => {
  const { state, core } = createMemoryServiceCore();
  state.equipment[0] = { ...state.equipment[0], status: 'available', saleMode: true };
  state.gantt_rentals = [{
    id: 'GR-1',
    equipmentId: 'EQ-1',
    status: 'active',
    startDate: '2026-04-01',
    endDate: '2026-05-20',
    comments: [],
  }];

  const result = core.applyServiceTicketCreationEffects({
    id: 'PDI-1',
    equipmentId: 'EQ-1',
    type: 'pdi',
    scenario: 'pdi',
    source: 'sales',
    saleMode: true,
    pdiData: { result: 'ready_for_sale' },
    reason: 'PDI / предпродажная подготовка',
  }, 'Оператор');

  assert.equal(state.equipment[0].status, 'available');
  assert.equal(state.gantt_rentals[0].status, 'active');
  assert.deepEqual(state.gantt_rentals[0].comments, []);
  assert.equal(result.ticket.counterpartyId, undefined);
  assert.equal(result.ticket.clientId, undefined);
});

test('production smoke fixture cannot be moved into service by service creation side effects', () => {
  const { state, core } = createMemoryServiceCore();
  state.service = [];
  state.equipment = [{
    id: 'EQ-smoke',
    manufacturer: 'Skytech',
    model: 'Production smoke rental fixture',
    inventoryNumber: 'SMOKE-RENTAL-001',
    serialNumber: 'SMOKE-RENTAL-001',
    status: 'available',
    category: 'own',
    activeInFleet: true,
  }];

  assert.throws(() => core.applyServiceTicketCreationEffects({
    id: 'S-smoke',
    equipmentId: 'EQ-smoke',
    inventoryNumber: 'SMOKE-RENTAL-001',
    serialNumber: 'SMOKE-RENTAL-001',
    status: 'new',
    reason: 'Случайная сервисная заявка',
  }, 'Оператор'), /SYSTEM_FIXTURE_PROTECTED/);

  assert.equal(state.equipment[0].status, 'available');
  assert.equal(state.equipment[0].category, 'own');
  assert.equal(state.equipment[0].inventoryNumber, 'SMOKE-RENTAL-001');
});

test('Stage H service creation atomically closes linked rental projections and overrides equipment', () => {
  const { state, core } = createMemoryServiceCore();
  state.service = [];
  state.equipment[0] = {
    ...state.equipment[0],
    status: 'rented',
    currentClient: 'ООО Клиент',
    returnDate: '2026-05-20',
  };
  state.rentals = [{
    id: 'R-1',
    client: 'ООО Клиент',
    equipmentId: 'EQ-1',
    equipment: ['083'],
    startDate: '2026-04-01',
    plannedReturnDate: '2026-05-20',
    status: 'active',
    history: [],
  }];
  state.gantt_rentals = [{
    id: 'GR-1',
    rentalId: 'R-1',
    equipmentId: 'EQ-1',
    equipmentInv: '083',
    startDate: '2026-04-01',
    endDate: '2026-05-20',
    status: 'active',
    comments: [],
  }];
  const ticket = { id: 'S-new', equipmentId: 'EQ-1', inventoryNumber: '083', status: 'new', reason: 'Поломка' };

  core.applyServiceTicketCreationEffects(ticket, 'Оператор', {
    persistService: true,
    serviceTickets: [ticket],
  });

  assert.equal(state.service[0].id, 'S-new');
  assert.equal(state.rentals[0].status, 'closed');
  assert.equal(state.rentals[0].actualReturnDate, '2026-04-24');
  assert.equal(state.gantt_rentals[0].status, 'returned');
  assert.equal(state.gantt_rentals[0].endDate, '2026-04-24');
  assert.equal(state.equipment[0].status, 'in_service');
  assert.equal(state.equipment[0].currentClient, undefined);
  assert.equal(state.equipment[0].returnDate, undefined);
});

test('service lifecycle does not treat orphan Gantt as a Classic rental', () => {
  const { state, core } = createMemoryServiceCore();
  state.service = [];
  state.equipment[0] = { ...state.equipment[0], status: 'available' };
  state.rentals = [];
  state.gantt_rentals = [{
    id: 'GR-orphan',
    equipmentId: 'EQ-1',
    equipmentInv: '083',
    startDate: '2026-04-01',
    endDate: '2026-05-20',
    status: 'active',
    comments: [],
  }];
  const ticket = { id: 'S-new', equipmentId: 'EQ-1', inventoryNumber: '083', status: 'new', reason: 'Поломка' };

  core.applyServiceTicketCreationEffects(ticket, 'Оператор', {
    persistService: true,
    serviceTickets: [ticket],
  });

  assert.equal(state.service[0].id, 'S-new');
  assert.equal(state.rentals.length, 0);
  assert.equal(state.gantt_rentals[0].status, 'active');
  assert.equal(state.gantt_rentals[0].rentalId, undefined);
  assert.equal(state.equipment[0].status, 'in_service');
});

test('Stage H service batch failure rolls back ticket, rental, planner and equipment', () => {
  const options = { failBatch: false };
  const { state, core } = createMemoryServiceCore(options);
  state.service = [];
  state.rentals = [{ id: 'R-1', client: 'ООО Клиент', equipmentId: 'EQ-1', startDate: '2026-04-01', plannedReturnDate: '2026-05-20', status: 'active' }];
  state.gantt_rentals = [{ id: 'GR-1', rentalId: 'R-1', equipmentId: 'EQ-1', startDate: '2026-04-01', endDate: '2026-05-20', status: 'active', comments: [] }];
  state.equipment[0] = { ...state.equipment[0], status: 'rented', currentClient: 'ООО Клиент', returnDate: '2026-05-20' };
  const before = structuredClone(state);
  const ticket = { id: 'S-new', equipmentId: 'EQ-1', inventoryNumber: '083', status: 'new', reason: 'Поломка' };
  options.failBatch = true;

  assert.throws(() => core.applyServiceTicketCreationEffects(ticket, 'Оператор', {
    persistService: true,
    serviceTickets: [ticket],
  }), /Injected service batch failure/);
  assert.deepEqual(state, before);
});

test('Service-core status, revision, and bulk mutations preserve canonical customer identity', () => {
  const { state, core } = createMemoryServiceCore();
  state.service[0] = {
    ...state.service[0],
    counterpartyId: 'CP-1',
    clientId: 'CL-1',
    assignedMechanicId: 'M-1',
    assignedMechanicName: 'Петров',
  };

  const ready = core.updateServiceTicketStatus(state.service[0], 'ready', 'Админ', 'Готово');
  assert.equal(ready.counterpartyId, 'CP-1');
  assert.equal(ready.clientId, 'CL-1');

  const revision = core.returnServiceTicketForRevision(ready, { reason: 'Проверка' }, { userId: 'U-1', userName: 'Админ' });
  assert.equal(revision.counterpartyId, 'CP-1');
  assert.equal(revision.clientId, 'CL-1');

  const resolved = core.resolveServiceTicketRevision(revision, { resolutionComment: 'Исправлено' }, { userId: 'U-2', userName: 'Петров' });
  assert.equal(resolved.counterpartyId, 'CP-1');

  core.persistServiceTicketBulkReplace([{ ...resolved, description: 'Атомарно' }], 'Админ');
  assert.equal(state.service[0].counterpartyId, 'CP-1');
  assert.equal(state.service[0].description, 'Атомарно');

  assert.throws(
    () => core.persistServiceTicketUpdate({ ...state.service[0], counterpartyId: 'CP-2' }, 'Админ'),
    /Counterparty|counterparty|ServiceTicket/,
  );
});
