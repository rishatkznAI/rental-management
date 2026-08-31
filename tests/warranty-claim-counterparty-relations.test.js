import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const express = serverRequire('express');
const { createAccessControl } = require('../server/lib/access-control.js');
const { createBusinessNumberingService } = require('../server/lib/business-numbering.js');
const { createNumberSequenceAllocator } = require('../server/lib/number-sequences.js');
const { findRoleRemovalBlockers } = require('../server/lib/counterparty-role-profiles.js');
const { registerCrudRoutes } = require('../server/routes/crud.js');
const {
  WARRANTY_RELATION_CLASSIFICATIONS,
  activeWarrantyCounterpartyReferences,
  auditWarrantyClaimCounterpartyRelations,
  canonicalizeWarrantyClaimCollection,
  canonicalizeWarrantyClaimCounterpartyRelation,
  canonicalizeWarrantyPersistenceEntries,
  decorateWarrantyClaimCounterparty,
  isTerminalWarrantyClaim,
  repairWarrantyClaimCounterpartyRelations,
  resolveWarrantyClaimCounterpartyRelation,
} = require('../server/lib/warranty-claim-counterparty-relations.js');

function fixture(overrides = {}) {
  const collections = {
    counterparties: [
      { id: 'CP-1', legalName: 'ООО Одинаковое', shortName: 'Одинаковое', status: 'active', roles: ['customer'] },
      { id: 'CP-2', legalName: 'ООО Одинаковое', shortName: 'Одинаковое', status: 'active', roles: ['customer'] },
      { id: 'CP-3', legalName: 'Архивный', status: 'archived', archivedAt: '2026-01-01', roles: ['customer'] },
      { id: 'CP-4', legalName: 'Stale customer projection', status: 'active', roles: ['customer'] },
      { id: 'CP-5', legalName: 'Counterparty only', status: 'active', roles: ['customer'] },
    ],
    counterparty_role_assignments: [
      { id: 'A-1', counterpartyId: 'CP-1', roleCode: 'customer', status: 'active', validTo: null },
      { id: 'A-2', counterpartyId: 'CP-2', roleCode: 'customer', status: 'active', validTo: null },
      { id: 'A-3', counterpartyId: 'CP-3', roleCode: 'customer', status: 'inactive', validTo: '2026-01-01' },
      { id: 'A-4', counterpartyId: 'CP-4', roleCode: 'customer', status: 'inactive', validTo: '2026-01-01' },
      { id: 'A-5', counterpartyId: 'CP-5', roleCode: 'customer', status: 'active', validTo: null },
    ],
    clients: [
      { id: 'CL-1', counterpartyId: 'CP-1', company: 'Одинаковое', inn: '1655000001', debt: 100 },
      { id: 'CL-2', counterpartyId: 'CP-2', company: 'Одинаковое', inn: '1655000002', documents: ['private'] },
      { id: 'CL-no-cp', company: 'Broken source' },
    ],
    rentals: [
      { id: 'R-1', counterpartyId: 'CP-1', clientId: 'CL-1', status: 'active' },
      { id: 'R-2', counterpartyId: 'CP-2', clientId: 'CL-2', status: 'active' },
      { id: 'R-no-cp', status: 'active' },
    ],
    gantt_rentals: [
      { id: 'GR-1', counterpartyId: 'CP-1', clientId: 'CL-1', status: 'active' },
    ],
    service: [
      { id: 'S-1', counterpartyId: 'CP-1', clientId: 'CL-1', status: 'new', equipmentId: 'EQ-1' },
      { id: 'S-2', counterpartyId: 'CP-2', clientId: 'CL-2', status: 'new', equipmentId: 'EQ-2' },
      { id: 'S-internal', status: 'new', equipmentId: 'EQ-internal', reason: 'Внутренняя гарантия' },
      { id: 'S-source-missing', clientId: 'CL-no-cp', status: 'new' },
      { id: 'S-derived-only', clientId: 'CL-1', status: 'new' },
    ],
    warranty_claims: [],
    ...overrides,
  };
  return {
    collections,
    readData(name) { return collections[name] || []; },
  };
}

