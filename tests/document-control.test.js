import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENT_CONTROL_STATUSES,
  buildDocumentControl,
} from '../src/app/lib/documentControl.js';

const clients = [
  { id: 'C-1', company: 'ООО Альфа' },
  { id: 'C-2', company: 'ООО Бета' },
];

const equipment = [
  { id: 'E-1', inventoryNumber: 'SKY-1', name: 'Подъёмник' },
  { id: 'E-2', inventoryNumber: 'SKY-2', name: 'Генератор' },
];

test('rental with signed contract and signed closing document is ok', () => {
  const control = buildDocumentControl({
    today: '2026-05-02',
    rentals: [
      { id: 'R-1', clientId: 'C-1', client: 'ООО Альфа', equipmentId: 'E-1', status: 'closed', manager: 'Руслан' },
    ],
    documents: [
      { id: 'D-1', type: 'contract', status: 'signed', rentalId: 'R-1', clientId: 'C-1', date: '2026-04-01' },
      { id: 'D-2', type: 'act', status: 'signed', rentalId: 'R-1', clientId: 'C-1', date: '2026-04-15' },
    ],
    clients,
    equipment,
  });

  const summary = control.getRentalSummary('R-1');
  assert.equal(summary.status, DOCUMENT_CONTROL_STATUSES.OK);
  assert.equal(control.rows.length, 0);
  assert.equal(control.kpi.unsignedDocuments, 0);
  assert.doesNotMatch(JSON.stringify(control), /NaN|undefined|null|\[object Object\]/);
});

test('active rental without contract is marked as missing contract', () => {
  const control = buildDocumentControl({
    today: '2026-05-02',
    rentals: [
      { id: 'R-2', clientId: 'C-1', client: 'ООО Альфа', equipmentId: 'E-1', status: 'active', manager: 'Руслан' },
    ],
    documents: [],
    clients,
    equipment,
  });

  assert.equal(control.getRentalSummary('R-2').status, DOCUMENT_CONTROL_STATUSES.MISSING_CONTRACT);
  assert.equal(control.kpi.rentalsWithoutContract, 1);
  assert.ok(control.rows.some(row => row.status === DOCUMENT_CONTROL_STATUSES.MISSING_CONTRACT));
});

test('closed rental without act or upd is marked as missing closing documents', () => {
  const control = buildDocumentControl({
    today: '2026-05-02',
    rentals: [
      { id: 'R-3', clientId: 'C-1', client: 'ООО Альфа', equipmentInv: 'SKY-1', status: 'closed', manager: 'Руслан' },
    ],
    documents: [
      { id: 'D-3', type: 'contract', status: 'signed', rentalId: 'R-3', clientId: 'C-1', date: '2026-04-01' },
    ],
    clients,
    equipment,
  });

  assert.equal(control.getRentalSummary('R-3').status, DOCUMENT_CONTROL_STATUSES.MISSING_CLOSING_DOCS);
  assert.equal(control.kpi.closedRentalsWithoutClosingDocs, 1);
});

test('sent unsigned document older than threshold is overdue', () => {
  const control = buildDocumentControl({
    today: '2026-05-20',
    signatureOverdueDays: 7,
    rentals: [
      { id: 'R-4', clientId: 'C-1', client: 'ООО Альфа', equipmentId: 'E-1', status: 'active', manager: 'Руслан' },
    ],
    documents: [
      { id: 'D-4', type: 'contract', status: 'sent', rentalId: 'R-4', clientId: 'C-1', date: '2026-05-01', manager: 'Руслан' },
    ],
    clients,
    equipment,
  });

  assert.ok(control.rows.some(row => row.documentId === 'D-4' && row.status === DOCUMENT_CONTROL_STATUSES.OVERDUE_SIGNATURE));
  assert.ok(control.rows.some(row => row.daysWithoutSignature === 19));
  assert.equal(control.kpi.overdueSignature >= 1, true);
});

test('legacy document rental fallback links safely by exact rental id', () => {
  const control = buildDocumentControl({
    today: '2026-05-02',
    rentals: [
      { id: 'R-5', clientId: 'C-2', client: 'ООО Бета', equipmentId: 'E-2', status: 'closed', manager: 'Анна' },
    ],
    documents: [
      { id: 'D-5', type: 'contract', status: 'signed', rental: 'R-5', clientId: 'C-2', date: '2026-04-01' },
      { id: 'D-6', type: 'act', status: 'signed', rental: 'R-5', clientId: 'C-2', date: '2026-04-20' },
    ],
    clients,
    equipment,
  });

  assert.equal(control.getRentalSummary('R-5').status, DOCUMENT_CONTROL_STATUSES.OK);
});

test('empty legacy data produces safe values without NaN undefined or null', () => {
  const control = buildDocumentControl({ today: '2026-05-02' });

  assert.equal(control.kpi.totalDocuments, 0);
  assert.equal(control.rows.length, 0);
  assert.doesNotMatch(JSON.stringify(control), /NaN|undefined|null|\[object Object\]/);
});

test('document is not attached to rental by unreliable client name match', () => {
  const control = buildDocumentControl({
    today: '2026-05-02',
    rentals: [
      { id: 'R-6', clientId: 'C-1', client: 'ООО Альфа', equipmentId: 'E-1', status: 'closed', manager: 'Руслан' },
    ],
    documents: [
      { id: 'D-7', type: 'contract', status: 'signed', client: 'ООО Альфа', date: '2026-04-01' },
      { id: 'D-8', type: 'act', status: 'signed', client: 'ООО Альфа', date: '2026-04-20' },
    ],
    clients,
    equipment,
  });

  assert.equal(control.getRentalSummary('R-6').status, DOCUMENT_CONTROL_STATUSES.MISSING_CONTRACT);
  assert.ok(control.rows.some(row => row.status === DOCUMENT_CONTROL_STATUSES.ORPHAN_DOCUMENT));
});
