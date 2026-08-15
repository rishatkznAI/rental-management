import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildClient360Summary } from '../src/app/lib/client360.js';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const { createAccessControl } = require('../server/lib/access-control.js');
const {
  buildClientReceivables,
  buildRentalDebtRows,
} = require('../server/lib/finance-core.js');
const {
  assertCanonicalArWorkflowWrite,
  decorateArWorkflowRecord,
} = require('../server/lib/ar-debtor-workflow.js');
const { registerCrudRoutes } = require('../server/routes/crud.js');

function rental(input) {
  return {
    equipmentInv: input.id,
    manager: 'Manager',
    startDate: '2026-08-01',
    endDate: '2026-08-10',
    expectedPaymentDate: '2026-08-10',
    amount: 100,
    status: 'active',
    ...input,
  };
}

function canonicalData(overrides = {}) {
  const clients = overrides.clients || [
    { id: 'C-A1', counterpartyId: 'CP-A', company: 'Shared display' },
    { id: 'C-A2', counterpartyId: 'CP-A', company: 'Renamed profile' },
    { id: 'C-B', counterpartyId: 'CP-B', company: 'Shared display' },
  ];
  const ganttRentals = overrides.gantt_rentals || [
    rental({ id: 'R-A', counterpartyId: 'CP-A', clientId: 'C-A1' }),
    rental({ id: 'R-B', counterpartyId: 'CP-B', clientId: 'C-B' }),
  ];
  return {
    counterparties: [
      { id: 'CP-A', roles: ['customer'], status: 'active' },
      { id: 'CP-B', roles: ['customer'], status: 'active' },
    ],
    clients,
    rentals: [],
    gantt_rentals: ganttRentals,
    payments: overrides.payments || [],
    documents: [],
    client_objects: [],
    client_contracts: [],
    debt_collection_plans: overrides.debt_collection_plans || [],
    debt_collection_actions: overrides.debt_collection_actions || [],
    receivable_payment_plans: overrides.receivable_payment_plans || [],
    ...overrides,
  };
}

function debtRows(data, rentals = data.gantt_rentals, payments = data.payments) {
  return buildRentalDebtRows(rentals, payments, { relationData: data });
}

test('J-H2 grouping 1: same Counterparty with different Client IDs is one debtor aggregate', () => {
  const data = canonicalData({
    gantt_rentals: [
      rental({ id: 'R-A1', counterpartyId: 'CP-A', clientId: 'C-A1', amount: 100 }),
      rental({ id: 'R-A2', counterpartyId: 'CP-A', clientId: 'C-A2', amount: 200 }),
    ],
  });
  const rows = buildClientReceivables(data.clients, debtRows(data), '2026-08-15', { relationData: data });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].counterpartyId, 'CP-A');
  assert.deepEqual(rows[0].clientIds, ['C-A1', 'C-A2']);
  assert.equal(rows[0].currentDebt, 300);
});

test('J-H2 grouping 2: identical display names on different Counterparties remain separate debtors', () => {
  const data = canonicalData({
    clients: [
      { id: 'C-A1', counterpartyId: 'CP-A', company: 'Same name' },
      { id: 'C-B', counterpartyId: 'CP-B', company: 'Same name' },
    ],
  });
  const rows = buildClientReceivables(data.clients, debtRows(data), '2026-08-15', { relationData: data });

  assert.deepEqual(rows.map(row => row.counterpartyId).sort(), ['CP-A', 'CP-B']);
});

test('J-H2 grouping 3: matching Rental and Payment Counterparties preserve the correct debtor amount', () => {
  const payments = [{
    id: 'P-A',
    counterpartyId: 'CP-A',
    clientId: 'C-A1',
    rentalId: 'R-A',
    amount: 40,
    paidAmount: 40,
    status: 'partial',
  }];
  const data = canonicalData({ payments });
  const rows = debtRows(data);
  const row = rows.find(item => item.rentalId === 'R-A');

  assert.equal(row.counterpartyId, 'CP-A');
  assert.equal(row.paidAmount, 40);
  assert.equal(row.outstanding, 60);
});

test('J-H2 grouping 4: conflicting or unresolved relations cannot contaminate a canonical aggregate', () => {
  const data = canonicalData({
    gantt_rentals: [
      rental({ id: 'R-valid', counterpartyId: 'CP-A', clientId: 'C-A1', amount: 100 }),
      rental({ id: 'R-cross', counterpartyId: 'CP-A', clientId: 'C-B', amount: 200 }),
      rental({ id: 'R-unresolved', client: 'Shared display', amount: 300 }),
    ],
  });
  const rows = buildClientReceivables(data.clients, debtRows(data), '2026-08-15', { relationData: data });
  const canonical = rows.find(row => row.counterpartyId === 'CP-A');

  assert.equal(canonical.currentDebt, 100);
  assert.equal(rows.filter(row => !row.counterpartyId).length, 2);
  assert.deepEqual(rows.filter(row => !row.counterpartyId).map(row => row.currentDebt).sort((a, b) => a - b), [200, 300]);
});

