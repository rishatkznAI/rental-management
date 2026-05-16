import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import net from 'node:net';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const { createGprsGateway } = require('../server/lib/gprs-gateway.js');
const { parseWialonIpsPacket } = require('../server/lib/gsm/wialon-ips-parser.js');
const { createWialonIpsGateway } = require('../server/lib/gsm/wialon-ips-gateway.js');
const { registerGsmRoutes } = require('../server/routes/gsm.js');

function createMemoryGateway(stateOverrides = {}, gatewayOptions = {}) {
  const state = {
    equipment: [],
    gsm_devices: [],
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
      { id: 'U-3', name: 'Investor', role: 'Инвестор' },
    ],
    ...stateOverrides,
  });
  const app = express();
  app.use(express.json());
  const apiRouter = express.Router();

  function requireAuth(req, res, next) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = token === 'admin-token'
      ? state.users[0]
      : token === 'viewer-token'
        ? state.users[1]
        : token === 'investor-token'
          ? state.users[2]
          : null;
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = { userId: user.id, userName: user.name, userRole: user.role };
    return next();
  }

  function requireWrite(collection) {
    return (req, res, next) => {
      if (['gsm_commands', 'gsm_devices'].includes(collection) && req.user.userRole === 'Администратор') return next();
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    };
  }

  registerGsmRoutes(apiRouter, {
    requireAuth,
    requireWrite,
    gprsGateway: gateway,
    readData: name => state[name],
    writeData: (name, value) => {
      state[name] = value;
    },
    generateId: prefix => `${prefix}-test`,
    nowIso: () => '2026-05-16T10:00:00.000Z',
  });
  app.use('/api', apiRouter);
  return { app, gateway, state };
}

test('WIALON IPS parser handles login packet', () => {
  const parsed = parseWialonIpsPacket('#L#869132070808689;secret');

  assert.equal(parsed.parseStatus, 'parsed');
  assert.equal(parsed.packetType, 'login');
  assert.equal(parsed.imei, '869132070808689');
  assert.equal(parsed.ack.toString(), '#AL#1\r\n');
});

test('WIALON IPS parser handles ping packet', () => {
  const parsed = parseWialonIpsPacket('#P#');

  assert.equal(parsed.parseStatus, 'parsed');
  assert.equal(parsed.packetType, 'ping');
  assert.equal(parsed.ack.toString(), '#AP#\r\n');
});

test('WIALON IPS parser stores zero coordinates as invalid location', () => {
  const parsed = parseWialonIpsPacket('#SD#160526;101500;0;N;0;E;0;0;0;0');

  assert.equal(parsed.parseStatus, 'parsed');
  assert.equal(parsed.lat, 0);
  assert.equal(parsed.lng, 0);
  assert.equal(parsed.hasValidLocation, false);
});

test('WIALON IPS parser extracts extended params BoardVoltage and iobits', () => {
  const parsed = parseWialonIpsPacket('#D#160526;101500;5547.7676;N;04906.3848;E;12;180;90;7;1.1;3;0;12.2;NA;BoardVoltage:2:13.7,iobits0:1:1,param1:2:44,param9:2:99,param12:2:120');

  assert.equal(parsed.parseStatus, 'parsed');
  assert.equal(parsed.packetType, 'extended-data');
  assert.equal(Number(parsed.lat.toFixed(5)), 55.79613);
  assert.equal(Number(parsed.lng.toFixed(5)), 49.10641);
  assert.equal(parsed.BoardVoltage, 13.7);
  assert.equal(parsed.iobits0, 1);
  assert.equal(parsed.iobits1, 1);
  assert.equal(parsed.ignition, true);
  assert.equal(parsed.param1, '44');
  assert.equal(parsed.param9, '99');
  assert.equal(parsed.param12, '120');
});

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

test('GET /api/gsm/packets supports bounded paginated response', async () => {
  const packets = Array.from({ length: 5 }, (_, index) => ({
    id: `P-${index + 1}`,
    imei: 'IMEI-1',
    equipmentId: 'EQ-1',
    parseStatus: 'parsed',
    receivedAt: `2026-05-16T10:0${index}:00.000Z`,
  }));
  const { app } = createGsmApiApp({ gsm_packets: packets });
  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'GET', '/api/gsm/packets?paginated=true&page=1&pageSize=2', 'viewer-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.items.length, 2);
    assert.equal(response.body.pagination.pageSize, 2);
    assert.equal(response.body.pagination.hasNextPage, true);
  });
});

