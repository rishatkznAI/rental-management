const {
  materializeInert,
} = require('./actual-source-eligibility-dry-run-domain');
const {
  ACTUAL_SOURCE_DRY_RUNS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE,
  ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE,
  assertActualSourceEligibilityDryRunStructure,
} = require('./actual-source-eligibility-dry-run-schema');

const ACTUAL_SOURCE_READ_SCOPES = new WeakSet();
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const FORBIDDEN_BRANCH_IDS = new Set(['*', 'all', 'global', 'company-wide', 'company_wide', 'any', 'null']);

class ActualSourceEligibilityDryRunReadError extends Error {
  constructor(code, message, field, status = 400) {
    super(message);
    this.name = 'ActualSourceEligibilityDryRunReadError';
    this.code = code;
    this.field = field;
    this.status = status;
  }
}

function fail(code, message, field, status) {
  throw new ActualSourceEligibilityDryRunReadError(code, message, field, status);
}

function requiredId(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) {
    fail('ACTUAL_SOURCE_READ_SCOPE_INVALID', `${field} is required.`, field, 403);
  }
  return value.trim();
}

function exactFilters(value, allowed, field = 'filters') {
  const inert = materializeInert(value || {}, field);
  if (!inert || Array.isArray(inert) || typeof inert !== 'object') {
    fail('ACTUAL_SOURCE_READ_FILTER_INVALID', `${field} must be an object.`, field);
  }
  const unknown = Object.keys(inert).find(key => !allowed.has(key));
  if (unknown) fail('ACTUAL_SOURCE_READ_FILTER_INVALID', `${field}.${unknown} is unsupported.`, `${field}.${unknown}`);
  return inert;
}

function normalizeLimit(value) {
  const limit = value === undefined ? DEFAULT_LIMIT : value;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    fail('ACTUAL_SOURCE_READ_LIMIT_INVALID', `limit must be between 1 and ${MAX_LIMIT}.`, 'limit');
  }
  return limit;
}

function createActualSourceEligibilityDryRunReadScope(platformScope, options = {}) {
  const inert = materializeInert(platformScope, 'platformScope');
  if (
    !inert
    || inert.authenticated !== true
    || inert.principalType !== 'user'
    || !Array.isArray(inert.capabilities)
    || !inert.capabilities.includes('receivables.read')
    || !Array.isArray(inert.allowedBranchIds)
    || inert.allowedBranchIds.length === 0
  ) fail('ACTUAL_SOURCE_READ_SCOPE_DENIED', 'Actual-source dry-run read scope is unavailable.', 'scope', 403);
  const companyId = requiredId(inert.companyId, 'scope.companyId');
  let branchIds = [...new Set(inert.allowedBranchIds.map((value, index) => (
    requiredId(value, `scope.allowedBranchIds[${index}]`)
  )))].sort();
  if (branchIds.some(branchId => FORBIDDEN_BRANCH_IDS.has(branchId.toLowerCase()))) {
    fail('ACTUAL_SOURCE_READ_SCOPE_DENIED', 'Concrete branch scope is required.', 'scope.allowedBranchIds', 403);
  }
  if (options.branchId !== undefined && options.branchId !== null && options.branchId !== '') {
    const branchId = requiredId(options.branchId, 'branchId');
    if (!branchIds.includes(branchId)) {
      fail('ACTUAL_SOURCE_READ_NOT_FOUND', 'Actual-source dry-run data was not found.', 'branchId', 404);
    }
    branchIds = [branchId];
  }
  const scope = Object.freeze({
    companyId,
    principalId: requiredId(inert.principalId, 'scope.principalId'),
    membershipId: requiredId(inert.membershipId, 'scope.membershipId'),
    membershipVersion: inert.membershipVersion,
    capabilityCatalogVersion: inert.capabilityCatalogVersion,
    branchIds: Object.freeze(branchIds),
  });
  ACTUAL_SOURCE_READ_SCOPES.add(scope);
  return scope;
}

function assertReadScope(scope) {
  if (!scope || !ACTUAL_SOURCE_READ_SCOPES.has(scope)) {
    fail('ACTUAL_SOURCE_READ_SCOPE_REQUIRED', 'A branded internal dry-run read scope is required.', 'scope', 403);
  }
  return scope;
}