test('Warranty resolves every allowed exact stable customer chain and agreeing combinations', () => {
  const data = fixture();
  const cases = [
    [{ counterpartyId: 'CP-5' }, 'counterpartyId', 'CP-5'],
    [{ clientId: 'CL-1' }, 'clientId', 'CP-1'],
    [{ rentalId: 'R-1' }, 'rentalId', 'CP-1'],
    [{ rentalId: 'GR-1' }, 'rentalId', 'CP-1'],
    [{ serviceTicketId: 'S-1' }, 'serviceTicketId', 'CP-1'],
  ];
  for (const [fields, source, counterpartyId] of cases) {
    const relation = resolveWarrantyClaimCounterpartyRelation({ id: `W-${source}`, status: 'draft', ...fields }, data);
    assert.equal(relation.counterpartyId, counterpartyId);
    assert.equal(relation.source, source);
  }
  const all = canonicalizeWarrantyClaimCounterpartyRelation({
    id: 'W-all',
    status: 'approved',
    counterpartyId: 'CP-1',
    serviceTicketId: 'S-1',
    clientId: 'CL-1',
    rentalId: 'R-1',
  }, data);
  assert.equal(all.counterpartyId, 'CP-1');
});

test('equipment-only and internal Service-linked Warranty claims remain customerless', () => {
  const data = fixture();
  assert.deepEqual(canonicalizeWarrantyClaimCounterpartyRelation({
    id: 'W-equipment',
    status: 'draft',
    equipmentId: 'EQ-internal',
    manufacturer: 'Factory A',
    factoryName: 'Factory A',
  }, data), {
    id: 'W-equipment',
    status: 'draft',
    equipmentId: 'EQ-internal',
    manufacturer: 'Factory A',
    factoryName: 'Factory A',
  });
  assert.equal(resolveWarrantyClaimCounterpartyRelation({
    id: 'W-service-internal', status: 'draft', serviceTicketId: 'S-internal', factoryName: 'Factory A',
  }, data), null);
});

test('conflicting chains, missing and duplicated stable sources, and source gaps fail closed', () => {
  const data = fixture();
  assert.throws(
    () => resolveWarrantyClaimCounterpartyRelation({ id: 'W-conflict', counterpartyId: 'CP-1', rentalId: 'R-2' }, data),
    error => error.code === 'COUNTERPARTY_RELATION_MISMATCH',
  );
  for (const [field, value, code] of [
    ['serviceTicketId', 'S-missing', 'WARRANTY_COUNTERPARTY_SERVICE_NOT_FOUND'],
    ['clientId', 'CL-missing', 'WARRANTY_COUNTERPARTY_CLIENT_NOT_FOUND'],
    ['rentalId', 'R-missing', 'WARRANTY_COUNTERPARTY_RENTAL_NOT_FOUND'],
  ]) {
    assert.throws(
      () => resolveWarrantyClaimCounterpartyRelation({ id: `W-${field}`, [field]: value }, data),
      error => error.code === code,
    );
  }
  const duplicateService = fixture({
    service: [
      { id: 'S-dupe', counterpartyId: 'CP-1', status: 'new' },
      { id: 'S-dupe', counterpartyId: 'CP-1', status: 'new' },
    ],
  });
  assert.throws(
    () => resolveWarrantyClaimCounterpartyRelation({ id: 'W-dupe', serviceTicketId: 'S-dupe' }, duplicateService),
    error => error.code === 'COUNTERPARTY_RELATION_AMBIGUOUS',
  );
  assert.throws(
    () => resolveWarrantyClaimCounterpartyRelation({ id: 'W-client-gap', clientId: 'CL-no-cp' }, data),
    error => error.code === 'WARRANTY_COUNTERPARTY_SOURCE_RELATION_MISSING',
  );
  assert.throws(
    () => resolveWarrantyClaimCounterpartyRelation({ id: 'W-service-gap', serviceTicketId: 'S-source-missing' }, data),
    error => error.code === 'WARRANTY_COUNTERPARTY_SOURCE_RELATION_MISSING',
  );
  assert.throws(
    () => resolveWarrantyClaimCounterpartyRelation({ id: 'W-service-not-canonical', serviceTicketId: 'S-derived-only' }, data),
    error => error.code === 'WARRANTY_COUNTERPARTY_SOURCE_RELATION_MISSING'
      && error.details.sourceField === 'ServiceTicket.counterpartyId',
  );
});

