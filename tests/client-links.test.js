import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeClientLinks,
  normalizeRecordClientLink,
} = require('../server/lib/client-links.js');
const {
  buildFinanceReport,
} = require('../server/lib/finance-core.js');

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

test('renamed client keeps legacy rental debt after clientId backfill from history', () => {
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
  const report = buildFinanceReport({
    clients: store.get('clients'),
    rentals: store.get('gantt_rentals'),
    payments: store.get('payments'),
  }, '2026-04-18');

  assert.equal(result.changed, 2);
  assert.equal(store.get('gantt_rentals')[0].clientId, 'c-1');
  assert.equal(store.get('payments')[0].clientId, 'c-1');
  assert.equal(report.clientSnapshots[0].clientId, 'c-1');
  assert.equal(report.clientSnapshots[0].client, 'ООО Ромашка Казань');
  assert.equal(report.clientSnapshots[0].currentDebt, 100000);
  assert.equal(report.totals.debt, 100000);
  assert.deepEqual(warnings, []);
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
