const crypto = require('crypto');
const {
  assertBranchScope,
  assertCapability,
  assertCompanyScope,
  assertScopeFresh,
  nonDisclosingNotFound,
} = require('./platform-authorization');
const { createPlatformIdentityRepository } = require('./platform-identity-repository');
const {
  ACTUAL_SOURCE_DRY_RUN_SCHEMA_VERSION,
  ActualSourceEligibilityDryRunError,
  assertActualSourceCommandPlan,
  assertActualSourceDryRunContext,
  assertActualSourceExecutionPlan,
  createActualSourceExecutionPlan,
  fail,
  fingerprint,
  safeAdd,
  stableJson,
} = require('./actual-source-eligibility-dry-run-domain');
const {
  evaluateActualSourceEligibility,
} = require('./actual-source-eligibility-dry-run-policy');
const {
  ACTUAL_SOURCE_DRY_RUNS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE,
  ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE,
  assertActualSourceEligibilityDryRunStructure,
} = require('./actual-source-eligibility-dry-run-schema');
const {
  BILLING_SOURCE_AUTHORITY_TABLES,
} = require('./billing-source-authority-schema');

const OPERATION_TYPE = 'evaluate_actual_source_dry_run';
const CAPABILITY_KEY = 'receivables.read';
const SOURCE_KINDS = Object.freeze([...BILLING_SOURCE_AUTHORITY_TABLES]);
const SOURCE_KIND_SET = new Set(SOURCE_KINDS);

function generateId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function repositoryFail(code, message, field, status = 409) {
  throw new ActualSourceEligibilityDryRunError(code, message, field, status);
}

function parseCanonicalJson(value, field, expectedType) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    repositoryFail('ACTUAL_SOURCE_RECONCILIATION_FAILED', `Persisted ${field} is invalid JSON.`, field, 500);
  }
  if (
    stableJson(parsed) !== value
    || (expectedType === 'array' && !Array.isArray(parsed))
    || (expectedType === 'object' && (!parsed || Array.isArray(parsed) || typeof parsed !== 'object'))
  ) repositoryFail('ACTUAL_SOURCE_RECONCILIATION_FAILED', `Persisted ${field} is not canonical.`, field, 500);
  return parsed;
}

function sourceVersion(row) {
  for (const field of ['version', 'sourceVersion', 'sourceEventVersion', 'resultVersion', 'aggregateVersion']) {
    if (Number.isSafeInteger(Number(row[field])) && Number(row[field]) >= 1) return Number(row[field]);
  }
  return null;
}

function externalAssertionHash(row) {
  const fields = [
    'sourceHash', 'contentHash', 'evidenceHash', 'sliceHash', 'mappingHash', 'identityHash',
    'provenanceHash', 'calculationInputsHash', 'evidenceSetHash', 'lineSetHash',
    'approvalFingerprint', 'commandFingerprint', 'resultFingerprint', 'afterFingerprint',
  ];
  const assertions = {};
  for (const field of fields) {
    if (typeof row[field] === 'string' && /^[a-f0-9]{64}$/.test(row[field])) {
      assertions[field] = row[field];
    }
  }
  const keys = Object.keys(assertions);
  if (keys.length === 0) return null;
  if (keys.length === 1) return assertions[keys[0]];
  return fingerprint(assertions);
}

function sourceState(row) {
  return row.state
    || row.status
    || row.eventType
    || row.sourceIntegrityStatus
    || row.authorityStatus
    || row.action
    || row.operationType
    || 'recorded';
}

function relationships(row) {
  const fields = [
    'activationBoundaryId', 'rentalLineId', 'periodId', 'closedPeriodVersionId',
    'snapshotId', 'updId', 'formedUpdVersionId', 'previousVersionId',
    'updLineId', 'updLineVersionId', 'coverageSetId', 'originalCoverageSetId',
    'replacementCoverageSetId', 'operationId', 'rentalId', 'clientId', 'contractId',
  ];
  const result = {};
  for (const field of fields) {
    if (row[field] !== undefined && row[field] !== null) result[field] = row[field];
  }
  return result;
}

function relationshipColumn(row, field) {
  if (field === 'updVersionId') return row.id && row.updId && row.version ? row.id : null;
  if (field === 'coverageSliceId') return row.coverageSetId && row.updLineVersionId ? row.id : null;
  if (field === 'sourceOperationId') return row.operationId || null;
  return row[field] || null;
}