test('active targets require a real non-archived Counterparty and authoritative customer assignment', () => {
  const data = fixture();
  assert.throws(
    () => canonicalizeWarrantyClaimCounterpartyRelation({ id: 'W-missing', status: 'draft', counterpartyId: 'CP-missing' }, data),
    error => error.code === 'COUNTERPARTY_RELATION_COUNTERPARTY_NOT_FOUND',
  );
  assert.throws(
    () => canonicalizeWarrantyClaimCounterpartyRelation({ id: 'W-archived', status: 'draft', counterpartyId: 'CP-3' }, data),
    error => error.code === 'COUNTERPARTY_RELATION_COUNTERPARTY_ARCHIVED',
  );
  assert.throws(
    () => canonicalizeWarrantyClaimCounterpartyRelation({ id: 'W-stale-role', status: 'draft', counterpartyId: 'CP-4' }, data),
    error => error.code === 'COUNTERPARTY_RELATION_CUSTOMER_ROLE_REQUIRED',
  );
});

test('customer snapshots never establish identity while factory/manufacturer text stays non-customer metadata', () => {
  const data = fixture();
  for (const field of ['client', 'clientName', 'counterpartyName', 'customerDisplayName', 'clientInn', 'clientPhone']) {
    assert.throws(
      () => canonicalizeWarrantyClaimCounterpartyRelation({ id: `W-${field}`, status: 'draft', [field]: 'Одинаковое' }, data),
      error => error.code === 'WARRANTY_COUNTERPARTY_METADATA_ONLY',
    );
  }
  assert.doesNotThrow(() => canonicalizeWarrantyClaimCounterpartyRelation({
    id: 'W-factory', status: 'draft', factoryName: 'Одинаковое', manufacturer: 'Одинаковое',
  }, data));
});

test('established identity is immutable while compatible source changes and first establishment are allowed', () => {
  const data = fixture();
  const existing = { id: 'W-1', status: 'draft', counterpartyId: 'CP-1', serviceTicketId: 'S-1' };
  assert.equal(canonicalizeWarrantyClaimCounterpartyRelation({
    ...existing, serviceTicketId: undefined, clientId: 'CL-1', rentalId: 'R-1',
  }, data, { existing }).counterpartyId, 'CP-1');
  assert.throws(
    () => canonicalizeWarrantyClaimCounterpartyRelation({ ...existing, counterpartyId: undefined, clientId: 'CL-1' }, data, { existing }),
    error => error.code === 'WARRANTY_COUNTERPARTY_RELATION_IMMUTABLE',
  );
  assert.throws(
    () => canonicalizeWarrantyClaimCounterpartyRelation({ ...existing, counterpartyId: 'CP-2', serviceTicketId: 'S-2' }, data, { existing }),
    error => error.code === 'WARRANTY_COUNTERPARTY_RELATION_IMMUTABLE',
  );
  const internal = { id: 'W-internal', status: 'draft', equipmentId: 'EQ-1' };
  assert.equal(canonicalizeWarrantyClaimCounterpartyRelation({ ...internal, serviceTicketId: 'S-1' }, data, { existing: internal }).counterpartyId, 'CP-1');
});

test('only the specified terminal statuses receive historical target exceptions', () => {
  const data = fixture();
  for (const status of ['closed', 'completed', 'done', 'rejected', 'declined']) {
    assert.equal(isTerminalWarrantyClaim({ status }), true, status);
    assert.equal(canonicalizeWarrantyClaimCounterpartyRelation({ id: `W-${status}`, status, counterpartyId: 'CP-3' }, data, {
      existing: { id: `W-${status}`, status, counterpartyId: 'CP-3' },
      allowHistoricalTarget: true,
    }).counterpartyId, 'CP-3');
  }
  for (const status of ['approved', 'parts_shipping', 'unknown_status']) {
    assert.equal(isTerminalWarrantyClaim({ status }), false, status);
    assert.throws(
      () => canonicalizeWarrantyClaimCounterpartyRelation({ id: `W-${status}`, status, counterpartyId: 'CP-3' }, data),
      error => error.code === 'COUNTERPARTY_RELATION_COUNTERPARTY_ARCHIVED',
    );
  }
  assert.throws(
    () => canonicalizeWarrantyClaimCounterpartyRelation({ id: 'W-new-history', status: 'closed', counterpartyId: 'CP-3' }, data, {
      allowHistoricalTarget: false,
    }),
    error => error.code === 'COUNTERPARTY_RELATION_COUNTERPARTY_ARCHIVED',
  );
  assert.throws(
    () => canonicalizeWarrantyClaimCounterpartyRelation({ id: 'W-history-conflict', status: 'closed', counterpartyId: 'CP-3', rentalId: 'R-1' }, data, {
      existing: { id: 'W-history-conflict', status: 'closed', counterpartyId: 'CP-3' },
      allowHistoricalTarget: true,
    }),
    error => error.code === 'COUNTERPARTY_RELATION_MISMATCH',
  );
  assert.equal(canonicalizeWarrantyClaimCounterpartyRelation({ id: 'W-role-history', status: 'closed', counterpartyId: 'CP-4' }, data, {
    existing: { id: 'W-role-history', status: 'closed', counterpartyId: 'CP-4' },
  }).counterpartyId, 'CP-4');
  assert.throws(
    () => canonicalizeWarrantyClaimCounterpartyRelation({ id: 'W-newly-closed', status: 'closed', counterpartyId: 'CP-3' }, data, {
      existing: { id: 'W-newly-closed', status: 'approved', counterpartyId: 'CP-3' },
    }),
    error => error.code === 'COUNTERPARTY_RELATION_COUNTERPARTY_ARCHIVED',
  );
  assert.throws(
    () => canonicalizeWarrantyClaimCounterpartyRelation({ id: 'W-reopened', status: 'approved', counterpartyId: 'CP-3' }, data, {
      existing: { id: 'W-reopened', status: 'closed', counterpartyId: 'CP-3' },
    }),
    error => error.code === 'COUNTERPARTY_RELATION_COUNTERPARTY_ARCHIVED',
  );
});

