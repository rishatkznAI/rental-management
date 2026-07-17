const crypto = require('crypto');
const {
  CANONICAL_BRANCHES_TABLE,
  CANONICAL_COMPANIES_TABLE,
} = require('./canonical-receivables-schema');
const {
  CAPABILITY_CATALOG_V1,
  COMPANY_SCOPED_CAPABILITY_KEYS,
  COMPANY_MEMBERSHIPS_TABLE,
  FINANCIAL_TABLES,
  IDENTITY_BOOTSTRAP_RUNS_TABLE,
  MEMBERSHIP_BRANCH_ACCESS_TABLE,
  MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE,
  ROLE_TEMPLATE_CAPABILITIES_TABLE,
  ROLE_TEMPLATES_TABLE,
  assertPlatformIdentityStructure,
  stableJson,
} = require('./platform-identity-schema');

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

function validationFail(code, message, field) {
  const error = Object.assign(new Error(message), { code, field });
  error.name = 'PlatformIdentityBootstrapValidationError';
  throw error;
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    validationFail('PLATFORM_IDENTITY_REQUIRED', `${field} is required.`, field);
  }
  return value.trim();
}

function requiredId(value, field) {
  const id = requiredText(value, field);
  if (id.length > 160 || /[\u0000-\u001f\u007f]/.test(id)) {
    validationFail(
      'PLATFORM_IDENTITY_INVALID_ID',
      `${field} must be an opaque stable identifier.`,
      field,
    );
  }
  return id;
}

function assertIanaTimezone(value, field = 'receivablesTimezone') {
  const timezone = requiredText(value, field);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
  } catch {
    validationFail(
      'PLATFORM_IDENTITY_INVALID_TIMEZONE',
      `${field} must be a valid IANA timezone.`,
      field,
    );
  }
  return timezone;
}

function assertBranchId(value, field = 'branchId') {
  const branchId = requiredId(value, field);
  if (FORBIDDEN_BRANCH_IDS.has(branchId.toLowerCase())) {
    validationFail(
      'PLATFORM_IDENTITY_BRANCH_SENTINEL_FORBIDDEN',
      `${field} cannot be a wildcard.`,
      field,
    );
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

function assertNoSecrets(value, path = 'config') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (isSecretBearingKey(key)) {
      validationFail(
        'PLATFORM_IDENTITY_AUDIT_SECRET_REJECTED',
        `Secret-bearing bootstrap field is forbidden: ${path}.${key}.`,
        `${path}.${key}`,
      );
    }
    assertNoSecrets(child, `${path}.${key}`);
  }
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

const AUTHORITY_CONFIG_KEYS = new Set([
  'configVersion',
  'company',
  'branches',
  'roleTemplates',
  'memberships',
  'intentionallyUnmappedUserIds',
  'approval',
]);
const COMPANY_KEYS = new Set(['id', 'displayName', 'receivablesTimezone']);
const BRANCH_KEYS = new Set(['id', 'displayName', 'isHeadOffice', 'status']);
const TEMPLATE_KEYS = new Set([
  'templateKey',
  'templateVersion',
  'displayName',
  'capabilities',
]);
const MEMBERSHIP_KEYS = new Set([
  'id',
  'principalId',
  'status',
  'roleTemplateKey',
  'roleTemplateVersion',
  'companyWideBranchAuthority',
  'branchIds',
  'capabilityAssignments',
]);
const ASSIGNMENT_KEYS = new Set(['capabilityKey', 'effect']);
const APPROVAL_KEYS = new Set([
  'approvedBy',
  'approvedAt',
  'approvalReference',
  'backupReference',
  'configChecksum',
  'schemaFingerprint',
]);
const LEGACY_INFERENCE_KEYS = new Set([
  'role',
  'legacyRole',
  'roleMapping',
  'roleMappings',
  'managerName',
  'ownerName',
  'email',
  'equipmentId',
]);
const KNOWN_CAPABILITIES = new Map(CAPABILITY_CATALOG_V1.map(item => [item.key, item]));
const COMPANY_SCOPED_CAPABILITIES = new Set(COMPANY_SCOPED_CAPABILITY_KEYS);
const AUTHORITY_SNAPSHOT_VERSION = 1;

const AUTHORITY_ROW_FIELDS = Object.freeze({
  companies: Object.freeze([
    'id',
    'displayName',
    'status',
    'version',
    'receivablesTimezone',
  ]),
  branches: Object.freeze([
    'id',
    'companyId',
    'displayName',
    'status',
    'version',
    'isHeadOffice',
  ]),
  memberships: Object.freeze([
    'id',
    'companyId',
    'principalId',
    'status',
    'version',
    'roleTemplateKey',
    'roleTemplateVersion',
    'companyWideBranchAuthority',
  ]),
  branchAccess: Object.freeze([
    'membershipId',
    'companyId',
    'branchId',
    'status',
    'version',
    'grantedBy',
    'revoked',
    'revokedBy',
  ]),
  roleTemplates: Object.freeze([
    'companyId',
    'templateKey',
    'templateVersion',
    'catalogVersion',
    'displayName',
    'status',
  ]),
  roleTemplateCapabilities: Object.freeze([
    'companyId',
    'templateKey',
    'templateVersion',
    'catalogVersion',
    'capabilityKey',
  ]),
  capabilityAssignments: Object.freeze([
    'membershipId',
    'companyId',
    'catalogVersion',
    'capabilityKey',
    'effect',
    'status',
    'version',
    'grantedBy',
    'revoked',
    'revokedBy',
  ]),
});

function authorityInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    validationFail(
      'PLATFORM_IDENTITY_AUTHORITY_SNAPSHOT_INVALID',
      `${field} must be a non-negative integer.`,
      field,
    );
  }
  return normalized;
}

function authorityBoolean(value, field) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  validationFail(
    'PLATFORM_IDENTITY_AUTHORITY_SNAPSHOT_INVALID',
    `${field} must be boolean.`,
    field,
  );
}

function authorityNullableText(value, field) {
  return value == null ? null : requiredText(value, field);
}

