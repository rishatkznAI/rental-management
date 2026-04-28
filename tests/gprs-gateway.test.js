import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import net from 'node:net';
import { once } from 'node:events';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const { createGprsGateway } = require('../server/lib/gprs-gateway.js');
const { registerGsmRoutes } = require('../server/routes/gsm.js');

function createMemoryGateway(stateOverrides = {}, gatewayOptions = {}) {
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
    ...gatewayOptions,
  });

  return { gateway, state };
}

async function waitFor(check, timeoutMs = 1200) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('Timed out waiting for condition');
}

async function withExpressApp(app, fn) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function request(baseUrl, method, path, token = 'admin-token', body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

function createGsmApiApp(stateOverrides = {}) {
  const { gateway, state } = createMemoryGateway({
    users: [
      { id: 'U-1', name: 'Admin', role: 'Администратор' },
      { id: 'U-2', name: 'Viewer', role: 'Менеджер по аренде' },
    ],
    ...stateOverrides,
  });
  const app = express();
  app.use(express.json());
  const apiRouter = express.Router();

  function requireAuth(req, res, next) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = token === 'admin-token' ? state.users[0] : token === 'viewer-token' ? state.users[1] : null;
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = { userId: user.id, userName: user.name, userRole: user.role };
    return next();
  }

  function requireWrite(collection) {
    return (req, res, next) => {
      if (collection === 'gsm_commands' && req.user.userRole === 'Администратор') return next();
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    };
  }

  registerGsmRoutes(apiRouter, { requireAuth, requireWrite, gprsGateway: gateway });
  app.use('/api', apiRouter);
  return { app, gateway, state };
}

test('TCP gateway accepts raw buffer and stores gsm_packets', async () => {
  const { gateway, state } = createMemoryGateway({}, { host: '127.0.0.1', port: 0 });
  const server = gateway.start();
  await once(server, 'listening');
  const { port } = server.address();

  const socket = net.createConnection({ host: '127.0.0.1', port });
  await once(socket, 'connect');
  socket.write(Buffer.from([0x78, 0x78, 0x01, 0x0d, 0x0a]));
  await waitFor(() => state.gsm_packets.length === 1);
  socket.destroy();
  await gateway.stop();

  assert.equal(state.gsm_packets[0].sourceIp, '127.0.0.1');
  assert.equal(state.gsm_packets[0].rawHex, '7878010D0A');
  assert.equal(state.gsm_packets[0].parseStatus, 'pending');
});

test('unknown packet gets pending parseStatus', () => {
  const { gateway, state } = createMemoryGateway();

  const packet = gateway.processRawPacket(Buffer.from('HELLO TRACKER'), {
    sourceIp: '10.0.0.10',
    remotePort: 12000,
  });

  assert.equal(packet.parseStatus, 'pending');
  assert.equal(packet.rawText, 'HELLO TRACKER');
  assert.equal(state.gsm_packets.length, 1);
});

test('parser error does not crash gateway and is stored on packet', () => {
  const { gateway, state } = createMemoryGateway({}, {
    parsePacket: () => {
      throw new Error('boom');
    },
  });

  const packet = gateway.processRawPacket(Buffer.from('IMEI:866123456789012'), {
    sourceIp: '10.0.0.11',
  });

  assert.equal(packet.parseStatus, 'failed');
  assert.equal(packet.parseError, 'boom');
  assert.equal(state.gsm_packets[0].parseError, 'boom');
});

test('packet with IMEI links to equipment by gsmImei and updates GSM state', () => {
  const { gateway, state } = createMemoryGateway({
    equipment: [
      { id: 'EQ-1', manufacturer: 'Mantall', model: 'XE80', inventoryNumber: '044', gsmImei: '866123456789012' },
    ],
  });

  const packet = gateway.processRawPacket(Buffer.from('IMEI:866123456789012 LAT:55.796 LNG:49.108 SPEED:0 VOLTAGE:12.4'), {
    sourceIp: '10.0.0.12',
  });

  assert.equal(packet.equipmentId, 'EQ-1');
  assert.equal(packet.parseStatus, 'parsed');
  assert.equal(state.equipment[0].gsmLastSeenAt, packet.receivedAt);
  assert.equal(state.equipment[0].gsmLastLat, 55.796);
  assert.equal(state.equipment[0].gsmLastLng, 49.108);
  assert.equal(state.equipment[0].gsmLastVoltage, 12.4);
  assert.equal(state.equipment[0].gsmStatus, 'online');
});

test('GET /api/gsm/packets returns stored packets', async () => {
  const { app, gateway } = createGsmApiApp();
  gateway.processRawPacket(Buffer.from('IMEI:866123456789012 LAT:55.796 LNG:49.108'), {
    sourceIp: '127.0.0.1',
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'GET', '/api/gsm/packets?limit=10', 'viewer-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.length, 1);
    assert.equal(response.body[0].imei, '866123456789012');
  });
});

test('GET /api/gsm/status returns gateway state', async () => {
  const { app, gateway } = createGsmApiApp();
  gateway.processRawPacket(Buffer.from('PING'), { sourceIp: '127.0.0.1' });

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'GET', '/api/gsm/status', 'viewer-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.tcpPort, 5023);
    assert.equal(response.body.packetsReceivedTotal, 1);
    assert.ok(response.body.lastPacketAt);
  });
});

test('POST /api/gsm/commands creates queued command', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [
      { id: 'EQ-1', manufacturer: 'Mantall', model: 'XE80', inventoryNumber: '044', gsmImei: '866123456789012' },
    ],
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/gsm/commands', 'admin-token', {
      equipmentId: 'EQ-1',
      command: 'PING',
      payload: { retries: 1 },
    });

    assert.equal(response.status, 202);
    assert.equal(response.body.status, 'queued');
    assert.equal(response.body.imei, '866123456789012');
    assert.equal(state.gsm_commands.length, 1);
  });
});

test('too large packet is stored as failed and does not break next packet', () => {
  const { gateway, state } = createMemoryGateway({}, { maxPacketBytes: 8 });

  const oversized = gateway.processRawPacket(Buffer.from('123456789'), { sourceIp: '10.0.0.13' });
  const normal = gateway.processRawPacket(Buffer.from('PING'), { sourceIp: '10.0.0.13' });

  assert.equal(oversized.parseStatus, 'failed');
  assert.match(oversized.parseError, /packet_too_large/);
  assert.equal(normal.parseStatus, 'pending');
  assert.equal(state.gsm_packets.length, 2);
});

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
