import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  aggregateGsmGatewayConnections,
  aggregateGsmGatewayStatus,
} = require('../server/lib/gsm/gateway-runtime-view.js');

test('composite GSM status exposes Wialon-only runtime metrics when GPRS is disabled', () => {
  const status = aggregateGsmGatewayStatus([
    {
      key: 'gprs',
      status: {
        gatewayEnabled: false,
        enabled: false,
        disabled: true,
        host: '0.0.0.0',
        port: 5023,
        uptimeSeconds: 0,
        onlineDevices: 0,
        packetsToday: 0,
      },
    },
    {
      key: 'wialon-ips',
      status: {
        gatewayEnabled: true,
        enabled: true,
        disabled: false,
        host: '127.0.0.1',
        port: 5050,
        startedAt: '2026-08-30T10:00:00.000Z',
        uptimeSeconds: 321,
        connectionsActive: 2,
        onlineConnections: 2,
        onlineDevices: 2,
        packetsReceivedTotal: 8,
        packetsStored: 8,
        packetsToday: 7,
        lastPacketAt: '2026-08-30T10:05:00.000Z',
      },
    },
  ], Date.parse('2026-08-30T10:06:00.000Z'));

  assert.equal(status.gatewayEnabled, true);
  assert.equal(status.disabled, false);
  assert.equal(status.host, '127.0.0.1');
  assert.equal(status.port, 5050);
  assert.equal(status.uptimeSeconds, 321);
  assert.equal(status.onlineDevices, 2);
  assert.equal(status.packetsToday, 7);
  assert.equal(status.lastPacketAt, '2026-08-30T10:05:00.000Z');
});

test('healthy Wialon runtime keeps a failed GPRS runtime as partial degradation, not fatal status', () => {
  const status = aggregateGsmGatewayStatus([
    {
      key: 'gprs',
      status: {
        gatewayEnabled: false,
        enabled: false,
        disabled: false,
        startError: 'listen EADDRINUSE 0.0.0.0:5023',
      },
    },
    {
      key: 'wialon-ips',
      status: {
        gatewayEnabled: true,
        enabled: true,
        disabled: false,
        host: '0.0.0.0',
        port: 5050,
        connectionsActive: 1,
        onlineConnections: 1,
        onlineDevices: 1,
      },
    },
  ]);

  assert.equal(status.startError, '');
  assert.equal(status.partialDegradation, true);
  assert.deepEqual(status.runtimeErrors, [
    { runtime: 'gprs', error: 'listen EADDRINUSE 0.0.0.0:5023' },
  ]);
  assert.equal(status.connectionsActive, 1);
});

test('composite GSM status reports a fatal start error only when no runtime is healthy', () => {
  const status = aggregateGsmGatewayStatus([
    { key: 'gprs', status: { enabled: false, startError: 'gprs failed' } },
    { key: 'wialon-ips', status: { enabled: false, startError: 'wialon failed' } },
  ]);

  assert.equal(status.startError, 'gprs failed | wialon failed');
  assert.equal(status.partialDegradation, false);
});

test('composite GSM connections preserve runtime provenance and unique IDs', () => {
  const connections = aggregateGsmGatewayConnections([
    { key: 'gprs', connections: [{ id: 'same', lastSeenAt: '2026-08-30T10:00:00.000Z' }] },
    { key: 'wialon-ips', connections: [{ id: 'same', lastSeenAt: '2026-08-30T10:01:00.000Z' }] },
  ]);

  assert.deepEqual(connections.map(item => item.id), ['wialon-ips:same', 'gprs:same']);
  assert.deepEqual(connections.map(item => item.runtime), ['wialon-ips', 'gprs']);
});

test('composite GSM status deduplicates one stable device connected through two runtimes', () => {
  const status = aggregateGsmGatewayStatus([
    { key: 'gprs', status: { enabled: true, gatewayEnabled: true, onlineDevices: 1 } },
    { key: 'wialon-ips', status: { enabled: true, gatewayEnabled: true, onlineDevices: 1 } },
  ], Date.now(), [
    { key: 'gprs', connections: [{ gsmDeviceRecordId: 'GDEV-1', isOnline: true }] },
    { key: 'wialon-ips', connections: [{ gsmDeviceRecordId: 'GDEV-1', isOnline: true }] },
  ]);

  assert.equal(status.onlineDevices, 1);
});

test('composite GSM status pairs maximum uptime with the earliest runtime start', () => {
  const now = Date.parse('2026-08-30T12:00:00.000Z');
  const status = aggregateGsmGatewayStatus([
    { key: 'gprs', status: { enabled: true, gatewayEnabled: true, startedAt: '2026-08-30T10:00:00.000Z', uptimeSeconds: 7200 } },
    { key: 'wialon-ips', status: { enabled: true, gatewayEnabled: true, startedAt: '2026-08-30T11:00:00.000Z', uptimeSeconds: 3600 } },
  ], now);

  assert.equal(status.startedAt, '2026-08-30T10:00:00.000Z');
  assert.equal(status.uptimeSeconds, 7200);
  assert.deepEqual(status.activeRuntimes.map(item => item.key), ['gprs', 'wialon-ips']);
});
