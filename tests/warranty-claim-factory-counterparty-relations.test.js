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
const { findRoleRemovalBlockers } = require('../server/lib/counterparty-role-profiles.js');
const { canonicalizeWarrantyPersistenceEntries } = require('../server/lib/warranty-claim-counterparty-relations.js');
const { registerCrudRoutes } = require('../server/routes/crud.js');
const {
  WARRANTY_FACTORY_CLASSIFICATIONS,
  activeWarrantyFactoryCounterpartyReferences,
  applyWarrantyClaimFactoryCounterpartyMappings,
  auditWarrantyClaimFactoryCounterpartyRelations,
  canonicalizeWarrantyClaimFactoryCollection,
  canonicalizeWarrantyClaimFactoryCounterpartyRelation,
  canonicalizeWarrantyFactoryPersistenceEntries,
  decorateWarrantyClaimFactoryCounterparty,
  listEligibleWarrantyFactoryCounterparties,
  planWarrantyClaimFactoryCounterpartyMappings,
  requiresWarrantyFactoryRelation,
  resolveWarrantyClaimFactoryCounterpartyRelation,
} = require('../server/lib/warranty-claim-factory-counterparty-relations.js');

function fixture(overrides = {}) {
  const collections = {
    counterparties: [
      { id: 'CP-C', legalName: 'ООО Клиент', status: 'active', roles: ['customer'] },
      { id: 'CP-S1', legalName: 'ООО Одинаковый завод', shortName: 'Одинаковый завод', status: 'active', roles: ['supplier'] },
      { id: 'CP-S2', legalName: 'ООО Одинаковый завод', shortName: 'Одинаковый завод', status: 'active', roles: ['supplier'] },
      { id: 'CP-ARCH', legalName: 'Архивный завод', status: 'archived', archivedAt: '2026-01-01', roles: ['supplier'] },
      { id: 'CP-INACTIVE', legalName: 'Неактивный поставщик', status: 'active', roles: ['supplier'] },
      { id: 'CP-NOPROFILE', legalName: 'Без профиля', status: 'active', roles: ['supplier'] },
      { id: 'CP-LEGACY', legalName: 'Только legacy projection', status: 'active', roles: ['supplier'] },
      { id: 'CP-BOTH', legalName: 'Клиент и поставщик', status: 'active', roles: ['customer', 'supplier'] },
    ],
    counterparty_role_assignments: [
      { id: 'A-C', counterpartyId: 'CP-C', roleCode: 'customer', status: 'active', validTo: null },
      { id: 'A-S1', counterpartyId: 'CP-S1', roleCode: 'supplier', status: 'active', validTo: null },
      { id: 'A-S2', counterpartyId: 'CP-S2', roleCode: 'supplier', status: 'active', validTo: null },
      { id: 'A-ARCH', counterpartyId: 'CP-ARCH', roleCode: 'supplier', status: 'inactive', validTo: '2026-01-01' },
      { id: 'A-INACTIVE', counterpartyId: 'CP-INACTIVE', roleCode: 'supplier', status: 'inactive', validTo: '2026-01-01' },
      { id: 'A-NOPROFILE', counterpartyId: 'CP-NOPROFILE', roleCode: 'supplier', status: 'active', validTo: null },
      { id: 'A-BOTH-C', counterpartyId: 'CP-BOTH', roleCode: 'customer', status: 'active', validTo: null },
      { id: 'A-BOTH-S', counterpartyId: 'CP-BOTH', roleCode: 'supplier', status: 'active', validTo: null },
    ],
    supplier_profiles: [
      { id: 'SP-S1', counterpartyId: 'CP-S1', status: 'active' },
      { id: 'SP-S2', counterpartyId: 'CP-S2', status: 'active' },
      { id: 'SP-ARCH', counterpartyId: 'CP-ARCH', status: 'inactive', archivedAt: '2026-01-01' },
      { id: 'SP-INACTIVE', counterpartyId: 'CP-INACTIVE', status: 'inactive', archivedAt: '2026-01-01' },
      { id: 'SP-BOTH', counterpartyId: 'CP-BOTH', status: 'active' },
    ],
    clients: [
      { id: 'CL-C', counterpartyId: 'CP-C', company: 'ООО Клиент', inn: '7707083893' },
      { id: 'CL-BOTH', counterpartyId: 'CP-BOTH', company: 'Клиент и поставщик', inn: '7707083894' },
    ],
    service: [
      { id: 'S-C', counterpartyId: 'CP-C', clientId: 'CL-C', status: 'new', equipmentId: 'EQ-1' },
      { id: 'S-BOTH', counterpartyId: 'CP-BOTH', clientId: 'CL-BOTH', status: 'new', equipmentId: 'EQ-2' },
    ],
    rentals: [],
    gantt_rentals: [],
    warranty_claims: [],
    ...overrides,
  };
  return {
    collections,
    readData(name) { return collections[name] || []; },
  };
}

