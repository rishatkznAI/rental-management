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
const { registerCrudRoutes } = require('../server/routes/crud.js');

const {
  DELIVERY_RELATION_CLASSIFICATIONS,
  auditDeliveryCounterpartyRelations,
  canonicalizeDeliveryCarrierCounterpartyRelation,
  canonicalizeDeliveryCounterpartyRelations,
  canonicalizeDeliveryPersistenceEntries,
  deliveryCarrierReferenceBlockers,
  repairDeliveryCounterpartyRelations,
} = require('../server/lib/delivery-counterparty-relations');

function fixture(overrides = {}) {
  const collections = {
    counterparties: [
      { id: 'CP-C', legalName: 'Customer Current', shortName: 'Customer', status: 'active', roles: ['customer'] },
      { id: 'CP-C2', legalName: 'Second Customer', status: 'active', roles: ['customer'] },
      { id: 'CP-K', legalName: 'Contractor Current', shortName: 'Carrier Co', status: 'active', roles: ['contractor'] },
    ],
    counterparty_role_assignments: [
      { id: 'A-C', counterpartyId: 'CP-C', roleCode: 'customer', status: 'active', validTo: null },
      { id: 'A-C2', counterpartyId: 'CP-C2', roleCode: 'customer', status: 'active', validTo: null },
      { id: 'A-K', counterpartyId: 'CP-K', roleCode: 'contractor', status: 'active', validTo: null },
    ],
    clients: [{ id: 'CL-C', counterpartyId: 'CP-C', company: 'Old snapshot' }],
    rentals: [{ id: 'R-1', clientId: 'CL-C', counterpartyId: 'CP-C', status: 'active' }],
    gantt_rentals: [],
    client_objects: [],
    client_contracts: [],
    delivery_carriers: [{ id: 'DC-1', counterpartyId: 'CP-K', name: 'Old carrier snapshot', status: 'active' }],
    deliveries: [],
    ...overrides,
  };
  return {
    collections,
    readData(name) { return collections[name] || []; },
  };
}

test('Delivery accepts a customer Counterparty without manufacturing a Client', () => {
  const data = fixture();
  const delivery = canonicalizeDeliveryCounterpartyRelations({
    id: 'D-1', counterpartyId: 'CP-C2', client: 'stale', status: 'new', carrierId: 'DC-1',
  }, data);
  assert.equal(delivery.counterpartyId, 'CP-C2');
  assert.equal(delivery.clientId, undefined);
  assert.equal(delivery.client, 'Second Customer');
  assert.equal(delivery.carrierCounterpartyId, 'CP-K');
});

test('Delivery repairs its customer relation only through a stable rental chain', () => {
  const data = fixture();
  const delivery = canonicalizeDeliveryCounterpartyRelations({ id: 'D-1', rentalId: 'R-1', status: 'new' }, data);
  assert.equal(delivery.counterpartyId, 'CP-C');
  assert.equal(delivery.clientId, 'CL-C');
});

test('display names cannot establish Delivery identity', () => {
  const data = fixture();
  assert.throws(
    () => canonicalizeDeliveryCounterpartyRelations({ id: 'D-1', client: 'Customer', status: 'new' }, data),
    error => error.code === 'COUNTERPARTY_RELATION_ID_REQUIRED',
  );
});

test('dual customer stable-ID mismatch is rejected', () => {
  const data = fixture();
  assert.throws(
    () => canonicalizeDeliveryCounterpartyRelations({
      id: 'D-1', counterpartyId: 'CP-C2', rentalId: 'R-1', status: 'new',
    }, data),
    error => error.code === 'COUNTERPARTY_RELATION_MISMATCH',
  );
});

test('invalid, duplicate, and carrier-mismatched IDs fail closed while Counterparty rename keeps identity stable', () => {
  const data = fixture();
  assert.throws(
    () => canonicalizeDeliveryCounterpartyRelations({ id: 'D-missing', counterpartyId: 'CP-missing', status: 'new' }, data),
    error => error.code === 'COUNTERPARTY_RELATION_COUNTERPARTY_NOT_FOUND',
  );

  data.collections.counterparties.push({ ...data.collections.counterparties[0] });
  assert.throws(
    () => canonicalizeDeliveryCounterpartyRelations({ id: 'D-duplicate', counterpartyId: 'CP-C', status: 'new' }, data),
    error => error.code === 'COUNTERPARTY_RELATION_AMBIGUOUS',
  );
  data.collections.counterparties.pop();

  assert.throws(
    () => canonicalizeDeliveryCounterpartyRelations({
      id: 'D-carrier-mismatch',
      counterpartyId: 'CP-C',
      carrierId: 'DC-1',
      carrierCounterpartyId: 'CP-C2',
      status: 'new',
    }, data),
    error => error.code === 'COUNTERPARTY_RELATION_MISMATCH',
  );

  data.collections.counterparties[0].shortName = 'Renamed customer';
  const renamed = canonicalizeDeliveryCounterpartyRelations({
    id: 'D-renamed', counterpartyId: 'CP-C', client: 'Old snapshot', status: 'new',
  }, data);
  assert.equal(renamed.counterpartyId, 'CP-C');
  assert.equal(renamed.client, 'Renamed customer');
});

