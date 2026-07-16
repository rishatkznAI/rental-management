const {
  CAPABILITY_CATALOG_V1,
  CAPABILITY_CATALOG_V1_CHECKSUM,
  stableJson,
} = require('./platform-identity-schema');
const {
  FORBIDDEN_BRANCH_IDS,
  assertIanaTimezone,
  requiredId,
} = require('./platform-identity-repository');

const KNOWN_CAPABILITIES = new Map(
  CAPABILITY_CATALOG_V1.map(entry => [entry.key, Object.freeze({ ...entry })]),
);
const COMPANY_SCOPED_CAPABILITIES = new Set([
  'companies.manage',
  'branches.manage',
  'members.manage',
]);

class PlatformAuthorizationError extends Error {
  constructor(code, message, { status = 403, field } = {}) {
    super(message);
    this.name = 'PlatformAuthorizationError';
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

function deny(code = 'PLATFORM_AUTHORIZATION_DENIED', message = 'Access is unavailable.', options) {
  throw new PlatformAuthorizationError(code, message, options);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function assertConcreteBranchId(branchId) {
  const id = requiredId(branchId, 'branchId');
  if (FORBIDDEN_BRANCH_IDS.has(id.toLowerCase())) {
    deny('PLATFORM_BRANCH_SCOPE_DENIED', 'Branch scope is unavailable.');
  }
  return id;
}

function assertKnownCapability(capabilityKey) {
  const key = requiredId(capabilityKey, 'capabilityKey');
  const entry = KNOWN_CAPABILITIES.get(key);
  if (!entry) {
    deny('PLATFORM_CAPABILITY_UNKNOWN', 'Capability is unavailable.');
  }
  return entry;
}

function narrowRequestedCompany(activeMemberships, requestedCompanyId) {
  const memberships = Array.isArray(activeMemberships)
    ? activeMemberships.filter(item => item?.status === 'active')
    : [];
  if (memberships.length === 0) {
    deny('PLATFORM_MEMBERSHIP_DENIED', 'Company scope is unavailable.');
  }
  if (memberships.length === 1) {
    if (
      requestedCompanyId !== undefined
      && requestedCompanyId !== null
      && requiredId(requestedCompanyId, 'requestedCompanyId') !== memberships[0].companyId
    ) {
      deny('PLATFORM_COMPANY_SCOPE_DENIED', 'Company scope is unavailable.');
    }
    return memberships[0];
  }
  if (requestedCompanyId === undefined || requestedCompanyId === null || requestedCompanyId === '') {
    deny('PLATFORM_COMPANY_SELECTION_REQUIRED', 'Company scope is unavailable.');
  }
  const companyId = requiredId(requestedCompanyId, 'requestedCompanyId');
  const matches = memberships.filter(item => item.companyId === companyId);
  if (matches.length !== 1) {
    deny('PLATFORM_COMPANY_SCOPE_DENIED', 'Company scope is unavailable.');
  }
  return matches[0];
}

function resolveLiveUser(readUsers, principalId) {
  if (typeof readUsers !== 'function') {
    deny('PLATFORM_USER_DIRECTORY_UNAVAILABLE', 'Principal is unavailable.');
  }
  const users = readUsers();
  if (!Array.isArray(users)) {
    deny('PLATFORM_USER_DIRECTORY_UNAVAILABLE', 'Principal is unavailable.');
  }
  const matches = users.filter(user => user && user.id === principalId);
  if (matches.length !== 1 || matches[0].status !== 'Активен') {
    deny('PLATFORM_PRINCIPAL_DENIED', 'Principal is unavailable.');
  }
  const user = matches[0];
  if (
    user.botOnly === true
    && user.allowFrontendLogin !== true
    && user.frontendAccess !== true
  ) {
    deny('PLATFORM_PRINCIPAL_DENIED', 'Principal is unavailable.');
  }
  return user;
}

function validateCatalog(repository) {
  const versions = repository.listActiveCatalogVersions();
  if (
    versions.length !== 1
    || Number(versions[0].version) !== 1
    || versions[0].checksum !== CAPABILITY_CATALOG_V1_CHECKSUM
  ) {
    deny('PLATFORM_CATALOG_DENIED', 'Authorization catalog is unavailable.');
  }
  const entries = repository.listCatalogEntries(versions[0].version)
    .map(entry => ({
      key: entry.capabilityKey,
      scopeKind: entry.scopeKind,
      assignable: entry.assignable === 1,
      status: entry.status,
    }));
  const expectedEntries = CAPABILITY_CATALOG_V1.map(entry => ({
    ...entry,
    status: 'active',
  }));
  if (stableJson(entries) !== stableJson(expectedEntries)) {
    deny('PLATFORM_CATALOG_DENIED', 'Authorization catalog is unavailable.');
  }
  return versions[0];
}

function validateCompany(repository, companyId) {
  const company = repository.getCompany(companyId);
  if (!company || company.status !== 'active') {
    deny('PLATFORM_COMPANY_SCOPE_DENIED', 'Company scope is unavailable.');
  }
  try {
    assertIanaTimezone(company.receivablesTimezone);
  } catch {
    deny('PLATFORM_COMPANY_SCOPE_DENIED', 'Company scope is unavailable.');
  }
  const headOffices = repository.listHeadOffices(companyId);
  if (
    headOffices.length !== 1
    || headOffices[0].status !== 'active'
    || FORBIDDEN_BRANCH_IDS.has(String(headOffices[0].id).toLowerCase())
  ) {
    deny('PLATFORM_COMPANY_SCOPE_DENIED', 'Company scope is unavailable.');
  }
  return company;
}

function validateTemplate(repository, membership, catalogVersion) {
  const template = repository.getRoleTemplate(
    membership.companyId,
    membership.roleTemplateKey,
    Number(membership.roleTemplateVersion),
  );
  if (
    !template
    || template.status !== 'active'
    || Number(template.catalogVersion) !== Number(catalogVersion)
  ) {
    deny('PLATFORM_ROLE_TEMPLATE_DENIED', 'Role template is unavailable.');
  }
  const capabilities = repository.listRoleTemplateCapabilities(
    membership.companyId,
    membership.roleTemplateKey,
    Number(membership.roleTemplateVersion),
  );
  for (const capability of capabilities) {
    if (
      Number(capability.catalogVersion) !== Number(catalogVersion)
      || !KNOWN_CAPABILITIES.has(capability.capabilityKey)
    ) {
      deny('PLATFORM_ROLE_TEMPLATE_DENIED', 'Role template is unavailable.');
    }
  }
  return {
    template,
    capabilities: capabilities.map(item => item.capabilityKey),
  };
}

function resolveEffectiveCapabilities(repository, membership, templateCapabilities, catalogVersion) {
  const assignments = repository.listCapabilityAssignments(membership.id, { status: 'active' });
  const byCapability = new Map();
  for (const assignment of assignments) {
    if (
      assignment.companyId !== membership.companyId
      || Number(assignment.catalogVersion) !== Number(catalogVersion)
      || !KNOWN_CAPABILITIES.has(assignment.capabilityKey)
      || !['grant', 'deny'].includes(assignment.effect)
    ) {
      deny('PLATFORM_CAPABILITY_STATE_DENIED', 'Capability state is unavailable.');
    }
    const existing = byCapability.get(assignment.capabilityKey);
    if (existing) {
      deny('PLATFORM_CAPABILITY_STATE_DENIED', 'Capability state is unavailable.');
    }
    byCapability.set(assignment.capabilityKey, assignment.effect);
  }

  const effective = new Set(templateCapabilities);
  for (const [capabilityKey, effect] of byCapability.entries()) {
    if (effect === 'grant') effective.add(capabilityKey);
  }
  for (const [capabilityKey, effect] of byCapability.entries()) {
    if (effect === 'deny') effective.delete(capabilityKey);
  }
  if (membership.companyWideBranchAuthority !== 1) {
    COMPANY_SCOPED_CAPABILITIES.forEach(capability => effective.delete(capability));
  }
  return sortedUnique([...effective]);
}

function resolveAllowedBranches(repository, membership) {
  const activeGrants = repository.listBranchAccess(membership.id, { status: 'active' });
  const grantKeys = new Set();
  for (const grant of activeGrants) {
    if (
      grant.companyId !== membership.companyId
      || grantKeys.has(grant.branchId)
    ) {
      deny('PLATFORM_BRANCH_STATE_DENIED', 'Branch scope is unavailable.');
    }
    grantKeys.add(grant.branchId);
  }

  if (membership.companyWideBranchAuthority === 1) {
    if (activeGrants.length !== 0) {
      deny('PLATFORM_BRANCH_STATE_DENIED', 'Branch scope is unavailable.');
    }
    const branchIds = repository.listBranches(membership.companyId, { status: 'active' })
      .map(branch => assertConcreteBranchId(branch.id));
    if (branchIds.length === 0) {
      deny('PLATFORM_BRANCH_SCOPE_DENIED', 'Branch scope is unavailable.');
    }
    return sortedUnique(branchIds);
  }

  if (membership.companyWideBranchAuthority !== 0 || activeGrants.length === 0) {
    deny('PLATFORM_BRANCH_SCOPE_DENIED', 'Branch scope is unavailable.');
  }
  const activeBranches = new Set(
    repository.listBranches(membership.companyId, { status: 'active' })
      .map(branch => branch.id),
  );
  const branchIds = activeGrants.map(grant => {
    const branchId = assertConcreteBranchId(grant.branchId);
    if (!activeBranches.has(branchId)) {
      deny('PLATFORM_BRANCH_SCOPE_DENIED', 'Branch scope is unavailable.');
    }
    return branchId;
  });
  return sortedUnique(branchIds);
}

function resolveTrustedScope({
  req,
  repository,
  readUsers,
  requestedCompanyId,
  requestedBranchId,
  nowIso = () => new Date().toISOString(),
} = {}) {
  if (!repository) {
    deny('PLATFORM_AUTHORIZATION_UNAVAILABLE', 'Authorization scope is unavailable.');
  }
  const principalId = requiredId(req?.user?.userId, 'authenticatedPrincipalId');
  resolveLiveUser(readUsers, principalId);
  const activeMemberships = repository.listMembershipsForPrincipal(principalId, { status: 'active' });
  const membership = narrowRequestedCompany(activeMemberships, requestedCompanyId);
  if (membership.principalId !== principalId || membership.status !== 'active') {
    deny('PLATFORM_MEMBERSHIP_DENIED', 'Company scope is unavailable.');
  }
  const company = validateCompany(repository, membership.companyId);
  const catalog = validateCatalog(repository);
  const template = validateTemplate(repository, membership, catalog.version);
  const allowedBranchIds = resolveAllowedBranches(repository, membership);
  const capabilities = resolveEffectiveCapabilities(
    repository,
    membership,
    template.capabilities,
    catalog.version,
  );
  let scope = deepFreeze({
    authenticated: true,
    principalType: 'user',
    principalId,
    companyId: company.id,
    companyTimezone: company.receivablesTimezone,
    membershipId: membership.id,
    membershipVersion: Number(membership.version),
    roleTemplateKey: membership.roleTemplateKey,
    roleTemplateVersion: Number(membership.roleTemplateVersion),
    capabilityCatalogVersion: Number(catalog.version),
    capabilities,
    companyWideBranchAuthority: membership.companyWideBranchAuthority === 1,
    allowedBranchIds,
    resolvedAt: nowIso(),
  });
  if (requestedBranchId !== undefined && requestedBranchId !== null && requestedBranchId !== '') {
    scope = narrowRequestedBranch(scope, requestedBranchId);
  }
  return scope;
}

function assertCapability(scope, capabilityKey) {
  const capability = assertKnownCapability(capabilityKey);
  if (
    !scope
    || scope.authenticated !== true
    || !Array.isArray(scope.capabilities)
    || !scope.capabilities.includes(capability.key)
  ) {
    deny('PLATFORM_CAPABILITY_DENIED', 'Access is unavailable.');
  }
  if (capability.scopeKind === 'company' && scope.companyWideBranchAuthority !== true) {
    deny('PLATFORM_CAPABILITY_DENIED', 'Access is unavailable.');
  }
  return true;
}

function assertCompanyScope(scope, companyId) {
  const requested = requiredId(companyId, 'companyId');
  if (!scope || scope.companyId !== requested) {
    deny('PLATFORM_ENTITY_NOT_FOUND', 'Entity was not found.', { status: 404 });
  }
  return true;
}

function assertBranchScope(scope, branchId) {
  const requested = assertConcreteBranchId(branchId);
  if (
    !scope
    || !Array.isArray(scope.allowedBranchIds)
    || !scope.allowedBranchIds.includes(requested)
  ) {
    deny('PLATFORM_ENTITY_NOT_FOUND', 'Entity was not found.', { status: 404 });
  }
  return true;
}

function narrowRequestedBranch(scope, requestedBranchId) {
  const branchId = assertConcreteBranchId(requestedBranchId);
  assertBranchScope(scope, branchId);
  return deepFreeze({
    ...scope,
    allowedBranchIds: [branchId],
  });
}

function assertScopeFresh(scope, { repository, readUsers, nowIso } = {}) {
  if (!scope || scope.principalType !== 'user') {
    deny('PLATFORM_SCOPE_STALE', 'Authorization scope is unavailable.');
  }
  const refreshed = resolveTrustedScope({
    req: { user: { userId: scope.principalId } },
    repository,
    readUsers,
    requestedCompanyId: scope.companyId,
    nowIso,
  });
  const comparableFields = [
    'companyId',
    'companyTimezone',
    'membershipId',
    'membershipVersion',
    'roleTemplateKey',
    'roleTemplateVersion',
    'capabilityCatalogVersion',
    'companyWideBranchAuthority',
  ];
  if (
    comparableFields.some(field => refreshed[field] !== scope[field])
    || stableJson(refreshed.capabilities) !== stableJson(scope.capabilities)
    || !Array.isArray(scope.allowedBranchIds)
    || scope.allowedBranchIds.length === 0
    || scope.allowedBranchIds.some(branchId => !refreshed.allowedBranchIds.includes(branchId))
  ) {
    deny('PLATFORM_SCOPE_STALE', 'Authorization scope is unavailable.');
  }
  return true;
}

function sqlIdentifier(value, field) {
  const identifier = String(value || '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`${field} must be a SQL identifier.`);
  }
  return identifier;
}

function buildScopedPredicate(scope, options = {}) {
  if (!scope || !Array.isArray(scope.allowedBranchIds) || scope.allowedBranchIds.length === 0) {
    deny('PLATFORM_BRANCH_SCOPE_DENIED', 'Branch scope is unavailable.');
  }
  const alias = options.alias ? `${sqlIdentifier(options.alias, 'alias')}.` : '';
  const companyColumn = sqlIdentifier(options.companyColumn || 'companyId', 'companyColumn');
  const branchColumn = sqlIdentifier(options.branchColumn || 'branchId', 'branchColumn');
  const params = { trustedCompanyId: scope.companyId };
  const placeholders = scope.allowedBranchIds.map((branchId, index) => {
    const key = `trustedBranchId${index}`;
    params[key] = assertConcreteBranchId(branchId);
    return `@${key}`;
  });
  const where = [
    `${alias}${companyColumn} = @trustedCompanyId`,
    `${alias}${branchColumn} IN (${placeholders.join(', ')})`,
  ];
  if (options.id !== undefined) {
    const idColumn = sqlIdentifier(options.idColumn || 'id', 'idColumn');
    params.trustedEntityId = requiredId(options.id, 'id');
    where.push(`${alias}${idColumn} = @trustedEntityId`);
  }
  return Object.freeze({
    where: where.join(' AND '),
    params: Object.freeze(params),
  });
}

function nonDisclosingNotFound() {
  deny('PLATFORM_ENTITY_NOT_FOUND', 'Entity was not found.', { status: 404 });
}

module.exports = {
  COMPANY_SCOPED_CAPABILITIES,
  PlatformAuthorizationError,
  assertBranchScope,
  assertCapability,
  assertCompanyScope,
  assertKnownCapability,
  assertScopeFresh,
  buildScopedPredicate,
  deepFreeze,
  narrowRequestedBranch,
  narrowRequestedCompany,
  nonDisclosingNotFound,
  resolveTrustedScope,
};
