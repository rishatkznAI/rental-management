import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approvedTestPolicyManifest,
  createActualSourceDryRunContext,
  dryRunCommand,
  seedPositiveSource,
} from './actual-source-eligibility-dry-run-fixtures.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { FINANCIAL_TABLES } = require('../server/lib/platform-identity-schema.js');

const PR8_TABLES = [
  'actual_source_dry_runs',
  'actual_source_dry_run_inputs',
  'actual_source_dry_run_candidates',
  'actual_source_dry_run_checks',
  'actual_source_dry_run_reconciliations',
  'actual_source_dry_run_diagnostics',
  'actual_source_dry_run_operations',
  'actual_source_dry_run_audit_events',
];

function tableCounts(db, tables) {
  return Object.fromEntries(tables.map(table => [
    table,
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  ]));
}

test('artificial exact source fixture is eligible_candidate but never authorizes canonical or production action', () => {
  const context = createActualSourceDryRunContext();
  try {
    seedPositiveSource(context);
    const canonicalBefore = tableCounts(context.db, FINANCIAL_TABLES);
    const sourceBefore = tableCounts(context.db, [
      'billing_source_periods',
      'billing_source_period_versions',
      'billing_source_snapshots',
      'billing_source_upd_versions',
      'billing_source_coverage_slices',
    ]);
    const forecastBefore = tableCounts(context.db, [
      'forecast_receivable_runs',
      'forecast_receivable_items',
      'forecast_receivable_operations',
    ]);

    const result = context.dryRunService.evaluateActualSourceDryRun(
      context.dryRunContext,
      dryRunCommand(),
    );
    assert.equal(result.status, 'completed');
    assert.equal(result.candidateCount, 1);
    assert.equal(result.eligibleCandidateCount, 1);
    assert.equal(result.blockedCandidateCount, 0);
    assert.equal(result.runNetMinor, 100_000);
    assert.equal(result.runVatMinor, 20_000);
    assert.equal(result.runGrossMinor, 120_000);
    assert.equal(result.diagnosticOnly, true);
    assert.equal(result.canonicalWriteAuthorized, false);
    assert.equal(result.productionActivationAuthorized, false);

    const candidate = context.db.prepare('SELECT * FROM actual_source_dry_run_candidates').get();
    assert.equal(candidate.status, 'eligible_candidate');
    assert.deepEqual(JSON.parse(candidate.blockerCodesJson), []);
    assert.equal(candidate.proposedOriginalAmountMinor, 120_000);
    assert.equal(candidate.diagnosticOnly, 1);
    assert.equal(candidate.canonicalWriteAuthorized, 0);
    assert.equal(candidate.productionActivationAuthorized, 0);
    assert.equal('canonicalReceivableId' in candidate, false);
    assert.equal('workflowStatus' in candidate, false);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM actual_source_dry_run_reconciliations WHERE blockerState = 1').get().count, 0);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM actual_source_dry_run_reconciliations').get().count, 6);

    assert.deepEqual(tableCounts(context.db, Object.keys(canonicalBefore)), canonicalBefore);
    assert.deepEqual(tableCounts(context.db, Object.keys(sourceBefore)), sourceBefore);
    assert.deepEqual(tableCounts(context.db, Object.keys(forecastBefore)), forecastBefore);
    assert.equal(context.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'actual_receivable_eligible_events'").get().count, 0);
  } finally {
    context.close();
  }
});

test('missing production policy registry persists explicit blockers and no monetary eligibility', () => {
  const context = createActualSourceDryRunContext();
  try {
    seedPositiveSource(context);
    const result = context.dryRunService.evaluateActualSourceDryRun(
      context.dryRunContext,
      dryRunCommand({ policyManifest: null, idempotencyKey: 'no-policy' }),
    );
    assert.equal(result.status, 'completed_with_blockers');
    assert.equal(result.eligibleCandidateCount, 0);
    assert.equal(result.blockedCandidateCount, 1);
    const candidate = context.db.prepare('SELECT * FROM actual_source_dry_run_candidates').get();
    const blockers = JSON.parse(candidate.blockerCodesJson);
    assert.ok(blockers.includes('ACCOUNTING_SOURCE_SUFFICIENCY_UNRESOLVED'));
    assert.ok(blockers.includes('VAT_POLICY_UNRESOLVED'));
    assert.ok(blockers.includes('ROUNDING_POLICY_UNRESOLVED'));
    assert.ok(blockers.includes('ACTIVATION_BOUNDARY_UNRESOLVED'));
    assert.equal(candidate.proposedOriginalAmountMinor, null);
    assert.equal(context.db.prepare("SELECT COUNT(*) AS count FROM actual_source_dry_run_checks WHERE candidateId IS NULL AND outcome = 'blocked'").get().count, 15);
  } finally {
    context.close();
  }
});

