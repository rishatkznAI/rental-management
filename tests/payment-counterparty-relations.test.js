import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const Database = serverRequire('better-sqlite3');
const { createAccessControl } = serverRequire('./lib/access-control');
const { normalizeRecordClientLink } = serverRequire('./lib/client-links');
const { buildRentalDebtRows } = serverRequire('./lib/finance-core');
const { registerCrudRoutes } = serverRequire('./routes/crud');
const {
  PAYMENT_RELATION_CLASSIFICATIONS,
  assertExistingPaymentAllocationsRemainCanonical,
  assertPaymentAllocationPersistenceEntriesSafe,
  assertPaymentRentalCounterpartyMatch,
  auditPaymentCounterpartyRelations,
  canonicalizePaymentCounterpartyRelation,
  repairPaymentCounterpartyRelations,
} = serverRequire('./lib/payment-counterparty-relations');

function counterparty(id, roles, overrides = {}) {
  return {
    id,
    legalName: `Legal ${id}`,
    shortName: `Short ${id}`,
    status: 'active',
    archivedAt: null,
    roles,
    inn: null,
    phone: null,
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    counterparties: [
      counterparty('CP-C', ['customer']),
      counterparty('CP-S', ['supplier']),
      counterparty('CP-K', ['contractor']),
      counterparty('CP-CS', ['customer', 'supplier']),
    ],
    clients: [
      { id: 'C-C', counterpartyId: 'CP-C', company: 'Customer' },
      { id: 'C-CS', counterpartyId: 'CP-CS', company: 'Customer Supplier' },
    ],
    rentals: [],
    gantt_rentals: [],
    payments: [],
    payment_allocations: [],
    ...overrides,
  };
}

function relationError(fn, code) {
  assert.throws(fn, error => {
    assert.equal(error.code, code);
    assert.equal(Number(error.status) >= 400, true);
    return true;
  });
}

test('Payment accepts direct supplier/contractor Counterparties without creating Client', () => {
  for (const counterpartyId of ['CP-S', 'CP-K']) {
    const store = state();
    const result = canonicalizePaymentCounterpartyRelation({ id: `P-${counterpartyId}`, counterpartyId }, store);
    assert.equal(result.counterpartyId, counterpartyId);
    assert.equal(result.clientId, undefined);
    assert.equal(store.clients.length, 2);
  }
});

test('Payment resolves legacy clientId, matching IDs, and a customer+supplier Counterparty', () => {
  const legacy = canonicalizePaymentCounterpartyRelation({ id: 'P-1', clientId: 'C-C' }, state());
  assert.equal(legacy.clientId, 'C-C');
  assert.equal(legacy.counterpartyId, 'CP-C');

  const matching = canonicalizePaymentCounterpartyRelation({
    id: 'P-2',
    clientId: 'C-CS',
    counterpartyId: 'CP-CS',
  }, state());
  assert.equal(matching.counterpartyId, 'CP-CS');
  assert.equal(matching.clientId, 'C-CS');
});

test('Payment rejects ID mismatch, missing targets, missing Client link, duplicate stable IDs, and metadata-only identity', () => {
  relationError(
    () => canonicalizePaymentCounterpartyRelation({ clientId: 'C-C', counterpartyId: 'CP-S' }, state()),
    'COUNTERPARTY_RELATION_MISMATCH',
  );
  relationError(
    () => canonicalizePaymentCounterpartyRelation({ clientId: 'C-missing' }, state()),
    'COUNTERPARTY_RELATION_CLIENT_NOT_FOUND',
  );
  relationError(
    () => canonicalizePaymentCounterpartyRelation({ counterpartyId: 'CP-missing' }, state()),
    'COUNTERPARTY_RELATION_COUNTERPARTY_NOT_FOUND',
  );
  relationError(
    () => canonicalizePaymentCounterpartyRelation(
      { clientId: 'C-no-link' },
      state({ clients: [{ id: 'C-no-link', company: 'Legacy' }] }),
    ),
    'COUNTERPARTY_RELATION_CLIENT_LINK_MISSING',
  );
  relationError(
    () => canonicalizePaymentCounterpartyRelation(
      { counterpartyId: 'CP-S' },
      state({ counterparties: [counterparty('CP-S', ['supplier']), counterparty('CP-S', ['supplier'])] }),
    ),
    'COUNTERPARTY_RELATION_AMBIGUOUS',
  );
  relationError(
    () => canonicalizePaymentCounterpartyRelation({ client: 'Short CP-S', inn: '7700000000' }, state()),
    'COUNTERPARTY_RELATION_ID_REQUIRED',
  );
});

