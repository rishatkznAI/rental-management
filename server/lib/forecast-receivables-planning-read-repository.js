const {
  FORECAST_RECEIVABLE_DIAGNOSTICS_TABLE,
  FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE,
  FORECAST_RECEIVABLE_ITEMS_TABLE,
  FORECAST_RECEIVABLE_RUNS_TABLE,
  FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE,
  assertForecastReceivablesPlanningStructure,
} = require('./forecast-receivables-planning-schema');

const FORECAST_READ_SCOPES = new WeakSet();
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const FORBIDDEN_BRANCH_IDS = new Set(['*', 'all', 'global', 'company-wide', 'company_wide', 'any', 'null']);

class ForecastReceivablesReadError extends Error {
  constructor(code, message, field, status = 400) {
    super(message);
    this.name = 'ForecastReceivablesReadError';
    this.code = code;
    this.field = field;
    this.status = status;
  }
}

function fail(code, message, field, status) {
  throw new ForecastReceivablesReadError(code, message, field, status);
}

function requiredId(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) {
    fail('FORECAST_READ_SCOPE_INVALID', `${field} is required.`, field, 403);
  }
  return value.trim();
}

function createForecastReceivablesReadScope(platformScope, options = {}) {
  if (
    !platformScope
    || platformScope.authenticated !== true
    || platformScope.principalType !== 'user'
    || !Array.isArray(platformScope.capabilities)
    || !platformScope.capabilities.includes('forecast.read')
    || !Array.isArray(platformScope.allowedBranchIds)
    || platformScope.allowedBranchIds.length === 0
  ) fail('FORECAST_READ_SCOPE_DENIED', 'Forecast read scope is unavailable.', 'scope', 403);
  const companyId = requiredId(platformScope.companyId, 'scope.companyId');
  let branchIds = [...new Set(platformScope.allowedBranchIds.map((value, index) => (
    requiredId(value, `scope.allowedBranchIds[${index}]`)
  )))].sort();
  if (branchIds.some(branchId => FORBIDDEN_BRANCH_IDS.has(branchId.toLowerCase()))) {
    fail('FORECAST_READ_SCOPE_DENIED', 'Concrete branch scope is required.', 'scope.allowedBranchIds', 403);
  }
  if (options.branchId !== undefined && options.branchId !== null && options.branchId !== '') {
    const branchId = requiredId(options.branchId, 'branchId');
    if (!branchIds.includes(branchId)) {
      fail('FORECAST_READ_NOT_FOUND', 'Forecast data was not found.', 'branchId', 404);
    }
    branchIds = [branchId];
  }
  const scope = Object.freeze({
    companyId,
    companyTimezone: requiredId(platformScope.companyTimezone, 'scope.companyTimezone'),
    principalId: requiredId(platformScope.principalId, 'scope.principalId'),
    membershipId: requiredId(platformScope.membershipId, 'scope.membershipId'),
    membershipVersion: platformScope.membershipVersion,
    capabilityCatalogVersion: platformScope.capabilityCatalogVersion,
    branchIds: Object.freeze(branchIds),
  });
  FORECAST_READ_SCOPES.add(scope);
  return scope;
}

function assertReadScope(scope) {
  if (!scope || !FORECAST_READ_SCOPES.has(scope)) {
    fail('FORECAST_READ_SCOPE_REQUIRED', 'A branded trusted forecast read scope is required.', 'scope', 403);
  }
  return scope;
}

function normalizeLimit(value) {
  const limit = value === undefined ? DEFAULT_LIMIT : value;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    fail('FORECAST_READ_LIMIT_INVALID', `limit must be between 1 and ${MAX_LIMIT}.`, 'limit');
  }
  return limit;
}

