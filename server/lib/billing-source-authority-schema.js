const {
  CANONICAL_BRANCHES_TABLE,
  CANONICAL_COMPANIES_TABLE,
  CANONICAL_RECEIVABLES_MIGRATION_ID,
  CANONICAL_RECEIVABLES_SCHEMA_VERSION,
} = require('./canonical-receivables-schema');
const {
  CANONICAL_RECEIVABLES_SETTLEMENT_MIGRATION_ID,
  CANONICAL_RECEIVABLES_SETTLEMENT_SCHEMA_VERSION,
} = require('./canonical-receivables-settlement-schema');
const {
  CAPABILITY_CATALOG_V1,
  FINANCIAL_TABLES,
  PLATFORM_IDENTITY_MIGRATION_ID,
  PLATFORM_IDENTITY_SCHEMA_VERSION,
  assertPlatformIdentityStructure,
} = require('./platform-identity-schema');

const BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION = 1;
const BILLING_SOURCE_AUTHORITY_MIGRATION_ID = 'billing_source_authority_pr6';

const BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE = 'billing_source_activation_boundaries';
const BILLING_SOURCE_RENTAL_LINES_TABLE = 'billing_source_rental_lines';
const BILLING_SOURCE_EFFECTIVE_TERMS_TABLE = 'billing_source_effective_terms';
const BILLING_SOURCE_PERIODS_TABLE = 'billing_source_periods';
const BILLING_SOURCE_PERIOD_VERSIONS_TABLE = 'billing_source_period_versions';
const BILLING_SOURCE_SNAPSHOTS_TABLE = 'billing_source_snapshots';
const BILLING_SOURCE_SNAPSHOT_EVIDENCE_TABLE = 'billing_source_snapshot_evidence';
const BILLING_SOURCE_UPDS_TABLE = 'billing_source_upds';
const BILLING_SOURCE_UPD_VERSIONS_TABLE = 'billing_source_upd_versions';
const BILLING_SOURCE_UPD_LINES_TABLE = 'billing_source_upd_lines';
const BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE = 'billing_source_upd_line_versions';
const BILLING_SOURCE_COVERAGE_SETS_TABLE = 'billing_source_coverage_sets';
const BILLING_SOURCE_COVERAGE_SLICES_TABLE = 'billing_source_coverage_slices';
const BILLING_SOURCE_OPERATIONS_TABLE = 'billing_source_operations';
const BILLING_SOURCE_AUDIT_EVENTS_TABLE = 'billing_source_audit_events';

const BILLING_SOURCE_AUTHORITY_TABLES = Object.freeze([
  BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE,
  BILLING_SOURCE_RENTAL_LINES_TABLE,
  BILLING_SOURCE_EFFECTIVE_TERMS_TABLE,
  BILLING_SOURCE_PERIODS_TABLE,
  BILLING_SOURCE_PERIOD_VERSIONS_TABLE,
  BILLING_SOURCE_SNAPSHOTS_TABLE,
  BILLING_SOURCE_SNAPSHOT_EVIDENCE_TABLE,
  BILLING_SOURCE_UPDS_TABLE,
  BILLING_SOURCE_UPD_VERSIONS_TABLE,
  BILLING_SOURCE_UPD_LINES_TABLE,
  BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE,
  BILLING_SOURCE_COVERAGE_SETS_TABLE,
  BILLING_SOURCE_COVERAGE_SLICES_TABLE,
  BILLING_SOURCE_OPERATIONS_TABLE,
  BILLING_SOURCE_AUDIT_EVENTS_TABLE,
]);

const REQUIRED_INDEXES = Object.freeze([
  'uq_billing_source_rental_binding',
  'uq_billing_source_terms_version',
  'uq_billing_source_terms_successor',
  'uq_billing_source_period_identity',
  'uq_billing_source_period_version',
  'uq_billing_source_upd_identity',
  'uq_billing_source_upd_version',
  'uq_billing_source_upd_line_identity',
  'uq_billing_source_upd_line_content_version',
  'uq_billing_source_coverage_set_version',
  'uq_billing_source_validated_coverage_successor',
  'uq_billing_source_operation_identity',
  'idx_billing_source_period_scope',
  'idx_billing_source_snapshot_scope',
  'idx_billing_source_upd_scope',
  'idx_billing_source_coverage_scope',
  'idx_billing_source_audit_scope',
  'idx_billing_source_blocked_snapshots',
  'idx_billing_source_blocked_upd_versions',
  'idx_billing_source_blocked_upd_lines',
  'idx_billing_source_blocked_coverage',
]);

const IMMUTABLE_TABLES = BILLING_SOURCE_AUTHORITY_TABLES;
const REQUIRED_TRIGGERS = Object.freeze([
  ...IMMUTABLE_TABLES.flatMap(table => [
    `trg_${table}_no_update`,
    `trg_${table}_no_delete`,
  ]),
  'trg_billing_source_operations_no_replace',
  'trg_billing_source_audit_events_no_replace',
  'trg_billing_source_periods_no_overlap',
  'trg_billing_source_coverage_slices_no_overlap',
]);

