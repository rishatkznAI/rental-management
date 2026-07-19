const {
  PRIMARY_RENTAL_STATUSES,
  REQUIRED_MANIFEST_EVENT_KINDS,
  buildForecastHorizon,
  civilDate,
  computePlanningSeriesKey,
  createPreparedForecastPlan,
  fail,
  materializeInert,
  moneyMinor,
  reasonCodes,
  requiredId,
  safeAdd,
} = require('./forecast-receivables-planning-domain');

const UNAVAILABLE_CALCULATION_VERSION = 'forecast-calculation-policy-unavailable-v1';
const UNAVAILABLE_CONFIDENCE_VERSION = 'forecast-confidence-policy-unavailable-v1';
const UNAVAILABLE_COVERAGE_VERSION = 'forecast-coverage-policy-unavailable-v1';

function diagnostic(input, reasonCode, options = {}) {
  return Object.freeze({
    inputIndex: input ? options.inputIndex : null,
    rentalLineId: input?.rentalLineId || null,
    componentKind: input?.componentKind || null,
    affectedStartDate: input?.candidateStartDate || null,
    affectedEndDateExclusive: input?.candidateEndDateExclusive || null,
    severity: options.severity || 'blocking',
    reasonCode,
    sourceIdentity: input?.sourceIdentity || null,
    sourceHash: input?.sourceHash || null,
    policyRef: options.policyRef || null,
  });
}

function assertPolicy(policy, method, field) {
  if (!policy || typeof policy !== 'object' || typeof policy[method] !== 'function') {
    fail('FORECAST_POLICY_INVALID', `${field}.${method} must be a function.`, field, 500);
  }
  return Object.freeze({
    version: requiredId(policy.version, `${field}.version`),
    policy,
  });
}

function createForecastReceivablesPolicyRegistry(options = {}) {
  const coverage = assertPolicy(options.coveragePartitionPolicy, 'partition', 'coveragePartitionPolicy');
  const pricing = assertPolicy(options.pricingPolicy, 'calculate', 'pricingPolicy');
  const confidence = assertPolicy(options.confidencePolicy, 'classify', 'confidencePolicy');
  return Object.freeze({
    available: true,
    calculationVersion: pricing.version,
    confidencePolicyVersion: confidence.version,
    coveragePolicyVersion: coverage.version,
    coveragePartitionPolicy: coverage.policy,
    pricingPolicy: pricing.policy,
    confidencePolicy: confidence.policy,
  });
}

function createUnavailableForecastReceivablesPolicyRegistry() {
  return Object.freeze({
    available: false,
    calculationVersion: UNAVAILABLE_CALCULATION_VERSION,
    confidencePolicyVersion: UNAVAILABLE_CONFIDENCE_VERSION,
    coveragePolicyVersion: UNAVAILABLE_COVERAGE_VERSION,
  });
}

function inputSetDiagnostics(plan, horizon) {
  const manifest = plan.inputSetManifest;
  if (!manifest) {
    return [diagnostic(null, 'FORECAST_INPUT_MANIFEST_MISSING', {
      policyRef: null,
    })];
  }
  if (
    manifest.authorityStatus !== 'approved_by_reference'
    || !manifest.policyRef
    || manifest.coveredBranchId !== plan.branchId
    || manifest.coveredStartDate > horizon.horizonStartDate
    || manifest.coveredEndDateExclusive < horizon.horizonEndDateExclusive
    || !manifest.rentalStatusesCovered.includes('active')
    || !manifest.rentalStatusesCovered.includes('return_planned')
    || !manifest.rentalStatusesCovered.includes('planned_future')
  ) {
    return [diagnostic(null, 'FORECAST_INPUT_MANIFEST_INCOMPLETE', {
      policyRef: manifest.policyRef,
    })];
  }
  return [];
}

