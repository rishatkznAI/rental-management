import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
  createForecastTestContext,
  forecastCommand,
} from './forecast-receivables-planning-fixtures.js';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const { ensureCanonicalReceivablesSchema } = require('../server/lib/canonical-receivables-schema.js');
const {
  ensureCanonicalReceivablesSettlementSchema,
} = require('../server/lib/canonical-receivables-settlement-schema.js');
const {
  ensurePlatformIdentitySchema,
} = require('../server/lib/platform-identity-schema.js');
const {
  BILLING_SOURCE_AUTHORITY_TABLES,
  ensureBillingSourceAuthoritySchema,
} = require('../server/lib/billing-source-authority-schema.js');
const {
  FORECAST_RECEIVABLES_PLANNING_MIGRATION_ID,
  FORECAST_RECEIVABLES_PLANNING_SCHEMA_VERSION,
  FORECAST_RECEIVABLES_PLANNING_TABLES,
  REQUIRED_COLUMNS,
  REQUIRED_INDEXES,
  REQUIRED_TRIGGERS,
  assertForecastReceivablesPlanningStructure,
  ensureForecastReceivablesPlanningSchema,
} = require('../server/lib/forecast-receivables-planning-schema.js');

function prerequisites({ includeBillingSource = true } = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  ensureCanonicalReceivablesSchema(db);
  ensureCanonicalReceivablesSettlementSchema(db);
  ensurePlatformIdentitySchema(db);
  if (includeBillingSource) ensureBillingSourceAuthoritySchema(db);
  return db;
}

test('PR7 migration requires the exact released PR6 prerequisite', () => {
  const db = prerequisites({ includeBillingSource: false });
  assert.throws(
    () => ensureForecastReceivablesPlanningSchema(db),
    /FORECAST_PR7_PREREQUISITE_REQUIRED:billing_source_authority_pr6:v1/,
  );
  db.close();
});

test('PR7 migration is additive, registered last, empty, and structurally complete', () => {
  const db = prerequisites();
  assert.equal(ensureForecastReceivablesPlanningSchema(db), true);
  const migration = db.prepare(`
    SELECT rowid, name, version, applied_at FROM sql_shadow_schema_migrations
    WHERE name = ?
  `).get(FORECAST_RECEIVABLES_PLANNING_MIGRATION_ID);
  const last = db.prepare('SELECT name FROM sql_shadow_schema_migrations ORDER BY rowid DESC LIMIT 1').get();
  assert.equal(migration.version, FORECAST_RECEIVABLES_PLANNING_SCHEMA_VERSION);
  assert.equal(last.name, FORECAST_RECEIVABLES_PLANNING_MIGRATION_ID);
  for (const table of FORECAST_RECEIVABLES_PLANNING_TABLES) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
  }
  assert.equal(assertForecastReceivablesPlanningStructure(db), true);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.deepEqual(db.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
  db.close();
});

test('PR7 migration rerun is a no-op and preserves registration time', () => {
  const db = prerequisites();
  ensureForecastReceivablesPlanningSchema(db);
  const before = db.prepare(`
    SELECT applied_at FROM sql_shadow_schema_migrations WHERE name = ?
  `).get(FORECAST_RECEIVABLES_PLANNING_MIGRATION_ID);
  assert.equal(ensureForecastReceivablesPlanningSchema(db), false);
  const after = db.prepare(`
    SELECT applied_at FROM sql_shadow_schema_migrations WHERE name = ?
  `).get(FORECAST_RECEIVABLES_PLANNING_MIGRATION_ID);
  assert.deepEqual(after, before);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM sql_shadow_schema_migrations WHERE name = ?
  `).get(FORECAST_RECEIVABLES_PLANNING_MIGRATION_ID).count, 1);
  db.close();
});

test('unregistered partial PR7 schema fails closed', () => {
  const db = prerequisites();
  db.exec('CREATE TABLE forecast_receivable_runs (id TEXT PRIMARY KEY)');
  assert.throws(
    () => ensureForecastReceivablesPlanningSchema(db),
    /FORECAST_PR7_UNEXPECTED_PARTIAL_STATE/,
  );
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM sql_shadow_schema_migrations WHERE name = ?
  `).get(FORECAST_RECEIVABLES_PLANNING_MIGRATION_ID).count, 0);
  db.close();
});

test('failed PR7 DDL rolls back every partial object and registration', () => {
  const db = prerequisites();
  const originalExec = db.exec.bind(db);
  db.exec = sql => {
    if (sql.includes('CREATE TABLE forecast_receivable_runs')) {
      originalExec('CREATE TABLE forecast_receivable_runs (id TEXT PRIMARY KEY)');
      throw new Error('injected forecast DDL failure');
    }
    return originalExec(sql);
  };
  assert.throws(() => ensureForecastReceivablesPlanningSchema(db), /injected forecast DDL failure/);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_master
    WHERE name LIKE 'forecast_receivable_%' OR name LIKE 'trg_forecast_%'
  `).get().count, 0);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM sql_shadow_schema_migrations WHERE name = ?
  `).get(FORECAST_RECEIVABLES_PLANNING_MIGRATION_ID).count, 0);
  db.close();
});