const REQUIRED_COLUMNS = Object.freeze({
  [BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE]: [
    'id', 'companyId', 'branchId', 'firstGovernedPeriodStartDate', 'cohortReference',
    'approvalReference', 'approvalFingerprint', 'schemaVersion', 'sourceHash', 'createdAt',
  ],
  [BILLING_SOURCE_RENTAL_LINES_TABLE]: [
    'id', 'companyId', 'branchId', 'rentalId', 'clientId', 'contractId', 'equipmentId',
    'activationBoundaryId', 'sourceSystem', 'sourceRentalRef', 'sourceLineIdentityKind',
    'sourceLineRef', 'sourceEventId', 'sourceEventVersion', 'provenanceHash', 'schemaVersion',
    'createdAt',
  ],
  [BILLING_SOURCE_EFFECTIVE_TERMS_TABLE]: [
    'id', 'companyId', 'branchId', 'rentalLineId', 'version', 'supersedesTermsVersionId',
    'effectiveFromDate', 'effectiveToDateExclusive', 'rateAmountMinor', 'rateUnitCode',
    'rateQuantityScale', 'contractualBillingCycleCode', 'contractualBillingCycleVersion',
    'minimumTermQuantity', 'minimumTermUnitCode', 'discountKind', 'discountValue', 'currency',
    'calculationPolicyRef', 'vatPolicyRef', 'roundingPolicyRef', 'policyDecisionRef',
    'policyResolutionStatus', 'unresolvedReasonCodesJson', 'sourceSystem', 'sourceRef',
    'sourceVersion', 'sourceHash', 'schemaVersion', 'createdAt',
  ],
  [BILLING_SOURCE_PERIODS_TABLE]: [
    'id', 'companyId', 'branchId', 'rentalId', 'rentalLineId', 'activationBoundaryId',
    'contractualBillingCycleCode', 'contractualBillingCycleVersion', 'cycleBoundaryEvidenceRef',
    'periodStartDate', 'periodEndDateExclusive', 'identityHash', 'schemaVersion', 'createdAt',
  ],
  [BILLING_SOURCE_PERIOD_VERSIONS_TABLE]: [
    'id', 'companyId', 'branchId', 'periodId', 'version', 'eventType', 'previousVersionId',
    'reopensClosedVersionId', 'effectiveTermsVersionId', 'snapshotId', 'operationId',
    'actorPrincipalId', 'actorMembershipId', 'actorMembershipVersion',
    'capabilityCatalogVersion', 'capabilityKey', 'reasonCode', 'reasonText', 'sourceEventId',
    'sourceEventVersion', 'sourceHash', 'schemaVersion', 'createdAt',
  ],
  [BILLING_SOURCE_SNAPSHOTS_TABLE]: [
    'id', 'companyId', 'branchId', 'rentalId', 'rentalLineId', 'periodId',
    'closedPeriodVersionId', 'effectiveTermsVersionId', 'coveredStartDate',
    'coveredEndDateExclusive', 'companyTimezone', 'currency', 'preDiscountNetMinor',
    'discountMinor', 'netMinor', 'vatMinor', 'grossMinor', 'calculationAlgorithmVersion',
    'calculationPolicyRef', 'vatPolicyRef', 'roundingPolicyRef', 'policyDecisionRef',
    'sourceIntegrityStatus', 'blockerReasonCodesJson', 'calculationInputsJson',
    'calculationInputsHash', 'evidenceSetHash', 'sourceHash', 'schemaVersion', 'createdAt',
  ],
  [BILLING_SOURCE_SNAPSHOT_EVIDENCE_TABLE]: [
    'id', 'companyId', 'branchId', 'snapshotId', 'evidenceType', 'sourceSystem', 'sourceId',
    'sourceVersion', 'sourceEventId', 'sourceEventVersion', 'coveredStartDate',
    'coveredEndDateExclusive', 'authorityStatus', 'authorityPolicyRef', 'evidenceHash',
    'schemaVersion', 'createdAt',
  ],
  [BILLING_SOURCE_UPDS_TABLE]: [
    'id', 'companyId', 'branchId', 'clientId', 'contractId', 'sourceSystem',
    'sourceDocumentRef', 'legacyDocumentId', 'documentNumber', 'documentDate', 'currency',
    'identityHash', 'schemaVersion', 'createdAt',
  ],
  [BILLING_SOURCE_UPD_VERSIONS_TABLE]: [
    'id', 'companyId', 'branchId', 'updId', 'version', 'state', 'previousVersionId',
    'formedVersionId', 'correctsUpdVersionId', 'supersedesUpdVersionId', 'operationId',
    'actorPrincipalId', 'actorMembershipId', 'actorMembershipVersion',
    'capabilityCatalogVersion', 'capabilityKey', 'reasonCode', 'reasonText', 'lineSetHash',
    'contentHash', 'sourceEventId', 'sourceEventVersion', 'conductedAt',
    'conductedEvidenceRef', 'conductedEvidenceVersion', 'conductedEvidenceHash',
    'conductedPolicyDecisionRef', 'clientSignatureEvidenceRef', 'signatureRequirementPolicyRef',
    'sourceIntegrityStatus', 'blockerReasonCodesJson', 'schemaVersion', 'createdAt',
  ],
  [BILLING_SOURCE_UPD_LINES_TABLE]: [
    'id', 'companyId', 'branchId', 'updId', 'sourceLineRef', 'sourceLineIdentityKind',
    'identityHash', 'schemaVersion', 'createdAt',
  ],
  [BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE]: [
    'id', 'companyId', 'branchId', 'updLineId', 'formedUpdVersionId', 'version',
    'supersedesLineVersionId', 'displayPosition', 'description', 'quantityValueInteger',
    'quantityScale', 'unitCode', 'currency', 'netMinor', 'vatMinor', 'grossMinor',
    'vatPolicyRef', 'roundingPolicyRef', 'policyDecisionRef', 'sourceIntegrityStatus',
    'blockerReasonCodesJson', 'sourceSystem', 'sourceRef', 'sourceVersion', 'contentHash',
    'schemaVersion', 'createdAt',
  ],
  [BILLING_SOURCE_COVERAGE_SETS_TABLE]: [
    'id', 'companyId', 'branchId', 'updId', 'formedUpdVersionId', 'version',
    'supersedesCoverageSetId', 'mappingAlgorithmVersion', 'status', 'mappingHash',
    'netDeltaMinor', 'vatDeltaMinor', 'grossDeltaMinor', 'blockerReasonCodesJson',
    'operationId', 'schemaVersion', 'createdAt',
  ],
  [BILLING_SOURCE_COVERAGE_SLICES_TABLE]: [
    'id', 'companyId', 'branchId', 'coverageSetId', 'updId', 'formedUpdVersionId',
    'updLineId', 'updLineVersionId', 'periodId', 'closedPeriodVersionId', 'snapshotId',
    'rentalId', 'rentalLineId', 'clientId', 'contractId', 'sliceStartDate',
    'sliceEndDateExclusive', 'allocatedNetMinor', 'allocatedVatMinor', 'allocatedGrossMinor',
    'currency', 'contractualDueDate', 'dueDateProvenance', 'dueDateEvidenceRef', 'sliceHash',
    'schemaVersion', 'createdAt',
  ],
  [BILLING_SOURCE_OPERATIONS_TABLE]: [
    'id', 'companyId', 'branchId', 'operationType', 'idempotencyKey', 'commandFingerprint',
    'actorPrincipalId', 'actorMembershipId', 'actorMembershipVersion',
    'capabilityCatalogVersion', 'capabilityKey', 'resultAggregateType', 'resultAggregateId',
    'resultVersion', 'resultFingerprint', 'correlationId', 'schemaVersion', 'createdAt',
  ],
  [BILLING_SOURCE_AUDIT_EVENTS_TABLE]: [
    'id', 'companyId', 'branchId', 'aggregateType', 'aggregateId', 'aggregateVersion',
    'eventType', 'actorType', 'actorPrincipalId', 'actorMembershipId',
    'actorMembershipVersion', 'capabilityCatalogVersion', 'capabilityKey', 'correlationId',
    'reasonCode', 'reasonText', 'beforeFingerprint', 'afterFingerprint', 'operationId',
    'sourceSystem', 'metadataJson', 'schemaVersion', 'createdAt',
  ],
});

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function objectExists(db, type, name) {
  return Boolean(db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(type, name));
}

function migrationRow(db, name) {
  if (!tableExists(db, 'sql_shadow_schema_migrations')) return null;
  return db.prepare(`
    SELECT name, version, applied_at
    FROM sql_shadow_schema_migrations
    WHERE name = ?
  `).get(name) || null;
}

function assertMigration(db, name, version) {
  const row = migrationRow(db, name);
  if (Number(row?.version) !== version) {
    throw new Error(`BILLING_SOURCE_PREREQUISITE_REQUIRED:${name}:v${version}`);
  }
}

function assertForeignKeysEnabled(db) {
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new Error('BILLING_SOURCE_FOREIGN_KEYS_REQUIRED');
  }
}

function assertForeignKeyCheckClean(db) {
  const failures = db.pragma('foreign_key_check');
  if (failures.length > 0) {
    throw new Error(`BILLING_SOURCE_FOREIGN_KEY_CHECK_FAILED:${JSON.stringify(failures)}`);
  }
}

