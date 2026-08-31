import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const { buildManagementActionQueue } = require('../server/lib/equipment-readiness.js');
const {
  buildFixtures,
  canonicalizeStagingGsmFixtures,
} = require('../server/scripts/seed-staging-readiness-fixtures.cjs');

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const scriptPath = path.join(rootDir, 'scripts', 'seed-staging-readiness-fixtures.cjs');

function runSeed(env) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: rootDir,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function readCollection(dbPath, collection) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare('SELECT json FROM app_data WHERE name = ?').get(collection);
    return row ? JSON.parse(row.json) : [];
  } finally {
    db.close();
  }
}

test('staging readiness fixture seed refuses without explicit allow flag', () => {
  const result = runSeed({
    RAILWAY_ENVIRONMENT_NAME: 'staging',
    RAILWAY_PROJECT_NAME: 'cooperative-vitality',
    RAILWAY_SERVICE_NAME: 'rental-management',
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /ALLOW_STAGING_FIXTURE_SEED=true/);
});

test('staging readiness fixture seed is guarded and idempotent', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'readiness-fixtures-'));
  const dbPath = path.join(dir, 'staging-readiness-fixtures.sqlite');
  const env = {
    DB_PATH: dbPath,
    ALLOW_STAGING_FIXTURE_SEED: 'true',
    STAGING_FIXTURE_DATABASE_DISPOSABLE: 'true',
    STAGING_COMPANY_ID: 'staging-company-test',
    STAGING_TENANT_ID: 'staging-company-test',
    RAILWAY_ENVIRONMENT_NAME: 'staging',
    RAILWAY_PROJECT_NAME: 'cooperative-vitality',
    RAILWAY_SERVICE_NAME: 'rental-management',
    BOT_DISABLED: 'true',
    GSM_DISABLED: 'true',
    GSM_ENABLED: 'false',
  };

  try {
    const first = runSeed(env);
    assert.equal(first.status, 0, first.stderr);
    const firstPayload = JSON.parse(first.stdout);
    assert.equal(firstPayload.ok, true);
    assert.equal(firstPayload.botEnabled, false);
    assert.equal(firstPayload.gsmEnabled, false);

    const second = runSeed(env);
    assert.equal(second.status, 0, second.stderr);
    const secondPayload = JSON.parse(second.stdout);
    const equipmentResult = secondPayload.results.find(item => item.collection === 'equipment');
    assert.equal(equipmentResult.removed, 9);
    assert.equal(equipmentResult.upserted, 9);

    const equipment = readCollection(dbPath, 'equipment');
    const gsmDevices = readCollection(dbPath, 'gsm_devices');
    const gsmPackets = readCollection(dbPath, 'gsm_packets');
    const rentals = readCollection(dbPath, 'rentals');
    const actionStates = readCollection(dbPath, 'management_action_states');
    assert.equal(equipment.filter(item => String(item.id).startsWith('STG-READINESS-')).length, 9);
    assert.equal(rentals.filter(item => String(item.id).startsWith('STG-READINESS-')).length, 6);
    assert.equal(actionStates.filter(item => String(item.id).startsWith('STG-ACTION-')).length, 6);
    assert.equal(gsmDevices.length, 1);
    assert.equal(gsmDevices[0].companyId, 'staging-company-test');
    assert.equal(gsmDevices[0].tenantId, 'staging-company-test');
    assert.equal(gsmDevices[0].equipmentId, 'STG-READINESS-EQ-GSM');
    assert.equal(gsmPackets.length, 1);
    assert.equal(gsmPackets[0].equipmentId, gsmDevices[0].equipmentId);
    assert.equal(gsmPackets[0].gsmDeviceRecordId, gsmDevices[0].id);
    assert.equal(gsmPackets[0].gsmBindingRevision, 1);
    assert.equal(gsmPackets[0].parseStatus, 'parsed');
    assert.equal(gsmDevices[0].bindingRevision, 1);
    assert.equal(gsmDevices[0].bindingHistory[0].equipmentId, gsmDevices[0].equipmentId);
    assert.equal(gsmDevices[0].ingressMode, 'tcp_device_credential');
    assert.equal(gsmDevices[0].ingressCredentialConfigured, true);
    assert.match(gsmDevices[0].ingressSecretHash, /^scrypt\$v1\$/);
    assert.ok(actionStates.some(item => item.status === 'in_progress'));
    assert.ok(actionStates.some(item => item.status === 'postponed'));
    assert.ok(actionStates.some(item => item.status === 'resolved'));
    assert.ok(actionStates.some(item => item.dueDate === new Date().toISOString().slice(0, 10)));
    assert.ok(actionStates.some(item => String(item.id).includes('HIGH-LOSS-UNASSIGNED')));
    assert.ok(rentals.some(item => String(item.id).startsWith('STG-READINESS-') && (item.rate || item.dailyRate || item.monthlyRate)));
    assert.ok(equipment.every(item => item.companyId === 'staging-company-test' && item.tenantId === 'staging-company-test'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('staging readiness fixture seed refuses production-like environment', () => {
  const result = runSeed({
    ALLOW_STAGING_FIXTURE_SEED: 'true',
    RAILWAY_ENVIRONMENT_NAME: 'production',
    RAILWAY_PROJECT_NAME: 'cooperative-vitality',
    RAILWAY_SERVICE_NAME: 'rental-management',
    APP_DISABLED: 'true',
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /not clearly staging|production-like/);
});

test('staging fixture seed refuses the conventional app.sqlite target even with all allow flags', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'readiness-target-guard-'));
  try {
    const result = runSeed({
      DB_PATH: path.join(dir, 'app.sqlite'),
      ALLOW_STAGING_FIXTURE_SEED: 'true',
      STAGING_FIXTURE_DATABASE_DISPOSABLE: 'true',
      STAGING_COMPANY_ID: 'staging-company-test',
      STAGING_TENANT_ID: 'staging-company-test',
      RAILWAY_ENVIRONMENT_NAME: 'staging',
      RAILWAY_PROJECT_NAME: 'cooperative-vitality',
      RAILWAY_SERVICE_NAME: 'rental-management',
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /refuse app\.sqlite|TARGET_DENIED/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('staging fixture batch rolls back earlier collection writes when a later write fails', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'readiness-atomic-'));
  const dbPath = path.join(dir, 'staging-partial-fixtures.sqlite');
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE app_data (name TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO app_data (name, json) VALUES ('equipment', '[{"id":"sentinel"}]');
      CREATE TRIGGER reject_fixture_documents
      BEFORE INSERT ON app_data
      WHEN NEW.name = 'documents'
      BEGIN
        SELECT RAISE(ABORT, 'injected fixture write failure');
      END;
    `);
  } finally {
    db.close();
  }
  try {
    const result = runSeed({
      DB_PATH: dbPath,
      ALLOW_STAGING_FIXTURE_SEED: 'true',
      STAGING_FIXTURE_DATABASE_DISPOSABLE: 'true',
      STAGING_COMPANY_ID: 'staging-company-test',
      STAGING_TENANT_ID: 'staging-company-test',
      RAILWAY_ENVIRONMENT_NAME: 'staging',
      RAILWAY_PROJECT_NAME: 'cooperative-vitality',
      RAILWAY_SERVICE_NAME: 'rental-management',
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /injected fixture write failure/);
    assert.deepEqual(readCollection(dbPath, 'equipment'), [{ id: 'sentinel' }]);
    assert.deepEqual(readCollection(dbPath, 'rentals'), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('staging readiness fixtures produce expected management action queue', () => {
  const now = new Date('2026-05-20T12:00:00Z');
  const fixtures = buildFixtures(now);
  const canonicalGsm = canonicalizeStagingGsmFixtures(fixtures, {
    companyId: 'staging-company-test',
    tenantId: 'staging-company-test',
  });
  const queue = buildManagementActionQueue({
    now,
    equipment: canonicalGsm.equipment,
    rentals: fixtures.rentals,
    serviceTickets: fixtures.service,
    deliveries: fixtures.deliveries,
    documents: fixtures.documents,
    gsmDevices: canonicalGsm.gsmDevices,
    gsmPackets: fixtures.gsmPackets,
  });
  const ids = queue.items.map(item => item.equipmentId);
  assert.equal(ids.includes('STG-READINESS-EQ-READY'), false);
  assert.equal(ids.includes('STG-READINESS-EQ-RENTED'), false);
  assert.equal(queue.items.find(item => item.equipmentId === 'STG-READINESS-EQ-SERVICE')?.responsibleArea, 'service');
  assert.equal(queue.items.find(item => item.equipmentId === 'STG-READINESS-EQ-DELIVERY')?.responsibleArea, 'logistics');
  assert.equal(queue.items.find(item => item.equipmentId === 'STG-READINESS-EQ-DOC')?.responsibleArea, 'office');
  assert.equal(queue.items.find(item => item.equipmentId === 'STG-READINESS-EQ-GSM')?.responsibleArea, 'admin');
  const gsmReadiness = queue.items.find(item => item.equipmentId === 'STG-READINESS-EQ-GSM');
  assert.equal(gsmReadiness?.readinessStatus, 'gsm_attention');
  assert.match(gsmReadiness?.description || '', /давно не выходил/);
  assert.doesNotMatch(gsmReadiness?.description || '', /пароль/);
  assert.ok(queue.items.some(item => item.equipmentId === 'STG-READINESS-EQ-CHECK' && ['service', 'office'].includes(item.responsibleArea)));
  assert.equal(queue.items.find(item => item.equipmentId === 'STG-READINESS-EQ-ACTION-LOSS')?.priority, 'critical');
  assert.ok(queue.items.some(item => item.equipmentId === 'STG-READINESS-EQ-UNKNOWN' && ['low', 'medium'].includes(item.priority)));
});