test('GET /api/gsm/packets rejects invalid parseStatus', async () => {
  const { app } = createGsmApiApp();

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'GET', '/api/gsm/packets?parseStatus=unknown', 'viewer-token');
    assert.equal(response.status, 400);
    assert.match(response.body.error, /parseStatus/);
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

test('GSM API enforces authentication and command write permissions', async () => {
  const { app } = createGsmApiApp({
    equipment: [
      { id: 'EQ-1', manufacturer: 'Mantall', model: 'XE80', inventoryNumber: '044', gsmImei: '866123456789012' },
    ],
  });

  await withExpressApp(app, async (baseUrl) => {
    const noAuth = await request(baseUrl, 'GET', '/api/gsm/status', '');
    assert.equal(noAuth.status, 401);

    const forbidden = await request(baseUrl, 'POST', '/api/gsm/commands', 'viewer-token', {
      equipmentId: 'EQ-1',
      command: 'PING',
    });
    assert.equal(forbidden.status, 403);
  });
});

test('GET /api/gsm/devices and route tolerate empty data', async () => {
  const { app } = createGsmApiApp();

  await withExpressApp(app, async (baseUrl) => {
    const devices = await request(baseUrl, 'GET', '/api/gsm/devices', 'viewer-token');
    assert.equal(devices.status, 200);
    assert.deepEqual(devices.body, []);

    const route = await request(baseUrl, 'GET', '/api/gsm/route?equipmentId=missing&dateFrom=2026-05-16T00:00:00.000Z&dateTo=2026-05-16T23:59:59.000Z', 'viewer-token');
    assert.equal(route.status, 200);
    assert.deepEqual(route.body, []);
  });
});

test('GET /api/gsm/route returns coordinate packets for equipment', async () => {
  const { app, gateway } = createGsmApiApp({
    equipment: [
      { id: 'EQ-1', manufacturer: 'Mantall', model: 'XE80', inventoryNumber: '044', gsmImei: '866123456789012' },
    ],
  });
  gateway.processRawPacket(Buffer.from('IMEI:866123456789012 LAT:55.796 LNG:49.108 SPEED:0 COURSE:120'), {
    sourceIp: '127.0.0.1',
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'GET', '/api/gsm/route?equipmentId=EQ-1&dateFrom=2026-05-16T00:00:00.000Z&dateTo=2026-05-16T23:59:59.000Z', 'viewer-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.length, 1);
    assert.equal(response.body[0].lat, 55.796);
    assert.equal(response.body[0].lng, 49.108);
    assert.equal(response.body[0].speed, 0);
  });
});

test('GET /api/gsm/route requires a bounded date window', async () => {
  const { app } = createGsmApiApp();

  await withExpressApp(app, async (baseUrl) => {
    const missingWindow = await request(baseUrl, 'GET', '/api/gsm/route?equipmentId=EQ-1', 'viewer-token');
    assert.equal(missingWindow.status, 400);
    assert.match(missingWindow.body.error, /dateFrom/);

    const tooLarge = await request(baseUrl, 'GET', '/api/gsm/route?equipmentId=EQ-1&dateFrom=2026-05-01T00:00:00.000Z&dateTo=2026-05-16T00:00:00.000Z', 'viewer-token');
    assert.equal(tooLarge.status, 400);
    assert.match(tooLarge.body.error, /7 дней/);
  });
});

test('GET /api/gsm/dashboard returns bounded snapshot without full references', async () => {
  const equipment = Array.from({ length: 25 }, (_, index) => ({
    id: `EQ-${index + 1}`,
    manufacturer: 'Mantall',
    model: `XE-${index + 1}`,
    inventoryNumber: `INV-${index + 1}`,
    status: index === 0 ? 'rented' : 'available',
    gsmImei: `IMEI-${index + 1}`,
    gsmLastSeenAt: '2026-05-16T10:00:00.000Z',
    gsmLastLat: 55 + index / 1000,
    gsmLastLng: 49 + index / 1000,
  }));
  const packets = Array.from({ length: 10 }, (_, index) => ({
    id: `P-${index + 1}`,
    imei: 'IMEI-1',
    equipmentId: 'EQ-1',
    parseStatus: 'parsed',
    lat: 55.7,
    lng: 49.1,
    receivedAt: `2026-05-16T10:0${index}:00.000Z`,
  }));
  const { app } = createGsmApiApp({
    equipment,
    clients: [{ id: 'CL-1', company: 'Client A', inn: '123', balance: 999 }],
    rentals: [{ id: 'R-1', equipmentId: 'EQ-1', clientId: 'CL-1', status: 'active', manager: 'Manager A', total: 500000 }],
    gantt_rentals: [{ id: 'G-1', rentalId: 'R-1', equipmentId: 'EQ-1', clientId: 'CL-1', status: 'active' }],
    gsm_packets: packets,
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'GET', '/api/gsm/dashboard?limit=5&recentLimit=3', 'viewer-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.snapshots.length, 5);
    assert.equal(response.body.recentPackets.length, 3);
    assert.equal(response.body.counters.total, 5);
    assert.equal(response.body.snapshots[0].binding.clientName, 'Client A');
    assert.equal(response.body.equipment, undefined);
    assert.equal(response.body.rentals, undefined);
    assert.equal(response.body.gantt_rentals, undefined);
    assert.equal(response.body.clients, undefined);
    assert.equal(response.body.snapshots[0].binding.total, undefined);
    assert.equal(response.body.snapshots[0].binding.balance, undefined);
  });
});

test('GSM dashboard RBAC denies investor before returning context', async () => {
  const { app } = createGsmApiApp({
    equipment: [{ id: 'EQ-1', manufacturer: 'Mantall', model: 'XE80', inventoryNumber: '044', gsmImei: '866123456789012' }],
  });

  await withExpressApp(app, async (baseUrl) => {
    const denied = await request(baseUrl, 'GET', '/api/gsm/dashboard', 'investor-token');
    assert.equal(denied.status, 403);
  });
});

test('GPRS gateway can be disabled without breaking status API', async () => {
  const { gateway } = createMemoryGateway({}, { enabled: false });
  const server = gateway.start();

  assert.equal(server, null);
  const status = gateway.getStatus();
  assert.equal(status.gatewayEnabled, false);
  assert.equal(status.disabled, true);
  assert.equal(status.tcpPort, 5023);
});

test('occupied GPRS port records a clear startup error without throwing', async () => {
  const { gateway: firstGateway } = createMemoryGateway({}, { host: '127.0.0.1', port: 0 });
  const firstServer = firstGateway.start();
  await once(firstServer, 'listening');
  const { port } = firstServer.address();

  const { gateway: secondGateway } = createMemoryGateway({}, { host: '127.0.0.1', port });
  const secondServer = secondGateway.start();
  await once(secondServer, 'error');

  const status = secondGateway.getStatus();
  assert.equal(status.gatewayEnabled, false);
  assert.match(status.startError, /EADDRINUSE|address already in use/i);

  await secondGateway.stop();
  await firstGateway.stop();
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

test('GET /api/gsm/gateway/commands supports bounded pagination', async () => {
  const commands = Array.from({ length: 4 }, (_, index) => ({
    id: `CMD-${index + 1}`,
    equipmentId: 'EQ-1',
    deviceId: 'DEV-1',
    command: `PING-${index + 1}`,
    status: 'queued',
    createdAt: `2026-05-16T10:0${index}:00.000Z`,
  }));
  const { app } = createGsmApiApp({ gsm_commands: commands });
  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'GET', '/api/gsm/gateway/commands?paginated=true&page=2&pageSize=2&deviceId=DEV-1', 'viewer-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.items.length, 2);
    assert.equal(response.body.pagination.page, 2);
    assert.equal(response.body.pagination.hasPrevPage, true);
  });
});

test('POST /api/gsm/devices/link links IMEI to equipment and creates gsm_devices record', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [
      { id: 'EQ-MANTALL', manufacturer: 'MANTALL', model: 'XE140W', inventoryNumber: '03300976' },
    ],
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      inventoryNumber: '03300976',
      model: 'MANTALL XE140W',
      imei: '869132070808689',
      deviceType: 'UMKA',
      sim1: '+79625678660',
      oldServer: 'gw1.glonasssoft.ru:15050',
      targetServer: 'tcp.proxy.railway.app:12345',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.device.equipmentId, 'EQ-MANTALL');
    assert.equal(response.body.device.imei, '869132070808689');
    assert.equal(response.body.device.targetServer, 'tcp.proxy.railway.app:12345');
    assert.equal(state.gsm_devices.length, 1);
    assert.equal(state.equipment[0].gsmImei, '869132070808689');
    assert.equal(state.equipment[0].gsmProtocol, 'WIALON IPS TCP');
  });
});