test('Rental to Payment uses authoritative Rental.counterpartyId and compatibility clientId', () => {
  const store = state({
    rentals: [{
      id: 'R-1',
      counterpartyId: 'CP-C',
      clientId: 'C-C',
      client: 'Rental snapshot',
    }],
  });
  const result = canonicalizePaymentCounterpartyRelation({ id: 'P-R', rentalId: 'R-1' }, store);
  assert.equal(result.counterpartyId, 'CP-C');
  assert.equal(result.clientId, 'C-C');
  assert.equal(result.client, 'Rental snapshot');
  relationError(
    () => canonicalizePaymentCounterpartyRelation({ rentalId: 'R-1', counterpartyId: 'CP-S' }, store),
    'COUNTERPARTY_RELATION_MISMATCH',
  );
});

test('Payment allocation Counterparty assertion accepts stable legacy chains and rejects every unresolved or conflicting relation', () => {
  const store = state({
    counterparties: [counterparty('CP-A', ['customer']), counterparty('CP-B', ['customer'])],
    clients: [
      { id: 'C-A', counterpartyId: 'CP-A', company: 'Same display name' },
      { id: 'C-B', counterpartyId: 'CP-B', company: 'Same display name' },
    ],
  });

  assert.equal(
    assertPaymentRentalCounterpartyMatch(
      { id: 'P-direct', counterpartyId: 'CP-A' },
      { id: 'R-direct', counterpartyId: 'CP-A' },
      store,
    ).counterpartyId,
    'CP-A',
  );
  assert.equal(
    assertPaymentRentalCounterpartyMatch(
      { id: 'P-client', clientId: 'C-A' },
      { id: 'R-client', clientId: 'C-A' },
      store,
    ).counterpartyId,
    'CP-A',
  );
  relationError(
    () => assertPaymentRentalCounterpartyMatch(
      { id: 'P-cross', counterpartyId: 'CP-A', client: 'Same display name' },
      { id: 'R-cross', counterpartyId: 'CP-B', client: 'Same display name' },
      store,
    ),
    'COUNTERPARTY_RELATION_MISMATCH',
  );
  relationError(
    () => assertPaymentRentalCounterpartyMatch(
      { id: 'P-dual', clientId: 'C-B', counterpartyId: 'CP-A' },
      { id: 'R-A', counterpartyId: 'CP-A' },
      store,
    ),
    'COUNTERPARTY_RELATION_MISMATCH',
  );
  relationError(
    () => assertPaymentRentalCounterpartyMatch(
      { id: 'P-A', counterpartyId: 'CP-A' },
      { id: 'R-dual', clientId: 'C-B', counterpartyId: 'CP-A' },
      store,
    ),
    'COUNTERPARTY_RELATION_MISMATCH',
  );
  relationError(
    () => assertPaymentRentalCounterpartyMatch(
      { id: 'P-unresolved', client: 'Same display name' },
      { id: 'R-A', counterpartyId: 'CP-A' },
      store,
    ),
    'COUNTERPARTY_RELATION_ID_REQUIRED',
  );
  relationError(
    () => assertPaymentRentalCounterpartyMatch(
      { id: 'P-A', counterpartyId: 'CP-A' },
      { id: 'R-unresolved', client: 'Same display name' },
      store,
    ),
    'COUNTERPARTY_RELATION_ID_REQUIRED',
  );
});

