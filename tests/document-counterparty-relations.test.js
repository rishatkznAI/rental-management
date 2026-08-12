import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  auditDocumentContractCounterpartyRelations,
  canonicalizeClientContractCounterpartyRelation,
  canonicalizeDocumentCounterpartyRelation,
  repairDocumentContractCounterpartyRelations,
} = require('../server/lib/document-counterparty-relations.js');

function foundation(overrides = {}) {
  return {
    counterparties: [
      { id: 'CP-1', legalName: 'ООО Одинаковое', status: 'active', roles: ['customer'] },
      { id: 'CP-2', legalName: 'ООО Одинаковое', status: 'active', roles: ['customer'] },
      { id: 'CP-INACTIVE', legalName: 'Неактивный', status: 'active', roles: ['customer'] },
    ],
    counterparty_role_assignments: [
      { id: 'A-1', counterpartyId: 'CP-1', roleCode: 'customer', status: 'active', validTo: null },
      { id: 'A-2', counterpartyId: 'CP-2', roleCode: 'customer', status: 'active', validTo: null },
      { id: 'A-3', counterpartyId: 'CP-INACTIVE', roleCode: 'customer', status: 'inactive', validTo: '2026-01-01' },
    ],
    clients: [
      { id: 'C-1', counterpartyId: 'CP-1', company: 'ООО Одинаковое' },
      { id: 'C-2', counterpartyId: 'CP-2', company: 'ООО Одинаковое' },
    ],
    client_objects: [
      { id: 'O-1', counterpartyId: 'CP-1', clientId: 'C-1', status: 'active' },
      { id: 'O-2', counterpartyId: 'CP-2', clientId: 'C-2', status: 'active' },
    ],
    client_contracts: [
      { id: 'CC-1', counterpartyId: 'CP-1', clientId: 'C-1', number: '1', status: 'active' },
      { id: 'CC-2', counterpartyId: 'CP-2', clientId: 'C-2', number: '2', status: 'active' },
    ],
    rentals: [
      { id: 'R-1', counterpartyId: 'CP-1', clientId: 'C-1' },
    ],
    gantt_rentals: [],
    documents: [],
    ...overrides,
  };
}

test('CP-only customer documents and contracts canonicalize without a synthetic Client', () => {
  const data = foundation();
  const document = canonicalizeDocumentCounterpartyRelation({
    id: 'D-1',
    type: 'rental_contract',
    counterpartyId: 'CP-1',
  }, data);
  assert.equal(document.counterpartyId, 'CP-1');
  assert.equal(document.clientId, undefined);

  const contract = canonicalizeClientContractCounterpartyRelation({
    id: 'CC-NEW',
    counterpartyId: 'CP-1',
    number: 'NEW',
    status: 'active',
  }, data);
  assert.equal(contract.counterpartyId, 'CP-1');
  assert.equal(contract.clientId, undefined);
});

test('matching dual IDs are accepted and mismatch is rejected', () => {
  const data = foundation();
  const matching = canonicalizeDocumentCounterpartyRelation({
    id: 'D-1', type: 'contract', counterpartyId: 'CP-1', clientId: 'C-1',
  }, data);
  assert.equal(matching.counterpartyId, 'CP-1');
  assert.equal(matching.clientId, 'C-1');
  assert.throws(() => canonicalizeDocumentCounterpartyRelation({
    id: 'D-2', type: 'contract', counterpartyId: 'CP-2', clientId: 'C-1',
  }, data), error => error.code === 'COUNTERPARTY_RELATION_MISMATCH');
});

test('Rental Counterparty is authoritative and disagreements with object or contract reject', () => {
  const data = foundation();
  const derived = canonicalizeDocumentCounterpartyRelation({
    id: 'D-1', type: 'transfer_act_to_client', rentalId: 'R-1',
  }, data);
  assert.equal(derived.counterpartyId, 'CP-1');
  assert.equal(derived.clientId, 'C-1');
  assert.throws(() => canonicalizeDocumentCounterpartyRelation({
    id: 'D-2', type: 'transfer_act_to_client', rentalId: 'R-1', objectId: 'O-2',
  }, data), error => error.code === 'COUNTERPARTY_RELATION_MISMATCH');
  assert.throws(() => canonicalizeDocumentCounterpartyRelation({
    id: 'D-3', type: 'transfer_act_to_client', rentalId: 'R-1', contractId: 'CC-2',
  }, data), error => error.code === 'COUNTERPARTY_RELATION_MISMATCH');
});