test('collections reject missing and duplicate claim IDs while direct and mixed persistence stay canonical and atomic', () => {
  const data = fixture();
  assert.throws(
    () => canonicalizeWarrantyClaimCollection([{ status: 'draft' }], data),
    error => error.code === 'WARRANTY_COUNTERPARTY_CLAIM_ID_REQUIRED',
  );
  assert.throws(
    () => canonicalizeWarrantyClaimCollection([{ id: 'W-1' }, { id: 'W-1' }], data),
    error => error.code === 'WARRANTY_COUNTERPARTY_DUPLICATE_CLAIM_ID',
  );
  const entries = canonicalizeWarrantyPersistenceEntries([
    { name: 'counterparties', value: [{ id: 'CP-new', legalName: 'Новый', status: 'active', roles: [] }] },
    { name: 'counterparty_role_assignments', value: [{ id: 'A-new', counterpartyId: 'CP-new', roleCode: 'customer', status: 'active', validTo: null }] },
    { name: 'clients', value: [{ id: 'CL-new', counterpartyId: 'CP-new' }] },
    { name: 'service', value: [{ id: 'S-new', counterpartyId: 'CP-new', clientId: 'CL-new', status: 'new' }] },
    { name: 'warranty_claims', value: [{ id: 'W-new', status: 'draft', serviceTicketId: 'S-new' }] },
  ], data);
  assert.equal(entries.find(entry => entry.name === 'warranty_claims').value[0].counterpartyId, 'CP-new');

  const before = structuredClone(data.collections.warranty_claims);
  assert.throws(() => canonicalizeWarrantyPersistenceEntries([{ name: 'warranty_claims', value: [
    { id: 'W-good', status: 'draft', serviceTicketId: 'S-1' },
    { id: 'W-bad', status: 'draft', serviceTicketId: 'S-missing' },
  ] }], data));
  assert.deepEqual(data.collections.warranty_claims, before);

  const persistEntries = candidateEntries => {
    const canonicalEntries = canonicalizeWarrantyPersistenceEntries(candidateEntries, { readData: data.readData });
    for (const entry of canonicalEntries) data.collections[entry.name] = entry.value;
  };
  const writeData = (name, value) => persistEntries([{ name, value }]);
  writeData('warranty_claims', [{ id: 'W-direct', status: 'draft', serviceTicketId: 'S-1' }]);
  assert.equal(data.collections.warranty_claims[0].counterpartyId, 'CP-1');

  const persistedBeforeFailure = structuredClone(data.collections);
  assert.throws(() => persistEntries([
    { name: 'service', value: [{ id: 'S-batch', counterpartyId: 'CP-2', status: 'new' }] },
    { name: 'warranty_claims', value: [{ id: 'W-batch', status: 'draft', serviceTicketId: 'S-missing' }] },
  ]));
  assert.deepEqual(data.collections, persistedBeforeFailure);
});

