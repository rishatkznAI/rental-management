import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const { ensureCanonicalReceivablesSchema } = require('../server/lib/canonical-receivables-schema.js');
const { ensureCanonicalReceivablesSettlementSchema } = require('../server/lib/canonical-receivables-settlement-schema.js');
const {
  CAPABILITY_CATALOG_V1,
  FINANCIAL_TABLES,
  ROLE_TEMPLATES_TABLE,
  COMPANY_MEMBERSHIPS_TABLE,
  MEMBERSHIP_BRANCH_ACCESS_TABLE,
  MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE,
  IDENTITY_BOOTSTRAP_RUNS_TABLE,
  ensurePlatformIdentitySchema,
} = require('../server/lib/platform-identity-schema.js');
const {
  BILLING_SOURCE_AUTHORITY_TABLES,
  ensureBillingSourceAuthoritySchema,
} = require('../server/lib/billing-source-authority-schema.js');
const {
  FORECAST_RECEIVABLES_PLANNING_TABLES,
  ensureForecastReceivablesPlanningSchema,
} = require('../server/lib/forecast-receivables-planning-schema.js');
const {
  ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_MIGRATION_ID,
  ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_SCHEMA_VERSION,
  ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES,
  REQUIRED_INDEXES,
  REQUIRED_TRIGGERS,
  assertActualSourceEligibilityDryRunStructure,
  ensureActualSourceEligibilityDryRunSchema,
} = require('../server/lib/actual-source-eligibility-dry-run-schema.js');

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE app_data (
      name TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  ensureCanonicalReceivablesSchema(db);
  ensureCanonicalReceivablesSettlementSchema(db);
  ensurePlatformIdentitySchema(db);
  ensureBillingSourceAuthoritySchema(db);
  ensureForecastReceivablesPlanningSchema(db);
  return db;
}

test('PR8 migration creates exactly eight empty append-only diagnostic tables after PR7', () => {
  const db = freshDb();
  try {
    assert.equal(ensureActualSourceEligibilityDryRunSchema(db), true);
    assertActualSourceEligibilityDryRunStructure(db);
    const migration = db.prepare(`
      SELECT name, version, applied_at FROM sql_shadow_schema_migrations WHERE name = ?
    `).get(ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_MIGRATION_ID);
    assert.equal(migration.name, ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_MIGRATION_ID);
    assert.equal(migration.version, ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_SCHEMA_VERSION);
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'actual_source_dry_run%'
      ORDER BY name
    `).all().map(row => row.name);
    assert.deepEqual(tables, [...ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES].sort());
    for (const table of ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
    }
    for (const name of REQUIRED_INDEXES) {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(name));
    }
    for (const name of REQUIRED_TRIGGERS) {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name));
    }
  } finally {
    db.close();
  }
});

test('PR8 startup is idempotent and preserves the original migration timestamp', () => {
  const db = freshDb();
  try {
    assert.equal(ensureActualSourceEligibilityDryRunSchema(db), true);
    const before = db.prepare('SELECT applied_at FROM sql_shadow_schema_migrations WHERE name = ?')
      .get(ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_MIGRATION_ID).applied_at;
    assert.equal(ensureActualSourceEligibilityDryRunSchema(db), false);
    const after = db.prepare('SELECT applied_at FROM sql_shadow_schema_migrations WHERE name = ?')
      .get(ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_MIGRATION_ID).applied_at;
    assert.equal(after, before);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sql_shadow_schema_migrations WHERE name = ?')
      .get(ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_MIGRATION_ID).count, 1);
  } finally {
    db.close();
  }
});

test('fresh PR8 migration conserves PR1/PR2/PR5/PR6/PR7 state and catalog 1/11', () => {
  const db = freshDb();
  try {
    ensureActualSourceEligibilityDryRunSchema(db);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('foreign_key_check').length, 0);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    for (const table of [...FINANCIAL_TABLES, ...BILLING_SOURCE_AUTHORITY_TABLES, ...FORECAST_RECEIVABLES_PLANNING_TABLES]) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM capability_catalog_versions').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM capability_catalog_entries WHERE catalogVersion = 1').get().count, CAPABILITY_CATALOG_V1.length);
    assert.equal(CAPABILITY_CATALOG_V1.length, 11);
    for (const table of [
      'canonical_companies',
      'canonical_branches',
      ROLE_TEMPLATES_TABLE,
      COMPANY_MEMBERSHIPS_TABLE,
      MEMBERSHIP_BRANCH_ACCESS_TABLE,
      MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE,
      IDENTITY_BOOTSTRAP_RUNS_TABLE,
    ]) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
    }
  } finally {
    db.close();
  }
});

test('unregistered partial and registered-incomplete PR8 states fail closed', () => {
  const partial = freshDb();
  try {
    partial.exec('CREATE TABLE actual_source_dry_runs (id TEXT PRIMARY KEY)');
    assert.throws(
      () => ensureActualSourceEligibilityDryRunSchema(partial),
      /ACTUAL_SOURCE_PR8_UNEXPECTED_PARTIAL_STATE/,
    );
  } finally {
    partial.close();
  }

  const incomplete = freshDb();
  try {
    ensureActualSourceEligibilityDryRunSchema(incomplete);
    incomplete.exec('DROP TRIGGER trg_actual_source_dry_run_inputs_no_update');
    assert.throws(
      () => ensureActualSourceEligibilityDryRunSchema(incomplete),
      /ACTUAL_SOURCE_PR8_SCHEMA_INCOMPLETE/,
    );
  } finally {
    incomplete.close();
  }
});

test('PR8 migration requires the exact PR7 prerequisite and rolls back DDL on a registry failure', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE app_data (name TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  try {
    ensureCanonicalReceivablesSchema(db);
    ensureCanonicalReceivablesSettlementSchema(db);
    ensurePlatformIdentitySchema(db);
    ensureBillingSourceAuthoritySchema(db);
    assert.throws(
      () => ensureActualSourceEligibilityDryRunSchema(db),
      /ACTUAL_SOURCE_PR8_PREREQUISITE_REQUIRED:forecast_receivables_planning_pr7:v1/,
    );
    for (const table of ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES) {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).count, 0);
    }
  } finally {
    db.close();
  }
});
