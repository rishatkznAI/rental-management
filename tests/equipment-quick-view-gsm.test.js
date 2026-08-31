import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEquipmentQuickViewGsmFields } from '../src/app/lib/equipmentQuickViewGsmFields.js';
import { GSM_ONLINE_WINDOW_MS } from '../src/app/lib/gsmSignalState.js';

const NOW = Date.parse('2026-08-30T12:00:00.000Z');

function fieldValue(fields, label) {
  return fields.find(field => field.label === label)?.value;
}

test('equipment quick view never renders persisted online after telemetry becomes stale', () => {
  const staleFields = buildEquipmentQuickViewGsmFields({
    gsmDeviceRecordId: 'GDEV-STALE',
    gsmBindingVerified: true,
    gsmTelemetryVerified: true,
    gsmStatus: 'online',
    gsmSignalStatus: 'online',
    gsmLastSeenAt: new Date(NOW - GSM_ONLINE_WINDOW_MS - 1).toISOString(),
  }, { nowMs: NOW });
  const freshFields = buildEquipmentQuickViewGsmFields({
    gsmDeviceRecordId: 'GDEV-FRESH',
    gsmBindingVerified: true,
    gsmTelemetryVerified: true,
    gsmStatus: 'offline',
    gsmLastSeenAt: new Date(NOW - GSM_ONLINE_WINDOW_MS).toISOString(),
  }, { nowMs: NOW });

  assert.equal(fieldValue(staleFields, 'Статус'), 'Офлайн');
  assert.equal(fieldValue(freshFields, 'Статус'), 'Онлайн');
});

test('equipment quick view rejects zero coordinates but preserves valid zero-valued telemetry', () => {
  const fields = buildEquipmentQuickViewGsmFields({
    gsmDeviceRecordId: 'GDEV-ZERO',
    gsmBindingVerified: true,
    gsmTelemetryVerified: true,
    gsmLastLat: 0,
    gsmLastLng: 0,
    gsmLastMotoHours: 0,
    gsmLastVoltage: 0,
  }, { nowMs: NOW });

  assert.equal(fieldValue(fields, 'Координаты'), '—');
  assert.equal(fieldValue(fields, 'Моточасы GSM'), 0);
  assert.equal(fieldValue(fields, 'Напряжение'), 0);
});

test('equipment quick view quarantines projection-only legacy telemetry', () => {
  const fields = buildEquipmentQuickViewGsmFields({
    gsmStatus: 'online',
    gsmLastSeenAt: new Date(NOW).toISOString(),
    gsmLastLat: 55.7,
    gsmLastLng: 49.1,
    gsmLastVoltage: 12.8,
  }, { nowMs: NOW });

  assert.equal(fieldValue(fields, 'Статус'), 'Непроверенные данные');
  assert.equal(fieldValue(fields, 'Последний сигнал'), '—');
  assert.equal(fieldValue(fields, 'Координаты'), '—');
  assert.equal(fieldValue(fields, 'Напряжение'), '—');
});

test('equipment quick view quarantines dangling record IDs without backend verification', () => {
  const fields = buildEquipmentQuickViewGsmFields({
    gsmDeviceRecordId: 'GDEV-DANGLING',
    gsmBindingVerified: false,
    gsmImei: '860000000000099',
    gsmStatus: 'online',
    gsmLastSeenAt: new Date(NOW).toISOString(),
    gsmLastLat: 55.7,
    gsmLastLng: 49.1,
  }, { nowMs: NOW });

  assert.equal(fieldValue(fields, 'Статус'), 'Непроверенные данные');
  assert.equal(fieldValue(fields, 'IMEI'), '—');
  assert.equal(fieldValue(fields, 'Последний сигнал'), '—');
  assert.equal(fieldValue(fields, 'Координаты'), '—');
});

test('equipment quick view treats retired neutral GSM state as no tracker data', () => {
  const fields = buildEquipmentQuickViewGsmFields({
    gsmStatus: 'unknown',
    gsmSignalStatus: 'unknown',
  }, { nowMs: NOW });

  assert.equal(fieldValue(fields, 'Статус'), '—');
  assert.equal(fieldValue(fields, 'IMEI'), '—');
  assert.equal(fieldValue(fields, 'Устройство'), '—');
});
