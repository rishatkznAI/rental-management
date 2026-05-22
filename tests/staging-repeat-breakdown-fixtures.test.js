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
const { buildServiceRepeatBreakdowns } = require('../server/lib/service-repeat-breakdowns.js');
const {
  EQUIPMENT_PREFIX,
  SERVICE_PREFIX,
  buildRepeatBreakdownFixtures,
} = require('../server/scripts/seed-staging-repeat-breakdown-fixtures.cjs');

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const scriptPath = path.join(rootDir, 'scripts', 'seed-staging-repeat-breakdown-fixtures.cjs');
const NOW = new Date('2026-05-22T12:00:00.000Z');

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

function buildFixtureAnalytics() {
  const fixtures = buildRepeatBreakdownFixtures(NOW);
  return buildServiceRepeatBreakdowns({
    equipment: fixtures.equipment,
    tickets: fixtures.service,
    workItems: fixtures.repairWorkItems,
    partItems: fixtures.repairPartItems,
  });
}

test('staging repeat breakdown fixture seed refuses without explicit allow flag', () => {
  const result = runSeed({
    RAILWAY_ENVIRONMENT_NAME: 'staging',
    RAILWAY_PROJECT_NAME: 'cooperative-vitality',
    RAILWAY_SERVICE_NAME: 'rental-management',
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /ALLOW_STAGING_FIXTURE_SEED=true/);
});

test('staging repeat breakdown fixture seed refuses production-like environment', () => {
  const result = runSeed({
    ALLOW_STAGING_FIXTURE_SEED: 'true',
    RAILWAY_ENVIRONMENT_NAME: 'production',
    RAILWAY_PROJECT_NAME: 'cooperative-vitality',
    RAILWAY_SERVICE_NAME: 'rental-management',
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /not clearly staging|production-like/);
});

test('staging repeat breakdown fixture seed is idempotent and scoped to fixture prefixes', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'repeat-breakdown-fixtures-'));
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
    assert.equal(firstPayload.prefixes.equipment, EQUIPMENT_PREFIX);
    assert.equal(firstPayload.prefixes.service, SERVICE_PREFIX);

    const second = runSeed(env);
    assert.equal(second.status, 0, second.stderr);
    const secondPayload = JSON.parse(second.stdout);
    assert.deepEqual(
      Object.fromEntries(secondPayload.results.map(item => [item.collection, [item.removed, item.upserted]])),
      {
        equipment: [3, 3],
        service: [6, 6],
        repair_work_items: [3, 3],
        repair_part_items: [3, 3],
      },
    );

    const equipment = readCollection(dbPath, 'equipment');
    const service = readCollection(dbPath, 'service');
    const workItems = readCollection(dbPath, 'repair_work_items');
    const partItems = readCollection(dbPath, 'repair_part_items');
    assert.equal(equipment.every(item => String(item.id).startsWith(EQUIPMENT_PREFIX)), true);
    assert.equal(service.every(item => String(item.id).startsWith(SERVICE_PREFIX)), true);
    assert.equal(workItems.every(item => String(item.id).startsWith(SERVICE_PREFIX) && String(item.repairId).startsWith(SERVICE_PREFIX)), true);
    assert.equal(partItems.every(item => String(item.id).startsWith(SERVICE_PREFIX) && String(item.repairId).startsWith(SERVICE_PREFIX)), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('high repeat fixture produces critical or high repeat items with links', () => {
  const result = buildFixtureAnalytics();
  const highItems = result.items.filter(item => item.equipmentId === `${EQUIPMENT_PREFIX}EQ-HIGH`);

  assert.ok(highItems.length >= 1);
  assert.ok(highItems.some(item => ['critical', 'high'].includes(item.repeatSeverity)));
  assert.ok(highItems.every(item => item.links.equipment === `/equipment/${encodeURIComponent(item.equipmentId)}`));
  assert.ok(highItems.every(item => item.links.previousServiceTicket.startsWith('/service/')));
  assert.ok(highItems.every(item => item.links.repeatServiceTicket.startsWith('/service/')));
});

test('medium repeat fixture produces lower-severity repeat item', () => {
  const result = buildFixtureAnalytics();
  const mediumItem = result.items.find(item => (
    item.equipmentId === `${EQUIPMENT_PREFIX}EQ-MEDIUM`
    && item.previousTicketId === `${SERVICE_PREFIX}MEDIUM-1`
    && item.repeatTicketId === `${SERVICE_PREFIX}MEDIUM-2`
  ));

  assert.ok(mediumItem);
  assert.equal(mediumItem.repeatSeverity, 'medium');
  assert.equal(mediumItem.repeatWindow, 14);
});

test('non-repeat control fixture is excluded from repeat items', () => {
  const result = buildFixtureAnalytics();

  assert.equal(result.items.some(item => item.equipmentId === `${EQUIPMENT_PREFIX}EQ-CONTROL`), false);
});

test('repeat breakdown fixtures produce non-zero summary and groups without unsafe labels', () => {
  const result = buildFixtureAnalytics();
  const serialized = JSON.stringify(result);

  assert.equal(result.summary.totalRepeats > 0, true);
  assert.equal(result.summary.repeatWithin30 > 0, true);
  assert.equal(result.summary.critical + result.summary.high > 0, true);
  assert.equal(result.summary.medium > 0, true);
  assert.equal(result.groups.byEquipment.length > 0, true);
  assert.equal(result.groups.byModel.length > 0, true);
  assert.equal(result.groups.byMechanic.length > 0, true);
  assert.equal(result.groups.byScenario.length > 0, true);
  assert.equal(/password|token|secret|hash|email|Bearer\s+/i.test(serialized), false);
  assert.equal(/undefined|null|\[object Object\]/.test(serialized), false);
});
