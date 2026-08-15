import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  AR_DEBTOR_IDENTITY_STATUSES,
  auditArDebtorIdentities,
  resolveArDebtorIdentity,
} = serverRequire('./lib/ar-debtor-identity');

function counterparty(id, overrides = {}) {
  return {
    id,
    legalName: `Legal ${id}`,
    shortName: id,
    status: 'active',
    archivedAt: null,
    roles: ['customer'],
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    counterparties: [counterparty('CP-A'), counterparty('CP-B')],
    clients: [{ id: 'CLIENT-A', counterpartyId: 'CP-A', company: 'ООО Ромашка' }],
    rentals: [],
    gantt_rentals: [],
    payments: [],
    payment_allocations: [],
    documents: [],
    client_contracts: [],
    client_objects: [],
    counterparty_role_assignments: [],
    debt_collection_plans: [],
    debt_collection_actions: [],
    receivable_payment_plans: [],
    ...overrides,
  };
}

test('explicit canonical Counterparty resolves as counterparty-only', () => {
  const result = resolveArDebtorIdentity({ counterpartyId: 'CP-A' }, state());
  assert.equal(result.status, AR_DEBTOR_IDENTITY_STATUSES.COUNTERPARTY_ONLY);
  assert.equal(result.counterpartyId, 'CP-A');
  assert.deepEqual(result.candidateCounterpartyIds, ['CP-A']);
});

test('legacy Client-only relation resolves through Client.counterpartyId', () => {
  const result = resolveArDebtorIdentity({ clientId: 'CLIENT-A' }, state());
  assert.equal(result.status, AR_DEBTOR_IDENTITY_STATUSES.LEGACY_RESOLVED);
  assert.equal(result.counterpartyId, 'CP-A');
  assert.deepEqual(result.legacyClientIds, ['CLIENT-A']);
});

test('matching explicit Counterparty and Client relation resolves as matching dual ID', () => {
  const result = resolveArDebtorIdentity({
    counterpartyId: 'CP-A',
    clientId: 'CLIENT-A',
  }, state());
  assert.equal(result.status, AR_DEBTOR_IDENTITY_STATUSES.MATCHING_DUAL_ID);
  assert.equal(result.counterpartyId, 'CP-A');
});

test('explicit Counterparty and mismatching Client relation fail closed', () => {
  const result = resolveArDebtorIdentity({
    counterpartyId: 'CP-B',
    clientId: 'CLIENT-A',
  }, state());
  assert.equal(result.status, AR_DEBTOR_IDENTITY_STATUSES.MISMATCH);
  assert.equal(result.counterpartyId, null);
  assert.deepEqual(result.candidateCounterpartyIds, ['CP-A', 'CP-B']);
});

test('same-name Clients never resolve a name-only source', () => {
  const store = state({
    clients: [
      { id: 'CLIENT-A', counterpartyId: 'CP-A', company: 'ООО Ромашка' },
      { id: 'CLIENT-B', counterpartyId: 'CP-B', company: 'ООО Ромашка' },
    ],
  });
  const result = resolveArDebtorIdentity({ clientName: 'ООО Ромашка' }, store);
  assert.equal(result.status, AR_DEBTOR_IDENTITY_STATUSES.UNRESOLVED);
  assert.equal(result.counterpartyId, null);
  assert.deepEqual(result.candidateCounterpartyIds, []);
  assert.deepEqual(result.metadata.displaySnapshots, [{ field: 'clientName', value: 'ООО Ромашка' }]);
});

test('renaming a Client display label does not change debtor identity', () => {
  const before = resolveArDebtorIdentity({ clientId: 'CLIENT-A' }, state());
  const after = resolveArDebtorIdentity({ clientId: 'CLIENT-A' }, state({
    clients: [{ id: 'CLIENT-A', counterpartyId: 'CP-A', company: 'Новое название' }],
  }));
  assert.equal(before.counterpartyId, 'CP-A');
  assert.equal(after.counterpartyId, 'CP-A');
  assert.equal(after.status, before.status);
});

