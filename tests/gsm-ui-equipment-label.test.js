import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGsmEquipmentLabel,
  buildGsmEquipmentLookup,
  getGsmCoordinateStatus,
  resolveGsmPacketEquipment,
} from '../src/app/lib/gsmEquipmentLabel.js';

test('linked GSM packet shows equipment label', () => {
  const lookup = buildGsmEquipmentLookup([
    {
      equipment: {
        id: 'EQ-1',
        model: 'GSM-SMOKE-20260517T062141Z',
        inventoryNumber: 'INV-260517',
        serialNumber: 'SN-260517',
        gsmImei: '990000260517062',
      },
    },
  ], [
    {
      id: 'GSM-DEVICE-1',
      equipmentId: 'EQ-1',
      bindingRevision: 3,
      imei: '990000260517062',
    },
  ]);

  const resolved = resolveGsmPacketEquipment({
    equipmentId: 'EQ-1',
    gsmDeviceRecordId: 'GSM-DEVICE-1',
    gsmBindingRevision: 3,
    imei: '990000260517062',
  }, lookup);

  assert.equal(resolved.linked, true);
  assert.equal(resolved.equipmentId, 'EQ-1');
  assert.equal(resolved.badge, 'Привязано');
  assert.equal(resolved.label, 'GSM-SMOKE-20260517T062141Z · INV-260517 · SN-260517');
});

test('linked GSM packet without model falls back to inventory and equipmentId', () => {
  assert.equal(
    buildGsmEquipmentLabel({ id: 'EQ-FALLBACK', inventoryNumber: 'EQ-INV-1' }, 'EQ-FALLBACK'),
    'INV EQ-INV-1',
  );

  assert.equal(buildGsmEquipmentLabel({}, 'EQ-FALLBACK'), 'EQ-FALLBACK');
});

test('orphan GSM packet shows unlinked equipment label', () => {
  const resolved = resolveGsmPacketEquipment({ imei: 'UNKNOWN-IMEI' }, buildGsmEquipmentLookup([], []));

  assert.equal(resolved.linked, false);
  assert.equal(resolved.label, 'Техника не привязана');
  assert.equal(resolved.badge, 'Неизвестный трекер');
});

test('unknown IMEI GSM packet never shows undefined or null labels', () => {
  const resolved = resolveGsmPacketEquipment({ imei: 'UNKNOWN-IMEI', equipmentLabel: null }, buildGsmEquipmentLookup([], []));

  assert.equal(resolved.label.includes('undefined'), false);
  assert.equal(resolved.label.includes('null'), false);
  assert.equal(resolved.label.includes('[object Object]'), false);
});

test('equipmentId-only packet keeps a defensive label but cannot become trusted or suppress current status', () => {
  const lookup = buildGsmEquipmentLookup([
    {
      equipment: {
        id: 'EQ-SNAPSHOT',
        name: 'Snapshot loader',
        inventoryNumber: 'SNAP-1',
      },
    },
  ]);

  const resolved = resolveGsmPacketEquipment({ equipmentId: 'EQ-SNAPSHOT' }, lookup);

  assert.equal(resolved.linked, false);
  assert.equal(resolved.equipmentId, '');
  assert.equal(resolved.badge, 'Непроверенная привязка');
  assert.equal(resolved.label, 'Snapshot loader · INV SNAP-1');
});

test('GSM UI equipment label is defensive for empty equipment objects', () => {
  assert.equal(buildGsmEquipmentLabel({}), 'Техника не привязана');
  assert.equal(buildGsmEquipmentLabel(null, ''), 'Техника не привязана');
  assert.equal(buildGsmEquipmentLabel({ model: undefined, inventoryNumber: null, serialNumber: {} }), 'Техника не привязана');
});