test('GSM devices link API denies non-admin write access', async () => {
  const { app } = createGsmApiApp({
    equipment: [
      { id: 'EQ-MANTALL', manufacturer: 'MANTALL', model: 'XE140W', inventoryNumber: '03300976' },
    ],
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'viewer-token', {
      inventoryNumber: '03300976',
      imei: '869132070808689',
    });
    assert.equal(response.status, 403);
  });
});

test('WIALON IPS gateway saves raw packet to gsm_packets and updates gsm_devices', () => {
  const state = {
    equipment: [{ id: 'EQ-MANTALL', manufacturer: 'MANTALL', model: 'XE140W', inventoryNumber: '03300976' }],
    gsm_devices: [{ id: 'GDEV-1', equipmentId: 'EQ-MANTALL', imei: '869132070808689', deviceType: 'UMKA', protocol: 'WIALON IPS TCP' }],
    gsm_packets: [],
  };
  const gateway = createWialonIpsGateway({
    readData: name => state[name] ?? [],
    writeData: (name, value) => {
      state[name] = value;
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    enabled: false,
  });

  gateway.processLine('#L#869132070808689;', { sourceIp: '127.0.0.1' });
  const result = gateway.processLine('#D#160526;101500;5547.7676;N;04906.3848;E;0;0;90;7;1.0;1;0;12.4;NA;BoardVoltage:2:13.1', {
    sourceIp: '127.0.0.1',
    connection: { id: 'CONN-1', imei: '869132070808689', sourceIp: '127.0.0.1' },
  });

  assert.equal(result.ack.toString(), '#AD#1\r\n');
  assert.equal(state.gsm_packets.length, 2);
  assert.equal(state.gsm_packets[0].rawText.startsWith('#D#160526'), true);
  assert.equal(state.gsm_packets[0].equipmentId, 'EQ-MANTALL');
  assert.equal(state.gsm_devices[0].lastVoltage, 13.1);
  assert.equal(state.equipment[0].gsmLastVoltage, 13.1);
});

test('local WIALON IPS TCP smoke client receives ACK', async () => {
  const state = {
    equipment: [],
    gsm_devices: [],
    gsm_packets: [],
  };
  const gateway = createWialonIpsGateway({
    readData: name => state[name] ?? [],
    writeData: (name, value) => {
      state[name] = value;
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    host: '127.0.0.1',
    port: 0,
    enabled: true,
  });
  const server = gateway.start();
  await once(server, 'listening');
  const { port } = server.address();

  const socket = net.createConnection({ host: '127.0.0.1', port });
  await once(socket, 'connect');
  socket.write('#L#869132070808689;\r\n');
  const [ack] = await once(socket, 'data');
  socket.destroy();
  await gateway.stop();

  assert.equal(ack.toString(), '#AL#1\r\n');
  assert.equal(state.gsm_packets.length, 1);
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

test('GSM page uses bounded dashboard context instead of full reference hooks', async () => {
  const source = await readFile(new URL('../src/app/pages/Gsm.tsx', import.meta.url), 'utf8');

  assert.equal(source.includes('useEquipmentList'), false);
  assert.equal(source.includes('useRentalsList'), false);
  assert.equal(source.includes('useGanttData'), false);
  assert.equal(source.includes('useClientsList'), false);
  assert.equal(source.includes('buildGsmSnapshot'), false);
  assert.match(source, /getDashboard\(\{ limit: 100, recentLimit: 50 \}\)/);
  assert.match(source, /getPacketsPaginated/);
  assert.match(source, /getCommandsPaginated/);
  assert.match(source, /getRoute\(\{ equipmentId: routeEquipmentId, dateFrom: routeFrom, dateTo: routeTo \}\)/);
});
