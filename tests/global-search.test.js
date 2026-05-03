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

// ─── Русские алиасы типов документов ────────────────────────────────────────

test('russian alias "договор" finds contract documents', () => {
  const results = flatten(search('договор'));
  assert.equal(results.some(item => item.id === 'document:DOC-99' && item.group === 'Документы'), true);
});

test('russian alias "договор аренды" finds contract documents', () => {
  const results = flatten(search('договор аренды'));
  assert.equal(results.some(item => item.id === 'document:DOC-99' && item.group === 'Документы'), true);
});

test('russian alias "акт" finds act documents', () => {
  const results = flatten(search('акт', allPermissions, {
    documents: [{ id: 'DOC-ACT', type: 'act', number: 'A-1', status: 'draft', clientId: 'client-1', rentalId: 'GR-7788' }],
  }));
  assert.equal(results.some(item => item.id === 'document:DOC-ACT' && item.group === 'Документы'), true);
});

test('russian alias "акт выполненных работ" finds act documents', () => {
  const results = flatten(search('акт выполненных работ', allPermissions, {
    documents: [{ id: 'DOC-ACT', type: 'act', number: 'A-1', status: 'draft', clientId: 'client-1', rentalId: 'GR-7788' }],
  }));
  assert.equal(results.some(item => item.id === 'document:DOC-ACT' && item.group === 'Документы'), true);
});

test('russian alias "заказ-наряд" finds work_order documents', () => {
  const results = flatten(search('заказ-наряд', allPermissions, {
    documents: [{ id: 'DOC-WO', type: 'work_order', number: 'WO-1', status: 'sent', clientId: 'client-1', rentalId: 'GR-7788' }],
  }));
  assert.equal(results.some(item => item.id === 'document:DOC-WO' && item.group === 'Документы'), true);
});

test('russian alias "наряд" finds work_order documents', () => {
  const results = flatten(search('наряд', allPermissions, {
    documents: [{ id: 'DOC-WO', type: 'work_order', number: 'WO-1', status: 'sent', clientId: 'client-1', rentalId: 'GR-7788' }],
  }));
  assert.equal(results.some(item => item.id === 'document:DOC-WO' && item.group === 'Документы'), true);
});

test('russian alias "счёт" finds invoice documents', () => {
  const results = flatten(search('счёт', allPermissions, {
    documents: [{ id: 'DOC-INV', type: 'invoice', number: 'I-1', status: 'pending', clientId: 'client-1', rentalId: 'GR-7788' }],
  }));
  assert.equal(results.some(item => item.id === 'document:DOC-INV' && item.group === 'Документы'), true);
});

test('russian alias "счет" (without ё) finds invoice documents', () => {
  const results = flatten(search('счет', allPermissions, {
    documents: [{ id: 'DOC-INV', type: 'invoice', number: 'I-1', status: 'pending', clientId: 'client-1', rentalId: 'GR-7788' }],
  }));
  assert.equal(results.some(item => item.id === 'document:DOC-INV' && item.group === 'Документы'), true);
});

test('russian alias "спецификация" finds specification documents', () => {
  const results = flatten(search('спецификация', allPermissions, {
    documents: [{ id: 'DOC-SPEC', type: 'specification', number: 'SP-1', status: 'draft', clientId: 'client-1', rentalId: 'GR-7788' }],
  }));
  assert.equal(results.some(item => item.id === 'document:DOC-SPEC' && item.group === 'Документы'), true);
});

// ─── Русские алиасы статусов документов ──────────────────────────────────────

test('russian alias "черновик" finds draft documents', () => {
  const results = flatten(search('черновик', allPermissions, {
    documents: [{ id: 'DOC-DRAFT', type: 'act', number: 'A-2', status: 'draft', clientId: 'client-1', rentalId: 'GR-7788' }],
  }));
  assert.equal(results.some(item => item.id === 'document:DOC-DRAFT' && item.group === 'Документы'), true);
});

test('russian alias "подписан" finds signed documents', () => {
  const results = flatten(search('подписан'));
  assert.equal(results.some(item => item.id === 'document:DOC-99' && item.group === 'Документы'), true);
});

test('russian alias "подписано" finds signed documents', () => {
  const results = flatten(search('подписано'));
  assert.equal(results.some(item => item.id === 'document:DOC-99' && item.group === 'Документы'), true);
});

