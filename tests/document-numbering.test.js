import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildDocumentRegistrySummary,
  nextDocumentNumber,
  prepareDocumentCreate,
  prepareDocumentPatch,
  readNumberingSettings,
} = require('../server/lib/documents-core.js');

const nowIso = () => '2026-05-09T10:00:00.000Z';
let idCounter = 0;
const generateId = prefix => `${prefix}-${++idCounter}`;
const user = { userId: 'U-office', userName: 'Офис', userRole: 'Офис-менеджер' };

test('document numbering creates separate yearly sequences by document type', () => {
  const first = prepareDocumentCreate({
    type: 'act',
    clientId: 'C-1',
    client: 'ООО Клиент',
    date: '2026-05-09',
    status: 'draft',
  }, { documents: [], settings: [], nowIso, generateId, idPrefix: 'D', user });

  assert.equal(first.document.number, 'ACT-2026-0001');

  const second = prepareDocumentCreate({
    type: 'act',
    clientId: 'C-1',
    client: 'ООО Клиент',
    date: '2026-06-01',
    status: 'draft',
  }, { documents: [first.document], settings: first.settings, nowIso, generateId, idPrefix: 'D', user });

  assert.equal(second.document.number, 'ACT-2026-0002');

  const invoice = prepareDocumentCreate({
    type: 'invoice',
    clientId: 'C-1',
    client: 'ООО Клиент',
    date: '2026-06-01',
    status: 'draft',
  }, { documents: [first.document, second.document], settings: second.settings, nowIso, generateId, idPrefix: 'D', user });

  assert.equal(invoice.document.number, 'INVOICE-2026-0001');

  const nextYear = prepareDocumentCreate({
    type: 'act',
    clientId: 'C-1',
    client: 'ООО Клиент',
    date: '2027-01-10',
    status: 'draft',
  }, { documents: [first.document, second.document, invoice.document], settings: invoice.settings, nowIso, generateId, idPrefix: 'D', user });

  assert.equal(nextYear.document.number, 'ACT-2027-0001');
});

test('commercial offers use KP numbering and quote aliases normalize to commercial_offer', () => {
  const offer = prepareDocumentCreate({
    type: 'commercial_offer',
    clientId: 'C-1',
    client: 'ООО Клиент',
    date: '2026-05-09',
    status: 'draft',
  }, { documents: [], settings: [], nowIso, generateId, idPrefix: 'D', user });

  assert.equal(offer.document.type, 'commercial_offer');
  assert.equal(offer.document.documentType, 'commercial_offer');
  assert.equal(offer.document.number, 'KP-2026-0001');

  const quoteAlias = prepareDocumentCreate({
    type: 'quote',
    clientId: 'C-1',
    client: 'ООО Клиент',
    date: '2026-05-10',
    status: 'draft',
  }, { documents: [offer.document], settings: offer.settings, nowIso, generateId, idPrefix: 'D', user });

  assert.equal(quoteAlias.document.type, 'commercial_offer');
  assert.equal(quoteAlias.document.number, 'KP-2026-0002');
});

test('document numbering rejects duplicate manual number and records history', () => {
  const created = prepareDocumentCreate({
    type: 'contract',
    number: 'CONTRACT-2026-0099',
    clientId: 'C-1',
    client: 'ООО Клиент',
    date: '2026-05-09',
    status: 'draft',
  }, { documents: [], settings: [], nowIso, generateId, idPrefix: 'D', user });

  assert.throws(() => prepareDocumentCreate({
    type: 'contract',
    number: 'CONTRACT-2026-0099',
    clientId: 'C-2',
    client: 'ООО Другой',
    date: '2026-05-10',
    status: 'draft',
  }, { documents: [created.document], settings: created.settings, nowIso, generateId, idPrefix: 'D', user }), /уже существует/);

  const updated = prepareDocumentPatch(created.document, {
    status: 'sent',
    number: 'CONTRACT-2026-0100',
  }, {
    documents: [created.document],
    nowIso,
    user,
    canManualNumber: true,
  });

  assert.equal(updated.number, 'CONTRACT-2026-0100');
  assert.equal(updated.sentAt, '2026-05-09T10:00:00.000Z');
  assert.ok(updated.history.some(entry => entry.action === 'number_changed'));
  assert.ok(updated.history.some(entry => entry.field === 'status'));
});

test('document registry summary reports legacy rows without numbers and duplicates', () => {
  const summary = buildDocumentRegistrySummary([
    { id: 'D-1', type: 'act', number: '', date: '2026-05-01', status: 'draft' },
    { id: 'D-2', type: 'act', number: 'ACT-2026-0001', date: '2026-05-02', status: 'sent' },
    { id: 'D-3', type: 'act', number: 'ACT-2026-0001', date: '2026-05-03', status: 'signed' },
  ], '2026-05-09T10:00:00.000Z');

  assert.equal(summary.total, 3);
  assert.equal(summary.withoutNumber, 1);
  assert.equal(summary.duplicateNumbers, 2);
  assert.equal(summary.unsigned, 2);
  assert.equal(summary.signed, 1);
  assert.equal(summary.currentMonth, 3);
});

test('document numbering settings are read from app settings', () => {
  const settings = readNumberingSettings([{
    key: 'document_numbering_settings',
    value: [{ documentType: 'upd', prefix: 'УПД', year: 2026, nextNumber: 7, padding: 3 }],
  }]);
  const preview = nextDocumentNumber([], settings, 'upd', 2026);
  assert.equal(preview.number, 'УПД-2026-007');
});
