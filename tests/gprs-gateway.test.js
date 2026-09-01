import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import net from 'node:net';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { deriveGsmGatewayOperationalState } from '../src/app/lib/gsmGatewayOperationalState.js';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const { createGprsGateway, resolveGsmMaxCommandBytes } = require('../server/lib/gprs-gateway.js');
const { parseWialonIpsPacket } = require('../server/lib/gsm/wialon-ips-parser.js');
const { createWialonIpsGateway } = require('../server/lib/gsm/wialon-ips-gateway.js');
const { createTcpIngressAdmissionController } = require('../server/lib/gsm/tcp-ingress-admission.js');
const { aggregateGsmGatewayStatus } = require('../server/lib/gsm/gateway-runtime-view.js');
const {
  GSM_INGRESS_MODE_HTTP_TOKEN,
  GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
  fingerprintGsmIngressCredentialHash,
  hashGsmIngressSecret,
  verifyGsmIngressSecret,
} = require('../server/lib/gsm/device-credential.js');
const {
  EQUIPMENT_GSM_CONFIGURATION_PROJECTION_FIELDS,
  GSM_BINDING_FUTURE_SKEW_MS,
  advanceGsmDeviceBindingLifecycle,
  applyEquipmentGsmConfigurationProjection,
  assertEquipmentGsmProjectionMutation,
  canonicalEquipmentGsmConfigurationProjection,
  createTrustedGsmDeviceProvisioningGuard,
  createTrustedGsmDeviceScopeResolver,
  gsmCurrentDeviceBindingIssue,
  gsmDeviceBindingLifecycleIssue,
} = require('../server/lib/gsm/trusted-device-scope.js');
const { registerGsmRoutes } = require('../server/routes/gsm.js');

const DEFAULT_SCOPE = Object.freeze({ companyId: 'COMPANY-A', tenantId: 'COMPANY-A' });
const TEST_GSM_INGRESS_SECRET = 'stage6-device-secret';
const TEST_GSM_INGRESS_SECRET_HASH = hashGsmIngressSecret(TEST_GSM_INGRESS_SECRET, {
  salt: Buffer.alloc(16, 7),
});
const SCOPED_TEST_COLLECTIONS = new Set([
  'equipment',
  'rentals',
  'gantt_rentals',
  'clients',
  'gsm_devices',
  'gsm_packets',
  'gsm_commands',
]);

function inScope(record, scope) {
  return record?.companyId === scope?.companyId && record?.tenantId === scope?.tenantId;
}

function addScope(record, fallback = DEFAULT_SCOPE) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  return {
    ...record,
    companyId: record.companyId || fallback.companyId,
    tenantId: record.tenantId || fallback.tenantId,
  };
}

function provisionedDevice(equipmentId, {
  id = `GDEV-${equipmentId}`,
  imei = null,
  deviceId = null,
  trackerId = null,
  protocol = null,
  sim1 = null,
  status = 'unknown',
  scope = DEFAULT_SCOPE,
  bindingRevision = 1,
  bindingHistory = null,
  ingressSecretHash = TEST_GSM_INGRESS_SECRET_HASH,
  ingressMode = 'http_token',
} = {}) {
  const record = addScope({
    id,
    equipmentId,
    imei,
    deviceId,
    trackerId,
    protocol,
    sim1,
    status,
    bindingRevision,
    ingressSecretHash,
    ingressMode,
  }, scope);
  return {
    ...record,
    bindingHistory: bindingHistory || [{
      revision: bindingRevision,
      equipmentId,
      companyId: record.companyId,
      tenantId: record.tenantId,
      imei,
      deviceId: deviceId || trackerId,
      linkedAt: '2026-05-16T09:00:00.000Z',
      unlinkedAt: null,
      reason: 'test_fixture',
    }],
  };
}

function clearEquipmentGsmConfiguration(record) {
  const next = { ...record };
  for (const field of EQUIPMENT_GSM_CONFIGURATION_PROJECTION_FIELDS) next[field] = null;
  return next;
}

function rebindMemoryDevice(memory, deviceRecordId, equipmentId, at = '') {
  const current = memory.state.gsm_devices.find(device => device.id === deviceRecordId);
  const previousEquipmentId = current.equipmentId;
  const lifecycleTimes = (current.bindingHistory || [])
    .flatMap(entry => [entry.linkedAt, entry.unlinkedAt])
    .map(value => Date.parse(value || ''))
    .filter(Number.isFinite);
  const safeAt = at || new Date(Math.max(Date.now(), ...lifecycleTimes, 0) + 1).toISOString();
  const rebound = advanceGsmDeviceBindingLifecycle({
    ...current,
    equipmentId,
  }, { at: safeAt, reason: 'test_rebind' });
  memory.state.gsm_devices = memory.state.gsm_devices.map(device => (
    device.id === deviceRecordId ? rebound : device
  ));
  memory.state.equipment = memory.state.equipment.map((record) => {
    if (record.id === equipmentId) return applyEquipmentGsmConfigurationProjection(record, rebound);
    if (record.id === previousEquipmentId) return clearEquipmentGsmConfiguration(record);
    return record;
  });
  return rebound;
}

function createMemoryGateway(stateOverrides = {}, gatewayOptions = {}) {
  const state = {
    equipment: [],
    gsm_devices: [],
    gsm_packets: [],
    gsm_commands: [],
    ...stateOverrides,
  };

  for (const [name, value] of Object.entries(state)) {
    if (!SCOPED_TEST_COLLECTIONS.has(name) || !Array.isArray(value)) continue;
    state[name] = value.map(record => addScope(record));
  }
  state.equipment = state.equipment.map((equipment) => {
    const devices = state.gsm_devices.filter(device => (
      device.equipmentId === equipment.id && !['disabled', 'inactive', 'retired', 'revoked'].includes(device.status)
    ));
    if (devices.length !== 1) return equipment;
    return applyEquipmentGsmConfigurationProjection(equipment, devices[0]);
  });
  let activeScope = DEFAULT_SCOPE;
  const readData = (name) => {
    const value = state[name];
    if (!SCOPED_TEST_COLLECTIONS.has(name) || !Array.isArray(value)) return value ?? [];
    return value.filter(record => inScope(record, activeScope));
  };
  const writeData = (name, value) => {
    if (!SCOPED_TEST_COLLECTIONS.has(name) || !Array.isArray(value)) {
      state[name] = value;
      return;
    }
    const raw = Array.isArray(state[name]) ? state[name] : [];
    const outside = raw.filter(record => !inScope(record, activeScope));
    state[name] = [...outside, ...value.map(record => addScope(record, activeScope))];
  };
  const writeDataBatch = (entries) => {
    const before = new Map((entries || []).map(entry => [entry.name, structuredClone(state[entry.name])]));
    try {
      for (const entry of entries || []) writeData(entry.name, entry.value);
    } catch (error) {
      for (const [name, value] of before) state[name] = value;
      throw error;
    }
  };
  const withActorScope = (scope, operation) => {
    const previous = activeScope;
    activeScope = scope;
    try {
      return operation();
    } finally {
      activeScope = previous;
    }
  };
  const resolveTrustedDeviceScope = createTrustedGsmDeviceScopeResolver({
    readData: name => state[name] ?? [],
  });
  const assertGsmDeviceIdentityAvailable = createTrustedGsmDeviceProvisioningGuard({
    readData: name => state[name] ?? [],
  });

  const gateway = createGprsGateway({
    readData,
    writeData,
    writeDataBatch,
    resolveTrustedDeviceScope,
    withActorScope,
    getCurrentScope: () => activeScope,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    ...gatewayOptions,
  });

  return {
    gateway,
    state,
    readData,
    writeData,
    writeDataBatch,
    withActorScope,
    resolveTrustedDeviceScope,
    assertGsmDeviceIdentityAvailable,
    getCurrentScope: () => activeScope,
    setActiveScope: (scope) => {
      activeScope = scope;
    },
  };
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

function createGsmApiApp(stateOverrides = {}, routeOptions = {}) {
  const memory = createMemoryGateway({
    users: [
      { id: 'U-1', name: 'Admin', role: 'Администратор' },
      { id: 'U-2', name: 'Viewer', role: 'Менеджер по аренде' },
      { id: 'U-3', name: 'Investor', role: 'Инвестор' },
      { id: 'U-4', name: 'Office', role: 'Офис-менеджер' },
      { id: 'U-5', name: 'Mechanic', role: 'Механик' },
      { id: 'U-6', name: 'Sales', role: 'Менеджер по продажам' },
      { id: 'U-7', name: 'Foreman', role: 'Бригадир' },
    ],
    ...stateOverrides,
  });
  const { gateway, state, readData, writeDataBatch } = memory;
  const app = express();
  app.use(express.json({
    verify: (req, _res, buffer) => {
      req.rawBodyBytes = buffer.length;
    },
  }));
  const apiRouter = express.Router();

  function requireAuth(req, res, next) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = token === 'admin-token'
      ? state.users[0]
      : token === 'viewer-token'
        ? state.users[1]
        : token === 'investor-token'
          ? state.users[2]
          : token === 'office-token'
            ? state.users[3]
          : token === 'mechanic-token'
            ? state.users[4]
          : token === 'sales-token'
            ? state.users[5]
          : token === 'foreman-token'
            ? state.users[6]
          : null;
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = { userId: user.id, userName: user.name, userRole: user.role };
    return next();
  }

  function requireWrite(collection) {
    return (req, res, next) => {
      if (collection === 'gsm_devices' && req.user.userRole === 'Администратор') return next();
      if (collection === 'gsm_commands' && ['Администратор', 'Офис-менеджер'].includes(req.user.userRole)) return next();
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    };
  }

  function canReadCollection(req, collection) {
    const role = req.user?.userRole;
    if (role === 'Администратор') return true;
    if (role === 'Менеджер по аренде' || role === 'Офис-менеджер') {
      return ['equipment', 'rentals', 'gantt_rentals', 'clients', 'gsm_devices', 'gsm_packets'].includes(collection);
    }
    if (role === 'Механик') {
      return ['equipment', 'gsm_devices', 'gsm_packets'].includes(collection);
    }
    if (role === 'Менеджер по продажам') {
      return ['equipment', 'clients', 'gsm_devices', 'gsm_packets'].includes(collection);
    }
    if (role === 'Бригадир') {
      return ['equipment', 'gsm_devices', 'gsm_packets', 'gsm_commands'].includes(collection);
    }
    return false;
  }

  registerGsmRoutes(apiRouter, {
    requireAuth,
    requireWrite,
    canReadCollection,
    gprsGateway: gateway,
    readData,
    writeDataBatch,
    generateId: prefix => `${prefix}-test`,
    nowIso: () => '2026-05-16T10:00:00.000Z',
    assertGsmDeviceIdentityAvailable: memory.assertGsmDeviceIdentityAvailable,
    gsmIngestToken: 'gsm-test-secret',
    gsmMaxPacketAgeSeconds: 10 * 365 * 24 * 60 * 60,
    ...routeOptions,
  });
  app.use('/api', apiRouter);
  return { app, gateway, state, ...memory };
}

test('equipment GSM projection comparison is order-stable and bounded fail-closed', () => {
  const current = {
    gsmMovementHistory: [
      { at: '2026-08-26T10:00:00.000Z', lat: 55.75, lng: 37.61, meta: { source: 'gps', valid: true } },
      { at: '2026-08-26T10:01:00.000Z', lat: 55.76, lng: 37.62 },
    ],
  };
  assert.doesNotThrow(() => assertEquipmentGsmProjectionMutation({
    gsmMovementHistory: [
      { meta: { valid: true, source: 'gps' }, lng: 37.61, lat: 55.75, at: '2026-08-26T10:00:00.000Z' },
      { lng: 37.62, at: '2026-08-26T10:01:00.000Z', lat: 55.76 },
    ],
  }, { current }));

  const maxCanonicalHistory = Array.from({ length: 240 }, (_, index) => ({
    at: new Date(Date.UTC(2026, 7, 26, 10, index)).toISOString(),
    lat: 55.75 + index / 10000,
    lng: 37.61 + index / 10000,
    source: 'gps',
    address: `Москва ${String(index).padStart(3, '0')} ${'А'.repeat(500)}`,
  }));
  const reorderedMaxCanonicalHistory = maxCanonicalHistory.map(entry => ({
    address: entry.address,
    source: entry.source,
    lng: entry.lng,
    lat: entry.lat,
    at: entry.at,
  }));
  assert.doesNotThrow(() => assertEquipmentGsmProjectionMutation(
    { gsmMovementHistory: reorderedMaxCanonicalHistory },
    { current: { gsmMovementHistory: maxCanonicalHistory } },
  ));
  const changedMaxCanonicalHistory = structuredClone(reorderedMaxCanonicalHistory);
  changedMaxCanonicalHistory.at(-1).lat += 0.01;
  assert.throws(
    () => assertEquipmentGsmProjectionMutation(
      { gsmMovementHistory: changedMaxCanonicalHistory },
      { current: { gsmMovementHistory: maxCanonicalHistory } },
    ),
    error => error?.code === 'GSM_EQUIPMENT_PROJECTION_WRITE_DENIED',
  );

  const assertDenied = (value) => assert.throws(
    () => assertEquipmentGsmProjectionMutation({ gsmMovementHistory: value }, { current }),
    error => error?.code === 'GSM_EQUIPMENT_PROJECTION_WRITE_DENIED'
      && error?.details?.changedFields?.includes('gsmMovementHistory'),
  );
  assertDenied([...current.gsmMovementHistory].reverse());
  assertDenied([{ ...current.gsmMovementHistory[0], lat: 55.77 }, current.gsmMovementHistory[1]]);

  let deepCurrent = { value: 'same' };
  let deepIncoming = { value: 'same' };
  for (let index = 0; index < 18; index += 1) {
    deepCurrent = { child: deepCurrent };
    deepIncoming = { child: deepIncoming };
  }
  assert.throws(
    () => assertEquipmentGsmProjectionMutation(
      { gsmMovementHistory: deepIncoming },
      { current: { gsmMovementHistory: deepCurrent } },
    ),
    error => error?.code === 'GSM_EQUIPMENT_PROJECTION_WRITE_DENIED',
  );

  const cyclicCurrent = [];
  const cyclicIncoming = [];
  cyclicCurrent.push(cyclicCurrent);
  cyclicIncoming.push(cyclicIncoming);
  assert.throws(
    () => assertEquipmentGsmProjectionMutation(
      { gsmMovementHistory: cyclicIncoming },
      { current: { gsmMovementHistory: cyclicCurrent } },
    ),
    error => error?.code === 'GSM_EQUIPMENT_PROJECTION_WRITE_DENIED',
  );

  let getterExecuted = false;
  const accessorValue = {};
  Object.defineProperty(accessorValue, 'lat', {
    enumerable: true,
    get() {
      getterExecuted = true;
      return 55.75;
    },
  });
  assert.throws(
    () => assertEquipmentGsmProjectionMutation(
      { gsmMovementHistory: [accessorValue] },
      { current: { gsmMovementHistory: [{ lat: 55.75 }] } },
    ),
    error => error?.code === 'GSM_EQUIPMENT_PROJECTION_WRITE_DENIED',
  );
  assert.equal(getterExecuted, false);

  const oversizedLeft = Object.fromEntries(Array.from(
    { length: 1025 },
    (_, index) => [`key${String(index).padStart(4, '0')}`, index],
  ));
  const oversizedRight = { ...oversizedLeft };
  const originalSort = Array.prototype.sort;
  let oversizedSortCalls = 0;
  Array.prototype.sort = function instrumentedSort(...args) {
    if (this.length > 1024) oversizedSortCalls += 1;
    return originalSort.apply(this, args);
  };
  try {
    assert.throws(
      () => assertEquipmentGsmProjectionMutation(
        { gsmMovementHistory: oversizedLeft },
        { current: { gsmMovementHistory: oversizedRight } },
      ),
      error => error?.code === 'GSM_EQUIPMENT_PROJECTION_WRITE_DENIED',
    );
  } finally {
    Array.prototype.sort = originalSort;
  }
  assert.equal(oversizedSortCalls, 0);
});

test('WIALON IPS parser handles login packet', () => {
  const parsed = parseWialonIpsPacket('#L#869132070808689;secret');

  assert.equal(parsed.parseStatus, 'parsed');
  assert.equal(parsed.packetType, 'login');
  assert.equal(parsed.imei, '869132070808689');
  assert.equal(parsed.ack.toString(), '#AL#1\r\n');
});

test('GSM binding lifecycle rejects cross-revision time travel and overlap', () => {
  const device = provisionedDevice('EQ-TIME-TRAVEL', {
    id: 'GDEV-TIME-TRAVEL',
    imei: '860000000000099',
    bindingRevision: 2,
    bindingHistory: [
      {
        revision: 1,
        equipmentId: 'EQ-TIME-TRAVEL',
        ...DEFAULT_SCOPE,
        imei: '860000000000098',
        deviceId: null,
        linkedAt: '2026-05-10T00:00:00.000Z',
        unlinkedAt: '2026-05-20T00:00:00.000Z',
      },
      {
        revision: 2,
        equipmentId: 'EQ-TIME-TRAVEL',
        ...DEFAULT_SCOPE,
        imei: '860000000000099',
        deviceId: null,
        linkedAt: '2026-05-01T00:00:00.000Z',
        unlinkedAt: null,
      },
    ],
  });

  assert.equal(gsmDeviceBindingLifecycleIssue(device), 'binding_history_invalid');
});

test('GSM binding lifecycle allows only bounded future clock skew and quarantines farther timestamps', () => {
  const observedAtMs = Date.parse('2026-05-16T10:00:00.000Z');
  const withinTolerance = provisionedDevice('EQ-BINDING-SKEW-OK', {
    id: 'GDEV-BINDING-SKEW-OK',
    deviceId: 'DEVICE-BINDING-SKEW-OK',
  });
  withinTolerance.bindingHistory[0].linkedAt = new Date(
    observedAtMs + GSM_BINDING_FUTURE_SKEW_MS,
  ).toISOString();
  const withinEquipment = applyEquipmentGsmConfigurationProjection(addScope({
    id: withinTolerance.equipmentId,
  }), withinTolerance);

  assert.equal(gsmDeviceBindingLifecycleIssue(withinTolerance, { nowMs: observedAtMs }), null);
  assert.equal(gsmCurrentDeviceBindingIssue(withinTolerance, {
    devices: [withinTolerance],
    equipment: [withinEquipment],
    nowMs: observedAtMs,
  }), null);

  const outsideTolerance = structuredClone(withinTolerance);
  outsideTolerance.id = 'GDEV-BINDING-SKEW-FUTURE';
  outsideTolerance.equipmentId = 'EQ-BINDING-SKEW-FUTURE';
  outsideTolerance.bindingHistory[0].equipmentId = outsideTolerance.equipmentId;
  outsideTolerance.bindingHistory[0].linkedAt = new Date(
    observedAtMs + GSM_BINDING_FUTURE_SKEW_MS + 1,
  ).toISOString();
  const outsideEquipment = applyEquipmentGsmConfigurationProjection(addScope({
    id: outsideTolerance.equipmentId,
  }), outsideTolerance);

  assert.equal(
    gsmDeviceBindingLifecycleIssue(outsideTolerance, { nowMs: observedAtMs }),
    'binding_timestamp_in_future',
  );
  assert.equal(gsmCurrentDeviceBindingIssue(outsideTolerance, {
    devices: [outsideTolerance],
    equipment: [outsideEquipment],
    nowMs: observedAtMs,
  }), 'binding_timestamp_in_future');
});