test('russian alias "отправлен" finds sent documents', () => {
  const results = flatten(search('отправлен', allPermissions, {
    documents: [{ id: 'DOC-SENT', type: 'contract', number: 'C-2', status: 'sent', clientId: 'client-1', rentalId: 'GR-7788' }],
  }));
  assert.equal(results.some(item => item.id === 'document:DOC-SENT' && item.group === 'Документы'), true);
});

test('russian alias "ожидает" finds pending documents', () => {
  const results = flatten(search('ожидает', allPermissions, {
    documents: [{ id: 'DOC-PEND', type: 'invoice', number: 'I-2', status: 'pending', clientId: 'client-1', rentalId: 'GR-7788' }],
  }));
  assert.equal(results.some(item => item.id === 'document:DOC-PEND' && item.group === 'Документы'), true);
});

test('russian alias "отменён" finds cancelled documents', () => {
  const results = flatten(search('отменён', allPermissions, {
    documents: [{ id: 'DOC-CANC', type: 'act', number: 'A-3', status: 'cancelled', clientId: 'client-1', rentalId: 'GR-7788' }],
  }));
  assert.equal(results.some(item => item.id === 'document:DOC-CANC' && item.group === 'Документы'), true);
});

// ─── Обратная совместимость: английские значения продолжают работать ──────────

test('english "contract" still finds contract documents', () => {
  const results = flatten(search('contract'));
  assert.equal(results.some(item => item.id === 'document:DOC-99' && item.group === 'Документы'), true);
});

test('english "draft" still finds draft documents', () => {
  const results = flatten(search('draft', allPermissions, {
    documents: [{ id: 'DOC-DRAFT', type: 'act', number: 'A-2', status: 'draft', clientId: 'client-1', rentalId: 'GR-7788' }],
  }));
  assert.equal(results.some(item => item.id === 'document:DOC-DRAFT' && item.group === 'Документы'), true);
});

test('english "signed" still finds signed documents', () => {
  const results = flatten(search('signed'));
  assert.equal(results.some(item => item.id === 'document:DOC-99' && item.group === 'Документы'), true);
});

test('english "work_order" still finds work_order documents', () => {
  const results = flatten(search('work_order', allPermissions, {
    documents: [{ id: 'DOC-WO', type: 'work_order', number: 'WO-1', status: 'sent', clientId: 'client-1', rentalId: 'GR-7788' }],
  }));
  assert.equal(results.some(item => item.id === 'document:DOC-WO' && item.group === 'Документы'), true);
});

test('english "act" still finds act documents', () => {
  const results = flatten(search('act', allPermissions, {
    documents: [{ id: 'DOC-ACT', type: 'act', number: 'A-1', status: 'draft', clientId: 'client-1', rentalId: 'GR-7788' }],
  }));
  assert.equal(results.some(item => item.id === 'document:DOC-ACT' && item.group === 'Документы'), true);
});

// ─── Нет дублей результатов ───────────────────────────────────────────────────

test('no duplicate results when querying by russian alias', () => {
  const groups = search('договор');
  const docGroup = groups.find(g => g.group === 'Документы');
  assert.ok(docGroup, 'Документы group should exist');
  const ids = docGroup.items.map(item => item.id);
  const uniqueIds = [...new Set(ids)];
  assert.equal(ids.length, uniqueIds.length, 'No duplicate items in group');
});

test('subtitle still shows english type and status (display unchanged)', () => {
  const results = flatten(search('договор'));
  const doc = results.find(item => item.id === 'document:DOC-99');
  assert.ok(doc, 'document found');
  assert.match(doc.subtitle, /contract/);
  assert.match(doc.subtitle, /signed/);
});

// ─── Безопасность: секретные поля не индексируются ───────────────────────────

test('secret fields are not indexed even with aliases', () => {
  const results = flatten(search('договор', allPermissions, {
    documents: [{ id: 'DOC-SEC', type: 'contract', number: 'password-contract', status: 'draft', clientId: 'client-1', rentalId: 'GR-7788' }],
  }));
  // document should NOT be found because 'password' appears in the searchable field text
  assert.equal(results.some(item => item.id === 'document:DOC-SEC'), false);
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
