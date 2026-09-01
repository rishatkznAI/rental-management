import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GSM_ONLINE_WINDOW_MS,
  deriveEquipmentGsmSignalState,
  deriveGsmPacketSignalState,
  getEquipmentGsmSaleValue,
  hasMeaningfulEquipmentGsmData,
  hasVerifiedGsmDeviceForEquipment,
  hasUsableGsmCoordinates,
  hasUsableGsmPacketCoordinates,
  isGsmTimestampWithinWindow,
  selectLatestGsmLocationPacket,
  selectLatestNonFutureGsmPacket,
  selectLatestParsedGsmPacket,
} from '../src/app/lib/gsmSignalState.js';

const NOW = Date.parse('2026-08-30T12:00:00.000Z');

test('GSM signal state requires fresh telemetry before reporting online', () => {
  assert.equal(deriveEquipmentGsmSignalState({
    gsmStatus: 'online',
    gsmSignalStatus: 'online',
    gsmLastSeenAt: new Date(NOW - GSM_ONLINE_WINDOW_MS - 1).toISOString(),
  }, null, { nowMs: NOW }), 'offline');

  assert.equal(deriveEquipmentGsmSignalState({
    gsmStatus: 'offline',
    gsmLastSignalAt: new Date(NOW - GSM_ONLINE_WINDOW_MS).toISOString(),
  }, null, { nowMs: NOW }), 'online');
});

test('persisted online without a trustworthy timestamp fails closed', () => {
  assert.equal(deriveEquipmentGsmSignalState({
    gsmStatus: 'online',
    gsmSignalStatus: 'online',
  }, null, { nowMs: NOW }), 'offline');

  assert.equal(deriveEquipmentGsmSignalState({
    gsmStatus: 'online',
  }, '2026-08-30T11:30:00.000Z', { nowMs: NOW }), 'location_only');

  assert.equal(deriveEquipmentGsmSignalState({
    gsmStatus: 'online',
    gsmLastSeenAt: new Date(NOW + 1).toISOString(),
  }, null, { nowMs: NOW }), 'offline');
});

test('raw GSM packet markers are online only inside the freshness window', () => {
  assert.equal(deriveGsmPacketSignalState({
    receivedAt: new Date(NOW - GSM_ONLINE_WINDOW_MS).toISOString(),
  }, { nowMs: NOW }), 'online');

  assert.equal(deriveGsmPacketSignalState({
    receivedAt: new Date(NOW - GSM_ONLINE_WINDOW_MS - 1).toISOString(),
  }, { nowMs: NOW }), 'offline');

  assert.equal(deriveGsmPacketSignalState({ createdAt: '' }, { nowMs: NOW }), 'offline');
  assert.equal(deriveGsmPacketSignalState({
    receivedAt: new Date(NOW + 1).toISOString(),
  }, { nowMs: NOW }), 'offline');
});

test('neutral unknown statuses do not resurrect a retired GSM projection', () => {
  assert.equal(hasMeaningfulEquipmentGsmData({
    gsmStatus: 'unknown',
    gsmSignalStatus: 'unknown',
  }), false);
  assert.equal(hasMeaningfulEquipmentGsmData({
    gsmStatus: 'unknown',
    gsmDeviceRecordId: 'GDEV-ACTIVE',
  }), true);
  assert.equal(hasMeaningfulEquipmentGsmData({ gsmStatus: 'offline' }), true);
});

test('Sales GSM summary is neutral unless backend verified the current binding', () => {
  const freshAt = new Date(NOW - 1_000).toISOString();
  assert.equal(getEquipmentGsmSaleValue({
    gsmDeviceRecordId: 'GDEV-DANGLING',
    gsmBindingVerified: false,
    gsmImei: '860000000000088',
    gsmStatus: 'online',
    gsmLastSeenAt: freshAt,
  }, { nowMs: NOW }), 'Непроверенные данные');
  assert.equal(getEquipmentGsmSaleValue({
    gsmDeviceRecordId: 'GDEV-VERIFIED',
    gsmBindingVerified: true,
    gsmImei: '860000000000088',
    gsmStatus: 'offline',
    gsmLastSeenAt: freshAt,
  }, { nowMs: NOW }), 'IMEI/ID 860000000000088 · Онлайн');
});