function runProjection(row, { detail = false } = {}) {
  if (!row) return null;
  const projection = {
    dryRunId: row.id,
    branchId: row.branchId,
    companyTimezone: row.companyTimezone,
    asOfDate: row.asOfDate,
    evaluatorVersion: row.evaluatorVersion,
    schemaVersion: Number(row.schemaVersion),
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
    canonicalWriteAuthorized: false,
    productionActivationAuthorized: false,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
    finalizedAt: row.finalizedAt,
  };
  if (detail) {
    projection.policyManifest = Object.freeze(JSON.parse(row.policyManifestJson));
    projection.sourceInputManifest = Object.freeze(JSON.parse(row.sourceInputManifestJson));
  }
  return Object.freeze(projection);
}

function candidateProjection(row) {
  return Object.freeze({
    candidateId: row.id,
    dryRunId: row.runId,
    branchId: row.branchId,
    candidateKey: row.candidateKey,
    activationBoundaryId: row.activationBoundaryId,
    rentalLineId: row.rentalLineId,
    rentalId: row.rentalId,
    clientId: row.clientId,
    contractId: row.contractId,
    periodId: row.periodId,
    closedPeriodVersionId: row.closedPeriodVersionId,
    snapshotId: row.snapshotId,
    updId: row.updId,
    formedUpdVersionId: row.formedUpdVersionId,
    currentConductedUpdVersionId: row.currentConductedUpdVersionId,
    updLineId: row.updLineId,
    updLineVersionId: row.updLineVersionId,
    coverageSetId: row.coverageSetId,
    coverageSliceId: row.coverageSliceId,
    sliceStartDate: row.sliceStartDate,
    sliceEndDateExclusive: row.sliceEndDateExclusive,
    sourceNetMinor: Number(row.sourceNetMinor),
    sourceVatMinor: Number(row.sourceVatMinor),
    sourceGrossMinor: Number(row.sourceGrossMinor),
    currency: row.currency,
    contractualDueDate: row.contractualDueDate,
    dueDateProvenance: row.dueDateProvenance,
    dueDateEvidenceRef: row.dueDateEvidenceRef,
    proposedOriginalAmountMinor: row.proposedOriginalAmountMinor == null
      ? null
      : Number(row.proposedOriginalAmountMinor),
    status: row.status,
    blockerCodes: Object.freeze(JSON.parse(row.blockerCodesJson)),
    policyManifestHash: row.policyManifestHash,
    inputLineageHash: row.inputLineageHash,
    resultHash: row.resultHash,
    diagnosticOnly: true,
    canonicalWriteAuthorized: false,
    productionActivationAuthorized: false,
    createdAt: row.createdAt,
  });
}

function checkProjection(row) {
  return Object.freeze({
    checkId: row.id,
    dryRunId: row.runId,
    candidateId: row.candidateId,
    branchId: row.branchId,
    gateCode: row.gateCode,
    outcome: row.outcome,
    policyDecisionRef: row.policyDecisionRef,
    policyDecisionVersion: row.policyDecisionVersion == null ? null : Number(row.policyDecisionVersion),
    policyDecisionHash: row.policyDecisionHash,
    sourceEvidenceRefs: Object.freeze(JSON.parse(row.sourceEvidenceRefsJson)),
    expectedFingerprint: row.expectedFingerprint,
    observedFingerprint: row.observedFingerprint,
    reasonCode: row.reasonCode,
    checkHash: row.checkHash,
    createdAt: row.createdAt,
  });
}

function reconciliationProjection(row) {
  return Object.freeze({
    reconciliationId: row.id,
    dryRunId: row.runId,
    candidateId: row.candidateId,
    branchId: row.branchId,
    dimensionKind: row.dimensionKind,
    dimensionIds: Object.freeze(JSON.parse(row.dimensionIdsJson)),
    expectedNetMinor: Number(row.expectedNetMinor),
    expectedVatMinor: Number(row.expectedVatMinor),
    expectedGrossMinor: Number(row.expectedGrossMinor),
    observedNetMinor: Number(row.observedNetMinor),
    observedVatMinor: Number(row.observedVatMinor),
    observedGrossMinor: Number(row.observedGrossMinor),
    deltaNetMinor: Number(row.deltaNetMinor),
    deltaVatMinor: Number(row.deltaVatMinor),
    deltaGrossMinor: Number(row.deltaGrossMinor),
    currency: row.currency,
    reconciliationRuleVersion: row.reconciliationRuleVersion,
    sourceInputHash: row.sourceInputHash,
    blockerState: Boolean(row.blockerState),
    reconciliationHash: row.reconciliationHash,
    createdAt: row.createdAt,
  });
}