function assertNoCompetingRoots(db) {
  for (const table of ['companies', 'branches']) {
    if (tableExists(db, table)) throw new Error(`BILLING_SOURCE_COMPETING_AUTHORITY:${table}`);
  }
}

function assertNoCanonicalFinancialRows(db) {
  for (const table of FINANCIAL_TABLES) {
    const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
    if (count !== 0) throw new Error(`BILLING_SOURCE_CANONICAL_ROWS_PRESENT:${table}:${count}`);
  }
}

function assertCapabilityCatalogExact(db) {
  const versions = db.prepare(`
    SELECT version, status FROM capability_catalog_versions ORDER BY version
  `).all();
  if (versions.length !== 1 || Number(versions[0].version) !== 1 || versions[0].status !== 'active') {
    throw new Error('BILLING_SOURCE_CAPABILITY_CATALOG_MISMATCH');
  }
  const entries = db.prepare(`
    SELECT capabilityKey, scopeKind, assignable, status
    FROM capability_catalog_entries
    WHERE catalogVersion = 1
    ORDER BY capabilityKey
  `).all();
  const expected = CAPABILITY_CATALOG_V1.map(entry => ({
    capabilityKey: entry.key,
    scopeKind: entry.scopeKind,
    assignable: entry.assignable ? 1 : 0,
    status: 'active',
  }));
  if (JSON.stringify(entries) !== JSON.stringify(expected)) {
    throw new Error('BILLING_SOURCE_CAPABILITY_CATALOG_MISMATCH');
  }
}

function hasUnexpectedPartialState(db) {
  const tableStarted = BILLING_SOURCE_AUTHORITY_TABLES.some(table => tableExists(db, table));
  const objects = db.prepare(`
    SELECT type, name FROM sqlite_master
    WHERE name LIKE 'uq_billing_source_%'
       OR name LIKE 'idx_billing_source_%'
       OR name LIKE 'trg_billing_source_%'
  `).all();
  return tableStarted || objects.length > 0;
}

function assertBillingSourceAuthorityStructure(db, { requireMigration = true } = {}) {
  assertForeignKeysEnabled(db);
  assertNoCompetingRoots(db);
  assertPlatformIdentityStructure(db);
  assertCapabilityCatalogExact(db);
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    if (!tableExists(db, table)) throw new Error(`BILLING_SOURCE_SCHEMA_INCOMPLETE:${table}`);
    const actual = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    for (const column of columns) {
      if (!actual.has(column)) throw new Error(`BILLING_SOURCE_SCHEMA_INCOMPLETE:${table}.${column}`);
    }
  }
  for (const index of REQUIRED_INDEXES) {
    if (!objectExists(db, 'index', index)) throw new Error(`BILLING_SOURCE_SCHEMA_INCOMPLETE:${index}`);
  }
  for (const trigger of REQUIRED_TRIGGERS) {
    if (!objectExists(db, 'trigger', trigger)) throw new Error(`BILLING_SOURCE_SCHEMA_INCOMPLETE:${trigger}`);
  }
  if (requireMigration) {
    const applied = migrationRow(db, BILLING_SOURCE_AUTHORITY_MIGRATION_ID);
    if (Number(applied?.version) !== BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION) {
      throw new Error('BILLING_SOURCE_MIGRATION_REGISTRY_MISMATCH');
    }
  }
  assertForeignKeyCheckClean(db);
  return true;
}

function scopedRootForeignKeys() {
  return `
    FOREIGN KEY (companyId) REFERENCES ${CANONICAL_COMPANIES_TABLE}(id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (companyId, branchId) REFERENCES ${CANONICAL_BRANCHES_TABLE}(companyId, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  `;
}

function immutableTriggersSql(table) {
  return `
    CREATE TRIGGER trg_${table}_no_update
    BEFORE UPDATE ON ${table}
    BEGIN
      SELECT RAISE(ABORT, '${table} is immutable');
    END;
    CREATE TRIGGER trg_${table}_no_delete
    BEFORE DELETE ON ${table}
    BEGIN
      SELECT RAISE(ABORT, '${table} is append-only');
    END;
  `;
}

