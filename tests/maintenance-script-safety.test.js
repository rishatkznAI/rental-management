import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  assertAuditedMaintenanceApplyUnavailable,
  assertDisposableFixtureDatabase,
  parseAppDataValue,
} = require('../server/lib/maintenance-script-safety.js');
const {
  normalizePart,
} = require('../scripts/import-spare-parts-catalog.cjs');

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function createAppDataDb(dbPath, collections = {}) {
  const db = new Database(dbPath);
  try {
    db.exec('CREATE TABLE app_data (name TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT)');
    const insert = db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)');
    for (const [name, value] of Object.entries(collections)) insert.run(name, JSON.stringify(value));
  } finally {
    db.close();
  }
}

test('raw maintenance apply and ambiguous fixture targets fail closed with stable error codes', () => {
  assert.throws(
    () => assertAuditedMaintenanceApplyUnavailable(true, 'test repair'),
    error => error.code === 'AUDITED_MAINTENANCE_RUNNER_REQUIRED',
  );
  assert.throws(
    () => assertDisposableFixtureDatabase({
      dbPath: '/tmp/app.sqlite',
      env: { STAGING_FIXTURE_DATABASE_DISPOSABLE: 'true' },
      kind: 'staging',
    }),
    error => error.code === 'FIXTURE_DATABASE_TARGET_DENIED',
  );
  assert.throws(
    () => parseAppDataValue({ json: '{broken' }, 'equipment'),
    error => error.code === 'MAINTENANCE_COLLECTION_INVALID_JSON',
  );
});

test('catalogue preview is byte-for-byte readonly and missing IDs are deterministic', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-preview-'));
  const dbPath = path.join(dir, 'catalogue-preview.sqlite');
  const inputPath = path.join(dir, 'parts.json');
  try {
    createAppDataDb(dbPath, { spare_parts: [{ id: 'PT-old', name: 'Old' }], spare_parts_catalog: [] });
    fs.writeFileSync(inputPath, JSON.stringify([{ name: 'Filter', article: 'F-1' }]));
    const before = digest(dbPath);
    const run = (...args) => spawnSync(process.execPath, [
      'scripts/import-spare-parts-catalog.cjs',
      ...args,
      '--db', dbPath,
      '--input', inputPath,
    ], { cwd: rootDir, encoding: 'utf8' });
    const preview = run('--dry-run');
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(JSON.parse(preview.stdout).productionDataChanged, false);
    assert.equal(digest(dbPath), before);
    const applied = run('--apply');
    assert.notEqual(applied.status, 0);
    assert.match(applied.stderr, /AUDITED_MAINTENANCE_RUNNER_REQUIRED/);
    assert.equal(digest(dbPath), before);
    assert.equal(normalizePart({ name: 'Filter', article: 'F-1' }).id, normalizePart({ name: 'Filter', article: 'F-1' }).id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SQL shadow diagnostic cannot create missing schema on a readonly source database', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readonly-shadow-diagnostic-'));
  const dbPath = path.join(dir, 'diagnostic.sqlite');
  try {
    createAppDataDb(dbPath, { documents: [], gantt_rentals: [], rentals: [], equipment: [] });
    const before = digest(dbPath);
    const result = spawnSync(process.execPath, [
      'scripts/diagnose-sql-index-consistency.cjs', '--db', dbPath,
    ], { cwd: rootDir, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SQL_SHADOW_MIGRATION_REGISTRATION_MISSING/);
    assert.equal(digest(dbPath), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
