import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  createPr9aContext,
  createPr9aSchemaDb,
} from './canonical-actual-posting-fixtures.js';

const require = createRequire(import.meta.url);
const {
  ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE,
  CANONICAL_ACTUAL_POSTING_MIGRATION_ID,
  CANONICAL_ACTUAL_POSTING_SCHEMA_VERSION,
  CANONICAL_ACTUAL_POSTING_TABLES,
  CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE,
  CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE,
  GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE,
  REQUIRED_COLUMNS,
  REQUIRED_INDEXES,
  REQUIRED_TRIGGERS,
  assertCanonicalActualPostingStructure,
  ensureCanonicalActualPostingSchema,
} = require('../server/lib/canonical-actual-posting-schema.js');

test('PR9a migration installs exactly seven registered disabled-foundation tables', () => {
  const db = createPr9aSchemaDb();
  try {
    assert.equal(CANONICAL_ACTUAL_POSTING_TABLES.length, 7);
    const names = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (${CANONICAL_ACTUAL_POSTING_TABLES.map(() => '?').join(',')})
      ORDER BY name
    `).all(...CANONICAL_ACTUAL_POSTING_TABLES).map(row => row.name);
    assert.deepEqual(names, [...CANONICAL_ACTUAL_POSTING_TABLES].sort());
    for (const table of CANONICAL_ACTUAL_POSTING_TABLES) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
      assert.deepEqual(
        db.pragma(`table_info(${table})`).map(column => column.name),
        REQUIRED_COLUMNS[table],
        table,
      );
    }
    const migration = db.prepare('SELECT * FROM sql_shadow_schema_migrations WHERE name = ?')
      .get(CANONICAL_ACTUAL_POSTING_MIGRATION_ID);
    assert.equal(migration.version, CANONICAL_ACTUAL_POSTING_SCHEMA_VERSION);
    assertCanonicalActualPostingStructure(db);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});

test('PR9a schema initialization is deterministic, idempotent, and fail-closed on drift', () => {
  const db = createPr9aSchemaDb();
  try {
    const before = db.prepare('SELECT applied_at FROM sql_shadow_schema_migrations WHERE name = ?')
      .get(CANONICAL_ACTUAL_POSTING_MIGRATION_ID).applied_at;
    assert.equal(ensureCanonicalActualPostingSchema(db), false);
    assert.equal(
      db.prepare('SELECT applied_at FROM sql_shadow_schema_migrations WHERE name = ?')
        .get(CANONICAL_ACTUAL_POSTING_MIGRATION_ID).applied_at,
      before,
    );
    db.exec(`DROP TRIGGER ${REQUIRED_TRIGGERS[0]}`);
    assert.throws(() => ensureCanonicalActualPostingSchema(db), /CANONICAL_PR9_TRIGGER_STRUCTURE_MISMATCH/);
  } finally {
    db.close();
  }
});

test('PR9a exposes every exact index and trigger and reciprocal FKs are deferred and ordered', () => {
  const db = createPr9aSchemaDb();
  try {
    for (const name of REQUIRED_INDEXES) {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(name), name);
    }
    for (const name of REQUIRED_TRIGGERS) {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name), name);
    }
    const conflictSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE).sql;
    const transitionSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE).sql;
    const compactConflictSql = conflictSql.replace(/\s+/g, '');
    const compactTransitionSql = transitionSql.replace(/\s+/g, '');
    assert.match(compactConflictSql, /FOREIGNKEY\(transitionId,id,companyId,branchId,denialAttemptId,conflictHash\)/i);
    assert.match(compactTransitionSql, /FOREIGNKEY\(conflictId,companyId,branchId,denialAttemptId,conflictHash\)/i);
    assert.match(conflictSql, /DEFERRABLE INITIALLY DEFERRED/i);
    assert.match(transitionSql, /DEFERRABLE INITIALLY DEFERRED/i);
    assert.match(conflictSql, /ON UPDATE RESTRICT ON DELETE RESTRICT/i);
    assert.match(transitionSql, /ON UPDATE RESTRICT ON DELETE RESTRICT/i);
  } finally {
    db.close();
  }
});

test('append-only authority and event records reject update, delete, and replacement', () => {
  const context = createPr9aContext();
  try {
    const { db } = context;
    assert.throws(
      () => db.prepare(`UPDATE ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} SET ownerRef = ownerRef || '-x' WHERE recordId = ?`)
        .run(context.authority.source.recordId),
      /is immutable/,
    );
    assert.throws(
      () => db.prepare(`DELETE FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} WHERE recordId = ?`)
        .run(context.authority.source.recordId),
      /append-only/,
    );
    assert.throws(
      () => db.prepare(`INSERT OR REPLACE INTO ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} SELECT * FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} WHERE recordId = ?`)
        .run(context.authority.source.recordId),
      /append-only|CANONICAL_AUTHORITY_VERSION_CHAIN_INVALID/,
    );
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}`).get().count, 0);
  } finally {
    context.db.close();
  }
});

test('reciprocal conflict/transition contract rejects orphan, shared, crossed, and swapped pairs structurally', () => {
  const db = createPr9aSchemaDb();
  try {
    const conflictFks = db.pragma(`foreign_key_list(${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE})`);
    const transitionFks = db.pragma(`foreign_key_list(${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE})`);
    const conflictReciprocal = conflictFks.filter(row => row.table === CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE);
    const transitionReciprocal = transitionFks.filter(row => row.table === CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE);
    assert.deepEqual(conflictReciprocal.map(row => row.from), [
      'transitionId', 'id', 'companyId', 'branchId', 'denialAttemptId', 'conflictHash',
    ]);
    assert.deepEqual(transitionReciprocal.map(row => row.from), [
      'conflictId', 'companyId', 'branchId', 'denialAttemptId', 'conflictHash',
    ]);
    const conflictUnique = REQUIRED_INDEXES.filter(name => name.includes('conflict_transition_parent'));
    assert.equal(conflictUnique.length, 1);
    assert.ok(REQUIRED_INDEXES.some(name => name.includes('posting_conflict_transition_parent')));
    assert.ok(REQUIRED_INDEXES.some(name => name.includes('conflict_transition_reciprocal_parent')));
  } finally {
    db.close();
  }
});
