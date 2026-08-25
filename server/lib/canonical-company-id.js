const crypto = require('node:crypto');

const CANONICAL_COMPANY_ID_PREFIX = 'cmp_';
const CANONICAL_COMPANY_ID_VERSION = 'rentcore:company:v1';
const RFC4648_BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function requiredToken(value, label, pattern) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized || !pattern.test(normalized)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return normalized;
}

function canonicalCompanyIdentityKey({ jurisdiction, registry, value } = {}) {
  const normalizedJurisdiction = requiredToken(jurisdiction, 'jurisdiction', /^[A-Z]{2}$/);
  const normalizedRegistry = requiredToken(registry, 'registry', /^[A-Z][A-Z0-9_]*$/);
  const normalizedValue = String(value ?? '').trim();
  if (!normalizedValue || /[|\s]/.test(normalizedValue)) {
    throw new TypeError('registry value is invalid.');
  }
  if (normalizedRegistry === 'INN' && !/^\d{10}(?:\d{2})?$/.test(normalizedValue)) {
    throw new TypeError('INN registry value must contain 10 or 12 digits.');
  }
  return `${CANONICAL_COMPANY_ID_VERSION}|jurisdiction=${normalizedJurisdiction}|registry=${normalizedRegistry}|value=${normalizedValue}`;
}

function base32Rfc4648NoPadding(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new TypeError('Base32 input must be bytes.');
  }
  let buffer = 0;
  let bits = 0;
  let encoded = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += RFC4648_BASE32_ALPHABET[(buffer >>> bits) & 31];
    }
    buffer = bits === 0 ? 0 : buffer & ((1 << bits) - 1);
  }
  if (bits > 0) {
    encoded += RFC4648_BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  }
  return encoded;
}

function deriveCanonicalCompanyId(identity) {
  const identityKey = canonicalCompanyIdentityKey(identity);
  const digest = crypto.createHash('sha256').update(identityKey, 'utf8').digest();
  const base32Digest = base32Rfc4648NoPadding(digest);
  return Object.freeze({
    canonicalIdentityKey: identityKey,
    sha256Hex: digest.toString('hex'),
    base32Digest,
    companyId: `${CANONICAL_COMPANY_ID_PREFIX}${base32Digest}`,
  });
}

module.exports = {
  CANONICAL_COMPANY_ID_PREFIX,
  CANONICAL_COMPANY_ID_VERSION,
  RFC4648_BASE32_ALPHABET,
  base32Rfc4648NoPadding,
  canonicalCompanyIdentityKey,
  deriveCanonicalCompanyId,
};