function inputContractDiagnostics(input, horizon, inputIndex) {
  const diagnostics = [];
  const openStatusAllowed = input.componentKind === 'open_period_forecast'
    && PRIMARY_RENTAL_STATUSES.has(input.rentalStatus);
  const futureStatusAllowed = input.componentKind === 'planned_future'
    && input.rentalStatus === 'planned_future';
  if (!openStatusAllowed && !futureStatusAllowed) {
    diagnostics.push(diagnostic(input, 'FORECAST_UNSUPPORTED_RENTAL_STATUS', { inputIndex }));
  }
  if (
    input.candidateStartDate < horizon.horizonStartDate
    || input.candidateEndDateExclusive > horizon.horizonEndDateExclusive
  ) diagnostics.push(diagnostic(input, 'FORECAST_COVERAGE_PARTITION_UNRESOLVED', { inputIndex }));

  const manifest = input.completenessManifest;
  if (!manifest) {
    diagnostics.push(diagnostic(input, 'FORECAST_INPUT_MANIFEST_MISSING', { inputIndex }));
  } else {
    const missingKinds = REQUIRED_MANIFEST_EVENT_KINDS.filter(
      kind => !manifest.eventKindsCovered.includes(kind),
    );
    if (
      manifest.authorityStatus !== 'approved_by_reference'
      || !manifest.policyRef
      || manifest.coveredStartDate > input.candidateStartDate
      || manifest.coveredEndDateExclusive < input.candidateEndDateExclusive
      || missingKinds.length > 0
    ) diagnostics.push(diagnostic(input, 'FORECAST_INPUT_MANIFEST_INCOMPLETE', {
      inputIndex,
      policyRef: manifest.policyRef,
    }));
  }

  const requiredPositiveEvents = ['rental_status', 'effective_terms'];
  for (const kind of requiredPositiveEvents) {
    const applicable = input.events.filter(event => (
      event.eventKind === kind
      && event.effectiveStartDate <= input.candidateStartDate
      && event.effectiveEndDateExclusive >= input.candidateEndDateExclusive
    ));
    if (applicable.length !== 1 || applicable[0].authorityStatus !== 'approved_by_reference') {
      diagnostics.push(diagnostic(
        input,
        kind === 'effective_terms'
          ? 'FORECAST_EFFECTIVE_TERMS_UNRESOLVED'
          : 'FORECAST_EVENT_PRECEDENCE_UNRESOLVED',
        { inputIndex, policyRef: applicable[0]?.authorityPolicyRef || null },
      ));
    }
  }

  const unresolvedEventReasons = {
    return: 'FORECAST_RETURN_AUTHORITY_UNRESOLVED',
    downtime: 'FORECAST_DOWNTIME_AUTHORITY_UNRESOLVED',
    extension: 'FORECAST_EXTENSION_AUTHORITY_UNRESOLVED',
  };
  for (const event of input.events) {
    if (
      event.effectiveStartDate < input.candidateEndDateExclusive
      && input.candidateStartDate < event.effectiveEndDateExclusive
      && event.authorityStatus !== 'approved_by_reference'
    ) {
      diagnostics.push(diagnostic(
        input,
        unresolvedEventReasons[event.eventKind] || 'FORECAST_EVENT_PRECEDENCE_UNRESOLVED',
        { inputIndex, policyRef: event.authorityPolicyRef },
      ));
    }
  }

  const unique = new Map();
  for (const item of diagnostics) unique.set(`${item.reasonCode}:${item.policyRef || ''}`, item);
  return [...unique.values()];
}

