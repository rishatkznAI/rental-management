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
const { createAuditLogger } = require('../server/lib/security-audit.js');
const { createServiceAuditLog } = require('../server/lib/service-audit-log.js');
const { createServiceCore } = require('../server/lib/service-core.js');
const { registerCrudRoutes } = require('../server/routes/crud.js');
const {
  SERVICE_RELATION_CLASSIFICATIONS,
  activeServiceCounterpartyReferences,
  auditServiceCounterpartyRelations,
  canonicalizeServicePersistenceEntries,
  canonicalizeServiceTicketCollection,
  canonicalizeServiceTicketCounterpartyRelation,
  decorateServiceTicketCounterparty,
  repairServiceCounterpartyRelations,
  resolveServiceCounterpartyRelation,
} = require('../server/lib/service-counterparty-relations.js');

function fixture(overrides = {}) {
  const collections = {
    counterparties: [
      { id: 'CP-1', legalName: 'ООО Одинаковое имя', shortName: 'Одинаковое имя', status: 'active', roles: ['customer'] },
      { id: 'CP-2', legalName: 'ООО Одинаковое имя', shortName: 'Одинаковое имя', status: 'active', roles: ['customer'] },
      { id: 'CP-3', legalName: 'Без роли', status: 'active', roles: [] },
      { id: 'CP-4', legalName: 'Архивный', status: 'archived', archivedAt: '2026-01-01', roles: ['customer'] },
    ],
    counterparty_role_assignments: [
      { id: 'A-1', counterpartyId: 'CP-1', roleCode: 'customer', status: 'active', validTo: null },
      { id: 'A-2', counterpartyId: 'CP-2', roleCode: 'customer', status: 'active', validTo: null },
      { id: 'A-3', counterpartyId: 'CP-3', roleCode: 'contractor', status: 'active', validTo: null },
      { id: 'A-4', counterpartyId: 'CP-4', roleCode: 'customer', status: 'active', validTo: null },
    ],
    clients: [
      { id: 'CL-1', counterpartyId: 'CP-1', company: 'Одинаковое имя', inn: '1655000001', debt: 100 },
      { id: 'CL-2', counterpartyId: 'CP-2', company: 'Одинаковое имя', inn: '1655000002', documents: ['private'] },
    ],
    rentals: [
      { id: 'R-1', counterpartyId: 'CP-1', clientId: 'CL-1', status: 'active' },
      { id: 'R-2', counterpartyId: 'CP-2', clientId: 'CL-2', status: 'active' },
    ],
    gantt_rentals: [{ id: 'GR-1', rentalId: 'R-1', counterpartyId: 'CP-1', clientId: 'CL-1', status: 'active' }],
    client_objects: [
      { id: 'O-1', counterpartyId: 'CP-1', clientId: 'CL-1', name: 'Объект' },
      { id: 'O-2', counterpartyId: 'CP-2', clientId: 'CL-2', name: 'Объект' },
    ],
    client_contracts: [
      { id: 'C-1', counterpartyId: 'CP-1', clientId: 'CL-1', number: 'Договор' },
      { id: 'C-2', counterpartyId: 'CP-2', clientId: 'CL-2', number: 'Договор' },
    ],
    service: [],
    service_audit_log: [],
    audit_logs: [],
    ...overrides,
  };
  return {
    collections,
    readData(name) { return collections[name] || []; },
  };
}

test('Service independently derives canonical identity from every allowed stable chain', () => {
  const data = fixture();
  const cases = [
    [{ counterpartyId: 'CP-1' }, 'counterpartyId'],
    [{ clientId: 'CL-1' }, 'clientId'],
    [{ rentalId: 'R-1' }, 'rentalId'],
    [{ objectId: 'O-1' }, 'objectId'],
    [{ contractId: 'C-1' }, 'contractId'],
  ];
  for (const [fields, source] of cases) {
    const relation = resolveServiceCounterpartyRelation({ id: `S-${source}`, status: 'new', ...fields }, data);
    assert.equal(relation.counterpartyId, 'CP-1');
    assert.equal(relation.source, source);
  }
});

test('two and all stable relation chains may coexist only when they agree', () => {
  const data = fixture();
  assert.equal(canonicalizeServiceTicketCounterpartyRelation({
    id: 'S-two', status: 'new', clientId: 'CL-1', rentalId: 'R-1',
  }, data).counterpartyId, 'CP-1');
  assert.equal(canonicalizeServiceTicketCounterpartyRelation({
    id: 'S-all', status: 'new', counterpartyId: 'CP-1', clientId: 'CL-1', rentalId: 'R-1', objectId: 'O-1', contractId: 'C-1',
  }, data).counterpartyId, 'CP-1');
});

