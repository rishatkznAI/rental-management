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

test('normalizeClientLinks restores rental, payment and document clientId from old client name', () => {
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

  assert.equal(result.changed, 4);
  assert.equal(store.get('gantt_rentals')[0].clientId, 'c-1');
  assert.equal(store.get('rentals')[0].clientId, 'c-1');
  assert.equal(store.get('payments')[0].clientId, 'c-1');
  assert.equal(store.get('documents')[0].clientId, 'c-1');
  assert.deepEqual(warnings, []);
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

test('normalizeClientLinks warns and does not guess on ambiguous names', () => {
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
  assert.equal(warnings.some(message => message.includes('не удалось однозначно сопоставить')), true);
});