test('read decoration uses only Counterparty display fields and same-name IDs remain distinct', () => {
  const data = fixture();
  const first = decorateWarrantyClaimCounterparty({ id: 'W-1', counterpartyId: 'CP-1' }, data);
  const second = decorateWarrantyClaimCounterparty({ id: 'W-2', counterpartyId: 'CP-2' }, data);
  assert.equal(first.customerDisplayName, second.customerDisplayName);
  assert.notEqual(first.counterpartyId, second.counterpartyId);
  for (const privateField of ['inn', 'documents', 'debt', 'paymentTerms', 'rentals']) {
    assert.equal(privateField in first, false);
  }
});

test('active canonical and deterministic Warranty references block customer role removal, terminal history does not', () => {
  const data = fixture({
    warranty_claims: [
      { id: 'W-active', status: 'approved', counterpartyId: 'CP-1' },
      { id: 'W-derived', status: 'parts_shipping', serviceTicketId: 'S-1' },
      { id: 'W-closed', status: 'closed', counterpartyId: 'CP-1' },
    ],
  });
  assert.deepEqual(activeWarrantyCounterpartyReferences('CP-1', data).map(item => item.id), ['W-active', 'W-derived']);
  const customerBlocker = findRoleRemovalBlockers({ counterpartyId: 'CP-1', roleCode: 'customer', data });
    assert.deepEqual(customerBlocker.find(item => item.collection === 'warranty_claims')?.recordIds, ['W-active', 'W-derived']);
  const supplierBlockers = findRoleRemovalBlockers({ counterpartyId: 'CP-1', roleCode: 'supplier', data });
  const contractorBlockers = findRoleRemovalBlockers({ counterpartyId: 'CP-1', roleCode: 'contractor', data });
  assert.equal(supplierBlockers.some(item => item.collection === 'warranty_claims'), false);
  assert.equal(contractorBlockers.some(item => item.collection === 'warranty_claims'), false);
});

test('audit emits every required deterministic classification and never mutates source data', () => {
  const data = fixture({
    service: [
      ...fixture().collections.service,
      { id: 'S-dupe', counterpartyId: 'CP-1', status: 'new' },
      { id: 'S-dupe', counterpartyId: 'CP-1', status: 'new' },
    ],
    warranty_claims: [
      { id: 'W-canonical', status: 'draft', counterpartyId: 'CP-1' },
      { id: 'W-repair', status: 'draft', serviceTicketId: 'S-1' },
      { id: 'W-internal', status: 'draft', equipmentId: 'EQ-1', factoryName: 'Factory' },
      { id: 'W-history', status: 'closed', counterpartyId: 'CP-3' },
      { id: 'W-conflict', status: 'draft', counterpartyId: 'CP-1', rentalId: 'R-2' },
      { id: 'W-ambiguous', status: 'draft', serviceTicketId: 'S-dupe' },
      { id: 'W-missing-ref', status: 'draft', serviceTicketId: 'S-missing' },
      { id: 'W-source-gap', status: 'draft', clientId: 'CL-no-cp' },
      { id: 'W-missing-cp', status: 'draft', counterpartyId: 'CP-missing' },
      { id: 'W-archived', status: 'draft', counterpartyId: 'CP-3' },
      { id: 'W-role', status: 'draft', counterpartyId: 'CP-4' },
      { id: 'W-meta', status: 'draft', clientName: 'Одинаковое' },
    ],
  });
  const before = structuredClone(data.collections.warranty_claims);
  const audit = auditWarrantyClaimCounterpartyRelations(data);
  assert.deepEqual(data.collections.warranty_claims, before);
  const classifications = new Set(audit.entries.map(entry => entry.classification));
  for (const expected of Object.values(WARRANTY_RELATION_CLASSIFICATIONS)) {
    assert.ok(classifications.has(expected), expected);
  }
});