function normalizePartitionResult(value, input) {
  const inert = materializeInert(value, 'coveragePolicyResult');
  if (!inert || typeof inert !== 'object' || Array.isArray(inert)) {
    fail('FORECAST_COVERAGE_POLICY_INVALID', 'Coverage policy result must be an object.', 'coveragePolicyResult', 400);
  }
  const allowed = new Set(['policyVersion', 'slices']);
  const unknown = Object.keys(inert).find(key => !allowed.has(key));
  if (unknown || !Array.isArray(inert.slices)) {
    fail('FORECAST_COVERAGE_POLICY_INVALID', 'Coverage policy result is invalid.', 'coveragePolicyResult', 400);
  }
  const policyVersion = requiredId(inert.policyVersion, 'coveragePolicyResult.policyVersion');
  const slices = inert.slices.map((slice, index) => {
    if (!slice || typeof slice !== 'object' || Array.isArray(slice)) {
      fail('FORECAST_COVERAGE_POLICY_INVALID', 'Coverage slice is invalid.', `coveragePolicyResult.slices[${index}]`, 400);
    }
    const keys = Object.keys(slice);
    if (keys.some(key => !['coverageStartDate', 'coverageEndDateExclusive'].includes(key))) {
      fail('FORECAST_COVERAGE_POLICY_INVALID', 'Coverage slice contains unknown fields.', `coveragePolicyResult.slices[${index}]`, 400);
    }
    const coverageStartDate = civilDate(slice.coverageStartDate, `coveragePolicyResult.slices[${index}].coverageStartDate`);
    const coverageEndDateExclusive = civilDate(slice.coverageEndDateExclusive, `coveragePolicyResult.slices[${index}].coverageEndDateExclusive`);
    if (
      coverageStartDate >= coverageEndDateExclusive
      || coverageStartDate < input.candidateStartDate
      || coverageEndDateExclusive > input.candidateEndDateExclusive
    ) fail('FORECAST_COVERAGE_POLICY_INVALID', 'Coverage slice is outside its authoritative candidate.', `coveragePolicyResult.slices[${index}]`, 400);
    return Object.freeze({ coverageStartDate, coverageEndDateExclusive });
  }).sort((left, right) => (
    left.coverageStartDate.localeCompare(right.coverageStartDate)
    || left.coverageEndDateExclusive.localeCompare(right.coverageEndDateExclusive)
  ));
  for (let index = 1; index < slices.length; index += 1) {
    if (slices[index - 1].coverageEndDateExclusive > slices[index].coverageStartDate) {
      fail('FORECAST_COVERAGE_POLICY_INVALID', 'Coverage policy returned overlapping slices.', 'coveragePolicyResult.slices', 400);
    }
  }
  if (
    slices.length > 0
    && (
      slices[0].coverageStartDate !== input.candidateStartDate
      || slices[slices.length - 1].coverageEndDateExclusive !== input.candidateEndDateExclusive
      || slices.some((slice, index) => (
        index > 0 && slices[index - 1].coverageEndDateExclusive !== slice.coverageStartDate
      ))
    )
  ) {
    fail(
      'FORECAST_COVERAGE_POLICY_INVALID',
      'Coverage slices must form an exact contiguous cover of the authoritative candidate.',
      'coveragePolicyResult.slices',
      400,
    );
  }
  return Object.freeze({ policyVersion, slices: Object.freeze(slices) });
}

