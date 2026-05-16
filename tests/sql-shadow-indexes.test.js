import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  DOCUMENTS_TABLE,
  GANTT_TABLE,
  backfillSqlShadowIndexes,
  diagnoseSqlShadowConsistency,
  ensureSqlShadowSchema,
  queryDocumentsIndex,
  queryGanttIndex,
  syncSqlShadowIndexForCollection,
} = require('../server/lib/sql-shadow-indexes.js');

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

test('SQL shadow schema creates documents and gantt tables idempotently', () => {
  const { db, dir } = makeDb();
  try {
    ensureSqlShadowSchema(db);
    ensureSqlShadowSchema(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
    assert.ok(tables.includes(DOCUMENTS_TABLE));
    assert.ok(tables.includes(GANTT_TABLE));
    const migration = db.prepare("SELECT version FROM sql_shadow_schema_migrations WHERE name = 'documents_gantt_shadow_indexes'").get();
    assert.equal(migration.version, 2);
    const documentColumns = db.prepare(`PRAGMA table_info(${DOCUMENTS_TABLE})`).all().map(row => row.name);
    assert.ok(documentColumns.includes('date'));
    assert.ok(documentColumns.includes('documentDate'));
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