function externalClaim(overrides = {}) {
  return {
    id: 'W-1',
    status: 'sent_to_factory',
    factoryCounterpartyId: 'CP-S1',
    equipmentLabel: 'Lift',
    factoryName: 'Historical Factory Snapshot',
    failureDescription: 'Failure',
    requestedResolution: 'Repair',
    priority: 'medium',
    ...overrides,
  };
}

test('resolver uses only exact stable ID and authoritative active supplier assignment plus SupplierProfile', () => {
  const data = fixture();
  const relation = resolveWarrantyClaimFactoryCounterpartyRelation(externalClaim(), data);
  assert.equal(relation.factoryCounterpartyId, 'CP-S1');
  assert.equal(relation.supplierAssignment.id, 'A-S1');
  assert.equal(relation.supplierProfile.id, 'SP-S1');

  for (const [overrides, code] of [
    [{ factoryCounterpartyId: 'CP-MISSING' }, 'WARRANTY_FACTORY_COUNTERPARTY_NOT_FOUND'],
    [{ factoryCounterpartyId: 'CP-ARCH' }, 'WARRANTY_FACTORY_COUNTERPARTY_ARCHIVED'],
    [{ factoryCounterpartyId: 'CP-INACTIVE' }, 'WARRANTY_FACTORY_SUPPLIER_ASSIGNMENT_INVALID'],
    [{ factoryCounterpartyId: 'CP-NOPROFILE' }, 'WARRANTY_FACTORY_SUPPLIER_PROFILE_INVALID'],
    [{ factoryCounterpartyId: 'CP-LEGACY' }, 'WARRANTY_FACTORY_SUPPLIER_ASSIGNMENT_INVALID'],
  ]) {
    assert.throws(
      () => resolveWarrantyClaimFactoryCounterpartyRelation(externalClaim(overrides), data),
      error => error.code === code,
    );
  }

  const duplicated = fixture({
    counterparties: [
      ...data.collections.counterparties,
      { id: 'CP-S1', legalName: 'Duplicate stable target', status: 'active' },
    ],
  });
  assert.throws(
    () => resolveWarrantyClaimFactoryCounterpartyRelation(externalClaim(), duplicated),
    error => error.code === 'WARRANTY_FACTORY_COUNTERPARTY_DUPLICATE',
  );

  for (const metadata of [
    { factoryName: 'Одинаковый завод' },
    { manufacturer: 'Одинаковый завод' },
    { factoryName: 'CP-S1' },
  ]) {
    assert.throws(
      () => resolveWarrantyClaimFactoryCounterpartyRelation(externalClaim({
        factoryCounterpartyId: undefined,
        ...metadata,
      }), data),
      error => error.code === 'WARRANTY_FACTORY_RELATION_REQUIRED',
    );
  }
});