test('deactivated Client keeps its stable debtor identity and emits only lifecycle diagnostics', () => {
  const result = resolveArDebtorIdentity({ clientId: 'CLIENT-A' }, state({
    clients: [{
      id: 'CLIENT-A',
      counterpartyId: 'CP-A',
      company: 'ООО Ромашка',
      status: 'inactive',
      archivedAt: '2026-08-01T00:00:00.000Z',
    }],
  }));
  assert.equal(result.status, AR_DEBTOR_IDENTITY_STATUSES.LEGACY_RESOLVED);
  assert.equal(result.counterpartyId, 'CP-A');
  assert.ok(result.issues.some(issue => (
    issue.code === 'AR_DEBTOR_CUSTOMER_PROFILE_INACTIVE' && issue.blocking === false
  )));
});

test('Counterparty-only Rental resolves without a Client profile', () => {
  const result = resolveArDebtorIdentity({
    id: 'R-CP',
    counterpartyId: 'CP-A',
    status: 'closed',
  }, state({ clients: [] }));
  assert.equal(result.status, AR_DEBTOR_IDENTITY_STATUSES.COUNTERPARTY_ONLY);
  assert.equal(result.counterpartyId, 'CP-A');
});

test('legacy Rental chain resolves through Rental.clientId and Client.counterpartyId', () => {
  const result = resolveArDebtorIdentity({ rentalId: 'R-LEGACY' }, state({
    rentals: [{ id: 'R-LEGACY', clientId: 'CLIENT-A' }],
  }));
  assert.equal(result.status, AR_DEBTOR_IDENTITY_STATUSES.LEGACY_RESOLVED);
  assert.equal(result.counterpartyId, 'CP-A');
});

test('Rental explicit Counterparty and Rental Client mismatch fail closed', () => {
  const result = resolveArDebtorIdentity({ rentalId: 'R-MISMATCH' }, state({
    rentals: [{ id: 'R-MISMATCH', counterpartyId: 'CP-B', clientId: 'CLIENT-A' }],
  }));
  assert.equal(result.status, AR_DEBTOR_IDENTITY_STATUSES.MISMATCH);
  assert.equal(result.counterpartyId, null);
});

test('Payment Counterparty identity is preserved directly and through paymentId', () => {
  const direct = resolveArDebtorIdentity({
    id: 'P-A',
    counterpartyId: 'CP-A',
  }, state());
  assert.equal(direct.status, AR_DEBTOR_IDENTITY_STATUSES.COUNTERPARTY_ONLY);
  assert.equal(direct.counterpartyId, 'CP-A');

  const linked = resolveArDebtorIdentity({ paymentId: 'P-A' }, state({
    payments: [{ id: 'P-A', counterpartyId: 'CP-A' }],
  }));
  assert.equal(linked.status, AR_DEBTOR_IDENTITY_STATUSES.CANONICAL);
  assert.equal(linked.counterpartyId, 'CP-A');
});

test('Document, Contract, Object, and Rental stable-chain collision is a mismatch', () => {
  const result = resolveArDebtorIdentity({
    documentId: 'DOC-A',
    contractId: 'CONTRACT-B',
    objectId: 'OBJECT-A',
    rentalId: 'RENTAL-B',
  }, state({
    documents: [{ id: 'DOC-A', counterpartyId: 'CP-A' }],
    client_contracts: [{ id: 'CONTRACT-B', counterpartyId: 'CP-B' }],
    client_objects: [{ id: 'OBJECT-A', counterpartyId: 'CP-A' }],
    rentals: [{ id: 'RENTAL-B', counterpartyId: 'CP-B' }],
  }));
  assert.equal(result.status, AR_DEBTOR_IDENTITY_STATUSES.MISMATCH);
  assert.equal(result.counterpartyId, null);
  assert.deepEqual(result.candidateCounterpartyIds, ['CP-A', 'CP-B']);
});

test('orphan Client is classified explicitly', () => {
  const result = resolveArDebtorIdentity({ clientId: 'CLIENT-MISSING' }, state());
  assert.equal(result.status, AR_DEBTOR_IDENTITY_STATUSES.ORPHAN_CLIENT);
  assert.equal(result.counterpartyId, null);
});