function runProjection(row) {
  if (!row) return null;
  return Object.freeze({
    forecastRunId: row.id,
    branchId: row.branchId,
    companyTimezone: row.companyTimezone,
    planningSeriesKey: row.planningSeriesKey,
    asOfDate: row.asOfDate,
    horizonStartDate: row.horizonStartDate,
    horizonEndDateExclusive: row.horizonEndDateExclusive,
    horizonDays: Number(row.horizonDays),
    currency: row.currency,
    calculationVersion: row.calculationVersion,
    inputContractVersion: row.inputContractVersion,
    confidencePolicyVersion: row.confidencePolicyVersion,
    coveragePolicyVersion: row.coveragePolicyVersion,
    inputSetHash: row.inputSetHash,
    resultHash: row.resultHash,
    status: row.status,
    completeness: row.completenessState,
    openPeriodForecastNetMinor: Number(row.openPeriodForecastNetMinor),
    openPeriodForecastVatMinor: Number(row.openPeriodForecastVatMinor),
    openPeriodForecastGrossMinor: Number(row.openPeriodForecastGrossMinor),
    plannedFutureNetMinor: Number(row.plannedFutureNetMinor),
    plannedFutureVatMinor: Number(row.plannedFutureVatMinor),
    plannedFutureGrossMinor: Number(row.plannedFutureGrossMinor),
    primaryForecastMinor: Number(row.primaryForecastMinor),
    itemCount: Number(row.itemCount),
    diagnosticCount: Number(row.diagnosticCount),
    blockingDiagnosticCount: Number(row.blockingDiagnosticCount),
    calculatedAt: row.calculatedAt,
    correlationId: row.correlationId,
  });
}

function itemProjection(row) {
  return Object.freeze({
    forecastItemId: row.id,
    forecastRunId: row.forecastRunId,
    forecastCoverageKey: row.forecastCoverageKey,
    branchId: row.branchId,
    componentKind: row.componentKind,
    clientId: row.clientId,
    contractId: row.contractId,
    rentalId: row.rentalId,
    rentalLineId: row.rentalLineId,
    effectiveTermsVersionId: row.effectiveTermsVersionId,
    coverageStartDate: row.coverageStartDate,
    coverageEndDateExclusive: row.coverageEndDateExclusive,
    currency: row.currency,
    netAmountMinor: Number(row.netAmountMinor),
    vatAmountMinor: Number(row.vatAmountMinor),
    grossAmountMinor: Number(row.grossAmountMinor),
    calculationVersion: row.calculationVersion,
    calculationPolicyRef: row.calculationPolicyRef,
    vatPolicyRef: row.vatPolicyRef,
    roundingPolicyRef: row.roundingPolicyRef,
    policyDecisionRef: row.policyDecisionRef,
    confidence: row.confidence,
    confidenceReasonCodes: Object.freeze(JSON.parse(row.confidenceReasonCodesJson)),
    itemSourceHash: row.itemSourceHash,
    itemResultHash: row.itemResultHash,
    createdAt: row.createdAt,
  });
}

function diagnosticProjection(row) {
  return Object.freeze({
    diagnosticId: row.id,
    forecastRunId: row.forecastRunId,
    branchId: row.branchId,
    rentalLineId: row.rentalLineId,
    componentKind: row.componentKind,
    affectedStartDate: row.affectedStartDate,
    affectedEndDateExclusive: row.affectedEndDateExclusive,
    severity: row.severity,
    confidence: row.confidence,
    reasonCode: row.reasonCode,
    sourceIdentity: row.sourceIdentity,
    sourceHash: row.sourceHash,
    policyRef: row.policyRef,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
  });
}