test('GSM binding lifecycle rejects unprovenanced aliases while preserving a bounded tracker alias', () => {
  const canonical = provisionedDevice('EQ-BINDING-ALIAS', {
    id: 'GDEV-BINDING-ALIAS',
    imei: '860000000000777',
    deviceId: 'DEVICE-BINDING-ALIAS',
    trackerId: 'TRACKER-LEGITIMATE-ALIAS',
    bindingHistory: [{
      revision: 1,
      equipmentId: 'EQ-BINDING-ALIAS',
      ...DEFAULT_SCOPE,
      imei: '860000000000777',
      deviceId: 'DEVICE-BINDING-ALIAS',
      trackerId: 'TRACKER-LEGITIMATE-ALIAS',
      identities: [
        '860000000000777',
        'DEVICE-BINDING-ALIAS',
        'TRACKER-LEGITIMATE-ALIAS',
      ],
      linkedAt: '2026-05-16T09:00:00.000Z',
      unlinkedAt: null,
    }],
  });
  assert.equal(gsmDeviceBindingLifecycleIssue(canonical), null);
  const canonicalGateway = createMemoryGateway({
    equipment: [{ id: canonical.equipmentId }],
    gsm_devices: [canonical],
  }).gateway;
  assert.equal(canonicalGateway.listDevices()[0].trackerId, 'TRACKER-LEGITIMATE-ALIAS');

  const injected = structuredClone(canonical);
  injected.bindingHistory[0].identities.push('password=HISTORYSECRET');
  assert.equal(gsmDeviceBindingLifecycleIssue(injected), 'binding_identity_invalid');
  const quarantinedGateway = createMemoryGateway({
    equipment: [{ id: injected.equipmentId }],
    gsm_devices: [injected],
  }).gateway;
  assert.deepEqual(quarantinedGateway.listDevices(), []);

  const duplicated = structuredClone(canonical);
  duplicated.bindingHistory[0].identities.push('TRACKER-LEGITIMATE-ALIAS');
  assert.equal(gsmDeviceBindingLifecycleIssue(duplicated), 'binding_identity_invalid');
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

test('TCP gateway accepts telemetry only from a provisioned linked device', async () => {
  const { gateway, state } = createMemoryGateway({
    equipment: [{ id: 'EQ-TCP', gsmImei: '866123456789012' }],
    gsm_devices: [provisionedDevice('EQ-TCP', {
      imei: '866123456789012',
      protocol: 'GPRS TCP',
      ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
    })],
  }, { host: '127.0.0.1', port: 0 });
  const server = await gateway.start();
  const { port } = server.address();

  const socket = net.createConnection({ host: '127.0.0.1', port });
  await once(socket, 'connect');
  const raw = Buffer.from(`IMEI:866123456789012 ingressSecret=${TEST_GSM_INGRESS_SECRET} LAT:55.796 LNG:49.108`);
  socket.write(raw);
  await waitFor(() => state.gsm_packets.length === 1);
  socket.destroy();
  await gateway.stop();

  assert.equal(state.gsm_packets[0].sourceIp, '127.0.0.1');
  assert.doesNotMatch(state.gsm_packets[0].rawText, new RegExp(TEST_GSM_INGRESS_SECRET, 'i'));
  assert.doesNotMatch(
    state.gsm_packets[0].rawHex.toLowerCase(),
    new RegExp(Buffer.from(TEST_GSM_INGRESS_SECRET).toString('hex').toLowerCase()),
  );
  assert.match(state.gsm_packets[0].rawText, /REDACTED/);
  assert.equal(state.gsm_packets[0].parseStatus, 'parsed');
  assert.equal(state.gsm_packets[0].equipmentId, 'EQ-TCP');
});

test('public GPRS TCP rejects missing and wrong per-device credentials before persistence', async () => {
  const { gateway, state } = createMemoryGateway({
    equipment: [{ id: 'EQ-TCP-AUTH' }],
    gsm_devices: [provisionedDevice('EQ-TCP-AUTH', {
      imei: '866123456789099',
      protocol: 'GPRS TCP',
      ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
    })],
  }, { host: '127.0.0.1', port: 0 });
  const server = await gateway.start();
  const { port } = server.address();

  async function sendRejected(payload) {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.on('error', () => {});
    await once(socket, 'connect');
    socket.write(payload);
    await once(socket, 'close');
  }

  try {
    await sendRejected('IMEI:866123456789099 LAT:55.7 LNG:49.1');
    await sendRejected('IMEI:866123456789099 ingressSecret=definitely-wrong LAT:55.7 LNG:49.1');
    assert.equal(state.gsm_packets.length, 0);
    assert.equal(state.gsm_devices[0].lastPacketAt, undefined);
  } finally {
    await gateway.stop();
  }
});

test('GPRS credential rotation invalidates an already authenticated TCP session', () => {
  const memory = createMemoryGateway({
    equipment: [{ id: 'EQ-TCP-ROTATE' }],
    gsm_devices: [provisionedDevice('EQ-TCP-ROTATE', {
      imei: '866123456789098',
      protocol: 'GPRS TCP',
      ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
    })],
  });
  const connection = {
    id: 'GCONN-ROTATE',
    sourceIp: '127.0.0.1',
    socket: { destroyed: false },
  };
  memory.gateway.processRawPacket(Buffer.from(
    `IMEI:866123456789098 ingressSecret=${TEST_GSM_INGRESS_SECRET} LAT:55.7 LNG:49.1`,
  ), { connection });
  assert.equal(connection.gsmAuthenticatedAt !== undefined, true);
  assert.equal(
    connection.gsmIngressCredentialFingerprint,
    fingerprintGsmIngressCredentialHash(TEST_GSM_INGRESS_SECRET_HASH),
  );
  const packetCount = memory.state.gsm_packets.length;
  memory.state.gsm_devices = memory.state.gsm_devices.map(device => (
    device.id === 'GDEV-EQ-TCP-ROTATE'
      ? { ...device, ingressSecretHash: hashGsmIngressSecret('rotated-device-secret') }
      : device
  ));

  assert.throws(
    () => memory.gateway.processRawPacket(
      Buffer.from('IMEI:866123456789098 LAT:55.8 LNG:49.2'),
      { connection },
    ),
    error => error.code === 'GSM_DEVICE_CREDENTIAL_CHANGED' && error.status === 409,
  );
  assert.equal(memory.state.gsm_packets.length, packetCount);
});

test('packet without a provisioned device identifier is rejected before persistence', () => {
  const { gateway, state } = createMemoryGateway();

  assert.throws(() => gateway.processRawPacket(Buffer.from('HELLO TRACKER'), {
    sourceIp: '10.0.0.10',
    remotePort: 12000,
  }), error => error.code === 'GSM_DEVICE_IDENTIFIER_REQUIRED');
  assert.equal(state.gsm_packets.length, 0);
  assert.equal(state.gsm_devices.length, 0);
});

test('parser error on an already identified provisioned connection is stored in tenant scope', () => {
  const { gateway, state } = createMemoryGateway({
    equipment: [{ id: 'EQ-PARSER', gsmImei: '866123456789012' }],
    gsm_devices: [provisionedDevice('EQ-PARSER', { imei: '866123456789012', deviceId: '866123456789012' })],
  }, {
    parsePacket: () => {
      throw new Error('boom');
    },
  });

  const packet = gateway.processRawPacket(Buffer.from('IMEI:866123456789012'), {
    sourceIp: '10.0.0.11',
    connection: { imei: '866123456789012', deviceId: '866123456789012' },
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
    gsm_devices: [provisionedDevice('EQ-1', { imei: '866123456789012' })],
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
  assert.deepEqual(
    Object.fromEntries(EQUIPMENT_GSM_CONFIGURATION_PROJECTION_FIELDS.map(field => [field, state.equipment[0][field] ?? null])),
    canonicalEquipmentGsmConfigurationProjection(state.gsm_devices[0]),
  );
});

test('packet with deviceId links to equipment by stable gsmDeviceId and updates GSM state', () => {
  const { gateway, state } = createMemoryGateway({
    equipment: [
      { id: 'EQ-DEVICE', manufacturer: 'Mantall', model: 'XE80', inventoryNumber: '045', gsmDeviceId: 'TRACKER-E2E' },
    ],
    gsm_devices: [provisionedDevice('EQ-DEVICE', { deviceId: 'TRACKER-E2E' })],
  });

  const packet = gateway.processRawPacket(Buffer.from('deviceId:TRACKER-E2E LAT:55.797 LNG:49.109 SPEED:2'), {
    sourceIp: '10.0.0.12',
  });

  assert.equal(packet.equipmentId, 'EQ-DEVICE');
  assert.equal(packet.deviceId, 'TRACKER-E2E');
  assert.equal(state.equipment[0].gsmLastLat, 55.797);
  assert.equal(state.equipment[0].gsmLastLng, 49.109);
  assert.equal(state.equipment[0].gsmStatus, 'online');
});

test('packet from Mantall tracker links by gsmDeviceId before IMEI', () => {
  const { gateway, state } = createMemoryGateway({
    equipment: [
      {
        id: 'EQ-MANTALL-001',
        manufacturer: 'Mantall ',
        model: 'XE160WCT ',
        serialNumber: '03311273',
        inventoryNumber: '001',
        status: 'available',
        gsmImei: '866854051837469',
        gsmDeviceId: '990999260517062',
      },
    ],
    gsm_devices: [provisionedDevice('EQ-MANTALL-001', {
      imei: '866854051837469',
      deviceId: '990999260517062',
    })],
  });

  const packet = gateway.processRawPacket(Buffer.from('deviceId:990999260517062 LAT:0.223456 LNG:0.754321 SPEED:0 VOLTAGE:11.9'), {
    sourceIp: '10.0.0.12',
  });

  assert.equal(packet.equipmentId, 'EQ-MANTALL-001');
  assert.equal(packet.equipmentLabel, 'Mantall XE160WCT · INV 001 · SN 03311273');
  assert.equal(packet.equipmentModel, 'XE160WCT');
  assert.equal(packet.equipmentInventoryNumber, '001');
  assert.equal(packet.equipmentSerialNumber, '03311273');
  assert.equal(state.gsm_packets[0].equipmentId, 'EQ-MANTALL-001');
  assert.equal(state.gsm_devices[0].equipmentId, 'EQ-MANTALL-001');
  assert.equal(state.equipment[0].gsmLastVoltage, 11.9);
  assert.equal(state.equipment[0].gsmLastSpeed, 0);
  assert.equal(state.equipment[0].gsmLastLat, 0.223456);
  assert.equal(state.equipment[0].gsmLastLng, 0.754321);
});

test('GSM identity matching is exact and preserves leading zeros', () => {
  const { gateway, state } = createMemoryGateway({
    equipment: [
      { id: 'EQ-IMEI', manufacturer: 'Mantall', model: 'XE80', inventoryNumber: '046', gsmImei: '00866123456789012' },
      { id: 'EQ-DEVICE', manufacturer: 'Mantall', model: 'XE80', inventoryNumber: '047', gsmDeviceId: 'TrackerAbC007' },
    ],
    gsm_devices: [
      provisionedDevice('EQ-IMEI', { imei: '00866123456789012' }),
      provisionedDevice('EQ-DEVICE', { deviceId: 'TrackerAbC007' }),
    ],
  });

  const imeiPacket = gateway.processRawPacket(Buffer.from('IMEI:00866123456789012 LAT:55.796 LNG:49.108'), {
    sourceIp: '10.0.0.12',
  });
  assert.throws(() => gateway.processRawPacket(Buffer.from('deviceId:trackerabc007 LAT:55.797 LNG:49.109'), {
    sourceIp: '10.0.0.13',
  }), error => error.code === 'GSM_DEVICE_NOT_PROVISIONED');
  const devicePacket = gateway.processRawPacket(Buffer.from('deviceId:TrackerAbC007 LAT:55.797 LNG:49.109'), {
    sourceIp: '10.0.0.13',
  });

  assert.equal(imeiPacket.equipmentId, 'EQ-IMEI');
  assert.equal(imeiPacket.imei, '00866123456789012');
  assert.equal(devicePacket.equipmentId, 'EQ-DEVICE');
  assert.equal(state.equipment[0].gsmImei, '00866123456789012');
  assert.equal(state.equipment[0].gsmLastLat, 55.796);
  assert.equal(state.equipment[1].gsmLastLat, 55.797);
});

test('packet persistence preserves an exact secret-looking canonical device identity', () => {
  const canonicalDeviceId = 'token:canonical-device-identity';
  const canonicalEquipmentId = 'token:canonical-equipment-identity';
  const rawSecret = 'packet-raw-password-secret';
  const { gateway, state } = createMemoryGateway({
    equipment: [{ id: canonicalEquipmentId }],
    gsm_devices: [provisionedDevice(canonicalEquipmentId, {
      deviceId: canonicalDeviceId,
    })],
  });

  const packet = gateway.processRawPacket(Buffer.from(
    `deviceId:${canonicalDeviceId} LAT:55.797 LNG:49.109 password="${rawSecret}"`,
  ));

  assert.equal(packet.deviceId, canonicalDeviceId);
  assert.equal(packet.trackerId, canonicalDeviceId);
  assert.equal(state.gsm_packets[0].deviceId, canonicalDeviceId);
  assert.equal(state.gsm_packets[0].trackerId, canonicalDeviceId);
  assert.doesNotMatch(JSON.stringify(state.gsm_packets[0]), new RegExp(rawSecret));
  assert.doesNotMatch(
    JSON.stringify(state.gsm_packets[0]).toLowerCase(),
    new RegExp(Buffer.from(rawSecret).toString('hex').toLowerCase()),
  );

  assert.equal(gateway.listDevices()[0].deviceId, canonicalDeviceId);
  assert.equal(gateway.listPackets({ deviceId: canonicalDeviceId })[0].deviceId, canonicalDeviceId);
  gateway.createCommand({
    equipmentId: canonicalEquipmentId,
    deviceId: canonicalDeviceId,
    command: 'PING',
  });
  assert.equal(gateway.listCommands({ deviceId: canonicalDeviceId })[0].deviceId, canonicalDeviceId);
  assert.equal(gateway.getAnalytics({ equipmentId: canonicalEquipmentId }).selected.equipmentId, canonicalEquipmentId);
});

test('stored GSM packet and command identities must match their exact historical binding', () => {
  const device = provisionedDevice('EQ-STORED-IDENTITY-PROOF', {
    id: 'GDEV-STORED-IDENTITY-PROOF',
    imei: '860000000000778',
    deviceId: 'DEVICE-STORED-IDENTITY-PROOF',
  });
  const binding = {
    equipmentId: device.equipmentId,
    gsmDeviceRecordId: device.id,
    gsmBindingRevision: device.bindingRevision,
  };
  const packetSecret = 'FORGED-PACKET-IDENTITY';
  const commandSecret = 'FORGED-COMMAND-IDENTITY';
  const { gateway } = createMemoryGateway({
    equipment: [{ id: device.equipmentId }],
    gsm_devices: [device],
    gsm_packets: [{
      id: 'GPKT-FORGED-STORED-IDENTITY',
      ...binding,
      direction: 'inbound',
      deviceId: `token:${packetSecret}`,
      imei: `password:${packetSecret}`,
      parseStatus: 'failed',
      receivedAt: '2026-05-16T10:00:00.000Z',
    }],
    gsm_commands: [{
      id: 'GCMD-FORGED-STORED-IDENTITY',
      ...binding,
      deviceId: `token:${commandSecret}`,
      imei: `password:${commandSecret}`,
      command: 'PING',
      status: 'queued',
      createdAt: '2026-05-16T10:00:00.000Z',
    }],
  });

  const packets = gateway.listPackets();
  const diagnostics = gateway.getDiagnostics();
  const serialized = JSON.stringify({ packets, diagnostics });
  assert.equal(packets.length, 1);
  assert.deepEqual(gateway.listCommands(), []);
  assert.equal(diagnostics.totals.quarantinedCommands, 1);
  assert.doesNotMatch(serialized, new RegExp(packetSecret));
  assert.doesNotMatch(serialized, new RegExp(commandSecret));
  assert.match(serialized, /REDACTED/);
});

test('rotated GSM identities stay reserved across tenants and cannot authorize delayed telemetry', () => {
  const scopeA = { companyId: 'COMPANY-A', tenantId: 'COMPANY-A' };
  const scopeB = { companyId: 'COMPANY-B', tenantId: 'COMPANY-B' };
  const original = provisionedDevice('EQ-ROTATED-A', {
    id: 'GDEV-ROTATED-A', deviceId: 'DEVICE-OLD', scope: scopeA,
  });
  const rotated = advanceGsmDeviceBindingLifecycle({
    ...original,
    deviceId: 'DEVICE-NEW',
  }, { at: '2026-05-16T10:00:00.000Z', reason: 'test_identity_rotation' });
  const conflicting = provisionedDevice('EQ-ROTATED-B', {
    id: 'GDEV-ROTATED-B', deviceId: 'DEVICE-OLD', scope: scopeB,
  });
  const memory = createMemoryGateway({
    equipment: [
      { id: 'EQ-ROTATED-A', ...scopeA },
      { id: 'EQ-ROTATED-B', ...scopeB },
    ],
    gsm_devices: [rotated, conflicting],
  });
  memory.setActiveScope(scopeB);
  const before = structuredClone(memory.state);

  assert.throws(
    () => memory.assertGsmDeviceIdentityAvailable({
      deviceId: 'DEVICE-OLD',
      currentDeviceRecordId: 'GDEV-PROSPECTIVE-B',
    }),
    error => error.code === 'GSM_DEVICE_IDENTITY_CONFLICT',
  );
  assert.throws(
    () => memory.gateway.processRawPacket(Buffer.from('deviceId:DEVICE-OLD LAT:55.1 LNG:49.1')),
    error => error.code === 'GSM_DEVICE_PARENT_INVALID',
  );
  assert.deepEqual(memory.state, before);
});

test('ambiguous provisioned GSM identity is rejected before any write', () => {
  const { gateway, state } = createMemoryGateway({
    equipment: [
      { id: 'EQ-1', model: 'Mantall XE80', gsmDeviceId: 'DUPLICATE-TRACKER' },
      { id: 'EQ-2', model: 'Mantall XE100', gsmDeviceId: 'DUPLICATE-TRACKER' },
    ],
    gsm_devices: [
      provisionedDevice('EQ-1', { id: 'GDEV-DUPLICATE-1', deviceId: 'DUPLICATE-TRACKER' }),
      provisionedDevice('EQ-2', { id: 'GDEV-DUPLICATE-2', deviceId: 'DUPLICATE-TRACKER' }),
    ],
  });

  assert.throws(() => gateway.processRawPacket(Buffer.from('deviceId:DUPLICATE-TRACKER LAT:55.796 LNG:49.108'), {
    sourceIp: '10.0.0.12',
  }), error => error.code === 'GSM_DEVICE_IDENTITY_AMBIGUOUS');
  assert.equal(state.gsm_packets.length, 0);
});

test('unknown IMEI is rejected without packet, device, or equipment mutation', () => {
  const { gateway, state } = createMemoryGateway({
    equipment: [
      { id: 'EQ-1', manufacturer: 'Mantall', model: 'XE80', inventoryNumber: '044', gsmImei: '866123456789012' },
    ],
  });

  const before = structuredClone(state);
  assert.throws(() => gateway.processRawPacket(Buffer.from('IMEI:866000000000000 LAT:55.796 LNG:49.108'), {
    sourceIp: '10.0.0.13',
  }), error => error.code === 'GSM_DEVICE_NOT_PROVISIONED');
  assert.deepEqual(state, before);
});

test('GSM device linked across tenant scopes is rejected before any write', () => {
  const { gateway, state } = createMemoryGateway({
    equipment: [{
      id: 'EQ-SCOPE-A',
      companyId: 'COMPANY-A',
      tenantId: 'COMPANY-A',
    }],
    gsm_devices: [{
      id: 'GDEV-SCOPE-B',
      deviceId: 'SCOPE-MISMATCH',
      equipmentId: 'EQ-SCOPE-A',
      companyId: 'COMPANY-B',
      tenantId: 'COMPANY-B',
    }],
  });
  const before = structuredClone(state);

  assert.throws(() => gateway.processRawPacket(
    Buffer.from('deviceId:SCOPE-MISMATCH LAT:55.796 LNG:49.108'),
    { sourceIp: '10.0.0.14' },
  ), error => error.code === 'GSM_DEVICE_SCOPE_MISMATCH');
  assert.deepEqual(state, before);
});

test('GPRS ingress rejects a device relink race before telemetry persistence', () => {
  let memory;
  memory = createMemoryGateway({
    equipment: [
      { id: 'EQ-RACE-OLD', gsmDeviceId: 'RACE-DEVICE' },
      { id: 'EQ-RACE-NEW' },
    ],
    gsm_devices: [{
      id: 'GDEV-RACE',
      deviceId: 'RACE-DEVICE',
      equipmentId: 'EQ-RACE-OLD',
    }],
  }, {
    withActorScope: (scope, operation) => {
      memory.state.gsm_devices = memory.state.gsm_devices.map(device => (
        device.id === 'GDEV-RACE'
          ? { ...device, equipmentId: 'EQ-RACE-NEW' }
          : device
      ));
      return memory.withActorScope(scope, operation);
    },
  });

  assert.throws(
    () => memory.gateway.processRawPacket(
      Buffer.from('deviceId:RACE-DEVICE LAT:55.796 LNG:49.108'),
      { sourceIp: '10.0.0.15' },
    ),
    error => error.code === 'GSM_DEVICE_BINDING_CHANGED' && error.status === 409,
  );
  assert.equal(memory.state.gsm_devices[0].equipmentId, 'EQ-RACE-NEW');
  assert.equal(memory.state.gsm_devices[0].lastPacketAt, undefined);
  assert.equal(memory.state.gsm_packets.length, 0);
  assert.equal(memory.state.equipment.some(item => item.gsmLastSeenAt), false);
});

test('GPRS connection must reconnect after its provisioned device is rebound', () => {
  const memory = createMemoryGateway({
    equipment: [
      { id: 'EQ-CONNECTION-OLD', gsmDeviceId: 'CONNECTION-DEVICE' },
      { id: 'EQ-CONNECTION-NEW' },
    ],
    gsm_devices: [{
      id: 'GDEV-CONNECTION',
      deviceId: 'CONNECTION-DEVICE',
      equipmentId: 'EQ-CONNECTION-OLD',
    }],
  });
  const connection = { id: 'CONNECTION-1' };
  memory.gateway.processRawPacket(
    Buffer.from('deviceId:CONNECTION-DEVICE LAT:55.1 LNG:49.1'),
    { connection },
  );
  rebindMemoryDevice(memory, 'GDEV-CONNECTION', 'EQ-CONNECTION-NEW');
  const packetCount = memory.state.gsm_packets.length;

  assert.throws(
    () => memory.gateway.processRawPacket(
      Buffer.from('deviceId:CONNECTION-DEVICE LAT:55.2 LNG:49.2'),
      { connection },
    ),
    error => error.code === 'GSM_CONNECTION_BINDING_CHANGED' && error.status === 409,
  );
  assert.equal(memory.state.gsm_packets.length, packetCount);
});

test('GSM packets, devices, status, and runtime connections are isolated by tenant', async () => {
  const scopeA = { companyId: 'COMPANY-A', tenantId: 'COMPANY-A' };
  const scopeB = { companyId: 'COMPANY-B', tenantId: 'COMPANY-B' };
  const memory = createMemoryGateway({
    equipment: [
      { id: 'EQ-A', gsmDeviceId: 'DEVICE-A', ...scopeA },
      { id: 'EQ-B', gsmDeviceId: 'DEVICE-B', ...scopeB },
    ],
    gsm_devices: [
      provisionedDevice('EQ-A', {
        deviceId: 'DEVICE-A', scope: scopeA, protocol: 'GPRS TCP', ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
      }),
      provisionedDevice('EQ-B', {
        deviceId: 'DEVICE-B', scope: scopeB, protocol: 'GPRS TCP', ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
      }),
    ],
  }, { host: '127.0.0.1', port: 0 });
  const { gateway, state, setActiveScope } = memory;

  gateway.processRawPacket(Buffer.from('deviceId:DEVICE-A LAT:55.1 LNG:49.1'));
  setActiveScope(scopeB);
  gateway.processRawPacket(Buffer.from('deviceId:DEVICE-B LAT:56.1 LNG:50.1'));

  setActiveScope(scopeA);
  assert.deepEqual(gateway.listPackets({ limit: 10 }).map(item => item.equipmentId), ['EQ-A']);
  assert.deepEqual(gateway.listDevices().map(item => item.equipmentId), ['EQ-A']);
  assert.equal(gateway.getStatus().packetsReceivedTotal, 1);

  const server = await gateway.start();
  const socket = net.createConnection({ host: '127.0.0.1', port: server.address().port });
  await once(socket, 'connect');
  socket.write(`deviceId:DEVICE-A ingressSecret=${TEST_GSM_INGRESS_SECRET} LAT:55.2 LNG:49.2`);
  await waitFor(() => state.gsm_packets.filter(item => item.equipmentId === 'EQ-A').length === 2);
  assert.equal(gateway.listConnections().length, 1);

  setActiveScope(scopeB);
  assert.deepEqual(gateway.listPackets({ limit: 10 }).map(item => item.equipmentId), ['EQ-B']);
  assert.deepEqual(gateway.listDevices().map(item => item.equipmentId), ['EQ-B']);
  assert.equal(gateway.getStatus().packetsReceivedTotal, 1);
  assert.equal(gateway.listConnections().length, 0);

  socket.destroy();
  await gateway.stop();
});

test('persisted online status ages to offline without fresh telemetry', () => {
  const staleAt = '2020-01-01T00:00:00.000Z';
  const device = {
    ...provisionedDevice('EQ-STALE-ONLINE', { deviceId: 'DEVICE-STALE' }),
    status: 'online',
    lastPacketAt: staleAt,
    lastOnlineAt: staleAt,
  };
  const { gateway } = createMemoryGateway({
    equipment: [{
      id: 'EQ-STALE-ONLINE',
      gsmStatus: 'online',
      gsmSignalStatus: 'online',
      gsmLastSeenAt: staleAt,
    }],
    gsm_devices: [device],
  });

  assert.equal(gateway.listDevices()[0].status, 'offline');
  assert.equal(gateway.getAnalytics({}).onlineTrackedEquipment, 0);
});

test('future persisted GSM timestamps never report a device online', () => {
  const futureAt = new Date(Date.now() + 60_000).toISOString();
  const device = {
    ...provisionedDevice('EQ-FUTURE-ONLINE', { deviceId: 'DEVICE-FUTURE' }),
    status: 'online',
    lastPacketAt: futureAt,
    lastOnlineAt: futureAt,
  };
  const { gateway } = createMemoryGateway({
    equipment: [{
      id: 'EQ-FUTURE-ONLINE',
      gsmStatus: 'online',
      gsmSignalStatus: 'online',
      gsmLastSeenAt: futureAt,
    }],
    gsm_devices: [device],
  });

  assert.equal(gateway.listDevices()[0].status, 'offline');
  assert.equal(gateway.getAnalytics({}).onlineTrackedEquipment, 0);
});

test('duplicate packet inside GSM_DEDUPE_WINDOW_MS does not update equipment state again', () => {
  const { gateway, state } = createMemoryGateway({
    equipment: [
      { id: 'EQ-1', manufacturer: 'Mantall', model: 'XE80', inventoryNumber: '044', gsmImei: '866123456789012' },
    ],
    gsm_devices: [provisionedDevice('EQ-1', { imei: '866123456789012' })],
  }, { dedupeWindowMs: 60_000 });
  const raw = Buffer.from('IMEI:866123456789012 TIME:2026-05-16T10:00:00.000Z LAT:55.796 LNG:49.108 SPEED:0');

  const first = gateway.processRawPacket(raw, { sourceIp: '10.0.0.14' });
  state.equipment[0].gsmLastSeenAt = 'sentinel-last-seen';
  state.equipment[0].gsmStatus = 'sentinel-status';
  const duplicate = gateway.processRawPacket(raw, { sourceIp: '10.0.0.14' });

  assert.equal(first.duplicate, undefined);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.duplicateOf, first.id);
  assert.equal(state.gsm_packets.length, 1);
  assert.equal(state.equipment[0].gsmLastSeenAt, 'sentinel-last-seen');
  assert.equal(state.equipment[0].gsmStatus, 'sentinel-status');
});

test('packet deduplication is scoped to the stable binding revision', () => {
  const memory = createMemoryGateway({
    equipment: [{ id: 'EQ-DEDUPE-OLD' }, { id: 'EQ-DEDUPE-NEW' }],
    gsm_devices: [provisionedDevice('EQ-DEDUPE-OLD', {
      id: 'GDEV-DEDUPE', deviceId: 'DEVICE-DEDUPE',
    })],
  });
  const raw = Buffer.from('deviceId:DEVICE-DEDUPE LAT:55.1 LNG:49.1');

  const first = memory.gateway.processRawPacket(raw);
  rebindMemoryDevice(memory, 'GDEV-DEDUPE', 'EQ-DEDUPE-NEW');
  const second = memory.gateway.processRawPacket(raw);

  assert.equal(first.duplicate, undefined);
  assert.equal(second.duplicate, undefined);
  assert.equal(memory.state.gsm_packets.length, 2);
  assert.deepEqual(
    memory.state.gsm_packets.map(item => [item.equipmentId, item.gsmBindingRevision]),
    [['EQ-DEDUPE-NEW', 2], ['EQ-DEDUPE-OLD', 1]],
  );
});

test('invalid coordinates on linked raw packet are stored as failed packet and do not update equipment', () => {
  const { gateway, state } = createMemoryGateway({
    equipment: [
      { id: 'EQ-1', manufacturer: 'Mantall', model: 'XE80', inventoryNumber: '044', gsmImei: '866123456789012' },
    ],
    gsm_devices: [provisionedDevice('EQ-1', { imei: '866123456789012' })],
  });

  const packet = gateway.processRawPacket(Buffer.from('IMEI:866123456789012 LAT:120 LNG:49.108'), {
    sourceIp: '10.0.0.15',
  });

  assert.equal(packet.parseStatus, 'failed');
  assert.equal(packet.equipmentId, 'EQ-1');
  assert.match(packet.parseError, /latitude_out_of_range/);
  assert.equal(state.gsm_packets.length, 1);
  assert.equal(state.equipment[0].gsmLastSeenAt, undefined);
  assert.equal(state.equipment[0].gsmLastLat, undefined);
});

test('GET /api/gsm/packets returns stored packets', async () => {
  const { app, gateway } = createGsmApiApp({
    equipment: [{ id: 'EQ-1', gsmImei: '866123456789012' }],
    gsm_devices: [provisionedDevice('EQ-1', { imei: '866123456789012' })],
  });
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
  const { app, gateway } = createGsmApiApp({
    equipment: [{ id: 'EQ-1', gsmImei: '866123456789012' }],
    gsm_devices: [provisionedDevice('EQ-1', { imei: '866123456789012' })],
  });
  gateway.processRawPacket(Buffer.from('IMEI:866123456789012'), { sourceIp: '127.0.0.1' });

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'GET', '/api/gsm/status', 'viewer-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.tcpPort, 5023);
    assert.equal(response.body.packetsReceivedTotal, 1);
    assert.ok(response.body.lastPacketAt);
  });
});

test('POST /api/gsm/ingest requires token and accepts valid JSON packet', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [
      { id: 'EQ-1', manufacturer: 'Mantall', model: 'XE80', inventoryNumber: '044', gsmImei: '866123456789012' },
    ],
    gsm_devices: [provisionedDevice('EQ-1', { imei: '866123456789012' })],
  });

  await withExpressApp(app, async (baseUrl) => {
    const noToken = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imei: '866123456789012', timestamp: '2026-05-16T10:00:00.000Z', lat: 55.796, lng: 49.108 }),
    });
    assert.equal(noToken.status, 401);

    const accepted = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gsm-ingest-token': 'gsm-test-secret',
      },
      body: JSON.stringify({ imei: '866123456789012', timestamp: '2026-05-16T10:00:00.000Z', lat: 55.796, lng: 49.108, speed: 4 }),
    });
    const body = await accepted.json();

    assert.equal(accepted.status, 202);
    assert.equal(body.ok, true);
    assert.equal(body.equipmentId, 'EQ-1');
    assert.equal(state.gsm_packets.length, 1);
    assert.equal(state.equipment[0].gsmLastLat, 55.796);
  });
});

