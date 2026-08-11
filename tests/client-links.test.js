import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeClientLinks,
  normalizeRecordClientLink,
} = require('../server/lib/client-links.js');

function createStore(initial) {
  const store = new Map(Object.entries(initial));
  return {
    readData(collection) {
      return store.get(collection) || [];
    },
    writeData(collection, list) {
      store.set(collection, list);
    },
    get(collection) {
      return store.get(collection) || [];
    },
  };
}

test('normalizeClientLinks never restores clientId from old client name', () => {
  const warnings = [];
  const store = createStore({
    clients: [{ id: 'c-1', company: 'ООО Ромашка', inn: '1655000000' }],
    gantt_rentals: [
      { id: 'gr-1', client: 'ООО Ромашка', amount: 100000, paymentStatus: 'unpaid' },
    ],
    rentals: [
      { id: 'r-1', client: 'ООО Ромашка', equipment: ['101'], startDate: '2026-04-01', plannedReturnDate: '2026-04-10' },
    ],
    payments: [
      { id: 'p-1', rentalId: 'gr-1', client: 'ООО Ромашка', amount: 100000, status: 'partial' },
    ],
    documents: [
      { id: 'd-1', rental: 'r-1', number: 'UPD-1', client: 'ООО Ромашка', status: 'draft' },
    ],
    crm_deals: [],
  });

  const result = normalizeClientLinks({
    readData: store.readData,
    writeData: store.writeData,
    logger: { log() {}, warn(message) { warnings.push(message); } },
  });

  assert.equal(result.changed, 0);
  assert.equal(store.get('gantt_rentals')[0].clientId, undefined);
  assert.equal(store.get('rentals')[0].clientId, undefined);
  assert.equal(store.get('payments')[0].clientId, undefined);
  assert.equal(store.get('documents')[0].clientId, undefined);
  assert.equal(warnings.every(message => message.includes('сопоставление по названию/ИНН запрещено')), true);
});

test('normalizeRecordClientLink prefers rental link over client name snapshot', () => {
  const clients = [
    { id: 'c-1', company: 'ООО Ромашка Казань', inn: '1655000000' },
    { id: 'c-2', company: 'ООО Другая', inn: '1655000001' },
  ];
  const relatedRentalsById = new Map([
    ['gr-1', { id: 'gr-1', clientId: 'c-1', client: 'ООО Ромашка' }],
  ]);

  const payment = normalizeRecordClientLink(
    { id: 'p-1', rentalId: 'gr-1', client: 'ООО Другая', amount: 50000 },
    clients,
    { relatedRentalsById, logger: { warn() {} } },
  );

  assert.equal(payment.clientId, 'c-1');
  assert.equal(payment.client, 'ООО Другая');
});

test('client rename history is never used as a relation recovery source', () => {
  const warnings = [];
  const store = createStore({
    clients: [{
      id: 'c-1',
      company: 'ООО Ромашка Казань',
      inn: '1655000000',
      creditLimit: 0,
      history: [
        { text: 'Клиент создан: ООО Ромашка', author: 'Система', type: 'system' },
        { text: 'Обновлён клиент: компания: ООО Ромашка → ООО Ромашка Казань', author: 'Руслан', type: 'system' },
      ],
    }],
    gantt_rentals: [
      {
        id: 'gr-rename-legacy-1',
        client: 'ООО Ромашка',
        amount: 100000,
        paidAmount: 0,
        paymentStatus: 'unpaid',
        status: 'active',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        expectedPaymentDate: '2026-04-05',
      },
    ],
    rentals: [],
    payments: [
      {
        id: 'p-rename-legacy-1',
        rentalId: 'gr-rename-legacy-1',
        client: 'ООО Ромашка',
        amount: 100000,
        paidAmount: 0,
        status: 'unpaid',
      },
    ],
    documents: [],
    crm_deals: [],
  });

  const result = normalizeClientLinks({
    readData: store.readData,
    writeData: store.writeData,
    logger: { log() {}, warn(message) { warnings.push(message); } },
  });
  assert.equal(result.changed, 0);
  assert.equal(store.get('gantt_rentals')[0].clientId, undefined);
  assert.equal(store.get('payments')[0].clientId, undefined);
  assert.equal(warnings.every(message => message.includes('сопоставление по названию/ИНН запрещено')), true);
});

