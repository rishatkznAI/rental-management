const crypto = require('crypto');
const {
  MAX_LIMIT,
  ForecastReceivablesReadError,
  assertReadScope,
} = require('./forecast-receivables-planning-read-repository');

const CURSOR_VERSION = 1;
const SORT_CONTRACT_VERSION = 'forecast-read-sort-v1';
const COMPONENT_KINDS = new Set(['open_period_forecast', 'planned_future']);
const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low']);

function fail(code, message, field, status = 400) {
  throw new ForecastReceivablesReadError(code, message, field, status);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function cursorCodec(secret) {
  const key = typeof secret === 'string' ? secret.trim() : '';
  if (Buffer.byteLength(key, 'utf8') < 32 || new Set(Buffer.from(key)).size < 8) {
    fail(
      'FORECAST_CURSOR_CONFIGURATION_INVALID',
      'Forecast cursor signing requires a non-default secret of at least 32 bytes.',
      'cursorSecret',
      500,
    );
  }
  const sign = payload => crypto.createHmac('sha256', key).update(payload).digest('base64url');
  return Object.freeze({
    encode(value) {
      const payload = Buffer.from(stableJson(value), 'utf8').toString('base64url');
      return `${payload}.${sign(payload)}`;
    },
    decode(value) {
      try {
        const [payload, signature, extra] = String(value || '').split('.');
        if (!payload || !signature || extra) throw new Error('malformed');
        const expected = Buffer.from(sign(payload));
        const actual = Buffer.from(signature);
        if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
          throw new Error('signature');
        }
        return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      } catch {
        fail('FORECAST_CURSOR_INVALID', 'cursor is malformed or has been tampered with.', 'cursor');
      }
    },
  });
}

function assertAllowedQuery(query, allowed) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    fail('FORECAST_FILTER_INVALID', 'Query filters must be an object.', 'query');
  }
  const unknown = Object.keys(query).find(key => !allowed.has(key));
  if (unknown) fail('FORECAST_FILTER_UNSUPPORTED', `${unknown} is not a supported filter.`, unknown);
}

function optionalId(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 160 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    fail('FORECAST_FILTER_INVALID', `${field} is invalid.`, field);
  }
  return normalized;
}

function dateOnly(value, field) {
  const normalized = optionalId(value, field);
  if (normalized === undefined) return undefined;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(normalized)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== normalized
  ) {
    fail('FORECAST_FILTER_INVALID', `${field} must be YYYY-MM-DD.`, field);
  }
  return normalized;
}

function booleanValue(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  fail('FORECAST_FILTER_INVALID', `${field} must be true or false.`, field);
}

function limitValue(value) {
  if (value === undefined || value === null || value === '') return 50;
  if (!/^\d+$/.test(String(value))) {
    fail('FORECAST_READ_LIMIT_INVALID', `limit must be between 1 and ${MAX_LIMIT}.`, 'limit');
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    fail('FORECAST_READ_LIMIT_INVALID', `limit must be between 1 and ${MAX_LIMIT}.`, 'limit');
  }
  return limit;
}

function assertBranch(scope, branchId) {
  if (branchId && !scope.branchIds.includes(branchId)) {
    fail('FORECAST_READ_NOT_FOUND', 'Forecast data was not found.', 'branchId', 404);
  }
}

function scopeContext(scope, branchId) {
  return Object.freeze({
    branchIds: branchId ? [branchId] : scope.branchIds,
    branchScope: branchId ? 'selected' : 'authorized_branches',
  });
}

function safeSum(values, field) {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) {
      fail('FORECAST_SUMMARY_OVERFLOW', `${field} exceeds the safe integer range.`, field, 500);
    }
  }
  return total;
}

