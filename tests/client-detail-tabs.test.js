import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLIENT_DETAIL_TABS,
  belongsToClientBoundary,
  buildClientDetailTabModel,
  resolveClientDetailTab,
} from '../src/app/lib/clientDetailTabs.js';

const client = {
  id: 'C-1',
  counterpartyId: 'CP-1',
  company: 'ООО «Альфа»',
  history: [{ date: '2026-08-01T10:00:00.000Z', text: 'Клиент проверен', author: 'Админ' }],
};

function populatedInput() {
  return {
    client,
    rentals: [
      {
        id: 'R-1',
        number: 'AR-000001',
        counterpartyId: 'CP-1',
        clientId: 'C-1',
        client: 'ООО «Альфа»',
        startDate: '2026-08-01',
        plannedReturnDate: '2026-08-10',
        status: 'active',
        price: 120000,
        equipmentId: 'E-1',
        equipmentInv: 'INV-1',
        equipment: ['INV-1'],
        history: [{ date: '2026-08-01T11:00:00.000Z', text: 'Аренда создана', author: 'Менеджер' }],
      },
    ],
    ganttRentals: [
      {
        id: 'GR-1',
        rentalId: 'R-1',
        counterpartyId: 'CP-1',
        clientId: 'C-1',
        equipmentId: 'E-1',
        equipmentInv: 'INV-1',
        startDate: '2026-08-01',
        endDate: '2026-08-10',
        status: 'active',
        amount: 120000,
        comments: [{ date: '2026-08-02T11:00:00.000Z', text: 'Отгрузка подтверждена', author: 'Логист' }],
      },
    ],
    payments: [
      {
        id: 'P-1',
        invoiceNumber: 'PAY-000001',
        counterpartyId: 'CP-1',
        clientId: 'C-1',
        rentalId: 'R-1',
        amount: 100000,
        paidAmount: 80000,
        paidDate: '2026-08-03',
        dueDate: '2026-08-03',
        status: 'partial',
      },
    ],
    paymentAllocations: [
      { id: 'A-1', paymentId: 'P-1', clientId: 'C-1', rentalId: 'R-1', amount: 60000, status: 'active' },
    ],
    documents: [
      {
        id: 'D-1',
        number: 'DOC-000001',
        type: 'rental_contract',
        counterpartyId: 'CP-1',
        clientId: 'C-1',
        rentalId: 'R-1',
        date: '2026-08-01',
        status: 'signed',
        history: [{ id: 'DH-1', action: 'signed', createdAt: '2026-08-04T12:00:00.000Z', createdBy: 'Офис' }],
      },
    ],
    contracts: [
      { id: 'CC-1', number: 'CON-000001', counterpartyId: 'CP-1', clientId: 'C-1', date: '2026-07-31', status: 'active' },
    ],
    crmActivities: [
      { id: 'CRM-1', clientId: 'C-1', occurredAt: '2026-08-05T09:00:00.000Z', result: 'Клиент подтвердил возврат', managerName: 'Менеджер' },
    ],
  };
}

test('client detail tab ids support every section and safely normalize unknown deep links', () => {
  assert.deepEqual(CLIENT_DETAIL_TABS.map(tab => tab.id), [
    'overview',
    'rentals',
    'payments',
    'documents',
    'equipment',
    'activity',
  ]);
  for (const tab of CLIENT_DETAIL_TABS) assert.equal(resolveClientDetailTab(tab.id), tab.id);
  assert.equal(resolveClientDetailTab('unknown'), 'overview');
  assert.equal(resolveClientDetailTab(''), 'overview');
  assert.equal(resolveClientDetailTab(null), 'overview');
});

test('client detail model uses canonical relations for rental, payment allocation, documents, equipment and counters', () => {
  const model = buildClientDetailTabModel(populatedInput());

  assert.equal(model.rentals.length, 1);
  assert.equal(model.rentals[0].businessNumber, 'AR-000001');
  assert.equal(model.rentals[0].navigationId, 'R-1');
  assert.equal(model.rentals[0].amount, 120000);
  assert.equal(model.payments.length, 1);
  assert.equal(model.payments[0].allocatedAmount, 60000);
  assert.equal(model.payments[0].unallocatedAmount, 20000);
  assert.equal(model.documents.length, 1);
  assert.equal(model.contracts.length, 1);
  assert.equal(model.equipment.length, 1);
  assert.equal(model.equipment[0].current, true);
  assert.equal(model.equipment[0].rentals[0].navigationId, 'R-1');
  assert.deepEqual(model.counters, {
    rentals: 1,
    payments: 1,
    documents: 2,
    equipment: 1,
    activity: 6,
  });
});