test('HTTP token ingest cannot impersonate a TCP-provisioned device', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-TCP-ONLY' }],
    gsm_devices: [provisionedDevice('EQ-TCP-ONLY', {
      deviceId: 'DEVICE-TCP-ONLY',
      protocol: 'GPRS TCP',
      ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
    })],
  });
  const before = structuredClone(state);

  await withExpressApp(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gsm-ingest-token': 'gsm-test-secret',
      },
      body: JSON.stringify({
        deviceId: 'DEVICE-TCP-ONLY',
        timestamp: '2026-05-16T10:00:00.000Z',
        lat: 55.796,
        lng: 49.108,
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.code, 'GSM_DEVICE_INGRESS_MODE_MISMATCH');
    assert.deepEqual(state, before);
  });
});

test('both public TCP transports reject an HTTP-token device before persistence', () => {
  const memory = createMemoryGateway({
    equipment: [{ id: 'EQ-HTTP-ONLY' }],
    gsm_devices: [provisionedDevice('EQ-HTTP-ONLY', {
      imei: '860000000000777',
      deviceId: 'DEVICE-HTTP-ONLY',
      protocol: 'HTTPS JSON',
      ingressMode: GSM_INGRESS_MODE_HTTP_TOKEN,
      ingressSecretHash: null,
    })],
    gsm_packets: [],
  });
  const before = structuredClone(memory.state);

  assert.throws(
    () => memory.gateway.processRawPacket(
      Buffer.from(`deviceId:DEVICE-HTTP-ONLY ingressSecret=${TEST_GSM_INGRESS_SECRET} LAT:55.1 LNG:49.1`),
      { connection: { id: 'TCP-HTTP-MISMATCH', sourceIp: '127.0.0.1', socket: {} } },
    ),
    error => error.code === 'GSM_DEVICE_INGRESS_MODE_MISMATCH' && error.status === 403,
  );

  const wialon = createWialonIpsGateway({
    readData: memory.readData,
    writeDataBatch: memory.writeDataBatch,
    resolveTrustedDeviceScope: memory.resolveTrustedDeviceScope,
    withActorScope: memory.withActorScope,
    getCurrentScope: memory.getCurrentScope,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    enabled: false,
  });
  assert.throws(
    () => wialon.processLine(`#L#860000000000777;${TEST_GSM_INGRESS_SECRET}`, {
      connection: { id: 'WIALON-HTTP-MISMATCH', sourceIp: '127.0.0.1' },
    }),
    error => error.code === 'GSM_DEVICE_INGRESS_MODE_MISMATCH' && error.status === 403,
  );
  assert.deepEqual(memory.state, before);
});

test('POST /api/gsm/ingest links JSON packet by gsmDeviceId', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [
      {
        id: 'EQ-MANTALL-001',
        manufacturer: 'Mantall ',
        model: 'XE160WCT ',
        serialNumber: '03311273',
        inventoryNumber: '001',
        gsmImei: '866854051837469',
        gsmDeviceId: '990999260517062',
      },
    ],
    gsm_devices: [provisionedDevice('EQ-MANTALL-001', {
      imei: '866854051837469',
      deviceId: '990999260517062',
    })],
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gsm-ingest-token': 'gsm-test-secret',
      },
      body: JSON.stringify({
        deviceId: '990999260517062',
        timestamp: '2026-05-16T10:00:00.000Z',
        lat: 0.223456,
        lng: 0.754321,
        speed: 0,
        voltage: 11.9,
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 202);
    assert.equal(body.equipmentId, 'EQ-MANTALL-001');
    assert.equal(state.gsm_packets[0].equipmentId, 'EQ-MANTALL-001');
    assert.equal(state.equipment[0].gsmLastVoltage, 11.9);
  });
});

test('POST /api/gsm/ingest rejects invalid packet without crashing', async () => {
  const { app, state } = createGsmApiApp();

  await withExpressApp(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer gsm-test-secret',
      },
      body: JSON.stringify({ imei: '866123456789012', timestamp: '2026-05-16T10:00:00.000Z', lat: 120, lng: 49.108 }),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.match(body.error, /latitude/i);
    assert.equal(state.gsm_packets.length, 0);
  });
});

test('POST /api/gsm/ingest rejects invalid token, stale timestamps, and oversize JSON', async () => {
  const { app, state } = createGsmApiApp({}, { gsmMaxPacketAgeSeconds: 60, gsmMaxHttpPayloadBytes: 180 });

  await withExpressApp(app, async (baseUrl) => {
    const invalidToken = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gsm-ingest-token': 'wrong-secret',
      },
      body: JSON.stringify({ imei: '866123456789012', timestamp: new Date().toISOString(), lat: 55.796, lng: 49.108 }),
    });
    assert.equal(invalidToken.status, 401);

    const tooOld = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer gsm-test-secret',
      },
      body: JSON.stringify({ imei: '866123456789012', timestamp: '2020-01-01T00:00:00.000Z', lat: 55.796, lng: 49.108 }),
    });
    assert.equal(tooOld.status, 400);

    const tooLarge = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gsm-ingest-token': 'gsm-test-secret',
      },
      body: JSON.stringify({
        imei: '866123456789012',
        timestamp: new Date().toISOString(),
        lat: 55.796,
        lng: 49.108,
        rawPayload: 'x'.repeat(240),
      }),
    });
    assert.equal(tooLarge.status, 413);
    assert.equal(state.gsm_packets.length, 0);
  });
});

test('HTTP ingest clamps invalid age and payload limit configuration to safe finite defaults', async () => {
  const { app, state } = createGsmApiApp({}, {
    gsmMaxPacketAgeSeconds: Number.NaN,
    gsmMaxHttpPayloadBytes: Number.POSITIVE_INFINITY,
  });

  await withExpressApp(app, async (baseUrl) => {
    const tooOld = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gsm-ingest-token': 'gsm-test-secret',
      },
      body: JSON.stringify({
        imei: '866123456789012',
        timestamp: '2020-01-01T00:00:00.000Z',
        lat: 55.796,
        lng: 49.108,
      }),
    });
    assert.equal(tooOld.status, 400);

    const tooLarge = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gsm-ingest-token': 'gsm-test-secret',
      },
      body: JSON.stringify({
        imei: '866123456789012',
        timestamp: new Date().toISOString(),
        lat: 55.796,
        lng: 49.108,
        rawPayload: 'x'.repeat(17 * 1024),
      }),
    });
    assert.equal(tooLarge.status, 413);
    assert.equal(state.gsm_packets.length, 0);
  });
});

test('POST /api/gsm/ingest keeps production closed when token is not configured', async () => {
  const { app } = createGsmApiApp({}, { gsmIngestToken: '' });

  await withExpressApp(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gsm-ingest-token': 'gsm-test-secret',
      },
      body: JSON.stringify({ imei: '866123456789012', timestamp: new Date().toISOString(), lat: 55.796, lng: 49.108 }),
    });
    assert.equal(response.status, 503);
  });
});

test('POST /api/gsm/ingest is blocked when GSM conservation flag is disabled', async () => {
  const { app, state } = createGsmApiApp({}, {
    getGsmDisabledConfig: () => ({ disabled: true, message: 'GSM paused' }),
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gsm-ingest-token': 'gsm-test-secret',
      },
      body: JSON.stringify({ imei: '866123456789012', timestamp: new Date().toISOString(), lat: 55.796, lng: 49.108 }),
    });
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.code, 'GSM_DISABLED');
    assert.equal(body.message, 'GSM paused');
    assert.equal(state.gsm_packets.length, 0);
    assert.equal(state.gsm_devices.length, 0);
  });
});

test('POST /api/gsm/ingest rejects an unknown device before any write', async () => {
  const { app, state } = createGsmApiApp();
  const before = structuredClone(state);

  await withExpressApp(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gsm-ingest-token': 'gsm-test-secret',
      },
      body: JSON.stringify({ deviceId: 'UNKNOWN-HTTP-1', timestamp: '2026-05-16T10:00:00.000Z', lat: 55.796, lng: 49.108 }),
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'GSM_DEVICE_NOT_PROVISIONED');
    assert.deepEqual(state, before);
  });
});

test('GET /api/gsm/packets keeps legacy unlinked packets quarantined from equipment', async () => {
  const { app } = createGsmApiApp({
    equipment: [
      {
        id: 'EQ-MANTALL-001',
        manufacturer: 'Mantall ',
        model: 'XE160WCT ',
        serialNumber: '03311273',
        inventoryNumber: '001',
        gsmDeviceId: '990999260517062',
      },
    ],
    gsm_packets: [
      {
        id: 'P-legacy',
        deviceId: '990999260517062',
        parseStatus: 'parsed',
        lat: 0.223456,
        lng: 0.754321,
        speed: 0,
        voltage: 11.9,
        receivedAt: '2026-05-16T10:00:00.000Z',
        createdAt: '2026-05-16T10:00:00.000Z',
        direction: 'inbound',
        payloadHex: '',
        encoding: 'text',
      },
    ],
  });

  await withExpressApp(app, async (baseUrl) => {
    const filtered = await request(baseUrl, 'GET', '/api/gsm/packets?deviceId=990999260517062&limit=10', 'viewer-token');
    const diagnostics = await request(baseUrl, 'GET', '/api/gsm/packets?limit=10', 'viewer-token');

    assert.equal(filtered.status, 200);
    assert.deepEqual(filtered.body, []);
    assert.equal(diagnostics.status, 200);
    assert.equal(diagnostics.body[0].equipmentId, undefined);
    assert.equal(diagnostics.body[0].equipmentLabel, undefined);
  });
});

test('POST /api/gsm/ingest uses gsm_devices link to update equipment', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [
      { id: 'EQ-linked', manufacturer: 'Mantall', model: 'XE80', inventoryNumber: '044' },
    ],
    gsm_devices: [
      {
        id: 'GSM-866123456789012',
        imei: '866123456789012',
        equipmentId: 'EQ-linked',
        protocol: 'HTTPS JSON',
        ingressMode: GSM_INGRESS_MODE_HTTP_TOKEN,
        status: 'unknown',
      },
    ],
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gsm-ingest-token': 'gsm-test-secret',
      },
      body: JSON.stringify({ imei: '866123456789012', timestamp: '2026-05-16T10:00:00.000Z', lat: 55.796, lng: 49.108 }),
    });
    const body = await response.json();

    assert.equal(response.status, 202);
    assert.equal(body.equipmentId, 'EQ-linked');
    assert.equal(state.gsm_packets[0].equipmentId, 'EQ-linked');
    assert.equal(state.gsm_devices[0].equipmentId, 'EQ-linked');
    assert.equal(state.equipment[0].gsmLastLat, 55.796);
  });
});

