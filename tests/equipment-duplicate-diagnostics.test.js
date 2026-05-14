import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildEquipmentDuplicateDiagnostics, normalizeIdentifier } = require('../server/lib/equipment-duplicate-diagnostics.js');

test('equipment duplicate diagnostics finds duplicate inventory numbers', () => {
  const report = buildEquipmentDuplicateDiagnostics({
    equipment: [
      { id: 'EQ-1', inventoryNumber: 'INV-1', serialNumber: 'SN-1', model: 'A' },
      { id: 'EQ-2', inventoryNumber: 'INV-1', serialNumber: 'SN-2', model: 'B' },
      { id: 'EQ-3', inventoryNumber: 'INV-3', serialNumber: 'SN-3', model: 'C' },
    ],
  });

  assert.equal(report.summary.duplicateInventoryNumbers, 1);
  assert.equal(report.summary.duplicateSerialNumbers, 0);
  assert.deepEqual(report.duplicates[0].items.map(item => item.id), ['EQ-1', 'EQ-2']);
});

test('equipment duplicate diagnostics finds duplicate serial numbers', () => {
  const report = buildEquipmentDuplicateDiagnostics({
    equipment: [
      { id: 'EQ-1', inventoryNumber: 'INV-1', serialNumber: 'SN-1', model: 'A' },
      { id: 'EQ-2', inventoryNumber: 'INV-2', serialNumber: 'SN-1', model: 'B' },
    ],
  });

  assert.equal(report.summary.duplicateInventoryNumbers, 0);
  assert.equal(report.summary.duplicateSerialNumbers, 1);
  assert.equal(report.duplicates[0].field, 'serialNumber');
});

test('equipment duplicate diagnostics ignores empty identifier values', () => {
  const report = buildEquipmentDuplicateDiagnostics({
    equipment: [
      { id: 'EQ-1', inventoryNumber: ' ', serialNumber: '' },
      { id: 'EQ-2', inventoryNumber: '', serialNumber: null },
      { id: 'EQ-3' },
    ],
  });

  assert.equal(report.summary.duplicateGroups, 0);
});

test('equipment duplicate diagnostics normalizes whitespace and case', () => {
  assert.equal(normalizeIdentifier(' Inv-77 '), 'inv-77');
  const report = buildEquipmentDuplicateDiagnostics({
    equipment: [
      { id: 'EQ-1', inventoryNumber: ' Inv-77 ', serialNumber: ' Sn-77 ' },
      { id: 'EQ-2', inventoryNumber: 'INV-77', serialNumber: 'SN-77' },
    ],
  });

  assert.equal(report.summary.duplicateInventoryNumbers, 1);
  assert.equal(report.summary.duplicateSerialNumbers, 1);
});

test('equipment duplicate diagnostics does not mutate equipment collection', () => {
  const collections = {
    equipment: [
      { id: 'EQ-1', inventoryNumber: 'INV-1', serialNumber: 'SN-1', history: [{ action: 'created' }] },
      { id: 'EQ-2', inventoryNumber: 'INV-1', serialNumber: 'SN-2' },
    ],
  };
  const before = JSON.parse(JSON.stringify(collections.equipment));

  const report = buildEquipmentDuplicateDiagnostics(collections);

  assert.equal(report.diagnosticsReadOnly, true);
  assert.deepEqual(collections.equipment, before);
});

test('equipment duplicate diagnostics includes linked rentals service deliveries documents and gsm flags', () => {
  const report = buildEquipmentDuplicateDiagnostics({
    equipment: [
      {
        id: 'EQ-1',
        inventoryNumber: 'INV-1',
        serialNumber: 'SN-1',
        manufacturer: 'Sky',
        model: 'Lift',
        status: 'available',
        owner: 'own',
        gsmImei: 'IMEI-1',
      },
      { id: 'EQ-2', inventoryNumber: ' inv-1 ', serialNumber: 'SN-2', model: 'Lift 2' },
    ],
    rentals: [{ id: 'R-1', equipmentId: 'EQ-1', status: 'active', client: 'Client A' }],
    ganttRentals: [{ id: 'G-1', rentalId: 'R-1', equipmentInv: 'INV-1', status: 'active' }],
    service: [{ id: 'S-1', equipmentId: 'EQ-1', status: 'open' }],
    deliveries: [{ id: 'D-1', equipmentInv: 'INV-1', status: 'planned' }],
    documents: [{ id: 'DOC-1', equipmentId: 'EQ-1', number: 'DOC-1', status: 'sent' }],
  });

  const first = report.duplicates[0].items.find(item => item.id === 'EQ-1');
  assert.ok(first);
  assert.equal(first.model, 'Sky Lift');
  assert.equal(first.linkedRentals.length, 2);
  assert.equal(first.linkedServiceTickets.length, 1);
  assert.equal(first.linkedDeliveries.length, 1);
  assert.equal(first.linkedDocuments.length, 1);
  assert.equal(first.gsm.hasData, true);
});