test('all required PR7 columns, indexes, and triggers are present', () => {
  const db = prerequisites();
  ensureForecastReceivablesPlanningSchema(db);
  for (const [table, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    requiredColumns.forEach(column => assert.equal(columns.has(column), true, `${table}.${column}`));
  }
  const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
  REQUIRED_INDEXES.forEach(index => assert.equal(indexes.has(index), true, index));
  const triggers = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map(row => row.name));
  REQUIRED_TRIGGERS.forEach(trigger => assert.equal(triggers.has(trigger), true, trigger));
  db.close();
});

test('PR7 migration seeds no PR6 source or canonical financial rows', () => {
  const db = prerequisites();
  ensureForecastReceivablesPlanningSchema(db);
  for (const table of BILLING_SOURCE_AUTHORITY_TABLES) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
  }
  for (const table of [
    'canonical_receivables',
    'canonical_payments',
    'canonical_payment_allocations',
    'canonical_receivable_adjustments',
  ]) assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
  db.close();
});

test('every populated PR7 table rejects direct update and delete', () => {
  const context = createForecastTestContext();
  const first = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context),
  );
  const second = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context, {
      asOfDate: '2026-08-15',
      candidateStartDate: '2026-08-15',
      candidateEndDateExclusive: '2026-09-14',
      idempotencyKey: 'forecast-partial-closed-overlap',
      expectedActiveRunIds: [first.forecastRunId],
    }),
  );
  assert.equal(second.status, 'insufficient');
  for (const table of FORECAST_RECEIVABLES_PLANNING_TABLES) {
    const row = context.db.prepare(`SELECT id FROM ${table} LIMIT 1`).get();
    assert.ok(row, `${table} fixture row`);
    assert.throws(() => context.db.prepare(`UPDATE ${table} SET id = id WHERE id = ?`).run(row.id), /immutable/);
    assert.throws(() => context.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.id), /append-only/);
  }
  context.close();
});

test('operation and audit replacement is rejected without altering history', () => {
  const context = createForecastTestContext();
  context.forecastService.calculateForecastRun(context.forecastCommandContext, forecastCommand(context));
  for (const table of ['forecast_receivable_operations', 'forecast_receivable_audit_events']) {
    const count = context.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    assert.throws(
      () => context.db.prepare(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table} LIMIT 1`).run(),
      /append-only|immutable/,
    );
    assert.equal(context.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, count);
  }
  context.close();
});

test('a finalized run rejects late child rows and lifecycle edges through direct SQL', () => {
  const context = createForecastTestContext();
  const first = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context),
  );
  const second = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context, {
      idempotencyKey: 'forecast-direct-sql-seal-2',
      expectedActiveRunIds: [first.forecastRunId],
    }),
  );

  const event = context.db.prepare(`
    SELECT * FROM forecast_receivable_input_events WHERE forecastRunId = ? LIMIT 1
  `).get(second.forecastRunId);
  assert.throws(
    () => context.db.prepare(`
      INSERT INTO forecast_receivable_input_events
      SELECT ?, forecastRunId, inputSnapshotId, companyId, branchId, rentalLineId,
             eventKind, sourceSystem, sourceId, sourceVersion, ?, sourceEventVersion,
             effectiveStartDate, effectiveEndDateExclusive, authorityStatus,
             authorityPolicyRef, evidenceHash, schemaVersion, createdAt
      FROM forecast_receivable_input_events WHERE id = ?
    `).run('forecast-event-late', 'forecast-event-late', event.id),
    /scope mismatch/,
  );

  const predecessor = context.db.prepare(`
    SELECT * FROM forecast_receivable_run_supersessions LIMIT 1
  `).get();
  const firstRun = context.db.prepare('SELECT * FROM forecast_receivable_runs WHERE id = ?').get(first.forecastRunId);
  assert.throws(
    () => context.db.prepare(`
      INSERT INTO forecast_receivable_run_supersessions (
        id, companyId, branchId, planningSeriesKey, predecessorRunId, successorRunId,
        operationId, reasonCode, reasonText, schemaVersion, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      'forecast-supersession-late',
      predecessor.companyId,
      predecessor.branchId,
      predecessor.planningSeriesKey,
      second.forecastRunId,
      first.forecastRunId,
      firstRun.operationId,
      'FORECAST_DIRECT_SQL_LATE_EDGE',
      'A finalized operation cannot receive another lifecycle edge.',
      predecessor.createdAt,
    ),
    /supersession invalid/,
  );

  assert.equal(context.db.prepare(`
    SELECT COUNT(*) AS count FROM forecast_receivable_input_events
  `).get().count, 4);
  assert.equal(context.db.prepare(`
    SELECT COUNT(*) AS count FROM forecast_receivable_run_supersessions
  `).get().count, 1);
  assert.deepEqual(context.db.pragma('foreign_key_check'), []);
  context.close();
});