test('duplicate HTTP ingest packet reuses stored packet instead of appending noise', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-1', gsmImei: '866123456789012' }],
    gsm_devices: [provisionedDevice('EQ-1', { imei: '866123456789012' })],
  });
  const packet = {
    imei: '866123456789012',
    timestamp: '2026-05-16T10:00:00.000Z',
    lat: 55.796,
    lng: 49.108,
  };

  await withExpressApp(app, async (baseUrl) => {
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(`${baseUrl}/api/gsm/ingest`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-gsm-ingest-token': 'gsm-test-secret',
        },
        body: JSON.stringify(packet),
      });
      assert.equal([200, 202].includes(response.status), true);
    }

    assert.equal(state.gsm_packets.length, 1);
  });
});

test('GET /api/gsm/diagnostics summarizes retained legacy unknown packets for admins', async () => {
  const { app } = createGsmApiApp({
    gsm_packets: [{
      id: 'LEGACY-UNKNOWN',
      direction: 'inbound',
      deviceId: 'UNKNOWN-DEVICE',
      equipmentId: null,
      parseStatus: 'failed',
      parseError: 'latitude_out_of_range',
      lat: 120,
      lng: 49.108,
      receivedAt: '2026-05-16T10:00:00.000Z',
    }],
  });

  await withExpressApp(app, async (baseUrl) => {
    const viewer = await request(baseUrl, 'GET', '/api/gsm/diagnostics', 'viewer-token');
    assert.equal(viewer.status, 403);

    const admin = await request(baseUrl, 'GET', '/api/gsm/diagnostics', 'admin-token');
    assert.equal(admin.status, 200);
    assert.equal(admin.body.totals.packets, 1);
    assert.equal(admin.body.totals.packetsWithoutLinkedEquipment, 1);
    assert.equal(admin.body.totals.parseErrors, 1);
    assert.deepEqual(admin.body.unknownDeviceIds, ['UNKNOWN-DEVICE']);
    assert.equal(admin.body.latestRawPackets.length, 1);
  });
});

test('GET /api/gsm/diagnostics redacts secret-like raw text', async () => {
  const nestedSecret = 'nested-diagnostic-secret';
  const identifierSecret = 'diagnostic-identifier-secret';
  const quotedSecret = 'diagnostic quoted secret';
  const escapedSecret = 'diagnostic-escaped-secret';
  const urlSecret = 'diagnostic-url-secret';
  const nestedHex = Buffer.from(JSON.stringify({ password: nestedSecret })).toString('hex').toUpperCase();
  const basicCredential = Buffer.from('diagnostic-user:basic-diagnostic-secret').toString('base64');
  const encodedRaw = [
    `payload="{\\"pwd\\":\\"${quotedSecret}\\"}"`,
    `rawPayload={\\"privateKey\\":\\"${escapedSecret}\\"}`,
    `body=${encodeURIComponent(JSON.stringify({ access_key: urlSecret }))}`,
  ].join(' ');
  const { app } = createGsmApiApp({
    gsm_packets: [{
      id: 'LEGACY-SECRET',
      direction: 'inbound',
      deviceId: `token=${identifierSecret}`,
      equipmentId: null,
      parseStatus: 'failed',
      parseError: `legacy_unknown_device rawPayloadHex=${nestedHex} ${encodedRaw}`,
      rawText: `deviceId:UNKNOWN-SECRET LAT:55.1 LNG:49.1 token=gsm-test-secret password=hidden Authorization: Basic ${basicCredential} rawPayloadHex=${nestedHex} ${encodedRaw}`,
      rawHex: Buffer.from(encodedRaw).toString('hex').toUpperCase(),
      receivedAt: '2026-05-16T10:00:00.000Z',
    }],
  });

  await withExpressApp(app, async (baseUrl) => {
    const admin = await request(baseUrl, 'GET', '/api/gsm/diagnostics', 'admin-token');
    assert.equal(admin.status, 200);
    const serialized = JSON.stringify(admin.body);
    assert.doesNotMatch(serialized, /gsm-test-secret/);
    assert.doesNotMatch(serialized, /password=hidden/);
    assert.doesNotMatch(serialized, new RegExp(nestedSecret, 'i'));
    assert.doesNotMatch(serialized.toLowerCase(), new RegExp(Buffer.from(nestedSecret).toString('hex').toLowerCase()));
    assert.doesNotMatch(serialized, new RegExp(basicCredential));
    for (const secret of [identifierSecret, quotedSecret, escapedSecret, urlSecret]) {
      assert.doesNotMatch(serialized, new RegExp(secret, 'i'));
      assert.doesNotMatch(serialized.toLowerCase(), new RegExp(Buffer.from(secret).toString('hex').toLowerCase()));
    }
    assert.equal(admin.body.unknownDeviceIds.some(value => String(value).includes(identifierSecret)), false);
    assert.match(serialized, /REDACTED/i);
  });
});

test('GSM analytics and dashboard redact raw legacy protocol and summary strings', async () => {
  const protocolSecret = 'analytics-protocol-secret';
  const summarySecret = 'analytics-summary-secret';
  const now = new Date().toISOString();
  const { app } = createGsmApiApp({
    gsm_packets: [{
      id: 'LEGACY-ANALYTICS-SECRET',
      direction: 'inbound',
      deviceId: 'UNKNOWN-ANALYTICS',
      equipmentId: null,
      protocol: `token=${protocolSecret}`,
      summary: `password="${summarySecret}"`,
      parseStatus: 'failed',
      receivedAt: now,
    }],
  });

  await withExpressApp(app, async (baseUrl) => {
    for (const path of ['/api/gsm/gateway/analytics', '/api/gsm/dashboard']) {
      const response = await request(baseUrl, 'GET', path, 'admin-token');
      assert.equal(response.status, 200, path);
      const serialized = JSON.stringify(response.body);
      assert.doesNotMatch(serialized, new RegExp(protocolSecret), path);
      assert.doesNotMatch(serialized, new RegExp(summarySecret), path);
      assert.match(serialized, /REDACTED/, path);
    }
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
    gsm_devices: [provisionedDevice('EQ-1', { imei: '866123456789012' })],
  });
  const packet = gateway.processRawPacket(Buffer.from('IMEI:866123456789012 LAT:55.796 LNG:49.108 SPEED:0 COURSE:120'), {
    sourceIp: '127.0.0.1',
  });
  const packetAt = new Date(packet.receivedAt);
  const from = new Date(packetAt.getTime() - 60_000).toISOString();
  const to = new Date(packetAt.getTime() + 60_000).toISOString();

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'GET', `/api/gsm/route?equipmentId=EQ-1&dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`, 'viewer-token');
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
    gsmDeviceRecordId: 'GDEV-EQ-1',
    gsmBindingRevision: 1,
    parseStatus: 'parsed',
    lat: 55.7,
    lng: 49.1,
    receivedAt: `2026-05-16T10:0${index}:00.000Z`,
  }));
  const { app } = createGsmApiApp({
    equipment,
    gsm_devices: equipment.map(item => provisionedDevice(item.id, { imei: item.gsmImei })),
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

test('GSM dashboard omits rental and client binding when the viewer cannot read rental sources', async () => {
  const device = provisionedDevice('EQ-RBAC', { deviceId: 'DEVICE-RBAC' });
  const { app } = createGsmApiApp({
    equipment: [{ id: 'EQ-RBAC', inventoryNumber: 'INV-RBAC' }],
    gsm_devices: [device],
    rentals: [{
      id: 'R-RBAC',
      equipmentId: 'EQ-RBAC',
      clientId: 'CL-RBAC',
      status: 'active',
      manager: 'Sensitive Manager',
      deliveryAddress: 'Sensitive Address',
    }],
    clients: [{ id: 'CL-RBAC', company: 'Sensitive Client', inn: '1655000000' }],
  });

  await withExpressApp(app, async (baseUrl) => {
    const admin = await request(baseUrl, 'GET', '/api/gsm/dashboard', 'admin-token');
    assert.equal(admin.status, 200);
    assert.equal(admin.body.snapshots[0].binding.rentalId, 'R-RBAC');
    assert.equal(admin.body.snapshots[0].binding.clientName, 'Sensitive Client');

    for (const token of ['mechanic-token', 'sales-token']) {
      const restricted = await request(baseUrl, 'GET', '/api/gsm/dashboard', token);
      assert.equal(restricted.status, 200, token);
      assert.equal(restricted.body.snapshots[0].binding, null, token);
      assert.doesNotMatch(JSON.stringify(restricted.body), /Sensitive Client|Sensitive Manager|Sensitive Address/, token);
    }
  });
});

test('GSM dashboard applies row-level rental-manager scope before building bindings', async () => {
  const { app } = createGsmApiApp({
    equipment: [
      { id: 'EQ-MANAGER-OWN', inventoryNumber: 'INV-OWN' },
      { id: 'EQ-MANAGER-OTHER', inventoryNumber: 'INV-OTHER' },
    ],
    gsm_devices: [
      provisionedDevice('EQ-MANAGER-OWN', { deviceId: 'DEVICE-MANAGER-OWN' }),
      provisionedDevice('EQ-MANAGER-OTHER', { deviceId: 'DEVICE-MANAGER-OTHER' }),
    ],
    rentals: [
      { id: 'R-MANAGER-OWN', equipmentId: 'EQ-MANAGER-OWN', clientId: 'CL-MANAGER-OWN', status: 'active', manager: 'Viewer' },
      { id: 'R-MANAGER-OTHER', equipmentId: 'EQ-MANAGER-OTHER', clientId: 'CL-MANAGER-OTHER', status: 'active', manager: 'Other Manager' },
    ],
    clients: [
      { id: 'CL-MANAGER-OWN', company: 'Own Client', manager: 'Viewer' },
      { id: 'CL-MANAGER-OTHER', company: 'Other Client', manager: 'Other Manager' },
    ],
  }, {
    accessControl: {
      filterCollectionByScope(collection, rows, user) {
        if (user?.userRole === 'Администратор' || collection === 'equipment') return rows;
        if (['rentals', 'gantt_rentals', 'clients'].includes(collection)) {
          return rows.filter(row => row.manager === user?.userName);
        }
        return rows;
      },
    },
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'GET', '/api/gsm/dashboard', 'viewer-token');
    assert.equal(response.status, 200);
    const own = response.body.snapshots.find(item => item.equipment.id === 'EQ-MANAGER-OWN');
    const other = response.body.snapshots.find(item => item.equipment.id === 'EQ-MANAGER-OTHER');
    assert.equal(own.binding.clientName, 'Own Client');
    assert.equal(other.binding, null);
    assert.doesNotMatch(JSON.stringify(response.body), /Other Client|Other Manager/);
  });
});

test('service foreman can use GSM read APIs without receiving rental or client context', async () => {
  const device = provisionedDevice('EQ-FOREMAN', { deviceId: 'DEVICE-FOREMAN' });
  const { app } = createGsmApiApp({
    equipment: [{ id: 'EQ-FOREMAN', inventoryNumber: 'INV-FOREMAN' }],
    gsm_devices: [device],
    rentals: [{
      id: 'R-FOREMAN',
      equipmentId: 'EQ-FOREMAN',
      clientId: 'CL-FOREMAN',
      status: 'active',
      manager: 'Restricted Manager',
    }],
    clients: [{ id: 'CL-FOREMAN', company: 'Restricted Client' }],
  });

  await withExpressApp(app, async (baseUrl) => {
    for (const path of [
      '/api/gsm/status',
      '/api/gsm/dashboard',
      '/api/gsm/packets',
      '/api/gsm/devices',
      '/api/gsm/gateway/status',
      '/api/gsm/gateway/commands',
    ]) {
      const response = await request(baseUrl, 'GET', path, 'foreman-token');
      assert.equal(response.status, 200, path);
      assert.doesNotMatch(JSON.stringify(response.body), /Restricted Client|Restricted Manager/, path);
    }
    const dashboard = await request(baseUrl, 'GET', '/api/gsm/dashboard', 'foreman-token');
    assert.equal(dashboard.body.snapshots[0].binding, null);
  });
});

test('GET /api/gsm/dashboard does not infer equipment ownership for a legacy unlinked packet', async () => {
  const { app } = createGsmApiApp({
    equipment: [
      {
        id: 'EQ-MANTALL-001',
        manufacturer: 'Mantall',
        model: 'XE160WCT',
        serialNumber: '03311273',
        inventoryNumber: '001',
        status: 'available',
        gsmDeviceId: '990999260517062',
      },
    ],
    gsm_devices: [provisionedDevice('EQ-MANTALL-001', { deviceId: '990999260517062' })],
    gsm_packets: [
      {
        id: 'P-device',
        deviceId: '990999260517062',
        parseStatus: 'parsed',
        lat: 0.223456,
        lng: 0.754321,
        speed: 0,
        voltage: 11.9,
        receivedAt: '2026-05-16T10:00:00.000Z',
        createdAt: '2026-05-16T10:00:00.000Z',
        direction: 'inbound',
        payloadHex: '',
        encoding: 'text',
      },
    ],
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'GET', '/api/gsm/dashboard?limit=10&recentLimit=10', 'viewer-token');
    const snapshot = response.body.snapshots.find(item => item.equipment.id === 'EQ-MANTALL-001');

    assert.equal(response.status, 200);
    assert.equal(response.body.recentPackets[0].equipmentId, undefined);
    assert.equal(response.body.recentPackets[0].equipmentLabel, undefined);
    assert.equal(snapshot.point, null);
    assert.equal(snapshot.telemetry.batteryVoltage, null);
    assert.equal(snapshot.telemetry.speedKph, null);
  });
});

test('GSM dashboard current telemetry requires the active binding revision', async () => {
  const device = advanceGsmDeviceBindingLifecycle(
    provisionedDevice('EQ-REVISION', { deviceId: 'DEVICE-REVISION' }),
    { at: '2026-05-16T09:30:00.000Z', reason: 'test_revision_advanced' },
  );
  const { app } = createGsmApiApp({
    equipment: [{
      id: 'EQ-REVISION',
      inventoryNumber: 'INV-REVISION',
      gsmDeviceRecordId: device.id,
      gsmDeviceId: 'DEVICE-REVISION',
    }],
    gsm_devices: [device],
    gsm_packets: [
      {
        id: 'P-stale-revision',
        equipmentId: 'EQ-REVISION',
        gsmDeviceRecordId: device.id,
        gsmBindingRevision: 1,
        lat: 10,
        lng: 20,
        parseStatus: 'parsed',
        receivedAt: '2026-05-16T10:02:00.000Z',
      },
      {
        id: 'P-current-outbound',
        direction: 'outbound',
        equipmentId: 'EQ-REVISION',
        gsmDeviceRecordId: device.id,
        gsmBindingRevision: 2,
        lat: 30,
        lng: 40,
        parseStatus: 'parsed',
        receivedAt: '2026-05-16T10:03:00.000Z',
      },
      {
        id: 'P-current-revision',
        equipmentId: 'EQ-REVISION',
        gsmDeviceRecordId: device.id,
        gsmBindingRevision: 2,
        lat: 55.7,
        lng: 49.1,
        parseStatus: 'parsed',
        receivedAt: '2026-05-16T10:01:00.000Z',
      },
    ],
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'GET', '/api/gsm/dashboard?limit=10&recentLimit=10', 'viewer-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.devices[0].bindingRevision, 2);
    assert.deepEqual(response.body.snapshots[0].point, {
      lat: 55.7,
      lng: 49.1,
      source: 'gps',
      address: 'GSM точка',
    });
    assert.deepEqual(
      response.body.snapshots[0].routePoints.map(item => [item.lat, item.lng]),
      [[55.7, 49.1]],
    );

    const equipmentTelemetry = await request(baseUrl, 'GET', '/api/gsm/equipment/EQ-REVISION', 'viewer-token');
    assert.equal(equipmentTelemetry.status, 200);
    assert.deepEqual(
      equipmentTelemetry.body.packets.map(item => item.id),
      ['P-current-outbound', 'P-current-revision'],
    );
    assert.deepEqual(
      equipmentTelemetry.body.historyPackets.map(item => item.id),
      ['P-current-outbound', 'P-stale-revision', 'P-current-revision'],
    );
  });
});

test('GSM maps and routes exclude failed, invalid, zero, and future packet locations', async () => {
  const now = Date.now();
  const validAt = new Date(now - 60 * 60 * 1000).toISOString();
  const failedAt = new Date(now - 30 * 60 * 1000).toISOString();
  const invalidAt = new Date(now - 20 * 60 * 1000).toISOString();
  const zeroAt = new Date(now - 10 * 60 * 1000).toISOString();
  const futureAt = new Date(now + 60 * 60 * 1000).toISOString();
  const device = provisionedDevice('EQ-MAP-TRUTH', { deviceId: 'DEVICE-MAP-TRUTH' });
  const binding = {
    equipmentId: 'EQ-MAP-TRUTH',
    gsmDeviceRecordId: device.id,
    gsmBindingRevision: device.bindingRevision,
    deviceId: device.deviceId,
  };
  const { app } = createGsmApiApp({
    equipment: [{
      id: 'EQ-MAP-TRUTH',
      gsmLastLat: 55.55,
      gsmLastLng: 49.55,
      gsmLastVoltage: 12.4,
    }],
    gsm_devices: [device],
    gsm_packets: [
      { id: 'P-FUTURE', ...binding, parseStatus: 'parsed', lat: 56, lng: 50, voltage: 999, receivedAt: futureAt },
      { id: 'P-ZERO', ...binding, parseStatus: 'parsed', lat: 0, lng: 0, receivedAt: zeroAt },
      { id: 'P-INVALID', ...binding, parseStatus: 'parsed', lat: 91, lng: 49, receivedAt: invalidAt },
      { id: 'P-FAILED', ...binding, parseStatus: 'failed', lat: 55.9, lng: 49.9, voltage: 998, receivedAt: failedAt },
      { id: 'P-VALID', ...binding, parseStatus: 'parsed', lat: 55.7, lng: 49.1, voltage: 12.8, receivedAt: validAt },
    ],
  });

  await withExpressApp(app, async (baseUrl) => {
    const dashboard = await request(baseUrl, 'GET', '/api/gsm/dashboard?limit=10&recentLimit=10', 'viewer-token');
    assert.equal(dashboard.status, 200);
    const snapshot = dashboard.body.snapshots[0];
    assert.deepEqual(snapshot.point, {
      lat: 55.7,
      lng: 49.1,
      source: 'gps',
      address: 'GSM точка',
    });
    assert.deepEqual(snapshot.routePoints.map(point => [point.lat, point.lng]), [[55.7, 49.1]]);
    assert.notEqual(snapshot.telemetry.batteryVoltage, 999);
    assert.notEqual(snapshot.telemetry.batteryVoltage, 998);

    const from = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const to = new Date(now + 2 * 60 * 60 * 1000).toISOString();
    const route = await request(
      baseUrl,
      'GET',
      `/api/gsm/route?equipmentId=EQ-MAP-TRUTH&dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`,
      'viewer-token',
    );
    assert.equal(route.status, 200);
    assert.deepEqual(route.body.map(point => [point.lat, point.lng]), [[55.7, 49.1]]);
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
  const server = await gateway.start();

  assert.equal(server, null);
  const status = gateway.getStatus();
  assert.equal(status.gatewayEnabled, false);
  assert.equal(status.disabled, true);
  assert.equal(status.tcpPort, 5023);
});

test('occupied GPRS port rejects startup and records the bind error', async (t) => {
  const { gateway: firstGateway } = createMemoryGateway({}, { host: '127.0.0.1', port: 0 });
  const firstStart = firstGateway.start();
  assert.equal(firstGateway.start(), firstStart);
  const firstServer = await firstStart;
  assert.equal(await firstGateway.start(), firstServer);
  const { port } = firstServer.address();

  const { gateway: secondGateway } = createMemoryGateway({}, { host: '127.0.0.1', port });
  t.after(async () => {
    await secondGateway.stop();
    await firstGateway.stop();
  });
  await assert.rejects(
    secondGateway.start(),
    error => error.code === 'EADDRINUSE',
  );

  const status = secondGateway.getStatus();
  assert.equal(status.gatewayEnabled, false);
  assert.match(status.startError, /EADDRINUSE|address already in use/i);
});

test('occupied WIALON IPS port rejects startup and records the bind error', async (t) => {
  const createGateway = (port) => {
    const memory = createMemoryGateway();
    return createWialonIpsGateway({
      readData: memory.readData,
      writeDataBatch: memory.writeDataBatch,
      resolveTrustedDeviceScope: memory.resolveTrustedDeviceScope,
      withActorScope: memory.withActorScope,
      getCurrentScope: memory.getCurrentScope,
      logger: { log: () => {}, warn: () => {}, error: () => {} },
      host: '127.0.0.1',
      port,
      enabled: true,
    });
  };
  const firstGateway = createGateway(0);
  const firstStart = firstGateway.start();
  assert.equal(firstGateway.start(), firstStart);
  const firstServer = await firstStart;
  assert.equal(await firstGateway.start(), firstServer);
  const secondGateway = createGateway(firstServer.address().port);
  t.after(async () => {
    await secondGateway.stop();
    await firstGateway.stop();
  });

  await assert.rejects(
    secondGateway.start(),
    error => error.code === 'EADDRINUSE',
  );
  const status = secondGateway.getStatus();
  assert.equal(status.gatewayEnabled, false);
  assert.match(status.startError, /EADDRINUSE|address already in use/i);
});

test('POST /api/gsm/commands creates queued command', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [
      { id: 'EQ-1', manufacturer: 'Mantall', model: 'XE80', inventoryNumber: '044', gsmImei: '866123456789012' },
    ],
    gsm_devices: [provisionedDevice('EQ-1', { imei: '866123456789012' })],
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
    assert.equal(response.body.gsmDeviceRecordId, 'GDEV-EQ-1');
    assert.equal(state.gsm_commands.length, 1);
  });
});

