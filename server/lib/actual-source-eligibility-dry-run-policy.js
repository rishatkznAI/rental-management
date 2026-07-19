const {
  ACTUAL_SOURCE_DRY_RUN_CURRENCY,
  ACTUAL_SOURCE_DRY_RUN_EVALUATOR_VERSION,
  GATE_KEYS,
  assertActualSourceCommandPlan,
  fingerprint,
  safeAdd,
  stableJson,
} = require('./actual-source-eligibility-dry-run-domain');

const RECONCILIATION_RULE_VERSION = 'actual-source-zero-delta-v1';
const REQUIRED_SNAPSHOT_EVIDENCE_TYPES = Object.freeze([
  'calculation_policy',
  'contract',
  'effective_terms',
  'rental',
  'rounding_policy',
  'vat_policy',
]);

const GATE_BLOCKERS = Object.freeze({
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
});

function indexUniverse(universe) {
  const byKind = new Map();
  for (const input of universe.inputs) {
    if (!byKind.has(input.sourceKind)) byKind.set(input.sourceKind, []);
    byKind.get(input.sourceKind).push(input);
  }
  const rows = kind => byKind.get(kind) || [];
  const map = kind => new Map(rows(kind).map(input => [input.sourceId, input]));
  return Object.freeze({ rows, map });
}

function latestBy(rows, identityField) {
  const result = new Map();
  for (const input of rows) {
    const identity = input.row[identityField];
    const current = result.get(identity);
    const version = Number(input.row.version || input.row.sourceVersion || 0);
    const currentVersion = Number(current?.row.version || current?.row.sourceVersion || 0);
    if (!current || version > currentVersion || (version === currentVersion && input.sourceId > current.sourceId)) {
      result.set(identity, input);
    }
  }
  return result;
}

function sumRows(rows, field) {
  return safeAdd(rows.map(input => Number(input.row[field])), field);
}

function addBlocker(state, code) {
  state.blockers.add(code);
}

function check({ candidateKey, gateCode, outcome, gate = null, evidence = [], reasonCode = null, expected = null, observed = null }) {
  const canonical = {
    candidateKey,
    gateCode,
    outcome,
    policyDecisionRef: gate?.decisionRef || null,
    policyDecisionVersion: gate?.decisionVersion || null,
    policyDecisionHash: gate?.decisionHash || null,
    sourceEvidenceRefs: [...evidence].sort(),
    expectedFingerprint: expected == null ? null : fingerprint(expected),
    observedFingerprint: observed == null ? null : fingerprint(observed),
    reasonCode,
  };
  return Object.freeze({ ...canonical, checkHash: fingerprint(canonical) });
}

function diagnostic({
  candidateKey = null,
  code,
  sourceKind = null,
  sourceId = null,
  sourceVersion = null,
  start = null,
  end = null,
  expected = {},
  observed = {},
  policyReferences = [],
  severity = 'blocking',
}) {
  const canonical = {
    candidateKey,
    severity,
    code,
    sourceKind,
    sourceId,
    sourceVersion,
    affectedStartDate: start,
    affectedEndDateExclusive: end,
    expectedEvidence: expected,
    observedEvidence: observed,
    policyReferences: [...policyReferences].filter(Boolean).sort(),
    detectorVersion: ACTUAL_SOURCE_DRY_RUN_EVALUATOR_VERSION,
  };
  return Object.freeze({ ...canonical, diagnosticHash: fingerprint(canonical) });
}

function gateApplies(gate, context, candidate) {
  const scope = gate.scope;
  if (!scope) return true;
  return (
    (!scope.companyId || scope.companyId === context.companyId)
    && (!scope.branchId || scope.branchId === context.branchId)
    && (!scope.contractId || scope.contractId === candidate.contractId)
  );
}

function evaluateGateChecks(context, commandPlan, candidate, state) {
  const byKey = new Map(commandPlan.policyManifest.gates.map(gate => [gate.key, gate]));
  for (const key of GATE_KEYS) {
    const gate = byKey.get(key);
    const approved = gate?.status === 'approved_by_reference' && gateApplies(gate, context, candidate);
    const reasonCode = approved ? null : GATE_BLOCKERS[key];
    if (!approved) addBlocker(state, reasonCode);
    state.checks.push(check({
      candidateKey: candidate.candidateKey,
      gateCode: key,
      outcome: approved ? 'passed' : 'blocked',
      gate,
      reasonCode,
      expected: { status: 'approved_by_reference', scope: { companyId: context.companyId, branchId: context.branchId, contractId: candidate.contractId } },
      observed: gate || null,
    }));
  }
  return byKey;
}

function sourceCheck(state, candidate, gateCode, passed, reasonCode, evidence, expected, observed) {
  if (!passed) addBlocker(state, reasonCode);
  state.checks.push(check({
    candidateKey: candidate.candidateKey,
    gateCode,
    outcome: passed ? 'passed' : 'blocked',
    evidence,
    reasonCode: passed ? null : reasonCode,
    expected,
    observed,
  }));
}

function makeReconciliation(candidate, dimensionKind, dimensionIds, expected, observed, sourceInputHash) {
  const delta = {
    netMinor: observed.netMinor - expected.netMinor,
    vatMinor: observed.vatMinor - expected.vatMinor,
    grossMinor: observed.grossMinor - expected.grossMinor,
  };
  const canonical = {
    candidateKey: candidate.candidateKey,
    dimensionKind,
    dimensionIds,
    expected,
    observed,
    delta,
    currency: candidate.currency,
    reconciliationRuleVersion: RECONCILIATION_RULE_VERSION,
    sourceInputHash,
    blockerState: delta.netMinor !== 0 || delta.vatMinor !== 0 || delta.grossMinor !== 0,
  };
  return Object.freeze({ ...canonical, reconciliationHash: fingerprint(canonical) });
}