test('Rental projections may share stable aliases only when their Counterparty relations agree', () => {
  const data = fixture();
  assert.equal(resolveServiceCounterpartyRelation({ id: 'S-rental', status: 'new', rentalId: 'R-1' }, data).counterpartyId, 'CP-1');
  const conflict = fixture({
    gantt_rentals: [{ id: 'GR-2', rentalId: 'R-1', counterpartyId: 'CP-2', clientId: 'CL-2', status: 'active' }],
  });
  assert.throws(
    () => resolveServiceCounterpartyRelation({ id: 'S-rental-conflict', status: 'new', rentalId: 'R-1' }, conflict),
    error => error.code === 'COUNTERPARTY_RELATION_MISMATCH',
  );
});

test('direct-versus-derived and derived-versus-derived mismatches fail closed', () => {
  const data = fixture();
  assert.throws(
    () => canonicalizeServiceTicketCounterpartyRelation({ id: 'S-direct', status: 'new', counterpartyId: 'CP-2', clientId: 'CL-1' }, data),
    error => error.code === 'COUNTERPARTY_RELATION_MISMATCH',
  );
  assert.throws(
    () => canonicalizeServiceTicketCounterpartyRelation({ id: 'S-derived', status: 'new', rentalId: 'R-1', objectId: 'O-2' }, data),
    error => error.code === 'COUNTERPARTY_RELATION_MISMATCH',
  );
});

test('missing stable Client, Rental, ClientObject, and ClientContract references are rejected', () => {
  const data = fixture();
  const cases = [
    ['clientId', 'CL-missing', 'SERVICE_COUNTERPARTY_CLIENT_NOT_FOUND'],
    ['rentalId', 'R-missing', 'SERVICE_COUNTERPARTY_RENTAL_NOT_FOUND'],
    ['objectId', 'O-missing', 'SERVICE_COUNTERPARTY_OBJECT_NOT_FOUND'],
    ['contractId', 'C-missing', 'SERVICE_COUNTERPARTY_CONTRACT_NOT_FOUND'],
  ];
  for (const [field, value, code] of cases) {
    assert.throws(
      () => canonicalizeServiceTicketCounterpartyRelation({ id: `S-${field}`, status: 'new', [field]: value }, data),
      error => error.code === code,
    );
  }
});

test('missing, archived, and customer-role-ineligible Counterparties are rejected for active tickets', () => {
  const data = fixture();
  assert.throws(
    () => canonicalizeServiceTicketCounterpartyRelation({ id: 'S-missing', status: 'new', counterpartyId: 'CP-missing' }, data),
    error => error.code === 'COUNTERPARTY_RELATION_COUNTERPARTY_NOT_FOUND',
  );
  assert.throws(
    () => canonicalizeServiceTicketCounterpartyRelation({ id: 'S-archived', status: 'new', counterpartyId: 'CP-4' }, data),
    error => error.code === 'COUNTERPARTY_RELATION_COUNTERPARTY_ARCHIVED',
  );
  assert.throws(
    () => canonicalizeServiceTicketCounterpartyRelation({ id: 'S-role', status: 'new', counterpartyId: 'CP-3' }, data),
    error => error.code === 'COUNTERPARTY_RELATION_CUSTOMER_ROLE_REQUIRED',
  );
});

test('same-name metadata never establishes or changes Service identity', () => {
  const data = fixture();
  for (const [field, value] of [
    ['client', 'Одинаковое имя'],
    ['counterpartyName', 'Одинаковое имя'],
    ['clientInn', '1655000001'],
    ['clientPhone', '+79990000000'],
    ['rentalLabel', 'Аренда 1'],
  ]) {
    assert.throws(
      () => canonicalizeServiceTicketCounterpartyRelation({ id: `S-${field}`, status: 'new', [field]: value }, data),
      error => error.code === 'SERVICE_COUNTERPARTY_METADATA_ONLY',
    );
  }
  const first = canonicalizeServiceTicketCounterpartyRelation({ id: 'S-1', status: 'new', clientId: 'CL-1', client: 'Одинаковое имя' }, data);
  const second = canonicalizeServiceTicketCounterpartyRelation({ id: 'S-2', status: 'new', clientId: 'CL-2', client: 'Одинаковое имя' }, data);
  assert.equal(first.counterpartyId, 'CP-1');
  assert.equal(second.counterpartyId, 'CP-2');
});

