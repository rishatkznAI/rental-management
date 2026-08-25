const {
  CANONICAL_COMPANIES_TABLE,
} = require('./canonical-receivables-schema');
const {
  COMPANY_MEMBERSHIPS_TABLE,
} = require('./platform-identity-schema');

// The current platform identity model has one tenant security boundary: company.
// There is no independently editable Tenant root or user -> tenant membership.
// Keep that domain invariant explicit and centralized instead of inventing a
// default tenant identifier or accepting one from an HTTP request.
const TENANT_MODEL = 'company_is_tenant';
const SCOPED_MASTER_DATA_COLLECTIONS = Object.freeze([
  'counterparties',
  'counterparty_role_assignments',
  'supplier_profiles',
  'contractor_profiles',
  'clients',
  'client_objects',
  'client_contracts',
]);
const SCOPED_MASTER_DATA_COLLECTION_SET = new Set(SCOPED_MASTER_DATA_COLLECTIONS);

class ActorScopeError extends Error {
  constructor(code, message, status = 403, details = undefined) {
    super(message);
    this.name = 'ActorScopeError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function scopeText(value) {
  return String(value ?? '').trim();
}

function incomplete(message = 'Trusted company/tenant scope пользователя не настроен.', details) {
  throw new ActorScopeError('ACTOR_SCOPE_INCOMPLETE', message, 403, details);
}

function assertCompleteActorScope(scope) {
  const companyId = scopeText(scope?.companyId);
  const tenantId = scopeText(scope?.tenantId);
  if (!companyId || !tenantId) incomplete();
  if (companyId !== tenantId) {
    incomplete('Company и tenant actor scope должны иметь один canonical ID.', {
      tenantModel: TENANT_MODEL,
    });
  }
  return Object.freeze({
    ...scope,
    companyId,
    tenantId,
    tenantModel: TENANT_MODEL,
  });
}

function createTrustedActorScopeResolver({ db } = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('Trusted actor scope resolver requires a SQLite database.');
  }
  const activeMemberships = db.prepare(`
    SELECT id, companyId, principalId, version
    FROM ${COMPANY_MEMBERSHIPS_TABLE}
    WHERE principalId = ? AND status = 'active'
    ORDER BY companyId, id
  `);
  const activeCompany = db.prepare(`
    SELECT id
    FROM ${CANONICAL_COMPANIES_TABLE}
    WHERE id = ? AND status = 'active'
  `);

  return function resolveTrustedActorScope(principalId) {
    const trustedPrincipalId = scopeText(principalId);
    if (!trustedPrincipalId) incomplete('Authenticated principal ID отсутствует.');
    const memberships = activeMemberships.all(trustedPrincipalId);
    if (memberships.length !== 1) {
      incomplete(
        memberships.length === 0
          ? 'У пользователя нет active company membership.'
          : 'Company membership пользователя неоднозначен.',
        { activeMembershipCount: memberships.length },
      );
    }
    const membership = memberships[0];
    const company = activeCompany.get(membership.companyId);
    if (!company) {
      incomplete('Authoritative company пользователя отсутствует или неактивна.', {
        membershipId: membership.id,
      });
    }
    return assertCompleteActorScope(Object.freeze({
      companyId: company.id,
      tenantId: company.id,
      membershipId: membership.id,
      membershipVersion: Number(membership.version),
      principalId: trustedPrincipalId,
      source: 'active_company_membership',
    }));
  };
}

function resolveOptionalActorScope(resolveTrustedActorScope, principalId) {
  try {
    return resolveTrustedActorScope(principalId);
  } catch (error) {
    if (error?.code === 'ACTOR_SCOPE_INCOMPLETE') return null;
    throw error;
  }
}

function requireRequestActorScope(req) {
  return assertCompleteActorScope(req?.actorScope);
}

function actorWithScope(req) {
  const scope = requireRequestActorScope(req);
  return { ...(req?.user || {}), ...scope };
}

function assertOwnershipFieldsNotClientSupplied(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const fields = ['companyId', 'tenantId']
    .filter(field => Object.prototype.hasOwnProperty.call(input, field));
  if (fields.length > 0) {
    throw new ActorScopeError(
      'MASTER_DATA_SCOPE_CLIENT_SUPPLIED',
      'companyId и tenantId назначаются только backend actor scope.',
      409,
      { fields },
    );
  }
}

function assignTrustedScope(record, scope) {
  const trusted = assertCompleteActorScope(scope);
  const { companyId: _companyId, tenantId: _tenantId, ...safeRecord } = record || {};
  return {
    ...safeRecord,
    companyId: trusted.companyId,
    tenantId: trusted.tenantId,
  };
}

function filterRecordsByActorScope(records, scope) {
  const trusted = assertCompleteActorScope(scope);
  return (Array.isArray(records) ? records : []).filter(record => (
    scopeText(record?.companyId) === trusted.companyId
    && scopeText(record?.tenantId) === trusted.tenantId
  ));
}

function assertRecordMatchesActorScope(record, scope, {
  code = 'MASTER_DATA_SCOPE_FORBIDDEN',
  unknownCode = 'MASTER_DATA_SCOPE_UNKNOWN',
  entityId = record?.id || null,
} = {}) {
  const trusted = assertCompleteActorScope(scope);
  for (const field of ['companyId', 'tenantId']) {
    const value = scopeText(record?.[field]);
    if (!value) {
      throw new ActorScopeError(
        unknownCode,
        `Legacy scope сущности нельзя определить по ${field}.`,
        409,
        { entityId, field },
      );
    }
    if (value !== trusted[field]) {
      throw new ActorScopeError(
        code,
        'Сущность не принадлежит company/tenant текущего пользователя.',
        403,
        { entityId, field },
      );
    }
  }
  return trusted;
}

function isScopedMasterDataCollection(collection) {
  return SCOPED_MASTER_DATA_COLLECTION_SET.has(String(collection || ''));
}

module.exports = {
  ActorScopeError,
  SCOPED_MASTER_DATA_COLLECTIONS,
  TENANT_MODEL,
  actorWithScope,
  assertCompleteActorScope,
  assertOwnershipFieldsNotClientSupplied,
  assertRecordMatchesActorScope,
  assignTrustedScope,
  createTrustedActorScopeResolver,
  filterRecordsByActorScope,
  isScopedMasterDataCollection,
  requireRequestActorScope,
  resolveOptionalActorScope,
};
