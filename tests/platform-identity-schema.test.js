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
const {
  inspectPlatformIdentity,
} = require('../server/lib/platform-identity-bootstrap.js');

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

test('competing physical companies or branches roots reject migration without partial PR5 state', async t => {
  for (const competingTables of [
    ['companies'],
    ['branches'],
    ['companies', 'branches'],
  ]) {
    await t.test(competingTables.join(' + '), () => {
      const db = baseDb();
      try {
        const rootsBefore = Object.fromEntries([
          CANONICAL_COMPANIES_TABLE,
          CANONICAL_BRANCHES_TABLE,
        ].map(table => [
          table,
          db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).sql,
        ]));
        const financialBefore = Object.fromEntries(FINANCIAL_TABLES.map(table => [
          table,
          db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
        ]));
        for (const table of competingTables) {
          db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, marker TEXT)`);
          db.prepare(`INSERT INTO ${table} (id, marker) VALUES (?, ?)`).run(
            `${table}-legacy-id`,
            'must-remain',
          );
        }

        assert.throws(
          () => ensurePlatformIdentitySchema(db),
          /PLATFORM_IDENTITY_COMPETING_AUTHORITY/,
        );
        assert.equal(migrationRow(db), undefined);
        for (const table of PLATFORM_IDENTITY_TABLES) {
          assert.equal(
            db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
            undefined,
          );
        }
        for (const [table, sql] of Object.entries(rootsBefore)) {
          assert.equal(
            db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).sql,
            sql,
          );
          assert.equal(
            db.prepare(`PRAGMA table_info(${table})`).all()
              .some(column => column.name === 'displayName'),
            false,
          );
        }
        assert.deepEqual(Object.fromEntries(FINANCIAL_TABLES.map(table => [
          table,
          db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
        ])), financialBefore);
        for (const table of competingTables) {
          assert.deepEqual(
            db.prepare(`SELECT * FROM ${table}`).all(),
            [{ id: `${table}-legacy-id`, marker: 'must-remain' }],
          );
        }
        assert.deepEqual(db.pragma('foreign_key_check'), []);
      } finally {
        db.close();
      }
    });
  }
});

test('prior application initializers remain compatible after the additive PR5 migration', () => {
  const db = baseDb();
  try {
    const legacyBefore = db.prepare('SELECT * FROM app_data ORDER BY name').all();
    const rootIdentityBefore = Object.fromEntries([
      CANONICAL_COMPANIES_TABLE,
      CANONICAL_BRANCHES_TABLE,
    ].map(table => [
      table,
      db.prepare("SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).rootpage,
    ]));
    assert.equal(ensurePlatformIdentitySchema(db), true);
    const pr5ObjectsBeforePriorStartup = db.prepare(`
      SELECT type, name, tbl_name AS tableName, sql
      FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all();
    const upgradedRootIdentity = Object.fromEntries([
      CANONICAL_COMPANIES_TABLE,
      CANONICAL_BRANCHES_TABLE,
    ].map(table => [
      table,
      db.prepare("SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).rootpage,
    ]));
    assert.deepEqual(upgradedRootIdentity, rootIdentityBefore);

    assert.equal(ensureCanonicalReceivablesSchema(db), false);
    assert.equal(ensureCanonicalReceivablesSettlementSchema(db), false);

    assert.deepEqual(
      db.prepare(`
        SELECT type, name, tbl_name AS tableName, sql
        FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%'
        ORDER BY type, name
      `).all(),
      pr5ObjectsBeforePriorStartup,
    );
    assert.deepEqual(Object.fromEntries([
      CANONICAL_COMPANIES_TABLE,
      CANONICAL_BRANCHES_TABLE,
    ].map(table => [
      table,
      db.prepare("SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).rootpage,
    ])), upgradedRootIdentity);
    assert.deepEqual(db.prepare('SELECT * FROM app_data ORDER BY name').all(), legacyBefore);
    db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)').run(
      'prior_app_probe',
      JSON.stringify([{ id: 'legacy-write-after-pr5', value: 1 }]),
    );
    assert.deepEqual(
      JSON.parse(db.prepare('SELECT json FROM app_data WHERE name = ?').get('prior_app_probe').json),
      [{ id: 'legacy-write-after-pr5', value: 1 }],
    );
    assert.equal(
      inspectPlatformIdentity(db, {
        CANONICAL_RECEIVABLES_READ_API_ENABLED: 'false',
      }).canonicalReadFeatureEnabled,
      false,
    );
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    for (const table of [
      CANONICAL_COMPANIES_TABLE,
      CANONICAL_BRANCHES_TABLE,
      'company_memberships',
      'membership_branch_access',
      'role_templates',
      'role_template_capabilities',
      'membership_capability_assignments',
      'authorization_audit_events',
      'identity_bootstrap_runs',
      ...FINANCIAL_TABLES,
    ]) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM capability_catalog_versions').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM capability_catalog_entries').get().count, 11);
  } finally {
    db.close();
  }
});