test('equipment detail trusts only a stable positive-revision device for the exact equipment', () => {
  assert.equal(hasVerifiedGsmDeviceForEquipment(null, 'EQ-1'), false);
  assert.equal(hasVerifiedGsmDeviceForEquipment({ id: 'GDEV-1', equipmentId: 'EQ-1' }, 'EQ-1'), false);
  assert.equal(hasVerifiedGsmDeviceForEquipment({ id: 'GDEV-1', equipmentId: 'EQ-2', bindingRevision: 1 }, 'EQ-1'), false);
  assert.equal(hasVerifiedGsmDeviceForEquipment({ id: 'GDEV-1', equipmentId: 'EQ-1', bindingRevision: 1 }, 'EQ-1'), true);
});

test('map coordinates require a parsed packet and a valid non-zero coordinate pair', () => {
  assert.equal(hasUsableGsmCoordinates(55.796, 49.108), true);
  assert.equal(hasUsableGsmCoordinates(0, 0), false);
  assert.equal(hasUsableGsmCoordinates(91, 49.108), false);
  assert.equal(hasUsableGsmCoordinates(55.796, -181), false);
  assert.equal(hasUsableGsmPacketCoordinates({
    parseStatus: 'parsed',
    lat: 55.796,
    lng: 49.108,
  }), true);
  assert.equal(hasUsableGsmPacketCoordinates({
    parseStatus: 'failed',
    lat: 55.796,
    lng: 49.108,
  }), false);
});

test('route freshness rejects invalid and future timestamps', () => {
  assert.equal(isGsmTimestampWithinWindow(
    new Date(NOW - 24 * 60 * 60 * 1000).toISOString(),
    { nowMs: NOW, windowMs: 24 * 60 * 60 * 1000 },
  ), true);
  assert.equal(isGsmTimestampWithinWindow(
    new Date(NOW + 1).toISOString(),
    { nowMs: NOW, windowMs: 24 * 60 * 60 * 1000 },
  ), false);
  assert.equal(isGsmTimestampWithinWindow('not-a-date', { nowMs: NOW }), false);
});

test('equipment detail selectors separate contact, parsed telemetry, and valid location truth', () => {
  const packets = [
    { id: 'future', parseStatus: 'parsed', receivedAt: new Date(NOW + 1).toISOString(), lat: 60, lng: 60, voltage: 999 },
    { id: 'failed', parseStatus: 'failed', receivedAt: new Date(NOW - 1_000).toISOString(), lat: 59, lng: 59, voltage: 998 },
    { id: 'invalid', parseStatus: 'parsed', receivedAt: new Date(NOW - 2_000).toISOString(), lat: 91, lng: 49, voltage: 12.9 },
    { id: 'valid', parseStatus: 'parsed', receivedAt: new Date(NOW - 3_000).toISOString(), lat: 55.7, lng: 49.1, voltage: 12.8 },
  ];

  assert.equal(selectLatestNonFutureGsmPacket(packets, { nowMs: NOW }).id, 'failed');
  assert.equal(selectLatestParsedGsmPacket(packets, { nowMs: NOW }).id, 'invalid');
  assert.equal(selectLatestGsmLocationPacket(packets, { nowMs: NOW }).id, 'valid');
});

test('equipment detail operational selectors never treat outbound command packets as telemetry', () => {
  const packets = [
    {
      id: 'inbound',
      direction: 'inbound',
      parseStatus: 'parsed',
      receivedAt: new Date(NOW - 2_000).toISOString(),
      lat: 55.7,
      lng: 49.1,
      voltage: 12.8,
    },
    {
      id: 'outbound-newer',
      direction: 'outbound',
      parseStatus: 'parsed',
      receivedAt: new Date(NOW - 1_000).toISOString(),
      lat: 60,
      lng: 60,
      voltage: 999,
    },
  ];

  assert.equal(selectLatestNonFutureGsmPacket(packets, { nowMs: NOW }).id, 'inbound');
  assert.equal(selectLatestParsedGsmPacket(packets, { nowMs: NOW }).id, 'inbound');
  assert.equal(selectLatestGsmLocationPacket(packets, { nowMs: NOW }).id, 'inbound');
});
