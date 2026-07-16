const crypto = require('crypto');
const {
  CANONICAL_BRANCHES_TABLE,
  CANONICAL_COMPANIES_TABLE,
  CANONICAL_RECEIVABLES_MIGRATION_ID,
  CANONICAL_RECEIVABLES_SCHEMA_VERSION,
  CANONICAL_RECEIVABLES_TABLE,
  FINANCIAL_AUDIT_EVENTS_TABLE,
} = require('./canonical-receivables-schema');
const {
  CANONICAL_APPROVAL_REQUESTS_TABLE,
  CANONICAL_PAYMENT_ALLOCATIONS_TABLE,
  CANONICAL_PAYMENTS_TABLE,
  CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE,
  CANONICAL_RECEIVABLES_SETTLEMENT_MIGRATION_ID,
  CANONICAL_RECEIVABLES_SETTLEMENT_SCHEMA_VERSION,
} = require('./canonical-receivables-settlement-schema');

const PLATFORM_IDENTITY_SCHEMA_VERSION = 1;
const PLATFORM_IDENTITY_MIGRATION_ID = 'platform_identity_pr5';

const COMPANY_MEMBERSHIPS_TABLE = 'company_memberships';
const MEMBERSHIP_BRANCH_ACCESS_TABLE = 'membership_branch_access';
const CAPABILITY_CATALOG_VERSIONS_TABLE = 'capability_catalog_versions';
const CAPABILITY_CATALOG_ENTRIES_TABLE = 'capability_catalog_entries';
const ROLE_TEMPLATES_TABLE = 'role_templates';
const ROLE_TEMPLATE_CAPABILITIES_TABLE = 'role_template_capabilities';
const MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE = 'membership_capability_assignments';
const AUTHORIZATION_AUDIT_EVENTS_TABLE = 'authorization_audit_events';
const IDENTITY_BOOTSTRAP_RUNS_TABLE = 'identity_bootstrap_runs';

const PLATFORM_IDENTITY_TABLES = Object.freeze([
  COMPANY_MEMBERSHIPS_TABLE,
  MEMBERSHIP_BRANCH_ACCESS_TABLE,
  CAPABILITY_CATALOG_VERSIONS_TABLE,
  CAPABILITY_CATALOG_ENTRIES_TABLE,
  ROLE_TEMPLATES_TABLE,
  ROLE_TEMPLATE_CAPABILITIES_TABLE,
  MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE,
  AUTHORIZATION_AUDIT_EVENTS_TABLE,
  IDENTITY_BOOTSTRAP_RUNS_TABLE,
]);

const FINANCIAL_TABLES = Object.freeze([
  CANONICAL_RECEIVABLES_TABLE,
  FINANCIAL_AUDIT_EVENTS_TABLE,
  CANONICAL_PAYMENTS_TABLE,
  CANONICAL_PAYMENT_ALLOCATIONS_TABLE,
  CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE,
  CANONICAL_APPROVAL_REQUESTS_TABLE,
]);

const CAPABILITY_CATALOG_V1 = Object.freeze([
  Object.freeze({ key: 'billing.period.close', scopeKind: 'branch', assignable: true }),
  Object.freeze({ key: 'billing.period.reopen', scopeKind: 'branch', assignable: true }),
  Object.freeze({ key: 'branches.manage', scopeKind: 'company', assignable: true }),
  Object.freeze({ key: 'companies.manage', scopeKind: 'company', assignable: true }),
  Object.freeze({ key: 'forecast.calculate', scopeKind: 'branch', assignable: true }),
  Object.freeze({ key: 'forecast.read', scopeKind: 'branch', assignable: true }),
  Object.freeze({ key: 'members.manage', scopeKind: 'company', assignable: true }),
  Object.freeze({ key: 'receivables.read', scopeKind: 'branch', assignable: true }),
  Object.freeze({ key: 'upd.conduct', scopeKind: 'branch', assignable: true }),
  Object.freeze({ key: 'upd.correct', scopeKind: 'branch', assignable: true }),
  Object.freeze({ key: 'upd.form', scopeKind: 'branch', assignable: true }),
]);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const CAPABILITY_CATALOG_V1_CHECKSUM = crypto
  .createHash('sha256')
  .update(stableJson(CAPABILITY_CATALOG_V1))
  .digest('hex');

const ROOT_COMPANY_COLUMNS = Object.freeze([
  'id',
  'receivablesTimezone',
  'createdAt',
  'displayName',
  'status',
  'version',
  'updatedAt',
]);

const ROOT_BRANCH_COLUMNS = Object.freeze([
  'companyId',
  'id',
  'isHeadOffice',
  'createdAt',
  'displayName',
  'status',
  'version',
  'updatedAt',
]);

const REQUIRED_INDEXES = Object.freeze([
  'uq_canonical_branches_global_id',
  'uq_company_memberships_company_principal',
  'uq_membership_branch_access_active',
  'uq_membership_capability_active',
  'uq_capability_catalog_single_active',
  'uq_identity_bootstrap_success_checksum',
]);

const REQUIRED_TRIGGERS = Object.freeze([
  'trg_canonical_companies_no_delete',
  'trg_canonical_companies_immutable_id',
  'trg_canonical_companies_version',
  'trg_canonical_companies_active_insert',
  'trg_canonical_companies_active_head_office',
  'trg_canonical_branches_no_delete',
  'trg_canonical_branches_immutable_identity',
  'trg_canonical_branches_version',
  'trg_canonical_branches_sentinel_insert',
  'trg_canonical_branches_active_metadata',
  'trg_canonical_branches_active_metadata_update',
  'trg_canonical_branches_active_head_office',
  'trg_company_memberships_no_delete',
  'trg_company_memberships_immutable_identity',
  'trg_company_memberships_version',
  'trg_company_memberships_revoked_terminal',
  'trg_membership_branch_access_no_delete',
  'trg_membership_branch_access_version',
  'trg_role_templates_no_update',
  'trg_role_templates_no_delete',
  'trg_role_template_capabilities_no_update',
  'trg_role_template_capabilities_no_delete',
  'trg_capability_catalog_versions_no_update',
  'trg_capability_catalog_versions_no_delete',
  'trg_capability_catalog_entries_no_update',
  'trg_capability_catalog_entries_no_delete',
  'trg_membership_capability_assignments_no_delete',
  'trg_membership_capability_assignments_version',
  'trg_authorization_audit_events_no_update',
  'trg_authorization_audit_events_no_delete',
  'trg_authorization_audit_events_no_replace',
  'trg_identity_bootstrap_runs_no_update',
  'trg_identity_bootstrap_runs_no_delete',
]);