test('J-H2 grouping 5: a legacy Rental resolves through a unique Client to Counterparty chain', () => {
  const data = canonicalData({
    gantt_rentals: [rental({ id: 'R-legacy', clientId: 'C-A2' })],
  });
  const [row] = debtRows(data);

  assert.equal(row.counterpartyId, 'CP-A');
  assert.equal(row.debtorIdentityStatus, 'legacy_resolved');
});

test('J-H2 grouping 6: a legacy row without a unique stable chain remains explicitly unresolved', () => {
  const data = canonicalData({
    gantt_rentals: [rental({ id: 'R-name-only', client: 'Shared display' })],
  });
  const [row] = debtRows(data);

  assert.equal(row.counterpartyId, undefined);
  assert.equal(row.debtorCounterpartyId, null);
  assert.equal(row.debtorIdentityStatus, 'unresolved');
});

test('J-H2 workflow 7: a canonical debt collection plan write passes', () => {
  const data = canonicalData();
  const result = assertCanonicalArWorkflowWrite('debt_collection_plans', {
    id: 'DCP-A',
    counterpartyId: 'CP-A',
    clientId: 'C-A1',
  }, data);

  assert.equal(result.counterpartyId, 'CP-A');
});

test('J-H2 workflow 8: a plan with conflicting Client and Counterparty is rejected', () => {
  const data = canonicalData();
  assert.throws(
    () => assertCanonicalArWorkflowWrite('debt_collection_plans', {
      id: 'DCP-cross',
      counterpartyId: 'CP-B',
      clientId: 'C-A1',
    }, data),
    error => error?.code === 'AR_DEBTOR_IDENTITY_REQUIRED' && error?.status === 409,
  );
});

test('J-H2 workflow 9: an action inherits its canonical Counterparty from its authoritative plan', () => {
  const data = canonicalData({
    debt_collection_plans: [{ id: 'DCP-A', counterpartyId: 'CP-A', clientId: 'C-A1' }],
  });
  const action = assertCanonicalArWorkflowWrite('debt_collection_actions', {
    id: 'DCA-A',
    debtCollectionPlanId: 'DCP-A',
    actionType: 'call',
  }, data);

  assert.equal(action.counterpartyId, 'CP-A');
  assert.equal(action.clientId, 'C-A1');
});

test('J-H2 workflow 10: an action cannot switch to another Counterparty', () => {
  const data = canonicalData({
    debt_collection_plans: [{ id: 'DCP-A', counterpartyId: 'CP-A', clientId: 'C-A1' }],
  });
  assert.throws(
    () => assertCanonicalArWorkflowWrite('debt_collection_actions', {
      id: 'DCA-cross',
      debtCollectionPlanId: 'DCP-A',
      counterpartyId: 'CP-B',
      actionType: 'call',
    }, data),
    error => ['AR_DEBTOR_IDENTITY_REQUIRED', 'AR_DEBTOR_PLAN_IDENTITY_MISMATCH'].includes(error?.code),
  );
});

test('J-H2 workflow 11: a payment plan matching its Rental Counterparty passes', () => {
  const data = canonicalData();
  const plan = assertCanonicalArWorkflowWrite('receivable_payment_plans', {
    id: 'RPP-A',
    counterpartyId: 'CP-A',
    rentalId: 'R-A',
    paymentDate: '2026-08-20',
    amount: 50,
  }, data);

  assert.equal(plan.counterpartyId, 'CP-A');
});

test('J-H2 workflow 12: a payment plan cannot cross its Rental Counterparty', () => {
  const data = canonicalData();
  assert.throws(
    () => assertCanonicalArWorkflowWrite('receivable_payment_plans', {
      id: 'RPP-cross',
      counterpartyId: 'CP-B',
      rentalId: 'R-A',
      paymentDate: '2026-08-20',
      amount: 50,
    }, data),
    error => error?.code === 'AR_DEBTOR_IDENTITY_REQUIRED' && error?.status === 409,
  );
});

function createWorkflowBulkApi() {
  const store = canonicalData({
    debt_collection_actions: [{
      id: 'DCA-existing',
      counterpartyId: 'CP-A',
      clientId: 'C-A1',
      actionType: 'call',
    }],
  });
  const readData = name => store[name] || [];
  const writeData = (name, value) => { store[name] = value; };
  const accessControl = createAccessControl({ readData });
  const app = express();
  app.use(express.json());
  const requireAuth = (req, res, next) => {
    req.user = { userId: 'U-admin', userName: 'Admin', userRole: 'Администратор' };
    next();
  };
  const allow = () => (_req, _res, next) => next();
  app.use('/api', registerCrudRoutes({
    collections: ['debt_collection_actions'],
    idPrefixes: { debt_collection_actions: 'DCA' },
    readData,
    writeData,
    writeDataBatch: entries => entries.forEach(entry => writeData(entry.name, entry.value)),
    requireAuth,
    requireRead: allow,
    requireWrite: allow,
    sanitizeUser: value => value,
    publicUserView: value => value,
    canReadFullUsers: () => false,
    hashPassword: value => value,
    normalizeServiceWorkRecord: value => value,
    normalizeSparePartRecord: value => value,
    validateRentalPayload: () => ({ ok: true }),
    mergeEntityHistory: (_collection, _previous, next) => next,
    requireNonEmptyString: () => {},
    generateId: prefix => `${prefix}-generated`,
    nowIso: () => '2026-08-15T12:00:00.000Z',
    accessControl,
    auditLog: () => {},
    serviceAuditLog: () => {},
  }));
  return { app, store };
}

