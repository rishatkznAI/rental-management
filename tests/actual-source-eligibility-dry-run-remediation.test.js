import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  closePlan,
  conductPlan,
  formPlan,
  hash,
  insertActivationBoundary,
  sourceRows,
} from './billing-source-authority-fixtures.js';
import {
  approvedTestPolicyManifest,
  completeEvidence,
  createActualSourceDryRunContext,
  dryRunCommand,
  seedPositiveSource,
} from './actual-source-eligibility-dry-run-fixtures.js';

const require = createRequire(import.meta.url);
const {
  createTrustedUserActorContext,
} = require('../server/lib/platform-identity-repository.js');
const {
  materializeActualSourceDryRunCommand,
} = require('../server/lib/actual-source-eligibility-dry-run-domain.js');
const {
  createActualSourceEligibilityDryRunRepository,
} = require('../server/lib/actual-source-eligibility-dry-run-repository.js');

function candidateBlockers(context, runId) {
  const row = context.db.prepare(`
    SELECT blockerCodesJson FROM actual_source_dry_run_candidates WHERE runId = ?
  `).get(runId);
  return row ? JSON.parse(row.blockerCodesJson) : [];
}

function pr8RowCount(context) {
  return context.db.prepare('SELECT COUNT(*) AS count FROM actual_source_dry_runs').get().count;
}

test('formed but not conducted UPD is blocked even with exact closed-period mapping', () => {
  const context = createActualSourceDryRunContext();
  try {
    insertActivationBoundary(context);
    context.service.closeBillingPeriod(context.commandContext, closePlan({ evidence: completeEvidence() }));
    context.service.formUpd(context.commandContext, formPlan(context));
    const result = context.dryRunService.evaluateActualSourceDryRun(
      context.dryRunContext,
      dryRunCommand({ idempotencyKey: 'formed-not-conducted' }),
    );
    assert.equal(result.blockedCandidateCount, 1);
    assert.ok(candidateBlockers(context, result.dryRunId).includes('UPD_NOT_CURRENTLY_CONDUCTED'));
  } finally {
    context.close();
  }
});

test('conducted UPD without mapping creates no candidate and retains explicit coverage diagnostics', () => {
  const context = createActualSourceDryRunContext();
  try {
    insertActivationBoundary(context);
    context.service.closeBillingPeriod(context.commandContext, closePlan({ evidence: completeEvidence() }));
    context.service.formUpd(context.commandContext, formPlan(context, { withoutCoverage: true }));
    context.service.conductUpd(context.commandContext, conductPlan(context));
    const result = context.dryRunService.evaluateActualSourceDryRun(
      context.dryRunContext,
      dryRunCommand({ idempotencyKey: 'conducted-no-mapping' }),
    );
    assert.equal(result.status, 'completed_no_candidates');
    assert.equal(result.candidateCount, 0);
    assert.ok(context.db.prepare(`
      SELECT 1 FROM actual_source_dry_run_diagnostics
      WHERE runId = ? AND code = 'COVERAGE_MISSING'
    `).get(result.dryRunId));
  } finally {
    context.close();
  }
});

test('period reopen after an exact mapping blocks the preserved source slice', () => {
  const context = createActualSourceDryRunContext();
  try {
    seedPositiveSource(context);
    const source = sourceRows(context);
    context.service.reopenBillingPeriod(context.commandContext, {
      operationType: 'reopen_billing_period',
      idempotencyKey: 'reopen-before-pr8',
      periodId: source.period.id,
      expectedPeriodVersion: 1,
      reasonCode: 'SOURCE_CORRECTION',
      reasonText: 'Explicit isolated correction before dry run',
      sourceEventId: 'reopen-before-pr8-event',
      sourceEventVersion: 1,
      sourceHash: hash('reopen-before-pr8-event'),
    });
    const result = context.dryRunService.evaluateActualSourceDryRun(
      context.dryRunContext,
      dryRunCommand({ idempotencyKey: 'reopened-period' }),
    );
    assert.equal(result.blockedCandidateCount, 1);
    assert.ok(candidateBlockers(context, result.dryRunId).includes('PERIOD_REOPENED'));
    assert.ok(context.db.prepare(`SELECT 1 FROM actual_source_dry_run_diagnostics WHERE runId = ? AND code = 'PERIOD_REOPENED'`).get(result.dryRunId));
  } finally {
    context.close();
  }
});