test('status, evidence, terminal history, reopen, immutability, and independent customer/factory identities are enforced', () => {
  const data = fixture();
  for (const status of ['sent_to_factory', 'factory_review', 'answer_received', 'approved', 'parts_shipping', 'unknown_nonterminal']) {
    assert.equal(requiresWarrantyFactoryRelation({ status }), true);
    assert.throws(
      () => canonicalizeWarrantyClaimFactoryCounterpartyRelation({ id: `W-${status}`, status }, data),
      error => error.code === 'WARRANTY_FACTORY_RELATION_REQUIRED',
    );
  }
  for (const status of ['draft', 'new', 'created', 'open']) {
    assert.equal(requiresWarrantyFactoryRelation({ status }), false);
    assert.doesNotThrow(() => canonicalizeWarrantyClaimFactoryCounterpartyRelation({ id: `W-${status}`, status }, data));
  }
  for (const field of ['sentAt', 'factoryCaseNumber', 'factoryResponse']) {
    assert.throws(
      () => canonicalizeWarrantyClaimFactoryCounterpartyRelation({ id: `W-${field}`, status: 'draft', [field]: 'evidence' }, data),
      error => error.code === 'WARRANTY_FACTORY_RELATION_REQUIRED',
    );
  }

  const terminal = externalClaim({ status: 'closed', factoryCounterpartyId: 'CP-ARCH' });
  assert.equal(canonicalizeWarrantyClaimFactoryCounterpartyRelation(terminal, data, {
    existing: terminal,
  }).factoryCounterpartyId, 'CP-ARCH');
  assert.doesNotThrow(() => canonicalizeWarrantyClaimFactoryCounterpartyRelation({
    id: 'W-terminal-snapshot', status: 'done', factoryName: 'Legacy only', manufacturer: 'Brand',
  }, data));
  assert.throws(
    () => canonicalizeWarrantyClaimFactoryCounterpartyRelation({ ...terminal, status: 'factory_review' }, data, { existing: terminal }),
    error => error.code === 'WARRANTY_FACTORY_COUNTERPARTY_ARCHIVED',
  );

  const established = externalClaim();
  for (const requested of [undefined, null, '', 'CP-S2']) {
    assert.throws(
      () => canonicalizeWarrantyClaimFactoryCounterpartyRelation({ ...established, factoryCounterpartyId: requested }, data, { existing: established }),
      error => error.code === 'WARRANTY_FACTORY_RELATION_IMMUTABLE',
    );
  }
  const firstEstablishment = canonicalizeWarrantyClaimFactoryCounterpartyRelation(
    { id: 'W-draft', status: 'factory_review', factoryCounterpartyId: 'CP-S1' },
    data,
    { existing: { id: 'W-draft', status: 'draft' } },
  );
  assert.equal(firstEstablishment.factoryCounterpartyId, 'CP-S1');
  assert.throws(
    () => canonicalizeWarrantyClaimFactoryCounterpartyRelation(
      { id: 'W-legacy-active', status: 'factory_review', factoryCounterpartyId: 'CP-S1' },
      data,
      { existing: { id: 'W-legacy-active', status: 'factory_review', factoryName: 'Legacy' } },
    ),
    error => error.code === 'WARRANTY_FACTORY_CONTROLLED_MAPPING_REQUIRED',
  );

  const sameCounterparty = canonicalizeWarrantyClaimFactoryCounterpartyRelation({
    id: 'W-both', status: 'sent_to_factory', counterpartyId: 'CP-BOTH', factoryCounterpartyId: 'CP-BOTH',
  }, data);
  assert.equal(sameCounterparty.counterpartyId, sameCounterparty.factoryCounterpartyId);
});