test('existing allocation mutation guard validates staged-next endpoint identity and deletion atomically', () => {
  const current = state({
    counterparties: [counterparty('CP-A', ['customer']), counterparty('CP-B', ['customer'])],
    clients: [
      { id: 'C-A', counterpartyId: 'CP-A' },
      { id: 'C-A2', counterpartyId: 'CP-A' },
      { id: 'C-B', counterpartyId: 'CP-B' },
    ],
    payments: [{ id: 'P-1', clientId: 'C-A', counterpartyId: 'CP-A' }],
    rentals: [{ id: 'R-1', clientId: 'C-A', counterpartyId: 'CP-A' }],
    payment_allocations: [{ id: 'PA-1', paymentId: 'P-1', rentalId: 'R-1', status: 'active' }],
  });

  assert.equal(assertExistingPaymentAllocationsRemainCanonical({
    currentPayments: current.payments,
    nextPayments: [{ id: 'P-1', clientId: 'C-A2', counterpartyId: 'CP-A' }],
    currentRentals: current.rentals,
    allocations: current.payment_allocations,
    currentData: current,
    nextData: current,
  }).checked, 1);

  for (const nextPayments of [
    [{ id: 'P-1', clientId: 'C-B', counterpartyId: 'CP-B' }],
    [],
    [{ id: 'P-1', counterpartyId: 'CP-A' }, { id: 'P-1', counterpartyId: 'CP-A' }],
    [{ id: 'P-1', clientId: 'C-A', counterpartyId: 'CP-B' }],
    [{ id: 'P-1', counterpartyId: 'CP-missing' }],
    [{ id: 'P-1', client: 'metadata only' }],
  ]) {
    assert.throws(() => assertExistingPaymentAllocationsRemainCanonical({
      currentPayments: current.payments,
      nextPayments,
      currentRentals: current.rentals,
      allocations: current.payment_allocations,
      currentData: current,
      nextData: current,
    }), error => String(error.code || '').startsWith('COUNTERPARTY_RELATION_'));
  }

  for (const nextRentals of [
    [{ id: 'R-1', clientId: 'C-B', counterpartyId: 'CP-B' }],
    [],
    [{ id: 'R-1', counterpartyId: 'CP-A' }, { id: 'R-1', counterpartyId: 'CP-A' }],
    [{ id: 'R-1', clientId: 'C-A', counterpartyId: 'CP-B' }],
    [{ id: 'R-1', counterpartyId: 'CP-missing' }],
    [{ id: 'R-1', client: 'metadata only' }],
  ]) {
    assert.throws(() => assertExistingPaymentAllocationsRemainCanonical({
      currentPayments: current.payments,
      currentRentals: current.rentals,
      nextRentals,
      allocations: current.payment_allocations,
      currentData: current,
      nextData: current,
    }), error => String(error.code || '').startsWith('COUNTERPARTY_RELATION_'));
  }
});

test('persistence-entry guard uses the complete staged batch and ignores cancelled allocation history', () => {
  const current = state({
    counterparties: [counterparty('CP-A', ['customer']), counterparty('CP-B', ['customer'])],
    payments: [{ id: 'P-1', counterpartyId: 'CP-A' }],
    rentals: [{ id: 'R-1', counterpartyId: 'CP-A' }],
    payment_allocations: [
      { id: 'PA-active', paymentId: 'P-1', rentalId: 'R-1', status: 'active' },
      { id: 'PA-cancelled', paymentId: 'P-old', rentalId: 'R-old', status: 'cancelled' },
    ],
  });
  const readData = name => current[name] || [];

  assert.equal(assertPaymentAllocationPersistenceEntriesSafe([
    { name: 'payments', value: [{ id: 'P-1', counterpartyId: 'CP-B' }] },
    { name: 'rentals', value: [{ id: 'R-1', counterpartyId: 'CP-B' }] },
  ], { readData }).checked, 1);

  relationError(
    () => assertPaymentAllocationPersistenceEntriesSafe([
      { name: 'payments', value: [{ id: 'P-1', counterpartyId: 'CP-B' }] },
    ], { readData }),
    'COUNTERPARTY_RELATION_MISMATCH',
  );
});

