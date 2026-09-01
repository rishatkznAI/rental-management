'use strict';

const crypto = require('node:crypto');
const {
  COLLECTION_SCOPE_CATEGORY,
  PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS,
} = require('./app-data-scope-registry');
const { stableJson } = require('./production-scope-remediation');

// Only commitments and non-sensitive policy metadata belong in Git. The exact
// production identifiers are reconstructed from the hash-bound source snapshot
// by the evidence builder and must match this reviewed, domain-separated digest.
const SENSITIVE_AUTHORITY_DOMAIN = 'rentcore.production-scope.classification-sensitive-authority.v1';
const CANONICAL_SCOPE_DOMAIN = 'rentcore.production-scope.classification-canonical-scope.v1';
const PRODUCTION_SENSITIVE_AUTHORITY_SHA256 = '18d5c0e1951d703c16b2547a7db5b720909e777e89d70d2349480616ff4c1ded';
const PRODUCTION_CANONICAL_SCOPE_SHA256 = '5b5846d3737ad33742a26d39ff4dea1bbdf247adf4ebb60635f0a2b0a979c1f2';

const LEGACY_IDEMPOTENCY_COLLECTIONS = Object.freeze([
  'inline_relation_idempotency',
  'rental_create_idempotency',
]);
const GLOBAL_AUDIT_ENTITY_TYPES = Object.freeze([
  'auth',
  'system',
  'system_data',
  'users',
]);
const SENSITIVE_AUTHORITY_COUNTS = Object.freeze({
  retainedAuditEntityIds: 3,
  businessPrincipalIds: 3,
  explicitFixtureRecordKeys: 8,
  explicitDemoPrincipalIds: 9,
  explicitInactivePrincipalIds: 1,
  productionSmokeSourcePrincipalIds: 1,
});
const EXPECTED_FROZEN_SNAPSHOT = Object.freeze({
  physicalAppDataCollectionCount: 70,
  allRegistryRecordCount: 702,
  scopeRelevantRecordCount: 688,
  systemRecordCount: 14,
  ownershipCandidateCount: 97,
  platformDefaultRecordCount: 399,
  fixtureRecordCount: 8,
  legacyIdempotencyRecordCount: 2,
  auditRecordCount: 182,
  auditCategoryCounts: Object.freeze({
    A_ENTITY_DERIVED: 6,
    B_ACTOR_DERIVED_ONLY: 28,
    C_GLOBAL_SYSTEM: 122,
    D_INSUFFICIENT_OR_FIXTURE: 26,
  }),
  userDispositionCounts: Object.freeze({
    BUSINESS_USER: 3,
    DEMO_FIXTURE: 9,
    INTENTIONALLY_UNMAPPED: 1,
    SMOKE_ACCOUNT: 1,
  }),
});

class ProductionScopeClassificationAuthorityError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ProductionScopeClassificationAuthorityError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ProductionScopeClassificationAuthorityError(code, message, details);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function text(value) {
  return String(value ?? '').trim();
}

function exactText(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.includes('\0')) {
    fail('CLASSIFICATION_AUTHORITY_INVALID', `${label} must be an exact non-empty string.`);
  }
  return value;
}

function normalizeExactSet(value, label) {
  if (!Array.isArray(value)) {
    fail('CLASSIFICATION_AUTHORITY_INVALID', `${label} must be an array.`);
  }
  const rows = value.map((item, index) => exactText(item, `${label}[${index}]`)).sort();
  if (new Set(rows).size !== rows.length) {
    fail('CLASSIFICATION_AUTHORITY_INVALID', `${label} contains duplicates.`);
  }
  return Object.freeze(rows);
}

function normalizeSensitiveAuthority(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('CLASSIFICATION_AUTHORITY_INVALID', 'Sensitive classification authority is required.');
  }
  const expectedKeys = Object.keys(SENSITIVE_AUTHORITY_COUNTS).sort();
  const actualKeys = Object.keys(value).sort();
  if (stableJson(actualKeys) !== stableJson(expectedKeys)) {
    fail('CLASSIFICATION_AUTHORITY_INVALID', 'Sensitive classification authority has unreviewed fields.', {
      actual: actualKeys,
      expected: expectedKeys,
    });
  }
  return Object.freeze(Object.fromEntries(expectedKeys.map(key => [
    key,
    normalizeExactSet(value[key], key),
  ])));
}

function sensitiveAuthorityProjection(value) {
  const normalized = normalizeSensitiveAuthority(value);
  return Object.freeze({ domain: SENSITIVE_AUTHORITY_DOMAIN, ...normalized });
}