test('Counterparty-only customers and truly internal tickets are valid', () => {
  const data = fixture();
  const customer = canonicalizeServiceTicketCounterpartyRelation({ id: 'S-customer', status: 'new', counterpartyId: 'CP-1' }, data);
  assert.equal(customer.counterpartyId, 'CP-1');
  assert.equal(customer.clientId, undefined);
  assert.deepEqual(
    canonicalizeServiceTicketCounterpartyRelation({ id: 'S-internal', status: 'new', reason: 'Плановое ТО' }, data),
    { id: 'S-internal', status: 'new', reason: 'Плановое ТО' },
  );
});

test('ordinary updates complete missing canonical IDs but never retarget established identity', () => {
  const data = fixture();
  const legacy = { id: 'S-legacy', status: 'new', clientId: 'CL-1', reason: 'Осмотр' };
  const completed = canonicalizeServiceTicketCounterpartyRelation({ ...legacy, reason: 'Диагностика' }, data, { existing: legacy });
  assert.equal(completed.counterpartyId, 'CP-1');

  const existing = { ...legacy, counterpartyId: 'CP-1' };
  assert.throws(
    () => canonicalizeServiceTicketCounterpartyRelation({ ...existing, counterpartyId: 'CP-2', clientId: 'CL-2' }, data, { existing }),
    error => error.code === 'SERVICE_COUNTERPARTY_RELATION_IMMUTABLE',
  );
  assert.throws(
    () => canonicalizeServiceTicketCounterpartyRelation({ ...existing, clientId: 'CL-2' }, data, { existing }),
    error => error.code === 'COUNTERPARTY_RELATION_MISMATCH',
  );
});

test('complete Service collections reject duplicate IDs and mixed valid/invalid batches atomically', () => {
  const data = fixture();
  assert.throws(
    () => canonicalizeServiceTicketCollection([{ id: 'S-1' }, { id: 'S-1' }], data),
    error => error.code === 'SERVICE_COUNTERPARTY_DUPLICATE_TICKET_ID',
  );
  const before = structuredClone(data.collections.service);
  assert.throws(
    () => canonicalizeServicePersistenceEntries([{ name: 'service', value: [
      { id: 'S-valid', status: 'new', counterpartyId: 'CP-1' },
      { id: 'S-invalid', status: 'new', counterpartyId: 'CP-2', rentalId: 'R-1' },
    ] }], data),
    error => error.code === 'COUNTERPARTY_RELATION_MISMATCH',
  );
  assert.deepEqual(data.collections.service, before);
});

test('global single and staged batch persistence canonicalize through the same Service invariant', () => {
  const data = fixture();
  const [single] = canonicalizeServicePersistenceEntries([
    { name: 'service', value: [{ id: 'S-1', status: 'new', rentalId: 'R-1' }] },
  ], data);
  assert.equal(single.value[0].counterpartyId, 'CP-1');

  const staged = canonicalizeServicePersistenceEntries([
    { name: 'counterparties', value: [{ id: 'CP-new', legalName: 'Новый', status: 'active', roles: ['customer'] }] },
    { name: 'counterparty_role_assignments', value: [{ id: 'A-new', counterpartyId: 'CP-new', roleCode: 'customer', status: 'active' }] },
    { name: 'clients', value: [{ id: 'CL-new', counterpartyId: 'CP-new', company: 'Новый' }] },
    { name: 'service', value: [{ id: 'S-new', status: 'new', clientId: 'CL-new' }] },
  ], data);
  assert.equal(staged.find(entry => entry.name === 'service').value[0].counterpartyId, 'CP-new');
});

test('read decoration uses stable IDs and exposes no private Client fields', () => {
  const data = fixture();
  const decorated = decorateServiceTicketCounterparty({
    id: 'S-1', counterpartyId: 'CP-2', clientId: 'CL-2', client: 'wrong same name',
  }, data);
  assert.equal(decorated.counterpartyId, 'CP-2');
  assert.equal(decorated.counterpartyName, 'Одинаковое имя');
  assert.equal(decorated.customerDisplayName, 'Одинаковое имя');
  assert.equal('inn' in decorated, false);
  assert.equal('documents' in decorated, false);
  assert.equal('debt' in decorated, false);
});