test('parent and specification Document chains reject conflicting Counterparties', () => {
  const data = foundation({
    documents: [
      { id: 'D-PARENT', type: 'rental_contract', counterpartyId: 'CP-1' },
      { id: 'D-SPEC', type: 'rental_specification', counterpartyId: 'CP-2' },
    ],
  });
  assert.throws(() => canonicalizeDocumentCounterpartyRelation({
    id: 'D-CHILD-PARENT',
    type: 'transfer_act_to_client',
    counterpartyId: 'CP-2',
    parentDocumentId: 'D-PARENT',
  }, data), error => error.code === 'COUNTERPARTY_RELATION_MISMATCH');
  assert.throws(() => canonicalizeDocumentCounterpartyRelation({
    id: 'D-CHILD-SPEC',
    type: 'return_act_from_client',
    counterpartyId: 'CP-1',
    specificationId: 'D-SPEC',
  }, data), error => error.code === 'COUNTERPARTY_RELATION_MISMATCH');
});

test('inactive role and name-only identity are rejected without equal-name inference', () => {
  const data = foundation();
  assert.throws(() => canonicalizeDocumentCounterpartyRelation({
    id: 'D-1', type: 'contract', counterpartyId: 'CP-INACTIVE',
  }, data), error => error.code === 'COUNTERPARTY_RELATION_CUSTOMER_ROLE_REQUIRED');
  assert.throws(() => canonicalizeDocumentCounterpartyRelation({
    id: 'D-2', type: 'contract', client: 'ООО Одинаковое',
  }, data), error => error.code === 'COUNTERPARTY_RELATION_ID_REQUIRED');
});

test('historical optional unlinked documents remain readable and canonical relation is immutable', () => {
  const data = foundation();
  assert.deepEqual(canonicalizeDocumentCounterpartyRelation({
    id: 'D-legacy', type: 'work_order', status: 'signed', client: 'Снимок',
  }, data, { allowArchived: true }), {
    id: 'D-legacy', type: 'work_order', status: 'signed', client: 'Снимок',
  });
  assert.throws(() => canonicalizeDocumentCounterpartyRelation({
    id: 'D-1', type: 'contract', counterpartyId: 'CP-2',
  }, data, {
    existing: { id: 'D-1', type: 'contract', counterpartyId: 'CP-1' },
  }), error => error.code === 'COUNTERPARTY_RELATION_IMMUTABLE');
});

test('audit classifies deterministic repairs and apply rerun is idempotent', () => {
  const state = foundation({
    client_contracts: [{ id: 'CC-LEGACY', clientId: 'C-1', number: 'LEGACY', status: 'active' }],
    documents: [
      { id: 'D-REPAIR', type: 'contract', clientId: 'C-1' },
      { id: 'D-UNLINKED', type: 'work_order', status: 'signed', client: 'Snapshot only' },
    ],
  });
  const readData = name => state[name] || [];
  let writes = 0;
  const writeDataBatch = entries => {
    writes += 1;
    for (const entry of entries) state[entry.name] = entry.value;
  };
  const before = JSON.stringify(state);
  const preview = repairDocumentContractCounterpartyRelations({ readData, dryRun: true });
  assert.equal(JSON.stringify(state), before);
  assert.equal(preview.audit.summary.classifications.repairable, 2);
  assert.equal(preview.audit.summary.classifications.valid, 1);

  const applied = repairDocumentContractCounterpartyRelations({ readData, writeDataBatch, dryRun: false });
  assert.equal(applied.changedRecords, 2);
  assert.equal(writes, 1);
  assert.equal(state.documents[0].counterpartyId, 'CP-1');
  assert.equal(state.client_contracts[0].counterpartyId, 'CP-1');

  const rerun = repairDocumentContractCounterpartyRelations({ readData, writeDataBatch, dryRun: false });
  assert.equal(rerun.changed, false);
  assert.equal(rerun.changedRecords, 0);
  assert.equal(writes, 1);
  assert.equal(auditDocumentContractCounterpartyRelations({ readData }).summary.classifications.valid, 3);
});

test('audit CLI defaults to read-only dry-run and emits machine-readable classifications', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'document-counterparty-audit-'));
  const dbPath = path.join(dir, 'app.sqlite');
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE app_data (
        name TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const state = foundation({
      client_contracts: [{ id: 'CC-LEGACY', clientId: 'C-1', number: 'LEGACY', status: 'active' }],
      documents: [{ id: 'D-LEGACY', type: 'contract', clientId: 'C-1' }],
    });
    const insert = db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)');
    for (const [name, value] of Object.entries(state)) insert.run(name, JSON.stringify(value));
  } finally {
    db.close();
  }
  const before = fs.readFileSync(dbPath);
  const result = spawnSync(process.execPath, [
    'server/scripts/document-contract-counterparty-integrity.js',
    '--db', dbPath,
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
  try {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.mode, 'dry-run');
    assert.equal(report.dryRun, true);
    assert.equal(report.audit.summary.classifications.repairable, 2);
    assert.deepEqual(fs.readFileSync(dbPath), before);
    assert.equal(fs.existsSync(path.join(dir, 'backups')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