function canonicalSourceInput(sourceKind, row) {
  if (!SOURCE_KIND_SET.has(sourceKind)) {
    repositoryFail('ACTUAL_SOURCE_KIND_REJECTED', 'Source kind is not allow-listed.', 'sourceKind', 500);
  }
  const canonicalRow = Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right)));
  const normalizedInputHash = fingerprint({ sourceKind, row: canonicalRow });
  return Object.freeze({
    sourceKind,
    sourceTableIdentity: sourceKind,
    sourceId: String(row.id),
    sourceVersion: sourceVersion(row),
    externalAssertionHash: externalAssertionHash(row),
    normalizedInputHash,
    sourceState: String(sourceState(row)),
    deterministicOrderKey: fingerprint({ sourceKind, sourceId: String(row.id) }),
    activationBoundaryId: relationshipColumn(row, 'activationBoundaryId'),
    rentalLineId: relationshipColumn(row, 'rentalLineId'),
    periodId: relationshipColumn(row, 'periodId'),
    closedPeriodVersionId: relationshipColumn(row, 'closedPeriodVersionId'),
    snapshotId: relationshipColumn(row, 'snapshotId'),
    updId: relationshipColumn(row, 'updId'),
    updVersionId: relationshipColumn(row, 'updVersionId'),
    updLineId: relationshipColumn(row, 'updLineId'),
    updLineVersionId: relationshipColumn(row, 'updLineVersionId'),
    coverageSetId: relationshipColumn(row, 'coverageSetId'),
    coverageSliceId: relationshipColumn(row, 'coverageSliceId'),
    sourceOperationId: relationshipColumn(row, 'sourceOperationId'),
    relationships: Object.freeze(relationships(row)),
    row: Object.freeze(canonicalRow),
  });
}

function manifestEntry(input) {
  return Object.freeze({
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    sourceVersion: input.sourceVersion,
    externalAssertionHash: input.externalAssertionHash,
    normalizedInputHash: input.normalizedInputHash,
    deterministicOrderKey: input.deterministicOrderKey,
  });
}

function canonicalSourceUniverse(companyId, branchId, inputs) {
  const sorted = [...inputs].sort((left, right) => (
    left.deterministicOrderKey.localeCompare(right.deterministicOrderKey)
  ));
  const manifest = Object.freeze(sorted.map(manifestEntry));
  const inputSetHash = fingerprint({
    sourceContractVersion: 'billing-source-authority-pr6-complete-branch-manifest-v1',
    companyId,
    branchId,
    expectedCounts: Object.fromEntries(SOURCE_KINDS.map(kind => [
      kind,
      sorted.filter(input => input.sourceKind === kind).length,
    ])),
    inputs: manifest,
  });
  return Object.freeze({
    companyId,
    branchId,
    manifest,
    inputSetHash,
    inputs: Object.freeze(sorted),
  });
}

function sourceDriftCode(before, after) {
  const beforeManifest = before.manifest || before.sourceInputManifest;
  const beforeIdentity = beforeManifest.map(item => ({
    sourceKind: item.sourceKind,
    sourceId: item.sourceId,
    sourceVersion: item.sourceVersion,
  }));
  const afterIdentity = after.manifest.map(item => ({
    sourceKind: item.sourceKind,
    sourceId: item.sourceId,
    sourceVersion: item.sourceVersion,
  }));
  return stableJson(beforeIdentity) === stableJson(afterIdentity)
    ? 'SOURCE_HASH_DRIFT'
    : 'SOURCE_VERSION_DRIFT';
}

function commandFingerprint(context, plan) {
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
    policyManifestHash: plan.policyManifestHash,
    sourceInputManifestHash: plan.sourceInputManifestHash,
    reasonCode: plan.reasonCode,
    reasonText: plan.reasonText,
    evaluatorVersion: plan.evaluatorVersion,
  });
}

function projectRun(row, operationId, replayed) {
  return Object.freeze({
    dryRunId: row.id,
    companyId: row.companyId,
    branchId: row.branchId,
    companyTimezone: row.companyTimezone,
    asOfDate: row.asOfDate,
    evaluatorVersion: row.evaluatorVersion,
    policyManifestHash: row.policyManifestHash,
    sourceInputManifestHash: row.sourceInputManifestHash,
    sourceInputCount: Number(row.sourceInputCount),
    candidateCount: Number(row.candidateCount),
    checkCount: Number(row.checkCount),
    reconciliationCount: Number(row.reconciliationCount),
    diagnosticCount: Number(row.diagnosticCount),
    eligibleCandidateCount: Number(row.eligibleCandidateCount),
    blockedCandidateCount: Number(row.blockedCandidateCount),
    runNetMinor: Number(row.runNetMinor),
    runVatMinor: Number(row.runVatMinor),
    runGrossMinor: Number(row.runGrossMinor),
    eligibleCandidateNetMinor: Number(row.eligibleCandidateNetMinor),
    eligibleCandidateVatMinor: Number(row.eligibleCandidateVatMinor),
    eligibleCandidateGrossMinor: Number(row.eligibleCandidateGrossMinor),
    resultHash: row.resultHash,
    status: row.status,
    diagnosticOnly: Boolean(row.diagnosticOnly),
    canonicalWriteAuthorized: Boolean(row.canonicalWriteAuthorized),
    productionActivationAuthorized: Boolean(row.productionActivationAuthorized),
    correlationId: row.correlationId,
    operationId,
    createdAt: row.createdAt,
    finalizedAt: row.finalizedAt,
    replayed,
  });
}

