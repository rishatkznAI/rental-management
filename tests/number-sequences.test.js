import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  createNumberSequenceAllocator,
  ensureNumberSequenceSchema,
  formatBusinessNumber,
} = require('../server/lib/number-sequences');
const {
  assertBusinessNumberNotProvided,
  createBusinessNumberingService,
} = require('../server/lib/business-numbering');

function tempDatabase(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rentcore-numbering-'));
  const dbPath = path.join(dir, 'app.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { db, dbPath };
}

function allocator(db, scopeId = 'SKYTECH', now = '2026-08-21T10:00:00.000Z') {
  return createNumberSequenceAllocator({
    db,
    scope: { scopeType: 'company', scopeId },
    nowIso: () => now,
  });
}

function businessNumbering(db, state, now = '2026-08-21T10:00:00.000Z') {
  return createBusinessNumberingService({
    allocator: allocator(db, 'SKYTECH', now),
    readData: collection => state[collection] || [],
    nowIso: () => now,
  });
}

test('number sequence allocates sequential six-digit Rental numbers', t => {
  const { db } = tempDatabase(t);
  const service = allocator(db);

  assert.equal(service.allocate({ entityType: 'RENTAL', entityId: 'R-1' }).number, 'RNT-26-000001');
  assert.equal(service.allocate({ entityType: 'RENTAL', entityId: 'R-2' }).number, 'RNT-26-000002');
  assert.equal(service.allocate({ entityType: 'RENTAL', entityId: 'R-3' }).number, 'RNT-26-000003');
});

test('number sequences are independent by entity, year and trusted scope', t => {
  const { db } = tempDatabase(t);
  const skytech = allocator(db, 'SKYTECH');
  const tenantB = allocator(db, 'TENANT_B');

  assert.equal(skytech.allocate({ entityType: 'RENTAL', entityId: 'R-1', year: 2026 }).number, 'RNT-26-000001');
  assert.equal(skytech.allocate({ entityType: 'SERVICE_TICKET', entityId: 'S-1', year: 2026 }).number, 'SRV-26-000001');
  assert.equal(skytech.allocate({ entityType: 'DELIVERY', entityId: 'DL-1', year: 2026 }).number, 'DLV-26-000001');
  assert.equal(skytech.allocate({ entityType: 'RENTAL', entityId: 'R-2027', year: 2027 }).number, 'RNT-27-000001');
  assert.equal(skytech.allocate({ entityType: 'RENTAL', entityId: 'R-2', year: 2026 }).number, 'RNT-26-000002');
  assert.equal(tenantB.allocate({ entityType: 'RENTAL', entityId: 'R-B-1', year: 2026 }).number, 'RNT-26-000001');
});

test('year rollover starts at one and does not disturb the prior-year counter', t => {
  const { db } = tempDatabase(t);
  const service = allocator(db);

  let last2026;
  for (let index = 1; index <= 123; index += 1) {
    last2026 = service.allocate({ entityType: 'RENTAL', entityId: `R-2026-${index}`, year: 2026 });
  }

  assert.equal(last2026.number, 'RNT-26-000123');
  assert.equal(
    service.allocate({ entityType: 'RENTAL', entityId: 'R-2027-1', year: 2027 }).number,
    'RNT-27-000001',
  );
  assert.equal(
    service.allocate({ entityType: 'RENTAL', entityId: 'R-2026-124', year: 2026 }).number,
    'RNT-26-000124',
  );
});

test('replaying allocation for the same canonical entity is idempotent and never consumes another number', t => {
  const { db } = tempDatabase(t);
  const service = allocator(db);

  const first = service.allocate({ entityType: 'RENTAL', entityId: 'R-1' });
  const replay = service.allocate({ entityType: 'RENTAL', entityId: 'R-1' });
  const next = service.allocate({ entityType: 'RENTAL', entityId: 'R-2' });

  assert.deepEqual(replay, first);
  assert.equal(next.number, 'RNT-26-000002');
});

test('reserved numbers are not reused after the business record is deleted or cancelled', t => {
  const { db } = tempDatabase(t);
  const service = allocator(db);

  for (let index = 1; index <= 10; index += 1) {
    service.allocate({ entityType: 'RENTAL', entityId: `R-${index}` });
  }
  // No registry row is deleted when its JSON business record disappears.
  assert.equal(service.allocate({ entityType: 'RENTAL', entityId: 'R-11' }).number, 'RNT-26-000011');
});

test('database schema enforces scope/entity number uniqueness', t => {
  const { db } = tempDatabase(t);
  ensureNumberSequenceSchema(db);
  const service = allocator(db);
  service.allocate({ entityType: 'RENTAL', entityId: 'R-1' });

  assert.throws(() => db.prepare(`
    INSERT INTO business_numbers (
      scope_type, scope_id, entity_type, entity_id, year, sequence_value, number, created_at
    ) VALUES ('company', 'SKYTECH', 'RENTAL', 'R-other', 2026, 2, 'RNT-26-000001', '2026-08-21T10:00:00.000Z')
  `).run(), /UNIQUE constraint failed/);
  assert.equal(formatBusinessNumber('INVOICE', 2025, 1), 'INV-25-000001');
});

test('persistence numbering assigns operational numbers and ignores client creation dates', t => {
  const { db } = tempDatabase(t);
  const state = { rentals: [], service: [], deliveries: [], warranty_claims: [] };
  const numbering = businessNumbering(db, state);
  const entries = [
    { name: 'rentals', value: [{ id: 'R-1', createdAt: '2025-01-01T00:00:00.000Z' }] },
    { name: 'service', value: [{ id: 'S-1', createdAt: '2027-01-01T00:00:00.000Z' }] },
    { name: 'deliveries', value: [{ id: 'DL-1' }] },
    { name: 'warranty_claims', value: [{ id: 'WC-1', date: '2024-01-01' }] },
  ];

  numbering.preparePersistenceEntries(entries);

  assert.equal(entries[0].value[0].number, 'RNT-26-000001');
  assert.equal(entries[1].value[0].number, 'SRV-26-000001');
  assert.equal(entries[2].value[0].number, 'DLV-26-000001');
  assert.equal(entries[3].value[0].number, 'WCL-26-000001');
});

test('document business date controls independent SP/AP/AR/ZN/INV sequence years', t => {
  const { db } = tempDatabase(t);
  const state = { documents: [] };
  const numbering = businessNumbering(db, state);
  const documents = [
    { id: 'D-SP', type: 'rental_specification', date: '2025-12-31' },
    { id: 'D-AP', type: 'transfer_act_to_client', date: '2026-01-01' },
    { id: 'D-AR', type: 'return_act_from_client', date: '2026-01-01' },
    { id: 'D-ZN', type: 'work_order', date: '2026-01-01' },
    { id: 'D-INV', type: 'invoice', date: '2026-01-01' },
  ];

  numbering.preparePersistenceEntries([{ name: 'documents', value: documents }]);

  assert.deepEqual(documents.map(item => item.number), [
    'SP-25-000001',
    'AP-26-000001',
    'AR-26-000001',
    'ZN-26-000001',
    'INV-26-000001',
  ]);
  assert.ok(documents.every(item => item.documentNumber === item.number));
});

test('document without an explicit business date uses the server date fallback', t => {
  const { db } = tempDatabase(t);
  const state = { documents: [] };
  const numbering = businessNumbering(db, state);
  const document = { id: 'D-AP-NO-DATE', type: 'transfer_act_to_client' };

  numbering.preparePersistenceEntries([{ name: 'documents', value: [document] }]);

  assert.equal(document.number, 'AP-26-000001');
});

test('ClientContract and VehicleTrip own contract and trip-ticket numbers', t => {
  const { db } = tempDatabase(t);
  const state = { client_contracts: [], vehicle_trips: [], documents: [], rentals: [], gantt_rentals: [] };
  const numbering = businessNumbering(db, state);
  const contract = { id: 'CC-1' };
  const trip = { id: 'VT-1' };
  const rental = { id: 'R-1' };
  const gantt = { id: 'GR-1', rentalId: 'R-1' };
  const contractDocument = { id: 'D-CTR', type: 'rental_contract', contractId: 'CC-1', date: '2026-08-21' };
  const tripDocument = { id: 'D-PL', type: 'trip_ticket', vehicleTripId: 'VT-1', date: '2026-08-21' };
  const entries = [
    { name: 'client_contracts', value: [contract] },
    { name: 'vehicle_trips', value: [trip] },
    { name: 'rentals', value: [rental] },
    { name: 'gantt_rentals', value: [gantt] },
    { name: 'documents', value: [contractDocument, tripDocument] },
  ];

  numbering.preparePersistenceEntries(entries);

  assert.equal(contract.number, 'CTR-26-000001');
  assert.equal(contractDocument.number, contract.number);
  assert.equal(trip.number, 'PL-26-000001');
  assert.equal(trip.sheetNumber, trip.number);
  assert.equal(tripDocument.number, trip.number);
  assert.equal(rental.number, 'RNT-26-000001');
  assert.equal(gantt.number, rental.number);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM business_numbers WHERE entity_type = 'CLIENT_CONTRACT'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM business_numbers WHERE entity_type = 'VEHICLE_TRIP'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM business_numbers WHERE entity_type IN ('RENTAL_CONTRACT', 'TRIP_TICKET')").get().count, 0);
});

test('managed document type and master link are immutable after number assignment', t => {
  const { db } = tempDatabase(t);
  const state = {
    client_contracts: [{ id: 'CC-1', number: 'CTR-26-000001' }, { id: 'CC-2', number: 'CTR-26-000002' }],
    vehicle_trips: [{ id: 'VT-1', number: 'PL-26-000001' }, { id: 'VT-2', number: 'PL-26-000002' }],
    documents: [],
  };
  const numbering = businessNumbering(db, state);
  const contractDocument = { id: 'D-CTR', type: 'rental_contract', contractId: 'CC-1' };
  const tripDocument = { id: 'D-PL', type: 'trip_ticket', vehicleTripId: 'VT-1' };
  numbering.preparePersistenceEntries([{ name: 'documents', value: [contractDocument, tripDocument] }]);
  state.documents = [structuredClone(contractDocument), structuredClone(tripDocument)];

  assert.throws(
    () => numbering.preparePersistenceEntries([{ name: 'documents', value: [{ ...contractDocument, contractId: 'CC-2' }, tripDocument] }]),
    error => error?.code === 'BUSINESS_DOCUMENT_OWNER_IMMUTABLE',
  );
  assert.throws(
    () => numbering.preparePersistenceEntries([{ name: 'documents', value: [contractDocument, { ...tripDocument, vehicleTripId: 'VT-2' }] }]),
    error => error?.code === 'BUSINESS_DOCUMENT_OWNER_IMMUTABLE',
  );
  assert.throws(
    () => numbering.preparePersistenceEntries([{ name: 'documents', value: [{ ...contractDocument, type: 'invoice', documentType: 'invoice' }, tripDocument] }]),
    error => error?.code === 'BUSINESS_DOCUMENT_TYPE_IMMUTABLE',
  );
});

test('business numbers are immutable and payment invoice references do not consume INV sequence', t => {
  const { db } = tempDatabase(t);
  const state = {
    rentals: [{ id: 'R-1', number: 'RNT-26-000001' }],
    payments: [],
    documents: [],
  };
  const numbering = businessNumbering(db, state);

  assert.throws(
    () => numbering.preparePersistenceEntries([{ name: 'rentals', value: [{ id: 'R-1', number: 'RNT-26-999999' }] }]),
    error => error?.code === 'BUSINESS_NUMBER_IMMUTABLE',
  );
  numbering.preparePersistenceEntries([{ name: 'payments', value: [{ id: 'P-1', invoiceNumber: 'INV-26-000001' }] }]);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM number_sequences WHERE entity_type = 'INVOICE'").get().count, 0);
  assert.throws(
    () => assertBusinessNumberNotProvided({ number: 'RNT-26-999999' }),
    error => error?.code === 'BUSINESS_NUMBER_SERVER_OWNED' && error?.status === 400,
  );
});

test('50 allocations across concurrent SQLite connections produce 50 unique numbers', async t => {
  const { db, dbPath } = tempDatabase(t);
  ensureNumberSequenceSchema(db);
  const workerCount = 10;
  const allocationsPerWorker = 5;
  const startSignal = new SharedArrayBuffer(4);
  const startView = new Int32Array(startSignal);
  const modulePath = require.resolve('../server/lib/number-sequences');
  const databaseModulePath = serverRequire.resolve('better-sqlite3');
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    const Database = require(workerData.databaseModulePath);
    const { createNumberSequenceAllocator } = require(workerData.modulePath);
    const db = new Database(workerData.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const service = createNumberSequenceAllocator({
      db,
      scope: { scopeType: 'company', scopeId: 'SKYTECH' },
      nowIso: () => '2026-08-21T10:00:00.000Z',
    });
    const startView = new Int32Array(workerData.startSignal);
    Atomics.wait(startView, 0, 0);
    const numbers = [];
    for (let index = 0; index < workerData.count; index += 1) {
      numbers.push(service.allocate({
        entityType: 'RENTAL',
        entityId: 'R-worker-' + workerData.workerIndex + '-' + index,
      }).number);
    }
    db.close();
    parentPort.postMessage(numbers);
  `;

  const workers = Array.from({ length: workerCount }, (_, workerIndex) => new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: {
        allocationsPerWorker,
        count: allocationsPerWorker,
        databaseModulePath,
        dbPath,
        modulePath,
        startSignal,
        workerIndex,
      },
    });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code !== 0) reject(new Error(`numbering worker exited with code ${code}`));
    });
  }));

  Atomics.store(startView, 0, 1);
  Atomics.notify(startView, 0, workerCount);
  const numbers = (await Promise.all(workers)).flat();

  assert.equal(numbers.length, 50);
  assert.equal(new Set(numbers).size, 50);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count
    FROM business_numbers
    WHERE scope_type = 'company' AND scope_id = 'SKYTECH' AND entity_type = 'RENTAL'
  `).get().count, 50);
  assert.equal(db.prepare(`
    SELECT last_value
    FROM number_sequences
    WHERE scope_type = 'company' AND scope_id = 'SKYTECH' AND entity_type = 'RENTAL' AND year = 2026
  `).get().last_value, 50);
});