function applyReconciliation(state, candidate, reconciliation) {
  state.reconciliations.push(reconciliation);
  const codes = [];
  if (reconciliation.delta.netMinor !== 0) codes.push('NET_DELTA_NON_ZERO');
  if (reconciliation.delta.vatMinor !== 0) codes.push('VAT_DELTA_NON_ZERO');
  if (reconciliation.delta.grossMinor !== 0) codes.push('GROSS_DELTA_NON_ZERO');
  for (const code of codes) {
    addBlocker(state, code);
    state.diagnostics.push(diagnostic({
      candidateKey: candidate.candidateKey,
      code,
      sourceKind: reconciliation.dimensionKind,
      sourceId: stableJson(reconciliation.dimensionIds),
      start: candidate.sliceStartDate,
      end: candidate.sliceEndDateExclusive,
      expected: reconciliation.expected,
      observed: reconciliation.observed,
    }));
  }
}

function candidateSourceInputs(candidate, maps) {
  const references = [
    ['billing_source_activation_boundaries', candidate.activationBoundaryId],
    ['billing_source_rental_lines', candidate.rentalLineId],
    ['billing_source_periods', candidate.periodId],
    ['billing_source_period_versions', candidate.closedPeriodVersionId],
    ['billing_source_snapshots', candidate.snapshotId],
    ['billing_source_upds', candidate.updId],
    ['billing_source_upd_versions', candidate.formedUpdVersionId],
    ['billing_source_upd_lines', candidate.updLineId],
    ['billing_source_upd_line_versions', candidate.updLineVersionId],
    ['billing_source_coverage_sets', candidate.coverageSetId],
    ['billing_source_coverage_slices', candidate.coverageSliceId],
  ];
  if (candidate.currentConductedUpdVersionId) {
    references.push(['billing_source_upd_versions', candidate.currentConductedUpdVersionId]);
  }
  return references.map(([kind, id]) => maps.map(kind).get(id)).filter(Boolean);
}

