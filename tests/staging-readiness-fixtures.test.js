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
const { buildFixtures } = require('../server/scripts/seed-staging-readiness-fixtures.cjs');

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
  const dbPath = path.join(dir, 'app.sqlite');
  const env = {
    DB_PATH: dbPath,
    ALLOW_STAGING_FIXTURE_SEED: 'true',
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
    assert.equal(equipmentResult.removed, 8);
    assert.equal(equipmentResult.upserted, 8);

    const equipment = readCollection(dbPath, 'equipment');
    const rentals = readCollection(dbPath, 'rentals');
    assert.equal(equipment.filter(item => String(item.id).startsWith('STG-READINESS-')).length, 8);
    assert.equal(rentals.filter(item => String(item.id).startsWith('STG-READINESS-')).length, 5);
    assert.ok(rentals.some(item => String(item.id).startsWith('STG-READINESS-') && (item.rate || item.dailyRate || item.monthlyRate)));
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

test('staging readiness fixtures produce expected management action queue', () => {
  const now = new Date('2026-05-20T12:00:00Z');
  const fixtures = buildFixtures(now);
  const queue = buildManagementActionQueue({
    now,
    equipment: fixtures.equipment,
    rentals: fixtures.rentals,
    serviceTickets: fixtures.service,
    deliveries: fixtures.deliveries,
    documents: fixtures.documents,
    gsmPackets: fixtures.gsmPackets,
  });
  const ids = queue.items.map(item => item.equipmentId);
  assert.equal(ids.includes('STG-READINESS-EQ-READY'), false);
  assert.equal(ids.includes('STG-READINESS-EQ-RENTED'), false);
  assert.equal(queue.items.find(item => item.equipmentId === 'STG-READINESS-EQ-SERVICE')?.responsibleArea, 'service');
  assert.equal(queue.items.find(item => item.equipmentId === 'STG-READINESS-EQ-DELIVERY')?.responsibleArea, 'logistics');
  assert.equal(queue.items.find(item => item.equipmentId === 'STG-READINESS-EQ-DOC')?.responsibleArea, 'office');
  assert.equal(queue.items.find(item => item.equipmentId === 'STG-READINESS-EQ-GSM')?.responsibleArea, 'admin');
  assert.ok(queue.items.some(item => item.equipmentId === 'STG-READINESS-EQ-CHECK' && ['service', 'office'].includes(item.responsibleArea)));
  assert.ok(queue.items.some(item => item.equipmentId === 'STG-READINESS-EQ-UNKNOWN' && ['low', 'medium'].includes(item.priority)));
});
