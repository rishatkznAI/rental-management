import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGlobalSearchGroups } from '../src/app/lib/globalSearch.js';

const allPermissions = {
  clients: true,
  equipment: true,
  rentals: true,
  documents: true,
  service: true,
  payments: true,
  finance: true,
  deliveries: true,
};

function search(query, permissions = allPermissions, overrides = {}) {
  return buildGlobalSearchGroups({
    clients: [
      { id: 'client-1', company: 'ООО Альфа', inn: '7701234567', contact: 'Иван Петров', phone: '+7 900 111', email: 'alpha@example.test' },
    ],
    equipment: [
      { id: 'eq-1', inventoryNumber: 'INV-204', serialNumber: 'SN-ABC-77', manufacturer: 'JLG', model: 'E450', owner: 'own', ownerName: 'Skytech', status: 'available', location: 'Склад' },
    ],
    rentals: [
      { id: 'R-7788', client: 'ООО Альфа', contact: 'Иван', manager: 'Мария', status: 'active', startDate: '2026-05-01', plannedReturnDate: '2026-05-10', equipment: ['INV-204'] },
    ],
    ganttRentals: [
      { id: 'GR-7788', client: 'ООО Альфа', equipmentInv: 'INV-204', manager: 'Мария', status: 'active' },
    ],
    documents: [
      { id: 'DOC-99', type: 'contract', number: 'CN-99', status: 'signed', clientId: 'client-1', rentalId: 'GR-7788' },
    ],
    serviceTickets: [
      { id: 'SRV-42', equipment: 'JLG E450', inventoryNumber: 'INV-204', serialNumber: 'SN-ABC-77', client: 'ООО Альфа', assignedMechanicName: 'Сергей', status: 'open', reason: 'Не едет', description: 'Ошибка контроллера' },
    ],
    payments: [
      { id: 'PAY-7', invoiceNumber: 'INV-PAY-7', client: 'ООО Альфа', rentalId: 'GR-7788', amount: 125000, dueDate: '2026-05-20', status: 'pending' },
    ],
    deliveries: [
      { id: 'DEL-5', client: 'ООО Альфа', equipmentInv: 'INV-204', destination: 'Казань, Промзона', carrierName: 'ТК Север', status: 'planned' },
    ],
    debtCollectionPlans: [
      { id: 'DEBT-3', clientName: 'ООО Альфа', responsibleName: 'Ольга', status: 'in_progress', nextActionType: 'call', nextActionDate: '2026-05-04', comment: 'Позвонить бухгалтеру' },
    ],
    ...overrides,
  }, { query, permissions });
}

function flatten(groups) {
  return groups.flatMap(group => group.items.map(item => ({ ...item, group: group.group })));
}

test('global search finds clients by INN', () => {
  const results = flatten(search('7701234567'));

  assert.equal(results.some(item => item.id === 'client:client-1' && item.group === 'Клиенты'), true);
});

test('global search finds equipment by serial and inventory numbers', () => {
  assert.equal(flatten(search('SN-ABC-77')).some(item => item.id === 'equipment:eq-1'), true);
  assert.equal(flatten(search('INV-204')).some(item => item.id === 'equipment:eq-1'), true);
});

test('global search finds rentals and service tickets by id', () => {
  assert.equal(flatten(search('R-7788')).some(item => item.id === 'rental:R-7788'), true);
  assert.equal(flatten(search('SRV-42')).some(item => item.id === 'service:SRV-42'), true);
});

test('global search filters results by section permissions', () => {
  const results = flatten(search('ООО Альфа', { ...allPermissions, clients: false, payments: false, finance: false }));

  assert.equal(results.some(item => item.group === 'Клиенты'), false);
  assert.equal(results.some(item => item.group === 'Платежи'), false);
  assert.equal(results.some(item => item.group === 'Планы взыскания'), false);
  assert.equal(results.some(item => item.group === 'Аренды'), true);
});

test('global search hides payment amount without finance permission and does not index it', () => {
  const noFinancePermissions = { ...allPermissions, finance: false };

  assert.equal(flatten(search('125000', noFinancePermissions)).some(item => item.group === 'Платежи'), false);

  const payment = flatten(search('INV-PAY-7', noFinancePermissions)).find(item => item.group === 'Платежи');
  assert.ok(payment);
  assert.doesNotMatch(`${payment.title} ${payment.subtitle}`, /125000/);
});

test('global search does not render NaN, undefined, null, or object placeholders', () => {
  const results = flatten(search('legacy', allPermissions, {
    documents: [
      { id: 'legacy-doc', type: 'act', number: 'legacy', status: undefined, client: null, rentalId: NaN, title: { text: 'bad' } },
    ],
  }));
  const text = results.map(item => `${item.title} ${item.subtitle}`).join(' ');

  assert.doesNotMatch(text, /NaN|undefined|null|\[object Object\]/);
});