function normalizePricingResult(value, registry) {
  const inert = materializeInert(value, 'pricingPolicyResult');
  if (!inert || typeof inert !== 'object' || Array.isArray(inert)) {
    fail('FORECAST_PRICING_POLICY_INVALID', 'Pricing policy result must be an object.', 'pricingPolicyResult', 400);
  }
  const allowed = new Set([
    'calculationVersion', 'calculationPolicyRef', 'vatPolicyRef', 'roundingPolicyRef',
    'policyDecisionRef', 'minimumTermPolicyRef', 'netAmountMinor', 'vatAmountMinor',
    'grossAmountMinor', 'normalizedCalculationEvidence',
  ]);
  if (Object.keys(inert).some(key => !allowed.has(key))) {
    fail('FORECAST_PRICING_POLICY_INVALID', 'Pricing policy result contains unknown fields.', 'pricingPolicyResult', 400);
  }
  const netAmountMinor = moneyMinor(inert.netAmountMinor, 'pricingPolicyResult.netAmountMinor');
  const vatAmountMinor = moneyMinor(inert.vatAmountMinor, 'pricingPolicyResult.vatAmountMinor');
  const grossAmountMinor = moneyMinor(inert.grossAmountMinor, 'pricingPolicyResult.grossAmountMinor');
  if (safeAdd([netAmountMinor, vatAmountMinor]) !== grossAmountMinor) {
    fail('FORECAST_RECONCILIATION_FAILED', 'Pricing policy net + VAT must equal gross.', 'pricingPolicyResult.grossAmountMinor', 400);
  }
  const calculationVersion = requiredId(inert.calculationVersion, 'pricingPolicyResult.calculationVersion');
  if (calculationVersion !== registry.calculationVersion) {
    fail('FORECAST_PRICING_POLICY_INVALID', 'Pricing policy version drifted.', 'pricingPolicyResult.calculationVersion', 400);
  }
  const evidence = materializeInert(inert.normalizedCalculationEvidence, 'pricingPolicyResult.normalizedCalculationEvidence');
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    fail('FORECAST_PRICING_POLICY_INVALID', 'Pricing evidence must be an inert object.', 'pricingPolicyResult.normalizedCalculationEvidence', 400);
  }
  return Object.freeze({
    calculationVersion,
    calculationPolicyRef: requiredId(inert.calculationPolicyRef, 'pricingPolicyResult.calculationPolicyRef'),
    vatPolicyRef: requiredId(inert.vatPolicyRef, 'pricingPolicyResult.vatPolicyRef'),
    roundingPolicyRef: requiredId(inert.roundingPolicyRef, 'pricingPolicyResult.roundingPolicyRef'),
    policyDecisionRef: requiredId(inert.policyDecisionRef, 'pricingPolicyResult.policyDecisionRef'),
    minimumTermPolicyRef: requiredId(inert.minimumTermPolicyRef, 'pricingPolicyResult.minimumTermPolicyRef'),
    netAmountMinor,
    vatAmountMinor,
    grossAmountMinor,
    normalizedCalculationEvidence: evidence,
  });
}

function normalizeConfidenceResult(value, registry) {
  const inert = materializeInert(value, 'confidencePolicyResult');
  if (!inert || typeof inert !== 'object' || Array.isArray(inert)) {
    fail('FORECAST_CONFIDENCE_POLICY_INVALID', 'Confidence policy result must be an object.', 'confidencePolicyResult', 400);
  }
  const allowed = new Set(['confidencePolicyVersion', 'confidence', 'reasonCodes']);
  if (Object.keys(inert).some(key => !allowed.has(key))) {
    fail('FORECAST_CONFIDENCE_POLICY_INVALID', 'Confidence policy result contains unknown fields.', 'confidencePolicyResult', 400);
  }
  const confidencePolicyVersion = requiredId(inert.confidencePolicyVersion, 'confidencePolicyResult.confidencePolicyVersion');
  if (confidencePolicyVersion !== registry.confidencePolicyVersion) {
    fail('FORECAST_CONFIDENCE_POLICY_INVALID', 'Confidence policy version drifted.', 'confidencePolicyResult.confidencePolicyVersion', 400);
  }
  const confidence = requiredId(inert.confidence, 'confidencePolicyResult.confidence');
  if (!['high', 'medium', 'low'].includes(confidence)) {
    fail('FORECAST_CONFIDENCE_POLICY_INVALID', 'Calculated money cannot have insufficient confidence.', 'confidencePolicyResult.confidence', 400);
  }
  return Object.freeze({
    confidencePolicyVersion,
    confidence,
    reasonCodes: reasonCodes(inert.reasonCodes, 'confidencePolicyResult.reasonCodes', { required: true }),
  });
}