test('collection and shared persistence boundaries validate staged dependencies and keep mixed batches atomic', () => {
  const data = fixture();
  assert.throws(
    () => canonicalizeWarrantyClaimFactoryCollection([{ status: 'draft' }], data),
    error => error.code === 'WARRANTY_FACTORY_CLAIM_ID_REQUIRED',
  );
  assert.throws(
    () => canonicalizeWarrantyClaimFactoryCollection([{ id: 'W-dupe', status: 'draft' }, { id: 'W-dupe', status: 'draft' }], data),
    error => error.code === 'WARRANTY_FACTORY_DUPLICATE_CLAIM_ID',
  );

  const freshData = fixture({
    counterparties: [],
    counterparty_role_assignments: [],
    supplier_profiles: [],
    warranty_claims: [],
  });
  const dependencyBatch = canonicalizeWarrantyFactoryPersistenceEntries([
    { name: 'counterparties', value: [{ id: 'CP-new', legalName: 'New supplier', status: 'active' }] },
    { name: 'counterparty_role_assignments', value: [{ id: 'A-new', counterpartyId: 'CP-new', roleCode: 'supplier', status: 'active', validTo: null }] },
    { name: 'supplier_profiles', value: [{ id: 'SP-new', counterpartyId: 'CP-new', status: 'active' }] },
    { name: 'warranty_claims', value: [externalClaim({ id: 'W-new', factoryCounterpartyId: 'CP-new' })] },
  ], { readData: freshData.readData });
  assert.equal(dependencyBatch.find(entry => entry.name === 'warranty_claims').value[0].factoryCounterpartyId, 'CP-new');

  const persisted = { audit_log: [{ id: 'before' }], warranty_claims: [] };
  const atomicWrite = entries => {
    const readData = name => persisted[name] ?? data.readData(name);
    const canonical = canonicalizeWarrantyFactoryPersistenceEntries(entries, { readData });
    for (const entry of canonical) persisted[entry.name] = entry.value;
  };
  assert.throws(
    () => atomicWrite([
      { name: 'audit_log', value: [{ id: 'after' }] },
      { name: 'warranty_claims', value: [externalClaim({ factoryCounterpartyId: 'CP-MISSING' })] },
    ]),
    error => error.code === 'WARRANTY_FACTORY_COUNTERPARTY_NOT_FOUND',
  );
  assert.deepEqual(persisted, { audit_log: [{ id: 'before' }], warranty_claims: [] });

  data.collections.warranty_claims = [externalClaim()];
  assert.throws(
    () => canonicalizeWarrantyFactoryPersistenceEntries([
      { name: 'supplier_profiles', value: [] },
    ], { readData: data.readData }),
    error => error.code === 'WARRANTY_FACTORY_SUPPLIER_PROFILE_INVALID',
  );
});

test('audit taxonomy is read-only, never auto-maps metadata, and exposes strict rollout blockers', () => {
  const data = fixture({
    warranty_claims: [
      externalClaim({ id: 'W-canonical' }),
      { id: 'W-draft', status: 'draft', factoryName: 'Draft snapshot' },
      { id: 'W-missing', status: 'factory_review', factoryName: 'Unique metadata' },
      { id: 'W-ambiguous', status: 'factory_review', factoryName: 'Одинаковый завод' },
      externalClaim({ id: 'W-target-missing', factoryCounterpartyId: 'CP-MISSING' }),
      externalClaim({ id: 'W-archived', factoryCounterpartyId: 'CP-ARCH' }),
      externalClaim({ id: 'W-assignment', factoryCounterpartyId: 'CP-INACTIVE' }),
      externalClaim({ id: 'W-profile', factoryCounterpartyId: 'CP-NOPROFILE' }),
      { id: 'W-terminal', status: 'closed', factoryName: 'Legacy snapshot', manufacturer: 'Brand' },
    ],
  });
  const before = structuredClone(data.collections);
  const audit = auditWarrantyClaimFactoryCounterpartyRelations(data);
  const classifications = new Set(audit.entries.map(entry => entry.classification));
  for (const expected of [
    WARRANTY_FACTORY_CLASSIFICATIONS.CANONICAL,
    WARRANTY_FACTORY_CLASSIFICATIONS.VALID_PRE_EXTERNAL_DRAFT,
    WARRANTY_FACTORY_CLASSIFICATIONS.BLOCKED_MANUAL_MAPPING,
    WARRANTY_FACTORY_CLASSIFICATIONS.AMBIGUOUS_METADATA,
    WARRANTY_FACTORY_CLASSIFICATIONS.MISSING_CANONICAL_TARGET,
    WARRANTY_FACTORY_CLASSIFICATIONS.ARCHIVED_ACTIVE_TARGET,
    WARRANTY_FACTORY_CLASSIFICATIONS.MISSING_INACTIVE_SUPPLIER_ASSIGNMENT,
    WARRANTY_FACTORY_CLASSIFICATIONS.MISSING_INACTIVE_SUPPLIER_PROFILE,
    WARRANTY_FACTORY_CLASSIFICATIONS.UNRESOLVED_TERMINAL_HISTORICAL_SNAPSHOT,
  ]) assert.equal(classifications.has(expected), true, expected);
  assert.equal(audit.strictRolloutReady, false);
  assert.equal(audit.summary.activeExternalUnresolved, 6);
  assert.equal(audit.entries.find(entry => entry.recordId === 'W-missing').repairability, 'explicit_mapping_required');
  assert.equal(data.collections.warranty_claims.find(claim => claim.id === 'W-missing').factoryCounterpartyId, undefined);
  assert.deepEqual(data.collections, before);
});

