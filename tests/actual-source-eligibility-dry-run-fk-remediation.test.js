import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  createActualSourceDryRunContext,
  dryRunCommand,
  seedPositiveSource,
} from './actual-source-eligibility-dry-run-fixtures.js';
import { insertActivationBoundary } from './billing-source-authority-fixtures.js';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const { ensureCanonicalReceivablesSchema } = require('../server/lib/canonical-receivables-schema.js');
const { ensureCanonicalReceivablesSettlementSchema } = require('../server/lib/canonical-receivables-settlement-schema.js');
const { ensurePlatformIdentitySchema } = require('../server/lib/platform-identity-schema.js');
const { createTrustedUserActorContext } = require('../server/lib/platform-identity-repository.js');
const { ensureBillingSourceAuthoritySchema } = require('../server/lib/billing-source-authority-schema.js');
const { ensureForecastReceivablesPlanningSchema } = require('../server/lib/forecast-receivables-planning-schema.js');
const {
  ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES,
  assertActualSourceEligibilityDryRunStructure,
  ensureActualSourceEligibilityDryRunSchema,
} = require('../server/lib/actual-source-eligibility-dry-run-schema.js');

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function replaceCandidateBoundary(db, replacement) {
  const table = 'actual_source_dry_run_candidates';
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  const names = columns.map(column => `"${column}"`).join(', ');
  const values = columns.map(column => (
    column === 'activationBoundaryId'
      ? sqlLiteral(replacement)
      : `NEW."${column}"`
  )).join(', ');
  db.exec(`
    CREATE TEMP TRIGGER replace_candidate_activation_boundary
    BEFORE INSERT ON ${table}
    WHEN NEW.activationBoundaryId != ${sqlLiteral(replacement)}
    BEGIN
      INSERT INTO ${table} (${names}) VALUES (${values});
      SELECT RAISE(IGNORE);
    END;
  `);
}

function replaceInputBoundary(db, replacement) {
  const table = 'actual_source_dry_run_inputs';
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  const names = columns.map(column => `"${column}"`).join(', ');
  const values = columns.map(column => (
    column === 'activationBoundaryId'
      ? sqlLiteral(replacement)
      : `NEW."${column}"`
  )).join(', ');
  db.exec(`
    CREATE TEMP TRIGGER replace_input_activation_boundary
    BEFORE INSERT ON ${table}
    WHEN NEW.activationBoundaryId IS NOT NULL
      AND NEW.activationBoundaryId != ${sqlLiteral(replacement)}
    BEGIN
      INSERT INTO ${table} (${names}) VALUES (${values});
      SELECT RAISE(IGNORE);
    END;
  `);
}

function seedOtherCompanyBoundary(context) {
  const actorContext = createTrustedUserActorContext({
    principalId: 'U-billing',
    correlationId: 'activation-other-company-fixture',
  });
  context.platformRepository.createCompanyAuthority({
    company: {
      id: 'company-b',
      displayName: 'Company B',
      receivablesTimezone: 'Europe/Moscow',
    },
    branches: [
      { id: 'branch-b-1', displayName: 'Branch B1', isHeadOffice: true },
    ],
    actorContext,
    reason: 'activation FK wrong-company fixture',
  });
  insertActivationBoundary(context, {
    id: 'activation-company-b',
    companyId: 'company-b',
    branchId: 'branch-b-1',
    sourceHash: 'c'.repeat(64),
  });
}

function pr8Counts(db) {
  return Object.fromEntries(ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES.map(table => [
    table,
    Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
  ]));
}

test('candidate activation boundary FK rejects nonexistent and wrong-branch lineage', async t => {
  const scenarios = [
    { name: 'nonexistent', replacement: 'activation-does-not-exist' },
    {
      name: 'wrong-branch',
      replacement: 'activation-branch-a-2',
      seedExtra(context) {
        insertActivationBoundary(context, {
          id: 'activation-branch-a-2',
          branchId: 'branch-a-2',
          sourceHash: 'b'.repeat(64),
        });
      },
    },
    {
      name: 'wrong-company',
      replacement: 'activation-company-b',
      seedExtra: seedOtherCompanyBoundary,
    },
  ];
  for (const [index, scenario] of scenarios.entries()) {
    await t.test(scenario.name, () => {
      const context = createActualSourceDryRunContext();
      try {
        seedPositiveSource(context);
        scenario.seedExtra?.(context);
        const before = pr8Counts(context.db);
        replaceCandidateBoundary(context.db, scenario.replacement);
        assert.throws(
          () => context.dryRunService.evaluateActualSourceDryRun(
            context.dryRunContext,
            dryRunCommand({ idempotencyKey: `activation-fk-${index}` }),
          ),
          error => error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY',
        );
        assert.deepEqual(pr8Counts(context.db), before);
      } finally {
        context.close();
      }
    });
  }
});

