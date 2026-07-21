import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  createActualSourceDryRunContext,
  dryRunCommand,
  seedPositiveSource,
} from './actual-source-eligibility-dry-run-fixtures.js';

const require = createRequire(import.meta.url);
const {
  ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES,
} = require('../server/lib/actual-source-eligibility-dry-run-schema.js');

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function replaceInsert(db, table, replacements, whenSql) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  const names = columns.map(column => `"${column}"`).join(', ');
  const values = columns.map(column => (
    Object.hasOwn(replacements, column) ? replacements[column] : `NEW."${column}"`
  )).join(', ');
  db.exec(`
    CREATE TEMP TRIGGER tamper_${table}
    BEFORE INSERT ON ${table}
    WHEN ${whenSql}
    BEGIN
      INSERT INTO ${table} (${names}) VALUES (${values});
      SELECT RAISE(IGNORE);
    END;
  `);
}

function ignoreInsert(db, table) {
  db.exec(`
    CREATE TEMP TRIGGER omit_${table}
    BEFORE INSERT ON ${table}
    BEGIN
      SELECT RAISE(IGNORE);
    END;
  `);
}

function addExtraCheck(db) {
  const table = 'actual_source_dry_run_checks';
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  const names = columns.map(column => `"${column}"`).join(', ');
  const values = columns.map(column => {
    if (column === 'id') return `'extra-' || NEW.id`;
    if (column === 'gateCode') return `'extra_' || NEW.gateCode`;
    if (column === 'checkHash') return sqlLiteral('e'.repeat(64));
    return `NEW."${column}"`;
  }).join(', ');
  db.exec(`
    CREATE TEMP TRIGGER extra_${table}
    AFTER INSERT ON ${table}
    WHEN NEW.id NOT LIKE 'extra-%'
    BEGIN
      INSERT INTO ${table} (${names}) VALUES (${values});
    END;
  `);
}

function pr8Counts(db) {
  return Object.fromEntries(ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES.map(table => [
    table,
    Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
  ]));
}

function assertSealingRollback({ configure, policyManifest, name }) {
  const context = createActualSourceDryRunContext();
  try {
    seedPositiveSource(context);
    const before = pr8Counts(context.db);
    configure(context.db);
    assert.throws(
      () => context.dryRunService.evaluateActualSourceDryRun(
        context.dryRunContext,
        dryRunCommand({
          idempotencyKey: `sealing-${name}`,
          ...(policyManifest === undefined ? {} : { policyManifest }),
        }),
      ),
      error => error.code === 'ACTUAL_SOURCE_RECONCILIATION_FAILED',
    );
    assert.deepEqual(pr8Counts(context.db), before);
    assert.equal(context.db.inTransaction, false);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM actual_source_dry_run_operations').get().count, 0);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM actual_source_dry_run_audit_events').get().count, 0);
  } finally {
    context.close();
  }
}

test('persisted candidate content and hashes are recomputed before sealing', async t => {
  const candidateTable = 'actual_source_dry_run_candidates';
  const scenarios = [
    {
      name: 'candidate-key',
      configure(db) {
        replaceInsert(
          db,
          candidateTable,
          { candidateKey: sqlLiteral('f'.repeat(64)) },
          `NEW.candidateKey != ${sqlLiteral('f'.repeat(64))}`,
        );
      },
    },
    {
      name: 'candidate-result-hash',
      configure(db) {
        replaceInsert(
          db,
          candidateTable,
          { resultHash: sqlLiteral('a'.repeat(64)) },
          `NEW.resultHash != ${sqlLiteral('a'.repeat(64))}`,
        );
      },
    },
    {
      name: 'candidate-status-and-blockers',
      configure(db) {
        replaceInsert(
          db,
          candidateTable,
          { status: `'blocked'`, blockerCodesJson: sqlLiteral('["TAMPERED_BLOCKER"]') },
          `NEW.status != 'blocked'`,
        );
      },
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, () => assertSealingRollback(scenario));
  }
});

test('persisted check/reconciliation/diagnostic content and hashes are recomputed', async t => {
  const scenarios = [
    {
      name: 'check-hash',
      configure(db) {
        replaceInsert(
          db,
          'actual_source_dry_run_checks',
          { checkHash: sqlLiteral('a'.repeat(64)) },
          `NEW.checkHash != ${sqlLiteral('a'.repeat(64))}`,
        );
      },
    },
    {
      name: 'check-content',
      configure(db) {
        replaceInsert(
          db,
          'actual_source_dry_run_checks',
          { gateCode: `'tampered_' || NEW.gateCode` },
          `NEW.gateCode NOT LIKE 'tampered_%'`,
        );
      },
    },
    {
      name: 'reconciliation-hash',
      configure(db) {
        replaceInsert(
          db,
          'actual_source_dry_run_reconciliations',
          { reconciliationHash: sqlLiteral('a'.repeat(64)) },
          `NEW.reconciliationHash != ${sqlLiteral('a'.repeat(64))}`,
        );
      },
    },
    {
      name: 'reconciliation-dimension',
      configure(db) {
        replaceInsert(
          db,
          'actual_source_dry_run_reconciliations',
          { dimensionKind: `'coverage_set_delta'` },
          `NEW.dimensionKind = 'snapshot_equation'`,
        );
      },
    },
    {
      name: 'diagnostic-hash',
      policyManifest: null,
      configure(db) {
        replaceInsert(
          db,
          'actual_source_dry_run_diagnostics',
          { diagnosticHash: sqlLiteral('a'.repeat(64)) },
          `NEW.code = 'ACCOUNTING_SOURCE_SUFFICIENCY_UNRESOLVED'`,
        );
      },
    },
    {
      name: 'diagnostic-code',
      policyManifest: null,
      configure(db) {
        replaceInsert(
          db,
          'actual_source_dry_run_diagnostics',
          { code: `'TAMPERED_' || NEW.code` },
          `NEW.code NOT LIKE 'TAMPERED_%'`,
        );
      },
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, () => assertSealingRollback(scenario));
  }
});

test('missing and extra child rows roll back without operation or audit', async t => {
  const scenarios = [
    {
      name: 'missing-child',
      configure(db) {
        ignoreInsert(db, 'actual_source_dry_run_checks');
      },
    },
    {
      name: 'extra-child',
      configure(db) {
        addExtraCheck(db);
      },
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, () => assertSealingRollback(scenario));
  }
});
