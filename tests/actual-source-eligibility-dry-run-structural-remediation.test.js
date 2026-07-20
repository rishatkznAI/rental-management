import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const { ensureCanonicalReceivablesSchema } = require('../server/lib/canonical-receivables-schema.js');
const { ensureCanonicalReceivablesSettlementSchema } = require('../server/lib/canonical-receivables-settlement-schema.js');
const { ensurePlatformIdentitySchema } = require('../server/lib/platform-identity-schema.js');
const { ensureBillingSourceAuthoritySchema } = require('../server/lib/billing-source-authority-schema.js');
const { ensureForecastReceivablesPlanningSchema } = require('../server/lib/forecast-receivables-planning-schema.js');
const {
  ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_MIGRATION_ID,
  canonicalSql,
  extractCheckExpressions,
  tokenizeSql,
  assertActualSourceEligibilityDryRunStructure,
  ensureActualSourceEligibilityDryRunSchema,
} = require('../server/lib/actual-source-eligibility-dry-run-schema.js');

function createFreshDatabase(file) {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE app_data (
      name TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  ensureCanonicalReceivablesSchema(db);
  ensureCanonicalReceivablesSettlementSchema(db);
  ensurePlatformIdentitySchema(db);
  ensureBillingSourceAuthoritySchema(db);
  ensureForecastReceivablesPlanningSchema(db);
  ensureActualSourceEligibilityDryRunSchema(db);
  return db;
}

function registeredAt(db) {
  return db.prepare('SELECT applied_at FROM sql_shadow_schema_migrations WHERE name = ?')
    .get(ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_MIGRATION_ID).applied_at;
}

function registeredSchemaFingerprint(db) {
  return JSON.stringify(db.prepare(`
    SELECT type, name, tbl_name AS tableName, sql
    FROM sqlite_master
    WHERE name LIKE 'actual_source_%' OR name LIKE 'trg_actual_source_%'
    ORDER BY type, name
  `).all());
}

function readWithMalformedSchemaSuppressed(db, read) {
  db.unsafeMode(true);
  db.pragma('writable_schema = ON');
  try {
    return read();
  } finally {
    db.pragma('writable_schema = OFF');
    db.unsafeMode(false);
  }
}

function malformedSchemaFingerprint(db) {
  return readWithMalformedSchemaSuppressed(db, () => registeredSchemaFingerprint(db));
}

function malformedRegisteredAt(db) {
  return readWithMalformedSchemaSuppressed(db, () => registeredAt(db));
}

function rewriteRegisteredSql(db, type, name, rewrite) {
  const row = db.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
    .get(type, name);
  const changed = rewrite(row.sql);
  assert.notEqual(changed, row.sql, `${type}:${name} rewrite must change SQL`);
  db.unsafeMode(true);
  db.pragma('writable_schema = ON');
  db.prepare('UPDATE sqlite_master SET sql = ? WHERE type = ? AND name = ?')
    .run(changed, type, name);
  const schemaVersion = Number(db.pragma('schema_version', { simple: true }));
  db.pragma(`schema_version = ${schemaVersion + 1}`);
  db.pragma('writable_schema = OFF');
  db.unsafeMode(false);
}

function reopen(file, db) {
  db.close();
  const reopened = new Database(file);
  reopened.pragma('foreign_keys = ON');
  return reopened;
}

function assertRegisteredSchemaRejected(scenario) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pr8-structure-remediation-'));
  const file = path.join(directory, 'app.sqlite');
  let db = createFreshDatabase(file);
  const appliedAt = registeredAt(db);
  try {
    if (scenario.rewrite) {
      rewriteRegisteredSql(db, scenario.type, scenario.object, scenario.rewrite);
    } else {
      scenario.mutate(db);
    }
    db = reopen(file, db);
    const mutatedSchemaFingerprint = registeredSchemaFingerprint(db);
    assert.throws(
      () => assertActualSourceEligibilityDryRunStructure(db),
      scenario.expectedError,
    );
    assert.equal(registeredSchemaFingerprint(db), mutatedSchemaFingerprint);
    assert.throws(
      () => ensureActualSourceEligibilityDryRunSchema(db),
      scenario.expectedError,
    );
    assert.equal(registeredAt(db), appliedAt);
    assert.equal(registeredSchemaFingerprint(db), mutatedSchemaFingerprint);
  } finally {
    db?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function assertRegisteredSchemaAcceptedAfterMutation(mutate) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pr8-structure-positive-'));
  const file = path.join(directory, 'app.sqlite');
  let db = createFreshDatabase(file);
  const appliedAt = registeredAt(db);
  try {
    mutate(db);
    db = reopen(file, db);
    const mutatedSchemaFingerprint = registeredSchemaFingerprint(db);
    assert.equal(assertActualSourceEligibilityDryRunStructure(db), true);
    assert.equal(registeredSchemaFingerprint(db), mutatedSchemaFingerprint);
    assert.equal(ensureActualSourceEligibilityDryRunSchema(db), false);
    assert.equal(registeredAt(db), appliedAt);
    assert.equal(registeredSchemaFingerprint(db), mutatedSchemaFingerprint);
  } finally {
    db?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function assertMalformedRegisteredSchemaRejected(scenario) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pr8-structure-malformed-'));
  const file = path.join(directory, 'app.sqlite');
  let db = createFreshDatabase(file);
  const appliedAt = registeredAt(db);
  try {
    rewriteRegisteredSql(db, scenario.type, scenario.object, scenario.rewrite);
    db = reopen(file, db);
    const mutatedSchemaFingerprint = malformedSchemaFingerprint(db);
    assert.throws(() => assertActualSourceEligibilityDryRunStructure(db), scenario.expectedError);
    assert.equal(malformedRegisteredAt(db), appliedAt);
    assert.equal(malformedSchemaFingerprint(db), mutatedSchemaFingerprint);
    assert.throws(() => ensureActualSourceEligibilityDryRunSchema(db), scenario.expectedError);
    assert.equal(malformedRegisteredAt(db), appliedAt);
    assert.equal(malformedSchemaFingerprint(db), mutatedSchemaFingerprint);
  } finally {
    db?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('SQLite-aware scanner ignores CHECK text in non-executable lexical regions', () => {
  const sql = `
    CREATE TABLE scanner_probe (
      value INTEGER,
      note TEXT DEFAULT 'CHECK (literal_decoy)',
      "CHECK (double_quoted_decoy)" TEXT,
      \`CHECK (backtick_decoy)\` TEXT,
      [CHECK (bracket_decoy)] TEXT,
      CHECK (coalesce((value + 1), 0) > 0 AND note != 'CHECK (nested_literal)')
      /* CHECK (block_comment_decoy) */
      -- CHECK (line_comment_decoy)
    )
  `;
  assert.deepEqual(extractCheckExpressions(sql), [
    canonicalSql("coalesce((value + 1), 0) > 0 AND note != 'CHECK (nested_literal)'"),
  ]);
});

test('semantic SQL canonicalization preserves literals, operators and meaningful quoting', () => {
  const canonicalIndex = 'CREATE UNIQUE INDEX uq_probe ON actual_source_dry_run_candidates(runId, candidateKey)';
  assert.equal(
    canonicalSql('create unique index "uq_probe" on "actual_source_dry_run_candidates"("runId", "candidateKey")'),
    canonicalSql(canonicalIndex),
  );
  assert.equal(
    canonicalSql('CREATE UNIQUE INDEX `uq_probe` ON [actual_source_dry_run_candidates](`runId`, [candidateKey])'),
    canonicalSql(canonicalIndex),
  );
  assert.equal(canonicalSql('SELECT "RUNID"'), canonicalSql('select runId'));
  assert.notEqual(canonicalSql('SELECT "select"'), canonicalSql('SELECT select'));
  assert.notEqual(canonicalSql('SELECT "two words"'), canonicalSql('SELECT two words'));
  assert.notEqual(canonicalSql('SELECT "run""Id"'), canonicalSql('SELECT runId'));
  assert.notEqual(canonicalSql('SELECT `run``Id`'), canonicalSql('SELECT runId'));
  assert.notEqual(canonicalSql("CHECK (value = 'CHECK')"), canonicalSql("CHECK (value = 'check')"));
  assert.notEqual(canonicalSql('CHECK (value = 0)'), canonicalSql('CHECK (value = 0.0)'));
  assert.notEqual(canonicalSql('CHECK (value = 1)'), canonicalSql('CHECK (value = 01)'));
  assert.notEqual(canonicalSql('CHECK (value = 1)'), canonicalSql('CHECK (value == 1)'));
  assert.notEqual(canonicalSql('CHECK (a AND b)'), canonicalSql('CHECK (a OR b)'));
});

test('SQLite-aware scanner fails closed on unterminated lexical regions and CHECK parentheses', () => {
  for (const sql of [
    'CREATE TABLE t (value INTEGER) /* unterminated',
    "CREATE TABLE t (value TEXT DEFAULT 'unterminated)",
    'CREATE TABLE t ("unterminated TEXT)',
    'CREATE TABLE t (`unterminated TEXT)',
    'CREATE TABLE t ([unterminated TEXT)',
  ]) {
    assert.equal(tokenizeSql(sql), null, sql);
    assert.equal(extractCheckExpressions(sql), null, sql);
  }
  assert.equal(extractCheckExpressions('CREATE TABLE t (value INTEGER CHECK ((value > 0)'), null);
});

test('registered startup fails closed on malformed persisted CHECK SQL without repair', async t => {
  const table = 'actual_source_dry_run_candidates';
  const inertnessCheck = 'CHECK (diagnosticOnly = 1 AND canonicalWriteAuthorized = 0 AND productionActivationAuthorized = 0)';
  const malformedSqlError = /ACTUAL_SOURCE_PR8_(?:TABLE_CONSTRAINT_MISMATCH|SCHEMA_INCOMPLETE)|malformed database schema|unrecognized token|incomplete input/i;
  const scenarios = [
    {
      name: 'unterminated block comment',
      type: 'table',
      object: table,
      expectedError: malformedSqlError,
      rewrite: sql => `${sql} /* unterminated`,
    },
    {
      name: 'unterminated string literal',
      type: 'table',
      object: table,
      expectedError: malformedSqlError,
      rewrite: sql => `${sql} 'unterminated`,
    },
    {
      name: 'unbalanced CHECK parentheses',
      type: 'table',
      object: table,
      expectedError: malformedSqlError,
      rewrite: sql => sql.replace(`${inertnessCheck},`, `${inertnessCheck.slice(0, -1)},`),
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, () => assertMalformedRegisteredSchemaRejected(scenario));
  }
});

test('registered schema rejects critical CHECK text found only in non-executable regions', async t => {
  const table = 'actual_source_dry_run_candidates';
  const expectedError = /ACTUAL_SOURCE_PR8_TABLE_CONSTRAINT_MISMATCH:actual_source_dry_run_candidates/;
  const inertnessCheck = 'CHECK (diagnosticOnly = 1 AND canonicalWriteAuthorized = 0 AND productionActivationAuthorized = 0)';
  const addConstraintNameDecoy = (sql, open, close) => sql
    .replace(`${inertnessCheck},`, '')
    .replace(
      "CHECK (createdAt GLOB '????-??-??T??:??:??.???Z')",
      `CONSTRAINT ${open}${inertnessCheck}${close} CHECK (createdAt GLOB '????-??-??T??:??:??.???Z')`,
    );
  const scenarios = [
    {
      name: 'block comment decoy',
      type: 'table',
      object: table,
      expectedError,
      rewrite: sql => sql.replace(`${inertnessCheck},`, `/* ${inertnessCheck} */`),
    },
    {
      name: 'line comment decoy',
      type: 'table',
      object: table,
      expectedError,
      rewrite: sql => sql.replace(`${inertnessCheck},`, `-- ${inertnessCheck}\n`),
    },
    {
      name: 'single-quoted DEFAULT decoy',
      type: 'table',
      object: table,
      expectedError,
      rewrite: sql => sql
        .replace(
          'currentConductedUpdVersionId TEXT,',
          `currentConductedUpdVersionId TEXT DEFAULT '${inertnessCheck}',`,
        )
        .replace(`${inertnessCheck},`, ''),
    },
    {
      name: 'double-quoted identifier decoy',
      type: 'table',
      object: table,
      expectedError,
      rewrite: sql => addConstraintNameDecoy(sql, '"', '"'),
    },
    {
      name: 'backtick-quoted identifier decoy',
      type: 'table',
      object: table,
      expectedError,
      rewrite: sql => addConstraintNameDecoy(sql, '`', '`'),
    },
    {
      name: 'bracket-quoted identifier decoy',
      type: 'table',
      object: table,
      expectedError,
      rewrite: sql => addConstraintNameDecoy(sql, '[', ']'),
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, () => assertRegisteredSchemaRejected(scenario));
  }
});

test('registered schema rejects weakened critical CHECK expressions', async t => {
  const candidateTable = 'actual_source_dry_run_candidates';
  const checkTable = 'actual_source_dry_run_checks';
  const runTable = 'actual_source_dry_runs';
  const candidateError = /ACTUAL_SOURCE_PR8_TABLE_CONSTRAINT_MISMATCH:actual_source_dry_run_candidates/;
  const scenarios = [
    {
      name: 'candidate diagnostic-only constraint removed',
      type: 'table',
      object: candidateTable,
      expectedError: candidateError,
      rewrite: sql => sql.replace(
        'CHECK (diagnosticOnly = 1 AND canonicalWriteAuthorized = 0 AND productionActivationAuthorized = 0)',
        'CHECK (canonicalWriteAuthorized = 0 AND productionActivationAuthorized = 0)',
      ),
    },
    {
      name: 'candidate canonical-write constraint removed',
      type: 'table',
      object: candidateTable,
      expectedError: candidateError,
      rewrite: sql => sql.replace(
        'CHECK (diagnosticOnly = 1 AND canonicalWriteAuthorized = 0 AND productionActivationAuthorized = 0)',
        'CHECK (diagnosticOnly = 1 AND productionActivationAuthorized = 0)',
      ),
    },
    {
      name: 'candidate production-activation constraint removed',
      type: 'table',
      object: candidateTable,
      expectedError: candidateError,
      rewrite: sql => sql.replace(
        'CHECK (diagnosticOnly = 1 AND canonicalWriteAuthorized = 0 AND productionActivationAuthorized = 0)',
        'CHECK (diagnosticOnly = 1 AND canonicalWriteAuthorized = 0)',
      ),
    },
    {
      name: 'candidate status domain widened',
      type: 'table',
      object: candidateTable,
      expectedError: candidateError,
      rewrite: sql => sql.replace(
        "CHECK (status IN ('eligible_candidate', 'blocked'))",
        "CHECK (status IN ('eligible_candidate', 'blocked', 'review_ready'))",
      ),
    },
    {
      name: 'nullable candidate lineage weakened',
      type: 'table',
      object: checkTable,
      expectedError: /ACTUAL_SOURCE_PR8_TABLE_CONSTRAINT_MISMATCH:actual_source_dry_run_checks/,
      rewrite: sql => sql.replace(
        'CHECK (candidateId IS NULL OR length(trim(candidateId)) > 0)',
        'CHECK (candidateId IS NULL OR 1)',
      ),
    },
    {
      name: 'run count conservation weakened',
      type: 'table',
      object: runTable,
      expectedError: /ACTUAL_SOURCE_PR8_TABLE_CONSTRAINT_MISMATCH:actual_source_dry_runs/,
      rewrite: sql => sql.replace(
        'CHECK (candidateCount = eligibleCandidateCount + blockedCandidateCount)',
        'CHECK (candidateCount >= eligibleCandidateCount + blockedCandidateCount)',
      ),
    },
    {
      name: 'candidate money equation weakened',
      type: 'table',
      object: candidateTable,
      expectedError: candidateError,
      rewrite: sql => sql.replace(
        'CHECK (sourceNetMinor + sourceVatMinor = sourceGrossMinor)',
        'CHECK (sourceNetMinor + sourceVatMinor >= 0)',
      ),
    },
    {
      name: 'candidate hash contract weakened',
      type: 'table',
      object: candidateTable,
      expectedError: candidateError,
      rewrite: sql => sql.replace(
        'CHECK (length(candidateKey) = 64 AND length(policyManifestHash) = 64',
        'CHECK (length(candidateKey) >= 0 AND length(policyManifestHash) = 64',
      ),
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, () => assertRegisteredSchemaRejected(scenario));
  }
});

test('registered schema rejects disabled or weakened critical triggers', async t => {
  const scenarios = [
    {
      name: 'candidate no-update trigger gains WHEN 0',
      type: 'trigger',
      object: 'trg_actual_source_dry_run_candidates_no_update',
      expectedError: /ACTUAL_SOURCE_PR8_TRIGGER_STRUCTURE_MISMATCH:trg_actual_source_dry_run_candidates_no_update/,
      rewrite: sql => sql.replace(
        'BEFORE UPDATE ON actual_source_dry_run_candidates',
        'BEFORE UPDATE ON actual_source_dry_run_candidates WHEN 0',
      ),
    },
    {
      name: 'candidate no-delete trigger gains WHEN 0',
      type: 'trigger',
      object: 'trg_actual_source_dry_run_candidates_no_delete',
      expectedError: /ACTUAL_SOURCE_PR8_TRIGGER_STRUCTURE_MISMATCH:trg_actual_source_dry_run_candidates_no_delete/,
      rewrite: sql => sql.replace(
        'BEFORE DELETE ON actual_source_dry_run_candidates',
        'BEFORE DELETE ON actual_source_dry_run_candidates WHEN 0',
      ),
    },
    {
      name: 'candidate no-update RAISE removed',
      type: 'trigger',
      object: 'trg_actual_source_dry_run_candidates_no_update',
      expectedError: /ACTUAL_SOURCE_PR8_TRIGGER_STRUCTURE_MISMATCH:trg_actual_source_dry_run_candidates_no_update/,
      rewrite: sql => sql.replace(
        "SELECT RAISE(ABORT, 'actual_source_dry_run_candidates is immutable')",
        'SELECT 1',
      ),
    },
    {
      name: 'candidate no-update event changed to DELETE',
      type: 'trigger',
      object: 'trg_actual_source_dry_run_candidates_no_update',
      expectedError: /ACTUAL_SOURCE_PR8_TRIGGER_STRUCTURE_MISMATCH:trg_actual_source_dry_run_candidates_no_update/,
      rewrite: sql => sql.replace('BEFORE UPDATE ON', 'BEFORE DELETE ON'),
    },
    {
      name: 'late-candidate sealing predicate disabled',
      type: 'trigger',
      object: 'trg_actual_source_candidate_before_seal',
      expectedError: /ACTUAL_SOURCE_PR8_TRIGGER_STRUCTURE_MISMATCH:trg_actual_source_candidate_before_seal/,
      rewrite: sql => sql.replace('WHEN EXISTS (', 'WHEN 0 AND EXISTS ('),
    },
    {
      name: 'operation finalization guard disabled',
      type: 'trigger',
      object: 'trg_actual_source_operation_finalize_run',
      expectedError: /ACTUAL_SOURCE_PR8_TRIGGER_STRUCTURE_MISMATCH:trg_actual_source_operation_finalize_run/,
      rewrite: sql => sql.replace('WHEN NOT EXISTS (', 'WHEN 0 AND NOT EXISTS ('),
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, () => assertRegisteredSchemaRejected(scenario));
  }
});

test('registered schema rejects partial, non-unique, expression or misdirected indexes', async t => {
  const candidateIndexError = /ACTUAL_SOURCE_PR8_INDEX_STRUCTURE_MISMATCH:uq_actual_source_candidate_key/;
  const scenarios = [
    {
      name: 'candidate-key index becomes partial WHERE 0',
      type: 'index',
      object: 'uq_actual_source_candidate_key',
      expectedError: candidateIndexError,
      rewrite: sql => `${sql} WHERE 0`,
    },
    {
      name: 'candidate-key index becomes non-unique',
      type: 'index',
      object: 'uq_actual_source_candidate_key',
      expectedError: candidateIndexError,
      rewrite: sql => sql.replace('CREATE UNIQUE INDEX', 'CREATE INDEX'),
    },
    {
      name: 'candidate-key index column order changes',
      type: 'index',
      object: 'uq_actual_source_candidate_key',
      expectedError: candidateIndexError,
      rewrite: sql => sql.replace('(runId, candidateKey)', '(candidateKey, runId)'),
    },
    {
      name: 'operation idempotency index becomes partial',
      type: 'index',
      object: 'uq_actual_source_operation_identity',
      expectedError: /ACTUAL_SOURCE_PR8_INDEX_STRUCTURE_MISMATCH:uq_actual_source_operation_identity/,
      rewrite: sql => `${sql} WHERE 0`,
    },
    {
      name: 'candidate-key column becomes an expression',
      type: 'index',
      object: 'uq_actual_source_candidate_key',
      expectedError: candidateIndexError,
      rewrite: sql => sql.replace('(runId, candidateKey)', '(runId, lower(candidateKey))'),
    },
    {
      name: 'candidate-key index targets the wrong table',
      expectedError: candidateIndexError,
      mutate(db) {
        db.exec(`
          DROP INDEX uq_actual_source_candidate_key;
          CREATE UNIQUE INDEX uq_actual_source_candidate_key
          ON actual_source_dry_run_checks(runId, candidateId);
        `);
      },
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, () => assertRegisteredSchemaRejected(scenario));
  }
});

test('semantically equivalent quoted index identifiers remain accepted', async t => {
  const quoteStyles = [
    {
      name: 'double quotes',
      identifier: value => `"${value}"`,
    },
    {
      name: 'backticks',
      identifier: value => `\`${value}\``,
    },
    {
      name: 'brackets',
      identifier: value => `[${value}]`,
    },
  ];
  for (const quoteStyle of quoteStyles) {
    await t.test(quoteStyle.name, () => assertRegisteredSchemaAcceptedAfterMutation(db => {
      const identifier = quoteStyle.identifier;
      db.exec(`
        DROP INDEX uq_actual_source_candidate_key;
        CREATE UNIQUE INDEX ${identifier('uq_actual_source_candidate_key')}
        ON ${identifier('actual_source_dry_run_candidates')}(
          ${identifier('runId')},
          ${identifier('candidateKey')}
        );
      `);
    }));
  }
});

test('valid registered schema and harmless SQL formatting remain accepted', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pr8-structure-formatting-'));
  const file = path.join(directory, 'app.sqlite');
  let db = createFreshDatabase(file);
  const appliedAt = registeredAt(db);
  try {
    assert.equal(assertActualSourceEligibilityDryRunStructure(db), true);
    assert.equal(ensureActualSourceEligibilityDryRunSchema(db), false);
    rewriteRegisteredSql(
      db,
      'index',
      'uq_actual_source_candidate_key',
      sql => sql
        .replace('CREATE UNIQUE INDEX', 'create   unique\nindex')
        .replace(' ON ', '\n ON '),
    );
    db = reopen(file, db);
    assert.equal(assertActualSourceEligibilityDryRunStructure(db), true);
    assert.equal(ensureActualSourceEligibilityDryRunSchema(db), false);
    assert.equal(registeredAt(db), appliedAt);
  } finally {
    db?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