function evaluateExactSlice(context, commandPlan, maps, source, lifecycle, latestPeriods, latestUpds, latestLines, activeSlices) {
  const slice = source.row;
  const coverage = maps.map('billing_source_coverage_sets').get(slice.coverageSetId);
  const period = maps.map('billing_source_periods').get(slice.periodId);
  const closeVersion = maps.map('billing_source_period_versions').get(slice.closedPeriodVersionId);
  const snapshot = maps.map('billing_source_snapshots').get(slice.snapshotId);
  const rentalLine = maps.map('billing_source_rental_lines').get(slice.rentalLineId);
  const boundary = maps.map('billing_source_activation_boundaries').get(rentalLine?.row.activationBoundaryId);
  const formed = maps.map('billing_source_upd_versions').get(slice.formedUpdVersionId);
  const latestUpd = latestUpds.get(slice.updId);
  const upd = maps.map('billing_source_upds').get(slice.updId);
  const updLine = maps.map('billing_source_upd_lines').get(slice.updLineId);
  const lineVersion = maps.map('billing_source_upd_line_versions').get(slice.updLineVersionId);
  const latestLine = latestLines.get(slice.updLineId);
  const latestPeriod = latestPeriods.get(slice.periodId);
  const terms = maps.map('billing_source_effective_terms').get(snapshot?.row.effectiveTermsVersionId);
  const termsSuccessor = terms
    ? maps.rows('billing_source_effective_terms').find(input => input.row.supersedesTermsVersionId === terms.sourceId)
    : null;

  const candidateBase = {
    companyId: context.companyId,
    branchId: context.branchId,
    activationBoundaryId: rentalLine?.row.activationBoundaryId || period?.row.activationBoundaryId || '',
    rentalLineId: slice.rentalLineId,
    rentalId: slice.rentalId,
    clientId: slice.clientId,
    contractId: slice.contractId ?? null,
    periodId: slice.periodId,
    closedPeriodVersionId: slice.closedPeriodVersionId,
    snapshotId: slice.snapshotId,
    updId: slice.updId,
    formedUpdVersionId: slice.formedUpdVersionId,
    currentConductedUpdVersionId: latestUpd?.row.state === 'conducted' ? latestUpd.sourceId : null,
    updLineId: slice.updLineId,
    updLineVersionId: slice.updLineVersionId,
    coverageSetId: slice.coverageSetId,
    coverageSliceId: source.sourceId,
    sliceStartDate: slice.sliceStartDate,
    sliceEndDateExclusive: slice.sliceEndDateExclusive,
    sourceNetMinor: Number(slice.allocatedNetMinor),
    sourceVatMinor: Number(slice.allocatedVatMinor),
    sourceGrossMinor: Number(slice.allocatedGrossMinor),
    currency: slice.currency,
    contractualDueDate: slice.contractualDueDate ?? null,
    dueDateProvenance: slice.dueDateProvenance,
    dueDateEvidenceRef: slice.dueDateEvidenceRef ?? null,
  };
  const candidateKey = fingerprint({
    candidateContractVersion: 'actual-source-slice-v1',
    ...candidateBase,
    closedPeriodVersion: closeVersion?.row.version || null,
    formedUpdVersion: formed?.row.version || null,
    currentConductedUpdVersion: latestUpd?.row.version || null,
    updLineVersion: lineVersion?.row.version || null,
    coverageSetVersion: coverage?.row.version || null,
  });
  const candidate = { ...candidateBase, candidateKey };
  const state = { blockers: new Set(), checks: [], reconciliations: [], diagnostics: [] };
  const gates = evaluateGateChecks(context, commandPlan, candidate, state);

  const completeLineage = Boolean(
    coverage && period && closeVersion && snapshot && rentalLine && boundary && formed
    && latestUpd && upd && updLine && lineVersion && latestPeriod && terms,
  );
  sourceCheck(
    state,
    candidate,
    'source_lineage_complete',
    completeLineage,
    'SOURCE_EVIDENCE_INCOMPLETE',
    candidateSourceInputs(candidate, maps).map(input => `${input.sourceKind}:${input.sourceId}`),
    { complete: true },
    { complete: completeLineage },
  );

  const scopeMatches = completeLineage && [
    coverage.row, period.row, closeVersion.row, snapshot.row, rentalLine.row, boundary.row,
    formed.row, latestUpd.row, upd.row, updLine.row, lineVersion.row,
  ].every(row => row.companyId === context.companyId && row.branchId === context.branchId)
    && period.row.rentalLineId === slice.rentalLineId
    && period.row.rentalId === slice.rentalId
    && snapshot.row.rentalLineId === slice.rentalLineId
    && snapshot.row.rentalId === slice.rentalId
    && rentalLine.row.rentalId === slice.rentalId
    && rentalLine.row.clientId === slice.clientId
    && (rentalLine.row.contractId ?? null) === (slice.contractId ?? null)
    && upd.row.clientId === slice.clientId
    && (upd.row.contractId ?? null) === (slice.contractId ?? null)
    && coverage.row.updId === slice.updId
    && coverage.row.formedUpdVersionId === slice.formedUpdVersionId
    && updLine.row.updId === slice.updId
    && lineVersion.row.updLineId === slice.updLineId
    && lineVersion.row.formedUpdVersionId === slice.formedUpdVersionId
    && snapshot.row.periodId === slice.periodId
    && snapshot.row.closedPeriodVersionId === slice.closedPeriodVersionId;
  sourceCheck(
    state,
    candidate,
    'exact_scope_and_relationships',
    scopeMatches,
    'COVERAGE_SCOPE_MISMATCH',
    [],
    { companyId: context.companyId, branchId: context.branchId, rentalId: slice.rentalId, clientId: slice.clientId, contractId: slice.contractId ?? null },
    completeLineage ? { rentalLine: rentalLine.row, period: period.row, snapshot: snapshot.row, upd: upd.row } : null,
  );

  const periodCurrentClosed = completeLineage
    && latestPeriod.sourceId === closeVersion.sourceId
    && latestPeriod.row.eventType === 'closed'
    && closeVersion.row.eventType === 'closed';
  const periodReason = latestPeriod?.row.eventType === 'reopened' ? 'PERIOD_REOPENED' : 'PERIOD_NOT_CURRENTLY_CLOSED';
  sourceCheck(
    state,
    candidate,
    'period_current_closed',
    periodCurrentClosed,
    periodReason,
    [closeVersion?.sourceId, latestPeriod?.sourceId].filter(Boolean),
    { latestVersionId: slice.closedPeriodVersionId, eventType: 'closed' },
    latestPeriod ? { latestVersionId: latestPeriod.sourceId, eventType: latestPeriod.row.eventType } : null,
  );

  const snapshotExact = completeLineage
    && snapshot.row.sourceIntegrityStatus === 'matched'
    && snapshot.row.coveredStartDate === period.row.periodStartDate
    && snapshot.row.coveredEndDateExclusive === period.row.periodEndDateExclusive
    && snapshot.row.coveredStartDate === slice.sliceStartDate
    && snapshot.row.coveredEndDateExclusive === slice.sliceEndDateExclusive
    && snapshot.row.effectiveTermsVersionId === terms.sourceId
    && terms.row.effectiveFromDate <= period.row.periodStartDate
    && terms.row.effectiveToDateExclusive >= period.row.periodEndDateExclusive
    && !termsSuccessor;
  sourceCheck(
    state,
    candidate,
    'snapshot_current_integrity',
    snapshotExact,
    snapshot?.row.sourceIntegrityStatus === 'blocked' ? 'SNAPSHOT_INTEGRITY_BLOCKED' : 'SOURCE_EVIDENCE_INCOMPLETE',
    [snapshot?.sourceId, terms?.sourceId].filter(Boolean),
    { exactGovernedInterval: true, sourceIntegrityStatus: 'matched', effectiveTermsCurrent: true },
    snapshot ? { coveredStartDate: snapshot.row.coveredStartDate, coveredEndDateExclusive: snapshot.row.coveredEndDateExclusive, sourceIntegrityStatus: snapshot.row.sourceIntegrityStatus, effectiveTermsCurrent: !termsSuccessor } : null,
  );

  const crossesBoundary = completeLineage && period.row.periodStartDate < boundary.row.firstGovernedPeriodStartDate;
  const activationGate = gates.get('activation_boundary');
  const cohortGate = gates.get('activation_cohort');
  const activationExact = completeLineage
    && !crossesBoundary
    && activationGate?.decisionValue === boundary.sourceId
    && cohortGate?.decisionValue === boundary.row.cohortReference;
  sourceCheck(
    state,
    candidate,
    'activation_exact_fully_governed',
    activationExact,
    crossesBoundary ? 'PARTIAL_GOVERNED_PERIOD' : 'ACTIVATION_BOUNDARY_UNRESOLVED',
    [boundary?.sourceId].filter(Boolean),
    { activationBoundaryId: boundary?.sourceId, cohortReference: boundary?.row.cohortReference, fullyGoverned: true },
    { decisionBoundary: activationGate?.decisionValue, decisionCohort: cohortGate?.decisionValue, fullyGoverned: !crossesBoundary },
  );

  const latestState = latestUpd?.row.state;
  const updCurrentConducted = completeLineage
    && latestState === 'conducted'
    && latestUpd.row.formedVersionId === formed.sourceId
    && formed.row.state === 'formed'
    && formed.row.sourceIntegrityStatus === 'matched'
    && latestUpd.row.sourceIntegrityStatus === 'matched'
    && lineVersion.row.sourceIntegrityStatus === 'matched'
    && latestLine?.sourceId === lineVersion.sourceId;
  const updReason = ['corrected', 'cancelled'].includes(latestState)
    ? 'UPD_CORRECTED_OR_CANCELLED'
    : 'UPD_NOT_CURRENTLY_CONDUCTED';
  sourceCheck(
    state,
    candidate,
    'upd_current_conducted',
    updCurrentConducted,
    updReason,
    [formed?.sourceId, latestUpd?.sourceId, lineVersion?.sourceId].filter(Boolean),
    { state: 'conducted', formedVersionId: formed?.sourceId, lineVersionCurrent: true },
    latestUpd ? { state: latestUpd.row.state, formedVersionId: latestUpd.row.formedVersionId, lineVersionCurrent: latestLine?.sourceId === lineVersion?.sourceId } : null,
  );

  const conductGate = gates.get('conducted_evidence');
  const conductEvidence = completeLineage
    && latestUpd.row.conductedEvidenceRef
    && latestUpd.row.conductedEvidenceVersion >= 1
    && typeof latestUpd.row.conductedEvidenceHash === 'string'
    && latestUpd.row.conductedEvidenceHash.length === 64
    && latestUpd.row.conductedPolicyDecisionRef
    && conductGate?.expectedSourceRef
    && conductGate.expectedSourceRef === latestUpd.row.conductedPolicyDecisionRef;
  sourceCheck(
    state,
    candidate,
    'conducted_evidence_complete',
    Boolean(conductEvidence),
    'CONDUCTED_EVIDENCE_MISSING',
    [latestUpd?.row.conductedEvidenceRef].filter(Boolean),
    { approvedPolicyRef: conductGate?.expectedSourceRef, evidenceHashPresent: true },
    latestUpd ? { policyRef: latestUpd.row.conductedPolicyDecisionRef, evidenceRef: latestUpd.row.conductedEvidenceRef, evidenceHash: latestUpd.row.conductedEvidenceHash } : null,
  );

  const signatureGate = gates.get('client_signature_requirement');
  const signatureRuleKnown = ['required', 'not_required'].includes(signatureGate?.decisionValue);
  const signatureSatisfied = signatureRuleKnown
    && (signatureGate.decisionValue === 'not_required' || Boolean(latestUpd?.row.clientSignatureEvidenceRef));
  sourceCheck(
    state,
    candidate,
    'client_signature_evidence',
    signatureSatisfied,
    signatureRuleKnown ? 'REQUIRED_SIGNATURE_EVIDENCE_MISSING' : 'SIGNATURE_REQUIREMENT_UNRESOLVED',
    [latestUpd?.row.clientSignatureEvidenceRef].filter(Boolean),
    { rule: signatureGate?.decisionValue },
    { evidenceRef: latestUpd?.row.clientSignatureEvidenceRef || null },
  );

  const coverageActive = completeLineage
    && coverage.row.status === 'validated'
    && !lifecycle.has(coverage.sourceId)
    && latestState === 'conducted';
  sourceCheck(
    state,
    candidate,
    'coverage_active_validated',
    coverageActive,
    'COVERAGE_NOT_ACTIVE_VALIDATED',
    [coverage?.sourceId].filter(Boolean),
    { status: 'validated', lifecycleSuccessor: false },
    coverage ? { status: coverage.row.status, lifecycleSuccessor: lifecycle.has(coverage.sourceId) } : null,
  );

  const evidence = maps.rows('billing_source_snapshot_evidence').filter(input => input.row.snapshotId === slice.snapshotId);
  const evidenceTypes = new Map();
  for (const input of evidence) {
    if (!evidenceTypes.has(input.row.evidenceType)) evidenceTypes.set(input.row.evidenceType, []);
    evidenceTypes.get(input.row.evidenceType).push(input);
  }
  const rejectedEvidence = evidence.some(input => input.row.authorityStatus === 'rejected');
  let evidenceComplete = !rejectedEvidence;
  for (const type of REQUIRED_SNAPSHOT_EVIDENCE_TYPES) {
    const matching = (evidenceTypes.get(type) || []).filter(input => (
      input.row.authorityStatus === 'approved_by_reference'
      && input.row.authorityPolicyRef
      && input.row.coveredStartDate <= slice.sliceStartDate
      && input.row.coveredEndDateExclusive >= slice.sliceEndDateExclusive
    ));
    if (matching.length !== 1) evidenceComplete = false;
  }
  for (const rows of evidenceTypes.values()) {
    const sorted = [...rows].sort((left, right) => left.row.coveredStartDate.localeCompare(right.row.coveredStartDate));
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].row.coveredStartDate < sorted[index - 1].row.coveredEndDateExclusive) {
        evidenceComplete = false;
      }
    }
  }
  sourceCheck(
    state,
    candidate,
    'snapshot_evidence_chain',
    evidenceComplete,
    rejectedEvidence ? 'SOURCE_EVIDENCE_REJECTED' : 'SOURCE_EVIDENCE_INCOMPLETE',
    evidence.map(input => `${input.row.evidenceType}:${input.sourceId}`),
    { requiredTypes: REQUIRED_SNAPSHOT_EVIDENCE_TYPES, exactNonOverlappingAuthority: true },
    { evidence: evidence.map(input => ({ type: input.row.evidenceType, status: input.row.authorityStatus, start: input.row.coveredStartDate, end: input.row.coveredEndDateExclusive })) },
  );

  const dueGate = gates.get('contractual_due_date');
  const unknownDueGate = gates.get('unknown_due_date_treatment');
  const dueKnown = slice.dueDateProvenance !== 'unknown';
  const dueValid = dueKnown
    ? Boolean(slice.contractualDueDate && slice.dueDateEvidenceRef && dueGate?.expectedSourceRef === slice.dueDateProvenance)
    : unknownDueGate?.decisionValue === 'allow_unknown_without_aging';
  sourceCheck(
    state,
    candidate,
    'contractual_due_date_evidence',
    dueValid,
    dueKnown ? 'DUE_DATE_POLICY_UNRESOLVED' : 'UNKNOWN_DUE_DATE_POLICY_UNRESOLVED',
    [slice.dueDateEvidenceRef].filter(Boolean),
    { provenance: dueKnown ? dueGate?.expectedSourceRef : 'unknown', unknownTreatment: unknownDueGate?.decisionValue },
    { contractualDueDate: slice.contractualDueDate, provenance: slice.dueDateProvenance, evidenceRef: slice.dueDateEvidenceRef },
  );

  const vatSelection = gates.get('vat_selection');
  const vatBasis = gates.get('vat_basis');
  const vatMatches = completeLineage
    && vatSelection?.expectedSourceRef
    && vatBasis?.expectedSourceRef
    && vatSelection.expectedSourceRef === snapshot.row.vatPolicyRef
    && vatSelection.expectedSourceRef === lineVersion.row.vatPolicyRef
    && vatBasis.expectedSourceRef === snapshot.row.policyDecisionRef
    && vatBasis.expectedSourceRef === lineVersion.row.policyDecisionRef;
  sourceCheck(
    state,
    candidate,
    'vat_policy_exact_match',
    Boolean(vatMatches),
    'VAT_POLICY_MISMATCH',
    [snapshot?.row.vatPolicyRef, lineVersion?.row.vatPolicyRef].filter(Boolean),
    { vatPolicyRef: vatSelection?.expectedSourceRef, vatBasisRef: vatBasis?.expectedSourceRef },
    completeLineage ? { snapshotVatPolicyRef: snapshot.row.vatPolicyRef, lineVatPolicyRef: lineVersion.row.vatPolicyRef, snapshotBasisRef: snapshot.row.policyDecisionRef, lineBasisRef: lineVersion.row.policyDecisionRef } : null,
  );

  const rounding = gates.get('rounding_mode_and_order');
  const residual = gates.get('rounding_residual_allocation');
  const roundingMatches = completeLineage
    && rounding?.expectedSourceRef
    && residual?.decisionValue === 'zero_residual_required'
    && rounding.expectedSourceRef === snapshot.row.roundingPolicyRef
    && rounding.expectedSourceRef === lineVersion.row.roundingPolicyRef;
  sourceCheck(
    state,
    candidate,
    'rounding_policy_exact_match',
    Boolean(roundingMatches),
    'ROUNDING_POLICY_MISMATCH',
    [snapshot?.row.roundingPolicyRef, lineVersion?.row.roundingPolicyRef].filter(Boolean),
    { roundingPolicyRef: rounding?.expectedSourceRef, residualRule: 'zero_residual_required' },
    completeLineage ? { snapshotRoundingPolicyRef: snapshot.row.roundingPolicyRef, lineRoundingPolicyRef: lineVersion.row.roundingPolicyRef, residualRule: residual?.decisionValue } : null,
  );

  const adapterGate = gates.get('source_adapter_authority');
  const adapterMatches = completeLineage
    && adapterGate?.decisionValue
    && adapterGate.decisionValue === rentalLine.row.sourceSystem
    && adapterGate.decisionValue === upd.row.sourceSystem;
  sourceCheck(
    state,
    candidate,
    'source_adapter_exact_match',
    Boolean(adapterMatches),
    'SOURCE_ADAPTER_AUTHORITY_UNRESOLVED',
    [],
    { sourceSystem: adapterGate?.decisionValue },
    completeLineage ? { rentalLineSourceSystem: rentalLine.row.sourceSystem, updSourceSystem: upd.row.sourceSystem } : null,
  );

  const duplicates = activeSlices.filter(input => (
    input.sourceId !== source.sourceId
    && input.row.periodId === slice.periodId
    && input.row.sliceStartDate < slice.sliceEndDateExclusive
    && slice.sliceStartDate < input.row.sliceEndDateExclusive
  ));
  sourceCheck(
    state,
    candidate,
    'duplicate_economic_coverage',
    duplicates.length === 0,
    'DUPLICATE_ECONOMIC_COVERAGE',
    duplicates.map(input => input.sourceId),
    { overlappingActiveSliceCount: 0 },
    { overlappingActiveSliceCount: duplicates.length },
  );

  const currencySupported = slice.currency === ACTUAL_SOURCE_DRY_RUN_CURRENCY
    && snapshot?.row.currency === ACTUAL_SOURCE_DRY_RUN_CURRENCY
    && lineVersion?.row.currency === ACTUAL_SOURCE_DRY_RUN_CURRENCY
    && upd?.row.currency === ACTUAL_SOURCE_DRY_RUN_CURRENCY;
  sourceCheck(
    state,
    candidate,
    'currency_supported',
    currencySupported,
    'UNSUPPORTED_CURRENCY',
    [],
    { currency: ACTUAL_SOURCE_DRY_RUN_CURRENCY },
    { slice: slice.currency, snapshot: snapshot?.row.currency, line: lineVersion?.row.currency, upd: upd?.row.currency },
  );

  sourceCheck(
    state,
    candidate,
    'candidate_amount_positive',
    Number(slice.allocatedGrossMinor) > 0,
    'NON_POSITIVE_CANDIDATE_AMOUNT',
    [],
    { grossMinorPositive: true },
    { grossMinor: Number(slice.allocatedGrossMinor) },
  );

  if (completeLineage) {
    const inputLineageHash = fingerprint(candidateSourceInputs(candidate, maps)
      .map(input => ({ sourceKind: input.sourceKind, sourceId: input.sourceId, normalizedInputHash: input.normalizedInputHash }))
      .sort((left, right) => stableJson(left).localeCompare(stableJson(right))));

    applyReconciliation(state, candidate, makeReconciliation(
      candidate,
      'snapshot_equation',
      { snapshotId: snapshot.sourceId },
      { netMinor: Number(snapshot.row.netMinor), vatMinor: Number(snapshot.row.vatMinor), grossMinor: Number(snapshot.row.grossMinor) },
      { netMinor: Number(snapshot.row.netMinor), vatMinor: Number(snapshot.row.vatMinor), grossMinor: Number(snapshot.row.netMinor) + Number(snapshot.row.vatMinor) },
      inputLineageHash,
    ));
    applyReconciliation(state, candidate, makeReconciliation(
      candidate,
      'upd_line_equation',
      { updLineVersionId: lineVersion.sourceId },
      { netMinor: Number(lineVersion.row.netMinor), vatMinor: Number(lineVersion.row.vatMinor), grossMinor: Number(lineVersion.row.grossMinor) },
      { netMinor: Number(lineVersion.row.netMinor), vatMinor: Number(lineVersion.row.vatMinor), grossMinor: Number(lineVersion.row.netMinor) + Number(lineVersion.row.vatMinor) },
      inputLineageHash,
    ));
    applyReconciliation(state, candidate, makeReconciliation(
      candidate,
      'coverage_slice_equation',
      { coverageSliceId: source.sourceId },
      { netMinor: Number(slice.allocatedNetMinor), vatMinor: Number(slice.allocatedVatMinor), grossMinor: Number(slice.allocatedGrossMinor) },
      { netMinor: Number(slice.allocatedNetMinor), vatMinor: Number(slice.allocatedVatMinor), grossMinor: Number(slice.allocatedNetMinor) + Number(slice.allocatedVatMinor) },
      inputLineageHash,
    ));
    const lineSlices = activeSlices.filter(input => input.row.updLineVersionId === slice.updLineVersionId);
    applyReconciliation(state, candidate, makeReconciliation(
      candidate,
      'upd_line_aggregate',
      { updLineVersionId: lineVersion.sourceId },
      { netMinor: Number(lineVersion.row.netMinor), vatMinor: Number(lineVersion.row.vatMinor), grossMinor: Number(lineVersion.row.grossMinor) },
      { netMinor: sumRows(lineSlices, 'allocatedNetMinor'), vatMinor: sumRows(lineSlices, 'allocatedVatMinor'), grossMinor: sumRows(lineSlices, 'allocatedGrossMinor') },
      inputLineageHash,
    ));
    const periodSlices = activeSlices.filter(input => input.row.closedPeriodVersionId === slice.closedPeriodVersionId);
    applyReconciliation(state, candidate, makeReconciliation(
      candidate,
      'closed_period_snapshot_aggregate',
      { closedPeriodVersionId: closeVersion.sourceId, snapshotId: snapshot.sourceId },
      { netMinor: Number(snapshot.row.netMinor), vatMinor: Number(snapshot.row.vatMinor), grossMinor: Number(snapshot.row.grossMinor) },
      { netMinor: sumRows(periodSlices, 'allocatedNetMinor'), vatMinor: sumRows(periodSlices, 'allocatedVatMinor'), grossMinor: sumRows(periodSlices, 'allocatedGrossMinor') },
      inputLineageHash,
    ));
    applyReconciliation(state, candidate, makeReconciliation(
      candidate,
      'coverage_set_delta',
      { coverageSetId: coverage.sourceId },
      { netMinor: 0, vatMinor: 0, grossMinor: 0 },
      { netMinor: Number(coverage.row.netDeltaMinor), vatMinor: Number(coverage.row.vatDeltaMinor), grossMinor: Number(coverage.row.grossDeltaMinor) },
      inputLineageHash,
    ));
  }

  const amountGate = gates.get('canonical_amount_basis');
  const amountBasisResolved = ['slice_gross_minor', 'slice_net_minor'].includes(amountGate?.decisionValue);
  if (!amountBasisResolved) addBlocker(state, 'CANONICAL_AMOUNT_BASIS_UNRESOLVED');
  const proposedOriginalAmountMinor = amountBasisResolved
    ? (amountGate.decisionValue === 'slice_gross_minor' ? candidate.sourceGrossMinor : candidate.sourceNetMinor)
    : null;
  const blockerCodes = [...state.blockers].sort();
  const diagnosedCodes = new Set(state.diagnostics.map(item => item.code));
  for (const code of blockerCodes) {
    if (diagnosedCodes.has(code)) continue;
    state.diagnostics.push(diagnostic({
      candidateKey,
      code,
      sourceKind: 'billing_source_coverage_slices',
      sourceId: candidate.coverageSliceId,
      start: candidate.sliceStartDate,
      end: candidate.sliceEndDateExclusive,
      expected: { blockingDiscrepancy: false },
      observed: { blockingDiscrepancy: true },
      policyReferences: commandPlan.policyManifest.gates
        .filter(gate => GATE_BLOCKERS[gate.key] === code)
        .map(gate => gate.decisionRef),
    }));
  }
  const status = blockerCodes.length === 0 ? 'eligible_candidate' : 'blocked';
  const inputLineageHash = fingerprint(candidateSourceInputs(candidate, maps)
    .map(input => ({ sourceKind: input.sourceKind, sourceId: input.sourceId, normalizedInputHash: input.normalizedInputHash }))
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right))));
  const resultCanonical = {
    candidateKey,
    sourceNetMinor: candidate.sourceNetMinor,
    sourceVatMinor: candidate.sourceVatMinor,
    sourceGrossMinor: candidate.sourceGrossMinor,
    proposedOriginalAmountMinor,
    status,
    blockerCodes,
    policyManifestHash: commandPlan.policyManifestHash,
    inputLineageHash,
    diagnosticOnly: true,
    canonicalWriteAuthorized: false,
    productionActivationAuthorized: false,
  };
  return Object.freeze({
    candidate: Object.freeze({
      ...candidate,
      proposedOriginalAmountMinor,
      status,
      blockerCodes: Object.freeze(blockerCodes),
      policyManifestHash: commandPlan.policyManifestHash,
      inputLineageHash,
      resultHash: fingerprint(resultCanonical),
      diagnosticOnly: true,
      canonicalWriteAuthorized: false,
      productionActivationAuthorized: false,
    }),
    checks: Object.freeze(state.checks),
    reconciliations: Object.freeze(state.reconciliations),
    diagnostics: Object.freeze(state.diagnostics),
  });
}