test('POST /api/gsm/gateway/send rejects malformed HEX before persistence', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-HEX-COMMAND' }],
    gsm_devices: [provisionedDevice('EQ-HEX-COMMAND', { deviceId: 'DEVICE-HEX-COMMAND' })],
  });

  await withExpressApp(app, async (baseUrl) => {
    for (const payload of ['ABC', 'GG']) {
      const rejected = await request(baseUrl, 'POST', '/api/gsm/gateway/send', 'admin-token', {
        equipmentId: 'EQ-HEX-COMMAND',
        deviceId: 'DEVICE-HEX-COMMAND',
        payload,
        encoding: 'hex',
      });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.code, 'GSM_COMMAND_HEX_INVALID');
      assert.equal(state.gsm_commands.length, 0);
    }

    const accepted = await request(baseUrl, 'POST', '/api/gsm/gateway/send', 'admin-token', {
      equipmentId: 'EQ-HEX-COMMAND',
      deviceId: 'DEVICE-HEX-COMMAND',
      payload: '50494E47',
      encoding: 'hex',
      appendNewline: false,
    });
    assert.equal(accepted.status, 202);
    assert.equal(accepted.body.encoding, 'hex');
    assert.equal(accepted.body.appendNewline, false);
    assert.equal(state.gsm_commands.length, 1);
    assert.equal(state.gsm_commands[0].encoding, 'hex');
    assert.equal(state.gsm_commands[0].appendNewline, false);
    assert.equal(state.gsm_commands[0].payload.encoding, 'hex');
    assert.equal(state.gsm_commands[0].payload.appendNewline, false);
  });
});

test('POST /api/gsm/gateway/send rejects payloads above the transport byte bound', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-LARGE-COMMAND' }],
    gsm_devices: [provisionedDevice('EQ-LARGE-COMMAND', { deviceId: 'DEVICE-LARGE-COMMAND' })],
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/gsm/gateway/send', 'admin-token', {
      equipmentId: 'EQ-LARGE-COMMAND',
      deviceId: 'DEVICE-LARGE-COMMAND',
      payload: 'A'.repeat(16 * 1024 + 1),
      encoding: 'text',
    });
    assert.equal(response.status, 413);
    assert.equal(response.body.code, 'GSM_COMMAND_PAYLOAD_TOO_LARGE');
    assert.equal(state.gsm_commands.length, 0);
  });
});

test('GSM command byte bound cannot be raised by invalid or oversized environment values', async (t) => {
  const original = process.env.GSM_MAX_COMMAND_BYTES;
  t.after(() => {
    if (original === undefined) delete process.env.GSM_MAX_COMMAND_BYTES;
    else process.env.GSM_MAX_COMMAND_BYTES = original;
  });

  assert.equal(resolveGsmMaxCommandBytes('1048576'), 16 * 1024);
  assert.equal(resolveGsmMaxCommandBytes('not-a-number'), 16 * 1024);
  assert.equal(resolveGsmMaxCommandBytes('2048'), 2048);

  for (const configured of ['1048576', 'not-a-number']) {
    process.env.GSM_MAX_COMMAND_BYTES = configured;
    const { app, state } = createGsmApiApp({
      equipment: [{ id: `EQ-COMMAND-BOUND-${configured}` }],
      gsm_devices: [provisionedDevice(`EQ-COMMAND-BOUND-${configured}`, {
        deviceId: `DEVICE-COMMAND-BOUND-${configured}`,
      })],
    });

    await withExpressApp(app, async (baseUrl) => {
      const equipmentId = `EQ-COMMAND-BOUND-${configured}`;
      const deviceId = `DEVICE-COMMAND-BOUND-${configured}`;
      const queuedObject = await request(baseUrl, 'POST', '/api/gsm/commands', 'admin-token', {
        equipmentId,
        deviceId,
        command: 'PING',
        payload: { blob: 'A'.repeat(16 * 1024) },
      });
      assert.equal(queuedObject.status, 413, configured);
      assert.equal(queuedObject.body.code, 'GSM_COMMAND_PAYLOAD_TOO_LARGE', configured);

      for (const [encoding, payload] of [
        ['text', 'A'.repeat(16 * 1024 + 1)],
        ['hex', 'AA'.repeat(16 * 1024 + 1)],
      ]) {
        const transport = await request(baseUrl, 'POST', '/api/gsm/gateway/send', 'admin-token', {
          equipmentId,
          deviceId,
          payload,
          encoding,
        });
        assert.equal(transport.status, 413, `${configured}:${encoding}`);
        assert.equal(transport.body.code, 'GSM_COMMAND_PAYLOAD_TOO_LARGE', `${configured}:${encoding}`);
      }
      assert.equal(state.gsm_commands.length, 0, configured);
    });
  }
});

test('office manager may queue GSM commands but cannot provision devices', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-OFFICE', gsmDeviceId: 'DEVICE-OFFICE' }],
    gsm_devices: [provisionedDevice('EQ-OFFICE', { deviceId: 'DEVICE-OFFICE' })],
  });

  await withExpressApp(app, async (baseUrl) => {
    const command = await request(baseUrl, 'POST', '/api/gsm/commands', 'office-token', {
      equipmentId: 'EQ-OFFICE',
      deviceId: 'DEVICE-OFFICE',
      command: 'PING',
    });
    assert.equal(command.status, 202);
    assert.equal(command.body.gsmDeviceRecordId, 'GDEV-EQ-OFFICE');

    const provisioning = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'office-token', {
      equipmentId: 'EQ-OFFICE',
      deviceId: 'DEVICE-OTHER',
    });
    assert.equal(provisioning.status, 403);
    assert.equal(state.gsm_devices.length, 1);
  });
});

test('GSM commands require the exact active provisioned device', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-1', gsmDeviceId: 'DEVICE-1' }],
    gsm_devices: [provisionedDevice('EQ-1', { deviceId: 'DEVICE-1' })],
  });

  await withExpressApp(app, async (baseUrl) => {
    const mismatch = await request(baseUrl, 'POST', '/api/gsm/commands', 'admin-token', {
      equipmentId: 'EQ-1',
      deviceId: 'DEVICE-OTHER',
      command: 'PING',
    });
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.code, 'GSM_COMMAND_DEVICE_MISMATCH');
    assert.equal(state.gsm_commands.length, 0);

    const accepted = await request(baseUrl, 'POST', '/api/gsm/commands', 'admin-token', {
      equipmentId: 'EQ-1',
      deviceId: 'DEVICE-1',
      command: 'PING',
    });
    assert.equal(accepted.status, 202);
    assert.equal(accepted.body.gsmDeviceRecordId, 'GDEV-EQ-1');
  });
});

test('GSM commands reject missing and ambiguous active device bindings', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [
      { id: 'EQ-NO-DEVICE' },
      { id: 'EQ-AMBIGUOUS' },
    ],
    gsm_devices: [
      provisionedDevice('EQ-AMBIGUOUS', { id: 'GDEV-AMBIGUOUS-1', deviceId: 'AMBIGUOUS-1' }),
      provisionedDevice('EQ-AMBIGUOUS', { id: 'GDEV-AMBIGUOUS-2', deviceId: 'AMBIGUOUS-2' }),
    ],
  });

  await withExpressApp(app, async (baseUrl) => {
    const missing = await request(baseUrl, 'POST', '/api/gsm/commands', 'admin-token', {
      equipmentId: 'EQ-NO-DEVICE',
      command: 'PING',
    });
    assert.equal(missing.status, 409);
    assert.equal(missing.body.code, 'GSM_COMMAND_DEVICE_NOT_PROVISIONED');

    const ambiguous = await request(baseUrl, 'POST', '/api/gsm/commands', 'admin-token', {
      equipmentId: 'EQ-AMBIGUOUS',
      command: 'PING',
    });
    assert.equal(ambiguous.status, 409);
    assert.equal(ambiguous.body.code, 'GSM_EQUIPMENT_DEVICE_AMBIGUOUS');
    assert.equal(state.gsm_commands.length, 0);
  });
});

test('GET /api/gsm/gateway/commands supports bounded pagination', async () => {
  const device = provisionedDevice('EQ-1', { id: 'GDEV-COMMANDS', deviceId: 'DEV-1' });
  const commands = Array.from({ length: 4 }, (_, index) => ({
    id: `CMD-${index + 1}`,
    equipmentId: 'EQ-1',
    gsmDeviceRecordId: device.id,
    gsmBindingRevision: 1,
    deviceId: 'DEV-1',
    command: `PING-${index + 1}`,
    status: 'queued',
    createdAt: `2026-05-16T10:0${index}:00.000Z`,
  }));
  const { app } = createGsmApiApp({
    equipment: [{ id: 'EQ-1' }],
    gsm_devices: [device],
    gsm_commands: commands,
  });
  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'GET', '/api/gsm/gateway/commands?paginated=true&page=2&pageSize=2&deviceId=DEV-1', 'viewer-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.items.length, 2);
    assert.equal(response.body.pagination.page, 2);
    assert.equal(response.body.pagination.hasPrevPage, true);
  });
});

test('filtered command history requires a trusted revision binding and its historical identity snapshot', () => {
  const original = provisionedDevice('EQ-COMMAND-HISTORY', {
    id: 'GDEV-COMMAND-HISTORY', deviceId: 'DEVICE-OLD',
  });
  const rotated = advanceGsmDeviceBindingLifecycle({
    ...original,
    deviceId: 'DEVICE-NEW',
  }, { at: '2026-05-16T10:00:00.000Z', reason: 'test_identity_rotation' });
  const memory = createMemoryGateway({
    equipment: [{ id: 'EQ-COMMAND-HISTORY' }, { id: 'EQ-OTHER' }],
    gsm_devices: [rotated],
    gsm_commands: [
      {
        id: 'CMD-HISTORICAL',
        equipmentId: 'EQ-COMMAND-HISTORY',
        gsmDeviceRecordId: rotated.id,
        gsmBindingRevision: 1,
        deviceId: 'DEVICE-OLD',
        status: 'queued',
      },
      {
        id: 'CMD-CURRENT',
        equipmentId: 'EQ-COMMAND-HISTORY',
        gsmDeviceRecordId: rotated.id,
        gsmBindingRevision: 2,
        deviceId: 'DEVICE-NEW',
        status: 'queued',
      },
      {
        id: 'CMD-TAMPERED-EQUIPMENT',
        equipmentId: 'EQ-OTHER',
        gsmDeviceRecordId: rotated.id,
        gsmBindingRevision: 1,
        deviceId: 'DEVICE-OLD',
      },
      {
        id: 'CMD-LEGACY',
        equipmentId: 'EQ-COMMAND-HISTORY',
        deviceId: 'DEVICE-OLD',
      },
    ],
  });

  assert.deepEqual(
    memory.gateway.listCommands({ deviceId: 'DEVICE-OLD' }).map(item => item.id),
    ['CMD-HISTORICAL'],
  );
  assert.deepEqual(
    memory.gateway.listCommands({ deviceId: 'DEVICE-NEW' }).map(item => item.id),
    ['CMD-CURRENT'],
  );
  assert.deepEqual(memory.gateway.listCommands({ equipmentId: 'EQ-OTHER' }), []);
  assert.equal(memory.gateway.listCommands().length, 2);
  assert.equal(memory.gateway.listCommands().every(item => typeof item.bindingCurrent === 'boolean'), true);
  const historical = memory.gateway.listCommands().find(item => item.id === 'CMD-HISTORICAL');
  const current = memory.gateway.listCommands().find(item => item.id === 'CMD-CURRENT');
  assert.equal(historical.status, 'queued');
  assert.equal(historical.bindingCurrent, false);
  assert.equal(historical.effectiveStatus, 'superseded');
  assert.equal(current.bindingCurrent, true);
  assert.equal(current.effectiveStatus, 'queued');
  assert.equal(memory.gateway.getStatus().queuedCommands, 1);
  assert.equal(memory.gateway.getAnalytics().commandStatus.queued, 1);
  assert.equal(
    memory.gateway.getAnalytics({
      equipmentId: 'EQ-COMMAND-HISTORY',
      deviceId: 'DEVICE-OLD',
    }).selected.commandStatus.queued,
    0,
  );
});

test('POST /api/gsm/devices/link links IMEI to equipment and creates gsm_devices record', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [
      { id: 'EQ-MANTALL', manufacturer: 'MANTALL', model: 'XE140W', inventoryNumber: '03300976' },
    ],
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-MANTALL',
      imei: '869132070808689',
      deviceType: 'UMKA',
      sim1: '+79625678660',
      oldServer: 'gw1.glonasssoft.ru:15050',
      targetServer: 'tcp.proxy.railway.app:12345',
      ingressSecret: TEST_GSM_INGRESS_SECRET,
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.device.equipmentId, 'EQ-MANTALL');
    assert.equal(response.body.device.imei, '869132070808689');
    assert.equal(response.body.device.targetServer, 'tcp.proxy.railway.app:12345');
    assert.doesNotMatch(JSON.stringify(response.body), new RegExp(TEST_GSM_INGRESS_SECRET, 'i'));
    assert.doesNotMatch(JSON.stringify(response.body), /scrypt\$v1\$/i);
    assert.equal(state.gsm_devices.length, 1);
    assert.equal(verifyGsmIngressSecret(TEST_GSM_INGRESS_SECRET, state.gsm_devices[0].ingressSecretHash), true);
    assert.equal(state.gsm_devices[0].ingressCredentialRevision, 1);
    assert.equal(state.equipment[0].gsmImei, '869132070808689');
    assert.equal(state.equipment[0].gsmProtocol, 'WIALON IPS TCP');
  });
});

test('GSM link edit preserves device metadata omitted by the caller', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-METADATA-PRESERVE' }],
    gsm_devices: [],
  });

  await withExpressApp(app, async (baseUrl) => {
    const created = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-METADATA-PRESERVE',
      imei: '869132070808699',
      deviceType: 'Manufacturer Model X',
      protocol: 'WIALON IPS TCP',
      ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
      oldServer: 'legacy.vendor.invalid:15050',
      targetServer: 'tenant-gateway.invalid:5050',
      ingressSecret: TEST_GSM_INGRESS_SECRET,
    });
    assert.equal(created.status, 201);

    const edited = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-METADATA-PRESERVE',
      imei: '869132070808699',
      protocol: 'WIALON IPS TCP',
      ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
    });
    assert.equal(edited.status, 201);
    assert.equal(state.gsm_devices[0].deviceType, 'Manufacturer Model X');
    assert.equal(state.gsm_devices[0].oldServer, 'legacy.vendor.invalid:15050');
    assert.equal(state.gsm_devices[0].targetServer, 'tenant-gateway.invalid:5050');
  });
});

test('GSM link API rotates only the stored credential hash and increments its revision', async () => {
  const oldSecret = 'old-device-secret';
  const nextSecret = 'next-device-secret';
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-CREDENTIAL-ROTATE' }],
    gsm_devices: [],
  });

  await withExpressApp(app, async (baseUrl) => {
    const created = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-CREDENTIAL-ROTATE',
      deviceId: 'DEVICE-CREDENTIAL-ROTATE',
      ingressSecret: oldSecret,
    });
    assert.equal(created.status, 201);
    const oldHash = state.gsm_devices[0].ingressSecretHash;
    assert.equal(verifyGsmIngressSecret(oldSecret, oldHash), true);
    assert.equal(state.gsm_devices[0].ingressCredentialRevision, 1);

    const rotated = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-CREDENTIAL-ROTATE',
      deviceId: 'DEVICE-CREDENTIAL-ROTATE',
      ingressSecret: nextSecret,
    });
    assert.equal(rotated.status, 201);
    assert.notEqual(state.gsm_devices[0].ingressSecretHash, oldHash);
    assert.equal(verifyGsmIngressSecret(oldSecret, state.gsm_devices[0].ingressSecretHash), false);
    assert.equal(verifyGsmIngressSecret(nextSecret, state.gsm_devices[0].ingressSecretHash), true);
    assert.equal(state.gsm_devices[0].ingressCredentialRevision, 2);
    const serialized = JSON.stringify(rotated.body);
    assert.doesNotMatch(serialized, new RegExp(oldSecret, 'i'));
    assert.doesNotMatch(serialized, new RegExp(nextSecret, 'i'));
    assert.doesNotMatch(serialized, /scrypt\$v1\$/i);
  });
});

test('GSM ingress mode transitions clear incompatible credentials and require fresh TCP proof', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-MODE-TRANSITION' }],
    gsm_devices: [],
  });

  await withExpressApp(app, async (baseUrl) => {
    const tcp = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-MODE-TRANSITION',
      deviceId: 'DEVICE-MODE-TRANSITION',
      protocol: 'GPRS TCP',
      ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
      ingressSecret: TEST_GSM_INGRESS_SECRET,
    });
    assert.equal(tcp.status, 201);
    assert.equal(tcp.body.device.ingressMode, GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL);
    assert.equal(tcp.body.device.ingressCredentialConfigured, true);
    assert.ok(state.gsm_devices[0].ingressSecretHash);
    const firstRevision = state.gsm_devices[0].bindingRevision;

    const http = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-MODE-TRANSITION',
      deviceId: 'DEVICE-MODE-TRANSITION',
      protocol: 'HTTPS JSON',
      ingressMode: GSM_INGRESS_MODE_HTTP_TOKEN,
    });
    assert.equal(http.status, 201);
    assert.equal(http.body.device.ingressMode, GSM_INGRESS_MODE_HTTP_TOKEN);
    assert.equal(http.body.device.ingressCredentialConfigured, false);
    assert.equal(state.gsm_devices[0].ingressSecretHash, null);
    assert.equal(state.gsm_devices[0].ingressCredentialRevision, null);
    assert.equal(state.gsm_devices[0].bindingRevision, firstRevision + 1);

    const tcpWithoutFreshSecret = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-MODE-TRANSITION',
      deviceId: 'DEVICE-MODE-TRANSITION',
      protocol: 'WIALON IPS TCP',
      ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
    });
    assert.equal(tcpWithoutFreshSecret.status, 400);
    assert.equal(tcpWithoutFreshSecret.body.code, 'GSM_DEVICE_CREDENTIAL_REQUIRED');
    assert.equal(state.gsm_devices[0].ingressMode, GSM_INGRESS_MODE_HTTP_TOKEN);

    const tcpWithFreshSecret = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-MODE-TRANSITION',
      deviceId: 'DEVICE-MODE-TRANSITION',
      protocol: 'WIALON IPS TCP',
      ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
      ingressSecret: 'fresh-mode-transition-secret',
    });
    assert.equal(tcpWithFreshSecret.status, 201);
    assert.equal(tcpWithFreshSecret.body.device.ingressMode, GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL);
    assert.equal(verifyGsmIngressSecret('fresh-mode-transition-secret', state.gsm_devices[0].ingressSecretHash), true);
  });
});

test('GSM provisioning rejects unknown protocol labels and explicit mode mismatches', async () => {
  const cases = [
    { protocol: 'http-maybe-custom', code: 'GSM_INGRESS_PROTOCOL_UNSUPPORTED' },
    { protocol: 'HTTPS JSON', ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL, code: 'GSM_INGRESS_MODE_PROTOCOL_MISMATCH' },
  ];
  for (const [index, input] of cases.entries()) {
    const { app, state } = createGsmApiApp({
      equipment: [{ id: `EQ-MODE-INVALID-${index}` }],
      gsm_devices: [],
    });
    await withExpressApp(app, async (baseUrl) => {
      const response = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
        equipmentId: `EQ-MODE-INVALID-${index}`,
        deviceId: `DEVICE-MODE-INVALID-${index}`,
        ...input,
        ingressSecret: input.ingressMode === GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL
          ? TEST_GSM_INGRESS_SECRET
          : undefined,
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.code, input.code);
      assert.equal(state.gsm_devices.length, 0);
    });
  }
});

test('explicit canonical ingress mode supports a manufacturer-specific protocol label', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-CUSTOM-PROTOCOL' }],
    gsm_devices: [],
  });
  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-CUSTOM-PROTOCOL',
      deviceId: 'DEVICE-CUSTOM-PROTOCOL',
      protocol: 'Manufacturer Cloud v2',
      ingressMode: GSM_INGRESS_MODE_HTTP_TOKEN,
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.device.ingressMode, GSM_INGRESS_MODE_HTTP_TOKEN);
    assert.equal(state.gsm_devices[0].protocol, 'Manufacturer Cloud v2');
  });
});

