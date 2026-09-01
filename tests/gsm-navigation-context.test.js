import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findExactVisibleGsmEquipment,
  resolveRequestedGsmEquipmentId,
} from '../src/app/lib/gsmNavigationContext.js';

test('GSM navigation honors only the exact stable equipment ID visible in the scoped dashboard', () => {
  assert.equal(
    resolveRequestedGsmEquipmentId(new URLSearchParams('equipmentId=EQ-A'), ['EQ-A', 'EQ-B']),
    'EQ-A',
  );
  assert.equal(
    resolveRequestedGsmEquipmentId(new URLSearchParams('equipmentId=EQ-UNKNOWN'), ['EQ-A', 'EQ-B']),
    '',
  );
  assert.equal(
    resolveRequestedGsmEquipmentId(new URLSearchParams('equipmentId=eq-a'), ['EQ-A']),
    '',
  );
  assert.equal(resolveRequestedGsmEquipmentId(new URLSearchParams(''), ['EQ-A']), '');
});

test('GSM navigation can resolve an exact unprovisioned equipment returned by scoped binding lookup', () => {
  const scopedBindingItems = [
    { id: 'EQ-UNPROVISIONED', gsmDeviceRecordId: null },
    { id: 'EQ-TRACKED', gsmDeviceRecordId: 'GDEV-TRACKED' },
  ];
  const requested = findExactVisibleGsmEquipment(scopedBindingItems, 'EQ-UNPROVISIONED');
  assert.equal(requested?.id, 'EQ-UNPROVISIONED');
  assert.equal(
    resolveRequestedGsmEquipmentId(
      new URLSearchParams('equipmentId=EQ-UNPROVISIONED'),
      [requested?.id],
    ),
    'EQ-UNPROVISIONED',
  );
  assert.equal(findExactVisibleGsmEquipment(scopedBindingItems, 'eq-unprovisioned'), null);
});
