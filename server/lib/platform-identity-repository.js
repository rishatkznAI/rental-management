const crypto = require('crypto');
const { types: utilTypes } = require('util');
const {
  CANONICAL_BRANCHES_TABLE,
  CANONICAL_COMPANIES_TABLE,
} = require('./canonical-receivables-schema');
const {
  AUTHORIZATION_AUDIT_EVENTS_TABLE,
  CAPABILITY_CATALOG_ENTRIES_TABLE,
  CAPABILITY_CATALOG_V1_CHECKSUM,
  CAPABILITY_CATALOG_VERSIONS_TABLE,
  COMPANY_SCOPED_CAPABILITY_KEYS,
  COMPANY_MEMBERSHIPS_TABLE,
  FINANCIAL_TABLES,
  IDENTITY_BOOTSTRAP_RUNS_TABLE,
  MEMBERSHIP_BRANCH_ACCESS_TABLE,
  MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE,
  ROLE_TEMPLATE_CAPABILITIES_TABLE,
  ROLE_TEMPLATES_TABLE,
  assertPlatformIdentityStructure,
} = require('./platform-identity-schema');

const COMPANY_STATUSES = new Set(['inactive', 'active', 'archived']);
const BRANCH_STATUSES = new Set(['inactive', 'active', 'archived']);
const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'inactive', 'revoked']);
const ASSIGNMENT_EFFECTS = new Set(['grant', 'deny']);
const COMPANY_SCOPED_CAPABILITIES = new Set(COMPANY_SCOPED_CAPABILITY_KEYS);
const AUDIT_JSON_MAX_DEPTH = 24;
const AUDIT_JSON_MAX_BYTES = 64 * 1024;
const TRUSTED_USER_ACTOR_CONTEXTS = new WeakSet();
const FORBIDDEN_BRANCH_IDS = new Set([
  '*',
  'all',
  'global',
  'company-wide',
  'company_wide',
  'any',
  'null',
]);
const SECRET_KEY_FRAGMENTS = Object.freeze([
  'password',
  'passwd',
  'secret',
  'token',
  'credential',
]);
const SECRET_KEY_EXACT = new Set([
  'authorization',
  'cookie',
  'session',
  'apikey',
  'privatekey',
]);

class PlatformIdentityRepositoryError extends Error {
  constructor(code, message, field) {
    super(message);
    this.name = 'PlatformIdentityRepositoryError';
    this.code = code;
    this.field = field;
  }
}

function fail(code, message, field) {
  throw new PlatformIdentityRepositoryError(code, message, field);
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('PLATFORM_IDENTITY_REQUIRED', `${field} is required.`, field);
  }
  return value.trim();
}

function requiredId(value, field) {
  const id = requiredText(value, field);
  if (id.length > 160 || /[\u0000-\u001f\u007f]/.test(id)) {
    fail('PLATFORM_IDENTITY_INVALID_ID', `${field} must be an opaque stable identifier.`, field);
  }
  return id;
}

function requiredVersion(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('PLATFORM_IDENTITY_INVALID_VERSION', `${field} must be a positive integer.`, field);
  }
  return value;
}

function booleanValue(value, field) {
  if (typeof value !== 'boolean') {
    fail('PLATFORM_IDENTITY_INVALID_BOOLEAN', `${field} must be boolean.`, field);
  }
  return value;
}

function enumValue(value, allowed, field) {
  const normalized = requiredText(value, field);
  if (!allowed.has(normalized)) {
    fail('PLATFORM_IDENTITY_INVALID_VALUE', `${field} is invalid.`, field);
  }
  return normalized;
}

function assertIanaTimezone(value, field = 'receivablesTimezone') {
  const timezone = requiredText(value, field);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
  } catch {
    fail('PLATFORM_IDENTITY_INVALID_TIMEZONE', `${field} must be a valid IANA timezone.`, field);
  }
  return timezone;
}

function assertBranchId(value, field = 'branchId') {
  const branchId = requiredId(value, field);
  if (FORBIDDEN_BRANCH_IDS.has(branchId.toLowerCase())) {
    fail('PLATFORM_IDENTITY_BRANCH_SENTINEL_FORBIDDEN', `${field} cannot be a wildcard.`, field);
  }
  return branchId;
}

function normalizedSecurityKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSecretBearingKey(value) {
  const normalized = normalizedSecurityKey(value);
  return (
    SECRET_KEY_EXACT.has(normalized)
    || SECRET_KEY_FRAGMENTS.some(fragment => normalized.includes(fragment))
  );
}

function assertNoSecrets(value, path = 'json') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (isSecretBearingKey(key)) {
      fail('PLATFORM_IDENTITY_AUDIT_SECRET_REJECTED', `Secret-bearing audit field is forbidden: ${path}.${key}.`);
    }
    assertNoSecrets(child, `${path}.${key}`);
  }
}

function invalidAuditJson(message, path) {
  fail('PLATFORM_IDENTITY_AUDIT_JSON_REJECTED', message, path);
}

function addAuditJsonBytes(state, value, path) {
  state.bytes += Buffer.byteLength(value, 'utf8');
  if (state.bytes > AUDIT_JSON_MAX_BYTES) {
    invalidAuditJson(`Audit payload exceeds ${AUDIT_JSON_MAX_BYTES} bytes.`, path);
  }
}

function canonicalizeAuditValue(value, path, depth, ancestors, sizeState) {
  if (depth > AUDIT_JSON_MAX_DEPTH) {
    invalidAuditJson(`Audit payload exceeds maximum depth ${AUDIT_JSON_MAX_DEPTH}.`, path);
  }
  if (value === null) {
    addAuditJsonBytes(sizeState, 'null', path);
    return null;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    addAuditJsonBytes(sizeState, JSON.stringify(value), path);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidAuditJson('Audit payload numbers must be finite.', path);
    addAuditJsonBytes(sizeState, JSON.stringify(value), path);
    return value;
  }
  if (typeof value !== 'object') {
    invalidAuditJson('Audit payload contains a non-JSON value.', path);
  }
  if (utilTypes.isProxy(value)) {
    invalidAuditJson('Audit payload cannot contain proxy objects.', path);
  }
  if (ancestors.has(value)) {
    invalidAuditJson('Audit payload cannot contain cyclic structures.', path);
  }
  if ('toJSON' in value) {
    invalidAuditJson('Audit payload objects cannot define or inherit toJSON.', path);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    invalidAuditJson('Audit payload cannot contain symbol keys.', path);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        invalidAuditJson('Audit arrays must use the standard Array prototype.', path);
      }
      addAuditJsonBytes(sizeState, '[]', path);
      const keys = Object.getOwnPropertyNames(value).filter(key => key !== 'length');
      if (
        keys.length !== value.length
        || keys.some(key => !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
      ) {
        invalidAuditJson('Audit arrays cannot contain holes or custom properties.', path);
      }
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) addAuditJsonBytes(sizeState, ',', path);
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          !descriptor
          || !descriptor.enumerable
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ) {
          invalidAuditJson('Audit arrays cannot contain holes or accessors.', `${path}[${index}]`);
        }
        result.push(canonicalizeAuditValue(
          descriptor.value,
          `${path}[${index}]`,
          depth + 1,
          ancestors,
          sizeState,
        ));
      }
      return result;
    }

    if (Object.getPrototypeOf(value) !== Object.prototype) {
      invalidAuditJson('Audit objects must be plain JSON objects.', path);
    }
    addAuditJsonBytes(sizeState, '{}', path);
    const result = {};
    const keys = Object.getOwnPropertyNames(value).sort();
    for (const [index, key] of keys.entries()) {
      if (index > 0) addAuditJsonBytes(sizeState, ',', path);
      if (isSecretBearingKey(key)) {
        fail(
          'PLATFORM_IDENTITY_AUDIT_SECRET_REJECTED',
          `Secret-bearing audit field is forbidden: ${path}.${key}.`,
          `${path}.${key}`,
        );
      }
      addAuditJsonBytes(sizeState, `${JSON.stringify(key)}:`, `${path}.${key}`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor
        || !descriptor.enumerable
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) {
        invalidAuditJson('Audit objects cannot contain accessors or hidden values.', `${path}.${key}`);
      }
      result[key] = canonicalizeAuditValue(
        descriptor.value,
        `${path}.${key}`,
        depth + 1,
        ancestors,
        sizeState,
      );
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function auditJson(value) {
  if (value === null) return null;
  if (!Array.isArray(value) && (
    typeof value !== 'object'
    || value === null
    || Object.getPrototypeOf(value) !== Object.prototype
  )) {
    invalidAuditJson('Audit payload must be null, a plain JSON object, or a JSON array.', 'json');
  }
  const sizeState = { bytes: 0 };
  const serialized = JSON.stringify(canonicalizeAuditValue(
    value,
    'json',
    0,
    new WeakSet(),
    sizeState,
  ));
  return serialized;
}

function sortedUnique(values, normalizer) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizer))].sort();
}

