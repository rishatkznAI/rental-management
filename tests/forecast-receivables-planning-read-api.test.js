import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
  createForecastTestContext,
  forecastCommand,
} from './forecast-receivables-planning-fixtures.js';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const {
  createForecastReceivablesReadScope,
} = require('../server/lib/forecast-receivables-planning-read-repository.js');
const {
  registerForecastReceivablesReadRoutes,
} = require('../server/routes/forecast-receivables-read.js');

const CURSOR_SECRET = 'forecast-test-cursor-secret-2026-unique-abcdef';

function request(app) {
  function call(method, requestPath) {
    const headers = {};
    const builder = {
      set(name, value) {
        headers[String(name).toLowerCase()] = value;
        return builder;
      },
      then(resolve, reject) {
        const promise = new Promise((innerResolve, innerReject) => {
          const server = app.listen(0, '127.0.0.1', async () => {
            const { port } = server.address();
            try {
              const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, {
                method,
                headers,
              });
              const text = await response.text();
              let body = null;
              try { body = text ? JSON.parse(text) : null; } catch { body = text; }
              innerResolve({
                status: response.status,
                body,
                headers: Object.fromEntries(response.headers.entries()),
              });
            } catch (error) {
              innerReject(error);
            } finally {
              server.close();
            }
          });
        });
        return promise.then(resolve, reject);
      },
    };
    return builder;
  }
  return {
    get: requestPath => call('GET', requestPath),
    post: requestPath => call('POST', requestPath),
    put: requestPath => call('PUT', requestPath),
    patch: requestPath => call('PATCH', requestPath),
    delete: requestPath => call('DELETE', requestPath),
  };
}

function appFor(context, options = {}) {
  const app = express();
  const router = express.Router();
  const readScope = options.readScope === undefined
    ? createForecastReceivablesReadScope(context.platformScope)
    : options.readScope;
  registerForecastReceivablesReadRoutes(router, {
    enabled: options.enabled !== false,
    db: context.db,
    ...(options.omitCursorSecret ? {} : { cursorSecret: CURSOR_SECRET }),
    requireAuth(req, res, next) {
      if (!req.headers.authorization) {
        return res.status(401).json({ error: 'Authentication required.' });
      }
      req.user = { userId: 'U-billing' };
      return next();
    },
    ...(options.omitResolver
      ? {}
      : { resolveTrustedScope: async () => readScope }),
    logger: { error() {} },
  });
  app.use('/api', router);
  return app;
}

function auth(call) {
  return call.set('Authorization', 'Bearer isolated-test');
}

function forbiddenFieldPresent(value) {
  const forbidden = new Set([
    'actualOutstandingMinor', 'closedUnbilledCandidateMinor', 'totalExpectedClientLoadMinor',
    'overdueMinor', 'aging', 'debt', 'collection', 'settlement', 'canonicalReceivableId',
  ]);
  if (Array.isArray(value)) return value.some(forbiddenFieldPresent);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => forbidden.has(key) || forbiddenFieldPresent(nested));
}

test('forecast read routes are absent when feature flag is false', async () => {
  const context = createForecastTestContext();
  const response = await request(appFor(context, { enabled: false })).get('/api/forecast-receivables/summary');
  assert.equal(response.status, 404);
  context.close();
});

test('enabled forecast API authenticates before fail-closed resolver denial', async () => {
  const context = createForecastTestContext();
  const app = appFor(context, { omitResolver: true, omitCursorSecret: true });
  const unauthenticated = await request(app).get('/api/forecast-receivables/summary');
  assert.equal(unauthenticated.status, 401);
  assert.match(unauthenticated.headers['x-request-id'], /^forecast-receivables-/);
  const denied = await auth(request(app).get('/api/forecast-receivables/summary'));
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'FORECAST_READ_SCOPE_DENIED');
  context.close();
});

test('read scope requires exact forecast.read and concrete branches', () => {
  const context = createForecastTestContext();
  assert.throws(
    () => createForecastReceivablesReadScope({
      ...context.platformScope,
      capabilities: context.platformScope.capabilities.filter(item => item !== 'forecast.read'),
    }),
    error => error.code === 'FORECAST_READ_SCOPE_DENIED',
  );
  assert.throws(
    () => createForecastReceivablesReadScope({
      ...context.platformScope,
      allowedBranchIds: ['*'],
    }),
    error => error.code === 'FORECAST_READ_SCOPE_DENIED',
  );
  context.close();
});

