import { createRequire } from 'node:module';
import {
  SOURCE_CAPABILITIES,
  closePlan,
  conductPlan,
  createBillingSourceContext,
  formPlan,
  hash,
  insertActivationBoundary,
} from './billing-source-authority-fixtures.js';

const require = createRequire(import.meta.url);
const {
  ensureForecastReceivablesPlanningSchema,
} = require('../server/lib/forecast-receivables-planning-schema.js');
const {
  ensureActualSourceEligibilityDryRunSchema,
} = require('../server/lib/actual-source-eligibility-dry-run-schema.js');
const {
  createActualSourceEligibilityDryRunService,
} = require('../server/lib/actual-source-eligibility-dry-run-service.js');
const {
  createActualSourceEligibilityDryRunReadRepository,
  createActualSourceEligibilityDryRunReadScope,
} = require('../server/lib/actual-source-eligibility-dry-run-read-repository.js');

export const PR8_CAPABILITIES = Object.freeze([...SOURCE_CAPABILITIES, 'receivables.read']);

function evidence(type, overrides = {}) {
  return {
    evidenceType: type,
    sourceSystem: 'isolated_test_adapter',
    sourceId: `${type}-source-1`,
    sourceVersion: 1,
    sourceEventId: `${type}-event-1`,
    sourceEventVersion: 1,
    coveredStartDate: overrides.coveredStartDate || '2026-08-01',
    coveredEndDateExclusive: overrides.coveredEndDateExclusive || '2026-09-01',
    authorityStatus: overrides.authorityStatus || 'approved_by_reference',
    authorityPolicyRef: overrides.authorityStatus === 'unresolved'
      ? null
      : `${type}-authority-policy-test-v1`,
    evidenceHash: hash(`${type}-evidence-1`),
  };
}

export function completeEvidence(overrides = {}) {
  return [
    'calculation_policy',
    'contract',
    'effective_terms',
    'rental',
    'rounding_policy',
    'vat_policy',
  ].map(type => evidence(type, overrides[type] || {}));
}

export function approvedTestPolicyManifest(overrides = {}) {
  const definitions = {
    accounting_source_sufficiency: {
      decisionValue: 'closed_period_conducted_upd_exact_mapping',
    },
    canonical_amount_basis: { decisionValue: 'slice_gross_minor' },
    conducted_evidence: {
      decisionValue: 'exact_conduct_event_required',
      expectedSourceRef: 'conduct-policy-decision-test-v1',
    },
    client_signature_requirement: { decisionValue: 'not_required' },
    contractual_due_date: { expectedSourceRef: 'contractual_payment_due_date' },
    unknown_due_date_treatment: { decisionValue: 'allow_unknown_without_aging' },
    vat_selection: { expectedSourceRef: 'vat-policy-test-v1' },
    vat_basis: { expectedSourceRef: 'policy-decision-test-v1' },
    rounding_mode_and_order: { expectedSourceRef: 'rounding-policy-test-v1' },
    rounding_residual_allocation: { decisionValue: 'zero_residual_required' },
    operational_event_authority: { decisionValue: 'exact_snapshot_evidence_only' },
    correction_cancellation_reopen_effect: { decisionValue: 'no_correction_or_reopen_lineage' },
    activation_boundary: { decisionValue: 'activation-a-1' },
    activation_cohort: { decisionValue: 'isolated-test-cohort' },
    source_adapter_authority: { decisionValue: 'isolated_test_adapter' },
  };
  const gates = Object.entries(definitions).map(([key, definition]) => ({
    key,
    status: 'approved_by_reference',
    decisionRef: `isolated-test-${key}-decision`,
    decisionVersion: 1,
    decisionHash: hash(`isolated-test-${key}-decision:v1`),
    schemaVersion: 1,
    scope: {
      companyId: 'company-a',
      branchId: 'branch-a-1',
    },
    ...definition,
  }));
  for (const [key, patch] of Object.entries(overrides.gates || {})) {
    const index = gates.findIndex(gate => gate.key === key);
    if (patch === null) gates.splice(index, 1);
    else gates[index] = { ...gates[index], ...patch };
  }
  return {
    manifestId: overrides.manifestId || 'isolated-test-pr8-policy',
    manifestVersion: overrides.manifestVersion || 1,
    schemaVersion: 1,
    gates,
  };
}

export function dryRunCommand(overrides = {}) {
  const command = {
    branchId: overrides.branchId || 'branch-a-1',
    asOfDate: overrides.asOfDate || '2026-09-15',
    idempotencyKey: overrides.idempotencyKey || 'actual-source-dry-run-1',
    correlationId: overrides.correlationId || 'actual-source-dry-run-correlation-1',
    reasonCode: overrides.reasonCode || 'ISOLATED_TEST_REVIEW',
    reasonText: overrides.reasonText || 'Artificial test-fixture dry run only',
  };
  if (overrides.policyManifest !== null) {
    command.policyManifest = overrides.policyManifest || approvedTestPolicyManifest();
  }
  if (overrides.expectedInputSetHash) command.expectedInputSetHash = overrides.expectedInputSetHash;
  if (overrides.expectedPolicyManifestHash) {
    command.expectedPolicyManifestHash = overrides.expectedPolicyManifestHash;
  }
  return command;
}

export function createActualSourceDryRunContext(options = {}) {
  const base = createBillingSourceContext({
    ...options,
    capabilities: options.capabilities || PR8_CAPABILITIES,
  });
  ensureForecastReceivablesPlanningSchema(base.db);
  ensureActualSourceEligibilityDryRunSchema(base.db);
  const dryRunService = createActualSourceEligibilityDryRunService({ db: base.db });
  const dryRunContext = dryRunService.createCommandContext(base.platformScope);
  const readRepository = createActualSourceEligibilityDryRunReadRepository(base.db);
  const readScope = createActualSourceEligibilityDryRunReadScope(base.platformScope, {
    branchId: options.readBranchId || 'branch-a-1',
  });
  return {
    ...base,
    dryRunService,
    dryRunContext,
    readRepository,
    readScope,
  };
}

export function seedPositiveSource(context, overrides = {}) {
  insertActivationBoundary(context, overrides.activationBoundary || {});
  const closed = context.service.closeBillingPeriod(context.commandContext, closePlan({
    evidence: overrides.evidence || completeEvidence(),
    ...(overrides.close || {}),
  }));
  const formed = context.service.formUpd(context.commandContext, formPlan(context, {
    ...(overrides.form || {}),
  }));
  const conducted = context.service.conductUpd(context.commandContext, conductPlan(context, {
    ...(overrides.conduct || {}),
  }));
  return { closed, formed, conducted };
}