function createActualSourceEligibilityDryRunRepository(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    repositoryFail('ACTUAL_SOURCE_DATABASE_REQUIRED', 'A better-sqlite3 database is required.', 'db', 500);
  }
  assertActualSourceEligibilityDryRunStructure(db);

  function readUsers() {
    const row = db.prepare("SELECT json FROM app_data WHERE name = 'users'").get();
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
    assertActualSourceDryRunContext(context);
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

  function readUniverse(context, plan) {
    const inputs = [];
    for (const sourceKind of SOURCE_KINDS) {
      const rows = db.prepare(`
        SELECT * FROM ${sourceKind}
        WHERE companyId = ? AND branchId = ?
        ORDER BY id
      `).all(context.companyId, plan.branchId);
      for (const row of rows) inputs.push(canonicalSourceInput(sourceKind, row));
    }
    return canonicalSourceUniverse(context.companyId, plan.branchId, inputs);
  }

  function prepareDryRun(context, commandPlan) {
    assertActualSourceDryRunContext(context);
    assertActualSourceCommandPlan(commandPlan);
    authorize(context, commandPlan);
    const universe = readUniverse(context, commandPlan);
    if (
      commandPlan.expectedInputSetHash
      && commandPlan.expectedInputSetHash !== universe.inputSetHash
    ) {
      repositoryFail(
        'ACTUAL_SOURCE_INPUT_SET_HASH_MISMATCH',
        'Expected source input hash does not match the complete repository manifest.',
        'expectedInputSetHash',
      );
    }
    const evaluation = evaluateActualSourceEligibility(
      { ...context, branchId: commandPlan.branchId },
      commandPlan,
      universe,
    );
    return createActualSourceExecutionPlan(commandPlan, universe, evaluation);
  }

  function replayOrConflict(context, plan, commandHash) {
    const operation = db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE}
      WHERE companyId = ? AND operationType = ? AND idempotencyKey = ?
    `).get(context.companyId, OPERATION_TYPE, plan.idempotencyKey);
    if (!operation) return null;
    if (
      operation.branchId !== plan.branchId
      || operation.actorPrincipalId !== context.principalId
      || operation.actorMembershipId !== context.membershipId
      || Number(operation.actorMembershipVersion) !== context.membershipVersion
      || operation.roleTemplateKey !== context.roleTemplateKey
      || Number(operation.roleTemplateVersion) !== context.roleTemplateVersion
      || Number(operation.capabilityCatalogVersion) !== context.capabilityCatalogVersion
      || operation.capabilityKey !== CAPABILITY_KEY
      || operation.policyManifestHash !== plan.policyManifestHash
      || operation.inputSetHash !== plan.sourceInputManifestHash
      || operation.commandFingerprint !== commandHash
    ) {
      repositoryFail(
        'ACTUAL_SOURCE_IDEMPOTENCY_CONFLICT',
        'The idempotency key was used with different source, policy, content, or authority.',
        'idempotencyKey',
      );
    }
    const run = db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUNS_TABLE}
      WHERE companyId = ? AND branchId = ? AND id = ?
    `).get(context.companyId, plan.branchId, operation.resultRunId);
    if (!run || run.resultHash !== operation.resultHash) {
      repositoryFail(
        'ACTUAL_SOURCE_RECONCILIATION_FAILED',
        'Persisted idempotent dry-run result is unavailable.',
        'idempotencyKey',
        500,
      );
    }
    return projectRun(run, operation.id, true);
  }

  function insertRun(context, plan, ids, createdAt) {
    const result = plan.result;
    db.prepare(`
      INSERT INTO ${ACTUAL_SOURCE_DRY_RUNS_TABLE} (
        id, companyId, branchId, companyTimezone, asOfDate, evaluatorVersion,
        schemaVersion, policyManifestJson, policyManifestHash, sourceInputManifestJson,
        sourceInputManifestHash, sourceInputCount, candidateCount, checkCount,
        reconciliationCount, diagnosticCount, eligibleCandidateCount,
        blockedCandidateCount, runNetMinor, runVatMinor, runGrossMinor,
        eligibleCandidateNetMinor, eligibleCandidateVatMinor, eligibleCandidateGrossMinor,
        resultHash, status, diagnosticOnly, canonicalWriteAuthorized,
        productionActivationAuthorized, correlationId, operationId, createdAt, finalizedAt
      ) VALUES (
        @id, @companyId, @branchId, @companyTimezone, @asOfDate, @evaluatorVersion,
        @schemaVersion, @policyManifestJson, @policyManifestHash, @sourceInputManifestJson,
        @sourceInputManifestHash, @sourceInputCount, @candidateCount, @checkCount,
        @reconciliationCount, @diagnosticCount, @eligibleCandidateCount,
        @blockedCandidateCount, @runNetMinor, @runVatMinor, @runGrossMinor,
        @eligibleCandidateNetMinor, @eligibleCandidateVatMinor, @eligibleCandidateGrossMinor,
        @resultHash, @status, 1, 0, 0, @correlationId, @operationId, @createdAt, @createdAt
      )
    `).run({
      id: ids.runId,
      companyId: context.companyId,
      branchId: plan.branchId,
      companyTimezone: context.companyTimezone,
      asOfDate: plan.asOfDate,
      evaluatorVersion: plan.evaluatorVersion,
      schemaVersion: ACTUAL_SOURCE_DRY_RUN_SCHEMA_VERSION,
      policyManifestJson: stableJson(plan.policyManifest),
      policyManifestHash: plan.policyManifestHash,
      sourceInputManifestJson: stableJson(plan.sourceInputManifest),
      sourceInputManifestHash: plan.sourceInputManifestHash,
      sourceInputCount: result.counts.sourceInputCount,
      candidateCount: result.counts.candidateCount,
      checkCount: result.counts.checkCount,
      reconciliationCount: result.counts.reconciliationCount,
      diagnosticCount: result.counts.diagnosticCount,
      eligibleCandidateCount: result.counts.eligibleCandidateCount,
      blockedCandidateCount: result.counts.blockedCandidateCount,
      runNetMinor: result.runTotals.netMinor,
      runVatMinor: result.runTotals.vatMinor,
      runGrossMinor: result.runTotals.grossMinor,
      eligibleCandidateNetMinor: result.eligibleTotals.netMinor,
      eligibleCandidateVatMinor: result.eligibleTotals.vatMinor,
      eligibleCandidateGrossMinor: result.eligibleTotals.grossMinor,
      resultHash: result.resultHash,
      status: result.status,
      correlationId: plan.correlationId,
      operationId: ids.operationId,
      createdAt,
    });
  }

  function insertInputs(context, plan, runId, createdAt) {
    const statement = db.prepare(`
      INSERT INTO ${ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE} (
        id, runId, companyId, branchId, sourceKind, sourceTableIdentity, sourceId,
        sourceVersion, externalAssertionHash, normalizedInputHash, sourceState,
        deterministicOrderKey, activationBoundaryId, rentalLineId, periodId,
        closedPeriodVersionId, snapshotId, updId, updVersionId, updLineId,
        updLineVersionId, coverageSetId, coverageSliceId, sourceOperationId,
        relationshipJson, schemaVersion, createdAt
      ) VALUES (
        @id, @runId, @companyId, @branchId, @sourceKind, @sourceTableIdentity, @sourceId,
        @sourceVersion, @externalAssertionHash, @normalizedInputHash, @sourceState,
        @deterministicOrderKey, @activationBoundaryId, @rentalLineId, @periodId,
        @closedPeriodVersionId, @snapshotId, @updId, @updVersionId, @updLineId,
        @updLineVersionId, @coverageSetId, @coverageSliceId, @sourceOperationId,
        @relationshipJson, @schemaVersion, @createdAt
      )
    `);
    for (const input of plan.sourceInputs) {
      statement.run({
        id: generateId('actual-source-input'),
        runId,
        companyId: context.companyId,
        branchId: plan.branchId,
        sourceKind: input.sourceKind,
        sourceTableIdentity: input.sourceTableIdentity,
        sourceId: input.sourceId,
        sourceVersion: input.sourceVersion,
        externalAssertionHash: input.externalAssertionHash,
        normalizedInputHash: input.normalizedInputHash,
        sourceState: input.sourceState,
        deterministicOrderKey: input.deterministicOrderKey,
        activationBoundaryId: input.activationBoundaryId,
        rentalLineId: input.rentalLineId,
        periodId: input.periodId,
        closedPeriodVersionId: input.closedPeriodVersionId,
        snapshotId: input.snapshotId,
        updId: input.updId,
        updVersionId: input.updVersionId,
        updLineId: input.updLineId,
        updLineVersionId: input.updLineVersionId,
        coverageSetId: input.coverageSetId,
        coverageSliceId: input.coverageSliceId,
        sourceOperationId: input.sourceOperationId,
        relationshipJson: stableJson(input.relationships),
        schemaVersion: ACTUAL_SOURCE_DRY_RUN_SCHEMA_VERSION,
        createdAt,
      });
    }
  }

  function insertCandidates(context, plan, runId, createdAt) {
    const ids = new Map();
    const statement = db.prepare(`
      INSERT INTO ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE} (
        id, runId, companyId, branchId, candidateKey, activationBoundaryId,
        rentalLineId, rentalId, clientId, contractId, periodId, closedPeriodVersionId,
        snapshotId, updId, formedUpdVersionId, currentConductedUpdVersionId,
        updLineId, updLineVersionId, coverageSetId, coverageSliceId, sliceStartDate,
        sliceEndDateExclusive, sourceNetMinor, sourceVatMinor, sourceGrossMinor,
        currency, contractualDueDate, dueDateProvenance, dueDateEvidenceRef,
        proposedOriginalAmountMinor, status, blockerCodesJson, policyManifestHash,
        inputLineageHash, resultHash, diagnosticOnly, canonicalWriteAuthorized,
        productionActivationAuthorized, schemaVersion, createdAt
      ) VALUES (
        @id, @runId, @companyId, @branchId, @candidateKey, @activationBoundaryId,
        @rentalLineId, @rentalId, @clientId, @contractId, @periodId, @closedPeriodVersionId,
        @snapshotId, @updId, @formedUpdVersionId, @currentConductedUpdVersionId,
        @updLineId, @updLineVersionId, @coverageSetId, @coverageSliceId, @sliceStartDate,
        @sliceEndDateExclusive, @sourceNetMinor, @sourceVatMinor, @sourceGrossMinor,
        @currency, @contractualDueDate, @dueDateProvenance, @dueDateEvidenceRef,
        @proposedOriginalAmountMinor, @status, @blockerCodesJson, @policyManifestHash,
        @inputLineageHash, @resultHash, 1, 0, 0, @schemaVersion, @createdAt
      )
    `);
    for (const candidate of plan.candidates) {
      const id = generateId('actual-source-candidate');
      ids.set(candidate.candidateKey, id);
      statement.run({
        ...candidate,
        id,
        runId,
        companyId: context.companyId,
        branchId: plan.branchId,
        blockerCodesJson: stableJson(candidate.blockerCodes),
        schemaVersion: ACTUAL_SOURCE_DRY_RUN_SCHEMA_VERSION,
        createdAt,
      });
    }
    return ids;
  }

  function insertChecks(context, plan, runId, candidateIds, createdAt) {
    const statement = db.prepare(`
      INSERT INTO ${ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE} (
        id, runId, candidateId, companyId, branchId, gateCode, outcome,
        policyDecisionRef, policyDecisionVersion, policyDecisionHash,
        sourceEvidenceRefsJson, expectedFingerprint, observedFingerprint,
        reasonCode, checkHash, schemaVersion, createdAt
      ) VALUES (
        @id, @runId, @candidateId, @companyId, @branchId, @gateCode, @outcome,
        @policyDecisionRef, @policyDecisionVersion, @policyDecisionHash,
        @sourceEvidenceRefsJson, @expectedFingerprint, @observedFingerprint,
        @reasonCode, @checkHash, @schemaVersion, @createdAt
      )
    `);
    for (const item of plan.checks) {
      statement.run({
        ...item,
        id: generateId('actual-source-check'),
        runId,
        candidateId: item.candidateKey ? candidateIds.get(item.candidateKey) : null,
        companyId: context.companyId,
        branchId: plan.branchId,
        sourceEvidenceRefsJson: stableJson(item.sourceEvidenceRefs),
        schemaVersion: ACTUAL_SOURCE_DRY_RUN_SCHEMA_VERSION,
        createdAt,
      });
    }
  }

  function insertReconciliations(context, plan, runId, candidateIds, createdAt) {
    const statement = db.prepare(`
      INSERT INTO ${ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE} (
        id, runId, candidateId, companyId, branchId, dimensionKind, dimensionIdsJson,
        expectedNetMinor, expectedVatMinor, expectedGrossMinor, observedNetMinor,
        observedVatMinor, observedGrossMinor, deltaNetMinor, deltaVatMinor,
        deltaGrossMinor, currency, reconciliationRuleVersion, sourceInputHash,
        blockerState, reconciliationHash, schemaVersion, createdAt
      ) VALUES (
        @id, @runId, @candidateId, @companyId, @branchId, @dimensionKind, @dimensionIdsJson,
        @expectedNetMinor, @expectedVatMinor, @expectedGrossMinor, @observedNetMinor,
        @observedVatMinor, @observedGrossMinor, @deltaNetMinor, @deltaVatMinor,
        @deltaGrossMinor, @currency, @reconciliationRuleVersion, @sourceInputHash,
        @blockerState, @reconciliationHash, @schemaVersion, @createdAt
      )
    `);
    for (const item of plan.reconciliations) {
      statement.run({
        id: generateId('actual-source-reconciliation'),
        runId,
        candidateId: item.candidateKey ? candidateIds.get(item.candidateKey) : null,
        companyId: context.companyId,
        branchId: plan.branchId,
        dimensionKind: item.dimensionKind,
        dimensionIdsJson: stableJson(item.dimensionIds),
        expectedNetMinor: item.expected.netMinor,
        expectedVatMinor: item.expected.vatMinor,
        expectedGrossMinor: item.expected.grossMinor,
        observedNetMinor: item.observed.netMinor,
        observedVatMinor: item.observed.vatMinor,
        observedGrossMinor: item.observed.grossMinor,
        deltaNetMinor: item.delta.netMinor,
        deltaVatMinor: item.delta.vatMinor,
        deltaGrossMinor: item.delta.grossMinor,
        currency: item.currency,
        reconciliationRuleVersion: item.reconciliationRuleVersion,
        sourceInputHash: item.sourceInputHash,
        blockerState: item.blockerState ? 1 : 0,
        reconciliationHash: item.reconciliationHash,
        schemaVersion: ACTUAL_SOURCE_DRY_RUN_SCHEMA_VERSION,
        createdAt,
      });
    }
  }

  function insertDiagnostics(context, plan, runId, candidateIds, createdAt) {
    const statement = db.prepare(`
      INSERT INTO ${ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE} (
        id, runId, candidateId, companyId, branchId, severity, code, sourceKind,
        sourceId, sourceVersion, affectedStartDate, affectedEndDateExclusive,
        expectedEvidenceJson, observedEvidenceJson, policyReferencesJson, detectedAt,
        detectorVersion, diagnosticHash, schemaVersion
      ) VALUES (
        @id, @runId, @candidateId, @companyId, @branchId, @severity, @code, @sourceKind,
        @sourceId, @sourceVersion, @affectedStartDate, @affectedEndDateExclusive,
        @expectedEvidenceJson, @observedEvidenceJson, @policyReferencesJson, @detectedAt,
        @detectorVersion, @diagnosticHash, @schemaVersion
      )
    `);
    for (const item of plan.diagnostics) {
      statement.run({
        id: generateId('actual-source-diagnostic'),
        runId,
        candidateId: item.candidateKey ? candidateIds.get(item.candidateKey) : null,
        companyId: context.companyId,
        branchId: plan.branchId,
        severity: item.severity,
        code: item.code,
        sourceKind: item.sourceKind,
        sourceId: item.sourceId,
        sourceVersion: item.sourceVersion,
        affectedStartDate: item.affectedStartDate,
        affectedEndDateExclusive: item.affectedEndDateExclusive,
        expectedEvidenceJson: stableJson(item.expectedEvidence),
        observedEvidenceJson: stableJson(item.observedEvidence),
        policyReferencesJson: stableJson(item.policyReferences),
        detectedAt: createdAt,
        detectorVersion: item.detectorVersion,
        diagnosticHash: item.diagnosticHash,
        schemaVersion: ACTUAL_SOURCE_DRY_RUN_SCHEMA_VERSION,
      });
    }
  }

  function assertPersistedResult(context, plan, runId) {
    const run = db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUNS_TABLE}
      WHERE companyId = ? AND branchId = ? AND id = ?
    `).get(context.companyId, plan.branchId, runId);
    if (!run) repositoryFail('ACTUAL_SOURCE_RECONCILIATION_FAILED', 'Persisted run is unavailable.', 'runId', 500);
    const persistedPolicy = parseCanonicalJson(run.policyManifestJson, 'policyManifestJson', 'object');
    const persistedManifest = parseCanonicalJson(run.sourceInputManifestJson, 'sourceInputManifestJson', 'array');
    if (
      fingerprint(persistedPolicy) !== plan.policyManifestHash
      || stableJson(persistedManifest) !== stableJson(plan.sourceInputManifest)
      || run.sourceInputManifestHash !== plan.sourceInputManifestHash
      || run.resultHash !== plan.result.resultHash
    ) repositoryFail('ACTUAL_SOURCE_RECONCILIATION_FAILED', 'Persisted run hashes drifted.', 'run', 500);

    const inputRows = db.prepare(`
      SELECT sourceKind, sourceId, sourceVersion, externalAssertionHash, normalizedInputHash,
             deterministicOrderKey, relationshipJson
      FROM ${ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE}
      WHERE companyId = ? AND branchId = ? AND runId = ?
      ORDER BY deterministicOrderKey
    `).all(context.companyId, plan.branchId, runId);
    if (inputRows.length !== plan.sourceInputs.length) {
      repositoryFail('ACTUAL_SOURCE_RECONCILIATION_FAILED', 'Persisted source input count drifted.', 'sourceInputCount', 500);
    }
    for (let index = 0; index < inputRows.length; index += 1) {
      const row = inputRows[index];
      const expected = plan.sourceInputs[index];
      parseCanonicalJson(row.relationshipJson, `inputs[${index}].relationshipJson`, 'object');
      if (
        row.sourceKind !== expected.sourceKind
        || row.sourceId !== expected.sourceId
        || (row.sourceVersion ?? null) !== (expected.sourceVersion ?? null)
        || (row.externalAssertionHash ?? null) !== (expected.externalAssertionHash ?? null)
        || row.normalizedInputHash !== expected.normalizedInputHash
        || row.deterministicOrderKey !== expected.deterministicOrderKey
        || row.relationshipJson !== stableJson(expected.relationships)
      ) repositoryFail('ACTUAL_SOURCE_RECONCILIATION_FAILED', 'Persisted source input drifted.', 'inputs', 500);
    }

    const candidates = db.prepare(`
      SELECT status, sourceNetMinor, sourceVatMinor, sourceGrossMinor, candidateKey,
             resultHash, blockerCodesJson
      FROM ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE}
      WHERE companyId = ? AND branchId = ? AND runId = ? ORDER BY candidateKey
    `).all(context.companyId, plan.branchId, runId);
    const counts = {
      sourceInputCount: inputRows.length,
      candidateCount: candidates.length,
      checkCount: Number(db.prepare(`SELECT COUNT(*) AS count FROM ${ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE} WHERE runId = ?`).get(runId).count),
      reconciliationCount: Number(db.prepare(`SELECT COUNT(*) AS count FROM ${ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE} WHERE runId = ?`).get(runId).count),
      diagnosticCount: Number(db.prepare(`SELECT COUNT(*) AS count FROM ${ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE} WHERE runId = ?`).get(runId).count),
      eligibleCandidateCount: candidates.filter(row => row.status === 'eligible_candidate').length,
      blockedCandidateCount: candidates.filter(row => row.status === 'blocked').length,
    };
    if (stableJson(counts) !== stableJson(plan.result.counts)) {
      repositoryFail('ACTUAL_SOURCE_RECONCILIATION_FAILED', 'Persisted result counts drifted.', 'counts', 500);
    }
    for (const row of candidates) parseCanonicalJson(row.blockerCodesJson, 'blockerCodesJson', 'array');
    const totals = rows => ({
      netMinor: safeAdd(rows.map(row => Number(row.sourceNetMinor)), 'persistedNetMinor'),
      vatMinor: safeAdd(rows.map(row => Number(row.sourceVatMinor)), 'persistedVatMinor'),
      grossMinor: safeAdd(rows.map(row => Number(row.sourceGrossMinor)), 'persistedGrossMinor'),
    });
    const runTotals = totals(candidates);
    const eligibleTotals = totals(candidates.filter(row => row.status === 'eligible_candidate'));
    if (
      stableJson(runTotals) !== stableJson(plan.result.runTotals)
      || stableJson(eligibleTotals) !== stableJson(plan.result.eligibleTotals)
    ) repositoryFail('ACTUAL_SOURCE_RECONCILIATION_FAILED', 'Persisted result totals drifted.', 'totals', 500);
    return run;
  }

  function insertAudit(context, plan, ids, createdAt) {
    db.prepare(`
      INSERT INTO ${ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE} (
        id, companyId, branchId, aggregateType, aggregateId, aggregateVersion, eventType,
        actorType, actorPrincipalId, actorMembershipId, actorMembershipVersion,
        roleTemplateKey, roleTemplateVersion, capabilityCatalogVersion, capabilityKey,
        correlationId, reasonCode, reasonText, beforeFingerprint, afterFingerprint,
        inputSetHash, resultHash, inputCount, candidateCount, checkCount,
        reconciliationCount, diagnosticCount, operationId, schemaVersion, createdAt
      ) VALUES (
        @id, @companyId, @branchId, 'actual_source_dry_run', @aggregateId, 1,
        'actual_source_dry_run_evaluated', 'user', @actorPrincipalId, @actorMembershipId,
        @actorMembershipVersion, @roleTemplateKey, @roleTemplateVersion,
        @capabilityCatalogVersion, @capabilityKey, @correlationId, @reasonCode,
        @reasonText, NULL, @afterFingerprint, @inputSetHash, @resultHash, @inputCount,
        @candidateCount, @checkCount, @reconciliationCount, @diagnosticCount,
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
      afterFingerprint: plan.result.resultHash,
      inputSetHash: plan.sourceInputManifestHash,
      resultHash: plan.result.resultHash,
      inputCount: plan.result.counts.sourceInputCount,
      candidateCount: plan.result.counts.candidateCount,
      checkCount: plan.result.counts.checkCount,
      reconciliationCount: plan.result.counts.reconciliationCount,
      diagnosticCount: plan.result.counts.diagnosticCount,
      operationId: ids.operationId,
      schemaVersion: ACTUAL_SOURCE_DRY_RUN_SCHEMA_VERSION,
      createdAt,
    });
  }

  function insertOperation(context, plan, ids, commandHash, createdAt) {
    db.prepare(`
      INSERT INTO ${ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE} (
        id, companyId, branchId, operationType, idempotencyKey, commandFingerprint,
        policyManifestHash, inputSetHash, actorPrincipalId, actorMembershipId,
        actorMembershipVersion, roleTemplateKey, roleTemplateVersion,
        capabilityCatalogVersion, capabilityKey, resultRunId, resultHash, auditEventId,
        correlationId, schemaVersion, createdAt
      ) VALUES (
        @id, @companyId, @branchId, @operationType, @idempotencyKey, @commandFingerprint,
        @policyManifestHash, @inputSetHash, @actorPrincipalId, @actorMembershipId,
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
      policyManifestHash: plan.policyManifestHash,
      inputSetHash: plan.sourceInputManifestHash,
      actorPrincipalId: context.principalId,
      actorMembershipId: context.membershipId,
      actorMembershipVersion: context.membershipVersion,
      roleTemplateKey: context.roleTemplateKey,
      roleTemplateVersion: context.roleTemplateVersion,
      capabilityCatalogVersion: context.capabilityCatalogVersion,
      capabilityKey: CAPABILITY_KEY,
      resultRunId: ids.runId,
      resultHash: plan.result.resultHash,
      auditEventId: ids.auditEventId,
      correlationId: plan.correlationId,
      schemaVersion: ACTUAL_SOURCE_DRY_RUN_SCHEMA_VERSION,
      createdAt,
    });
  }

  function evaluateDryRun(context, executionPlan) {
    assertActualSourceDryRunContext(context);
    assertActualSourceExecutionPlan(executionPlan);
    try {
      return db.transaction(() => {
        authorize(context, executionPlan);
        if (fingerprint(executionPlan.policyManifest) !== executionPlan.policyManifestHash) {
          repositoryFail('POLICY_MANIFEST_DRIFT', 'Policy manifest drifted after planning.', 'policyManifest');
        }
        const lockedUniverse = readUniverse(context, executionPlan);
        if (lockedUniverse.inputSetHash !== executionPlan.sourceInputManifestHash) {
          const code = sourceDriftCode(executionPlan, lockedUniverse);
          repositoryFail(code, 'Billing-source authority changed after planning.', 'sourceInputManifest');
        }
        const lockedEvaluation = evaluateActualSourceEligibility(
          { ...context, branchId: executionPlan.branchId },
          executionPlan,
          lockedUniverse,
        );
        if (lockedEvaluation.result.resultHash !== executionPlan.result.resultHash) {
          repositoryFail('SOURCE_HASH_DRIFT', 'Eligibility result drifted under the repository lock.', 'result');
        }
        const commandHash = commandFingerprint(context, executionPlan);
        const replay = replayOrConflict(context, executionPlan, commandHash);
        if (replay) return replay;

        const createdAt = new Date().toISOString();
        const ids = {
          runId: generateId('actual-source-run'),
          operationId: generateId('actual-source-operation'),
          auditEventId: generateId('actual-source-audit'),
        };
        insertRun(context, executionPlan, ids, createdAt);
        insertInputs(context, executionPlan, ids.runId, createdAt);
        const candidateIds = insertCandidates(context, executionPlan, ids.runId, createdAt);
        insertChecks(context, executionPlan, ids.runId, candidateIds, createdAt);
        insertReconciliations(context, executionPlan, ids.runId, candidateIds, createdAt);
        insertDiagnostics(context, executionPlan, ids.runId, candidateIds, createdAt);
        const run = assertPersistedResult(context, executionPlan, ids.runId);
        insertAudit(context, executionPlan, ids, createdAt);
        insertOperation(context, executionPlan, ids, commandHash, createdAt);
        const operation = db.prepare(`
          SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE}
          WHERE companyId = ? AND branchId = ? AND id = ?
        `).get(context.companyId, executionPlan.branchId, ids.operationId);
        const audit = db.prepare(`
          SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE}
          WHERE companyId = ? AND branchId = ? AND id = ?
        `).get(context.companyId, executionPlan.branchId, ids.auditEventId);
        if (
          !operation
          || !audit
          || operation.resultHash !== run.resultHash
          || audit.resultHash !== run.resultHash
          || operation.inputSetHash !== run.sourceInputManifestHash
          || audit.inputSetHash !== run.sourceInputManifestHash
          || operation.auditEventId !== audit.id
          || audit.operationId !== operation.id
        ) repositoryFail('ACTUAL_SOURCE_RECONCILIATION_FAILED', 'Operation/audit sealing failed.', 'operation', 500);
        return projectRun(run, ids.operationId, false);
      }).immediate();
    } catch (error) {
      if (error?.code === 'SQLITE_BUSY' || error?.code === 'SQLITE_LOCKED') {
        repositoryFail(
          'ACTUAL_SOURCE_CONCURRENT_CONFLICT',
          'Concurrent dry-run evaluation conflicted; retry from fresh state.',
          'operation',
        );
      }
      throw error;
    }
  }

  return Object.freeze({ prepareDryRun, evaluateDryRun });
}

module.exports = {
  CAPABILITY_KEY,
  OPERATION_TYPE,
  SOURCE_KINDS,
  canonicalSourceInput,
  canonicalSourceUniverse,
  commandFingerprint,
  createActualSourceEligibilityDryRunRepository,
};