function createForecastReceivablesPlanningReadService({ repository, cursorSecret } = {}) {
  if (!repository) fail('FORECAST_READ_REPOSITORY_REQUIRED', 'Forecast read repository is required.', 'repository', 500);
  const cursors = cursorCodec(cursorSecret);

  function positionFor(endpoint, scope, filters, cursor) {
    if (!cursor) return null;
    const decoded = cursors.decode(cursor);
    const expected = {
      version: CURSOR_VERSION,
      endpoint,
      companyId: scope.companyId,
      branchIds: scope.branchIds,
      filters,
      sortContractVersion: SORT_CONTRACT_VERSION,
    };
    if (
      decoded?.version !== expected.version
      || decoded.endpoint !== endpoint
      || decoded.companyId !== expected.companyId
      || stableJson(decoded.branchIds) !== stableJson(expected.branchIds)
      || stableJson(decoded.filters) !== stableJson(expected.filters)
      || decoded.sortContractVersion !== expected.sortContractVersion
      || !decoded.position?.createdAt
      || !decoded.position?.id
    ) fail('FORECAST_CURSOR_INVALID', 'cursor does not match this scope, endpoint, or filter.', 'cursor');
    return decoded.position;
  }

  function nextCursor(endpoint, scope, filters, page) {
    if (!page.hasMore || !page.last) return null;
    return cursors.encode({
      version: CURSOR_VERSION,
      endpoint,
      companyId: scope.companyId,
      branchIds: scope.branchIds,
      filters,
      sortContractVersion: SORT_CONTRACT_VERSION,
      position: page.last,
    });
  }

  function listRuns(query, scope) {
    assertReadScope(scope);
    assertAllowedQuery(query, new Set([
      'branchId', 'runId', 'asOfDate', 'currentOnly', 'limit', 'cursor',
    ]));
    const filters = {
      branchId: optionalId(query.branchId, 'branchId'),
      runId: optionalId(query.runId, 'runId'),
      asOfDate: dateOnly(query.asOfDate, 'asOfDate'),
      currentOnly: booleanValue(query.currentOnly, 'currentOnly'),
    };
    Object.keys(filters).forEach(key => filters[key] === undefined && delete filters[key]);
    assertBranch(scope, filters.branchId);
    const limit = limitValue(query.limit);
    const position = positionFor('runs', scope, filters, query.cursor);
    const page = repository.listRuns(scope, filters, position, limit);
    return Object.freeze({
      items: page.rows,
      nextCursor: nextCursor('runs', scope, filters, page),
      scope: scopeContext(scope, filters.branchId),
    });
  }

  function runDetail(runId, query, scope) {
    assertReadScope(scope);
    assertAllowedQuery(query, new Set(['branchId']));
    const id = optionalId(runId, 'runId');
    const branchId = optionalId(query.branchId, 'branchId');
    assertBranch(scope, branchId);
    const result = repository.getRun(scope, id);
    if (!result || (branchId && result.branchId !== branchId)) return null;
    return result;
  }

  function listItems(query, scope) {
    assertReadScope(scope);
    assertAllowedQuery(query, new Set([
      'branchId', 'runId', 'componentKind', 'confidence', 'limit', 'cursor',
    ]));
    const filters = {
      branchId: optionalId(query.branchId, 'branchId'),
      runId: optionalId(query.runId, 'runId'),
      componentKind: optionalId(query.componentKind, 'componentKind'),
      confidence: optionalId(query.confidence, 'confidence'),
    };
    Object.keys(filters).forEach(key => filters[key] === undefined && delete filters[key]);
    assertBranch(scope, filters.branchId);
    if (filters.componentKind && !COMPONENT_KINDS.has(filters.componentKind)) {
      fail('FORECAST_FILTER_INVALID', 'componentKind is invalid.', 'componentKind');
    }
    if (filters.confidence && !CONFIDENCE_LEVELS.has(filters.confidence)) {
      fail('FORECAST_FILTER_INVALID', 'confidence is invalid.', 'confidence');
    }
    const limit = limitValue(query.limit);
    const position = positionFor('items', scope, filters, query.cursor);
    const page = repository.listItems(scope, filters, position, limit);
    return Object.freeze({
      items: page.rows,
      nextCursor: nextCursor('items', scope, filters, page),
      scope: scopeContext(scope, filters.branchId),
    });
  }

  function listDiagnostics(query, scope) {
    assertReadScope(scope);
    assertAllowedQuery(query, new Set([
      'branchId', 'runId', 'componentKind', 'limit', 'cursor',
    ]));
    const filters = {
      branchId: optionalId(query.branchId, 'branchId'),
      runId: optionalId(query.runId, 'runId'),
      componentKind: optionalId(query.componentKind, 'componentKind'),
    };
    Object.keys(filters).forEach(key => filters[key] === undefined && delete filters[key]);
    assertBranch(scope, filters.branchId);
    if (filters.componentKind && !COMPONENT_KINDS.has(filters.componentKind)) {
      fail('FORECAST_FILTER_INVALID', 'componentKind is invalid.', 'componentKind');
    }
    const limit = limitValue(query.limit);
    const position = positionFor('diagnostics', scope, filters, query.cursor);
    const page = repository.listDiagnostics(scope, filters, position, limit);
    return Object.freeze({
      items: page.rows,
      nextCursor: nextCursor('diagnostics', scope, filters, page),
      scope: scopeContext(scope, filters.branchId),
    });
  }

  function summary(query, scope) {
    assertReadScope(scope);
    assertAllowedQuery(query, new Set(['branchId']));
    const branchId = optionalId(query.branchId, 'branchId');
    assertBranch(scope, branchId);
    const requestedBranches = branchId ? [branchId] : [...scope.branchIds];
    const runs = repository.currentSummary(scope, branchId);
    const byBranch = new Map(runs.map(run => [run.branchId, run]));
    const branches = requestedBranches.map(id => {
      const run = byBranch.get(id);
      if (!run) {
        return Object.freeze({
          branchId: id,
          hasCurrentRun: false,
          completeness: 'unavailable',
          monetaryResult: null,
        });
      }
      return Object.freeze({
        branchId: id,
        hasCurrentRun: true,
        forecastRunId: run.forecastRunId,
        asOfDate: run.asOfDate,
        calculatedAt: run.calculatedAt,
        horizonStartDate: run.horizonStartDate,
        horizonEndDateExclusive: run.horizonEndDateExclusive,
        calculationVersion: run.calculationVersion,
        confidencePolicyVersion: run.confidencePolicyVersion,
        coveragePolicyVersion: run.coveragePolicyVersion,
        status: run.status,
        completeness: run.completeness,
        currency: run.currency,
        openPeriodForecastNetMinor: run.openPeriodForecastNetMinor,
        openPeriodForecastVatMinor: run.openPeriodForecastVatMinor,
        openPeriodForecastGrossMinor: run.openPeriodForecastGrossMinor,
        plannedFutureNetMinor: run.plannedFutureNetMinor,
        plannedFutureVatMinor: run.plannedFutureVatMinor,
        plannedFutureGrossMinor: run.plannedFutureGrossMinor,
        primaryForecastMinor: run.primaryForecastMinor,
        itemCount: run.itemCount,
        confidenceDistribution: run.confidenceDistribution,
        diagnosticCount: run.diagnosticCount,
        blockingDiagnosticCount: run.blockingDiagnosticCount,
        inputSetHash: run.inputSetHash,
        resultHash: run.resultHash,
      });
    });

    let aggregate = null;
    let aggregateUnavailableReason = null;
    if (branches.some(item => !item.hasCurrentRun)) {
      aggregateUnavailableReason = 'MISSING_CURRENT_RUN';
    } else if (branches.some(item => item.completeness !== 'complete')) {
      aggregateUnavailableReason = 'INCOMPLETE_CURRENT_RUN';
    } else {
      const signatures = new Set(branches.map(item => stableJson({
        asOfDate: item.asOfDate,
        horizonStartDate: item.horizonStartDate,
        horizonEndDateExclusive: item.horizonEndDateExclusive,
        calculationVersion: item.calculationVersion,
        confidencePolicyVersion: item.confidencePolicyVersion,
        coveragePolicyVersion: item.coveragePolicyVersion,
        currency: item.currency,
        completeness: item.completeness,
      })));
      if (signatures.size !== 1) {
        aggregateUnavailableReason = 'INCOMPATIBLE_RUN_PROVENANCE';
      } else {
        aggregate = Object.freeze({
          currency: branches[0].currency,
          asOfDate: branches[0].asOfDate,
          horizonStartDate: branches[0].horizonStartDate,
          horizonEndDateExclusive: branches[0].horizonEndDateExclusive,
          calculationVersion: branches[0].calculationVersion,
          completeness: 'complete',
          openPeriodForecastNetMinor: safeSum(branches.map(item => item.openPeriodForecastNetMinor), 'openPeriodForecastNetMinor'),
          openPeriodForecastVatMinor: safeSum(branches.map(item => item.openPeriodForecastVatMinor), 'openPeriodForecastVatMinor'),
          openPeriodForecastGrossMinor: safeSum(branches.map(item => item.openPeriodForecastGrossMinor), 'openPeriodForecastGrossMinor'),
          plannedFutureNetMinor: safeSum(branches.map(item => item.plannedFutureNetMinor), 'plannedFutureNetMinor'),
          plannedFutureVatMinor: safeSum(branches.map(item => item.plannedFutureVatMinor), 'plannedFutureVatMinor'),
          plannedFutureGrossMinor: safeSum(branches.map(item => item.plannedFutureGrossMinor), 'plannedFutureGrossMinor'),
          primaryForecastMinor: safeSum(branches.map(item => item.primaryForecastMinor), 'primaryForecastMinor'),
          itemCount: safeSum(branches.map(item => item.itemCount), 'itemCount'),
          diagnosticCount: safeSum(branches.map(item => item.diagnosticCount), 'diagnosticCount'),
          blockingDiagnosticCount: safeSum(branches.map(item => item.blockingDiagnosticCount), 'blockingDiagnosticCount'),
        });
      }
    }
    return Object.freeze({
      hasCurrentRun: branches.some(item => item.hasCurrentRun),
      scope: scopeContext(scope, branchId),
      branches: Object.freeze(branches),
      aggregate,
      aggregateUnavailableReason,
    });
  }

  return Object.freeze({
    listDiagnostics,
    listItems,
    listRuns,
    runDetail,
    summary,
  });
}

module.exports = {
  CURSOR_VERSION,
  SORT_CONTRACT_VERSION,
  createForecastReceivablesPlanningReadService,
};