test('missing customer or contractor role is rejected by authoritative assignments', () => {
  const data = fixture({
    counterparty_role_assignments: [{ id: 'A-C', counterpartyId: 'CP-C', roleCode: 'customer', status: 'active' }],
  });
  assert.throws(
    () => canonicalizeDeliveryCarrierCounterpartyRelation({ id: 'DC-1', counterpartyId: 'CP-K', status: 'active' }, data),
    error => error.code === 'COUNTERPARTY_RELATION_CONTRACTOR_ROLE_REQUIRED',
  );

  const projectionOnly = fixture({
    counterparty_role_assignments: [{ id: 'A-K', counterpartyId: 'CP-K', roleCode: 'contractor', status: 'active' }],
  });
  assert.throws(
    () => canonicalizeDeliveryCounterpartyRelations({ id: 'D-1', clientId: 'CL-C', status: 'new' }, projectionOnly),
    error => error.code === 'COUNTERPARTY_RELATION_CUSTOMER_ROLE_REQUIRED',
  );
});

test('carrier relation is stable and immutable without a Client compatibility profile', () => {
  const data = fixture();
  const carrier = canonicalizeDeliveryCarrierCounterpartyRelation(
    { id: 'DC-1', counterpartyId: 'CP-K', name: 'Snapshot', status: 'active' },
    data,
    { existing: data.collections.delivery_carriers[0] },
  );
  assert.equal(carrier.counterpartyId, 'CP-K');
  assert.equal(carrier.company, 'Carrier Co');
  assert.throws(
    () => canonicalizeDeliveryCarrierCounterpartyRelation(
      { ...carrier, counterpartyId: 'CP-C' },
      data,
      { existing: data.collections.delivery_carriers[0] },
    ),
    error => ['COUNTERPARTY_RELATION_CONTRACTOR_ROLE_REQUIRED', 'COUNTERPARTY_RELATION_IMMUTABLE'].includes(error.code),
  );
});

test('duplicate stable carrier IDs fail closed', () => {
  const base = fixture();
  const data = fixture({ delivery_carriers: [...base.collections.delivery_carriers, { ...base.collections.delivery_carriers[0] }] });
  assert.throws(
    () => canonicalizeDeliveryCounterpartyRelations({ id: 'D-1', counterpartyId: 'CP-C', carrierId: 'DC-1' }, data),
    error => error.code === 'COUNTERPARTY_RELATION_AMBIGUOUS',
  );
});

test('audit and repair are deterministic and idempotent', () => {
  const data = fixture();
  data.collections.deliveries = [{ id: 'D-1', rentalId: 'R-1', carrierId: 'DC-1', status: 'completed' }];
  const audit = auditDeliveryCounterpartyRelations(data);
  assert.equal(audit.entries.find(item => item.domain === 'deliveries').classification, DELIVERY_RELATION_CLASSIFICATIONS.REPAIRABLE);
  const writes = [];
  const first = repairDeliveryCounterpartyRelations({
    readData: data.readData,
    writeDataBatch(entries) {
      writes.push(...entries);
      for (const entry of entries) data.collections[entry.name] = entry.value;
    },
    dryRun: false,
  });
  assert.equal(first.changedRecords, 1);
  assert.equal(repairDeliveryCounterpartyRelations({ readData: data.readData, dryRun: true }).changed, false);
  assert.equal(writes[0].value[0].counterpartyId, 'CP-C');
});

test('shared persistence canonicalizes a staged carrier before its deliveries', () => {
  const data = fixture({ delivery_carriers: [], deliveries: [] });
  const entries = canonicalizeDeliveryPersistenceEntries([
    { name: 'delivery_carriers', value: [{ id: 'DC-2', counterpartyId: 'CP-K', status: 'active' }] },
    { name: 'deliveries', value: [{ id: 'D-2', counterpartyId: 'CP-C', carrierId: 'DC-2', status: 'new' }] },
  ], data);
  assert.equal(entries.find(item => item.name === 'deliveries').value[0].carrierCounterpartyId, 'CP-K');
});

test('carrier deletion blockers use stable IDs only', () => {
  const data = fixture({
    deliveries: [{ id: 'D-1', carrierId: 'DC-1' }, { id: 'D-2', carrier: 'Old carrier snapshot' }],
  });
  assert.deepEqual(deliveryCarrierReferenceBlockers(data.collections.delivery_carriers[0], data), [
    { collection: 'deliveries', id: 'D-1' },
  ]);
});