test('client detail excludes name-only matches and conflicting cross-client records', () => {
  const input = populatedInput();
  input.rentals.push(
    { id: 'R-NAME', client: 'ООО «Альфа»', status: 'active', startDate: '2026-08-01', plannedReturnDate: '2026-08-02' },
    { id: 'R-OTHER', counterpartyId: 'CP-2', clientId: 'C-2', client: 'ООО «Альфа»', status: 'active', startDate: '2026-08-01', plannedReturnDate: '2026-08-02' },
  );
  input.payments.push(
    { id: 'P-NAME', client: 'ООО «Альфа»', amount: 10, paidAmount: 10, paidDate: '2026-08-03', status: 'paid' },
    { id: 'P-OTHER', counterpartyId: 'CP-2', clientId: 'C-2', rentalId: 'R-OTHER', amount: 10, paidAmount: 10, paidDate: '2026-08-03', status: 'paid' },
    { id: 'P-CONFLICT', counterpartyId: 'CP-2', clientId: 'C-2', rentalId: 'R-1', amount: 10, paidAmount: 10, paidDate: '2026-08-03', status: 'paid' },
  );
  input.documents.push(
    { id: 'D-NAME', client: 'ООО «Альфа»', number: 'NAME', type: 'act', status: 'signed', date: '2026-08-01' },
    { id: 'D-OTHER', counterpartyId: 'CP-2', clientId: 'C-2', rentalId: 'R-OTHER', number: 'OTHER', type: 'act', status: 'signed', date: '2026-08-01' },
    { id: 'D-CONFLICT', counterpartyId: 'CP-2', clientId: 'C-2', rentalId: 'R-1', number: 'CONFLICT', type: 'act', status: 'signed', date: '2026-08-01' },
  );

  const model = buildClientDetailTabModel(input);

  assert.deepEqual(model.rentals.map(item => item.id), ['R-1']);
  assert.deepEqual(model.payments.map(item => item.id), ['P-1']);
  assert.deepEqual(model.documents.map(item => item.id), ['D-1']);
  assert.equal(model.equipment.length, 1);
});

test('legacy clientId-only records remain inside the stable Client -> Counterparty compatibility chain', () => {
  assert.equal(belongsToClientBoundary({ clientId: 'C-1' }, client), true);
  assert.equal(belongsToClientBoundary({ clientId: 'C-2' }, client), false);
  assert.equal(belongsToClientBoundary({ counterpartyId: 'CP-1', clientId: 'C-2' }, client), false);

  const model = buildClientDetailTabModel({
    client,
    rentals: [{ id: 'R-LEGACY', clientId: 'C-1', number: 'AR-LEGACY', status: 'closed', startDate: '2026-01-01', plannedReturnDate: '2026-01-02' }],
    payments: [{ id: 'P-LEGACY', clientId: 'C-1', amount: 10, paidAmount: 10, paidDate: '2026-01-03', status: 'paid' }],
    documents: [{ id: 'D-LEGACY', clientId: 'C-1', number: 'D-LEGACY', type: 'act', status: 'signed', date: '2026-01-02' }],
  });

  assert.equal(model.rentals.length, 1);
  assert.equal(model.payments.length, 1);
  assert.equal(model.documents.length, 1);
});

test('client detail empty model drives real empty states instead of empty tables', () => {
  const model = buildClientDetailTabModel({ client });
  assert.deepEqual(model.counters, { rentals: 0, payments: 0, documents: 0, equipment: 0, activity: 1 });

  const source = readFileSync(new URL('../src/app/components/clients/ClientDetailTabContent.tsx', import.meta.url), 'utf8');
  for (const message of [
    'У клиента пока нет аренд',
    'У клиента пока нет платежей',
    'У клиента пока нет документов',
    'В арендной истории клиента пока нет техники',
    'По клиенту пока нет зафиксированных событий',
  ]) assert.match(source, new RegExp(message));
});

test('ClientDetail tabs use URL search state and render one selected tabpanel', () => {
  const source = readFileSync(new URL('../src/app/pages/ClientDetail.tsx', import.meta.url), 'utf8');
  assert.match(source, /useSearchParams\(\)/);
  assert.match(source, /searchParams\.get\('tab'\)/);
  assert.match(source, /next\.set\('tab', tab\)/);
  assert.match(source, /setSearchParams\(next\)/);
  assert.match(source, /onClick=\{\(\) => selectTab\(tab\.id\)\}/);
  assert.match(source, /aria-selected=\{selected\}/);
  assert.match(source, /activeTab === 'overview'/);
  assert.match(source, /<ClientDetailTabContent/);
});
