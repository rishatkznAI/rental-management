const crypto = require('crypto');
const {
  assertBranchScope,
  assertCapability,
  assertCompanyScope,
  assertScopeFresh,
  nonDisclosingNotFound,
} = require('./platform-authorization');
const {
  createPlatformIdentityRepository,
} = require('./platform-identity-repository');
const {
  FORECAST_CURRENCY,
  FORECAST_INPUT_CONTRACT_VERSION,
  FORECAST_RECEIVABLES_SCHEMA_VERSION,
  ForecastReceivablesPlanningError,
  assertForecastCommandContext,
  assertPreparedForecastPlan,
  computeForecastCoverageKey,
  fingerprint,
  safeAdd,
  stableJson,
} = require('./forecast-receivables-planning-domain');
const {
  FORECAST_RECEIVABLE_AUDIT_EVENTS_TABLE,
  FORECAST_RECEIVABLE_DIAGNOSTICS_TABLE,
  FORECAST_RECEIVABLE_INPUT_EVENTS_TABLE,
  FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE,
  FORECAST_RECEIVABLE_ITEMS_TABLE,
  FORECAST_RECEIVABLE_OPERATIONS_TABLE,
  FORECAST_RECEIVABLE_RUNS_TABLE,
  FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE,
  assertForecastReceivablesPlanningStructure,
} = require('./forecast-receivables-planning-schema');

const OPERATION_TYPE = 'calculate_forecast_run';
const CAPABILITY_KEY = 'forecast.calculate';

function fail(code, message, field, status = 409) {
  throw new ForecastReceivablesPlanningError(code, message, field, status);
}

function generateId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function same(left, right) {
  return stableJson(left) === stableJson(right);
}

function canonicalEvent(event) {
  return {
    eventKind: event.eventKind,
    sourceSystem: event.sourceSystem,
    sourceId: event.sourceId,
    sourceVersion: event.sourceVersion,
    sourceEventId: event.sourceEventId,
    sourceEventVersion: event.sourceEventVersion,
    effectiveStartDate: event.effectiveStartDate,
    effectiveEndDateExclusive: event.effectiveEndDateExclusive,
    authorityStatus: event.authorityStatus,
    authorityPolicyRef: event.authorityPolicyRef,
    evidenceHash: event.evidenceHash,
  };
}

function canonicalInput(input) {
  return {
    rentalLineId: input.rentalLineId,
    activationBoundaryId: input.activationBoundaryId,
    activationBoundarySourceHash: input.activationBoundarySourceHash,
    effectiveTermsVersionId: input.effectiveTermsVersionId,
    effectiveTermsSourceVersion: input.effectiveTermsSourceVersion,
    effectiveTermsSourceHash: input.effectiveTermsSourceHash,
    clientId: input.clientId,
    contractId: input.contractId,
    rentalId: input.rentalId,
    equipmentId: input.equipmentId,
    rentalStatus: input.rentalStatus,
    componentKind: input.componentKind,
    serviceStartDate: input.serviceStartDate,
    serviceEndDateExclusive: input.serviceEndDateExclusive,
    candidateStartDate: input.candidateStartDate,
    candidateEndDateExclusive: input.candidateEndDateExclusive,
    sourceSystem: input.sourceSystem,
    sourceIdentity: input.sourceIdentity,
    sourceEventId: input.sourceEventId,
    sourceEventVersion: input.sourceEventVersion,
    sourceHash: input.sourceHash,
    completenessManifest: input.completenessManifest,
    events: input.events.map(canonicalEvent).sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
  };
}

function canonicalInputSet(plan) {
  return {
    inputContractVersion: FORECAST_INPUT_CONTRACT_VERSION,
    branchId: plan.branchId,
    asOfDate: plan.asOfDate,
    horizonStartDate: plan.horizonStartDate,
    horizonEndDateExclusive: plan.horizonEndDateExclusive,
    inputSetManifest: plan.inputSetManifest,
    inputs: plan.inputs.map(canonicalInput).sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
  };
}

function inputSourceHash(input) {
  return fingerprint({
    inputContractVersion: FORECAST_INPUT_CONTRACT_VERSION,
    input: canonicalInput(input),
  });
}

function parseCanonicalJson(value, field, expectedType) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail('FORECAST_RECONCILIATION_FAILED', `Persisted ${field} is not valid JSON.`, field, 500);
  }
  if (
    stableJson(parsed) !== value
    || (expectedType === 'array' && !Array.isArray(parsed))
    || (expectedType === 'object' && (!parsed || Array.isArray(parsed) || typeof parsed !== 'object'))
  ) fail('FORECAST_RECONCILIATION_FAILED', `Persisted ${field} is not canonical.`, field, 500);
  return parsed;
}

function canonicalDiagnostic(diagnostic) {
  return {
    rentalLineId: diagnostic.rentalLineId,
    componentKind: diagnostic.componentKind,
    affectedStartDate: diagnostic.affectedStartDate,
    affectedEndDateExclusive: diagnostic.affectedEndDateExclusive,
    severity: diagnostic.severity,
    confidence: 'insufficient',
    reasonCode: diagnostic.reasonCode,
    sourceIdentity: diagnostic.sourceIdentity,
    sourceHash: diagnostic.sourceHash,
    policyRef: diagnostic.policyRef,
  };
}

function canonicalItem(item) {
  return {
    forecastCoverageKey: item.forecastCoverageKey,
    componentKind: item.componentKind,
    clientId: item.clientId,
    contractId: item.contractId,
    rentalId: item.rentalId,
    rentalLineId: item.rentalLineId,
    effectiveTermsVersionId: item.effectiveTermsVersionId,
    coverageStartDate: item.coverageStartDate,
    coverageEndDateExclusive: item.coverageEndDateExclusive,
    currency: item.currency,
    netAmountMinor: item.netAmountMinor,
    vatAmountMinor: item.vatAmountMinor,
    grossAmountMinor: item.grossAmountMinor,
    calculationVersion: item.calculationVersion,
    calculationPolicyRef: item.calculationPolicyRef,
    vatPolicyRef: item.vatPolicyRef,
    roundingPolicyRef: item.roundingPolicyRef,
    policyDecisionRef: item.policyDecisionRef,
    confidence: item.confidence,
    confidenceReasonCodes: item.confidenceReasonCodes,
    normalizedCalculationEvidence: item.normalizedCalculationEvidence,
    itemSourceHash: item.itemSourceHash,
  };
}

function computeItemResultHash(item) {
  return fingerprint(canonicalItem(item));
}

function totalsFor(items) {
  const select = kind => items.filter(item => item.componentKind === kind);
  const sum = (rows, field) => safeAdd(rows.map(row => row[field]), field);
  const open = select('open_period_forecast');
  const future = select('planned_future');
  const totals = {
    openPeriodForecastNetMinor: sum(open, 'netAmountMinor'),
    openPeriodForecastVatMinor: sum(open, 'vatAmountMinor'),
    openPeriodForecastGrossMinor: sum(open, 'grossAmountMinor'),
    plannedFutureNetMinor: sum(future, 'netAmountMinor'),
    plannedFutureVatMinor: sum(future, 'vatAmountMinor'),
    plannedFutureGrossMinor: sum(future, 'grossAmountMinor'),
  };
  if (
    safeAdd([totals.openPeriodForecastNetMinor, totals.openPeriodForecastVatMinor])
      !== totals.openPeriodForecastGrossMinor
    || safeAdd([totals.plannedFutureNetMinor, totals.plannedFutureVatMinor])
      !== totals.plannedFutureGrossMinor
  ) fail('FORECAST_RECONCILIATION_FAILED', 'Forecast totals do not reconcile.', 'items');
  return Object.freeze({
    ...totals,
    primaryForecastMinor: totals.openPeriodForecastGrossMinor,
  });
}

function statusFor(items, diagnostics) {
  const blocking = diagnostics.filter(item => item.severity === 'blocking').length;
  if (blocking === 0) return Object.freeze({ status: 'calculated', completenessState: 'complete' });
  if (items.length > 0) return Object.freeze({ status: 'calculated_with_gaps', completenessState: 'gaps' });
  return Object.freeze({ status: 'insufficient', completenessState: 'insufficient' });
}

