import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  analyzeRentalEquipmentDiagnostics,
  planRentalEquipmentBackfill,
} = require('../server/lib/rental-equipment-diagnostics.js');

test('rental equipment diagnostics reports missing canonical links and stale legacy refs', () => {
  const diagnostics = analyzeRentalEquipmentDiagnostics({
    equipment: [
      { id: 'EQ-1', inventoryNumber: 'INV-1', serialNumber: 'SN-1', equipmentInv: 'PIN-1' },
      { id: 'EQ-2', inventoryNumber: 'INV-2', serialNumber: 'SN-2', equipmentInv: 'PIN-2' },
      { id: 'EQ-3', inventoryNumber: 'INV-2', serialNumber: 'SN-3', equipmentInv: 'PIN-3' },
      { id: 'EQ-4', inventoryNumber: 'INV-4', serialNumber: 'SN-3', equipmentInv: 'PIN-3' },
    ],
    rentals: [
      { id: 'R-no-id', equipmentInv: 'INV-1', equipment: ['INV-1'] },
      { id: 'R-missing-eq', equipmentId: 'EQ-missing', equipmentInv: 'INV-X' },
      { id: 'R-stale', equipmentId: 'EQ-2', equipmentInv: 'INV-1', inventoryNumber: 'INV-1', equipment: ['INV-1'] },
    ],
    ganttRentals: [
      { id: 'GR-no-link', equipmentId: 'EQ-1', equipmentInv: 'INV-1' },
      { id: 'GR-missing-rental', rentalId: 'R-missing', equipmentId: 'EQ-1', equipmentInv: 'INV-1' },
      { id: 'GR-stale', rentalId: 'R-stale', equipmentId: 'EQ-1', equipmentInv: 'INV-1' },
    ],
  });

  assert.equal(diagnostics.summary.rentalsTotal, 3);
  assert.equal(diagnostics.summary.rentalsWithoutEquipmentId, 1);
  assert.equal(diagnostics.summary.rentalsWithMissingEquipment, 1);
  assert.equal(diagnostics.summary.ganttTotal, 3);
  assert.equal(diagnostics.summary.ganttWithoutRentalId, 1);
  assert.equal(diagnostics.summary.ganttMissingRental, 1);
  assert.equal(diagnostics.summary.ganttEquipmentMismatches, 1);
  assert.equal(diagnostics.summary.duplicateEquipmentInv, 1);
  assert.equal(diagnostics.summary.duplicateInventoryNumbers, 1);
  assert.equal(diagnostics.summary.duplicateSerialNumbers, 1);
  assert.equal(diagnostics.summary.legacyConflicts, 1);

  assert.equal(diagnostics.issues.rentalsWithoutEquipmentId[0].id, 'R-no-id');
  assert.equal(diagnostics.issues.rentalsWithoutEquipmentId[0].resolvedEquipmentId, 'EQ-1');
  assert.equal(diagnostics.issues.rentalsWithMissingEquipment[0].equipmentId, 'EQ-missing');
  assert.equal(diagnostics.issues.ganttEquipmentMismatches[0].id, 'GR-stale');
  assert.equal(diagnostics.issues.ganttEquipmentMismatches[0].canonicalRentalEquipmentId, 'EQ-2');
  assert.equal(diagnostics.issues.duplicateEquipmentIdentifiers.length, 3);
});

test('rental equipment backfill plans only deterministic canonical repairs', () => {
  const plan = planRentalEquipmentBackfill({
    equipment: [
      { id: 'EQ-1', inventoryNumber: 'INV-1', serialNumber: 'SN-1' },
      { id: 'EQ-2', inventoryNumber: 'INV-2', serialNumber: 'SN-2' },
    ],
    rentals: [
      { id: 'R-no-id', equipmentInv: 'INV-1', equipment: ['INV-1'] },
      { id: 'R-stale', equipmentId: 'EQ-2', equipmentInv: 'INV-1', inventoryNumber: 'INV-1', equipment: ['INV-1'] },
      { id: 'R-missing', equipmentId: 'EQ-missing', equipmentInv: 'INV-1' },
      { id: 'R-broken', equipmentId: 'EQ-missing-2', equipmentInv: 'INV-1' },
    ],
    ganttRentals: [
      { id: 'GR-stale', rentalId: 'R-stale', equipmentId: 'EQ-1', equipmentInv: 'INV-1', equipment: ['INV-1'] },
      { id: 'GR-orphan', rentalId: 'R-404', equipmentId: 'EQ-1', equipmentInv: 'INV-1' },
      { id: 'GR-broken', rentalId: 'R-broken', equipmentId: 'EQ-1', equipmentInv: 'INV-1' },
    ],
  });

  assert.equal(plan.summary.rentalsUpdated, 2);
  assert.equal(plan.summary.ganttUpdated, 1);
  assert.equal(plan.summary.skipped, 4);
  assert.equal(plan.summary.manualReview, 4);
  assert.equal(plan.nextRentals.find(item => item.id === 'R-no-id').equipmentId, 'EQ-1');
  assert.equal(plan.nextRentals.find(item => item.id === 'R-stale').equipmentInv, 'INV-2');
  assert.equal(plan.nextRentals.find(item => item.id === 'R-missing').equipmentId, 'EQ-missing');
  assert.equal(plan.nextGanttRentals.find(item => item.id === 'GR-stale').equipmentId, 'EQ-2');
  assert.equal(plan.nextGanttRentals.find(item => item.id === 'GR-stale').equipmentInv, 'INV-2');
  assert.equal(plan.nextGanttRentals.find(item => item.id === 'GR-broken').equipmentId, 'EQ-1');
  assert.equal(plan.manualReview.some(item => item.reason === 'linked_rental_has_non_empty_equipmentId_not_synced_from_fallback'), true);
  assert.equal(plan.changes.some(item => item.action === 'backfill_equipmentId'), true);
  assert.equal(plan.changes.some(item => item.action === 'sync_from_canonical_rental'), true);
});