test('GSM link API rejects credentials that cannot be represented by every TCP transport', async () => {
  const unsafeSecrets = [
    'line\nbreak-secret',
    'nul\u0000secret',
    'space secret',
    'semicolon;secret',
    'query&secret',
    'comma,secret',
  ];

  for (const [index, ingressSecret] of unsafeSecrets.entries()) {
    const { app, state } = createGsmApiApp({
      equipment: [{ id: `EQ-UNSAFE-SECRET-${index}` }],
      gsm_devices: [],
    });
    await withExpressApp(app, async (baseUrl) => {
      const response = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
        equipmentId: `EQ-UNSAFE-SECRET-${index}`,
        deviceId: `DEVICE-UNSAFE-SECRET-${index}`,
        ingressSecret,
      });
      assert.equal(response.status, 400, JSON.stringify({ ingressSecret, body: response.body }));
      assert.equal(response.body.code, 'GSM_DEVICE_CREDENTIAL_INVALID');
      assert.equal(state.gsm_devices.length, 0);
    });
  }
});

test('GSM provisioning rejects overlong, control-character, and invalid-format metadata before persistence', async () => {
  const cases = [
    { imei: '8'.repeat(65) },
    { imei: 'invalid imei' },
    { deviceId: 'D'.repeat(129) },
    { deviceId: 'bad\ndevice' },
    { deviceType: 'T'.repeat(101) },
    { deviceType: 'bad\u0000type' },
    { protocol: 'P'.repeat(101) },
    { protocol: 'bad\rprotocol' },
    { sim1: '1'.repeat(41) },
    { sim1: 'not-a-phone' },
    { oldServer: 'o'.repeat(256) },
    { oldServer: 'bad\nserver' },
    { targetServer: 't'.repeat(256) },
    { targetServer: 'bad\u0000server' },
  ];

  for (const [index, invalidField] of cases.entries()) {
    const { app, state } = createGsmApiApp({
      equipment: [{ id: `EQ-BOUNDS-${index}` }],
      gsm_devices: [],
    });
    await withExpressApp(app, async (baseUrl) => {
      const response = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
        equipmentId: `EQ-BOUNDS-${index}`,
        imei: '860000000000901',
        deviceId: 'DEVICE-BOUNDS',
        protocol: 'GPRS TCP',
        ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
        ingressSecret: TEST_GSM_INGRESS_SECRET,
        ...invalidField,
      });
      assert.equal(response.status, 400, JSON.stringify({ invalidField, body: response.body }));
      assert.equal(response.body.code, 'GSM_DEVICE_FIELD_INVALID');
      assert.equal(state.gsm_devices.length, 0);
    });
  }
});

test('GSM provisioning accepts metadata exactly at documented length bounds', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-BOUNDS-EXACT' }],
    gsm_devices: [],
  });
  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-BOUNDS-EXACT',
      imei: '8'.repeat(64),
      deviceId: 'D'.repeat(128),
      deviceType: 'T'.repeat(100),
      protocol: 'P'.repeat(100),
      ingressMode: GSM_INGRESS_MODE_HTTP_TOKEN,
      sim1: '1'.repeat(40),
      oldServer: 'o'.repeat(255),
      targetServer: 't'.repeat(255),
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(state.gsm_devices.length, 1);
    assert.equal(state.gsm_devices[0].deviceId.length, 128);
    assert.equal(state.gsm_devices[0].targetServer.length, 255);
  });
});

test('GSM device provisioning preserves distinct IMEI and deviceId identities', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [
      { id: 'EQ-BOTH' },
      { id: 'EQ-DEVICE-ID-ONLY' },
    ],
    gsm_devices: [],
  });

  await withExpressApp(app, async (baseUrl) => {
    const both = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-BOTH',
      imei: '860000000000001',
      deviceId: 'TRACKER-BOTH',
      ingressSecret: TEST_GSM_INGRESS_SECRET,
    });
    assert.equal(both.status, 201);
    assert.equal(both.body.device.imei, '860000000000001');
    assert.equal(both.body.device.deviceId, 'TRACKER-BOTH');

    const deviceOnly = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-DEVICE-ID-ONLY',
      deviceId: 'TRACKER-ONLY',
      ingressSecret: TEST_GSM_INGRESS_SECRET,
    });
    assert.equal(deviceOnly.status, 201);
    assert.equal(deviceOnly.body.device.imei, null);
    assert.equal(deviceOnly.body.device.deviceId, 'TRACKER-ONLY');
    assert.equal(state.gsm_devices.length, 2);
  });
});

test('GSM devices link API updates an existing device and its equipment projection in one batch', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-MANTALL', gsmImei: '869132070808689' }],
    gsm_devices: [{
      id: 'GDEV-EXISTING',
      equipmentId: 'EQ-MANTALL',
      imei: '869132070808689',
      protocol: 'legacy',
      sim1: null,
    }],
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-MANTALL',
      imei: '869132070808689',
      protocol: 'WIALON IPS TCP',
      sim1: '+79990000000',
      ingressSecret: TEST_GSM_INGRESS_SECRET,
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.device.id, 'GDEV-EXISTING');
    assert.equal(state.gsm_devices.length, 1);
    assert.equal(state.gsm_devices[0].sim1, '+79990000000');
    assert.equal(state.equipment[0].gsmSimNumber, '+79990000000');
    assert.equal(state.equipment[0].gsmProtocol, 'WIALON IPS TCP');
  });
});

test('GSM device link batch failure leaves device and equipment projections unchanged', async () => {
  const injected = Object.assign(new Error('injected GSM link batch failure'), { status: 503 });
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-MANTALL' }],
    gsm_devices: [],
  }, {
    writeDataBatch: () => { throw injected; },
  });
  const before = structuredClone(state);

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-MANTALL',
      imei: '869132070808689',
      ingressSecret: TEST_GSM_INGRESS_SECRET,
    });

    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'GSM_DEVICE_LINK_REJECTED');
    assert.deepEqual(state, before);
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

test('GSM devices link API requires a stable equipmentId and does not fall back to labels', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-MANTALL', manufacturer: 'MANTALL', model: 'XE140W', inventoryNumber: '03300976' }],
  });
  const before = structuredClone(state);

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      inventoryNumber: '03300976',
      model: 'MANTALL XE140W',
      imei: '869132070808689',
    });
    assert.equal(response.status, 404);
    assert.equal(response.body.code, 'GSM_EQUIPMENT_ID_REQUIRED');
    assert.deepEqual(state, before);
  });
});

test('GSM devices link API rejects an identifier already provisioned in another tenant', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-A' }],
    gsm_devices: [{
      id: 'GDEV-B',
      equipmentId: 'EQ-B',
      deviceId: 'SHARED-DEVICE',
      companyId: 'COMPANY-B',
      tenantId: 'COMPANY-B',
    }],
  });
  const before = structuredClone(state);

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-A',
      deviceId: 'SHARED-DEVICE',
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'GSM_DEVICE_IDENTITY_CONFLICT');
    assert.deepEqual(state, before);
  });
});

test('GSM API lifecycle and diagnostics remain isolated across tenant A and tenant B', async () => {
  const scopeA = { companyId: 'COMPANY-A', tenantId: 'COMPANY-A' };
  const scopeB = { companyId: 'COMPANY-B', tenantId: 'COMPANY-B' };
  let idSequence = 0;
  let nowMs = Date.parse('2026-05-16T10:00:00.000Z');
  const context = createGsmApiApp({
    equipment: [
      { id: 'EQ-A-LIFECYCLE', ...scopeA },
      { id: 'EQ-A-SPARE', ...scopeA },
      { id: 'EQ-B-LIFECYCLE', ...scopeB },
      { id: 'EQ-B-SPARE', ...scopeB },
    ],
    gsm_devices: [],
    gsm_packets: [],
  }, {
    generateId: prefix => `${prefix}-AB-${++idSequence}`,
    nowIso: () => new Date(nowMs += 1_000).toISOString(),
  });
  const { app, state, setActiveScope } = context;

  await withExpressApp(app, async (baseUrl) => {
    const linkedA = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-A-LIFECYCLE',
      deviceId: 'DEVICE-A-OLD',
      protocol: 'HTTPS JSON',
      ingressMode: GSM_INGRESS_MODE_HTTP_TOKEN,
    });
    assert.equal(linkedA.status, 201);
    const deviceRecordIdA = linkedA.body.device.id;

    const bindingsA = await request(baseUrl, 'GET', '/api/gsm/bindings', 'viewer-token');
    assert.deepEqual(bindingsA.body.items.map(item => item.id).sort(), ['EQ-A-LIFECYCLE', 'EQ-A-SPARE']);
    assert.doesNotMatch(JSON.stringify(bindingsA.body), /EQ-B-/);
    const exactUnprovisionedA = await request(
      baseUrl,
      'GET',
      '/api/gsm/bindings?equipmentId=EQ-A-SPARE&limit=1',
      'viewer-token',
    );
    assert.deepEqual(exactUnprovisionedA.body.items.map(item => item.id), ['EQ-A-SPARE']);
    assert.equal(exactUnprovisionedA.body.items[0].gsmDeviceRecordId, null);
    const ingestA = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gsm-ingest-token': 'gsm-test-secret' },
      body: JSON.stringify({
        deviceId: 'DEVICE-A-OLD',
        timestamp: '2026-05-16T10:00:00.000Z',
        lat: 55.7,
        lng: 49.1,
      }),
    });
    assert.equal(ingestA.status, 202);

    setActiveScope(scopeB);
    const bindingsBBefore = await request(baseUrl, 'GET', '/api/gsm/bindings', 'viewer-token');
    assert.deepEqual(bindingsBBefore.body.items.map(item => item.id).sort(), ['EQ-B-LIFECYCLE', 'EQ-B-SPARE']);
    assert.doesNotMatch(JSON.stringify(bindingsBBefore.body), /EQ-A-/);
    const crossTenantIdentityReuse = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-B-LIFECYCLE',
      deviceId: 'DEVICE-A-OLD',
      protocol: 'HTTPS JSON',
      ingressMode: GSM_INGRESS_MODE_HTTP_TOKEN,
    });
    assert.equal(crossTenantIdentityReuse.status, 409);
    assert.equal(crossTenantIdentityReuse.body.code, 'GSM_DEVICE_IDENTITY_CONFLICT');

    const linkedB = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-B-LIFECYCLE',
      deviceId: 'DEVICE-B-CURRENT',
      protocol: 'HTTPS JSON',
      ingressMode: GSM_INGRESS_MODE_HTTP_TOKEN,
    });
    assert.equal(linkedB.status, 201);
    const ingestB = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gsm-ingest-token': 'gsm-test-secret' },
      body: JSON.stringify({
        deviceId: 'DEVICE-B-CURRENT',
        timestamp: '2026-05-16T10:00:00.000Z',
        lat: 56.7,
        lng: 50.1,
      }),
    });
    assert.equal(ingestB.status, 202);
    const diagnosticsB = await request(baseUrl, 'GET', '/api/gsm/diagnostics', 'admin-token');
    assert.equal(diagnosticsB.body.totals.packets, 1);
    assert.match(JSON.stringify(diagnosticsB.body), /DEVICE-B-CURRENT/);
    assert.doesNotMatch(JSON.stringify(diagnosticsB.body), /DEVICE-A-OLD/);

    const rotateAFromB = await request(
      baseUrl,
      'PATCH',
      `/api/gsm/devices/${encodeURIComponent(deviceRecordIdA)}/identity`,
      'admin-token',
      { deviceId: 'DEVICE-A-NEW' },
    );
    assert.equal(rotateAFromB.status, 404);
    const retireAFromB = await request(
      baseUrl,
      'POST',
      `/api/gsm/devices/${encodeURIComponent(deviceRecordIdA)}/retire`,
      'admin-token',
      {},
    );
    assert.equal(retireAFromB.status, 404);

    setActiveScope(scopeA);
    const rotatedA = await request(
      baseUrl,
      'PATCH',
      `/api/gsm/devices/${encodeURIComponent(deviceRecordIdA)}/identity`,
      'admin-token',
      { deviceId: 'DEVICE-A-NEW' },
    );
    assert.equal(rotatedA.status, 200);
    assert.equal(rotatedA.body.device.bindingRevision, 2);
    const retiredA = await request(
      baseUrl,
      'POST',
      `/api/gsm/devices/${encodeURIComponent(deviceRecordIdA)}/retire`,
      'admin-token',
      { reason: 'tenant A lifecycle test' },
    );
    assert.equal(retiredA.status, 200);
    assert.equal(retiredA.body.device.status, 'retired');
    const reactivatedA = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-A-LIFECYCLE',
      deviceId: 'DEVICE-A-NEW',
      protocol: 'HTTPS JSON',
      ingressMode: GSM_INGRESS_MODE_HTTP_TOKEN,
    });
    assert.equal(reactivatedA.status, 201);
    assert.equal(reactivatedA.body.device.id, deviceRecordIdA);
    assert.equal(reactivatedA.body.device.bindingRevision, 3);
    assert.equal(reactivatedA.body.device.bindingHistory.length, 3);

    const diagnosticsA = await request(baseUrl, 'GET', '/api/gsm/diagnostics', 'admin-token');
    assert.equal(diagnosticsA.body.totals.packets, 1);
    assert.match(JSON.stringify(diagnosticsA.body), /DEVICE-A-OLD/);
    assert.doesNotMatch(JSON.stringify(diagnosticsA.body), /DEVICE-B-CURRENT/);
    const bindingsAAfter = await request(baseUrl, 'GET', '/api/gsm/bindings', 'viewer-token');
    assert.equal(
      bindingsAAfter.body.items.find(item => item.id === 'EQ-A-LIFECYCLE').gsmDeviceId,
      'DEVICE-A-NEW',
    );

    setActiveScope(scopeB);
    const bindingsBAfter = await request(baseUrl, 'GET', '/api/gsm/bindings', 'viewer-token');
    assert.equal(
      bindingsBAfter.body.items.find(item => item.id === 'EQ-B-LIFECYCLE').gsmDeviceId,
      'DEVICE-B-CURRENT',
    );
    assert.equal(state.gsm_devices.length, 2);
  });
});

test('GSM devices link API enforces one active device per equipment', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-ONE', gsmDeviceId: 'DEVICE-ONE' }],
    gsm_devices: [{
      id: 'GDEV-ONE',
      equipmentId: 'EQ-ONE',
      deviceId: 'DEVICE-ONE',
      status: 'unknown',
    }],
  });
  const before = structuredClone(state);

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-ONE',
      deviceId: 'DEVICE-TWO',
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'GSM_EQUIPMENT_ALREADY_PROVISIONED');
    assert.deepEqual(state, before);
  });
});

test('GSM device rebind atomically clears the old projection and resets current telemetry', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [
      {
        id: 'EQ-OLD',
        gsmImei: '869132070808689',
        gsmDeviceId: '869132070808689',
        gsmTrackerId: '869132070808689',
        gsmStatus: 'online',
        gsmSignalStatus: 'online',
        gsmLastSeenAt: '2026-05-16T09:59:00.000Z',
        gsmLastLat: 55.7,
        gsmLastLng: 49.1,
      },
      {
        id: 'EQ-NEW',
        gsmLastSeenAt: '2025-01-01T00:00:00.000Z',
        gsmLastLat: 1,
        gsmLastLng: 2,
      },
    ],
    gsm_devices: [{
      id: 'GDEV-REBOUND',
      equipmentId: 'EQ-OLD',
      imei: '869132070808689',
      status: 'online',
      lastPacketAt: '2026-05-16T09:59:00.000Z',
      lastLatitude: 55.7,
      lastLongitude: 49.1,
    }],
    gsm_packets: [{
      id: 'PACKET-HISTORY',
      gsmDeviceRecordId: 'GDEV-REBOUND',
      equipmentId: 'EQ-OLD',
      receivedAt: '2026-05-16T09:59:00.000Z',
    }],
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-NEW',
      imei: '869132070808689',
      ingressSecret: TEST_GSM_INGRESS_SECRET,
    });
    assert.equal(response.status, 201);
    assert.equal(state.gsm_devices.length, 1);
    assert.equal(state.gsm_devices[0].equipmentId, 'EQ-NEW');
    assert.equal(state.gsm_devices[0].status, 'unknown');
    assert.equal(state.gsm_devices[0].lastPacketAt, null);
    assert.equal(state.gsm_devices[0].lastLatitude, null);

    const oldEquipment = state.equipment.find(item => item.id === 'EQ-OLD');
    const newEquipment = state.equipment.find(item => item.id === 'EQ-NEW');
    assert.equal(oldEquipment.gsmImei, null);
    assert.equal(oldEquipment.gsmDeviceId, null);
    assert.equal(oldEquipment.gsmLastSeenAt, null);
    assert.equal(oldEquipment.gsmLastLat, null);
    assert.equal(newEquipment.gsmImei, '869132070808689');
    assert.equal(newEquipment.gsmLastSeenAt, null);
    assert.equal(newEquipment.gsmLastLat, null);
    assert.equal(state.gsm_packets[0].equipmentId, 'EQ-OLD');
  });
});

test('retired GSM device is hidden from runtime, clears projection, and rejects ingress and commands', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-RETIRE', gsmImei: '869132070808689', gsmStatus: 'online' }],
    gsm_devices: [{
      id: 'GDEV-RETIRE',
      equipmentId: 'EQ-RETIRE',
      imei: '869132070808689',
      status: 'online',
    }],
  });

  await withExpressApp(app, async (baseUrl) => {
    const retired = await request(baseUrl, 'POST', '/api/gsm/devices/GDEV-RETIRE/retire', 'admin-token', {
      reason: 'tracker replaced',
    });
    assert.equal(retired.status, 200);
    assert.equal(retired.body.device.status, 'retired');
    assert.equal(state.equipment[0].gsmImei, null);
    assert.equal(state.equipment[0].gsmStatus, null);
    assert.equal(state.equipment[0].gsmSignalStatus, null);

    const devices = await request(baseUrl, 'GET', '/api/gsm/devices', 'viewer-token');
    assert.deepEqual(devices.body, []);

    const ingest = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gsm-ingest-token': 'gsm-test-secret',
      },
      body: JSON.stringify({
        imei: '869132070808689',
        timestamp: '2026-05-16T10:00:00.000Z',
        lat: 55.7,
        lng: 49.1,
      }),
    });
    assert.equal(ingest.status, 403);
    assert.equal((await ingest.json()).code, 'GSM_DEVICE_NOT_ACTIVE');
    assert.equal(state.gsm_packets.length, 0);

    const command = await request(baseUrl, 'POST', '/api/gsm/commands', 'admin-token', {
      equipmentId: 'EQ-RETIRE',
      command: 'PING',
    });
    assert.equal(command.status, 409);
    assert.equal(command.body.code, 'GSM_COMMAND_DEVICE_NOT_PROVISIONED');
    assert.equal(state.gsm_commands.length, 0);
  });
});

test('retire quarantines a far-future active binding without mutating device or equipment state', async () => {
  const futureDevice = provisionedDevice('EQ-RETIRE-FUTURE-BINDING', {
    id: 'GDEV-RETIRE-FUTURE-BINDING',
    deviceId: 'DEVICE-RETIRE-FUTURE-BINDING',
  });
  futureDevice.bindingHistory[0].linkedAt = '9999-01-01T00:00:00.000Z';
  const { app, state } = createGsmApiApp({
    equipment: [{ id: futureDevice.equipmentId }],
    gsm_devices: [futureDevice],
  });
  const before = structuredClone(state);

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(
      baseUrl,
      'POST',
      '/api/gsm/devices/GDEV-RETIRE-FUTURE-BINDING/retire',
      'admin-token',
      { reason: 'must remain quarantined' },
    );
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'GSM_DEVICE_BINDING_HISTORY_INVALID');
    assert.deepEqual(state, before);
  });
});

test('retire idempotently repairs an inactive legacy binding and stale equipment projection', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [{
      id: 'EQ-LEGACY-INACTIVE',
      gsmDeviceRecordId: 'GDEV-LEGACY-INACTIVE',
      gsmImei: '860000000000099',
      gsmDeviceId: 'LEGACY-INACTIVE',
      gsmTrackerId: 'LEGACY-INACTIVE',
      gsmStatus: 'online',
      gsmSignalStatus: 'online',
      gsmLastSeenAt: '2025-01-01T00:00:00.000Z',
      gsmLastLat: 55.7,
      gsmLastLng: 49.1,
    }],
    gsm_devices: [{
      id: 'GDEV-LEGACY-INACTIVE',
      equipmentId: 'EQ-LEGACY-INACTIVE',
      imei: '860000000000099',
      deviceId: 'LEGACY-INACTIVE',
      status: 'inactive',
    }],
  });

  await withExpressApp(app, async (baseUrl) => {
    const first = await request(
      baseUrl,
      'POST',
      '/api/gsm/devices/GDEV-LEGACY-INACTIVE/retire',
      'admin-token',
      { reason: 'repair stale inactive projection' },
    );
    assert.equal(first.status, 200);
    assert.equal(first.body.device.status, 'retired');
    assert.equal(first.body.device.bindingRevision, 1);
    assert.equal(first.body.device.bindingHistory.length, 1);
    assert.ok(first.body.device.bindingHistory[0].unlinkedAt);
    for (const field of EQUIPMENT_GSM_CONFIGURATION_PROJECTION_FIELDS) {
      assert.equal(state.equipment[0][field], null, field);
    }
    assert.equal(state.equipment[0].gsmStatus, null);
    assert.equal(state.equipment[0].gsmSignalStatus, null);
    assert.equal(state.equipment[0].gsmLastSeenAt, null);
    assert.equal(state.equipment[0].gsmLastLat, null);

    const afterFirst = structuredClone(state);
    const second = await request(
      baseUrl,
      'POST',
      '/api/gsm/devices/GDEV-LEGACY-INACTIVE/retire',
      'admin-token',
      { reason: 'must not rewrite closed history' },
    );
    assert.equal(second.status, 200);
    assert.deepEqual(state, afterFirst);
  });
});