const CANONICAL_PREREQUISITE_OBJECTS = Object.freeze([
  ['index', 'uq_canonical_branches_head_office'],
  ['index', 'idx_canonical_receivables_company'],
  ['index', 'idx_canonical_receivables_company_branch'],
  ['index', 'idx_canonical_receivables_company_client'],
  ['index', 'idx_canonical_receivables_company_workflow'],
  ['index', 'idx_canonical_receivables_company_due_date'],
  ['index', 'uq_canonical_receivables_source_identity'],
  ['index', 'uq_canonical_receivables_idempotency'],
  ['index', 'uq_canonical_receivables_external_identity'],
  ['index', 'idx_financial_audit_events_company'],
  ['index', 'idx_financial_audit_events_company_branch'],
  ['index', 'idx_financial_audit_events_company_aggregate'],
  ['index', 'uq_canonical_receivables_company_id'],
  ['index', 'uq_canonical_receivables_company_id_branch'],
  ['index', 'uq_canonical_payments_idempotency'],
  ['index', 'uq_canonical_payments_external_identity'],
  ['index', 'uq_canonical_payment_single_reversal'],
  ['index', 'idx_canonical_payments_company_branch'],
  ['index', 'idx_canonical_payments_company_client'],
  ['index', 'uq_canonical_payment_allocations_idempotency'],
  ['index', 'uq_canonical_payment_allocation_reversal'],
  ['index', 'idx_canonical_payment_allocations_payment'],
  ['index', 'idx_canonical_payment_allocations_receivable'],
  ['index', 'uq_canonical_receivable_adjustments_idempotency'],
  ['index', 'uq_canonical_receivable_adjustment_reversal'],
  ['index', 'idx_canonical_receivable_adjustments_receivable'],
  ['index', 'idx_canonical_approval_requests_company_status'],
  ['index', 'idx_canonical_approval_requests_aggregate'],
  ['index', 'uq_canonical_approval_requests_pending_operation'],
  ['index', 'uq_canonical_approval_requests_financial_operation'],
  ['trigger', 'trg_canonical_receivables_posted_immutability'],
  ['trigger', 'trg_financial_audit_events_no_update'],
  ['trigger', 'trg_financial_audit_events_no_delete'],
  ['trigger', 'trg_financial_audit_events_no_replace'],
  ['trigger', 'trg_canonical_approval_requests_pending_identity_immutable'],
  ['trigger', 'trg_canonical_approval_requests_final_immutable'],
  ['trigger', 'trg_canonical_approval_requests_no_delete'],
  ['trigger', 'trg_canonical_payments_pending_identity_immutable'],
  ['trigger', 'trg_canonical_payments_final_business_immutable'],
  ['trigger', 'trg_canonical_payments_no_delete'],
  ['trigger', 'trg_canonical_payment_allocations_final_immutable'],
  ['trigger', 'trg_canonical_payment_allocations_no_delete'],
  ['trigger', 'trg_canonical_payment_allocations_pending_identity_immutable'],
  ['trigger', 'trg_canonical_payment_allocations_pending_approval_guard'],
  ['trigger', 'trg_canonical_receivable_adjustments_final_immutable'],
  ['trigger', 'trg_canonical_receivable_adjustments_no_delete'],
  ['trigger', 'trg_canonical_receivable_adjustments_pending_identity_immutable'],
  ['trigger', 'trg_canonical_payments_reversal_reference_guard'],
  ['trigger', 'trg_canonical_allocations_reversal_reference_guard'],
  ['trigger', 'trg_canonical_adjustments_reversal_reference_guard'],
  ['trigger', 'trg_canonical_allocations_approval_insert_guard'],
  ['trigger', 'trg_canonical_allocations_approval_update_guard'],
  ['trigger', 'trg_canonical_adjustments_approval_insert_guard'],
  ['trigger', 'trg_canonical_adjustments_approval_update_guard'],
  ['trigger', 'trg_canonical_refunds_approval_insert_guard'],
  ['trigger', 'trg_canonical_refunds_approval_update_guard'],
  ['trigger', 'trg_canonical_receivables_due_date_operation_guard'],
  ['trigger', 'trg_canonical_receivables_posted_cancellation_guard'],
  ['trigger', 'trg_canonical_allocations_confirm_insert_guard'],
  ['trigger', 'trg_canonical_allocations_confirm_update_guard'],
  ['trigger', 'trg_canonical_adjustments_confirm_insert_guard'],
  ['trigger', 'trg_canonical_adjustments_confirm_update_guard'],
  ['trigger', 'trg_canonical_refunds_confirm_insert_guard'],
  ['trigger', 'trg_canonical_refunds_confirm_update_guard'],
]);

function tableExists(db, table) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(table));
}