function buildRunLevelDiagnostics(context, maps, latestPeriods, latestUpds, sliceRows) {
  const diagnostics = [];
  const slicesByPeriod = new Map();
  const slicesByUpd = new Map();
  for (const input of sliceRows) {
    if (!slicesByPeriod.has(input.row.periodId)) slicesByPeriod.set(input.row.periodId, []);
    if (!slicesByUpd.has(input.row.updId)) slicesByUpd.set(input.row.updId, []);
    slicesByPeriod.get(input.row.periodId).push(input);
    slicesByUpd.get(input.row.updId).push(input);
  }
  for (const [periodId, latest] of latestPeriods) {
    const period = maps.map('billing_source_periods').get(periodId);
    if (latest.row.eventType === 'reopened') {
      diagnostics.push(diagnostic({
        code: 'PERIOD_REOPENED',
        sourceKind: 'billing_source_period_versions',
        sourceId: latest.sourceId,
        sourceVersion: Number(latest.row.version),
        start: period?.row.periodStartDate || null,
        end: period?.row.periodEndDateExclusive || null,
        expected: { eventType: 'closed' },
        observed: { eventType: latest.row.eventType },
      }));
    }
    if (latest.row.eventType === 'closed' && (slicesByPeriod.get(periodId) || []).length === 0) {
      diagnostics.push(diagnostic({
        code: 'COVERAGE_MISSING',
        sourceKind: 'billing_source_period_versions',
        sourceId: latest.sourceId,
        sourceVersion: Number(latest.row.version),
        start: period?.row.periodStartDate || null,
        end: period?.row.periodEndDateExclusive || null,
        expected: { exactCoverageSlice: true },
        observed: { coverageSliceCount: 0 },
      }));
    }
  }
  for (const [updId, latest] of latestUpds) {
    if (latest.row.state !== 'conducted') {
      diagnostics.push(diagnostic({
        code: ['cancelled', 'corrected'].includes(latest.row.state)
          ? 'UPD_CORRECTED_OR_CANCELLED'
          : 'UPD_NOT_CURRENTLY_CONDUCTED',
        sourceKind: 'billing_source_upd_versions',
        sourceId: latest.sourceId,
        sourceVersion: Number(latest.row.version),
        expected: { state: 'conducted' },
        observed: { state: latest.row.state },
      }));
    }
    if (latest.row.state === 'conducted' && (slicesByUpd.get(updId) || []).length === 0) {
      diagnostics.push(diagnostic({
        code: 'COVERAGE_MISSING',
        sourceKind: 'billing_source_upd_versions',
        sourceId: latest.sourceId,
        sourceVersion: Number(latest.row.version),
        expected: { exactCoverageSlice: true },
        observed: { coverageSliceCount: 0 },
      }));
    }
  }
  for (const snapshot of maps.rows('billing_source_snapshots')) {
    if (snapshot.row.sourceIntegrityStatus === 'blocked') {
      diagnostics.push(diagnostic({
        code: 'SNAPSHOT_INTEGRITY_BLOCKED',
        sourceKind: snapshot.sourceKind,
        sourceId: snapshot.sourceId,
        start: snapshot.row.coveredStartDate,
        end: snapshot.row.coveredEndDateExclusive,
        expected: { sourceIntegrityStatus: 'matched' },
        observed: { sourceIntegrityStatus: snapshot.row.sourceIntegrityStatus },
      }));
    }
  }
  const unique = new Map();
  for (const item of diagnostics) unique.set(item.diagnosticHash, item);
  return [...unique.values()].sort((left, right) => left.diagnosticHash.localeCompare(right.diagnosticHash));
}

