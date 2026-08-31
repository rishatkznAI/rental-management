const crypto = require('crypto');

const MIN_SECRET_LENGTH = 8;
const MAX_SECRET_LENGTH = 256;
const KEY_LENGTH = 32;
const GSM_INGRESS_MODE_HTTP_TOKEN = 'http_token';
const GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL = 'tcp_device_credential';
// Both supported public TCP formats must be able to carry exactly the same
// provisioned credential. Keep provisioning to an unambiguous, delimiter-free
// alphabet; legacy hashes remain verifiable for backward compatibility.
const TRANSPORT_SAFE_SECRET_PATTERN = /^[A-Za-z0-9._~-]+$/;

const HTTP_TOKEN_PROTOCOLS = new Set([
  'http',
  'https',
  'http ingest',
  'https ingest',
  'http json',
  'https json',
  'http webhook',
  'https webhook',
]);
const TCP_DEVICE_CREDENTIAL_PROTOCOLS = new Set([
  'tcp',
  'gprs',
  'gprs tcp',
  'generic text',
  'raw text',
  'fallback text',
  'wialon',
  'wialon ips',
  'wialon ips tcp',
]);

function normalizeIngressMode(value) {
  const mode = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (mode === 'http' || mode === 'http_token') return GSM_INGRESS_MODE_HTTP_TOKEN;
  if (mode === 'tcp' || mode === 'tcp_device_credential') return GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL;
  return null;
}

