import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  DEMO_PREFIX,
  DEMO_USER_EMAILS,
  assertDemoSeedAllowed,
  buildDemoData,
} = require('../server/scripts/seed-demo-data.js');

function runSeed(dbPath, extraEnv = {}) {
  return execFileSync('node', ['server/scripts/seed-demo-data.js'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: {
      ...process.env,
      DB_PATH: dbPath,
      NODE_ENV: 'test',
      DEMO_ENV: 'true',
      ALLOW_DEMO_SEED: 'true',
      DEMO_DEFAULT_PASSWORD: 'unit-test-demo-password',
      ...extraEnv,
    },
  });
}

function readCollection(dbPath, name) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT json FROM app_data WHERE name = ?').get(name);
    return row ? JSON.parse(row.json) : [];
  } finally {
    db.close();
  }
}

function writeCollection(dbPath, name, value) {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_data (
        name TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.prepare(`
      INSERT INTO app_data (name, json)
      VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET json = excluded.json
    `).run(name, JSON.stringify(value));
  } finally {
    db.close();
  }
}

function withDemoDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'rental-demo-seed-'));
  const dbPath = join(dir, 'demo.sqlite');
  try {
    return fn(dbPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('demo seed refuses production and staging environments', () => {
  assert.throws(
    () => assertDemoSeedAllowed({ env: { DEMO_ENV: 'true', NODE_ENV: 'production' }, dbPath: '/data/demo.sqlite' }),
    /production-like/,
  );
  assert.throws(
    () => assertDemoSeedAllowed({ env: { DEMO_ENV: 'true', APP_ENV: 'staging', NODE_ENV: 'test' }, dbPath: '/data/demo.sqlite' }),
    /staging-like/,
  );
});

test('demo seed requires explicit demo seed permission', () => {
  assert.throws(
    () => assertDemoSeedAllowed({ env: { NODE_ENV: 'test' }, dbPath: '/tmp/demo.sqlite' }),
    /DEMO_ENV=true or ALLOW_DEMO_SEED=true/,
  );
  assert.equal(
    assertDemoSeedAllowed({ env: { NODE_ENV: 'test', ALLOW_DEMO_SEED: 'true', APP_ENV: 'demo' }, dbPath: '/tmp/demo.sqlite' }),
    true,
  );
});

test('demo seed refuses non-demo database paths', () => {
  assert.throws(
    () => assertDemoSeedAllowed({ env: { DEMO_ENV: 'true', NODE_ENV: 'test' }, dbPath: '/data/app.sqlite' }),
    /clearly named demo database/,
  );
});

test('demo seed creates only DEMO-prefixed records and demo users', () => withDemoDb((dbPath) => {
  const output = runSeed(dbPath);
  assert.match(output, /Seeded demo records/);
  assert.doesNotMatch(output, /unit-test-demo-password|h2:scrypt|TOKEN|SECRET|sk-/i);

  const users = readCollection(dbPath, 'users');
  const clients = readCollection(dbPath, 'clients');
  const equipment = readCollection(dbPath, 'equipment');
  const rentals = readCollection(dbPath, 'rentals');
  const service = readCollection(dbPath, 'service');
  const deliveries = readCollection(dbPath, 'deliveries');

  assert.deepEqual(users.map(user => user.email).sort(), [...DEMO_USER_EMAILS].sort());
  assert.ok(users.every(user => String(user.id).startsWith(DEMO_PREFIX)));
  assert.ok(users.every(user => String(user.password || '').startsWith('h2:scrypt:')));
  assert.equal(equipment.length, 20);
  assert.equal(clients.length, 5);
  assert.ok(rentals.some(item => item.status === 'active'));
  assert.ok(rentals.some(item => item.status === 'closed'));
  assert.ok(rentals.some(item => item.status === 'created'));
  assert.ok(service.some(item => item.status === 'waiting_parts'));
  assert.ok(deliveries.some(item => item.status === 'new'));
  assert.ok(deliveries.some(item => item.status === 'in_transit'));
  assert.ok(deliveries.some(item => item.status === 'completed'));

  for (const collection of [users, clients, equipment, rentals, service, deliveries]) {
    assert.ok(collection.every(item => String(item.id || '').startsWith(DEMO_PREFIX)));
    assert.ok(collection.every(item => item.fixtureTag === DEMO_PREFIX));
  }
}));

test('demo seed is idempotent and does not touch non-demo records', () => withDemoDb((dbPath) => {
  writeCollection(dbPath, 'clients', [
    { id: 'CLIENT-PROTECTED', company: 'Protected Existing Client' },
    { id: 'DEMO-CLIENT-OLD', company: 'Old Demo Client', fixtureTag: DEMO_PREFIX },
  ]);
  writeCollection(dbPath, 'equipment', [
    { id: 'EQ-PROTECTED', inventoryNumber: 'PROTECTED-001' },
    { id: 'DEMO-EQ-OLD', inventoryNumber: 'DEMO-EQ-OLD', fixtureTag: DEMO_PREFIX },
  ]);

  runSeed(dbPath);
  runSeed(dbPath);

  const clients = readCollection(dbPath, 'clients');
  const equipment = readCollection(dbPath, 'equipment');
  assert.equal(clients.filter(item => String(item.id).startsWith(DEMO_PREFIX)).length, 5);
  assert.equal(equipment.filter(item => String(item.id).startsWith(DEMO_PREFIX)).length, 20);
  assert.equal(clients.some(item => item.id === 'CLIENT-PROTECTED'), true);
  assert.equal(equipment.some(item => item.id === 'EQ-PROTECTED'), true);
  assert.equal(clients.some(item => item.id === 'DEMO-CLIENT-OLD'), false);
  assert.equal(equipment.some(item => item.id === 'DEMO-EQ-OLD'), false);
}));

test('demo data has no real-looking credentials, external emails, tokens, bot, or GSM data', () => {
  const data = buildDemoData({ env: { DEMO_DEFAULT_PASSWORD: 'unit-test-demo-password' } });
  const visible = JSON.stringify({
    clients: data.clients,
    equipment: data.equipment,
    rentals: data.rentals,
    documents: data.documents,
    payments: data.payments,
    service: data.service,
    deliveries: data.deliveries,
    debt_collection_plans: data.debt_collection_plans,
  });

  assert.doesNotMatch(visible, /sk-[A-Za-z0-9]|Bearer\s+|password|secret|token|webhook|BOT_TOKEN|MAX_WEBHOOK_SECRET/i);
  assert.doesNotMatch(visible, /@[a-z0-9.-]+\.(ru|com|net|org)\b/i);
  assert.ok(data.clients.every(client => String(client.inn || '').startsWith('DEMO-INN-')));
  assert.doesNotMatch(visible, /imei|gsm|gprs/i);
});