test('exact idempotent replay returns original run and creates no new diagnostic evidence', () => {
  const context = createActualSourceDryRunContext();
  try {
    seedPositiveSource(context);
    const command = dryRunCommand({ idempotencyKey: 'exact-replay' });
    const first = context.dryRunService.evaluateActualSourceDryRun(context.dryRunContext, command);
    const counts = tableCounts(context.db, PR8_TABLES);
    const replay = context.dryRunService.evaluateActualSourceDryRun(context.dryRunContext, command);
    assert.equal(replay.dryRunId, first.dryRunId);
    assert.equal(replay.operationId, first.operationId);
    assert.equal(replay.resultHash, first.resultHash);
    assert.equal(replay.replayed, true);
    assert.deepEqual(tableCounts(context.db, PR8_TABLES), counts);
  } finally {
    context.close();
  }
});

test('same idempotency key with different policy is a deterministic conflict with no partial run', () => {
  const context = createActualSourceDryRunContext();
  try {
    seedPositiveSource(context);
    context.dryRunService.evaluateActualSourceDryRun(
      context.dryRunContext,
      dryRunCommand({ idempotencyKey: 'policy-conflict' }),
    );
    const counts = tableCounts(context.db, PR8_TABLES);
    const changed = approvedTestPolicyManifest({
      manifestVersion: 2,
      gates: {
        unknown_due_date_treatment: { decisionVersion: 2 },
      },
    });
    assert.throws(
      () => context.dryRunService.evaluateActualSourceDryRun(
        context.dryRunContext,
        dryRunCommand({ idempotencyKey: 'policy-conflict', policyManifest: changed }),
      ),
      error => error.code === 'ACTUAL_SOURCE_IDEMPOTENCY_CONFLICT',
    );
    assert.deepEqual(tableCounts(context.db, PR8_TABLES), counts);
  } finally {
    context.close();
  }
});

test('operation sealing prevents late evidence and all PR8 rows reject update/delete/replace', () => {
  const context = createActualSourceDryRunContext();
  try {
    seedPositiveSource(context);
    const result = context.dryRunService.evaluateActualSourceDryRun(
      context.dryRunContext,
      dryRunCommand({ idempotencyKey: 'immutability' }),
    );
    for (const table of PR8_TABLES) {
      if (context.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count === 0) continue;
      assert.throws(() => context.db.prepare(`UPDATE ${table} SET id = id`).run(), /immutable/);
      assert.throws(() => context.db.prepare(`DELETE FROM ${table}`).run(), /append-only/);
    }
    const operation = context.db.prepare('SELECT * FROM actual_source_dry_run_operations').get();
    assert.throws(
      () => context.db.prepare(`INSERT OR REPLACE INTO actual_source_dry_run_operations SELECT * FROM actual_source_dry_run_operations WHERE id = ?`).run(operation.id),
      /append-only|immutable/,
    );
    const candidate = context.db.prepare('SELECT * FROM actual_source_dry_run_candidates').get();
    assert.throws(
      () => context.db.prepare(`
        INSERT INTO actual_source_dry_run_checks (
          id, runId, candidateId, companyId, branchId, gateCode, outcome,
          sourceEvidenceRefsJson, checkHash, schemaVersion, createdAt
        ) VALUES (?, ?, ?, ?, ?, 'late_check', 'passed', '[]', ?, 1, ?)
      `).run('late-check', result.dryRunId, candidate.id, 'company-a', 'branch-a-1', 'a'.repeat(64), result.createdAt),
      /sealed/,
    );
  } finally {
    context.close();
  }
});