function assertExactAuthorityFields(row, fields, field) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    validationFail(
      'PLATFORM_IDENTITY_AUTHORITY_SNAPSHOT_INVALID',
      `${field} must be an authority row.`,
      field,
    );
  }
  const actual = Object.keys(row).sort();
  const expected = [...fields].sort();
  if (stableJson(actual) !== stableJson(expected)) {
    validationFail(
      'PLATFORM_IDENTITY_AUTHORITY_SNAPSHOT_INVALID',
      `${field} contains missing or unexpected fields.`,
      field,
    );
  }
}

function sortAuthorityRows(rows) {
  return rows.sort((left, right) => {
    const leftJson = stableJson(left);
    const rightJson = stableJson(right);
    if (leftJson < rightJson) return -1;
    if (leftJson > rightJson) return 1;
    return 0;
  });
}

function buildAuthoritySnapshotFromRows(rows = {}) {
  for (const collection of Object.keys(AUTHORITY_ROW_FIELDS)) {
    if (!Array.isArray(rows[collection])) {
      validationFail(
        'PLATFORM_IDENTITY_AUTHORITY_SNAPSHOT_INVALID',
        `authorityRows.${collection} must be an array.`,
        `authorityRows.${collection}`,
      );
    }
  }
  const normalizeRows = (collection, normalize) => sortAuthorityRows(
    rows[collection].map((row, index) => {
      assertExactAuthorityFields(
        row,
        AUTHORITY_ROW_FIELDS[collection],
        `authorityRows.${collection}[${index}]`,
      );
      return normalize(row, `authorityRows.${collection}[${index}]`);
    }),
  );
  return deepFreeze({
    authoritySnapshotVersion: AUTHORITY_SNAPSHOT_VERSION,
    companies: normalizeRows('companies', (row, field) => ({
      id: requiredId(row.id, `${field}.id`),
      displayName: requiredText(row.displayName, `${field}.displayName`),
      status: requiredText(row.status, `${field}.status`),
      version: authorityInteger(row.version, `${field}.version`),
      receivablesTimezone: assertIanaTimezone(
        row.receivablesTimezone,
        `${field}.receivablesTimezone`,
      ),
    })),
    branches: normalizeRows('branches', (row, field) => ({
      id: assertBranchId(row.id, `${field}.id`),
      companyId: requiredId(row.companyId, `${field}.companyId`),
      displayName: requiredText(row.displayName, `${field}.displayName`),
      status: requiredText(row.status, `${field}.status`),
      version: authorityInteger(row.version, `${field}.version`),
      isHeadOffice: authorityBoolean(row.isHeadOffice, `${field}.isHeadOffice`),
    })),
    memberships: normalizeRows('memberships', (row, field) => ({
      id: requiredId(row.id, `${field}.id`),
      companyId: requiredId(row.companyId, `${field}.companyId`),
      principalId: requiredId(row.principalId, `${field}.principalId`),
      status: requiredText(row.status, `${field}.status`),
      version: authorityInteger(row.version, `${field}.version`),
      roleTemplateKey: requiredId(row.roleTemplateKey, `${field}.roleTemplateKey`),
      roleTemplateVersion: authorityInteger(
        row.roleTemplateVersion,
        `${field}.roleTemplateVersion`,
      ),
      companyWideBranchAuthority: authorityBoolean(
        row.companyWideBranchAuthority,
        `${field}.companyWideBranchAuthority`,
      ),
    })),
    branchAccess: normalizeRows('branchAccess', (row, field) => ({
      membershipId: requiredId(row.membershipId, `${field}.membershipId`),
      companyId: requiredId(row.companyId, `${field}.companyId`),
      branchId: assertBranchId(row.branchId, `${field}.branchId`),
      status: requiredText(row.status, `${field}.status`),
      version: authorityInteger(row.version, `${field}.version`),
      grantedBy: requiredId(row.grantedBy, `${field}.grantedBy`),
      revoked: authorityBoolean(row.revoked, `${field}.revoked`),
      revokedBy: authorityNullableText(row.revokedBy, `${field}.revokedBy`),
    })),
    roleTemplates: normalizeRows('roleTemplates', (row, field) => ({
      companyId: requiredId(row.companyId, `${field}.companyId`),
      templateKey: requiredId(row.templateKey, `${field}.templateKey`),
      templateVersion: authorityInteger(row.templateVersion, `${field}.templateVersion`),
      catalogVersion: authorityInteger(row.catalogVersion, `${field}.catalogVersion`),
      displayName: requiredText(row.displayName, `${field}.displayName`),
      status: requiredText(row.status, `${field}.status`),
    })),
    roleTemplateCapabilities: normalizeRows('roleTemplateCapabilities', (row, field) => ({
      companyId: requiredId(row.companyId, `${field}.companyId`),
      templateKey: requiredId(row.templateKey, `${field}.templateKey`),
      templateVersion: authorityInteger(row.templateVersion, `${field}.templateVersion`),
      catalogVersion: authorityInteger(row.catalogVersion, `${field}.catalogVersion`),
      capabilityKey: requiredId(row.capabilityKey, `${field}.capabilityKey`),
    })),
    capabilityAssignments: normalizeRows('capabilityAssignments', (row, field) => ({
      membershipId: requiredId(row.membershipId, `${field}.membershipId`),
      companyId: requiredId(row.companyId, `${field}.companyId`),
      catalogVersion: authorityInteger(row.catalogVersion, `${field}.catalogVersion`),
      capabilityKey: requiredId(row.capabilityKey, `${field}.capabilityKey`),
      effect: requiredText(row.effect, `${field}.effect`),
      status: requiredText(row.status, `${field}.status`),
      version: authorityInteger(row.version, `${field}.version`),
      grantedBy: requiredId(row.grantedBy, `${field}.grantedBy`),
      revoked: authorityBoolean(row.revoked, `${field}.revoked`),
      revokedBy: authorityNullableText(row.revokedBy, `${field}.revokedBy`),
    })),
  });
}

