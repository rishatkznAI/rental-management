import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createServiceCore } = require('../server/lib/service-core.js');
const { equipmentMatchesServiceTicket } = require('../server/lib/equipment-matching.js');

function createMemoryServiceCore() {
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
    gantt_rentals: [],
  };
  const core = createServiceCore({
    readData: (name) => state[name] ?? [],
    writeData: (name, value) => {
      state[name] = value;
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

  core.applyServiceTicketCreationEffects({
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