test('persistence-entry guard checks changed effective allocation-only rows', () => {
  const current = state({
    counterparties: [counterparty('CP-A', ['customer'])],
    payments: [{ id: 'P-1', counterpartyId: 'CP-A' }],
    rentals: [{ id: 'R-1', counterpartyId: 'CP-A' }],
    payment_allocations: [{
      id: 'PA-1',
      paymentId: 'P-1',
      rentalId: 'R-1',
      amount: 100,
      status: 'active',
    }],
  });
  const readData = name => current[name] || [];

  const checked = assertPaymentAllocationPersistenceEntriesSafe([{
    name: 'payment_allocations',
    value: [{ ...current.payment_allocations[0], comment: 'changed allocation-only row' }],
  }], { readData });
  assert.equal(checked.checked, 1);
  assert.deepEqual(checked.affectedPaymentIds, ['P-1']);
  assert.deepEqual(checked.affectedRentalIds, ['R-1']);

  relationError(
    () => assertPaymentAllocationPersistenceEntriesSafe([{
      name: 'payment_allocations',
      value: [{ ...current.payment_allocations[0], rentalId: null }],
    }], { readData }),
    'COUNTERPARTY_RELATION_ID_REQUIRED',
  );
  relationError(
    () => assertPaymentAllocationPersistenceEntriesSafe([{
      name: 'payment_allocations',
      value: [{ ...current.payment_allocations[0], paymentId: '' }],
    }], { readData }),
    'COUNTERPARTY_RELATION_ID_REQUIRED',
  );

  assert.equal(assertPaymentAllocationPersistenceEntriesSafe([{
    name: 'payment_allocations',
    value: [{ id: 'PA-history', status: 'cancelled' }],
  }], { readData }).checked, 0);
});

test('persistence-entry guard covers authoritative Client, Counterparty, and role dependency mutations', () => {
  const current = state({
    counterparties: [counterparty('CP-A', ['customer'])],
    counterparty_role_assignments: [{
      id: 'A-A',
      counterpartyId: 'CP-A',
      roleCode: 'customer',
      status: 'active',
      validTo: null,
    }],
    clients: [{ id: 'C-A', counterpartyId: 'CP-A', company: 'A' }],
    payments: [{ id: 'P-1', clientId: 'C-A', counterpartyId: 'CP-A' }],
    rentals: [{ id: 'R-1', clientId: 'C-A', counterpartyId: 'CP-A' }],
    payment_allocations: [{ id: 'PA-1', paymentId: 'P-1', rentalId: 'R-1', status: 'active' }],
  });
  const readData = name => current[name] || [];

  assert.equal(assertPaymentAllocationPersistenceEntriesSafe([
    { name: 'clients', value: [{ ...current.clients[0], company: 'Renamed' }] },
    { name: 'counterparties', value: [{ ...current.counterparties[0], shortName: 'Renamed' }] },
  ], { readData }).checked, 0);

  for (const entries of [
    [{ name: 'clients', value: [] }],
    [{ name: 'counterparties', value: [] }],
    [{
      name: 'counterparty_role_assignments',
      value: [{ ...current.counterparty_role_assignments[0], status: 'inactive', validTo: '2026-08-15' }],
    }],
  ]) {
    assert.throws(
      () => assertPaymentAllocationPersistenceEntriesSafe(entries, { readData }),
      error => String(error.code || '').startsWith('COUNTERPARTY_RELATION_'),
    );
  }
});

test('affected historically invalid allocation fails closed even when next state would repair it', () => {
  const current = state({
    counterparties: [counterparty('CP-A', ['customer'])],
    payments: [],
    rentals: [{ id: 'R-1', counterpartyId: 'CP-A' }],
    payment_allocations: [{ id: 'PA-orphan', paymentId: 'P-1', rentalId: 'R-1', status: 'active' }],
  });
  relationError(
    () => assertPaymentAllocationPersistenceEntriesSafe([
      { name: 'payments', value: [{ id: 'P-1', counterpartyId: 'CP-A' }] },
    ], { readData: name => current[name] || [] }),
    'COUNTERPARTY_RELATION_ENDPOINT_NOT_FOUND',
  );
});