function calculateSensitiveAuthoritySha256(value) {
  return sha256(stableJson(sensitiveAuthorityProjection(value)));
}

function normalizeCanonicalScope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('CLASSIFICATION_CANONICAL_SCOPE_INVALID', 'Canonical classification scope is required.');
  }
  const actual = Object.keys(value).sort();
  const expected = ['companyId', 'headOfficeId'];
  if (stableJson(actual) !== stableJson(expected)) {
    fail('CLASSIFICATION_CANONICAL_SCOPE_INVALID', 'Canonical classification scope has unreviewed fields.');
  }
  return Object.freeze({
    companyId: exactText(value.companyId, 'canonical companyId'),
    headOfficeId: exactText(value.headOfficeId, 'canonical headOfficeId'),
  });
}

function calculateCanonicalScopeSha256(value) {
  return sha256(stableJson({ domain: CANONICAL_SCOPE_DOMAIN, ...normalizeCanonicalScope(value) }));
}

function createClassificationContract({
  canonicalScope,
  sensitiveAuthority,
  expectedFrozenSnapshot = EXPECTED_FROZEN_SNAPSHOT,
}) {
  const normalized = normalizeSensitiveAuthority(sensitiveAuthority);
  return Object.freeze({
    authorityVersion: 3,
    canonicalScopeSha256: calculateCanonicalScopeSha256(canonicalScope),
    sensitiveAuthoritySha256: calculateSensitiveAuthoritySha256(normalized),
    sensitiveAuthorityCounts: Object.freeze(Object.fromEntries(
      Object.keys(SENSITIVE_AUTHORITY_COUNTS).sort().map(key => [key, normalized[key].length]),
    )),
    expectedFrozenSnapshot: structuredClone(expectedFrozenSnapshot),
  });
}

const PRODUCTION_CLASSIFICATION_CONTRACT = Object.freeze({
  authorityVersion: 3,
  canonicalScopeSha256: PRODUCTION_CANONICAL_SCOPE_SHA256,
  sensitiveAuthoritySha256: PRODUCTION_SENSITIVE_AUTHORITY_SHA256,
  sensitiveAuthorityCounts: SENSITIVE_AUTHORITY_COUNTS,
  expectedFrozenSnapshot: EXPECTED_FROZEN_SNAPSHOT,
});

function classificationAuthoritySnapshot(contract = PRODUCTION_CLASSIFICATION_CONTRACT) {
  return {
    authorityVersion: contract.authorityVersion,
    canonicalScopeSha256: contract.canonicalScopeSha256,
    sensitiveAuthoritySha256: contract.sensitiveAuthoritySha256,
    sensitiveAuthorityCounts: structuredClone(contract.sensitiveAuthorityCounts),
    platformDefaultTenantOverlayCollections: [...PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS],
    legacyIdempotencyCollections: [...LEGACY_IDEMPOTENCY_COLLECTIONS],
    globalAuditEntityTypes: [...GLOBAL_AUDIT_ENTITY_TYPES],
    expectedFrozenSnapshot: structuredClone(contract.expectedFrozenSnapshot),
    fallbackPolicy: 'BLOCK_NON_AUDIT;QUARANTINE_UNPROVEN_AUDIT',
  };
}

