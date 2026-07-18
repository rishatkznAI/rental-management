import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  ensureCanonicalReceivablesSchema,
} = require('../server/lib/canonical-receivables-schema.js');
const {
  ensureCanonicalReceivablesSettlementSchema,
} = require('../server/lib/canonical-receivables-settlement-schema.js');
const {
  CAPABILITY_CATALOG_V1,
  FINANCIAL_TABLES,
  ensurePlatformIdentitySchema,
} = require('../server/lib/platform-identity-schema.js');
const {
  BILLING_SOURCE_AUTHORITY_MIGRATION_ID,
  BILLING_SOURCE_AUTHORITY_TABLES,
  REQUIRED_INDEXES,
  REQUIRED_TRIGGERS,
  assertBillingSourceAuthorityStructure,
  ensureBillingSourceAuthoritySchema,
} = require('../server/lib/billing-source-authority-schema.js');

function baseDb({ legacy = true } = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE app_data (
      name TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  if (legacy) {
    db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)').run(
      'rentals',
      JSON.stringify([{ id: 'legacy-rental', price: 12.34, equipment: ['INV-1'] }]),
    );
  }
  ensureCanonicalReceivablesSchema(db);
  ensureCanonicalReceivablesSettlementSchema(db);
  ensurePlatformIdentitySchema(db);
  return db;
}

function migration(db) {
  return db.prepare(`
    SELECT name, version, applied_at
    FROM sql_shadow_schema_migrations
    WHERE name = ?
  `).get(BILLING_SOURCE_AUTHORITY_MIGRATION_ID);
}

test('PR6 migration is additive, exact, empty, foreign-key clean, and preserves legacy JSON', () => {
  const db = baseDb();
  try {
    const legacyBefore = db.prepare('SELECT * FROM app_data ORDER BY name').all();
    const canonicalSqlBefore = Object.fromEntries(FINANCIAL_TABLES.map(table => [
      table,
      db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).sql,
    ]));
    assert.equal(ensureBillingSourceAuthoritySchema(db), true);
    assert.equal(assertBillingSourceAuthorityStructure(db), true);
    assert.deepEqual(db.prepare('SELECT * FROM app_data ORDER BY name').all(), legacyBefore);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    for (const table of BILLING_SOURCE_AUTHORITY_TABLES) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
    }
    for (const table of FINANCIAL_TABLES) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
      assert.equal(
        db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).sql,
        canonicalSqlBefore[table],
      );
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM canonical_companies').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM canonical_branches').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM company_memberships').get().count, 0);
    assert.deepEqual(
      db.prepare('SELECT capabilityKey FROM capability_catalog_entries ORDER BY capabilityKey').all()
        .map(row => row.capabilityKey),
      CAPABILITY_CATALOG_V1.map(item => item.key),
    );
    assert.deepEqual(
      db.pragma('index_info(uq_billing_source_upd_line_identity)').map(row => row.name),
      ['companyId', 'branchId', 'updId', 'sourceLineRef'],
    );
  } finally {
    db.close();
  }
});

test('PR6 migration rerun is a no-op and preserves its original registry timestamp', () => {
  const db = baseDb();
  try {
    assert.equal(ensureBillingSourceAuthoritySchema(db), true);
    const first = migration(db);
    assert.equal(ensureBillingSourceAuthoritySchema(db), false);
    assert.deepEqual(migration(db), first);
  } finally {
    db.close();
  }
});

test('PR6 enables foreign keys before validating and registers migration last', () => {
  const db = baseDb();
  try {
    db.pragma('foreign_keys = OFF');
    assert.equal(ensureBillingSourceAuthoritySchema(db), true);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    const row = migration(db);
    assert.equal(row.version, 1);
    assert.ok(BILLING_SOURCE_AUTHORITY_TABLES.every(table => (
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
    )));
  } finally {
    db.close();
  }
});

