const crypto = require('crypto');
const {
  CANONICAL_BRANCHES_TABLE,
  CANONICAL_COMPANIES_TABLE,
} = require('./canonical-receivables-schema');
const {
  AUTHORIZATION_AUDIT_EVENTS_TABLE,
  CAPABILITY_CATALOG_ENTRIES_TABLE,
  CAPABILITY_CATALOG_V1_CHECKSUM,
  CAPABILITY_CATALOG_VERSIONS_TABLE,
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
const FORBIDDEN_BRANCH_IDS = new Set([
  '*',
  'all',
  'global',
  'company-wide',
  'company_wide',
  'any',
  'null',
]);
const SECRET_KEY_PATTERN = /^(?:.*password.*|.*passwd.*|.*secret.*|.*token.*|authorization|cookie|api[_-]?key|webhook[_-]?(?:secret|token))$/i;

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

function assertNoSecrets(value, path = 'json') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      fail('PLATFORM_IDENTITY_AUDIT_SECRET_REJECTED', `Secret-bearing audit field is forbidden: ${path}.${key}.`);
    }
    assertNoSecrets(child, `${path}.${key}`);
  }
}

function auditJson(value) {
  if (value === undefined || value === null) return null;
  assertNoSecrets(value);
  return JSON.stringify(value);
}

function sortedUnique(values, normalizer) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizer))].sort();
}

function normalizeActor(actor = {}) {
  const type = enumValue(actor.type || 'user', new Set(['user', 'integration', 'system']), 'actor.type');
  const principalId = requiredId(actor.principalId, 'actor.principalId');
  const membershipId = actor.membershipId == null
    ? null
    : requiredId(actor.membershipId, 'actor.membershipId');
  const membershipVersion = membershipId == null
    ? null
    : requiredVersion(actor.membershipVersion, 'actor.membershipVersion');
  return {
    type,
    principalId,
    membershipId,
    membershipVersion,
    correlationId: requiredId(actor.correlationId, 'actor.correlationId'),
  };
}

