const crypto = require('crypto');
const {
  createCanonicalReceivablesReadRepository,
} = require('../lib/canonical-receivables-read-repository');
const {
  createCanonicalReceivablesReadService,
} = require('../lib/canonical-receivables-read-service');

function makeRequestId(req) {
  return String(req.headers?.['x-request-id'] || req.headers?.['x-railway-request-id'] || '').slice(0, 120)
    || `receivables-${crypto.randomUUID()}`;
}

function defaultErrorCode(status) {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'RECEIVABLE_NOT_FOUND';
  return status >= 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST';
}

function canonicalRequestContext(req, res, next) {
  req.canonicalReceivablesRequestId = makeRequestId(req);
  res.setHeader('X-Request-ID', req.canonicalReceivablesRequestId);
  const json = res.json.bind(res);
  res.json = body => {
    if (res.statusCode < 400 || (body?.error && typeof body.error === 'object' && body.error.requestId)) {
      return json(body);
    }
    const message = typeof body?.error === 'string'
      ? body.error
      : body?.message || 'The request could not be completed.';
    return json({
      ok: false,
      error: {
        code: defaultErrorCode(res.statusCode),
        message,
        requestId: req.canonicalReceivablesRequestId,
        details: {},
      },
    });
  };
  next();
}

function sendError(req, res, error, logger) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = error?.code || defaultErrorCode(status);
  const isInternal = status >= 500;
  if (isInternal) {
    (logger?.error || console.error)('[canonical-receivables-read] request failed', {
      requestId: req.canonicalReceivablesRequestId,
      code,
      path: req.path,
    });
  }
  return res.status(status).json({
    ok: false,
    error: {
      code,
      message: isInternal
        ? 'Canonical receivables read calculation failed.'
        : error?.message || 'The request could not be completed.',
      field: error?.field,
      requestId: req.canonicalReceivablesRequestId,
      details: {},
    },
  });
}

function registerCanonicalReceivablesReadRoutes(router, deps = {}) {
  if (deps.enabled !== true) return router;
  if (typeof deps.requireAuth !== 'function') {
    throw new Error('Canonical receivables read routes require authentication middleware.');
  }
  const service = deps.service || createCanonicalReceivablesReadService({
    repository: createCanonicalReceivablesReadRepository(deps.db),
    cursorSecret: deps.cursorSecret,
    now: deps.now,
  });
  const resolveTrustedScope = deps.resolveTrustedScope;

  async function scopeMiddleware(req, res, next) {
    if (typeof resolveTrustedScope !== 'function') {
      return sendError(req, res, {
        status: 403,
        code: 'RECEIVABLES_SCOPE_DENIED',
        message: 'Canonical receivables scope mapping is unavailable.',
      }, deps.logger);
    }
    try {
      req.canonicalReceivablesScope = await resolveTrustedScope({ req, principal: req.user });
      if (!req.canonicalReceivablesScope) {
        return sendError(req, res, {
          status: 403,
          code: 'RECEIVABLES_SCOPE_DENIED',
          message: 'Canonical receivables scope mapping is unavailable.',
        }, deps.logger);
      }
      return next();
    } catch (error) {
      return sendError(req, res, {
        status: 403,
        code: 'RECEIVABLES_SCOPE_DENIED',
        message: 'Canonical receivables scope mapping was denied.',
      }, deps.logger);
    }
  }

  const middleware = [canonicalRequestContext, deps.requireAuth, scopeMiddleware];
  const handler = operation => (req, res) => {
    try {
      const result = operation(req);
      return res.json(result);
    } catch (error) {
      return sendError(req, res, error, deps.logger);
    }
  };

  // Static routes must precede /:id so Express can never treat them as IDs.
  router.get('/receivables/summary', ...middleware, handler(req => ({
    ...service.summary(req.query, req.canonicalReceivablesScope),
    requestId: req.canonicalReceivablesRequestId,
  })));
  router.get('/receivables/aging', ...middleware, handler(req => ({
    ...service.aging(req.query, req.canonicalReceivablesScope),
    requestId: req.canonicalReceivablesRequestId,
  })));
  router.get('/receivables', ...middleware, handler(req => (
    service.list(req.query, req.canonicalReceivablesScope)
  )));
  router.get('/receivables/:id', ...middleware, handler(req => {
    const result = service.detail(req.params.id, req.query, req.canonicalReceivablesScope);
    if (!result) {
      throw Object.assign(new Error('Canonical receivable was not found.'), {
        status: 404,
        code: 'RECEIVABLE_NOT_FOUND',
      });
    }
    return result;
  }));
  return router;
}

module.exports = {
  canonicalRequestContext,
  makeRequestId,
  registerCanonicalReceivablesReadRoutes,
};