test('empty authorized summary is unavailable rather than a calculated zero', async () => {
  const context = createForecastTestContext();
  const response = await auth(request(appFor(context)).get('/api/forecast-receivables/summary'));
  assert.equal(response.status, 200);
  assert.equal(response.body.hasCurrentRun, false);
  assert.equal(response.body.branches[0].hasCurrentRun, false);
  assert.equal(response.body.branches[0].completeness, 'unavailable');
  assert.equal(response.body.branches[0].monetaryResult, null);
  assert.equal(response.body.aggregate, null);
  assert.equal(response.body.aggregateUnavailableReason, 'MISSING_CURRENT_RUN');
  context.close();
});

test('persisted complete zero is distinguishable from unavailable state', async () => {
  const context = createForecastTestContext();
  const command = forecastCommand(context);
  command.inputs = [];
  context.forecastService.calculateForecastRun(context.forecastCommandContext, command);
  const response = await auth(request(appFor(context)).get('/api/forecast-receivables/summary'));
  assert.equal(response.status, 200);
  assert.equal(response.body.hasCurrentRun, true);
  assert.equal(response.body.branches[0].hasCurrentRun, true);
  assert.equal(response.body.branches[0].completeness, 'complete');
  assert.equal(response.body.branches[0].primaryForecastMinor, 0);
  assert.equal(response.body.aggregate.primaryForecastMinor, 0);
  context.close();
});

test('summary exposes forecast provenance and keeps planned future separate', async () => {
  const context = createForecastTestContext();
  context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context, { rentalStatus: 'planned_future', componentKind: 'planned_future' }),
  );
  const response = await auth(request(appFor(context)).get('/api/forecast-receivables/summary'));
  assert.equal(response.status, 200);
  const summary = response.body.branches[0];
  assert.equal(summary.openPeriodForecastGrossMinor, 0);
  assert.equal(summary.plannedFutureGrossMinor, 3_600);
  assert.equal(summary.primaryForecastMinor, 0);
  assert.equal(summary.confidenceDistribution.high, 1);
  assert.equal(forbiddenFieldPresent(response.body), false);
  context.close();
});

test('runs endpoint supports historical and current-only views with deterministic order', async () => {
  const context = createForecastTestContext();
  const first = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context),
  );
  const second = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context, {
      idempotencyKey: 'api-run-2',
      expectedActiveRunIds: [first.forecastRunId],
    }),
  );
  const app = appFor(context);
  const all = await auth(request(app).get('/api/forecast-receivables/runs'));
  assert.equal(all.status, 200);
  assert.equal(all.body.items.length, 2);
  assert.deepEqual(
    all.body.items.map(item => item.forecastRunId),
    [first.forecastRunId, second.forecastRunId].sort().reverse(),
  );
  const current = await auth(request(app).get('/api/forecast-receivables/runs?currentOnly=true'));
  assert.equal(current.body.items.length, 1);
  assert.equal(current.body.items[0].forecastRunId, second.forecastRunId);
  context.close();
});

test('run detail is scoped and includes immutable source input lineage', async () => {
  const context = createForecastTestContext();
  const run = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context),
  );
  const app = appFor(context);
  const detail = await auth(request(app).get(`/api/forecast-receivables/runs/${run.forecastRunId}`));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.forecastRunId, run.forecastRunId);
  assert.equal(detail.body.inputSnapshots.length, 1);
  assert.equal(detail.body.inputSnapshots[0].rentalLineId.startsWith('billing-source-rental-line-'), true);
  const missing = await auth(request(app).get('/api/forecast-receivables/runs/not-in-scope'));
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'FORECAST_RUN_NOT_FOUND');
  context.close();
});

