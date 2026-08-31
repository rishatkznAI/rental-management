import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');

const {
  REQUEST_IDEMPOTENCY_TABLE,
  createRequestIdempotencyService,
} = require('../server/lib/request-idempotency.js');

const FINGERPRINT_A = 'a'.repeat(64);
const FINGERPRINT_B = 'b'.repeat(64);

function command(overrides = {}) {
  return {
    scope: { companyId: 'COMPANY-A', tenantId: 'COMPANY-A' },
    operation: 'rentals.create',
    clientKey: 'request-key-0001',
    requestFingerprint: FINGERPRINT_A,
    resultType: 'rentals',
    createdByUserId: 'USER-A',
    ...overrides,
  };
}

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE app_data (
      name TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

test('tenant, operation, and client key form the authoritative namespace', () => {
  const db = createDb();
  const service = createRequestIdempotencyService({
    db,
    nowIso: () => '2026-08-26T10:00:00.000Z',
  });
  let creates = 0;

  const first = service.execute(command(), () => {
    creates += 1;
    return 'RENTAL-A';
  });
  const sameTenantReplayByAnotherActor = service.execute(command({ createdByUserId: 'USER-B' }), () => {
    creates += 1;
    return 'SHOULD-NOT-BE-CREATED';
  });
  const otherTenant = service.execute(command({
    scope: { companyId: 'COMPANY-B', tenantId: 'COMPANY-B' },
    createdByUserId: 'USER-B',
  }), () => {
    creates += 1;
    return 'RENTAL-B';
  });
  const otherOperation = service.execute(command({ operation: 'client_objects.create' }), () => {
    creates += 1;
    return 'OBJECT-A';
  });

  assert.deepEqual(first, { status: 'created', resultId: 'RENTAL-A' });
  assert.deepEqual(sameTenantReplayByAnotherActor, { status: 'replayed', resultId: 'RENTAL-A' });
  assert.deepEqual(otherTenant, { status: 'created', resultId: 'RENTAL-B' });
  assert.deepEqual(otherOperation, { status: 'created', resultId: 'OBJECT-A' });
  assert.equal(creates, 3);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${REQUEST_IDEMPOTENCY_TABLE}`).get().count, 3);
});

test('changed payload under the same authoritative namespace fails without invoking the write', () => {
  const db = createDb();
  const service = createRequestIdempotencyService({ db });
  service.execute(command(), () => 'RENTAL-A');
  let invoked = false;

  assert.throws(
    () => service.execute(command({ requestFingerprint: FINGERPRINT_B }), () => {
      invoked = true;
      return 'RENTAL-B';
    }),
    error => error?.code === 'IDEMPOTENCY_KEY_REUSED' && error?.status === 409,
  );
  assert.equal(invoked, false);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${REQUEST_IDEMPOTENCY_TABLE}`).get().count, 1);
});

test('legacy unscoped records are immutable global tombstones and never become replay payloads', () => {
  const db = createDb();
  const legacyPayload = JSON.stringify([{
    key: 'legacy-key-0001',
    fingerprint: FINGERPRINT_A,
    rentalId: 'DELETED-RENTAL',
    actorUserId: 'DELETED-USER',
    secretHistoricalPayload: 'must-not-be-returned',
  }]);
  db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)')
    .run('rental_create_idempotency', legacyPayload);
  const service = createRequestIdempotencyService({ db });
  let invoked = false;

  for (const operation of ['rentals.create', 'client_objects.create']) {
    assert.throws(
      () => service.execute(command({
        operation,
        clientKey: 'legacy-key-0001',
      }), () => {
        invoked = true;
        return 'NEW-RESULT';
      }),
      error => (
        error?.code === 'LEGACY_IDEMPOTENCY_KEY_RESERVED'
        && error?.status === 409
        && !String(error?.message || '').includes('must-not-be-returned')
        && !String(JSON.stringify(error?.details || {})).includes('DELETED-RENTAL')
      ),
    );
  }

  assert.equal(invoked, false);
  assert.equal(db.prepare('SELECT json FROM app_data WHERE name = ?').get('rental_create_idempotency').json, legacyPayload);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${REQUEST_IDEMPOTENCY_TABLE}`).get().count, 0);
});

test('receipt and business persistence share one immediate transaction and roll back together', () => {
  const db = createDb();
  const service = createRequestIdempotencyService({ db });

  assert.throws(
    () => service.execute(command(), () => {
      db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)').run('rentals', '[{"id":"R-ROLLBACK"}]');
      throw new Error('injected persistence failure');
    }),
    /injected persistence failure/,
  );

  assert.equal(db.prepare('SELECT 1 FROM app_data WHERE name = ?').get('rentals'), undefined);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${REQUEST_IDEMPOTENCY_TABLE}`).get().count, 0);
});

test('receipts survive service recreation and are append-only', () => {
  const db = createDb();
  const firstService = createRequestIdempotencyService({ db });
  firstService.execute(command(), () => 'RENTAL-A');

  const restartedService = createRequestIdempotencyService({ db });
  assert.deepEqual(restartedService.inspect(command()), {
    status: 'replayed',
    resultId: 'RENTAL-A',
  });
  assert.throws(
    () => db.prepare(`UPDATE ${REQUEST_IDEMPOTENCY_TABLE} SET result_id = ?`).run('TAMPERED'),
    /REQUEST_IDEMPOTENCY_IMMUTABLE/,
  );
  assert.throws(
    () => db.prepare(`DELETE FROM ${REQUEST_IDEMPOTENCY_TABLE}`).run(),
    /REQUEST_IDEMPOTENCY_IMMUTABLE/,
  );
  assert.throws(
    () => db.prepare(`
      INSERT OR REPLACE INTO ${REQUEST_IDEMPOTENCY_TABLE} (
        tenant_id, operation, client_key, request_fingerprint,
        result_type, result_id, created_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'COMPANY-A',
      'rentals.create',
      'request-key-0001',
      FINGERPRINT_A,
      'rentals',
      'TAMPERED',
      'USER-A',
      '2026-08-26T10:00:00.000Z',
    ),
    /REQUEST_IDEMPOTENCY_IMMUTABLE/,
  );
});

test('incomplete or mismatched actor scope fails closed before a callback can run', () => {
  const db = createDb();
  const service = createRequestIdempotencyService({ db });
  let invoked = false;

  for (const scope of [null, {}, { companyId: 'A', tenantId: 'B' }]) {
    assert.throws(
      () => service.execute(command({ scope }), () => {
        invoked = true;
        return 'RESULT';
      }),
      error => error?.code === 'ACTOR_SCOPE_INCOMPLETE' && error?.status === 403,
    );
  }
  assert.equal(invoked, false);
});

test('missing legacy tombstone storage fails closed instead of permitting a new key', () => {
  const db = new Database(':memory:');
  const service = createRequestIdempotencyService({ db });
  let invoked = false;

  assert.throws(
    () => service.execute(command(), () => {
      invoked = true;
      return 'RESULT';
    }),
    error => error?.code === 'LEGACY_IDEMPOTENCY_STORAGE_UNAVAILABLE' && error?.status === 503,
  );
  assert.equal(invoked, false);
});