function objectExists(db, type, name) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = ? AND name = ?
  `).get(type, name));
}

function tableColumns(db, table) {
  if (!tableExists(db, table)) return [];
  return db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
}

function getMigration(db, name) {
  if (!tableExists(db, 'sql_shadow_schema_migrations')) return null;
  return db.prepare(`
    SELECT name, version, applied_at
    FROM sql_shadow_schema_migrations
    WHERE name = ?
  `).get(name) || null;
}

function foreignKeyTargets(db, table) {
  return new Set(db.prepare(`PRAGMA foreign_key_list(${table})`).all().map(row => row.table));
}

function assertForeignKeysEnabled(db) {
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new Error('PLATFORM_IDENTITY_FOREIGN_KEYS_REQUIRED');
  }
}

function assertForeignKeyCheckClean(db) {
  const failures = db.pragma('foreign_key_check');
  if (failures.length > 0) {
    throw new Error(`PLATFORM_IDENTITY_FOREIGN_KEY_CHECK_FAILED:${JSON.stringify(failures)}`);
  }
}

function assertPrerequisiteMigration(db, name, version) {
  const migration = getMigration(db, name);
  if (Number(migration?.version) !== version) {
    throw new Error(`PLATFORM_IDENTITY_PREREQUISITE_REQUIRED:${name}:v${version}`);
  }
}

function assertCanonicalPrerequisiteStructure(db) {
  const expectedRootColumns = new Map([
    [CANONICAL_COMPANIES_TABLE, ['id', 'receivablesTimezone', 'createdAt']],
    [CANONICAL_BRANCHES_TABLE, ['companyId', 'id', 'isHeadOffice', 'createdAt']],
  ]);
  for (const [table, expectedColumns] of expectedRootColumns.entries()) {
    const columns = new Set(tableColumns(db, table));
    for (const column of expectedColumns) {
      if (!columns.has(column)) {
        throw new Error(`PLATFORM_IDENTITY_PREREQUISITE_COLUMN_MISSING:${table}.${column}`);
      }
    }
  }
  for (const [type, name] of CANONICAL_PREREQUISITE_OBJECTS) {
    if (!objectExists(db, type, name)) {
      throw new Error(`PLATFORM_IDENTITY_PREREQUISITE_OBJECT_MISSING:${type}:${name}`);
    }
  }
}

function assertCanonicalForeignKeys(db) {
  const required = new Map([
    [CANONICAL_RECEIVABLES_TABLE, [CANONICAL_COMPANIES_TABLE, CANONICAL_BRANCHES_TABLE]],
    [FINANCIAL_AUDIT_EVENTS_TABLE, [CANONICAL_COMPANIES_TABLE, CANONICAL_BRANCHES_TABLE]],
    [CANONICAL_PAYMENTS_TABLE, [CANONICAL_COMPANIES_TABLE, CANONICAL_BRANCHES_TABLE]],
    [CANONICAL_PAYMENT_ALLOCATIONS_TABLE, [CANONICAL_COMPANIES_TABLE, CANONICAL_BRANCHES_TABLE]],
    [CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE, [CANONICAL_COMPANIES_TABLE, CANONICAL_BRANCHES_TABLE]],
    [CANONICAL_APPROVAL_REQUESTS_TABLE, [CANONICAL_COMPANIES_TABLE]],
  ]);
  for (const [table, expectedTargets] of required.entries()) {
    if (!tableExists(db, table)) {
      throw new Error(`PLATFORM_IDENTITY_CANONICAL_TABLE_MISSING:${table}`);
    }
    const targets = foreignKeyTargets(db, table);
    for (const target of expectedTargets) {
      if (!targets.has(target)) {
        throw new Error(`PLATFORM_IDENTITY_CANONICAL_FK_MISSING:${table}:${target}`);
      }
    }
  }
}

function assertNoCompetingPhysicalRoots(db) {
  for (const table of ['companies', 'branches']) {
    if (tableExists(db, table)) {
      throw new Error(`PLATFORM_IDENTITY_COMPETING_AUTHORITY:${table}`);
    }
  }
}

function assertFinancialTablesEmpty(db) {
  for (const table of FINANCIAL_TABLES) {
    const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
    if (count !== 0) {
      throw new Error(`PLATFORM_IDENTITY_FINANCIAL_ROWS_PRESENT:${table}:${count}`);
    }
  }
}

function hasUnexpectedPartialState(db) {
  const companyColumns = new Set(tableColumns(db, CANONICAL_COMPANIES_TABLE));
  const branchColumns = new Set(tableColumns(db, CANONICAL_BRANCHES_TABLE));
  const rootUpgradeStarted = ['displayName', 'status', 'version', 'updatedAt']
    .some(column => companyColumns.has(column) || branchColumns.has(column));
  const tableStarted = PLATFORM_IDENTITY_TABLES.some(table => tableExists(db, table));
  const indexStarted = REQUIRED_INDEXES.some(index => objectExists(db, 'index', index));
  const triggerStarted = REQUIRED_TRIGGERS.some(trigger => objectExists(db, 'trigger', trigger));
  return rootUpgradeStarted || tableStarted || indexStarted || triggerStarted;
}

function assertCatalogManifest(db) {
  const versions = db.prepare(`
    SELECT version, status, checksum
    FROM ${CAPABILITY_CATALOG_VERSIONS_TABLE}
    ORDER BY version
  `).all();
  if (
    versions.length !== 1
    || Number(versions[0].version) !== 1
    || versions[0].status !== 'active'
    || versions[0].checksum !== CAPABILITY_CATALOG_V1_CHECKSUM
  ) {
    throw new Error('PLATFORM_IDENTITY_CATALOG_MANIFEST_MISMATCH');
  }
  const entries = db.prepare(`
    SELECT capabilityKey AS key, scopeKind, assignable, status
    FROM ${CAPABILITY_CATALOG_ENTRIES_TABLE}
    WHERE catalogVersion = 1
    ORDER BY capabilityKey
  `).all().map(row => ({
    key: row.key,
    scopeKind: row.scopeKind,
    assignable: row.assignable === 1,
    status: row.status,
  }));
  const expectedEntries = CAPABILITY_CATALOG_V1.map(entry => ({
    ...entry,
    status: 'active',
  }));
  if (stableJson(entries) !== stableJson(expectedEntries)) {
    throw new Error('PLATFORM_IDENTITY_CATALOG_ENTRIES_MISMATCH');
  }
}

function assertPlatformIdentityStructure(db, { requireMigration = true } = {}) {
  assertForeignKeysEnabled(db);
  assertNoCompetingPhysicalRoots(db);
  assertCanonicalPrerequisiteStructure(db);

  const companyColumns = new Set(tableColumns(db, CANONICAL_COMPANIES_TABLE));
  const branchColumns = new Set(tableColumns(db, CANONICAL_BRANCHES_TABLE));
  for (const column of ROOT_COMPANY_COLUMNS) {
    if (!companyColumns.has(column)) {
      throw new Error(`PLATFORM_IDENTITY_SCHEMA_INCOMPLETE:${CANONICAL_COMPANIES_TABLE}.${column}`);
    }
  }
  for (const column of ROOT_BRANCH_COLUMNS) {
    if (!branchColumns.has(column)) {
      throw new Error(`PLATFORM_IDENTITY_SCHEMA_INCOMPLETE:${CANONICAL_BRANCHES_TABLE}.${column}`);
    }
  }
  for (const table of PLATFORM_IDENTITY_TABLES) {
    if (!tableExists(db, table)) {
      throw new Error(`PLATFORM_IDENTITY_SCHEMA_INCOMPLETE:${table}`);
    }
  }
  for (const index of REQUIRED_INDEXES) {
    if (!objectExists(db, 'index', index)) {
      throw new Error(`PLATFORM_IDENTITY_SCHEMA_INCOMPLETE:${index}`);
    }
  }
  for (const trigger of REQUIRED_TRIGGERS) {
    if (!objectExists(db, 'trigger', trigger)) {
      throw new Error(`PLATFORM_IDENTITY_SCHEMA_INCOMPLETE:${trigger}`);
    }
  }
  if (requireMigration) {
    const applied = getMigration(db, PLATFORM_IDENTITY_MIGRATION_ID);
    if (Number(applied?.version) !== PLATFORM_IDENTITY_SCHEMA_VERSION) {
      throw new Error('PLATFORM_IDENTITY_MIGRATION_REGISTRY_MISMATCH');
    }
  }
  assertCanonicalForeignKeys(db);
  assertCatalogManifest(db);
  assertForeignKeyCheckClean(db);
  return true;
}

function ensurePlatformIdentitySchema(db, options = {}) {
  db.pragma('foreign_keys = ON');
  assertForeignKeysEnabled(db);
  assertPrerequisiteMigration(
    db,
    CANONICAL_RECEIVABLES_MIGRATION_ID,
    CANONICAL_RECEIVABLES_SCHEMA_VERSION,
  );
  assertPrerequisiteMigration(
    db,
    CANONICAL_RECEIVABLES_SETTLEMENT_MIGRATION_ID,
    CANONICAL_RECEIVABLES_SETTLEMENT_SCHEMA_VERSION,
  );
  if (!tableExists(db, CANONICAL_COMPANIES_TABLE) || !tableExists(db, CANONICAL_BRANCHES_TABLE)) {
    throw new Error('PLATFORM_IDENTITY_CANONICAL_ROOTS_MISSING');
  }
  assertNoCompetingPhysicalRoots(db);
  assertCanonicalPrerequisiteStructure(db);
  assertCanonicalForeignKeys(db);
  assertForeignKeyCheckClean(db);

  const applied = getMigration(db, PLATFORM_IDENTITY_MIGRATION_ID);
  if (applied) {
    if (Number(applied.version) !== PLATFORM_IDENTITY_SCHEMA_VERSION) {
      throw new Error(`PLATFORM_IDENTITY_MIGRATION_VERSION_MISMATCH:${applied.version}`);
    }
    assertPlatformIdentityStructure(db);
    return false;
  }
  if (hasUnexpectedPartialState(db)) {
    throw new Error('PLATFORM_IDENTITY_UNEXPECTED_PARTIAL_STATE');
  }
  assertFinancialTablesEmpty(db);

  const migrate = db.transaction(() => {
    db.exec(`
      ALTER TABLE ${CANONICAL_COMPANIES_TABLE}
        ADD COLUMN displayName TEXT NOT NULL DEFAULT '';
      ALTER TABLE ${CANONICAL_COMPANIES_TABLE}
        ADD COLUMN status TEXT NOT NULL DEFAULT 'inactive'
          CHECK (status IN ('inactive', 'active', 'archived'));
      ALTER TABLE ${CANONICAL_COMPANIES_TABLE}
        ADD COLUMN version INTEGER NOT NULL DEFAULT 1
          CHECK (typeof(version) = 'integer' AND version >= 1);
      ALTER TABLE ${CANONICAL_COMPANIES_TABLE}
        ADD COLUMN updatedAt TEXT NOT NULL DEFAULT '';

      ALTER TABLE ${CANONICAL_BRANCHES_TABLE}
        ADD COLUMN displayName TEXT NOT NULL DEFAULT '';
      ALTER TABLE ${CANONICAL_BRANCHES_TABLE}
        ADD COLUMN status TEXT NOT NULL DEFAULT 'inactive'
          CHECK (status IN ('inactive', 'active', 'archived'));
      ALTER TABLE ${CANONICAL_BRANCHES_TABLE}
        ADD COLUMN version INTEGER NOT NULL DEFAULT 1
          CHECK (typeof(version) = 'integer' AND version >= 1);
      ALTER TABLE ${CANONICAL_BRANCHES_TABLE}
        ADD COLUMN updatedAt TEXT NOT NULL DEFAULT '';
    `);

    if (typeof options.afterRootUpgrade === 'function') {
      options.afterRootUpgrade(db);
    }

    db.exec(`
      CREATE UNIQUE INDEX uq_canonical_branches_global_id
        ON ${CANONICAL_BRANCHES_TABLE}(id);

      CREATE TABLE ${CAPABILITY_CATALOG_VERSIONS_TABLE} (
        version INTEGER PRIMARY KEY,
        status TEXT NOT NULL,
        checksum TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        CHECK (typeof(version) = 'integer' AND version >= 1),
        CHECK (status IN ('active', 'inactive')),
        CHECK (length(trim(checksum)) = 64)
      );

      CREATE TABLE ${CAPABILITY_CATALOG_ENTRIES_TABLE} (
        catalogVersion INTEGER NOT NULL,
        capabilityKey TEXT NOT NULL,
        scopeKind TEXT NOT NULL,
        assignable INTEGER NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        PRIMARY KEY (catalogVersion, capabilityKey),
        FOREIGN KEY (catalogVersion)
          REFERENCES ${CAPABILITY_CATALOG_VERSIONS_TABLE}(version)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (length(trim(capabilityKey)) > 0),
        CHECK (scopeKind IN ('company', 'branch')),
        CHECK (assignable IN (0, 1)),
        CHECK (status IN ('active', 'inactive'))
      );

      CREATE TABLE ${ROLE_TEMPLATES_TABLE} (
        companyId TEXT NOT NULL,
        templateKey TEXT NOT NULL,
        templateVersion INTEGER NOT NULL,
        catalogVersion INTEGER NOT NULL,
        displayName TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        createdBy TEXT NOT NULL,
        reason TEXT NOT NULL,
        PRIMARY KEY (companyId, templateKey, templateVersion),
        UNIQUE (companyId, templateKey, templateVersion, catalogVersion),
        FOREIGN KEY (companyId) REFERENCES ${CANONICAL_COMPANIES_TABLE}(id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (catalogVersion)
          REFERENCES ${CAPABILITY_CATALOG_VERSIONS_TABLE}(version)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (length(trim(templateKey)) > 0),
        CHECK (typeof(templateVersion) = 'integer' AND templateVersion >= 1),
        CHECK (length(trim(displayName)) > 0),
        CHECK (status IN ('inactive', 'active', 'archived')),
        CHECK (length(trim(createdBy)) > 0),
        CHECK (length(trim(reason)) > 0)
      );

      CREATE TABLE ${ROLE_TEMPLATE_CAPABILITIES_TABLE} (
        companyId TEXT NOT NULL,
        templateKey TEXT NOT NULL,
        templateVersion INTEGER NOT NULL,
        catalogVersion INTEGER NOT NULL,
        capabilityKey TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        createdBy TEXT NOT NULL,
        PRIMARY KEY (
          companyId,
          templateKey,
          templateVersion,
          capabilityKey
        ),
        FOREIGN KEY (
          companyId,
          templateKey,
          templateVersion,
          catalogVersion
        ) REFERENCES ${ROLE_TEMPLATES_TABLE}(
          companyId,
          templateKey,
          templateVersion,
          catalogVersion
        ) ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (catalogVersion, capabilityKey)
          REFERENCES ${CAPABILITY_CATALOG_ENTRIES_TABLE}(catalogVersion, capabilityKey)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (length(trim(capabilityKey)) > 0),
        CHECK (length(trim(createdBy)) > 0)
      );

      CREATE TABLE ${COMPANY_MEMBERSHIPS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        principalId TEXT NOT NULL,
        status TEXT NOT NULL,
        roleTemplateKey TEXT NOT NULL,
        roleTemplateVersion INTEGER NOT NULL,
        companyWideBranchAuthority INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        activatedAt TEXT,
        inactivatedAt TEXT,
        revokedAt TEXT,
        createdBy TEXT NOT NULL,
        updatedBy TEXT NOT NULL,
        revokedBy TEXT,
        reason TEXT NOT NULL,
        UNIQUE (id, companyId),
        UNIQUE (companyId, principalId),
        FOREIGN KEY (companyId) REFERENCES ${CANONICAL_COMPANIES_TABLE}(id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (companyId, roleTemplateKey, roleTemplateVersion)
          REFERENCES ${ROLE_TEMPLATES_TABLE}(companyId, templateKey, templateVersion)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (length(trim(id)) > 0),
        CHECK (length(trim(companyId)) > 0),
        CHECK (length(trim(principalId)) > 0),
        CHECK (status IN ('pending', 'active', 'inactive', 'revoked')),
        CHECK (length(trim(roleTemplateKey)) > 0),
        CHECK (typeof(roleTemplateVersion) = 'integer' AND roleTemplateVersion >= 1),
        CHECK (companyWideBranchAuthority IN (0, 1)),
        CHECK (typeof(version) = 'integer' AND version >= 1),
        CHECK (length(trim(createdBy)) > 0),
        CHECK (length(trim(updatedBy)) > 0),
        CHECK (length(trim(reason)) > 0),
        CHECK (status != 'active' OR activatedAt IS NOT NULL),
        CHECK (
          status != 'revoked'
          OR (
            revokedAt IS NOT NULL
            AND revokedBy IS NOT NULL
            AND length(trim(revokedBy)) > 0
          )
        )
      );

      CREATE TABLE ${MEMBERSHIP_BRANCH_ACCESS_TABLE} (
        id TEXT PRIMARY KEY,
        membershipId TEXT NOT NULL,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        status TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        grantedAt TEXT NOT NULL,
        grantedBy TEXT NOT NULL,
        revokedAt TEXT,
        revokedBy TEXT,
        reason TEXT NOT NULL,
        FOREIGN KEY (membershipId, companyId)
          REFERENCES ${COMPANY_MEMBERSHIPS_TABLE}(id, companyId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (companyId, branchId)
          REFERENCES ${CANONICAL_BRANCHES_TABLE}(companyId, id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (length(trim(id)) > 0),
        CHECK (status IN ('active', 'revoked')),
        CHECK (typeof(version) = 'integer' AND version >= 1),
        CHECK (length(trim(grantedBy)) > 0),
        CHECK (length(trim(reason)) > 0),
        CHECK (
          status != 'revoked'
          OR (
            revokedAt IS NOT NULL
            AND revokedBy IS NOT NULL
            AND length(trim(revokedBy)) > 0
          )
        )
      );

      CREATE TABLE ${MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE} (
        id TEXT PRIMARY KEY,
        membershipId TEXT NOT NULL,
        companyId TEXT NOT NULL,
        catalogVersion INTEGER NOT NULL,
        capabilityKey TEXT NOT NULL,
        effect TEXT NOT NULL,
        status TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        grantedAt TEXT NOT NULL,
        grantedBy TEXT NOT NULL,
        revokedAt TEXT,
        revokedBy TEXT,
        reason TEXT NOT NULL,
        FOREIGN KEY (membershipId, companyId)
          REFERENCES ${COMPANY_MEMBERSHIPS_TABLE}(id, companyId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (catalogVersion, capabilityKey)
          REFERENCES ${CAPABILITY_CATALOG_ENTRIES_TABLE}(catalogVersion, capabilityKey)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (effect IN ('grant', 'deny')),
        CHECK (status IN ('active', 'revoked')),
        CHECK (typeof(version) = 'integer' AND version >= 1),
        CHECK (length(trim(grantedBy)) > 0),
        CHECK (length(trim(reason)) > 0),
        CHECK (
          status != 'revoked'
          OR (
            revokedAt IS NOT NULL
            AND revokedBy IS NOT NULL
            AND length(trim(revokedBy)) > 0
          )
        )
      );

      CREATE TABLE ${AUTHORIZATION_AUDIT_EVENTS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        actorType TEXT NOT NULL,
        actorPrincipalId TEXT NOT NULL,
        actorMembershipId TEXT,
        actorMembershipVersion INTEGER,
        action TEXT NOT NULL,
        targetType TEXT NOT NULL,
        targetId TEXT NOT NULL,
        capabilityKey TEXT,
        decision TEXT NOT NULL,
        reasonCode TEXT NOT NULL,
        beforeJson TEXT,
        afterJson TEXT,
        capabilityCatalogVersion INTEGER,
        correlationId TEXT NOT NULL,
        occurredAt TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (companyId) REFERENCES ${CANONICAL_COMPANIES_TABLE}(id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (companyId, branchId)
          REFERENCES ${CANONICAL_BRANCHES_TABLE}(companyId, id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (actorMembershipId, companyId)
          REFERENCES ${COMPANY_MEMBERSHIPS_TABLE}(id, companyId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (capabilityCatalogVersion)
          REFERENCES ${CAPABILITY_CATALOG_VERSIONS_TABLE}(version)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (actorType IN ('user', 'integration', 'system')),
        CHECK (length(trim(actorPrincipalId)) > 0),
        CHECK (
          actorMembershipId IS NULL
          OR (
            actorMembershipVersion IS NOT NULL
            AND typeof(actorMembershipVersion) = 'integer'
            AND actorMembershipVersion >= 1
          )
        ),
        CHECK (length(trim(action)) > 0),
        CHECK (length(trim(targetType)) > 0),
        CHECK (length(trim(targetId)) > 0),
        CHECK (decision IN ('allowed', 'denied', 'applied', 'rejected')),
        CHECK (length(trim(reasonCode)) > 0),
        CHECK (beforeJson IS NULL OR json_valid(beforeJson)),
        CHECK (afterJson IS NULL OR json_valid(afterJson)),
        CHECK (length(trim(correlationId)) > 0)
      );

      CREATE TABLE ${IDENTITY_BOOTSTRAP_RUNS_TABLE} (
        id TEXT PRIMARY KEY,
        configVersion INTEGER NOT NULL,
        configChecksum TEXT NOT NULL,
        schemaFingerprint TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        approvedBy TEXT NOT NULL,
        approvedAt TEXT NOT NULL,
        approvalReference TEXT NOT NULL,
        backupReference TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        completedAt TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        summaryJson TEXT NOT NULL,
        errorCode TEXT,
        errorSummary TEXT,
        CHECK (typeof(configVersion) = 'integer' AND configVersion >= 1),
        CHECK (length(trim(configChecksum)) = 64),
        CHECK (length(trim(schemaFingerprint)) = 64),
        CHECK (mode IN ('inspect', 'validate', 'plan', 'apply')),
        CHECK (status IN ('succeeded', 'failed', 'noop')),
        CHECK (length(trim(approvedBy)) > 0),
        CHECK (length(trim(approvalReference)) > 0),
        CHECK (length(trim(backupReference)) > 0),
        CHECK (json_valid(summaryJson))
      );

      CREATE UNIQUE INDEX uq_capability_catalog_single_active
        ON ${CAPABILITY_CATALOG_VERSIONS_TABLE}(status)
        WHERE status = 'active';
      CREATE UNIQUE INDEX uq_company_memberships_company_principal
        ON ${COMPANY_MEMBERSHIPS_TABLE}(companyId, principalId);
      CREATE UNIQUE INDEX uq_membership_branch_access_active
        ON ${MEMBERSHIP_BRANCH_ACCESS_TABLE}(membershipId, branchId)
        WHERE status = 'active';
      CREATE UNIQUE INDEX uq_membership_capability_active
        ON ${MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE}(membershipId, capabilityKey)
        WHERE status = 'active';
      CREATE UNIQUE INDEX uq_identity_bootstrap_success_checksum
        ON ${IDENTITY_BOOTSTRAP_RUNS_TABLE}(configChecksum)
        WHERE status = 'succeeded';

      CREATE INDEX idx_company_memberships_principal_status
        ON ${COMPANY_MEMBERSHIPS_TABLE}(principalId, status, companyId);
      CREATE INDEX idx_membership_branch_access_membership_status
        ON ${MEMBERSHIP_BRANCH_ACCESS_TABLE}(membershipId, status, branchId);
      CREATE INDEX idx_membership_capability_membership_status
        ON ${MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE}(membershipId, status, capabilityKey);
      CREATE INDEX idx_authorization_audit_company_occurred
        ON ${AUTHORIZATION_AUDIT_EVENTS_TABLE}(companyId, occurredAt, id);
      CREATE INDEX idx_authorization_audit_target
        ON ${AUTHORIZATION_AUDIT_EVENTS_TABLE}(companyId, targetType, targetId, occurredAt);

      CREATE TRIGGER trg_canonical_companies_no_delete
      BEFORE DELETE ON ${CANONICAL_COMPANIES_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'platform companies cannot be deleted');
      END;

      CREATE TRIGGER trg_canonical_companies_immutable_id
      BEFORE UPDATE OF id ON ${CANONICAL_COMPANIES_TABLE}
      WHEN OLD.id IS NOT NEW.id
      BEGIN
        SELECT RAISE(ABORT, 'platform company identity is immutable');
      END;

      CREATE TRIGGER trg_canonical_companies_version
      BEFORE UPDATE ON ${CANONICAL_COMPANIES_TABLE}
      WHEN NEW.version != OLD.version + 1
      BEGIN
        SELECT RAISE(ABORT, 'platform company version must increment');
      END;

      CREATE TRIGGER trg_canonical_companies_active_insert
      BEFORE INSERT ON ${CANONICAL_COMPANIES_TABLE}
      WHEN NEW.status = 'active'
      BEGIN
        SELECT RAISE(ABORT, 'platform company must be activated after Head Office creation');
      END;

      CREATE TRIGGER trg_canonical_companies_active_head_office
      BEFORE UPDATE OF status ON ${CANONICAL_COMPANIES_TABLE}
      WHEN NEW.status = 'active' AND (
        length(trim(NEW.displayName)) = 0
        OR length(trim(NEW.receivablesTimezone)) = 0
        OR (
          SELECT COUNT(*)
          FROM ${CANONICAL_BRANCHES_TABLE} branch
          WHERE branch.companyId = NEW.id
            AND branch.isHeadOffice = 1
            AND branch.status = 'active'
        ) != 1
      )
      BEGIN
        SELECT RAISE(ABORT, 'active company requires one active Head Office');
      END;

      CREATE TRIGGER trg_canonical_branches_no_delete
      BEFORE DELETE ON ${CANONICAL_BRANCHES_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'platform branches cannot be deleted');
      END;

      CREATE TRIGGER trg_canonical_branches_immutable_identity
      BEFORE UPDATE OF companyId, id, isHeadOffice ON ${CANONICAL_BRANCHES_TABLE}
      WHEN OLD.companyId IS NOT NEW.companyId
        OR OLD.id IS NOT NEW.id
        OR OLD.isHeadOffice IS NOT NEW.isHeadOffice
      BEGIN
        SELECT RAISE(ABORT, 'platform branch identity is immutable');
      END;

      CREATE TRIGGER trg_canonical_branches_version
      BEFORE UPDATE ON ${CANONICAL_BRANCHES_TABLE}
      WHEN NEW.version != OLD.version + 1
      BEGIN
        SELECT RAISE(ABORT, 'platform branch version must increment');
      END;

      CREATE TRIGGER trg_canonical_branches_sentinel_insert
      BEFORE INSERT ON ${CANONICAL_BRANCHES_TABLE}
      WHEN length(trim(NEW.id)) = 0
        OR lower(trim(NEW.id)) IN (
          '*', 'all', 'global', 'company-wide', 'company_wide', 'any', 'null'
        )
      BEGIN
        SELECT RAISE(ABORT, 'branch sentinel identifiers are forbidden');
      END;

      CREATE TRIGGER trg_canonical_branches_active_metadata
      BEFORE INSERT ON ${CANONICAL_BRANCHES_TABLE}
      WHEN NEW.status = 'active' AND length(trim(NEW.displayName)) = 0
      BEGIN
        SELECT RAISE(ABORT, 'active branch requires display metadata');
      END;

      CREATE TRIGGER trg_canonical_branches_active_metadata_update
      BEFORE UPDATE ON ${CANONICAL_BRANCHES_TABLE}
      WHEN NEW.status = 'active' AND length(trim(NEW.displayName)) = 0
      BEGIN
        SELECT RAISE(ABORT, 'active branch requires display metadata');
      END;

      CREATE TRIGGER trg_canonical_branches_active_head_office
      BEFORE UPDATE OF status ON ${CANONICAL_BRANCHES_TABLE}
      WHEN OLD.isHeadOffice = 1
        AND OLD.status = 'active'
        AND NEW.status != 'active'
        AND EXISTS (
          SELECT 1
          FROM ${CANONICAL_COMPANIES_TABLE} company
          WHERE company.id = OLD.companyId AND company.status = 'active'
        )
      BEGIN
        SELECT RAISE(ABORT, 'active company must retain its active Head Office');
      END;

      CREATE TRIGGER trg_company_memberships_no_delete
      BEFORE DELETE ON ${COMPANY_MEMBERSHIPS_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'company memberships cannot be deleted');
      END;

      CREATE TRIGGER trg_company_memberships_immutable_identity
      BEFORE UPDATE OF id, companyId, principalId ON ${COMPANY_MEMBERSHIPS_TABLE}
      WHEN OLD.id IS NOT NEW.id
        OR OLD.companyId IS NOT NEW.companyId
        OR OLD.principalId IS NOT NEW.principalId
      BEGIN
        SELECT RAISE(ABORT, 'company membership identity is immutable');
      END;

      CREATE TRIGGER trg_company_memberships_version
      BEFORE UPDATE ON ${COMPANY_MEMBERSHIPS_TABLE}
      WHEN NEW.version != OLD.version + 1
      BEGIN
        SELECT RAISE(ABORT, 'company membership version must increment');
      END;

      CREATE TRIGGER trg_company_memberships_revoked_terminal
      BEFORE UPDATE ON ${COMPANY_MEMBERSHIPS_TABLE}
      WHEN OLD.status = 'revoked' AND NEW.status != 'revoked'
      BEGIN
        SELECT RAISE(ABORT, 'revoked membership is terminal');
      END;

      CREATE TRIGGER trg_membership_branch_access_no_delete
      BEFORE DELETE ON ${MEMBERSHIP_BRANCH_ACCESS_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'membership branch access cannot be deleted');
      END;

      CREATE TRIGGER trg_membership_branch_access_version
      BEFORE UPDATE ON ${MEMBERSHIP_BRANCH_ACCESS_TABLE}
      WHEN NEW.version != OLD.version + 1
      BEGIN
        SELECT RAISE(ABORT, 'membership branch access version must increment');
      END;

      CREATE TRIGGER trg_role_templates_no_update
      BEFORE UPDATE ON ${ROLE_TEMPLATES_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'role template versions are immutable');
      END;

      CREATE TRIGGER trg_role_templates_no_delete
      BEFORE DELETE ON ${ROLE_TEMPLATES_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'role template versions cannot be deleted');
      END;

      CREATE TRIGGER trg_role_template_capabilities_no_update
      BEFORE UPDATE ON ${ROLE_TEMPLATE_CAPABILITIES_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'role template capabilities are immutable');
      END;

      CREATE TRIGGER trg_role_template_capabilities_no_delete
      BEFORE DELETE ON ${ROLE_TEMPLATE_CAPABILITIES_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'role template capabilities cannot be deleted');
      END;

      CREATE TRIGGER trg_capability_catalog_versions_no_update
      BEFORE UPDATE ON ${CAPABILITY_CATALOG_VERSIONS_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'capability catalog versions are immutable');
      END;

      CREATE TRIGGER trg_capability_catalog_versions_no_delete
      BEFORE DELETE ON ${CAPABILITY_CATALOG_VERSIONS_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'capability catalog versions cannot be deleted');
      END;

      CREATE TRIGGER trg_capability_catalog_entries_no_update
      BEFORE UPDATE ON ${CAPABILITY_CATALOG_ENTRIES_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'capability catalog entries are immutable');
      END;

      CREATE TRIGGER trg_capability_catalog_entries_no_delete
      BEFORE DELETE ON ${CAPABILITY_CATALOG_ENTRIES_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'capability catalog entries cannot be deleted');
      END;

      CREATE TRIGGER trg_membership_capability_assignments_no_delete
      BEFORE DELETE ON ${MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'membership capability assignments cannot be deleted');
      END;

      CREATE TRIGGER trg_membership_capability_assignments_version
      BEFORE UPDATE ON ${MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE}
      WHEN NEW.version != OLD.version + 1
      BEGIN
        SELECT RAISE(ABORT, 'membership capability assignment version must increment');
      END;

      CREATE TRIGGER trg_authorization_audit_events_no_update
      BEFORE UPDATE ON ${AUTHORIZATION_AUDIT_EVENTS_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'authorization audit events are append-only');
      END;

      CREATE TRIGGER trg_authorization_audit_events_no_delete
      BEFORE DELETE ON ${AUTHORIZATION_AUDIT_EVENTS_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'authorization audit events are append-only');
      END;

      CREATE TRIGGER trg_authorization_audit_events_no_replace
      BEFORE INSERT ON ${AUTHORIZATION_AUDIT_EVENTS_TABLE}
      WHEN EXISTS (
        SELECT 1 FROM ${AUTHORIZATION_AUDIT_EVENTS_TABLE} WHERE id = NEW.id
      )
      BEGIN
        SELECT RAISE(ABORT, 'authorization audit events are append-only');
      END;

      CREATE TRIGGER trg_identity_bootstrap_runs_no_update
      BEFORE UPDATE ON ${IDENTITY_BOOTSTRAP_RUNS_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'identity bootstrap runs are append-only');
      END;

      CREATE TRIGGER trg_identity_bootstrap_runs_no_delete
      BEFORE DELETE ON ${IDENTITY_BOOTSTRAP_RUNS_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'identity bootstrap runs cannot be deleted');
      END;
    `);

    const createdAt = '2026-07-15T00:00:00.000Z';
    db.prepare(`
      INSERT INTO ${CAPABILITY_CATALOG_VERSIONS_TABLE} (
        version, status, checksum, createdAt
      ) VALUES (1, 'active', ?, ?)
    `).run(CAPABILITY_CATALOG_V1_CHECKSUM, createdAt);
    const insertCapability = db.prepare(`
      INSERT INTO ${CAPABILITY_CATALOG_ENTRIES_TABLE} (
        catalogVersion,
        capabilityKey,
        scopeKind,
        assignable,
        status,
        createdAt
      ) VALUES (1, ?, ?, ?, 'active', ?)
    `);
    for (const capability of CAPABILITY_CATALOG_V1) {
      insertCapability.run(
        capability.key,
        capability.scopeKind,
        capability.assignable ? 1 : 0,
        createdAt,
      );
    }

    assertPlatformIdentityStructure(db, { requireMigration: false });

    db.prepare(`
      INSERT INTO sql_shadow_schema_migrations (name, version)
      VALUES (?, ?)
    `).run(PLATFORM_IDENTITY_MIGRATION_ID, PLATFORM_IDENTITY_SCHEMA_VERSION);
    return true;
  });

  return migrate.immediate();
}

module.exports = {
  AUTHORIZATION_AUDIT_EVENTS_TABLE,
  CAPABILITY_CATALOG_ENTRIES_TABLE,
  CAPABILITY_CATALOG_V1,
  CAPABILITY_CATALOG_V1_CHECKSUM,
  CAPABILITY_CATALOG_VERSIONS_TABLE,
  COMPANY_MEMBERSHIPS_TABLE,
  FINANCIAL_TABLES,
  IDENTITY_BOOTSTRAP_RUNS_TABLE,
  MEMBERSHIP_BRANCH_ACCESS_TABLE,
  MEMBERSHIP_CAPABILITY_ASSIGNMENTS_TABLE,
  PLATFORM_IDENTITY_MIGRATION_ID,
  PLATFORM_IDENTITY_SCHEMA_VERSION,
  PLATFORM_IDENTITY_TABLES,
  ROLE_TEMPLATE_CAPABILITIES_TABLE,
  ROLE_TEMPLATES_TABLE,
  assertPlatformIdentityStructure,
  ensurePlatformIdentitySchema,
  stableJson,
};