test('only active/nonterminal Service tickets block archival and customer-role removal', () => {
  const data = fixture({
    service: [
      { id: 'S-new', counterpartyId: 'CP-1', status: 'new' },
      { id: 'S-progress', counterpartyId: 'CP-1', status: 'in_progress' },
      { id: 'S-repairable', clientId: 'CL-1', status: 'waiting_parts' },
      { id: 'S-ready', counterpartyId: 'CP-1', status: 'ready' },
      { id: 'S-closed', counterpartyId: 'CP-1', status: 'closed' },
    ],
  });
  assert.deepEqual(activeServiceCounterpartyReferences('CP-1', data).map(item => item.id), ['S-new', 'S-progress', 'S-repairable']);
});

test('audit classifies every required Service relation state without mutation', () => {
  const data = fixture({
    service: [
      { id: 'S-canonical', counterpartyId: 'CP-1', status: 'new' },
      { id: 'S-repair', clientId: 'CL-1', status: 'new' },
      { id: 'S-internal', reason: 'ТО', status: 'new' },
      { id: 'S-conflict', counterpartyId: 'CP-2', rentalId: 'R-1', status: 'new' },
      { id: 'S-ref', rentalId: 'R-missing', status: 'new' },
      { id: 'S-cp', counterpartyId: 'CP-missing', status: 'new' },
      { id: 'S-archived', counterpartyId: 'CP-4', status: 'new' },
      { id: 'S-role', counterpartyId: 'CP-3', status: 'new' },
      { id: 'S-meta', clientName: 'Одинаковое имя', status: 'new' },
    ],
  });
  const before = structuredClone(data.collections.service);
  const audit = auditServiceCounterpartyRelations(data);
  assert.deepEqual(data.collections.service, before);
  const classifications = new Set(audit.entries.map(entry => entry.classification));
  for (const expected of Object.values(SERVICE_RELATION_CLASSIFICATIONS)) assert.ok(classifications.has(expected), expected);
});

test('repair applies only deterministic stable-ID completions and is idempotent', () => {
  const data = fixture({
    service: [
      { id: 'S-repair', rentalId: 'R-1', status: 'new' },
      { id: 'S-unresolved', clientName: 'Одинаковое имя', status: 'new' },
    ],
  });
  const first = repairServiceCounterpartyRelations({
    readData: data.readData,
    writeDataBatch(entries) {
      for (const entry of entries) data.collections[entry.name] = entry.value;
    },
    dryRun: false,
  });
  assert.equal(first.changedRecords, 1);
  assert.equal(first.unresolvedRecords, 1);
  assert.equal(data.collections.service[0].counterpartyId, 'CP-1');
  assert.equal(data.collections.service[1].counterpartyId, undefined);
  assert.equal(repairServiceCounterpartyRelations({ readData: data.readData, dryRun: true }).changed, false);
});