test('safe options and read decoration expose only stable ID plus display label and preserve snapshots', () => {
  const data = fixture();
  const options = listEligibleWarrantyFactoryCounterparties(data);
  assert.deepEqual(options.map(option => Object.keys(option).sort()), options.map(() => ['displayLabel', 'id']));
  assert.deepEqual(options.filter(option => ['CP-S1', 'CP-S2'].includes(option.id)).map(option => option.displayLabel), [
    'Одинаковый завод · CP-S1',
    'Одинаковый завод · CP-S2',
  ]);
  assert.equal(options.some(option => option.id === 'CP-LEGACY'), false);
  assert.equal(options.some(option => option.id === 'CP-ARCH'), false);
  const decorated = decorateWarrantyClaimFactoryCounterparty(externalClaim(), data);
  assert.equal(decorated.factoryCounterpartyDisplayName, 'Одинаковый завод');
  assert.equal(decorated.factoryName, 'Historical Factory Snapshot');
  assert.equal('roles' in decorated, false);
  assert.equal('supplierProfile' in decorated, false);
});

test('active factory references block supplier removal while terminal claims do not change customer or contractor boundaries', () => {
  const data = fixture({
    warranty_claims: [
      externalClaim({ id: 'W-active' }),
      externalClaim({ id: 'W-terminal', status: 'closed' }),
      { id: 'W-customer', status: 'draft', counterpartyId: 'CP-C' },
    ],
    service: [{ id: 'S-contractor', status: 'closed', contractorCounterpartyId: 'CP-S2' }],
  });
  assert.deepEqual(activeWarrantyFactoryCounterpartyReferences('CP-S1', data).map(claim => claim.id), ['W-active']);
  const supplierBlockers = findRoleRemovalBlockers({ counterpartyId: 'CP-S1', roleCode: 'supplier', data });
  assert.deepEqual(supplierBlockers.find(blocker => blocker.collection === 'warranty_claims').recordIds, ['W-active']);
  assert.equal(findRoleRemovalBlockers({ counterpartyId: 'CP-C', roleCode: 'customer', data })
    .some(blocker => blocker.collection === 'warranty_claims'), true);
  assert.equal(findRoleRemovalBlockers({ counterpartyId: 'CP-S2', roleCode: 'contractor', data })
    .some(blocker => blocker.collection === 'service'), true);
});