test('repair is dry-run by default, fail-closed, precondition-aware, deterministic, and idempotent', () => {
  const data = fixture({ warranty_claims: [{ id: 'W-repair', status: 'draft', serviceTicketId: 'S-1', decision: 'preserve' }] });
  const before = structuredClone(data.collections.warranty_claims);
  const preview = repairWarrantyClaimCounterpartyRelations({ readData: data.readData });
  assert.equal(preview.changedRecords, 1);
  assert.deepEqual(data.collections.warranty_claims, before);

  const applied = repairWarrantyClaimCounterpartyRelations({
    readData: data.readData,
    writeDataBatch(entries) {
      for (const entry of entries) data.collections[entry.name] = entry.value;
    },
    dryRun: false,
    expectedFingerprint: preview.audit.fingerprint,
  });
  assert.equal(applied.changedRecords, 1);
  assert.equal(data.collections.warranty_claims[0].counterpartyId, 'CP-1');
  assert.equal(data.collections.warranty_claims[0].decision, 'preserve');
  assert.equal(repairWarrantyClaimCounterpartyRelations({ readData: data.readData }).changed, false);

  const invalid = fixture({ warranty_claims: [
    { id: 'W-repair', status: 'draft', serviceTicketId: 'S-1' },
    { id: 'W-invalid', status: 'draft', serviceTicketId: 'S-missing' },
  ] });
  assert.throws(() => repairWarrantyClaimCounterpartyRelations({
    readData: invalid.readData,
    writeDataBatch: () => assert.fail('invalid repair must not write'),
    dryRun: false,
  }), error => error.code === 'WARRANTY_COUNTERPARTY_REPAIR_BLOCKED');
  assert.throws(() => repairWarrantyClaimCounterpartyRelations({
    readData: data.readData,
    dryRun: false,
    expectedFingerprint: 'stale',
  }), error => error.code === 'WARRANTY_COUNTERPARTY_REPAIR_PRECONDITION_CHANGED');
});

