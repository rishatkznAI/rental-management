import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  DOCUMENTS_TABLE,
  EXPECTED_INDEXES,
  GANTT_TABLE,
  SHADOW_MIGRATION_NAME,
  backfillSqlShadowIndexes,
  diagnoseSqlShadowConsistency,
  ensureSqlShadowSchema,
  queryDocumentsIndex,
  queryGanttIndex,
  syncSqlShadowIndexForCollection,
} = require('../server/lib/sql-shadow-indexes.js');

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rental-sql-shadow-'));
  const dbPath = path.join(dir, 'app.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE app_data (
      name TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return { db, dbPath, dir };
}

function setCollection(db, name, value) {
  db.prepare(`
    INSERT INTO app_data (name, json)
    VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET json = excluded.json, updated_at = CURRENT_TIMESTAMP
  `).run(name, JSON.stringify(value));
}

function migrationRow(db) {
  return db.prepare(`
    SELECT rowid, name, version, applied_at
    FROM sql_shadow_schema_migrations
    WHERE name = ?
  `).get(SHADOW_MIGRATION_NAME);
}

function schemaFingerprint(db) {
  const sql = db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE sql IS NOT NULL
    ORDER BY type, name
  `).all();
  return crypto.createHash('sha256').update(JSON.stringify(sql)).digest('hex');
}

function runConcurrentEnsure(dbPath) {
  const source = `
    const Database = require('./server/node_modules/better-sqlite3');
    const { ensureSqlShadowSchema } = require('./server/lib/sql-shadow-indexes');
    const db = new Database(process.env.SHADOW_TEST_DB);
    db.pragma('busy_timeout = 5000');
    try {
      const applied = ensureSqlShadowSchema(db);
      process.stdout.write(JSON.stringify({ ok: true, applied }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, code: error.code || null, message: error.message }));
      process.exitCode = 1;
    } finally {
      db.close();
    }
  `;
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['-e', source], {
      cwd: root,
      env: { ...process.env, SHADOW_TEST_DB: dbPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => {
      let result;
      try {
        result = JSON.parse(stdout);
      } catch {
        result = { ok: false, message: stderr || stdout || `worker exited ${status}` };
      }
      resolve({ ...result, status, stderr });
    });
  });
}

function runFullInitializer(dbPath) {
  return spawnSync(process.execPath, ['-e', "require('./server/db.js').ensureDb()"], {
    cwd: root,
    env: { ...process.env, DB_PATH: dbPath },
    encoding: 'utf8',
  });
}

test('SQL shadow schema creates documents and gantt tables idempotently', () => {
  const { db, dir } = makeDb();
  try {
    assert.equal(ensureSqlShadowSchema(db), true);
    assert.equal(ensureSqlShadowSchema(db), false);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
    assert.ok(tables.includes(DOCUMENTS_TABLE));
    assert.ok(tables.includes(GANTT_TABLE));
    const migration = migrationRow(db);
    assert.equal(migration.version, 2);
    assert.match(migration.applied_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(db.prepare(`
      SELECT COUNT(*) AS count
      FROM sql_shadow_schema_migrations
      WHERE name = ?
    `).get(SHADOW_MIGRATION_NAME).count, 1);
    assert.deepEqual(
      db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'index'
          AND tbl_name IN (?, ?)
          AND name NOT LIKE 'sqlite_autoindex_%'
        ORDER BY name
      `).all(DOCUMENTS_TABLE, GANTT_TABLE).map(row => row.name),
      Object.keys(EXPECTED_INDEXES).sort(),
    );
    const documentColumns = db.prepare(`PRAGMA table_info(${DOCUMENTS_TABLE})`).all().map(row => row.name);
    assert.ok(documentColumns.includes('date'));
    assert.ok(documentColumns.includes('documentDate'));
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('repeated SQL shadow startup preserves exact registration, schema, rows, and change count', () => {
  const { db, dir } = makeDb();
  try {
    assert.equal(ensureSqlShadowSchema(db), true);
    db.prepare(`INSERT INTO ${DOCUMENTS_TABLE} (id, rawJson) VALUES (?, ?)`)
      .run('D-preserved', '{"id":"D-preserved"}');
    db.exec(`
      CREATE TRIGGER deny_shadow_registration_update
      BEFORE UPDATE ON sql_shadow_schema_migrations
      FOR EACH ROW WHEN OLD.name = '${SHADOW_MIGRATION_NAME}'
      BEGIN
        SELECT RAISE(ABORT, 'shadow migration registration is immutable');
      END;
      CREATE TRIGGER deny_shadow_registration_delete
      BEFORE DELETE ON sql_shadow_schema_migrations
      FOR EACH ROW WHEN OLD.name = '${SHADOW_MIGRATION_NAME}'
      BEGIN
        SELECT RAISE(ABORT, 'shadow migration registration is immutable');
      END;
    `);
    const before = {
      migration: migrationRow(db),
      schema: schemaFingerprint(db),
      documents: db.prepare(`SELECT * FROM ${DOCUMENTS_TABLE} ORDER BY id`).all(),
      gantt: db.prepare(`SELECT * FROM ${GANTT_TABLE} ORDER BY id`).all(),
      changes: db.prepare('SELECT total_changes() AS count').get().count,
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal(ensureSqlShadowSchema(db), false);
    }

    assert.deepEqual(migrationRow(db), before.migration);
    assert.equal(schemaFingerprint(db), before.schema);
    assert.deepEqual(db.prepare(`SELECT * FROM ${DOCUMENTS_TABLE} ORDER BY id`).all(), before.documents);
    assert.deepEqual(db.prepare(`SELECT * FROM ${GANTT_TABLE} ORDER BY id`).all(), before.gantt);
    assert.equal(db.prepare('SELECT total_changes() AS count').get().count, before.changes);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('registered SQL shadow schema drift fails closed without repair or timestamp mutation', () => {
  const { db, dir } = makeDb();
  try {
    ensureSqlShadowSchema(db);
    const beforeMigration = migrationRow(db);
    db.exec('DROP INDEX idx_documents_sql_type');
    const driftedSchema = schemaFingerprint(db);

    assert.throws(
      () => ensureSqlShadowSchema(db),
      /SQL_SHADOW_INDEX_SET_MISMATCH/,
    );
    assert.deepEqual(migrationRow(db), beforeMigration);
    assert.equal(schemaFingerprint(db), driftedSchema);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_documents_sql_type'").get().count,
      0,
    );
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SQL shadow migration failure rolls back registration and partial objects', () => {
  const { db, dir } = makeDb();
  try {
    db.exec(`CREATE VIEW ${GANTT_TABLE} AS SELECT 'blocked' AS id`);
    assert.throws(() => ensureSqlShadowSchema(db));
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'sql_shadow_schema_migrations'").get().count,
      0,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?").get(DOCUMENTS_TABLE).count,
      0,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'view' AND name = ?").get(GANTT_TABLE).count,
      1,
    );
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('concurrent SQL shadow startup creates one valid registration', async () => {
  const { db, dbPath, dir } = makeDb();
  db.close();
  try {
    const results = await Promise.all(Array.from({ length: 6 }, () => runConcurrentEnsure(dbPath)));
    assert.equal(results.filter(result => result.ok && result.applied === true).length, 1, JSON.stringify(results));
    assert.equal(results.filter(result => result.ok && result.applied === false).length, 5, JSON.stringify(results));
    assert.ok(results.every(result => result.status === 0), JSON.stringify(results));

    const verified = new Database(dbPath, { readonly: true });
    try {
      assert.equal(verified.prepare(`
        SELECT COUNT(*) AS count FROM sql_shadow_schema_migrations
        WHERE name = ? AND version = 2
      `).get(SHADOW_MIGRATION_NAME).count, 1);
      assert.equal(migrationRow(verified).name, SHADOW_MIGRATION_NAME);
      assert.doesNotThrow(() => require('../server/lib/sql-shadow-indexes.js').assertSqlShadowStructure(verified));
    } finally {
      verified.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('full PR1-PR8 startup chain preserves shadow registration on a new process restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rental-sql-shadow-chain-'));
  const dbPath = path.join(dir, 'app.sqlite');
  try {
    const first = runFullInitializer(dbPath);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const afterFirst = new Database(dbPath);
    const firstMigration = migrationRow(afterFirst);
    const firstSchema = schemaFingerprint(afterFirst);
    afterFirst.exec(`
      CREATE TRIGGER deny_shadow_registration_update
      BEFORE UPDATE ON sql_shadow_schema_migrations
      FOR EACH ROW WHEN OLD.name = '${SHADOW_MIGRATION_NAME}'
      BEGIN
        SELECT RAISE(ABORT, 'shadow migration registration is immutable');
      END;
    `);
    const protectedSchema = schemaFingerprint(afterFirst);
    afterFirst.close();

    const second = runFullInitializer(dbPath);
    assert.equal(second.status, 0, second.stderr || second.stdout);

    const verified = new Database(dbPath, { readonly: true });
    try {
      assert.deepEqual(migrationRow(verified), firstMigration);
      assert.notEqual(protectedSchema, firstSchema);
      assert.equal(schemaFingerprint(verified), protectedSchema);
      assert.equal(verified.prepare(`
        SELECT COUNT(*) AS count FROM sql_shadow_schema_migrations
        WHERE name IN (
          'documents_gantt_shadow_indexes',
          'canonical_receivables_pr1_schema',
          'canonical_receivables_pr2_settlement',
          'platform_identity_pr5',
          'billing_source_authority_pr6',
          'forecast_receivables_planning_pr7',
          'actual_source_eligibility_dry_run_pr8'
        )
      `).get().count, 7);
      for (const table of [
        'canonical_receivables',
        'financial_audit_events',
        'canonical_payments',
        'canonical_payment_allocations',
        'canonical_receivable_adjustments',
        'canonical_approval_requests',
        'company_memberships',
        'billing_source_operations',
        'forecast_receivable_runs',
        'actual_source_dry_runs',
      ]) {
        assert.equal(verified.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
      }
      assert.deepEqual(verified.pragma('foreign_key_check'), []);
      assert.equal(verified.pragma('integrity_check', { simple: true }), 'ok');
    } finally {
      verified.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SQL shadow schema backfills legacy gantt table columns before sync', () => {
  const { db, dir } = makeDb();
  try {
    db.exec(`
      CREATE TABLE ${GANTT_TABLE} (
        id TEXT PRIMARY KEY,
        rentalId TEXT,
        sourceRentalId TEXT,
        originalRentalId TEXT,
        equipmentId TEXT,
        clientId TEXT,
        managerId TEXT,
        ownerId TEXT,
        status TEXT,
        startDate TEXT,
        endDate TEXT,
        plannedReturnDate TEXT,
        searchText TEXT,
        rawJson TEXT NOT NULL
      );
    `);
    ensureSqlShadowSchema(db);
    const columns = db.prepare(`PRAGMA table_info(${GANTT_TABLE})`).all().map(row => row.name);
    assert.ok(columns.includes('objectId'));
    assert.ok(columns.includes('contractId'));

    const result = syncSqlShadowIndexForCollection(db, 'gantt_rentals', [{
      id: 'GR-legacy',
      rentalId: 'R-legacy',
      equipmentId: 'EQ-legacy',
      clientId: 'C-legacy',
      objectId: 'CO-legacy',
      contractId: 'CC-legacy',
      startDate: '2026-05-01',
      endDate: '2026-05-03',
    }]);
    assert.equal(result.inserted, 1);
    const row = db.prepare(`SELECT objectId, contractId, rawJson FROM ${GANTT_TABLE} WHERE id = 'GR-legacy'`).get();
    assert.equal(row.objectId, 'CO-legacy');
    assert.equal(row.contractId, 'CC-legacy');
    assert.equal(JSON.parse(row.rawJson).rentalId, 'R-legacy');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backfill indexes documents and gantt_rentals and preserves rawJson', () => {
  const { db, dir } = makeDb();
  try {
    setCollection(db, 'documents', [
      { id: 'D-1', number: 'ACT-1', type: 'act', status: 'signed', clientId: 'C-1', rentalId: 'R-1', equipmentId: 'EQ-1', date: '2026-05-01', documentDate: '2026-05-02', createdAt: '2026-05-01T12:00:00.000Z', signedAt: '2026-05-02' },
      { number: 'BROKEN-NO-ID', type: 'invoice' },
    ]);
    setCollection(db, 'gantt_rentals', [
      { id: 'GR-1', rentalId: 'R-1', equipmentId: 'EQ-1', clientId: 'C-1', managerId: 'U-1', status: 'active', startDate: '2026-05-01', endDate: '2026-05-10' },
    ]);
    const result = backfillSqlShadowIndexes(db);
    assert.equal(result.documents.inserted, 1);
    assert.equal(result.documents.skipped, 1);
    assert.equal(result.gantt_rentals.inserted, 1);
    const document = db.prepare(`SELECT * FROM ${DOCUMENTS_TABLE} WHERE id = 'D-1'`).get();
    assert.equal(document.number, 'ACT-1');
    assert.equal(document.date, '2026-05-01');
    assert.equal(document.documentDate, '2026-05-02');
    assert.equal(JSON.parse(document.rawJson).clientId, 'C-1');
    const gantt = db.prepare(`SELECT * FROM ${GANTT_TABLE} WHERE id = 'GR-1'`).get();
    assert.equal(gantt.rentalId, 'R-1');
    assert.equal(JSON.parse(gantt.rawJson).equipmentId, 'EQ-1');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backfill is idempotent on second run and does not create duplicates', () => {
  const { db, dir } = makeDb();
  try {
    setCollection(db, 'documents', [{ id: 'D-1', number: 'N-1', updatedAt: '2026-05-01T00:00:00.000Z' }]);
    setCollection(db, 'gantt_rentals', [{ id: 'GR-1', rentalId: 'R-1', startDate: '2026-05-01', endDate: '2026-05-02' }]);
    backfillSqlShadowIndexes(db);
    const second = backfillSqlShadowIndexes(db);
    assert.equal(second.documents.inserted, 0);
    assert.equal(second.documents.updated, 1);
    assert.equal(second.gantt_rentals.inserted, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${DOCUMENTS_TABLE}`).get().count, 1);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${GANTT_TABLE}`).get().count, 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('diagnostics detects missing SQL rows, duplicate ids, bad dates, and invalid links', () => {
  const { db, dir } = makeDb();
  try {
    setCollection(db, 'documents', [
      { id: 'D-1', updatedAt: '2026-05-01T00:00:00.000Z' },
      { id: 'D-1', updatedAt: 'not-a-date' },
      { id: 'D-2', parentDocumentId: 'D-missing' },
    ]);
    setCollection(db, 'gantt_rentals', [
      { id: 'GR-1', rentalId: 'R-missing', equipmentId: 'EQ-missing', startDate: 'bad-date' },
    ]);
    setCollection(db, 'rentals', []);
    setCollection(db, 'equipment', []);
    ensureSqlShadowSchema(db);
    db.prepare(`INSERT INTO ${DOCUMENTS_TABLE} (id, rawJson) VALUES ('D-1', '{}')`).run();
    const report = diagnoseSqlShadowConsistency(db);
    assert.equal(report.criticalMismatch, true);
    assert.deepEqual(report.documents.missingInSql.sort(), ['D-2']);
    assert.equal(report.documents.duplicateIds[0].id, 'D-1');
    assert.equal(report.documents.invalidDates[0].field, 'updatedAt');
    assert.equal(report.documents.invalidDocumentChains[0].parentDocumentId, 'D-missing');
    assert.equal(report.gantt_rentals.missingInSql[0], 'GR-1');
    assert.equal(report.gantt_rentals.invalidDates[0].field, 'startDate');
    assert.equal(report.gantt_rentals.invalidRentalLinks[0].rentalIds[0], 'R-missing');
    assert.equal(report.gantt_rentals.invalidEquipmentLinks[0].equipmentId, 'EQ-missing');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SQL read helpers support document filters/search and gantt date overlap', () => {
  const { db, dir } = makeDb();
  try {
    setCollection(db, 'documents', [
      { id: 'D-1', number: 'ACT-1', type: 'act', status: 'signed', clientId: 'C-1', rentalId: 'R-1', equipmentId: 'EQ-1', createdAt: '2026-05-01', client: 'Альфа' },
      { id: 'D-2', number: 'INV-2', type: 'invoice', status: 'draft', clientId: 'C-2', rentalId: 'R-2', equipmentId: 'EQ-2', createdAt: '2026-06-01', client: 'Бета' },
    ]);
    setCollection(db, 'gantt_rentals', [
      { id: 'GR-1', rentalId: 'R-1', equipmentId: 'EQ-1', clientId: 'C-1', status: 'active', startDate: '2026-05-01', endDate: '2026-05-10' },
      { id: 'GR-2', rentalId: 'R-2', equipmentId: 'EQ-2', clientId: 'C-2', status: 'closed', startDate: '2026-07-01', endDate: '2026-07-10' },
    ]);
    backfillSqlShadowIndexes(db);
    assert.deepEqual(queryDocumentsIndex(db, { type: 'act', search: 'альфа' }).map(item => item.id), ['D-1']);
    assert.deepEqual(queryDocumentsIndex(db, { clientId: 'C-2', dateFrom: '2026-06-01', dateTo: '2026-06-30' }).map(item => item.id), ['D-2']);
    assert.deepEqual(queryGanttIndex(db, { equipmentId: 'EQ-1', dateFrom: '2026-05-05', dateTo: '2026-05-20' }).map(item => item.id), ['GR-1']);
    assert.deepEqual(queryGanttIndex(db, { rentalId: 'R-2' }).map(item => item.id), ['GR-2']);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gantt SQL read helper supports stable reference filters used by JSON reference path', () => {
  const { db, dir } = makeDb();
  try {
    setCollection(db, 'documents', []);
    setCollection(db, 'gantt_rentals', [
      {
        id: 'GR-stable',
        rentalId: '',
        sourceRentalId: 'R-source',
        originalRentalId: 'R-original',
        equipmentId: 'EQ-1',
        clientId: 'C-1',
        objectId: 'CO-1',
        contractId: 'CC-1',
        managerId: 'U-manager',
        ownerId: 'OWN-1',
        status: 'active',
        startDate: '2026-05-01',
        endDate: '2026-05-10',
      },
      {
        id: 'GR-other',
        rentalId: 'R-other',
        sourceRentalId: 'R-other',
        equipmentId: 'EQ-2',
        clientId: 'C-2',
        objectId: 'CO-2',
        contractId: 'CC-2',
        managerId: 'U-other',
        ownerId: 'OWN-2',
        status: 'closed',
        startDate: '2026-06-01',
        endDate: '2026-06-10',
      },
    ]);
    backfillSqlShadowIndexes(db);
    for (const query of [
      { rentalId: 'R-source' },
      { rentalId: 'R-original' },
      { rentalId: 'GR-stable' },
      { objectId: 'CO-1' },
      { managerId: 'U-manager' },
      { ownerId: 'OWN-1' },
      { clientId: 'C-1', equipmentId: 'EQ-1', contractId: 'CC-1', status: 'active' },
    ]) {
      assert.deepEqual(queryGanttIndex(db, query).map(item => item.id), ['GR-stable'], JSON.stringify(query));
    }
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('documents SQL date range uses JSON business date fallback order', () => {
  const { db, dir } = makeDb();
  try {
    setCollection(db, 'documents', [
      { id: 'D-date', number: 'DATE-1', type: 'act', status: 'signed', clientId: 'C-1', rentalId: 'R-1', equipmentId: 'EQ-1', contractId: 'CON-1', date: '2026-05-01', createdAt: '2026-05-14T19:07:53.327Z' },
      { id: 'D-documentDate', number: 'DATE-2', type: 'act', status: 'signed', clientId: 'C-1', rentalId: 'R-1', equipmentId: 'EQ-1', contractId: 'CON-1', documentDate: '2026-05-01', createdAt: '2026-05-14T19:07:53.327Z' },
      { id: 'D-createdAt', number: 'DATE-3', type: 'invoice', status: 'draft', clientId: 'C-2', rentalId: 'R-2', equipmentId: 'EQ-2', contractId: 'CON-2', createdAt: '2026-05-01T12:00:00.000Z' },
      { id: 'D-updatedAt', number: 'DATE-4', type: 'invoice', status: 'draft', clientId: 'C-2', rentalId: 'R-2', equipmentId: 'EQ-2', contractId: 'CON-2', updatedAt: '2026-05-01T12:00:00.000Z' },
      { id: 'D-outside', number: 'DATE-5', type: 'act', status: 'signed', clientId: 'C-1', rentalId: 'R-1', equipmentId: 'EQ-1', contractId: 'CON-1', date: '2026-05-02', createdAt: '2026-05-01T12:00:00.000Z' },
    ]);
    setCollection(db, 'gantt_rentals', []);
    backfillSqlShadowIndexes(db);
    assert.deepEqual(
      queryDocumentsIndex(db, { dateFrom: '2026-05-01', dateTo: '2026-05-01' }).map(item => item.id).sort(),
      ['D-createdAt', 'D-date', 'D-documentDate', 'D-updatedAt'],
    );
    assert.deepEqual(queryDocumentsIndex(db, { contractId: 'CON-2' }).map(item => item.id).sort(), ['D-createdAt', 'D-updatedAt']);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('documents SQL sync updates business date columns on dual-write', () => {
  const { db, dir } = makeDb();
  try {
    ensureSqlShadowSchema(db);
    syncSqlShadowIndexForCollection(db, 'documents', [
      { id: 'D-1', date: '2026-05-01', documentDate: '2026-05-01', status: 'draft', updatedAt: '2026-05-01T10:00:00.000Z' },
    ]);
    let row = db.prepare(`SELECT date, documentDate, status FROM ${DOCUMENTS_TABLE} WHERE id = 'D-1'`).get();
    assert.deepEqual(row, { date: '2026-05-01', documentDate: '2026-05-01', status: 'draft' });

    syncSqlShadowIndexForCollection(db, 'documents', [
      { id: 'D-1', date: '2026-05-03', documentDate: '2026-05-04', status: 'signed', updatedAt: '2026-05-04T10:00:00.000Z' },
    ]);
    row = db.prepare(`SELECT date, documentDate, status FROM ${DOCUMENTS_TABLE} WHERE id = 'D-1'`).get();
    assert.deepEqual(row, { date: '2026-05-03', documentDate: '2026-05-04', status: 'signed' });
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