test('orphan Counterparty is classified explicitly', () => {
  const result = resolveArDebtorIdentity({ counterpartyId: 'CP-MISSING' }, state());
  assert.equal(result.status, AR_DEBTOR_IDENTITY_STATUSES.ORPHAN_COUNTERPARTY);
  assert.equal(result.counterpartyId, null);
  assert.deepEqual(result.candidateCounterpartyIds, ['CP-MISSING']);
});

test('name-only legacy data remains unresolved', () => {
  for (const record of [
    { name: 'ООО Ромашка' },
    { clientName: 'ООО Ромашка' },
    { counterpartyName: 'ООО Ромашка' },
  ]) {
    const result = resolveArDebtorIdentity(record, state());
    assert.equal(result.status, AR_DEBTOR_IDENTITY_STATUSES.UNRESOLVED);
    assert.equal(result.counterpartyId, null);
  }
});

test('duplicate stable source IDs are ambiguous even when display metadata matches', () => {
  const result = resolveArDebtorIdentity({ clientId: 'CLIENT-A' }, state({
    clients: [
      { id: 'CLIENT-A', counterpartyId: 'CP-A', company: 'Same' },
      { id: 'CLIENT-A', counterpartyId: 'CP-A', company: 'Same' },
    ],
  }));
  assert.equal(result.status, AR_DEBTOR_IDENTITY_STATUSES.AMBIGUOUS);
  assert.equal(result.counterpartyId, null);
});

test('two identical audit runs are structurally deterministic', () => {
  const store = state({
    payments: [{ id: 'P-A', counterpartyId: 'CP-A' }],
    payment_allocations: [{ id: 'PA-A', paymentId: 'P-A', clientId: 'CLIENT-A' }],
    debt_collection_plans: [{ id: 'DCP-NAME', clientName: 'ООО Ромашка' }],
  });
  assert.deepEqual(auditArDebtorIdentities(store), auditArDebtorIdentities(store));
  const audit = auditArDebtorIdentities(store);
  assert.equal(audit.summary.inspected, 3);
  assert.equal(audit.summary.unresolved, 1);
  assert.equal(audit.summary.blockingIssueCount, 1);
});

test('resolver and audit do not mutate input collections', () => {
  const store = state({
    rentals: [{ id: 'R-A', clientId: 'CLIENT-A' }],
    payments: [{ id: 'P-A', rentalId: 'R-A' }],
    payment_allocations: [{ id: 'PA-A', paymentId: 'P-A' }],
  });
  const snapshot = structuredClone(store);
  resolveArDebtorIdentity(store.payment_allocations[0], store);
  auditArDebtorIdentities(store);
  assert.deepEqual(store, snapshot);
});

test('read-only CLI emits JSON diagnostics without changing app_data', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ar-debtor-identity-'));
  const dbPath = path.join(directory, 'app.sqlite');
  const scriptPath = new URL('../server/scripts/ar-debtor-identity.js', import.meta.url).pathname;
  const db = new Database(dbPath);
  try {
    db.exec('CREATE TABLE app_data (name TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL)');
    const insert = db.prepare('INSERT INTO app_data (name, json, updated_at) VALUES (?, ?, ?)');
    insert.run('counterparties', JSON.stringify([counterparty('CP-A')]), 'unchanged');
    insert.run('clients', JSON.stringify([{ id: 'CLIENT-A', counterpartyId: 'CP-A' }]), 'unchanged');
    insert.run('debt_collection_plans', JSON.stringify([{ id: 'DCP-A', clientId: 'CLIENT-A' }]), 'unchanged');
  } finally {
    db.close();
  }

  try {
    const run = spawnSync(process.execPath, [scriptPath, '--db', dbPath, '--json'], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    const output = JSON.parse(run.stdout);
    assert.equal(output.mode, 'read-only');
    assert.equal(output.audit.summary.inspected, 1);
    assert.equal(output.audit.summary.legacy_resolved, 1);
    assert.equal(output.audit.summary.blockingIssueCount, 0);

    const verify = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      assert.deepEqual(
        verify.prepare('SELECT name, updated_at FROM app_data ORDER BY name').all(),
        [
          { name: 'clients', updated_at: 'unchanged' },
          { name: 'counterparties', updated_at: 'unchanged' },
          { name: 'debt_collection_plans', updated_at: 'unchanged' },
        ],
      );
    } finally {
      verify.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
