const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { stableJson } = require('./production-scope-remediation');

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;
const MAX_REQUEST_TTL_SECONDS = 10 * 60;
const MAX_CLOCK_SKEW_SECONDS = 60;

class ProductionScopeAuthError extends Error {
  constructor(code, message, status = 403) {
    super(message);
    this.name = 'ProductionScopeAuthError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new ProductionScopeAuthError(code, message, status);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function requestBodySha256(body) {
  return sha256(stableJson(body ?? {}));
}

function operationSignatureMessage({ requestId, mode, issuedAt, expiresAt, bodySha256 }) {
  return [
    'rentcore-production-scope-remediation-v1',
    requestId,
    mode,
    String(issuedAt),
    String(expiresAt),
    bodySha256,
  ].join('\n');
}

function signOperationRequest({ secret, requestId, mode, issuedAt, expiresAt, body }) {
  return crypto.createHmac('sha256', secret).update(operationSignatureMessage({
    requestId,
    mode,
    issuedAt,
    expiresAt,
    bodySha256: requestBodySha256(body),
  })).digest('hex');
}

function safeEqualHex(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === 64 && b.length === 64 && crypto.timingSafeEqual(a, b);
}

function validateOperationAuthorization({
  secret,
  signature,
  requestId,
  mode,
  issuedAt,
  expiresAt,
  body,
  now = new Date(),
}) {
  if (Buffer.byteLength(String(secret || ''), 'utf8') < 32) {
    fail('REMEDIATION_AUTH_NOT_CONFIGURED', 'Remediation request signing is not configured.', 404);
  }
  const normalizedRequestId = String(requestId || '').trim().toLowerCase();
  const normalizedMode = String(mode || '').trim();
  const issued = Number(issuedAt);
  const expires = Number(expiresAt);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (!REQUEST_ID_PATTERN.test(normalizedRequestId)) {
    fail('OPERATION_REQUEST_ID_INVALID', 'A valid operation request ID is required.');
  }
  if (!Number.isSafeInteger(issued) || !Number.isSafeInteger(expires)
    || expires <= issued || expires - issued > MAX_REQUEST_TTL_SECONDS
    || issued > nowSeconds + MAX_CLOCK_SKEW_SECONDS
    || expires < nowSeconds) {
    fail('OPERATION_TOKEN_EXPIRED', 'The operation authorization window is invalid or expired.');
  }
  if (!SIGNATURE_PATTERN.test(String(signature || '').trim().toLowerCase())) {
    fail('OPERATION_TOKEN_INVALID', 'The operation authorization is invalid.');
  }
  const expected = signOperationRequest({
    secret,
    requestId: normalizedRequestId,
    mode: normalizedMode,
    issuedAt: issued,
    expiresAt: expires,
    body,
  });
  if (!safeEqualHex(String(signature || '').trim().toLowerCase(), expected)) {
    fail('OPERATION_TOKEN_INVALID', 'The operation authorization is invalid.');
  }
  return {
    requestId: normalizedRequestId,
    issuedAt: issued,
    expiresAt: expires,
    bodySha256: requestBodySha256(body),
  };
}

function consumeOperationRequest({ dbPath, requestId, mode, issuedAt, expiresAt }) {
  const directory = path.join(
    path.dirname(path.resolve(dbPath)),
    '.production-scope-remediation-requests',
  );
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStat = fs.lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    fail('OPERATION_REPLAY_STORE_INVALID', 'The operation replay store is invalid.', 409);
  }
  const requestHash = sha256(requestId);
  const target = path.join(directory, `${requestHash}.used`);
  let fd;
  try {
    fd = fs.openSync(target, 'wx', 0o600);
    fs.writeFileSync(fd, `${stableJson({
      version: 1,
      requestHash,
      mode,
      issuedAt,
      expiresAt,
    })}\n`, 'utf8');
    fs.fsyncSync(fd);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      fail('OPERATION_TOKEN_REPLAYED', 'This operation authorization was already consumed.', 409);
    }
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  const directoryFd = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(directoryFd);
  } finally {
    fs.closeSync(directoryFd);
  }
  return { requestHash };
}

module.exports = {
  MAX_REQUEST_TTL_SECONDS,
  ProductionScopeAuthError,
  consumeOperationRequest,
  operationSignatureMessage,
  requestBodySha256,
  signOperationRequest,
  validateOperationAuthorization,
};
