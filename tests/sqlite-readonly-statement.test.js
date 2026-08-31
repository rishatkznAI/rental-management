import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  SQLITE_READONLY_STATEMENT_REQUIRED,
  assertSqliteReadonlyStatement,
  prepareSqliteReadonlyStatement,
} = require('../server/lib/sqlite-readonly-statement');

test('SQLite read guard accepts immutable statements and rejects reader-shaped DML before execution', () => {
  const db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE probe (value TEXT NOT NULL); INSERT INTO probe (value) VALUES ('before')");
    const select = db.prepare('SELECT value FROM probe');
    assert.equal(select.readonly, true);
    assert.equal(assertSqliteReadonlyStatement(select, 'test_select'), select);
    assert.equal(select.get().value, 'before');

    const returningWrite = db.prepare("UPDATE probe SET value = 'mutated' RETURNING value");
    assert.equal(returningWrite.reader, true);
    assert.equal(returningWrite.readonly, false);
    assert.throws(
      () => assertSqliteReadonlyStatement(returningWrite, 'test_returning_write'),
      error => (
        error.code === SQLITE_READONLY_STATEMENT_REQUIRED
        && error.context === 'test_returning_write'
      ),
    );
    assert.equal(db.prepare('SELECT value FROM probe').get().value, 'before');
  } finally {
    db.close();
  }
});

test('SQLite read guard rejects mutating PRAGMA statements exposed through read methods', () => {
  const db = new Database(':memory:');
  try {
    const readPragma = db.prepare('PRAGMA table_info(sqlite_schema)');
    assert.equal(readPragma.readonly, true);
    assert.equal(assertSqliteReadonlyStatement(readPragma), readPragma);

    const writePragma = db.prepare('PRAGMA user_version=7');
    assert.equal(writePragma.readonly, false);
    assert.throws(
      () => assertSqliteReadonlyStatement(writePragma, 'test_write_pragma'),
      error => error.code === SQLITE_READONLY_STATEMENT_REQUIRED,
    );
    assert.equal(db.pragma('user_version', { simple: true }), 0);
  } finally {
    db.close();
  }
});

test('SQLite guarded prepare rejects DML RETURNING before exposing a statement', () => {
  const db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE probe (value TEXT NOT NULL); INSERT INTO probe (value) VALUES ('before')");
    const read = prepareSqliteReadonlyStatement(db, 'SELECT value FROM probe', 'guarded_select');
    assert.equal(read.get().value, 'before');
    assert.throws(
      () => prepareSqliteReadonlyStatement(
        db,
        "DELETE FROM probe RETURNING value",
        'guarded_delete',
      ),
      error => error.code === SQLITE_READONLY_STATEMENT_REQUIRED,
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM probe').get().count, 1);
  } finally {
    db.close();
  }
});