test('resolution-impact scan does not block an unrelated mutation because of unchanged invalid history', () => {
  const current = state({
    counterparties: [counterparty('CP-A', ['customer'])],
    payments: [],
    rentals: [{ id: 'R-1', counterpartyId: 'CP-A' }],
    payment_allocations: [{ id: 'PA-orphan', paymentId: 'P-missing', rentalId: 'R-1', status: 'active' }],
  });
  const result = assertPaymentAllocationPersistenceEntriesSafe([{
    name: 'counterparties',
    value: [...current.counterparties, counterparty('CP-unrelated', ['supplier'])],
  }], { readData: name => current[name] || [] });

  assert.equal(result.checked, 0);
});

test('allocation guard detects missing-id classic and Gantt Rental alias collisions by resolution impact', () => {
  const current = state({
    counterparties: [counterparty('CP-A', ['customer'])],
    payments: [{ id: 'P-A', rentalId: 'X', counterpartyId: 'CP-A' }],
    rentals: [{ id: 'R-A', rentalId: 'X', counterpartyId: 'CP-A' }],
    gantt_rentals: [],
    payment_allocations: [{ id: 'PA-X', paymentId: 'P-A', rentalId: 'X', status: 'active' }],
  });
  const readData = name => current[name] || [];

  for (const [name, value] of [
    ['rentals', [...current.rentals, { rentalId: 'X', counterpartyId: 'CP-A' }]],
    ['gantt_rentals', [{ sourceRentalId: 'X', counterpartyId: 'CP-A' }]],
  ]) {
    assert.throws(
      () => assertPaymentAllocationPersistenceEntriesSafe([{ name, value }], { readData }),
      error => {
        assert.equal(error.code, 'COUNTERPARTY_RELATION_AMBIGUOUS');
        assert.equal(error.details?.allocationId, 'PA-X');
        assert.equal(error.details?.phase, 'next');
        return true;
      },
    );
  }
});

test('Payment endpoint identity is exact-id-only while a duplicate exact ID remains fail-closed', () => {
  const current = state({
    counterparties: [counterparty('CP-A', ['customer'])],
    payments: [{ id: 'P-A', counterpartyId: 'CP-A' }],
    rentals: [{ id: 'R-A', counterpartyId: 'CP-A' }],
    payment_allocations: [{ id: 'PA-A', paymentId: 'P-A', rentalId: 'R-A', status: 'active' }],
  });
  const readData = name => current[name] || [];

  const noIdWithPaymentLikeAlias = assertPaymentAllocationPersistenceEntriesSafe([{
    name: 'payments',
    value: [...current.payments, { paymentId: 'P-A', counterpartyId: 'CP-A' }],
  }], { readData });
  assert.equal(noIdWithPaymentLikeAlias.checked, 0);

  assert.throws(
    () => assertPaymentAllocationPersistenceEntriesSafe([{
      name: 'payments',
      value: [...current.payments, { id: 'P-A', counterpartyId: 'CP-A' }],
    }], { readData }),
    error => error.code === 'COUNTERPARTY_RELATION_AMBIGUOUS'
      && error.details?.allocationId === 'PA-A'
      && error.details?.phase === 'next',
  );
});