test('offline CLI dry-run is read-only and raw apply is blocked without mutation', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warranty-counterparty-'));
  const dbPath = path.join(tempDir, 'migration.sqlite');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE app_data (name TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT)');
  const insert = db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)');
  const collections = fixture().collections;
  collections.warranty_claims = [{ id: 'W-1', status: 'draft', serviceTicketId: 'S-1', decision: 'unchanged' }];
  for (const [name, value] of Object.entries(collections)) insert.run(name, JSON.stringify(value));
  db.close();
  const script = path.resolve('server/scripts/warranty-claim-counterparty-relations.js');
  const run = mode => spawnSync(process.execPath, [script, mode, '--db', dbPath], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
  try {
    const dryRun = run('--dry-run');
    assert.equal(dryRun.status, 0, dryRun.stderr);
    let verify = new Database(dbPath, { readonly: true });
    assert.equal(JSON.parse(verify.prepare('SELECT json FROM app_data WHERE name = ?').get('warranty_claims').json)[0].counterpartyId, undefined);
    verify.close();

    const applied = run('--apply');
    assert.notEqual(applied.status, 0);
    assert.match(applied.stderr, /AUDITED_MAINTENANCE_RUNNER_REQUIRED/);
    verify = new Database(dbPath, { readonly: true });
    const unchanged = JSON.parse(verify.prepare('SELECT json FROM app_data WHERE name = ?').get('warranty_claims').json)[0];
    verify.close();
    assert.equal(unchanged.counterpartyId, undefined);
    assert.equal(unchanged.decision, 'unchanged');
    assert.equal(fs.existsSync(path.join(tempDir, 'backups')), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

async function withWarrantyCrud(data, user, run, options = {}) {
  const readData = name => data.collections[name] || [];
  let nextBatchFailure = null;
  const numberingDb = options.businessNumbering ? new Database(':memory:') : null;
  if (numberingDb) {
    numberingDb.exec('CREATE TABLE app_data (name TEXT PRIMARY KEY, json TEXT NOT NULL)');
  }
  const businessNumbering = numberingDb ? createBusinessNumberingService({
    allocator: createNumberSequenceAllocator({
      db: numberingDb,
      scope: { scopeType: 'company', scopeId: 'COMPANY-A' },
      nowIso: () => '2026-08-13T12:00:00.000Z',
    }),
    readData,
    nowIso: () => '2026-08-13T12:00:00.000Z',
  }) : null;
  const upsertAppData = numberingDb ? numberingDb.prepare(`
    INSERT INTO app_data (name, json)
    VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET json = excluded.json
  `) : null;
  const persistNumberedEntries = numberingDb ? numberingDb.transaction(entries => {
    businessNumbering.preparePersistenceEntries(entries);
    const canonical = canonicalizeWarrantyPersistenceEntries(entries, { readData });
    if (nextBatchFailure) {
      const error = nextBatchFailure;
      nextBatchFailure = null;
      throw error;
    }
    for (const entry of canonical) {
      upsertAppData.run(entry.name, JSON.stringify(entry.value));
      data.collections[entry.name] = entry.value;
    }
  }) : null;
  const persistEntries = entries => {
    if (persistNumberedEntries) return persistNumberedEntries.immediate(entries);
    const canonical = canonicalizeWarrantyPersistenceEntries(entries, { readData });
    for (const entry of canonical) data.collections[entry.name] = entry.value;
  };
  const accessControl = createAccessControl({ readData });
  const app = express();
  app.use(express.json());
  const pass = () => (_req, _res, next) => next();
  app.use('/api', registerCrudRoutes({
    collections: ['warranty_claims'],
    idPrefixes: { warranty_claims: 'WCL' },
    readData,
    writeData: (name, value) => persistEntries([{ name, value }]),
    writeDataBatch: persistEntries,
    requireAuth(req, _res, next) { req.user = user; next(); },
    requireRead: pass,
    requireWrite: pass,
    sanitizeUser: value => value,
    publicUserView: value => value,
    canReadFullUsers: () => true,
    hashPassword: value => value,
    normalizeServiceWorkRecord: value => value,
    normalizeSparePartRecord: value => value,
    validateRentalPayload: () => ({ ok: true }),
    mergeEntityHistory: (_collection, _previous, next) => next,
    requireNonEmptyString: () => {},
    generateId: () => `WCL-${data.collections.warranty_claims.length + 1}`,
    nowIso: () => '2026-08-13T12:00:00.000Z',
    accessControl,
    auditLog: () => {},
    serviceAuditLog: () => {},
    normalizeRecordClientLink: item => item,
    businessNumbering,
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const request = async (method, route, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    await run(request, {
      numberingDb,
      failNextBatch() {
        const error = new Error('Injected warranty batch failure');
        error.code = 'INJECTED_WARRANTY_BATCH_FAILURE';
        error.status = 503;
        nextBatchFailure = error;
      },
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    numberingDb?.close();
  }
}

test('Warranty route rolls back numbering and app_data when canonical persistence fails', async () => {
  const data = fixture();
  const admin = { userId: 'U-admin', userName: 'Admin', userRole: 'Администратор' };
  const payload = {
    serviceTicketId: 'S-1',
    equipmentId: 'EQ-1',
    equipmentLabel: 'Lift',
    factoryName: 'Factory',
    failureDescription: 'Failure',
    requestedResolution: 'Repair',
    status: 'draft',
    priority: 'medium',
  };

  await withWarrantyCrud(data, admin, async (request, context) => {
    context.failNextBatch();
    const failed = await request('POST', '/api/warranty_claims', payload);
    assert.equal(failed.status, 503, JSON.stringify(failed.body));
    assert.equal(failed.body.code, 'INJECTED_WARRANTY_BATCH_FAILURE');
    assert.equal(data.collections.warranty_claims.length, 0);
    assert.equal(context.numberingDb.prepare('SELECT COUNT(*) AS count FROM number_sequences').get().count, 0);
    assert.equal(context.numberingDb.prepare('SELECT COUNT(*) AS count FROM business_numbers').get().count, 0);
    assert.equal(context.numberingDb.prepare('SELECT COUNT(*) AS count FROM app_data').get().count, 0);

    const created = await request('POST', '/api/warranty_claims', payload);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.number, 'WCL-26-000001');
    assert.equal(data.collections.warranty_claims[0].number, created.body.number);
    assert.equal(context.numberingDb.prepare('SELECT COUNT(*) AS count FROM number_sequences').get().count, 1);
    assert.equal(context.numberingDb.prepare('SELECT COUNT(*) AS count FROM business_numbers').get().count, 1);
    assert.equal(context.numberingDb.prepare("SELECT COUNT(*) AS count FROM app_data WHERE name = 'warranty_claims'").get().count, 1);
  }, { businessNumbering: true });
});

test('generic Warranty CRUD canonicalizes POST/PATCH/PUT, decorates reads, filters by Counterparty ID, and keeps failures atomic', async () => {
  const data = fixture();
  const admin = { userId: 'U-admin', userName: 'Admin', userRole: 'Администратор' };
  await withWarrantyCrud(data, admin, async request => {
    const created = await request('POST', '/api/warranty_claims', {
      serviceTicketId: 'S-1', equipmentId: 'EQ-1', equipmentLabel: 'Lift', factoryName: 'Factory',
      failureDescription: 'Failure', requestedResolution: 'Repair', status: 'draft', priority: 'medium',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.counterpartyId, 'CP-1');
    assert.equal(created.body.customerDisplayName, 'Одинаковое');

    const compatible = await request('PATCH', `/api/warranty_claims/${created.body.id}`, { clientId: 'CL-1' });
    assert.equal(compatible.status, 200);
    assert.equal(compatible.body.counterpartyId, 'CP-1');
    const retarget = await request('PATCH', `/api/warranty_claims/${created.body.id}`, {
      counterpartyId: 'CP-2', serviceTicketId: 'S-2', clientId: 'CL-2',
    });
    assert.equal(retarget.status, 409);
    assert.equal(data.collections.warranty_claims[0].counterpartyId, 'CP-1');

    const sameNameOther = await request('POST', '/api/warranty_claims', {
      serviceTicketId: 'S-2', equipmentId: 'EQ-2', equipmentLabel: 'Lift 2', factoryName: 'Factory',
      failureDescription: 'Failure', requestedResolution: 'Repair', status: 'draft', priority: 'medium',
    });
    assert.equal(sameNameOther.status, 201);
    const filtered = await request('GET', '/api/warranty_claims?paginated=true&page=1&pageSize=20&counterpartyId=CP-2');
    assert.equal(filtered.status, 200);
    assert.deepEqual(filtered.body.items.map(item => item.counterpartyId), ['CP-2']);
    assert.equal('debt' in filtered.body.items[0], false);
    const unpaginated = await request('GET', '/api/warranty_claims?counterpartyId=CP-1');
    assert.equal(unpaginated.status, 200);
    assert.deepEqual(unpaginated.body.map(item => item.counterpartyId), ['CP-1']);

    const before = structuredClone(data.collections.warranty_claims);
    const invalidBulk = await request('PUT', '/api/warranty_claims', [
      ...before,
      { id: 'W-bad', serviceTicketId: 'S-missing', status: 'draft' },
    ]);
    assert.equal(invalidBulk.status, 409);
    assert.deepEqual(data.collections.warranty_claims, before);
    const duplicateBulk = await request('PUT', '/api/warranty_claims', [before[0], before[0]]);
    assert.equal(duplicateBulk.status, 409);
    const missingIdBulk = await request('PUT', '/api/warranty_claims', [{ status: 'draft' }]);
    assert.equal(missingIdBulk.status, 409);
  });
});

test('ordinary mechanic authorization follows the target Service ticket on create and serviceTicketId update', async () => {
  const data = fixture({
    mechanics: [{ id: 'M-1', userId: 'U-mech', name: 'Mechanic' }],
    service: [
      { id: 'S-own', counterpartyId: 'CP-1', status: 'new', assignedMechanicId: 'M-1' },
      { id: 'S-other', counterpartyId: 'CP-2', status: 'new', assignedMechanicId: 'M-2' },
      { id: 'S-own-2', counterpartyId: 'CP-1', status: 'new', assignedMechanicId: 'M-1' },
    ],
    warranty_claims: [{ id: 'W-own', serviceTicketId: 'S-own', counterpartyId: 'CP-1', status: 'draft' }],
  });
  const mechanic = { userId: 'U-mech', userName: 'Mechanic', userRole: 'Механик' };
  await withWarrantyCrud(data, mechanic, async request => {
    const forbiddenCreate = await request('POST', '/api/warranty_claims', {
      serviceTicketId: 'S-other', equipmentLabel: 'Lift', factoryName: 'Factory',
      failureDescription: 'Failure', requestedResolution: 'Repair', status: 'draft', priority: 'medium',
    });
    assert.equal(forbiddenCreate.status, 403);

    const allowedCreate = await request('POST', '/api/warranty_claims', {
      serviceTicketId: 'S-own', equipmentLabel: 'Lift', factoryName: 'Factory',
      failureDescription: 'Failure', requestedResolution: 'Repair', status: 'draft', priority: 'medium',
    });
    assert.equal(allowedCreate.status, 201);

    const forbiddenUpdate = await request('PATCH', '/api/warranty_claims/W-own', { serviceTicketId: 'S-other' });
    assert.equal(forbiddenUpdate.status, 403);
    const allowedUpdate = await request('PATCH', '/api/warranty_claims/W-own', { serviceTicketId: 'S-own-2' });
    assert.equal(allowedUpdate.status, 200);
    assert.equal(allowedUpdate.body.counterpartyId, 'CP-1');
  });
});