test('GSM packet with Mantall equipmentId shows full equipment label', () => {
  const lookup = buildGsmEquipmentLookup([
    {
      equipment: {
        id: 'EQ-MANTALL-001',
        manufacturer: 'Mantall',
        model: 'XE160WCT',
        inventoryNumber: '001',
        serialNumber: '03311273',
        gsmDeviceId: '990999260517062',
      },
    },
  ], [
    {
      id: 'GSM-DEVICE-MANTALL',
      equipmentId: 'EQ-MANTALL-001',
      bindingRevision: 2,
      deviceId: '990999260517062',
    },
  ]);

  const resolved = resolveGsmPacketEquipment({
    equipmentId: 'EQ-MANTALL-001',
    gsmDeviceRecordId: 'GSM-DEVICE-MANTALL',
    gsmBindingRevision: 2,
    deviceId: '990999260517062',
  }, lookup);

  assert.equal(resolved.linked, true);
  assert.equal(resolved.equipmentId, 'EQ-MANTALL-001');
  assert.equal(resolved.label, 'Mantall XE160WCT · INV 001 · SN 03311273');
});

test('tracker, deviceId, and IMEI aliases remain display-only and cannot suppress current status', () => {
  const lookup = buildGsmEquipmentLookup([
    {
      equipment: {
        id: 'EQ-MANTALL-001',
        manufacturer: 'Mantall',
        model: 'XE160WCT',
        inventoryNumber: '001',
        serialNumber: '03311273',
        gsmDeviceId: '990999260517062',
      },
    },
  ], [
    {
      id: 'GSM-DEVICE-MANTALL',
      equipmentId: 'EQ-MANTALL-001',
      bindingRevision: 2,
      imei: 'IMEI-MANTALL',
      deviceId: 'DEVICE-MANTALL',
      trackerId: 'TRACKER-MANTALL',
    },
  ]);

  for (const packet of [
    { deviceId: 'DEVICE-MANTALL' },
    { trackerId: 'TRACKER-MANTALL' },
    { imei: 'IMEI-MANTALL' },
  ]) {
    const resolved = resolveGsmPacketEquipment(packet, lookup);
    assert.equal(resolved.linked, false);
    assert.equal(resolved.equipmentId, '');
    assert.equal(resolved.badge, 'Непроверенная привязка');
    assert.equal(resolved.label, 'Mantall XE160WCT · INV 001 · SN 03311273');
  }
});

test('stable GSM binding must match packet equipment and a positive exact revision', () => {
  const lookup = buildGsmEquipmentLookup([
    { equipment: { id: 'EQ-1', model: 'Current loader' } },
    { equipment: { id: 'EQ-2', model: 'Other loader' } },
  ], [
    {
      id: 'GSM-DEVICE-1',
      equipmentId: 'EQ-1',
      bindingRevision: 4,
      imei: 'IMEI-1',
    },
  ]);

  for (const packet of [
    { equipmentId: 'EQ-1', gsmDeviceRecordId: 'GSM-DEVICE-1' },
    { equipmentId: 'EQ-1', gsmDeviceRecordId: 'GSM-DEVICE-1', gsmBindingRevision: 0 },
    { equipmentId: 'EQ-1', gsmDeviceRecordId: 'GSM-DEVICE-1', gsmBindingRevision: 3 },
    { equipmentId: 'EQ-1', gsmDeviceRecordId: 'OTHER-DEVICE', gsmBindingRevision: 4 },
    { equipmentId: 'EQ-2', gsmDeviceRecordId: 'GSM-DEVICE-1', gsmBindingRevision: 4 },
  ]) {
    const resolved = resolveGsmPacketEquipment(packet, lookup);
    assert.equal(resolved.linked, false);
    assert.equal(resolved.equipmentId, '');
  }
});

test('near-zero GSM coordinates are valid but suspicious for the map UI', () => {
  const status = getGsmCoordinateStatus(0.223456, 0.754321);

  assert.equal(status.valid, true);
  assert.equal(status.status, 'suspicious');
  assert.equal(status.warning, 'Координаты выглядят тестовыми или некорректными');
});

test('GSM coordinate helper rejects broken coordinate shapes without unsafe text', () => {
  const invalid = getGsmCoordinateStatus({ lat: 55 }, 'not-a-number');
  const missing = getGsmCoordinateStatus(null, undefined);

  assert.equal(invalid.status, 'missing');
  assert.equal(missing.status, 'missing');
  assert.equal(JSON.stringify([invalid, missing]).includes('undefined'), false);
  assert.equal(JSON.stringify([invalid, missing]).includes('[object Object]'), false);
});
