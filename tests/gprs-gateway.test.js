import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createGprsGateway } = require('../server/lib/gprs-gateway.js');

function createMemoryGateway(stateOverrides = {}) {
  const state = {
    equipment: [],
    gsm_packets: [],
    gsm_commands: [],
    ...stateOverrides,
  };

  const gateway = createGprsGateway({
    readData: (name) => state[name] ?? [],
    writeData: (name, value) => {
      state[name] = value;
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  return { gateway, state };
}

test('GPRS analytics summarizes tracker quality and selected device traffic', () => {
  const now = Date.now();
  const recent = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const stale = new Date(now - 48 * 60 * 60 * 1000).toISOString();
  const { gateway } = createMemoryGateway({
    equipment: [
      { id: 'EQ-1', manufacturer: 'Mantall', model: '1932R', inventoryNumber: '001', gsmTrackerId: 'T1', gsmLastSignalAt: recent },
      { id: 'EQ-2', manufacturer: 'Mantall', model: 'XE80', inventoryNumber: '002', gsmTrackerId: 'T2', gsmLastSignalAt: stale },
    ],
    gsm_packets: [
      {
        id: 'P1',
        direction: 'inbound',
        equipmentId: 'EQ-1',
        deviceId: 'T1',
        protocol: 'generic-text',
        summary: 'Координаты 55.1, 49.1',
        createdAt: recent,
      },
      {
        id: 'P2',
        direction: 'inbound',
        equipmentId: null,
        deviceId: 'UNKNOWN',
        protocol: 'raw-text',
        createdAt: recent,
      },
    ],
    gsm_commands: [
      {
        id: 'C1',
        equipmentId: 'EQ-1',
        deviceId: 'T1',
        status: 'sent',
        createdAt: recent,
      },
      {
        id: 'C2',
        equipmentId: 'EQ-2',
        deviceId: 'T2',
        status: 'queued',
        createdAt: recent,
      },
    ],
  });

  const analytics = gateway.getAnalytics({ equipmentId: 'EQ-1', deviceId: 'T1' });

  assert.equal(analytics.trackedEquipment, 2);
  assert.equal(analytics.configuredTrackers, 2);
  assert.equal(analytics.staleTrackers, 1);
  assert.equal(analytics.unknownPackets24h, 1);
  assert.equal(analytics.packets24h, 2);
  assert.equal(analytics.commandStatus.sent, 1);
  assert.equal(analytics.commandStatus.queued, 1);
  assert.equal(analytics.selected.packets24h, 1);
  assert.equal(analytics.selected.lastProtocol, 'generic-text');
  assert.equal(analytics.selected.commandStatus.sent, 1);
  assert.equal(analytics.protocols[0].protocol, 'generic-text');
});