function evaluateForecastPolicy(context, commandPlan, registry) {
  const horizon = buildForecastHorizon(commandPlan.asOfDate, context.companyTimezone);
  const diagnostics = [...inputSetDiagnostics(commandPlan, horizon)];
  const calculatedSlices = [];

  commandPlan.inputs.forEach((input, inputIndex) => {
    const blockers = inputContractDiagnostics(input, horizon, inputIndex);
    diagnostics.push(...blockers);
    if (blockers.some(item => item.severity === 'blocking')) return;

    if (!registry?.available) {
      diagnostics.push(
        diagnostic(input, 'FORECAST_COVERAGE_PARTITION_UNRESOLVED', { inputIndex }),
        diagnostic(input, 'FORECAST_MINIMUM_TERM_POLICY_UNAVAILABLE', { inputIndex }),
        diagnostic(input, 'FORECAST_VAT_POLICY_UNAVAILABLE', { inputIndex }),
        diagnostic(input, 'FORECAST_ROUNDING_POLICY_UNAVAILABLE', { inputIndex }),
        diagnostic(input, 'FORECAST_CONFIDENCE_POLICY_UNAVAILABLE', { inputIndex }),
      );
      return;
    }

    const partition = normalizePartitionResult(
      registry.coveragePartitionPolicy.partition(Object.freeze({ input, horizon })),
      input,
    );
    if (partition.policyVersion !== registry.coveragePolicyVersion) {
      fail('FORECAST_COVERAGE_POLICY_INVALID', 'Coverage policy version drifted.', 'coveragePolicyResult.policyVersion', 400);
    }
    if (partition.slices.length === 0) {
      diagnostics.push(diagnostic(input, 'FORECAST_COVERAGE_PARTITION_UNRESOLVED', { inputIndex }));
      return;
    }
    for (const slice of partition.slices) {
      const pricing = normalizePricingResult(
        registry.pricingPolicy.calculate(Object.freeze({ input, slice, horizon })),
        registry,
      );
      const confidence = normalizeConfidenceResult(
        registry.confidencePolicy.classify(Object.freeze({ input, slice, pricing, horizon })),
        registry,
      );
      calculatedSlices.push(Object.freeze({
        inputIndex,
        ...slice,
        calculationVersion: pricing.calculationVersion,
        calculationPolicyRef: pricing.calculationPolicyRef,
        vatPolicyRef: pricing.vatPolicyRef,
        roundingPolicyRef: pricing.roundingPolicyRef,
        policyDecisionRef: pricing.policyDecisionRef,
        confidencePolicyVersion: confidence.confidencePolicyVersion,
        coveragePolicyVersion: partition.policyVersion,
        netAmountMinor: pricing.netAmountMinor,
        vatAmountMinor: pricing.vatAmountMinor,
        grossAmountMinor: pricing.grossAmountMinor,
        confidence: confidence.confidence,
        reasonCodes: confidence.reasonCodes,
        normalizedCalculationEvidence: Object.freeze({
          ...pricing.normalizedCalculationEvidence,
          minimumTermPolicyRef: pricing.minimumTermPolicyRef,
        }),
      }));
    }
  });

  return createPreparedForecastPlan(commandPlan, {
    planningSeriesKey: computePlanningSeriesKey(context.companyId, commandPlan.branchId),
    horizonStartDate: horizon.horizonStartDate,
    horizonEndDateExclusive: horizon.horizonEndDateExclusive,
    calculationVersion: registry?.calculationVersion || UNAVAILABLE_CALCULATION_VERSION,
    confidencePolicyVersion: registry?.confidencePolicyVersion || UNAVAILABLE_CONFIDENCE_VERSION,
    coveragePolicyVersion: registry?.coveragePolicyVersion || UNAVAILABLE_COVERAGE_VERSION,
    calculatedSlices,
    diagnostics,
  });
}

module.exports = {
  UNAVAILABLE_CALCULATION_VERSION,
  UNAVAILABLE_CONFIDENCE_VERSION,
  UNAVAILABLE_COVERAGE_VERSION,
  createForecastReceivablesPolicyRegistry,
  createUnavailableForecastReceivablesPolicyRegistry,
  evaluateForecastPolicy,
};
