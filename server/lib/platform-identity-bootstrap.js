const crypto = require('crypto');
const {
  CANONICAL_BRANCHES_TABLE,
  CANONICAL_COMPANIES_TABLE,
} = require('./canonical-receivables-schema');
const {
  CAPABILITY_CATALOG_V1,
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
const {
  assertBranchId,
  assertIanaTimezone,
  assertNoSecrets,
  createPlatformIdentityRepository,
  requiredId,
} = require('./platform-identity-repository');

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
  const users = readJsonCollection(db, 'users');
  const idCounts = new Map();
  const userHints = users.map(user => {
    const id = typeof user?.id === 'string' ? user.id.trim() : '';
    if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1);
    return {
      id: id || null,
      status: typeof user?.status === 'string' ? user.status : null,
      displayRoleHint: typeof user?.role === 'string' ? user.role : null,
    };
  });
  const duplicateUserIds = [...idCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ id, count }));
  const missingUserIdIndexes = userHints
    .map((user, index) => user.id ? null : index)
    .filter(index => index !== null);

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
    duplicateUserIds,
    missingUserIdIndexes,
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

function authorityPayload(config = {}) {
  return {
    configVersion: config.configVersion,
    company: config.company,
    branches: config.branches,
    roleTemplates: config.roleTemplates,
    memberships: config.memberships,
    intentionallyUnmappedUserIds: config.intentionallyUnmappedUserIds,
  };
}

function calculateBootstrapChecksum(config) {
  assertNoSecrets(authorityPayload(config));
  return sha256(stableJson(authorityPayload(config)));
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

  const users = readJsonCollection(db, 'users');
  const usersById = new Map();
  for (const user of users) {
    const id = typeof user?.id === 'string' ? user.id.trim() : '';
    if (!id) {
      blockers.push({ code: 'USER_ID_MISSING', path: 'app_data.users' });
      continue;
    }
    if (usersById.has(id)) blockers.push({ code: 'USER_ID_DUPLICATE', path: `app_data.users.${id}` });
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
      if (!usersById.has(principalId) || usersById.get(principalId)?.status !== 'Активен') {
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
  for (const [userId, user] of usersById.entries()) {
    if (user.status === 'Активен' && !membershipPrincipalIds.has(userId) && !unmapped.has(userId)) {
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
    configChecksum = calculateBootstrapChecksum(config);
  } catch (error) {
    blockers.push({ code: error.code || 'CHECKSUM_FAILED' });
  }
  const approval = config.approval || {};
  for (const field of ['approvedBy', 'approvedAt', 'approvalReference', 'backupReference']) {
    if (typeof approval[field] !== 'string' || !approval[field].trim()) {
      blockers.push({ code: 'APPROVAL_METADATA_REQUIRED', path: `approval.${field}` });
    }
  }
  if (approval.configChecksum !== configChecksum) {
    blockers.push({ code: 'APPROVAL_CHECKSUM_MISMATCH', path: 'approval.configChecksum' });
  }
  if (!schemaFingerprint || approval.schemaFingerprint !== schemaFingerprint) {
    blockers.push({ code: 'APPROVAL_SCHEMA_MISMATCH', path: 'approval.schemaFingerprint' });
  }
  if (!usersById.has(approval.approvedBy) || usersById.get(approval.approvedBy)?.status !== 'Активен') {
    blockers.push({ code: 'BOOTSTRAP_OPERATOR_INVALID', path: 'approval.approvedBy' });
  }

  return Object.freeze({
    mode: 'validate',
    writes: 0,
    ok: blockers.length === 0,
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
    configChecksum,
    schemaFingerprint,
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
    blockers: validation.blockers,
    warnings: validation.warnings,
    exactChanges: changes,
    beforeCounts: validation.identityCounts,
    afterCounts,
    financialCounts: validation.financialCounts,
    requiredApproval: {
      approvedConfigChecksum: validation.configChecksum,
      approvedSchemaFingerprint: validation.schemaFingerprint,
      backupReferenceRequired: true,
    },
    normalized,
  });
}

function applyPlatformIdentityBootstrap(db, config, options = {}) {
  if (options.explicitApply !== true) {
    throw Object.assign(new Error('Bootstrap apply requires explicit --apply.'), {
      code: 'BOOTSTRAP_EXPLICIT_APPLY_REQUIRED',
    });
  }
  const plan = planPlatformIdentityBootstrap(db, config);
  if (!plan.ok) {
    throw Object.assign(new Error('Bootstrap validation has blockers.'), {
      code: 'BOOTSTRAP_BLOCKED',
      blockers: plan.blockers,
    });
  }
  if (options.expectedChecksum !== plan.configChecksum) {
    throw Object.assign(new Error('Bootstrap checksum confirmation mismatch.'), {
      code: 'BOOTSTRAP_CHECKSUM_CONFIRMATION_MISMATCH',
    });
  }
  if (Object.values(plan.beforeCounts).some(count => count !== 0)) {
    const existing = tableCount(db, IDENTITY_BOOTSTRAP_RUNS_TABLE);
    if (existing === 0) {
      throw Object.assign(new Error('Bootstrap apply requires an empty identity authority.'), {
        code: 'BOOTSTRAP_IDENTITY_NOT_EMPTY',
      });
    }
  }
  const nowIso = options.nowIso || (() => new Date().toISOString());
  const repository = createPlatformIdentityRepository(db, {
    nowIso,
    generateId: options.generateId,
    beforeAuditInsert: options.beforeAuditInsert,
    beforeBootstrapApply() {
      if (getSchemaFingerprint(db) !== plan.schemaFingerprint) {
        throw Object.assign(new Error('Bootstrap schema fingerprint changed before apply.'), {
          code: 'BOOTSTRAP_SCHEMA_CHANGED',
        });
      }
    },
  });
  return repository.applyBootstrapPlan({
    ...plan.normalized,
    configChecksum: plan.configChecksum,
    schemaFingerprint: plan.schemaFingerprint,
    correlationId: `identity-bootstrap-${plan.configChecksum.slice(0, 16)}`,
    startedAt: nowIso(),
    summary: {
      exactChanges: plan.exactChanges,
      beforeCounts: plan.beforeCounts,
      afterCounts: plan.afterCounts,
      financialCounts: plan.financialCounts,
    },
  });
}

function runPlatformIdentityBootstrap({ db, mode, config, env, ...options }) {
  if (mode === 'inspect') return inspectPlatformIdentity(db, env);
  if (mode === 'validate') return validateBootstrapConfig(db, config);
  if (mode === 'plan') return planPlatformIdentityBootstrap(db, config);
  if (mode === 'apply') return applyPlatformIdentityBootstrap(db, config, options);
  throw Object.assign(new Error('Bootstrap mode must be inspect, validate, plan, or apply.'), {
    code: 'BOOTSTRAP_MODE_INVALID',
  });
}

module.exports = {
  applyPlatformIdentityBootstrap,
  calculateBootstrapChecksum,
  getSchemaFingerprint,
  inspectPlatformIdentity,
  planPlatformIdentityBootstrap,
  runPlatformIdentityBootstrap,
  validateBootstrapConfig,
};