test('Payment audit emits the required machine-readable classifications', () => {
  const audit = auditPaymentCounterpartyRelations(state({
    clients: [
      { id: 'C-C', counterpartyId: 'CP-C' },
      { id: 'C-no-link' },
    ],
    payments: [
      { id: 'P-valid', counterpartyId: 'CP-S' },
      { id: 'P-repair', clientId: 'C-C' },
      { id: 'P-mismatch', clientId: 'C-C', counterpartyId: 'CP-S' },
      { id: 'P-missing-client', clientId: 'C-missing' },
      { id: 'P-missing-counterparty', counterpartyId: 'CP-missing' },
      { id: 'P-client-no-link', clientId: 'C-no-link' },
      { id: 'P-metadata', client: 'Metadata only' },
      { id: 'P-duplicate', counterpartyId: 'CP-S' },
      { id: 'P-duplicate', counterpartyId: 'CP-S' },
    ],
  }));
  for (const classification of [
    'valid_counterparty',
    'repairable_from_client',
    'mismatch',
    'missing_client',
    'missing_counterparty',
    'client_missing_counterparty',
    'metadata_only',
    'duplicate_stable_id',
  ]) {
    assert.equal(audit.summary.classifications[classification] > 0, true, classification);
  }
});

test('Payment audit preserves archived Counterparty history while active writes remain blocked', () => {
  const store = state({
    counterparties: [counterparty('CP-S', ['supplier'], {
      status: 'archived',
      archivedAt: '2026-08-11T00:00:00.000Z',
    })],
    payments: [{ id: 'P-history', counterpartyId: 'CP-S', status: 'paid' }],
  });

  const audit = auditPaymentCounterpartyRelations(store);
  assert.deepEqual(audit.healthy.map(item => item.recordId), ['P-history']);
  relationError(
    () => canonicalizePaymentCounterpartyRelation(store.payments[0], store),
    'COUNTERPARTY_RELATION_COUNTERPARTY_ARCHIVED',
  );
});

test('Payment migration dry-run, apply, and re-run are deterministic and idempotent', () => {
  const store = state({ payments: [{ id: 'P-legacy', clientId: 'C-C', client: 'Editable display' }] });
  const readData = name => store[name] || [];
  const writeDataBatch = entries => {
    for (const entry of entries) store[entry.name] = entry.value;
  };

  const dryRun = repairPaymentCounterpartyRelations({ readData, writeDataBatch, dryRun: true });
  assert.equal(dryRun.changed.length, 1);
  assert.equal(dryRun.changed[0].classification, PAYMENT_RELATION_CLASSIFICATIONS.REPAIRABLE_FROM_CLIENT);
  assert.equal(store.payments[0].counterpartyId, undefined);

  const applied = repairPaymentCounterpartyRelations({ readData, writeDataBatch, dryRun: false });
  assert.equal(applied.changed.length, 1);
  assert.equal(applied.changed[0].applied, true);
  assert.equal(store.payments[0].counterpartyId, 'CP-C');
  const second = repairPaymentCounterpartyRelations({ readData, writeDataBatch, dryRun: false });
  assert.equal(second.changed.length, 0);
});