test('incomplete snapshot evidence, required signature, VAT and rounding reference drift all block', async t => {
  await t.test('incomplete evidence', () => {
    const context = createActualSourceDryRunContext();
    try {
      insertActivationBoundary(context);
      context.service.closeBillingPeriod(context.commandContext, closePlan());
      context.service.formUpd(context.commandContext, formPlan(context));
      context.service.conductUpd(context.commandContext, conductPlan(context));
      const result = context.dryRunService.evaluateActualSourceDryRun(
        context.dryRunContext,
        dryRunCommand({ idempotencyKey: 'incomplete-evidence' }),
      );
      assert.ok(candidateBlockers(context, result.dryRunId).includes('SOURCE_EVIDENCE_INCOMPLETE'));
    } finally {
      context.close();
    }
  });

  await t.test('required signature absent', () => {
    const context = createActualSourceDryRunContext();
    try {
      seedPositiveSource(context);
      const policyManifest = approvedTestPolicyManifest({
        gates: { client_signature_requirement: { decisionValue: 'required' } },
      });
      const result = context.dryRunService.evaluateActualSourceDryRun(
        context.dryRunContext,
        dryRunCommand({ idempotencyKey: 'signature-required', policyManifest }),
      );
      assert.ok(candidateBlockers(context, result.dryRunId).includes('REQUIRED_SIGNATURE_EVIDENCE_MISSING'));
    } finally {
      context.close();
    }
  });

  await t.test('VAT and rounding refs drift', () => {
    const context = createActualSourceDryRunContext();
    try {
      seedPositiveSource(context);
      const policyManifest = approvedTestPolicyManifest({
        gates: {
          vat_selection: { expectedSourceRef: 'different-vat-policy' },
          rounding_mode_and_order: { expectedSourceRef: 'different-rounding-policy' },
        },
      });
      const result = context.dryRunService.evaluateActualSourceDryRun(
        context.dryRunContext,
        dryRunCommand({ idempotencyKey: 'tax-rounding-drift', policyManifest }),
      );
      const blockers = candidateBlockers(context, result.dryRunId);
      assert.ok(blockers.includes('VAT_POLICY_MISMATCH'));
      assert.ok(blockers.includes('ROUNDING_POLICY_MISMATCH'));
    } finally {
      context.close();
    }
  });
});

test('activation row alone cannot replace explicit boundary/cohort policy approval', () => {
  const context = createActualSourceDryRunContext();
  try {
    seedPositiveSource(context);
    const policyManifest = approvedTestPolicyManifest({
      gates: {
        activation_boundary: null,
        activation_cohort: null,
      },
    });
    const result = context.dryRunService.evaluateActualSourceDryRun(
      context.dryRunContext,
      dryRunCommand({ idempotencyKey: 'activation-row-only', policyManifest }),
    );
    const blockers = candidateBlockers(context, result.dryRunId);
    assert.ok(blockers.includes('ACTIVATION_BOUNDARY_UNRESOLVED'));
    assert.ok(blockers.includes('ACTIVATION_COHORT_UNRESOLVED'));
    assert.equal(result.productionActivationAuthorized, false);
  } finally {
    context.close();
  }
});

test('source version drift after planning rolls back without partial PR8 evidence', () => {
  const context = createActualSourceDryRunContext();
  try {
    seedPositiveSource(context);
    const repository = createActualSourceEligibilityDryRunRepository(context.db);
    const commandPlan = materializeActualSourceDryRunCommand(dryRunCommand({ idempotencyKey: 'source-drift' }));
    const executionPlan = repository.prepareDryRun(context.dryRunContext, commandPlan);
    const source = sourceRows(context);
    context.service.reopenBillingPeriod(context.commandContext, {
      operationType: 'reopen_billing_period',
      idempotencyKey: 'source-drift-reopen',
      periodId: source.period.id,
      expectedPeriodVersion: 1,
      reasonCode: 'SOURCE_CORRECTION',
      reasonText: 'Race source change',
      sourceEventId: 'source-drift-reopen-event',
      sourceEventVersion: 1,
      sourceHash: hash('source-drift-reopen-event'),
    });
    assert.throws(
      () => repository.evaluateDryRun(context.dryRunContext, executionPlan),
      error => error.code === 'SOURCE_VERSION_DRIFT',
    );
    assert.equal(pr8RowCount(context), 0);
  } finally {
    context.close();
  }
});

test('membership revocation and branch deactivation after planning fail fresh authorization before commit', async t => {
  await t.test('membership inactive', () => {
    const context = createActualSourceDryRunContext();
    try {
      seedPositiveSource(context);
      const repository = createActualSourceEligibilityDryRunRepository(context.db);
      const commandPlan = materializeActualSourceDryRunCommand(dryRunCommand({ idempotencyKey: 'membership-race' }));
      const executionPlan = repository.prepareDryRun(context.dryRunContext, commandPlan);
      context.platformRepository.updateMembership({
        membershipId: 'membership-billing',
        expectedVersion: context.platformScope.membershipVersion,
        status: 'inactive',
        actorContext: createTrustedUserActorContext({
          principalId: 'U-billing',
          correlationId: 'membership-race-update',
        }),
        reason: 'isolated-test-revocation',
      });
      assert.throws(() => repository.evaluateDryRun(context.dryRunContext, executionPlan));
      assert.equal(pr8RowCount(context), 0);
    } finally {
      context.close();
    }
  });

  await t.test('branch inactive', () => {
    const context = createActualSourceDryRunContext();
    try {
      seedPositiveSource(context);
      const repository = createActualSourceEligibilityDryRunRepository(context.db);
      const commandPlan = materializeActualSourceDryRunCommand(dryRunCommand({ idempotencyKey: 'branch-race' }));
      const executionPlan = repository.prepareDryRun(context.dryRunContext, commandPlan);
      context.platformRepository.updateBranch({
        companyId: 'company-a',
        branchId: 'branch-a-1',
        expectedVersion: 1,
        status: 'inactive',
        actorContext: createTrustedUserActorContext({
          principalId: 'U-billing',
          correlationId: 'branch-race-update',
        }),
        reason: 'isolated-test-deactivation',
      });
      assert.throws(() => repository.evaluateDryRun(context.dryRunContext, executionPlan));
      assert.equal(pr8RowCount(context), 0);
    } finally {
      context.close();
    }
  });
});