function normalizeProtocol(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function inferGsmIngressModeFromProtocol(value) {
  const protocol = normalizeProtocol(value);
  if (HTTP_TOKEN_PROTOCOLS.has(protocol)) return GSM_INGRESS_MODE_HTTP_TOKEN;
  if (TCP_DEVICE_CREDENTIAL_PROTOCOLS.has(protocol)) return GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL;
  return null;
}

function gsmDeviceIngressMode(device = {}) {
  return normalizeIngressMode(device?.ingressMode)
    || inferGsmIngressModeFromProtocol(device?.protocol);
}

function resolveGsmIngressMode({ ingressMode, protocol } = {}) {
  const explicit = ingressMode === null || ingressMode === undefined || ingressMode === ''
    ? null
    : normalizeIngressMode(ingressMode);
  if (ingressMode !== null && ingressMode !== undefined && ingressMode !== '' && !explicit) {
    throw new GsmDeviceCredentialError(
      'GSM_INGRESS_MODE_INVALID',
      'GSM ingressMode must be http_token or tcp_device_credential.',
      400,
    );
  }
  const inferred = inferGsmIngressModeFromProtocol(protocol);
  if (!inferred && !explicit) {
    throw new GsmDeviceCredentialError(
      'GSM_INGRESS_PROTOCOL_UNSUPPORTED',
      'GSM protocol must explicitly identify a supported HTTP/HTTPS or TCP ingress transport.',
      400,
    );
  }
  if (explicit && inferred && explicit !== inferred) {
    throw new GsmDeviceCredentialError(
      'GSM_INGRESS_MODE_PROTOCOL_MISMATCH',
      'GSM ingressMode does not match the selected protocol.',
      400,
    );
  }
  return explicit || inferred;
}

function assertGsmDeviceIngressMode(device, attemptedMode) {
  const expectedMode = gsmDeviceIngressMode(device);
  const actualMode = normalizeIngressMode(attemptedMode);
  if (!expectedMode) {
    throw new GsmDeviceCredentialError(
      'GSM_DEVICE_INGRESS_MODE_UNCONFIGURED',
      'The provisioned GSM device has no recognized canonical ingress mode.',
      403,
    );
  }
  if (!actualMode || actualMode !== expectedMode) {
    throw new GsmDeviceCredentialError(
      'GSM_DEVICE_INGRESS_MODE_MISMATCH',
      'The GSM device is not provisioned for this ingress transport.',
      403,
    );
  }
  return expectedMode;
}

function isGsmHttpTokenIngressProtocol(value) {
  return normalizeIngressMode(value) === GSM_INGRESS_MODE_HTTP_TOKEN
    || inferGsmIngressModeFromProtocol(value) === GSM_INGRESS_MODE_HTTP_TOKEN;
}

function requiresGsmTcpIngressCredential(value) {
  const explicitMode = normalizeIngressMode(value);
  const inferredMode = inferGsmIngressModeFromProtocol(value);
  return (explicitMode || inferredMode) !== GSM_INGRESS_MODE_HTTP_TOKEN;
}

class GsmDeviceCredentialError extends Error {
  constructor(code, message, status = 403) {
    super(message);
    this.name = 'GsmDeviceCredentialError';
    this.code = code;
    this.status = status;
    this.statusCode = status;
  }
}

function normalizeSecret(value) {
  return String(value ?? '');
}

function assertValidGsmIngressSecret(value) {
  const secret = normalizeSecret(value);
  if (secret.length < MIN_SECRET_LENGTH || secret.length > MAX_SECRET_LENGTH) {
    throw new GsmDeviceCredentialError(
      'GSM_DEVICE_CREDENTIAL_INVALID',
      `GSM device credential must contain ${MIN_SECRET_LENGTH}-${MAX_SECRET_LENGTH} characters.`,
      400,
    );
  }
  if (!TRANSPORT_SAFE_SECRET_PATTERN.test(secret)) {
    throw new GsmDeviceCredentialError(
      'GSM_DEVICE_CREDENTIAL_INVALID',
      'GSM device credential may contain only ASCII letters, digits, dot, underscore, tilde, and hyphen.',
      400,
    );
  }
  return secret;
}

function hashGsmIngressSecret(value, { salt = crypto.randomBytes(16) } = {}) {
  const secret = assertValidGsmIngressSecret(value);
  const saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(String(salt), 'hex');
  const digest = crypto.scryptSync(secret, saltBuffer, KEY_LENGTH);
  return `scrypt$v1$${saltBuffer.toString('hex')}$${digest.toString('hex')}`;
}

function verifyGsmIngressSecret(value, encodedHash) {
  const secret = normalizeSecret(value);
  const [algorithm, version, saltHex, digestHex, extra] = String(encodedHash || '').split('$');
  if (
    extra !== undefined
    || algorithm !== 'scrypt'
    || version !== 'v1'
    || !/^[a-f0-9]{32}$/i.test(saltHex || '')
    || !/^[a-f0-9]{64}$/i.test(digestHex || '')
  ) return false;
  try {
    const expected = Buffer.from(digestHex, 'hex');
    const actual = crypto.scryptSync(secret, Buffer.from(saltHex, 'hex'), expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function fingerprintGsmIngressCredentialHash(encodedHash) {
  const value = String(encodedHash || '');
  if (!value) return null;
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertGsmIngressCredential({ suppliedSecret, storedHash, deviceRecordId = null } = {}) {
  if (!storedHash) {
    throw new GsmDeviceCredentialError(
      'GSM_DEVICE_CREDENTIAL_REQUIRED',
      'The provisioned GSM device has no ingress credential and cannot use public TCP ingress.',
      403,
    );
  }
  if (!verifyGsmIngressSecret(suppliedSecret, storedHash)) {
    throw new GsmDeviceCredentialError(
      'GSM_DEVICE_CREDENTIAL_REJECTED',
      'The GSM device ingress credential is invalid.',
      403,
    );
  }
  return { deviceRecordId };
}

function assertGsmIngressSessionCredentialCurrent({
  authenticatedAt,
  authenticatedCredentialFingerprint,
  storedHash,
  deviceRecordId = null,
} = {}) {
  if (!authenticatedAt) {
    throw new GsmDeviceCredentialError(
      'GSM_DEVICE_AUTHENTICATION_REQUIRED',
      'The GSM TCP connection must authenticate before sending telemetry.',
      403,
    );
  }
  const currentFingerprint = fingerprintGsmIngressCredentialHash(storedHash);
  if (!currentFingerprint || currentFingerprint !== authenticatedCredentialFingerprint) {
    throw new GsmDeviceCredentialError(
      'GSM_DEVICE_CREDENTIAL_CHANGED',
      'The GSM device ingress credential changed; reconnect and authenticate again.',
      409,
    );
  }
  return { deviceRecordId };
}

module.exports = {
  GSM_INGRESS_MODE_HTTP_TOKEN,
  GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
  GsmDeviceCredentialError,
  assertGsmDeviceIngressMode,
  assertGsmIngressCredential,
  assertGsmIngressSessionCredentialCurrent,
  assertValidGsmIngressSecret,
  fingerprintGsmIngressCredentialHash,
  hashGsmIngressSecret,
  gsmDeviceIngressMode,
  inferGsmIngressModeFromProtocol,
  isGsmHttpTokenIngressProtocol,
  normalizeIngressMode,
  requiresGsmTcpIngressCredential,
  resolveGsmIngressMode,
  TRANSPORT_SAFE_SECRET_PATTERN,
  verifyGsmIngressSecret,
};