function resultHashFor(plan, items, diagnostics, totals, status) {
  return fingerprint({
    resultContractVersion: 'forecast-result-v1',
    planningSeriesKey: plan.planningSeriesKey,
    asOfDate: plan.asOfDate,
    horizonStartDate: plan.horizonStartDate,
    horizonEndDateExclusive: plan.horizonEndDateExclusive,
    calculationVersion: plan.calculationVersion,
    confidencePolicyVersion: plan.confidencePolicyVersion,
    coveragePolicyVersion: plan.coveragePolicyVersion,
    currency: FORECAST_CURRENCY,
    status,
    totals,
    items: items.map(item => ({ ...canonicalItem(item), itemResultHash: item.itemResultHash }))
      .sort((left, right) => left.forecastCoverageKey.localeCompare(right.forecastCoverageKey)),
    diagnostics: diagnostics.map(canonicalDiagnostic)
      .sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
  });
}

function commandFingerprint(context, plan, inputSetHash) {
  const slices = plan.calculatedSlices.map(slice => ({
    input: canonicalInput(plan.inputs[slice.inputIndex]),
    coverageStartDate: slice.coverageStartDate,
    coverageEndDateExclusive: slice.coverageEndDateExclusive,
    calculationVersion: slice.calculationVersion,
    calculationPolicyRef: slice.calculationPolicyRef,
    vatPolicyRef: slice.vatPolicyRef,
    roundingPolicyRef: slice.roundingPolicyRef,
    policyDecisionRef: slice.policyDecisionRef,
    confidencePolicyVersion: slice.confidencePolicyVersion,
    coveragePolicyVersion: slice.coveragePolicyVersion,
    netAmountMinor: slice.netAmountMinor,
    vatAmountMinor: slice.vatAmountMinor,
    grossAmountMinor: slice.grossAmountMinor,
    confidence: slice.confidence,
    reasonCodes: slice.reasonCodes,
    normalizedCalculationEvidence: slice.normalizedCalculationEvidence,
  })).sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  return fingerprint({
    operationType: OPERATION_TYPE,
    companyId: context.companyId,
    branchId: plan.branchId,
    principalId: context.principalId,
    membershipId: context.membershipId,
    membershipVersion: context.membershipVersion,
    roleTemplateKey: context.roleTemplateKey,
    roleTemplateVersion: context.roleTemplateVersion,
    capabilityCatalogVersion: context.capabilityCatalogVersion,
    capabilityKey: CAPABILITY_KEY,
    asOfDate: plan.asOfDate,
    idempotencyKey: plan.idempotencyKey,
    correlationId: plan.correlationId,
    expectedActiveRunIds: plan.expectedActiveRunIds,
    expectedInputSetHash: plan.expectedInputSetHash,
    inputSetHash,
    planningSeriesKey: plan.planningSeriesKey,
    calculationVersion: plan.calculationVersion,
    confidencePolicyVersion: plan.confidencePolicyVersion,
    coveragePolicyVersion: plan.coveragePolicyVersion,
    reasonCode: plan.reasonCode,
    reasonText: plan.reasonText,
    calculatedSlices: slices,
    diagnostics: plan.diagnostics.map(canonicalDiagnostic)
      .sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
  });
}