async function withServer(app, fn) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('J-H2 workflow 13: a mixed bulk write rejects atomically with zero writes', async () => {
  const { app, store } = createWorkflowBulkApi();
  const before = structuredClone(store.debt_collection_actions);
  await withServer(app, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/debt_collection_actions`, {
      method: 'PUT',
      headers: { authorization: 'Bearer admin', 'content-type': 'application/json' },
      body: JSON.stringify([
        { id: 'DCA-valid', counterpartyId: 'CP-A', clientId: 'C-A1', actionType: 'call' },
        { id: 'DCA-invalid', counterpartyId: 'CP-B', clientId: 'C-A1', actionType: 'call' },
      ]),
    });
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.code, 'AR_DEBTOR_IDENTITY_REQUIRED');
  });
  assert.deepEqual(store.debt_collection_actions, before);
});

test('J-H2 read 15-16: grouping ignores Client IDs while retaining them as provenance', () => {
  const data = canonicalData({
    gantt_rentals: [
      rental({ id: 'R-A1', counterpartyId: 'CP-A', clientId: 'C-A1' }),
      rental({ id: 'R-A2', counterpartyId: 'CP-A', clientId: 'C-A2' }),
    ],
  });
  const [row] = buildClientReceivables(data.clients, debtRows(data), '2026-08-15', { relationData: data });

  assert.equal(row.counterpartyId, 'CP-A');
  assert.equal(row.clientId, 'C-A1');
  assert.deepEqual(row.clientIds, ['C-A1', 'C-A2']);
  assert.equal(row.unpaidRentals, 2);
});

test('J-H2 read 17: unresolved debtors are explicit and never merged by display metadata', () => {
  const data = canonicalData({
    gantt_rentals: [
      rental({ id: 'R-U1', client: 'Same unresolved name', amount: 10 }),
      rental({ id: 'R-U2', client: 'Same unresolved name', amount: 20 }),
    ],
  });
  const rows = buildClientReceivables(data.clients, debtRows(data), '2026-08-15', { relationData: data });

  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.debtorIdentityStatus === 'unresolved'));
  assert.ok(rows.every(row => row.dataIssue === 'unresolved_debtor_identity'));
});

test('J-H2 read 18: Client 360 resolves through Counterparty and consolidates compatible Client profiles', () => {
  const summary = buildClient360Summary({
    client: { id: 'C-A1', counterpartyId: 'CP-A', company: 'Profile A' },
    today: '2026-08-15',
    rentals: [
      rental({ id: 'R-A1', counterpartyId: 'CP-A', clientId: 'C-A1', amount: 100 }),
      rental({ id: 'R-A2', counterpartyId: 'CP-A', clientId: 'C-A2', amount: 200 }),
      rental({ id: 'R-B', counterpartyId: 'CP-B', clientId: 'C-B', amount: 999 }),
    ],
    rentalDebtRows: [
      { rentalId: 'R-A1', counterpartyId: 'CP-A', clientId: 'C-A1', outstanding: 100, endDate: '2026-08-10' },
      { rentalId: 'R-A2', counterpartyId: 'CP-A', clientId: 'C-A2', outstanding: 200, endDate: '2026-08-10' },
      { rentalId: 'R-B', counterpartyId: 'CP-B', clientId: 'C-B', outstanding: 999, endDate: '2026-08-10' },
    ],
  });

  assert.equal(summary.rentals.active.length, 2);
  assert.equal(summary.debt.total, 300);
});

test('J-H2 historical read: workflow rows resolve without persistence and retain explicit status', () => {
  const data = canonicalData();
  const legacy = { id: 'DCA-legacy', clientId: 'C-A1', actionType: 'call' };
  const unresolved = { id: 'DCA-name-only', clientName: 'Shared display', actionType: 'call' };

  assert.equal(decorateArWorkflowRecord('debt_collection_actions', legacy, data).debtorIdentityStatus, 'legacy_resolved');
  assert.equal(decorateArWorkflowRecord('debt_collection_actions', unresolved, data).debtorIdentityStatus, 'unresolved');
  assert.equal(legacy.counterpartyId, undefined);
  assert.equal(unresolved.counterpartyId, undefined);
});