test('migration CLI keeps dry-run read-only and blocks raw apply without mutation', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'payment-counterparty-'));
  const dbPath = path.join(directory, 'app.sqlite');
  const scriptPath = new URL('../server/scripts/payment-counterparty-relations.js', import.meta.url).pathname;
  const db = new Database(dbPath);
  try {
    db.exec('CREATE TABLE app_data (name TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT)');
    const insert = db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)');
    insert.run('counterparties', JSON.stringify([counterparty('CP-C', ['customer'])]));
    insert.run('clients', JSON.stringify([{ id: 'C-C', counterpartyId: 'CP-C' }]));
    insert.run('payments', JSON.stringify([{ id: 'P-legacy', clientId: 'C-C' }]));
  } finally {
    db.close();
  }

  try {
    const dry = spawnSync(process.execPath, [scriptPath, '--dry-run', '--db', dbPath], { encoding: 'utf8' });
    assert.equal(dry.status, 0, dry.stderr);
    const dryOutput = JSON.parse(dry.stdout);
    assert.equal(dryOutput.wrote, false);
    assert.equal(dryOutput.result.summary.classifications.repairable_from_client, 1);
    let verify = new Database(dbPath, { readonly: true });
    assert.equal(JSON.parse(verify.prepare("SELECT json FROM app_data WHERE name = 'payments'").get().json)[0].counterpartyId, undefined);
    verify.close();

    const apply = spawnSync(process.execPath, [scriptPath, '--apply', '--db', dbPath], { encoding: 'utf8' });
    assert.notEqual(apply.status, 0);
    assert.match(apply.stderr, /AUDITED_MAINTENANCE_RUNNER_REQUIRED/);
    verify = new Database(dbPath, { readonly: true });
    assert.equal(JSON.parse(verify.prepare("SELECT json FROM app_data WHERE name = 'payments'").get().json)[0].counterpartyId, undefined);
    verify.close();
    assert.equal(existsSync(path.join(directory, 'backups')), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createPaymentApi() {
  const store = state({
    users: [],
    counterparties: [
      counterparty('CP-S', ['supplier'], { legalName: 'Supplier Alpha', shortName: 'Alpha', inn: '7701000000', phone: '+79990000000' }),
      counterparty('CP-K', ['contractor'], { legalName: 'Contractor Beta', shortName: 'Beta' }),
    ],
    clients: [],
    payments: [],
  });
  const users = {
    admin: { userId: 'U-A', userName: 'Admin', userRole: 'Администратор' },
    office: { userId: 'U-O', userName: 'Office', userRole: 'Офис-менеджер' },
    manager: { userId: 'U-M', userName: 'Manager', userRole: 'Менеджер по аренде' },
  };
  const readData = name => store[name] || [];
  const writeData = (name, value) => { store[name] = value; };
  const accessControl = createAccessControl({ readData });
  let idCounter = 0;
  const app = express();
  app.use(express.json());
  const requireAuth = (req, res, next) => {
    const user = users[String(req.headers.authorization || '').replace(/^Bearer\s+/, '')];
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = user;
    return next();
  };
  const requireRead = collection => (req, res, next) => (
    collection === 'payments' ? next() : res.status(403).json({ ok: false, error: 'Forbidden' })
  );
  const requireWrite = collection => (req, res, next) => (
    collection === 'payments' && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole)
      ? next()
      : res.status(403).json({ ok: false, error: 'Forbidden' })
  );
  app.use('/api', registerCrudRoutes({
    collections: ['payments'],
    idPrefixes: { payments: 'P' },
    readData,
    writeData,
    writeDataBatch: entries => entries.forEach(entry => writeData(entry.name, entry.value)),
    requireAuth,
    requireRead,
    requireWrite,
    sanitizeUser: value => value,
    publicUserView: value => value,
    canReadFullUsers: () => false,
    hashPassword: value => value,
    normalizeServiceWorkRecord: value => value,
    normalizeSparePartRecord: value => value,
    validateRentalPayload: () => ({ ok: true }),
    mergeEntityHistory: (_collection, _previous, next) => next,
    requireNonEmptyString: () => {},
    generateId: prefix => `${prefix}-${++idCounter}`,
    nowIso: () => '2026-08-11T12:00:00.000Z',
    accessControl,
    auditLog: () => {},
    serviceAuditLog: () => {},
    normalizeRecordClientLink,
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

async function apiRequest(baseUrl, method, route, token, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, json: await response.json() };
}

test('Payment API exposes stable Counterparty DTO, filters by counterpartyId, and never resolves metadata as identity', async () => {
  const { app, store } = createPaymentApi();
  await withServer(app, async baseUrl => {
    const created = await apiRequest(baseUrl, 'POST', '/api/payments', 'office', {
      counterpartyId: 'CP-S',
      client: 'Contractor Beta',
      invoiceNumber: 'INV-1',
      amount: 1000,
      status: 'paid',
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.json.counterpartyId, 'CP-S');
    assert.equal(created.json.clientId, undefined);
    assert.deepEqual(created.json.counterparty, {
      id: 'CP-S',
      legalName: 'Supplier Alpha',
      shortName: 'Alpha',
      roles: ['supplier'],
      status: 'active',
      inn: '7701000000',
      phone: '+79990000000',
    });
    assert.equal(store.clients.length, 0);

    await apiRequest(baseUrl, 'POST', '/api/payments', 'admin', {
      counterpartyId: 'CP-K',
      client: 'Supplier Alpha',
      invoiceNumber: 'INV-2',
      amount: 500,
      status: 'paid',
    });
    const filtered = await apiRequest(baseUrl, 'GET', '/api/payments?paginated=true&page=1&pageSize=20&counterpartyId=CP-S', 'admin');
    assert.equal(filtered.response.status, 200);
    assert.deepEqual(filtered.json.items.map(item => item.counterpartyId), ['CP-S']);
    const discovered = await apiRequest(baseUrl, 'GET', '/api/payments?paginated=true&page=1&pageSize=20&search=7701000000', 'admin');
    assert.deepEqual(discovered.json.items.map(item => item.counterpartyId), ['CP-S']);

    const metadataOnly = await apiRequest(baseUrl, 'POST', '/api/payments', 'office', {
      client: 'Supplier Alpha',
      invoiceNumber: 'INV-3',
      amount: 1,
      status: 'paid',
    });
    assert.equal(metadataOnly.response.status, 400);
    assert.equal(metadataOnly.json.code, 'COUNTERPARTY_RELATION_ID_REQUIRED');
  });
});

test('Payment authorization remains backend-enforced for canonical Counterparty payments', async () => {
  const { app } = createPaymentApi();
  await withServer(app, async baseUrl => {
    const denied = await apiRequest(baseUrl, 'POST', '/api/payments', 'manager', {
      counterpartyId: 'CP-S', invoiceNumber: 'INV-X', amount: 1, status: 'paid',
    });
    assert.equal(denied.response.status, 403);
    const allowed = await apiRequest(baseUrl, 'POST', '/api/payments', 'office', {
      counterpartyId: 'CP-S', invoiceNumber: 'INV-Y', amount: 1, status: 'paid',
    });
    assert.equal(allowed.response.status, 201);
    const managerList = await apiRequest(baseUrl, 'GET', '/api/payments', 'manager');
    assert.deepEqual(managerList.json, []);
  });
});

test('Payment bulk replace rejects duplicate stable IDs before persistence', async () => {
  const { app, store } = createPaymentApi();
  await withServer(app, async baseUrl => {
    const before = structuredClone(store.payments);
    const duplicate = await apiRequest(baseUrl, 'PUT', '/api/payments', 'admin', [
      { id: 'P-duplicate', counterpartyId: 'CP-S', amount: 1, status: 'paid' },
      { id: 'P-duplicate', counterpartyId: 'CP-K', amount: 2, status: 'paid' },
    ]);

    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.json.code, 'COUNTERPARTY_RELATION_AMBIGUOUS');
    assert.deepEqual(store.payments, before);
  });
});

test('counterpartyId is identity-only and does not change existing financial calculations', () => {
  const rentals = [{
    id: 'R-1',
    counterpartyId: 'CP-C',
    clientId: 'C-C',
    client: 'Customer',
    startDate: '2026-08-01',
    endDate: '2026-08-05',
    amount: 1000,
    status: 'active',
  }];
  const legacyPayments = [{ id: 'P-1', rentalId: 'R-1', clientId: 'C-C', amount: 400, paidAmount: 400, status: 'partial' }];
  const canonicalPayments = legacyPayments.map(payment => ({ ...payment, counterpartyId: 'CP-C' }));
  assert.deepEqual(
    buildRentalDebtRows(rentals, canonicalPayments),
    buildRentalDebtRows(rentals, legacyPayments),
  );
});

test('Payments UI no longer derives navigation identity from display names', () => {
  const source = readFileSync(new URL('../src/app/pages/Payments.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /resolveClientProfileId|normalizedClientName\(clientName\)/);
  assert.match(source, /const clientProfileId = text\(payment\.clientId\)/);
  assert.match(source, /counterpartyId: form\.counterpartyId/);
  assert.match(source, /pagination\.setFilters\(\{ counterpartyId:/);
});