function ensureBillingSourceAuthoritySchema(db) {
  db.pragma('foreign_keys = ON');
  assertForeignKeysEnabled(db);
  assertMigration(db, CANONICAL_RECEIVABLES_MIGRATION_ID, CANONICAL_RECEIVABLES_SCHEMA_VERSION);
  assertMigration(
    db,
    CANONICAL_RECEIVABLES_SETTLEMENT_MIGRATION_ID,
    CANONICAL_RECEIVABLES_SETTLEMENT_SCHEMA_VERSION,
  );
  assertMigration(db, PLATFORM_IDENTITY_MIGRATION_ID, PLATFORM_IDENTITY_SCHEMA_VERSION);
  assertNoCompetingRoots(db);
  assertPlatformIdentityStructure(db);
  assertCapabilityCatalogExact(db);
  assertForeignKeyCheckClean(db);

  const applied = migrationRow(db, BILLING_SOURCE_AUTHORITY_MIGRATION_ID);
  if (applied) {
    if (Number(applied.version) !== BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION) {
      throw new Error(`BILLING_SOURCE_MIGRATION_VERSION_MISMATCH:${applied.version}`);
    }
    assertBillingSourceAuthorityStructure(db);
    return false;
  }
  if (hasUnexpectedPartialState(db)) throw new Error('BILLING_SOURCE_UNEXPECTED_PARTIAL_STATE');
  assertNoCanonicalFinancialRows(db);

  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE ${BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        firstGovernedPeriodStartDate TEXT NOT NULL,
        cohortReference TEXT NOT NULL,
        approvalReference TEXT NOT NULL,
        approvalFingerprint TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        sourceHash TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        CHECK (length(trim(id)) > 0),
        CHECK (date(firstGovernedPeriodStartDate) = firstGovernedPeriodStartDate),
        CHECK (length(trim(cohortReference)) > 0),
        CHECK (length(trim(approvalReference)) > 0),
        CHECK (length(approvalFingerprint) = 64),
        CHECK (length(sourceHash) = 64),
        CHECK (typeof(schemaVersion) = 'integer' AND schemaVersion >= 1)
      );

      CREATE TABLE ${BILLING_SOURCE_RENTAL_LINES_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        rentalId TEXT NOT NULL,
        clientId TEXT NOT NULL,
        contractId TEXT,
        equipmentId TEXT,
        activationBoundaryId TEXT NOT NULL,
        sourceSystem TEXT NOT NULL,
        sourceRentalRef TEXT NOT NULL,
        sourceLineIdentityKind TEXT NOT NULL,
        sourceLineRef TEXT NOT NULL,
        sourceEventId TEXT NOT NULL,
        sourceEventVersion INTEGER NOT NULL,
        provenanceHash TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (activationBoundaryId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (sourceLineIdentityKind IN ('source_system_line_id', 'source_event_line_id', 'generated_forward_line_id')),
        CHECK (typeof(sourceEventVersion) = 'integer' AND sourceEventVersion >= 1),
        CHECK (length(provenanceHash) = 64),
        CHECK (typeof(schemaVersion) = 'integer' AND schemaVersion >= 1),
        CHECK (length(trim(rentalId)) > 0 AND length(trim(clientId)) > 0),
        CHECK (length(trim(sourceSystem)) > 0 AND length(trim(sourceRentalRef)) > 0),
        CHECK (length(trim(sourceLineRef)) > 0 AND length(trim(sourceEventId)) > 0)
      );

      CREATE TABLE ${BILLING_SOURCE_EFFECTIVE_TERMS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        rentalLineId TEXT NOT NULL,
        version INTEGER NOT NULL,
        supersedesTermsVersionId TEXT,
        effectiveFromDate TEXT NOT NULL,
        effectiveToDateExclusive TEXT NOT NULL,
        rateAmountMinor INTEGER NOT NULL,
        rateUnitCode TEXT NOT NULL,
        rateQuantityScale INTEGER NOT NULL,
        contractualBillingCycleCode TEXT NOT NULL,
        contractualBillingCycleVersion INTEGER NOT NULL,
        minimumTermQuantity INTEGER NOT NULL,
        minimumTermUnitCode TEXT NOT NULL,
        discountKind TEXT NOT NULL,
        discountValue INTEGER NOT NULL,
        currency TEXT NOT NULL,
        calculationPolicyRef TEXT NOT NULL,
        vatPolicyRef TEXT NOT NULL,
        roundingPolicyRef TEXT NOT NULL,
        policyDecisionRef TEXT,
        policyResolutionStatus TEXT NOT NULL,
        unresolvedReasonCodesJson TEXT NOT NULL,
        sourceSystem TEXT NOT NULL,
        sourceRef TEXT NOT NULL,
        sourceVersion INTEGER NOT NULL,
        sourceHash TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (rentalLineId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_RENTAL_LINES_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (supersedesTermsVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_EFFECTIVE_TERMS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (typeof(version) = 'integer' AND version >= 1),
        CHECK (date(effectiveFromDate) = effectiveFromDate),
        CHECK (date(effectiveToDateExclusive) = effectiveToDateExclusive),
        CHECK (effectiveFromDate < effectiveToDateExclusive),
        CHECK (typeof(rateAmountMinor) = 'integer' AND rateAmountMinor >= 0),
        CHECK (typeof(rateQuantityScale) = 'integer' AND rateQuantityScale >= 0),
        CHECK (typeof(contractualBillingCycleVersion) = 'integer' AND contractualBillingCycleVersion >= 1),
        CHECK (typeof(minimumTermQuantity) = 'integer' AND minimumTermQuantity >= 0),
        CHECK (discountKind IN ('none', 'fixed_minor', 'basis_points')),
        CHECK (typeof(discountValue) = 'integer' AND discountValue >= 0),
        CHECK (discountKind != 'none' OR discountValue = 0),
        CHECK (currency = 'RUB'),
        CHECK (policyResolutionStatus IN ('resolved', 'unresolved')),
        CHECK (json_valid(unresolvedReasonCodesJson) AND json_type(unresolvedReasonCodesJson) = 'array'),
        CHECK ((policyResolutionStatus = 'resolved' AND json_array_length(unresolvedReasonCodesJson) = 0) OR (policyResolutionStatus = 'unresolved' AND json_array_length(unresolvedReasonCodesJson) > 0)),
        CHECK (length(sourceHash) = 64),
        CHECK (typeof(sourceVersion) = 'integer' AND sourceVersion >= 1),
        CHECK (typeof(schemaVersion) = 'integer' AND schemaVersion >= 1)
      );

      CREATE TABLE ${BILLING_SOURCE_PERIODS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        rentalId TEXT NOT NULL,
        rentalLineId TEXT NOT NULL,
        activationBoundaryId TEXT NOT NULL,
        contractualBillingCycleCode TEXT NOT NULL,
        contractualBillingCycleVersion INTEGER NOT NULL,
        cycleBoundaryEvidenceRef TEXT NOT NULL,
        periodStartDate TEXT NOT NULL,
        periodEndDateExclusive TEXT NOT NULL,
        identityHash TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (rentalLineId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_RENTAL_LINES_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (activationBoundaryId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (typeof(contractualBillingCycleVersion) = 'integer' AND contractualBillingCycleVersion >= 1),
        CHECK (date(periodStartDate) = periodStartDate),
        CHECK (date(periodEndDateExclusive) = periodEndDateExclusive),
        CHECK (periodStartDate < periodEndDateExclusive),
        CHECK (length(identityHash) = 64),
        CHECK (typeof(schemaVersion) = 'integer' AND schemaVersion >= 1)
      );

      CREATE TABLE ${BILLING_SOURCE_PERIOD_VERSIONS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        periodId TEXT NOT NULL,
        version INTEGER NOT NULL,
        eventType TEXT NOT NULL,
        previousVersionId TEXT,
        reopensClosedVersionId TEXT,
        effectiveTermsVersionId TEXT,
        snapshotId TEXT,
        operationId TEXT NOT NULL,
        actorPrincipalId TEXT NOT NULL,
        actorMembershipId TEXT NOT NULL,
        actorMembershipVersion INTEGER NOT NULL,
        capabilityCatalogVersion INTEGER NOT NULL,
        capabilityKey TEXT NOT NULL,
        reasonCode TEXT,
        reasonText TEXT,
        sourceEventId TEXT NOT NULL,
        sourceEventVersion INTEGER NOT NULL,
        sourceHash TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (periodId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_PERIODS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (previousVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_PERIOD_VERSIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (reopensClosedVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_PERIOD_VERSIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (effectiveTermsVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_EFFECTIVE_TERMS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (snapshotId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_SNAPSHOTS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (operationId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_OPERATIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (actorMembershipId, companyId)
          REFERENCES company_memberships(id, companyId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (capabilityCatalogVersion, capabilityKey)
          REFERENCES capability_catalog_entries(catalogVersion, capabilityKey)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (typeof(version) = 'integer' AND version >= 1),
        CHECK (eventType IN ('closed', 'reopened')),
        CHECK (typeof(actorMembershipVersion) = 'integer' AND actorMembershipVersion >= 1),
        CHECK (typeof(sourceEventVersion) = 'integer' AND sourceEventVersion >= 1),
        CHECK (length(sourceHash) = 64),
        CHECK (typeof(schemaVersion) = 'integer' AND schemaVersion >= 1),
        CHECK (
          (eventType = 'closed' AND effectiveTermsVersionId IS NOT NULL AND snapshotId IS NOT NULL AND capabilityKey = 'billing.period.close')
          OR
          (eventType = 'reopened' AND effectiveTermsVersionId IS NULL AND snapshotId IS NULL AND reopensClosedVersionId IS NOT NULL AND capabilityKey = 'billing.period.reopen' AND length(trim(reasonCode)) > 0 AND length(trim(reasonText)) > 0)
        )
      );

      CREATE TABLE ${BILLING_SOURCE_SNAPSHOTS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        rentalId TEXT NOT NULL,
        rentalLineId TEXT NOT NULL,
        periodId TEXT NOT NULL,
        closedPeriodVersionId TEXT NOT NULL,
        effectiveTermsVersionId TEXT NOT NULL,
        coveredStartDate TEXT NOT NULL,
        coveredEndDateExclusive TEXT NOT NULL,
        companyTimezone TEXT NOT NULL,
        currency TEXT NOT NULL,
        preDiscountNetMinor INTEGER NOT NULL,
        discountMinor INTEGER NOT NULL,
        netMinor INTEGER NOT NULL,
        vatMinor INTEGER NOT NULL,
        grossMinor INTEGER NOT NULL,
        calculationAlgorithmVersion INTEGER NOT NULL,
        calculationPolicyRef TEXT NOT NULL,
        vatPolicyRef TEXT NOT NULL,
        roundingPolicyRef TEXT NOT NULL,
        policyDecisionRef TEXT,
        sourceIntegrityStatus TEXT NOT NULL,
        blockerReasonCodesJson TEXT NOT NULL,
        calculationInputsJson TEXT NOT NULL,
        calculationInputsHash TEXT NOT NULL,
        evidenceSetHash TEXT NOT NULL,
        sourceHash TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        UNIQUE (closedPeriodVersionId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (rentalLineId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_RENTAL_LINES_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (periodId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_PERIODS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (closedPeriodVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_PERIOD_VERSIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (effectiveTermsVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_EFFECTIVE_TERMS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (date(coveredStartDate) = coveredStartDate),
        CHECK (date(coveredEndDateExclusive) = coveredEndDateExclusive),
        CHECK (coveredStartDate < coveredEndDateExclusive),
        CHECK (currency = 'RUB'),
        CHECK (typeof(preDiscountNetMinor) = 'integer' AND preDiscountNetMinor >= 0),
        CHECK (typeof(discountMinor) = 'integer' AND discountMinor >= 0),
        CHECK (typeof(netMinor) = 'integer' AND netMinor >= 0),
        CHECK (typeof(vatMinor) = 'integer' AND vatMinor >= 0),
        CHECK (typeof(grossMinor) = 'integer' AND grossMinor >= 0),
        CHECK (sourceIntegrityStatus IN ('matched', 'blocked')),
        CHECK (json_valid(blockerReasonCodesJson) AND json_type(blockerReasonCodesJson) = 'array'),
        CHECK ((sourceIntegrityStatus = 'matched' AND json_array_length(blockerReasonCodesJson) = 0) OR (sourceIntegrityStatus = 'blocked' AND json_array_length(blockerReasonCodesJson) > 0)),
        CHECK (json_valid(calculationInputsJson) AND json_type(calculationInputsJson) = 'object'),
        CHECK (length(calculationInputsHash) = 64 AND length(evidenceSetHash) = 64 AND length(sourceHash) = 64),
        CHECK (typeof(calculationAlgorithmVersion) = 'integer' AND calculationAlgorithmVersion >= 1),
        CHECK (typeof(schemaVersion) = 'integer' AND schemaVersion >= 1),
        CHECK (sourceIntegrityStatus != 'matched' OR (preDiscountNetMinor - discountMinor = netMinor AND netMinor + vatMinor = grossMinor))
      );

      CREATE TABLE ${BILLING_SOURCE_SNAPSHOT_EVIDENCE_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        snapshotId TEXT NOT NULL,
        evidenceType TEXT NOT NULL,
        sourceSystem TEXT NOT NULL,
        sourceId TEXT NOT NULL,
        sourceVersion INTEGER NOT NULL,
        sourceEventId TEXT NOT NULL,
        sourceEventVersion INTEGER NOT NULL,
        coveredStartDate TEXT NOT NULL,
        coveredEndDateExclusive TEXT NOT NULL,
        authorityStatus TEXT NOT NULL,
        authorityPolicyRef TEXT,
        evidenceHash TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (snapshotId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_SNAPSHOTS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (evidenceType IN ('rental', 'effective_terms', 'return', 'downtime', 'extension', 'contract', 'calculation_policy', 'vat_policy', 'rounding_policy', 'other_explicit')),
        CHECK (authorityStatus IN ('approved_by_reference', 'unresolved', 'rejected')),
        CHECK (authorityStatus != 'approved_by_reference' OR length(trim(authorityPolicyRef)) > 0),
        CHECK (date(coveredStartDate) = coveredStartDate AND date(coveredEndDateExclusive) = coveredEndDateExclusive),
        CHECK (coveredStartDate < coveredEndDateExclusive),
        CHECK (typeof(sourceVersion) = 'integer' AND sourceVersion >= 1),
        CHECK (typeof(sourceEventVersion) = 'integer' AND sourceEventVersion >= 1),
        CHECK (length(evidenceHash) = 64),
        CHECK (typeof(schemaVersion) = 'integer' AND schemaVersion >= 1)
      );

      CREATE TABLE ${BILLING_SOURCE_UPDS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        clientId TEXT NOT NULL,
        contractId TEXT,
        sourceSystem TEXT NOT NULL,
        sourceDocumentRef TEXT NOT NULL,
        legacyDocumentId TEXT,
        documentNumber TEXT,
        documentDate TEXT NOT NULL,
        currency TEXT NOT NULL,
        identityHash TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        CHECK (date(documentDate) = documentDate),
        CHECK (currency = 'RUB'),
        CHECK (length(identityHash) = 64),
        CHECK (length(trim(clientId)) > 0 AND length(trim(sourceSystem)) > 0 AND length(trim(sourceDocumentRef)) > 0),
        CHECK (typeof(schemaVersion) = 'integer' AND schemaVersion >= 1)
      );

      CREATE TABLE ${BILLING_SOURCE_UPD_VERSIONS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        updId TEXT NOT NULL,
        version INTEGER NOT NULL,
        state TEXT NOT NULL,
        previousVersionId TEXT,
        formedVersionId TEXT,
        correctsUpdVersionId TEXT,
        supersedesUpdVersionId TEXT,
        operationId TEXT NOT NULL,
        actorPrincipalId TEXT NOT NULL,
        actorMembershipId TEXT NOT NULL,
        actorMembershipVersion INTEGER NOT NULL,
        capabilityCatalogVersion INTEGER NOT NULL,
        capabilityKey TEXT NOT NULL,
        reasonCode TEXT,
        reasonText TEXT,
        lineSetHash TEXT,
        contentHash TEXT NOT NULL,
        sourceEventId TEXT NOT NULL,
        sourceEventVersion INTEGER NOT NULL,
        conductedAt TEXT,
        conductedEvidenceRef TEXT,
        conductedEvidenceVersion INTEGER,
        conductedEvidenceHash TEXT,
        conductedPolicyDecisionRef TEXT,
        clientSignatureEvidenceRef TEXT,
        signatureRequirementPolicyRef TEXT,
        sourceIntegrityStatus TEXT NOT NULL,
        blockerReasonCodesJson TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (updId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPDS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (previousVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPD_VERSIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (formedVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPD_VERSIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (correctsUpdVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPD_VERSIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (supersedesUpdVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPD_VERSIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (operationId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_OPERATIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (actorMembershipId, companyId)
          REFERENCES company_memberships(id, companyId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (capabilityCatalogVersion, capabilityKey)
          REFERENCES capability_catalog_entries(catalogVersion, capabilityKey)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (typeof(version) = 'integer' AND version >= 1),
        CHECK (state IN ('draft', 'formed', 'conducted', 'corrected', 'cancelled')),
        CHECK (sourceIntegrityStatus IN ('matched', 'blocked')),
        CHECK (json_valid(blockerReasonCodesJson) AND json_type(blockerReasonCodesJson) = 'array'),
        CHECK ((sourceIntegrityStatus = 'matched' AND json_array_length(blockerReasonCodesJson) = 0) OR (sourceIntegrityStatus = 'blocked' AND json_array_length(blockerReasonCodesJson) > 0)),
        CHECK (typeof(actorMembershipVersion) = 'integer' AND actorMembershipVersion >= 1),
        CHECK (typeof(sourceEventVersion) = 'integer' AND sourceEventVersion >= 1),
        CHECK (length(contentHash) = 64),
        CHECK (typeof(schemaVersion) = 'integer' AND schemaVersion >= 1),
        CHECK (state != 'draft' OR capabilityKey IN ('upd.form', 'upd.correct')),
        CHECK (state != 'formed' OR (formedVersionId IS NOT NULL AND length(lineSetHash) = 64 AND capabilityKey IN ('upd.form', 'upd.correct'))),
        CHECK (state != 'conducted' OR (formedVersionId IS NOT NULL AND conductedAt IS NOT NULL AND length(trim(conductedEvidenceRef)) > 0 AND conductedEvidenceVersion >= 1 AND length(conductedEvidenceHash) = 64 AND capabilityKey = 'upd.conduct')),
        CHECK (state NOT IN ('corrected', 'cancelled') OR (length(trim(reasonCode)) > 0 AND length(trim(reasonText)) > 0 AND capabilityKey = 'upd.correct'))
      );

      CREATE TABLE ${BILLING_SOURCE_UPD_LINES_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        updId TEXT NOT NULL,
        sourceLineRef TEXT NOT NULL,
        sourceLineIdentityKind TEXT NOT NULL,
        identityHash TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (updId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPDS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (sourceLineIdentityKind IN ('source_system_line_id', 'source_event_line_id', 'generated_forward_line_id')),
        CHECK (length(trim(sourceLineRef)) > 0),
        CHECK (length(identityHash) = 64),
        CHECK (typeof(schemaVersion) = 'integer' AND schemaVersion >= 1)
      );

      CREATE TABLE ${BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        updLineId TEXT NOT NULL,
        formedUpdVersionId TEXT NOT NULL,
        version INTEGER NOT NULL,
        supersedesLineVersionId TEXT,
        displayPosition INTEGER,
        description TEXT,
        quantityValueInteger INTEGER NOT NULL,
        quantityScale INTEGER NOT NULL,
        unitCode TEXT NOT NULL,
        currency TEXT NOT NULL,
        netMinor INTEGER NOT NULL,
        vatMinor INTEGER NOT NULL,
        grossMinor INTEGER NOT NULL,
        vatPolicyRef TEXT NOT NULL,
        roundingPolicyRef TEXT NOT NULL,
        policyDecisionRef TEXT,
        sourceIntegrityStatus TEXT NOT NULL,
        blockerReasonCodesJson TEXT NOT NULL,
        sourceSystem TEXT NOT NULL,
        sourceRef TEXT NOT NULL,
        sourceVersion INTEGER NOT NULL,
        contentHash TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (updLineId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPD_LINES_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (formedUpdVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPD_VERSIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (supersedesLineVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (typeof(version) = 'integer' AND version >= 1),
        CHECK (displayPosition IS NULL OR (typeof(displayPosition) = 'integer' AND displayPosition >= 1)),
        CHECK (typeof(quantityValueInteger) = 'integer' AND quantityValueInteger >= 0),
        CHECK (typeof(quantityScale) = 'integer' AND quantityScale >= 0),
        CHECK (currency = 'RUB'),
        CHECK (typeof(netMinor) = 'integer' AND netMinor >= 0),
        CHECK (typeof(vatMinor) = 'integer' AND vatMinor >= 0),
        CHECK (typeof(grossMinor) = 'integer' AND grossMinor >= 0),
        CHECK (sourceIntegrityStatus IN ('matched', 'blocked')),
        CHECK (json_valid(blockerReasonCodesJson) AND json_type(blockerReasonCodesJson) = 'array'),
        CHECK ((sourceIntegrityStatus = 'matched' AND json_array_length(blockerReasonCodesJson) = 0) OR (sourceIntegrityStatus = 'blocked' AND json_array_length(blockerReasonCodesJson) > 0)),
        CHECK (sourceIntegrityStatus != 'matched' OR netMinor + vatMinor = grossMinor),
        CHECK (typeof(sourceVersion) = 'integer' AND sourceVersion >= 1),
        CHECK (length(contentHash) = 64),
        CHECK (typeof(schemaVersion) = 'integer' AND schemaVersion >= 1)
      );

      CREATE TABLE ${BILLING_SOURCE_COVERAGE_SETS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        updId TEXT NOT NULL,
        formedUpdVersionId TEXT NOT NULL,
        version INTEGER NOT NULL,
        supersedesCoverageSetId TEXT,
        mappingAlgorithmVersion INTEGER NOT NULL,
        status TEXT NOT NULL,
        mappingHash TEXT NOT NULL,
        netDeltaMinor INTEGER NOT NULL,
        vatDeltaMinor INTEGER NOT NULL,
        grossDeltaMinor INTEGER NOT NULL,
        blockerReasonCodesJson TEXT NOT NULL,
        operationId TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (updId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPDS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (formedUpdVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPD_VERSIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (supersedesCoverageSetId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_COVERAGE_SETS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (operationId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_OPERATIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
        CHECK (typeof(version) = 'integer' AND version >= 1),
        CHECK (typeof(mappingAlgorithmVersion) = 'integer' AND mappingAlgorithmVersion >= 1),
        CHECK (status IN ('validated', 'blocked')),
        CHECK (length(mappingHash) = 64),
        CHECK (typeof(netDeltaMinor) = 'integer' AND typeof(vatDeltaMinor) = 'integer' AND typeof(grossDeltaMinor) = 'integer'),
        CHECK (json_valid(blockerReasonCodesJson) AND json_type(blockerReasonCodesJson) = 'array'),
        CHECK ((status = 'validated' AND json_array_length(blockerReasonCodesJson) = 0) OR (status = 'blocked' AND json_array_length(blockerReasonCodesJson) > 0)),
        CHECK (status != 'validated' OR (netDeltaMinor = 0 AND vatDeltaMinor = 0 AND grossDeltaMinor = 0)),
        CHECK (status != 'blocked' OR supersedesCoverageSetId IS NULL),
        CHECK (typeof(schemaVersion) = 'integer' AND schemaVersion >= 1)
      );

      CREATE TABLE ${BILLING_SOURCE_COVERAGE_SLICES_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        coverageSetId TEXT NOT NULL,
        updId TEXT NOT NULL,
        formedUpdVersionId TEXT NOT NULL,
        updLineId TEXT NOT NULL,
        updLineVersionId TEXT NOT NULL,
        periodId TEXT NOT NULL,
        closedPeriodVersionId TEXT NOT NULL,
        snapshotId TEXT NOT NULL,
        rentalId TEXT NOT NULL,
        rentalLineId TEXT NOT NULL,
        clientId TEXT NOT NULL,
        contractId TEXT,
        sliceStartDate TEXT NOT NULL,
        sliceEndDateExclusive TEXT NOT NULL,
        allocatedNetMinor INTEGER NOT NULL,
        allocatedVatMinor INTEGER NOT NULL,
        allocatedGrossMinor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        contractualDueDate TEXT,
        dueDateProvenance TEXT NOT NULL,
        dueDateEvidenceRef TEXT,
        sliceHash TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (coverageSetId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_COVERAGE_SETS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (updId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPDS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (formedUpdVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPD_VERSIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (updLineId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPD_LINES_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (updLineVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (periodId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_PERIODS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (closedPeriodVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_PERIOD_VERSIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (snapshotId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_SNAPSHOTS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (rentalLineId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_RENTAL_LINES_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (date(sliceStartDate) = sliceStartDate AND date(sliceEndDateExclusive) = sliceEndDateExclusive),
        CHECK (sliceStartDate < sliceEndDateExclusive),
        CHECK (typeof(allocatedNetMinor) = 'integer' AND allocatedNetMinor >= 0),
        CHECK (typeof(allocatedVatMinor) = 'integer' AND allocatedVatMinor >= 0),
        CHECK (typeof(allocatedGrossMinor) = 'integer' AND allocatedGrossMinor >= 0),
        CHECK (allocatedNetMinor + allocatedVatMinor = allocatedGrossMinor),
        CHECK (currency = 'RUB'),
        CHECK (dueDateProvenance IN ('invoice_due_date', 'contractual_payment_due_date', 'installment_due_date', 'unknown')),
        CHECK ((dueDateProvenance = 'unknown' AND contractualDueDate IS NULL AND dueDateEvidenceRef IS NULL) OR (dueDateProvenance != 'unknown' AND date(contractualDueDate) = contractualDueDate AND length(trim(dueDateEvidenceRef)) > 0)),
        CHECK (length(sliceHash) = 64),
        CHECK (typeof(schemaVersion) = 'integer' AND schemaVersion >= 1)
      );

      CREATE TABLE ${BILLING_SOURCE_OPERATIONS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        operationType TEXT NOT NULL,
        idempotencyKey TEXT NOT NULL,
        commandFingerprint TEXT NOT NULL,
        actorPrincipalId TEXT NOT NULL,
        actorMembershipId TEXT NOT NULL,
        actorMembershipVersion INTEGER NOT NULL,
        capabilityCatalogVersion INTEGER NOT NULL,
        capabilityKey TEXT NOT NULL,
        resultAggregateType TEXT NOT NULL,
        resultAggregateId TEXT NOT NULL,
        resultVersion INTEGER NOT NULL,
        resultFingerprint TEXT NOT NULL,
        correlationId TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (actorMembershipId, companyId)
          REFERENCES company_memberships(id, companyId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (capabilityCatalogVersion, capabilityKey)
          REFERENCES capability_catalog_entries(catalogVersion, capabilityKey)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (length(commandFingerprint) = 64 AND length(resultFingerprint) = 64),
        CHECK (typeof(actorMembershipVersion) = 'integer' AND actorMembershipVersion >= 1),
        CHECK (typeof(resultVersion) = 'integer' AND resultVersion >= 1),
        CHECK (typeof(schemaVersion) = 'integer' AND schemaVersion >= 1),
        CHECK (
          (operationType = 'close_billing_period' AND capabilityKey = 'billing.period.close')
          OR (operationType = 'reopen_billing_period' AND capabilityKey = 'billing.period.reopen')
          OR (operationType IN ('form_upd', 'record_upd_coverage') AND capabilityKey = 'upd.form')
          OR (operationType = 'conduct_upd' AND capabilityKey = 'upd.conduct')
          OR (operationType = 'correct_upd' AND capabilityKey = 'upd.correct')
        )
      );

      CREATE TABLE ${BILLING_SOURCE_AUDIT_EVENTS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        aggregateType TEXT NOT NULL,
        aggregateId TEXT NOT NULL,
        aggregateVersion INTEGER NOT NULL,
        eventType TEXT NOT NULL,
        actorType TEXT NOT NULL,
        actorPrincipalId TEXT NOT NULL,
        actorMembershipId TEXT NOT NULL,
        actorMembershipVersion INTEGER NOT NULL,
        capabilityCatalogVersion INTEGER NOT NULL,
        capabilityKey TEXT NOT NULL,
        correlationId TEXT NOT NULL,
        reasonCode TEXT,
        reasonText TEXT,
        beforeFingerprint TEXT,
        afterFingerprint TEXT NOT NULL,
        operationId TEXT NOT NULL,
        sourceSystem TEXT NOT NULL,
        metadataJson TEXT,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (operationId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_OPERATIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (actorMembershipId, companyId)
          REFERENCES company_memberships(id, companyId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (capabilityCatalogVersion, capabilityKey)
          REFERENCES capability_catalog_entries(catalogVersion, capabilityKey)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (actorType = 'user'),
        CHECK (typeof(aggregateVersion) = 'integer' AND aggregateVersion >= 1),
        CHECK (typeof(actorMembershipVersion) = 'integer' AND actorMembershipVersion >= 1),
        CHECK (beforeFingerprint IS NULL OR length(beforeFingerprint) = 64),
        CHECK (length(afterFingerprint) = 64),
        CHECK (metadataJson IS NULL OR json_valid(metadataJson)),
        CHECK (typeof(schemaVersion) = 'integer' AND schemaVersion >= 1)
      );

      CREATE UNIQUE INDEX uq_billing_source_rental_binding
        ON ${BILLING_SOURCE_RENTAL_LINES_TABLE}(companyId, sourceSystem, sourceRentalRef, sourceLineIdentityKind, sourceLineRef);
      CREATE UNIQUE INDEX uq_billing_source_terms_version
        ON ${BILLING_SOURCE_EFFECTIVE_TERMS_TABLE}(companyId, branchId, rentalLineId, version);
      CREATE UNIQUE INDEX uq_billing_source_terms_successor
        ON ${BILLING_SOURCE_EFFECTIVE_TERMS_TABLE}(supersedesTermsVersionId)
        WHERE supersedesTermsVersionId IS NOT NULL;
      CREATE UNIQUE INDEX uq_billing_source_period_identity
        ON ${BILLING_SOURCE_PERIODS_TABLE}(companyId, branchId, rentalLineId, contractualBillingCycleCode, contractualBillingCycleVersion, periodStartDate, periodEndDateExclusive);
      CREATE UNIQUE INDEX uq_billing_source_period_version
        ON ${BILLING_SOURCE_PERIOD_VERSIONS_TABLE}(companyId, branchId, periodId, version);
      CREATE UNIQUE INDEX uq_billing_source_upd_identity
        ON ${BILLING_SOURCE_UPDS_TABLE}(companyId, sourceSystem, sourceDocumentRef);
      CREATE UNIQUE INDEX uq_billing_source_upd_version
        ON ${BILLING_SOURCE_UPD_VERSIONS_TABLE}(companyId, branchId, updId, version);
      CREATE UNIQUE INDEX uq_billing_source_upd_line_identity
        ON ${BILLING_SOURCE_UPD_LINES_TABLE}(companyId, branchId, updId, sourceLineRef);
      CREATE UNIQUE INDEX uq_billing_source_upd_line_content_version
        ON ${BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE}(companyId, branchId, updLineId, version);
      CREATE UNIQUE INDEX uq_billing_source_coverage_set_version
        ON ${BILLING_SOURCE_COVERAGE_SETS_TABLE}(companyId, branchId, updId, formedUpdVersionId, version);
      CREATE UNIQUE INDEX uq_billing_source_validated_coverage_successor
        ON ${BILLING_SOURCE_COVERAGE_SETS_TABLE}(supersedesCoverageSetId)
        WHERE status = 'validated' AND supersedesCoverageSetId IS NOT NULL;
      CREATE UNIQUE INDEX uq_billing_source_operation_identity
        ON ${BILLING_SOURCE_OPERATIONS_TABLE}(companyId, operationType, idempotencyKey);

      CREATE INDEX idx_billing_source_period_scope
        ON ${BILLING_SOURCE_PERIODS_TABLE}(companyId, branchId, rentalLineId, periodStartDate, id);
      CREATE INDEX idx_billing_source_snapshot_scope
        ON ${BILLING_SOURCE_SNAPSHOTS_TABLE}(companyId, branchId, periodId, createdAt, id);
      CREATE INDEX idx_billing_source_upd_scope
        ON ${BILLING_SOURCE_UPDS_TABLE}(companyId, branchId, clientId, documentDate, id);
      CREATE INDEX idx_billing_source_coverage_scope
        ON ${BILLING_SOURCE_COVERAGE_SLICES_TABLE}(companyId, branchId, periodId, sliceStartDate, id);
      CREATE INDEX idx_billing_source_audit_scope
        ON ${BILLING_SOURCE_AUDIT_EVENTS_TABLE}(companyId, branchId, aggregateType, aggregateId, aggregateVersion, id);
      CREATE INDEX idx_billing_source_blocked_snapshots
        ON ${BILLING_SOURCE_SNAPSHOTS_TABLE}(companyId, branchId, createdAt, id)
        WHERE sourceIntegrityStatus = 'blocked';
      CREATE INDEX idx_billing_source_blocked_upd_versions
        ON ${BILLING_SOURCE_UPD_VERSIONS_TABLE}(companyId, branchId, createdAt, id)
        WHERE sourceIntegrityStatus = 'blocked';
      CREATE INDEX idx_billing_source_blocked_upd_lines
        ON ${BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE}(companyId, branchId, createdAt, id)
        WHERE sourceIntegrityStatus = 'blocked';
      CREATE INDEX idx_billing_source_blocked_coverage
        ON ${BILLING_SOURCE_COVERAGE_SETS_TABLE}(companyId, branchId, createdAt, id)
        WHERE status = 'blocked';

      CREATE TRIGGER trg_billing_source_periods_no_overlap
      BEFORE INSERT ON ${BILLING_SOURCE_PERIODS_TABLE}
      WHEN EXISTS (
        SELECT 1 FROM ${BILLING_SOURCE_PERIODS_TABLE} existing
        WHERE existing.companyId = NEW.companyId
          AND existing.branchId = NEW.branchId
          AND existing.rentalLineId = NEW.rentalLineId
          AND existing.contractualBillingCycleCode = NEW.contractualBillingCycleCode
          AND existing.contractualBillingCycleVersion = NEW.contractualBillingCycleVersion
          AND existing.periodStartDate < NEW.periodEndDateExclusive
          AND NEW.periodStartDate < existing.periodEndDateExclusive
      )
      BEGIN
        SELECT RAISE(ABORT, 'billing source period overlap');
      END;

      CREATE TRIGGER trg_billing_source_coverage_slices_no_overlap
      BEFORE INSERT ON ${BILLING_SOURCE_COVERAGE_SLICES_TABLE}
      WHEN EXISTS (
        SELECT 1
        FROM ${BILLING_SOURCE_COVERAGE_SLICES_TABLE} existing
        JOIN ${BILLING_SOURCE_COVERAGE_SETS_TABLE} existingSet ON existingSet.id = existing.coverageSetId
        WHERE existing.companyId = NEW.companyId
          AND existing.branchId = NEW.branchId
          AND existing.periodId = NEW.periodId
          AND existing.sliceStartDate < NEW.sliceEndDateExclusive
          AND NEW.sliceStartDate < existing.sliceEndDateExclusive
          AND existingSet.status = 'validated'
          AND NOT EXISTS (
            SELECT 1 FROM ${BILLING_SOURCE_COVERAGE_SETS_TABLE} successor
            WHERE successor.supersedesCoverageSetId = existingSet.id
              AND successor.status = 'validated'
          )
          AND (SELECT status FROM ${BILLING_SOURCE_COVERAGE_SETS_TABLE} WHERE id = NEW.coverageSetId) = 'validated'
      )
      BEGIN
        SELECT RAISE(ABORT, 'billing source active coverage overlap');
      END;

      ${IMMUTABLE_TABLES.map(immutableTriggersSql).join('\n')}

      CREATE TRIGGER trg_billing_source_operations_no_replace
      BEFORE INSERT ON ${BILLING_SOURCE_OPERATIONS_TABLE}
      WHEN EXISTS (SELECT 1 FROM ${BILLING_SOURCE_OPERATIONS_TABLE} WHERE id = NEW.id)
      BEGIN
        SELECT RAISE(ABORT, 'billing source operations are append-only');
      END;
      CREATE TRIGGER trg_billing_source_audit_events_no_replace
      BEFORE INSERT ON ${BILLING_SOURCE_AUDIT_EVENTS_TABLE}
      WHEN EXISTS (SELECT 1 FROM ${BILLING_SOURCE_AUDIT_EVENTS_TABLE} WHERE id = NEW.id)
      BEGIN
        SELECT RAISE(ABORT, 'billing source audit events are append-only');
      END;
    `);

    assertBillingSourceAuthorityStructure(db, { requireMigration: false });
    db.prepare(`
      INSERT INTO sql_shadow_schema_migrations (name, version)
      VALUES (?, ?)
    `).run(BILLING_SOURCE_AUTHORITY_MIGRATION_ID, BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION);
    return true;
  });

  return migrate.immediate();
}

module.exports = {
  BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE,
  BILLING_SOURCE_AUDIT_EVENTS_TABLE,
  BILLING_SOURCE_AUTHORITY_MIGRATION_ID,
  BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
  BILLING_SOURCE_AUTHORITY_TABLES,
  BILLING_SOURCE_COVERAGE_SETS_TABLE,
  BILLING_SOURCE_COVERAGE_SLICES_TABLE,
  BILLING_SOURCE_EFFECTIVE_TERMS_TABLE,
  BILLING_SOURCE_OPERATIONS_TABLE,
  BILLING_SOURCE_PERIODS_TABLE,
  BILLING_SOURCE_PERIOD_VERSIONS_TABLE,
  BILLING_SOURCE_RENTAL_LINES_TABLE,
  BILLING_SOURCE_SNAPSHOT_EVIDENCE_TABLE,
  BILLING_SOURCE_SNAPSHOTS_TABLE,
  BILLING_SOURCE_UPD_LINES_TABLE,
  BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE,
  BILLING_SOURCE_UPDS_TABLE,
  BILLING_SOURCE_UPD_VERSIONS_TABLE,
  REQUIRED_INDEXES,
  REQUIRED_TRIGGERS,
  assertBillingSourceAuthorityStructure,
  ensureBillingSourceAuthoritySchema,
};
