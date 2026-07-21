import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approvedTestPolicyManifest,
  completeEvidence,
  createActualSourceDryRunContext,
  dryRunCommand,
  seedPositiveSource,
} from './actual-source-eligibility-dry-run-fixtures.js';

function evaluate(context, idempotencyKey, policyManifest = approvedTestPolicyManifest()) {
  return context.dryRunService.evaluateActualSourceDryRun(
    context.dryRunContext,
    dryRunCommand({ idempotencyKey, policyManifest }),
  );
}

function persistedCandidate(context, result) {
  const row = context.db.prepare(`
    SELECT status, blockerCodesJson
    FROM actual_source_dry_run_candidates
    WHERE runId = ?
  `).get(result.dryRunId);
  return { status: row.status, blockers: JSON.parse(row.blockerCodesJson) };
}

function assertBlocked(context, result, blocker) {
  assert.equal(result.eligibleCandidateCount, 0);
  assert.equal(result.blockedCandidateCount, 1);
  const candidate = persistedCandidate(context, result);
  assert.equal(candidate.status, 'blocked');
  assert.ok(candidate.blockers.includes(blocker), `${blocker}: ${candidate.blockers.join(', ')}`);
  const diagnostic = context.db.prepare(`
    SELECT code FROM actual_source_dry_run_diagnostics
    WHERE runId = ? AND code = ?
  `).get(result.dryRunId, blocker);
  assert.equal(diagnostic?.code, blocker);
}

test('signature requirement is bound to the exact conducted source policy identity and scope', async t => {
  const scenarios = [
    {
      name: 'matching not_required may pass',
      expectedEligible: true,
    },
    {
      name: 'different policy ref with not_required blocks',
      policy: approvedTestPolicyManifest({
        gates: { client_signature_requirement: { expectedSourceRef: 'different-signature-policy' } },
      }),
      blocker: 'SIGNATURE_POLICY_REFERENCE_MISMATCH',
    },
    {
      name: 'missing conducted source policy ref blocks',
      seed: { conduct: { signatureRequirementPolicyRef: null } },
      blocker: 'SIGNATURE_POLICY_REFERENCE_MISSING',
    },
    {
      name: 'missing gate expected policy ref blocks',
      policy: approvedTestPolicyManifest({
        gates: { client_signature_requirement: { expectedSourceRef: null } },
      }),
      blocker: 'SIGNATURE_POLICY_REFERENCE_MISSING',
    },
    {
      name: 'cross-company applicability blocks',
      policy: approvedTestPolicyManifest({
        gates: { client_signature_requirement: { scope: { companyId: 'company-b', branchId: 'branch-a-1' } } },
      }),
      blocker: 'SIGNATURE_POLICY_REFERENCE_MISMATCH',
    },
    {
      name: 'cross-contract applicability blocks',
      policy: approvedTestPolicyManifest({
        gates: { client_signature_requirement: { scope: { companyId: 'company-a', branchId: 'branch-a-1', contractId: 'contract-other' } } },
      }),
      blocker: 'SIGNATURE_POLICY_REFERENCE_MISMATCH',
    },
    {
      name: 'required without evidence blocks',
      policy: approvedTestPolicyManifest({
        gates: { client_signature_requirement: { decisionValue: 'required' } },
      }),
      blocker: 'REQUIRED_SIGNATURE_EVIDENCE_MISSING',
    },
    {
      name: 'required with exact evidence may pass',
      seed: { conduct: { clientSignatureEvidenceRef: 'signature-evidence-test-v1' } },
      policy: approvedTestPolicyManifest({
        gates: { client_signature_requirement: { decisionValue: 'required' } },
      }),
      expectedEligible: true,
    },
  ];

  for (const [index, scenario] of scenarios.entries()) {
    await t.test(scenario.name, () => {
      const context = createActualSourceDryRunContext();
      try {
        seedPositiveSource(context, scenario.seed || {});
        const result = evaluate(context, `signature-remediation-${index}`, scenario.policy);
        if (scenario.expectedEligible) {
          assert.equal(result.eligibleCandidateCount, 1);
          assert.equal(persistedCandidate(context, result).status, 'eligible_candidate');
        } else {
          assertBlocked(context, result, scenario.blocker);
        }
      } finally {
        context.close();
      }
    });
  }
});

test('adapter authority covers the complete source-owned candidate lineage', async t => {
  const baseEvidence = completeEvidence();
  const extraEvidence = {
    ...baseEvidence[0],
    evidenceType: 'other_explicit',
    sourceSystem: 'unapproved_extra_adapter',
    sourceId: 'extra-source-1',
    sourceEventId: 'extra-event-1',
  };
  const scenarios = [
    { name: 'complete approved ownership manifest may pass', expectedEligible: true },
    {
      name: 'rental line source mismatch blocks',
      seed: { close: { rentalLineSourceSystem: 'unapproved_rental_adapter' } },
    },
    {
      name: 'effective terms source mismatch blocks',
      seed: { close: { effectiveTermsSourceSystem: 'unapproved_terms_adapter' } },
    },
    {
      name: 'snapshot evidence source mismatch blocks',
      seed: { evidence: completeEvidence({ contract: { sourceSystem: 'unapproved_evidence_adapter' } }) },
    },
    {
      name: 'UPD source mismatch blocks',
      seed: { form: { updSourceSystem: 'unapproved_upd_adapter' } },
    },
    {
      name: 'conducted evidence ownership mismatch blocks through its UPD owner',
      seed: { form: { updSourceSystem: 'unapproved_conducted_owner' } },
    },
    {
      name: 'UPD line version monetary source mismatch blocks',
      seed: { form: { lineSourceSystem: 'unapproved_line_adapter' } },
    },
    {
      name: 'extra source system in relevant evidence manifest blocks',
      seed: { evidence: [...baseEvidence, extraEvidence] },
    },
  ];

  for (const [index, scenario] of scenarios.entries()) {
    await t.test(scenario.name, () => {
      const context = createActualSourceDryRunContext();
      try {
        seedPositiveSource(context, scenario.seed || {});
        const result = evaluate(context, `adapter-remediation-${index}`);
        if (scenario.expectedEligible) {
          assert.equal(result.eligibleCandidateCount, 1);
        } else {
          assertBlocked(context, result, 'SOURCE_ADAPTER_AUTHORITY_MISMATCH');
        }
      } finally {
        context.close();
      }
    });
  }
});
