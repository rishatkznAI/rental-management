import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  CANONICAL_BRANCHES_TABLE,
  CANONICAL_COMPANIES_TABLE,
  ensureCanonicalReceivablesSchema,
} = require('../server/lib/canonical-receivables-schema.js');
const {
  ensureCanonicalReceivablesSettlementSchema,
} = require('../server/lib/canonical-receivables-settlement-schema.js');
const {
  CAPABILITY_CATALOG_V1,
  FINANCIAL_TABLES,
  PLATFORM_IDENTITY_MIGRATION_ID,
  PLATFORM_IDENTITY_TABLES,
  assertPlatformIdentityStructure,
  ensurePlatformIdentitySchema,
} = require('../server/lib/platform-identity-schema.js');

function baseDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE app_data (
      name TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO app_data (name, json) VALUES
      ('legacy_probe', '[{"id":"legacy-1","name":"unchanged"}]');
  `);
  ensureCanonicalReceivablesSchema(db);
  ensureCanonicalReceivablesSettlementSchema(db);
  return db;
}

function migrationRow(db) {
  return db.prepare(`
    SELECT name, version, applied_at
    FROM sql_shadow_schema_migrations
    WHERE name = ?
  `).get(PLATFORM_IDENTITY_MIGRATION_ID);
}

test('PR5 upgrades exact PR1/PR2 roots in place and preserves legacy data and child FK targets', () => {
  const db = baseDb();
  try {
    const legacyBefore = db.prepare('SELECT * FROM app_data').all();
    const foreignKeysBefore = Object.fromEntries([
      'canonical_receivables',
      'financial_audit_events',
      'canonical_payments',
      'canonical_payment_allocations',
      'canonical_receivable_adjustments',
      'canonical_approval_requests',
    ].map(table => [
      table,
      db.prepare(`PRAGMA foreign_key_list(${table})`).all().map(row => row.table).sort(),
    ]));
    const childSqlBefore = Object.fromEntries(Object.keys(foreignKeysBefore).map(table => [
      table,
      db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).sql,
    ]));

    assert.equal(ensurePlatformIdentitySchema(db), true);
    assert.equal(assertPlatformIdentityStructure(db), true);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.deepEqual(db.prepare('SELECT * FROM app_data').all(), legacyBefore);

    const physicalTables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
    `).all().map(row => row.name);
    assert.equal(physicalTables.includes(CANONICAL_COMPANIES_TABLE), true);
    assert.equal(physicalTables.includes(CANONICAL_BRANCHES_TABLE), true);
    assert.equal(physicalTables.includes('companies'), false);
    assert.equal(physicalTables.includes('branches'), false);
    PLATFORM_IDENTITY_TABLES.forEach(table => assert.equal(physicalTables.includes(table), true));

    const companyColumns = db.prepare(`PRAGMA table_info(${CANONICAL_COMPANIES_TABLE})`).all()
      .map(row => row.name);
    const branchColumns = db.prepare(`PRAGMA table_info(${CANONICAL_BRANCHES_TABLE})`).all()
      .map(row => row.name);
    assert.deepEqual(companyColumns, [
      'id', 'receivablesTimezone', 'createdAt', 'displayName', 'status', 'version', 'updatedAt',
    ]);
    assert.deepEqual(branchColumns, [
      'companyId', 'id', 'isHeadOffice', 'createdAt', 'displayName', 'status', 'version', 'updatedAt',
    ]);

    const foreignKeysAfter = Object.fromEntries(Object.keys(foreignKeysBefore).map(table => [
      table,
      db.prepare(`PRAGMA foreign_key_list(${table})`).all().map(row => row.table).sort(),
    ]));
    assert.deepEqual(foreignKeysAfter, foreignKeysBefore);
    const childSqlAfter = Object.fromEntries(Object.keys(foreignKeysBefore).map(table => [
      table,
      db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).sql,
    ]));
    assert.deepEqual(childSqlAfter, childSqlBefore);
    for (const table of FINANCIAL_TABLES) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM canonical_companies').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM canonical_branches').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM company_memberships').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM membership_branch_access').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM role_templates').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM authorization_audit_events').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM identity_bootstrap_runs').get().count, 0);
    assert.deepEqual(
      db.prepare(`
        SELECT capabilityKey
        FROM capability_catalog_entries
        WHERE catalogVersion = 1
        ORDER BY capabilityKey
      `).all().map(row => row.capabilityKey),
      CAPABILITY_CATALOG_V1.map(item => item.key),
    );
  } finally {
    db.close();
  }
});

