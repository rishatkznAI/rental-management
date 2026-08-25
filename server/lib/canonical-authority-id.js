const crypto = require('node:crypto');
const { base32Rfc4648NoPadding } = require('./canonical-company-id');

const CANONICAL_BRANCH_ID_PREFIX = 'brn_';
const CANONICAL_BRANCH_ID_VERSION = 'rentcore:branch:v1';
const CANONICAL_MEMBERSHIP_ID_PREFIX = 'mbr_';
const CANONICAL_MEMBERSHIP_ID_VERSION = 'rentcore:membership:v1';

function requiredAuthorityId(value, label, pattern) {
  const normalized = String(value ?? '').trim();
  if (!normalized || /[|\s]/.test(normalized) || (pattern && !pattern.test(normalized))) {
    throw new TypeError(`${label} is invalid.`);
  }
  return normalized;
}

function deriveOpaqueAuthorityId({ identityKey, prefix }) {
  const digest = crypto.createHash('sha256').update(identityKey, 'utf8').digest();
  const base32Digest = base32Rfc4648NoPadding(digest);
  return Object.freeze({
    canonicalIdentityKey: identityKey,
    sha256Hex: digest.toString('hex'),
    base32Digest,
    id: `${prefix}${base32Digest}`,
  });
}

function canonicalHeadOfficeIdentityKey({ companyId } = {}) {
  const normalizedCompanyId = requiredAuthorityId(companyId, 'companyId', /^cmp_[A-Z2-7]{52}$/);
  return `${CANONICAL_BRANCH_ID_VERSION}|companyId=${normalizedCompanyId}|kind=HEAD_OFFICE`;
}

function deriveCanonicalHeadOfficeId(input) {
  const result = deriveOpaqueAuthorityId({
    identityKey: canonicalHeadOfficeIdentityKey(input),
    prefix: CANONICAL_BRANCH_ID_PREFIX,
  });
  return Object.freeze({ ...result, branchId: result.id });
}

function canonicalMembershipIdentityKey({ companyId, principalId } = {}) {
  const normalizedCompanyId = requiredAuthorityId(companyId, 'companyId', /^cmp_[A-Z2-7]{52}$/);
  const normalizedPrincipalId = requiredAuthorityId(principalId, 'principalId');
  return `${CANONICAL_MEMBERSHIP_ID_VERSION}|companyId=${normalizedCompanyId}|principalId=${normalizedPrincipalId}`;
}

function deriveCanonicalMembershipId(input) {
  const result = deriveOpaqueAuthorityId({
    identityKey: canonicalMembershipIdentityKey(input),
    prefix: CANONICAL_MEMBERSHIP_ID_PREFIX,
  });
  return Object.freeze({ ...result, membershipId: result.id });
}

module.exports = {
  CANONICAL_BRANCH_ID_PREFIX,
  CANONICAL_BRANCH_ID_VERSION,
  CANONICAL_MEMBERSHIP_ID_PREFIX,
  CANONICAL_MEMBERSHIP_ID_VERSION,
  canonicalHeadOfficeIdentityKey,
  canonicalMembershipIdentityKey,
  deriveCanonicalHeadOfficeId,
  deriveCanonicalMembershipId,
};