function createForecastReceivablesPlanningReadRepository(db) {
  if (!db || typeof db.prepare !== 'function') {
    fail('FORECAST_READ_DATABASE_REQUIRED', 'A better-sqlite3 database is required.', 'db', 500);
  }
  assertForecastReceivablesPlanningStructure(db);

  function scopeSql(scope, requestedBranchId) {
    assertReadScope(scope);
    const branches = requestedBranchId ? [requestedBranchId] : scope.branchIds;
    if (requestedBranchId && !scope.branchIds.includes(requestedBranchId)) {
      fail('FORECAST_READ_NOT_FOUND', 'Forecast data was not found.', 'branchId', 404);
    }
    return Object.freeze({
      branches,
      placeholders: branches.map(() => '?').join(', '),
      params: [scope.companyId, ...branches],
    });
  }

  function listRuns(scope, filters = {}, position = null, rawLimit) {
    const scoped = scopeSql(scope, filters.branchId);
    const where = [];
    const params = [...scoped.params];
    if (filters.runId) {
      where.push('run.id = ?');
      params.push(filters.runId);
    }
    if (filters.asOfDate) {
      where.push('run.asOfDate = ?');
      params.push(filters.asOfDate);
    }
    if (filters.currentOnly === true) {
      where.push(`NOT EXISTS (
        SELECT 1 FROM ${FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE} lifecycle
        WHERE lifecycle.predecessorRunId = run.id
      )`);
    }
    if (position) {
      where.push('(run.calculatedAt < ? OR (run.calculatedAt = ? AND run.id < ?))');
      params.push(position.createdAt, position.createdAt, position.id);
    }
    const limit = normalizeLimit(rawLimit);
    const rows = db.prepare(`
      SELECT run.*
      FROM ${FORECAST_RECEIVABLE_RUNS_TABLE} run
      WHERE run.companyId = ? AND run.branchId IN (${scoped.placeholders})
        ${where.length > 0 ? `AND ${where.join(' AND ')}` : ''}
      ORDER BY run.calculatedAt DESC, run.id DESC
      LIMIT ?
    `).all(...params, limit + 1);
    return Object.freeze({
      rows: Object.freeze(rows.slice(0, limit).map(runProjection)),
      hasMore: rows.length > limit,
      last: rows.length === 0 ? null : Object.freeze({
        createdAt: rows[Math.min(rows.length, limit) - 1].calculatedAt,
        id: rows[Math.min(rows.length, limit) - 1].id,
      }),
    });
  }

  function getRun(scope, runId) {
    const scoped = scopeSql(scope);
    const row = db.prepare(`
      SELECT run.*
      FROM ${FORECAST_RECEIVABLE_RUNS_TABLE} run
      WHERE run.companyId = ? AND run.branchId IN (${scoped.placeholders}) AND run.id = ?
    `).get(...scoped.params, runId);
    if (!row) return null;
    const predecessorRows = db.prepare(`
      SELECT predecessorRunId FROM ${FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE}
      WHERE companyId = ? AND branchId = ? AND successorRunId = ?
      ORDER BY predecessorRunId LIMIT 200
    `).all(scope.companyId, row.branchId, row.id);
    const successor = db.prepare(`
      SELECT successorRunId FROM ${FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE}
      WHERE companyId = ? AND branchId = ? AND predecessorRunId = ?
      LIMIT 1
    `).get(scope.companyId, row.branchId, row.id);
    const inputs = db.prepare(`
      SELECT id AS inputSnapshotId, rentalLineId, activationBoundaryId, effectiveTermsVersionId,
             clientId, contractId, rentalId, equipmentId, rentalStatus, componentKind,
             serviceStartDate, serviceEndDateExclusive, candidateStartDate,
             candidateEndDateExclusive, sourceSystem, sourceIdentity, sourceEventId,
             sourceEventVersion, sourceHash, eventManifestHash, inputSourceHash,
             authorityStatus, completenessStatus
      FROM ${FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE}
      WHERE companyId = ? AND branchId = ? AND forecastRunId = ?
      ORDER BY rentalLineId, componentKind, candidateStartDate, id
      LIMIT 200
    `).all(scope.companyId, row.branchId, row.id);
    return Object.freeze({
      ...runProjection(row),
      predecessorRunIds: Object.freeze(predecessorRows.map(item => item.predecessorRunId)),
      successorRunId: successor?.successorRunId || null,
      inputSnapshots: Object.freeze(inputs.map(item => Object.freeze(item))),
      inputSnapshotsTruncated: inputs.length >= 200 && Number(row.itemCount) > 200,
    });
  }

  function listItems(scope, filters = {}, position = null, rawLimit) {
    const scoped = scopeSql(scope, filters.branchId);
    const where = [];
    const params = [...scoped.params];
    for (const [column, value] of [
      ['forecastRunId', filters.runId],
      ['componentKind', filters.componentKind],
      ['confidence', filters.confidence],
    ]) {
      if (value) {
        where.push(`item.${column} = ?`);
        params.push(value);
      }
    }
    if (position) {
      where.push('(item.createdAt > ? OR (item.createdAt = ? AND item.id > ?))');
      params.push(position.createdAt, position.createdAt, position.id);
    }
    const limit = normalizeLimit(rawLimit);
    const rows = db.prepare(`
      SELECT item.* FROM ${FORECAST_RECEIVABLE_ITEMS_TABLE} item
      WHERE item.companyId = ? AND item.branchId IN (${scoped.placeholders})
        ${where.length > 0 ? `AND ${where.join(' AND ')}` : ''}
      ORDER BY item.createdAt ASC, item.id ASC
      LIMIT ?
    `).all(...params, limit + 1);
    return Object.freeze({
      rows: Object.freeze(rows.slice(0, limit).map(itemProjection)),
      hasMore: rows.length > limit,
      last: rows.length === 0 ? null : Object.freeze({
        createdAt: rows[Math.min(rows.length, limit) - 1].createdAt,
        id: rows[Math.min(rows.length, limit) - 1].id,
      }),
    });
  }

  function listDiagnostics(scope, filters = {}, position = null, rawLimit) {
    const scoped = scopeSql(scope, filters.branchId);
    const where = [];
    const params = [...scoped.params];
    if (filters.runId) {
      where.push('diagnostic.forecastRunId = ?');
      params.push(filters.runId);
    }
    if (filters.componentKind) {
      where.push('diagnostic.componentKind = ?');
      params.push(filters.componentKind);
    }
    if (position) {
      where.push('(diagnostic.createdAt > ? OR (diagnostic.createdAt = ? AND diagnostic.id > ?))');
      params.push(position.createdAt, position.createdAt, position.id);
    }
    const limit = normalizeLimit(rawLimit);
    const rows = db.prepare(`
      SELECT diagnostic.* FROM ${FORECAST_RECEIVABLE_DIAGNOSTICS_TABLE} diagnostic
      WHERE diagnostic.companyId = ? AND diagnostic.branchId IN (${scoped.placeholders})
        ${where.length > 0 ? `AND ${where.join(' AND ')}` : ''}
      ORDER BY diagnostic.createdAt ASC, diagnostic.id ASC
      LIMIT ?
    `).all(...params, limit + 1);
    return Object.freeze({
      rows: Object.freeze(rows.slice(0, limit).map(diagnosticProjection)),
      hasMore: rows.length > limit,
      last: rows.length === 0 ? null : Object.freeze({
        createdAt: rows[Math.min(rows.length, limit) - 1].createdAt,
        id: rows[Math.min(rows.length, limit) - 1].id,
      }),
    });
  }

  function currentSummary(scope, branchId) {
    const scoped = scopeSql(scope, branchId);
    const runs = db.prepare(`
      SELECT run.* FROM ${FORECAST_RECEIVABLE_RUNS_TABLE} run
      WHERE run.companyId = ? AND run.branchId IN (${scoped.placeholders})
        AND NOT EXISTS (
          SELECT 1 FROM ${FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE} lifecycle
          WHERE lifecycle.predecessorRunId = run.id
        )
      ORDER BY run.branchId, run.calculatedAt DESC, run.id DESC
    `).all(...scoped.params);
    const runIds = runs.map(run => run.id);
    const confidenceRows = runIds.length === 0 ? [] : db.prepare(`
      SELECT forecastRunId, confidence, COUNT(*) AS count
      FROM ${FORECAST_RECEIVABLE_ITEMS_TABLE}
      WHERE companyId = ? AND branchId IN (${scoped.placeholders})
        AND forecastRunId IN (${runIds.map(() => '?').join(', ')})
      GROUP BY forecastRunId, confidence
      ORDER BY forecastRunId, confidence
    `).all(...scoped.params, ...runIds);
    const confidenceByRun = new Map();
    for (const row of confidenceRows) {
      if (!confidenceByRun.has(row.forecastRunId)) {
        confidenceByRun.set(row.forecastRunId, { high: 0, medium: 0, low: 0 });
      }
      confidenceByRun.get(row.forecastRunId)[row.confidence] = Number(row.count);
    }
    return Object.freeze(runs.map(run => Object.freeze({
      ...runProjection(run),
      confidenceDistribution: Object.freeze(confidenceByRun.get(run.id) || {
        high: 0,
        medium: 0,
        low: 0,
      }),
    })));
  }

  return Object.freeze({
    currentSummary,
    getRun,
    listDiagnostics,
    listItems,
    listRuns,
  });
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  ForecastReceivablesReadError,
  assertReadScope,
  createForecastReceivablesPlanningReadRepository,
  createForecastReceivablesReadScope,
};