test('PR5 migration rerun is idempotent and preserves the registry timestamp', () => {
  const db = baseDb();
  try {
    assert.equal(ensurePlatformIdentitySchema(db), true);
    const first = migrationRow(db);
    assert.equal(ensurePlatformIdentitySchema(db), false);
    assert.deepEqual(migrationRow(db), first);
  } finally {
    db.close();
  }
});

test('PR5 migration enables SQLite foreign-key enforcement before validation', () => {
  const db = baseDb();
  try {
    db.pragma('foreign_keys = OFF');
    assert.equal(db.pragma('foreign_keys', { simple: true }), 0);
    assert.equal(ensurePlatformIdentitySchema(db), true);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});

test('applied registry with incomplete schema fails explicitly', () => {
  const db = baseDb();
  try {
    ensurePlatformIdentitySchema(db);
    db.exec('DROP INDEX uq_membership_capability_active');
    assert.throws(
      () => ensurePlatformIdentitySchema(db),
      /PLATFORM_IDENTITY_SCHEMA_INCOMPLETE/,
    );
  } finally {
    db.close();
  }
});

test('unexpected partial PR5 state is rejected before migration', () => {
  const db = baseDb();
  try {
    db.exec('ALTER TABLE canonical_companies ADD COLUMN displayName TEXT');
    assert.throws(
      () => ensurePlatformIdentitySchema(db),
      /PLATFORM_IDENTITY_UNEXPECTED_PARTIAL_STATE/,
    );
    assert.equal(migrationRow(db), undefined);
  } finally {
    db.close();
  }
});

test('unexpected financial rows block PR5 migration', () => {
  const db = baseDb();
  try {
    db.exec(`
      INSERT INTO canonical_companies (id, receivablesTimezone)
      VALUES ('company-existing', 'Europe/Moscow');
      INSERT INTO canonical_branches (companyId, id, isHeadOffice)
      VALUES ('company-existing', 'branch-existing', 1);
      INSERT INTO canonical_receivables (
        id, companyId, branchId, clientId, sourceDocumentType, sourceDocumentId,
        sourceSystem, idempotencyKey, currency, originalAmountMinor,
        dueDateProvenance, companyTimezone, workflowStatus, createdAt, updatedAt
      ) VALUES (
        'receivable-existing', 'company-existing', 'branch-existing', 'client-existing',
        'invoice', 'invoice-existing', 'test', 'idem-existing', 'RUB', 1,
        'unknown', 'Europe/Moscow', 'draft',
        '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z'
      );
    `);
    assert.throws(
      () => ensurePlatformIdentitySchema(db),
      /PLATFORM_IDENTITY_FINANCIAL_ROWS_PRESENT:canonical_receivables:1/,
    );
    assert.equal(migrationRow(db), undefined);
  } finally {
    db.close();
  }
});

test('forced migration failure rolls back additive root upgrades and all PR5 objects', () => {
  const db = baseDb();
  try {
    assert.throws(
      () => ensurePlatformIdentitySchema(db, {
        afterRootUpgrade() {
          throw new Error('forced-ddl-failure');
        },
      }),
      /forced-ddl-failure/,
    );
    assert.equal(
      db.prepare('PRAGMA table_info(canonical_companies)').all()
        .some(column => column.name === 'displayName'),
      false,
    );
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'company_memberships'").get(),
      undefined,
    );
    assert.equal(migrationRow(db), undefined);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});