function createTrustedUserActorContext(input = {}) {
  const allowedKeys = new Set([
    'principalId',
    'membershipId',
    'expectedMembershipVersion',
    'correlationId',
  ]);
  const unknownKeys = Object.keys(input || {}).filter(key => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    fail(
      'PLATFORM_IDENTITY_ACTOR_CONTEXT_REJECTED',
      `Trusted actor context contains an unsupported field: ${unknownKeys[0]}.`,
      unknownKeys[0],
    );
  }
  const principalId = requiredId(input.principalId, 'actorContext.principalId');
  const membershipId = input.membershipId == null
    ? null
    : requiredId(input.membershipId, 'actorContext.membershipId');
  const expectedMembershipVersion = membershipId == null
    ? null
    : requiredVersion(
      input.expectedMembershipVersion,
      'actorContext.expectedMembershipVersion',
    );
  if (membershipId == null && input.expectedMembershipVersion != null) {
    fail(
      'PLATFORM_IDENTITY_ACTOR_CONTEXT_REJECTED',
      'A membership version cannot be supplied without a membership ID.',
      'actorContext.expectedMembershipVersion',
    );
  }
  const context = Object.freeze({
    principalId,
    membershipId,
    expectedMembershipVersion,
    correlationId: requiredId(input.correlationId, 'actorContext.correlationId'),
  });
  TRUSTED_USER_ACTOR_CONTEXTS.add(context);
  return context;
}

function isEligiblePlatformUser(user) {
  return Boolean(
    user
    && user.status === 'Активен'
    && !(
      user.botOnly === true
      && user.allowFrontendLogin !== true
      && user.frontendAccess !== true
    )
  );
}