test('retired GSM device can be reactivated with a new binding revision and preserved history', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-REACTIVATE', gsmDeviceId: 'DEVICE-REACTIVATE' }],
    gsm_devices: [{
      id: 'GDEV-REACTIVATE',
      equipmentId: 'EQ-REACTIVATE',
      deviceId: 'DEVICE-REACTIVATE',
      ingressSecretHash: TEST_GSM_INGRESS_SECRET_HASH,
      status: 'online',
    }],
  });

  await withExpressApp(app, async (baseUrl) => {
    const retired = await request(baseUrl, 'POST', '/api/gsm/devices/GDEV-REACTIVATE/retire', 'admin-token', {});
    assert.equal(retired.status, 200);
    assert.equal(retired.body.device.bindingRevision, 1);
    assert.ok(retired.body.device.bindingHistory[0].unlinkedAt);

    const reactivated = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-REACTIVATE',
      deviceId: 'DEVICE-REACTIVATE',
      ingressSecret: TEST_GSM_INGRESS_SECRET,
    });
    assert.equal(reactivated.status, 201);
    assert.equal(reactivated.body.device.id, 'GDEV-REACTIVATE');
    assert.equal(reactivated.body.device.bindingRevision, 2);
    assert.equal(reactivated.body.device.bindingHistory.length, 2);
    assert.equal(reactivated.body.device.bindingHistory[1].unlinkedAt, null);
    assert.equal(state.gsm_devices[0].status, 'unknown');
  });
});

test('stable GSM device record supports atomic identity rotation and resets telemetry projection', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [{
      id: 'EQ-ROTATE',
      gsmImei: '860000000000010',
      gsmDeviceId: 'TRACKER-OLD',
      gsmStatus: 'online',
      gsmLastSeenAt: '2026-05-16T09:59:00.000Z',
    }],
    gsm_devices: [{
      id: 'GDEV-ROTATE',
      equipmentId: 'EQ-ROTATE',
      imei: '860000000000010',
      deviceId: 'TRACKER-OLD',
      trackerId: 'TRACKER-OLD-ALIAS',
      protocol: 'HTTPS JSON',
      ingressMode: GSM_INGRESS_MODE_HTTP_TOKEN,
      status: 'online',
      lastPacketAt: '2026-05-16T09:59:00.000Z',
    }],
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'PATCH', '/api/gsm/devices/GDEV-ROTATE/identity', 'admin-token', {
      imei: '860000000000011',
      deviceId: 'TRACKER-NEW',
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.rotated, true);
    assert.equal(response.body.device.id, 'GDEV-ROTATE');
    assert.equal(response.body.device.bindingRevision, 2);
    assert.equal(response.body.device.bindingHistory[0].imei, '860000000000010');
    assert.equal(response.body.device.bindingHistory[1].imei, '860000000000011');
    assert.equal(response.body.device.trackerId, null);
    assert.equal(state.equipment[0].gsmImei, '860000000000011');
    assert.equal(state.equipment[0].gsmDeviceId, 'TRACKER-NEW');
    assert.equal(state.equipment[0].gsmStatus, 'unknown');
    assert.equal(state.equipment[0].gsmLastSeenAt, null);

    assert.equal(state.gsm_devices.find(item => item.imei === '860000000000010'), undefined);

    const oldIdentity = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gsm-ingest-token': 'gsm-test-secret' },
      body: JSON.stringify({
        imei: '860000000000010',
        timestamp: '2026-05-16T10:00:00.000Z',
        lat: 55.7,
        lng: 49.1,
      }),
    });
    assert.equal(oldIdentity.status, 403);

    const oldTrackerAlias = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gsm-ingest-token': 'gsm-test-secret' },
      body: JSON.stringify({
        deviceId: 'TRACKER-OLD-ALIAS',
        timestamp: '2026-05-16T10:00:00.000Z',
        lat: 55.7,
        lng: 49.1,
      }),
    });
    assert.equal(oldTrackerAlias.status, 403);

    const newIdentity = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gsm-ingest-token': 'gsm-test-secret' },
      body: JSON.stringify({
        imei: '860000000000011',
        deviceId: 'TRACKER-NEW',
        timestamp: '2026-05-16T10:00:00.000Z',
        lat: 55.7,
        lng: 49.1,
      }),
    });
    assert.equal(newIdentity.status, 202);
    assert.equal(state.gsm_packets[0].gsmBindingRevision, 2);
  });
});

test('identity rotation permanently reserves a distinct legacy tracker alias', async () => {
  const { app, state } = createGsmApiApp({
    equipment: [
      { id: 'EQ-ALIAS-OLD' },
      { id: 'EQ-ALIAS-NEW' },
    ],
    gsm_devices: [{
      id: 'GDEV-ALIAS',
      equipmentId: 'EQ-ALIAS-OLD',
      imei: '860000000000055',
      deviceId: 'DEVICE-PRIMARY-OLD',
      trackerId: 'TRACKER-LEGACY-ALIAS',
      status: 'unknown',
      bindingRevision: 1,
      bindingHistory: [{
        revision: 1,
        equipmentId: 'EQ-ALIAS-OLD',
        companyId: DEFAULT_SCOPE.companyId,
        tenantId: DEFAULT_SCOPE.tenantId,
        imei: '860000000000055',
        deviceId: 'DEVICE-PRIMARY-OLD',
        linkedAt: '2026-05-16T09:00:00.000Z',
        unlinkedAt: null,
      }],
    }],
  });

  await withExpressApp(app, async (baseUrl) => {
    const rotated = await request(baseUrl, 'PATCH', '/api/gsm/devices/GDEV-ALIAS/identity', 'admin-token', {
      imei: '860000000000056',
      deviceId: 'DEVICE-PRIMARY-NEW',
    });
    assert.equal(rotated.status, 200);
    assert.equal(rotated.body.device.bindingHistory[0].trackerId, 'TRACKER-LEGACY-ALIAS');
    assert.equal(rotated.body.device.bindingHistory[0].identities.includes('TRACKER-LEGACY-ALIAS'), true);

    const reuse = await request(baseUrl, 'POST', '/api/gsm/devices/link', 'admin-token', {
      equipmentId: 'EQ-ALIAS-NEW',
      deviceId: 'TRACKER-LEGACY-ALIAS',
    });
    assert.equal(reuse.status, 409);
    assert.equal(reuse.body.code, 'GSM_DEVICE_IDENTITY_CONFLICT');
    assert.equal(state.gsm_devices.length, 1);
  });
});

test('GSM identity rotation batch failure leaves device and equipment unchanged', async () => {
  const injected = Object.assign(new Error('injected identity rotation failure'), { status: 503 });
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-ROTATE-ROLLBACK', gsmDeviceId: 'TRACKER-OLD' }],
    gsm_devices: [{
      id: 'GDEV-ROTATE-ROLLBACK',
      equipmentId: 'EQ-ROTATE-ROLLBACK',
      deviceId: 'TRACKER-OLD',
      status: 'unknown',
    }],
  }, {
    writeDataBatch: () => { throw injected; },
  });
  const before = structuredClone(state);

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(baseUrl, 'PATCH', '/api/gsm/devices/GDEV-ROTATE-ROLLBACK/identity', 'admin-token', {
      deviceId: 'TRACKER-NEW',
    });
    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'GSM_DEVICE_IDENTITY_ROTATION_REJECTED');
    assert.deepEqual(state, before);
  });
});

test('WIALON IPS gateway saves raw packet to gsm_packets and updates gsm_devices', () => {
  const loginSecret = TEST_GSM_INGRESS_SECRET;
  const memory = createMemoryGateway({
    equipment: [
      { id: 'EQ-MANTALL', manufacturer: 'MANTALL', model: 'XE140W', inventoryNumber: '03300976' },
      { id: 'EQ-UNRELATED-SECRET', databasePassword: 'legacy-equipment-secret-must-not-change' },
    ],
    gsm_devices: [
      {
        id: 'GDEV-1',
        equipmentId: 'EQ-MANTALL',
        imei: '869132070808689',
        deviceType: 'UMKA',
        protocol: 'WIALON IPS TCP',
        passwordConfigured: false,
        tokenCount: 7,
        authorizationStatus: 'approved',
        ingressSecretHash: TEST_GSM_INGRESS_SECRET_HASH,
      },
      provisionedDevice('EQ-UNRELATED-SECRET', {
        id: 'GDEV-UNRELATED-SECRET',
        deviceId: 'UNRELATED-DEVICE',
      }),
    ].map((device) => (
      device.id === 'GDEV-UNRELATED-SECRET'
        ? { ...device, apiToken: 'legacy-device-token-must-not-change' }
        : device
    )),
    gsm_packets: [],
  });
  const { state } = memory;
  const gateway = createWialonIpsGateway({
    readData: memory.readData,
    writeDataBatch: memory.writeDataBatch,
    resolveTrustedDeviceScope: memory.resolveTrustedDeviceScope,
    withActorScope: memory.withActorScope,
    getCurrentScope: memory.getCurrentScope,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    enabled: false,
  });

  const connection = { id: 'CONN-1', sourceIp: '127.0.0.1' };
  gateway.processLine(`#L#869132070808689;${loginSecret}`, { connection });
  const storedLogin = structuredClone(state.gsm_packets[0]);
  assert.equal(storedLogin.rawText, '#L#869132070808689;[REDACTED]');
  assert.equal(state.gsm_devices[0].lastRawPacket, '#L#869132070808689;[REDACTED]');
  assert.equal(storedLogin.parsed.passwordConfigured, true);
  assert.equal(state.gsm_devices[0].passwordConfigured, false);
  assert.equal(state.gsm_devices[0].tokenCount, 7);
  assert.equal(state.gsm_devices[0].authorizationStatus, 'approved');
  assert.equal(
    state.gsm_devices.find(item => item.id === 'GDEV-UNRELATED-SECRET').apiToken,
    'legacy-device-token-must-not-change',
  );
  assert.equal(
    state.equipment.find(item => item.id === 'EQ-UNRELATED-SECRET').databasePassword,
    'legacy-equipment-secret-must-not-change',
  );
  assert.doesNotMatch(JSON.stringify({ storedLogin, device: state.gsm_devices[0] }), new RegExp(loginSecret, 'i'));
  assert.doesNotMatch(
    String(storedLogin.rawHex).toLowerCase(),
    new RegExp(Buffer.from(loginSecret).toString('hex').toLowerCase()),
  );
  const result = gateway.processLine('#D#160526;101500;5547.7676;N;04906.3848;E;0;0;90;7;1.0;1;0;12.4;NA;BoardVoltage:2:13.1', {
    connection,
  });

  assert.equal(result.ack.toString(), '#AD#1\r\n');
  assert.equal(state.gsm_packets.length, 2);
  assert.equal(state.gsm_packets[0].rawText.startsWith('#D#160526'), true);
  assert.equal(state.gsm_packets[0].equipmentId, 'EQ-MANTALL');
  assert.equal(state.gsm_devices[0].lastVoltage, 13.1);
  assert.equal(state.equipment[0].gsmLastVoltage, 13.1);
});

test('HTTP GSM rawPayload secrets are redacted before packet and device persistence', async () => {
  const secret = 'http-ingest-password-73';
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-HTTP-SECRET' }],
    gsm_devices: [provisionedDevice('EQ-HTTP-SECRET', { imei: '860000000000073' })],
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/gsm/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gsm-ingest-token': 'gsm-test-secret',
      },
      body: JSON.stringify({
        imei: '860000000000073',
        timestamp: '2026-05-16T10:00:00.000Z',
        lat: 55.7,
        lng: 49.1,
        rawPayload: { password: secret, apiToken: secret },
      }),
    });
    assert.equal(response.status, 202);
  });

  const persisted = JSON.stringify({
    packet: state.gsm_packets[0],
    device: state.gsm_devices[0],
  });
  assert.doesNotMatch(persisted, new RegExp(secret, 'i'));
  assert.doesNotMatch(persisted.toLowerCase(), new RegExp(Buffer.from(secret).toString('hex').toLowerCase()));
  assert.match(persisted, /REDACTED/);
});

test('GSM viewer APIs redact legacy packet, device, and command credentials including raw hex', async () => {
  const secret = 'legacy-gsm-password-91';
  const login = `#L#860000000000091;${secret}`;
  const device = {
    ...provisionedDevice('EQ-LEGACY-SECRET', { id: 'GDEV-LEGACY-SECRET', imei: '860000000000091' }),
    lastRawPacket: login,
  };
  const binding = {
    equipmentId: 'EQ-LEGACY-SECRET',
    gsmDeviceRecordId: device.id,
    gsmBindingRevision: device.bindingRevision,
  };
  const { app } = createGsmApiApp({
    equipment: [{ id: 'EQ-LEGACY-SECRET' }],
    gsm_devices: [device],
    gsm_packets: [{
      id: 'GPKT-LEGACY-SECRET',
      ...binding,
      imei: device.imei,
      receivedAt: '2026-05-16T10:00:00.000Z',
      rawText: login,
      payload: login,
      rawHex: Buffer.from(login).toString('hex').toUpperCase(),
      payloadHex: Buffer.from(login).toString('hex').toUpperCase(),
      parsed: {
        password: secret,
        rawPayload: {
          text: `token=${secret}`,
          rawHex: Buffer.from(login).toString('hex').toUpperCase(),
        },
      },
    }],
    gsm_commands: [{
      id: 'GCMD-LEGACY-SECRET',
      ...binding,
      imei: device.imei,
      command: `SET password=${secret}`,
      encoding: 'hex',
      payload: {
        raw: Buffer.from(login).toString('hex').toUpperCase(),
        apiToken: secret,
      },
      status: 'queued',
      createdAt: '2026-05-16T10:00:00.000Z',
    }],
  });

  await withExpressApp(app, async (baseUrl) => {
    for (const path of [
      '/api/gsm/packets',
      '/api/gsm/gateway/packets',
      '/api/gsm/devices',
      '/api/gsm/dashboard',
      '/api/gsm/equipment/EQ-LEGACY-SECRET',
      '/api/gsm/gateway/commands',
    ]) {
      const response = await request(baseUrl, 'GET', path, 'viewer-token');
      assert.equal(response.status, 200, path);
      const serialized = JSON.stringify(response.body);
      assert.doesNotMatch(serialized, new RegExp(secret, 'i'), path);
      assert.doesNotMatch(
        serialized.toLowerCase(),
        new RegExp(Buffer.from(secret).toString('hex').toLowerCase()),
        path,
      );
    }
  });
});

test('GSM lifecycle response redacts a legacy device secret without rewriting storage', async () => {
  const secret = 'legacy-lifecycle-password-37';
  const login = `#L#860000000000037;${secret}`;
  const device = {
    ...provisionedDevice('EQ-LIFECYCLE-SECRET', {
      id: 'GDEV-LIFECYCLE-SECRET',
      imei: '860000000000037',
    }),
    lastRawPacket: login,
  };
  const { app, state } = createGsmApiApp({
    equipment: [{ id: 'EQ-LIFECYCLE-SECRET' }],
    gsm_devices: [device],
  });

  await withExpressApp(app, async (baseUrl) => {
    const response = await request(
      baseUrl,
      'PATCH',
      '/api/gsm/devices/GDEV-LIFECYCLE-SECRET/identity',
      'admin-token',
      { imei: '860000000000037' },
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.rotated, false);
    assert.doesNotMatch(JSON.stringify(response.body), new RegExp(secret, 'i'));
    assert.match(response.body.device.lastRawPacket, /REDACTED/);
    assert.equal(state.gsm_devices[0].lastRawPacket, login);
  });
});

test('WIALON IPS ingress rejects a device relink race before telemetry persistence', () => {
  const memory = createMemoryGateway({
    equipment: [
      { id: 'EQ-WIALON-RACE-OLD' },
      { id: 'EQ-WIALON-RACE-NEW' },
    ],
    gsm_devices: [{
      id: 'GDEV-WIALON-RACE',
      equipmentId: 'EQ-WIALON-RACE-OLD',
      imei: '869132070808689',
      protocol: 'WIALON IPS TCP',
      ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
      ingressSecretHash: TEST_GSM_INGRESS_SECRET_HASH,
    }],
    gsm_packets: [],
  });
  const gateway = createWialonIpsGateway({
    readData: memory.readData,
    writeDataBatch: memory.writeDataBatch,
    resolveTrustedDeviceScope: memory.resolveTrustedDeviceScope,
    withActorScope: (scope, operation) => {
      memory.state.gsm_devices = memory.state.gsm_devices.map(device => (
        device.id === 'GDEV-WIALON-RACE'
          ? { ...device, equipmentId: 'EQ-WIALON-RACE-NEW' }
          : device
      ));
      return memory.withActorScope(scope, operation);
    },
    getCurrentScope: memory.getCurrentScope,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    enabled: false,
  });

  assert.throws(
    () => gateway.processLine(`#L#869132070808689;${TEST_GSM_INGRESS_SECRET}`, { sourceIp: '127.0.0.1' }),
    error => error.code === 'GSM_DEVICE_BINDING_CHANGED' && error.status === 409,
  );
  assert.equal(memory.state.gsm_devices[0].equipmentId, 'EQ-WIALON-RACE-NEW');
  assert.equal(memory.state.gsm_devices[0].lastPacketAt, undefined);
  assert.equal(memory.state.gsm_packets.length, 0);
  assert.equal(memory.state.equipment.some(item => item.gsmLastSeenAt), false);
});

test('WIALON IPS connection must reconnect after its provisioned device is rebound', () => {
  const memory = createMemoryGateway({
    equipment: [
      { id: 'EQ-WIALON-CONNECTION-OLD' },
      { id: 'EQ-WIALON-CONNECTION-NEW' },
    ],
    gsm_devices: [{
      id: 'GDEV-WIALON-CONNECTION',
      equipmentId: 'EQ-WIALON-CONNECTION-OLD',
      imei: '869132070808689',
      protocol: 'WIALON IPS TCP',
      ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
      ingressSecretHash: TEST_GSM_INGRESS_SECRET_HASH,
    }],
  });
  const gateway = createWialonIpsGateway({
    readData: memory.readData,
    writeDataBatch: memory.writeDataBatch,
    resolveTrustedDeviceScope: memory.resolveTrustedDeviceScope,
    withActorScope: memory.withActorScope,
    getCurrentScope: memory.getCurrentScope,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    enabled: false,
  });
  const connection = { id: 'WIALON-CONNECTION-1', sourceIp: '127.0.0.1' };
  gateway.processLine(`#L#869132070808689;${TEST_GSM_INGRESS_SECRET}`, { connection });
  rebindMemoryDevice(memory, 'GDEV-WIALON-CONNECTION', 'EQ-WIALON-CONNECTION-NEW');
  const packetCount = memory.state.gsm_packets.length;

  assert.throws(
    () => gateway.processLine('#P#', { connection }),
    error => error.code === 'GSM_CONNECTION_BINDING_CHANGED' && error.status === 409,
  );
  assert.equal(memory.state.gsm_packets.length, packetCount);
});

test('WIALON IPS rejects an unprovisioned login without persisting telemetry', () => {
  const memory = createMemoryGateway({ equipment: [], gsm_devices: [], gsm_packets: [] });
  const gateway = createWialonIpsGateway({
    readData: memory.readData,
    writeDataBatch: memory.writeDataBatch,
    resolveTrustedDeviceScope: memory.resolveTrustedDeviceScope,
    withActorScope: memory.withActorScope,
    getCurrentScope: memory.getCurrentScope,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    enabled: false,
  });
  const before = structuredClone(memory.state);

  assert.throws(
    () => gateway.processLine('#L#869132070808689;', { sourceIp: '127.0.0.1' }),
    error => error.code === 'GSM_DEVICE_NOT_PROVISIONED',
  );
  assert.deepEqual(memory.state, before);
});