test('offline migration dry-run is read-only, apply backs up atomically, and repeat apply is idempotent', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-counterparty-'));
  const dbPath = path.join(tempDir, 'migration.sqlite');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE app_data (name TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT)');
  const insert = db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)');
  const data = fixture().collections;
  data.deliveries = [{ id: 'D-1', rentalId: 'R-1', carrierId: 'DC-1', status: 'completed' }];
  for (const [name, value] of Object.entries(data)) insert.run(name, JSON.stringify(value));
  db.close();

  const script = path.resolve('server/scripts/delivery-counterparty-relations.js');
  const run = (...args) => spawnSync(process.execPath, [script, ...args, '--db', dbPath], {
    cwd: path.resolve('server'),
    encoding: 'utf8',
  });
  try {
    const dryRun = run('--dry-run');
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.equal(JSON.parse(dryRun.stdout).changedRecords, 1);
    let verify = new Database(dbPath, { readonly: true });
    assert.equal(JSON.parse(verify.prepare('SELECT json FROM app_data WHERE name = ?').get('deliveries').json)[0].counterpartyId, undefined);
    verify.close();

    const applied = run('--apply');
    assert.equal(applied.status, 0, applied.stderr);
    const appliedResult = JSON.parse(applied.stdout);
    assert.ok(fs.existsSync(appliedResult.backupPath));
    verify = new Database(dbPath, { readonly: true });
    const migrated = JSON.parse(verify.prepare('SELECT json FROM app_data WHERE name = ?').get('deliveries').json)[0];
    verify.close();
    assert.equal(migrated.counterpartyId, 'CP-C');
    assert.equal(migrated.carrierCounterpartyId, 'CP-K');

    const repeated = run('--apply');
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(JSON.parse(repeated.stdout).changed, false);
    assert.equal(fs.readdirSync(path.join(tempDir, 'backups')).length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('generic DeliveryCarrier CRUD and bulk paths enforce canonical identity and history guards', async () => {
  const data = fixture();
  data.collections.counterparties.push({ id: 'CP-K2', legalName: 'Other Carrier', status: 'active', roles: ['contractor'] });
  data.collections.counterparty_role_assignments.push({ id: 'A-K2', counterpartyId: 'CP-K2', roleCode: 'contractor', status: 'active' });
  data.collections.delivery_carriers = [];
  const readData = name => data.collections[name] || [];
  const writeData = (name, value) => { data.collections[name] = value; };
  const accessControl = createAccessControl({ readData });
  const app = express();
  app.use(express.json());
  const pass = () => (_req, _res, next) => next();
  app.use('/api', registerCrudRoutes({
    collections: ['delivery_carriers'],
    idPrefixes: { delivery_carriers: 'DC' },
    readData,
    writeData,
    writeDataBatch: entries => entries.forEach(entry => writeData(entry.name, entry.value)),
    requireAuth(req, _res, next) {
      req.user = { userId: 'U-A', userName: 'Admin', userRole: 'Администратор' };
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
    generateId: () => 'DC-1',
    nowIso: () => '2026-08-12T12:00:00.000Z',
    accessControl,
    auditLog: () => {},
    serviceAuditLog: () => {},
    normalizeRecordClientLink: item => item,
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, route, body) => {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await request('POST', '/api/delivery_carriers', { name: 'Carrier', status: 'active' })).status, 400);
    const created = await request('POST', '/api/delivery_carriers', { counterpartyId: 'CP-K', status: 'active' });
    assert.equal(created.status, 201);
    assert.equal(created.body.counterpartyId, 'CP-K');
    assert.equal(created.body.company, 'Carrier Co');

    const changedIdentity = await request('PATCH', '/api/delivery_carriers/DC-1', { counterpartyId: 'CP-K2' });
    assert.equal(changedIdentity.status, 409);
    assert.equal(data.collections.delivery_carriers[0].counterpartyId, 'CP-K');

    data.collections.deliveries = [{ id: 'D-1', counterpartyId: 'CP-C', carrierId: 'DC-1', carrierCounterpartyId: 'CP-K' }];
    const deleted = await request('DELETE', '/api/delivery_carriers/DC-1');
    assert.equal(deleted.status, 409);
    assert.equal(deleted.body.code, 'DELIVERY_CARRIER_HAS_HISTORY');
    assert.equal((await request('PUT', '/api/delivery_carriers', [])).status, 409);

    const bulk = await request('PUT', '/api/delivery_carriers', [{
      ...data.collections.delivery_carriers[0],
      notes: 'updated safely',
    }]);
    assert.equal(bulk.status, 200);
    assert.equal(data.collections.delivery_carriers[0].notes, 'updated safely');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