function createPlatformIdentityRepository(db, options = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    fail('PLATFORM_IDENTITY_DATABASE_REQUIRED', 'A better-sqlite3 database is required.');
  }
  assertPlatformIdentityStructure(db);
  if (typeof options.readUsers !== 'function') {
    fail(
      'PLATFORM_IDENTITY_USER_DIRECTORY_REQUIRED',
      'A live users-directory reader is required.',
    );
  }

  const nowIso = typeof options.nowIso === 'function'
    ? options.nowIso
    : () => new Date().toISOString();
  const generateId = typeof options.generateId === 'function'
    ? options.generateId
    : prefix => `${prefix}-${crypto.randomUUID()}`;
  const validatedActors = new WeakSet();

  function resolveTrustedActor(actorContext, companyId, {
    allowWithoutMembership = false,
    allowWithoutMembershipAfterProvisioning = false,
  } = {}) {
    if (!actorContext || !TRUSTED_USER_ACTOR_CONTEXTS.has(actorContext)) {
      fail(
        'PLATFORM_IDENTITY_ACTOR_CONTEXT_REJECTED',
        'A trusted server-created user actor context is required.',
      );
    }
    const principalId = actorContext.principalId;
    const users = options.readUsers();
    if (!Array.isArray(users)) {
      fail('PLATFORM_IDENTITY_ACTOR_USER_DENIED', 'The live users directory is unavailable.');
    }
    const matches = users.filter(user => user && user.id === principalId);
    if (matches.length !== 1 || !isEligiblePlatformUser(matches[0])) {
      fail('PLATFORM_IDENTITY_ACTOR_USER_DENIED', 'The audit actor is unavailable.');
    }

    const normalizedCompanyId = requiredId(companyId, 'companyId');
    const activeMemberships = db.prepare(`
      SELECT *
      FROM ${COMPANY_MEMBERSHIPS_TABLE}
      WHERE companyId = ? AND principalId = ? AND status = 'active'
      ORDER BY id
    `).all(normalizedCompanyId, principalId);
    let membership = null;
    if (actorContext.membershipId != null) {
      membership = getMembership(actorContext.membershipId);
      if (
        !membership
        || membership.companyId !== normalizedCompanyId
        || membership.principalId !== principalId
        || membership.status !== 'active'
        || Number(membership.version) !== Number(actorContext.expectedMembershipVersion)
      ) {
        fail(
          'PLATFORM_IDENTITY_ACTOR_MEMBERSHIP_DENIED',
          'The audit actor membership is unavailable or stale.',
        );
      }
    } else if (activeMemberships.length === 1) {
      membership = activeMemberships[0];
    } else if (activeMemberships.length > 1) {
      fail(
        'PLATFORM_IDENTITY_ACTOR_MEMBERSHIP_DENIED',
        'The audit actor membership is ambiguous.',
      );
    } else {
      const companyMembershipCount = Number(db.prepare(`
        SELECT COUNT(*) AS count
        FROM ${COMPANY_MEMBERSHIPS_TABLE}
        WHERE companyId = ?
      `).get(normalizedCompanyId).count);
      if (
        !allowWithoutMembership
        || (companyMembershipCount !== 0 && !allowWithoutMembershipAfterProvisioning)
      ) {
        fail(
          'PLATFORM_IDENTITY_ACTOR_MEMBERSHIP_DENIED',
          'An active audit actor membership is required.',
        );
      }
    }
    if (
      membership
      && actorContext.membershipId != null
      && activeMemberships.some(item => item.id !== membership.id)
    ) {
      fail(
        'PLATFORM_IDENTITY_ACTOR_MEMBERSHIP_DENIED',
        'The audit actor membership is ambiguous.',
      );
    }

    const actor = Object.freeze({
      type: 'user',
      principalId,
      membershipId: membership?.id || null,
      membershipVersion: membership ? Number(membership.version) : null,
      correlationId: actorContext.correlationId,
    });
    validatedActors.add(actor);
    return actor;
  }

  function transactionImmediate(operation) {
    return db.transaction(operation).immediate();
  }

  function getCompany(companyId) {
    return db.prepare(`
      SELECT id, receivablesTimezone, createdAt, displayName, status, version, updatedAt
      FROM ${CANONICAL_COMPANIES_TABLE}
      WHERE id = ?
    `).get(requiredId(companyId, 'companyId')) || null;
  }

  function listBranches(companyId, { status } = {}) {
    const normalizedCompanyId = requiredId(companyId, 'companyId');
    if (status !== undefined) enumValue(status, BRANCH_STATUSES, 'status');
    return db.prepare(`
      SELECT companyId, id, isHeadOffice, createdAt, displayName, status, version, updatedAt
      FROM ${CANONICAL_BRANCHES_TABLE}
      WHERE companyId = @companyId
        AND (@status IS NULL OR status = @status)
      ORDER BY id
    `).all({ companyId: normalizedCompanyId, status: status || null });
  }

  function listHeadOffices(companyId, { activeOnly = false } = {}) {
    const normalizedCompanyId = requiredId(companyId, 'companyId');
    return db.prepare(`
      SELECT companyId, id, isHeadOffice, createdAt, displayName, status, version, updatedAt
      FROM ${CANONICAL_BRANCHES_TABLE}
      WHERE companyId = ?
        AND isHeadOffice = 1
        ${activeOnly ? "AND status = 'active'" : ''}
      ORDER BY id
    `).all(normalizedCompanyId);
  }

  function requireActiveHeadOffice(companyId) {
    const offices = listHeadOffices(companyId, { activeOnly: true });
    if (offices.length !== 1) {
      fail('PLATFORM_IDENTITY_HEAD_OFFICE_INVALID', 'Active company requires exactly one active Head Office.');
    }
    return offices[0];
  }

  function listMembershipsForPrincipal(principalId, { status } = {}) {
    const normalizedPrincipalId = requiredId(principalId, 'principalId');
    if (status !== undefined) enumValue(status, MEMBERSHIP_STATUSES, 'status');
    return db.prepare(`
      SELECT *
      FROM ${COMPANY_MEMBERSHIPS_TABLE}
      WHERE principalId = @principalId
        AND (@status IS NULL OR status = @status)
      ORDER BY companyId, id
    `).all({ principalId: normalizedPrincipalId, status: status || null });
  }

  function getMembership(membershipId) {
    return db.prepare(`
      SELECT *
      FROM ${COMPANY_MEMBERSHIPS_TABLE}
      WHERE id = ?
    `).get(requiredId(membershipId, 'membershipId')) || null;
  }

  function getRoleTemplate(companyId, templateKey, templateVersion) {
    return db.prepare(`
      SELECT *
      FROM ${ROLE_TEMPLATES_TABLE}
      WHERE companyId = ?
        AND templateKey = ?
        AND templateVersion = ?
    `).get(
      requiredId(companyId, 'companyId'),
      requiredId(templateKey, 'templateKey'),
      requiredVersion(templateVersion, 'templateVersion'),
    ) || null;
  }

  function listRoleTemplateCapabilities(companyId, templateKey, templateVersion) {
    return db.prepare(`
      SELECT companyId, templateKey, templateVersion, catalogVersion, capabilityKey
      FROM ${ROLE_TEMPLATE_CAPABILITIES_TABLE}
      WHERE companyId = ?
        AND templateKey = ?
        AND templateVersion = ?
      ORDER BY capabilityKey
    `).all(
      requiredId(companyId, 'companyId'),
      requiredId(templateKey, 'templateKey'),
      requiredVersion(templateVersion, 'templateVersion'),
    );
  }

  function listActiveCatalogVersions() {
    return db.prepare(`
      SELECT version, status, checksum, createdAt
      FROM ${CAPABILITY_CATALOG_VERSIONS_TABLE}
      WHERE status = 'active'
      ORDER BY version
    `).all();
  }

  function listCatalogEntries(catalogVersion) {
    return db.prepare(`
      SELECT catalogVersion, capabilityKey, scopeKind, assignable, status, createdAt
      FROM ${CAPABILITY_CATALOG_ENTRIES_TABLE}
      WHERE catalogVersion = ?
      ORDER BY capabilityKey
    `).all(requiredVersion(catalogVersion, 'catalogVersion'));
  }

  function listBranchAccess(membershipId, { status } = {}) {
    const normalizedMembershipId = requiredId(membershipId, 'membershipId');
    if (status !== undefined) enumValue(status, new Set(['active', 'revoked']), 'status');
    return db.prepare(`
      SELECT *
      FROM ${MEMBERSHIP_BRANCH_ACCESS_TABLE}
      WHERE membershipId = @membershipId
        AND (@status IS NULL OR status = @status)
      ORDER BY branchId, grantedAt, id
    `).all({ membershipId: normalizedMembershipId, status: status || null });
  }

  function listCapabilityAssignments(membershipId, { status } = {}) {
    const normalizedMembershipId = requiredId(membershipId, 'membershipId');
    if (status !== undefined) enumValue(status, new Set(['active', 'revoked']), 'status');
    return db.prepare(`
      SELECT *
      FROM ${MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE}
      WHERE membershipId = @membershipId
        AND (@status IS NULL OR status = @status)
      ORDER BY capabilityKey, grantedAt, id
    `).all({ membershipId: normalizedMembershipId, status: status || null });
  }

  function requireActiveCatalog() {
    const versions = listActiveCatalogVersions();
    if (
      versions.length !== 1
      || Number(versions[0].version) !== 1
      || versions[0].checksum !== CAPABILITY_CATALOG_V1_CHECKSUM
    ) {
      fail('PLATFORM_IDENTITY_CATALOG_INVALID', 'The active capability catalog is inconsistent.');
    }
    return versions[0];
  }

  function requireCatalogCapability(catalogVersion, capabilityKey, { grant = false } = {}) {
    const key = requiredId(capabilityKey, 'capabilityKey');
    const row = db.prepare(`
      SELECT catalogVersion, capabilityKey, scopeKind, assignable, status
      FROM ${CAPABILITY_CATALOG_ENTRIES_TABLE}
      WHERE catalogVersion = ? AND capabilityKey = ?
    `).get(requiredVersion(catalogVersion, 'catalogVersion'), key);
    if (!row || row.status !== 'active' || (grant && row.assignable !== 1)) {
      fail('PLATFORM_IDENTITY_CAPABILITY_REJECTED', 'Capability is unknown, inactive, or not assignable.');
    }
    return row;
  }

  function requireActiveCompany(companyId) {
    const company = getCompany(companyId);
    if (!company || company.status !== 'active') {
      fail('PLATFORM_IDENTITY_COMPANY_INACTIVE', 'An active company is required.');
    }
    assertIanaTimezone(company.receivablesTimezone);
    requireActiveHeadOffice(company.id);
    return company;
  }

  function requireActiveTemplate(membershipLike) {
    const template = getRoleTemplate(
      membershipLike.companyId,
      membershipLike.roleTemplateKey,
      Number(membershipLike.roleTemplateVersion),
    );
    const catalog = requireActiveCatalog();
    if (
      !template
      || template.status !== 'active'
      || Number(template.catalogVersion) !== Number(catalog.version)
    ) {
      fail('PLATFORM_IDENTITY_TEMPLATE_INVALID', 'An exact active role template is required.');
    }
    return template;
  }

  function assertMembershipCapabilityCompatibility(membershipLike, {
    assignments,
  } = {}) {
    if (membershipLike.companyWideBranchAuthority === 1) return true;
    const templateCapabilities = listRoleTemplateCapabilities(
      membershipLike.companyId,
      membershipLike.roleTemplateKey,
      Number(membershipLike.roleTemplateVersion),
    );
    if (
      templateCapabilities.some(item => COMPANY_SCOPED_CAPABILITIES.has(item.capabilityKey))
    ) {
      fail(
        'PLATFORM_IDENTITY_COMPANY_CAPABILITY_SCOPE_CONFLICT',
        'Company-scoped role-template capabilities require company-wide branch authority.',
      );
    }
    const activeAssignments = assignments || (
      membershipLike.id
        ? listCapabilityAssignments(membershipLike.id, { status: 'active' })
        : []
    );
    if (
      activeAssignments.some(item => (
        item.effect === 'grant'
        && COMPANY_SCOPED_CAPABILITIES.has(item.capabilityKey)
      ))
    ) {
      fail(
        'PLATFORM_IDENTITY_COMPANY_CAPABILITY_SCOPE_CONFLICT',
        'Company-scoped grants require company-wide branch authority.',
      );
    }
    return true;
  }

  function insertAuditRow(event) {
    const actor = event.validatedActor;
    if (!actor || !validatedActors.has(actor)) {
      fail(
        'PLATFORM_IDENTITY_ACTOR_CONTEXT_REJECTED',
        'Audit actor metadata must come from in-transaction trusted validation.',
      );
    }
    const companyId = requiredId(event.companyId, 'companyId');
    const branchId = event.branchId == null
      ? requireActiveHeadOffice(companyId).id
      : assertBranchId(event.branchId, 'branchId');
    const branch = db.prepare(`
      SELECT id
      FROM ${CANONICAL_BRANCHES_TABLE}
      WHERE companyId = ? AND id = ?
    `).get(companyId, branchId);
    if (!branch) {
      fail('PLATFORM_IDENTITY_AUDIT_BRANCH_INVALID', 'Audit branch must be a concrete company branch.');
    }
    const row = {
      id: event.id ? requiredId(event.id, 'audit.id') : generateId('authorization-audit'),
      companyId,
      branchId,
      actorType: actor.type,
      actorPrincipalId: actor.principalId,
      actorMembershipId: actor.membershipId,
      actorMembershipVersion: actor.membershipVersion,
      action: requiredText(event.action, 'audit.action'),
      targetType: requiredText(event.targetType, 'audit.targetType'),
      targetId: requiredId(event.targetId, 'audit.targetId'),
      capabilityKey: event.capabilityKey == null
        ? null
        : requiredId(event.capabilityKey, 'audit.capabilityKey'),
      decision: enumValue(
        event.decision || 'applied',
        new Set(['allowed', 'denied', 'applied', 'rejected']),
        'audit.decision',
      ),
      reasonCode: requiredText(event.reasonCode, 'audit.reasonCode'),
      beforeJson: event.before === undefined ? null : auditJson(event.before),
      afterJson: event.after === undefined ? null : auditJson(event.after),
      capabilityCatalogVersion: event.capabilityCatalogVersion == null
        ? null
        : requiredVersion(event.capabilityCatalogVersion, 'audit.capabilityCatalogVersion'),
      correlationId: actor.correlationId,
      occurredAt: event.occurredAt || nowIso(),
      createdAt: event.createdAt || nowIso(),
    };
    if (typeof options.beforeAuditInsert === 'function') options.beforeAuditInsert(row);
    db.prepare(`
      INSERT INTO ${AUTHORIZATION_AUDIT_EVENTS_TABLE} (
        id, companyId, branchId, actorType, actorPrincipalId,
        actorMembershipId, actorMembershipVersion, action, targetType,
        targetId, capabilityKey, decision, reasonCode, beforeJson, afterJson,
        capabilityCatalogVersion, correlationId, occurredAt, createdAt
      ) VALUES (
        @id, @companyId, @branchId, @actorType, @actorPrincipalId,
        @actorMembershipId, @actorMembershipVersion, @action, @targetType,
        @targetId, @capabilityKey, @decision, @reasonCode, @beforeJson, @afterJson,
        @capabilityCatalogVersion, @correlationId, @occurredAt, @createdAt
      )
    `).run(row);
    return Object.freeze({ ...row });
  }

  function insertAudit(event = {}) {
    return transactionImmediate(() => {
      const companyId = requiredId(event.companyId, 'companyId');
      const validatedActor = resolveTrustedActor(event.actorContext, companyId);
      return insertAuditRow({
        ...event,
        companyId,
        validatedActor,
      });
    });
  }

  function bumpMembership(membershipId, expectedVersion, actorPrincipalId, reason, timestamp) {
    const result = db.prepare(`
      UPDATE ${COMPANY_MEMBERSHIPS_TABLE}
      SET version = version + 1,
          updatedAt = @updatedAt,
          updatedBy = @updatedBy,
          reason = @reason
      WHERE id = @id AND version = @expectedVersion
    `).run({
      id: membershipId,
      expectedVersion,
      updatedAt: timestamp,
      updatedBy: actorPrincipalId,
      reason,
    });
    if (result.changes !== 1) {
      fail('PLATFORM_IDENTITY_STALE_VERSION', 'Membership version is stale.');
    }
    return getMembership(membershipId);
  }

  function assertExplicitBranchMode(membership) {
    const activeGrants = listBranchAccess(membership.id, { status: 'active' });
    if (membership.companyWideBranchAuthority === 1) {
      if (activeGrants.length !== 0) {
        fail('PLATFORM_IDENTITY_BRANCH_MODE_CONFLICT', 'Company-wide authority cannot have active explicit grants.');
      }
      return;
    }
    if (membership.status === 'active' && activeGrants.length === 0) {
      fail('PLATFORM_IDENTITY_EMPTY_BRANCH_SCOPE', 'Active explicit membership requires a branch grant.');
    }
  }

  function createCompanyAuthority(input = {}) {
    return transactionImmediate(() => {
      const company = input.company || {};
      const companyId = requiredId(company.id, 'company.id');
      const displayName = requiredText(company.displayName, 'company.displayName');
      const receivablesTimezone = assertIanaTimezone(company.receivablesTimezone);
      const validatedActor = resolveTrustedActor(input.actorContext, companyId, {
        allowWithoutMembership: true,
      });
      const reason = requiredText(input.reason, 'reason');
      const timestamp = input.timestamp || nowIso();
      const branches = Array.isArray(input.branches) ? input.branches : [];
      if (branches.length === 0) {
        fail('PLATFORM_IDENTITY_BRANCH_REQUIRED', 'At least one branch is required.');
      }
      const normalizedBranches = branches.map(branch => ({
        id: assertBranchId(branch.id),
        displayName: requiredText(branch.displayName, 'branch.displayName'),
        isHeadOffice: branch.isHeadOffice === true,
        status: enumValue(branch.status || 'active', BRANCH_STATUSES, 'branch.status'),
      }));
      if (new Set(normalizedBranches.map(branch => branch.id)).size !== normalizedBranches.length) {
        fail('PLATFORM_IDENTITY_DUPLICATE_BRANCH', 'Branch IDs must be globally unique.');
      }
      if (normalizedBranches.filter(branch => branch.isHeadOffice && branch.status === 'active').length !== 1) {
        fail('PLATFORM_IDENTITY_HEAD_OFFICE_INVALID', 'Exactly one active Head Office is required.');
      }
      db.prepare(`
        INSERT INTO ${CANONICAL_COMPANIES_TABLE} (
          id, receivablesTimezone, createdAt, displayName, status, version, updatedAt
        ) VALUES (?, ?, ?, ?, 'inactive', 1, ?)
      `).run(companyId, receivablesTimezone, timestamp, displayName, timestamp);
      const insertBranch = db.prepare(`
        INSERT INTO ${CANONICAL_BRANCHES_TABLE} (
          companyId, id, isHeadOffice, createdAt, displayName, status, version, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `);
      for (const branch of normalizedBranches) {
        insertBranch.run(
          companyId,
          branch.id,
          branch.isHeadOffice ? 1 : 0,
          timestamp,
          branch.displayName,
          branch.status,
          timestamp,
        );
      }
      db.prepare(`
        UPDATE ${CANONICAL_COMPANIES_TABLE}
        SET status = 'active', version = 2, updatedAt = ?
        WHERE id = ? AND version = 1
      `).run(timestamp, companyId);
      const created = getCompany(companyId);
      insertAuditRow({
        companyId,
        validatedActor,
        action: 'company.authority.created',
        targetType: 'company',
        targetId: companyId,
        reasonCode: reason,
        after: created,
        capabilityCatalogVersion: 1,
      });
      for (const branch of normalizedBranches) {
        insertAuditRow({
          companyId,
          branchId: branch.id,
          validatedActor,
          action: 'branch.created',
          targetType: 'branch',
          targetId: branch.id,
          reasonCode: reason,
          after: branch,
          capabilityCatalogVersion: 1,
        });
      }
      return Object.freeze({
        company: created,
        branches: listBranches(companyId),
      });
    });
  }

  function createRoleTemplate(input = {}) {
    return transactionImmediate(() => {
      const companyId = requiredId(input.companyId, 'companyId');
      requireActiveCompany(companyId);
      const validatedActor = resolveTrustedActor(input.actorContext, companyId, {
        allowWithoutMembership: true,
      });
      const catalog = requireActiveCatalog();
      const templateKey = requiredId(input.templateKey, 'templateKey');
      const templateVersion = requiredVersion(input.templateVersion, 'templateVersion');
      const displayName = requiredText(input.displayName, 'displayName');
      const reason = requiredText(input.reason, 'reason');
      const capabilities = sortedUnique(
        input.capabilities,
        value => requireCatalogCapability(catalog.version, value, { grant: true }).capabilityKey,
      );
      const timestamp = input.timestamp || nowIso();
      db.prepare(`
        INSERT INTO ${ROLE_TEMPLATES_TABLE} (
          companyId, templateKey, templateVersion, catalogVersion, displayName,
          status, createdAt, updatedAt, createdBy, reason
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
      `).run(
        companyId,
        templateKey,
        templateVersion,
        catalog.version,
        displayName,
        timestamp,
        timestamp,
        validatedActor.principalId,
        reason,
      );
      const insertCapability = db.prepare(`
        INSERT INTO ${ROLE_TEMPLATE_CAPABILITIES_TABLE} (
          companyId, templateKey, templateVersion, catalogVersion,
          capabilityKey, createdAt, createdBy
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const capabilityKey of capabilities) {
        insertCapability.run(
          companyId,
          templateKey,
          templateVersion,
          catalog.version,
          capabilityKey,
          timestamp,
          validatedActor.principalId,
        );
      }
      const template = getRoleTemplate(companyId, templateKey, templateVersion);
      insertAuditRow({
        companyId,
        validatedActor,
        action: 'role_template.created',
        targetType: 'role_template',
        targetId: `${templateKey}:v${templateVersion}`,
        reasonCode: reason,
        after: { ...template, capabilities },
        capabilityCatalogVersion: catalog.version,
      });
      return Object.freeze({ ...template, capabilities: Object.freeze(capabilities) });
    });
  }

  function createBranch(input = {}) {
    return transactionImmediate(() => {
      const companyId = requiredId(input.companyId, 'companyId');
      requireActiveCompany(companyId);
      const branchId = assertBranchId(input.id, 'id');
      const displayName = requiredText(input.displayName, 'displayName');
      const status = enumValue(input.status || 'active', BRANCH_STATUSES, 'status');
      if (input.isHeadOffice === true) {
        fail('PLATFORM_IDENTITY_HEAD_OFFICE_IMMUTABLE', 'Head Office is established with company authority.');
      }
      const validatedActor = resolveTrustedActor(input.actorContext, companyId);
      const reason = requiredText(input.reason, 'reason');
      const timestamp = input.timestamp || nowIso();
      db.prepare(`
        INSERT INTO ${CANONICAL_BRANCHES_TABLE} (
          companyId, id, isHeadOffice, createdAt, displayName, status, version, updatedAt
        ) VALUES (?, ?, 0, ?, ?, ?, 1, ?)
      `).run(companyId, branchId, timestamp, displayName, status, timestamp);
      const branch = db.prepare(`
        SELECT *
        FROM ${CANONICAL_BRANCHES_TABLE}
        WHERE companyId = ? AND id = ?
      `).get(companyId, branchId);
      insertAuditRow({
        companyId,
        branchId,
        validatedActor,
        action: 'branch.created',
        targetType: 'branch',
        targetId: branchId,
        reasonCode: reason,
        after: branch,
        capabilityCatalogVersion: 1,
      });
      return Object.freeze({ ...branch });
    });
  }

  function updateCompany(input = {}) {
    return transactionImmediate(() => {
      const companyId = requiredId(input.companyId, 'companyId');
      const expectedVersion = requiredVersion(input.expectedVersion, 'expectedVersion');
      const company = getCompany(companyId);
      if (!company || Number(company.version) !== expectedVersion) {
        fail('PLATFORM_IDENTITY_STALE_VERSION', 'Company version is stale.');
      }
      const validatedActor = resolveTrustedActor(input.actorContext, companyId);
      const reason = requiredText(input.reason, 'reason');
      const displayName = input.displayName === undefined
        ? company.displayName
        : requiredText(input.displayName, 'displayName');
      const receivablesTimezone = input.receivablesTimezone === undefined
        ? company.receivablesTimezone
        : assertIanaTimezone(input.receivablesTimezone);
      const status = input.status === undefined
        ? company.status
        : enumValue(input.status, COMPANY_STATUSES, 'status');
      if (status === 'active') {
        assertIanaTimezone(receivablesTimezone);
        requireActiveHeadOffice(companyId);
      }
      const timestamp = input.timestamp || nowIso();
      const result = db.prepare(`
        UPDATE ${CANONICAL_COMPANIES_TABLE}
        SET displayName = ?,
            receivablesTimezone = ?,
            status = ?,
            version = version + 1,
            updatedAt = ?
        WHERE id = ? AND version = ?
      `).run(
        displayName,
        receivablesTimezone,
        status,
        timestamp,
        companyId,
        expectedVersion,
      );
      if (result.changes !== 1) {
        fail('PLATFORM_IDENTITY_STALE_VERSION', 'Company version is stale.');
      }
      const updated = getCompany(companyId);
      insertAuditRow({
        companyId,
        validatedActor,
        action: 'company.updated',
        targetType: 'company',
        targetId: companyId,
        reasonCode: reason,
        before: company,
        after: updated,
        capabilityCatalogVersion: 1,
      });
      return Object.freeze({ ...updated });
    });
  }

  function updateBranch(input = {}) {
    return transactionImmediate(() => {
      const companyId = requiredId(input.companyId, 'companyId');
      const branchId = assertBranchId(input.branchId);
      const expectedVersion = requiredVersion(input.expectedVersion, 'expectedVersion');
      const branch = db.prepare(`
        SELECT *
        FROM ${CANONICAL_BRANCHES_TABLE}
        WHERE companyId = ? AND id = ?
      `).get(companyId, branchId);
      if (!branch || Number(branch.version) !== expectedVersion) {
        fail('PLATFORM_IDENTITY_STALE_VERSION', 'Branch version is stale.');
      }
      const validatedActor = resolveTrustedActor(input.actorContext, companyId);
      const reason = requiredText(input.reason, 'reason');
      const displayName = input.displayName === undefined
        ? branch.displayName
        : requiredText(input.displayName, 'displayName');
      const status = input.status === undefined
        ? branch.status
        : enumValue(input.status, BRANCH_STATUSES, 'status');
      const timestamp = input.timestamp || nowIso();
      const result = db.prepare(`
        UPDATE ${CANONICAL_BRANCHES_TABLE}
        SET displayName = ?,
            status = ?,
            version = version + 1,
            updatedAt = ?
        WHERE companyId = ? AND id = ? AND version = ?
      `).run(
        displayName,
        status,
        timestamp,
        companyId,
        branchId,
        expectedVersion,
      );
      if (result.changes !== 1) {
        fail('PLATFORM_IDENTITY_STALE_VERSION', 'Branch version is stale.');
      }
      const updated = db.prepare(`
        SELECT *
        FROM ${CANONICAL_BRANCHES_TABLE}
        WHERE companyId = ? AND id = ?
      `).get(companyId, branchId);
      insertAuditRow({
        companyId,
        branchId,
        validatedActor,
        action: 'branch.updated',
        targetType: 'branch',
        targetId: branchId,
        reasonCode: reason,
        before: branch,
        after: updated,
        capabilityCatalogVersion: 1,
      });
      return Object.freeze({ ...updated });
    });
  }

  function createMembership(input = {}) {
    return transactionImmediate(() => {
      const companyId = requiredId(input.companyId, 'companyId');
      requireActiveCompany(companyId);
      const validatedActor = resolveTrustedActor(input.actorContext, companyId, {
        allowWithoutMembership: true,
      });
      const catalog = requireActiveCatalog();
      const membershipId = requiredId(input.id, 'id');
      const principalId = requiredId(input.principalId, 'principalId');
      const status = enumValue(input.status || 'pending', MEMBERSHIP_STATUSES, 'status');
      const roleTemplateKey = requiredId(input.roleTemplateKey, 'roleTemplateKey');
      const roleTemplateVersion = requiredVersion(input.roleTemplateVersion, 'roleTemplateVersion');
      const companyWide = input.companyWideBranchAuthority === undefined
        ? false
        : booleanValue(input.companyWideBranchAuthority, 'companyWideBranchAuthority');
      const reason = requiredText(input.reason, 'reason');
      const timestamp = input.timestamp || nowIso();
      const template = getRoleTemplate(companyId, roleTemplateKey, roleTemplateVersion);
      if (
        !template
        || template.status !== 'active'
        || Number(template.catalogVersion) !== Number(catalog.version)
      ) {
        fail('PLATFORM_IDENTITY_TEMPLATE_INVALID', 'An exact active role template is required.');
      }
      const branchIds = sortedUnique(input.branchIds, value => assertBranchId(value));
      if (companyWide && branchIds.length > 0) {
        fail('PLATFORM_IDENTITY_BRANCH_MODE_CONFLICT', 'Company-wide membership cannot include explicit branches.');
      }
      if (!companyWide && status === 'active' && branchIds.length === 0) {
        fail('PLATFORM_IDENTITY_EMPTY_BRANCH_SCOPE', 'Active explicit membership requires branch access.');
      }
      assertMembershipCapabilityCompatibility({
        companyId,
        roleTemplateKey,
        roleTemplateVersion,
        companyWideBranchAuthority: companyWide ? 1 : 0,
      }, {
        assignments: input.capabilityAssignments || [],
      });
      db.prepare(`
        INSERT INTO ${COMPANY_MEMBERSHIPS_TABLE} (
          id, companyId, principalId, status, roleTemplateKey, roleTemplateVersion,
          companyWideBranchAuthority, version, createdAt, updatedAt, activatedAt,
          inactivatedAt, revokedAt, createdBy, updatedBy, revokedBy, reason
        ) VALUES (
          @id, @companyId, @principalId, @status, @roleTemplateKey, @roleTemplateVersion,
          @companyWideBranchAuthority, 1, @createdAt, @updatedAt, @activatedAt,
          @inactivatedAt, @revokedAt, @createdBy, @updatedBy, @revokedBy, @reason
        )
      `).run({
        id: membershipId,
        companyId,
        principalId,
        status,
        roleTemplateKey,
        roleTemplateVersion,
        companyWideBranchAuthority: companyWide ? 1 : 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        activatedAt: status === 'active' ? timestamp : null,
        inactivatedAt: status === 'inactive' ? timestamp : null,
        revokedAt: status === 'revoked' ? timestamp : null,
        createdBy: validatedActor.principalId,
        updatedBy: validatedActor.principalId,
        revokedBy: status === 'revoked' ? validatedActor.principalId : null,
        reason,
      });
      let membership = getMembership(membershipId);
      insertAuditRow({
        companyId,
        validatedActor,
        action: 'membership.created',
        targetType: 'membership',
        targetId: membershipId,
        reasonCode: reason,
        after: membership,
        capabilityCatalogVersion: catalog.version,
      });
      for (const branchId of branchIds) {
        membership = grantBranchAccessInternal({
          membership,
          branchId,
          validatedActor,
          reason,
          timestamp,
          audit: true,
        });
      }
      for (const assignment of input.capabilityAssignments || []) {
        membership = assignCapabilityInternal({
          membership,
          capabilityKey: assignment.capabilityKey,
          effect: assignment.effect,
          validatedActor,
          reason,
          timestamp,
          audit: true,
        });
      }
      return Object.freeze({ ...membership });
    });
  }

  function grantBranchAccessInternal({
    membership,
    branchId,
    validatedActor,
    reason,
    timestamp,
    audit,
  }) {
    if (!membership || membership.status === 'revoked') {
      fail('PLATFORM_IDENTITY_MEMBERSHIP_INVALID', 'A non-revoked membership is required.');
    }
    if (membership.companyWideBranchAuthority === 1) {
      fail('PLATFORM_IDENTITY_BRANCH_MODE_CONFLICT', 'Company-wide membership cannot have explicit grants.');
    }
    const normalizedBranchId = assertBranchId(branchId);
    const branch = db.prepare(`
      SELECT *
      FROM ${CANONICAL_BRANCHES_TABLE}
      WHERE companyId = ? AND id = ? AND status = 'active'
    `).get(membership.companyId, normalizedBranchId);
    if (!branch) {
      fail('PLATFORM_IDENTITY_BRANCH_SCOPE_REJECTED', 'Branch is unavailable in the membership company.');
    }
    const active = db.prepare(`
      SELECT 1
      FROM ${MEMBERSHIP_BRANCH_ACCESS_TABLE}
      WHERE membershipId = ? AND branchId = ? AND status = 'active'
    `).get(membership.id, normalizedBranchId);
    if (active) {
      fail('PLATFORM_IDENTITY_DUPLICATE_BRANCH_GRANT', 'An active branch grant already exists.');
    }
    const grantId = generateId('membership-branch');
    db.prepare(`
      INSERT INTO ${MEMBERSHIP_BRANCH_ACCESS_TABLE} (
        id, membershipId, companyId, branchId, status, version,
        grantedAt, grantedBy, revokedAt, revokedBy, reason
      ) VALUES (?, ?, ?, ?, 'active', 1, ?, ?, NULL, NULL, ?)
    `).run(
      grantId,
      membership.id,
      membership.companyId,
      normalizedBranchId,
      timestamp,
      validatedActor.principalId,
      reason,
    );
    const updated = bumpMembership(
      membership.id,
      Number(membership.version),
      validatedActor.principalId,
      reason,
      timestamp,
    );
    if (audit) {
      insertAuditRow({
        companyId: membership.companyId,
        branchId: normalizedBranchId,
        validatedActor,
        action: 'membership_branch.granted',
        targetType: 'membership_branch_access',
        targetId: grantId,
        reasonCode: reason,
        after: { membershipId: membership.id, branchId: normalizedBranchId, status: 'active' },
        capabilityCatalogVersion: 1,
      });
    }
    return updated;
  }

  function grantBranchAccess(input = {}) {
    return transactionImmediate(() => {
      const membership = getMembership(input.membershipId);
      if (!membership || Number(membership.version) !== requiredVersion(input.expectedMembershipVersion, 'expectedMembershipVersion')) {
        fail('PLATFORM_IDENTITY_STALE_VERSION', 'Membership version is stale.');
      }
      const validatedActor = resolveTrustedActor(input.actorContext, membership.companyId);
      const updated = grantBranchAccessInternal({
        membership,
        branchId: input.branchId,
        validatedActor,
        reason: requiredText(input.reason, 'reason'),
        timestamp: input.timestamp || nowIso(),
        audit: true,
      });
      return Object.freeze({ ...updated });
    });
  }

  function revokeBranchAccess(input = {}) {
    return transactionImmediate(() => {
      const membership = getMembership(input.membershipId);
      if (!membership || Number(membership.version) !== requiredVersion(input.expectedMembershipVersion, 'expectedMembershipVersion')) {
        fail('PLATFORM_IDENTITY_STALE_VERSION', 'Membership version is stale.');
      }
      const validatedActor = resolveTrustedActor(input.actorContext, membership.companyId);
      const reason = requiredText(input.reason, 'reason');
      const branchId = assertBranchId(input.branchId);
      const grant = db.prepare(`
        SELECT *
        FROM ${MEMBERSHIP_BRANCH_ACCESS_TABLE}
        WHERE membershipId = ? AND branchId = ? AND status = 'active'
      `).get(membership.id, branchId);
      if (!grant) {
        fail('PLATFORM_IDENTITY_BRANCH_GRANT_NOT_FOUND', 'Active branch grant was not found.');
      }
      if (membership.status === 'active' && membership.companyWideBranchAuthority === 0) {
        const activeCount = Number(db.prepare(`
          SELECT COUNT(*) AS count
          FROM ${MEMBERSHIP_BRANCH_ACCESS_TABLE}
          WHERE membershipId = ? AND status = 'active'
        `).get(membership.id).count);
        if (activeCount <= 1) {
          fail('PLATFORM_IDENTITY_EMPTY_BRANCH_SCOPE', 'Active membership cannot lose its final branch grant.');
        }
      }
      const timestamp = input.timestamp || nowIso();
      db.prepare(`
        UPDATE ${MEMBERSHIP_BRANCH_ACCESS_TABLE}
        SET status = 'revoked',
            version = version + 1,
            revokedAt = ?,
            revokedBy = ?,
            reason = ?
        WHERE id = ? AND version = ?
      `).run(timestamp, validatedActor.principalId, reason, grant.id, grant.version);
      const updated = bumpMembership(
        membership.id,
        Number(membership.version),
        validatedActor.principalId,
        reason,
        timestamp,
      );
      insertAuditRow({
        companyId: membership.companyId,
        branchId,
        validatedActor,
        action: 'membership_branch.revoked',
        targetType: 'membership_branch_access',
        targetId: grant.id,
        reasonCode: reason,
        before: grant,
        after: { ...grant, status: 'revoked', version: grant.version + 1 },
        capabilityCatalogVersion: 1,
      });
      return Object.freeze({ ...updated });
    });
  }

  function assignCapabilityInternal({
    membership,
    capabilityKey,
    effect,
    validatedActor,
    reason,
    timestamp,
    audit,
  }) {
    if (!membership || membership.status === 'revoked') {
      fail('PLATFORM_IDENTITY_MEMBERSHIP_INVALID', 'A non-revoked membership is required.');
    }
    const template = requireActiveTemplate(membership);
    const normalizedEffect = enumValue(effect, ASSIGNMENT_EFFECTS, 'effect');
    const capability = requireCatalogCapability(
      template.catalogVersion,
      capabilityKey,
      { grant: normalizedEffect === 'grant' },
    );
    if (
      normalizedEffect === 'grant'
      && membership.companyWideBranchAuthority !== 1
      && COMPANY_SCOPED_CAPABILITIES.has(capability.capabilityKey)
    ) {
      fail(
        'PLATFORM_IDENTITY_COMPANY_CAPABILITY_SCOPE_CONFLICT',
        'Company-scoped grants require company-wide branch authority.',
      );
    }
    const active = db.prepare(`
      SELECT *
      FROM ${MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE}
      WHERE membershipId = ? AND capabilityKey = ? AND status = 'active'
    `).get(membership.id, capability.capabilityKey);
    if (active) {
      fail('PLATFORM_IDENTITY_CAPABILITY_CONFLICT', 'An active assignment already exists for this capability.');
    }
    const assignmentId = generateId('membership-capability');
    db.prepare(`
      INSERT INTO ${MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE} (
        id, membershipId, companyId, catalogVersion, capabilityKey, effect,
        status, version, grantedAt, grantedBy, revokedAt, revokedBy, reason
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, NULL, NULL, ?)
    `).run(
      assignmentId,
      membership.id,
      membership.companyId,
      template.catalogVersion,
      capability.capabilityKey,
      normalizedEffect,
      timestamp,
      validatedActor.principalId,
      reason,
    );
    const updated = bumpMembership(
      membership.id,
      Number(membership.version),
      validatedActor.principalId,
      reason,
      timestamp,
    );
    if (audit) {
      insertAuditRow({
        companyId: membership.companyId,
        validatedActor,
        action: 'membership_capability.assigned',
        targetType: 'membership_capability_assignment',
        targetId: assignmentId,
        capabilityKey: capability.capabilityKey,
        reasonCode: reason,
        after: {
          membershipId: membership.id,
          capabilityKey: capability.capabilityKey,
          effect: normalizedEffect,
          status: 'active',
        },
        capabilityCatalogVersion: template.catalogVersion,
      });
    }
    return updated;
  }

  function assignCapability(input = {}) {
    return transactionImmediate(() => {
      const membership = getMembership(input.membershipId);
      if (!membership || Number(membership.version) !== requiredVersion(input.expectedMembershipVersion, 'expectedMembershipVersion')) {
        fail('PLATFORM_IDENTITY_STALE_VERSION', 'Membership version is stale.');
      }
      const validatedActor = resolveTrustedActor(input.actorContext, membership.companyId);
      const updated = assignCapabilityInternal({
        membership,
        capabilityKey: input.capabilityKey,
        effect: input.effect,
        validatedActor,
        reason: requiredText(input.reason, 'reason'),
        timestamp: input.timestamp || nowIso(),
        audit: true,
      });
      return Object.freeze({ ...updated });
    });
  }

  function revokeCapabilityAssignment(input = {}) {
    return transactionImmediate(() => {
      const membership = getMembership(input.membershipId);
      if (!membership || Number(membership.version) !== requiredVersion(input.expectedMembershipVersion, 'expectedMembershipVersion')) {
        fail('PLATFORM_IDENTITY_STALE_VERSION', 'Membership version is stale.');
      }
      const validatedActor = resolveTrustedActor(input.actorContext, membership.companyId);
      const reason = requiredText(input.reason, 'reason');
      const capabilityKey = requiredId(input.capabilityKey, 'capabilityKey');
      const assignment = db.prepare(`
        SELECT *
        FROM ${MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE}
        WHERE membershipId = ? AND capabilityKey = ? AND status = 'active'
      `).get(membership.id, capabilityKey);
      if (!assignment) {
        fail('PLATFORM_IDENTITY_CAPABILITY_ASSIGNMENT_NOT_FOUND', 'Active capability assignment was not found.');
      }
      const timestamp = input.timestamp || nowIso();
      db.prepare(`
        UPDATE ${MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE}
        SET status = 'revoked',
            version = version + 1,
            revokedAt = ?,
            revokedBy = ?,
            reason = ?
        WHERE id = ? AND version = ?
      `).run(timestamp, validatedActor.principalId, reason, assignment.id, assignment.version);
      const updated = bumpMembership(
        membership.id,
        Number(membership.version),
        validatedActor.principalId,
        reason,
        timestamp,
      );
      insertAuditRow({
        companyId: membership.companyId,
        validatedActor,
        action: 'membership_capability.revoked',
        targetType: 'membership_capability_assignment',
        targetId: assignment.id,
        capabilityKey,
        reasonCode: reason,
        before: assignment,
        after: { ...assignment, status: 'revoked', version: assignment.version + 1 },
        capabilityCatalogVersion: assignment.catalogVersion,
      });
      return Object.freeze({ ...updated });
    });
  }

  function updateMembership(input = {}) {
    return transactionImmediate(() => {
      const membership = getMembership(input.membershipId);
      const expectedVersion = requiredVersion(input.expectedVersion, 'expectedVersion');
      if (!membership || Number(membership.version) !== expectedVersion) {
        fail('PLATFORM_IDENTITY_STALE_VERSION', 'Membership version is stale.');
      }
      if (membership.status === 'revoked') {
        fail('PLATFORM_IDENTITY_MEMBERSHIP_REVOKED', 'Revoked membership is terminal.');
      }
      const validatedActor = resolveTrustedActor(input.actorContext, membership.companyId);
      const reason = requiredText(input.reason, 'reason');
      const nextStatus = input.status === undefined
        ? membership.status
        : enumValue(input.status, MEMBERSHIP_STATUSES, 'status');
      const roleTemplateKey = input.roleTemplateKey === undefined
        ? membership.roleTemplateKey
        : requiredId(input.roleTemplateKey, 'roleTemplateKey');
      const roleTemplateVersion = input.roleTemplateVersion === undefined
        ? Number(membership.roleTemplateVersion)
        : requiredVersion(input.roleTemplateVersion, 'roleTemplateVersion');
      const companyWide = input.companyWideBranchAuthority === undefined
        ? membership.companyWideBranchAuthority === 1
        : booleanValue(input.companyWideBranchAuthority, 'companyWideBranchAuthority');
      requireActiveTemplate({
        ...membership,
        roleTemplateKey,
        roleTemplateVersion,
      });
      const activeGrants = listBranchAccess(membership.id, { status: 'active' });
      if (companyWide && activeGrants.length > 0) {
        fail('PLATFORM_IDENTITY_BRANCH_MODE_CONFLICT', 'Company-wide authority cannot have active explicit grants.');
      }
      if (!companyWide && nextStatus === 'active' && activeGrants.length === 0) {
        fail('PLATFORM_IDENTITY_EMPTY_BRANCH_SCOPE', 'Active explicit membership requires branch access.');
      }
      assertMembershipCapabilityCompatibility({
        ...membership,
        roleTemplateKey,
        roleTemplateVersion,
        companyWideBranchAuthority: companyWide ? 1 : 0,
      });
      const timestamp = input.timestamp || nowIso();
      const result = db.prepare(`
        UPDATE ${COMPANY_MEMBERSHIPS_TABLE}
        SET status = @status,
            roleTemplateKey = @roleTemplateKey,
            roleTemplateVersion = @roleTemplateVersion,
            companyWideBranchAuthority = @companyWideBranchAuthority,
            version = version + 1,
            updatedAt = @updatedAt,
            activatedAt = @activatedAt,
            inactivatedAt = @inactivatedAt,
            revokedAt = @revokedAt,
            updatedBy = @updatedBy,
            revokedBy = @revokedBy,
            reason = @reason
        WHERE id = @id AND version = @expectedVersion
      `).run({
        id: membership.id,
        expectedVersion,
        status: nextStatus,
        roleTemplateKey,
        roleTemplateVersion,
        companyWideBranchAuthority: companyWide ? 1 : 0,
        updatedAt: timestamp,
        activatedAt: nextStatus === 'active'
          ? membership.activatedAt || timestamp
          : membership.activatedAt,
        inactivatedAt: nextStatus === 'inactive' ? timestamp : membership.inactivatedAt,
        revokedAt: nextStatus === 'revoked' ? timestamp : null,
        updatedBy: validatedActor.principalId,
        revokedBy: nextStatus === 'revoked' ? validatedActor.principalId : null,
        reason,
      });
      if (result.changes !== 1) {
        fail('PLATFORM_IDENTITY_STALE_VERSION', 'Membership version is stale.');
      }
      const updated = getMembership(membership.id);
      assertExplicitBranchMode(updated);
      insertAuditRow({
        companyId: membership.companyId,
        validatedActor,
        action: 'membership.updated',
        targetType: 'membership',
        targetId: membership.id,
        reasonCode: reason,
        before: membership,
        after: updated,
        capabilityCatalogVersion: requireActiveCatalog().version,
      });
      return Object.freeze({ ...updated });
    });
  }

  function applyBootstrapPlan(plan = {}) {
    const configChecksum = requiredText(plan.configChecksum, 'configChecksum');
    if (!/^[a-f0-9]{64}$/.test(configChecksum)) {
      fail('PLATFORM_IDENTITY_BOOTSTRAP_CHECKSUM_INVALID', 'Bootstrap checksum must be SHA-256.');
    }

    return transactionImmediate(() => {
      assertPlatformIdentityStructure(db);
      for (const table of FINANCIAL_TABLES) {
        const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
        if (count !== 0) {
          fail(
            'PLATFORM_IDENTITY_FINANCIAL_ROWS_PRESENT',
            `Bootstrap requires ${table} to remain empty.`,
          );
        }
      }
      if (typeof options.beforeBootstrapApply === 'function') {
        options.beforeBootstrapApply(plan);
      }
      const approval = plan.approval || {};
      const companyId = requiredId(plan.company?.id, 'company.id');
      const actorContext = createTrustedUserActorContext({
        principalId: approval.approvedBy,
        correlationId: plan.correlationId,
      });
      const validatedActor = resolveTrustedActor(actorContext, companyId, {
        allowWithoutMembership: true,
        allowWithoutMembershipAfterProvisioning: true,
      });
      const duplicate = db.prepare(`
        SELECT *
        FROM ${IDENTITY_BOOTSTRAP_RUNS_TABLE}
        WHERE configChecksum = ? AND status = 'succeeded'
      `).get(configChecksum);
      if (duplicate) return Object.freeze({ status: 'noop', run: duplicate });

      const companyRows = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${CANONICAL_COMPANIES_TABLE}`).get().count);
      const branchRows = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${CANONICAL_BRANCHES_TABLE}`).get().count);
      const authorityRows = [
        COMPANY_MEMBERSHIPS_TABLE,
        MEMBERSHIP_BRANCH_ACCESS_TABLE,
        ROLE_TEMPLATES_TABLE,
        ROLE_TEMPLATE_CAPABILITIES_TABLE,
        MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE,
        AUTHORIZATION_AUDIT_EVENTS_TABLE,
        IDENTITY_BOOTSTRAP_RUNS_TABLE,
      ].reduce(
        (total, table) => total + Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
        0,
      );
      if (companyRows !== 0 || branchRows !== 0 || authorityRows !== 0) {
        fail('PLATFORM_IDENTITY_BOOTSTRAP_NOT_EMPTY', 'Bootstrap apply requires an empty identity authority.');
      }

      const reason = requiredText(approval.approvalReference, 'approval.approvalReference');
      const timestamp = plan.startedAt || nowIso();
      const companyResult = createCompanyAuthorityInternal({
        company: plan.company,
        branches: plan.branches,
        validatedActor,
        reason,
        timestamp,
      });
      for (const template of plan.roleTemplates || []) {
        createRoleTemplateInternal({
          companyId: companyResult.company.id,
          ...template,
          validatedActor,
          reason,
          timestamp,
        });
      }
      for (const membership of plan.memberships || []) {
        createMembershipInternal({
          companyId: companyResult.company.id,
          ...membership,
          validatedActor,
          reason,
          timestamp,
        });
      }
      const completedAt = plan.completedAt || nowIso();
      const run = {
        id: requiredId(plan.runId || generateId('identity-bootstrap'), 'runId'),
        configVersion: requiredVersion(plan.configVersion, 'configVersion'),
        configChecksum,
        schemaFingerprint: requiredText(plan.schemaFingerprint, 'schemaFingerprint'),
        mode: 'apply',
        status: 'succeeded',
        approvedBy: validatedActor.principalId,
        approvedAt: requiredText(approval.approvedAt, 'approval.approvedAt'),
        approvalReference: reason,
        backupReference: requiredText(approval.backupReference, 'approval.backupReference'),
        startedAt: timestamp,
        completedAt,
        createdAt: completedAt,
        summaryJson: auditJson(plan.summary || {}),
        errorCode: null,
        errorSummary: null,
      };
      db.prepare(`
        INSERT INTO ${IDENTITY_BOOTSTRAP_RUNS_TABLE} (
          id, configVersion, configChecksum, schemaFingerprint, mode, status,
          approvedBy, approvedAt, approvalReference, backupReference,
          startedAt, completedAt, createdAt, summaryJson, errorCode, errorSummary
        ) VALUES (
          @id, @configVersion, @configChecksum, @schemaFingerprint, @mode, @status,
          @approvedBy, @approvedAt, @approvalReference, @backupReference,
          @startedAt, @completedAt, @createdAt, @summaryJson, @errorCode, @errorSummary
        )
      `).run(run);
      return Object.freeze({ status: 'succeeded', run: Object.freeze({ ...run }) });
    });
  }

  function createCompanyAuthorityInternal(input) {
    const company = input.company || {};
    const companyId = requiredId(company.id, 'company.id');
    const displayName = requiredText(company.displayName, 'company.displayName');
    const timezone = assertIanaTimezone(company.receivablesTimezone);
    const branches = (input.branches || []).map(branch => ({
      id: assertBranchId(branch.id),
      displayName: requiredText(branch.displayName, 'branch.displayName'),
      isHeadOffice: branch.isHeadOffice === true,
      status: enumValue(branch.status || 'active', BRANCH_STATUSES, 'branch.status'),
    }));
    if (branches.length === 0 || new Set(branches.map(branch => branch.id)).size !== branches.length) {
      fail('PLATFORM_IDENTITY_DUPLICATE_BRANCH', 'Bootstrap branches must be non-empty and globally unique.');
    }
    if (branches.filter(branch => branch.isHeadOffice && branch.status === 'active').length !== 1) {
      fail('PLATFORM_IDENTITY_HEAD_OFFICE_INVALID', 'Exactly one active Head Office is required.');
    }
    db.prepare(`
      INSERT INTO ${CANONICAL_COMPANIES_TABLE} (
        id, receivablesTimezone, createdAt, displayName, status, version, updatedAt
      ) VALUES (?, ?, ?, ?, 'inactive', 1, ?)
    `).run(companyId, timezone, input.timestamp, displayName, input.timestamp);
    const insertBranch = db.prepare(`
      INSERT INTO ${CANONICAL_BRANCHES_TABLE} (
        companyId, id, isHeadOffice, createdAt, displayName, status, version, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `);
    for (const branch of branches) {
      insertBranch.run(
        companyId,
        branch.id,
        branch.isHeadOffice ? 1 : 0,
        input.timestamp,
        branch.displayName,
        branch.status,
        input.timestamp,
      );
    }
    db.prepare(`
      UPDATE ${CANONICAL_COMPANIES_TABLE}
      SET status = 'active', version = 2, updatedAt = ?
      WHERE id = ? AND version = 1
    `).run(input.timestamp, companyId);
    const created = getCompany(companyId);
    insertAuditRow({
      companyId,
      validatedActor: input.validatedActor,
      action: 'company.authority.created',
      targetType: 'company',
      targetId: companyId,
      reasonCode: input.reason,
      after: created,
      capabilityCatalogVersion: 1,
    });
    for (const branch of branches) {
      insertAuditRow({
        companyId,
        branchId: branch.id,
        validatedActor: input.validatedActor,
        action: 'branch.created',
        targetType: 'branch',
        targetId: branch.id,
        reasonCode: input.reason,
        after: branch,
        capabilityCatalogVersion: 1,
      });
    }
    return { company: created, branches };
  }

  function createRoleTemplateInternal(input) {
    const catalog = requireActiveCatalog();
    const capabilities = sortedUnique(
      input.capabilities,
      value => requireCatalogCapability(catalog.version, value, { grant: true }).capabilityKey,
    );
    const templateKey = requiredId(input.templateKey, 'templateKey');
    const templateVersion = requiredVersion(input.templateVersion, 'templateVersion');
    db.prepare(`
      INSERT INTO ${ROLE_TEMPLATES_TABLE} (
        companyId, templateKey, templateVersion, catalogVersion, displayName,
        status, createdAt, updatedAt, createdBy, reason
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `).run(
      input.companyId,
      templateKey,
      templateVersion,
      catalog.version,
      requiredText(input.displayName, 'displayName'),
      input.timestamp,
      input.timestamp,
      input.validatedActor.principalId,
      input.reason,
    );
    const insertCapability = db.prepare(`
      INSERT INTO ${ROLE_TEMPLATE_CAPABILITIES_TABLE} (
        companyId, templateKey, templateVersion, catalogVersion,
        capabilityKey, createdAt, createdBy
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    capabilities.forEach(capabilityKey => insertCapability.run(
      input.companyId,
      templateKey,
      templateVersion,
      catalog.version,
      capabilityKey,
      input.timestamp,
      input.validatedActor.principalId,
    ));
    insertAuditRow({
      companyId: input.companyId,
      validatedActor: input.validatedActor,
      action: 'role_template.created',
      targetType: 'role_template',
      targetId: `${templateKey}:v${templateVersion}`,
      reasonCode: input.reason,
      after: { templateKey, templateVersion, capabilities },
      capabilityCatalogVersion: catalog.version,
    });
  }

  function createMembershipInternal(input) {
    const membership = createMembershipRecord(input);
    let current = membership;
    for (const branchId of input.branchIds || []) {
      current = grantBranchAccessInternal({
        membership: current,
        branchId,
        validatedActor: input.validatedActor,
        reason: input.reason,
        timestamp: input.timestamp,
        audit: true,
      });
    }
    for (const assignment of input.capabilityAssignments || []) {
      current = assignCapabilityInternal({
        membership: current,
        capabilityKey: assignment.capabilityKey,
        effect: assignment.effect,
        validatedActor: input.validatedActor,
        reason: input.reason,
        timestamp: input.timestamp,
        audit: true,
      });
    }
    return current;
  }

  function createMembershipRecord(input) {
    const catalog = requireActiveCatalog();
    const id = requiredId(input.id, 'membership.id');
    const principalId = requiredId(input.principalId, 'membership.principalId');
    const status = enumValue(input.status || 'active', MEMBERSHIP_STATUSES, 'membership.status');
    const roleTemplateKey = requiredId(input.roleTemplateKey, 'membership.roleTemplateKey');
    const roleTemplateVersion = requiredVersion(
      input.roleTemplateVersion,
      'membership.roleTemplateVersion',
    );
    const companyWide = input.companyWideBranchAuthority === true;
    const branchIds = sortedUnique(input.branchIds, value => assertBranchId(value));
    if (companyWide && branchIds.length > 0) {
      fail('PLATFORM_IDENTITY_BRANCH_MODE_CONFLICT', 'Company-wide membership cannot include explicit branches.');
    }
    if (!companyWide && status === 'active' && branchIds.length === 0) {
      fail('PLATFORM_IDENTITY_EMPTY_BRANCH_SCOPE', 'Active explicit membership requires a branch grant.');
    }
    const template = getRoleTemplate(input.companyId, roleTemplateKey, roleTemplateVersion);
    if (
      !template
      || template.status !== 'active'
      || Number(template.catalogVersion) !== Number(catalog.version)
    ) {
      fail('PLATFORM_IDENTITY_TEMPLATE_INVALID', 'An exact active role template is required.');
    }
    assertMembershipCapabilityCompatibility({
      companyId: input.companyId,
      roleTemplateKey,
      roleTemplateVersion,
      companyWideBranchAuthority: companyWide ? 1 : 0,
    }, {
      assignments: input.capabilityAssignments || [],
    });
    db.prepare(`
      INSERT INTO ${COMPANY_MEMBERSHIPS_TABLE} (
        id, companyId, principalId, status, roleTemplateKey, roleTemplateVersion,
        companyWideBranchAuthority, version, createdAt, updatedAt, activatedAt,
        inactivatedAt, revokedAt, createdBy, updatedBy, revokedBy, reason
      ) VALUES (
        @id, @companyId, @principalId, @status, @roleTemplateKey, @roleTemplateVersion,
        @companyWideBranchAuthority, 1, @createdAt, @updatedAt, @activatedAt,
        @inactivatedAt, @revokedAt, @createdBy, @updatedBy, @revokedBy, @reason
      )
    `).run({
      id,
      companyId: input.companyId,
      principalId,
      status,
      roleTemplateKey,
      roleTemplateVersion,
      companyWideBranchAuthority: companyWide ? 1 : 0,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
      activatedAt: status === 'active' ? input.timestamp : null,
      inactivatedAt: status === 'inactive' ? input.timestamp : null,
      revokedAt: status === 'revoked' ? input.timestamp : null,
      createdBy: input.validatedActor.principalId,
      updatedBy: input.validatedActor.principalId,
      revokedBy: status === 'revoked' ? input.validatedActor.principalId : null,
      reason: input.reason,
    });
    const membership = getMembership(id);
    insertAuditRow({
      companyId: input.companyId,
      validatedActor: input.validatedActor,
      action: 'membership.created',
      targetType: 'membership',
      targetId: id,
      reasonCode: input.reason,
      after: membership,
      capabilityCatalogVersion: catalog.version,
    });
    return membership;
  }

  return Object.freeze({
    applyBootstrapPlan,
    assignCapability,
    createBranch,
    createCompanyAuthority,
    createMembership,
    createRoleTemplate,
    getCompany,
    getMembership,
    grantBranchAccess,
    insertAudit,
    listActiveCatalogVersions,
    listBranchAccess,
    listBranches,
    listCapabilityAssignments,
    listCatalogEntries,
    listHeadOffices,
    listMembershipsForPrincipal,
    listRoleTemplateCapabilities,
    getRoleTemplate,
    requireActiveCatalog,
    revokeBranchAccess,
    revokeCapabilityAssignment,
    updateBranch,
    updateCompany,
    updateMembership,
  });
}

module.exports = {
  AUDIT_JSON_MAX_BYTES,
  AUDIT_JSON_MAX_DEPTH,
  FORBIDDEN_BRANCH_IDS,
  PlatformIdentityRepositoryError,
  assertBranchId,
  assertIanaTimezone,
  assertNoSecrets,
  auditJson,
  createPlatformIdentityRepository,
  createTrustedUserActorContext,
  isEligiblePlatformUser,
  requiredId,
};