test('WIALON IPS rejects missing or wrong credentials and data before login', () => {
  const memory = createMemoryGateway({
    equipment: [{ id: 'EQ-WIALON-AUTH' }],
    gsm_devices: [provisionedDevice('EQ-WIALON-AUTH', {
      imei: '869132070808698',
      protocol: 'WIALON IPS TCP',
      ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
    })],
    gsm_packets: [],
  });
  const gateway = createWialonIpsGateway({
    readData: memory.readData,
    writeDataBatch: memory.writeDataBatch,
    resolveTrustedDeviceScope: memory.resolveTrustedDeviceScope,
    withActorScope: memory.withActorScope,
    getCurrentScope: memory.getCurrentScope,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    enabled: false,
  });

  for (const login of ['#L#869132070808698;', '#L#869132070808698;wrong-password']) {
    assert.throws(
      () => gateway.processLine(login, { connection: { id: 'WIALON-AUTH', sourceIp: '127.0.0.1' } }),
      error => error.code === 'GSM_DEVICE_CREDENTIAL_REJECTED' && error.status === 403,
    );
  }
  assert.throws(
    () => gateway.processLine('#P#', {
      connection: { id: 'WIALON-NO-LOGIN', sourceIp: '127.0.0.1', imei: '869132070808698' },
    }),
    error => error.code === 'GSM_DEVICE_AUTHENTICATION_REQUIRED' && error.status === 403,
  );
  assert.equal(memory.state.gsm_packets.length, 0);
});

test('WIALON IPS credential rotation invalidates an authenticated connection', () => {
  const memory = createMemoryGateway({
    equipment: [{ id: 'EQ-WIALON-ROTATE' }],
    gsm_devices: [provisionedDevice('EQ-WIALON-ROTATE', {
      imei: '869132070808697',
      protocol: 'WIALON IPS TCP',
      ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
    })],
    gsm_packets: [],
  });
  const gateway = createWialonIpsGateway({
    readData: memory.readData,
    writeDataBatch: memory.writeDataBatch,
    resolveTrustedDeviceScope: memory.resolveTrustedDeviceScope,
    withActorScope: memory.withActorScope,
    getCurrentScope: memory.getCurrentScope,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    enabled: false,
  });
  const connection = { id: 'WIALON-ROTATE', sourceIp: '127.0.0.1' };
  gateway.processLine(`#L#869132070808697;${TEST_GSM_INGRESS_SECRET}`, { connection });
  const packetCount = memory.state.gsm_packets.length;
  memory.state.gsm_devices = memory.state.gsm_devices.map(device => (
    device.id === 'GDEV-EQ-WIALON-ROTATE'
      ? { ...device, ingressSecretHash: hashGsmIngressSecret('rotated-wialon-secret') }
      : device
  ));

  assert.throws(
    () => gateway.processLine('#P#', { connection }),
    error => error.code === 'GSM_DEVICE_CREDENTIAL_CHANGED' && error.status === 409,
  );
  assert.equal(memory.state.gsm_packets.length, packetCount);
});

test('local WIALON IPS TCP smoke client receives ACK', async () => {
  const memory = createMemoryGateway({
    equipment: [{ id: 'EQ-WIALON', gsmImei: '869132070808689' }],
    gsm_devices: [{
      id: 'GDEV-WIALON',
      equipmentId: 'EQ-WIALON',
      imei: '869132070808689',
      protocol: 'WIALON IPS TCP',
      ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
      ingressSecretHash: TEST_GSM_INGRESS_SECRET_HASH,
    }],
    gsm_packets: [],
  });
  const { state } = memory;
  const gateway = createWialonIpsGateway({
    readData: memory.readData,
    writeDataBatch: memory.writeDataBatch,
    resolveTrustedDeviceScope: memory.resolveTrustedDeviceScope,
    withActorScope: memory.withActorScope,
    getCurrentScope: memory.getCurrentScope,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    host: '127.0.0.1',
    port: 0,
    enabled: true,
  });
  const server = await gateway.start();
  const { port } = server.address();

  const socket = net.createConnection({ host: '127.0.0.1', port });
  await once(socket, 'connect');
  socket.write(`#L#869132070808689;${TEST_GSM_INGRESS_SECRET}\r\n`);
  const [ack] = await once(socket, 'data');
  socket.destroy();
  await gateway.stop();

  assert.equal(ack.toString(), '#AL#1\r\n');
  assert.equal(state.gsm_packets.length, 1);
});

test('public TCP gateways share a global connection admission limit', async (t) => {
  const controller = createTcpIngressAdmissionController({
    maxConnections: 1,
    maxConnectionsPerIp: 1,
    preAuthTimeoutMs: 5_000,
  });
  const memory = createMemoryGateway({}, {
    host: '127.0.0.1',
    port: 0,
    tcpAdmissionController: controller,
  });
  const wialon = createWialonIpsGateway({
    readData: memory.readData,
    writeDataBatch: memory.writeDataBatch,
    resolveTrustedDeviceScope: memory.resolveTrustedDeviceScope,
    withActorScope: memory.withActorScope,
    getCurrentScope: memory.getCurrentScope,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    host: '127.0.0.1',
    port: 0,
    enabled: true,
    tcpAdmissionController: controller,
  });
  const gprsServer = await memory.gateway.start();
  const wialonServer = await wialon.start();
  t.after(async () => {
    await wialon.stop();
    await memory.gateway.stop();
  });

  const held = net.createConnection({ host: '127.0.0.1', port: gprsServer.address().port });
  held.on('error', () => {});
  await once(held, 'connect');
  await waitFor(() => controller.getStatus().activeConnections === 1);
  const rejected = net.createConnection({ host: '127.0.0.1', port: wialonServer.address().port });
  rejected.on('error', () => {});
  await once(rejected, 'connect');
  await once(rejected, 'close');
  assert.equal(controller.getStatus().rejectedConnections, 1);
  assert.equal(memory.state.gsm_packets.length, 0);
  held.destroy();
});

test('GPRS closes unauthenticated sockets at the pre-auth deadline', async (t) => {
  const warnings = [];
  const memory = createMemoryGateway({}, {
    host: '127.0.0.1',
    port: 0,
    preAuthTimeoutMs: 100,
    logger: { log: () => {}, warn: (...args) => warnings.push(args), error: () => {} },
  });
  const server = await memory.gateway.start();
  t.after(() => memory.gateway.stop());
  const socket = net.createConnection({ host: '127.0.0.1', port: server.address().port });
  socket.on('error', () => {});
  await once(socket, 'connect');
  await once(socket, 'close');
  assert.equal(warnings.some(([, details]) => details?.code === 'GSM_TCP_PREAUTH_TIMEOUT'), true);
  assert.equal(memory.state.gsm_packets.length, 0);
});

test('WIALON closes unauthenticated sockets at the pre-auth deadline', async (t) => {
  const warnings = [];
  const memory = createMemoryGateway({ gsm_packets: [] });
  const gateway = createWialonIpsGateway({
    readData: memory.readData,
    writeDataBatch: memory.writeDataBatch,
    resolveTrustedDeviceScope: memory.resolveTrustedDeviceScope,
    withActorScope: memory.withActorScope,
    getCurrentScope: memory.getCurrentScope,
    logger: { log: () => {}, warn: (...args) => warnings.push(args), error: () => {} },
    host: '127.0.0.1',
    port: 0,
    enabled: true,
    preAuthTimeoutMs: 100,
  });
  const server = await gateway.start();
  t.after(() => gateway.stop());
  const socket = net.createConnection({ host: '127.0.0.1', port: server.address().port });
  socket.on('error', () => {});
  await once(socket, 'connect');
  await once(socket, 'close');
  assert.equal(warnings.some(([, details]) => details?.code === 'GSM_TCP_PREAUTH_TIMEOUT'), true);
  assert.equal(memory.state.gsm_packets.length, 0);
});

test('GPRS auth admission rejects attempts before another credential check can persist', async (t) => {
  const controller = createTcpIngressAdmissionController({
    maxAuthAttemptsPerMinute: 1,
    maxAuthAttemptsPerIpPerMinute: 1,
    preAuthTimeoutMs: 5_000,
  });
  const memory = createMemoryGateway({
    equipment: [{ id: 'EQ-AUTH-BOUND' }],
    gsm_devices: [provisionedDevice('EQ-AUTH-BOUND', {
      imei: '860000000000881',
      protocol: 'GPRS TCP',
      ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
    })],
  }, {
    host: '127.0.0.1',
    port: 0,
    tcpAdmissionController: controller,
  });
  const server = await memory.gateway.start();
  t.after(() => memory.gateway.stop());

  for (const secret of ['wrong-device-secret', TEST_GSM_INGRESS_SECRET]) {
    const socket = net.createConnection({ host: '127.0.0.1', port: server.address().port });
    socket.on('error', () => {});
    await once(socket, 'connect');
    socket.write(`IMEI:860000000000881 ingressSecret=${secret} LAT:55.7 LNG:49.1`);
    await once(socket, 'close');
  }
  assert.equal(controller.getStatus().rejectedAuthAttempts, 1);
  assert.equal(memory.state.gsm_packets.length, 0);
});

test('WIALON rejects oversized unterminated lines without buffering or persistence', async (t) => {
  const warnings = [];
  const memory = createMemoryGateway({ gsm_packets: [] });
  const gateway = createWialonIpsGateway({
    readData: memory.readData,
    writeDataBatch: memory.writeDataBatch,
    resolveTrustedDeviceScope: memory.resolveTrustedDeviceScope,
    withActorScope: memory.withActorScope,
    getCurrentScope: memory.getCurrentScope,
    logger: { log: () => {}, warn: (...args) => warnings.push(args), error: () => {} },
    host: '127.0.0.1',
    port: 0,
    enabled: true,
    maxLineBytes: 32,
    preAuthTimeoutMs: 5_000,
  });
  const server = await gateway.start();
  t.after(() => gateway.stop());
  const socket = net.createConnection({ host: '127.0.0.1', port: server.address().port });
  socket.on('error', () => {});
  await once(socket, 'connect');
  socket.write('X'.repeat(33));
  await once(socket, 'close');
  assert.equal(warnings.some(([, details]) => details?.code === 'GSM_TCP_LINE_TOO_LARGE'), true);
  assert.equal(memory.state.gsm_packets.length, 0);
  assert.equal(gateway.getStatus().ingressProtection.activeConnections, 0);
});

test('public TCP gateways enforce one shared telemetry budget before parsing or persistence', async (t) => {
  const controller = createTcpIngressAdmissionController({
    maxPacketsPerMinute: 1,
    maxPacketsPerIpPerMinute: 10,
    maxBytesPerMinute: 1024,
    maxBytesPerIpPerMinute: 1024,
    preAuthTimeoutMs: 5_000,
  });
  const memory = createMemoryGateway({
    equipment: [
      { id: 'EQ-SHARED-GPRS' },
      { id: 'EQ-SHARED-WIALON' },
    ],
    gsm_devices: [
      provisionedDevice('EQ-SHARED-GPRS', {
        id: 'GDEV-SHARED-GPRS',
        imei: '860000000000882',
        deviceId: '860000000000882',
        protocol: 'GPRS TCP',
        ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
      }),
      provisionedDevice('EQ-SHARED-WIALON', {
        id: 'GDEV-SHARED-WIALON',
        imei: '860000000000883',
        deviceId: '860000000000883',
        protocol: 'WIALON IPS TCP',
        ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
      }),
    ],
    gsm_packets: [],
  }, {
    host: '127.0.0.1',
    port: 0,
    tcpAdmissionController: controller,
  });
  const wialon = createWialonIpsGateway({
    readData: memory.readData,
    writeDataBatch: memory.writeDataBatch,
    resolveTrustedDeviceScope: memory.resolveTrustedDeviceScope,
    withActorScope: memory.withActorScope,
    getCurrentScope: memory.getCurrentScope,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    host: '127.0.0.1',
    port: 0,
    enabled: true,
    tcpAdmissionController: controller,
  });
  const gprsServer = await memory.gateway.start();
  const wialonServer = await wialon.start();
  t.after(async () => {
    await wialon.stop();
    await memory.gateway.stop();
  });

  const gprsSocket = net.createConnection({ host: '127.0.0.1', port: gprsServer.address().port });
  gprsSocket.on('error', () => {});
  await once(gprsSocket, 'connect');
  gprsSocket.write(`IMEI:860000000000882 ingressSecret=${TEST_GSM_INGRESS_SECRET} LAT:55.7 LNG:49.1`);
  await waitFor(() => memory.state.gsm_packets.length === 1);
  gprsSocket.destroy();

  const wialonSocket = net.createConnection({ host: '127.0.0.1', port: wialonServer.address().port });
  wialonSocket.on('error', () => {});
  await once(wialonSocket, 'connect');
  wialonSocket.write(`#L#860000000000883;${TEST_GSM_INGRESS_SECRET}\r\n`);
  await once(wialonSocket, 'close');

  assert.equal(memory.state.gsm_packets.length, 1);
  assert.equal(memory.state.gsm_packets[0].gsmDeviceRecordId, 'GDEV-SHARED-GPRS');
  assert.equal(controller.getStatus().rejectedTelemetryPackets, 1);
});

test('GPRS per-connection rate rejection never persists outside the shared admission path', async (t) => {
  const warnings = [];
  const memory = createMemoryGateway({
    equipment: [{ id: 'EQ-CONNECTION-RATE' }],
    gsm_devices: [provisionedDevice('EQ-CONNECTION-RATE', {
      imei: '860000000000884',
      protocol: 'GPRS TCP',
      ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
    })],
    gsm_packets: [],
  }, {
    host: '127.0.0.1',
    port: 0,
    maxPacketsPerMinute: 1,
    logger: { log: () => {}, warn: (...args) => warnings.push(args), error: () => {} },
  });
  const server = await memory.gateway.start();
  t.after(() => memory.gateway.stop());
  const socket = net.createConnection({ host: '127.0.0.1', port: server.address().port });
  socket.on('error', () => {});
  await once(socket, 'connect');
  socket.write(`IMEI:860000000000884 ingressSecret=${TEST_GSM_INGRESS_SECRET} LAT:55.7 LNG:49.1`);
  await waitFor(() => memory.state.gsm_packets.length === 1);
  socket.write('IMEI:860000000000884 LAT:55.8 LNG:49.2');
  await once(socket, 'close');

  assert.equal(memory.state.gsm_packets.length, 1);
  assert.equal(
    warnings.some(([, details]) => details?.code === 'GSM_TCP_CONNECTION_PACKET_RATE_LIMIT'),
    true,
  );
});

test('gateway transport limits clamp invalid options to finite positive values', () => {
  const memory = createMemoryGateway({}, {
    maxPacketBytes: Number.NaN,
    maxPacketsPerMinute: Number.POSITIVE_INFINITY,
    connectionTimeoutMs: -1,
  });
  const gprsLimits = memory.gateway.getStatus().transportLimits;
  const wialon = createWialonIpsGateway({
    readData: memory.readData,
    writeDataBatch: memory.writeDataBatch,
    resolveTrustedDeviceScope: memory.resolveTrustedDeviceScope,
    withActorScope: memory.withActorScope,
    getCurrentScope: memory.getCurrentScope,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    enabled: false,
    maxLineBytes: Number.NEGATIVE_INFINITY,
    maxPacketsPerMinute: 0,
    connectionTimeoutMs: Number.NaN,
  });
  const wialonLimits = wialon.getStatus().transportLimits;

  for (const value of [...Object.values(gprsLimits), ...Object.values(wialonLimits)]) {
    assert.equal(Number.isSafeInteger(value), true);
    assert.equal(value > 0, true);
  }
});

test('too large packet is stored as failed and does not break next packet', () => {
  const { gateway, state } = createMemoryGateway({
    equipment: [{ id: 'EQ-LARGE', gsmImei: '866123456789012' }],
    gsm_devices: [provisionedDevice('EQ-LARGE', {
      imei: '866123456789012',
      deviceId: '866123456789012',
    })],
  }, { maxPacketBytes: 8 });
  const connection = { imei: '866123456789012', deviceId: '866123456789012' };

  const oversized = gateway.processRawPacket(Buffer.from('123456789'), { sourceIp: '10.0.0.13', connection });
  const normal = gateway.processRawPacket(Buffer.from('PING'), { sourceIp: '10.0.0.13', connection });

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
    gsm_devices: [
      provisionedDevice('EQ-1', { deviceId: 'T1' }),
      provisionedDevice('EQ-2', { deviceId: 'T2' }),
    ],
    gsm_packets: [
      {
        id: 'P1',
        direction: 'inbound',
        equipmentId: 'EQ-1',
        gsmDeviceRecordId: 'GDEV-EQ-1',
        gsmBindingRevision: 1,
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
        gsmDeviceRecordId: 'GDEV-EQ-1',
        gsmBindingRevision: 1,
        deviceId: 'T1',
        status: 'sent',
        createdAt: recent,
      },
      {
        id: 'C2',
        equipmentId: 'EQ-2',
        gsmDeviceRecordId: 'GDEV-EQ-2',
        gsmBindingRevision: 1,
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

test('future server timestamps do not inflate GSM status or analytics', () => {
  const now = Date.now();
  const recent = new Date(now - 5 * 60 * 1000).toISOString();
  const future = new Date(now + 60 * 60 * 1000).toISOString();
  const device = provisionedDevice('EQ-FUTURE-ANALYTICS', { deviceId: 'DEVICE-FUTURE-ANALYTICS' });
  const binding = {
    equipmentId: 'EQ-FUTURE-ANALYTICS',
    gsmDeviceRecordId: device.id,
    gsmBindingRevision: device.bindingRevision,
    deviceId: device.deviceId,
  };
  const { gateway } = createMemoryGateway({
    equipment: [{
      id: 'EQ-FUTURE-ANALYTICS',
      gsmLastSeenAt: future,
      gsmLastSignalAt: future,
    }],
    gsm_devices: [device],
    gsm_packets: [
      { id: 'P-FUTURE-ANALYTICS', ...binding, parseStatus: 'parsed', receivedAt: future },
      { id: 'P-RECENT-ANALYTICS', ...binding, parseStatus: 'parsed', receivedAt: recent },
    ],
  });

  const status = gateway.getStatus();
  const analytics = gateway.getAnalytics({ equipmentId: binding.equipmentId });

  assert.equal(status.packetsToday, 1);
  assert.equal(status.lastPacketAt, recent);
  assert.equal(analytics.packets24h, 1);
  assert.equal(analytics.selected.packets24h, 1);
  assert.equal(analytics.selected.lastPacketAt, recent);
  assert.equal(analytics.staleTrackers, 0);
  assert.equal(analytics.onlineTrackedEquipment, 1);
});

test('outbound-only history cannot become a fresh backend or composed UI gateway signal', async (t) => {
  const observedAtMs = Date.now();
  const recent = new Date(observedAtMs - 1_000).toISOString();
  const memory = createMemoryGateway({
    gsm_packets: [
      {
        id: 'P-OUTBOUND-GENERIC',
        direction: 'outbound',
        protocol: 'generic-text',
        receivedAt: recent,
      },
      {
        id: 'P-OUTBOUND-WIALON',
        direction: 'outbound',
        protocol: 'wialon-ips',
        receivedAt: recent,
      },
      {
        id: 'P-UNTRUSTED-INBOUND',
        direction: 'inbound',
        protocol: 'generic-text',
        receivedAt: recent,
      },
    ],
  }, {
    enabled: true,
    host: '127.0.0.1',
    port: 0,
  });
  const wialon = createWialonIpsGateway({
    readData: memory.readData,
    writeDataBatch: memory.writeDataBatch,
    resolveTrustedDeviceScope: memory.resolveTrustedDeviceScope,
    withActorScope: memory.withActorScope,
    getCurrentScope: memory.getCurrentScope,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    enabled: true,
    host: '127.0.0.1',
    port: 0,
  });
  t.after(async () => {
    await Promise.all([memory.gateway.stop(), wialon.stop()]);
  });
  await Promise.all([memory.gateway.start(), wialon.start()]);

  const gprsStatus = memory.gateway.getStatus();
  const wialonStatus = wialon.getStatus();
  assert.equal(gprsStatus.lastPacketAt, null);
  assert.equal(gprsStatus.packetsToday, 0);
  assert.equal(wialonStatus.lastPacketAt, null);
  assert.equal(wialonStatus.packetsToday, 0);

  const composite = aggregateGsmGatewayStatus([
    { key: 'gprs', status: gprsStatus },
    { key: 'wialon-ips', status: wialonStatus },
  ], observedAtMs);
  assert.equal(composite.lastPacketAt, null);
  assert.equal(deriveGsmGatewayOperationalState(
    composite,
    memory.readData('gsm_packets').map(packet => ({ ...packet, bindingVerified: false })),
    [],
    { nowMs: observedAtMs },
  ).label, 'Нет свежих данных');
});

test('production GSM read policy includes the service foreman role', async () => {
  const source = await readFile(new URL('../server/server.js', import.meta.url), 'utf8');
  for (const collection of ['gsm_devices', 'gsm_packets', 'gsm_commands']) {
    assert.match(
      source,
      new RegExp(`${collection}: \\[[^\\n]+SERVICE_FOREMAN_ROLE`),
      collection,
    );
  }
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