test('normalizeClientLinks refuses name recovery regardless of whether a name is ambiguous', () => {
  const warnings = [];
  const store = createStore({
    clients: [
      { id: 'c-1', company: 'ООО Ромашка', inn: '1655000000' },
      { id: 'c-2', company: 'ООО Ромашка', inn: '1655000001' },
    ],
    gantt_rentals: [
      { id: 'gr-ambiguous', client: 'ООО Ромашка', amount: 100000, paymentStatus: 'unpaid' },
    ],
    rentals: [],
    payments: [],
    documents: [],
    crm_deals: [],
  });

  const result = normalizeClientLinks({
    readData: store.readData,
    writeData: store.writeData,
    logger: { log() {}, warn(message) { warnings.push(message); } },
  });

  assert.equal(result.changed, 0);
  assert.equal(store.get('gantt_rentals')[0].clientId, undefined);
  assert.equal(warnings.some(message => message.includes('сопоставление по названию/ИНН запрещено')), true);
});

test('normalizeClientLinks never restores clientId from INN', () => {
  const warnings = [];
  const store = createStore({
    clients: [{ id: 'c-1', company: 'ООО Ромашка', inn: '1655000000' }],
    gantt_rentals: [{ id: 'gr-inn', clientInn: '1655000000' }],
    rentals: [],
    payments: [],
    documents: [],
    crm_deals: [],
  });

  const result = normalizeClientLinks({
    readData: store.readData,
    writeData: store.writeData,
    logger: { log() {}, warn(message) { warnings.push(message); } },
  });

  assert.equal(result.changed, 0);
  assert.equal(store.get('gantt_rentals')[0].clientId, undefined);
  assert.equal(warnings.some(message => message.includes('сопоставление по названию/ИНН запрещено')), true);
});

test('production write normalization surfaces an invalid stable clientId without legacy repair', () => {
  const warnings = [];
  const record = {
    id: 'R-invalid-client',
    clientId: 'C-missing',
    client: 'ООО Ромашка',
    clientInn: '1655000000',
    rentalId: 'R-related',
  };
  const clients = [{ id: 'C-1', company: 'ООО Ромашка', inn: '1655000000' }];
  const relatedRentalsById = new Map([
    ['R-related', { id: 'R-related', clientId: 'C-1' }],
  ]);

  const normalized = normalizeRecordClientLink(record, clients, {
    allowLegacyRecovery: false,
    relatedRentalsById,
    logger: { warn(message) { warnings.push(String(message)); } },
  });

  assert.equal(normalized, record);
  assert.equal(normalized.clientId, 'C-missing');
  assert.equal(warnings.some(message => message.includes('clientId "C-missing" не найден')), true);
  assert.equal(warnings.some(message => message.includes('автоматическое исправление отключено')), true);
});

test('production write normalization surfaces a missing clientId without name, INN or rental fallback', () => {
  const warnings = [];
  const record = {
    id: 'R-missing-client',
    client: 'ООО Ромашка',
    clientInn: '1655000000',
    rentalId: 'R-related',
  };
  const clients = [{ id: 'C-1', company: 'ООО Ромашка', inn: '1655000000' }];
  const relatedRentalsById = new Map([
    ['R-related', { id: 'R-related', clientId: 'C-1' }],
  ]);

  const normalized = normalizeRecordClientLink(record, clients, {
    allowLegacyRecovery: false,
    relatedRentalsById,
    logger: { warn(message) { warnings.push(String(message)); } },
  });

  assert.equal(normalized, record);
  assert.equal(normalized.clientId, undefined);
  assert.equal(warnings.some(message => message.includes('clientId отсутствует')), true);
  assert.equal(warnings.some(message => message.includes('production write отключено')), true);
});
