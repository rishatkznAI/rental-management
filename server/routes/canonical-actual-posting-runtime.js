const crypto = require('crypto');
const {
  ERROR_CODES,
  CanonicalActualPostingError,
} = require('../lib/canonical-actual-posting-domain');
const {
  createCanonicalActualPostingRuntimeService,
} = require('../lib/canonical-actual-posting-runtime-service');

const CANONICAL_ACTUAL_POSTING_RUNTIME_PATH = '/internal/canonical-receivables/actual-posting/events/:eventId';

function bearerToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer ([^\s]+)$/);
  return match ? match[1] : '';
}

function tokenMatches(actual, expected) {
  const actualBytes = Buffer.from(String(actual || ''), 'utf8');
  const expectedBytes = Buffer.from(String(expected || ''), 'utf8');
  return actualBytes.length === expectedBytes.length
    && expectedBytes.length > 0
    && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

function responseStatus(error) {
  if (error?.code === ERROR_CODES.POSTING_EVENT_NOT_FOUND) return 404;
  if ([
    ERROR_CODES.INPUT_NOT_INERT,
    ERROR_CODES.INVALID_IDENTIFIER,
    ERROR_CODES.ENVELOPE_INVALID,
  ].includes(error?.code)) return 400;
  if ([
    ERROR_CODES.POSTING_ASSERTION_MISMATCH,
    ERROR_CODES.POSTING_CONCURRENT_CONFLICT,
    ERROR_CODES.POSTING_INTEGRITY_BLOCKED,
  ].includes(error?.code)) return 409;
  return 500;
}

function registerCanonicalActualPostingRuntimeRoutes(router, {
  db,
  enabled = false,
  logger = console,
  runtimeContract,
  triggerToken,
} = {}) {
  if (!enabled) return;
  if (!triggerToken) throw new TypeError('Canonical actual posting runtime trigger token is required.');
  const service = createCanonicalActualPostingRuntimeService({ db, runtimeContract });

  router.post(CANONICAL_ACTUAL_POSTING_RUNTIME_PATH, (req, res) => {
    const requestId = crypto.randomUUID();
    res.setHeader('x-request-id', requestId);
    if (!tokenMatches(bearerToken(req), triggerToken)) {
      logger.warn?.(`[canonical-actual-posting] unauthorized requestId=${requestId}`);
      return res.status(401).json({ ok: false, error: { code: 'CANONICAL_POSTING_TRIGGER_UNAUTHORIZED' } });
    }

    try {
      const result = service.postEligibleEvent({
        ...(req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}),
        eventId: req.params.eventId,
      });
      logger.log?.(
        `[canonical-actual-posting] requestId=${requestId} eventId=${result.event.eventId} outcome=${result.posting.outcome} replayed=${Boolean(result.posting.replayed)}`,
      );
      return res.json({ ok: true, result });
    } catch (error) {
      const code = error instanceof CanonicalActualPostingError
        ? error.code
        : ERROR_CODES.POSTING_DATABASE_FAILED;
      logger.error?.(`[canonical-actual-posting] requestId=${requestId} code=${code}`);
      return res.status(responseStatus(error)).json({ ok: false, error: { code } });
    }
  });
}

module.exports = {
  CANONICAL_ACTUAL_POSTING_RUNTIME_PATH,
  registerCanonicalActualPostingRuntimeRoutes,
  tokenMatches,
};
