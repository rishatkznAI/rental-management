import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGsmEquipmentLabel,
  buildGsmEquipmentLookup,
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
  ]);

  const resolved = resolveGsmPacketEquipment({ equipmentId: 'EQ-1', imei: '990000260517062' }, lookup);

  assert.equal(resolved.linked, true);
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

test('dashboard snapshot equipmentId resolves packet label', () => {
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

  assert.equal(resolved.label, 'Snapshot loader · INV SNAP-1');
});

test('GSM UI equipment label is defensive for empty equipment objects', () => {
  assert.equal(buildGsmEquipmentLabel({}), 'Техника не привязана');
  assert.equal(buildGsmEquipmentLabel(null, ''), 'Техника не привязана');
  assert.equal(buildGsmEquipmentLabel({ model: undefined, inventoryNumber: null, serialNumber: {} }), 'Техника не привязана');
});