function buildExpectedAuthoritySnapshot(normalized, catalogVersion) {
  const companyId = requiredId(normalized?.company?.id, 'normalized.company.id');
  const approvedBy = requiredId(
    normalized?.approval?.approvedBy,
    'normalized.approval.approvedBy',
  );
  const normalizedCatalogVersion = authorityInteger(catalogVersion, 'catalogVersion');
  return buildAuthoritySnapshotFromRows({
    companies: [{
      id: companyId,
      displayName: normalized.company.displayName,
      status: 'active',
      version: 2,
      receivablesTimezone: normalized.company.receivablesTimezone,
    }],
    branches: normalized.branches.map(branch => ({
      id: branch.id,
      companyId,
      displayName: branch.displayName,
      status: branch.status,
      version: 1,
      isHeadOffice: branch.isHeadOffice,
    })),
    memberships: normalized.memberships.map(membership => ({
      id: membership.id,
      companyId,
      principalId: membership.principalId,
      status: membership.status,
      version: 1 + membership.branchIds.length + membership.capabilityAssignments.length,
      roleTemplateKey: membership.roleTemplateKey,
      roleTemplateVersion: membership.roleTemplateVersion,
      companyWideBranchAuthority: membership.companyWideBranchAuthority,
    })),
    branchAccess: normalized.memberships.flatMap(membership => (
      membership.branchIds.map(branchId => ({
        membershipId: membership.id,
        companyId,
        branchId,
        status: 'active',
        version: 1,
        grantedBy: approvedBy,
        revoked: false,
        revokedBy: null,
      }))
    )),
    roleTemplates: normalized.roleTemplates.map(template => ({
      companyId,
      templateKey: template.templateKey,
      templateVersion: template.templateVersion,
      catalogVersion: normalizedCatalogVersion,
      displayName: template.displayName,
      status: 'active',
    })),
    roleTemplateCapabilities: normalized.roleTemplates.flatMap(template => (
      template.capabilities.map(capabilityKey => ({
        companyId,
        templateKey: template.templateKey,
        templateVersion: template.templateVersion,
        catalogVersion: normalizedCatalogVersion,
        capabilityKey,
      }))
    )),
    capabilityAssignments: normalized.memberships.flatMap(membership => (
      membership.capabilityAssignments.map(assignment => ({
        membershipId: membership.id,
        companyId,
        catalogVersion: normalizedCatalogVersion,
        capabilityKey: assignment.capabilityKey,
        effect: assignment.effect,
        status: 'active',
        version: 1,
        grantedBy: approvedBy,
        revoked: false,
        revokedBy: null,
      }))
    )),
  });
}

function calculateAuthorityFingerprint(snapshot) {
  if (
    !snapshot
    || snapshot.authoritySnapshotVersion !== AUTHORITY_SNAPSHOT_VERSION
  ) {
    validationFail(
      'PLATFORM_IDENTITY_AUTHORITY_SNAPSHOT_INVALID',
      'Authority snapshot version is invalid.',
      'authoritySnapshotVersion',
    );
  }
  return sha256(stableJson(snapshot));
}