function createProductionScopeClassificationAuthority({
  canonicalScope,
  sensitiveAuthority,
  contract = PRODUCTION_CLASSIFICATION_CONTRACT,
}) {
  const normalizedScope = normalizeCanonicalScope(canonicalScope);
  const normalizedSensitive = normalizeSensitiveAuthority(sensitiveAuthority);
  const observedScopeSha256 = calculateCanonicalScopeSha256(normalizedScope);
  const observedSensitiveSha256 = calculateSensitiveAuthoritySha256(normalizedSensitive);
  const observedCounts = Object.fromEntries(Object.keys(SENSITIVE_AUTHORITY_COUNTS).sort().map(key => [
    key,
    normalizedSensitive[key].length,
  ]));
  if (
    contract?.authorityVersion !== 3
    || observedScopeSha256 !== contract.canonicalScopeSha256
    || observedSensitiveSha256 !== contract.sensitiveAuthoritySha256
    || stableJson(observedCounts) !== stableJson(contract.sensitiveAuthorityCounts)
  ) {
    fail('CLASSIFICATION_AUTHORITY_MISMATCH', 'Observed identifiers differ from the reviewed classification commitment.', {
      scopeMatches: observedScopeSha256 === contract?.canonicalScopeSha256,
      sensitiveAuthorityMatches: observedSensitiveSha256 === contract?.sensitiveAuthoritySha256,
      countsMatch: stableJson(observedCounts) === stableJson(contract?.sensitiveAuthorityCounts),
    });
  }

  const platformDefaultTenantOverlayCollections = new Set(PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS);
  const legacyIdempotency = new Set(LEGACY_IDEMPOTENCY_COLLECTIONS);
  const retainedAuditEntityIds = new Set(normalizedSensitive.retainedAuditEntityIds);
  const businessPrincipalIds = new Set(normalizedSensitive.businessPrincipalIds);
  const globalAuditEntityTypes = new Set(GLOBAL_AUDIT_ENTITY_TYPES);
  const fixtureRecordKeys = new Set(normalizedSensitive.explicitFixtureRecordKeys);
  const demoPrincipalIds = new Set(normalizedSensitive.explicitDemoPrincipalIds);
  const inactivePrincipalIds = new Set(normalizedSensitive.explicitInactivePrincipalIds);
  const smokePrincipalIds = new Set(normalizedSensitive.productionSmokeSourcePrincipalIds);

  function classifyAuditRecord(record) {
    const entityType = text(record?.entityType).toLowerCase();
    const entityId = text(record?.entityId);
    const userId = text(record?.userId);
    if (text(record?.auditKind) === 'GLOBAL_SYSTEM' || globalAuditEntityTypes.has(entityType)) {
      return {
        code: 'C_GLOBAL_SYSTEM', ownershipRule: 'PLATFORM_GLOBAL_AUDIT',
        futureState: 'GLOBAL_SYSTEM_AUDIT', migrationRequired: 'NO_SCOPE_UPDATE',
        evidenceCode: 'GLOBAL_ENTITY_TYPE_OR_EXPLICIT_KIND',
      };
    }
    if (retainedAuditEntityIds.has(entityId)) {
      return {
        code: 'A_ENTITY_DERIVED', ownershipRule: 'AUTHORITATIVE_RETAINED_ENTITY',
        futureState: 'TENANT_AUDIT_DERIVED_SCOPE', migrationRequired: 'YES_SEPARATE_AUDIT_MANIFEST',
        evidenceCode: 'ENTITY_STABLE_ID_RETAINED',
      };
    }
    if (businessPrincipalIds.has(userId)) {
      return {
        code: 'B_ACTOR_DERIVED_ONLY', ownershipRule: 'ACTOR_ONLY_NOT_HISTORICAL_TENANT_PROOF',
        futureState: 'LEGACY_UNSCOPED_QUARANTINED', migrationRequired: 'NO_CONTENT_REWRITE',
        evidenceCode: 'ACTOR_PRESENT_ENTITY_NOT_RETAINED',
      };
    }
    return {
      code: 'D_INSUFFICIENT_OR_FIXTURE', ownershipRule: 'INSUFFICIENT_OR_FIXTURE_EVIDENCE',
      futureState: 'LEGACY_UNSCOPED_QUARANTINED', migrationRequired: 'NO_CONTENT_REWRITE',
      evidenceCode: 'NO_DETERMINISTIC_TENANT_PROOF',
    };
  }

  function classifyProductionScopeRecord({ collection, policy, recordId, record, baseline }) {
    if (!collection || !policy || !recordId) {
      return { disposition: 'UNRESOLVED', ownershipRule: 'INVALID_CLASSIFICATION_INPUT', futureState: 'FAIL_CLOSED', migrationRequired: 'BLOCKED' };
    }
    if (platformDefaultTenantOverlayCollections.has(collection)) {
      const plainRecord = Boolean(record && typeof record === 'object' && !Array.isArray(record));
      const physicalId = text(record?.id);
      const rawCompanyId = record?.companyId;
      const rawTenantId = record?.tenantId;
      const companyId = text(rawCompanyId);
      const tenantId = text(rawTenantId);
      const linkPresent = Object.prototype.hasOwnProperty.call(record || {}, 'platformDefaultId');
      const rawPlatformDefaultId = record?.platformDefaultId;
      const platformDefaultId = text(rawPlatformDefaultId);
      const evidenceCategory = COLLECTION_SCOPE_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY;
      if (!plainRecord || typeof record.id !== 'string' || physicalId !== record.id || physicalId !== recordId) {
        return { disposition: 'UNRESOLVED', ownershipRule: 'MIXED_CATALOG_PHYSICAL_ID_INVALID', futureState: 'FAIL_CLOSED', migrationRequired: 'BLOCKED', evidenceCategory };
      }
      if (!companyId && !tenantId && !linkPresent) {
        return { disposition: 'PLATFORM_DEFAULT_REFERENCE', ownershipRule: `EXACT_UNSCOPED_PLATFORM_DEFAULT_POLICY:${collection}`, futureState: 'PRESERVE_UNSCOPED_PLATFORM_DEFAULT', migrationRequired: 'NO', evidenceCategory };
      }
      if (!companyId || !tenantId || companyId !== tenantId || typeof rawCompanyId !== 'string' || typeof rawTenantId !== 'string' || rawCompanyId !== companyId || rawTenantId !== tenantId) {
        return { disposition: 'UNRESOLVED', ownershipRule: 'MIXED_CATALOG_SCOPE_INVALID', futureState: 'FAIL_CLOSED', migrationRequired: 'BLOCKED', evidenceCategory };
      }
      if (linkPresent && (!platformDefaultId || typeof rawPlatformDefaultId !== 'string' || rawPlatformDefaultId !== platformDefaultId)) {
        return { disposition: 'UNRESOLVED', ownershipRule: 'MIXED_CATALOG_OVERRIDE_LINK_INVALID', futureState: 'FAIL_CLOSED', migrationRequired: 'BLOCKED', evidenceCategory };
      }
      if (linkPresent) {
        return { disposition: 'TENANT_CATALOG_OVERRIDE', ownershipRule: `EXACT_TENANT_OVERRIDE_SCOPE:${collection}`, futureState: 'PRESERVE_EXACT_TENANT_OVERRIDE', migrationRequired: 'NO', platformDefaultId, evidenceCategory };
      }
      return { disposition: 'TENANT_OWNED_CATALOG_ENTRY', ownershipRule: `EXACT_TENANT_CATALOG_SCOPE:${collection}`, futureState: 'PRESERVE_EXACT_TENANT_ENTRY', migrationRequired: 'NO', evidenceCategory };
    }
    if (baseline) {
      return {
        disposition: 'TENANT_OWNERSHIP_CANDIDATE', ownershipRule: text(baseline.scopeSource),
        futureState: 'CANONICAL_SKYTECH_SCOPE',
        migrationRequired: text(record?.companyId) === normalizedScope.companyId
          && text(record?.tenantId) === normalizedScope.companyId ? 'NO' : 'YES',
        baselineClassification: text(baseline.classification), evidenceCategory: policy.category,
      };
    }
    if (policy.category === COLLECTION_SCOPE_CATEGORY.SYSTEM) {
      return { disposition: 'SYSTEM_RECORD', ownershipRule: 'DEDICATED_SYSTEM_POLICY', futureState: 'SYSTEM_POLICY', migrationRequired: 'NO', evidenceCategory: policy.category };
    }
    if (policy.category === COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY) {
      const audit = classifyAuditRecord(record);
      return { disposition: `AUDIT_${audit.code}`, ownershipRule: audit.ownershipRule, futureState: audit.futureState, migrationRequired: audit.migrationRequired, auditClassification: audit.code, auditEvidenceCode: audit.evidenceCode, evidenceCategory: policy.category };
    }
    if (legacyIdempotency.has(collection)) {
      return { disposition: 'LEGACY_IDEMPOTENCY_TOMBSTONE', ownershipRule: 'IMMUTABLE_GLOBAL_REPLAY_TOMBSTONE', futureState: 'HIDDEN_COMPATIBILITY_TOMBSTONE', migrationRequired: 'NO_PRESERVE_REPLAY_PROTECTION', evidenceCategory: policy.category };
    }
    if (fixtureRecordKeys.has(`${collection}:${recordId}`)) {
      return { disposition: 'FIXTURE_DEMO_TEST', ownershipRule: 'EXPLICIT_FIXTURE_STABLE_ID', futureState: 'NO_BUSINESS_MEMBERSHIP_OR_TENANT_PROMOTION', migrationRequired: 'NO', evidenceCategory: policy.category };
    }
    return { disposition: 'UNRESOLVED', ownershipRule: 'NO_EXPLICIT_CLASSIFICATION_AUTHORITY', futureState: 'FAIL_CLOSED', migrationRequired: 'BLOCKED', evidenceCategory: policy.category };
  }

  function classifyProductionPrincipal({ user, helperRow, actorMapping }) {
    const principalId = text(user?.id);
    if (actorMapping?.action === 'CREATE_MEMBERSHIP' && businessPrincipalIds.has(principalId)) {
      return { classification: 'BUSINESS_USER', membership: 'YES', companyId: actorMapping.companyId, tenantId: actorMapping.tenantId, branchIds: [...(actorMapping.branchIds || [])], companyWideBranchAuthority: actorMapping.companyWideBranchAuthority === true, roleTemplateKey: actorMapping.roleTemplateKey, roleTemplateVersion: actorMapping.roleTemplateVersion, evidenceCode: 'EXPLICIT_APPROVED_STABLE_ID_MAPPING' };
    }
    if (smokePrincipalIds.has(principalId)) {
      return { classification: 'SMOKE_ACCOUNT', membership: 'NO', companyId: null, tenantId: null, branchIds: [], companyWideBranchAuthority: false, roleTemplateKey: null, roleTemplateVersion: null, evidenceCode: 'DEDICATED_REPLACEMENT_REQUIRED_NO_ADMIN_MEMBERSHIP' };
    }
    if (demoPrincipalIds.has(principalId)) {
      return { classification: 'DEMO_FIXTURE', membership: 'NO', companyId: null, tenantId: null, branchIds: [], companyWideBranchAuthority: false, roleTemplateKey: null, roleTemplateVersion: null, evidenceCode: 'EXPLICIT_DEMO_PRINCIPAL_STABLE_ID' };
    }
    if (inactivePrincipalIds.has(principalId) && helperRow?.proposedAction === 'NO_ACTIVE_MEMBERSHIP') {
      return { classification: 'INTENTIONALLY_UNMAPPED', membership: 'NO', companyId: null, tenantId: null, branchIds: [], companyWideBranchAuthority: false, roleTemplateKey: null, roleTemplateVersion: null, evidenceCode: 'EXPLICIT_INACTIVE_PRODUCTION_PRINCIPAL' };
    }
    return { classification: 'UNRESOLVED', membership: 'NO', companyId: null, tenantId: null, branchIds: [], companyWideBranchAuthority: false, roleTemplateKey: null, roleTemplateVersion: null, evidenceCode: 'NO_EXPLICIT_PRINCIPAL_DISPOSITION' };
  }

  return Object.freeze({
    canonicalScope: normalizedScope,
    sensitiveAuthority: normalizedSensitive,
    classificationAuthoritySnapshot: () => classificationAuthoritySnapshot(contract),
    classifyAuditRecord,
    classifyProductionPrincipal,
    classifyProductionScopeRecord,
  });
}