test('items and diagnostics endpoints expose only their planning contracts', async () => {
  const calculated = createForecastTestContext();
  const run = calculated.forecastService.calculateForecastRun(
    calculated.forecastCommandContext,
    forecastCommand(calculated),
  );
  const itemResponse = await auth(request(appFor(calculated)).get(`/api/forecast-receivables/items?runId=${run.forecastRunId}`));
  assert.equal(itemResponse.status, 200);
  assert.equal(itemResponse.body.items.length, 1);
  assert.equal(itemResponse.body.items[0].grossAmountMinor, 12_000);
  assert.equal(forbiddenFieldPresent(itemResponse.body), false);
  calculated.close();

  const incomplete = createForecastTestContext();
  const partial = incomplete.forecastService.calculateForecastRun(
    incomplete.forecastCommandContext,
    forecastCommand(incomplete, {
      asOfDate: '2026-08-15',
      candidateStartDate: '2026-08-15',
      candidateEndDateExclusive: '2026-09-14',
    }),
  );
  const diagnosticResponse = await auth(request(appFor(incomplete)).get(`/api/forecast-receivables/diagnostics?runId=${partial.forecastRunId}`));
  assert.equal(diagnosticResponse.status, 200);
  assert.equal(diagnosticResponse.body.items[0].reasonCode, 'FORECAST_CLOSED_COVERAGE_OVERLAP');
  assert.equal(diagnosticResponse.body.items[0].confidence, 'insufficient');
  assert.equal(forbiddenFieldPresent(diagnosticResponse.body), false);
  incomplete.close();
});

test('signed cursor is endpoint, scope, and filter bound and rejects tampering', async () => {
  const context = createForecastTestContext();
  const first = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context),
  );
  context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context, {
      idempotencyKey: 'cursor-run-2',
      expectedActiveRunIds: [first.forecastRunId],
    }),
  );
  const app = appFor(context);
  const firstPage = await auth(request(app).get('/api/forecast-receivables/runs?limit=1'));
  assert.equal(firstPage.status, 200);
  assert.ok(firstPage.body.nextCursor);
  const next = await auth(request(app).get(`/api/forecast-receivables/runs?limit=1&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`));
  assert.equal(next.status, 200);
  assert.equal(next.body.items.length, 1);
  assert.notEqual(next.body.items[0].forecastRunId, firstPage.body.items[0].forecastRunId);
  const tamperedCursor = `${firstPage.body.nextCursor.slice(0, -1)}x`;
  const tampered = await auth(request(app).get(`/api/forecast-receivables/runs?limit=1&cursor=${encodeURIComponent(tamperedCursor)}`));
  assert.equal(tampered.status, 400);
  assert.equal(tampered.body.error.code, 'FORECAST_CURSOR_INVALID');
  const filterMismatch = await auth(request(app).get(`/api/forecast-receivables/runs?limit=1&currentOnly=true&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`));
  assert.equal(filterMismatch.status, 400);
  const endpointMismatch = await auth(request(app).get(`/api/forecast-receivables/items?limit=1&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`));
  assert.equal(endpointMismatch.status, 400);
  context.close();
});

test('branch narrowing is non-disclosing and client company authority is rejected', async () => {
  const context = createForecastTestContext();
  context.forecastService.calculateForecastRun(context.forecastCommandContext, forecastCommand(context));
  const app = appFor(context);
  const branch = await auth(request(app).get('/api/forecast-receivables/summary?branchId=branch-a-1'));
  assert.equal(branch.status, 200);
  assert.deepEqual(branch.body.scope.branchIds, ['branch-a-1']);
  const crossBranch = await auth(request(app).get('/api/forecast-receivables/summary?branchId=branch-a-2'));
  assert.equal(crossBranch.status, 404);
  const company = await auth(request(app).get('/api/forecast-receivables/runs?companyId=company-a'));
  assert.equal(company.status, 400);
  assert.equal(company.body.error.code, 'FORECAST_FILTER_UNSUPPORTED');
  context.close();
});

test('limits are bounded and no mutation forecast routes exist', async () => {
  const context = createForecastTestContext();
  const app = appFor(context);
  const tooLarge = await auth(request(app).get('/api/forecast-receivables/runs?limit=201'));
  assert.equal(tooLarge.status, 400);
  const impossibleDate = await auth(request(app).get('/api/forecast-receivables/runs?asOfDate=2026-02-30'));
  assert.equal(impossibleDate.status, 400);
  for (const method of ['post', 'put', 'patch', 'delete']) {
    const response = await auth(request(app)[method]('/api/forecast-receivables/runs'));
    assert.equal(response.status, 404, method);
  }
  context.close();
});

test('static summary route is never consumed by dynamic run detail', async () => {
  const context = createForecastTestContext();
  const response = await auth(request(appFor(context)).get('/api/forecast-receivables/summary'));
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.branches));
  assert.equal(response.body.error, undefined);
  context.close();
});