function getAuthorityRowCounts(snapshot) {
  return Object.freeze({
    [CANONICAL_COMPANIES_TABLE]: snapshot.companies.length,
    [CANONICAL_BRANCHES_TABLE]: snapshot.branches.length,
    [COMPANY_MEMBERSHIPS_TABLE]: snapshot.memberships.length,
    [MEMBERSHIP_BRANCH_ACCESS_TABLE]: snapshot.branchAccess.length,
    [ROLE_TEMPLATES_TABLE]: snapshot.roleTemplates.length,
    [ROLE_TEMPLATE_CAPABILITIES_TABLE]: snapshot.roleTemplateCapabilities.length,
    [MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE]: snapshot.capabilityAssignments.length,
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJsonCollection(db, name) {
  const exists = db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_data'
  `).get();
  if (!exists) return [];
  const row = db.prepare('SELECT json FROM app_data WHERE name = ?').get(name);
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.json);
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch {
    return [];
  }
}

function normalizedSecurityFlag(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function readUsersDirectorySnapshot(db) {
  const exists = db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_data'
  `).get();
  if (!exists) {
    return Object.freeze({
      ok: false,
      errorCode: 'USERS_DIRECTORY_TABLE_MISSING',
      users: Object.freeze([]),
      records: Object.freeze([]),
      duplicateUserIds: Object.freeze([]),
      missingUserIdIndexes: Object.freeze([]),
      eligibleActiveUserIds: Object.freeze([]),
      fingerprint: sha256(stableJson({ errorCode: 'USERS_DIRECTORY_TABLE_MISSING' })),
    });
  }
  const row = db.prepare('SELECT json FROM app_data WHERE name = ?').get('users');
  if (!row) {
    return Object.freeze({
      ok: false,
      errorCode: 'USERS_DIRECTORY_ROW_MISSING',
      users: Object.freeze([]),
      records: Object.freeze([]),
      duplicateUserIds: Object.freeze([]),
      missingUserIdIndexes: Object.freeze([]),
      eligibleActiveUserIds: Object.freeze([]),
      fingerprint: sha256(stableJson({ errorCode: 'USERS_DIRECTORY_ROW_MISSING' })),
    });
  }
  let users;
  try {
    users = JSON.parse(row.json);
  } catch {
    return Object.freeze({
      ok: false,
      errorCode: 'USERS_DIRECTORY_JSON_INVALID',
      users: Object.freeze([]),
      records: Object.freeze([]),
      duplicateUserIds: Object.freeze([]),
      missingUserIdIndexes: Object.freeze([]),
      eligibleActiveUserIds: Object.freeze([]),
      fingerprint: sha256(stableJson({ errorCode: 'USERS_DIRECTORY_JSON_INVALID' })),
    });
  }
  if (!Array.isArray(users)) {
    return Object.freeze({
      ok: false,
      errorCode: 'USERS_DIRECTORY_SHAPE_INVALID',
      users: Object.freeze([]),
      records: Object.freeze([]),
      duplicateUserIds: Object.freeze([]),
      missingUserIdIndexes: Object.freeze([]),
      eligibleActiveUserIds: Object.freeze([]),
      fingerprint: sha256(stableJson({ errorCode: 'USERS_DIRECTORY_SHAPE_INVALID' })),
    });
  }

  const idCounts = new Map();
  const missingUserIdIndexes = [];
  const records = users.map((user, index) => {
    const id = user && typeof user.id === 'string' ? user.id.trim() : '';
    if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1);
    else missingUserIdIndexes.push(index);
    return Object.freeze({
      id: id || null,
      status: user && typeof user.status === 'string' ? user.status : null,
      botOnly: normalizedSecurityFlag(user?.botOnly),
      allowFrontendLogin: normalizedSecurityFlag(user?.allowFrontendLogin),
      frontendAccess: normalizedSecurityFlag(user?.frontendAccess),
    });
  }).sort((left, right) => (
    String(left.id || '').localeCompare(String(right.id || ''))
    || stableJson(left).localeCompare(stableJson(right))
  ));
  const duplicateUserIds = [...idCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => Object.freeze({ id, count }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const eligibleActiveUserIds = [...new Set(users
    .filter(isEligiblePlatformUser)
    .map(user => String(user.id || '').trim())
    .filter(Boolean))]
    .sort();
  const frozenRecords = Object.freeze(records);
  return Object.freeze({
    ok: true,
    errorCode: null,
    users: Object.freeze(users),
    records: frozenRecords,
    duplicateUserIds: Object.freeze(duplicateUserIds),
    missingUserIdIndexes: Object.freeze(missingUserIdIndexes),
    eligibleActiveUserIds: Object.freeze(eligibleActiveUserIds),
    fingerprint: sha256(stableJson({
      records: frozenRecords,
      duplicateUserIds,
      missingUserIdIndexes,
      eligibleActiveUserIds,
    })),
  });
}

function getUsersDirectoryFingerprint(db) {
  return readUsersDirectorySnapshot(db).fingerprint;
}

function tableCount(db, table) {
  const exists = db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(table);
  if (!exists) return null;
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
}

function listMigrations(db) {
  const exists = db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = 'sql_shadow_schema_migrations'
  `).get();
  if (!exists) return [];
  return db.prepare(`
    SELECT name, version, applied_at
    FROM sql_shadow_schema_migrations
    ORDER BY name
  `).all();
}

function getSchemaFingerprint(db) {
  const objects = db.prepare(`
    SELECT type, name, tbl_name AS tableName, COALESCE(sql, '') AS sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
      AND (
        name IN (
          'canonical_companies',
          'canonical_branches',
          'company_memberships',
          'membership_branch_access',
          'capability_catalog_versions',
          'capability_catalog_entries',
          'role_templates',
          'role_template_capabilities',
          'membership_capability_assignments',
          'authorization_audit_events',
          'identity_bootstrap_runs',
          'sql_shadow_schema_migrations'
        )
        OR name LIKE 'trg_canonical_companies_%'
        OR name LIKE 'trg_canonical_branches_%'
        OR name LIKE 'trg_company_memberships_%'
        OR name LIKE 'trg_membership_branch_access_%'
        OR name LIKE 'trg_role_template_%'
        OR name LIKE 'trg_capability_catalog_%'
        OR name LIKE 'trg_membership_capability_%'
        OR name LIKE 'trg_authorization_audit_%'
        OR name LIKE 'trg_identity_bootstrap_%'
        OR name LIKE 'uq_canonical_branches_%'
        OR name LIKE 'uq_company_memberships_%'
        OR name LIKE 'uq_membership_%'
        OR name LIKE 'uq_capability_catalog_%'
        OR name LIKE 'uq_identity_bootstrap_%'
      )
    ORDER BY type, name
  `).all();
  const migrations = listMigrations(db).filter(migration => [
    'canonical_receivables_pr1_schema',
    'canonical_receivables_pr2_settlement',
    'platform_identity_pr5',
  ].includes(migration.name));
  return sha256(stableJson({ objects, migrations }));
}

function inspectPlatformIdentity(db, env = process.env) {
  const usersDirectory = readUsersDirectorySnapshot(db);
  const userHints = usersDirectory.users.map(user => {
    const id = typeof user?.id === 'string' ? user.id.trim() : '';
    return {
      id: id || null,
      status: typeof user?.status === 'string' ? user.status : null,
      displayRoleHint: typeof user?.role === 'string' ? user.role : null,
    };
  });

  const settings = readJsonCollection(db, 'app_settings');
  const companyLikeSettings = settings
    .filter(item => /company|branch|region|location|timezone/i.test(String(item?.key || item?.name || '')))
    .map(item => ({ key: String(item?.key || item?.name || '') }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const candidateCounts = new Map();
  for (const collection of ['equipment', 'rentals', 'deliveries', 'service']) {
    for (const item of readJsonCollection(db, collection)) {
      for (const field of ['location', 'branch', 'region']) {
        const value = typeof item?.[field] === 'string' ? item[field].trim() : '';
        if (!value) continue;
        const key = `${collection}:${field}:${value}`;
        candidateCounts.set(key, (candidateCounts.get(key) || 0) + 1);
      }
    }
  }
  const locationCandidates = [...candidateCounts.entries()]
    .map(([key, count]) => {
      const [collection, field, ...value] = key.split(':');
      return { collection, field, value: value.join(':'), count };
    })
    .sort((a, b) => (
      a.collection.localeCompare(b.collection)
      || a.field.localeCompare(b.field)
      || a.value.localeCompare(b.value)
    ));

  const tables = [
    CANONICAL_COMPANIES_TABLE,
    CANONICAL_BRANCHES_TABLE,
    COMPANY_MEMBERSHIPS_TABLE,
    MEMBERSHIP_BRANCH_ACCESS_TABLE,
    ROLE_TEMPLATES_TABLE,
    ROLE_TEMPLATE_CAPABILITIES_TABLE,
    MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE,
    'authorization_audit_events',
    IDENTITY_BOOTSTRAP_RUNS_TABLE,
    ...FINANCIAL_TABLES,
  ];
  return Object.freeze({
    mode: 'inspect',
    writes: 0,
    users: userHints,
    duplicateUserIds: usersDirectory.duplicateUserIds,
    missingUserIdIndexes: usersDirectory.missingUserIdIndexes,
    eligibleActiveUserIds: usersDirectory.eligibleActiveUserIds,
    usersDirectoryFingerprint: usersDirectory.fingerprint,
    companyLikeSettings,
    locationCandidates,
    migrations: listMigrations(db),
    tableCounts: Object.fromEntries(tables.map(table => [table, tableCount(db, table)])),
    foreignKeysEnabled: db.pragma('foreign_keys', { simple: true }) === 1,
    foreignKeyFailures: db.pragma('foreign_key_check'),
    schemaFingerprint: getSchemaFingerprint(db),
    canonicalReadFeatureEnabled: String(env.CANONICAL_RECEIVABLES_READ_API_ENABLED || '').toLowerCase() === 'true',
    productionResolver: 'unconditional-null',
  });
}

function unknownKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).filter(key => !allowed.has(key));
}

function pushUnknownKeyBlockers(blockers, value, allowed, path) {
  for (const key of unknownKeys(value, allowed)) {
    const isInference = LEGACY_INFERENCE_KEYS.has(key);
    blockers.push({
      code: isInference ? 'LEGACY_ROLE_INFERENCE_FORBIDDEN' : 'UNKNOWN_CONFIG_FIELD',
      path: `${path}.${key}`,
    });
  }
}

function canonicalText(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function canonicalArray(value, mapper) {
  if (!Array.isArray(value)) return value;
  return value.map(mapper).sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

function authorityPayload(config = {}) {
  const branches = canonicalArray(config.branches, branch => ({
    id: canonicalText(branch?.id),
    displayName: canonicalText(branch?.displayName),
    isHeadOffice: branch?.isHeadOffice === true,
    status: branch?.status || 'active',
  }));
  const roleTemplates = canonicalArray(config.roleTemplates, template => ({
    templateKey: canonicalText(template?.templateKey),
    templateVersion: template?.templateVersion,
    displayName: canonicalText(template?.displayName),
    capabilities: Array.isArray(template?.capabilities)
      ? [...new Set(template.capabilities.map(canonicalText))].sort()
      : template?.capabilities,
  }));
  const memberships = canonicalArray(config.memberships, membership => ({
    id: canonicalText(membership?.id),
    principalId: canonicalText(membership?.principalId),
    status: membership?.status || 'active',
    roleTemplateKey: canonicalText(membership?.roleTemplateKey),
    roleTemplateVersion: membership?.roleTemplateVersion,
    companyWideBranchAuthority: membership?.companyWideBranchAuthority === true,
    branchIds: Array.isArray(membership?.branchIds)
      ? [...new Set(membership.branchIds.map(canonicalText))].sort()
      : membership?.branchIds,
    capabilityAssignments: canonicalArray(
      membership?.capabilityAssignments,
      assignment => ({
        capabilityKey: canonicalText(assignment?.capabilityKey),
        effect: assignment?.effect,
      }),
    ),
  }));
  return {
    configVersion: config.configVersion,
    company: config.company && {
      id: canonicalText(config.company.id),
      displayName: canonicalText(config.company.displayName),
      receivablesTimezone: canonicalText(config.company.receivablesTimezone),
    },
    branches,
    roleTemplates,
    memberships,
    intentionallyUnmappedUserIds: Array.isArray(config.intentionallyUnmappedUserIds)
      ? [...new Set(config.intentionallyUnmappedUserIds.map(canonicalText))].sort()
      : config.intentionallyUnmappedUserIds,
  };
}

function calculateBootstrapChecksum(db, config) {
  const authority = authorityPayload(config);
  assertNoSecrets(authority);
  const usersDirectory = readUsersDirectorySnapshot(db);
  const mappedUserIds = [...new Set(
    (Array.isArray(authority.memberships) ? authority.memberships : [])
      .map(membership => String(membership?.principalId || '').trim())
      .filter(Boolean),
  )].sort();
  const intentionallyUnmappedUserIds = [...new Set(
    (Array.isArray(authority.intentionallyUnmappedUserIds)
      ? authority.intentionallyUnmappedUserIds
      : [])
      .map(value => String(value || '').trim())
      .filter(Boolean),
  )].sort();
  return sha256(stableJson({
    authority,
    approvedSchemaFingerprint: canonicalText(config?.approval?.schemaFingerprint) || null,
    usersDirectoryFingerprint: usersDirectory.fingerprint,
    mappingPlan: {
      mappedUserIds,
      intentionallyUnmappedUserIds,
      eligibleActiveUserIds: usersDirectory.eligibleActiveUserIds,
      approvedBy: String(config?.approval?.approvedBy || '').trim() || null,
    },
  }));
}

function validateBootstrapConfig(db, config = {}) {
  const blockers = [];
  const warnings = [];
  let schemaFingerprint = null;
  try {
    assertPlatformIdentityStructure(db);
    schemaFingerprint = getSchemaFingerprint(db);
  } catch (error) {
    blockers.push({ code: 'SCHEMA_INVALID', detail: error.code || error.message });
  }
  try {
    assertNoSecrets(config);
  } catch (error) {
    blockers.push({ code: error.code || 'SECRET_CONTENT_REJECTED' });
  }
  pushUnknownKeyBlockers(blockers, config, AUTHORITY_CONFIG_KEYS, 'config');
  pushUnknownKeyBlockers(blockers, config.company, COMPANY_KEYS, 'company');
  pushUnknownKeyBlockers(blockers, config.approval, APPROVAL_KEYS, 'approval');

  if (!Number.isSafeInteger(config.configVersion) || config.configVersion < 1) {
    blockers.push({ code: 'CONFIG_VERSION_INVALID', path: 'configVersion' });
  }

  let company = null;
  try {
    company = {
      id: requiredId(config.company?.id, 'company.id'),
      displayName: requiredId(config.company?.displayName, 'company.displayName'),
      receivablesTimezone: assertIanaTimezone(config.company?.receivablesTimezone),
    };
  } catch (error) {
    blockers.push({ code: error.code || 'COMPANY_INVALID', path: error.field || 'company' });
  }

  const branches = [];
  const branchIds = new Set();
  for (const [index, branch] of (Array.isArray(config.branches) ? config.branches : []).entries()) {
    pushUnknownKeyBlockers(blockers, branch, BRANCH_KEYS, `branches[${index}]`);
    try {
      const normalized = {
        id: assertBranchId(branch.id),
        displayName: requiredId(branch.displayName, `branches[${index}].displayName`),
        isHeadOffice: branch.isHeadOffice === true,
        status: branch.status || 'active',
      };
      if (!['inactive', 'active', 'archived'].includes(normalized.status)) {
        blockers.push({ code: 'BRANCH_STATUS_INVALID', path: `branches[${index}].status` });
      }
      if (branchIds.has(normalized.id)) {
        blockers.push({ code: 'BRANCH_ID_DUPLICATE', path: `branches[${index}].id` });
      }
      branchIds.add(normalized.id);
      branches.push(normalized);
    } catch (error) {
      blockers.push({ code: error.code || 'BRANCH_INVALID', path: error.field || `branches[${index}]` });
    }
  }
  if (branches.length === 0) blockers.push({ code: 'BRANCH_REQUIRED', path: 'branches' });
  if (branches.filter(branch => branch.isHeadOffice && branch.status === 'active').length !== 1) {
    blockers.push({ code: 'HEAD_OFFICE_INVALID', path: 'branches' });
  }

  const templateKeys = new Map();
  const roleTemplates = [];
  for (const [index, template] of (Array.isArray(config.roleTemplates) ? config.roleTemplates : []).entries()) {
    pushUnknownKeyBlockers(blockers, template, TEMPLATE_KEYS, `roleTemplates[${index}]`);
    try {
      const templateKey = requiredId(template.templateKey, `roleTemplates[${index}].templateKey`);
      const templateVersion = template.templateVersion;
      if (!Number.isSafeInteger(templateVersion) || templateVersion < 1) {
        blockers.push({ code: 'TEMPLATE_VERSION_INVALID', path: `roleTemplates[${index}].templateVersion` });
      }
      const key = `${templateKey}:${templateVersion}`;
      if (templateKeys.has(key)) blockers.push({ code: 'TEMPLATE_DUPLICATE', path: `roleTemplates[${index}]` });
      const capabilities = [...new Set(Array.isArray(template.capabilities) ? template.capabilities : [])].sort();
      for (const capability of capabilities) {
        if (!KNOWN_CAPABILITIES.has(capability)) {
          blockers.push({ code: 'CAPABILITY_REJECTED', path: `roleTemplates[${index}].capabilities` });
        }
      }
      const normalized = {
        templateKey,
        templateVersion,
        displayName: requiredId(template.displayName, `roleTemplates[${index}].displayName`),
        capabilities,
      };
      templateKeys.set(key, normalized);
      roleTemplates.push(normalized);
    } catch (error) {
      blockers.push({ code: error.code || 'TEMPLATE_INVALID', path: error.field || `roleTemplates[${index}]` });
    }
  }
  if (roleTemplates.length === 0) {
    blockers.push({ code: 'ROLE_TEMPLATE_REQUIRED', path: 'roleTemplates' });
  }

  const usersDirectory = readUsersDirectorySnapshot(db);
  if (!usersDirectory.ok) {
    blockers.push({ code: usersDirectory.errorCode, path: 'app_data.users' });
  }
  usersDirectory.missingUserIdIndexes.forEach(index => {
    blockers.push({ code: 'USER_ID_MISSING', path: `app_data.users[${index}]` });
  });
  usersDirectory.duplicateUserIds.forEach(({ id }) => {
    blockers.push({ code: 'USER_ID_DUPLICATE', path: `app_data.users.${id}` });
  });
  const users = usersDirectory.users;
  const usersById = new Map();
  for (const user of users) {
    const id = typeof user?.id === 'string' ? user.id.trim() : '';
    if (!id || usersById.has(id)) continue;
    usersById.set(id, user);
  }

  const membershipPrincipalIds = new Set();
  const membershipIds = new Set();
  const memberships = [];
  for (const [index, membership] of (Array.isArray(config.memberships) ? config.memberships : []).entries()) {
    pushUnknownKeyBlockers(blockers, membership, MEMBERSHIP_KEYS, `memberships[${index}]`);
    try {
      const id = requiredId(membership.id, `memberships[${index}].id`);
      const principalId = requiredId(membership.principalId, `memberships[${index}].principalId`);
      const status = membership.status || 'active';
      const roleTemplateKey = requiredId(
        membership.roleTemplateKey,
        `memberships[${index}].roleTemplateKey`,
      );
      const roleTemplateVersion = membership.roleTemplateVersion;
      const companyWideBranchAuthority = membership.companyWideBranchAuthority === true;
      const explicitBranches = [...new Set(
        (Array.isArray(membership.branchIds) ? membership.branchIds : []).map(assertBranchId),
      )].sort();
      const assignments = [];
      const assignmentKeys = new Set();
      for (const [assignmentIndex, assignment] of (
        Array.isArray(membership.capabilityAssignments)
          ? membership.capabilityAssignments
          : []
      ).entries()) {
        pushUnknownKeyBlockers(
          blockers,
          assignment,
          ASSIGNMENT_KEYS,
          `memberships[${index}].capabilityAssignments[${assignmentIndex}]`,
        );
        if (!KNOWN_CAPABILITIES.has(assignment.capabilityKey)) {
          blockers.push({
            code: 'CAPABILITY_REJECTED',
            path: `memberships[${index}].capabilityAssignments[${assignmentIndex}]`,
          });
        }
        if (!['grant', 'deny'].includes(assignment.effect)) {
          blockers.push({
            code: 'ASSIGNMENT_EFFECT_INVALID',
            path: `memberships[${index}].capabilityAssignments[${assignmentIndex}]`,
          });
        }
        if (assignmentKeys.has(assignment.capabilityKey)) {
          blockers.push({
            code: 'ASSIGNMENT_CONFLICT',
            path: `memberships[${index}].capabilityAssignments`,
          });
        }
        assignmentKeys.add(assignment.capabilityKey);
        assignments.push({
          capabilityKey: assignment.capabilityKey,
          effect: assignment.effect,
        });
      }
      if (!['pending', 'active', 'inactive', 'revoked'].includes(status)) {
        blockers.push({ code: 'MEMBERSHIP_STATUS_INVALID', path: `memberships[${index}].status` });
      }
      if (!Number.isSafeInteger(roleTemplateVersion) || roleTemplateVersion < 1) {
        blockers.push({
          code: 'TEMPLATE_VERSION_INVALID',
          path: `memberships[${index}].roleTemplateVersion`,
        });
      }
      if (!templateKeys.has(`${roleTemplateKey}:${roleTemplateVersion}`)) {
        blockers.push({ code: 'TEMPLATE_UNKNOWN', path: `memberships[${index}]` });
      }
      if (!usersById.has(principalId) || !isEligiblePlatformUser(usersById.get(principalId))) {
        blockers.push({ code: 'MEMBERSHIP_USER_INVALID', path: `memberships[${index}].principalId` });
      }
      if (membershipIds.has(id)) blockers.push({ code: 'MEMBERSHIP_ID_DUPLICATE', path: `memberships[${index}].id` });
      if (membershipPrincipalIds.has(principalId)) {
        blockers.push({ code: 'MEMBERSHIP_PRINCIPAL_DUPLICATE', path: `memberships[${index}].principalId` });
      }
      membershipIds.add(id);
      membershipPrincipalIds.add(principalId);
      if (companyWideBranchAuthority && explicitBranches.length > 0) {
        blockers.push({ code: 'BRANCH_MODE_CONFLICT', path: `memberships[${index}]` });
      }
      if (!companyWideBranchAuthority && status === 'active' && explicitBranches.length === 0) {
        blockers.push({ code: 'EMPTY_BRANCH_SCOPE', path: `memberships[${index}].branchIds` });
      }
      const boundTemplate = templateKeys.get(`${roleTemplateKey}:${roleTemplateVersion}`);
      if (
        !companyWideBranchAuthority
        && boundTemplate?.capabilities.some(capability => COMPANY_SCOPED_CAPABILITIES.has(capability))
      ) {
        blockers.push({
          code: 'COMPANY_CAPABILITY_SCOPE_CONFLICT',
          path: `memberships[${index}].roleTemplateKey`,
        });
      }
      if (
        !companyWideBranchAuthority
        && assignments.some(assignment => (
          assignment.effect === 'grant'
          && COMPANY_SCOPED_CAPABILITIES.has(assignment.capabilityKey)
        ))
      ) {
        blockers.push({
          code: 'COMPANY_CAPABILITY_SCOPE_CONFLICT',
          path: `memberships[${index}].capabilityAssignments`,
        });
      }
      for (const branchId of explicitBranches) {
        const branch = branches.find(item => item.id === branchId);
        if (!branch || branch.status !== 'active') {
          blockers.push({ code: 'MEMBERSHIP_BRANCH_INVALID', path: `memberships[${index}].branchIds` });
        }
      }
      memberships.push({
        id,
        principalId,
        status,
        roleTemplateKey,
        roleTemplateVersion,
        companyWideBranchAuthority,
        branchIds: explicitBranches,
        capabilityAssignments: assignments,
      });
    } catch (error) {
      blockers.push({ code: error.code || 'MEMBERSHIP_INVALID', path: error.field || `memberships[${index}]` });
    }
  }

  let intentionallyUnmappedUserIds = [];
  try {
    intentionallyUnmappedUserIds = [...new Set(
      Array.isArray(config.intentionallyUnmappedUserIds)
        ? config.intentionallyUnmappedUserIds.map(id => requiredId(id, 'intentionallyUnmappedUserIds'))
        : [],
    )].sort();
  } catch (error) {
    blockers.push({
      code: error.code || 'UNMAPPED_USER_INVALID',
      path: error.field || 'intentionallyUnmappedUserIds',
    });
  }
  const unmapped = new Set(intentionallyUnmappedUserIds);
  for (const userId of intentionallyUnmappedUserIds) {
    if (!usersById.has(userId)) blockers.push({ code: 'UNMAPPED_USER_UNKNOWN', path: 'intentionallyUnmappedUserIds' });
    if (membershipPrincipalIds.has(userId)) blockers.push({ code: 'USER_MAPPING_CONFLICT', path: 'intentionallyUnmappedUserIds' });
  }
  for (const userId of usersDirectory.eligibleActiveUserIds) {
    if (!membershipPrincipalIds.has(userId) && !unmapped.has(userId)) {
      blockers.push({ code: 'ACTIVE_USER_UNRESOLVED', path: `app_data.users.${userId}` });
    }
  }

  const financialCounts = Object.fromEntries(FINANCIAL_TABLES.map(table => [table, tableCount(db, table)]));
  for (const [table, count] of Object.entries(financialCounts)) {
    if (count !== 0) blockers.push({ code: 'FINANCIAL_ROWS_PRESENT', table, count });
  }
  const identityCounts = Object.fromEntries([
    CANONICAL_COMPANIES_TABLE,
    CANONICAL_BRANCHES_TABLE,
    COMPANY_MEMBERSHIPS_TABLE,
    MEMBERSHIP_BRANCH_ACCESS_TABLE,
    ROLE_TEMPLATES_TABLE,
    ROLE_TEMPLATE_CAPABILITIES_TABLE,
    MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE,
    'authorization_audit_events',
    IDENTITY_BOOTSTRAP_RUNS_TABLE,
  ].map(table => [table, tableCount(db, table)]));
  if (Object.values(identityCounts).some(count => count !== 0)) {
    warnings.push({ code: 'IDENTITY_AUTHORITY_NOT_EMPTY', counts: identityCounts });
  }
  if (db.pragma('foreign_keys', { simple: true }) !== 1) blockers.push({ code: 'FOREIGN_KEYS_DISABLED' });
  const foreignKeyFailures = db.pragma('foreign_key_check');
  if (foreignKeyFailures.length > 0) blockers.push({ code: 'FOREIGN_KEY_CHECK_FAILED', failures: foreignKeyFailures });

  let configChecksum = null;
  try {
    configChecksum = calculateBootstrapChecksum(db, config);
  } catch (error) {
    blockers.push({ code: error.code || 'CHECKSUM_FAILED' });
  }
  const approval = config.approval || {};
  for (const field of ['approvedBy', 'approvedAt', 'approvalReference', 'backupReference']) {
    if (typeof approval[field] !== 'string' || !approval[field].trim()) {
      blockers.push({ code: 'APPROVAL_METADATA_REQUIRED', path: `approval.${field}` });
    }
  }
  if (typeof approval.configChecksum !== 'string' || !/^[a-f0-9]{64}$/.test(approval.configChecksum)) {
    blockers.push({ code: 'APPROVAL_CHECKSUM_INVALID', path: 'approval.configChecksum' });
  }
  if (typeof approval.schemaFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(approval.schemaFingerprint)) {
    blockers.push({ code: 'APPROVAL_SCHEMA_FINGERPRINT_INVALID', path: 'approval.schemaFingerprint' });
  }
  if (approval.configChecksum !== configChecksum) {
    blockers.push({ code: 'APPROVAL_CHECKSUM_MISMATCH', path: 'approval.configChecksum' });
  }
  if (!schemaFingerprint || approval.schemaFingerprint !== schemaFingerprint) {
    blockers.push({ code: 'APPROVAL_SCHEMA_MISMATCH', path: 'approval.schemaFingerprint' });
  }
  const bootstrapOperatorMatches = users.filter(user => (
    user
    && typeof user.id === 'string'
    && user.id.trim() === approval.approvedBy
  ));
  if (
    bootstrapOperatorMatches.length !== 1
    || !isEligiblePlatformUser(bootstrapOperatorMatches[0])
  ) {
    blockers.push({ code: 'BOOTSTRAP_OPERATOR_INVALID', path: 'approval.approvedBy' });
  }
  const mappedUserIds = [...membershipPrincipalIds].sort();

  return Object.freeze({
    mode: 'validate',
    writes: 0,
    ok: blockers.length === 0,
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
    configChecksum,
    schemaFingerprint,
    usersDirectoryFingerprint: usersDirectory.fingerprint,
    eligibleActiveUserIds: usersDirectory.eligibleActiveUserIds,
    mappedUserIds: Object.freeze(mappedUserIds),
    intentionallyUnmappedUserIds: Object.freeze(intentionallyUnmappedUserIds),
    approvedBy: approval.approvedBy,
    foreignKeyFailures,
    financialCounts: Object.freeze(financialCounts),
    identityCounts: Object.freeze(identityCounts),
    normalized: deepFreeze({
      configVersion: config.configVersion,
      company,
      branches,
      roleTemplates,
      memberships,
      intentionallyUnmappedUserIds,
      usersDirectoryFingerprint: usersDirectory.fingerprint,
      eligibleActiveUserIds: usersDirectory.eligibleActiveUserIds,
      mappedUserIds,
      approval: {
        approvedBy: approval.approvedBy,
        approvedAt: approval.approvedAt,
        approvalReference: approval.approvalReference,
        backupReference: approval.backupReference,
      },
    }),
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function approvedConfigFromValidation(validation, approval = {}) {
  const normalized = validation.normalized;
  return {
    configVersion: normalized.configVersion,
    company: normalized.company,
    branches: normalized.branches,
    roleTemplates: normalized.roleTemplates,
    memberships: normalized.memberships,
    intentionallyUnmappedUserIds: normalized.intentionallyUnmappedUserIds,
    approval: {
      approvedBy: approval.approvedBy,
      approvedAt: approval.approvedAt,
      approvalReference: approval.approvalReference,
      backupReference: approval.backupReference,
      configChecksum: approval.configChecksum,
      schemaFingerprint: approval.schemaFingerprint,
    },
  };
}

function planPlatformIdentityBootstrap(db, config) {
  const validation = validateBootstrapConfig(db, config);
  const normalized = validation.normalized;
  const changes = normalized.company ? {
    companies: 1,
    branches: normalized.branches.length,
    roleTemplates: normalized.roleTemplates.length,
    roleTemplateCapabilities: normalized.roleTemplates
      .reduce((total, template) => total + template.capabilities.length, 0),
    memberships: normalized.memberships.length,
    branchGrants: normalized.memberships
      .reduce((total, membership) => total + membership.branchIds.length, 0),
    capabilityAssignments: normalized.memberships
      .reduce((total, membership) => total + membership.capabilityAssignments.length, 0),
  } : {};
  changes.authorizationAuditEvents = normalized.company
    ? changes.companies
      + changes.branches
      + changes.roleTemplates
      + changes.memberships
      + changes.branchGrants
      + changes.capabilityAssignments
    : 0;
  changes.bootstrapRuns = normalized.company ? 1 : 0;
  const afterCounts = { ...validation.identityCounts };
  for (const [key, count] of Object.entries({
    [CANONICAL_COMPANIES_TABLE]: changes.companies || 0,
    [CANONICAL_BRANCHES_TABLE]: changes.branches || 0,
    [ROLE_TEMPLATES_TABLE]: changes.roleTemplates || 0,
    [ROLE_TEMPLATE_CAPABILITIES_TABLE]: changes.roleTemplateCapabilities || 0,
    [COMPANY_MEMBERSHIPS_TABLE]: changes.memberships || 0,
    [MEMBERSHIP_BRANCH_ACCESS_TABLE]: changes.branchGrants || 0,
    [MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE]: changes.capabilityAssignments || 0,
    authorization_audit_events: changes.authorizationAuditEvents || 0,
    [IDENTITY_BOOTSTRAP_RUNS_TABLE]: changes.bootstrapRuns || 0,
  })) {
    afterCounts[key] = Number(afterCounts[key] || 0) + count;
  }
  return deepFreeze({
    mode: 'plan',
    writes: 0,
    ok: validation.ok,
    configChecksum: validation.configChecksum,
    schemaFingerprint: validation.schemaFingerprint,
    usersDirectoryFingerprint: validation.usersDirectoryFingerprint,
    mappedUserIds: validation.mappedUserIds,
    intentionallyUnmappedUserIds: validation.intentionallyUnmappedUserIds,
    eligibleActiveUserIds: validation.eligibleActiveUserIds,
    approvedBy: validation.approvedBy,
    blockers: validation.blockers,
    warnings: validation.warnings,
    exactChanges: changes,
    beforeCounts: validation.identityCounts,
    afterCounts,
    financialCounts: validation.financialCounts,
    requiredApproval: {
      approvedConfigChecksum: validation.configChecksum,
      approvedSchemaFingerprint: validation.schemaFingerprint,
      approvedUsersDirectoryFingerprint: validation.usersDirectoryFingerprint,
      backupReferenceRequired: true,
    },
    approvedConfig: approvedConfigFromValidation(validation, config.approval),
    normalized,
  });
}

module.exports = {
  AUTHORITY_SNAPSHOT_VERSION,
  buildAuthoritySnapshotFromRows,
  buildExpectedAuthoritySnapshot,
  calculateBootstrapChecksum,
  calculateAuthorityFingerprint,
  deepFreeze,
  getAuthorityRowCounts,
  getSchemaFingerprint,
  getUsersDirectoryFingerprint,
  inspectPlatformIdentity,
  planPlatformIdentityBootstrap,
  readUsersDirectorySnapshot,
  tableCount,
  validateBootstrapConfig,
};
