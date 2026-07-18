const crypto = require('crypto');
const {
  createForecastReceivablesPlanningReadRepository,
} = require('../lib/forecast-receivables-planning-read-repository');
const {
  createForecastReceivablesPlanningReadService,
} = require('../lib/forecast-receivables-planning-read-service');

function makeForecastRequestId(req) {
  return String(req.headers?.['x-request-id'] || req.headers?.['x-railway-request-id'] || '').slice(0, 120)
    || `forecast-receivables-${crypto.randomUUID()}`;
}

function defaultCode(status) {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORECAST_READ_FORBIDDEN';
  if (status === 404) return 'FORECAST_RUN_NOT_FOUND';
  return status >= 500 ? 'FORECAST_READ_INTERNAL_ERROR' : 'FORECAST_READ_INVALID_REQUEST';
}

function forecastRequestContext(req, res, next) {
  req.forecastReceivablesRequestId = makeForecastRequestId(req);
  res.setHeader('X-Request-ID', req.forecastReceivablesRequestId);
  const json = res.json.bind(res);
  res.json = body => {
    if (res.statusCode < 400 || (body?.error && typeof body.error === 'object' && body.error.requestId)) {
      return json(body);
    }
    return json({
      ok: false,
      error: {
        code: defaultCode(res.statusCode),
        message: typeof body?.error === 'string'
          ? body.error
          : body?.message || 'The forecast request could not be completed.',
        requestId: req.forecastReceivablesRequestId,
        details: {},
      },
    });
  };
  next();
}

function sendError(req, res, error, logger) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = error?.code || defaultCode(status);
  if (status >= 500) {
    (logger?.error || console.error)('[forecast-receivables-read] request failed', {
      requestId: req.forecastReceivablesRequestId,
      code,
      path: req.path,
    });
  }
  return res.status(status).json({
    ok: false,
    error: {
      code,
      message: status >= 500
        ? 'Forecast receivables read failed.'
        : error?.message || 'The forecast request could not be completed.',
      field: error?.field,
      requestId: req.forecastReceivablesRequestId,
      details: {},
    },
  });
}

function registerForecastReceivablesReadRoutes(router, deps = {}) {
  if (deps.enabled !== true) return router;
  if (typeof deps.requireAuth !== 'function') {
    throw new Error('Forecast receivables read routes require authentication middleware.');
  }
  let service = deps.service || null;
  function readService() {
    if (!service) {
      service = createForecastReceivablesPlanningReadService({
        repository: createForecastReceivablesPlanningReadRepository(deps.db),
        cursorSecret: deps.cursorSecret,
      });
    }
    return service;
  }

  async function scopeMiddleware(req, res, next) {
    if (typeof deps.resolveTrustedScope !== 'function') {
      return sendError(req, res, {
        status: 403,
        code: 'FORECAST_READ_SCOPE_DENIED',
        message: 'Forecast receivables scope mapping is unavailable.',
      }, deps.logger);
    }
    try {
      req.forecastReceivablesScope = await deps.resolveTrustedScope({
        req,
        principal: req.user,
      });
      if (!req.forecastReceivablesScope) {
        return sendError(req, res, {
          status: 403,
          code: 'FORECAST_READ_SCOPE_DENIED',
          message: 'Forecast receivables scope mapping is unavailable.',
        }, deps.logger);
      }
      return next();
    } catch {
      return sendError(req, res, {
        status: 403,
        code: 'FORECAST_READ_SCOPE_DENIED',
        message: 'Forecast receivables scope mapping was denied.',
      }, deps.logger);
    }
  }

  const middleware = [forecastRequestContext, deps.requireAuth, scopeMiddleware];
  const handler = operation => (req, res) => {
    try {
      return res.json(operation(req));
    } catch (error) {
      return sendError(req, res, error, deps.logger);
    }
  };

  // Static routes are registered before the dynamic run-detail route.
  router.get('/forecast-receivables/summary', ...middleware, handler(req => ({
    ...readService().summary(req.query, req.forecastReceivablesScope),
    requestId: req.forecastReceivablesRequestId,
  })));
  router.get('/forecast-receivables/items', ...middleware, handler(req => (
    {
      ...readService().listItems(req.query, req.forecastReceivablesScope),
      requestId: req.forecastReceivablesRequestId,
    }
  )));
  router.get('/forecast-receivables/diagnostics', ...middleware, handler(req => (
    {
      ...readService().listDiagnostics(req.query, req.forecastReceivablesScope),
      requestId: req.forecastReceivablesRequestId,
    }
  )));
  router.get('/forecast-receivables/runs', ...middleware, handler(req => (
    {
      ...readService().listRuns(req.query, req.forecastReceivablesScope),
      requestId: req.forecastReceivablesRequestId,
    }
  )));
  router.get('/forecast-receivables/runs/:id', ...middleware, handler(req => {
    const result = readService().runDetail(req.params.id, req.query, req.forecastReceivablesScope);
    if (!result) {
      const error = new Error('Forecast run was not found.');
      error.status = 404;
      error.code = 'FORECAST_RUN_NOT_FOUND';
      throw error;
    }
    return {
      ...result,
      requestId: req.forecastReceivablesRequestId,
    };
  }));
  return router;
}

module.exports = {
  forecastRequestContext,
  makeForecastRequestId,
  registerForecastReceivablesReadRoutes,
};
