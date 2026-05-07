import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeServiceTicketList, normalizeServiceTicketRecord } = require('../server/lib/service-dto.js');

test('service DTO normalizes incomplete legacy records without mutating storage shape', () => {
  const ticket = normalizeServiceTicketRecord({
    id: 'S-old',
    status: 'done',
    priority: 'urgent',
    reason: null,
    equipmentInv: 'INV-7',
    mechanicId: 'M-1',
    workLog: null,
    parts: null,
  });

  assert.equal(ticket.id, 'S-old');
  assert.equal(ticket.status, 'closed');
  assert.equal(ticket.priority, 'critical');
  assert.equal(ticket.serviceKind, 'repair');
  assert.equal(ticket.reason, 'Без причины');
  assert.equal(ticket.equipment, 'INV: INV-7');
  assert.equal(ticket.inventoryNumber, 'INV-7');
  assert.equal(ticket.mechanicId, 'M-1');
  assert.equal(ticket.assignedMechanicId, 'M-1');
  assert.equal(ticket.clientId, '');
  assert.equal(ticket.rentalId, '');
  assert.deepEqual(ticket.workLog, []);
  assert.deepEqual(ticket.parts, []);
});

test('service DTO skips non-object rows and assigns safe ids to partial rows', () => {
  const list = normalizeServiceTicketList([
    null,
    'broken',
    { status: undefined, priority: undefined, description: 'legacy text' },
  ]);

  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'legacy-service-3');
  assert.equal(list[0].status, 'new');
  assert.equal(list[0].priority, 'medium');
  assert.equal(list[0].description, 'legacy text');
});

test('mechanic service DTO keeps object context without financial fields', () => {
  const ticket = normalizeServiceTicketRecord({
    id: 'S-1',
    equipmentId: 'EQ-1',
    equipment: 'Подъемник',
    reason: 'Осмотр',
    description: 'Осмотр',
    priority: 'medium',
    status: 'new',
    clientId: 'C-1',
    client: 'ООО Клиент',
    objectId: 'CO-1',
    objectName: 'ТЦ Север',
    objectAddress: 'Казань, Северная 1',
    objectContactName: 'Ильдар',
    objectContactPhone: '+7',
    contractId: 'CC-1',
    contractNumber: 'Д-1',
    debt: 100000,
    receivables: [{ id: 'R-1' }],
    paymentTerms: '100% предоплата',
    contractAmount: 500000,
  });

  assert.equal(ticket.objectId, 'CO-1');
  assert.equal(ticket.objectName, 'ТЦ Север');
  assert.equal(ticket.objectAddress, 'Казань, Северная 1');
  assert.equal(ticket.objectContactName, 'Ильдар');
  assert.equal(ticket.objectContactPhone, '+7');
  assert.equal(ticket.contractNumber, 'Д-1');
  assert.equal('debt' in ticket, false);
  assert.equal('receivables' in ticket, false);
  assert.equal('paymentTerms' in ticket, false);
  assert.equal('contractAmount' in ticket, false);
});