// Compatibility calls deliberately carry no production identity authority.
// Production evidence must construct and verify an exact authority explicitly.
const genericScope = Object.freeze({ companyId: 'repository-safe-unbound-company', headOfficeId: 'repository-safe-unbound-branch' });
const genericSensitiveAuthority = Object.freeze(Object.fromEntries(
  Object.keys(SENSITIVE_AUTHORITY_COUNTS).map(key => [key, []]),
));
const genericContract = createClassificationContract({
  canonicalScope: genericScope,
  sensitiveAuthority: genericSensitiveAuthority,
});
const genericAuthority = createProductionScopeClassificationAuthority({
  canonicalScope: genericScope,
  sensitiveAuthority: genericSensitiveAuthority,
  contract: genericContract,
});

module.exports = {
  CANONICAL_SCOPE_DOMAIN,
  EXPECTED_FROZEN_SNAPSHOT,
  GLOBAL_AUDIT_ENTITY_TYPES,
  LEGACY_IDEMPOTENCY_COLLECTIONS,
  PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS,
  PRODUCTION_CANONICAL_SCOPE_SHA256,
  PRODUCTION_CLASSIFICATION_CONTRACT,
  PRODUCTION_SENSITIVE_AUTHORITY_SHA256,
  SENSITIVE_AUTHORITY_COUNTS,
  SENSITIVE_AUTHORITY_DOMAIN,
  ProductionScopeClassificationAuthorityError,
  calculateCanonicalScopeSha256,
  calculateSensitiveAuthoritySha256,
  classificationAuthoritySnapshot,
  classifyAuditRecord: genericAuthority.classifyAuditRecord,
  classifyProductionPrincipal: genericAuthority.classifyProductionPrincipal,
  classifyProductionScopeRecord: genericAuthority.classifyProductionScopeRecord,
  createClassificationContract,
  createProductionScopeClassificationAuthority,
  normalizeSensitiveAuthority,
  sensitiveAuthorityProjection,
};