function createForecastReceivablesPlanningRepository(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    fail('FORECAST_DATABASE_REQUIRED', 'A better-sqlite3 database is required.', 'db', 500);
  }
  assertForecastReceivablesPlanningStructure(db);

  function readUsers() {
    const row = db.prepare(`
      SELECT json FROM app_data WHERE name = 'users'
    `).get();
    if (!row) return [];
    try {
      const users = JSON.parse(row.json);
      return Array.isArray(users) ? users : [];
    } catch {
      return [];
    }
  }

  const platformRepository = createPlatformIdentityRepository(db, { readUsers });

  function authorize(context, plan) {
    assertForecastCommandContext(context);
    assertPreparedForecastPlan(plan);
    assertScopeFresh(context, { repository: platformRepository, readUsers });
    assertCapability(context, CAPABILITY_KEY);
    assertCompanyScope(context, context.companyId);
    assertBranchScope(context, plan.branchId);
    const branch = db.prepare(`
      SELECT id FROM canonical_branches
      WHERE companyId = ? AND id = ? AND status = 'active'
    `).get(context.companyId, plan.branchId);
    if (!branch) nonDisclosingNotFound();
  }

  function activeRuns(context, plan) {
    return db.prepare(`
      SELECT run.id, run.resultHash, run.calculatedAt
      FROM ${FORECAST_RECEIVABLE_RUNS_TABLE} run
      WHERE run.companyId = ? AND run.branchId = ? AND run.planningSeriesKey = ?
        AND NOT EXISTS (
          SELECT 1 FROM ${FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE} lifecycle
          WHERE lifecycle.predecessorRunId = run.id
        )
      ORDER BY run.id
    `).all(context.companyId, plan.branchId, plan.planningSeriesKey);
  }

  function replayOrConflict(context, plan, calculatedInputSetHash, calculatedCommandFingerprint) {
    const row = db.prepare(`
      SELECT * FROM ${FORECAST_RECEIVABLE_OPERATIONS_TABLE}
      WHERE companyId = ? AND operationType = ? AND idempotencyKey = ?
    `).get(context.companyId, OPERATION_TYPE, plan.idempotencyKey);
    if (!row) return null;
    if (
      row.branchId !== plan.branchId
      || row.actorPrincipalId !== context.principalId
      || row.actorMembershipId !== context.membershipId
      || Number(row.actorMembershipVersion) !== context.membershipVersion
      || row.roleTemplateKey !== context.roleTemplateKey
      || Number(row.roleTemplateVersion) !== context.roleTemplateVersion
      || Number(row.capabilityCatalogVersion) !== context.capabilityCatalogVersion
      || row.capabilityKey !== CAPABILITY_KEY
      || row.inputSetHash !== calculatedInputSetHash
      || row.commandFingerprint !== calculatedCommandFingerprint
    ) fail('FORECAST_IDEMPOTENCY_CONFLICT', 'The idempotency key was used with different input or authority.', 'idempotencyKey');
    const run = db.prepare(`
      SELECT * FROM ${FORECAST_RECEIVABLE_RUNS_TABLE}
      WHERE companyId = ? AND branchId = ? AND id = ?
    `).get(context.companyId, plan.branchId, row.resultRunId);
    if (!run || run.resultHash !== row.resultHash) {
      fail('FORECAST_RECONCILIATION_FAILED', 'Persisted idempotent result is unavailable.', 'idempotencyKey', 500);
    }
    return Object.freeze({ ...projectRun(run), operationId: row.id, replayed: true });
  }

  function sourceDrift(field) {
    fail('FORECAST_SOURCE_VERSION_DRIFT', 'Referenced billing-source authority drifted.', field);
  }

  function validateSource(input, context) {
    const rentalLine = db.prepare(`
      SELECT * FROM billing_source_rental_lines
      WHERE companyId = ? AND branchId = ? AND id = ?
    `).get(context.companyId, input.branchId || context.branchId, input.rentalLineId);
    if (!rentalLine) nonDisclosingNotFound();
    const expectedLine = {
      activationBoundaryId: input.activationBoundaryId,
      clientId: input.clientId,
      contractId: input.contractId,
      rentalId: input.rentalId,
      equipmentId: input.equipmentId,
      sourceSystem: input.sourceSystem,
      sourceLineRef: input.sourceIdentity,
      sourceEventId: input.sourceEventId,
      sourceEventVersion: input.sourceEventVersion,
      provenanceHash: input.sourceHash,
    };
    for (const [field, value] of Object.entries(expectedLine)) {
      if ((rentalLine[field] ?? null) !== (value ?? null)) sourceDrift(`inputs.${input.rentalLineId}.${field}`);
    }

    const boundary = db.prepare(`
      SELECT * FROM billing_source_activation_boundaries
      WHERE companyId = ? AND branchId = ? AND id = ?
    `).get(context.companyId, context.branchId, input.activationBoundaryId);
    if (!boundary || boundary.sourceHash !== input.activationBoundarySourceHash) {
      sourceDrift(`inputs.${input.rentalLineId}.activationBoundaryId`);
    }

    const terms = db.prepare(`
      SELECT * FROM billing_source_effective_terms
      WHERE companyId = ? AND branchId = ? AND id = ? AND rentalLineId = ?
    `).get(context.companyId, context.branchId, input.effectiveTermsVersionId, input.rentalLineId);
    if (
      !terms
      || Number(terms.sourceVersion) !== input.effectiveTermsSourceVersion
      || terms.sourceHash !== input.effectiveTermsSourceHash
      || terms.currency !== FORECAST_CURRENCY
    ) sourceDrift(`inputs.${input.rentalLineId}.effectiveTermsVersionId`);
    const successor = db.prepare(`
      SELECT id FROM billing_source_effective_terms
      WHERE companyId = ? AND branchId = ? AND supersedesTermsVersionId = ?
      LIMIT 1
    `).get(context.companyId, context.branchId, terms.id);
    if (successor) sourceDrift(`inputs.${input.rentalLineId}.effectiveTermsVersionId`);

    const blockers = [];
    if (!input.contractId || input.contractId !== rentalLine.contractId) {
      blockers.push('FORECAST_EFFECTIVE_TERMS_UNAVAILABLE');
    }
    if (
      terms.effectiveFromDate > input.candidateStartDate
      || terms.effectiveToDateExclusive < input.candidateEndDateExclusive
      || boundary.firstGovernedPeriodStartDate > input.candidateStartDate
    ) blockers.push('FORECAST_EFFECTIVE_TERMS_UNAVAILABLE');
    if (
      terms.policyResolutionStatus !== 'resolved'
      || !terms.calculationPolicyRef
      || !terms.vatPolicyRef
      || !terms.roundingPolicyRef
      || !terms.policyDecisionRef
    ) blockers.push('FORECAST_EFFECTIVE_TERMS_UNRESOLVED');
    return Object.freeze({ rentalLine, boundary, terms, blockers: [...new Set(blockers)].sort() });
  }

  function latestClosedOverlaps(context, input, slice) {
    return db.prepare(`
      SELECT period.*, latest.id AS latestVersionId, latest.eventType AS latestEventType
      FROM billing_source_periods period
      JOIN billing_source_period_versions latest
        ON latest.companyId = period.companyId
       AND latest.branchId = period.branchId
       AND latest.periodId = period.id
       AND latest.version = (
         SELECT MAX(version) FROM billing_source_period_versions versioned
         WHERE versioned.companyId = period.companyId
           AND versioned.branchId = period.branchId
           AND versioned.periodId = period.id
       )
      WHERE period.companyId = ? AND period.branchId = ? AND period.rentalLineId = ?
        AND latest.eventType = 'closed'
        AND period.periodStartDate < ?
        AND ? < period.periodEndDateExclusive
      ORDER BY period.periodStartDate, period.periodEndDateExclusive, period.id
    `).all(
      context.companyId,
      context.branchId,
      input.rentalLineId,
      slice.coverageEndDateExclusive,
      slice.coverageStartDate,
    );
  }

  function buildCommittedResult(context, plan, sourceStates) {
    const diagnostics = [...plan.diagnostics];
    const blockedInputs = new Set();
    sourceStates.forEach((state, inputIndex) => {
      for (const reasonCode of state.blockers) {
        blockedInputs.add(inputIndex);
        const input = plan.inputs[inputIndex];
        diagnostics.push({
          inputIndex,
          rentalLineId: input.rentalLineId,
          componentKind: input.componentKind,
          affectedStartDate: input.candidateStartDate,
          affectedEndDateExclusive: input.candidateEndDateExclusive,
          severity: 'blocking',
          reasonCode,
          sourceIdentity: input.sourceIdentity,
          sourceHash: input.sourceHash,
          policyRef: null,
        });
      }
    });

    const exactlyClosedInputs = new Set();
    plan.inputs.forEach((input, inputIndex) => {
      if (blockedInputs.has(inputIndex)) return;
      const slices = plan.calculatedSlices.filter(slice => slice.inputIndex === inputIndex);
      if (slices.length === 0) return;
      const closed = latestClosedOverlaps(context, input, {
        coverageStartDate: input.candidateStartDate,
        coverageEndDateExclusive: input.candidateEndDateExclusive,
      });
      if (
        closed.length === 1
        && closed[0].periodStartDate === input.candidateStartDate
        && closed[0].periodEndDateExclusive === input.candidateEndDateExclusive
      ) {
        exactlyClosedInputs.add(inputIndex);
        diagnostics.push({
          inputIndex,
          rentalLineId: input.rentalLineId,
          componentKind: input.componentKind,
          affectedStartDate: input.candidateStartDate,
          affectedEndDateExclusive: input.candidateEndDateExclusive,
          severity: 'info',
          reasonCode: 'FORECAST_CLOSED_COVERAGE_SUPPRESSED',
          sourceIdentity: input.sourceIdentity,
          sourceHash: input.sourceHash,
          policyRef: closed[0].latestVersionId,
        });
      }
    });

    const items = [];
    for (const slice of plan.calculatedSlices) {
      if (blockedInputs.has(slice.inputIndex) || exactlyClosedInputs.has(slice.inputIndex)) continue;
      const input = plan.inputs[slice.inputIndex];
      const closed = latestClosedOverlaps(context, input, slice);
      if (closed.length > 0) {
        const exact = closed.length === 1
          && closed[0].periodStartDate === slice.coverageStartDate
          && closed[0].periodEndDateExclusive === slice.coverageEndDateExclusive;
        diagnostics.push({
          inputIndex: slice.inputIndex,
          rentalLineId: input.rentalLineId,
          componentKind: input.componentKind,
          affectedStartDate: slice.coverageStartDate,
          affectedEndDateExclusive: slice.coverageEndDateExclusive,
          severity: exact ? 'info' : 'blocking',
          reasonCode: exact ? 'FORECAST_CLOSED_COVERAGE_SUPPRESSED' : 'FORECAST_CLOSED_COVERAGE_OVERLAP',
          sourceIdentity: input.sourceIdentity,
          sourceHash: input.sourceHash,
          policyRef: exact ? closed[0].latestVersionId : null,
        });
        continue;
      }
      const forecastCoverageKey = computeForecastCoverageKey({
        companyId: context.companyId,
        branchId: plan.branchId,
        contractId: input.contractId,
        rentalId: input.rentalId,
        rentalLineId: input.rentalLineId,
        componentKind: input.componentKind,
        coverageStartDate: slice.coverageStartDate,
        coverageEndDateExclusive: slice.coverageEndDateExclusive,
        effectiveTermsVersionId: input.effectiveTermsVersionId,
        calculationVersion: slice.calculationVersion,
        coveragePolicyVersion: slice.coveragePolicyVersion,
      });
      const item = {
        inputIndex: slice.inputIndex,
        forecastCoverageKey,
        componentKind: input.componentKind,
        clientId: input.clientId,
        contractId: input.contractId,
        rentalId: input.rentalId,
        rentalLineId: input.rentalLineId,
        effectiveTermsVersionId: input.effectiveTermsVersionId,
        coverageStartDate: slice.coverageStartDate,
        coverageEndDateExclusive: slice.coverageEndDateExclusive,
        currency: FORECAST_CURRENCY,
        netAmountMinor: slice.netAmountMinor,
        vatAmountMinor: slice.vatAmountMinor,
        grossAmountMinor: slice.grossAmountMinor,
        calculationVersion: slice.calculationVersion,
        calculationPolicyRef: slice.calculationPolicyRef,
        vatPolicyRef: slice.vatPolicyRef,
        roundingPolicyRef: slice.roundingPolicyRef,
        policyDecisionRef: slice.policyDecisionRef,
        confidence: slice.confidence,
        confidenceReasonCodes: [...slice.reasonCodes],
        normalizedCalculationEvidence: slice.normalizedCalculationEvidence,
        itemSourceHash: fingerprint({
          inputSourceHash: inputSourceHash(input),
          effectiveTermsVersionId: input.effectiveTermsVersionId,
          coverageStartDate: slice.coverageStartDate,
          coverageEndDateExclusive: slice.coverageEndDateExclusive,
          calculationPolicyRef: slice.calculationPolicyRef,
          vatPolicyRef: slice.vatPolicyRef,
          roundingPolicyRef: slice.roundingPolicyRef,
          policyDecisionRef: slice.policyDecisionRef,
          normalizedCalculationEvidence: slice.normalizedCalculationEvidence,
        }),
      };
      item.itemResultHash = computeItemResultHash(item);
      items.push(Object.freeze(item));
    }

    const uniqueDiagnostics = new Map();
    for (const item of diagnostics) uniqueDiagnostics.set(stableJson(canonicalDiagnostic(item)), item);
    const sortedDiagnostics = [...uniqueDiagnostics.values()].sort(
      (left, right) => stableJson(canonicalDiagnostic(left)).localeCompare(stableJson(canonicalDiagnostic(right))),
    );
    const sortedItems = items.sort((left, right) => left.forecastCoverageKey.localeCompare(right.forecastCoverageKey));
    for (let index = 1; index < sortedItems.length; index += 1) {
      const left = sortedItems[index - 1];
      const right = sortedItems[index];
      if (
        left.rentalLineId === right.rentalLineId
        && left.componentKind === right.componentKind
        && left.coverageStartDate < right.coverageEndDateExclusive
        && right.coverageStartDate < left.coverageEndDateExclusive
      ) fail('FORECAST_COVERAGE_OVERLAP', 'Calculated forecast items overlap.', 'calculatedSlices');
    }
    const totals = totalsFor(sortedItems);
    const state = statusFor(sortedItems, sortedDiagnostics);
    const resultHash = resultHashFor(plan, sortedItems, sortedDiagnostics, totals, state);
    return Object.freeze({
      items: Object.freeze(sortedItems),
      diagnostics: Object.freeze(sortedDiagnostics),
      totals,
      ...state,
      resultHash,
    });
  }

  function insertRun(context, plan, result, ids, inputSetHash, predecessors, createdAt) {
    const manifest = plan.inputSetManifest;
    db.prepare(`
      INSERT INTO ${FORECAST_RECEIVABLE_RUNS_TABLE} (
        id, companyId, branchId, companyTimezone, planningSeriesKey, asOfDate,
        horizonStartDate, horizonEndDateExclusive, horizonDays, currency,
        calculationVersion, inputContractVersion, confidencePolicyVersion,
        coveragePolicyVersion, inputSetManifestPresent, inputSetManifestSourceSystem,
        inputSetManifestSourceSnapshotVersion, inputSetManifestCoveredBranchId,
        inputSetManifestCoveredStartDate, inputSetManifestCoveredEndDateExclusive,
        inputSetManifestRentalStatusesJson, inputSetManifestAuthorityStatus,
        inputSetManifestPolicyRef, inputSetManifestSourceHash, inputSetManifestHash,
        inputSetManifestSchemaVersion, inputSetHash, resultHash, status, completenessState,
        openPeriodForecastNetMinor, openPeriodForecastVatMinor, openPeriodForecastGrossMinor,
        plannedFutureNetMinor, plannedFutureVatMinor, plannedFutureGrossMinor,
        primaryForecastMinor, inputSnapshotCount, inputEventCount,
        inputCompletenessManifestCount, itemCount, diagnosticCount, blockingDiagnosticCount,
        predecessorCount, operationId, calculatedAt, correlationId, schemaVersion
      ) VALUES (
        @id, @companyId, @branchId, @companyTimezone, @planningSeriesKey, @asOfDate,
        @horizonStartDate, @horizonEndDateExclusive, 30, @currency,
        @calculationVersion, @inputContractVersion, @confidencePolicyVersion,
        @coveragePolicyVersion, @inputSetManifestPresent, @inputSetManifestSourceSystem,
        @inputSetManifestSourceSnapshotVersion, @inputSetManifestCoveredBranchId,
        @inputSetManifestCoveredStartDate, @inputSetManifestCoveredEndDateExclusive,
        @inputSetManifestRentalStatusesJson, @inputSetManifestAuthorityStatus,
        @inputSetManifestPolicyRef, @inputSetManifestSourceHash, @inputSetManifestHash,
        @inputSetManifestSchemaVersion, @inputSetHash, @resultHash, @status, @completenessState,
        @openPeriodForecastNetMinor, @openPeriodForecastVatMinor, @openPeriodForecastGrossMinor,
        @plannedFutureNetMinor, @plannedFutureVatMinor, @plannedFutureGrossMinor,
        @primaryForecastMinor, @inputSnapshotCount, @inputEventCount,
        @inputCompletenessManifestCount, @itemCount, @diagnosticCount, @blockingDiagnosticCount,
        @predecessorCount, @operationId, @calculatedAt, @correlationId, @schemaVersion
      )
    `).run({
      id: ids.runId,
      companyId: context.companyId,
      branchId: plan.branchId,
      companyTimezone: context.companyTimezone,
      planningSeriesKey: plan.planningSeriesKey,
      asOfDate: plan.asOfDate,
      horizonStartDate: plan.horizonStartDate,
      horizonEndDateExclusive: plan.horizonEndDateExclusive,
      currency: FORECAST_CURRENCY,
      calculationVersion: plan.calculationVersion,
      inputContractVersion: FORECAST_INPUT_CONTRACT_VERSION,
      confidencePolicyVersion: plan.confidencePolicyVersion,
      coveragePolicyVersion: plan.coveragePolicyVersion,
      inputSetManifestPresent: manifest ? 1 : 0,
      inputSetManifestSourceSystem: manifest?.sourceSystem || null,
      inputSetManifestSourceSnapshotVersion: manifest?.sourceSnapshotVersion || null,
      inputSetManifestCoveredBranchId: manifest?.coveredBranchId || null,
      inputSetManifestCoveredStartDate: manifest?.coveredStartDate || null,
      inputSetManifestCoveredEndDateExclusive: manifest?.coveredEndDateExclusive || null,
      inputSetManifestRentalStatusesJson: manifest ? stableJson(manifest.rentalStatusesCovered) : null,
      inputSetManifestAuthorityStatus: manifest?.authorityStatus || null,
      inputSetManifestPolicyRef: manifest?.policyRef || null,
      inputSetManifestSourceHash: manifest?.sourceHash || null,
      inputSetManifestHash: manifest ? fingerprint(manifest) : null,
      inputSetManifestSchemaVersion: manifest ? FORECAST_RECEIVABLES_SCHEMA_VERSION : null,
      inputSetHash,
      resultHash: result.resultHash,
      status: result.status,
      completenessState: result.completenessState,
      ...result.totals,
      inputSnapshotCount: plan.inputs.length,
      inputEventCount: plan.inputs.reduce((count, input) => count + input.events.length, 0),
      inputCompletenessManifestCount: plan.inputs.filter(input => input.completenessManifest).length,
      itemCount: result.items.length,
      diagnosticCount: result.diagnostics.length,
      blockingDiagnosticCount: result.diagnostics.filter(item => item.severity === 'blocking').length,
      predecessorCount: predecessors.length,
      operationId: ids.operationId,
      calculatedAt: createdAt,
      correlationId: plan.correlationId,
      schemaVersion: FORECAST_RECEIVABLES_SCHEMA_VERSION,
    });
  }

  function insertInputs(context, plan, result, runId, createdAt) {
    const snapshotIds = [];
    const insertSnapshot = db.prepare(`
      INSERT INTO ${FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE} (
        id, forecastRunId, companyId, branchId, rentalLineId, activationBoundaryId,
        activationBoundarySourceHash, effectiveTermsVersionId, effectiveTermsSourceVersion,
        effectiveTermsSourceHash, clientId, contractId, rentalId, equipmentId, rentalStatus,
        componentKind, serviceStartDate, serviceEndDateExclusive, candidateStartDate,
        candidateEndDateExclusive, sourceSystem, sourceIdentity, sourceEventId,
        sourceEventVersion, sourceHash, completenessManifestPresent, manifestSourceSystem,
        manifestSourceSnapshotVersion, manifestSourceEventWatermarkVersion,
        manifestEventKindsCoveredJson, manifestCoveredStartDate, manifestCoveredEndDateExclusive,
        manifestSourceHash, manifestAuthorityStatus, manifestPolicyRef, eventManifestHash, policyBundleRefsJson,
        inputSourceHash, authorityStatus, completenessStatus, schemaVersion, createdAt
      ) VALUES (
        @id, @forecastRunId, @companyId, @branchId, @rentalLineId, @activationBoundaryId,
        @activationBoundarySourceHash, @effectiveTermsVersionId, @effectiveTermsSourceVersion,
        @effectiveTermsSourceHash, @clientId, @contractId, @rentalId, @equipmentId, @rentalStatus,
        @componentKind, @serviceStartDate, @serviceEndDateExclusive, @candidateStartDate,
        @candidateEndDateExclusive, @sourceSystem, @sourceIdentity, @sourceEventId,
        @sourceEventVersion, @sourceHash, @completenessManifestPresent, @manifestSourceSystem,
        @manifestSourceSnapshotVersion, @manifestSourceEventWatermarkVersion,
        @manifestEventKindsCoveredJson, @manifestCoveredStartDate, @manifestCoveredEndDateExclusive,
        @manifestSourceHash, @manifestAuthorityStatus, @manifestPolicyRef, @eventManifestHash, @policyBundleRefsJson,
        @inputSourceHash, @authorityStatus, @completenessStatus, @schemaVersion, @createdAt
      )
    `);
    const insertEvent = db.prepare(`
      INSERT INTO ${FORECAST_RECEIVABLE_INPUT_EVENTS_TABLE} (
        id, forecastRunId, inputSnapshotId, companyId, branchId, rentalLineId, eventKind,
        sourceSystem, sourceId, sourceVersion, sourceEventId, sourceEventVersion,
        effectiveStartDate, effectiveEndDateExclusive, authorityStatus, authorityPolicyRef,
        evidenceHash, schemaVersion, createdAt
      ) VALUES (
        @id, @forecastRunId, @inputSnapshotId, @companyId, @branchId, @rentalLineId, @eventKind,
        @sourceSystem, @sourceId, @sourceVersion, @sourceEventId, @sourceEventVersion,
        @effectiveStartDate, @effectiveEndDateExclusive, @authorityStatus, @authorityPolicyRef,
        @evidenceHash, @schemaVersion, @createdAt
      )
    `);
    plan.inputs.forEach((input, inputIndex) => {
      const snapshotId = generateId('forecast-input');
      snapshotIds[inputIndex] = snapshotId;
      const slices = result.items.filter(item => item.inputIndex === inputIndex);
      const policyRefs = slices.map(item => ({
        calculationVersion: item.calculationVersion,
        calculationPolicyRef: item.calculationPolicyRef,
        vatPolicyRef: item.vatPolicyRef,
        roundingPolicyRef: item.roundingPolicyRef,
        policyDecisionRef: item.policyDecisionRef,
      })).sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
      const manifest = input.completenessManifest;
      insertSnapshot.run({
        id: snapshotId,
        forecastRunId: runId,
        companyId: context.companyId,
        branchId: plan.branchId,
        rentalLineId: input.rentalLineId,
        activationBoundaryId: input.activationBoundaryId,
        activationBoundarySourceHash: input.activationBoundarySourceHash,
        effectiveTermsVersionId: input.effectiveTermsVersionId,
        effectiveTermsSourceVersion: input.effectiveTermsSourceVersion,
        effectiveTermsSourceHash: input.effectiveTermsSourceHash,
        clientId: input.clientId,
        contractId: input.contractId,
        rentalId: input.rentalId,
        equipmentId: input.equipmentId,
        rentalStatus: input.rentalStatus,
        componentKind: input.componentKind,
        serviceStartDate: input.serviceStartDate,
        serviceEndDateExclusive: input.serviceEndDateExclusive,
        candidateStartDate: input.candidateStartDate,
        candidateEndDateExclusive: input.candidateEndDateExclusive,
        sourceSystem: input.sourceSystem,
        sourceIdentity: input.sourceIdentity,
        sourceEventId: input.sourceEventId,
        sourceEventVersion: input.sourceEventVersion,
        sourceHash: input.sourceHash,
        completenessManifestPresent: manifest ? 1 : 0,
        manifestSourceSystem: manifest?.sourceSystem || null,
        manifestSourceSnapshotVersion: manifest?.sourceSnapshotVersion || null,
        manifestSourceEventWatermarkVersion: manifest?.sourceEventWatermarkVersion || null,
        manifestEventKindsCoveredJson: manifest ? stableJson(manifest.eventKindsCovered) : null,
        manifestCoveredStartDate: manifest?.coveredStartDate || null,
        manifestCoveredEndDateExclusive: manifest?.coveredEndDateExclusive || null,
        manifestSourceHash: manifest?.sourceHash || null,
        manifestAuthorityStatus: manifest?.authorityStatus || null,
        manifestPolicyRef: manifest?.policyRef || null,
        eventManifestHash: manifest ? fingerprint(manifest) : null,
        policyBundleRefsJson: stableJson(policyRefs),
        inputSourceHash: inputSourceHash(input),
        authorityStatus: manifest?.authorityStatus || 'unresolved',
        completenessStatus: !manifest
          ? 'missing'
          : (result.diagnostics.some(item => item.inputIndex === inputIndex && item.severity === 'blocking') ? 'incomplete' : 'complete'),
        schemaVersion: FORECAST_RECEIVABLES_SCHEMA_VERSION,
        createdAt,
      });
      [...input.events].sort((left, right) => stableJson(canonicalEvent(left)).localeCompare(stableJson(canonicalEvent(right))))
        .forEach(event => insertEvent.run({
          id: generateId('forecast-event'),
          forecastRunId: runId,
          inputSnapshotId: snapshotId,
          companyId: context.companyId,
          branchId: plan.branchId,
          rentalLineId: input.rentalLineId,
          ...event,
          schemaVersion: FORECAST_RECEIVABLES_SCHEMA_VERSION,
          createdAt,
        }));
    });
    return snapshotIds;
  }

  function insertItems(context, plan, result, runId, snapshotIds, createdAt) {
    const insert = db.prepare(`
      INSERT INTO ${FORECAST_RECEIVABLE_ITEMS_TABLE} (
        id, forecastRunId, inputSnapshotId, forecastCoverageKey, companyId, branchId,
        componentKind, clientId, contractId, rentalId, rentalLineId, effectiveTermsVersionId,
        coverageStartDate, coverageEndDateExclusive, currency, netAmountMinor, vatAmountMinor,
        grossAmountMinor, calculationVersion, calculationPolicyRef, vatPolicyRef,
        roundingPolicyRef, policyDecisionRef, confidence, confidenceReasonCodesJson,
        normalizedCalculationEvidenceJson, itemSourceHash, itemResultHash, schemaVersion, createdAt
      ) VALUES (
        @id, @forecastRunId, @inputSnapshotId, @forecastCoverageKey, @companyId, @branchId,
        @componentKind, @clientId, @contractId, @rentalId, @rentalLineId, @effectiveTermsVersionId,
        @coverageStartDate, @coverageEndDateExclusive, @currency, @netAmountMinor, @vatAmountMinor,
        @grossAmountMinor, @calculationVersion, @calculationPolicyRef, @vatPolicyRef,
        @roundingPolicyRef, @policyDecisionRef, @confidence, @confidenceReasonCodesJson,
        @normalizedCalculationEvidenceJson, @itemSourceHash, @itemResultHash, @schemaVersion, @createdAt
      )
    `);
    for (const item of result.items) {
      insert.run({
        id: generateId('forecast-item'),
        forecastRunId: runId,
        inputSnapshotId: snapshotIds[item.inputIndex],
        companyId: context.companyId,
        branchId: plan.branchId,
        ...item,
        confidenceReasonCodesJson: stableJson(item.confidenceReasonCodes),
        normalizedCalculationEvidenceJson: stableJson(item.normalizedCalculationEvidence),
        schemaVersion: FORECAST_RECEIVABLES_SCHEMA_VERSION,
        createdAt,
      });
    }
  }

  function insertDiagnostics(context, plan, result, runId, snapshotIds, createdAt) {
    const insert = db.prepare(`
      INSERT INTO ${FORECAST_RECEIVABLE_DIAGNOSTICS_TABLE} (
        id, forecastRunId, inputSnapshotId, companyId, branchId, rentalLineId,
        componentKind, affectedStartDate, affectedEndDateExclusive, severity, confidence,
        reasonCode, sourceIdentity, sourceHash, policyRef, correlationId, schemaVersion, createdAt
      ) VALUES (
        @id, @forecastRunId, @inputSnapshotId, @companyId, @branchId, @rentalLineId,
        @componentKind, @affectedStartDate, @affectedEndDateExclusive, @severity, 'insufficient',
        @reasonCode, @sourceIdentity, @sourceHash, @policyRef, @correlationId, @schemaVersion, @createdAt
      )
    `);
    for (const diagnostic of result.diagnostics) {
      const inputIndex = diagnostic.inputIndex;
      insert.run({
        id: generateId('forecast-diagnostic'),
        forecastRunId: runId,
        inputSnapshotId: inputIndex == null ? null : snapshotIds[inputIndex],
        companyId: context.companyId,
        branchId: plan.branchId,
        ...diagnostic,
        correlationId: plan.correlationId,
        schemaVersion: FORECAST_RECEIVABLES_SCHEMA_VERSION,
        createdAt,
      });
    }
  }

  function insertSupersessions(context, plan, predecessors, ids, createdAt) {
    const insert = db.prepare(`
      INSERT INTO ${FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE} (
        id, companyId, branchId, planningSeriesKey, predecessorRunId, successorRunId,
        operationId, reasonCode, reasonText, schemaVersion, createdAt
      ) VALUES (
        @id, @companyId, @branchId, @planningSeriesKey, @predecessorRunId, @successorRunId,
        @operationId, @reasonCode, @reasonText, @schemaVersion, @createdAt
      )
    `);
    for (const predecessor of predecessors) {
      insert.run({
        id: generateId('forecast-supersession'),
        companyId: context.companyId,
        branchId: plan.branchId,
        planningSeriesKey: plan.planningSeriesKey,
        predecessorRunId: predecessor.id,
        successorRunId: ids.runId,
        operationId: ids.operationId,
        reasonCode: plan.reasonCode,
        reasonText: plan.reasonText,
        schemaVersion: FORECAST_RECEIVABLES_SCHEMA_VERSION,
        createdAt,
      });
    }
  }

  function readPersistedInputSet(context, runId, originallyCalculatedInputSetHash) {
    const run = db.prepare(`
      SELECT * FROM ${FORECAST_RECEIVABLE_RUNS_TABLE}
      WHERE companyId = ? AND branchId = ? AND id = ?
    `).get(context.companyId, context.branchId, runId);
    if (!run || run.inputContractVersion !== FORECAST_INPUT_CONTRACT_VERSION) {
      fail('FORECAST_RECONCILIATION_FAILED', 'Persisted forecast input-set run is unavailable.', 'inputSetHash', 500);
    }

    let inputSetManifest = null;
    if (Number(run.inputSetManifestPresent) === 1) {
      inputSetManifest = {
        sourceSystem: run.inputSetManifestSourceSystem,
        sourceSnapshotVersion: Number(run.inputSetManifestSourceSnapshotVersion),
        coveredBranchId: run.inputSetManifestCoveredBranchId,
        coveredStartDate: run.inputSetManifestCoveredStartDate,
        coveredEndDateExclusive: run.inputSetManifestCoveredEndDateExclusive,
        rentalStatusesCovered: parseCanonicalJson(
          run.inputSetManifestRentalStatusesJson,
          'inputSetManifestRentalStatusesJson',
          'array',
        ),
        authorityStatus: run.inputSetManifestAuthorityStatus,
        policyRef: run.inputSetManifestPolicyRef,
        sourceHash: run.inputSetManifestSourceHash,
      };
      if (
        Number(run.inputSetManifestSchemaVersion) !== FORECAST_RECEIVABLES_SCHEMA_VERSION
        || fingerprint(inputSetManifest) !== run.inputSetManifestHash
      ) fail('FORECAST_RECONCILIATION_FAILED', 'Persisted input-set manifest hash mismatch.', 'inputSetManifestHash', 500);
    } else if (Number(run.inputSetManifestPresent) !== 0) {
      fail('FORECAST_RECONCILIATION_FAILED', 'Persisted input-set manifest state is invalid.', 'inputSetManifestPresent', 500);
    }

    const snapshotRows = db.prepare(`
      SELECT * FROM ${FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE}
      WHERE companyId = ? AND branchId = ? AND forecastRunId = ?
      ORDER BY id
    `).all(context.companyId, context.branchId, runId);
    const eventRows = db.prepare(`
      SELECT * FROM ${FORECAST_RECEIVABLE_INPUT_EVENTS_TABLE}
      WHERE companyId = ? AND branchId = ? AND forecastRunId = ?
      ORDER BY inputSnapshotId, id
    `).all(context.companyId, context.branchId, runId);
    const manifestCount = snapshotRows.filter(row => Number(row.completenessManifestPresent) === 1).length;
    if (
      snapshotRows.length !== Number(run.inputSnapshotCount)
      || eventRows.length !== Number(run.inputEventCount)
      || manifestCount !== Number(run.inputCompletenessManifestCount)
    ) fail('FORECAST_RECONCILIATION_FAILED', 'Persisted forecast input-set counts mismatch.', 'inputSnapshotCount', 500);

    const snapshotsById = new Map(snapshotRows.map(row => [row.id, row]));
    const eventsBySnapshotId = new Map(snapshotRows.map(row => [row.id, []]));
    for (const row of eventRows) {
      const target = eventsBySnapshotId.get(row.inputSnapshotId);
      if (!target || !snapshotsById.has(row.inputSnapshotId)) {
        fail('FORECAST_RECONCILIATION_FAILED', 'Persisted input event has no exact snapshot.', 'inputSnapshotId', 500);
      }
      target.push(canonicalEvent(row));
    }

    const inputs = snapshotRows.map(row => {
      let completenessManifest = null;
      if (Number(row.completenessManifestPresent) === 1) {
        completenessManifest = {
          sourceSystem: row.manifestSourceSystem,
          sourceSnapshotVersion: Number(row.manifestSourceSnapshotVersion),
          sourceEventWatermarkVersion: Number(row.manifestSourceEventWatermarkVersion),
          eventKindsCovered: parseCanonicalJson(
            row.manifestEventKindsCoveredJson,
            'manifestEventKindsCoveredJson',
            'array',
          ),
          coveredStartDate: row.manifestCoveredStartDate,
          coveredEndDateExclusive: row.manifestCoveredEndDateExclusive,
          sourceHash: row.manifestSourceHash,
          authorityStatus: row.manifestAuthorityStatus,
          policyRef: row.manifestPolicyRef,
        };
        if (fingerprint(completenessManifest) !== row.eventManifestHash) {
          fail('FORECAST_RECONCILIATION_FAILED', 'Persisted completeness manifest hash mismatch.', 'eventManifestHash', 500);
        }
      } else if (Number(row.completenessManifestPresent) !== 0) {
        fail('FORECAST_RECONCILIATION_FAILED', 'Persisted completeness manifest state is invalid.', 'completenessManifestPresent', 500);
      }
      const input = {
        rentalLineId: row.rentalLineId,
        activationBoundaryId: row.activationBoundaryId,
        activationBoundarySourceHash: row.activationBoundarySourceHash,
        effectiveTermsVersionId: row.effectiveTermsVersionId,
        effectiveTermsSourceVersion: Number(row.effectiveTermsSourceVersion),
        effectiveTermsSourceHash: row.effectiveTermsSourceHash,
        clientId: row.clientId,
        contractId: row.contractId,
        rentalId: row.rentalId,
        equipmentId: row.equipmentId,
        rentalStatus: row.rentalStatus,
        componentKind: row.componentKind,
        serviceStartDate: row.serviceStartDate,
        serviceEndDateExclusive: row.serviceEndDateExclusive,
        candidateStartDate: row.candidateStartDate,
        candidateEndDateExclusive: row.candidateEndDateExclusive,
        sourceSystem: row.sourceSystem,
        sourceIdentity: row.sourceIdentity,
        sourceEventId: row.sourceEventId,
        sourceEventVersion: Number(row.sourceEventVersion),
        sourceHash: row.sourceHash,
        completenessManifest,
        events: eventsBySnapshotId.get(row.id),
      };
      if (inputSourceHash(input) !== row.inputSourceHash) {
        fail('FORECAST_RECONCILIATION_FAILED', 'Persisted input source hash mismatch.', 'inputSourceHash', 500);
      }
      return input;
    });

    const reconstructedInputSetHash = fingerprint(canonicalInputSet({
      branchId: run.branchId,
      asOfDate: run.asOfDate,
      horizonStartDate: run.horizonStartDate,
      horizonEndDateExclusive: run.horizonEndDateExclusive,
      inputSetManifest,
      inputs,
    }));
    if (
      reconstructedInputSetHash !== run.inputSetHash
      || reconstructedInputSetHash !== originallyCalculatedInputSetHash
    ) fail('FORECAST_INPUT_SET_HASH_MISMATCH', 'Persisted forecast input set does not match the calculated input set.', 'inputSetHash', 500);
    return Object.freeze({ run, inputSetHash: reconstructedInputSetHash });
  }

  function assertFinalizedInputSetHashes(context, ids, inputSetHash) {
    const operation = db.prepare(`
      SELECT inputSetHash, resultRunId, auditEventId
      FROM ${FORECAST_RECEIVABLE_OPERATIONS_TABLE}
      WHERE companyId = ? AND branchId = ? AND id = ?
    `).get(context.companyId, context.branchId, ids.operationId);
    const audit = db.prepare(`
      SELECT inputSetHash, aggregateId, operationId
      FROM ${FORECAST_RECEIVABLE_AUDIT_EVENTS_TABLE}
      WHERE companyId = ? AND branchId = ? AND id = ?
    `).get(context.companyId, context.branchId, ids.auditEventId);
    if (
      !operation
      || !audit
      || operation.inputSetHash !== inputSetHash
      || audit.inputSetHash !== inputSetHash
      || operation.resultRunId !== ids.runId
      || operation.auditEventId !== ids.auditEventId
      || audit.aggregateId !== ids.runId
      || audit.operationId !== ids.operationId
    ) fail('FORECAST_INPUT_SET_HASH_MISMATCH', 'Finalized operation or audit input hash mismatch.', 'inputSetHash', 500);
  }

  function readPersistedResult(context, runId) {
    const run = db.prepare(`
      SELECT * FROM ${FORECAST_RECEIVABLE_RUNS_TABLE}
      WHERE companyId = ? AND branchId = ? AND id = ?
    `).get(context.companyId, context.branchId, runId);
    const itemRows = db.prepare(`
      SELECT * FROM ${FORECAST_RECEIVABLE_ITEMS_TABLE}
      WHERE companyId = ? AND branchId = ? AND forecastRunId = ?
      ORDER BY forecastCoverageKey
    `).all(context.companyId, context.branchId, runId);
    const diagnostics = db.prepare(`
      SELECT rentalLineId, componentKind, affectedStartDate, affectedEndDateExclusive,
             severity, reasonCode, sourceIdentity, sourceHash, policyRef
      FROM ${FORECAST_RECEIVABLE_DIAGNOSTICS_TABLE}
      WHERE companyId = ? AND branchId = ? AND forecastRunId = ?
      ORDER BY reasonCode, id
    `).all(context.companyId, context.branchId, runId);
    const items = itemRows.map(row => {
      const item = {
        forecastCoverageKey: row.forecastCoverageKey,
        componentKind: row.componentKind,
        clientId: row.clientId,
        contractId: row.contractId,
        rentalId: row.rentalId,
        rentalLineId: row.rentalLineId,
        effectiveTermsVersionId: row.effectiveTermsVersionId,
        coverageStartDate: row.coverageStartDate,
        coverageEndDateExclusive: row.coverageEndDateExclusive,
        currency: row.currency,
        netAmountMinor: row.netAmountMinor,
        vatAmountMinor: row.vatAmountMinor,
        grossAmountMinor: row.grossAmountMinor,
        calculationVersion: row.calculationVersion,
        calculationPolicyRef: row.calculationPolicyRef,
        vatPolicyRef: row.vatPolicyRef,
        roundingPolicyRef: row.roundingPolicyRef,
        policyDecisionRef: row.policyDecisionRef,
        confidence: row.confidence,
        confidenceReasonCodes: JSON.parse(row.confidenceReasonCodesJson),
        normalizedCalculationEvidence: JSON.parse(row.normalizedCalculationEvidenceJson),
        itemSourceHash: row.itemSourceHash,
      };
      item.itemResultHash = computeItemResultHash(item);
      if (item.itemResultHash !== row.itemResultHash) {
        fail('FORECAST_RECONCILIATION_FAILED', 'Persisted item hash mismatch.', 'itemResultHash', 500);
      }
      return item;
    });
    const totals = totalsFor(items);
    const state = statusFor(items, diagnostics);
    const reconstructedHash = resultHashFor({
      planningSeriesKey: run.planningSeriesKey,
      asOfDate: run.asOfDate,
      horizonStartDate: run.horizonStartDate,
      horizonEndDateExclusive: run.horizonEndDateExclusive,
      calculationVersion: run.calculationVersion,
      confidencePolicyVersion: run.confidencePolicyVersion,
      coveragePolicyVersion: run.coveragePolicyVersion,
    }, items, diagnostics, totals, state);
    const expectedRun = {
      ...totals,
      status: state.status,
      completenessState: state.completenessState,
      itemCount: items.length,
      diagnosticCount: diagnostics.length,
      blockingDiagnosticCount: diagnostics.filter(item => item.severity === 'blocking').length,
      resultHash: reconstructedHash,
    };
    for (const [field, value] of Object.entries(expectedRun)) {
      if (run[field] !== value) {
        fail('FORECAST_RECONCILIATION_FAILED', `Persisted run ${field} mismatch.`, field, 500);
      }
    }
    return run;
  }

  function insertOperationAndAudit(context, plan, ids, inputSetHash, commandHash, result, predecessors, createdAt) {
    db.prepare(`
      INSERT INTO ${FORECAST_RECEIVABLE_OPERATIONS_TABLE} (
        id, companyId, branchId, operationType, idempotencyKey, commandFingerprint,
        inputSetHash, planningSeriesKey, actorPrincipalId, actorMembershipId,
        actorMembershipVersion, roleTemplateKey, roleTemplateVersion,
        capabilityCatalogVersion, capabilityKey, resultRunId, resultHash, auditEventId,
        correlationId, schemaVersion, createdAt
      ) VALUES (
        @id, @companyId, @branchId, @operationType, @idempotencyKey, @commandFingerprint,
        @inputSetHash, @planningSeriesKey, @actorPrincipalId, @actorMembershipId,
        @actorMembershipVersion, @roleTemplateKey, @roleTemplateVersion,
        @capabilityCatalogVersion, @capabilityKey, @resultRunId, @resultHash, @auditEventId,
        @correlationId, @schemaVersion, @createdAt
      )
    `).run({
      id: ids.operationId,
      companyId: context.companyId,
      branchId: plan.branchId,
      operationType: OPERATION_TYPE,
      idempotencyKey: plan.idempotencyKey,
      commandFingerprint: commandHash,
      inputSetHash,
      planningSeriesKey: plan.planningSeriesKey,
      actorPrincipalId: context.principalId,
      actorMembershipId: context.membershipId,
      actorMembershipVersion: context.membershipVersion,
      roleTemplateKey: context.roleTemplateKey,
      roleTemplateVersion: context.roleTemplateVersion,
      capabilityCatalogVersion: context.capabilityCatalogVersion,
      capabilityKey: CAPABILITY_KEY,
      resultRunId: ids.runId,
      resultHash: result.resultHash,
      auditEventId: ids.auditEventId,
      correlationId: plan.correlationId,
      schemaVersion: FORECAST_RECEIVABLES_SCHEMA_VERSION,
      createdAt,
    });

    db.prepare(`
      INSERT INTO ${FORECAST_RECEIVABLE_AUDIT_EVENTS_TABLE} (
        id, companyId, branchId, aggregateType, aggregateId, aggregateVersion, eventType,
        actorType, actorPrincipalId, actorMembershipId, actorMembershipVersion,
        roleTemplateKey, roleTemplateVersion, capabilityCatalogVersion, capabilityKey,
        correlationId, reasonCode, reasonText, beforeFingerprint, afterFingerprint,
        inputSetHash, resultHash, operationId, schemaVersion, createdAt
      ) VALUES (
        @id, @companyId, @branchId, 'forecast_receivable_run', @aggregateId, 1,
        'forecast_run_calculated', 'user', @actorPrincipalId, @actorMembershipId,
        @actorMembershipVersion, @roleTemplateKey, @roleTemplateVersion,
        @capabilityCatalogVersion, @capabilityKey, @correlationId, @reasonCode,
        @reasonText, @beforeFingerprint, @afterFingerprint, @inputSetHash, @resultHash,
        @operationId, @schemaVersion, @createdAt
      )
    `).run({
      id: ids.auditEventId,
      companyId: context.companyId,
      branchId: plan.branchId,
      aggregateId: ids.runId,
      actorPrincipalId: context.principalId,
      actorMembershipId: context.membershipId,
      actorMembershipVersion: context.membershipVersion,
      roleTemplateKey: context.roleTemplateKey,
      roleTemplateVersion: context.roleTemplateVersion,
      capabilityCatalogVersion: context.capabilityCatalogVersion,
      capabilityKey: CAPABILITY_KEY,
      correlationId: plan.correlationId,
      reasonCode: plan.reasonCode,
      reasonText: plan.reasonText,
      beforeFingerprint: predecessors.length === 0
        ? null
        : fingerprint(predecessors.map(item => ({ id: item.id, resultHash: item.resultHash })).sort((a, b) => a.id.localeCompare(b.id))),
      afterFingerprint: result.resultHash,
      inputSetHash,
      resultHash: result.resultHash,
      operationId: ids.operationId,
      schemaVersion: FORECAST_RECEIVABLES_SCHEMA_VERSION,
      createdAt,
    });
  }

  function projectRun(row) {
    return Object.freeze({
      forecastRunId: row.id,
      companyId: row.companyId,
      branchId: row.branchId,
      companyTimezone: row.companyTimezone,
      planningSeriesKey: row.planningSeriesKey,
      asOfDate: row.asOfDate,
      horizonStartDate: row.horizonStartDate,
      horizonEndDateExclusive: row.horizonEndDateExclusive,
      horizonDays: row.horizonDays,
      currency: row.currency,
      calculationVersion: row.calculationVersion,
      inputContractVersion: row.inputContractVersion,
      confidencePolicyVersion: row.confidencePolicyVersion,
      coveragePolicyVersion: row.coveragePolicyVersion,
      inputSetHash: row.inputSetHash,
      resultHash: row.resultHash,
      status: row.status,
      completeness: row.completenessState,
      openPeriodForecastNetMinor: row.openPeriodForecastNetMinor,
      openPeriodForecastVatMinor: row.openPeriodForecastVatMinor,
      openPeriodForecastGrossMinor: row.openPeriodForecastGrossMinor,
      plannedFutureNetMinor: row.plannedFutureNetMinor,
      plannedFutureVatMinor: row.plannedFutureVatMinor,
      plannedFutureGrossMinor: row.plannedFutureGrossMinor,
      primaryForecastMinor: row.primaryForecastMinor,
      itemCount: row.itemCount,
      diagnosticCount: row.diagnosticCount,
      blockingDiagnosticCount: row.blockingDiagnosticCount,
      calculatedAt: row.calculatedAt,
      correlationId: row.correlationId,
    });
  }

  function calculateForecastRun(context, plan) {
    assertForecastCommandContext(context);
    assertPreparedForecastPlan(plan);
    try {
      return db.transaction(() => {
        authorize(context, plan);
        const calculatedInputSetHash = fingerprint(canonicalInputSet(plan));
        if (plan.expectedInputSetHash && plan.expectedInputSetHash !== calculatedInputSetHash) {
          fail('FORECAST_INPUT_SET_HASH_MISMATCH', 'Expected input set hash does not match repository input.', 'expectedInputSetHash');
        }
        const calculatedCommandFingerprint = commandFingerprint(context, plan, calculatedInputSetHash);
        const replay = replayOrConflict(
          context,
          plan,
          calculatedInputSetHash,
          calculatedCommandFingerprint,
        );
        if (replay) return replay;

        const sourceStates = plan.inputs.map(input => validateSource(input, {
          ...context,
          branchId: plan.branchId,
        }));
        const predecessors = activeRuns(context, plan);
        const activeIds = predecessors.map(row => row.id).sort();
        if (!same(activeIds, plan.expectedActiveRunIds)) {
          fail('FORECAST_ACTIVE_RUN_CONFLICT', 'The active forecast run set changed.', 'expectedActiveRunIds');
        }
        const result = buildCommittedResult({ ...context, branchId: plan.branchId }, plan, sourceStates);
        const createdAt = new Date().toISOString();
        const ids = {
          runId: generateId('forecast-run'),
          operationId: generateId('forecast-operation'),
          auditEventId: generateId('forecast-audit'),
        };
        insertRun(context, plan, result, ids, calculatedInputSetHash, predecessors, createdAt);
        const snapshotIds = insertInputs(context, plan, result, ids.runId, createdAt);
        insertItems(context, plan, result, ids.runId, snapshotIds, createdAt);
        insertDiagnostics(context, plan, result, ids.runId, snapshotIds, createdAt);
        insertSupersessions(context, plan, predecessors, ids, createdAt);
        const persistedInputSet = readPersistedInputSet(
          { ...context, branchId: plan.branchId },
          ids.runId,
          calculatedInputSetHash,
        );
        const run = readPersistedResult({ ...context, branchId: plan.branchId }, ids.runId);
        insertOperationAndAudit(
          context,
          plan,
          ids,
          persistedInputSet.inputSetHash,
          calculatedCommandFingerprint,
          result,
          predecessors,
          createdAt,
        );
        assertFinalizedInputSetHashes(
          { ...context, branchId: plan.branchId },
          ids,
          persistedInputSet.inputSetHash,
        );
        return Object.freeze({
          ...projectRun(run),
          operationId: ids.operationId,
          replayed: false,
        });
      }).immediate();
    } catch (error) {
      if (error?.code === 'SQLITE_BUSY' || error?.code === 'SQLITE_LOCKED') {
        fail('FORECAST_CONCURRENT_CONFLICT', 'Concurrent forecast calculation conflicted; retry from fresh state.', 'operation');
      }
      throw error;
    }
  }

  return Object.freeze({ calculateForecastRun });
}

module.exports = {
  CAPABILITY_KEY,
  OPERATION_TYPE,
  canonicalInputSet,
  computeItemResultHash,
  createForecastReceivablesPlanningRepository,
  inputSourceHash,
  resultHashFor,
  totalsFor,
};
