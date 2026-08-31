'use strict';

const SQLITE_READONLY_STATEMENT_REQUIRED = 'SQLITE_READONLY_STATEMENT_REQUIRED';

function assertSqliteReadonlyStatement(statement, context = 'sqlite_read') {
  if (statement?.readonly === true) return statement;
  const error = new Error('SQLite read path rejected a statement that may mutate persistent state.');
  error.code = SQLITE_READONLY_STATEMENT_REQUIRED;
  error.context = String(context || 'sqlite_read');
  throw error;
}

function prepareSqliteReadonlyStatement(db, sql, context = 'sqlite_read') {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('SQLite read path requires a database with prepare().');
  }
  return assertSqliteReadonlyStatement(db.prepare(sql), context);
}

module.exports = {
  SQLITE_READONLY_STATEMENT_REQUIRED,
  assertSqliteReadonlyStatement,
  prepareSqliteReadonlyStatement,
};
