const crypto = require('crypto');
const {
  CanonicalActualPostingProductError,
  createCanonicalActualPostingProductService,
} = require('../lib/canonical-actual-posting-product-service');
const {
  PlatformAuthorizationError,
  resolveTrustedScope,
} = require('../lib/platform-authorization');
const {
  createPlatformIdentityRepository,
} = require('../lib/platform-identity-repository');

const CANONICAL_ACTUAL_POSTING_PRODUCT_PATH = '/canonical-receivables/actual-posting/events';

function requestId(req) {
  return String(req.headers?.['x-request-id'] || req.headers?.['x-railway-request-id'] || '').slice(0, 120)
    || `actual-posting-${crypto.randomUUID()}`;
}

function requestContext(req, res, next) {
  req.canonicalActualPostingProductRequestId = requestId(req);
  res.setHeader('x-request-id', req.canonicalActualPostingProductRequestId);
  next();
}

function normalizeRouteError(error) {
  if (error instanceof CanonicalActualPostingProductError) return error;
  if (error instanceof PlatformAuthorizationError) {
    const status = Number.isInteger(error.status) ? error.status : 403;
    return new CanonicalActualPostingProductError(
      status,
      'scope_denied',
      status === 404 ? 'Подготовленная операция недоступна.' : 'Недостаточно прав для этой операции.',
      error.code,
    );
  }
  return new CanonicalActualPostingProductError(
    500,
    'failed',
    'Не удалось создать фактическое начисление.',
    'CANONICAL_POSTING_PRODUCT_FAILED',
  );
}

function sendError(req, res, error, logger) {
  const normalized = normalizeRouteError(error);
  const log = normalized.status >= 500 ? logger?.error : logger?.warn;
  log?.call(logger, '[canonical-actual-posting-product] request failed', {
    requestId: req.canonicalActualPostingProductRequestId,
    code: normalized.internalCode,
    status: normalized.status,
  });
  return res.status(normalized.status).json({
    ok: false,
    status: normalized.productStatus,
    error: normalized.publicMessage,
    requestId: req.canonicalActualPostingProductRequestId,
  });
}

function registerCanonicalActualPostingProductRoutes(router, deps = {}) {
  if (typeof deps.requireAuth !== 'function' || typeof deps.requireFinanceWrite !== 'function') {
    throw new TypeError('Canonical actual posting product routes require auth and finance permission middleware.');
  }
  const service = deps.service || createCanonicalActualPostingProductService({
    db: deps.db,
    runtimeContract: deps.runtimeConfig?.runtimeContract,
    runtimeEnabled: deps.runtimeConfig?.enabled === true,
    readClients: deps.readClients,
  });
  const readUsers = deps.readUsers;
  const platformRepository = deps.resolveScope || !deps.db || typeof readUsers !== 'function'
    ? null
    : createPlatformIdentityRepository(deps.db, { readUsers });
  const resolveScope = deps.resolveScope || ((req, eventScope) => resolveTrustedScope({
    req,
    repository: platformRepository,
    readUsers,
    requestedCompanyId: eventScope?.companyId,
    requestedBranchId: eventScope?.branchId,
  }));
  const middleware = [requestContext, deps.requireAuth, deps.requireFinanceWrite];

  router.get(CANONICAL_ACTUAL_POSTING_PRODUCT_PATH, ...middleware, async (req, res) => {
    try {
      if (!service.enabled) {
        return res.json({
          ...service.disabledPreview(),
          requestId: req.canonicalActualPostingProductRequestId,
        });
      }
      const scope = await resolveScope(req, null);
      return res.json({
        ...service.listEligibleEvents(scope),
        requestId: req.canonicalActualPostingProductRequestId,
      });
    } catch (error) {
      return sendError(req, res, error, deps.logger || console);
    }
  });

  router.post(`${CANONICAL_ACTUAL_POSTING_PRODUCT_PATH}/:eventId`, ...middleware, async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body
        : {};
      if (Object.keys(body).length > 0) {
        throw new CanonicalActualPostingProductError(
          400,
          'invalid_request',
          'Дополнительные параметры для этой операции не принимаются.',
        );
      }
      service.assertEnabled();
      const eventScope = service.readEventScope(req.params.eventId);
      if (!eventScope) {
        throw new CanonicalActualPostingProductError(
          404,
          'not_found',
          'Подготовленная операция не найдена.',
        );
      }
      const scope = await resolveScope(req, eventScope);
      const result = service.postEligibleEvent({ eventId: req.params.eventId, scope });
      deps.logger?.log?.(
        `[canonical-actual-posting-product] requestId=${req.canonicalActualPostingProductRequestId} eventId=${req.params.eventId} status=${result.status} replayed=${result.replayed}`,
      );
      return res.json({ ...result, requestId: req.canonicalActualPostingProductRequestId });
    } catch (error) {
      return sendError(req, res, error, deps.logger || console);
    }
  });

  return router;
}

module.exports = {
  CANONICAL_ACTUAL_POSTING_PRODUCT_PATH,
  normalizeRouteError,
  registerCanonicalActualPostingProductRoutes,
  requestContext,
};