test('missing or wrong PR1, PR2, and PR5 prerequisites fail explicitly without PR6 objects', async t => {
  for (const scenario of [
    {
      name: 'missing PR1',
      prepare(db) {
        db.exec('CREATE TABLE sql_shadow_schema_migrations (name TEXT PRIMARY KEY, version INTEGER, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
      },
      match: /canonical_receivables_pr1_schema/,
    },
    {
      name: 'missing PR2',
      prepare(db) { ensureCanonicalReceivablesSchema(db); },
      match: /canonical_receivables_pr2_settlement/,
    },
    {
      name: 'missing PR5',
      prepare(db) { ensureCanonicalReceivablesSchema(db); ensureCanonicalReceivablesSettlementSchema(db); },
      match: /platform_identity_pr5/,
    },
  ]) {
    await t.test(scenario.name, () => {
      const db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      try {
        scenario.prepare(db);
        assert.throws(() => ensureBillingSourceAuthoritySchema(db), scenario.match);
        assert.equal(BILLING_SOURCE_AUTHORITY_TABLES.some(table => (
          db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
        )), false);
      } finally {
        db.close();
      }
    });
  }
});

test('wrong prerequisite version and prerequisite schema or catalog drift fail closed', async t => {
  await t.test('wrong migration version', () => {
    const db = baseDb();
    try {
      db.prepare("UPDATE sql_shadow_schema_migrations SET version = 2 WHERE name = 'platform_identity_pr5'").run();
      assert.throws(() => ensureBillingSourceAuthoritySchema(db), /platform_identity_pr5:v1/);
    } finally {
      db.close();
    }
  });
  await t.test('catalog drift', () => {
    const db = baseDb();
    try {
      db.exec('DROP TRIGGER trg_capability_catalog_entries_no_update');
      db.prepare("UPDATE capability_catalog_entries SET status = 'inactive' WHERE capabilityKey = 'upd.form'").run();
      assert.throws(() => ensureBillingSourceAuthoritySchema(db), /PLATFORM_IDENTITY_SCHEMA_INCOMPLETE|CAPABILITY_CATALOG/);
    } finally {
      db.close();
    }
  });
  await t.test('root drift', () => {
    const db = baseDb();
    try {
      db.exec('DROP INDEX uq_canonical_branches_global_id');
      assert.throws(() => ensureBillingSourceAuthoritySchema(db), /PLATFORM_IDENTITY_SCHEMA_INCOMPLETE/);
    } finally {
      db.close();
    }
  });
});

test('registered incomplete schema and unregistered partial table/index/trigger state fail explicitly', async t => {
  for (const scenario of [
    ['registered missing index', db => {
      ensureBillingSourceAuthoritySchema(db);
      db.exec(`DROP INDEX ${REQUIRED_INDEXES[0]}`);
    }, /BILLING_SOURCE_SCHEMA_INCOMPLETE/],
    ['unregistered table', db => db.exec('CREATE TABLE billing_source_upds (id TEXT)'), /BILLING_SOURCE_UNEXPECTED_PARTIAL_STATE/],
    ['unregistered index', db => db.exec('CREATE INDEX idx_billing_source_partial_probe ON app_data(name)'), /BILLING_SOURCE_UNEXPECTED_PARTIAL_STATE/],
    ['unregistered trigger', db => db.exec(`CREATE TRIGGER trg_billing_source_partial_probe BEFORE UPDATE ON app_data BEGIN SELECT RAISE(ABORT, 'probe'); END`), /BILLING_SOURCE_UNEXPECTED_PARTIAL_STATE/],
  ]) {
    await t.test(scenario[0], () => {
      const db = baseDb();
      try {
        scenario[1](db);
        assert.throws(() => ensureBillingSourceAuthoritySchema(db), scenario[2]);
      } finally {
        db.close();
      }
    });
  }
});

test('SQLite-native DDL failure rolls back every PR6 object and leaves migration unregistered', () => {
  const db = baseDb();
  try {
    db.exec('CREATE VIEW billing_source_upds AS SELECT 1 AS marker');
    assert.throws(() => ensureBillingSourceAuthoritySchema(db), /already exists/);
    assert.equal(migration(db), undefined);
    for (const table of BILLING_SOURCE_AUTHORITY_TABLES) {
      assert.equal(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
        undefined,
      );
    }
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});

test('canonical financial rows contradicting no-write state block first PR6 application without mutation', () => {
  const db = baseDb();
  try {
    db.exec(`
      INSERT INTO canonical_companies (
        id, receivablesTimezone, displayName, status, version, updatedAt
      ) VALUES ('company-existing', 'Europe/Moscow', 'Existing', 'inactive', 1, '2026-07-17');
      INSERT INTO canonical_branches (
        companyId, id, isHeadOffice, displayName, status, version, updatedAt
      ) VALUES ('company-existing', 'branch-existing', 1, 'Existing', 'inactive', 1, '2026-07-17');
      INSERT INTO canonical_receivables (
        id, companyId, branchId, clientId, sourceDocumentType, sourceDocumentId,
        sourceSystem, idempotencyKey, currency, originalAmountMinor,
        dueDateProvenance, companyTimezone, workflowStatus, createdAt, updatedAt
      ) VALUES (
        'receivable-existing', 'company-existing', 'branch-existing', 'client-existing',
        'invoice', 'invoice-existing', 'test', 'idem-existing', 'RUB', 1,
        'unknown', 'Europe/Moscow', 'draft', '2026-07-17', '2026-07-17'
      );
    `);
    assert.throws(() => ensureBillingSourceAuthoritySchema(db), /BILLING_SOURCE_CANONICAL_ROWS_PRESENT/);
    assert.equal(migration(db), undefined);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM canonical_receivables').get().count, 1);
  } finally {
    db.close();
  }
});

test('every PR6 authority table rejects update and delete, with operation/audit no-replace protection', () => {
  const db = baseDb();
  try {
    ensureBillingSourceAuthoritySchema(db);
    for (const table of BILLING_SOURCE_AUTHORITY_TABLES) {
      const triggerNames = db.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name
      `).all(table).map(row => row.name);
      assert.ok(triggerNames.includes(`trg_${table}_no_update`), table);
      assert.ok(triggerNames.includes(`trg_${table}_no_delete`), table);
    }
    assert.ok(REQUIRED_TRIGGERS.includes('trg_billing_source_operations_no_replace'));
    assert.ok(REQUIRED_TRIGGERS.includes('trg_billing_source_audit_events_no_replace'));
  } finally {
    db.close();
  }
});

test('two independent normal startups register PR6 once and seed zero source, identity, or financial rows', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-source-startup-'));
  const dbPath = path.join(directory, 'startup.sqlite');
  const script = `
    const { ensureDb } = require('./server/db');
    const { BILLING_SOURCE_AUTHORITY_TABLES } = require('./server/lib/billing-source-authority-schema');
    const { FINANCIAL_TABLES } = require('./server/lib/platform-identity-schema');
    const db = ensureDb();
    const tables = [
      ...BILLING_SOURCE_AUTHORITY_TABLES,
      'canonical_companies', 'canonical_branches', 'company_memberships',
      'membership_branch_access', 'role_templates', 'authorization_audit_events',
      ...FINANCIAL_TABLES,
    ];
    console.log(JSON.stringify({
      counts: Object.fromEntries(tables.map(table => [table, db.prepare('SELECT COUNT(*) AS count FROM ' + table).get().count])),
      migration: db.prepare("SELECT version, applied_at FROM sql_shadow_schema_migrations WHERE name = 'billing_source_authority_pr6'").get(),
      catalogVersions: db.prepare('SELECT COUNT(*) AS count FROM capability_catalog_versions').get().count,
      catalogEntries: db.prepare('SELECT COUNT(*) AS count FROM capability_catalog_entries').get().count,
      appData: db.prepare('SELECT COUNT(*) AS count FROM app_data').get().count,
      foreignKeys: db.pragma('foreign_keys', { simple: true }),
      foreignKeyCheck: db.pragma('foreign_key_check').length,
    }));
  `;
  try {
    const run = () => JSON.parse(execFileSync(process.execPath, ['-e', script], {
      cwd: root,
      env: { ...process.env, DB_PATH: dbPath },
      encoding: 'utf8',
    }).trim());
    const first = run();
    const second = run();
    Object.values(first.counts).forEach(count => assert.equal(count, 0));
    assert.deepEqual(second.counts, first.counts);
    assert.deepEqual(second.migration, first.migration);
    assert.equal(first.catalogVersions, 1);
    assert.equal(first.catalogEntries, 11);
    assert.equal(first.appData, 0);
    assert.equal(first.foreignKeys, 1);
    assert.equal(first.foreignKeyCheck, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
