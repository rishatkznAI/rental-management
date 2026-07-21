import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approvedTestPolicyManifest,
  createActualSourceDryRunContext,
  dryRunCommand,
  seedPositiveSource,
} from './actual-source-eligibility-dry-run-fixtures.js';

const EXPECTED_GATE_BLOCKERS = {
  accounting_source_sufficiency: 'ACCOUNTING_SOURCE_SUFFICIENCY_UNRESOLVED',
  canonical_amount_basis: 'CANONICAL_AMOUNT_BASIS_UNRESOLVED',
  conducted_evidence: 'CONDUCTED_EVIDENCE_POLICY_UNRESOLVED',
  client_signature_requirement: 'SIGNATURE_REQUIREMENT_UNRESOLVED',
  contractual_due_date: 'DUE_DATE_POLICY_UNRESOLVED',
  unknown_due_date_treatment: 'UNKNOWN_DUE_DATE_POLICY_UNRESOLVED',
  vat_selection: 'VAT_POLICY_UNRESOLVED',
  vat_basis: 'VAT_POLICY_UNRESOLVED',
  rounding_mode_and_order: 'ROUNDING_POLICY_UNRESOLVED',
  rounding_residual_allocation: 'RESIDUAL_ALLOCATION_POLICY_UNRESOLVED',
  operational_event_authority: 'OPERATIONAL_EVENT_AUTHORITY_UNRESOLVED',
  correction_cancellation_reopen_effect: 'CORRECTION_TREATMENT_UNRESOLVED',
  activation_boundary: 'ACTIVATION_BOUNDARY_UNRESOLVED',
  activation_cohort: 'ACTIVATION_COHORT_UNRESOLVED',
  source_adapter_authority: 'SOURCE_ADAPTER_AUTHORITY_UNRESOLVED',
};

test('every mandatory missing gate blocks an otherwise exact artificial source slice', () => {
  const context = createActualSourceDryRunContext();
  try {
    seedPositiveSource(context);
    let sequence = 0;
    for (const [gateKey, expectedCode] of Object.entries(EXPECTED_GATE_BLOCKERS)) {
      const policyManifest = approvedTestPolicyManifest({ gates: { [gateKey]: null } });
      const result = context.dryRunService.evaluateActualSourceDryRun(
        context.dryRunContext,
        dryRunCommand({
          idempotencyKey: `missing-gate-${++sequence}`,
          policyManifest,
        }),
      );
      assert.equal(result.eligibleCandidateCount, 0, gateKey);
      assert.equal(result.blockedCandidateCount, 1, gateKey);
      const candidate = context.db.prepare(`
        SELECT blockerCodesJson FROM actual_source_dry_run_candidates WHERE runId = ?
      `).get(result.dryRunId);
      assert.ok(JSON.parse(candidate.blockerCodesJson).includes(expectedCode), gateKey);
      const check = context.db.prepare(`
        SELECT outcome, reasonCode FROM actual_source_dry_run_checks
        WHERE runId = ? AND candidateId IS NULL AND gateCode = ?
      `).get(result.dryRunId, gateKey);
      assert.deepEqual(check, { outcome: 'blocked', reasonCode: expectedCode });
    }
  } finally {
    context.close();
  }
});

test('matching decision reference without an approved decision hash becomes unresolved and blocked', () => {
  const context = createActualSourceDryRunContext();
  try {
    seedPositiveSource(context);
    const policyManifest = approvedTestPolicyManifest();
    delete policyManifest.gates.find(gate => gate.key === 'vat_selection').decisionHash;
    const result = context.dryRunService.evaluateActualSourceDryRun(
      context.dryRunContext,
      dryRunCommand({ idempotencyKey: 'missing-decision-hash', policyManifest }),
    );
    assert.equal(result.eligibleCandidateCount, 0);
    const check = context.db.prepare(`
      SELECT outcome, policyDecisionRef, policyDecisionHash, reasonCode
      FROM actual_source_dry_run_checks
      WHERE runId = ? AND candidateId IS NULL AND gateCode = 'vat_selection'
    `).get(result.dryRunId);
    assert.deepEqual(check, {
      outcome: 'blocked',
      policyDecisionRef: null,
      policyDecisionHash: null,
      reasonCode: 'VAT_POLICY_UNRESOLVED',
    });
  } finally {
    context.close();
  }
});

test('unknown due date is eligible only under explicit test policy and never gains aging semantics', () => {
  const context = createActualSourceDryRunContext();
  try {
    seedPositiveSource(context, {
      form: {
        contractualDueDate: null,
        dueDateProvenance: 'unknown',
        dueDateEvidenceRef: null,
      },
    });
    const allowed = context.dryRunService.evaluateActualSourceDryRun(
      context.dryRunContext,
      dryRunCommand({ idempotencyKey: 'unknown-due-allowed' }),
    );
    assert.equal(allowed.eligibleCandidateCount, 1);
    const candidate = context.db.prepare('SELECT * FROM actual_source_dry_run_candidates WHERE runId = ?')
      .get(allowed.dryRunId);
    assert.equal(candidate.contractualDueDate, null);
    assert.equal(candidate.dueDateProvenance, 'unknown');
    assert.equal('overdue' in candidate, false);
    assert.equal('agingBucket' in candidate, false);

    const policyManifest = approvedTestPolicyManifest({
      gates: {
        unknown_due_date_treatment: { decisionValue: 'reject_unknown' },
      },
    });
    const blocked = context.dryRunService.evaluateActualSourceDryRun(
      context.dryRunContext,
      dryRunCommand({ idempotencyKey: 'unknown-due-rejected', policyManifest }),
    );
    assert.equal(blocked.blockedCandidateCount, 1);
  } finally {
    context.close();
  }
});
