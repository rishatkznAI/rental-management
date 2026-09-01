import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveGsmGatewayOperationalState } from '../src/app/lib/gsmGatewayOperationalState.js';
import { GSM_ONLINE_WINDOW_MS } from '../src/app/lib/gsmSignalState.js';

const NOW = Date.parse('2026-08-30T12:00:00.000Z');
const enabledStatus = {
  gatewayEnabled: true,
  disabled: false,
  startError: '',
  connectionsActive: 0,
  onlineConnections: 0,
  packetsToday: 0,
  packetsReceivedTotal: 0,
  lastPacketAt: null,
};

test('gateway reports connected only for a fresh non-future server timestamp', () => {
  assert.equal(deriveGsmGatewayOperationalState({
    ...enabledStatus,
    packetsReceivedTotal: 100,
    lastPacketAt: new Date(NOW - GSM_ONLINE_WINDOW_MS).toISOString(),
  }, [], [], { nowMs: NOW }).label, 'Подключено');

  assert.equal(deriveGsmGatewayOperationalState({
    ...enabledStatus,
    packetsReceivedTotal: 100,
    lastPacketAt: new Date(NOW - GSM_ONLINE_WINDOW_MS - 1).toISOString(),
  }, [], [], { nowMs: NOW }).label, 'Нет свежих данных');

  assert.equal(deriveGsmGatewayOperationalState({
    ...enabledStatus,
    packetsReceivedTotal: 100,
    lastPacketAt: new Date(NOW + 1).toISOString(),
  }, [], [], { nowMs: NOW }).label, 'Нет свежих данных');
});

test('stale and future retained packets never create a success gateway state', () => {
  const stale = { receivedAt: new Date(NOW - GSM_ONLINE_WINDOW_MS - 1).toISOString() };
  const future = { receivedAt: new Date(NOW + 60_000).toISOString() };
  assert.equal(deriveGsmGatewayOperationalState(
    enabledStatus,
    [stale, future],
    [],
    { nowMs: NOW },
  ).label, 'Нет свежих данных');
});

test('fresh outbound history never proves inbound gateway connectivity', () => {
  const outbound = {
    direction: 'outbound',
    receivedAt: new Date(NOW - 1_000).toISOString(),
  };
  assert.equal(deriveGsmGatewayOperationalState(
    { ...enabledStatus, packetsReceivedTotal: 1 },
    [outbound],
    [],
    { nowMs: NOW },
  ).label, 'Нет свежих данных');
});

test('only explicitly current verified recent packets may prove gateway connectivity', () => {
  const receivedAt = new Date(NOW - 1_000).toISOString();
  const unverified = { direction: 'inbound', bindingVerified: false, receivedAt };
  const legacy = { direction: 'inbound', receivedAt };
  const verified = { direction: 'inbound', bindingVerified: true, receivedAt };

  assert.equal(deriveGsmGatewayOperationalState(
    enabledStatus,
    [unverified, legacy],
    [],
    { nowMs: NOW },
  ).label, 'Нет свежих данных');
  assert.equal(deriveGsmGatewayOperationalState(
    enabledStatus,
    [verified],
    [],
    { nowMs: NOW },
  ).label, 'Подключено');
});

test('active connection without a fresh packet remains in waiting state', () => {
  assert.equal(deriveGsmGatewayOperationalState({
    ...enabledStatus,
    connectionsActive: 1,
    packetsReceivedTotal: 20,
  }, [], [], { nowMs: NOW }).label, 'Ожидает пакеты');
});