test('input activation boundary FK rejects nonexistent and wrong-scope lineage', async t => {
  const scenarios = [
    { name: 'nonexistent', replacement: 'activation-input-does-not-exist' },
    {
      name: 'wrong-branch',
      replacement: 'activation-input-branch-a-2',
      seedExtra(context) {
        insertActivationBoundary(context, {
          id: 'activation-input-branch-a-2',
          branchId: 'branch-a-2',
          sourceHash: 'd'.repeat(64),
        });
      },
    },
    {
      name: 'wrong-company',
      replacement: 'activation-company-b',
      seedExtra: seedOtherCompanyBoundary,
    },
  ];
  for (const [index, scenario] of scenarios.entries()) {
    await t.test(scenario.name, () => {
      const context = createActualSourceDryRunContext();
      try {
        seedPositiveSource(context);
        scenario.seedExtra?.(context);
        const before = pr8Counts(context.db);
        replaceInputBoundary(context.db, scenario.replacement);
        assert.throws(
          () => context.dryRunService.evaluateActualSourceDryRun(
            context.dryRunContext,
            dryRunCommand({ idempotencyKey: `activation-input-fk-${index}` }),
          ),
          error => error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY',
        );
        assert.deepEqual(pr8Counts(context.db), before);
      } finally {
        context.close();
      }
    });
  }
});

test('candidate child composite FK rejects cross-run, orphan and partial references but permits run-level rows', () => {
  const context = createActualSourceDryRunContext();
  try {
    seedPositiveSource(context);
    const first = context.dryRunService.evaluateActualSourceDryRun(
      context.dryRunContext,
      dryRunCommand({ idempotencyKey: 'fk-run-a' }),
    );
    const second = context.dryRunService.evaluateActualSourceDryRun(
      context.dryRunContext,
      dryRunCommand({ idempotencyKey: 'fk-run-b' }),
    );
    const candidateB = context.db.prepare(`
      SELECT id FROM actual_source_dry_run_candidates WHERE runId = ?
    `).get(second.dryRunId).id;
    context.db.exec('DROP TRIGGER trg_actual_source_check_before_seal');
    const insert = context.db.prepare(`
      INSERT INTO actual_source_dry_run_checks (
        id, runId, candidateId, companyId, branchId, gateCode, outcome,
        sourceEvidenceRefsJson, checkHash, schemaVersion, createdAt
      ) VALUES (?, ?, ?, 'company-a', 'branch-a-1', ?, 'passed', '[]', ?, 1, ?)
    `);
    assert.throws(
      () => insert.run(
        'cross-run-check',
        first.dryRunId,
        candidateB,
        'cross_run_probe',
        'a'.repeat(64),
        first.createdAt,
      ),
      error => error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY',
    );
    assert.throws(
      () => insert.run(
        'orphan-check',
        first.dryRunId,
        'candidate-does-not-exist',
        'orphan_probe',
        'b'.repeat(64),
        first.createdAt,
      ),
      error => error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY',
    );
    assert.throws(
      () => insert.run(
        'partial-check',
        first.dryRunId,
        '',
        'partial_probe',
        'c'.repeat(64),
        first.createdAt,
      ),
      error => error.code === 'SQLITE_CONSTRAINT_CHECK',
    );
    assert.equal(insert.run(
      'run-level-check',
      first.dryRunId,
      null,
      'run_level_probe',
      'd'.repeat(64),
      first.createdAt,
    ).changes, 1);
  } finally {
    context.close();
  }
});

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

function rewriteRegisteredTableSql(file, table, rewrite) {
  let db = new Database(file);
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  const changed = rewrite(row.sql);
  assert.notEqual(changed, row.sql);
  db.unsafeMode(true);
  db.pragma('writable_schema = ON');
  db.prepare("UPDATE sqlite_master SET sql = ? WHERE type = 'table' AND name = ?").run(changed, table);
  const version = Number(db.pragma('schema_version', { simple: true }));
  db.pragma(`schema_version = ${version + 1}`);
  db.pragma('writable_schema = OFF');
  db.unsafeMode(false);
  db.close();
  db = new Database(file);
  db.pragma('foreign_keys = ON');
  return db;
}

test('registered schemas with weakened or misdirected composite FK fail repeated startup', async t => {
  const scenarios = [
    {
      name: 'missing-composite-run-column',
      rewrite(sql) {
        return sql.replace(
          /FOREIGN KEY \(candidateId, runId, companyId, branchId\)\s+REFERENCES actual_source_dry_run_candidates\(id, runId, companyId, branchId\)/,
          'FOREIGN KEY (candidateId, companyId, branchId) REFERENCES actual_source_dry_run_candidates(id, companyId, branchId)',
        );
      },
    },
    {
      name: 'wrong-referenced-column-order',
      rewrite(sql) {
        return sql.replace(
          'REFERENCES actual_source_dry_run_candidates(id, runId, companyId, branchId)',
          'REFERENCES actual_source_dry_run_candidates(id, companyId, branchId, runId)',
        );
      },
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pr8-fk-'));
      const file = path.join(directory, 'app.sqlite');
      let db = createFreshDatabase(file);
      db.close();
      try {
        db = rewriteRegisteredTableSql(
          file,
          'actual_source_dry_run_checks',
          scenario.rewrite,
        );
        assert.throws(
          () => assertActualSourceEligibilityDryRunStructure(db),
          /ACTUAL_SOURCE_PR8_FOREIGN_KEY_STRUCTURE_MISMATCH|foreign key mismatch/,
        );
        assert.throws(
          () => ensureActualSourceEligibilityDryRunSchema(db),
          /ACTUAL_SOURCE_PR8_FOREIGN_KEY_STRUCTURE_MISMATCH|foreign key mismatch/,
        );
      } finally {
        db?.close();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});