function evaluateActualSourceEligibility(context, commandPlan, universe) {
  assertActualSourceCommandPlan(commandPlan);
  const maps = indexUniverse(universe);
  const periodVersions = maps.rows('billing_source_period_versions');
  const updVersions = maps.rows('billing_source_upd_versions');
  const lineVersions = maps.rows('billing_source_upd_line_versions');
  const sliceRows = maps.rows('billing_source_coverage_slices');
  const latestPeriods = latestBy(periodVersions, 'periodId');
  const latestUpds = latestBy(updVersions, 'updId');
  const latestLines = latestBy(lineVersions, 'updLineId');
  const lifecycle = new Map(maps.rows('billing_source_coverage_supersessions')
    .map(input => [input.row.originalCoverageSetId, input]));
  const coverageSets = maps.map('billing_source_coverage_sets');
  const activeSlices = sliceRows.filter(input => {
    const set = coverageSets.get(input.row.coverageSetId);
    const latest = latestUpds.get(input.row.updId);
    return set?.row.status === 'validated'
      && !lifecycle.has(set.sourceId)
      && !['cancelled', 'corrected'].includes(latest?.row.state);
  });

  const evaluated = sliceRows
    .map(source => evaluateExactSlice(
      { ...context, branchId: commandPlan.branchId },
      commandPlan,
      maps,
      source,
      lifecycle,
      latestPeriods,
      latestUpds,
      latestLines,
      activeSlices,
    ))
    .sort((left, right) => left.candidate.candidateKey.localeCompare(right.candidate.candidateKey));
  const candidates = evaluated.map(item => item.candidate);
  const runChecks = commandPlan.policyManifest.gates.map(gate => {
    const scopeMatches = !gate.scope
      || ((!gate.scope.companyId || gate.scope.companyId === context.companyId)
        && (!gate.scope.branchId || gate.scope.branchId === commandPlan.branchId));
    const passed = gate.status === 'approved_by_reference' && scopeMatches;
    return check({
      candidateKey: null,
      gateCode: gate.key,
      outcome: passed ? 'passed' : 'blocked',
      gate,
      reasonCode: passed ? null : GATE_BLOCKERS[gate.key],
      expected: { status: 'approved_by_reference', companyId: context.companyId, branchId: commandPlan.branchId },
      observed: gate,
    });
  });
  const checks = [...runChecks, ...evaluated.flatMap(item => item.checks)]
    .sort((left, right) => `${left.candidateKey}:${left.gateCode}`.localeCompare(`${right.candidateKey}:${right.gateCode}`));
  const reconciliations = evaluated.flatMap(item => item.reconciliations)
    .sort((left, right) => left.reconciliationHash.localeCompare(right.reconciliationHash));
  const diagnostics = [
    ...evaluated.flatMap(item => item.diagnostics),
    ...commandPlan.policyManifest.gates
      .filter(gate => gate.status !== 'approved_by_reference')
      .map(gate => diagnostic({
        code: GATE_BLOCKERS[gate.key],
        sourceKind: 'policy_gate_manifest',
        sourceId: gate.key,
        expected: { status: 'approved_by_reference' },
        observed: { status: gate.status },
        policyReferences: [gate.decisionRef],
      })),
    ...buildRunLevelDiagnostics(
      { ...context, branchId: commandPlan.branchId },
      maps,
      latestPeriods,
      latestUpds,
      sliceRows,
    ),
  ];
  const uniqueDiagnostics = new Map();
  for (const item of diagnostics) uniqueDiagnostics.set(`${item.candidateKey || ''}:${item.diagnosticHash}`, item);
  const sortedDiagnostics = [...uniqueDiagnostics.values()].sort((left, right) => (
    `${left.candidateKey || ''}:${left.diagnosticHash}`.localeCompare(`${right.candidateKey || ''}:${right.diagnosticHash}`)
  ));
  const eligible = candidates.filter(candidate => candidate.status === 'eligible_candidate');
  const blocked = candidates.filter(candidate => candidate.status === 'blocked');
  const totals = rows => ({
    netMinor: safeAdd(rows.map(row => row.sourceNetMinor), 'runNetMinor'),
    vatMinor: safeAdd(rows.map(row => row.sourceVatMinor), 'runVatMinor'),
    grossMinor: safeAdd(rows.map(row => row.sourceGrossMinor), 'runGrossMinor'),
  });
  const runTotals = totals(candidates);
  const eligibleTotals = totals(eligible);
  const status = candidates.length === 0
    ? 'completed_no_candidates'
    : (blocked.length > 0 || sortedDiagnostics.some(item => item.severity === 'blocking')
      ? 'completed_with_blockers'
      : 'completed');
  const resultCanonical = {
    resultContractVersion: 'actual-source-dry-run-result-v1',
    policyManifestHash: commandPlan.policyManifestHash,
    sourceInputManifestHash: universe.inputSetHash,
    status,
    counts: {
      sourceInputCount: universe.inputs.length,
      candidateCount: candidates.length,
      checkCount: checks.length,
      reconciliationCount: reconciliations.length,
      diagnosticCount: sortedDiagnostics.length,
      eligibleCandidateCount: eligible.length,
      blockedCandidateCount: blocked.length,
    },
    runTotals,
    eligibleTotals,
    candidateResults: candidates.map(candidate => ({ candidateKey: candidate.candidateKey, resultHash: candidate.resultHash })),
    checkHashes: checks.map(item => item.checkHash),
    reconciliationHashes: reconciliations.map(item => item.reconciliationHash),
    diagnosticHashes: sortedDiagnostics.map(item => item.diagnosticHash),
    diagnosticOnly: true,
    canonicalWriteAuthorized: false,
    productionActivationAuthorized: false,
  };
  return Object.freeze({
    candidates: Object.freeze(candidates),
    checks: Object.freeze(checks),
    reconciliations: Object.freeze(reconciliations),
    diagnostics: Object.freeze(sortedDiagnostics),
    result: Object.freeze({
      ...resultCanonical,
      resultHash: fingerprint(resultCanonical),
    }),
  });
}

function createUnavailableActualSourcePolicyManifest() {
  return null;
}

module.exports = {
  GATE_BLOCKERS,
  RECONCILIATION_RULE_VERSION,
  REQUIRED_SNAPSHOT_EVIDENCE_TYPES,
  createUnavailableActualSourcePolicyManifest,
  evaluateActualSourceEligibility,
};
