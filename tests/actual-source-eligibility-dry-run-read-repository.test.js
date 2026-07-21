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
  createActualSourceEligibilityDryRunReadRepository,
  createActualSourceEligibilityDryRunReadScope,
} = require('../server/lib/actual-source-eligibility-dry-run-read-repository.js');

test('internal read repository exposes complete diagnostic provenance without canonical/aging projections', () => {
  const context = createActualSourceDryRunContext();
  try {
    seedPositiveSource(context);
    const result = context.dryRunService.evaluateActualSourceDryRun(
      context.dryRunContext,
      dryRunCommand({ idempotencyKey: 'read-contract' }),
    );
    const runs = context.readRepository.listDryRuns(context.readScope, { status: 'completed' });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].dryRunId, result.dryRunId);
    assert.equal(runs[0].diagnosticOnly, true);
    assert.equal(runs[0].canonicalWriteAuthorized, false);
    assert.equal(runs[0].productionActivationAuthorized, false);

    const detail = context.readRepository.getDryRun(context.readScope, result.dryRunId);
    assert.equal(detail.policyManifest.gates.length, 15);
    assert.equal(detail.sourceInputManifest.length, detail.sourceInputCount);
    assert.equal(detail.sourceInputManifest.some(input => input.sourceKind === 'billing_source_coverage_slices'), true);
    assert.equal('debtMinor' in detail, false);
    assert.equal('aging' in detail, false);
    assert.equal('overdue' in detail, false);

    const candidates = context.readRepository.listCandidates(context.readScope, result.dryRunId);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].status, 'eligible_candidate');
    assert.equal(candidates[0].canonicalWriteAuthorized, false);
    assert.equal('canonicalReceivableId' in candidates[0], false);
    assert.equal('workflowStatus' in candidates[0], false);

    const checks = context.readRepository.listChecks(context.readScope, result.dryRunId);
    assert.ok(checks.length >= 30);
    assert.equal(checks.every(check => check.outcome === 'passed'), true);
    const reconciliations = context.readRepository.listReconciliations(
      context.readScope,
      result.dryRunId,
    );
    assert.equal(reconciliations.length, 6);
    assert.equal(reconciliations.every(row => (
      row.deltaNetMinor === 0 && row.deltaVatMinor === 0 && row.deltaGrossMinor === 0
    )), true);
    assert.deepEqual(context.readRepository.listDiagnostics(context.readScope, result.dryRunId), []);

    const operation = context.readRepository.inspectOperation(context.readScope, result.operationId);
    assert.equal(operation.resultRunId, result.dryRunId);
    assert.equal(operation.capabilityKey, 'receivables.read');
    assert.equal(operation.canonicalWriteAuthorized, false);
    const audit = context.readRepository.inspectAuditHistory(context.readScope, result.dryRunId);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].eventType, 'actual_source_dry_run_evaluated');
  } finally {
    context.close();
  }
});
test('read scope is branded, concrete, branch-confined, bounded, and rejects arbitrary filters', () => {
  const context = createActualSourceDryRunContext({ branchIds: ['branch-a-1', 'branch-a-2'] });
  try {
    seedPositiveSource(context);
    const result = context.dryRunService.evaluateActualSourceDryRun(
      context.dryRunContext,
      dryRunCommand({ idempotencyKey: 'read-scope' }),
    );
    assert.throws(
      () => context.readRepository.getDryRun({ ...context.readScope }, result.dryRunId),
      error => error.code === 'ACTUAL_SOURCE_READ_SCOPE_REQUIRED',
    );
    assert.throws(
      () => createActualSourceEligibilityDryRunReadScope(
        context.db,
        { ...context.readActorContext },
        { branchId: 'branch-a-1' },
      ),
      error => error.code === 'PLATFORM_IDENTITY_ACTOR_CONTEXT_REJECTED',
    );
    assert.throws(
      () => context.readRepository.listDryRuns(context.readScope, { rawSql: '1=1' }),
      error => error.code === 'ACTUAL_SOURCE_READ_FILTER_INVALID',
    );
    assert.throws(
      () => context.readRepository.listDryRuns(context.readScope, {}, 201),
      error => error.code === 'ACTUAL_SOURCE_READ_LIMIT_INVALID',
    );
    assert.throws(
      () => context.readRepository.listDryRuns(context.readScope, { branchId: 'branch-a-2' }),
      error => error.code === 'ACTUAL_SOURCE_READ_NOT_FOUND',
    );

    const otherBranchScope = createActualSourceEligibilityDryRunReadScope(
      context.db,
      context.readActorContext,
      { branchId: 'branch-a-2' },
    );
    const repository = createActualSourceEligibilityDryRunReadRepository(context.db);
    assert.equal(repository.getDryRun(otherBranchScope, result.dryRunId), null);
    assert.deepEqual(repository.listCandidates(otherBranchScope, result.dryRunId), []);
  } finally {
    context.close();
  }
});

test('blocked candidates retain exact blocker checks and diagnostics on internal reads', () => {
  const context = createActualSourceDryRunContext();
  try {
    seedPositiveSource(context);
    const result = context.dryRunService.evaluateActualSourceDryRun(
      context.dryRunContext,
      dryRunCommand({ policyManifest: null, idempotencyKey: 'read-blockers' }),
    );
    const candidate = context.readRepository.listCandidates(
      context.readScope,
      result.dryRunId,
      { status: 'blocked' },
    )[0];
    assert.ok(candidate.blockerCodes.includes('VAT_POLICY_UNRESOLVED'));
    const checks = context.readRepository.listChecks(
      context.readScope,
      result.dryRunId,
      { candidateId: candidate.candidateId, outcome: 'blocked' },
    );
    assert.ok(checks.some(check => check.reasonCode === 'VAT_POLICY_UNRESOLVED'));
    const diagnostics = context.readRepository.listDiagnostics(
      context.readScope,
      result.dryRunId,
      { candidateId: candidate.candidateId },
    );
    assert.ok(diagnostics.some(item => item.code === 'VAT_POLICY_UNRESOLVED'));
  } finally {
    context.close();
  }
});