function createPlatformIdentityRepository(db, options = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    fail('PLATFORM_IDENTITY_DATABASE_REQUIRED', 'A better-sqlite3 database is required.');
  }
  assertPlatformIdentityStructure(db);

  const nowIso = typeof options.nowIso === 'function'
    ? options.nowIso
    : () => new Date().toISOString();
  const generateId = typeof options.generateId === 'function'
    ? options.generateId
    : prefix => `${prefix}-${crypto.randomUUID()}`;

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

  function insertAudit(event) {
    const actor = normalizeActor(event.actor);
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
      beforeJson: auditJson(event.before),
      afterJson: auditJson(event.after),
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
      const actor = normalizeActor(input.actor);
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
      insertAudit({
        companyId,
        actor,
        action: 'company.authority.created',
        targetType: 'company',
        targetId: companyId,
        reasonCode: reason,
        after: created,
        capabilityCatalogVersion: 1,
      });
      for (const branch of normalizedBranches) {
        insertAudit({
          companyId,
          branchId: branch.id,
          actor,
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
      const actor = normalizeActor(input.actor);
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
        actor.principalId,
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
          actor.principalId,
        );
      }
      const template = getRoleTemplate(companyId, templateKey, templateVersion);
      insertAudit({
        companyId,
        actor,
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
      const actor = normalizeActor(input.actor);
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
      insertAudit({
        companyId,
        branchId,
        actor,
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
      const actor = normalizeActor(input.actor);
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
      insertAudit({
        companyId,
        actor,
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
      const actor = normalizeActor(input.actor);
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
      insertAudit({
        companyId,
        branchId,
        actor,
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
      const actor = normalizeActor(input.actor);
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
        createdBy: actor.principalId,
        updatedBy: actor.principalId,
        revokedBy: status === 'revoked' ? actor.principalId : null,
        reason,
      });
      let membership = getMembership(membershipId);
      insertAudit({
        companyId,
        actor,
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
          actor,
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
          actor,
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
    actor,
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
      actor.principalId,
      reason,
    );
    const updated = bumpMembership(
      membership.id,
      Number(membership.version),
      actor.principalId,
      reason,
      timestamp,
    );
    if (audit) {
      insertAudit({
        companyId: membership.companyId,
        branchId: normalizedBranchId,
        actor,
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
      const actor = normalizeActor(input.actor);
      const updated = grantBranchAccessInternal({
        membership,
        branchId: input.branchId,
        actor,
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
      const actor = normalizeActor(input.actor);
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
      `).run(timestamp, actor.principalId, reason, grant.id, grant.version);
      const updated = bumpMembership(
        membership.id,
        Number(membership.version),
        actor.principalId,
        reason,
        timestamp,
      );
      insertAudit({
        companyId: membership.companyId,
        branchId,
        actor,
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
    actor,
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
      actor.principalId,
      reason,
    );
    const updated = bumpMembership(
      membership.id,
      Number(membership.version),
      actor.principalId,
      reason,
      timestamp,
    );
    if (audit) {
      insertAudit({
        companyId: membership.companyId,
        actor,
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
      const updated = assignCapabilityInternal({
        membership,
        capabilityKey: input.capabilityKey,
        effect: input.effect,
        actor: normalizeActor(input.actor),
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
      const actor = normalizeActor(input.actor);
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
      `).run(timestamp, actor.principalId, reason, assignment.id, assignment.version);
      const updated = bumpMembership(
        membership.id,
        Number(membership.version),
        actor.principalId,
        reason,
        timestamp,
      );
      insertAudit({
        companyId: membership.companyId,
        actor,
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
      const actor = normalizeActor(input.actor);
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
        updatedBy: actor.principalId,
        revokedBy: nextStatus === 'revoked' ? actor.principalId : null,
        reason,
      });
      if (result.changes !== 1) {
        fail('PLATFORM_IDENTITY_STALE_VERSION', 'Membership version is stale.');
      }
      const updated = getMembership(membership.id);
      assertExplicitBranchMode(updated);
      insertAudit({
        companyId: membership.companyId,
        actor,
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
    const existing = db.prepare(`
      SELECT *
      FROM ${IDENTITY_BOOTSTRAP_RUNS_TABLE}
      WHERE configChecksum = ? AND status = 'succeeded'
    `).get(configChecksum);
    if (existing) return Object.freeze({ status: 'noop', run: existing });

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

      const approval = plan.approval || {};
      const actor = normalizeActor({
        type: 'user',
        principalId: approval.approvedBy,
        correlationId: plan.correlationId,
      });
      const reason = requiredText(approval.approvalReference, 'approval.approvalReference');
      const timestamp = plan.startedAt || nowIso();
      const companyResult = createCompanyAuthorityInternal({
        company: plan.company,
        branches: plan.branches,
        actor,
        reason,
        timestamp,
      });
      for (const template of plan.roleTemplates || []) {
        createRoleTemplateInternal({
          companyId: companyResult.company.id,
          ...template,
          actor,
          reason,
          timestamp,
        });
      }
      for (const membership of plan.memberships || []) {
        createMembershipInternal({
          companyId: companyResult.company.id,
          ...membership,
          actor,
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
        approvedBy: actor.principalId,
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
    insertAudit({
      companyId,
      actor: input.actor,
      action: 'company.authority.created',
      targetType: 'company',
      targetId: companyId,
      reasonCode: input.reason,
      after: created,
      capabilityCatalogVersion: 1,
    });
    for (const branch of branches) {
      insertAudit({
        companyId,
        branchId: branch.id,
        actor: input.actor,
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
      input.actor.principalId,
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
      input.actor.principalId,
    ));
    insertAudit({
      companyId: input.companyId,
      actor: input.actor,
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
        actor: input.actor,
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
        actor: input.actor,
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
      createdBy: input.actor.principalId,
      updatedBy: input.actor.principalId,
      revokedBy: status === 'revoked' ? input.actor.principalId : null,
      reason: input.reason,
    });
    const membership = getMembership(id);
    insertAudit({
      companyId: input.companyId,
      actor: input.actor,
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
  FORBIDDEN_BRANCH_IDS,
  PlatformIdentityRepositoryError,
  assertBranchId,
  assertIanaTimezone,
  assertNoSecrets,
  auditJson,
  createPlatformIdentityRepository,
  requiredId,
};
