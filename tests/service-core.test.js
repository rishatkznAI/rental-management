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