test('offline migration is read-only in dry-run and raw apply is blocked without mutation', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'service-counterparty-'));
  const dbPath = path.join(tempDir, 'migration.sqlite');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE app_data (name TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT)');
  const insert = db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)');
  const data = fixture().collections;
  data.service = [{ id: 'S-1', rentalId: 'R-1', status: 'new' }];
  for (const [name, value] of Object.entries(data)) insert.run(name, JSON.stringify(value));
  db.close();

  const script = path.resolve('server/scripts/service-counterparty-relations.js');
  const run = (...args) => spawnSync(process.execPath, [script, ...args, '--db', dbPath], {
    cwd: path.resolve('server'),
    encoding: 'utf8',
  });
  try {
    const dryRun = run('--dry-run');
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.equal(JSON.parse(dryRun.stdout).changedRecords, 1);
    let verify = new Database(dbPath, { readonly: true });
    assert.equal(JSON.parse(verify.prepare('SELECT json FROM app_data WHERE name = ?').get('service').json)[0].counterpartyId, undefined);
    verify.close();

    const applied = run('--apply');
    assert.notEqual(applied.status, 0);
    assert.match(applied.stderr, /AUDITED_MAINTENANCE_RUNNER_REQUIRED/);
    verify = new Database(dbPath, { readonly: true });
    assert.equal(JSON.parse(verify.prepare('SELECT json FROM app_data WHERE name = ?').get('service').json)[0].counterpartyId, undefined);
    verify.close();
    assert.equal(fs.existsSync(path.join(tempDir, 'backups')), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

async function withServiceCrud(data, run) {
  const readData = name => data.collections[name] || [];
  const persistEntries = entries => {
    const canonical = canonicalizeServicePersistenceEntries(entries, { readData });
    for (const entry of canonical) data.collections[entry.name] = entry.value;
  };
  const writeData = (name, value) => persistEntries([{ name, value }]);
  const serviceCore = createServiceCore({
    readData,
    writeData,
    writeDataBatch: persistEntries,
    nowIso: () => '2026-08-12T12:00:00.000Z',
    equipmentMatchesServiceTicket: (ticket, equipment) => ticket.equipmentId === equipment.id,
  });
  let auditSequence = 0;
  const auditDeps = {
    readData,
    writeData,
    generateId: prefix => `${prefix}-${++auditSequence}`,
    nowIso: () => '2026-08-12T12:00:00.000Z',
  };
  const auditLog = createAuditLogger(auditDeps);
  const serviceAuditLog = createServiceAuditLog(auditDeps);
  const accessControl = createAccessControl({ readData });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actorScope = {
      companyId: 'COMPANY-A',
      tenantId: 'COMPANY-A',
      membershipId: 'MEMBERSHIP-U-admin',
      principalId: 'U-admin',
      source: 'service-counterparty-test',
    };
    next();
  });
  const pass = () => (_req, _res, next) => next();
  app.use('/api', registerCrudRoutes({
    collections: ['service'],
    idPrefixes: { service: 'S' },
    readData,
    writeData,
    writeDataBatch: persistEntries,
    writeServiceDataBatch: persistEntries,
    requireAuth(req, _res, next) {
      req.user = { userId: 'U-admin', userName: 'Admin', userRole: 'Администратор' };
      next();
    },
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
    generateId: () => `S-${data.collections.service.length + 1}`,
    nowIso: () => '2026-08-12T12:00:00.000Z',
    applyServiceTicketCreationEffects: serviceCore.applyServiceTicketCreationEffects,
    persistServiceTicketUpdate: serviceCore.persistServiceTicketUpdate,
    persistServiceTicketDeletion: serviceCore.persistServiceTicketDeletion,
    persistServiceTicketBulkReplace: serviceCore.persistServiceTicketBulkReplace,
    accessControl,
    auditLog,
    serviceAuditLog,
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

test('generic Service create, patch, list/detail, bulk replacement, and delete share canonical enforcement', async () => {
  const data = fixture();
  await withServiceCrud(data, async request => {
    const created = await request('POST', '/api/service', {
      clientId: 'CL-1', equipmentId: 'EQ-1', reason: 'Осмотр', description: 'Осмотр', status: 'new', priority: 'medium',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.counterpartyId, 'CP-1');
    assert.equal(data.collections.service[0].counterpartyId, 'CP-1');

    const retarget = await request('PATCH', `/api/service/${created.body.id}`, { counterpartyId: 'CP-2', clientId: 'CL-2' });
    assert.equal(retarget.status, 409);
    assert.equal(data.collections.service[0].counterpartyId, 'CP-1');

    const patched = await request('PATCH', `/api/service/${created.body.id}`, { description: 'Уточнение' });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.counterpartyId, 'CP-1');

    const list = await request('GET', '/api/service');
    assert.equal(list.status, 200);
    assert.equal(list.body[0].counterpartyName, 'Одинаковое имя');
    assert.equal('debt' in list.body[0], false);
    const detail = await request('GET', `/api/service/${created.body.id}`);
    assert.equal(detail.body.customerDisplayName, 'Одинаковое имя');

    const beforeBulk = structuredClone(data.collections.service);
    const bulkBase = {
      id: beforeBulk[0].id,
      equipmentId: beforeBulk[0].equipmentId,
      reason: beforeBulk[0].reason,
      description: beforeBulk[0].description,
      status: beforeBulk[0].status,
      priority: beforeBulk[0].priority,
      counterpartyId: beforeBulk[0].counterpartyId,
      clientId: beforeBulk[0].clientId,
    };
    const rejectedBulk = await request('PUT', '/api/service', [
      bulkBase,
      { id: 'S-invalid', counterpartyId: 'CP-2', rentalId: 'R-1', equipmentId: 'EQ-1', reason: 'bad', status: 'new', priority: 'medium' },
    ]);
    assert.equal(rejectedBulk.status, 409, JSON.stringify(rejectedBulk.body));
    assert.deepEqual(data.collections.service, beforeBulk);

    const validBulk = await request('PUT', '/api/service', [{ ...bulkBase, description: 'bulk' }]);
    assert.equal(validBulk.status, 200);
    assert.equal(data.collections.service[0].description, 'bulk');

    const deleted = await request('DELETE', `/api/service/${created.body.id}`);
    assert.equal(deleted.status, 200);
    assert.equal(data.collections.service.length, 0);
  });
});