async function withWarrantyCrud(data, user, run) {
  const readData = name => data.collections[name] || [];
  const persistEntries = entries => {
    const customerCanonical = canonicalizeWarrantyPersistenceEntries(entries, { readData });
    const factoryCanonical = canonicalizeWarrantyFactoryPersistenceEntries(customerCanonical, { readData });
    for (const entry of factoryCanonical) data.collections[entry.name] = entry.value;
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
    nowIso: () => '2026-08-14T12:00:00.000Z',
    accessControl,
    auditLog: () => {},
    serviceAuditLog: () => {},
    normalizeRecordClientLink: item => item,
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
    await run(request);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('CRUD persists and filters factory identity by ID, blocks invalid transitions and exposes minimal options to Warranty users', async () => {
  const data = fixture();
  const admin = { userId: 'U-admin', userName: 'Admin', userRole: 'Администратор' };
  await withWarrantyCrud(data, admin, async request => {
    const created = await request('POST', '/api/warranty_claims', {
      serviceTicketId: 'S-C', factoryCounterpartyId: 'CP-S1', equipmentLabel: 'Lift', factoryName: 'Snapshot',
      failureDescription: 'Failure', requestedResolution: 'Repair', status: 'draft', priority: 'medium',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.counterpartyId, 'CP-C');
    assert.equal(created.body.factoryCounterpartyId, 'CP-S1');
    assert.equal(created.body.factoryCounterpartyDisplayName, 'Одинаковый завод');

    const external = await request('PATCH', `/api/warranty_claims/${created.body.id}`, { status: 'sent_to_factory' });
    assert.equal(external.status, 200, JSON.stringify(external.body));
    const remove = await request('PATCH', `/api/warranty_claims/${created.body.id}`, { factoryCounterpartyId: null });
    assert.equal(remove.status, 409);
    const replace = await request('PATCH', `/api/warranty_claims/${created.body.id}`, { factoryCounterpartyId: 'CP-S2' });
    assert.equal(replace.status, 409);

    const second = await request('POST', '/api/warranty_claims', {
      serviceTicketId: 'S-C', factoryCounterpartyId: 'CP-S2', equipmentLabel: 'Lift 2', factoryName: 'Same snapshot',
      failureDescription: 'Failure', requestedResolution: 'Repair', status: 'sent_to_factory', priority: 'medium',
    });
    assert.equal(second.status, 201, JSON.stringify(second.body));
    const filtered = await request('GET', '/api/warranty_claims?factoryCounterpartyId=CP-S2');
    assert.equal(filtered.status, 200);
    assert.deepEqual(filtered.body.map(claim => claim.factoryCounterpartyId), ['CP-S2']);

    const before = structuredClone(data.collections.warranty_claims);
    const invalidBulk = await request('PUT', '/api/warranty_claims', [
      ...before,
      externalClaim({ id: 'W-bad', factoryCounterpartyId: 'CP-MISSING' }),
    ]);
    assert.equal(invalidBulk.status, 409);
    assert.deepEqual(data.collections.warranty_claims, before);
    const deleted = await request('DELETE', `/api/warranty_claims/${created.body.id}`);
    assert.equal(deleted.status, 200);
  });

  const warrantyUser = { userId: 'U-warranty', userName: 'Warranty', userRole: 'Механик по гарантии' };
  await withWarrantyCrud(fixture(), warrantyUser, async request => {
    const options = await request('GET', '/api/warranty_claims/factory-counterparty-options');
    assert.equal(options.status, 200);
    assert.ok(options.body.length >= 2);
    assert.ok(options.body.every(option => Object.keys(option).sort().join(',') === 'displayLabel,id'));
    assert.doesNotMatch(JSON.stringify(options.body), /inn|debt|finance|profile|roles/i);
  });
  const unknownUser = { userId: 'U-unknown', userName: 'Unknown', userRole: 'Unknown Role' };
  await withWarrantyCrud(fixture(), unknownUser, async request => {
    assert.equal((await request('GET', '/api/warranty_claims/factory-counterparty-options')).status, 403);
  });
});

test('controlled mapping validates explicit IDs, fingerprints, atomicity, and repeat application', () => {
  const data = fixture({
    warranty_claims: [
      { id: 'W-map', status: 'factory_review', factoryName: 'Одинаковый завод' },
      { id: 'W-terminal', status: 'closed', manufacturer: 'Historical brand' },
    ],
  });
  const writes = [];
  const manifest = { mappings: [{ claimId: 'W-map', factoryCounterpartyId: 'CP-S1' }] };
  const preview = planWarrantyClaimFactoryCounterpartyMappings({ readData: data.readData, manifest });
  assert.equal(preview.changedRecords, 1);
  assert.equal(data.collections.warranty_claims[0].factoryCounterpartyId, undefined);
  assert.throws(
    () => applyWarrantyClaimFactoryCounterpartyMappings({
      readData: data.readData, writeDataBatch: () => {}, manifest,
    }),
    error => error.code === 'WARRANTY_FACTORY_MAPPING_MANIFEST_INVALID',
  );
  assert.throws(
    () => applyWarrantyClaimFactoryCounterpartyMappings({
      readData: data.readData,
      writeDataBatch: () => {},
      manifest,
      expectedFingerprint: '0'.repeat(64),
    }),
    error => error.code === 'WARRANTY_FACTORY_MAPPING_PRECONDITION_CHANGED',
  );
  const applied = applyWarrantyClaimFactoryCounterpartyMappings({
    readData: data.readData,
    writeDataBatch(entries) {
      writes.push(entries);
      for (const entry of entries) data.collections[entry.name] = entry.value;
    },
    manifest,
    expectedFingerprint: preview.sourceFingerprint,
  });
  assert.equal(applied.wrote, true);
  assert.equal(data.collections.warranty_claims[0].factoryCounterpartyId, 'CP-S1');
  const repeatedPreview = planWarrantyClaimFactoryCounterpartyMappings({ readData: data.readData, manifest });
  const repeated = applyWarrantyClaimFactoryCounterpartyMappings({
    readData: data.readData,
    writeDataBatch: () => assert.fail('no-op mapping must not write'),
    manifest,
    expectedFingerprint: repeatedPreview.sourceFingerprint,
  });
  assert.equal(repeated.wrote, false);

  for (const invalidManifest of [
    { mappings: [{ claimId: 'W-missing', factoryCounterpartyId: 'CP-S1' }] },
    { mappings: [{ claimId: 'W-terminal', factoryCounterpartyId: 'CP-MISSING' }] },
    { mappings: [{ claimId: 'W-terminal', factoryCounterpartyId: 'CP-S1' }, { claimId: 'W-terminal', factoryCounterpartyId: 'CP-S2' }] },
  ]) {
    assert.throws(() => planWarrantyClaimFactoryCounterpartyMappings({ readData: data.readData, manifest: invalidManifest }));
  }
  assert.equal(writes.length, 1);
});

function createCliDatabase(dbPath, data) {
  const db = new Database(dbPath);
  db.exec('CREATE TABLE app_data (name TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT)');
  const insert = db.prepare('INSERT INTO app_data (name, json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  for (const [name, value] of Object.entries(data.collections)) insert.run(name, JSON.stringify(value));
  db.close();
}

test('mapping CLI is read-only and blocks raw apply without mutation', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warranty-factory-mapping-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const manifestPath = path.join(tempDir, 'mapping.json');
  const data = fixture({
    warranty_claims: [{ id: 'W-map', status: 'factory_review', factoryName: 'Одинаковый завод' }],
  });
  createCliDatabase(dbPath, data);
  const script = path.resolve('server/scripts/warranty-claim-factory-counterparty-relations.js');
  const run = mode => spawnSync(process.execPath, [script, mode, '--db', dbPath, '--manifest', manifestPath], {
    cwd: path.resolve('.'), encoding: 'utf8',
  });
  try {
    fs.writeFileSync(manifestPath, JSON.stringify({ mappings: [{ claimId: 'W-map', factoryCounterpartyId: 'CP-S1' }] }));
    const dryRun = run('--dry-run');
    assert.equal(dryRun.status, 0, dryRun.stderr);
    const preview = JSON.parse(dryRun.stdout);
    let verify = new Database(dbPath, { readonly: true });
    assert.equal(JSON.parse(verify.prepare('SELECT json FROM app_data WHERE name = ?').get('warranty_claims').json)[0].factoryCounterpartyId, undefined);
    verify.close();

    fs.writeFileSync(manifestPath, JSON.stringify({
      sourceFingerprint: preview.sourceFingerprint,
      mappings: [{ claimId: 'W-map', factoryCounterpartyId: 'CP-S1' }],
    }));
    const applied = run('--apply');
    assert.notEqual(applied.status, 0);
    assert.match(applied.stderr, /AUDITED_MAINTENANCE_RUNNER_REQUIRED/);
    verify = new Database(dbPath, { readonly: true });
    assert.equal(JSON.parse(verify.prepare('SELECT json FROM app_data WHERE name = ?').get('warranty_claims').json)[0].factoryCounterpartyId, undefined);
    verify.close();
    assert.equal(fs.existsSync(path.join(tempDir, 'backups')), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