function diagnosticProjection(row) {
  return Object.freeze({
    diagnosticId: row.id,
    dryRunId: row.runId,
    candidateId: row.candidateId,
    branchId: row.branchId,
    severity: row.severity,
    code: row.code,
    sourceKind: row.sourceKind,
    sourceId: row.sourceId,
    sourceVersion: row.sourceVersion == null ? null : Number(row.sourceVersion),
    affectedStartDate: row.affectedStartDate,
    affectedEndDateExclusive: row.affectedEndDateExclusive,
    expectedEvidence: Object.freeze(JSON.parse(row.expectedEvidenceJson)),
    observedEvidence: Object.freeze(JSON.parse(row.observedEvidenceJson)),
    policyReferences: Object.freeze(JSON.parse(row.policyReferencesJson)),
    detectedAt: row.detectedAt,
    detectorVersion: row.detectorVersion,
    diagnosticHash: row.diagnosticHash,
  });
}

function createActualSourceEligibilityDryRunReadRepository(db) {
  if (!db || typeof db.prepare !== 'function') {
    fail('ACTUAL_SOURCE_READ_DATABASE_REQUIRED', 'A better-sqlite3 database is required.', 'db', 500);
  }
  assertActualSourceEligibilityDryRunStructure(db);

  function scoped(scope, requestedBranchId) {
    assertReadScope(scope);
    const branches = requestedBranchId ? [requestedBranchId] : scope.branchIds;
    if (requestedBranchId && !scope.branchIds.includes(requestedBranchId)) {
      fail('ACTUAL_SOURCE_READ_NOT_FOUND', 'Actual-source dry-run data was not found.', 'branchId', 404);
    }
    return Object.freeze({
      branches,
      placeholders: branches.map(() => '?').join(', '),
      params: [scope.companyId, ...branches],
    });
  }

  function listDryRuns(scope, filters = {}, rawLimit) {
    const normalized = exactFilters(filters, new Set(['branchId', 'status', 'asOfDate']));
    const scopedQuery = scoped(scope, normalized.branchId);
    const where = [];
    const params = [...scopedQuery.params];
    if (normalized.status) {
      if (!['completed', 'completed_with_blockers', 'completed_no_candidates'].includes(normalized.status)) {
        fail('ACTUAL_SOURCE_READ_FILTER_INVALID', 'status is invalid.', 'filters.status');
      }
      where.push('status = ?');
      params.push(normalized.status);
    }
    if (normalized.asOfDate) {
      where.push('asOfDate = ?');
      params.push(normalized.asOfDate);
    }
    const limit = normalizeLimit(rawLimit);
    return Object.freeze(db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUNS_TABLE}
      WHERE companyId = ? AND branchId IN (${scopedQuery.placeholders})
        ${where.length > 0 ? `AND ${where.join(' AND ')}` : ''}
      ORDER BY createdAt DESC, id DESC LIMIT ?
    `).all(...params, limit).map(row => runProjection(row)));
  }

  function getDryRun(scope, runId) {
    const scopedQuery = scoped(scope);
    const row = db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUNS_TABLE}
      WHERE companyId = ? AND branchId IN (${scopedQuery.placeholders}) AND id = ?
    `).get(...scopedQuery.params, requiredId(runId, 'runId'));
    return runProjection(row, { detail: true });
  }

  function listCandidates(scope, runId, filters = {}, rawLimit) {
    const normalized = exactFilters(filters, new Set(['status', 'candidateKey']));
    const scopedQuery = scoped(scope);
    const where = [];
    const params = [...scopedQuery.params, requiredId(runId, 'runId')];
    if (normalized.status) {
      if (!['eligible_candidate', 'blocked'].includes(normalized.status)) {
        fail('ACTUAL_SOURCE_READ_FILTER_INVALID', 'status is invalid.', 'filters.status');
      }
      where.push('status = ?');
      params.push(normalized.status);
    }
    if (normalized.candidateKey) {
      where.push('candidateKey = ?');
      params.push(normalized.candidateKey);
    }
    return Object.freeze(db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE}
      WHERE companyId = ? AND branchId IN (${scopedQuery.placeholders}) AND runId = ?
        ${where.length > 0 ? `AND ${where.join(' AND ')}` : ''}
      ORDER BY candidateKey LIMIT ?
    `).all(...params, normalizeLimit(rawLimit)).map(candidateProjection));
  }

  function listChecks(scope, runId, filters = {}, rawLimit) {
    const normalized = exactFilters(filters, new Set(['candidateId', 'gateCode', 'outcome']));
    const scopedQuery = scoped(scope);
    const where = [];
    const params = [...scopedQuery.params, requiredId(runId, 'runId')];
    for (const field of ['candidateId', 'gateCode', 'outcome']) {
      if (normalized[field]) {
        where.push(`${field} = ?`);
        params.push(normalized[field]);
      }
    }
    return Object.freeze(db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE}
      WHERE companyId = ? AND branchId IN (${scopedQuery.placeholders}) AND runId = ?
        ${where.length > 0 ? `AND ${where.join(' AND ')}` : ''}
      ORDER BY ifnull(candidateId, ''), gateCode, id LIMIT ?
    `).all(...params, normalizeLimit(rawLimit)).map(checkProjection));
  }

  function listReconciliations(scope, runId, filters = {}, rawLimit) {
    const normalized = exactFilters(filters, new Set(['candidateId', 'dimensionKind', 'blockerState']));
    const scopedQuery = scoped(scope);
    const where = [];
    const params = [...scopedQuery.params, requiredId(runId, 'runId')];
    for (const field of ['candidateId', 'dimensionKind']) {
      if (normalized[field]) {
        where.push(`${field} = ?`);
        params.push(normalized[field]);
      }
    }
    if (normalized.blockerState !== undefined) {
      if (typeof normalized.blockerState !== 'boolean') {
        fail('ACTUAL_SOURCE_READ_FILTER_INVALID', 'blockerState must be boolean.', 'filters.blockerState');
      }
      where.push('blockerState = ?');
      params.push(normalized.blockerState ? 1 : 0);
    }
    return Object.freeze(db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE}
      WHERE companyId = ? AND branchId IN (${scopedQuery.placeholders}) AND runId = ?
        ${where.length > 0 ? `AND ${where.join(' AND ')}` : ''}
      ORDER BY ifnull(candidateId, ''), dimensionKind, dimensionIdsJson LIMIT ?
    `).all(...params, normalizeLimit(rawLimit)).map(reconciliationProjection));
  }

  function listDiagnostics(scope, runId, filters = {}, rawLimit) {
    const normalized = exactFilters(filters, new Set(['candidateId', 'code', 'severity']));
    const scopedQuery = scoped(scope);
    const where = [];
    const params = [...scopedQuery.params, requiredId(runId, 'runId')];
    for (const field of ['candidateId', 'code', 'severity']) {
      if (normalized[field]) {
        where.push(`${field} = ?`);
        params.push(normalized[field]);
      }
    }
    return Object.freeze(db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE}
      WHERE companyId = ? AND branchId IN (${scopedQuery.placeholders}) AND runId = ?
        ${where.length > 0 ? `AND ${where.join(' AND ')}` : ''}
      ORDER BY ifnull(candidateId, ''), code, diagnosticHash LIMIT ?
    `).all(...params, normalizeLimit(rawLimit)).map(diagnosticProjection));
  }

  function inspectOperation(scope, operationId) {
    const scopedQuery = scoped(scope);
    const row = db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE}
      WHERE companyId = ? AND branchId IN (${scopedQuery.placeholders}) AND id = ?
    `).get(...scopedQuery.params, requiredId(operationId, 'operationId'));
    if (!row) return null;
    return Object.freeze({ ...row, diagnosticOnly: true, canonicalWriteAuthorized: false, productionActivationAuthorized: false });
  }

  function inspectAuditHistory(scope, runId, rawLimit) {
    const scopedQuery = scoped(scope);
    return Object.freeze(db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE}
      WHERE companyId = ? AND branchId IN (${scopedQuery.placeholders}) AND aggregateId = ?
      ORDER BY createdAt, id LIMIT ?
    `).all(...scopedQuery.params, requiredId(runId, 'runId'), normalizeLimit(rawLimit)).map(row => Object.freeze({ ...row })));
  }

  return Object.freeze({
    listDryRuns,
    getDryRun,
    listCandidates,
    listChecks,
    listReconciliations,
    listDiagnostics,
    inspectOperation,
    inspectAuditHistory,
  });
}

module.exports = {
  ACTUAL_SOURCE_READ_SCOPES,
  ActualSourceEligibilityDryRunReadError,
  createActualSourceEligibilityDryRunReadRepository,
  createActualSourceEligibilityDryRunReadScope,
};
